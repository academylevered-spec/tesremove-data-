'use client';

import { useState } from 'react';
import { ArrowRightLeft, Download, MinusCircle, PenLine, PlusCircle, Upload } from 'lucide-react';
import { compareReports } from '../engine/diff';
import { buildSampleCleanJpeg, buildSampleGpsJpeg } from '../engine/samples';
import type { DiffReport, Locale, Report } from '../engine/types';
import { formatBytes, formatNumber, type Translations } from '../i18n/translations';
import { runPrivateAnalysisInWorker } from '../workers/workerClient';

interface CompareViewProps {
  locale: Locale;
  t: Translations;
}

export default function CompareView({ locale, t }: CompareViewProps) {
  const [reportA, setReportA] = useState<Report | null>(null);
  const [reportB, setReportB] = useState<Report | null>(null);
  const [loadingSlot, setLoadingSlot] = useState<'A' | 'B' | 'pair' | null>(null);
  const [dragSlot, setDragSlot] = useState<'A' | 'B' | null>(null);
  const [diff, setDiff] = useState<DiffReport | null>(null);

  const analyzeIntoSlot = async (slot: 'A' | 'B', file: Blob, name: string) => {
    setLoadingSlot(slot);
    try {
      const handle = runPrivateAnalysisInWorker(file, name);
      const rep = await handle.promise;
      if (slot === 'A') {
        setReportA(rep);
        if (reportB) setDiff(compareReports(rep, reportB));
      } else {
        setReportB(rep);
        if (reportA) setDiff(compareReports(reportA, rep));
      }
    } finally {
      setLoadingSlot(null);
    }
  };

  const loadSamplePair = async () => {
    setLoadingSlot('pair');
    try {
      const orig = buildSampleGpsJpeg(true);
      const clean = buildSampleCleanJpeg();
      const [repA, repB] = await Promise.all([
        runPrivateAnalysisInWorker(new Blob([orig.bytes as unknown as BlobPart], { type: orig.mime }), orig.name).promise,
        runPrivateAnalysisInWorker(new Blob([clean.bytes as unknown as BlobPart], { type: clean.mime }), clean.name).promise,
      ]);
      setReportA(repA);
      setReportB(repB);
      setDiff(compareReports(repA, repB));
    } finally {
      setLoadingSlot(null);
    }
  };

  const exportDiffJson = () => {
    if (!diff) return;
    const blob = new Blob([JSON.stringify(diff, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metascope-diff.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t.compareTitle}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.compareSub}</p>
        </div>
        <button
          type="button"
          onClick={loadSamplePair}
          disabled={loadingSlot !== null}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 min-h-[40px] text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50/30 dark:hover:bg-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowRightLeft className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          {locale === 'id' ? 'Muat contoh: Foto Asli vs Dibersihkan' : 'Load sample: Original vs Stripped Photo'}
        </button>
      </div>

      {/* Two Drag-and-Drop Upload Slots */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['A', 'B'] as const).map((slot) => {
          const rep = slot === 'A' ? reportA : reportB;
          const isDrag = dragSlot === slot;
          return (
            <div
              key={slot}
              onDragOver={(e) => {
                e.preventDefault();
                setDragSlot(slot);
              }}
              onDragLeave={() => setDragSlot(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragSlot(null);
                const f = e.dataTransfer.files?.[0];
                if (f) void analyzeIntoSlot(slot, f, f.name);
              }}
              className={`rounded-2xl border p-5 space-y-3.5 transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
                isDrag
                  ? 'border-sky-500 border-dashed bg-sky-50/60 dark:bg-sky-950/30'
                  : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  {slot === 'A' ? t.compareSlotA : t.compareSlotB}
                </span>
                <label className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.dropzoneSelect}</span>
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) analyzeIntoSlot(slot, f, f.name);
                    }}
                  />
                </label>
              </div>
              {loadingSlot === slot || loadingSlot === 'pair' ? (
                <p className="text-xs text-sky-600 dark:text-sky-400">{t.analyzingProgress}</p>
              ) : rep ? (
                <div className="text-xs space-y-1 font-mono text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="font-sans text-sm font-semibold text-slate-900 dark:text-white">{rep.file.name}</div>
                  <div>
                    {rep.file.detectedType} · {formatBytes(rep.file.size, locale)} · Privasi: {rep.privacy.score}/100
                  </div>
                  <div className="truncate text-slate-400">MD5: {rep.file.hashes.md5}</div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  {locale === 'id'
                    ? 'Jatuhkan file ke kotak ini atau klik Pilih file.'
                    : 'Drop a file into this card or click Choose file.'}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Diff Result */}
      {diff && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {locale === 'id' ? 'Ringkasan Perbedaan' : 'Comparison Summary'}
              </h3>
              <button
                type="button"
                onClick={exportDiffJson}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 min-h-[40px] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                {locale === 'id' ? 'Ekspor Diff JSON' : 'Export Diff JSON'}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm tabular-nums">
              <div>
                <span className="text-xs text-slate-500 block">Hash SHA-256</span>
                <strong className={diff.hashesMatch ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                  {diff.hashesMatch ? (locale === 'id' ? 'Identik' : 'Identical') : locale === 'id' ? 'Berbeda' : 'Different'}
                </strong>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">{locale === 'id' ? 'Selisih Skor Privasi' : 'Privacy Score Delta'}</span>
                <strong className="font-mono">
                  {diff.fileA.privacyScore} → {diff.fileB.privacyScore} ({diff.privacyDelta > 0 ? `+${diff.privacyDelta}` : diff.privacyDelta})
                </strong>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">{locale === 'id' ? 'Tag Dihapus / Ditambah' : 'Tags Removed / Added'}</span>
                <strong className="font-mono">
                  -{diff.tags.removed.length} / +{diff.tags.added.length}
                </strong>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">{locale === 'id' ? 'Tag Diubah' : 'Tags Changed'}</span>
                <strong className="font-mono">{diff.tags.changed.length}</strong>
              </div>
            </div>
          </section>

          {/* Tag Diff Table (uses BOTH color and explicit icons/labels!) */}
          <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {locale === 'id' ? 'Perbedaan Tag' : 'Tag Differences'}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-4 w-28">Status</th>
                    <th className="py-2 px-4">Namespace : Tag</th>
                    <th className="py-2 px-4">File A</th>
                    <th className="py-2 px-4">File B</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                  {diff.tags.removed.map((tag, i) => (
                    <tr key={`rem-${i}`} className="bg-rose-50/50 dark:bg-rose-950/20">
                      <td className="py-2 px-4 font-sans font-semibold text-rose-700 dark:text-rose-400 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <MinusCircle className="w-3.5 h-3.5" aria-hidden="true" /> {locale === 'id' ? 'Dihapus' : 'Removed'}
                        </span>
                      </td>
                      <td className="py-2 px-4">{tag.ns}:{tag.name}</td>
                      <td className="py-2 px-4 break-all">{tag.decoded ?? String(tag.raw ?? '')}</td>
                      <td className="py-2 px-4 text-slate-400">—</td>
                    </tr>
                  ))}
                  {diff.tags.added.map((tag, i) => (
                    <tr key={`add-${i}`} className="bg-emerald-50/50 dark:bg-emerald-950/20">
                      <td className="py-2 px-4 font-sans font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" /> {locale === 'id' ? 'Ditambah' : 'Added'}
                        </span>
                      </td>
                      <td className="py-2 px-4">{tag.ns}:{tag.name}</td>
                      <td className="py-2 px-4 text-slate-400">—</td>
                      <td className="py-2 px-4 break-all">{tag.decoded ?? String(tag.raw ?? '')}</td>
                    </tr>
                  ))}
                  {diff.tags.changed.map((ch, i) => (
                    <tr key={`chg-${i}`} className="bg-amber-50/50 dark:bg-amber-950/20">
                      <td className="py-2 px-4 font-sans font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <PenLine className="w-3.5 h-3.5" aria-hidden="true" /> {locale === 'id' ? 'Diubah' : 'Changed'}
                        </span>
                      </td>
                      <td className="py-2 px-4">{ch.ns}:{ch.name}</td>
                      <td className="py-2 px-4 break-all">{ch.before}</td>
                      <td className="py-2 px-4 break-all">{ch.after}</td>
                    </tr>
                  ))}
                  {diff.tags.removed.length === 0 && diff.tags.added.length === 0 && diff.tags.changed.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 px-4 text-center font-sans text-slate-500">
                        {locale === 'id' ? 'Semua tag identik di kedua file.' : 'All tags are identical across both files.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Structure Diff */}
          <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
              {locale === 'id' ? 'Perbedaan Struktur Internal' : 'Internal Structure Diff'}
            </h3>
            <div className="flex flex-wrap gap-4 tabular-nums">
              <span className="text-rose-700 dark:text-rose-400 font-medium">
                - {diff.structure.removed.length} node dihapus ({diff.structure.removed.map((n) => n.type).slice(0, 6).join(', ') || '—'})
              </span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                + {diff.structure.added.length} node ditambah ({diff.structure.added.map((n) => n.type).slice(0, 6).join(', ') || '—'})
              </span>
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                ~ {diff.structure.resized.length} node berubah ukuran
              </span>
            </div>
            {diff.structure.resized.length > 0 && (
              <ul className="mt-2 space-y-1 font-mono text-slate-600 dark:text-slate-400">
                {diff.structure.resized.slice(0, 10).map((rs, i) => (
                  <li key={i}>
                    {rs.path}: {formatNumber(rs.beforeSize, locale, 0)} B → {formatNumber(rs.afterSize, locale, 0)} B
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
