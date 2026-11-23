'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eraser,
  FileCheck2,
  FileSearch,
  FileText,
  FileUp,
  Film,
  Info,
  Loader2,
  Lock,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  buildSampleAiPng,
  buildSampleDocx,
  buildSampleGpsJpeg,
  buildSampleMp4,
  buildSamplePdf,
} from '../engine/samples';
import {
  DEFAULT_STRIP_OPTIONS,
  stripFileMetadata,
  type StripOptions,
  type StripResult,
} from '../engine/stripper';
import type { Locale, Report } from '../engine/types';
import { formatBytes, formatNumber, type Translations } from '../i18n/translations';
import { runPrivateAnalysisInWorker } from '../workers/workerClient';

interface RemoverViewProps {
  locale: Locale;
  t: Translations;
  initialFile?: { blob: Blob; name: string } | null;
  onConsumeInitialFile?: () => void;
  onInspectCleaned: (report: Report, blob: Blob) => void;
  onCompressCleaned?: (blob: Blob, filename: string) => void;
}

interface CleanSession {
  sourceBlob: Blob;
  sourceName: string;
  stripResult: StripResult;
  beforeReport: Report;
  afterReport: Report;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function scoreColor(score: number): string {
  if (score >= 50) return 'text-rose-600 dark:text-rose-400';
  if (score >= 20) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export default function RemoverView({
  locale,
  t,
  initialFile,
  onConsumeInitialFile,
  onInspectCleaned,
  onCompressCleaned,
}: RemoverViewProps) {
  const [options, setOptions] = useState<StripOptions>(DEFAULT_STRIP_OPTIONS);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [session, setSession] = useState<CleanSession | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const consumedInitialRef = useRef<Blob | null>(null);

  const runClean = useCallback(
    async (blob: Blob, name: string, activeOptions: StripOptions) => {
      setErrorMsg(null);
      setProcessing(name);
      try {
        const beforeHandle = runPrivateAnalysisInWorker(blob, name);
        const [beforeReport, stripResult] = await Promise.all([
          beforeHandle.promise,
          stripFileMetadata(blob, name, activeOptions),
        ]);

        let afterReport = beforeReport;
        if (stripResult.supported) {
          const afterHandle = runPrivateAnalysisInWorker(stripResult.cleanedBlob, stripResult.cleanedFilename);
          afterReport = await afterHandle.promise;
        }

        setSession({
          sourceBlob: blob,
          sourceName: name,
          stripResult,
          beforeReport,
          afterReport,
        });
      } catch (err) {
        setErrorMsg((err as Error)?.message || (locale === 'id' ? 'Gagal membersihkan metadata file.' : 'Failed to strip file metadata.'));
      } finally {
        setProcessing(null);
      }
    },
    [locale],
  );

  // Auto-clean when user clicked "Bersihkan metadata" from an open ReportView
  useEffect(() => {
    if (initialFile && consumedInitialRef.current !== initialFile.blob) {
      consumedInitialRef.current = initialFile.blob;
      onConsumeInitialFile?.();
      void runClean(initialFile.blob, initialFile.name, options);
    }
  }, [initialFile, onConsumeInitialFile, options, runClean]);

  // Clipboard paste support (Ctrl+V) for instant image metadata cleaning
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            void runClean(f, f.name || `clipboard_${Date.now()}.png`, options);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [options, runClean]);

  const handleToggleOption = (key: keyof StripOptions) => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
    if (session) {
      void runClean(session.sourceBlob, session.sourceName, next);
    }
  };

  const handleCopySha256 = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const quickSamples = [
    {
      id: 'gps',
      label: locale === 'id' ? 'Foto JPEG berGPS + Data Sisa' : 'GPS JPEG + Trailing Data',
      icon: MapPin,
      run: () => {
        const s = buildSampleGpsJpeg(true);
        void runClean(new Blob([s.bytes as unknown as BlobPart], { type: s.mime }), s.name, options);
      },
    },
    {
      id: 'png',
      label: locale === 'id' ? 'PNG Generator AI' : 'AI Generator PNG',
      icon: Sparkles,
      run: () => {
        const s = buildSampleAiPng(false);
        void runClean(new Blob([s.bytes as unknown as BlobPart], { type: s.mime }), s.name, options);
      },
    },
    {
      id: 'docx',
      label: locale === 'id' ? 'DOCX Komentar + Makro' : 'DOCX Comments + Macro',
      icon: FileCheck2,
      run: () => {
        const s = buildSampleDocx();
        void runClean(new Blob([s.bytes as unknown as BlobPart], { type: s.mime }), s.name, options);
      },
    },
    {
      id: 'mp4',
      label: locale === 'id' ? 'Video MP4 (Tag QuickTime)' : 'MP4 Video (QuickTime Tags)',
      icon: Film,
      run: () => {
        const s = buildSampleMp4();
        void runClean(new Blob([s.bytes as unknown as BlobPart], { type: s.mime }), s.name, options);
      },
    },
    {
      id: 'pdf',
      label: locale === 'id' ? 'PDF Revisi Ganda' : 'Multi-Revision PDF',
      icon: FileText,
      run: () => {
        const s = buildSamplePdf();
        void runClean(new Blob([s.bytes as unknown as BlobPart], { type: s.mime }), s.name, options);
      },
    },
  ];

  const optionItems: Array<{
    key: keyof StripOptions;
    label: string;
    desc: string;
  }> = [
    {
      key: 'preserveColorProfile',
      label: locale === 'id' ? 'Pertahankan profil warna ICC (disarankan)' : 'Preserve ICC color profile (recommended)',
      desc:
        locale === 'id'
          ? 'Menjaga akurasi warna foto pada JPEG, PNG, dan WebP sambil tetap menghapus GPS, EXIF, dan XMP.'
          : 'Keeps photo color accuracy intact on JPEG, PNG, and WebP while still removing GPS, EXIF, and XMP.',
    },
    {
      key: 'stripTrailingData',
      label: locale === 'id' ? 'Hapus data sisa setelah penanda akhir file' : 'Remove trailing bytes after end-of-file marker',
      desc:
        locale === 'id'
          ? 'Membersihkan payload tersembunyi setelah EOI (JPEG) atau IEND (PNG).'
          : 'Removes appended hidden payloads after JPEG EOI or PNG IEND.',
    },
    {
      key: 'zeroTimestamps',
      label: locale === 'id' ? 'Kosongkan timestamp internal kontainer (MP4/MOV)' : 'Zero internal container timestamps (MP4/MOV)',
      desc:
        locale === 'id'
          ? 'Menyetel waktu pembuatan & modifikasi pada atom mvhd, tkhd, dan mdhd ke 0.'
          : 'Resets creation and modification timestamps inside mvhd, tkhd, and mdhd atoms to 0.',
    },
    {
      key: 'stripOfficeCommentsAndMacros',
      label: locale === 'id' ? 'Hapus komentar, revisi terhapus & makro (DOCX/XLSX/PPTX)' : 'Strip comments, deleted revisions & macros (Office)',
      desc:
        locale === 'id'
          ? 'Menghapus komentar internal, riwayat teks terhapus (<w:del>), nama penulis revisi, dan makro VBA.'
          : 'Removes internal comments, deleted tracked text (<w:del>), revision authors, and VBA macros.',
    },
  ];

  const pctSaved =
    session && session.stripResult.originalSize > 0
      ? (session.stripResult.bytesRemoved / session.stripResult.originalSize) * 100
      : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-2">
            <Eraser className="w-4 h-4" aria-hidden="true" />
            <span>{locale === 'id' ? 'Pembersihan Lossless 100% Lokal' : '100% Local Lossless Sanitizer'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.removerTitle}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {t.removerSub}
          </p>
        </div>
        {session && !processing && (
          <button
            type="button"
            onClick={() => {
              setSession(null);
              setErrorMsg(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.removerCleanAnother}</span>
          </button>
        )}
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/40 px-5 py-4 text-sm text-rose-900 dark:text-rose-200"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Processing state */}
      {processing && (
        <div
          role="status"
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-10 text-center shadow-[0_2px_10px_rgba(15,23,42,0.04)] max-w-xl mx-auto space-y-4"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Membersihkan & memverifikasi hasil...' : 'Stripping metadata & verifying output...'}
            </p>
            <p className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400 truncate">{processing}</p>
          </div>
        </div>
      )}

      {/* Upload & Options view when no active result */}
      {!processing && !session && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Dropzone Column */}
          <div className="lg:col-span-7 space-y-5">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void runClean(f, f.name, options);
              }}
              onClick={() => inputRef.current?.click()}
              className={`group rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center transition-all duration-150 cursor-pointer shadow-[0_2px_8px_rgba(15,23,42,0.03)] ${
                dragging
                  ? 'border-emerald-500 bg-emerald-50/70 dark:border-emerald-400 dark:bg-emerald-950/30 scale-[1.005]'
                  : 'border-slate-300/90 dark:border-slate-700 bg-white dark:bg-slate-900/90 hover:border-emerald-400 dark:hover:border-emerald-500/80 hover:bg-emerald-50/20 dark:hover:bg-slate-900'
              }`}
            >
              <div
                className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-150 ${
                  dragging
                    ? 'bg-emerald-600 text-white scale-105'
                    : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 group-hover:scale-105'
                }`}
              >
                <FileUp className="w-6 h-6" aria-hidden="true" />
              </div>

              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
                {locale === 'id' ? 'Jatuhkan file untuk dibersihkan' : 'Drop a file to strip its metadata'}
              </h2>
              <p className="mt-2 mx-auto max-w-md text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {locale === 'id'
                  ? 'Mendukung pembersihan lossless untuk JPEG, PNG, WebP, GIF, MP4/MOV/M4A, DOCX/XLSX/PPTX/ODF, PDF, MP3, dan WAV.'
                  : 'Supports lossless cleaning for JPEG, PNG, WebP, GIF, MP4/MOV/M4A, DOCX/XLSX/PPTX/ODF, PDF, MP3, and WAV.'}
              </p>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                  className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 shadow-xs transition-colors cursor-pointer"
                >
                  {locale === 'id' ? 'Pilih file untuk dibersihkan' : 'Choose file to clean'}
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void runClean(f, f.name, options);
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800/80 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>
                  {locale === 'id'
                    ? 'File dibersihkan langsung di memori browser. Tanpa upload & tanpa kompresi ulang gambar/video.'
                    : 'Cleaned directly in browser memory. Zero uploads & zero image/video re-encoding.'}
                </span>
              </div>
            </div>

            {/* Quick Sample Strip Tests */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {locale === 'id' ? 'Uji cepat dengan berkas contoh' : 'Try instantly with sample files'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {quickSamples.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={s.run}
                      className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3.5 py-2.5 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-emerald-300 dark:hover:border-emerald-600 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition-colors cursor-pointer"
                    >
                      <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                      <span className="truncate">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Options Column */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {locale === 'id' ? 'Opsi Pembersihan' : 'Cleaning Options'}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id'
                  ? 'Sesuaikan bagian apa saja yang ingin dihapus sebelum file diproses.'
                  : 'Customize which metadata layers to strip before processing.'}
              </p>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {optionItems.map((item) => (
                <label key={item.key} className="flex items-start gap-3 py-3.5 first:pt-1 last:pb-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options[item.key]}
                    onChange={() => handleToggleOption(item.key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600 accent-emerald-600 cursor-pointer shrink-0"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 leading-snug">
                      {item.label}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {item.desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results & Verification View */}
      {!processing && session && (
        <div className="space-y-6">
          {/* Unsupported Format Notice */}
          {!session.stripResult.supported ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/30 p-6 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    {locale === 'id'
                      ? `Format ${session.stripResult.format} belum didukung untuk pembersihan otomatis`
                      : `Format ${session.stripResult.format} is not yet supported for automated stripping`}
                  </h2>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {session.stripResult.unsupportedReason}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Success Action Header Card */}
              <section className="rounded-2xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                      <ShieldCheck className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white break-all">
                        {session.stripResult.cleanedFilename}
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                        {session.stripResult.removedItems.length > 0
                          ? locale === 'id'
                            ? `${session.stripResult.removedItems.length} grup metadata berhasil dibersihkan secara lossless dan terverifikasi ulang.`
                            : `${session.stripResult.removedItems.length} metadata groups were losslessly stripped and re-verified.`
                          : locale === 'id'
                            ? 'File ini sudah bersih — tidak ditemukan metadata sensitif yang perlu dihapus.'
                            : 'This file was already clean — no sensitive metadata blocks required removal.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() =>
                        downloadBlob(session.stripResult.cleanedBlob, session.stripResult.cleanedFilename)
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 min-h-[44px] text-xs sm:text-sm font-semibold text-white hover:bg-emerald-700 shadow-xs transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{t.removerDownload}</span>
                    </button>
                    {onCompressCleaned && session.afterReport.file.detectedFamily === 'video' && (
                      <button
                        type="button"
                        onClick={() =>
                          onCompressCleaned(session.stripResult.cleanedBlob, session.stripResult.cleanedFilename)
                        }
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2.5 min-h-[44px] text-xs sm:text-sm font-semibold text-white hover:bg-sky-700 shadow-xs transition-colors cursor-pointer"
                      >
                        <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{t.compressCurrentVideo}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectCleaned(session.afterReport, session.stripResult.cleanedBlob)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-4 py-2.5 min-h-[44px] text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <FileSearch className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                      <span>{t.removerInspectCleaned}</span>
                    </button>
                  </div>
                </div>

                {/* New SHA-256 verification strip */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">
                      {locale === 'id' ? 'SHA-256 File Bersih: ' : 'Cleaned File SHA-256: '}
                    </span>
                    <span className="font-mono text-slate-800 dark:text-slate-200 break-all">
                      {session.afterReport.file.hashes.sha256}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopySha256(session.afterReport.file.hashes.sha256)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 transition-colors shrink-0 cursor-pointer"
                  >
                    {copiedHash ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        <span className="text-emerald-600 dark:text-emerald-400">{t.copied}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.copy}</span>
                      </>
                    )}
                  </button>
                </div>
              </section>

              {/* 3 Before -> After Proof KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Privacy Score Before -> After */}
                <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.privacyScore}</span>
                  <div className="flex items-center gap-2.5 font-mono tabular-nums">
                    <span className={`text-2xl font-bold ${scoreColor(session.beforeReport.privacy.score)}`}>
                      {session.beforeReport.privacy.score}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    <span className={`text-3xl font-bold ${scoreColor(session.afterReport.privacy.score)}`}>
                      {session.afterReport.privacy.score}
                    </span>
                    <span className="text-xs text-slate-400">/ 100</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {session.afterReport.privacy.score === 0
                      ? locale === 'id'
                        ? 'Aman dibagikan — tidak ada sinyal risiko privasi tersisa'
                        : 'Safe to share — zero privacy risk signals remaining'
                      : locale === 'id'
                        ? `Turun ${Math.max(0, session.beforeReport.privacy.score - session.afterReport.privacy.score)} poin risiko`
                        : `Reduced by ${Math.max(0, session.beforeReport.privacy.score - session.afterReport.privacy.score)} risk points`}
                  </p>
                </div>

                {/* Metadata Tags Before -> After */}
                <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {locale === 'id' ? 'Jumlah Tag Metadata' : 'Metadata Tag Count'}
                  </span>
                  <div className="flex items-center gap-2.5 font-mono tabular-nums">
                    <span className="text-2xl font-bold text-slate-500 dark:text-slate-400">
                      {session.beforeReport.tags.length}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    <span className="text-3xl font-bold text-slate-900 dark:text-white">
                      {session.afterReport.tags.length}
                    </span>
                    <span className="text-xs font-sans text-slate-500">tag</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {locale === 'id'
                      ? `${Math.max(0, session.beforeReport.tags.length - session.afterReport.tags.length)} tag metadata berhasil dihapus`
                      : `${Math.max(0, session.beforeReport.tags.length - session.afterReport.tags.length)} metadata tags stripped`}
                  </p>
                </div>

                {/* File Size Reduction */}
                <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {locale === 'id' ? 'Pengurangan Ukuran File' : 'File Size Reduction'}
                  </span>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {session.stripResult.bytesRemoved > 0
                      ? `-${formatNumber(pctSaved, locale, 1)}%`
                      : '0%'}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                    {formatBytes(session.stripResult.originalSize, locale)} → {formatBytes(session.stripResult.cleanedSize, locale)}
                  </p>
                </div>
              </div>

              {/* Detailed Breakdown: Removed vs Kept */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <section className="lg:col-span-7 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {locale === 'id' ? 'Metadata & Lapisan yang Dihapus' : 'Stripped Metadata & Layers'}
                  </h3>
                  {session.stripResult.removedItems.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {locale === 'id'
                        ? 'Tidak ada blok metadata tambahan yang ditemukan pada file asli.'
                        : 'No removable metadata blocks were found in the original file.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {session.stripResult.removedItems.map((item, idx) => (
                        <li key={idx} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                                {item.category}
                              </span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="font-semibold text-slate-900 dark:text-white">{item.label}</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 break-words">{item.detail}</p>
                          </div>
                          {typeof item.bytesSaved === 'number' && item.bytesSaved > 0 && (
                            <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                              -{formatNumber(item.bytesSaved, locale, 0)} B
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className="lg:col-span-5 space-y-5">
                  <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      {locale === 'id' ? 'Dipertahankan Secara Lossless' : 'Preserved Losslessly'}
                    </h3>
                    <ul className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
                      {session.stripResult.keptItems.map((k, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                          <span className="leading-relaxed">{k}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {session.stripResult.notes.length > 0 && (
                    <section className="rounded-2xl border border-sky-200/80 dark:border-sky-800/60 bg-sky-50/50 dark:bg-sky-950/20 p-5 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                        <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{locale === 'id' ? 'Catatan Transparansi Teknis' : 'Technical Transparency Note'}</span>
                      </div>
                      {session.stripResult.notes.map((n, idx) => (
                        <p key={idx} className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          {n}
                        </p>
                      ))}
                    </section>
                  )}

                  {/* Live Option Tweaks */}
                  <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {locale === 'id' ? 'Ubah Opsi & Proses Ulang' : 'Adjust Options & Re-clean'}
                    </h3>
                    <div className="space-y-2.5">
                      {optionItems.map((item) => (
                        <label key={item.key} className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={options[item.key]}
                            onChange={() => handleToggleOption(item.key)}
                            className="h-3.5 w-3.5 rounded accent-emerald-600 cursor-pointer shrink-0"
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
