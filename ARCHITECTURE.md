# Arsitektur MetaScope

## Gambaran Lapisan

MetaScope memisahkan secara ketat antara **mesin parser deterministik** (tanpa ketergantungan React atau LLM), **mesin aturan deklaratif**, **pekerja latar (Web Worker)**, **antarmuka React**, dan **rute server opsional**.

```text
/src
├── engine/          # Fungsi murni deterministik (Blob.slice -> JSON bagian Report)
│   ├── types.ts           # Skema tunggal Report v1.0 (satu sumber kebenaran)
│   ├── magic.ts           # Deteksi tipe berbasis magic bytes & cek ekstensi
│   ├── hasher.ts          # Streaming MD5 / SHA-1 / SHA-256 via hash-wasm (chunk 2 MiB)
│   ├── mp4.ts             # Walker box MP4/MOV, stsz/stss/stco/stts/ctts, hvcC/avcC, SEI, statistik
│   ├── image.ts           # Walker JPEG/PNG/WebP/HEIC, CRC32, DQT, exifr (EXIF/GPS/XMP/IPTC/ICC)
│   ├── pdf.ts             # Parser PDF deterministik (Info, XMP, %%EOF, JS, objek, cakupan byte)
│   ├── officeArchive.ts   # Parser ZIP Central Directory & XML Office aman (tanpa XXE)
│   ├── audio.ts           # music-metadata + walker WAV/MP3/FLAC
│   ├── c2pa.ts            # Deteksi JUMBF + lazy-load @contentauth/c2pa-web
│   ├── stringsEntropy.ts  # Ekstraksi strings berbasis potongan & profil entropi Shannon
│   ├── orchestrator.ts    # Orkestrasi L0-L8 terisolasi (galat -> warning) + merger Mode Mendalam
│   ├── diff.ts            # Mesin perbandingan dua Report (tag, struktur, hash, privasi)
│   ├── exporters.ts       # JSON tervalidasi, CSV, Markdown, HTML mandiri (ter-escape), ZIP batch
│   ├── samples.ts         # Pembangkit fixture biner deterministik untuk pengujian lokal
│   └── historyDb.ts       # Penyimpanan riwayat lokal IndexedDB (hanya metadata)
├── rules/           # Daftar aturan data-driven (terpisah dari parser)
│   ├── checks.ts          # Aturan cross-check fakta (lolos / gagal / tidak_berlaku)
│   ├── inferences.ts      # Aturan inferensi berlabel keyakinan (pasti / kuat / heuristik)
│   ├── privacy.ts         # Bobot skor privasi transparan & saran netral
│   └── engine.ts          # Runner evaluasi aturan & penanda AI/provenance
├── workers/         # Eksekusi non-blocking di Web Worker
│   ├── analyzer.worker.ts
│   └── workerClient.ts
├── i18n/            # Kamus bahasa Indonesia (default) & Inggris + formatter lokal
└── ui/              # Komponen antarmuka aksesibel WCAG 2.2 AA (Mode Terang & Gelap)

/app/api
├── analyze/route.ts       # Mode Mendalam: ExifTool + ffprobe, file temp UUID dihapus di finally
└── ai-insight/route.ts    # Proksi Gemini server-side (@google/genai, JSON tersaring saja)
```

## Prinsip Keamanan & Privasi

1. **Zero Upload Default**: Mode Privat memproses seluruh berkas lewat `Blob.slice` di dalam Web Worker browser.
2. **Isolasi Kesalahan**: Setiap analyzer dibungkus `try/catch`; kegagalan satu modul dicatat pada `report.warnings` tanpa membatalkan laporan.
3. **XSS & XXE Safety**: Semua nilai tag dirender sebagai teks React (tanpa `dangerouslySetInnerHTML`); ekspor HTML melakukan entity escaping penuh; XML Office dibaca secara non-eksekusi tanpa resolusi entitas eksternal.
4. **Batas Server Ketat**: `POST /api/analyze` membatasi ukuran unggahan via `METASCOPE_MAX_UPLOAD_MB`, menerapkan rate limit per IP, tidak pernah memakai nama file pengguna di path disk, dan menghapus berkas sementara secara mutlak di `finally`.
5. **AI Terbatasi**: `POST /api/ai-insight` menyaring ulang payload di server, hanya mengakses `process.env.GEMINI_API_KEY` di server, dan menerapkan system prompt anti-halusinasi.
