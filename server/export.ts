import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { MODES, PAPER } from '../shared/protocol.ts'
import type { Stroke } from '../shared/protocol.ts'
import { BoardRenderer } from '../shared/render.ts'
import type { Round } from './game.ts'

export const ASSETS = new URL('../public/referans/', import.meta.url)
const factory = (w: number, h: number) => createCanvas(w, h) as unknown as HTMLCanvasElement
const WIDTH = 1440
const HEIGHT = 1080

function board(strokes: Stroke[]) {
  const canvas = createCanvas(WIDTH, HEIGHT)
  const renderer = new BoardRenderer(canvas as unknown as HTMLCanvasElement, factory)
  for (const stroke of strokes) renderer.add(stroke)
  renderer.paint()
  return canvas
}

function wrap(ctx: SKRSContext2D, line: string, width: number) {
  const rows: string[] = []
  let text = ''
  for (const word of line.split(' ')) {
    if (text && ctx.measureText(text + ' ' + word).width > width) {
      rows.push(text)
      text = word
    } else {
      text += (text ? ' ' : '') + word
    }
  }
  rows.push(text)
  return rows
}

async function exhibit(round: Round, drawings: Canvas[]) {
  const w = 1600
  const image = 'reference' in round.prompt ? await loadImage(fileURLToPath(new URL(round.prompt.reference, ASSETS))) : null
  const title = 'sentence' in round.prompt ? round.prompt.sentence : 'Referans fotoğrafı'
  const canvas = createCanvas(w, image ? 1320 : 1060)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#F1E5D2'
  ctx.fillRect(0, 0, w, canvas.height)
  ctx.fillStyle = '#463B32'
  ctx.font = 'bold 52px sans-serif'
  ctx.fillText('Hadi Çizelim', 56, 78)
  ctx.fillStyle = '#766A5D'
  ctx.font = '26px sans-serif'
  ctx.fillText(MODES[round.mode].name, 59, 117)
  ctx.fillStyle = '#463B32'
  ctx.font = 'bold 35px sans-serif'
  wrap(ctx, title, 1450).forEach((row, i) => ctx.fillText(row, 56, 174 + i * 41))
  if (image) {
    const scale = Math.min(540 / image.width, 280 / image.height)
    ctx.drawImage(image, 56, 203, image.width * scale, image.height * scale)
  }
  const startY = image ? 520 : 250
  const drawingWidth = drawings.length === 1 ? 930 : 722
  const drawingHeight = drawingWidth * 3 / 4
  drawings.forEach((drawing, index) => {
    const x = drawings.length === 1 ? (w - drawingWidth) / 2 : 56 + index * (drawingWidth + 44)
    ctx.fillStyle = PAPER
    ctx.fillRect(x - 8, startY - 8, drawingWidth + 16, drawingHeight + 61)
    ctx.drawImage(drawing, x, startY, drawingWidth, drawingHeight)
    ctx.fillStyle = '#463B32'
    ctx.font = 'bold 27px sans-serif'
    const label = drawings.length === 1 ? round.names.join(' ve ') : round.names[index]
    ctx.fillText(label, x + 12, startY + drawingHeight + 37, drawingWidth - 24)
  })
  ctx.font = 'italic 28px sans-serif'
  ctx.fillStyle = '#766A5D'
  ctx.fillText(round.quote, 56, canvas.height - 38)
  return canvas
}

export type ResultFile = 'birinci' | 'ikinci' | 'ortak' | 'sergi' | 'onizleme'
export const resultFiles = (mode: Round['mode']): ResultFile[] =>
  mode === 'relay' ? ['ortak', 'sergi', 'onizleme'] : ['birinci', 'ikinci', 'sergi', 'onizleme']
export type Exports = Partial<Record<ResultFile, Buffer>>

export async function renderExports(round: Round): Promise<Exports> {
  const drawings = round.mode === 'relay'
    ? [board(round.strokes)]
    : [board(round.strokes.filter(s => s.owner === 0)), board(round.strokes.filter(s => s.owner === 1))]
  const composition = await exhibit(round, drawings)
  const thumb = createCanvas(420, Math.round(420 * composition.height / composition.width))
  thumb.getContext('2d').drawImage(composition, 0, 0, thumb.width, thumb.height)
  const [first, second, sergi, onizleme] = await Promise.all([
    drawings[0].encode('png'), drawings[1]?.encode('png'), composition.encode('png'), thumb.encode('png'),
  ])
  return round.mode === 'relay' ? { ortak: first, sergi, onizleme } : { birinci: first, ikinci: second, sergi, onizleme }
}

export function makeZip(files: Exports, id: string) {
  return zipSync(Object.fromEntries(Object.entries(files).filter(([name]) => name !== 'onizleme')
    .map(([name, png]) => [filename(id, name), png])), { level: 0 })
}

export const filename = (id: string, file: string) => 'hadi-cizelim-' + id.slice(0, 8) +
  (file === 'zip' ? '.zip' : '-' + file + '.png')
