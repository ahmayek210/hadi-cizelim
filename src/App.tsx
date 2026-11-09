import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, Clock3, Copy, Eraser, Image as ImageIcon, Layers2, Link2, Pencil, Plus, RefreshCw, Undo2, UsersRound, WifiOff } from 'lucide-react'
import { FIXED, MODES, PALETTE, REFERENCES, normalizeCode } from '../shared/protocol.ts'
import type { Mode, Prompt, RoomView, RoundView, Session } from '../shared/protocol.ts'
import { CoverArt } from './Art.tsx'
import { Board } from './Board.tsx'
import { Gallery, downloadDrawing } from './Gallery.tsx'
import { api, gameNow, history, lastName, socket, useRoom } from './room.ts'

type Game = ReturnType<typeof useRoom>
const MODE_ICONS = { reference: ImageIcon, sentence: Pencil, relay: Layers2 }
const WIDTH_LABELS = ['İnce', 'Orta', 'Kalın']
const modeList = Object.entries(MODES) as [Mode, typeof MODES[Mode]][]
const labels = ['Birinci oyuncu', 'İkinci oyuncu']
const asset = (file: string) => import.meta.env.BASE_URL + 'referans/' + file

function Header({ album, leave, home }: { album?: () => void; leave?: () => void; home: boolean }) {
  if (home && !album) return null
  return <header className="masthead"><div className="mast-inner">
    <div className="brand"><span className="brand-icon"><Pencil size={20} strokeWidth={2.3} /></span>
      <span className={home ? 'sr-only' : undefined}>Hadi Çizelim</span></div>
    <nav aria-label="Oyun menüsü">
      {album && <button className="nav-button" onClick={album}><BookOpen size={18} /> <span>Galerim</span></button>}
      {leave && <button className="nav-button leave" onClick={leave}><ArrowLeft size={18} /> <span>Odadan ayrıl</span></button>}
    </nav>
  </div></header>
}

function Home({ game }: { game: Game }) {
  const invite = new URLSearchParams(location.search).get('oda') || ''
  const [action, setAction] = useState<'create' | 'join'>(invite ? 'join' : 'create')
  const [name, setName] = useState(lastName)
  const [code, setCode] = useState(invite.slice(0, 12))
  const recent = history()[0]
  const submit = (event: FormEvent) => {
    event.preventDefault()
    game.enter({ action, name, code })
  }
  return <main className="home">
    <section className="hero">
      <div className="hero-copy">
        <h1>Hadi <em>Çizelim!</em></h1>
        <div className="join-card">
          <div className="join-tabs" aria-label="Oda seçimi">
            <button type="button" aria-pressed={action === 'create'} onClick={() => setAction('create')}><Plus size={18} /> Oda Oluştur</button>
            <button type="button" aria-pressed={action === 'join'} onClick={() => setAction('join')}><UsersRound size={18} /> Odaya Katıl</button>
          </div>
          <form onSubmit={submit}>
            <label htmlFor="name">Oyuncu adın</label>
            <input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Adını yaz" maxLength={24} autoComplete="nickname" required />
            {action === 'join' && <>
              <label htmlFor="code">Oda kodu</label>
              <div className="code-input"><input id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="Örn. AB4K7M" maxLength={12} autoCapitalize="characters" autoComplete="off" spellCheck={false} required />
                <button type="button" className="text-button fixed-code" onClick={() => setCode(FIXED)}>Sabit oda</button></div>
            </>}
            <button className="button primary enter" disabled={game.busy || !game.online} type="submit">{game.busy ? 'Bağlanıyor…' : action === 'create' ? 'Oda oluştur' : 'Odaya katıl'} <ArrowRight size={19} /></button>
          </form>
          {!game.online && <p className="feedback" role="status">Sunucuya bağlanılıyor…</p>}
          {game.error && <p className="notice error" role="alert">{game.error}</p>}
          {recent && <button className="text-button rejoin" onClick={() => game.enter({ ...recent, action: 'resume' })} disabled={game.busy || !game.online}><RefreshCw size={15} /> Son odaya dön</button>}
        </div>
      </div>
      <CoverArt />
    </section>
  </main>
}

function Lobby({ room, online, report }: { room: RoomView; online: boolean; report: Game['report'] }) {
  const [notice, setNotice] = useState('')
  const own = room.players.find(p => p.slot === room.me)!
  const host = room.me === room.host
  const ready = room.players.length === 2 && room.players.every(p => p.ready && p.connected)
  async function share(codeOnly: boolean) {
    const url = new URL(location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('oda', room.code)
    try {
      if (!codeOnly && navigator.share) {
        await navigator.share({ title: 'Hadi Çizelim', text: 'Çizim masama katıl!', url: url.toString() })
      } else {
        await navigator.clipboard.writeText(codeOnly ? room.code : url.toString())
        setNotice(codeOnly ? 'Oda kodu kopyalandı.' : 'Davet bağlantısı kopyalandı.')
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice(codeOnly ? 'Oda kodunu seçip kopyalayabilirsin.' : url.toString())
    }
  }
  return <section className="stage lobby">
    <h1 className="sr-only">Oyun lobisi</h1>
    <div className="lobby-grid">
      <aside className="invite-panel paper-panel">
        <div className="invite-top">
          <div><span className="mini-label">Oda kodu</span>
            <strong className="invite-code" data-testid="room-code">{room.code}</strong></div>
          <div className="invite-actions">
            <button className="button secondary icon-button" aria-label="Kodu kopyala" title="Kodu kopyala" onClick={() => share(true)}><Copy size={18} /></button>
            <button className="button secondary icon-button" aria-label="Davet bağlantısı" title="Davet bağlantısı" onClick={() => share(false)}><Link2 size={19} /></button>
          </div>
        </div>
        {notice && <p className="feedback" role="status">{notice}</p>}
        <div className="seat-list">
          {([0, 1] as const).map(slot => {
            const p = room.players.find(player => player.slot === slot)
            return <div className={'seat ' + (p ? '' : 'vacant')} key={slot}>
              <span className="seat-icon">{p ? [...p.name][0].toLocaleUpperCase('tr') : <Plus size={18}/>}</span>
              <span><strong>{p?.name || 'Boş koltuk'}</strong>{p?.slot === room.me && <span className="you"> · Sen</span>}
                <small>{p ? !p.connected ? 'Bağlantı kesildi' : p.ready ? 'Hazır' : 'Bağlı' : 'Oyuncu bekleniyor'}</small></span>
              {p?.ready && p.connected && <Check size={19} className="seat-check" />}
            </div>
          })}
        </div>
      </aside>
      <div className="paper-panel mode-panel">
        <h2 id="mode-heading">Oyun modu</h2>
        {!host && <p className="sr-only" id="mode-owner">Oyun modunu oda sahibi seçer.</p>}
        <div className="mode-list" role="group" aria-labelledby="mode-heading" aria-describedby={host ? undefined : 'mode-owner'}>{modeList.map(([mode, details]) => {
          const Icon = MODE_ICONS[mode]
          return <button key={mode} className={'mode-choice ' + mode} disabled={!host || !online} aria-pressed={room.mode === mode}
            onClick={() => socket.emit('mode', mode, report)}><span className="mode-icon"><Icon size={22} /></span>
            <strong>{details.name}</strong><small>{details.duration}</small></button>
        })}</div>
        <div className="action-row">
          <button className={'button ' + (own.ready ? 'secondary' : 'primary')} disabled={!online} onClick={() => socket.emit('ready', !own.ready, report)}><Check size={19} /> {own.ready ? 'Hazır değilim' : 'Hazırım'}</button>
          {host && <button className={'button ' + (ready ? 'primary' : 'secondary')} disabled={!ready || !online}
            onClick={() => socket.emit('start', report)}>Oyunu başlat <ArrowRight size={18} /></button>}
        </div>
      </div>
    </div>
  </section>
}

function PromptCard({ prompt }: { prompt: Prompt }) {
  const ref = 'reference' in prompt ? REFERENCES.find(item => item.file === prompt.reference) : undefined
  return <div className="prompt-card">
    {ref ? <img src={asset(ref.file)} width={ref.width} height={ref.height}
      style={{ '--reference-width': Math.min(65.25, 42.1 * ref.width / ref.height) + '%' } as CSSProperties}
      alt="Bu turun referans fotoğrafı" />
      : 'sentence' in prompt && <p data-testid="sentence">{prompt.sentence}</p>}
  </div>
}

function Drawing({ room, online, game }: { room: RoomView & { round: RoundView }; online: boolean; game: Game }) {
  const { round, me } = room
  const [brush, setBrush] = useState({ color: 0, size: 1, erase: false })
  const [now, setNow] = useState(gameNow)
  useEffect(() => {
    const interval = window.setInterval(() => setNow(gameNow()), 90)
    return () => window.clearInterval(interval)
  }, [])
  const remaining = Math.max(0, round.endsAt - now)
  const seconds = Math.ceil(remaining / 1000)
  const relay = round.mode === 'relay'
  const enabled = online && seconds > 0 && (!relay || round.active === me)
  const previous = round.strokes.findLast(s => s.owner === me)
  const headline = !seconds ? 'Süre doldu' : !relay ? '' :
    round.active === me ? 'Sıra sende!' : round.names[round.active!] + ' çiziyor'
  const time = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
  return <section className="stage drawing">
    <h1 className="sr-only">{MODES[round.mode].name}</h1>
    <div className="drawing-layout">
      <aside className="drawing-context">
        <PromptCard prompt={round.prompt} />
        <div className="round-clock">
          <div className={'clock ' + (seconds < 6 ? 'urgent' : '')} aria-label="Kalan süre"><Clock3 size={18} /> <span data-testid="timer">{time}</span></div>
          {headline && <strong className="turn-status" role="status">{headline}</strong>}
          {relay && <small data-testid="turn">Sıra {round.turn + 1} / 8</small>}
        </div>
      </aside>
      <div className="sketchbook">
        <div className="sheet">
          <Board key={round.id} strokes={round.strokes} label="Çizim tuvali"
            input={{ brush, enabled, endsAt: round.endsAt, round: round.id, turn: round.turn, send: value => game.draw(value, me) }} />
        </div>
        <div className="tools" role="group" aria-label="Çizim araçları">
          <div className="swatches" aria-label="Kalem renkleri">{PALETTE.map(([label, color], index) => <button type="button" key={color} disabled={!enabled}
            aria-label={label} title={label} aria-pressed={!brush.erase && brush.color === index} onClick={() => setBrush({ ...brush, color: index, erase: false })}>
            <span style={{ backgroundColor: color }} /></button>)}</div>
          <div className="tool-divider" />
          <div className="widths">{WIDTH_LABELS.map((label, index) => <button key={label} disabled={!enabled} aria-pressed={brush.size === index}
            aria-label={label} title={label} onClick={() => setBrush({ ...brush, size: index })}><span style={{ width: 4 + index * 4, height: 4 + index * 4 }}/></button>)}</div>
          <div className="tool-divider" />
          <div className="tool-buttons">
            <button disabled={!enabled} aria-pressed={brush.erase} aria-label="Silgi" title="Silgi" onClick={() => setBrush({ ...brush, erase: !brush.erase })}><Eraser size={19}/></button>
            <button disabled={!enabled || !previous} aria-label="Geri al" title="Geri al" onClick={() => previous &&
              socket.emit('undo', { round: round.id, turn: round.turn, id: previous.id }, game.report)}><Undo2 size={20}/></button>
          </div>
        </div>
      </div>
    </div>
  </section>
}

function Results({ round, session, game }: { round: RoundView; session: Session; game: Game }) {
  const [busy, setBusy] = useState<'save' | 'download' | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const relay = round.mode === 'relay'
  async function action(kind: 'save' | 'download') {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      if (kind === 'save') { await api('gallery/' + round.id, session.token, 'POST'); setSaved(true) }
      else await downloadDrawing('result', round.id, session.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem tamamlanamadı.')
    } finally { setBusy(null) }
  }
  return <section className="stage results" data-testid="results" data-round={round.id}>
    <h1 className="sr-only">Tur sonucu</h1>
    <div className="result-layout">
      <PromptCard prompt={round.prompt} />
      <div className={'frames ' + (relay ? 'one-frame' : '')}>
        {(relay ? [0] : [0, 1]).map(index => <figure className="frame" key={index}>
          <Board strokes={relay ? round.strokes : round.strokes.filter(s => s.owner === index)}
            label={relay ? 'Ortak çizim' : labels[index] + ' çizimi'} />
          <figcaption>{relay ? round.names.join(' ve ') : round.names[index]}</figcaption>
        </figure>)}
      </div>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="result-actions action-row">
      <button className="button primary" disabled={!!busy} onClick={() => action('download')}><ArrowDownToLine size={18} /> Çizimi İndir</button>
      <button className="button secondary" disabled={!!busy || saved} onClick={() => action('save')}><BookOpen size={18} /> {saved ? 'Galeriye kaydedildi' : busy === 'save' ? 'Kaydediliyor…' : 'Galeriye kaydet'}</button>
      <button className="button secondary" disabled={!game.online || !!busy} onClick={() => socket.emit('replay', game.report)}><RefreshCw size={17} /> Tekrar oyna</button>
    </div>
  </section>
}

export function App() {
  const game = useRoom()
  const [album, setAlbum] = useState<Session | null>(null)
  const openAlbum = (session?: Session | null) => setAlbum(session ?? game.session ?? history()[0] ?? null)
  const room = game.view
  const gallerySessions = album ? [album, ...history().filter(s => s.token !== album.token)] : []
  const phase = room?.phase
  useEffect(() => { window.scrollTo(0, 0) }, [phase, !!album])
  useEffect(() => { if (phase === 'drawing') setAlbum(null) }, [phase])
  let content: ReactNode
  if (album) {
    content = <Gallery key={album.token} session={album} sessions={gallerySessions} change={setAlbum} close={() => setAlbum(null)} />
  } else if (!room) {
    content = game.booting ? <section className="stage empty" role="status">Çizim masası açılıyor…</section> : <Home game={game} />
  } else if (room.phase === 'lobby') {
    content = <Lobby room={room} online={game.online} report={game.report} />
  } else if (room.phase === 'drawing' && room.round) {
    content = <Drawing key={room.round.id} room={{ ...room, round: room.round }} online={game.online} game={game} />
  } else if (room.round && game.session) {
    content = <Results key={room.round.id} round={room.round} session={game.session} game={game} />
  }
  const leave = () => {
    setAlbum(null)
    game.leave()
  }
  return <>
    <Header home={!room && !album} album={phase !== 'drawing' && !album && (game.session || history().length) ? () => openAlbum() : undefined} leave={room ? leave : undefined} />
    {room && !game.online && <div className="status-strip" role="status"><WifiOff size={17} /> Bağlantı kesildi. Yeniden bağlanılıyor…</div>}
    {room && game.error && <div className="status-strip" role="alert">{game.error}</div>}
    {content}
  </>
}
