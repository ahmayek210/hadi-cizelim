import refs from './references.json' with { type: 'json' }

export const FIXED = 'HADICIZELIM'
export const RATIO = 4 / 3
export const PALETTE = [
  ['Grafit siyahı', '#37312C'], ['Yumuşak kırmızı', '#B86F66'],
  ['Hardal sarısı', '#D8AA5C'], ['Adaçayı yeşili', '#77946E'],
  ['Gökyüzü mavisi', '#6E9FB7'], ['Soluk mor', '#93769A'],
] as const
export const WIDTHS = [0.004, 0.009, 0.02] as const
export const PAPER = '#FFFCF6'
export const REFERENCES = refs
export const MODES = {
  reference: { name: 'Referanstan Çiz', duration: '60 saniye', description: 'Aynı kare, iki ayrı yorum.' },
  sentence: { name: 'Cümleden Çiz', duration: '60 saniye', description: 'Bir cümleye iki farklı hayal gücü.' },
  relay: { name: 'Sıralı Çizim', duration: '8 × 15 saniye', description: 'Tek kâğıt, sıra sıra iki kalem.' },
} as const
export type Mode = keyof typeof MODES
export type Slot = 0 | 1
export type Point = [x: number, y: number]
export type Stroke = { id: string; owner: Slot; turn: number; color: number; size: number; erase: boolean; points: Point[] }
export type DrawInput = {
  round: string; id: string; turn: number; offset: number; color: number; size: number; erase: boolean; points: Point[]
}
export type Patch = { round: string; stroke: Omit<Stroke, 'points'>; offset: number; points: Point[] }
export type Prompt = { sentence: string } | { reference: string }
export type PlayerView = { name: string; slot: Slot; ready: boolean; connected: boolean }
export type RoundInfo = {
  id: string; mode: Mode; prompt: Prompt; names: [string, string]; date: string; quote: string;
}
export type RoundView = RoundInfo & { turn: number; active: Slot | null; endsAt: number; strokes: Stroke[] }
export type RoomView = {
  code: string; me: Slot; host: Slot; players: PlayerView[]; mode: Mode; serverNow: number;
  phase: 'lobby' | 'drawing' | 'results'; round: RoundView | null;
}
export type Session = { code: string; token: string; name: string }
export type Reply<T = undefined> = { ok: true; value: T } | { ok: false; error: string }
export type Join = { action: 'create' | 'join' | 'resume'; code: string; name: string; token?: string }
export type GalleryEntry = RoundInfo
export type GalleryPage = { entries: GalleryEntry[]; next: string | null }
export type SocketInput = {
  enter: (input: Join, ack: (reply: Reply<Session>) => void) => void;
  ready: (value: boolean, ack: (reply: Reply) => void) => void;
  mode: (mode: Mode, ack: (reply: Reply) => void) => void;
  start: (ack: (reply: Reply) => void) => void;
  replay: (ack: (reply: Reply) => void) => void;
  leave: (ack: (reply: Reply) => void) => void;
  draw: (input: DrawInput, ack: (reply: Reply) => void) => void;
  undo: (input: { round: string; turn: number; id: string }, ack: (reply: Reply) => void) => void;
  sync: () => void;
  clock: (ack: (time: number) => void) => void;
}
export type SocketOutput = {
  room: (room: RoomView) => void;
  patch: (patch: Patch) => void;
  undo: (undo: { round: string; id: string }) => void;
  replaced: () => void;
}
export const normalizeCode = (code: string) => code.trim().toUpperCase()
