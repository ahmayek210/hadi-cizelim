import { createServer } from 'node:http'
import cors from 'cors'
import express from 'express'
import { Server } from 'socket.io'
import type { SocketInput, SocketOutput } from '../shared/protocol.ts'
import { Game, tokenDigest, type Round } from './game.ts'
import { filename, makeZip, renderExports, resultFiles, type Exports, type ResultFile } from './export.ts'
import { openGallery } from './gallery.ts'
import { RateLimit } from './limits.ts'

const production = process.env.NODE_ENV === 'production'
const allowed = new Set((process.env.FRONTEND_ORIGINS || (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
  .split(',').map(value => value.trim()).filter(Boolean))
if (!allowed.size) throw new Error('FRONTEND_ORIGINS gerekli.')

const app = express()
app.disable('x-powered-by')
if (process.env.RAILWAY_ENVIRONMENT) app.set('trust proxy', 1)
app.use(cors({ origin: (origin, done) => done(null, !origin || allowed.has(origin)), allowedHeaders: ['Authorization', 'Content-Type'] }))
const server = createServer(app)
const io = new Server<SocketInput, SocketOutput>(server, {
  cors: { origin: [...allowed] }, maxHttpBufferSize: 12_000,
  allowRequest: (req, done) => done(null, !req.headers.origin || allowed.has(req.headers.origin)),
})
const game = new Game(io)
const gallery = await openGallery()
const limits = new RateLimit()
setInterval(() => limits.prune(), 30_000).unref()
const exportsInFlight = new Map<string, Promise<Exports>>()
const saves = new Map<string, Promise<void>>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function render(round: Round) {
  const prior = exportsInFlight.get(round.id)
  if (prior) return prior
  const job = renderExports(round).finally(() => exportsInFlight.delete(round.id))
  exportsInFlight.set(round.id, job)
  return job
}
function save(round: Round) {
  const prior = saves.get(round.id)
  if (prior) return prior
  const job = render(round).then(files => gallery.save(round, files)).finally(() => saves.delete(round.id))
  saves.set(round.id, job)
  return job
}

app.get('/health', async (_req, res) => {
  try {
    const storage = await gallery.check()
    res.json({ ok: true, database: storage === 'neon' ? 'neon' : 'local', storage })
  } catch {
    res.status(503).json({ ok: false })
  }
})

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  res.set('X-Content-Type-Options', 'nosniff')
  const hash = tokenDigest(req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || '')
  if (!hash) { res.status(401).json({ error: 'Oda oturumu gerekiyor.' }); return }
  if (!limits.take('ip:' + req.ip, 240, 60_000) || !limits.take(hash, 140, 60_000)) {
    res.status(429).json({ error: 'Çok fazla istek. Biraz sonra tekrar dene.' })
    return
  }
  res.locals.hash = hash
  next()
})

app.get('/api/gallery', async (_req, res) => {
  const hash: string = res.locals.hash
  const entries = await gallery.list(hash)
  if (!entries.length && !game.isMember(hash)) { res.status(403).json({ error: 'Bu oturumun galeri erişimi yok.' }); return }
  res.json(entries)
})

app.post('/api/gallery/:id', async (req, res) => {
  const id = req.params.id
  const hash: string = res.locals.hash
  if (UUID.test(id)) {
    if (await gallery.entry(hash, id)) { res.json({ ok: true }); return }
    const round = game.result(id, hash)
    if (round) {
      if (!limits.take(hash + ':save', 12, 60_000)) { res.status(429).json({ error: 'Biraz sonra tekrar dene.' }); return }
      await save(round)
      res.json({ ok: true })
      return
    }
  }
  res.status(404).json({ error: 'Bu çizim bulunamadı.' })
})

app.get('/api/:source/:id/:file', async (req, res) => {
  const { source, id, file } = req.params
  const hash: string = res.locals.hash
  if (!UUID.test(id) || (source !== 'gallery' && source !== 'result')) {
    res.status(404).json({ error: 'Bu çizim bulunamadı.' })
    return
  }
  const round = source === 'result' ? game.result(id, hash) : null
  const entry = round || await gallery.entry(hash, id)
  const files = entry ? resultFiles(entry.mode) : []
  if (!entry || (file !== 'zip' && !files.includes(file as ResultFile))) {
    res.status(404).json({ error: 'Bu çizim bulunamadı.' })
    return
  }
  if (round && !limits.take(hash + ':render', 22, 60_000)) {
    res.status(429).json({ error: 'Biraz sonra tekrar dene.' }); return
  }
  if (file === 'zip') {
    const images = round ? await render(round) : Object.fromEntries(await Promise.all(
      files.filter(name => name !== 'onizleme').map(async name => [name, await gallery.get(id, name)]),
    ))
    res.type('application/zip').attachment(filename(id, file)).send(Buffer.from(makeZip(images, id)))
    return
  }
  const name = file as ResultFile
  const png = round ? (await render(round))[name] : await gallery.get(id, name)
  res.type('image/png').send(png)
})

app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('API isteği işlenemedi.')
  res.status(503).json({ error: 'İşlem tamamlanamadı. Biraz sonra tekrar dene.' })
})

server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Hadi Çizelim API hazır.'))
