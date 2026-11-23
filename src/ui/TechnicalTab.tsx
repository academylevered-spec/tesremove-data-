'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Film, Music, XCircle } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Locale, Report } from '../engine/types';
import { formatHexOffset, formatNumber, type Translations } from '../i18n/translations';

interface TechnicalTabProps {
  report: Report;
  file: Blob | null;
  onJumpToHex: (offset: number) => void;
  locale: Locale;
  t: Translations;
}

export default function TechnicalTab({ report, file, onJumpToHex, locale, t }: TechnicalTabProps) {
  const { video, image, audio, document: doc } = report.technical;
  const { bitstream, stats } = report;
  const [failedMediaUrl, setFailedMediaUrl] = useState<string | null>(null);

  // Create and cleanly revoke local Object URL for image/video/audio preview (never uploaded)
  const localMediaUrl = useMemo(() => {
    if (!file || (!image && !video && !audio) || typeof URL === 'undefined') return null;
    return URL.createObjectURL(file);
  }, [file, image, video, audio]);

  useEffect(() => {
    return () => {
      if (localMediaUrl) URL.revokeObjectURL(localMediaUrl);
    };
  }, [localMediaUrl]);

  const mainImageUrl = image ? localMediaUrl : null;
  const videoUrl = video ? localMediaUrl : null;
  const audioUrl = audio ? localMediaUrl : null;
  const videoPreviewError = Boolean(videoUrl && failedMediaUrl === videoUrl);
  const audioPreviewError = Boolean(audioUrl && failedMediaUrl === audioUrl);

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  if (!video && !image && !audio && !doc) {
    return (
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-8 text-sm text-slate-600 dark:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {t.deepAnalysisUnavailable}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* VIDEO PANEL */}
      {video && (
        <>
          {videoUrl && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                  <Film className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Pratinjau Video Lokal' : 'Local Video Preview'}</span>
                </h3>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {video.width && video.height ? `${video.width}×${video.height}` : ''}{video.codec ? ` · ${video.codec}` : ''}
                </span>
              </div>
              {videoPreviewError ? (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span>
                    {locale === 'id'
                      ? 'Browser di perangkat ini belum mendukung pemutaran langsung codec/kontainer ini. Semua metadata biner tetap terbaca penuh — Anda dapat mengonversinya ke preset universal di tab Kompres.'
                      : 'This browser does not natively decode this video codec/container. All binary metadata is still parsed accurately — you can convert it to a universal preset in the Compress tab.'}
                  </span>
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-200/80 dark:border-slate-800">
                  <video
                    key={videoUrl}
                    src={videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      if (e.currentTarget.videoWidth === 0 || e.currentTarget.videoHeight === 0) {
                        setFailedMediaUrl(videoUrl);
                      }
                    }}
                    onError={() => setFailedMediaUrl(videoUrl)}
                    className="w-full max-h-80 object-contain mx-auto"
                  />
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">
              {locale === 'id' ? 'Ringkasan Kontainer & Video' : 'Container & Video Summary'}
            </h3>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Brand ftyp</dt>
                <dd className="font-mono font-medium text-slate-900 dark:text-slate-100">
                  {video.majorBrand ?? '—'} {video.compatibleBrands?.length ? `(${video.compatibleBrands.join(', ')})` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Faststart</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">
                  {video.faststart ? (locale === 'id' ? 'Ya (moov sebelum mdat)' : 'Yes (moov before mdat)') : 'Tidak'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Overhead Non-Media' : 'Non-Media Overhead'}
                </dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatNumber(video.nonMediaOverheadBytes, locale, 0)} byte ({formatNumber(video.nonMediaOverheadPercent, locale)}%)
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Resolusi & FPS' : 'Resolution & FPS'}
                </dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {video.width && video.height ? `${video.width}×${video.height}` : '—'}{' '}
                  {video.fps ? `· ${formatNumber(video.fps, locale)} fps` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Codec & Profil</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {[video.codec, video.profile, video.level ? `Level ${video.level}` : ''].filter(Boolean).join(' ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Format Piksel & Warna' : 'Pixel Format & Color'}
                </dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {[video.pixelFormat, video.colorSpace].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Kepadatan Bit' : 'Bit Density'}
                </dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {video.bitDensity !== undefined ? `${formatNumber(video.bitDensity, locale, 4)} bit/px` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Audio</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {video.audioCodec
                    ? `${video.audioCodec}, ${video.audioSampleRate ? `${formatNumber(video.audioSampleRate, locale, 0)} Hz` : '—'}, ${
                        video.audioChannels === 2 ? 'stereo' : video.audioChannels === 1 ? 'mono' : `${video.audioChannels ?? '?'} ch`
                      }`
                    : '—'}
                </dd>
              </div>
            </dl>
          </section>

          {/* Tracks table */}
          <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {locale === 'id' ? 'Tabel Track Media' : 'Media Tracks'}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-4">ID</th>
                    <th className="py-2 px-4">Tipe</th>
                    <th className="py-2 px-4">Codec</th>
                    <th className="py-2 px-4 text-right">Durasi (s)</th>
                    <th className="py-2 px-4 text-right">Sampel</th>
                    <th className="py-2 px-4 text-right">Timescale</th>
                    <th className="py-2 px-4 text-right">Bitrate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {video.tracks.map((tr) => (
                    <tr key={tr.id}>
                      <td className="py-2.5 px-4">{tr.id}</td>
                      <td className="py-2.5 px-4 font-sans">{tr.type} ({tr.handler})</td>
                      <td className="py-2.5 px-4">{tr.codec}</td>
                      <td className="py-2.5 px-4 text-right">{formatNumber(tr.durationSec, locale, 4)}</td>
                      <td className="py-2.5 px-4 text-right">{formatNumber(tr.sampleCount, locale, 0)}</td>
                      <td className="py-2.5 px-4 text-right">{formatNumber(tr.timescale, locale, 0)} Hz</td>
                      <td className="py-2.5 px-4 text-right">
                        {tr.bitrateBps ? `${formatNumber(tr.bitrateBps, locale, 0)} bps` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Bitstream: hvcC/avcC + NAL + SEI */}
          {bitstream && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Bitstream ({bitstream.codec.toUpperCase()} — {bitstream.codec === 'hevc' ? 'hvcC' : 'avcC'}, NAL &amp; SEI)
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {Object.entries(bitstream.config).map(([k, v]) => (
                  <div key={k} className="rounded border border-slate-200 dark:border-slate-800 p-2.5">
                    <span className="text-slate-500 dark:text-slate-400 block">{k}</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {Array.isArray(v) ? v.join(', ') : String(v)}
                    </span>
                  </div>
                ))}
              </div>

              {bitstream.nalArrays && bitstream.nalArrays.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Array NAL Konfigurasi hvcC ({bitstream.nalArrays.length} array)
                  </h4>
                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    {bitstream.nalArrays.map((arr, i) => (
                      <span key={i} className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1">
                        {arr.nalTypeName} (tipe {arr.nalType}): {arr.lengths.map((l) => `${l} B`).join(', ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Urutan Tipe NAL pada Sampel Video Pertama' : 'First Video Sample NAL Unit Types'}
                </h4>
                <p className="font-mono text-xs text-slate-900 dark:text-slate-100">
                  {bitstream.firstSampleNals.length > 0 ? bitstream.firstSampleNals.join(', ') : '—'}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  SEI User-Data Unregistered (Payload Type 5)
                </h4>
                {bitstream.seiUserData.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {locale === 'id' ? 'Tidak ada SEI user-data pada sampel pertama.' : 'No SEI user-data found in first sample.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {bitstream.seiUserData.map((sei, i) => (
                      <div key={i} className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400">UUID: {sei.uuid}</span>
                          {sei.offset !== undefined && (
                            <button
                              type="button"
                              onClick={() => onJumpToHex(sei.offset!)}
                              className="text-sky-600 dark:text-sky-400 hover:underline"
                            >
                              {formatHexOffset(sei.offset)}
                            </button>
                          )}
                        </div>
                        <div className="text-slate-900 dark:text-slate-100 font-semibold break-all">{sei.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Video Stats: Bitrate per Second & GOP Charts + Keyframe list */}
          {stats && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {locale === 'id' ? 'Statistik Bitrate & GOP (Detik Penuh)' : 'Bitrate & GOP Statistics (Full Seconds)'}
                </h3>
                <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  Mean {formatNumber(stats.kbpsPerSecond.mean, locale, 0)} kbps · Median {formatNumber(stats.kbpsPerSecond.median, locale, 0)} kbps · Min{' '}
                  {formatNumber(stats.kbpsPerSecond.min, locale, 0)} kbps · Max {formatNumber(stats.kbpsPerSecond.max, locale, 0)} kbps · SD{' '}
                  {formatNumber(stats.kbpsPerSecond.stdev, locale, 0)} kbps ({stats.kbpsPerSecond.fullSeconds} s)
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">
                    {locale === 'id' ? 'Bitrate per Detik (kbps)' : 'Bitrate per Second (kbps)'}
                  </h4>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stats.kbpsPerSecond.series}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                        <XAxis dataKey="second" tick={{ fontSize: 11 }} unit="s" />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [`${v} kbps`, 'Bitrate']} labelFormatter={(l) => `Detik ke-${l}`} />
                        <Line type="monotone" dataKey="kbps" stroke="#0284c7" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">
                    {locale === 'id' ? 'Jarak Antar-Keyframe / GOP (detik)' : 'Keyframe / GOP Intervals (seconds)'}
                  </h4>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.gopGaps.map((g, i) => ({ gop: `GOP ${i + 1}`, seconds: g }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                        <XAxis dataKey="gop" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} unit="s" />
                        <Tooltip formatter={(v) => [`${v} s`, 'GOP Gap']} />
                        <Bar dataKey="seconds" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  {locale === 'id'
                    ? `Daftar Keyframe (${stats.keyframes} keyframe, GOP maks ${stats.maxGopFrames} frame / ${formatNumber(stats.maxGopSec, locale)} s)`
                    : `Keyframes (${stats.keyframes} keyframes, max GOP ${stats.maxGopFrames} frames / ${formatNumber(stats.maxGopSec, locale)} s)`}
                </h4>
                <p className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 leading-relaxed">
                  {stats.keyframeTimes.map((kt) => `${formatNumber(kt, locale, 2)} s`).join(' · ')}
                </p>
              </div>
            </section>
          )}
        </>
      )}

      {/* IMAGE PANEL */}
      {image && (
        <>
          <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {locale === 'id' ? 'Data Teknis Gambar' : 'Image Technical Details'}
            </h3>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Format</dt>
                <dd className="font-mono font-medium text-slate-900 dark:text-slate-100">{image.format}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">{locale === 'id' ? 'Dimensi' : 'Dimensions'}</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {image.width && image.height ? `${formatNumber(image.width, locale, 0)} × ${formatNumber(image.height, locale, 0)} px` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Subsampling / Mode</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {[image.subsampling, image.progressive !== undefined ? (image.progressive ? 'Progressive' : 'Baseline') : '']
                    .filter(Boolean)
                    .join(' · ') || image.colorSpace || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Estimasi Kualitas JPEG' : 'Estimated JPEG Quality'}
                </dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {image.estimatedQuality !== undefined ? `~${image.estimatedQuality} / 100` : '—'}
                </dd>
              </div>
              {image.iccProfile && (
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Profil ICC</dt>
                  <dd className="font-mono text-slate-900 dark:text-slate-100">
                    {image.iccProfile.name ?? 'ICC'}{image.iccProfile.colorSpace ? ` · ${image.iccProfile.colorSpace}` : ''}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Side-by-side Main Image vs Embedded Thumbnail */}
          {(mainImageUrl || image.thumbnail?.present) && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {locale === 'id' ? 'Pratinjau Lokal & Thumbnail Tertanam' : 'Local Preview & Embedded Thumbnail'}
                </h3>
                {image.thumbnail?.aspectRatioDiff !== undefined && image.thumbnail.aspectRatioDiff > 0.12 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {locale === 'id'
                      ? `Rasio aspek berbeda (selisih ${image.thumbnail.aspectRatioDiff}) — kemungkinan gambar dipotong`
                      : `Aspect ratio mismatch (delta ${image.thumbnail.aspectRatioDiff}) — image may be cropped`}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {locale === 'id' ? 'Gambar Utama' : 'Main Image'} ({image.width ?? '?'}×{image.height ?? '?'})
                  </p>
                  {mainImageUrl ? (
                    <div className="h-52 rounded border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 flex items-center justify-center overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mainImageUrl} alt={report.file.name} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : (
                    <div className="h-52 rounded border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-xs text-slate-400">
                      —
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {locale === 'id' ? 'Thumbnail Tertanam EXIF' : 'Embedded EXIF Thumbnail'}{' '}
                    {image.thumbnail?.present
                      ? `(${image.thumbnail.width ?? '?'}×${image.thumbnail.height ?? '?'}, ${formatNumber(image.thumbnail.size ?? 0, locale, 0)} byte)`
                      : `(${locale === 'id' ? 'tidak ada' : 'none'})`}
                  </p>
                  {image.thumbnail?.dataUrl ? (
                    <div className="h-52 rounded border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 flex items-center justify-center overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.thumbnail.dataUrl} alt="Embedded EXIF Thumbnail" className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : (
                    <div className="h-52 rounded border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-xs text-slate-400">
                      {locale === 'id' ? 'Tidak ada thumbnail tertanam' : 'No embedded thumbnail'}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* JPEG DQT Quantization Table Chart */}
          {image.quantizationTables && image.quantizationTables.length > 0 && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {locale === 'id' ? 'Tabel Kuantisasi JPEG (DQT)' : 'JPEG Quantization Tables (DQT)'}
              </h3>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={image.quantizationTables[0].values.map((v, idx) => ({ idx, value: v }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                    <XAxis dataKey="idx" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#0284c7" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-8 gap-1 font-mono text-[11px] tabular-nums text-center">
                {image.quantizationTables[0].values.map((v, i) => (
                  <div key={i} className="rounded bg-slate-100 dark:bg-slate-800 py-1 text-slate-800 dark:text-slate-200">
                    {v}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* PNG Chunks & CRC Verification */}
          {image.pngChunks && image.pngChunks.length > 0 && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {locale === 'id' ? 'Verifikasi Chunk & CRC32 PNG' : 'PNG Chunks & CRC32 Verification'}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 px-4">Chunk</th>
                      <th className="py-2 px-4">Offset</th>
                      <th className="py-2 px-4 text-right">Ukuran</th>
                      <th className="py-2 px-4">CRC Aktual</th>
                      <th className="py-2 px-4">Status CRC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {image.pngChunks.map((c, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-4 font-semibold">{c.type}</td>
                        <td className="py-2 px-4">
                          <button type="button" onClick={() => onJumpToHex(c.offset)} className="text-sky-600 dark:text-sky-400 hover:underline">
                            {formatHexOffset(c.offset)}
                          </button>
                        </td>
                        <td className="py-2 px-4 text-right">{formatNumber(c.size, locale, 0)} B</td>
                        <td className="py-2 px-4">0x{c.actualCrc}</td>
                        <td className="py-2 px-4 font-sans">
                          {c.crcValid ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-semibold">
                              <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Gagal (seharusnya 0x{c.expectedCrc})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* AUDIO PANEL */}
      {audio && (
        <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <Music className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span>{locale === 'id' ? 'Data Teknis Audio' : 'Audio Technical Details'}</span>
            </h3>
          </div>
          {audioUrl && !audioPreviewError && (
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3">
              <audio
                key={audioUrl}
                src={audioUrl}
                controls
                preload="metadata"
                onError={() => setFailedMediaUrl(audioUrl)}
                className="w-full h-10"
              />
            </div>
          )}
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Codec</dt>
              <dd className="font-mono">{audio.codec ?? audio.format}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Durasi</dt>
              <dd className="font-mono tabular-nums">{audio.durationSec !== undefined ? `${formatNumber(audio.durationSec, locale)} s` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Sample Rate</dt>
              <dd className="font-mono tabular-nums">{audio.sampleRate ? `${formatNumber(audio.sampleRate, locale, 0)} Hz` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Bitrate</dt>
              <dd className="font-mono tabular-nums">{audio.bitrateBps ? `${formatNumber(Math.round(audio.bitrateBps / 1000), locale, 0)} kbps` : '—'}</dd>
            </div>
            {audio.encoder && (
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">Encoder</dt>
                <dd className="font-mono">{audio.encoder}</dd>
              </div>
            )}
          </dl>

          {audio.coverArt && audio.coverArt.length > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">Cover Art</h4>
              <div className="flex flex-wrap gap-4">
                {audio.coverArt.map((cov, idx) => (
                  <div key={idx} className="space-y-2">
                    {cov.dataUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cov.dataUrl} alt={cov.description ?? 'Cover art'} className="h-36 w-36 rounded border border-slate-200 dark:border-slate-800 object-cover" />
                    )}
                    {cov.dataUrl && (
                      <button
                        type="button"
                        onClick={() => downloadDataUrl(cov.dataUrl!, `cover_${idx + 1}.jpg`)}
                        className="inline-flex items-center gap-1.5 text-xs text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        {locale === 'id' ? 'Unduh cover art' : 'Download cover art'} ({formatNumber(cov.size, locale, 0)} B)
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* DOCUMENT & ARCHIVE PANEL */}
      {doc && (
        <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {locale === 'id' ? `Inspeksi Dokumen / Arsip (${doc.format})` : `Document / Archive Inspection (${doc.format})`}
          </h3>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {doc.pdfVersion && (
              <div>
                <dt className="text-xs text-slate-500">Versi PDF</dt>
                <dd className="font-mono">{doc.pdfVersion}</dd>
              </div>
            )}
            {doc.revisions !== undefined && (
              <div>
                <dt className="text-xs text-slate-500">{locale === 'id' ? 'Jumlah Revisi' : 'Revisions'}</dt>
                <dd className="font-mono tabular-nums">{doc.revisions}</dd>
              </div>
            )}
            {doc.author && (
              <div>
                <dt className="text-xs text-slate-500">{locale === 'id' ? 'Pembuat / Penulis' : 'Author'}</dt>
                <dd>{doc.author}</dd>
              </div>
            )}
            {doc.lastModifiedBy && (
              <div>
                <dt className="text-xs text-slate-500">{locale === 'id' ? 'Penyunting Terakhir' : 'Last Modified By'}</dt>
                <dd>{doc.lastModifiedBy}</dd>
              </div>
            )}
            {doc.application && (
              <div>
                <dt className="text-xs text-slate-500">Aplikasi</dt>
                <dd>{doc.application}</dd>
              </div>
            )}
            {doc.company && (
              <div>
                <dt className="text-xs text-slate-500">{locale === 'id' ? 'Organisasi' : 'Company'}</dt>
                <dd>{doc.company}</dd>
              </div>
            )}
            {doc.hasJavaScript !== undefined && (
              <div>
                <dt className="text-xs text-slate-500">JavaScript</dt>
                <dd className={doc.hasJavaScript ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}>
                  {doc.hasJavaScript ? 'Terdeteksi' : 'Tidak ada'}
                </dd>
              </div>
            )}
            {doc.hasMacros !== undefined && (
              <div>
                <dt className="text-xs text-slate-500">Makro VBA</dt>
                <dd className="font-semibold text-amber-700 dark:text-amber-400">vbaProject.bin terdeteksi</dd>
              </div>
            )}
          </dl>

          {doc.comments && doc.comments.length > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                {locale === 'id' ? `Komentar Tersembunyi (${doc.comments.length})` : `Embedded Comments (${doc.comments.length})`}
              </h4>
              <div className="space-y-2">
                {doc.comments.map((c, idx) => (
                  <div key={idx} className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs">
                    <div className="text-slate-500 dark:text-slate-400 mb-1">
                      <strong>{c.author ?? 'Unknown'}</strong> · {c.date ?? '—'} · {c.source}
                    </div>
                    <p className="text-slate-900 dark:text-slate-100">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {doc.trackedChanges && doc.trackedChanges.length > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                {locale === 'id' ? `Perubahan Terlacak / Track Changes (${doc.trackedChanges.length})` : `Tracked Changes (${doc.trackedChanges.length})`}
              </h4>
              <div className="space-y-2">
                {doc.trackedChanges.map((tc, idx) => (
                  <div key={idx} className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs">
                    <div className="text-slate-500 dark:text-slate-400 mb-1">
                      <strong>{tc.type === 'delete' ? 'Dihapus' : 'Disisipkan'}</strong> · {tc.author ?? 'Unknown'} · {tc.date ?? '—'}
                    </div>
                    <p className={`font-mono ${tc.type === 'delete' ? 'line-through text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                      {tc.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {doc.archiveEntries && doc.archiveEntries.length > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                {locale === 'id' ? `Daftar Entri Arsip (${doc.archiveEntries.length})` : `Archive Entries (${doc.archiveEntries.length})`}
              </h4>
              <div className="max-h-64 overflow-auto border border-slate-200 dark:border-slate-800 rounded">
                <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                  <thead className="bg-slate-50 dark:bg-slate-950 sticky top-0">
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3">Nama Entri</th>
                      <th className="py-2 px-3 text-right">Asli</th>
                      <th className="py-2 px-3 text-right">Terkompresi</th>
                      <th className="py-2 px-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {doc.archiveEntries.map((e, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 px-3 break-all">{e.name}</td>
                        <td className="py-1.5 px-3 text-right">{formatNumber(e.uncompressedSize, locale, 0)} B</td>
                        <td className="py-1.5 px-3 text-right">{formatNumber(e.compressedSize, locale, 0)} B</td>
                        <td className="py-1.5 px-3 text-slate-500">{e.modifiedAt ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
