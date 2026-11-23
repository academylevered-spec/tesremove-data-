'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Binary,
  Braces,
  Check,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FolderTree,
  HelpCircle,
  Info,
  LayoutDashboard,
  MapPin,
  Printer,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  exportReportJson,
  exportReportMarkdown,
  exportStandaloneHtml,
  exportTagsCsv,
} from '../engine/exporters';
import type { Confidence, Locale, Report, Severity } from '../engine/types';
import { formatBytes, formatNumber, type Translations } from '../i18n/translations';
import { PRIVACY_WEIGHTS } from '../rules/privacy';
import AiInsightPanel from './AiInsightPanel';
import HexStringsTab from './HexStringsTab';
import StructureTab from './StructureTab';
import TagsTab from './TagsTab';
import TechnicalTab from './TechnicalTab';
import TimelineLocationTab from './TimelineLocationTab';

type TabId =
  | 'summary'
  | 'tags'
  | 'structure'
  | 'technical'
  | 'timeline'
  | 'provenance'
  | 'integrity'
  | 'hex'
  | 'json';

interface ReportViewProps {
  report: Report;
  file: Blob | null;
  locale: Locale;
  t: Translations;
  onAnalyzeAnother?: () => void;
  onCleanFile?: () => void;
  onCompressVideo?: () => void;
}

function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function confidenceStyle(conf: Confidence): string {
  if (conf === 'pasti') return 'text-emerald-700 dark:text-emerald-400 font-semibold';
  if (conf === 'kuat') return 'text-sky-700 dark:text-sky-400 font-semibold';
  return 'text-amber-700 dark:text-amber-400 font-semibold';
}

function friendlyConfidenceText(conf: Confidence, locale: Locale): string {
  if (locale === 'en') {
    if (conf === 'pasti') return 'Verified fact';
    if (conf === 'kuat') return 'Strong indicator';
    return 'Heuristic estimate';
  }
  if (conf === 'pasti') return 'Fakta pasti';
  if (conf === 'kuat') return 'Indikasi kuat';
  return 'Perkiraan heuristik';
}

function severityStyle(sev: Severity): string {
  if (sev === 'kritis' || sev === 'tinggi') return 'text-rose-700 dark:text-rose-400 font-semibold';
  if (sev === 'sedang') return 'text-amber-700 dark:text-amber-400 font-semibold';
  return 'text-slate-600 dark:text-slate-400 font-medium';
}

function privacyVerdict(score: number, locale: Locale): { label: string; tone: string; bar: string } {
  if (score >= 50) {
    return {
      label: locale === 'id' ? 'Risiko tinggi — mengandung data sensitif' : 'High risk — contains sensitive data',
      tone: 'text-rose-600 dark:text-rose-400',
      bar: 'bg-rose-500 dark:bg-rose-400',
    };
  }
  if (score >= 20) {
    return {
      label: locale === 'id' ? 'Risiko sedang — periksa sebelum dibagikan' : 'Moderate risk — review before sharing',
      tone: 'text-amber-600 dark:text-amber-400',
      bar: 'bg-amber-500 dark:bg-amber-400',
    };
  }
  return {
    label: locale === 'id' ? 'Risiko rendah — relatif bersih' : 'Low risk — relatively clean',
    tone: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500 dark:bg-emerald-400',
  };
}

export default function ReportView({ report, file, locale, t, onAnalyzeAnother, onCleanFile, onCompressVideo }: ReportViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [hexJumpOffset, setHexJumpOffset] = useState<number | null>(null);
  const [tagSearchPreset, setTagSearchPreset] = useState('');
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [copiedBugInfo, setCopiedBugInfo] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const tabs: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'summary', label: t.tabSummary, icon: LayoutDashboard },
    { id: 'tags', label: `${t.tabTags} (${report.tags.length})`, icon: Tag },
    { id: 'structure', label: t.tabStructure, icon: FolderTree },
    { id: 'technical', label: t.tabTechnical, icon: SlidersHorizontal },
    { id: 'timeline', label: t.tabTimeline, icon: MapPin },
    { id: 'provenance', label: t.tabProvenance, icon: ShieldCheck },
    { id: 'integrity', label: t.tabIntegrity, icon: CheckSquare },
    { id: 'hex', label: t.tabHex, icon: Binary },
    { id: 'json', label: t.tabJson, icon: Braces },
  ];

  const applicableChecks = useMemo(
    () => report.checks.filter((c) => c.status !== 'tidak_berlaku'),
    [report.checks],
  );
  const passedChecks = useMemo(
    () => applicableChecks.filter((c) => c.status === 'lolos'),
    [applicableChecks],
  );

  const jsonFormatted = useMemo(() => exportReportJson(report), [report]);
  const failedCount = Math.max(0, report.meta.totalAnalyzers - report.meta.completedAnalyzers);
  const verdict = privacyVerdict(report.privacy.score, locale);
  const coveragePct =
    report.coverage.mapped && report.coverage.totalBytes > 0
      ? Math.min(100, (report.coverage.explainedBytes / report.coverage.totalBytes) * 100)
      : null;

  const handleJumpToHex = (offset: number) => {
    setHexJumpOffset(offset);
    setActiveTab('hex');
  };

  const handleJumpToEvidence = (kind: 'tag' | 'offset' | 'section', target: string | number) => {
    if (kind === 'offset' && typeof target === 'number') {
      handleJumpToHex(target);
    } else if (kind === 'tag' && typeof target === 'string') {
      const cleanName = target.includes(':') ? target.split(':').pop() || target : target;
      setTagSearchPreset(cleanName);
      setActiveTab('tags');
    } else if (kind === 'section' && typeof target === 'string') {
      setActiveTab(target as TabId);
    }
  };

  const handleCopyHash = (label: string, val: string) => {
    if (!val) return;
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopiedHash(label);
    setTimeout(() => setCopiedHash(null), 1600);
  };

  const handleCopyTechDetails = () => {
    const bugSummary = JSON.stringify(
      {
        schema: report.meta.schema,
        mode: report.meta.mode,
        detectedType: report.file.detectedType,
        size: report.file.size,
        analyzers: report.meta.analyzers,
        warnings: report.warnings,
      },
      null,
      2,
    );
    navigator.clipboard?.writeText(bugSummary).catch(() => {});
    setCopiedBugInfo(true);
    setTimeout(() => setCopiedBugInfo(false), 1800);
  };

  const baseFilename = report.file.name.replace(/\.[^.]+$/, '') || 'metascope-report';

  return (
    <div className="space-y-6">
      {onAnalyzeAnother && (
        <div>
          <button
            type="button"
            onClick={onAnalyzeAnother}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{locale === 'id' ? 'Kembali & analisis file lain' : 'Back & analyze another file'}</span>
          </button>
        </div>
      )}

      {/* File Identity & Status Header */}
      <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white break-all">
              {report.file.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">{report.file.detectedType}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(report.file.size, locale)}</span>
              <span aria-hidden="true">·</span>
              <span>{report.meta.mode === 'mendalam' ? t.modeDeep : t.modePrivate}</span>
              <span aria-hidden="true">·</span>
              <span>{t.analyzersCompleted(report.meta.completedAnalyzers, report.meta.totalAnalyzers, failedCount)}</span>
              {report.meta.durationMs !== undefined && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatNumber(report.meta.durationMs, locale, 0)} ms</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 max-w-full">
            {file && onCompressVideo && report.technical.video && (
              <button
                type="button"
                onClick={onCompressVideo}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white hover:bg-sky-700 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                {t.compressCurrentVideo}
              </button>
            )}
            {file && onCleanFile && (
              <button
                type="button"
                onClick={onCleanFile}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 min-h-[40px] text-xs font-semibold text-white hover:bg-emerald-700 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                {t.removerCleanCurrent}
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadText(jsonFormatted, `${baseFilename}.metascope.json`, 'application/json')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-3.5 py-2 min-h-[40px] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              {t.exportJson}
            </button>
            <button
              type="button"
              onClick={() => downloadText(exportStandaloneHtml(report), `${baseFilename}.metascope.html`, 'text/html')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-3.5 py-2 min-h-[40px] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              HTML
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-3.5 py-2 min-h-[40px] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              PDF
            </button>
          </div>
        </div>

        {/* Hashes L0 with One-Click Copy */}
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-xs">
          {(
            [
              ['MD5', report.file.hashes.md5],
              ['SHA-1', report.file.hashes.sha1],
              ['SHA-256', report.file.hashes.sha256],
            ] as const
          ).map(([label, val]) => (
            <div key={label} className="min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <dt className="text-slate-500 dark:text-slate-400 font-medium">{label}</dt>
                {val && (
                  <button
                    type="button"
                    onClick={() => handleCopyHash(label, val)}
                    aria-label={`${t.copy} ${label}`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors cursor-pointer"
                  >
                    {copiedHash === label ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        <span className="text-emerald-600 dark:text-emerald-400">{t.copied}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" aria-hidden="true" />
                        <span>{t.copy}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              <dd className="font-mono text-slate-800 dark:text-slate-200 break-all leading-relaxed">{val || '—'}</dd>
            </div>
          ))}
        </dl>

        {/* Extension mismatch warning */}
        {!report.file.extensionMatches && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs text-rose-900 dark:text-rose-200"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <span>
              <strong>{t.extensionMismatchBanner}</strong> (.{report.file.extension} ≠ {report.file.detectedType})
            </span>
          </div>
        )}

        {/* Partial failure / analyzer warnings */}
        {report.warnings.length > 0 && (
          <div
            role="status"
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200"
          >
            <div className="space-y-1">
              {report.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>{w.analyzer}:</strong> {w.message}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopyTechDetails}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-700 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedBugInfo ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedBugInfo ? t.copied : t.copyTechDetails}
            </button>
          </div>
        )}

        {/* Unsupported deep format notice */}
        {report.file.detectedFamily === 'unknown' && (
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
            <span>{t.deepAnalysisUnavailable}</span>
          </div>
        )}
      </section>

      {/* Accessible Icon-Paired Report Tabs */}
      <div className="border-b border-slate-200/80 dark:border-slate-800 overflow-x-auto no-scrollbar snap-x">
        <div role="tablist" aria-label="Report sections" className="flex items-center gap-1 min-w-max">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                id={`tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-3 min-h-[44px] snap-start text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300 font-semibold'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB PANELS */}
      <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'summary' && (
          <div className="space-y-6">
            {/* Executive KPI Overview Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Privacy Score Card */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.privacyScore}</span>
                  <button
                    type="button"
                    onClick={() => setShowScoreModal(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    {t.howScoreCalculated}
                  </button>
                </div>
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-3xl font-bold font-mono tabular-nums ${verdict.tone}`}>
                      {report.privacy.score}
                    </span>
                    <span className="text-sm text-slate-400 dark:text-slate-500">/ 100</span>
                  </div>
                  <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${verdict.bar}`}
                      style={{ width: `${Math.max(report.privacy.score > 0 ? 4 : 0, report.privacy.score)}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  <span className={`font-medium ${verdict.tone}`}>{verdict.label}</span>
                  {' · '}
                  {report.privacy.items.length} {locale === 'id' ? 'sinyal' : 'signals'}
                </p>
              </div>

              {/* Cross-check Status Card */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-3">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.crossChecks}</span>
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    {passedChecks.length === applicableChecks.length ? (
                      <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                      {t.checksPassedOf(passedChecks.length, applicableChecks.length)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {passedChecks.length === applicableChecks.length
                      ? locale === 'id'
                        ? 'Semua pemeriksaan konsistensi internal lolos'
                        : 'All internal consistency checks passed'
                      : locale === 'id'
                        ? 'Terdapat catatan integritas yang perlu ditinjau'
                        : 'Some integrity checks flagged notes to inspect'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('integrity')}
                  className="text-left text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                >
                  {locale === 'id' ? 'Lihat detail semua pemeriksaan →' : 'Inspect all integrity checks →'}
                </button>
              </div>

              {/* Byte Coverage Card */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-3">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.byteCoverage}</span>
                <div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {coveragePct !== null ? `${formatNumber(coveragePct, locale, 2)}%` : '—'}
                  </div>
                  <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        coveragePct !== null && coveragePct < 99.9
                          ? 'bg-amber-500 dark:bg-amber-400'
                          : 'bg-sky-600 dark:bg-sky-400'
                      }`}
                      style={{ width: `${coveragePct ?? 0}%` }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('structure')}
                  className="text-left text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                >
                  {report.coverage.mapped
                    ? `${formatNumber(report.coverage.explainedBytes, locale, 0)} / ${formatNumber(report.coverage.totalBytes, locale, 0)} byte →`
                    : locale === 'id'
                      ? 'Belum dipetakan'
                      : 'Not mapped yet'}
                </button>
              </div>
            </div>

            {/* Key Findings (Human-First Language + Confidence + Clickable Evidence) */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{t.topFindings}</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id'
                    ? 'Setiap temuan dilabeli tingkat keyakinan dan bukti langsung'
                    : 'Every finding lists its confidence level and direct evidence'}
                </span>
              </div>
              {report.findings.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Tidak ada temuan inferensial khusus.' : 'No specific inferential findings.'}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {report.findings.map((f) => (
                    <li
                      key={f.id}
                      className="py-4 first:pt-0 last:pb-0 flex flex-wrap items-start justify-between gap-4"
                    >
                      <div className="space-y-1.5 max-w-3xl">
                        <div className="text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-500 dark:text-slate-400">
                          <span className={`inline-flex items-center gap-1 ${confidenceStyle(f.confidence)}`}>
                            {f.confidence === 'pasti' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            ) : f.confidence === 'kuat' ? (
                              <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span>{friendlyConfidenceText(f.confidence, locale)}</span>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{f.id}</span>
                        </div>
                        <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                          {locale === 'en' && f.textEn ? f.textEn : f.text}
                        </p>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all">
                          {locale === 'id' ? 'Bukti' : 'Evidence'}: {f.evidence.join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 max-w-full">
                        {(f.evidenceLinks ?? []).map((link, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleJumpToEvidence(link.kind, link.target)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 hover:border-sky-300 dark:hover:border-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/50 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <span>
                              {t.viewEvidence}: {link.label}
                            </span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Privacy Items & Neutral Advice */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
                {locale === 'id' ? 'Rincian Sinyal Privasi & Saran Tindakan' : 'Privacy Signals & Neutral Advice'}
              </h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {report.privacy.items.map((item) => (
                  <li key={item.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={severityStyle(item.severity)}>
                        {t.severityLabels[item.severity]}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">+{item.weight} poin</span>
                    </div>
                    <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                      {locale === 'en' && item.textEn ? item.textEn : item.text}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {locale === 'id' ? 'Saran' : 'Advice'}:
                      </span>{' '}
                      {locale === 'en' && item.adviceEn ? item.adviceEn : item.advice}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            {/* Opt-in AI Insight Panel */}
            <AiInsightPanel report={report} locale={locale} t={t} />

            {/* Legal disclaimer */}
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center pt-1">{t.legalDisclaimer}</p>
          </div>
        )}

        {activeTab === 'tags' && (
          <TagsTab key={tagSearchPreset || 'all'} tags={report.tags} initialSearch={tagSearchPreset} onJumpToHex={handleJumpToHex} locale={locale} t={t} />
        )}

        {activeTab === 'structure' && (
          <StructureTab
            structure={report.structure}
            coverage={report.coverage}
            onJumpToHex={handleJumpToHex}
            locale={locale}
            t={t}
          />
        )}

        {activeTab === 'technical' && (
          <TechnicalTab report={report} file={file} onJumpToHex={handleJumpToHex} locale={locale} t={t} />
        )}

        {activeTab === 'timeline' && (
          <TimelineLocationTab timeline={report.timeline} location={report.location} locale={locale} t={t} />
        )}

        {activeTab === 'provenance' && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Content Credentials (C2PA)</h3>
              {report.provenance?.c2pa?.present ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Status</dt>
                    <dd className="font-medium">{report.provenance.c2pa.statusMessage}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Penandatangan</dt>
                    <dd>{report.provenance.c2pa.signer ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Claim Generator</dt>
                    <dd className="font-mono text-xs">{report.provenance.c2pa.claimGenerator ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Tindakan</dt>
                    <dd>{report.provenance.c2pa.actions?.join(', ') || '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {report.provenance?.c2pa?.statusMessage || t.noC2pa}
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {locale === 'id' ? 'Penanda AI & Rantai Pemrosesan' : 'AI Markers & Processing Chain'}
              </h3>
              {(report.provenance?.aiMarkers.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {locale === 'id' ? 'Tidak ada penanda generator AI yang ditemukan di metadata.' : 'No AI generator markers found in metadata.'}
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {report.provenance!.aiMarkers.map((m, i) => (
                    <li key={i} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 text-xs space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={confidenceStyle(m.confidence)}>{t.confidenceLabels[m.confidence]}</span>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{m.indicator}</span>
                        <span className="text-slate-500">· {m.source}</span>
                      </div>
                      <p className="font-mono text-slate-700 dark:text-slate-300 break-all">{m.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
              {(report.provenance?.processingChain.length ?? 0) > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {locale === 'id' ? 'Rantai Perangkat Lunak Terdeteksi' : 'Detected Software Chain'}
                  </h4>
                  <p className="text-xs font-mono text-slate-800 dark:text-slate-200">
                    {report.provenance!.processingChain.join('  →  ')}
                  </p>
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 pt-2">{t.aiAbsenceDisclaimer}</p>
            </section>
          </div>
        )}

        {activeTab === 'integrity' && (
          <div className="space-y-6">
            {/* Cross-Checks */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t.crossChecks}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                      <th className="py-3 px-5">Pemeriksaan</th>
                      <th className="py-3 px-4 w-32">Status</th>
                      <th className="py-3 px-5">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {report.checks.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-5 font-medium text-slate-900 dark:text-slate-100">
                          {locale === 'en' && c.nameEn ? c.nameEn : c.name}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {c.status === 'lolos' && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> {t.checkStatusLabels.lolos}
                            </span>
                          )}
                          {c.status === 'gagal' && (
                            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-semibold">
                              <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> {t.checkStatusLabels.gagal}
                            </span>
                          )}
                          {c.status === 'tidak_berlaku' && (
                            <span className="text-slate-400">{t.checkStatusLabels.tidak_berlaku}</span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-slate-600 dark:text-slate-400">
                          {locale === 'en' && c.detailEn ? c.detailEn : c.detail ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* FR-14 Tag Hash Region Verification */}
            {report.hashTests && report.hashTests.length > 0 && (
              <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {locale === 'id' ? 'Pengujian Hash di Tag terhadap Region File' : 'Tag Hash Verification Against File Regions'}
                </h3>
                {report.hashTests.map((ht, idx) => (
                  <div key={idx} className="space-y-2 text-xs overflow-x-auto">
                    <div className="font-mono break-all">
                      <strong>{ht.tagNamespace}:{ht.tagName}</strong> ({ht.algorithm.toUpperCase()}): {ht.tagHash}
                    </div>
                    <table className="w-full text-left border-collapse font-mono">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-sans">
                          <th className="py-2 pr-4">Region</th>
                          <th className="py-2 pr-4">Hash Terhitung</th>
                          <th className="py-2">Cocok?</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {ht.matches.map((m, j) => (
                          <tr key={j}>
                            <td className="py-2 pr-4 font-sans">{m.region}</td>
                            <td className="py-2 pr-4 break-all">{m.computedHash}</td>
                            <td className="py-2 font-sans">
                              {m.matched ? (
                                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Cocok</span>
                              ) : (
                                <span className="text-rose-700 dark:text-rose-400 font-semibold">Tidak cocok</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {activeTab === 'hex' && (
          <HexStringsTab key={hexJumpOffset ?? 'start'} file={file} fileSize={report.file.size} jumpOffset={hexJumpOffset} locale={locale} t={t} />
        )}

        {activeTab === 'json' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => downloadText(jsonFormatted, `${baseFilename}.metascope.json`, 'application/json')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-sky-500 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-sky-400 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" /> {t.exportJson}
              </button>
              <button
                type="button"
                onClick={() => downloadText(exportTagsCsv(report), `${baseFilename}.tags.csv`, 'text/csv;charset=utf-8')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" /> {t.exportCsv}
              </button>
              <button
                type="button"
                onClick={() => downloadText(exportReportMarkdown(report), `${baseFilename}.metascope.md`, 'text/markdown')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" /> {t.exportMarkdown}
              </button>
              <button
                type="button"
                onClick={() => downloadText(exportStandaloneHtml(report), `${baseFilename}.metascope.html`, 'text/html')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" /> {t.exportHtml}
              </button>
            </div>
            <pre className="max-h-[620px] overflow-auto rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 text-xs font-mono text-slate-800 dark:text-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {jsonFormatted}
            </pre>
          </div>
        )}
      </div>

      {/* Transparent Privacy Score Weights Modal */}
      {showScoreModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="score-modal-title"
          onClick={() => setShowScoreModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 id="score-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
                  {t.howScoreCalculated}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  {locale === 'id'
                    ? 'Skor privasi (0–100) adalah penjumlahan deterministik bobot temuan yang ditemukan (dibatasi maksimal 100), bukan kotak hitam.'
                    : 'The privacy score (0–100) is a deterministic sum of detected signal weights (capped at 100), never a black box.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowScoreModal(false)}
                aria-label="Tutup"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 max-h-80 overflow-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pr-3">Sinyal Privasi</th>
                    <th className="py-2 pr-3">Severity</th>
                    <th className="py-2 text-right">Bobot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {Object.values(PRIVACY_WEIGHTS).map((w) => (
                    <tr key={w.id}>
                      <td className="py-2.5 pr-3 text-slate-800 dark:text-slate-200">
                        {locale === 'en' ? w.labelEn : w.labelId}
                      </td>
                      <td className={`py-2.5 pr-3 ${severityStyle(w.severity)}`}>{t.severityLabels[w.severity]}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">+{w.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
