import { test, expect } from '@playwright/test'
import { io, type Socket } from 'socket.io-client'
import { randomUUID } from 'node:crypto'
import { backend } from '../playwright.config.ts'
import { matches } from '../server/words.ts'
import type { RoomView, SocketInput, SocketOutput } from '../shared/protocol.ts'

test('Türkçe eşleşme ve ihtiyatlı yazım hataları', () => {
  for (const [word, guess] of [['çiçek','cicek'], ['şişe','sise'], ['gözlük','gozluk'], ['ağaç','agac'], ['ışık','ISIK'], ['üzüm','uzum'], ['köpek','kopek'], ['patates','pataes'], ['dondurma','dondruma'], ['bisiklet','bisikelt']]) {
    expect(matches({ text: word, aliases: [] }, guess), `${word} / ${guess}`).toBeTruthy()
  }
  for (const [word, guess] of [['ev','el'], ['kedi','köpek'], ['araba','arabi'], ['patates','domates'], ['uçan balık','uçan kedi']]) {
    expect(matches({ text: word, aliases: [] }, guess), `${word} / ${guess}`).toBeFalsy()
  }
  expect(matches({ text: 'Televizyon', aliases: ['TV'] }, 'tv')).toBeTruthy()
})

test('altı tur, gizlilik, yetki, yeniden bağlanma ve galeri', async ({ request }) => {
  test.setTimeout(110_000)
  const peers: Socket<SocketOutput, SocketInput>[] = [io(backend), io(backend)]
  const states: (RoomView | undefined)[] = []
  peers.forEach((peer, i) => peer.on('room', state => { states[i] = state }))
  try {
    const a = await peers[0].timeout(8000).emitWithAck('enter', { action: 'create', code: '', name: 'Ada' })
    if (!a.ok) throw new Error(a.error)
    const b = await peers[1].timeout(8000).emitWithAck('enter', { action: 'join', code: a.value.code, name: 'Can' })
    if (!b.ok) throw new Error(b.error)
    await peers[0].timeout(8000).emitWithAck('mode', 'guess')
    await Promise.all(peers.map(p => p.timeout(8000).emitWithAck('ready', true)))
    await peers[0].timeout(8000).emitWithAck('start')
    const words: string[] = []
    let firstStroke = ''
    for (let turn = 0; turn < 6; turn++) {
      await expect.poll(() => states[turn % 2]?.round?.turn, { timeout: 10_000 }).toBe(turn)
      const drawer = turn % 2, guesser = 1 - drawer
      const current = states[drawer]!.round!
      const word = current.guess!.word!
      words.push(word)
      expect(word).toBeTruthy()
      expect(JSON.stringify({ ...states[guesser]!.round, names: [], date: '', quote: '' })).not.toContain(JSON.stringify(word))
      expect(current.strokes).toHaveLength(0)
      await expect.poll(() => states[drawer]?.round?.guess?.stage, { timeout: 5000 }).toBe('playing')
      const stroke = { round: current.id, turn, id: randomUUID(), offset: 0, color: 0, size: 1, erase: false, points: [[.1,.2], [.8,.2]] as [number, number][] }
      if (!turn) firstStroke = stroke.id
      expect((await peers[guesser].timeout(8000).emitWithAck('draw', stroke)).ok).toBeFalsy()
      expect((await peers[drawer].timeout(8000).emitWithAck('draw', stroke)).ok).toBeTruthy()
      await expect.poll(() => states[guesser]?.round?.strokes.length).toBe(0) // patches do not publish snapshots
      peers[guesser].emit('sync')
      await expect.poll(() => states[guesser]?.round?.strokes.length).toBe(1)
      expect((await peers[drawer].timeout(8000).emitWithAck('guess', { round: current.id, turn, text: word })).ok).toBeFalsy()
      const wrong = await peers[guesser].timeout(8000).emitWithAck('guess', { round: current.id, turn, text: 'bambaşka' })
      expect(wrong.ok && !wrong.value.correct).toBeTruthy()
      if (turn === 0) {
        peers[guesser].disconnect(); peers[guesser].connect()
        expect((await peers[guesser].timeout(8000).emitWithAck('enter', { ...b.value, action: 'resume' })).ok).toBeTruthy()
        await expect.poll(() => states[guesser]?.round?.strokes[0]?.id).toBe(firstStroke)
        expect(JSON.stringify({ ...states[guesser]!.round, names: [], date: '', quote: '' })).not.toContain(JSON.stringify(word))
      }
      if (turn === 1) {
        expect((await peers[drawer].timeout(8000).emitWithAck('draw', { ...stroke, turn: 0 })).ok).toBeFalsy()
        expect((await peers[guesser].timeout(8000).emitWithAck('guess', { round: current.id, turn: 0, text: words[0] })).ok).toBeFalsy()
      }
      if (turn !== 2) {
        const correct = await peers[guesser].timeout(8000).emitWithAck('guess', { round: current.id, turn, text: word })
        expect(correct.ok && correct.value.correct).toBeTruthy()
      }
      await expect.poll(() => states[guesser]?.round?.guess?.stage, { timeout: 35_000 }).toBe('transition')
      expect(states[guesser]!.round!.guess!.results[turn].success).toBe(turn !== 2)
    }
    await expect.poll(() => states[0]?.phase, { timeout: 6000 }).toBe('results')
    expect(new Set(words).size).toBe(6)
    expect(states[0]!.round!.guessResults!.filter(r => r.success)).toHaveLength(5)
    expect(states[0]!.round!.guessResults).toEqual(states[1]!.round!.guessResults)
    const id = states[0]!.round!.id, headers = { Authorization: 'Bearer ' + a.value.token }
    expect((await request.get(`${backend}/api/result/${id}/sergi`, { headers })).ok()).toBeTruthy()
    expect((await request.post(`${backend}/api/gallery/${id}`, { headers })).ok()).toBeTruthy()
    expect((await request.get(`${backend}/api/gallery/${id}/sergi`, { headers: { Authorization: 'Bearer ' + b.value.token } })).ok()).toBeTruthy()
  } finally { peers.forEach(p => p.disconnect()) }
})


