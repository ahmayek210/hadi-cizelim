import { useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import type { DrawInput, Point, Stroke } from '../shared/protocol.ts'
import { RATIO } from '../shared/protocol.ts'
import { BoardRenderer } from '../shared/render.ts'
import { gameNow } from './room.ts'

type Brush = Pick<DrawInput, 'color' | 'size' | 'erase'>
type Input = {
  brush: Brush; round: string; turn: number; endsAt: number; enabled: boolean; send: (value: DrawInput) => void;
}
type Pen = { pointer: number; pending: Point[]; offset: number; data: Omit<DrawInput, 'points' | 'offset'>; endsAt: number }
const factory = (width: number, height: number) => Object.assign(document.createElement('canvas'), { width, height })

export function Board({ strokes, input, label }: { strokes: Stroke[]; input?: Input; label: string }) {
  const node = useRef<HTMLCanvasElement>(null)
  const model = useRef(strokes)
  const drawn = useRef<Stroke[]>([])
  const renderer = useRef<BoardRenderer | null>(null)
  const active = useRef<Pen | null>(null)
  const timeout = useRef(0)
  const settings = useRef(input)
  settings.current = input

  function repaint() {
    if (!renderer.current) return
    const board = renderer.current
    const before = drawn.current
    const now = model.current
    const rebuild = before.length > now.length || before.some((old, i) => {
      const next = now[i]
      return !next || next.id !== old.id || next.points.length < old.points.length ||
        (i < before.length - 1 && next.points.length !== old.points.length)
    })
    if (rebuild) board.reset()
    for (let i = rebuild ? 0 : Math.max(0, before.length - 1); i < now.length; i++) {
      const offset = rebuild ? 0 : before[i]?.points.length || 0
      if (now[i].points.length > offset) board.add(now[i], offset)
    }
    board.paint()
    drawn.current = now
  }

  useLayoutEffect(() => {
    const canvas = node.current!
    const resize = () => {
      const width = Math.min(1200, Math.max(2, Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 2))))
      if (renderer.current && canvas.width === width) return
      canvas.width = width
      canvas.height = Math.round(width / RATIO)
      renderer.current = new BoardRenderer(canvas, factory)
      drawn.current = []
      repaint()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    model.current = strokes
    const frame = requestAnimationFrame(repaint)
    return () => cancelAnimationFrame(frame)
  }, [strokes])

  function flush() {
    window.clearTimeout(timeout.current)
    timeout.current = 0
    const pen = active.current
    const config = settings.current
    if (!pen || !config?.enabled || pen.data.round !== config.round || pen.data.turn !== config.turn || gameNow() >= pen.endsAt) return
    while (pen.pending.length) {
      const points = pen.pending.splice(0, 64)
      config.send({ ...pen.data, offset: pen.offset, points })
      pen.offset += points.length
    }
  }

  useEffect(() => {
    if (active.current && (!input?.enabled || active.current.data.turn !== input.turn)) {
      active.current = null
      window.clearTimeout(timeout.current)
      timeout.current = 0
    }
    return () => { window.clearTimeout(timeout.current); timeout.current = 0 }
  }, [input?.enabled, input?.round, input?.turn])

  function append(event: PointerEvent<HTMLCanvasElement>) {
    const pen = active.current
    if (!pen || event.pointerId !== pen.pointer) return
    const rect = event.currentTarget.getBoundingClientRect()
    const normalized = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000
    const samples = event.nativeEvent.getCoalescedEvents?.()
    for (const sample of samples?.length ? samples : [event.nativeEvent]) {
      const point: Point = [normalized((sample.clientX - rect.left) / rect.width), normalized((sample.clientY - rect.top) / rect.height)]
      const prev = pen.pending.at(-1)
      if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) pen.pending.push(point)
    }
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (!input?.enabled || gameNow() >= input.endsAt || event.button !== 0 || active.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    active.current = { pointer: event.pointerId, offset: 0, pending: [], endsAt: input.endsAt,
      data: { ...input.brush, id: crypto.randomUUID(), round: input.round, turn: input.turn } }
    append(event)
    flush()
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (active.current?.pointer !== event.pointerId) return
    append(event)
    if (!timeout.current) timeout.current = window.setTimeout(flush, 22)
  }
  function stop(event: PointerEvent<HTMLCanvasElement>) {
    if (active.current?.pointer !== event.pointerId) return
    if (event.type === 'pointerup') append(event)
    flush()
    active.current = null
  }

  return <canvas ref={node} className={'board ' + (input?.enabled ? 'drawable' : '')} aria-label={label}
    onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />
}
