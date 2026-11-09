import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { chromium, firefox, expect, test, devices } from '@playwright/test'
import type { BrowserContext, Download, Page } from '@playwright/test'
import { io, type Socket } from 'socket.io-client'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { unzipSync } from 'fflate'
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
async function readDownload(page: Page, label: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label, exact: true }).click()])
  return readFile((await (file as Download).path())!)
}

test('sabit oda, iki tarayıcı, gizli tuval, süre, PNG, ZIP ve özel galeri', async ({ request }) => {
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
    const id = (await results(a).getAttribute('data-round'))!
    const own = await readDownload(a, 'Kendi çizimimi indir')
    const img = await loadImage(own)
    expect([img.width, img.height]).toEqual([1440, 1080])
    const bitmap = createCanvas(img.width, img.height).getContext('2d')
    bitmap.drawImage(img, 0, 0)
    expect(Array.from(bitmap.getImageData(720, 324, 1, 1).data)).toEqual(penPixel)
    expect(Array.from(bitmap.getImageData(20, 20, 1, 1).data)).toEqual(emptyPixel)
    const combined = await loadImage(await readDownload(a, 'İki çizimi birlikte indir'))
    expect([combined.width, combined.height]).toEqual([1600, 1320])
    const archive = unzipSync(await readDownload(a, 'Tüm sonuçları indir (ZIP)'))
    expect(Object.keys(archive).sort()).toEqual(['birinci', 'ikinci', 'sergi'].map(name => 'hadi-cizelim-' + id.slice(0, 8) + '-' + name + '.png'))
    for (const bytes of Object.values(archive)) expect((await loadImage(Buffer.from(bytes))).height).toBeGreaterThan(1000)
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
    await a.getByRole('button', { name: 'Galeriye git' }).click()
    await a.getByRole('button', { name: /Referanstan Çiz/ }).click()
    await expect(a.getByRole('img', { name: 'Referans fotoğrafı' })).toBeVisible()
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
    const shared = await request.get(backend + '/api/result/' + initial.id + '/ortak', { headers: auth(first.value) })
    expect(shared.ok()).toBeTruthy()
    const image = await loadImage(await shared.body())
    expect([image.width, image.height]).toEqual([1440, 1080])
    const ctx = createCanvas(image.width, image.height).getContext('2d')
    ctx.drawImage(image, 0, 0)
    expect(Array.from(ctx.getImageData(720, 324, 1, 1).data)).toEqual(penPixel)
    expect(Array.from(ctx.getImageData(720, 756, 1, 1).data)).toEqual(bluePixel)
  } finally {
    for (const peer of peers) peer.disconnect()
  }
})
