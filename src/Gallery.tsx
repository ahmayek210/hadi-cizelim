import { useEffect, useState } from 'react'
import { ArrowDownToLine, BookOpen, ChevronLeft, Image as ImageIcon } from 'lucide-react'
import { MODES } from '../shared/protocol.ts'
import type { GalleryEntry, GalleryPage, Session } from '../shared/protocol.ts'
import { api } from './room.ts'

export async function downloadDrawing(source: 'result' | 'gallery', id: string, token: string) {
  const response = await api(source + '/' + id + '/sergi', token)
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'hadi-cizelim-' + id.slice(0, 8) + '.png'
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
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setEntries(null)
    setSelected(null)
    setError('')
    setNext(null)
    api('gallery', session.token, 'GET', controller.signal).then(response => response.json()).then((page: GalleryPage) => {
      if (controller.signal.aborted) return
      setEntries(page.entries)
      setNext(page.next)
    })
      .catch(err => {
        if (controller.signal.aborted) return
        setEntries([])
        if (!err.message.includes('galeri erişimi yok')) setError(err.message)
      })
    return () => controller.abort()
  }, [session.token])
  async function more() {
    if (!next || busy) return
    setBusy(true)
    setError('')
    try {
      const page: GalleryPage = await (await api('gallery?after=' + next, session.token)).json()
      setEntries(items => [...(items || []), ...page.entries])
      setNext(page.next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Albüm açılamadı.')
    } finally { setBusy(false) }
  }
  async function exportFile() {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    try { await downloadDrawing('gallery', selected.id, session.token) }
    catch (err) { setError(err instanceof Error ? err.message : 'Dosya indirilemedi.') }
    finally { setBusy(false) }
  }
  const title = (entry: GalleryEntry) => 'sentence' in entry.prompt ? entry.prompt.sentence : 'Referans fotoğrafı'
  const date = (entry: GalleryEntry) => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(entry.date))
  return <section className={'stage gallery' + (selected ? ' gallery-detail' : '')}>
    <button className="text-button" onClick={() => selected ? setSelected(null) : close()}><ChevronLeft size={18} /> {selected ? 'Galeriye dön' : 'Geri dön'}</button>
    <h1 className={selected ? 'sr-only' : 'gallery-heading'}>{selected ? title(selected) : 'Çizim galerisi'}</h1>
    {!selected && sessions.length > 1 && <label className="gallery-select">Oda oturumu
      <select value={session.token} onChange={event => { const next = sessions.find(s => s.token === event.target.value); if (next) change(next) }}>
        {sessions.map((s, i) => <option value={s.token} key={s.token}>{s.code} · {s.name} · {i + 1}</option>)}
      </select></label>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {selected ? <>
      <div className="exhibit-image"><ProtectedImage key={selected.id} path={'gallery/' + selected.id + '/sergi'} token={session.token} label={title(selected)} /></div>
      <div className="action-row gallery-actions">
        <button className="button primary" disabled={busy} onClick={exportFile}><ArrowDownToLine size={18} /> Çizimi İndir</button>
      </div>
    </> : entries === null ? <p className="empty" role="status">Albüm açılıyor…</p> : !entries.length ? <div className="empty"><BookOpen size={28}/><h2>Albüm henüz boş</h2></div>
      : <>
        <div className="gallery-grid">{entries.map(entry => <button className="gallery-card" key={entry.id} onClick={() => setSelected(entry)}>
          <ProtectedImage path={'gallery/' + entry.id + '/onizleme'} token={session.token} label={title(entry)} />
          <span className="mini-label">{MODES[entry.mode].name} · {date(entry)}</span><strong>{title(entry)}</strong><small>{entry.names.join(' ve ')}</small>
        </button>)}</div>
        {next && <button className="button secondary" onClick={more} disabled={busy}>Daha fazla göster</button>}
      </>}
  </section>
}
