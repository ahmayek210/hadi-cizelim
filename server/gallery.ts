import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import pg from 'pg'
import type { GalleryEntry } from '../shared/protocol.ts'
import type { Round } from './game.ts'
import type { Exports, ResultFile } from './export.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS drawing_gallery (
    id uuid PRIMARY KEY,
    member_a text NOT NULL,
    member_b text NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL
  );
  CREATE INDEX IF NOT EXISTS drawing_gallery_member_a_idx ON drawing_gallery (member_a, saved_at DESC);
  CREATE INDEX IF NOT EXISTS drawing_gallery_member_b_idx ON drawing_gallery (member_b, saved_at DESC);
`

type Query = <T extends Record<string, unknown>>(sql: string, params?: string[]) => Promise<{ rows: T[] }>
type Objects = { get: (key: string) => Promise<Uint8Array>; put: (key: string, png: Buffer) => Promise<unknown>; check: () => Promise<unknown> }

export async function openGallery() {
  const local = process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL
  let query: Query
  let objects: Objects

  if (local) {
    const root = process.env.LOCAL_DATA_DIR || '.local'
    const folder = join(root, 'images')
    await mkdir(folder, { recursive: true })
    const { PGlite } = await import('@electric-sql/pglite')
    const db = await PGlite.create(join(root, 'postgres'))
    await db.exec(SCHEMA)
    query = (sql, params) => db.query(sql, params)
    objects = {
      put: (key, png) => writeFile(join(folder, key), png),
      get: key => readFile(join(folder, key)),
      check: async () => {},
    }
  } else {
    const { DATABASE_URL, AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET } = process.env
    if (!DATABASE_URL || !AWS_ENDPOINT_URL_S3 || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !S3_BUCKET) {
      throw new Error('Veritabanı ve nesne depolama ortam değişkenleri gerekli.')
    }
    const db = new pg.Pool({ connectionString: DATABASE_URL, max: 5, connectionTimeoutMillis: 10_000 })
    db.on('error', () => console.error('Galeri veritabanı bağlantısı kesildi.'))
    const s3 = new S3Client({
      endpoint: AWS_ENDPOINT_URL_S3, region: AWS_REGION, forcePathStyle: true,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
    })
    await db.query(SCHEMA)
    query = (sql, params) => db.query(sql, params)
    objects = {
      put: (Key, Body) => s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key, Body, ContentType: 'image/png' })),
      get: async Key => {
        const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key }))
        return result.Body!.transformToByteArray()
      },
      check: () => s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET })),
    }
  }

  await objects.check()
  const key = (id: string, file: string) => id + '-' + file + '.png'
  return {
    async check() {
      await Promise.all([query('SELECT 1'), objects.check()])
      return local ? 'local' : 'neon'
    },
    async list(hash: string) {
      const data = await query<{ metadata: GalleryEntry }>(
        'SELECT metadata FROM drawing_gallery WHERE member_a = $1 OR member_b = $1 ORDER BY saved_at DESC LIMIT 100', [hash])
      return data.rows.map(row => row.metadata)
    },
    async entry(hash: string, id: string) {
      const data = await query<{ metadata: GalleryEntry }>(
        'SELECT metadata FROM drawing_gallery WHERE id = $2 AND (member_a = $1 OR member_b = $1)', [hash, id])
      return data.rows[0]?.metadata
    },
    async save(round: Round, files: Exports) {
      await Promise.all(Object.entries(files).map(([file, png]) => objects.put(key(round.id, file), png)))
      const { id, mode, names, date, quote, prompt, members } = round
      await query(
        'INSERT INTO drawing_gallery (id, member_a, member_b, metadata) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [id, ...members, JSON.stringify({ id, mode, names, date, quote, prompt })],
      )
    },
    get: async (id: string, file: ResultFile) => Buffer.from(await objects.get(key(id, file))),
  }
}
