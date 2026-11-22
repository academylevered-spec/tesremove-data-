# MetaScope — Penampil Metadata Universal

MetaScope adalah aplikasi web analisis metadata universal yang membongkar berkas hingga ke lapisan byte: tag kontainer, struktur internal (pohon box/segmen/chunk/objek/entri), bitstream video, statistik GOP & bitrate, linimasa timestamp, koordinat GPS, provenance C2PA, cross-check integritas, skor privasi transparan, dan penjelasan AI opsional.

## Mode Eksekusi

1. **Mode Privat (Default — 100% di Browser)**
   - Semua parsing dan hashing streaming (MD5, SHA-1, SHA-256) berjalan di browser menggunakan Web Worker dan `Blob.slice`.
   - Tidak ada byte file yang diunggah ke jaringan.
   - Peta OpenStreetMap pada tab Waktu & Lokasi hanya dimuat setelah pengguna menekan tombol **"Tampilkan di peta"**.
2. **Mode Mendalam (Opt-in — Server Node.js)**
   - Meminta persetujuan eksplisit sebelum mengirim file sementara ke `POST /api/analyze`.
   - Menjalankan `exiftool-vendored` (`-a -G1 -s -u -ee`) dan `ffprobe` (jika tersedia) pada file sementara bernama UUID acak, lalu menghapus file secara mutlak di blok `finally`.
   - **Turun Anggun:** Jika Perl atau ExifTool tidak tersedia di runtime, server mengembalikan `engine_unavailable` dan aplikasi otomatis turun ke Mode Privat tanpa error.
3. **AI Insight (Opt-in per Laporan — Server-Side Gemini)**
   - Memanggil Gemini (`gemini-4-hydrogen`) melalui `POST /api/ai-insight` di sisi server saja.
   - Pengguna melihat pratinjau JSON tersaring (tanpa isi file, thumbnail, cover art, atau hex) sebelum mengirim.
   - AI hanya menjelaskan isi JSON laporan, mengutip sumber field/id, dan menjawab `"tidak ada di laporan"` jika data tidak ada.

## Format yang Didukung

| Keluarga | Format | Kemampuan Analisis |
| --- | --- | --- |
| Video | MP4, MOV, M4V, 3GP | Walker box kustom, `ftyp`, `mvhd`/`tkhd`/`mdhd`/`elst`, tabel sampel (`stsz`/`stss`/`stco`/`co64`/`stts`/`ctts`), `hvcC`/`avcC`, NAL sampel pertama, SEI `user_data_unregistered`, statistik bitrate & GOP, QuickTime Keys, faststart, peta cakupan byte |
| Gambar | JPEG, PNG, WebP, GIF, TIFF, HEIC/AVIF | Segmen JPEG (APPn, DQT + estimasi kualitas, SOF, SOS→EOI, data sisa), chunk PNG + verifikasi CRC32 + `tEXt`/`zTXt`/`iTXt`, EXIF/GPS/IPTC/XMP/ICC via `exifr`, perbandingan rasio thumbnail, peta cakupan byte |
| Dokumen | PDF, DOCX, XLSX, PPTX, ODT/ODS/ODP, EPUB | Info dict, XMP, penghitung revisi `%%EOF`, deteksi JavaScript/tanda tangan/font, `docProps/core.xml` & `app.xml`, komentar, track changes (`w:ins`/`w:del`), sheet tersembunyi, tautan eksternal, makro (`vbaProject.bin`) |
| Audio | MP3, M4A/AAC, FLAC, OGG/Opus, WAV, AIFF | ID3v1/v2, Vorbis comment, cover art (pratinjau & unduh), ReplayGain, spesifikasi stream |
| Arsip | ZIP, TAR, GZ | Daftar entri, ukuran, timestamp, komentar, Central Directory, peta cakupan byte |
| Provenance | C2PA / Content Credentials | Muat malas `@contentauth/c2pa-web`, deteksi XMP `DigitalSourceType`, parameter generator PNG |
| Universal | Format apa pun | Magic bytes, cek kesesuaian ekstensi, hash streaming MD5/SHA-1/SHA-256, Hex Viewer tervirtualisasi, ekstraksi Strings, grafik entropi Shannon |

## Cara Menjalankan

```bash
npm install
npm run dev      # Menjalankan server pengembangan di http://localhost:3000
npm test         # Menjalankan unit test, golden test MP4/gambar/dokumen, dan fuzzing
npm run lint     # Pemeriksaan ESLint
npm run build    # Build produksi Next.js
```

## Cara Menambah Aturan atau Analyzer Baru

- **Menambah aturan cross-check**: tambahkan satu objek `CrossCheckRule` di `/src/rules/checks.ts` tanpa menyentuh parser.
- **Menambah aturan inferensi**: tambahkan satu objek `InferenceRule` (dengan label `confidence`: `'pasti' | 'kuat' | 'heuristik'`, teks ID/EN, dan `evidenceLinks`) di `/src/rules/inferences.ts`.
- **Menambah bobot privasi**: perbarui `PRIVACY_WEIGHTS` dan fungsi evaluasi di `/src/rules/privacy.ts`.
- **Menambah analyzer format baru**: buat fungsi murni `(file: Blob) => Promise<...>` di `/src/engine/` dan daftarkan di `/src/engine/orchestrator.ts`.

## Batasan

- Laporan MetaScope bersifat informatif; metadata dapat diedit atau dihapus dan laporan **bukan bukti hukum**.
- MakerNote kamera RAW mendalam memerlukan Mode Mendalam (ExifTool sisi server).
