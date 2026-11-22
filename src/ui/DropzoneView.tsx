'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Clipboard,
  FileCheck2,
  FileText,
  FileUp,
  Film,
  Image as ImageIcon,
  Lock,
  MapPin,
  Server,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { BUILTIN_SAMPLES } from '../engine/samples';
import type { AnalysisMode, Locale } from '../engine/types';
import type { Translations } from '../i18n/translations';

interface DropzoneViewProps {
  mode: AnalysisMode;
  onModeChange: (m: AnalysisMode) => void;
  onSelectFile: (file: Blob, filename: string) => void;
  locale: Locale;
  t: Translations;
}

const SAMPLE_META: Record<
  string,
  {
    icon: typeof Film;
    descId: string;
    descEn: string;
  }
> = {
  mp4_hevc: {
    icon: Film,
    descId: 'Uji codec HEVC, jejak encoder ByteVC1/Lavf, dan faststart.',
    descEn: 'Inspect HEVC config, ByteVC1/Lavf signatures, and faststart.',
  },
  jpg_gps: {
    icon: MapPin,
    descId: 'Deteksi lokasi GPS Monas, selisih thumbnail, dan 64 byte data sisa.',
    descEn: 'Detect Monas GPS coordinates, thumbnail mismatch, and trailing bytes.',
  },
  jpg_clean: {
    icon: ImageIcon,
    descId: 'Foto bersih tanpa EXIF/GPS — ideal untuk pembanding privasi.',
    descEn: 'Clean photo stripped of EXIF/GPS — ideal for privacy comparison.',
  },
  png_ai: {
    icon: Sparkles,
    descId: 'Uji chunk teks PNG, CRC32, dan penanda parameter generator AI.',
    descEn: 'Inspect PNG text chunks, CRC32 validation, and AI prompt markers.',
  },
  docx_review: {
    icon: FileCheck2,
    descId: 'Ungkap komentar tersembunyi, track changes, dan makro VBA.',
    descEn: 'Reveal hidden review comments, tracked changes, and VBA macros.',
  },
  pdf_rev: {
    icon: FileText,
    descId: 'Hitung revisi inkremental %%EOF, XMP, dan objek berisiko PDF.',
    descEn: 'Count incremental %%EOF updates, XMP metadata, and PDF objects.',
  },
};

export default function DropzoneView({ mode, onModeChange, onSelectFile, locale, t }: DropzoneViewProps) {
  const [dragging, setDragging] = useState(false);
  const [showDeepConsent, setShowDeepConsent] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Clipboard image paste support (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            onSelectFile(f, f.name || `clipboard_${Date.now()}.png`);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [onSelectFile]);

  const handleModeClick = (next: AnalysisMode) => {
    if (next === 'mendalam' && mode !== 'mendalam') {
      setShowDeepConsent(true);
    } else {
      onModeChange(next);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onSelectFile(f, f.name);
  };

  return (
    <div className="space-y-10">
      {/* Welcoming, Clear Hero Header */}
      <section className="max-w-3xl mx-auto text-center space-y-4">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white [text-wrap:balance]">
          {locale === 'id'
            ? 'Lihat apa yang tersembunyi di dalam file Anda'
            : 'See everything hidden inside your files'}
        </h1>
        <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl mx-auto">
          {locale === 'id'
            ? 'Periksa metadata kamera, lokasi GPS, riwayat edit, struktur kontainer, hingga lapisan byte secara instan dan mudah dipahami.'
            : 'Inspect camera metadata, GPS coordinates, edit history, container structure, and raw bytes — clear, fast, and private.'}
        </p>

        {/* Compact, Friendly Segmented Mode Switch */}
        <div className="pt-2 flex flex-col items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Analysis execution mode"
            className="inline-flex items-center gap-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/80 p-1"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'privat'}
              onClick={() => handleModeClick('privat')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                mode === 'privat'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>{t.modePrivate}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'mendalam'}
              onClick={() => handleModeClick('mendalam')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                mode === 'mendalam'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
              <span>{t.modeDeep}</span>
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg">
            {mode === 'privat' ? t.modePrivateDesc : t.modeDeepDesc}
          </p>
        </div>
      </section>

      {/* Primary Focal Anchor: Clickable & Drag-and-Drop Dropzone */}
      <section className="max-w-4xl mx-auto">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`group rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-all duration-150 cursor-pointer shadow-[0_2px_8px_rgba(15,23,42,0.03)] ${
            dragging
              ? 'border-sky-500 bg-sky-50/70 dark:border-sky-400 dark:bg-sky-950/30 scale-[1.005]'
              : 'border-slate-300/90 dark:border-slate-700 bg-white dark:bg-slate-900/90 hover:border-sky-400 dark:hover:border-sky-500/80 hover:bg-sky-50/20 dark:hover:bg-slate-900'
          }`}
        >
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-150 ${
              dragging
                ? 'bg-sky-600 text-white scale-105'
                : 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 group-hover:scale-105'
            }`}
          >
            <FileUp className="w-6 h-6" aria-hidden="true" />
          </div>

          <h2 className="mt-4 text-lg sm:text-xl font-semibold text-slate-900 dark:text-white">
            {dragging
              ? locale === 'id'
                ? 'Lepaskan file untuk mulai membedah'
                : 'Release file to start inspection'
              : t.dropzoneTitle}
          </h2>
          <p className="mt-2 mx-auto max-w-xl text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {t.dropzoneSub}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              className="rounded-xl bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 shadow-xs transition-colors cursor-pointer"
            >
              {t.dropzoneSelect}
            </button>
            <input
              ref={inputRef}
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSelectFile(f, f.name);
                e.target.value = '';
              }}
            />
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                {mode === 'privat'
                  ? t.privacyGuarantee
                  : locale === 'id'
                    ? 'Mode Mendalam: file dihapus otomatis setelah diproses'
                    : 'Deep Mode: files are deleted immediately after processing'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clipboard className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              <span>{t.dropzonePasteHint}</span>
            </span>
          </div>
        </div>
      </section>

      {/* Friendly Quick-Test Sample Grid */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">{t.samplesHeading}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.samplesHint}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {BUILTIN_SAMPLES.map((s) => {
            const meta = SAMPLE_META[s.id];
            const Icon = meta?.icon ?? FileText;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  const built = s.build();
                  onSelectFile(new Blob([built.bytes as unknown as BlobPart], { type: built.mime }), built.name);
                }}
                className="group text-left rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-sky-400/90 dark:hover:border-sky-500/70 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] transition-all duration-150 cursor-pointer flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-sky-600 dark:text-sky-400 group-hover:bg-sky-50 dark:group-hover:bg-sky-950/60 transition-colors shrink-0">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">{s.badge}</span>
                  </div>
                  <ArrowUpRight
                    className="w-4 h-4 text-slate-400 group-hover:text-sky-600 dark:group-hover:text-sky-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform shrink-0"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                    {locale === 'en' ? s.labelEn : s.labelId}
                  </div>
                  {meta && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {locale === 'en' ? meta.descEn : meta.descId}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Clean Unboxed 3-Step Friendly Guide (Whitespace & Hairline Divider, Zero Card Clutter) */}
      <section className="pt-8 border-t border-slate-200/80 dark:border-slate-800/80">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="space-y-1.5">
            <p className="text-xs font-mono font-semibold text-sky-600 dark:text-sky-400">01</p>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Jatuhkan file apa saja' : 'Drop any file instantly'}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {locale === 'id'
                ? 'Deteksi format otomatis dari magic bytes — bahkan jika ekstensi file sempat diubah.'
                : 'Automatic format detection from magic bytes — even if a file extension was renamed.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-mono font-semibold text-sky-600 dark:text-sky-400">02</p>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Pahami risiko privasi & temuan' : 'Read clear privacy & findings'}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {locale === 'id'
                ? 'Setiap temuan dipisahkan jelas antara fakta pasti dan perkiraan, lengkap dengan tautan bukti.'
                : 'Every finding separates verified facts from heuristics, complete with one-click evidence links.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-mono font-semibold text-sky-600 dark:text-sky-400">03</p>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Bandingkan, batch, atau ekspor' : 'Compare, batch, or export'}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {locale === 'id'
                ? 'Unduh laporan JSON/HTML/PDF offline, bandingkan foto sebelum-sesudah, atau periksa folder sekaligus.'
                : 'Export offline JSON/HTML/PDF reports, diff two files side by side, or inspect entire folders.'}
            </p>
          </div>
        </div>
      </section>

      {/* Deep Mode Consent Dialog */}
      {showDeepConsent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deep-consent-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shrink-0">
                  <Server className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 id="deep-consent-title" className="text-base font-semibold text-slate-900 dark:text-white">
                  {t.deepConsentTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDeepConsent(false)}
                aria-label={t.deepConsentCancel}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{t.deepConsentBody}</p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowDeepConsent(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {t.deepConsentCancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeepConsent(false);
                  onModeChange('mendalam');
                }}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 transition-colors cursor-pointer"
              >
                {t.deepConsentAccept}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
