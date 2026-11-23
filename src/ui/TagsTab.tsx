'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Search, X } from 'lucide-react';
import type { Locale, TagEntry } from '../engine/types';
import { formatHexOffset, type Translations } from '../i18n/translations';

interface TagsTabProps {
  tags: TagEntry[];
  initialSearch?: string;
  onJumpToHex: (offset: number) => void;
  locale: Locale;
  t: Translations;
}

export default function TagsTab({ tags, initialSearch = '', onJumpToHex, locale, t }: TagsTabProps) {
  const [query, setQuery] = useState(initialSearch);
  const [nsFilter, setNsFilter] = useState<string>('ALL');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const tag of tags) set.add(tag.ns);
    return Array.from(set).sort();
  }, [tags]);

  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return tags.filter((tag) => {
      if (nsFilter !== 'ALL' && tag.ns !== nsFilter) return false;
      if (!q) return true;
      const combined = `${tag.ns}:${tag.name} ${tag.decoded ?? ''} ${typeof tag.raw === 'object' ? JSON.stringify(tag.raw) : String(tag.raw ?? '')} ${tag.source}`.toLowerCase();
      return combined.includes(q);
    });
  }, [tags, deferredQuery, nsFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, TagEntry[]>();
    for (const tag of filtered) {
      const list = map.get(tag.ns) ?? [];
      list.push(tag);
      map.set(tag.ns, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <label htmlFor="tag-search-input" className="sr-only">
            {t.searchTagsPlaceholder}
          </label>
          <input
            id="tag-search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchTagsPlaceholder}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-10 pr-9 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={locale === 'id' ? 'Bersihkan pencarian' : 'Clear search'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <label htmlFor="ns-filter-select" className="sr-only">
          Namespace filter
        </label>
        <select
          id="ns-filter-select"
          value={nsFilter}
          onChange={(e) => setNsFilter(e.target.value)}
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.03)] cursor-pointer"
        >
          <option value="ALL">{t.allNamespaces} ({tags.length})</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
          {locale === 'id' ? `${filtered.length} dari ${tags.length} tag` : `${filtered.length} of ${tags.length} tags`}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-10 text-center space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {locale === 'id' ? 'Tidak ada tag yang cocok dengan filter.' : 'No tags match the current filter.'}
          </p>
          {(query || nsFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setNsFilter('ALL');
              }}
              className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
            >
              {locale === 'id' ? 'Reset filter' : 'Reset filters'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([ns, items]) => (
            <section
              key={ns}
              className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50/80 dark:bg-slate-950/60 border-b border-slate-200/80 dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white font-mono">{ns}</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{items.length} tag</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-2 px-4 font-medium w-48">{t.colTagName}</th>
                      <th className="py-2 px-4 font-medium">{t.colDecodedValue}</th>
                      <th className="py-2 px-4 font-medium">{t.colRawValue}</th>
                      <th className="py-2 px-4 font-medium w-32">{t.colSource}</th>
                      <th className="py-2 px-4 font-medium w-28">{t.colOffset}</th>
                      <th className="py-2 px-4 font-medium w-16 text-right">{t.copy}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {items.map((tag, idx) => {
                      const rowId = `${ns}-${tag.name}-${idx}`;
                      const rawStr =
                        typeof tag.raw === 'object' && tag.raw !== null ? JSON.stringify(tag.raw) : String(tag.raw ?? '');
                      const decodedStr = tag.decoded !== undefined ? tag.decoded : rawStr;
                      const isZeroed = decodedStr.includes('dikosongkan') || rawStr === '0000:00:00 00:00:00';
                      return (
                        <tr key={rowId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                          <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-900 dark:text-slate-100 break-words">
                            {tag.name}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-800 dark:text-slate-200 break-all">
                            <span className={isZeroed ? 'text-amber-700 dark:text-amber-400 font-medium' : ''}>
                              {decodedStr}
                            </span>
                            {tag.discrepancy && (
                              <div className="mt-1 flex items-start gap-1 text-xs text-amber-800 dark:text-amber-300">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                                <span>
                                  <strong>{t.discrepancyLabel}</strong> ({tag.discrepancy.otherSource}): {tag.discrepancy.otherValue}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 break-all">
                            {rawStr}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {tag.source}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs tabular-nums">
                            {tag.offset !== undefined ? (
                              <button
                                type="button"
                                onClick={() => onJumpToHex(tag.offset!)}
                                className="text-sky-600 dark:text-sky-400 hover:underline"
                              >
                                {formatHexOffset(tag.offset)}
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleCopy(rowId, decodedStr)}
                              aria-label={`${t.copy} ${tag.name}`}
                              className="inline-flex items-center justify-center rounded-lg min-h-[36px] min-w-[36px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              {copiedKey === rowId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
