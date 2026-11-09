# Hadi Çizelim

İki kişilik, kâğıt ve karton temalı bir çizim oyunu. [Canlı oyun](https://ahmayek210.github.io/hadi-cizelim/)

## Nasıl oynanır?

1. Adını yazıp oda oluştur. Arkadaşına oda kodunu ya da davet bağlantısını gönder. İsterseniz ikiniz de `HADICIZELIM` koduyla sabit odaya katılabilirsiniz.
2. Oda sahibi modu seçer. İki oyuncu hazır olunca oyunu başlatır.
3. Referanstan Çiz ve Cümleden Çiz modlarında her oyuncu kendi tuvalinde 60 saniye çizer. Sıralı Çizim modunda ortak tuvalde her oyuncuya 15 saniyelik dörder sıra verilir.
4. Sergide PNG veya ZIP indir. **Galeriye kaydet** ile turu iki katılımcının özel albümünde sakla.

Katılım anahtarı tarayıcıda saklanır. Sayfayı yenilediğinde aynı oyuncu olarak devam edebilirsin. Lobide bağlantısı kopan oyuncunun yeri beş dakika tutulur. Herkesin ayrıldığı odalar yeniden kullanılabilir. Oda kodu lobiyi bulur. Galeri erişimini o turdaki katılım anahtarları belirler. Tarayıcı verileri temizlenirse saklanan anahtarlar da kaybolur.

## Yerelde çalıştırma

Node.js 24 ve npm gerekir. Depo kökünde bağımlılıkları kur.

```sh
npm ci
```

İki terminal aç. İlkinde API'yi, ikincisinde web uygulamasını başlat.

```sh
npm run dev:api
npm run dev
```

Oyun `http://localhost:5173` adresinde, API `http://localhost:8080` adresinde açılır. Yerel galeri PGlite ve `.local/` dizininde saklanan PNG dosyalarını kullanır. Başka cihazdan yerel test için HTTPS ve uygun `FRONTEND_ORIGINS` ile `VITE_BACKEND_URL` değerleri gerekir.

```sh
npm run assets
npm run build
npx playwright install chromium firefox
npm test
```

`npm run assets` 19 JPG'yi açıp boyutlarını doğrular ve referans manifestini üretir. `shared/sentences.json` 40 özgün cümleyi içerir. Playwright üç modu gerçek süreleriyle çalıştırır ve yerel servisleri kendisi başlatır. Yayımlanan siteye karşı aynı paketi çalıştırmak için `E2E_SITE` ve `E2E_API` ortam değişkenlerini ver.

## Üretim

- **GitHub Pages** Vite çıktısını depo alt yolunda yayımlar. Derleme sırasında `PAGES_BASE` için `/hadi-cizelim/`, `VITE_BACKEND_URL` için Railway HTTPS adresi gerekir. Davetler `?oda=KOD` kullanır.
- **Railway** kökteki Dockerfile'dan API'yi çalıştırır. Tek replika kullanır. `/health` hem PostgreSQL hem nesne deposu bağlantısını kontrol eder.
- **Neon** galeri bilgilerini PostgreSQL'de, PNG dosyalarını özel S3 uyumlu depoda tutar. Backend başlangıçta galeri tablosunu ve indekslerini oluşturur.

Railway servis değişkenleri:

| Değişken | İçerik |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Railway'in yönlendirdiği port. Bu servis için 8080. |
| `FRONTEND_ORIGINS` | Virgülle ayrılmış tam origin değerleri. Canlı site için `https://ahmayek210.github.io`. |
| `DATABASE_URL` | SSL etkin Neon PostgreSQL bağlantısı |
| `AWS_ENDPOINT_URL_S3` | Neon dalının S3 uç noktası |
| `AWS_REGION` | Nesne deposu bölgesi |
| `AWS_ACCESS_KEY_ID` | Neon kapsamlı anahtar kimliği |
| `AWS_SECRET_ACCESS_KEY` | Neon S3 gizli anahtarı |
| `S3_BUCKET` | Özel kova adı |

Galeri S3 anahtarına `storage:read` ve `storage:write` kapsamları verilir. Veritabanı ve S3 değerleri yalnızca Railway ortamında tutulur. Galeri isteklerinde sunucu katılım anahtarının özetini, tur kaydındaki katılımcılarla karşılaştırır.

Aktif odalar ve kaydedilmemiş turlar tek Railway sürecinin belleğinde tutulur. Yeniden dağıtım veya süreç yeniden başlatma aktif turları sonlandırır. Kaydedilmiş galeri sonuçları Neon'da kalır.

- [GitHub Pages yayımlama ayarları](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Railway sağlık kontrolü](https://docs.railway.com/deployments/healthchecks)
- [Neon nesne depolama kimlik doğrulaması](https://neon.com/docs/storage/authentication)
