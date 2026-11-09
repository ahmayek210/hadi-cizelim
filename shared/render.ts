import { PALETTE, PAPER, WIDTHS } from './protocol.ts'
import type { Point, Slot, Stroke } from './protocol.ts'

// Browser and Node Canvas use the same normalized drawing and compositing rules.
export class BoardRenderer {
  private layers = new Map<number, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; owner: Slot }>()
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement
  private makeCanvas: (width: number, height: number) => HTMLCanvasElement

  constructor(
    canvas: HTMLCanvasElement,
    makeCanvas: (width: number, height: number) => HTMLCanvasElement,
  ) {
    this.canvas = canvas
    this.makeCanvas = makeCanvas
    this.ctx = canvas.getContext('2d')!
  }

  reset() {
    this.layers.clear()
  }

  add(stroke: Stroke, offset = 0) {
    const width = this.canvas.width
    const height = this.canvas.height
    const key = stroke.turn * 2 + stroke.owner
    if (!this.layers.has(key)) {
      const canvas = this.makeCanvas(width, height)
      this.layers.set(key, { canvas, ctx: canvas.getContext('2d')!, owner: stroke.owner })
    }
    const layers = stroke.erase
      ? [...this.layers.values()].filter(layer => layer.owner === stroke.owner)
      : [this.layers.get(key)!]
    const line = WIDTHS[stroke.size] * width * (stroke.erase ? 2.5 : 1)
    const paint = PALETTE[stroke.color][1]
    for (const { ctx } of layers) {
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = line
      ctx.strokeStyle = paint
      ctx.fillStyle = paint
      const points = stroke.points
      if (!offset && points[0]) {
        ctx.beginPath()
        ctx.arc(points[0][0] * width, points[0][1] * height, line / 2, 0, 2 * Math.PI)
        ctx.fill()
      }
      if (points.length <= Math.max(1, offset)) continue
      const first = points[Math.max(0, offset - 1)]
      ctx.beginPath()
      ctx.moveTo(first[0] * width, first[1] * height)
      for (let i = Math.max(1, offset); i < points.length; i++) {
        const point: Point = points[i]
        ctx.lineTo(point[0] * width, point[1] * height)
      }
      ctx.stroke()
    }
  }

  paint() {
    const { width, height } = this.canvas
    this.ctx.fillStyle = PAPER
    this.ctx.fillRect(0, 0, width, height)
    for (const key of [...this.layers.keys()].sort((a, b) => a - b)) {
      this.ctx.drawImage(this.layers.get(key)!.canvas, 0, 0)
    }
  }
}
