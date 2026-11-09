import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Copy, Eraser, Image as ImageIcon, Layers2, Link2, LockKeyhole, Pencil, Plus, RefreshCw, Sparkles, Undo2, UsersRound, WifiOff } from 'lucide-react'
import { FIXED, MODES, PALETTE, REFERENCES, normalizeCode } from '../shared/protocol.ts'
import type { Mode, Prompt, RoomView, RoundView, Session } from '../shared/protocol.ts'
import { CoverArt } from './Art.tsx'
import { Board } from './Board.tsx'
import { Gallery, download } from './Gallery.tsx'
import { api, gameNow, history, lastName, socket, useRoom } from './room.ts'

type Game = ReturnType<typeof useRoom>
const MODE_ICONS = { reference: ImageIcon, sentence: Pencil, relay: Layers2 }
const WIDTH_LABELS = ['İnce', 'Orta', 'Kalın']
const modeList = Object.entries(MODES) as [Mode, typeof MODES[Mode]][]
const labels = ['Birinci oyuncu', 'İkinci oyuncu']
const asset = (file: string) => import.meta.env.BASE_URL + 'referans/' + file

function Header({ album, leave }: { album?: () => void; leave?: () => void }) {
  return <header className="masthead"><div className="mast-inner">
    <div className="brand"><span className="brand-icon"><Pencil size={20} strokeWidth={2.3} /></span>
      <span>Hadi Çizelim<small>İKİ KİŞİLİK ÇİZİM OYUNU</small></span></div>
    <nav aria-label="Oyun menüsü">
      {album && <button className="nav-button" onClick={album}><BookOpen size={18} /> <span>Galerim</span></button>}
      {leave && <button className="nav-button leave" onClick={leave}><ArrowLeft size={18} /> <span>Odadan ayrıl</span></button>}
      {!leave && !album && <span className="nav-tag"><UsersRound size={17} /> İki kişilik</span>}
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
        <span className="eyebrow ticket"><Sparkles size={15} /> KÂĞIT, KALEM, ARKADAŞ</span>
        <h1>Hadi <em>Çizelim<span>!</span></em></h1>
        <p className="lede">Bir arkadaşını çağır, kalemini seç.<br className="desktop-break" /> İki kişilik çizim masası seni bekliyor.</p>
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
        <p className="privacy-note"><LockKeyhole size={15} /> Hesap gerekmez. Çizim galerisi odana özel.</p>
      </div>
      <CoverArt />
    </section>
    <section className="home-modes" aria-label="Oyun modları">
      {modeList.map(([mode, details], index) => {
        const Icon = MODE_ICONS[mode]
        return <article className={'home-mode ' + mode} key={mode}><span className="mode-icon"><Icon size={21} /></span>
          <div><h2>{details.name}</h2><p>{details.description}</p></div><span className="mode-number">0{index + 1}</span></article>
      })}
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
    <div className="stage-intro"><span className="eyebrow"><UsersRound size={17} /> ÇİZİM MASASI</span>
      <h1>Oyun lobisi</h1><p>Kodu arkadaşına gönder. İkiniz de hazır olunca çizime geçin.</p></div>
    <div className="lobby-grid">
      <aside className="invite-panel paper-panel">
        <span className="mini-label">ODA KODU</span>
        <strong className="invite-code" data-testid="room-code">{room.code}</strong>
        <div className="invite-actions">
          <button className="button secondary compact" onClick={() => share(true)}><Copy size={16} /> Kodu kopyala</button>
          <button className="button secondary compact" onClick={() => share(false)}><Link2 size={16} /> Davet bağlantısı</button>
        </div>
        {notice && <p className="feedback" role="status">{notice}</p>}
        <div className="seat-list">
          {([0, 1] as const).map(slot => {
            const p = room.players.find(player => player.slot === slot)
            return <div className={'seat ' + (p ? '' : 'vacant')} key={slot}>
              <span className="seat-icon">{p ? [...p.name][0].toLocaleUpperCase('tr') : <Plus size={18}/>}</span>
              <span><strong>{p?.name || 'Arkadaşın bekleniyor'}</strong>{p?.slot === room.me && <span className="you"> · Sen</span>}
                <small>{p ? !p.connected ? 'Bağlantı kesildi' : p.ready ? 'Hazır' : 'Bağlı · Bekliyor' : 'Boş koltuk'}</small></span>
              {p?.ready && p.connected && <Check size={19} className="seat-check" />}
            </div>
          })}
        </div>
      </aside>
      <div className="paper-panel mode-panel">
        <h2>Oyun modunu seç</h2>
        <p className="muted">{host ? 'Bu turda ne çizmek istersiniz?' : 'Oyun modunu oda sahibi seçer.'}</p>
        <div className="mode-list">{modeList.map(([mode, details]) => {
          const Icon = MODE_ICONS[mode]
          return <button key={mode} className={'mode-choice ' + mode} disabled={!host || !online} aria-pressed={room.mode === mode}
            onClick={() => socket.emit('mode', mode, report)}><span className="mode-icon"><Icon size={22} /></span>
            <span><strong>{details.name}</strong><small>{details.description}</small></span><span className="mode-time">{details.duration}</span>
            <span className="mode-radio">{room.mode === mode && <Check size={15} />}</span></button>
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

function PromptCard({ prompt, compact = false }: { prompt: Prompt; compact?: boolean }) {
  const ref = 'reference' in prompt ? REFERENCES.find(item => item.file === prompt.reference) : undefined
  return <div className={'prompt-card ' + (compact ? 'prompt-compact' : '')}>
    <span className="mini-label">{ref ? <ImageIcon size={15} /> : <CircleHelp size={15} />} {ref ? 'REFERANS' : 'ÇİZİM CÜMLESİ'}</span>
    {ref ? <img src={asset(ref.file)} width={ref.width} height={ref.height} alt="Bu turun referans fotoğrafı" />
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
  const headline = !online ? 'Bağlantı bekleniyor' : !seconds ? 'Süre doldu' : !relay ? 'Çizim zamanı' :
    round.active === me ? 'Sıra sende!' : round.names[round.active!] + ' çiziyor'
  const time = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
  return <section className="stage drawing">
    <div className="draw-heading">
      <div><span className="eyebrow"><Pencil size={15} /> {MODES[round.mode].name}</span><h1>{headline}</h1></div>
      <div className={'clock ' + (seconds < 6 ? 'urgent' : '')} aria-label="Kalan süre"><Clock3 size={19} /> <span data-testid="timer">{time}</span></div>
    </div>
    {relay && <div className="turn-meter" aria-label={'Çizim sırası ' + (round.turn + 1) + ' / 8'}>
      <strong data-testid="turn">Sıra {round.turn + 1} / 8</strong>
      <div>{Array.from({ length: 8 }, (_, index) => <span className={index < round.turn ? 'done' : index === round.turn ? 'current' : ''} key={index} />)}</div>
    </div>}
    <div className="drawing-layout">
      <aside><PromptCard prompt={round.prompt} compact /><p className="drawing-tip">{relay ? 'Çizim aynı kâğıtta devam eder. Sıran gelince kendi çizgilerine ekleme yap.' : 'Arkadaşının çizimi tur sonunda sergide açılacak.'}</p></aside>
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

function Results({ room, session, game, album }: { room: RoomView & { round: RoundView }; session: Session; game: Game; album: () => void }) {
  const { round } = room
  const [busy, setBusy] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const relay = round.mode === 'relay'
  async function action(file: string) {
    if (busy) return
    setBusy(file)
    setError('')
    try {
      if (file === 'save') { await api('gallery/' + round.id, session.token, 'POST'); setSaved(true) }
      else await download('result', round.id, file, session.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem tamamlanamadı.')
    } finally { setBusy('') }
  }
  return <section className="stage results" data-testid="results" data-round={round.id}>
    <div className="stage-intro"><span className="eyebrow"><Sparkles size={17} /> MİNİ ÇİZİM SERGİSİ</span>
      <h1>Ve işte eserler!</h1><p className="quote">“{round.quote}”</p></div>
    <div className="result-layout">
      <PromptCard prompt={round.prompt} />
      <div className={'frames ' + (relay ? 'one-frame' : '')}>
        {(relay ? [0] : [0, 1]).map(index => <figure className="frame" key={index}>
          <Board strokes={relay ? round.strokes : round.strokes.filter(s => s.owner === index)}
            label={relay ? 'Ortak çizim' : labels[index] + ' çizimi'} />
          <figcaption><strong>{relay ? round.names.join(' ve ') : round.names[index]}</strong>
            <small>{relay ? 'Ortak çizim' : index === room.me ? 'Senin çizimin' : 'Arkadaşının çizimi'}</small></figcaption>
        </figure>)}
      </div>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="result-actions paper-panel">
      <div className="action-row">
        <button className="button primary" disabled={!!busy || saved} onClick={() => action('save')}><BookOpen size={18} /> {saved ? 'Galeriye kaydedildi' : busy === 'save' ? 'Kaydediliyor…' : 'Galeriye kaydet'}</button>
        <button className="button secondary" disabled={!game.online || !!busy} onClick={() => socket.emit('replay', game.report)}><RefreshCw size={17} /> Tekrar oyna</button>
        {saved && <button className="text-button" onClick={album}>Galeriye git <ChevronRight size={17} /></button>}
      </div>
      <div className="action-row downloads">
        <button className="button secondary compact" disabled={!!busy} onClick={() => action(relay ? 'ortak' : room.me ? 'ikinci' : 'birinci')}><ArrowDownToLine size={16} /> {relay ? 'Ortak çizimi indir' : 'Kendi çizimimi indir'}</button>
        {!relay && <button className="button secondary compact" disabled={!!busy} onClick={() => action('sergi')}><ArrowDownToLine size={16} /> İki çizimi birlikte indir</button>}
        <button className="button secondary compact" disabled={!!busy} onClick={() => action('zip')}><ArrowDownToLine size={16} /> Tüm sonuçları indir (ZIP)</button>
      </div>
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
    content = <Results key={room.round.id} room={{ ...room, round: room.round }} session={game.session} game={game} album={() => openAlbum()} />
  }
  const leave = () => {
    setAlbum(null)
    game.leave()
  }
  return <>
    <Header album={phase !== 'drawing' && !album && (game.session || history().length) ? () => openAlbum() : undefined} leave={room ? leave : undefined} />
    {room && !game.online && <div className="status-strip" role="status"><WifiOff size={17} /> Bağlantı kesildi. Yeniden bağlanılıyor…</div>}
    {room && game.error && <div className="status-strip" role="alert">{game.error}</div>}
    {content}
    {phase !== 'drawing' && <footer className="footer"><span><Pencil size={14} /> Hadi Çizelim</span><span>Arkadaşla çizmek daha güzel.</span></footer>}
  </>
}
