import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { DrawInput, Join, Patch, Reply, RoomView, Session, SocketInput, SocketOutput } from '../shared/protocol.ts'

export const API = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080').replace(/\/$/, '')
const ACTIVE = 'hc-aktif'
const HISTORY = 'hc-galeriler'
const NAME = 'hc-isim'
export const socket: Socket<SocketOutput, SocketInput> = io(API, { autoConnect: false, transports: ['websocket', 'polling'] })

function read<T>(source: Storage, key: string, fallback: T): T {
  try { return JSON.parse(source.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
export function history() { return read<Session[]>(localStorage, HISTORY, []) }
export function lastName() { return read<string>(localStorage, NAME, '') }
let current = read<Session | null>(sessionStorage, ACTIVE, null)
let skew = 0
export const gameNow = () => Date.now() + skew

function remember(session: Session) {
  current = session
  sessionStorage.setItem(ACTIVE, JSON.stringify(session))
  localStorage.setItem(NAME, JSON.stringify(session.name))
  localStorage.setItem(HISTORY, JSON.stringify([session, ...history().filter(s => s.token !== session.token)]))
}
function forget() {
  current = null
  sessionStorage.removeItem(ACTIVE)
}

export function patchRoom(view: RoomView | null, patch: Patch) {
  if (!view?.round || view.round.id !== patch.round || view.phase !== 'drawing' || view.round.turn !== patch.stroke.turn) return view
  const strokes = view.round.strokes
  const previous = strokes.find(s => s.id === patch.stroke.id)
  if (patch.offset !== (previous?.points.length ?? 0)) return view
  const stroke = { ...patch.stroke, points: [...(previous?.points || []), ...patch.points] }
  return { ...view, round: { ...view.round, strokes: previous ? strokes.map(s => s.id === stroke.id ? stroke : s) : [...strokes, stroke] } }
}

export function useRoom() {
  const [view, setView] = useState<RoomView | null>(null)
  const [session, setSession] = useState(current)
  const [online, setOnline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [booting, setBooting] = useState(!!current)

  useEffect(() => {
    const clock = () => {
      const sent = Date.now()
      socket.emit('clock', serverTime => { skew = serverTime - (Date.now() + sent) / 2 })
    }
    const connect = () => {
      setOnline(true)
      clock()
      if (!current) return
      socket.timeout(7000).emit('enter', { ...current, action: 'resume' }, (err, reply) => {
        setBooting(false)
        if (err) { setError('Odaya bağlanılıyor…'); socket.disconnect().connect(); return }
        if (!reply.ok) {
          forget()
          setSession(null)
          setView(null)
          setError(reply.error)
        }
      })
    }
    const disconnect = () => setOnline(false)
    const failed = () => {
      setOnline(false)
      setBooting(false)
    }
    const room = (state: RoomView) => { setView(state); setError('') }
    const patch = (value: Patch) => setView(state => patchRoom(state, value))
    const undo = ({ round, id }: { round: string; id: string }) => setView(state =>
      state?.round?.id === round ? { ...state, round: { ...state.round, strokes: state.round.strokes.filter(s => s.id !== id) } } : state)
    const replaced = () => {
      forget()
      setSession(null)
      setView(null)
      setError('Bu oturum başka bir sekmede açıldı.')
    }
    socket.on('connect', connect).on('disconnect', disconnect).on('connect_error', failed)
      .on('room', room).on('patch', patch).on('undo', undo).on('replaced', replaced)
    socket.connect()
    const interval = window.setInterval(() => { if (socket.connected) clock() }, 10_000)
    return () => {
      window.clearInterval(interval)
      socket.off('connect', connect).off('disconnect', disconnect).off('connect_error', failed)
        .off('room', room).off('patch', patch).off('undo', undo).off('replaced', replaced)
      socket.disconnect()
    }
  }, [])

  function enter(input: Join) {
    if (busy) return
    setError('')
    setBusy(true)
    // Connect first when the transport is retrying. Never queue an anonymous join across a reconnect.
    if (!socket.connected) {
      socket.connect()
      setError('Sunucuya bağlanılıyor. Biraz sonra tekrar dene.')
      setBusy(false)
      return
    }
    socket.timeout(7000).emit('enter', input, (err, reply) => {
      setBusy(false)
      if (err) { setError('Sunucu yanıt vermedi. Tekrar dene.'); socket.disconnect().connect(); return }
      if (!reply.ok) { setError(reply.error); return }
      remember(reply.value)
      setSession(reply.value)
    })
  }
  function report(reply: Reply) {
    if (!reply.ok) setError(reply.error)
  }
  function draw(input: DrawInput, me: RoomView['me']) {
    if (!socket.connected) return
    const { points, offset, round, ...meta } = input
    setView(value => patchRoom(value, { round, offset, points, stroke: { ...meta, owner: me } }))
    socket.timeout(5000).emit('draw', input, (err, reply) => {
      if (err || !reply.ok) socket.volatile.emit('sync')
    })
  }
  function leave() {
    if (socket.connected) socket.emit('leave', () => {})
    forget()
    setSession(null)
    setView(null)
    setError('')
  }
  return { view, online, busy, booting, error, session, enter, report, draw, leave }
}

export async function api(path: string, token: string, method = 'GET', signal?: AbortSignal) {
  const response = await fetch(API + '/api/' + path, {
    method, signal, cache: 'no-store', headers: { Authorization: 'Bearer ' + token },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || 'Sunucuya ulaşılamadı.')
  }
  return response
}

