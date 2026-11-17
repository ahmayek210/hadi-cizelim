import { randomInt } from 'node:crypto'

// Drawability and familiar vocabulary take precedence over exhaustive coverage.
const easy = `Kedi,Köpek,Balık,Muz,Elma,Araba,Ev,Kalp,Güneş,Ay,Ağaç,Çiçek,Şişe,Bardak,Kitap,Pizza,Robot,Uçak,Saat,Balon,Kuş,At,İnek,Koyun,Ördek,Tavuk,Arı,Kelebek,Fil,Zürafa,Aslan,Maymun,Yılan,Kapı,Pencere,Masa,Sandalye,Yatak,Yastık,Lamba,Ayna,Tarak,Fırça,Sabun,Anahtar,Kilit,Çanta,Şapka,Ayakkabı,Çorap,Eldiven,Elbise,Gömlek,Top,Uçurtma,Gemi,Tren,Otobüs,Bisiklet,Tekerlek,Yol,Köprü,Dağ,Bulut,Yağmur,Kar,Yıldız,Gökkuşağı,Deniz,Ada,Çim,Yaprak,Mantar,Havuç,Domates,Patates,Salatalık,Biber,Mısır,Üzüm,Çilek,Karpuz,Armut,Kiraz,Limon,Portakal,Ekmek,Peynir,Yumurta,Pasta,Kek,Çay,Kahve,Kaşık,Çatal,Bıçak,Tabak,Tencere,Tava,Diş,Göz,Burun,Kulak,El,Ayak,Taç,Hediye,Oyuncak,Kalem,Silgi,Defter,Makas,Boya,Futbol,Çadır,Merdiven,Para,Balıkçı,Gitar,Davul,Piyano,Kamera,Telefon,Bilgisayar,Süpürge,Musluk,Şemsiye`.split(',')
const medium = `Dondurma,Kaplumbağa,Gözlük,Televizyon,Roket,Kurbağa,Denizaltı,Penguen,Helikopter,Zürafa,Kirpi,Salyangoz,Timsah,Ahtapot,Yunus,Kanguru,Deve,Hamster,Papağan,Baykuş,Traktör,Ambulans,İtfaiye,Satranç,Dürbün,Mikroskop,Şelale,Volkan,Deniz feneri,Kardan adam`.split(',')
const funny = `Uçan balık,Dans eden kedi,Ağlayan patates,Uykucu robot,Şapkalı muz,Kızgın penguen,Pizza yiyen uzaylı,Gülen güneş,Uçan fil,Dans eden havuç,Şarkı söyleyen kuş,Kayak yapan ayı,Kitap okuyan kedi,Şapkalı balık,Uzaylı köpek`.split(',')
const aliases: Record<string, string[]> = { Televizyon: ['TV'], Araba: ['Otomobil'] }
export type Word = { text: string; aliases: string[] }
export function selectWords(): Word[] {
  const groups = [easy, medium, funny].map(items => [...new Set(items)])
  const chosen: Word[] = []
  while (chosen.length < 6) {
    const n = randomInt(100), group = groups[n < 70 ? 0 : n < 90 ? 1 : 2]
    const text = group[randomInt(group.length)]
    if (!chosen.some(w => normalize(w.text) === normalize(text))) chosen.push({ text, aliases: aliases[text] || [] })
  }
  return chosen
}
export function normalize(value: string) {
  return value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').trim().replace(/\s+/g, ' ')
}
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) d[i][0] = i
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + Number(a[i-1] !== b[j-1]))
    if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) d[i][j] = Math.min(d[i][j], d[i-2][j-2] + 1)
  }
  return d[a.length][b.length]
}
const vocabulary = new Set([...easy, ...medium, ...funny].map(normalize))
export function matches(word: Word, guess: string) {
  const input = normalize(guess), answer = normalize(word.text)
  if ([answer, ...word.aliases.map(normalize)].includes(input)) return true
  if (!input || input.length > 80 || vocabulary.has(input) || input.split(' ').length !== answer.split(' ').length) return false
  // One typo only, with each word checked separately and short words exact.
  let mistakes = 0
  const a = answer.split(' '), b = input.split(' ')
  for (let i = 0; i < a.length; i++) {
    const delta = distance(a[i], b[i])
    if (delta && a[i].length < 6) return false
    mistakes += delta
  }
  return mistakes <= 1
}
