import { readdir, readFile, writeFile } from 'node:fs/promises'
import { loadImage } from '@napi-rs/canvas'

const dir = new URL('../public/referans/', import.meta.url)
const files = (await readdir(dir)).filter(file => /^[0-9]+\.jpg$/i.test(file))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
if (files.length !== 19) throw new Error('Referans havuzunda 19 JPG olmalı.')
const entries = await Promise.all(files.map(async file => {
  const bytes = await readFile(new URL(file, dir))
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error(file + ': JPG imzası geçersiz')
  const image = await loadImage(bytes)
  if (!image.width || !image.height) throw new Error(file + ': JPG boyutu geçersiz')
  return { file, width: image.width, height: image.height }
}))
await writeFile(new URL('./references.json', import.meta.url), JSON.stringify(entries, null, 2) + '\n')
console.log(entries.map(r => r.file + ' ' + r.width + '×' + r.height).join('\n'))
