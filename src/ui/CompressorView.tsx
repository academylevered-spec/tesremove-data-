'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSearch,
  FileVideo,
  Film,
  Gauge,
  Globe,
  Loader2,
  Play,
  RotateCcw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Upload,
  Zap,
} from 'lucide-react';
import type { Locale } from '../engine/types';
import {
  CODEC_PROFILES,
  computeTargetBitratePlan,
  DEFAULT_COMPRESS_OPTIONS,
  PLATFORM_PRESETS,
  resolveEffectiveCrf,
  type AudioMode,
  type CompressOptions,
  type CompressionRecommendation,
  type PlatformPreset,
  type ProbedVideoInfo,
  type QualityPreset,
  type SmartDenoiseMode,
  type SpeedEffort,
  type TargetFps,
  type TargetResolution,
  type VideoCodecId,
} from '../engine/videoCompress';
import { formatBytes, formatNumber, type Translations } from '../i18n/translations';

interface CompressorViewProps {
  locale: Locale;
  t: Translations;
  initialFile?: { blob: Blob; name: string } | null;
  onConsumeInitialFile?: () => void;
  onInspectVideo: (blob: Blob, filename: string) => void;
}

interface ServerCapabilities {
  available: boolean;
  pythonEngine?: boolean;
  encoders: Record<VideoCodecId, boolean>;
  maxUploadMb: number;
}

interface PipelineStageLog {
  stage: string;
  detail: string;
  elapsed_ms: number;
}

interface CompressStats {
  engine?: string;
  originalSize: number;
  compressedSize: number;
  bytesSaved: number;
  reductionPercent: number;
  originalCodec: string;
  compressedCodec: string;
  originalBitrateKbps: number;
  compressedBitrateKbps: number;
  width: number;
  height: number;
  durationSec: number;
  pixFmt: string;
  effectiveCrf: number | null;
  targetBitrateKbps: number | null;
  vbvMaxrateKbps?: number | null;
  usesTwoPass?: boolean;
  ssimPercent?: number | null;
  psnrDb?: number | null;
  sourceBpp?: number | null;
  motionScore?: number | null;
  complexityClass?: string;
  denoiseApplied?: boolean;
  smartAudioOptimized?: boolean;
  antiBloatTriggered?: boolean;
  antiBloatReason?: string | null;
  attempts?: number;
  universalPlayable?: boolean;
  elapsedMs: number;
  filename: string;
  mime: string;
  strippedMetadata: boolean;
  stages?: PipelineStageLog[];
}

interface CompressResultState {
  blob: Blob;
  stats: CompressStats;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0s';
  const mins = Math.floor(sec / 60);
  const rem = Math.round((sec % 60) * 10) / 10;
  return mins > 0 ? `${mins}m ${rem}s` : `${rem}s`;
}

function crfQualityLabel(codec: VideoCodecId, crf: number, locale: Locale): string {
  const p = CODEC_PROFILES[codec].crfRange;
  if (crf <= p.visuallyLossless - 2) {
    return locale === 'id' ? 'Hampir identik master (ukuran lebih besar)' : 'Near-master transparency (larger file)';
  }
  if (crf <= p.visuallyLossless + 1) {
    return locale === 'id' ? 'Tanpa turun kualitas (Visually Lossless)' : 'Visually lossless (indistinguishable)';
  }
  if (crf <= p.balanced + 1) {
    return locale === 'id' ? 'Sangat tajam & hemat ruang' : 'Very sharp & space-efficient';
  }
  return locale === 'id' ? 'Kompresi agresif (ukuran minimal)' : 'Aggressive compression (minimum size)';
}

let cachedCodecSupport: Record<VideoCodecId, boolean> | null = null;
const subscribeNoop = () => () => {};

function getBrowserCodecSupportSnapshot(): Record<VideoCodecId, boolean> | null {
  if (typeof document === 'undefined') return null;
  if (cachedCodecSupport) return cachedCodecSupport;
  try {
    const v = document.createElement('video');
    const check = (cid: VideoCodecId) =>
      CODEC_PROFILES[cid].canPlayTypeStrings.some((s) => v.canPlayType(s) !== '');
    cachedCodecSupport = {
      hevc: check('hevc'),
      av1: check('av1'),
      vp9: check('vp9'),
      h264: check('h264'),
    };
    return cachedCodecSupport;
  } catch {
    return null;
  }
}

export default function CompressorView({
  locale,
  t,
  initialFile,
  onConsumeInitialFile,
  onInspectVideo,
}: CompressorViewProps) {
  const [caps, setCaps] = useState<ServerCapabilities | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sourceFile, setSourceFile] = useState<{ blob: Blob; name: string } | null>(null);
  const [probed, setProbed] = useState<ProbedVideoInfo | null>(null);
  const [recommendation, setRecommendation] = useState<CompressionRecommendation | null>(null);
  const [options, setOptions] = useState<CompressOptions>(DEFAULT_COMPRESS_OPTIONS);

  const [probing, setProbing] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<CompressResultState | null>(null);
  const [previewTarget, setPreviewTarget] = useState<'compressed' | 'original' | 'split'>('compressed');
  const [previewPlaybackError, setPreviewPlaybackError] = useState(false);
  const browserCodecSupport = useSyncExternalStore(subscribeNoop, getBrowserCodecSupportSnapshot, () => null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const consumedInitialRef = useRef<Blob | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const splitCompressedRef = useRef<HTMLVideoElement | null>(null);
  const splitOriginalRef = useRef<HTMLVideoElement | null>(null);

  // Fetch server FFmpeg capabilities on mount
  useEffect(() => {
    let active = true;
    fetch('/api/compress')
      .then((r) => r.json())
      .then((data) => {
        if (active && data && typeof data.available === 'boolean') {
          setCaps({
            available: data.available,
            encoders: data.encoders,
            maxUploadMb: data.maxUploadMb ?? 200,
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Elapsed seconds ticker during live FFmpeg compression
  useEffect(() => {
    if (!compressing) return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [compressing]);

  // Manage object URLs cleanly for side-by-side HTML5 video preview
  const sourceUrl = useMemo(() => (sourceFile ? URL.createObjectURL(sourceFile.blob) : null), [sourceFile]);
  const resultUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const handleLoadVideo = useCallback(
    async (blob: Blob, name: string) => {
      setErrorMsg(null);
      setResult(null);
      setProbed(null);
      setRecommendation(null);
      setSourceFile({ blob, name });
      setProbing(true);

      try {
        const fd = new FormData();
        fd.append('file', blob, name);
        fd.append('action', 'probe');
        const res = await fetch('/api/compress', { method: 'POST', body: fd });
        const data = (await res.json()) as {
          status?: string;
          message?: string;
          probed?: ProbedVideoInfo;
          recommendation?: CompressionRecommendation;
          capabilities?: ServerCapabilities;
        };

        if (!res.ok || !data.probed) {
          throw new Error(data.message || (locale === 'id' ? 'Gagal membaca info video.' : 'Failed to inspect video.'));
        }

        setProbed(data.probed);
        if (data.capabilities) setCaps(data.capabilities);
        if (data.recommendation) {
          setRecommendation(data.recommendation);
          const recCodec = data.recommendation.codec;
          const defaultTargetMb = Math.max(
            0.5,
            Math.round(((data.probed.sizeBytes * 0.45) / (1024 * 1024)) * 10) / 10,
          );
          setOptions((prev) => ({
            ...prev,
            codec: recCodec,
            crf: CODEC_PROFILES[recCodec].crfRange.visuallyLossless,
            targetSizeMb: defaultTargetMb,
            tenBit: data.recommendation?.tenBit ?? CODEC_PROFILES[recCodec].defaultTenBit,
            platformPreset: recCodec === 'av1' ? 'max_efficiency_av1' : recCodec === 'hevc' ? 'hevc_10bit' : 'auto',
          }));
        }
      } catch (err) {
        setErrorMsg((err as Error)?.message || (locale === 'id' ? 'Gagal memeriksa video.' : 'Failed to inspect video.'));
        setSourceFile(null);
      } finally {
        setProbing(false);
      }
    },
    [locale],
  );

  // Auto-load when user clicks "Kompres video" from ReportView
  useEffect(() => {
    if (initialFile && consumedInitialRef.current !== initialFile.blob) {
      consumedInitialRef.current = initialFile.blob;
      onConsumeInitialFile?.();
      void handleLoadVideo(initialFile.blob, initialFile.name);
    }
  }, [initialFile, onConsumeInitialFile, handleLoadVideo]);

  const handleLoadSampleHd = async () => {
    setErrorMsg(null);
    setLoadingSample(true);
    try {
      const res = await fetch('/api/compress?sample=1');
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Gagal membuat video contoh HD.');
      }
      const blob = await res.blob();
      await handleLoadVideo(blob, 'sample_hd_720p_3s.mp4');
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Gagal memuat video contoh HD.');
    } finally {
      setLoadingSample(false);
    }
  };

  const handleCancelCompress = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  };

  const handleStartCompress = async (overrideOptions?: CompressOptions) => {
    if (!sourceFile) return;
    const effectiveOpts = overrideOptions ?? options;
    if (overrideOptions) setOptions(overrideOptions);

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setErrorMsg(null);
    setPreviewPlaybackError(false);
    setElapsedSec(0);
    setCompressing(true);
    try {
      const fd = new FormData();
      fd.append('file', sourceFile.blob, sourceFile.name);
      fd.append('action', 'compress');
      fd.append('options', JSON.stringify(effectiveOpts));

      const res = await fetch('/api/compress', { method: 'POST', body: fd, signal: controller.signal });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Server mengembalikan HTTP ${res.status}.`);
      }

      const statsHeader = res.headers.get('X-MetaScope-Compress-Stats');
      const rawBlob = await res.blob();
      const stats: CompressStats = statsHeader
        ? (JSON.parse(decodeURIComponent(statsHeader)) as CompressStats)
        : {
            originalSize: sourceFile.blob.size,
            compressedSize: rawBlob.size,
            bytesSaved: sourceFile.blob.size - rawBlob.size,
            reductionPercent:
              sourceFile.blob.size > 0
                ? Math.round(((sourceFile.blob.size - rawBlob.size) / sourceFile.blob.size) * 1000) / 10
                : 0,
            originalCodec: probed?.videoCodec ?? 'unknown',
            compressedCodec: effectiveOpts.codec,
            originalBitrateKbps: probed?.bitrateKbps ?? 0,
            compressedBitrateKbps: 0,
            width: probed?.width ?? 0,
            height: probed?.height ?? 0,
            durationSec: probed?.durationSec ?? 0,
            pixFmt: effectiveOpts.tenBit && CODEC_PROFILES[effectiveOpts.codec].supportsTenBit ? 'yuv420p10le' : 'yuv420p',
            effectiveCrf: resolveEffectiveCrf(effectiveOpts),
            targetBitrateKbps: null,
            usesTwoPass: false,
            ssimPercent: null,
            universalPlayable: effectiveOpts.codec === 'h264',
            elapsedMs: elapsedSec * 1000,
            filename: `${sourceFile.name}_${effectiveOpts.codec}.${CODEC_PROFILES[effectiveOpts.codec].ext}`,
            mime: CODEC_PROFILES[effectiveOpts.codec].mime,
            strippedMetadata: effectiveOpts.stripMetadata,
          };

      // Guarantee explicit MIME type on Blob URL so Safari/iOS/Edge/Chrome decoders never reject it
      const typedBlob = new Blob([rawBlob], { type: stats.mime || CODEC_PROFILES[effectiveOpts.codec].mime });
      setResult({ blob: typedBlob, stats });
      setPreviewTarget('compressed');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setErrorMsg((err as Error)?.message || (locale === 'id' ? 'Gagal mengompres video.' : 'Compression failed.'));
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setCompressing(false);
    }
  };

  const handleApplyPlatformPreset = (preset: PlatformPreset) => {
    const patch = preset.apply(probed);
    setOptions((prev) => ({ ...prev, ...patch }));
  };

  const handleSelectCodec = (codec: VideoCodecId) => {
    const profile = CODEC_PROFILES[codec];
    const nextCrf =
      options.qualityPreset === 'visually_lossless'
        ? profile.crfRange.visuallyLossless
        : options.qualityPreset === 'balanced'
          ? profile.crfRange.balanced
          : profile.crfRange.maxShrink;
    setOptions((prev) => ({
      ...prev,
      codec,
      crf: nextCrf,
      tenBit: profile.defaultTenBit,
      platformPreset: 'auto',
    }));
  };

  const liveTargetPlan = useMemo(() => {
    if (!probed || options.mode !== 'custom' || options.customRateControl !== 'target_size') return null;
    return computeTargetBitratePlan(
      options.targetSizeMb,
      probed.durationSec,
      options.audioMode,
      Boolean(probed.audioCodec),
      options.codec,
    );
  }, [probed, options]);

  const activeProfile = CODEC_PROFILES[options.codec];
  const codecOrder: VideoCodecId[] = ['av1', 'hevc', 'vp9', 'h264'];

  const presetCards: Array<{ id: QualityPreset; title: string; desc: string; tag: string }> = [
    {
      id: 'visually_lossless',
      title: locale === 'id' ? 'Tanpa Turun Kualitas' : 'Visually Lossless',
      desc:
        locale === 'id'
          ? 'Tajam identik secara visual dengan video asli. Ideal untuk arsip, konten HD/4K, dan kiriman profesional.'
          : 'Visually indistinguishable from source. Ideal for archives, HD/4K footage, and crisp sharing.',
      tag: locale === 'id' ? 'Direkomendasikan' : 'Recommended',
    },
    {
      id: 'balanced',
      title: locale === 'id' ? 'Seimbang (Tajam & Ringkas)' : 'Balanced (Sharp & Compact)',
      desc:
        locale === 'id'
          ? 'Potongan ukuran sangat besar (~65–80%) sambil menjaga detail tetap bersih untuk media sosial & web.'
          : 'Huge size reduction (~65–80%) while keeping clean details for social media and web.',
      tag: locale === 'id' ? 'Hemat Besar' : 'Great Savings',
    },
    {
      id: 'max_shrink',
      title: locale === 'id' ? 'Kompresi Ekstrem' : 'Maximum Shrink',
      desc:
        locale === 'id'
          ? 'Prioritas ukuran sekecil mungkin untuk batas email, WhatsApp, atau unggahan cepat.'
          : 'Prioritizes smallest possible file size for chat limits, email, or fast uploads.',
      tag: locale === 'id' ? 'Ukuran Terkecil' : 'Smallest Size',
    },
  ];

  const handleResetAll = () => {
    setSourceFile(null);
    setProbed(null);
    setRecommendation(null);
    setResult(null);
    setErrorMsg(null);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-sky-700 dark:text-sky-400 mb-2">
            <Zap className="w-4 h-4" aria-hidden="true" />
            <span>
              {locale === 'id'
                ? 'Mesin Kompresi Python + FFmpeg · AV1 · H.265/HEVC 10-bit · VP9 · H.264 · Anti-Bloat'
                : 'Python + FFmpeg Compression Engine · AV1 · 10-bit H.265/HEVC · VP9 · H.264 · Anti-Bloat'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.compressTitle}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {t.compressSub}
          </p>
        </div>

        {sourceFile && !compressing && (
          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{locale === 'id' ? 'Pilih video lain' : 'Choose another video'}</span>
          </button>
        )}
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/40 px-5 py-4 text-sm text-rose-900 dark:text-rose-200"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* STEP 1: Dropzone when no video loaded yet */}
      {!sourceFile && !probing && (
        <section className="max-w-4xl mx-auto space-y-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleLoadVideo(f, f.name);
            }}
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
              <FileVideo className="w-6 h-6" aria-hidden="true" />
            </div>

            <h2 className="mt-4 text-lg sm:text-xl font-semibold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Jatuhkan file video di sini atau pilih dari perangkat' : 'Drop a video file here or browse your device'}
            </h2>
            <p className="mt-2 mx-auto max-w-xl text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {locale === 'id'
                ? `Mendukung semua format video lintas platform: MP4, MOV (iPhone/macOS), MKV, WebM, AVI, 3GP, FLV, WMV, dan MPEG-TS (maks ${caps?.maxUploadMb ?? 200} MB). Aman untuk video landscape 16:9 maupun vertikal 9:16.`
                : `Supports all cross-platform video formats: MP4, MOV (iPhone/macOS), MKV, WebM, AVI, 3GP, FLV, WMV, and MPEG-TS (up to ${caps?.maxUploadMb ?? 200} MB). Safe for both landscape 16:9 and vertical 9:16 footage.`}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-6 py-3 min-h-[44px] text-sm font-semibold text-white hover:bg-sky-700 shadow-xs transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                <span>{locale === 'id' ? 'Pilih file video' : 'Choose video file'}</span>
              </button>
              <button
                type="button"
                disabled={loadingSample}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleLoadSampleHd();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-5 py-3 min-h-[44px] text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-60"
              >
                {loadingSample ? (
                  <Loader2 className="w-4 h-4 animate-spin text-sky-600" aria-hidden="true" />
                ) : (
                  <Film className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                )}
                <span>
                  {loadingSample
                    ? locale === 'id'
                      ? 'Membuat video contoh HD...'
                      : 'Generating HD sample...'
                    : locale === 'id'
                      ? 'Coba Video Contoh HD (720p · 3 dtk)'
                      : 'Try HD Sample Video (720p · 3s)'}
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v,.3gp,.flv,.wmv,.ts,.m2ts,.ogv,.mpg,.mpeg"
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleLoadVideo(f, f.name);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="mt-7 pt-5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                <span>
                  {locale === 'id'
                    ? 'Diproses sementara oleh FFmpeg di server lalu segera dihapus otomatis dari disk.'
                    : 'Encoded temporarily on the FFmpeg server and immediately deleted from disk.'}
                </span>
              </span>
              {caps?.available && (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {['hevc', 'av1', 'vp9', 'h264']
                      .filter((c) => caps.encoders[c as VideoCodecId])
                      .map((c) => c.toUpperCase())
                      .join(' · ')}{' '}
                    {locale === 'id' ? 'siap' : 'ready'}
                  </span>
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Probing Spinner */}
      {probing && (
        <div
          role="status"
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-10 text-center max-w-xl mx-auto shadow-[0_2px_10px_rgba(15,23,42,0.04)] space-y-3"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Menganalisis stream, bitrate & codec video...' : 'Probing video streams, bitrate & codec...'}
          </p>
          {sourceFile && <p className="text-xs font-mono text-slate-500 truncate">{sourceFile.name}</p>}
        </div>
      )}

      {/* Compressing Live Progress */}
      {compressing && sourceFile && (
        <div
          role="status"
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-10 text-center max-w-xl mx-auto shadow-[0_2px_10px_rgba(15,23,42,0.04)] space-y-4"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
            <Loader2 className="w-7 h-7 animate-spin" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900 dark:text-white">
              {locale === 'id'
                ? `Mengompres dengan ${activeProfile.name}...`
                : `Compressing with ${activeProfile.name}...`}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {options.codec === 'av1'
                ? locale === 'id'
                  ? 'AV1 melakukan analisis frame mendalam untuk efisiensi tertinggi — mohon tunggu sebentar.'
                  : 'AV1 performs deep perceptual frame analysis for maximum efficiency — please hold on.'
                : locale === 'id'
                  ? 'Menjaga detail visual tetap tajam sambil memangkas bitrate berlebih.'
                  : 'Preserving crisp visual detail while trimming redundant bitrate.'}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-mono tabular-nums text-sky-600 dark:text-sky-400">
            <span className="truncate max-w-[220px]">{sourceFile.name}</span>
            <span aria-hidden="true">·</span>
            <span>{elapsedSec}s</span>
          </div>
          <div>
            <button
              type="button"
              onClick={handleCancelCompress}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800 px-4 py-2 min-h-[40px] text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
            >
              <Square className="w-3 h-3" aria-hidden="true" />
              <span>{t.cancelBtn}</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Configuration Workspace */}
      {!probing && !compressing && sourceFile && probed && !result && (
        <div className="space-y-6">
          {/* Source Info + Smart Recommendation Card */}
          <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white break-all">{sourceFile.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                  <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">
                    {probed.videoCodec.toUpperCase()}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {probed.width}×{probed.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatNumber(probed.fps, locale, 2)} fps</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDuration(probed.durationSec)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatNumber(probed.bitrateKbps, locale, 0)} kbps</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {formatBytes(probed.sizeBytes, locale)}
                  </span>
                  {probed.audioCodec && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Audio {probed.audioCodec.toUpperCase()}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {recommendation && (
              <div className="rounded-xl border border-sky-200/80 dark:border-sky-800/60 bg-sky-50/50 dark:bg-sky-950/20 px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Sparkles className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {locale === 'id' ? 'Rekomendasi pintar: ' : 'Smart recommendation: '}
                    </span>
                    {locale === 'id' ? recommendation.reasonId : recommendation.reasonEn}
                  </p>
                </div>
                <span className="font-mono text-sky-700 dark:text-sky-300 font-semibold whitespace-nowrap shrink-0 tabular-nums">
                  {locale === 'id' ? 'Estimasi' : 'Est.'}: {formatBytes(recommendation.estimatedMinBytes, locale).split(' (')[0]} –{' '}
                  {formatBytes(recommendation.estimatedMaxBytes, locale).split(' (')[0]}
                </span>
              </div>
            )}
          </section>

          {/* Mode Switcher: Rekomendasi vs Kustom */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div
              role="radiogroup"
              aria-label="Compression mode"
              className="inline-flex items-center gap-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/80 p-1"
            >
              <button
                type="button"
                role="radio"
                aria-checked={options.mode === 'recommended'}
                onClick={() => setOptions((prev) => ({ ...prev, mode: 'recommended' }))}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  options.mode === 'recommended'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>{locale === 'id' ? 'Rekomendasi (Otomatis)' : 'Recommended (Smart)'}</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={options.mode === 'custom'}
                onClick={() => setOptions((prev) => ({ ...prev, mode: 'custom' }))}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  options.mode === 'custom'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>{locale === 'id' ? 'Kustom Penuh (Target MB / CRF)' : 'Full Custom (Target MB / CRF)'}</span>
              </button>
            </div>
          </div>

          {/* 1-Click Cross-Platform Media Presets */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                <span>{locale === 'id' ? 'Preset Cepat Platform Media & Perangkat' : 'Quick Platform & Device Presets'}</span>
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Opsional — atur otomatis codec & profil terbaik' : 'Optional — auto-tunes optimal codec & profile'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {PLATFORM_PRESETS.map((preset) => {
                const active = options.platformPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPlatformPreset(preset)}
                    className={`rounded-xl border p-3.5 text-left transition-all cursor-pointer min-h-[44px] ${
                      active
                        ? 'border-sky-500 dark:border-sky-400 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-500/20'
                        : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        {locale === 'id' ? preset.nameId : preset.nameEn}
                      </span>
                      <span className="text-[11px] font-medium text-sky-600 dark:text-sky-400 truncate max-w-[140px]">
                        {preset.platforms.split(' · ')[0]}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                      {locale === 'id' ? preset.subtitleId : preset.subtitleEn}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Codec Picker (4 Modern Codecs) */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {locale === 'id' ? '1. Pilih Codec Video Modern' : '1. Choose Modern Video Codec'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {codecOrder.map((cid) => {
                const prof = CODEC_PROFILES[cid];
                const selected = options.codec === cid;
                const disabled = caps ? !caps.encoders[cid] : false;
                const nativeBrowserPlay = browserCodecSupport ? browserCodecSupport[cid] : null;
                return (
                  <button
                    key={cid}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectCodec(cid)}
                    className={`rounded-2xl border p-4 text-left transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex flex-col justify-between gap-2 ${
                      selected
                        ? 'border-sky-500 dark:border-sky-400 bg-white dark:bg-slate-900 ring-2 ring-sky-500/20 shadow-[0_2px_10px_rgba(2,132,199,0.08)]'
                        : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">{prof.name}</span>
                        <span className="font-mono text-[11px] uppercase text-slate-400">.{prof.ext}</span>
                      </div>
                      <p
                        className={`mt-1 text-xs font-medium ${
                          cid === 'av1'
                            ? 'text-violet-600 dark:text-violet-400'
                            : cid === 'hevc'
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {locale === 'id' ? prof.badgeId : prof.badgeEn}
                      </p>
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {locale === 'id' ? prof.summaryId : prof.summaryEn}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Globe className="w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
                        <span className="truncate">{locale === 'id' ? prof.compatId : prof.compatEn}</span>
                      </span>
                      {nativeBrowserPlay !== null && (
                        <span
                          className={`shrink-0 font-medium ${
                            nativeBrowserPlay ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {nativeBrowserPlay
                            ? locale === 'id'
                              ? 'Pratinjau OK'
                              : 'Preview OK'
                            : locale === 'id'
                              ? 'Unduh'
                              : 'Download'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Settings Panel: Recommended vs Custom */}
          {options.mode === 'recommended' ? (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {locale === 'id' ? '2. Pilih Tingkat Kualitas' : '2. Choose Quality Profile'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {presetCards.map((card) => {
                  const selected = options.qualityPreset === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() =>
                        setOptions((prev) => ({
                          ...prev,
                          qualityPreset: card.id,
                          crf:
                            card.id === 'visually_lossless'
                              ? activeProfile.crfRange.visuallyLossless
                              : card.id === 'balanced'
                                ? activeProfile.crfRange.balanced
                                : activeProfile.crfRange.maxShrink,
                        }))
                      }
                      className={`rounded-2xl border p-5 text-left transition-all cursor-pointer ${
                        selected
                          ? 'border-sky-500 dark:border-sky-400 bg-white dark:bg-slate-900 ring-2 ring-sky-500/20'
                          : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{card.title}</span>
                        <span className="text-xs font-medium text-sky-600 dark:text-sky-400">{card.tag}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{card.desc}</p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs">
                {activeProfile.supportsTenBit && (
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={options.tenBit}
                      onChange={(e) => setOptions((prev) => ({ ...prev, tenBit: e.target.checked }))}
                      className="h-4 w-4 rounded accent-sky-600 cursor-pointer"
                    />
                    <span className="font-medium">
                      {locale === 'id'
                        ? 'Presisi warna 10-bit (cegah color banding, efisiensi lebih baik)'
                        : '10-bit color precision (prevents banding, better efficiency)'}
                    </span>
                  </label>
                )}
                <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.stripMetadata}
                    onChange={(e) => setOptions((prev) => ({ ...prev, stripMetadata: e.target.checked }))}
                    className="h-4 w-4 rounded accent-sky-600 cursor-pointer"
                  />
                  <span className="font-medium">
                    {locale === 'id' ? 'Hapus metadata privasi sekaligus' : 'Strip privacy metadata at the same time'}
                  </span>
                </label>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-6">
              {/* Rate Control Toggle: CRF vs Target Size MB */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {locale === 'id' ? '2. Kontrol Ukuran / Kualitas' : '2. Size / Quality Control'}
                  </h3>
                  <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setOptions((prev) => ({ ...prev, customRateControl: 'target_size' }))}
                      className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                        options.customRateControl === 'target_size'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {locale === 'id' ? 'Target Ukuran (MB)' : 'Target Size (MB)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOptions((prev) => ({ ...prev, customRateControl: 'crf' }))}
                      className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                        options.customRateControl === 'crf'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {locale === 'id' ? 'Kualitas Manual (CRF)' : 'Manual Quality (CRF)'}
                    </button>
                  </div>
                </div>

                {options.customRateControl === 'target_size' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                        <span>{locale === 'id' ? 'Target ukuran:' : 'Target size:'}</span>
                        <input
                          type="number"
                          min={0.2}
                          max={500}
                          step={0.5}
                          value={options.targetSizeMb}
                          onChange={(e) =>
                            setOptions((prev) => ({
                              ...prev,
                              targetSizeMb: Math.max(0.2, Number(e.target.value) || 1),
                            }))
                          }
                          className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-900 dark:text-white focus:border-sky-500 focus:outline-none"
                        />
                        <span className="font-mono text-slate-500">MB</span>
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {[0.5, 2, 5, 10, 25, 50].map((mb) => (
                          <button
                            key={mb}
                            type="button"
                            onClick={() => setOptions((prev) => ({ ...prev, targetSizeMb: mb }))}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer ${
                              options.targetSizeMb === mb
                                ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 font-semibold'
                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            {mb} MB
                          </button>
                        ))}
                      </div>
                    </div>
                    {liveTargetPlan && (
                      <div className="space-y-2.5">
                        <p className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-2">
                          <Gauge className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                          <span>
                            {locale === 'id' ? 'Bitrate video terhitung:' : 'Calculated video bitrate:'}{' '}
                            <strong className="font-mono text-slate-900 dark:text-white">
                              {formatNumber(liveTargetPlan.videoBitrateKbps, locale, 0)} kbps
                            </strong>
                            {liveTargetPlan.audioBitrateKbps > 0 && ` (+ audio ${liveTargetPlan.audioBitrateKbps} kbps)`}
                          </span>
                          {liveTargetPlan.qualityWarning !== 'none' && (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              ·{' '}
                              {liveTargetPlan.qualityWarning === 'extreme'
                                ? locale === 'id'
                                  ? 'Target sangat ketat — pertimbangkan menurunkan resolusi atau pakai AV1.'
                                  : 'Very tight budget — consider lowering resolution or using AV1.'
                                : locale === 'id'
                                  ? 'Target cukup ketat untuk menjaga detail penuh.'
                                  : 'Moderately tight budget for full detail.'}
                            </span>
                          )}
                        </p>
                        {options.codec !== 'av1' && (
                          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={options.twoPass}
                              onChange={(e) => setOptions((prev) => ({ ...prev, twoPass: e.target.checked }))}
                              className="h-4 w-4 rounded accent-sky-600 cursor-pointer"
                            />
                            <span className="font-medium">
                              {locale === 'id'
                                ? 'Mode 2-Pass Encoding (target MB jauh lebih presisi & adegan gerak cepat tetap tajam)'
                                : '2-Pass Encoding (higher target-size accuracy & sharper fast-motion scenes)'}
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-slate-400">
                        {crfQualityLabel(options.codec, options.crf, locale)}
                      </span>
                      <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                        CRF {options.crf}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={activeProfile.crfRange.min}
                      max={activeProfile.crfRange.max}
                      step={1}
                      value={options.crf}
                      onChange={(e) => setOptions((prev) => ({ ...prev, crf: Number(e.target.value) }))}
                      className="w-full accent-sky-600 cursor-pointer"
                    />
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>{locale === 'id' ? 'Kualitas tertinggi (CRF rendah)' : 'Highest quality (lower CRF)'}</span>
                      <span>{locale === 'id' ? 'Ukuran terkecil (CRF tinggi)' : 'Smallest size (higher CRF)'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 2x2 Dropdown Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                <label className="space-y-1.5">
                  <span className="block font-medium text-slate-700 dark:text-slate-300">
                    {locale === 'id' ? 'Resolusi' : 'Resolution'}
                  </span>
                  <select
                    value={options.resolution}
                    onChange={(e) => setOptions((prev) => ({ ...prev, resolution: e.target.value as TargetResolution }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="original">{locale === 'id' ? `Asli (${probed.width}×${probed.height})` : `Original (${probed.width}×${probed.height})`}</option>
                    <option value="2160">4K (2160p)</option>
                    <option value="1440">QHD (1440p)</option>
                    <option value="1080">Full HD (1080p)</option>
                    <option value="720">HD (720p)</option>
                    <option value="480">SD (480p)</option>
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="block font-medium text-slate-700 dark:text-slate-300">Frame Rate (FPS)</span>
                  <select
                    value={options.fps}
                    onChange={(e) => setOptions((prev) => ({ ...prev, fps: e.target.value as TargetFps }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="original">{locale === 'id' ? `Asli (${formatNumber(probed.fps, locale, 1)} fps)` : `Original (${formatNumber(probed.fps, locale, 1)} fps)`}</option>
                    <option value="60">60 fps</option>
                    <option value="30">30 fps</option>
                    <option value="24">24 fps (Sinematik)</option>
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="block font-medium text-slate-700 dark:text-slate-300">Audio</span>
                  <select
                    value={options.audioMode}
                    onChange={(e) => setOptions((prev) => ({ ...prev, audioMode: e.target.value as AudioMode }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="copy">{locale === 'id' ? 'Salin Asli (0% turun kualitas)' : 'Copy Original (Lossless)'}</option>
                    <option value="transparent">{locale === 'id' ? 'Transparan (192k AAC / 128k Opus)' : 'Transparent (192k AAC / 128k Opus)'}</option>
                    <option value="compact">{locale === 'id' ? 'Hemat (128k AAC / 96k Opus)' : 'Compact (128k AAC / 96k Opus)'}</option>
                    <option value="mute">{locale === 'id' ? 'Tanpa Audio (Bisukan)' : 'Mute (Remove Audio)'}</option>
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="block font-medium text-slate-700 dark:text-slate-300">
                    {locale === 'id' ? 'Kecepatan vs Efisiensi' : 'Speed vs Efficiency'}
                  </span>
                  <select
                    value={options.speedEffort}
                    onChange={(e) => setOptions((prev) => ({ ...prev, speedEffort: e.target.value as SpeedEffort }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="fast">{locale === 'id' ? 'Cepat' : 'Fast'}</option>
                    <option value="balanced">{locale === 'id' ? 'Seimbang (Rekomendasi)' : 'Balanced (Recommended)'}</option>
                    <option value="thorough">{locale === 'id' ? 'Efisiensi Maksimal (Lebih lambat)' : 'Max Efficiency (Slower)'}</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="block font-medium text-slate-700 dark:text-slate-300">
                    {locale === 'id' ? 'Pembersih Grain / Noise (Anti-Bloat)' : 'Smart Pre-Denoise (Anti-Bloat)'}
                  </span>
                  <select
                    value={options.smartDenoise}
                    onChange={(e) => setOptions((prev) => ({ ...prev, smartDenoise: e.target.value as SmartDenoiseMode }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="auto">{locale === 'id' ? 'Otomatis (Saat ada noise/grain)' : 'Auto (When grain/noise detected)'}</option>
                    <option value="light">{locale === 'id' ? 'Selalu Aktif (Halus hqdn3d)' : 'Always On (Subtle hqdn3d)'}</option>
                    <option value="off">{locale === 'id' ? 'Matikan (Pertahankan grain asli)' : 'Off (Keep raw sensor grain)'}</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.antiBloatGuard}
                    onChange={(e) => setOptions((prev) => ({ ...prev, antiBloatGuard: e.target.checked }))}
                    className="h-4 w-4 rounded accent-sky-600 cursor-pointer"
                  />
                  <span className="font-medium">
                    {locale === 'id'
                      ? 'Pengaman Anti-Bloat (Batas VBV + Adaptive Pass 2 otomatis)'
                      : 'Anti-Bloat Guard (VBV Cap + Auto Adaptive Pass 2)'}
                  </span>
                </label>
                {activeProfile.supportsTenBit && (
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={options.tenBit}
                      onChange={(e) => setOptions((prev) => ({ ...prev, tenBit: e.target.checked }))}
                      className="h-4 w-4 rounded accent-sky-600 cursor-pointer"
                    />
                    <span className="font-medium">
                      {locale === 'id' ? 'Presisi warna 10-bit (yuv420p10le)' : '10-bit color precision (yuv420p10le)'}
                    </span>
                  </label>
                )}
                <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.stripMetadata}
                    onChange={(e) => setOptions((prev) => ({ ...prev, stripMetadata: e.target.checked }))}
                    className="h-4 w-4 rounded accent-sky-600 cursor-pointer"
                  />
                  <span className="font-medium">
                    {locale === 'id' ? 'Hapus metadata privasi sekaligus' : 'Strip privacy metadata'}
                  </span>
                </label>
              </div>
            </section>
          )}

          {/* Pre-encode compatibility warning if chosen codec cannot play natively in this browser */}
          {browserCodecSupport && browserCodecSupport[options.codec] === false && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <p className="leading-relaxed">
                  {locale === 'id'
                    ? `Browser/OS di perangkat ini tidak memiliki dekoder bawaan untuk ${activeProfile.name}. Hasil file tetap valid untuk iPhone/Mac/VLC, namun tidak akan tampil di pratinjau browser ini atau Windows Media Player standar.`
                    : `This browser/OS has no built-in decoder for ${activeProfile.name}. The output file stays valid for Apple/VLC, but will not render inline here or in default Windows Media Player.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleSelectCodec('h264')}
                  className="rounded-lg bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 min-h-[36px] text-xs font-semibold transition-colors cursor-pointer"
                >
                  {locale === 'id' ? 'Pakai H.264 Universal' : 'Switch to Universal H.264'}
                </button>
                {browserCodecSupport.av1 && (
                  <button
                    type="button"
                    onClick={() => handleSelectCodec('av1')}
                    className="rounded-lg border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 px-3 py-1.5 min-h-[36px] text-xs font-semibold transition-colors cursor-pointer"
                  >
                    {locale === 'id' ? 'Pakai AV1 (Tampil & Terkecil)' : 'Switch to AV1 (Playable & Smallest)'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Primary Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {locale === 'id'
                ? `Output: ${activeProfile.name} (.${activeProfile.ext}) · ${options.tenBit && activeProfile.supportsTenBit ? '10-bit' : '8-bit Rec.709'} · ${options.mode === 'custom' && options.customRateControl === 'target_size' ? `Target ${options.targetSizeMb} MB${options.twoPass && options.codec !== 'av1' ? ' (2-Pass)' : ''}` : `CRF ${resolveEffectiveCrf(options)}`}${options.antiBloatGuard ? ' · Anti-Bloat Aktif' : ''}`
                : `Output: ${activeProfile.name} (.${activeProfile.ext}) · ${options.tenBit && activeProfile.supportsTenBit ? '10-bit' : '8-bit Rec.709'} · ${options.mode === 'custom' && options.customRateControl === 'target_size' ? `Target ${options.targetSizeMb} MB${options.twoPass && options.codec !== 'av1' ? ' (2-Pass)' : ''}` : `CRF ${resolveEffectiveCrf(options)}`}${options.antiBloatGuard ? ' · Anti-Bloat On' : ''}`}
            </p>
            <button
              type="button"
              onClick={() => void handleStartCompress()}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-6 py-3 min-h-[44px] text-sm font-semibold text-white hover:bg-sky-700 shadow-sm transition-colors cursor-pointer"
            >
              <Zap className="w-4 h-4" aria-hidden="true" />
              <span>{locale === 'id' ? 'Kompres Video Sekarang' : 'Compress Video Now'}</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Compression Result & Live Playback Verification */}
      {!compressing && result && sourceFile && (
        <div className="space-y-6">
          {/* Success Header Card */}
          <section className="rounded-2xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white break-all">
                    {result.stats.filename}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {result.stats.bytesSaved > 0
                      ? locale === 'id'
                        ? `Berhasil diperkecil ${formatNumber(result.stats.reductionPercent, locale, 1)}% (${formatBytes(result.stats.bytesSaved, locale)} lebih hemat) dalam ${formatNumber(result.stats.elapsedMs / 1000, locale, 1)} detik.`
                        : `Successfully shrunk by ${formatNumber(result.stats.reductionPercent, locale, 1)}% (saved ${formatBytes(result.stats.bytesSaved, locale)}) in ${formatNumber(result.stats.elapsedMs / 1000, locale, 1)}s.`
                      : locale === 'id'
                        ? 'Video sumber sudah sangat terkompresi — coba pilih codec AV1 atau mode Kustom (Target MB / CRF lebih tinggi) untuk ukuran lebih kecil.'
                        : 'Source video was already heavily compressed — try AV1 or Custom Target Size / higher CRF for further shrinkage.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => downloadBlob(result.blob, result.stats.filename)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-700 shadow-xs transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Unduh Video Terkompresi' : 'Download Compressed Video'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onInspectVideo(result.blob, result.stats.filename)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <FileSearch className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Inspeksi di MetaScope' : 'Inspect in MetaScope'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <SlidersHorizontal className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Ubah Pengaturan' : 'Adjust Settings'}</span>
                </button>
              </div>
            </div>
          </section>

          {/* 3 Executive Proof Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Pengurangan Ukuran' : 'Size Reduction'}
              </span>
              <div
                className={`text-3xl font-bold font-mono tabular-nums ${
                  result.stats.reductionPercent > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {result.stats.reductionPercent > 0
                  ? `-${formatNumber(result.stats.reductionPercent, locale, 1)}%`
                  : `${formatNumber(-result.stats.reductionPercent, locale, 1)}%`}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                {formatBytes(result.stats.originalSize, locale).split(' (')[0]} →{' '}
                {formatBytes(result.stats.compressedSize, locale).split(' (')[0]}
                {result.stats.usesTwoPass ? ' · 2-Pass' : ''}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {result.stats.ssimPercent !== null && result.stats.ssimPercent !== undefined
                  ? locale === 'id'
                    ? 'Fidelitas Visual (SSIM) & Codec'
                    : 'Visual Fidelity (SSIM) & Codec'
                  : locale === 'id'
                    ? 'Codec & Presisi Warna'
                    : 'Codec & Color Precision'}
              </span>
              {result.stats.ssimPercent !== null && result.stats.ssimPercent !== undefined ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400">
                    {formatNumber(result.stats.ssimPercent, locale, 1)}%
                  </span>
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    {result.stats.ssimPercent >= 96
                      ? locale === 'id'
                        ? 'Identik visual'
                        : 'Visually lossless'
                      : locale === 'id'
                        ? 'Tajam'
                        : 'Sharp'}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-mono text-xl font-bold text-slate-900 dark:text-white">
                  <span className="text-slate-500 dark:text-slate-400 uppercase">{result.stats.originalCodec}</span>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="text-sky-600 dark:text-sky-400 uppercase">{result.stats.compressedCodec}</span>
                </div>
              )}
              <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                {result.stats.compressedCodec.toUpperCase()} · {result.stats.width}×{result.stats.height} · {result.stats.pixFmt}
                {result.stats.psnrDb !== null && result.stats.psnrDb !== undefined
                  ? ` · PSNR ${formatNumber(result.stats.psnrDb, locale, 1)} dB`
                  : ''}
                {result.stats.effectiveCrf !== null ? ` · CRF ${result.stats.effectiveCrf}` : ''}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Efisiensi Bitrate & Anti-Bloat' : 'Bitrate & Anti-Bloat Guard'}
              </span>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {formatNumber(result.stats.originalBitrateKbps, locale, 0)} →{' '}
                {formatNumber(result.stats.compressedBitrateKbps, locale, 0)}{' '}
                <span className="text-xs font-sans font-normal text-slate-500">kbps</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {locale === 'id' ? 'Selesai dalam' : 'Encoded in'}{' '}
                {formatNumber(result.stats.elapsedMs / 1000, locale, 2)}s
                {result.stats.vbvMaxrateKbps
                  ? ` · VBV ≤ ${formatNumber(result.stats.vbvMaxrateKbps, locale, 0)} kbps`
                  : ''}
                {result.stats.usesTwoPass ? ' · 2-Pass' : ''}
                {result.stats.strippedMetadata
                  ? locale === 'id'
                    ? ' · Metadata bersih'
                    : ' · Metadata stripped'
                  : ''}
              </p>
            </div>
          </div>

          {/* 5-Stage Python + FFmpeg Pipeline Audit */}
          {result.stats.stages && result.stats.stages.length > 0 && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <span>
                    {locale === 'id'
                      ? 'Audit Pipeline Per-Title (Python + FFmpeg · Pengaman Anti-Bloat)'
                      : 'Per-Title Pipeline Audit (Python + FFmpeg · Anti-Bloat Guard)'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {result.stats.sourceBpp ? <span>BPP {result.stats.sourceBpp}</span> : null}
                  {result.stats.denoiseApplied ? (
                    <span className="text-sky-600 dark:text-sky-400">· Pre-Denoise</span>
                  ) : null}
                  {result.stats.smartAudioOptimized ? (
                    <span className="text-sky-600 dark:text-sky-400">· Smart Audio</span>
                  ) : null}
                  {result.stats.antiBloatTriggered ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      · {locale === 'id' ? `Anti-Bloat Aktif (${result.stats.attempts}x Pass)` : `Anti-Bloat Active (${result.stats.attempts} Passes)`}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {result.stats.stages.map((st, idx) => (
                  <div
                    key={`${st.stage}-${idx}`}
                    className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3 py-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                        {idx + 1}. {st.stage.replace(/_/g, ' ')}
                      </span>
                      <span className="font-mono text-slate-400">{formatNumber(st.elapsed_ms / 1000, locale, 2)}s</span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 break-words leading-snug">
                      {st.detail}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Live Playback Verification */}
          {resultUrl && sourceUrl && (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {locale === 'id' ? 'Pratinjau Kualitas Video Langsung' : 'Live Visual Quality Preview'}
                  </h3>
                </div>
                <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewPlaybackError(false);
                      setPreviewTarget('compressed');
                    }}
                    className={`px-3 py-1.5 min-h-[36px] rounded-md font-medium transition-colors cursor-pointer ${
                      previewTarget === 'compressed'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {locale === 'id' ? 'Hasil Kompresi' : 'Compressed'} ({formatBytes(result.stats.compressedSize, locale).split(' (')[0]})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewPlaybackError(false);
                      setPreviewTarget('original');
                    }}
                    className={`px-3 py-1.5 min-h-[36px] rounded-md font-medium transition-colors cursor-pointer ${
                      previewTarget === 'original'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {locale === 'id' ? 'Video Asli' : 'Original'} ({formatBytes(result.stats.originalSize, locale).split(' (')[0]})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewPlaybackError(false);
                      setPreviewTarget('split');
                    }}
                    className={`px-3 py-1.5 min-h-[36px] rounded-md font-medium transition-colors cursor-pointer ${
                      previewTarget === 'split'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {locale === 'id' ? 'Berdampingan' : 'Side-by-Side'}
                  </button>
                </div>
              </div>

              {previewPlaybackError ? (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/30 p-6 text-center space-y-3">
                  <Film className="w-7 h-7 text-amber-600 dark:text-amber-400 mx-auto" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {locale === 'id'
                      ? `Browser di perangkat ini tidak memiliki dekoder video ${result.stats.compressedCodec.toUpperCase()} (${result.stats.pixFmt}).`
                      : `This browser does not include a ${result.stats.compressedCodec.toUpperCase()} (${result.stats.pixFmt}) video decoder.`}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 max-w-lg mx-auto leading-relaxed">
                    {locale === 'id'
                      ? 'File hasil kompresi Anda 100% valid dan bisa diputar di iPhone/Mac/Android/VLC — namun untuk langsung terlihat di browser ini, Windows, dan WhatsApp, konversi instan ke H.264 Universal (8-bit Rec.709):'
                      : 'Your compressed file is 100% valid for Apple/Android/VLC — however, to play it directly in this browser, Windows, and WhatsApp, convert instantly to Universal H.264 (8-bit Rec.709):'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    {browserCodecSupport?.av1 && result.stats.compressedCodec !== 'av1' && (
                      <button
                        type="button"
                        onClick={() =>
                          void handleStartCompress({
                            ...options,
                            codec: 'av1',
                            tenBit: false,
                            crf: CODEC_PROFILES.av1.crfRange.visuallyLossless,
                            platformPreset: 'max_efficiency_av1',
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 px-4 py-2.5 min-h-[40px] text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {locale === 'id'
                            ? 'Konversi ke AV1 (Lebih Kecil & Tampil di Browser)'
                            : 'Convert to AV1 (Smaller & Browser Playable)'}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void handleStartCompress({
                          ...options,
                          codec: 'h264',
                          tenBit: false,
                          crf: CODEC_PROFILES.h264.crfRange.visuallyLossless,
                          platformPreset: 'universal',
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-sky-950/40 px-4 py-2.5 min-h-[40px] text-xs font-semibold text-sky-700 dark:text-sky-300 transition-colors cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {locale === 'id'
                          ? 'Konversi ke H.264 Universal'
                          : 'Convert to Universal H.264'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadBlob(result.blob, result.stats.filename)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 min-h-[40px] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{locale === 'id' ? 'Unduh File HEVC Ini (Laptop/VLC/Apple)' : 'Download This HEVC File (Laptop/VLC/Apple)'}</span>
                    </button>
                  </div>
                </div>
              ) : previewTarget === 'split' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {locale === 'id' ? 'Hasil Kompresi' : 'Compressed'}
                      </span>
                      <span className="font-mono">
                        {formatBytes(result.stats.compressedSize, locale).split(' (')[0]} · {result.stats.compressedCodec.toUpperCase()}
                      </span>
                    </div>
                    <div className="rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center max-h-[340px]">
                      <video
                        ref={splitCompressedRef}
                        key={`split-comp-${resultUrl}`}
                        src={resultUrl}
                        controls
                        playsInline
                        preload="auto"
                        onLoadedMetadata={(e) => {
                          if (e.currentTarget.videoWidth === 0 || e.currentTarget.videoHeight === 0) {
                            setPreviewPlaybackError(true);
                          }
                        }}
                        onPlay={() => {
                          const other = splitOriginalRef.current;
                          if (other && other.paused) {
                            other.currentTime = splitCompressedRef.current?.currentTime ?? 0;
                            void other.play().catch(() => {});
                          }
                        }}
                        onPause={() => {
                          const other = splitOriginalRef.current;
                          if (other && !other.paused) other.pause();
                        }}
                        onSeeked={(e) => {
                          const other = splitOriginalRef.current;
                          if (other && Math.abs(other.currentTime - e.currentTarget.currentTime) > 0.15) {
                            other.currentTime = e.currentTarget.currentTime;
                          }
                        }}
                        onError={() => setPreviewPlaybackError(true)}
                        className="max-h-[340px] w-full object-contain"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {locale === 'id' ? 'Video Asli' : 'Original'}
                      </span>
                      <span className="font-mono">
                        {formatBytes(result.stats.originalSize, locale).split(' (')[0]} · {result.stats.originalCodec.toUpperCase()}
                      </span>
                    </div>
                    <div className="rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center max-h-[340px]">
                      <video
                        ref={splitOriginalRef}
                        key={`split-orig-${sourceUrl}`}
                        src={sourceUrl}
                        controls
                        muted
                        playsInline
                        preload="auto"
                        className="max-h-[340px] w-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center max-h-[420px]">
                  <video
                    key={`${previewTarget}-${previewTarget === 'compressed' ? resultUrl : sourceUrl}`}
                    src={previewTarget === 'compressed' ? resultUrl : sourceUrl}
                    controls
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => {
                      // Catch silent black-screen bug where AAC audio loads (readyState=4) but video codec is unsupported (videoWidth=0)
                      if (
                        previewTarget === 'compressed' &&
                        (e.currentTarget.videoWidth === 0 || e.currentTarget.videoHeight === 0)
                      ) {
                        setPreviewPlaybackError(true);
                      }
                    }}
                    onError={() => {
                      if (previewTarget === 'compressed') setPreviewPlaybackError(true);
                    }}
                    className="max-h-[420px] w-full object-contain"
                  />
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id'
                  ? 'Semua output MP4 sudah menggunakan warna Rec.709, piksel persegi (SAR 1:1), dan header moov faststart agar langsung bisa diputar mulus di browser, Windows, iPhone, Android, maupun WhatsApp.'
                  : 'All MP4 outputs normalize Rec.709 color, square pixels (SAR 1:1), and faststart moov headers for instant playback across browsers, Windows, iPhone, Android, and WhatsApp.'}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
