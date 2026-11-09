import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import { FIXED, MODES, normalizeCode, REFERENCES, WIDTHS, PALETTE } from '../shared/protocol.ts'
import type { DrawInput, Join, Mode, Patch, Reply, RoomView, RoundInfo, Slot, SocketInput, SocketOutput, Stroke } from '../shared/protocol.ts'
import sentences from '../shared/sentences.json' with { type: 'json' }
import { RateLimit } from './limits.ts'

type Peer = Socket<SocketInput, SocketOutput, Record<string, never>, { code?: string; slot?: Slot }>
type Hub = Server<SocketInput, SocketOutput, Record<string, never>, Peer['data']>
type Player = { slot: Slot; name: string; digest: string; sid: string | null; ready: boolean; gone: number; left: boolean }
export type Round = RoundInfo & {
  starts: Slot; turn: number; endsAt: number; members: [string, string];
  strokes: Stroke[]; byId: Map<string, Stroke>; used: Set<string>; points: number;
}
type Room = {
  code: string; players: Player[]; mode: Mode; round: Round | null;
  phase: RoomView['phase']; first: Slot; refs: string[]; timer?: NodeJS.Timeout;
}
const QUOTES = [
  'Beklenmedik bir şaheser.', 'Müze müdürü bir duvar ayırdı.', 'Bu kâğıt bir sergiyi hak ediyor.',
  'Sanat tarihine küçük bir çentik.', 'Bunu açıklamak için bilim insanı lazım.',
  'Bir kalemle başlayan macera, işte burada.', 'Çerçeve nerede? Bu eser beklemesin.',
]
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE = /^[A-Z2-9]{6}$/
export const TOKEN = /^[a-f0-9]{64}$/
const STROKE_ID = /^[a-z0-9-]{1,48}$/
const RESERVATION = 5 * 60_000
const ROOM_TTL = 20 * 60_000
const INVALID = 'Bu işlem şu anda yapılamıyor.'
const LIMIT = 'Biraz yavaşla ve tekrar dene.'
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
export function tokenDigest(token: string) { return TOKEN.test(token) ? digest(token) : '' }

function activeSlot(round: Round): Slot {
  return ((round.starts + round.turn) % 2) as Slot
}
function shuffledReferences() {
  const list = REFERENCES.map(ref => ref.file)
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

export class Game {
  private rooms = new Map<string, Room>()
  private results = new Map<string, Round>()
  private limits = new RateLimit()
  private identities = new Map<string, Player>()

  constructor(private io: Hub) {
    io.on('connection', socket => this.connect(socket))
    setInterval(() => {
      this.limits.prune()
      for (const room of this.rooms.values()) this.prune(room)
    }, 30_000).unref()
  }

  isMember(hash: string) { return this.identities.has(hash) }

  result(id: string, hash: string) {
    const round = this.results.get(id)
    return round?.members.includes(hash) ? round : null
  }

  private discard(room: Room) {
    if (room.timer) clearTimeout(room.timer)
    if (room.round) this.results.delete(room.round.id)
    for (const player of room.players) this.identities.delete(player.digest)
    this.rooms.delete(room.code)
  }

  private prune(room: Room) {
    if (room.players.every(p => !p.sid && (p.left || Date.now() - p.gone > ROOM_TTL))) {
      this.discard(room)
      return
    }
    if (room.phase !== 'lobby') return
    for (const player of room.players) {
      if (!player.sid && (player.left || Date.now() - player.gone > RESERVATION)) {
        this.identities.delete(player.digest)
        room.players = room.players.filter(p => p !== player)
      }
    }
    if (!room.players.length) this.discard(room)
  }

  private snapshot(room: Room, me: Slot): RoomView {
    const round = room.round
    return {
      code: room.code, me, host: room.players[0].slot, mode: room.mode, phase: room.phase, serverNow: Date.now(),
      players: room.players.map(p => ({ slot: p.slot, name: p.name, ready: p.ready, connected: !!p.sid })),
      round: round && {
        id: round.id, mode: round.mode, prompt: round.prompt, names: round.names, date: round.date, quote: round.quote,
        turn: round.turn, endsAt: round.endsAt,
        active: room.phase === 'drawing' && round.mode === 'relay' ? activeSlot(round) : null,
        strokes: room.phase === 'results' || round.mode === 'relay' ? round.strokes : round.strokes.filter(s => s.owner === me),
      },
    }
  }

  private publish(room: Room) {
    for (const p of room.players) if (p.sid) this.io.to(p.sid).emit('room', this.snapshot(room, p.slot))
  }

  private enter(socket: Peer, input: Join): Reply<{ code: string; token: string; name: string }> {
    if (socket.data.code) return { ok: false, error: INVALID }
    if (!input || typeof input.code !== 'string' || typeof input.name !== 'string' ||
      input.code.length > 30 || input.name.length > 64) return { ok: false, error: 'Oda bilgilerini kontrol et.' }
    const name = input.name.trim().replace(/\s+/g, ' ').normalize('NFC')
    const code = normalizeCode(input.code)
    if (input.action === 'resume') {
      const hash = typeof input.token === 'string' ? tokenDigest(input.token) : ''
      const room = this.rooms.get(code)
      const player = room?.players.find(p => p.digest === hash && !p.left)
      if (!room || !player || !input.token) return { ok: false, error: 'Oturum sona erdi. Kayıtlı çizimlerin galeride durur.' }
      this.advance(room)
      const old = player.sid ? this.io.sockets.sockets.get(player.sid) : undefined
      player.sid = socket.id
      socket.data.code = code
      socket.data.slot = player.slot
      if (old) {
        old.emit('replaced')
        old.disconnect()
      }
      return { ok: true, value: { code, token: input.token, name: player.name } }
    }
    if (input.action !== 'create' && input.action !== 'join') return { ok: false, error: INVALID }
    if (!name || [...name].length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) return { ok: false, error: 'Adın 1 ile 24 karakter arasında olmalı.' }
    if (input.action === 'join' && code !== FIXED && !CODE.test(code)) return { ok: false, error: 'Oda kodunu kontrol et.' }
    let roomCode = code
    if (input.action === 'create') {
      do { roomCode = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('') }
      while (this.rooms.has(roomCode))
    }
    const existing = this.rooms.get(roomCode)
    if (existing) this.prune(existing)
    let room = this.rooms.get(roomCode)
    if (!room) {
      if (input.action === 'join' && roomCode !== FIXED) return { ok: false, error: 'Oda bulunamadı. Kodu arkadaşından tekrar iste.' }
      if (this.rooms.size >= 100 || !this.limits.take('create', 24, 60_000)) {
        return { ok: false, error: 'Şu anda çok fazla oda açılıyor. Biraz sonra tekrar dene.' }
      }
      room = { code: roomCode, players: [], mode: 'reference', round: null, phase: 'lobby', first: 0, refs: [] }
      this.rooms.set(roomCode, room)
    }
    if (room.players.length >= 2 || room.phase !== 'lobby') return { ok: false, error: 'Bu oda dolu.' }
    const token = randomBytes(32).toString('hex')
    const slot = room.players.some(p => p.slot === 0) ? 1 : 0
    const player: Player = { slot, name, digest: digest(token), sid: socket.id, ready: false, gone: 0, left: false }
    room.players.push(player)
    this.identities.set(player.digest, player)
    socket.data.code = roomCode
    socket.data.slot = slot
    return { ok: true, value: { code: roomCode, name, token } }
  }

  private advance(room: Room) {
    const round = room.round
    if (!round || room.phase !== 'drawing' || Date.now() < round.endsAt) return
    if (room.timer) clearTimeout(room.timer)
    if (round.mode === 'relay') {
      while (Date.now() >= round.endsAt && round.turn < 7) {
        round.turn++
        round.endsAt += 15_000
      }
    }
    if (Date.now() >= round.endsAt) {
      room.phase = 'results'
      this.results.set(round.id, round)
    } else {
      this.schedule(room)
    }
    this.publish(room)
  }

  private schedule(room: Room) {
    room.timer = setTimeout(() => this.advance(room), Math.max(1, room.round!.endsAt - Date.now())).unref()
  }

  private start(room: Room) {
    const players = [...room.players].sort((a, b) => a.slot - b.slot)
    if (!room.refs.length) room.refs = shuffledReferences()
    const prompt = room.mode === 'reference' ? { reference: room.refs.pop()! } : { sentence: sentences[randomInt(sentences.length)] }
    room.round = {
      id: randomUUID(), mode: room.mode, prompt, names: [players[0].name, players[1].name],
      date: new Date().toISOString(), quote: QUOTES[randomInt(QUOTES.length)], starts: room.first,
      turn: 0, endsAt: Date.now() + (room.mode === 'relay' ? 15_000 : 60_000),
      members: [players[0].digest, players[1].digest], strokes: [], byId: new Map(), used: new Set(), points: 0,
    }
    if (room.mode === 'relay') room.first = room.first === 0 ? 1 : 0
    room.phase = 'drawing'
    this.schedule(room)
    this.publish(room)
  }

  private canDraw(room: Room, player: Player, roundId: string, turn: number) {
    const round = room.round
    return round && room.phase === 'drawing' && round.id === roundId && round.turn === turn &&
      Date.now() < round.endsAt && (round.mode !== 'relay' || activeSlot(round) === player.slot) ? round : null
  }

  private drawingPeers(room: Room, player: Player) {
    return room.round!.mode === 'relay' ? room.players : [player]
  }

  private draw(room: Room, player: Player, input: DrawInput) {
    if (!input || typeof input.id !== 'string' || !STROKE_ID.test(input.id) ||
      !Number.isInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.color) ||
      input.color < 0 || input.color >= PALETTE.length || !Number.isInteger(input.size) ||
      input.size < 0 || input.size >= WIDTHS.length || typeof input.erase !== 'boolean' ||
      !Array.isArray(input.points) || !input.points.length || input.points.length > 64 ||
      input.points.some(p => !Array.isArray(p) || p.length !== 2 ||
        p.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1))) return false
    const round = this.canDraw(room, player, input.round, input.turn)
    if (!round) return false
    const points = input.points
    let stroke = round.byId.get(input.id)
    if (stroke) {
      if (stroke.owner !== player.slot || stroke.turn !== input.turn) return false
      if (input.offset < stroke.points.length) return true
      if (input.offset !== stroke.points.length || round.strokes.findLast(s => s.owner === player.slot) !== stroke ||
        stroke.points.length + points.length > 9000) return false
    } else {
      if (input.offset !== 0 || round.used.has(input.id) || round.used.size >= 1200) return false
      stroke = { id: input.id, owner: player.slot, turn: input.turn, erase: input.erase, size: input.size, color: input.color, points: [] }
      if (round.points + points.length > 35_000) return false
      round.byId.set(stroke.id, stroke)
      round.used.add(stroke.id)
      round.strokes.push(stroke)
    }
    if (round.points + points.length > 35_000) return false
    stroke.points.push(...points)
    round.points += points.length
    const { points: _fullPoints, ...meta } = stroke
    const patch: Patch = { round: round.id, stroke: meta, offset: input.offset, points }
    for (const p of this.drawingPeers(room, player)) if (p.sid) this.io.to(p.sid).emit('patch', patch)
    return true
  }

  private disconnect(socket: Peer, left = false) {
    const room = this.rooms.get(socket.data.code || '')
    const player = room?.players.find(p => p.sid === socket.id)
    delete socket.data.code
    delete socket.data.slot
    if (!room || !player) return
    player.sid = null
    player.ready = false
    player.gone = Date.now()
    player.left = left
    this.prune(room)
    if (this.rooms.has(room.code)) this.publish(room)
  }

  private connect(socket: Peer) {
    // Railway terminates TLS and appends the connecting IP to the forwarded chain.
    const forwarded = socket.handshake.headers['x-forwarded-for']
    const ip = process.env.RAILWAY_ENVIRONMENT && typeof forwarded === 'string'
      ? forwarded.split(',').at(-1)!.trim() : socket.handshake.address
    const ack = (fn: unknown, ok: boolean, error = INVALID) => {
      if (typeof fn === 'function') fn(ok ? { ok: true } : { ok: false, error })
    }
    const withPlayer = (fn: unknown, operation: (room: Room, player: Player) => boolean, fast = false) => {
      const room = this.rooms.get(socket.data.code || '')
      const player = room?.players.find(p => p.sid === socket.id)
      if (!player || !room) return ack(fn, false)
      if (!this.limits.take(player.digest + (fast ? ':draw' : ':action'), fast ? 90 : 35, fast ? 1000 : 10_000)) return ack(fn, false, LIMIT)
      this.advance(room)
      ack(fn, operation(room, player))
    }
    socket.on('enter', (input, reply) => {
      if (typeof reply !== 'function') return
      const outcome = this.limits.take(ip + ':enter', 24, 60_000) ? this.enter(socket, input) : { ok: false as const, error: LIMIT }
      reply(outcome)
      if (outcome.ok) this.publish(this.rooms.get(outcome.value.code)!)
    })
    socket.on('ready', (ready, reply) => withPlayer(reply, (room, player) => {
      if (room.phase !== 'lobby' || typeof ready !== 'boolean') return false
      player.ready = ready
      this.publish(room)
      return true
    }))
    socket.on('mode', (mode, reply) => withPlayer(reply, (room, player) => {
      if (room.phase !== 'lobby' || room.players[0] !== player || typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) return false
      room.mode = mode
      this.publish(room)
      return true
    }))
    socket.on('start', reply => withPlayer(reply, (room, player) => {
      if (room.phase !== 'lobby' || room.players[0] !== player || room.players.length !== 2 ||
        !room.players.every(p => p.sid && p.ready)) return false
      this.start(room)
      return true
    }))
    socket.on('draw', (input, reply) => withPlayer(reply, (room, player) => this.draw(room, player, input), true))
    socket.on('undo', (input, reply) => withPlayer(reply, (room, player) => {
      if (!input || typeof input.id !== 'string') return false
      const round = this.canDraw(room, player, input.round, input.turn)
      if (!round) return false
      const stroke = round.byId.get(input.id)
      if (!stroke) return round.used.has(input.id)
      if (stroke.owner !== player.slot || stroke !== round.strokes.findLast(s => s.owner === player.slot)) return false
      round.strokes.splice(round.strokes.indexOf(stroke), 1)
      round.byId.delete(stroke.id)
      for (const p of this.drawingPeers(room, player)) if (p.sid) this.io.to(p.sid).emit('undo', { round: round.id, id: stroke.id })
      return true
    }))
    socket.on('replay', reply => withPlayer(reply, room => {
      if (room.phase !== 'results') return false
      this.results.delete(room.round!.id)
      room.round = null
      room.phase = 'lobby'
      for (const p of room.players) p.ready = false
      this.prune(room)
      this.publish(room)
      return true
    }))
    socket.on('leave', reply => withPlayer(reply, () => { this.disconnect(socket, true); return true }))
    socket.on('sync', () => withPlayer(undefined, (room, player) => {
      socket.emit('room', this.snapshot(room, player.slot))
      return true
    }))
    socket.on('clock', reply => { if (typeof reply === 'function' && this.limits.take(socket.id + ':clock', 10, 10_000)) reply(Date.now()) })
    socket.on('disconnect', () => this.disconnect(socket))
  }
}
