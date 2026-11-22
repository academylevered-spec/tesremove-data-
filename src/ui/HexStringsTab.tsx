'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeEntropyProfile, extractStrings, type EntropyPoint, type ExtractedString } from '../engine/stringsEntropy';
import type { Locale } from '../engine/types';
import { formatHexOffset, formatNumber, type Translations } from '../i18n/translations';

interface HexStringsTabProps {
  file: Blob | null;
  fileSize: number;
  jumpOffset: number | null;
  locale: Locale;
  t: Translations;
}

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 24;
const VIEWPORT_ROWS = 22;

export default function HexStringsTab({ file, fileSize, jumpOffset, locale, t }: HexStringsTabProps) {
  const initialJumpRow =
    jumpOffset !== null && jumpOffset >= 0 && jumpOffset < fileSize
      ? Math.floor(jumpOffset / BYTES_PER_ROW)
      : 0;
  const [subView, setSubView] = useState<'hex' | 'strings' | 'entropy'>('hex');
  const [scrollRow, setScrollRow] = useState(initialJumpRow);
  const [highlightByte, setHighlightByte] = useState<number | null>(
    jumpOffset !== null && jumpOffset >= 0 && jumpOffset < fileSize ? jumpOffset : null,
  );
  const [offsetInput, setOffsetInput] = useState('');
  const [windowBytes, setWindowBytes] = useState<{ startRow: number; data: Uint8Array }>({
    startRow: initialJumpRow,
    data: new Uint8Array(0),
  });

  // Strings state (keyed by minLen so loading is derived without synchronous setState in effect)
  const [minLen, setMinLen] = useState(6);
  const [stringsResult, setStringsResult] = useState<{ minLen: number; items: ExtractedString[] } | null>(null);
  const [stringFilter, setStringFilter] = useState('');
  const strings = useMemo(
    () => (stringsResult?.minLen === minLen ? stringsResult.items : []),
    [stringsResult, minLen],
  );
  const loadingStrings = Boolean(file && subView === 'strings' && stringsResult?.minLen !== minLen);

  // Entropy state
  const [entropy, setEntropy] = useState<EntropyPoint[]>([]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const totalRows = Math.max(1, Math.ceil(fileSize / BYTES_PER_ROW));
  // Clamp virtual scroll height safely within browser CSS max-height limits (use scrollbar paging for huge >200MB files)
  const MAX_VIRTUAL_PX = 12_000_000;
  const virtualRowScale = totalRows * ROW_HEIGHT > MAX_VIRTUAL_PX ? (totalRows * ROW_HEIGHT) / MAX_VIRTUAL_PX : 1;
  const totalScrollHeight = Math.round((totalRows * ROW_HEIGHT) / virtualRowScale);

  // Synchronize DOM scrollTop to initial jump offset (DOM side-effect only, no setState)
  useEffect(() => {
    if (jumpOffset !== null && jumpOffset >= 0 && jumpOffset < fileSize && scrollerRef.current) {
      const targetRow = Math.floor(jumpOffset / BYTES_PER_ROW);
      scrollerRef.current.scrollTop = Math.floor((targetRow * ROW_HEIGHT) / virtualRowScale);
    }
  }, [jumpOffset, fileSize, virtualRowScale]);

  // Load ONLY the visible byte slice from Blob (supports 100 MB - 500 MB+ files effortlessly!)
  useEffect(() => {
    if (!file || subView !== 'hex') return;
    let cancelled = false;
    const startByte = scrollRow * BYTES_PER_ROW;
    const byteCount = (VIEWPORT_ROWS + 4) * BYTES_PER_ROW;
    const endByte = Math.min(file.size, startByte + byteCount);

    file
      .slice(startByte, endByte)
      .arrayBuffer()
      .then((buf) => {
        if (!cancelled) {
          setWindowBytes({ startRow: scrollRow, data: new Uint8Array(buf) });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [file, scrollRow, subView]);

  // Lazy load strings when Strings sub-tab opened
  useEffect(() => {
    if (!file || subView !== 'strings') return;
    let cancelled = false;
    extractStrings(file, minLen, 1000)
      .then((res) => {
        if (!cancelled) {
          setStringsResult({ minLen, items: res });
        }
      })
      .catch(() => {
        if (!cancelled) setStringsResult({ minLen, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [file, minLen, subView]);

  // Lazy load entropy when Entropy sub-tab opened
  useEffect(() => {
    if (!file || subView !== 'entropy') return;
    let cancelled = false;
    computeEntropyProfile(file, 72)
      .then((pts) => {
        if (!cancelled) setEntropy(pts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file, subView]);

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = offsetInput.trim();
    if (!raw) return;
    const parsed = raw.startsWith('0x') || raw.startsWith('0X') ? parseInt(raw.slice(2), 16) : parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed >= fileSize) return;
    const row = Math.floor(parsed / BYTES_PER_ROW);
    setScrollRow(row);
    setHighlightByte(parsed);
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = Math.floor((row * ROW_HEIGHT) / virtualRowScale);
    }
  };

  const filteredStrings = useMemo(() => {
    const q = stringFilter.trim().toLowerCase();
    if (!q) return strings;
    return strings.filter((s) => s.value.toLowerCase().includes(q));
  }, [strings, stringFilter]);

  const handleExportStrings = () => {
    const content = filteredStrings.map((s) => `${formatHexOffset(s.offset)}\t${s.value}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metascope-strings.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!file) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-600 dark:text-slate-400">
        {locale === 'id'
          ? 'Hex viewer hanya tersedia saat berkas asli dimuat pada sesi aktif (laporan dari riwayat lokal tidak menyimpan byte biner file).'
          : 'Hex viewer is only available when the original file is loaded in the active session (saved history stores metadata only, not binary bytes).'}
      </div>
    );
  }

  const visibleRowCount = Math.min(VIEWPORT_ROWS, totalRows - scrollRow);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Hex and Strings views" className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          {(['hex', 'strings', 'entropy'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={subView === v}
              onClick={() => setSubView(v)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                subView === v
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {v === 'hex' ? t.hexTab : v === 'strings' ? t.stringsTab : t.entropyTab}
            </button>
          ))}
        </div>

        {subView === 'hex' && (
          <form onSubmit={handleJumpSubmit} className="flex items-center gap-2">
            <label htmlFor="hex-jump-input" className="sr-only">
              {t.jumpToOffset}
            </label>
            <input
              id="hex-jump-input"
              type="text"
              value={offsetInput}
              onChange={(e) => setOffsetInput(e.target.value)}
              placeholder="0x0000001C / 28"
              className="w-48 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="rounded-md bg-slate-900 dark:bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-sky-700 whitespace-nowrap shrink-0"
            >
              {t.goBtn}
            </button>
          </form>
        )}
      </div>

      {subView === 'hex' && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="grid grid-cols-[110px_1fr_180px] gap-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-2 text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
            <span>OFFSET</span>
            <span>00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F</span>
            <span>ASCII</span>
          </div>
          <div
            ref={scrollerRef}
            onScroll={(e) => {
              const top = e.currentTarget.scrollTop;
              const nextRow = Math.min(totalRows - 1, Math.max(0, Math.floor((top * virtualRowScale) / ROW_HEIGHT)));
              if (nextRow !== scrollRow) setScrollRow(nextRow);
            }}
            style={{ height: `${VIEWPORT_ROWS * ROW_HEIGHT}px` }}
            className="overflow-y-auto relative font-mono text-xs tabular-nums"
            tabIndex={0}
            aria-label="Virtualized hex byte viewer"
          >
            <div style={{ height: `${totalScrollHeight}px`, position: 'relative' }}>
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  left: 0,
                  right: 0,
                }}
              >
                {Array.from({ length: visibleRowCount }).map((_, idx) => {
                  const rowIdx = scrollRow + idx;
                  const rowOffset = rowIdx * BYTES_PER_ROW;
                  const relStart = (rowIdx - windowBytes.startRow) * BYTES_PER_ROW;
                  const slice =
                    relStart >= 0 && relStart < windowBytes.data.length
                      ? windowBytes.data.subarray(relStart, Math.min(windowBytes.data.length, relStart + BYTES_PER_ROW))
                      : new Uint8Array(0);

                  const isHighlightedRow =
                    highlightByte !== null && highlightByte >= rowOffset && highlightByte < rowOffset + BYTES_PER_ROW;

                  return (
                    <div
                      key={rowIdx}
                      style={{ height: `${ROW_HEIGHT}px` }}
                      className={`grid grid-cols-[110px_1fr_180px] items-center gap-4 px-4 ${
                        isHighlightedRow
                          ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-950 dark:text-sky-100'
                          : idx % 2 === 1
                            ? 'bg-slate-50/60 dark:bg-slate-900/40'
                            : ''
                      }`}
                    >
                      <span className="text-slate-500 dark:text-slate-400">{formatHexOffset(rowOffset)}</span>
                      <span className="whitespace-pre text-slate-900 dark:text-slate-100">
                        {Array.from({ length: BYTES_PER_ROW }).map((__, bIdx) => {
                          const hasByte = bIdx < slice.length;
                          const byteAbs = rowOffset + bIdx;
                          const isTarget = highlightByte === byteAbs;
                          const sep = bIdx === 7 ? '  ' : bIdx === 15 ? '' : ' ';
                          return (
                            <span
                              key={bIdx}
                              className={isTarget ? 'bg-sky-600 text-white rounded px-0.5' : ''}
                            >
                              {hasByte ? slice[bIdx].toString(16).toUpperCase().padStart(2, '0') : '  '}
                              {sep}
                            </span>
                          );
                        })}
                      </span>
                      <span className="whitespace-pre text-slate-600 dark:text-slate-400">
                        {Array.from(slice)
                          .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
                          .join('')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span className="tabular-nums">
              {formatNumber(fileSize, locale, 0)} byte · {formatNumber(totalRows, locale, 0)} {locale === 'id' ? 'baris' : 'rows'}
            </span>
            <span className="font-mono">
              {formatHexOffset(scrollRow * BYTES_PER_ROW)}
            </span>
          </div>
        </div>
      )}

      {subView === 'strings' && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  type="text"
                  value={stringFilter}
                  onChange={(e) => setStringFilter(e.target.value)}
                  placeholder={locale === 'id' ? 'Filter string...' : 'Filter strings...'}
                  aria-label="Filter strings"
                  className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>{t.minStringLen}:</span>
                <input
                  type="number"
                  min={4}
                  max={64}
                  value={minLen}
                  onChange={(e) => setMinLen(Math.max(4, Math.min(64, Number(e.target.value) || 6)))}
                  className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={handleExportStrings}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {t.exportStrings}
            </button>
          </div>
          {loadingStrings ? (
            <p className="text-xs text-slate-500">{locale === 'id' ? 'Mengekstrak string...' : 'Extracting strings...'}</p>
          ) : (
            <div className="max-h-96 overflow-auto border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800">
              {filteredStrings.slice(0, 400).map((s, idx) => (
                <div key={idx} className="flex items-start gap-4 px-3 py-1.5 text-xs font-mono hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <button
                    type="button"
                    onClick={() => {
                      setSubView('hex');
                      const row = Math.floor(s.offset / BYTES_PER_ROW);
                      setScrollRow(row);
                      setHighlightByte(s.offset);
                    }}
                    className="text-sky-600 dark:text-sky-400 hover:underline shrink-0"
                  >
                    {formatHexOffset(s.offset)}
                  </button>
                  <span className="text-slate-800 dark:text-slate-200 break-all">{s.value}</span>
                </div>
              ))}
              {filteredStrings.length === 0 && (
                <p className="p-4 text-xs text-slate-500">
                  {locale === 'id' ? 'Tidak ada string yang cocok.' : 'No matching strings.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {subView === 'entropy' && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {locale === 'id' ? 'Profil Entropi Shannon (0–8 bit/byte)' : 'Shannon Byte Entropy Profile (0–8 bits/byte)'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-4">
            {locale === 'id'
              ? 'Nilai mendekati 8 bit/byte menandakan data terkompresi atau terenkripsi (mis. bitstream video/IDAT); nilai rendah menandakan header, teks, atau padding.'
              : 'Values near 8 bits/byte indicate compressed or encrypted payloads (e.g., video bitstream/IDAT); low values indicate headers, text, or padding.'}
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={entropy}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                <XAxis
                  dataKey="offset"
                  tickFormatter={(v) => `0x${Number(v).toString(16)}`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis domain={[0, 8]} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => [`${v} bits/byte`, 'Entropy']}
                  labelFormatter={(l) => `Offset ${formatHexOffset(Number(l))}`}
                />
                <Area type="monotone" dataKey="entropy" stroke="#0284c7" fill="#0ea5e9" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
