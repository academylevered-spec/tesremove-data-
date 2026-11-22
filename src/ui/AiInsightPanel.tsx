'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, BookOpen, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { sanitizeReportForExportOrAi } from '../engine/exporters';
import type { Locale, Report } from '../engine/types';
import type { Translations } from '../i18n/translations';

interface AiInsightPanelProps {
  report: Report;
  locale: Locale;
  t: Translations;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const TECHNICAL_TERMS_ID = ['faststart', 'hvcC', 'SEI', 'GOP', 'C2PA', 'cross-check', 'vid_md5'];
const TECHNICAL_TERMS_EN = ['faststart', 'hvcC', 'SEI', 'GOP', 'C2PA', 'cross-check', 'vid_md5'];

export default function AiInsightPanel({ report, locale, t }: AiInsightPanelProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [termExplain, setTermExplain] = useState<{ term: string; text: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);

  const sanitizedReport = useMemo(() => sanitizeReportForExportOrAi(report), [report]);
  const previewJson = useMemo(() => JSON.stringify(sanitizedReport, null, 2), [sanitizedReport]);

  const callAi = async (payload: Record<string, unknown>): Promise<string | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          report: sanitizedReport,
          ...payload,
        }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        setError(data.error || 'Gagal mendapatkan respons dari AI Insight.');
        return null;
      }
      return data.text;
    } catch {
      setError('Tidak dapat terhubung ke endpoint server /api/ai-insight. Laporan lokal tetap utuh.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSend = async () => {
    setShowPreview(false);
    setConsented(true);
    const text = await callAi({ action: 'summary' });
    if (text) setSummaryText(text);
  };

  const handleExplainTerm = async (term: string) => {
    const text = await callAi({ action: 'explainTerm', term });
    if (text) setTermExplain({ term, text });
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setQuestion('');
    const nextHistory: ChatTurn[] = [...chatHistory, { role: 'user', text: q }];
    setChatHistory(nextHistory);
    const answer = await callAi({ action: 'qa', question: q, history: chatHistory });
    if (answer) {
      setChatHistory([...nextHistory, { role: 'assistant', text: answer }]);
    }
  };

  return (
    <section
      aria-labelledby="ai-insight-heading"
      className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shrink-0">
            <Sparkles className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 id="ai-insight-heading" className="text-base font-semibold text-slate-900 dark:text-white">
              {t.aiSummaryTitle}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {locale === 'id'
                ? 'Opt-in per laporan. Gemini hanya menerima JSON metadata tersaring di sisi server (tanpa isi file atau hex).'
                : 'Opt-in per report. Gemini only receives sanitized metadata JSON server-side (no file bytes or hex).'}
            </p>
          </div>
        </div>
        {!consented && (
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            {t.aiExplainBtn}
          </button>
        )}
      </div>

      {/* Pre-send JSON Preview & Consent Modal */}
      {showPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-preview-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 id="ai-preview-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {t.aiPreviewTitle}
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.aiPreviewDesc}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                aria-label={t.aiCancel}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono text-slate-700 dark:text-slate-300">
              {previewJson}
            </pre>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {t.aiCancel}
              </button>
              <button
                type="button"
                onClick={handleConfirmSend}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                {t.aiSendConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active AI Session */}
      {consented && (
        <div className="mt-4 space-y-4 border-t border-slate-200 dark:border-slate-800 pt-4">
          {error && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => callAi({ action: 'summary' }).then((txt) => txt && setSummaryText(txt))}
                className="inline-flex items-center gap-1 rounded border border-amber-400 dark:border-amber-700 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                {t.aiRetry}
              </button>
            </div>
          )}

          {loading && !summaryText && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {locale === 'id' ? 'Menyusun penjelasan berbasis JSON laporan...' : 'Generating explanation grounded in report JSON...'}
            </p>
          )}

          {summaryText && (
            <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-line">
              {summaryText}
            </div>
          )}

          {/* Clickable technical terms */}
          <div className="pt-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{locale === 'id' ? 'Klik istilah teknis untuk penjelasan:' : 'Click a technical term for explanation:'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(locale === 'id' ? TECHNICAL_TERMS_ID : TECHNICAL_TERMS_EN).map((term) => (
                <button
                  key={term}
                  type="button"
                  disabled={loading}
                  onClick={() => handleExplainTerm(term)}
                  className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1 text-xs font-mono text-slate-700 dark:text-slate-300 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
            {termExplain && (
              <div className="mt-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs text-slate-700 dark:text-slate-300">
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{termExplain.term}: </span>
                <span className="whitespace-pre-line">{termExplain.text}</span>
              </div>
            )}
          </div>

          {/* Session-only Q&A */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            {chatHistory.length > 0 && (
              <div className="space-y-2 mb-3 max-h-60 overflow-auto">
                {chatHistory.map((turn, idx) => (
                  <div
                    key={idx}
                    className={`rounded-md p-2.5 text-sm ${
                      turn.role === 'user'
                        ? 'bg-sky-50 dark:bg-sky-950/40 text-slate-900 dark:text-slate-100'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
                      {turn.role === 'user' ? (locale === 'id' ? 'Anda' : 'You') : 'AI Insight'}
                    </span>
                    <span className="whitespace-pre-line">{turn.text}</span>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAsk} className="flex gap-2">
              <label htmlFor="ai-question-input" className="sr-only">
                {t.aiAskPlaceholder}
              </label>
              <input
                id="ai-question-input"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t.aiAskPlaceholder}
                className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={loading || !question.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 dark:bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                {t.aiAskBtn}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
