import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { chromium, firefox, expect, test, devices } from '@playwright/test'
import type { BrowserContext, Download, Page } from '@playwright/test'
import { io, type Socket } from 'socket.io-client'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { DrawInput, RoomView, Session, SocketInput, SocketOutput } from '../shared/protocol.ts'
import { site, backend } from '../playwright.config.ts'

const canvas = (page: Page) => page.getByLabel('Çizim tuvali')
const emptyPixel = [255, 252, 246, 255]
const penPixel = [55, 49, 44, 255]
const bluePixel = [110, 159, 183, 255]
const ready = (page: Page) => page.getByRole('button', { name: 'Hazırım', exact: true }).click()
const start = (page: Page) => page.getByRole('button', { name: 'Oyunu başlat' }).click()
const roomCode = (page: Page) => page.getByTestId('room-code').innerText()
const results = (page: Page) => page.getByTestId('results')
const session = (page: Page): Promise<Session> => page.evaluate(() => JSON.parse(sessionStorage.getItem('hc-aktif')!))
const auth = (s: Session) => ({ Authorization: 'Bearer ' + s.token })

async function open(page: Page, name: string, code?: string) {
  const url = new URL(site)
  if (code) url.searchParams.set('oda', code)
  await page.goto(url.toString())
  await page.getByLabel('Oyuncu adın').fill(name)
  await page.getByRole('button', { name: code ? 'Odaya katıl' : 'Oda oluştur', exact: true }).last().click()
}
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 })
  await page.mouse.up()
}
async function pixel(page: Page, x: number, y: number) {
  return canvas(page).evaluate((node: HTMLCanvasElement, { x, y }) => Array.from(
    node.getContext('2d')!.getImageData(Math.floor(node.width * x), Math.floor(node.height * y), 1, 1).data,
  ), { x, y })
}
async function touch(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  const box = (await canvas(page).boundingBox())!
  const points = (x: number) => [{ x: Math.round(box.x + box.width * x), y: Math.round(box.y + box.height * .45) }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(.2) })
  for (const x of [.28, .36, .44, .52, .60, .68]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(x) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
async function readDownload(page: Page) {
  const button = page.getByRole('button', { name: 'Çizimi İndir', exact: true })
  await expect(button).toHaveCount(1)
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(file.suggestedFilename()).toMatch(/^hadi-cizelim-[0-9a-f]{8}\.png$/)
  return readFile((await (file as Download).path())!)
}

async function openPng(bytes: Buffer) {
  const image = await loadImage(bytes)
  expect(image.width).toBe(2400)
  const ctx = createCanvas(image.width, image.height).getContext('2d')
  ctx.drawImage(image, 0, 0)
  return { height: image.height, ctx, at: (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data) }
}

test('sabit oda, iki tarayıcı, gizli tuval, süre, referanslı PNG ve özel galeri', async ({ request }) => {
  const [aBrowser, bBrowser] = await Promise.all([chromium.launch(), firefox.launch()])
  try {
    const a = await aBrowser.newPage()
    const b = await bBrowser.newPage()
    const c = await aBrowser.newPage()
    await open(a, 'Deniz', 'HadiCizelim')
    expect(await roomCode(a)).toBe('HADICIZELIM')
    await open(b, 'Ece', 'hadicizelim')
    expect(await roomCode(b)).toBe('HADICIZELIM')
    await open(c, 'Üçüncü', 'HADICIZELIM')
    await expect(c.getByRole('alert')).toHaveText('Bu oda dolu.')
    await expect(a.getByRole('button', { name: 'Oyunu başlat' })).toBeDisabled()
    const [aSession, bSession] = await Promise.all([session(a), session(b)])
    expect(aSession.token).not.toBe(bSession.token)
    await ready(a)
    await ready(b)
    const started = Date.now()
    await start(a)
    const ref = (p: Page) => p.getByRole('img', { name: 'Bu turun referans fotoğrafı' })
    await expect(ref(a)).toBeVisible()
    await expect(ref(b)).toHaveAttribute('src', (await ref(a).getAttribute('src'))!)
    expect(await ref(a).evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth))).toBeGreaterThan(0)
    const [minutes, seconds] = (await a.getByTestId('timer').innerText()).split(':').map(Number)
    const remaining = 60 * minutes + seconds
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(60)
    await draw(a, [.15, .3], [.8, .3])
    await expect.poll(() => pixel(a, .5, .3)).toEqual(penPixel)
    expect(await pixel(b, .5, .3)).toEqual(emptyPixel)
    await b.getByRole('button', { name: 'Gökyüzü mavisi' }).click()
    await draw(b, [.15, .65], [.8, .65])
    await expect.poll(() => pixel(b, .5, .65)).toEqual(bluePixel)
    expect(await pixel(a, .5, .65)).toEqual(emptyPixel)
    await a.reload()
    await expect.poll(() => pixel(a, .5, .3)).toEqual(penPixel)
    expect((await session(a)).token).toBe(aSession.token)
    await expect(results(a)).toBeVisible({ timeout: 65_000 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(59_000)
    await expect(results(b)).toBeVisible()
    await expect(canvas(a)).toHaveCount(0)
    await expect(results(a).getByRole('button')).toHaveCount(3)
    await expect(results(a).locator('figcaption')).toHaveText(['Deniz', 'Ece'])
    const id = (await results(a).getAttribute('data-round'))!
    const refResponse = await request.get(new URL((await ref(a).getAttribute('src'))!, site).toString())
    const reference = await loadImage(await refResponse.body())
    const scale = Math.min(1488 / reference.width, 960 / reference.height)
    const refHeight = Math.ceil(reference.height * scale)
    const combined = await openPng(await readDownload(a))
    expect(combined.height).toBe(1085 + refHeight)
    const referencePixels = createCanvas(2400, refHeight + 60).getContext('2d')
    referencePixels.drawImage(reference, (2400 - reference.width * scale) / 2, 60, reference.width * scale, reference.height * scale)
    for (const x of [1100, 1200, 1300]) {
      const y = 60 + Math.floor(refHeight / 2)
      expect(combined.at(x, y)).toEqual(Array.from(referencePixels.getImageData(x, y, 1, 1).data))
    }
    expect(combined.at(100, 60 + Math.floor(refHeight / 2))).toEqual([247, 241, 229, 255])
    const boardTop = 124 + refHeight
    expect(combined.at(618, boardTop + 244)).toEqual(penPixel)
    expect(combined.at(1782, boardTop + 528)).toEqual(bluePixel)
    await a.getByRole('button', { name: 'Galeriye kaydet' }).click()
    await expect(a.getByRole('button', { name: 'Galeriye kaydedildi' })).toBeVisible({ timeout: 16_000 })
    const url = backend + '/api/gallery/' + id + '/sergi'
    expect((await request.get(url, { headers: auth(bSession) })).ok()).toBeTruthy()
    expect((await request.get(url)).status()).toBe(401)
    await open(c, 'Dış oda')
    await expect(c.getByTestId('room-code')).toBeVisible()
    const cSession = await session(c)
    expect((await request.get(url, { headers: auth(cSession) })).status()).toBe(404)
    expect(await (await request.get(backend + '/api/gallery', { headers: auth(cSession) })).json()).toEqual({ entries: [], next: null })
    await a.getByRole('button', { name: 'Galerim' }).click()
    await a.getByRole('button', { name: /Referanstan Çiz/ }).click()
    await expect(a.getByRole('img', { name: 'Referans fotoğrafı' })).toBeVisible()
    await expect(a.locator('.gallery-detail').getByRole('button')).toHaveCount(2)
    expect(await readDownload(a)).toEqual(await (await request.get(url, { headers: auth(aSession) })).body())
    await a.getByRole('button', { name: 'Odadan ayrıl' }).click()
    await b.getByRole('button', { name: 'Odadan ayrıl' }).click()
    expect((await request.get(url, { headers: auth(aSession) })).ok()).toBeTruthy()
    await c.getByRole('button', { name: 'Odadan ayrıl' }).click()
    await open(c, 'Yeni oyuncu', 'hadicizelim')
    await expect(c.getByTestId('room-code')).toHaveText('HADICIZELIM')
    expect((await request.get(url, { headers: auth(await session(c)) })).status()).toBe(404)
    await c.getByRole('button', { name: 'Odadan ayrıl' }).click()
  } finally {
    await Promise.all([aBrowser.close(), bBrowser.close()])
  }
})

test('cümle modu, davet, mobil dokunmatik kalem, silgi ve geri alma', async () => {
  const browser = await chromium.launch()
  try {
    const a = await browser.newPage()
    const mobile = await browser.newContext({ ...devices['Pixel 7'] })
    const b = await mobile.newPage()
    await open(a, 'Mert')
    await open(b, 'İpek', await roomCode(a))
    await a.getByRole('button', { name: /Cümleden Çiz/ }).click()
    await ready(a)
    await ready(b)
    await start(a)
    const sentence = a.getByTestId('sentence')
    await expect(sentence).toBeVisible()
    await expect(b.getByTestId('sentence')).toHaveText(await sentence.innerText())
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    expect(await canvas(b).evaluate(node => node.getBoundingClientRect().width / innerWidth)).toBeGreaterThanOrEqual(.99)
    expect(await canvas(b).evaluate(node => getComputedStyle(node).touchAction)).toBe('none')
    await touch(mobile, b)
    await expect.poll(() => pixel(b, .5, .45)).toEqual(penPixel)
    const before = await b.evaluate(() => scrollY)
    await b.getByRole('button', { name: 'Silgi', exact: true }).click()
    await touch(mobile, b)
    await expect.poll(() => pixel(b, .5, .45)).toEqual(emptyPixel)
    await b.getByRole('button', { name: 'Geri al', exact: true }).click()
    await expect.poll(() => pixel(b, .5, .45)).toEqual(penPixel)
    expect(await b.evaluate(() => scrollY)).toBe(before)
    await b.setViewportSize({ width: 360, height: 740 })
    await expect.poll(() => pixel(b, .5, .45)).toEqual(penPixel)
    await expect(results(a)).toBeVisible({ timeout: 65_000 })
    await expect(results(b)).toBeVisible()
    const [left, right] = await results(b).locator('canvas').evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, right } = node.getBoundingClientRect()
      return { x, y, width, right }
    }))
    expect(left.y).toBe(right.y)
    expect(Math.abs(left.width - right.width)).toBeLessThan(.5)
    expect(left.right).toBeLessThan(right.x)
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await expect(results(b).locator('figcaption')).toHaveText(['Mert', 'İpek'])
    const sentencePng = await openPng(await readDownload(b))
    const sentenceInk = sentencePng.ctx.getImageData(140, 60, 2120, sentencePng.height - 1085).data
    expect(sentenceInk.some((channel, index) => index % 4 === 0 && channel < 100)).toBeTruthy()
    expect(sentencePng.at(1782, sentencePng.height - 60 - 88 - 813 + 366)).toEqual(penPixel)
    await a.getByRole('button', { name: 'Tekrar oyna' }).click()
    await expect(a.getByRole('heading', { name: 'Oyun lobisi' })).toBeVisible()
    await expect(b.getByRole('heading', { name: 'Oyun lobisi' })).toBeVisible()
    await a.getByRole('button', { name: /Sıralı Çizim/ }).click()
    await ready(a)
    await ready(b)
    await start(a)
    await expect(b.getByRole('button', { name: 'Silgi' })).toBeDisabled()
    await draw(a, [.18, .33], [.8, .33])
    await expect.poll(() => pixel(b, .5, .33)).toEqual(penPixel)
    await expect(b.getByTestId('turn')).toHaveText('Sıra 2 / 8', { timeout: 19_000 })
    await expect(b.getByRole('button', { name: 'Silgi' })).toBeEnabled()
    await expect(a.getByRole('button', { name: 'Silgi' })).toBeDisabled()
  } finally { await browser.close() }
})

test('ortak tuval sekiz adet 15 saniyelik sıra, sunucu yetkisi ve yeniden bağlantı', async ({ request }) => {
  const peers: Socket<SocketOutput, SocketInput>[] = [io(backend, { transports: ['websocket'] }), io(backend, { transports: ['websocket'] })]
  const states: [RoomView[], RoomView[]] = [[], []]
  const latest = (i: number) => states[i].at(-1)
  peers.forEach((socket, i) => socket.on('room', room => states[i].push(room)))
  try {
    const first = await peers[0].timeout(8000).emitWithAck('enter', { action: 'create', name: 'Ada', code: '' })
    if (!first.ok) throw new Error(first.error)
    const second = await peers[1].timeout(8000).emitWithAck('enter', { action: 'join', name: 'Can', code: first.value.code })
    if (!second.ok) throw new Error(second.error)
    const a = peers[0].timeout(8000)
    const b = peers[1].timeout(8000)
    expect((await a.emitWithAck('mode', 'relay')).ok).toBeTruthy()
    await a.emitWithAck('ready', true)
    await b.emitWithAck('ready', true)
    expect((await a.emitWithAck('start')).ok).toBeTruthy()
    await expect.poll(() => latest(1)?.round?.turn).toBe(0)
    const initial = latest(1)!.round!
    expect(initial.endsAt - latest(1)!.serverNow).toBeGreaterThanOrEqual(14_990)
    const stroke: DrawInput = { round: initial.id, turn: 0, offset: 0, id: randomUUID(), erase: false, color: 0, size: 1, points: [[.2, .3], [.7, .3]] }
    expect((await b.emitWithAck('draw', stroke)).ok).toBeFalsy()
    const patch = new Promise(resolve => peers[1].once('patch', resolve))
    expect((await a.emitWithAck('draw', stroke)).ok).toBeTruthy()
    expect(await patch).toMatchObject({ round: initial.id, points: stroke.points })
    expect((await a.emitWithAck('draw', stroke)).ok).toBeTruthy()
    peers[0].disconnect()
    await expect.poll(() => latest(1)?.players[0].connected).toBeFalsy()
    peers[0].connect()
    const rejoin = await peers[0].timeout(8000).emitWithAck('enter', { ...first.value, action: 'resume' })
    expect(rejoin).toEqual(first)
    await expect.poll(() => latest(0)?.round?.strokes[0]?.points).toEqual(stroke.points)
    for (let turn = 1; turn < 8; turn++) {
      await expect.poll(() => latest(1)?.round?.turn, { timeout: 19_000 }).toBe(turn)
      const now = latest(1)!.round!
      expect(now.active).toBe(turn % 2)
      expect(now.endsAt - initial.endsAt).toBe(turn * 15_000)
      expect(now.strokes[0].points).toEqual(stroke.points)
      const attempt = { ...stroke, id: randomUUID(), turn, color: 4, points: [[.2, .7], [.7, .7]] as DrawInput['points'] }
      const active = peers[turn % 2].timeout(8000)
      const inactive = peers[1 - turn % 2].timeout(8000)
      expect((await inactive.emitWithAck('draw', attempt)).ok).toBeFalsy()
      if (turn === 1) {
        expect((await active.emitWithAck('undo', { round: initial.id, turn, id: stroke.id })).ok).toBeFalsy()
        expect((await active.emitWithAck('draw', attempt)).ok).toBeTruthy()
      }
    }
    await expect.poll(() => latest(1)?.phase, { timeout: 19_000 }).toBe('results')
    expect((await a.emitWithAck('draw', { ...stroke, turn: 7 })).ok).toBeFalsy()
    const shared = await request.get(backend + '/api/result/' + initial.id + '/sergi', { headers: auth(first.value) })
    expect(shared.ok()).toBeTruthy()
    const composition = await openPng(await shared.body())
    const top = composition.height - 60 - 88 - 1308
    expect(composition.at(1200, top + 392)).toEqual(penPixel)
    expect(composition.at(1200, top + 916)).toEqual(bluePixel)
    expect(composition.at(200, top + 392)).toEqual([247, 241, 229, 255])
  } finally {
    for (const peer of peers) peer.disconnect()
  }
})
