export type VideoCodecId = 'av1' | 'hevc' | 'vp9' | 'h264';
export type CompressMode = 'recommended' | 'custom';
export type QualityPreset = 'visually_lossless' | 'balanced' | 'max_shrink';
export type CustomRateControl = 'crf' | 'target_size';
export type TargetResolution = 'original' | '2160' | '1440' | '1080' | '720' | '480';
export type TargetFps = 'original' | '60' | '30' | '24';
export type AudioMode = 'copy' | 'transparent' | 'compact' | 'mute';
export type SpeedEffort = 'fast' | 'balanced' | 'thorough';
export type SmartDenoiseMode = 'auto' | 'off' | 'light';
export type PlatformPresetId =
  | 'auto'
  | 'max_efficiency_av1'
  | 'hevc_10bit'
  | 'universal'
  | 'whatsapp'
  | 'social_reels'
  | 'web_vp9';

export interface CompressOptions {
  codec: VideoCodecId;
  mode: CompressMode;
  qualityPreset: QualityPreset;
  customRateControl: CustomRateControl;
  crf: number;
  targetSizeMb: number;
  twoPass: boolean;
  resolution: TargetResolution;
  fps: TargetFps;
  audioMode: AudioMode;
  speedEffort: SpeedEffort;
  tenBit: boolean;
  stripMetadata: boolean;
  antiBloatGuard: boolean;
  smartDenoise: SmartDenoiseMode;
  platformPreset?: PlatformPresetId;
}

export interface ProbedVideoInfo {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  fps: number;
  bitrateKbps: number;
  sizeBytes: number;
  pixFmt?: string;
}

export interface CodecProfile {
  id: VideoCodecId;
  name: string;
  encoder: string;
  container: 'mp4' | 'webm';
  mime: string;
  ext: 'mp4' | 'webm';
  supportsTenBit: boolean;
  defaultTenBit: boolean;
  universalPlayback: boolean;
  canPlayTypeStrings: string[];
  crfRange: { min: number; max: number; visuallyLossless: number; balanced: number; maxShrink: number };
  estimatedRatio: Record<QualityPreset, number>;
  badgeId: string;
  badgeEn: string;
  summaryId: string;
  summaryEn: string;
  compatId: string;
  compatEn: string;
}

export interface PlatformPreset {
  id: Exclude<PlatformPresetId, 'auto'>;
  nameId: string;
  nameEn: string;
  subtitleId: string;
  subtitleEn: string;
  platforms: string;
  apply: (probed: ProbedVideoInfo | null) => Partial<CompressOptions>;
}

export const CODEC_PROFILES: Record<VideoCodecId, CodecProfile> = {
  av1: {
    id: 'av1',
    name: 'AV1 (Paling Canggih)',
    encoder: 'libaom-av1',
    container: 'mp4',
    mime: 'video/mp4',
    ext: 'mp4',
    supportsTenBit: true,
    defaultTenBit: false, // 8-bit av01 decodes natively in Chrome/Edge/Firefox/Android/Safari 17+ with max shrinkage
    universalPlayback: false,
    canPlayTypeStrings: ['video/mp4; codecs="av01.0.04M.08"', 'video/mp4; codecs="av01.0.04M.10"'],
    crfRange: { min: 18, max: 48, visuallyLossless: 30, balanced: 34, maxShrink: 40 },
    estimatedRatio: { visually_lossless: 0.34, balanced: 0.24, max_shrink: 0.16 },
    badgeId: 'Rekomendasi #1 · Efisiensi Tertinggi',
    badgeEn: '#1 Recommended · Highest Efficiency',
    summaryId: 'Codec generasi terbaru standar YouTube & Netflix dengan TPL + AQ2 + Anti-Bloat. Hemat hingga 75% ukuran tanpa turun kualitas & langsung bisa diputar di browser modern.',
    summaryEn: 'Newest YouTube/Netflix-grade codec with TPL + AQ2 + Anti-Bloat. Shrinks up to 75% with visually lossless SSIM and plays natively in modern browsers.',
    compatId: 'Chrome · Edge · Firefox · Windows 11 · Android · Safari 17+',
    compatEn: 'Chrome · Edge · Firefox · Windows 11 · Android · Safari 17+',
  },
  hevc: {
    id: 'hevc',
    name: 'H.265 / HEVC 10-bit',
    encoder: 'libx265',
    container: 'mp4',
    mime: 'video/mp4',
    ext: 'mp4',
    supportsTenBit: true,
    defaultTenBit: true, // 10-bit Main 10 eliminates banding & maximizes compression efficiency on HEVC-capable laptops/Apple/VLC
    universalPlayback: false,
    canPlayTypeStrings: ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"'],
    crfRange: { min: 16, max: 36, visuallyLossless: 22, balanced: 25, maxShrink: 29 },
    estimatedRatio: { visually_lossless: 0.38, balanced: 0.28, max_shrink: 0.19 },
    badgeId: 'Cepat & Sangat Efisien (10-bit)',
    badgeEn: 'Fast & Ultra-Efficient (10-bit)',
    summaryId: 'Kompresi sangat tajam & cepat (no-sao + AQ3 + 10-bit anti-banding). Ideal untuk laptop modern, iPhone/Mac, Android, VLC, dan video durasi panjang atau 4K.',
    summaryEn: 'Razor-sharp fast compression (no-sao + AQ3 + 10-bit anti-banding). Ideal for modern laptops, Apple, Android, VLC, and longer or 4K footage.',
    compatId: 'Laptop/VLC · Mac · iPhone · Android · Safari',
    compatEn: 'Laptop/VLC · Mac · iPhone · Android · Safari',
  },
  vp9: {
    id: 'vp9',
    name: 'VP9 (WebM + Opus)',
    encoder: 'libvpx-vp9',
    container: 'webm',
    mime: 'video/webm',
    ext: 'webm',
    supportsTenBit: false,
    defaultTenBit: false,
    universalPlayback: false,
    canPlayTypeStrings: ['video/webm; codecs="vp9, opus"', 'video/webm; codecs="vp09.00.10.08"'],
    crfRange: { min: 18, max: 44, visuallyLossless: 26, balanced: 32, maxShrink: 38 },
    estimatedRatio: { visually_lossless: 0.40, balanced: 0.30, max_shrink: 0.20 },
    badgeId: 'Web & Streaming Terbuka',
    badgeEn: 'Open Web & Streaming',
    summaryId: 'Codec web terbuka berefisiensi tinggi dengan audio Opus transparan dalam kontainer WebM, bebas royalti dan langsung putar di browser.',
    summaryEn: 'High-efficiency royalty-free web codec with transparent Opus audio inside WebM, playing directly in browsers.',
    compatId: 'Chrome · Firefox · Edge · Android · Safari 14+',
    compatEn: 'Chrome · Firefox · Edge · Android · Safari 14+',
  },
  h264: {
    id: 'h264',
    name: 'H.264 / AVC (Universal)',
    encoder: 'libx264',
    container: 'mp4',
    mime: 'video/mp4',
    ext: 'mp4',
    supportsTenBit: false,
    defaultTenBit: false,
    universalPlayback: true,
    canPlayTypeStrings: ['video/mp4; codecs="avc1.640028, mp4a.40.2"'],
    crfRange: { min: 16, max: 32, visuallyLossless: 20, balanced: 23, maxShrink: 27 },
    estimatedRatio: { visually_lossless: 0.52, balanced: 0.40, max_shrink: 0.28 },
    badgeId: 'Kompatibilitas 100% Perangkat Lama',
    badgeEn: '100% Legacy Compatibility',
    summaryId: 'Dilengkapi pengaman Anti-Bloat VBV & 2-Pass otomatis agar tidak pernah membengkak. Cocok untuk WhatsApp, Smart TV lama, dan perangkat lawas.',
    summaryEn: 'Protected by automatic VBV Anti-Bloat & 2-Pass tightening so files never bloat. Best for WhatsApp, older Smart TVs, and legacy players.',
    compatId: 'Semua Perangkat · WhatsApp · TV · Browser',
    compatEn: 'Every Device · WhatsApp · TV · Browsers',
  },
};

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: 'max_efficiency_av1',
    nameId: 'Ukuran Terkecil (AV1)',
    nameEn: 'Smallest Size (AV1)',
    subtitleId: 'AV1 TPL+AQ2 · Hemat hingga 75% · Putar di browser modern',
    subtitleEn: 'AV1 TPL+AQ2 · Up to 75% smaller · Plays in modern browsers',
    platforms: 'AV1 · YouTube · Chrome · Laptop',
    apply: () => ({
      codec: 'av1',
      mode: 'recommended',
      qualityPreset: 'visually_lossless',
      crf: CODEC_PROFILES.av1.crfRange.visuallyLossless,
      resolution: 'original',
      fps: 'original',
      audioMode: 'copy',
      tenBit: false,
      twoPass: false,
      antiBloatGuard: true,
      smartDenoise: 'auto',
      platformPreset: 'max_efficiency_av1',
    }),
  },
  {
    id: 'hevc_10bit',
    nameId: 'HEVC 10-bit (Laptop & Apple)',
    nameEn: '10-bit HEVC (Laptop & Apple)',
    subtitleId: 'H.265 10-bit no-sao · Super cepat, tajam & hemat ruang',
    subtitleEn: '10-bit H.265 no-sao · Fast, crisp & compact',
    platforms: 'Laptop · iPhone · Mac · VLC · Android',
    apply: () => ({
      codec: 'hevc',
      mode: 'recommended',
      qualityPreset: 'visually_lossless',
      crf: CODEC_PROFILES.hevc.crfRange.visuallyLossless,
      resolution: 'original',
      fps: 'original',
      audioMode: 'copy',
      tenBit: true,
      twoPass: false,
      antiBloatGuard: true,
      smartDenoise: 'auto',
      platformPreset: 'hevc_10bit',
    }),
  },
  {
    id: 'whatsapp',
    nameId: 'WhatsApp & Telegram',
    nameEn: 'WhatsApp & Telegram',
    subtitleId: 'H.264 2-Pass · Ringkas ≤14 MB · Anti-bloat & tajam',
    subtitleEn: '2-Pass H.264 · Compact ≤14 MB · Anti-bloat crisp',
    platforms: 'WhatsApp · Telegram · Discord',
    apply: (probed) => {
      const sizeMb = probed ? probed.sizeBytes / (1024 * 1024) : 20;
      const useTarget = sizeMb > 14;
      return {
        codec: 'h264',
        mode: useTarget ? 'custom' : 'recommended',
        qualityPreset: 'balanced',
        customRateControl: useTarget ? 'target_size' : 'crf',
        targetSizeMb: useTarget ? 14 : Math.max(1, Math.round(sizeMb * 0.45 * 10) / 10),
        twoPass: useTarget,
        crf: CODEC_PROFILES.h264.crfRange.balanced,
        resolution: probed && Math.min(probed.width, probed.height) > 1080 ? '1080' : 'original',
        fps: probed && probed.fps > 30 ? '30' : 'original',
        audioMode: 'compact',
        tenBit: false,
        antiBloatGuard: true,
        smartDenoise: 'auto',
        platformPreset: 'whatsapp',
      };
    },
  },
  {
    id: 'social_reels',
    nameId: 'TikTok · Reels · Shorts',
    nameEn: 'TikTok · Reels · Shorts',
    subtitleId: 'H.264 1080p tajam · Aman rasio vertikal 9:16',
    subtitleEn: 'Sharp H.264 1080p · Portrait 9:16 safe',
    platforms: 'Instagram · TikTok · YouTube Shorts',
    apply: (probed) => ({
      codec: 'h264',
      mode: 'custom',
      qualityPreset: 'visually_lossless',
      customRateControl: 'crf',
      crf: 21,
      twoPass: false,
      resolution: probed && Math.min(probed.width, probed.height) > 1080 ? '1080' : 'original',
      fps: probed && probed.fps > 60 ? '60' : 'original',
      audioMode: 'transparent',
      tenBit: false,
      antiBloatGuard: true,
      smartDenoise: 'auto',
      platformPreset: 'social_reels',
    }),
  },
  {
    id: 'universal',
    nameId: 'Semua Perangkat Lama',
    nameEn: 'All Legacy Devices',
    subtitleId: 'H.264 High 8-bit · Anti-Bloat VBV · Pasti putar di mana saja',
    subtitleEn: '8-bit H.264 High · VBV Anti-Bloat · Plays everywhere',
    platforms: 'Smart TV · Windows Lama · Browser',
    apply: () => ({
      codec: 'h264',
      mode: 'recommended',
      qualityPreset: 'balanced',
      crf: CODEC_PROFILES.h264.crfRange.balanced,
      resolution: 'original',
      fps: 'original',
      audioMode: 'transparent',
      tenBit: false,
      twoPass: false,
      antiBloatGuard: true,
      smartDenoise: 'auto',
      platformPreset: 'universal',
    }),
  },
  {
    id: 'web_vp9',
    nameId: 'Web & HTML5 Ringan',
    nameEn: 'Web & Lightweight HTML5',
    subtitleId: 'VP9 + Opus (.webm) · Streaming efisien',
    subtitleEn: 'VP9 + Opus (.webm) · Efficient streaming',
    platforms: 'Website · Chrome · Firefox · Edge',
    apply: () => ({
      codec: 'vp9',
      mode: 'recommended',
      qualityPreset: 'balanced',
      crf: CODEC_PROFILES.vp9.crfRange.balanced,
      resolution: 'original',
      fps: 'original',
      audioMode: 'transparent',
      tenBit: false,
      twoPass: false,
      antiBloatGuard: true,
      smartDenoise: 'auto',
      platformPreset: 'web_vp9',
    }),
  },
];

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  codec: 'av1',
  mode: 'recommended',
  qualityPreset: 'visually_lossless',
  customRateControl: 'crf',
  crf: 30,
  targetSizeMb: 10,
  twoPass: true,
  resolution: 'original',
  fps: 'original',
  audioMode: 'copy',
  speedEffort: 'balanced',
  tenBit: false,
  stripMetadata: true,
  antiBloatGuard: true,
  smartDenoise: 'auto',
  platformPreset: 'max_efficiency_av1',
};

export interface TargetBitratePlan {
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  qualityWarning: 'none' | 'tight' | 'extreme';
}

/**
 * Calculates exact video & audio bitrate budget to hit a custom target size (MB)
 * while reserving 4% for container overhead (MP4/WebM moov/cues/headers).
 */
export function computeTargetBitratePlan(
  targetSizeMb: number,
  durationSec: number,
  audioMode: AudioMode,
  hasAudio: boolean,
  codec: VideoCodecId,
): TargetBitratePlan {
  const safeDuration = Math.max(0.5, durationSec);
  const safeTargetBytes = Math.max(0.1, targetSizeMb) * 1024 * 1024;
  // Reserve 4% for container muxing overhead so we never overshoot target
  const usableBits = safeTargetBytes * 0.96 * 8;
  const totalKbps = usableBits / safeDuration / 1000;

  let audioBitrateKbps = 0;
  if (hasAudio && audioMode !== 'mute') {
    if (audioMode === 'compact') audioBitrateKbps = codec === 'vp9' ? 64 : 96;
    else if (audioMode === 'transparent') audioBitrateKbps = codec === 'vp9' ? 128 : 160;
    else audioBitrateKbps = codec === 'vp9' ? 96 : 128;
  }

  // Keep audio under 25% of tiny budgets
  if (audioBitrateKbps > totalKbps * 0.25 && totalKbps > 160) {
    audioBitrateKbps = Math.max(48, Math.floor(totalKbps * 0.2));
  }

  const videoBitrateKbps = Math.max(100, Math.floor(totalKbps - audioBitrateKbps));
  const maxrateKbps = Math.floor(videoBitrateKbps * 1.35);
  const bufsizeKbps = Math.floor(videoBitrateKbps * 2.2);

  // Perceptual threshold depends on codec efficiency
  const tightFloor = codec === 'av1' ? 400 : codec === 'hevc' ? 520 : codec === 'vp9' ? 600 : 880;
  const extremeFloor = codec === 'av1' ? 200 : codec === 'hevc' ? 260 : codec === 'vp9' ? 320 : 460;
  const qualityWarning: TargetBitratePlan['qualityWarning'] =
    videoBitrateKbps < extremeFloor ? 'extreme' : videoBitrateKbps < tightFloor ? 'tight' : 'none';

  return {
    videoBitrateKbps,
    audioBitrateKbps,
    maxrateKbps,
    bufsizeKbps,
    qualityWarning,
  };
}

export function resolveEffectiveCrf(options: CompressOptions): number {
  const profile = CODEC_PROFILES[options.codec];
  if (options.mode === 'recommended') {
    if (options.qualityPreset === 'visually_lossless') return profile.crfRange.visuallyLossless;
    if (options.qualityPreset === 'balanced') return profile.crfRange.balanced;
    return profile.crfRange.maxShrink;
  }
  return Math.max(profile.crfRange.min, Math.min(profile.crfRange.max, Math.round(options.crf)));
}

export function sanitizeCompressOptions(raw: Partial<CompressOptions>): CompressOptions {
  const codec: VideoCodecId =
    raw.codec === 'av1' || raw.codec === 'hevc' || raw.codec === 'vp9' || raw.codec === 'h264'
      ? raw.codec
      : DEFAULT_COMPRESS_OPTIONS.codec;

  const mode: CompressMode = raw.mode === 'custom' ? 'custom' : 'recommended';
  const qualityPreset: QualityPreset =
    raw.qualityPreset === 'balanced' || raw.qualityPreset === 'max_shrink'
      ? raw.qualityPreset
      : 'visually_lossless';

  const customRateControl: CustomRateControl = raw.customRateControl === 'target_size' ? 'target_size' : 'crf';

  const profile = CODEC_PROFILES[codec];
  const parsedCrf = Number(raw.crf);
  const crf = Number.isFinite(parsedCrf)
    ? Math.max(profile.crfRange.min, Math.min(profile.crfRange.max, Math.round(parsedCrf)))
    : profile.crfRange.visuallyLossless;

  const parsedTargetMb = Number(raw.targetSizeMb);
  const targetSizeMb = Number.isFinite(parsedTargetMb)
    ? Math.max(0.2, Math.min(500, Math.round(parsedTargetMb * 10) / 10))
    : DEFAULT_COMPRESS_OPTIONS.targetSizeMb;

  const allowedRes: TargetResolution[] = ['original', '2160', '1440', '1080', '720', '480'];
  const resolution: TargetResolution = allowedRes.includes(raw.resolution as TargetResolution)
    ? (raw.resolution as TargetResolution)
    : 'original';

  const allowedFps: TargetFps[] = ['original', '60', '30', '24'];
  const fps: TargetFps = allowedFps.includes(raw.fps as TargetFps) ? (raw.fps as TargetFps) : 'original';

  const allowedAudio: AudioMode[] = ['copy', 'transparent', 'compact', 'mute'];
  const audioMode: AudioMode = allowedAudio.includes(raw.audioMode as AudioMode)
    ? (raw.audioMode as AudioMode)
    : 'copy';

  const allowedSpeed: SpeedEffort[] = ['fast', 'balanced', 'thorough'];
  const speedEffort: SpeedEffort = allowedSpeed.includes(raw.speedEffort as SpeedEffort)
    ? (raw.speedEffort as SpeedEffort)
    : 'balanced';

  const allowedDenoise: SmartDenoiseMode[] = ['auto', 'off', 'light'];
  const smartDenoise: SmartDenoiseMode = allowedDenoise.includes(raw.smartDenoise as SmartDenoiseMode)
    ? (raw.smartDenoise as SmartDenoiseMode)
    : 'auto';

  const allowedPlatforms: PlatformPresetId[] = [
    'auto',
    'max_efficiency_av1',
    'hevc_10bit',
    'universal',
    'whatsapp',
    'social_reels',
    'web_vp9',
  ];
  const platformPreset: PlatformPresetId = allowedPlatforms.includes(raw.platformPreset as PlatformPresetId)
    ? (raw.platformPreset as PlatformPresetId)
    : 'auto';

  return {
    codec,
    mode,
    qualityPreset,
    customRateControl,
    crf,
    targetSizeMb,
    twoPass: typeof raw.twoPass === 'boolean' ? raw.twoPass : true,
    resolution,
    fps,
    audioMode,
    speedEffort,
    tenBit: typeof raw.tenBit === 'boolean' ? (profile.supportsTenBit ? raw.tenBit : false) : profile.defaultTenBit,
    stripMetadata: typeof raw.stripMetadata === 'boolean' ? raw.stripMetadata : true,
    antiBloatGuard: typeof raw.antiBloatGuard === 'boolean' ? raw.antiBloatGuard : true,
    smartDenoise,
    platformPreset,
  };
}

export interface CompressionRecommendation {
  codec: VideoCodecId;
  qualityPreset: QualityPreset;
  tenBit: boolean;
  reasonId: string;
  reasonEn: string;
  estimatedMinBytes: number;
  estimatedMaxBytes: number;
}

/**
 * Efficiency-first Per-Title smart recommendation:
 * - Default flagship: AV1 8-bit (libaom-av1 + TPL + AQ2 + Anti-Bloat) for clips <= 90s and <= 1440p —
 *   delivers the absolute smallest file size (up to 75% reduction) AND plays natively in modern browsers & Windows 11/Android.
 * - For longer (> 90s) or 4K clips: recommends H.265 / HEVC 10-bit (no-sao + AQ3 + Anti-Bloat) for 5x faster
 *   encoding with massive compression savings and razor-sharp 10-bit gradients.
 */
export function recommendCompressionPlan(info: ProbedVideoInfo): CompressionRecommendation {
  const maxDim = Math.max(info.width, info.height);
  const preferHevcForSpeed = info.durationSec > 90 || maxDim >= 2160;
  const codec: VideoCodecId = preferHevcForSpeed ? 'hevc' : 'av1';
  const tenBit = codec === 'hevc';
  const qualityPreset: QualityPreset = 'visually_lossless';

  const srcLower = info.videoCodec.toLowerCase();
  const isAlreadyModern = srcLower.includes('hevc') || srcLower.includes('h265') || srcLower.includes('av1');
  const baseRatio = isAlreadyModern ? 0.56 : CODEC_PROFILES[codec].estimatedRatio[qualityPreset];
  const estimatedMinBytes = Math.round(info.sizeBytes * Math.max(0.18, baseRatio * 0.72));
  const estimatedMaxBytes = Math.round(info.sizeBytes * Math.min(0.82, baseRatio * 1.15));

  return {
    codec,
    qualityPreset,
    tenBit,
    reasonId: preferHevcForSpeed
      ? `Video berdurasi panjang/resolusi tinggi (${info.width}×${info.height}, ${Math.round(info.durationSec)} dtk): H.265/HEVC 10-bit (no-sao + AQ3 + Anti-Bloat VBV) direkomendasikan untuk rasio kompresi ekstrem yang jauh lebih cepat dan tajam tanpa membengkak.`
      : `AV1 (TPL + AQ2 + Anti-Bloat Guard) direkomendasikan untuk video ${info.width}×${info.height} Anda: codec paling mutakhir dengan ukuran paling kecil (hemat hingga 50–75%), kualitas identik (SSIM tinggi), dijamin tidak membengkak, dan langsung bisa diputar di browser modern maupun laptop.`,
    reasonEn: preferHevcForSpeed
      ? `Long or 4K footage (${info.width}×${info.height}, ${Math.round(info.durationSec)}s): 10-bit H.265/HEVC (no-sao + AQ3 + VBV Anti-Bloat) is recommended for extreme shrinkage at high speed with zero bloat.`
      : `AV1 (TPL + AQ2 + Anti-Bloat Guard) is recommended for your ${info.width}×${info.height} video: the newest high-efficiency codec delivering the smallest file size (50–75% savings), high SSIM visual fidelity, guaranteed zero bloat, and native playback in modern browsers.`,
    estimatedMinBytes,
    estimatedMaxBytes,
  };
}

export interface FfmpegBuildResult {
  args: string[];
  pass1Args?: string[];
  pass2Args?: string[];
  usesTwoPass: boolean;
  outputExt: 'mp4' | 'webm';
  outputMime: string;
  effectiveCrf: number | null;
  targetPlan: TargetBitratePlan | null;
  vbvMaxrateKbps: number | null;
  pixFmt: string;
}

/**
 * Computes orientation-aware Lanczos downscale filter with square pixel normalization (setsar=1)
 * so vertical 9:16 phone videos (e.g. 1080x1920) constrain their short edge instead of wrongly
 * shrinking height to 1080, and non-square SAR streams never appear stretched.
 */
export function buildScaleFilter(resolution: TargetResolution, width: number, height: number): string {
  if (resolution === 'original') {
    return 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1';
  }
  const maxShortEdge = Number(resolution);
  const isPortrait = height > width;
  if (isPortrait) {
    return `scale='min(iw,${maxShortEdge})':-2:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`;
  }
  return `scale=-2:'min(ih,${maxShortEdge})':flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`;
}

function computeVbvCap(safe: CompressOptions, probed: ProbedVideoInfo): { maxrate: number; bufsize: number } | null {
  if (!safe.antiBloatGuard || probed.bitrateKbps <= 0) return null;
  const presetCap =
    safe.qualityPreset === 'max_shrink' ? 0.34 : safe.qualityPreset === 'balanced' ? 0.52 : 0.72;
  const codecCap =
    safe.codec === 'av1'
      ? Math.min(presetCap, 0.65)
      : safe.codec === 'hevc'
        ? Math.min(presetCap, 0.68)
        : presetCap;
  const maxrate = Math.max(140, Math.floor(probed.bitrateKbps * codecCap));
  const bufsize = Math.max(maxrate * 2, Math.floor(maxrate * 2.2));
  return { maxrate, bufsize };
}

function buildVideoCodecArgs(
  safe: CompressOptions,
  probed: ProbedVideoInfo,
  effectiveCrf: number | null,
  targetPlan: TargetBitratePlan | null,
  vbvCap: { maxrate: number; bufsize: number } | null,
  passMode?: 1 | 2,
  passLogPrefix?: string,
): string[] {
  const profile = CODEC_PROFILES[safe.codec];
  const args: string[] = ['-c:v', profile.encoder];
  const useTargetSize = safe.mode === 'custom' && safe.customRateControl === 'target_size';
  const gop = String(Math.max(48, Math.min(300, Math.round(probed.fps * 5))));

  if (safe.codec === 'hevc') {
    const preset = safe.speedEffort === 'fast' ? 'fast' : safe.speedEffort === 'thorough' ? 'slow' : 'medium';
    args.push('-preset', preset, '-g', gop, '-tag:v', 'hvc1');
    if (useTargetSize && targetPlan) {
      args.push(
        '-b:v', `${targetPlan.videoBitrateKbps}k`,
        '-maxrate', `${targetPlan.maxrateKbps}k`,
        '-bufsize', `${targetPlan.bufsizeKbps}k`,
      );
    } else if (effectiveCrf !== null) {
      args.push('-crf', String(effectiveCrf));
      if (vbvCap) {
        args.push('-maxrate', `${vbvCap.maxrate}k`, '-bufsize', `${vbvCap.bufsize}k`);
      }
    }
    const x265Parts = [
      'no-sao=1',
      'aq-mode=3',
      'psy-rd=1.5',
      'psy-rdoq=1.0',
      'bframes=8',
      'rc-lookahead=25',
      'deblock=-1,-1',
      'log-level=error',
    ];
    if (passMode && passLogPrefix) {
      x265Parts.push(`pass=${passMode}`, `stats=${passLogPrefix}.x265.log`);
    }
    args.push('-x265-params', x265Parts.join(':'));
  } else if (safe.codec === 'av1') {
    const cpuUsed = safe.speedEffort === 'fast' ? '8' : safe.speedEffort === 'thorough' ? '4' : '6';
    args.push(
      '-cpu-used', cpuUsed,
      '-row-mt', '1',
      '-tiles', '2x2',
      '-g', gop,
      '-tag:v', 'av01',
      '-aom-params', 'enable-tpl-model=1:aq-mode=2:deltaq-mode=1',
    );
    if (useTargetSize && targetPlan) {
      args.push(
        '-b:v', `${targetPlan.videoBitrateKbps}k`,
        '-maxrate', `${targetPlan.maxrateKbps}k`,
        '-bufsize', `${targetPlan.bufsizeKbps}k`,
      );
    } else if (effectiveCrf !== null) {
      args.push('-crf', String(effectiveCrf), '-b:v', vbvCap ? `${vbvCap.maxrate}k` : '0');
    }
  } else if (safe.codec === 'vp9') {
    const cpuUsed = safe.speedEffort === 'fast' ? '4' : safe.speedEffort === 'thorough' ? '1' : '2';
    args.push(
      '-cpu-used', cpuUsed,
      '-row-mt', '1',
      '-tile-columns', '2',
      '-deadline', 'good',
      '-auto-alt-ref', '1',
      '-lag-in-frames', '25',
      '-aq-mode', '2',
      '-g', gop,
    );
    if (useTargetSize && targetPlan) {
      args.push(
        '-b:v', `${targetPlan.videoBitrateKbps}k`,
        '-maxrate', `${targetPlan.maxrateKbps}k`,
        '-bufsize', `${targetPlan.bufsizeKbps}k`,
      );
    } else if (effectiveCrf !== null) {
      args.push('-crf', String(effectiveCrf), '-b:v', vbvCap ? `${vbvCap.maxrate}k` : '0');
    }
    if (passMode && passLogPrefix) {
      args.push('-pass', String(passMode), '-passlogfile', passLogPrefix);
    }
  } else {
    const preset = safe.speedEffort === 'fast' ? 'fast' : safe.speedEffort === 'thorough' ? 'slow' : 'medium';
    const maxDim = Math.max(probed.width, probed.height);
    const level = maxDim > 1920 ? '5.1' : probed.fps > 35 ? '4.2' : '4.1';
    args.push(
      '-preset', preset,
      '-profile:v', 'high',
      '-level:v', level,
      '-g', gop,
      '-tag:v', 'avc1',
      '-x264-params', 'aq-mode=3:psy-rd=1.0,0.15:deblock=-1,-1',
    );
    if (useTargetSize && targetPlan) {
      args.push(
        '-b:v', `${targetPlan.videoBitrateKbps}k`,
        '-maxrate', `${targetPlan.maxrateKbps}k`,
        '-bufsize', `${targetPlan.bufsizeKbps}k`,
      );
      if (passMode && passLogPrefix) {
        args.push('-pass', String(passMode), '-passlogfile', passLogPrefix);
      }
    } else if (effectiveCrf !== null) {
      args.push('-crf', String(effectiveCrf));
      if (vbvCap) {
        args.push('-maxrate', `${vbvCap.maxrate}k`, '-bufsize', `${vbvCap.bufsize}k`);
      }
    }
  }

  return args;
}

function buildAudioArgs(
  safe: CompressOptions,
  probed: ProbedVideoInfo,
  hasAudio: boolean,
  useTargetSize: boolean,
  targetPlan: TargetBitratePlan | null,
): string[] {
  const profile = CODEC_PROFILES[safe.codec];
  if (!hasAudio || safe.audioMode === 'mute') {
    return ['-an'];
  }
  const srcAudio = (probed.audioCodec ?? '').toLowerCase();
  const copyCompatible =
    profile.container === 'mp4'
      ? srcAudio === 'aac' || srcAudio === 'mp3'
      : srcAudio === 'opus' || srcAudio === 'vorbis';

  if (safe.audioMode === 'copy' && copyCompatible && !useTargetSize) {
    return ['-c:a', 'copy'];
  }
  if (profile.container === 'webm') {
    const br = targetPlan ? targetPlan.audioBitrateKbps : safe.audioMode === 'compact' ? 80 : 128;
    return ['-c:a', 'libopus', '-b:a', `${br}k`, '-ac', '2', '-ar', '48000'];
  }
  const br = targetPlan ? targetPlan.audioBitrateKbps : safe.audioMode === 'compact' ? 96 : 160;
  return ['-c:a', 'aac', '-b:a', `${br}k`, '-ac', '2', '-ar', '48000'];
}

/**
 * Pure deterministic FFmpeg argument builder (zero shell interpolation, strictly allowlisted flags).
 * Mirrors the Python 5-stage compression orchestrator for pure-TS unit tests & fallback safety.
 */
export function buildFfmpegArgs(
  inputPath: string,
  outputPath: string,
  options: CompressOptions,
  probed: ProbedVideoInfo,
  passLogPrefix?: string,
): FfmpegBuildResult {
  const safe = sanitizeCompressOptions(options);
  const profile = CODEC_PROFILES[safe.codec];
  const useTargetSize = safe.mode === 'custom' && safe.customRateControl === 'target_size';
  const effectiveCrf = useTargetSize ? null : resolveEffectiveCrf(safe);
  const hasAudio = Boolean(probed.audioCodec);

  const targetPlan = useTargetSize
    ? computeTargetBitratePlan(safe.targetSizeMb, probed.durationSec, safe.audioMode, hasAudio, safe.codec)
    : null;
  const vbvCap = useTargetSize ? null : computeVbvCap(safe, probed);

  const filters: string[] = [buildScaleFilter(safe.resolution, probed.width, probed.height)];
  if (safe.smartDenoise === 'light') {
    filters.push('hqdn3d=1.2:1.2:4:4');
  }
  if (safe.fps !== 'original') {
    filters.push(`fps=${Number(safe.fps)}`);
  }
  const filterGraph = filters.join(',');

  const pixFmt = safe.tenBit && profile.supportsTenBit ? 'yuv420p10le' : 'yuv420p';
  const colorTags =
    pixFmt === 'yuv420p'
      ? ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
      : [];

  const commonHead = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-threads',
    '0',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
  ];

  const buildFullPass = (passMode?: 1 | 2): string[] => {
    const args = [...commonHead];
    if (passMode === 1) {
      args.push('-an');
    } else {
      if (hasAudio && safe.audioMode !== 'mute') {
        args.push('-map', '0:a:0?');
      }
      if (safe.stripMetadata) {
        args.push('-map_metadata', '-1', '-map_chapters', '-1');
      }
    }

    args.push('-vf', filterGraph, '-pix_fmt', pixFmt, ...colorTags);
    args.push(...buildVideoCodecArgs(safe, probed, effectiveCrf, targetPlan, vbvCap, passMode, passLogPrefix));
    args.push('-max_muxing_queue_size', '1024');

    if (passMode === 1) {
      args.push('-f', profile.container === 'webm' ? 'webm' : 'mp4', '/dev/null');
      return args;
    }

    args.push(...buildAudioArgs(safe, probed, hasAudio, useTargetSize, targetPlan));
    if (profile.container === 'mp4') {
      args.push('-movflags', '+faststart', '-brand', 'mp42');
    }
    args.push(outputPath);
    return args;
  };

  const canUseTwoPass =
    Boolean(passLogPrefix) &&
    useTargetSize &&
    safe.twoPass &&
    (safe.codec === 'h264' || safe.codec === 'hevc' || safe.codec === 'vp9');

  if (canUseTwoPass) {
    const pass1Args = buildFullPass(1);
    const pass2Args = buildFullPass(2);
    return {
      args: pass2Args,
      pass1Args,
      pass2Args,
      usesTwoPass: true,
      outputExt: profile.ext,
      outputMime: profile.mime,
      effectiveCrf,
      targetPlan,
      vbvMaxrateKbps: vbvCap?.maxrate ?? null,
      pixFmt,
    };
  }

  return {
    args: buildFullPass(undefined),
    usesTwoPass: false,
    outputExt: profile.ext,
    outputMime: profile.mime,
    effectiveCrf,
    targetPlan,
    vbvMaxrateKbps: vbvCap?.maxrate ?? null,
    pixFmt,
  };
}

/**
 * Parses FFmpeg SSIM filter output (e.g. "All:0.987654 (19.08)") into a 0..100 percentage.
 */
export function parseSsimScore(stderrOutput: string): number | null {
  const match = /All:([01](?:\.\d+)?)/.exec(stderrOutput);
  if (!match) return null;
  const val = Number(match[1]);
  if (!Number.isFinite(val) || val < 0 || val > 1) return null;
  return Math.round(val * 1000) / 10;
}

export function buildCompressedFilename(originalName: string, codec: VideoCodecId, ext: 'mp4' | 'webm'): string {
  const base = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'video';
  return `${base}_${codec}_compressed.${ext}`;
}
