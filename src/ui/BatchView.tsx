'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
  Square,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { exportBatchCsv, exportBatchZip } from '../engine/exporters';
import { BUILTIN_SAMPLES } from '../engine/samples';
import type { Locale, Report } from '../engine/types';
import { formatNumber, type Translations } from '../i18n/translations';
import { getOptimalWorkerConcurrency, runPrivateAnalysisInWorker, type RunAnalysisHandle } from '../workers/workerClient';

interface BatchItem {
  id: string;
  file: Blob;
  name: string;
  size: number;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  report?: Report;
  error?: string;
}

interface BatchViewProps {
  onOpenReport: (report: Report, file: Blob) => void;
  locale: Locale;
  t: Translations;
}

export default function BatchView({ onOpenReport, locale, t }: BatchViewProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'score'>('score');
  const [sortAsc, setSortAsc] = useState(false);
  const activeHandlesRef = useRef<Map<string, RunAnalysisHandle>>(new Map());
  const cancelledRef = useRef(false);
  const concurrency = useMemo(() => getOptimalWorkerConcurrency(), []);

  const runQueue = async (queueItems: BatchItem[]) => {
    cancelledRef.current = false;
    let cursor = 0;

    const workerLoop = async () => {
      while (cursor < queueItems.length && !cancelledRef.current) {
        const current = queueItems[cursor++];
        setItems((prev) => prev.map((it) => (it.id === current.id ? { ...it, status: 'running', error: undefined } : it)));
        const handle = runPrivateAnalysisInWorker(current.file, current.name);
        activeHandlesRef.current.set(current.id, handle);
        try {
          const rep = await handle.promise;
          setItems((prev) => prev.map((it) => (it.id === current.id ? { ...it, status: 'done', report: rep } : it)));
        } catch (err) {
          const isAbort = (err as Error)?.name === 'AbortError' || cancelledRef.current;
          setItems((prev) =>
            prev.map((it) =>
              it.id === current.id
                ? { ...it, status: isAbort ? 'cancelled' : 'error', error: (err as Error)?.message }
                : it,
            ),
          );
        } finally {
          activeHandlesRef.current.delete(current.id);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, queueItems.length) }, () => workerLoop());
    await Promise.all(workers);
  };

  const enqueueFiles = (fileList: Array<{ file: Blob; name: string }>) => {
    const created: BatchItem[] = fileList.map((f, i) => ({
      id: `batch_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      file: f.file,
      name: f.name,
      size: f.file.size,
      status: 'queued',
    }));
    setItems((prev) => [...prev, ...created]);
    void runQueue(created);
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    for (const h of activeHandlesRef.current.values()) h.cancel();
    activeHandlesRef.current.clear();
    setItems((prev) =>
      prev.map((it) => (it.status === 'queued' || it.status === 'running' ? { ...it, status: 'cancelled' } : it)),
    );
  };

  const handleRetryFailed = () => {
    const failed = items.filter((it) => it.status === 'error' || it.status === 'cancelled');
    if (failed.length === 0) return;
    setItems((prev) =>
      prev.map((it) => (it.status === 'error' || it.status === 'cancelled' ? { ...it, status: 'queued', error: undefined } : it)),
    );
    void runQueue(failed);
  };

  const handleLoadBuiltinBatch = () => {
    const built = BUILTIN_SAMPLES.map((s) => {
      const sample = s.build();
      return { file: new Blob([sample.bytes as unknown as BlobPart], { type: sample.mime }), name: sample.name };
    });
    enqueueFiles(built);
  };

  const completedReports = useMemo(
    () => items.filter((i) => i.status === 'done' && i.report).map((i) => i.report!),
    [items],
  );
  const runningCount = items.filter((i) => i.status === 'running' || i.status === 'queued').length;
  const failedCount = items.filter((i) => i.status === 'error' || i.status === 'cancelled').length;

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      else cmp = (a.report?.privacy.score ?? -1) - (b.report?.privacy.score ?? -1);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [items, sortBy, sortAsc]);

  const toggleSort = (col: 'name' | 'size' | 'score') => {
    if (sortBy === col) setSortAsc((v) => !v);
    else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  const handleExportBatchCsv = () => {
    const csv = exportBatchCsv(completedReports);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metascope-batch-summary.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportBatchZip = () => {
    const zipBytes = exportBatchZip(completedReports);
    const blob = new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metascope-batch-reports.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="space-y-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const fl = Array.from(e.dataTransfer.files ?? []).map((f) => ({ file: f, name: f.name }));
        if (fl.length > 0) enqueueFiles(fl);
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t.batchTitle}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.batchSub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-sky-700 shadow-xs transition-colors cursor-pointer whitespace-nowrap">
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{locale === 'id' ? 'Tambah banyak file' : 'Add multiple files'}</span>
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                const fl = Array.from(e.target.files ?? []).map((f) => ({ file: f, name: f.name }));
                if (fl.length > 0) enqueueFiles(fl);
                e.target.value = '';
              }}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap">
            <FolderOpen className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>{locale === 'id' ? 'Pilih folder' : 'Select folder'}</span>
            <input
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is standard in Chromium/WebKit/Firefox
              webkitdirectory=""
              className="sr-only"
              onChange={(e) => {
                const fl = Array.from(e.target.files ?? []).map((f) => ({ file: f, name: f.webkitRelativePath || f.name }));
                if (fl.length > 0) enqueueFiles(fl);
                e.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleLoadBuiltinBatch}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50/30 dark:hover:bg-slate-800 transition-all whitespace-nowrap cursor-pointer"
          >
            {locale === 'id' ? 'Uji 6 contoh bawaan' : 'Run 6 built-in samples'}
          </button>
        </div>
      </div>

      {/* Progress & Batch Controls */}
      {items.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              <span>
                {completedReports.length} / {items.length} {locale === 'id' ? 'selesai' : 'completed'} ({concurrency} worker)
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {Math.round((completedReports.length / items.length) * 100)}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-sky-600 dark:bg-sky-400 transition-all"
                style={{ width: `${Math.round((completedReports.length / items.length) * 100)}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            {runningCount > 0 && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-800 px-3 py-2 min-h-[40px] text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <Square className="w-3 h-3" aria-hidden="true" /> {t.cancelBtn}
              </button>
            )}
            {failedCount > 0 && (
              <button
                type="button"
                onClick={handleRetryFailed}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 px-3 py-2 min-h-[40px] text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {t.retryFailed} ({failedCount})
              </button>
            )}
            {completedReports.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleExportBatchCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" /> {t.batchExportCsv}
                </button>
                <button
                  type="button"
                  onClick={handleExportBatchZip}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" /> {t.batchExportZip}
                </button>
              </>
            )}
            {runningCount === 0 && items.length > 0 && (
              <button
                type="button"
                onClick={() => setItems([])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> {locale === 'id' ? 'Bersihkan daftar' : 'Clear list'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sortable Summary Table */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {items.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
              <FolderOpen className="w-5 h-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {locale === 'id'
                ? 'Seret banyak file ke sini atau pilih folder untuk dianalisis sekaligus'
                : 'Drag multiple files here or pick a folder to analyze in parallel'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {locale === 'id'
                ? 'Semua file diproses paralel di browser menggunakan Web Worker tanpa diunggah ke server.'
                : 'Files are processed in parallel right inside your browser using Web Workers.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900 dark:hover:text-slate-100">
                      Nama File <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-4">Tipe</th>
                  <th className="py-2.5 px-4 text-right">
                    <button type="button" onClick={() => toggleSort('size')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900 dark:hover:text-slate-100">
                      Ukuran <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-4 text-right">
                    <button type="button" onClick={() => toggleSort('score')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900 dark:hover:text-slate-100">
                      Privasi <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-4">Temuan Teratas</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedItems.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-medium">
                      {it.report ? (
                        <button
                          type="button"
                          onClick={() => onOpenReport(it.report!, it.file)}
                          className="text-sky-700 dark:text-sky-400 hover:underline text-left"
                        >
                          {it.name}
                        </button>
                      ) : (
                        <span className="text-slate-800 dark:text-slate-200">{it.name}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono">{it.report?.file.detectedType ?? '—'}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatNumber(it.size, locale, 0)} B</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                      {it.report ? `${it.report.privacy.score}/100` : '—'}
                    </td>
                    <td className="py-2.5 px-4 max-w-md truncate text-slate-600 dark:text-slate-400">
                      {it.report?.findings[0]?.text ?? it.error ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {it.status === 'done' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Selesai
                        </span>
                      )}
                      {it.status === 'running' && (
                        <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Memproses
                        </span>
                      )}
                      {it.status === 'queued' && <span className="text-slate-400">Antre</span>}
                      {(it.status === 'error' || it.status === 'cancelled') && (
                        <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-medium">
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> {it.status === 'cancelled' ? 'Dibatalkan' : 'Gagal'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
