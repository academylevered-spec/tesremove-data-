'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Globe, Loader2, Lock, Moon, Plus, Server, Sun, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { clearAllHistory, deleteHistoryItem, listReportHistory, saveReportHistory, type HistoryEntry } from '../engine/historyDb';
import { mergeDeepServerResults, type DeepServerResponse } from '../engine/orchestrator';
import type { AnalysisMode, Locale, Report } from '../engine/types';
import { formatBytes, translations } from '../i18n/translations';
import { runPrivateAnalysisInWorker, type RunAnalysisHandle } from '../workers/workerClient';
import BatchView from './BatchView';
import CompareView from './CompareView';
import DropzoneView from './DropzoneView';
import RemoverView from './RemoverView';
import ReportView from './ReportView';

type ActiveSection = 'analyze' | 'remover' | 'compare' | 'batch' | 'history';

function friendlyStageLabel(stage: string, locale: Locale): string {
  const idMap: Record<string, string> = {
    init: 'Menyiapkan pembacaan file...',
    magic: 'Mendeteksi tipe file dari magic bytes...',
    hash: 'Menghitung hash MD5, SHA-1, dan SHA-256...',
    parse: 'Membongkar struktur & tag metadata...',
    rules: 'Menjalankan cross-check & skor privasi...',
    server: 'Menjalankan ExifTool & ffprobe di server...',
  };
  const enMap: Record<string, string> = {
    init: 'Preparing file stream...',
    magic: 'Detecting file format from magic bytes...',
    hash: 'Computing streaming MD5, SHA-1 & SHA-256 hashes...',
    parse: 'Inspecting internal containers & metadata tags...',
    rules: 'Running integrity cross-checks & privacy scoring...',
    server: 'Running temporary ExifTool & ffprobe analysis...',
  };
  return (locale === 'id' ? idMap[stage] : enMap[stage]) ?? (locale === 'id' ? 'Menganalisis file...' : 'Analyzing file...');
}

export default function MetaScopeApp() {
  const [locale, setLocale] = useState<Locale>('id');
  const [darkMode, setDarkMode] = useState(false);
  const [section, setSection] = useState<ActiveSection>('analyze');
  const [mode, setMode] = useState<AnalysisMode>('privat');

  const [activeFile, setActiveFile] = useState<Blob | null>(null);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [analyzing, setAnalyzing] = useState<{ stage: string; fraction: number; filename: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pendingCleanFile, setPendingCleanFile] = useState<{ blob: Blob; name: string } | null>(null);

  const activeHandleRef = useRef<RunAnalysisHandle | null>(null);
  const t = translations[locale];

  // Sync Tailwind v4 .dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const refreshHistory = useCallback(() => {
    listReportHistory().then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const handleAnalyzeFile = useCallback(
    async (file: Blob, filename: string) => {
      activeHandleRef.current?.cancel();
      setSection('analyze');
      setErrorMsg(null);
      setActiveFile(file);
      setActiveReport(null);
      setAnalyzing({ stage: 'init', fraction: 0.05, filename });

      const handle = runPrivateAnalysisInWorker(file, filename, (stage, fraction) => {
        setAnalyzing({ stage, fraction: mode === 'mendalam' ? fraction * 0.75 : fraction, filename });
      });
      activeHandleRef.current = handle;

      try {
        let report = await handle.promise;

        // If user explicitly opted into Mode Mendalam, call server /api/analyze and merge results
        if (mode === 'mendalam') {
          setAnalyzing({ stage: 'server', fraction: 0.85, filename });
          try {
            const fd = new FormData();
            fd.append('file', file, 'upload.bin');
            const res = await fetch('/api/analyze', { method: 'POST', body: fd });
            const serverData = (await res.json()) as DeepServerResponse;
            if (!res.ok) {
              report = mergeDeepServerResults(report, {
                status: 'engine_unavailable',
                message: serverData.message || `Server mengembalikan HTTP ${res.status}; turun ke Mode Privat.`,
              });
            } else {
              report = mergeDeepServerResults(report, serverData);
            }
          } catch {
            report = mergeDeepServerResults(report, {
              status: 'engine_unavailable',
              message: 'Endpoint Mode Mendalam tidak dapat dijangkau; turun otomatis ke Mode Privat.',
            });
          }
        }

        setActiveReport(report);
        await saveReportHistory(report);
        refreshHistory();
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setErrorMsg((err as Error)?.message || 'Gagal menganalisis file.');
        }
      } finally {
        activeHandleRef.current = null;
        setAnalyzing(null);
      }
    },
    [mode, refreshHistory],
  );

  const handleCancelActive = () => {
    activeHandleRef.current?.cancel();
    activeHandleRef.current = null;
    setAnalyzing(null);
  };

  const handleResetToDropzone = () => {
    activeHandleRef.current?.cancel();
    setSection('analyze');
    setActiveReport(null);
    setActiveFile(null);
    setErrorMsg(null);
    setAnalyzing(null);
  };

  const navItems: ReadonlyArray<readonly [ActiveSection, string]> = [
    ['analyze', t.navAnalyze],
    ['remover', t.navRemover],
    ['compare', t.navCompare],
    ['batch', t.navBatch],
    ['history', t.navHistory],
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9FC] text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#0E1420]/90 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={handleResetToDropzone}
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-white hover:text-sky-600 dark:hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t.appName}
          </button>

          {/* Zone 2: 4 Concise Single-Line Nav Links (desktop 3-zone bar) */}
          <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-7 text-sm font-medium">
            {navItems.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`relative py-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  section === id
                    ? 'text-slate-900 dark:text-white font-semibold after:absolute after:inset-x-0 after:-bottom-[18px] after:h-0.5 after:bg-sky-600 dark:after:bg-sky-400 after:rounded-full'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleResetToDropzone}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-sky-400 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.newFile}</span>
            </button>
          </div>
        </div>

        {/* Mobile Secondary Navigation Row (<640px) so all 5 tabs fit cleanly */}
        <nav
          aria-label="Mobile navigation"
          className="flex sm:hidden items-center justify-between gap-2 overflow-x-auto border-t border-slate-100 dark:border-slate-800/80 px-4 py-1.5 text-xs font-medium"
        >
          {navItems.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap ${
                section === id
                  ? 'border-sky-600 text-slate-900 dark:border-sky-400 dark:text-white font-semibold'
                  : 'border-transparent text-slate-500 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* Quiet Workspace Preferences Strip (Privacy reassurance + Language ID/EN + Light/Dark Theme) */}
      <div className="border-b border-slate-200/70 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            {mode === 'privat' ? (
              <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            ) : (
              <Server className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
            )}
            <span>{mode === 'privat' ? t.privacyGuarantee : t.modeDeepDesc}</span>
          </span>
          <div className="flex items-center gap-2.5 shrink-0">
            <div
              className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 p-0.5"
              role="group"
              aria-label="Language switch"
            >
              <Globe className="w-3.5 h-3.5 text-slate-400 mx-1.5" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setLocale('id')}
                aria-pressed={locale === 'id'}
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  locale === 'id'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                ID
              </button>
              <button
                type="button"
                onClick={() => setLocale('en')}
                aria-pressed={locale === 'en'}
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  locale === 'en'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                EN
              </button>
            </div>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? t.themeLight : t.themeDark}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> : <Moon className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />}
              <span>{darkMode ? t.themeLight : t.themeDark}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Viewport */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
        <motion.div
          key={`${section}-${Boolean(activeReport)}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {section === 'analyze' && (
            <>
              {errorMsg && (
                <div
                  role="alert"
                  className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/40 px-5 py-4 text-sm text-rose-900 dark:text-rose-200"
                >
                  <span>{errorMsg}</span>
                  <button
                    type="button"
                    onClick={() => setErrorMsg(null)}
                    aria-label="Tutup galat"
                    className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {analyzing && (
                <div
                  role="status"
                  className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-8 max-w-xl mx-auto shadow-[0_2px_10px_rgba(15,23,42,0.04)] space-y-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{t.analyzingProgress}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {friendlyStageLabel(analyzing.stage, locale)}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                      {Math.round(analyzing.fraction * 100)}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-sky-600 dark:bg-sky-400 transition-all duration-150"
                      style={{ width: `${Math.max(6, Math.round(analyzing.fraction * 100))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">{analyzing.filename}</p>
                    <button
                      type="button"
                      onClick={handleCancelActive}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                    >
                      {t.cancelBtn}
                    </button>
                  </div>
                </div>
              )}

              {!analyzing && !activeReport && (
                <DropzoneView
                  mode={mode}
                  onModeChange={setMode}
                  onSelectFile={handleAnalyzeFile}
                  locale={locale}
                  t={t}
                />
              )}

              {!analyzing && activeReport && (
                <ReportView
                  report={activeReport}
                  file={activeFile}
                  locale={locale}
                  t={t}
                  onAnalyzeAnother={handleResetToDropzone}
                  onCleanFile={
                    activeFile
                      ? () => {
                          setPendingCleanFile({ blob: activeFile, name: activeReport.file.name });
                          setSection('remover');
                        }
                      : undefined
                  }
                />
              )}
            </>
          )}

          {section === 'remover' && (
            <RemoverView
              locale={locale}
              t={t}
              initialFile={pendingCleanFile}
              onConsumeInitialFile={() => setPendingCleanFile(null)}
              onInspectCleaned={(rep, blob) => {
                setActiveReport(rep);
                setActiveFile(blob);
                setSection('analyze');
              }}
            />
          )}

          {section === 'compare' && <CompareView locale={locale} t={t} />}

          {section === 'batch' && (
            <BatchView
              locale={locale}
              t={t}
              onOpenReport={(rep, file) => {
                setActiveReport(rep);
                setActiveFile(file);
                setSection('analyze');
              }}
            />
          )}

          {section === 'history' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {locale === 'id' ? 'Riwayat Analisis Lokal' : 'Local Analysis History'}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {locale === 'id'
                      ? 'Hanya tersimpan di IndexedDB browser ini tanpa isi file biner dan tanpa penyimpanan server.'
                      : 'Stored strictly in your browser IndexedDB with zero binary contents and zero server storage.'}
                  </p>
                </div>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      await clearAllHistory();
                      setHistory([]);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-800/80 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {t.clearHistory}
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    <Clock className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-slate-900 dark:text-white">{t.emptyHistory}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {locale === 'id'
                      ? 'Setiap file yang Anda periksa akan muncul di sini agar mudah dibuka kembali.'
                      : 'Files you analyze will appear here so you can reopen their reports anytime.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleResetToDropzone}
                    className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 transition-colors cursor-pointer"
                  >
                    {locale === 'id' ? 'Analisis file pertama' : 'Analyze your first file'}
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="px-5 py-4 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveReport(item.report);
                          setActiveFile(null);
                          setSection('analyze');
                        }}
                        className="text-left min-w-0 flex-1 cursor-pointer"
                      >
                        <div className="text-sm font-semibold text-slate-900 dark:text-white hover:text-sky-600 dark:hover:text-sky-400 transition-colors truncate">
                          {item.fileName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{item.detectedType}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatBytes(item.fileSize, locale)}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              item.privacyScore >= 50
                                ? 'text-rose-600 dark:text-rose-400 font-medium'
                                : item.privacyScore >= 20
                                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                                  : 'text-emerald-600 dark:text-emerald-400 font-medium'
                            }
                          >
                            {locale === 'id' ? 'Privasi' : 'Privacy'} {item.privacyScore}/100
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{new Date(item.savedAt).toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteHistoryItem(item.id);
                          refreshHistory();
                        }}
                        aria-label={`Hapus ${item.fileName}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-slate-200/70 dark:border-slate-800/70 bg-white/50 dark:bg-slate-950/50 py-5 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
        MetaScope · {t.legalDisclaimer}
      </footer>
    </div>
  );
}
