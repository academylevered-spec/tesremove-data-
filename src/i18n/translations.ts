import type { Confidence, Locale, Severity, CheckStatus } from '../engine/types';

export interface Translations {
  appName: string;
  tagline: string;
  navAnalyze: string;
  navRemover: string;
  navCompare: string;
  navBatch: string;
  navHistory: string;
  newFile: string;
  dropzoneTitle: string;
  dropzoneSub: string;
  dropzoneSelect: string;
  dropzonePasteHint: string;
  privacyGuarantee: string;
  modePrivate: string;
  modePrivateDesc: string;
  modeDeep: string;
  modeDeepDesc: string;
  deepConsentTitle: string;
  deepConsentBody: string;
  deepConsentAccept: string;
  deepConsentCancel: string;
  samplesHeading: string;
  samplesHint: string;
  tabSummary: string;
  tabTags: string;
  tabStructure: string;
  tabTechnical: string;
  tabTimeline: string;
  tabProvenance: string;
  tabIntegrity: string;
  tabHex: string;
  tabJson: string;
  privacyScore: string;
  howScoreCalculated: string;
  crossChecks: string;
  checksPassedOf: (passed: number, total: number) => string;
  topFindings: string;
  viewEvidence: string;
  exportMenu: string;
  exportJson: string;
  exportCsv: string;
  exportMarkdown: string;
  exportHtml: string;
  exportPrintPdf: string;
  aiExplainBtn: string;
  aiPreviewTitle: string;
  aiPreviewDesc: string;
  aiSendConfirm: string;
  aiCancel: string;
  aiAskPlaceholder: string;
  aiAskBtn: string;
  aiSummaryTitle: string;
  aiRetry: string;
  searchTagsPlaceholder: string;
  allNamespaces: string;
  colTagName: string;
  colRawValue: string;
  colDecodedValue: string;
  colSource: string;
  colOffset: string;
  copied: string;
  copy: string;
  copyTechDetails: string;
  byteCoverage: string;
  explainedBytes: string;
  unexplainedBytes: string;
  unmappedCoverage: string;
  jumpToOffset: string;
  goBtn: string;
  stringsTab: string;
  hexTab: string;
  entropyTab: string;
  minStringLen: string;
  exportStrings: string;
  showOnMap: string;
  mapPrivacyNotice: string;
  noLocation: string;
  noC2pa: string;
  aiAbsenceDisclaimer: string;
  legalDisclaimer: string;
  deepAnalysisUnavailable: string;
  analyzingProgress: string;
  cancelBtn: string;
  retryFailed: string;
  clearHistory: string;
  emptyHistory: string;
  compareTitle: string;
  compareSub: string;
  compareSlotA: string;
  compareSlotB: string;
  compareRun: string;
  batchTitle: string;
  batchSub: string;
  batchExportCsv: string;
  batchExportZip: string;
  analyzersCompleted: (done: number, total: number, failed: number) => string;
  extensionMismatchBanner: string;
  discrepancyLabel: string;
  zeroedLabel: string;
  confidenceLabels: Record<Confidence, string>;
  severityLabels: Record<Severity, string>;
  checkStatusLabels: Record<CheckStatus, string>;
  themeLight: string;
  themeDark: string;
  removerTitle: string;
  removerSub: string;
  removerAction: string;
  removerDownload: string;
  removerInspectCleaned: string;
  removerCleanAnother: string;
  removerCleanCurrent: string;
}

const id: Translations = {
  appName: 'MetaScope',
  tagline: 'Bongkar metadata, struktur kontainer, bitstream, dan sinyal privasi hingga lapisan byte.',
  navAnalyze: 'Analisis',
  navRemover: 'Bersihkan',
  navCompare: 'Bandingkan',
  navBatch: 'Batch',
  navHistory: 'Riwayat',
  newFile: 'File baru',
  dropzoneTitle: 'Jatuhkan file di sini atau pilih dari perangkat',
  dropzoneSub: 'Mendukung MP4/MOV, JPEG, PNG, WebP, GIF, TIFF, HEIC/AVIF, PDF, DOCX/XLSX/PPTX/ODF/EPUB, MP3/FLAC/WAV/OGG/M4A, dan ZIP/TAR/GZ.',
  dropzoneSelect: 'Pilih file',
  dropzonePasteHint: 'Anda juga dapat menempel gambar langsung dari clipboard (Ctrl+V).',
  privacyGuarantee: 'File diproses di perangkat Anda dan tidak diunggah.',
  modePrivate: 'Privat (Browser)',
  modePrivateDesc: '100% lokal di browser melalui Web Worker. Tidak ada data file yang meninggalkan perangkat.',
  modeDeep: 'Mendalam (Server)',
  modeDeepDesc: 'Menjalankan ExifTool & ffprobe sementara di server untuk MakerNote & stream mendalam, lalu menghapus file segera.',
  deepConsentTitle: 'Konfirmasi Mode Mendalam',
  deepConsentBody:
    'File Anda akan dikirim sementara ke server MetaScope untuk diproses oleh ExifTool dan ffprobe, lalu segera dihapus dari disk setelah analisis selesai. Hasil tidak disimpan di server (sesi maksimal 60 menit). Lanjutkan?',
  deepConsentAccept: 'Saya mengerti, aktifkan Mode Mendalam',
  deepConsentCancel: 'Tetap di Mode Privat',
  samplesHeading: 'Atau uji cepat dengan berkas contoh sintetis',
  samplesHint: 'Dibuat secara lokal di browser untuk verifikasi fitur tanpa mengunggah file pribadi.',
  tabSummary: 'Ringkasan',
  tabTags: 'Semua tag',
  tabStructure: 'Struktur',
  tabTechnical: 'Teknis',
  tabTimeline: 'Waktu & Lokasi',
  tabProvenance: 'Provenance',
  tabIntegrity: 'Integritas',
  tabHex: 'Hex & Strings',
  tabJson: 'JSON',
  privacyScore: 'Skor Risiko Privasi',
  howScoreCalculated: 'Bagaimana skor dihitung?',
  crossChecks: 'Cross-Check Integritas',
  checksPassedOf: (p, t) => `${p} dari ${t} lolos`,
  topFindings: 'Temuan Utama',
  viewEvidence: 'Lihat bukti',
  exportMenu: 'Ekspor',
  exportJson: 'Unduh JSON',
  exportCsv: 'Unduh CSV Tag',
  exportMarkdown: 'Unduh Markdown',
  exportHtml: 'Unduh HTML Mandiri',
  exportPrintPdf: 'Cetak / Simpan PDF',
  aiExplainBtn: 'Jelaskan dengan AI',
  aiPreviewTitle: 'Pratinjau Data untuk AI Insight',
  aiPreviewDesc:
    'Hanya JSON laporan yang disaring di bawah ini yang akan dikirim ke server Gemini. Isi file asli, thumbnail, cover art, dan hex TIDAK disertakan.',
  aiSendConfirm: 'Kirim & Jelaskan',
  aiCancel: 'Batal',
  aiAskPlaceholder: 'Tanyakan sesuatu tentang laporan metadata ini...',
  aiAskBtn: 'Tanya',
  aiSummaryTitle: 'Penjelasan AI Insight',
  aiRetry: 'Coba lagi',
  searchTagsPlaceholder: 'Cari nama tag, nilai, atau sumber...',
  allNamespaces: 'Semua namespace',
  colTagName: 'Nama Tag',
  colRawValue: 'Nilai Mentah',
  colDecodedValue: 'Terdekode',
  colSource: 'Sumber',
  colOffset: 'Offset',
  copied: 'Tersalin',
  copy: 'Salin',
  copyTechDetails: 'Salin detail teknis',
  byteCoverage: 'Peta Cakupan Byte',
  explainedBytes: 'Byte terjelaskan',
  unexplainedBytes: 'Byte tak terjelaskan',
  unmappedCoverage: 'Belum dipetakan (format belum memiliki walker struktur lengkap).',
  jumpToOffset: 'Lompat ke offset (desimal atau 0x hex)',
  goBtn: 'Lompat',
  stringsTab: 'Strings',
  hexTab: 'Hex Viewer',
  entropyTab: 'Entropi Byte',
  minStringLen: 'Panjang minimum',
  exportStrings: 'Unduh Strings (.txt)',
  showOnMap: 'Tampilkan di peta',
  mapPrivacyNotice:
    'Peta tidak dimuat otomatis demi privasi Anda. Memuat tile OpenStreetMap akan menyingkap koordinat area ini ke penyedia tile peta.',
  noLocation: 'Tidak ditemukan koordinat GPS di dalam metadata file ini.',
  noC2pa: 'Tidak ada Content Credentials (C2PA) yang ditemukan pada file ini.',
  aiAbsenceDisclaimer:
    'Catatan: Ketiadaan penanda AI atau C2PA BUKAN bukti bahwa konten dibuat tanpa AI — metadata dapat dihapus oleh platform atau perangkat lunak.',
  legalDisclaimer: 'Metadata dapat diedit atau dihapus; laporan ini bukan bukti hukum.',
  deepAnalysisUnavailable: 'Analisis mendalam belum tersedia untuk format ini. Informasi dasar (L0) dan pratinjau hex tetap ditampilkan.',
  analyzingProgress: 'Menganalisis file per potongan...',
  cancelBtn: 'Batalkan',
  retryFailed: 'Ulangi yang gagal',
  clearHistory: 'Hapus semua riwayat',
  emptyHistory: 'Belum ada riwayat analisis lokal di browser ini.',
  compareTitle: 'Bandingkan Dua File',
  compareSub: 'Lihat perbedaan tag (tambah, hapus, ubah), struktur internal, hash, dan skor privasi secara berdampingan.',
  compareSlotA: 'File A (Sebelum / Asli)',
  compareSlotB: 'File B (Sesudah / Pembanding)',
  compareRun: 'Bandingkan sekarang',
  batchTitle: 'Analisis Batch',
  batchSub: 'Analisis banyak file sekaligus lewat antrean pekerja paralel tanpa membekukan antarmuka.',
  batchExportCsv: 'Ekspor CSV Ringkasan',
  batchExportZip: 'Ekspor ZIP (Semua JSON)',
  analyzersCompleted: (done, total, failed) =>
    failed > 0 ? `${done} dari ${total} analyzer selesai, ${failed} gagal` : `${done} dari ${total} analyzer selesai`,
  extensionMismatchBanner: 'Peringatan: Isi file (magic bytes) tidak sesuai dengan ekstensi nama file.',
  discrepancyLabel: 'Selisih',
  zeroedLabel: 'dikosongkan',
  confidenceLabels: {
    pasti: 'Pasti',
    kuat: 'Kuat',
    heuristik: 'Heuristik',
  },
  severityLabels: {
    kritis: 'Kritis',
    tinggi: 'Tinggi',
    sedang: 'Sedang',
    rendah: 'Rendah',
    info: 'Info',
  },
  checkStatusLabels: {
    lolos: 'Lolos',
    gagal: 'Gagal',
    tidak_berlaku: 'Tidak berlaku',
  },
  themeLight: 'Mode Terang',
  themeDark: 'Mode Gelap',
  removerTitle: 'Pembersih Metadata',
  removerSub: 'Hapus lokasi GPS, info kamera, nama penulis, komentar tersembunyi, dan data sisa secara lossless — 100% di browser tanpa mengunggah file.',
  removerAction: 'Bersihkan metadata sekarang',
  removerDownload: 'Unduh file bersih',
  removerInspectCleaned: 'Inspeksi file bersih di MetaScope',
  removerCleanAnother: 'Bersihkan file lain',
  removerCleanCurrent: 'Bersihkan metadata',
};

const en: Translations = {
  appName: 'MetaScope',
  tagline: 'Inspect file metadata, container structure, bitstreams, and privacy signals down to the byte layer.',
  navAnalyze: 'Analyze',
  navRemover: 'Clean',
  navCompare: 'Compare',
  navBatch: 'Batch',
  navHistory: 'History',
  newFile: 'New file',
  dropzoneTitle: 'Drop a file here or browse your device',
  dropzoneSub: 'Supports MP4/MOV, JPEG, PNG, WebP, GIF, TIFF, HEIC/AVIF, PDF, DOCX/XLSX/PPTX/ODF/EPUB, MP3/FLAC/WAV/OGG/M4A, and ZIP/TAR/GZ.',
  dropzoneSelect: 'Choose file',
  dropzonePasteHint: 'You can also paste an image directly from the clipboard (Ctrl+V).',
  privacyGuarantee: 'Files are processed locally on your device and never uploaded.',
  modePrivate: 'Private (Browser)',
  modePrivateDesc: '100% local in your browser via Web Worker. No file bytes leave your device.',
  modeDeep: 'Deep (Server)',
  modeDeepDesc: 'Temporarily runs ExifTool & ffprobe on the server for MakerNote & deep streams, then deletes the file immediately.',
  deepConsentTitle: 'Confirm Deep Analysis Mode',
  deepConsentBody:
    'Your file will be temporarily sent to the MetaScope server for ExifTool and ffprobe inspection, then immediately deleted from disk once processing finishes. Results are not persisted on the server (max 60 min session). Continue?',
  deepConsentAccept: 'I understand, enable Deep Mode',
  deepConsentCancel: 'Stay in Private Mode',
  samplesHeading: 'Or test immediately with synthetic sample files',
  samplesHint: 'Generated locally in your browser to verify analyzers without uploading private files.',
  tabSummary: 'Summary',
  tabTags: 'All tags',
  tabStructure: 'Structure',
  tabTechnical: 'Technical',
  tabTimeline: 'Time & Location',
  tabProvenance: 'Provenance',
  tabIntegrity: 'Integrity',
  tabHex: 'Hex & Strings',
  tabJson: 'JSON',
  privacyScore: 'Privacy Risk Score',
  howScoreCalculated: 'How is this calculated?',
  crossChecks: 'Integrity Cross-Checks',
  checksPassedOf: (p, t) => `${p} of ${t} passed`,
  topFindings: 'Key Findings',
  viewEvidence: 'View evidence',
  exportMenu: 'Export',
  exportJson: 'Download JSON',
  exportCsv: 'Download Tags CSV',
  exportMarkdown: 'Download Markdown',
  exportHtml: 'Download Standalone HTML',
  exportPrintPdf: 'Print / Save PDF',
  aiExplainBtn: 'Explain with AI',
  aiPreviewTitle: 'Preview Data Sent to AI Insight',
  aiPreviewDesc:
    'Only the sanitized JSON report below will be sent to the server Gemini endpoint. Raw file bytes, thumbnails, cover art, and hex are NOT included.',
  aiSendConfirm: 'Send & Explain',
  aiCancel: 'Cancel',
  aiAskPlaceholder: 'Ask a question about this metadata report...',
  aiAskBtn: 'Ask',
  aiSummaryTitle: 'AI Insight Explanation',
  aiRetry: 'Retry',
  searchTagsPlaceholder: 'Search tag name, value, or source...',
  allNamespaces: 'All namespaces',
  colTagName: 'Tag Name',
  colRawValue: 'Raw Value',
  colDecodedValue: 'Decoded',
  colSource: 'Source',
  colOffset: 'Offset',
  copied: 'Copied',
  copy: 'Copy',
  copyTechDetails: 'Copy technical details',
  byteCoverage: 'Byte Coverage Map',
  explainedBytes: 'Explained bytes',
  unexplainedBytes: 'Unexplained bytes',
  unmappedCoverage: 'Not mapped yet (format does not have a complete structural walker).',
  jumpToOffset: 'Jump to offset (decimal or 0x hex)',
  goBtn: 'Jump',
  stringsTab: 'Strings',
  hexTab: 'Hex Viewer',
  entropyTab: 'Byte Entropy',
  minStringLen: 'Min length',
  exportStrings: 'Download Strings (.txt)',
  showOnMap: 'Show on map',
  mapPrivacyNotice:
    'The map is not loaded automatically to protect your privacy. Loading OpenStreetMap tiles exposes this coordinate area to the map tile provider.',
  noLocation: 'No GPS coordinates were found in this file metadata.',
  noC2pa: 'No Content Credentials (C2PA) manifest was found in this file.',
  aiAbsenceDisclaimer:
    'Note: The absence of AI markers or C2PA is NOT proof that content is non-AI — metadata can be stripped by platforms or tools.',
  legalDisclaimer: 'Metadata can be edited or stripped; this report is not legal evidence.',
  deepAnalysisUnavailable: 'Deep structural analysis is not yet available for this format. Basic file info (L0) and hex preview remain available.',
  analyzingProgress: 'Analyzing file in chunks...',
  cancelBtn: 'Cancel',
  retryFailed: 'Retry failed',
  clearHistory: 'Clear all history',
  emptyHistory: 'No local analysis history stored in this browser yet.',
  compareTitle: 'Compare Two Files',
  compareSub: 'Inspect added, removed, and modified tags, structural differences, hashes, and privacy score changes side by side.',
  compareSlotA: 'File A (Before / Original)',
  compareSlotB: 'File B (After / Comparison)',
  compareRun: 'Compare now',
  batchTitle: 'Batch Analysis',
  batchSub: 'Analyze multiple files via a concurrent worker queue without freezing the interface.',
  batchExportCsv: 'Export Summary CSV',
  batchExportZip: 'Export ZIP (All JSON)',
  analyzersCompleted: (done, total, failed) =>
    failed > 0 ? `${done} of ${total} analyzers finished, ${failed} failed` : `${done} of ${total} analyzers finished`,
  extensionMismatchBanner: 'Warning: File content (magic bytes) does not match its filename extension.',
  discrepancyLabel: 'Discrepancy',
  zeroedLabel: 'cleared (zeroed)',
  confidenceLabels: {
    pasti: 'Certain',
    kuat: 'Strong',
    heuristik: 'Heuristic',
  },
  severityLabels: {
    kritis: 'Critical',
    tinggi: 'High',
    sedang: 'Medium',
    rendah: 'Low',
    info: 'Info',
  },
  checkStatusLabels: {
    lolos: 'Passed',
    gagal: 'Failed',
    tidak_berlaku: 'N/A',
  },
  themeLight: 'Light Mode',
  themeDark: 'Dark Mode',
  removerTitle: 'Metadata Remover',
  removerSub: 'Losslessly strip GPS coordinates, camera info, author names, hidden comments, and trailing bytes — 100% in your browser without uploading.',
  removerAction: 'Strip metadata now',
  removerDownload: 'Download clean file',
  removerInspectCleaned: 'Inspect clean file in MetaScope',
  removerCleanAnother: 'Clean another file',
  removerCleanCurrent: 'Strip metadata',
};

export const translations: Record<Locale, Translations> = { id, en };

export function formatNumber(n: number, locale: Locale, maxFractionDigits = 2): string {
  const tag = locale === 'id' ? 'id-ID' : 'en-US';
  return new Intl.NumberFormat(tag, { maximumFractionDigits: maxFractionDigits }).format(n);
}

export function formatBytes(bytes: number, locale: Locale): string {
  const exact = `${formatNumber(bytes, locale, 0)} byte`;
  if (bytes < 1024) return exact;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let u = 0;
  while (val >= 1024 && u < units.length - 1) {
    val /= 1024;
    u++;
  }
  return `${formatNumber(val, locale, 2)} ${units[u]} (${exact})`;
}

export function formatHexOffset(offset: number): string {
  return `0x${offset.toString(16).toUpperCase().padStart(8, '0')}`;
}
