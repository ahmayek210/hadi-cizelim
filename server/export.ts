import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
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
  const width = 2400
  const margin = 60
  const gap = 48
  const inset = 16
  const nameHeight = 88
  const relay = drawings.length === 1
  const frameWidth = relay ? 1776 : (width - 2 * margin - gap) / 2
  const drawingWidth = frameWidth - 2 * inset
  const drawingHeight = drawingWidth * 3 / 4
  const frameHeight = inset + drawingHeight + nameHeight

  const image = 'reference' in round.prompt ? await loadImage(fileURLToPath(new URL(round.prompt.reference, ASSETS))) : null
  const imageScale = image ? Math.min(1488 / image.width, 960 / image.height) : 0
  const imageWidth = image ? image.width * imageScale : 0
  const imageHeight = image ? Math.ceil(image.height * imageScale) : 0
  const sentence = 'sentence' in round.prompt ? round.prompt.sentence : ''
  const sentenceFont = 'bold 70px serif'
  const lineHeight = 83
  const measure = createCanvas(1, 1).getContext('2d')
  measure.font = sentenceFont
  const lines = sentence ? wrap(measure, sentence, 2070) : []
  const frameTop = margin + (image ? imageHeight : lines.length * lineHeight) + gap
  const canvas = createCanvas(width, frameTop + frameHeight + margin)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#F7F1E5'
  ctx.fillRect(0, 0, width, canvas.height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (image) {
    ctx.drawImage(image, (width - imageWidth) / 2, margin, imageWidth, image.height * imageScale)
  } else {
    ctx.fillStyle = '#463B32'
    ctx.font = sentenceFont
    lines.forEach((line, index) => ctx.fillText(line, width / 2, margin + (index + .5) * lineHeight))
  }

  drawings.forEach((drawing, index) => {
    const x = relay ? (width - frameWidth) / 2 : margin + index * (frameWidth + gap)
    ctx.beginPath()
    ctx.roundRect(x, frameTop, frameWidth, frameHeight, 20)
    ctx.fillStyle = '#E9D5B8'
    ctx.fill()
    ctx.strokeStyle = '#CBB592'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.drawImage(drawing, x + inset, frameTop + inset, drawingWidth, drawingHeight)
    ctx.fillStyle = '#463B32'
    ctx.font = 'bold 52px sans-serif'
    const label = relay ? round.names.join(' ve ') : round.names[index]
    ctx.fillText(label, x + frameWidth / 2, frameTop + inset + drawingHeight + nameHeight / 2, drawingWidth - 16)
  })
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
