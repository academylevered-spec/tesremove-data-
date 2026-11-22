'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { BoxNode, CoverageInfo, Locale } from '../engine/types';
import { formatHexOffset, formatNumber, type Translations } from '../i18n/translations';

interface StructureTabProps {
  structure: BoxNode[];
  coverage: CoverageInfo;
  onJumpToHex: (offset: number) => void;
  locale: Locale;
  t: Translations;
}

const COLOR_MAP: Record<string, string> = {
  header: 'bg-sky-600 dark:bg-sky-500',
  metadata: 'bg-amber-500 dark:bg-amber-400',
  media: 'bg-emerald-600 dark:bg-emerald-500',
  other: 'bg-slate-400 dark:bg-slate-600',
  unexplained: 'bg-rose-600 dark:bg-rose-500',
};

function TreeRow({
  node,
  depth,
  onJumpToHex,
  locale,
}: {
  node: BoxNode;
  depth: number;
  onJumpToHex: (offset: number) => void;
  locale: Locale;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = Boolean(node.children && node.children.length > 0);

  return (
    <div role="treeitem" aria-selected={false} aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`flex items-center justify-between gap-3 py-2 px-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800/80 ${
          node.error ? 'bg-rose-50/70 dark:bg-rose-950/30' : ''
        }`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={`${expanded ? 'Tutup' : 'Buka'} ${node.type}`}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <span className="w-5 inline-block shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => onJumpToHex(node.offset)}
            className="font-mono font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-600 dark:hover:text-sky-400 text-left truncate"
            title={locale === 'id' ? 'Klik untuk membuka di Hex Viewer' : 'Click to inspect in Hex Viewer'}
          >
            {node.type}
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {node.detail ? `· ${node.detail}` : `· ${node.path}`}
          </span>
          {node.error && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {node.error}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs font-mono tabular-nums shrink-0 text-slate-600 dark:text-slate-400">
          <span>{formatHexOffset(node.offset)}</span>
          <span className="w-28 text-right text-slate-900 dark:text-slate-200">
            {formatNumber(node.size, locale, 0)} B
          </span>
          <button
            type="button"
            onClick={() => onJumpToHex(node.offset)}
            aria-label={`Hex ${node.type} @ ${formatHexOffset(node.offset)}`}
            className="text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
          >
            Hex
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {hasChildren && expanded && (
        <div role="group">
          {node.children!.map((child, i) => (
            <TreeRow key={`${child.path}-${child.offset}-${i}`} node={child} depth={depth + 1} onJumpToHex={onJumpToHex} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StructureTab({ structure, coverage, onJumpToHex, locale, t }: StructureTabProps) {
  const explainedPct =
    coverage.totalBytes > 0 ? Number(((coverage.explainedBytes / coverage.totalBytes) * 100).toFixed(2)) : 0;
  const unexplainedBytes = Math.max(0, coverage.totalBytes - coverage.explainedBytes);
  const unexplainedPct = Number((100 - explainedPct).toFixed(2));

  return (
    <div className="space-y-6">
      {/* Byte Coverage Map */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.byteCoverage}</h3>
          {coverage.mapped ? (
            <div className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              {t.explainedBytes}: <strong className="text-slate-900 dark:text-slate-100">{formatNumber(explainedPct, locale)}%</strong> (
              {formatNumber(coverage.explainedBytes, locale, 0)} byte) · {t.unexplainedBytes}:{' '}
              <strong className={unexplainedBytes > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}>
                {formatNumber(unexplainedPct, locale)}%
              </strong>{' '}
              ({formatNumber(unexplainedBytes, locale, 0)} byte)
            </div>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">{t.unmappedCoverage}</span>
          )}
        </div>

        {coverage.mapped && coverage.totalBytes > 0 && (
          <>
            <div className="h-5 w-full rounded overflow-hidden bg-slate-200 dark:bg-slate-800 flex" role="img" aria-label={t.byteCoverage}>
              {(coverage.segments ?? []).map((seg, i) => {
                const widthPct = Math.max(0.4, (seg.size / coverage.totalBytes) * 100);
                return (
                  <button
                    key={`${seg.label}-${seg.offset}-${i}`}
                    type="button"
                    onClick={() => onJumpToHex(seg.offset)}
                    style={{ width: `${widthPct}%` }}
                    title={`${seg.label}: ${formatNumber(seg.size, locale, 0)} byte (${((seg.size / coverage.totalBytes) * 100).toFixed(2)}%) @ ${formatHexOffset(seg.offset)}`}
                    className={`h-full ${COLOR_MAP[seg.colorKey] ?? COLOR_MAP.other} hover:opacity-80 transition-opacity border-r border-white/20`}
                    aria-label={`${seg.label} ${formatHexOffset(seg.offset)}`}
                  />
                );
              })}
              {coverage.unexplained.map((u, i) => {
                const widthPct = Math.max(0.6, (u.size / coverage.totalBytes) * 100);
                return (
                  <button
                    key={`unexp-${i}`}
                    type="button"
                    onClick={() => onJumpToHex(u.offset)}
                    style={{ width: `${widthPct}%` }}
                    title={`${t.unexplainedBytes}: ${formatNumber(u.size, locale, 0)} byte @ ${formatHexOffset(u.offset)}`}
                    className={`h-full ${COLOR_MAP.unexplained} hover:opacity-80`}
                    aria-label={`${t.unexplainedBytes} ${formatHexOffset(u.offset)}`}
                  />
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-600" aria-hidden="true" /> Header
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" aria-hidden="true" /> Metadata / Container
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" aria-hidden="true" /> Media / Payload
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-600" aria-hidden="true" /> {t.unexplainedBytes}
              </span>
            </div>

            {coverage.unexplained.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-400 mb-2">
                  {locale === 'id' ? 'Area byte tidak terjelaskan (klik untuk buka di Hex):' : 'Unexplained byte regions (click to inspect in Hex):'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {coverage.unexplained.map((u, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onJumpToHex(u.offset)}
                      className="rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 text-xs font-mono text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50"
                    >
                      {formatHexOffset(u.offset)} · {formatNumber(u.size, locale, 0)} byte
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Expandable Structure Tree */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {locale === 'id' ? 'Pohon Struktur Internal' : 'Internal Structure Tree'}
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {locale === 'id' ? 'Klik node mana pun untuk melompat ke offset Hex' : 'Click any node to jump to its Hex offset'}
          </span>
        </div>

        {structure.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{t.deepAnalysisUnavailable}</p>
        ) : (
          <div role="tree" aria-label="File structure tree">
            {structure.map((node, idx) => (
              <TreeRow key={`${node.path}-${node.offset}-${idx}`} node={node} depth={0} onJumpToHex={onJumpToHex} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
