import { useEffect, useState } from 'react'
import { ArrowDownToLine, BookOpen, ChevronLeft, Image as ImageIcon } from 'lucide-react'
import { MODES } from '../shared/protocol.ts'
import type { GalleryEntry, Session } from '../shared/protocol.ts'
import { api } from './room.ts'

export async function download(source: string, id: string, file: string, token: string) {
  const response = await api(source + '/' + id + '/' + file, token)
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'hadi-cizelim-' + id.slice(0, 8) + (file === 'zip' ? '.zip' : '-' + file + '.png')
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function ProtectedImage({ path, token, label }: { path: string; token: string; label: string }) {
  const [state, setState] = useState<{ path: string; url: string; failed: boolean }>({ path: '', url: '', failed: false })
  useEffect(() => {
    const controller = new AbortController()
    let url = ''
    api(path, token, 'GET', controller.signal).then(response => response.blob()).then(blob => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      setState({ path, url, failed: false })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ path, url: '', failed: true })
    })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [path, token])
  return state.path === path && state.url
    ? <img src={state.url} alt={label} />
    : <div className="image-placeholder" aria-label={label}><ImageIcon size={24} />{state.path === path && state.failed ? 'Görsel yüklenemedi' : 'Yükleniyor…'}</div>
}

export function Gallery({ session, sessions, change, close }: { session: Session; sessions: Session[]; change: (s: Session) => void; close: () => void }) {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
  const [selected, setSelected] = useState<GalleryEntry | null>(null)
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(12)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setEntries(null)
    setSelected(null)
    setError('')
    setLimit(12)
    api('gallery', session.token, 'GET', controller.signal).then(response => response.json()).then(setEntries)
      .catch(err => {
        if (controller.signal.aborted) return
        setEntries([])
        if (!err.message.includes('galeri erişimi yok')) setError(err.message)
      })
    return () => controller.abort()
  }, [session.token])
  async function exportFile(file: string) {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    try { await download('gallery', selected.id, file, session.token) }
    catch (err) { setError(err instanceof Error ? err.message : 'Dosya indirilemedi.') }
    finally { setBusy(false) }
  }
  const title = (entry: GalleryEntry) => 'sentence' in entry.prompt ? entry.prompt.sentence : 'Referans fotoğrafı'
  const date = (entry: GalleryEntry) => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(entry.date))
  return <section className="stage gallery">
    <button className="text-button" onClick={() => selected ? setSelected(null) : close()}><ChevronLeft size={18} /> {selected ? 'Galeriye dön' : 'Geri dön'}</button>
    <div className="stage-intro">
      <span className="eyebrow"><BookOpen size={16} /> ÖZEL ALBÜM</span>
      <h1>{selected ? title(selected) : 'Çizim galerisi'}</h1>
      {selected ? <p>{MODES[selected.mode].name} · {selected.names.join(' ve ')} · {date(selected)}</p>
        : <p>Birlikte çizdiğiniz ve saklamak istediğiniz turlar.</p>}
    </div>
    {!selected && sessions.length > 1 && <label className="gallery-select">Oda oturumu
      <select value={session.token} onChange={event => { const next = sessions.find(s => s.token === event.target.value); if (next) change(next) }}>
        {sessions.map((s, i) => <option value={s.token} key={s.token}>{s.code} · {s.name} · {i + 1}</option>)}
      </select></label>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {selected ? <>
      <div className="exhibit-image"><ProtectedImage key={selected.id} path={'gallery/' + selected.id + '/sergi'} token={session.token} label={title(selected)} /></div>
      <div className="action-row">
        <button className="button primary" disabled={busy} onClick={() => exportFile('sergi')}><ArrowDownToLine size={18} /> PNG indir</button>
        <button className="button secondary" disabled={busy} onClick={() => exportFile('zip')}><ArrowDownToLine size={18} /> ZIP indir</button>
      </div>
    </> : entries === null ? <p className="empty">Albüm açılıyor…</p> : !entries.length ? <div className="empty"><BookOpen size={28}/><h2>Albüm henüz boş</h2><p>Bir turun sonunda Galeriye kaydet düğmesine dokun.</p></div>
      : <>
        <div className="gallery-grid">{entries.slice(0, limit).map(entry => <button className="gallery-card" key={entry.id} onClick={() => setSelected(entry)}>
          <ProtectedImage path={'gallery/' + entry.id + '/onizleme'} token={session.token} label={title(entry)} />
          <span className="mini-label">{MODES[entry.mode].name} · {date(entry)}</span><strong>{title(entry)}</strong><small>{entry.names.join(' ve ')}</small>
        </button>)}</div>
        {entries.length > limit && <button className="button secondary" onClick={() => setLimit(n => n + 12)}>Daha fazla göster</button>}
      </>}
  </section>
}
