export type Confidence = 'pasti' | 'kuat' | 'heuristik';
export type Severity = 'kritis' | 'tinggi' | 'sedang' | 'rendah' | 'info';
export type CheckStatus = 'lolos' | 'gagal' | 'tidak_berlaku';
export type AnalysisMode = 'privat' | 'mendalam';
export type Locale = 'id' | 'en';

export interface BoxNode {
  path: string;
  type: string;
  offset: number;
  size: number;
  detail?: string;
  error?: string;
  children?: BoxNode[];
}

export interface TagEntry {
  ns: string;
  name: string;
  raw: unknown;
  decoded?: string;
  source: string;
  offset?: number;
  discrepancy?: {
    otherSource: string;
    otherValue: string;
  };
}

export interface TrackSummary {
  id: number;
  type: 'video' | 'audio' | 'subtitle' | 'other';
  handler: string;
  codec: string;
  codecDetail?: string;
  timescale: number;
  durationSec: number;
  sampleCount: number;
  keyframeCount?: number;
  width?: number;
  height?: number;
  fps?: number;
  bitrateBps?: number;
  sampleRate?: number;
  channels?: number;
  firstPacketPtsSec?: number;
  colorInfo?: string;
  pixelFormat?: string;
}

export interface VideoInfo {
  container: string;
  majorBrand?: string;
  minorVersion?: number;
  compatibleBrands?: string[];
  durationSec: number;
  videoDurationSec?: number;
  audioDurationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  profile?: string;
  level?: string;
  pixelFormat?: string;
  colorSpace?: string;
  videoBitrateBps?: number;
  bitDensity?: number;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  audioBitrateBps?: number;
  audioPackets?: number;
  audioFirstPtsSec?: number;
  faststart: boolean;
  nonMediaOverheadBytes: number;
  nonMediaOverheadPercent: number;
  tracks: TrackSummary[];
  mp4Integrity?: {
    videoStszCount: number;
    videoSttsFrameCount: number;
    videoStssCount: number;
    audioStszCount: number;
    audioSttsPacketCount: number;
    topLevelBoxSum: number;
    moovOffset?: number;
    mdatOffset?: number;
    mdatPayloadOffset?: number;
    mdatPayloadSize?: number;
    moovSize?: number;
  };
}

export interface ImageInfo {
  format: string;
  width?: number;
  height?: number;
  colorSpace?: string;
  bitDepth?: number;
  subsampling?: string;
  progressive?: boolean;
  estimatedQuality?: number;
  quantizationTables?: Array<{ id: number; precision: number; values: number[] }>;
  iccProfile?: {
    name?: string;
    colorSpace?: string;
    size?: number;
    description?: string;
  };
  thumbnail?: {
    present: boolean;
    offset?: number;
    size?: number;
    width?: number;
    height?: number;
    aspectRatioDiff?: number;
    mimeType?: string;
    dataUrl?: string;
  };
  trailingData?: {
    offset: number;
    size: number;
  };
  pngChunks?: Array<{
    type: string;
    offset: number;
    size: number;
    crcValid: boolean;
    expectedCrc?: string;
    actualCrc?: string;
  }>;
  pngTextChunks?: Array<{
    keyword: string;
    text: string;
    chunkType: string;
    offset: number;
  }>;
  hasEndMarker?: boolean;
}

export interface AudioInfo {
  format: string;
  codec?: string;
  durationSec?: number;
  bitrateBps?: number;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  encoder?: string;
  replayGain?: Record<string, string | number>;
  chapters?: Array<{ title?: string; startSec: number; endSec?: number }>;
  coverArt?: Array<{
    mimeType: string;
    size: number;
    description?: string;
    dataUrl?: string;
  }>;
}

export interface DocInfo {
  format: string;
  pdfVersion?: string;
  pageCount?: number;
  eofCount?: number;
  revisions?: number;
  producer?: string;
  creator?: string;
  author?: string;
  lastModifiedBy?: string;
  company?: string;
  application?: string;
  hasJavaScript?: boolean;
  hasEmbeddedFiles?: boolean;
  embeddedFiles?: string[];
  hasDigitalSignature?: boolean;
  annotationCount?: number;
  fonts?: string[];
  comments?: Array<{ author?: string; date?: string; text: string; source: string }>;
  trackedChanges?: Array<{ author?: string; date?: string; type: 'insert' | 'delete'; text: string }>;
  hiddenSheets?: string[];
  externalLinks?: string[];
  hasMacros?: boolean;
  customXmlParts?: string[];
  archiveEntries?: Array<{
    name: string;
    compressedSize: number;
    uncompressedSize: number;
    modifiedAt?: string;
    comment?: string;
    offset?: number;
    extraLength?: number;
  }>;
}

export interface HvccNalArray {
  nalType: number;
  nalTypeName: string;
  count: number;
  lengths: number[];
}

export interface BitstreamInfo {
  codec: 'hevc' | 'avc' | string;
  config: Record<string, unknown>;
  firstSampleNals: number[];
  seiUserData: Array<{ uuid: string; text: string; offset?: number }>;
  nalArrays?: HvccNalArray[];
}

export interface VideoStats {
  frames: number;
  keyframes: number;
  keyframeTimes: number[];
  keyframeFrames: number[];
  gopGaps: number[];
  maxGopFrames: number;
  maxGopSec: number;
  kbpsPerSecond: {
    mean: number;
    median: number;
    min: number;
    max: number;
    stdev: number;
    fullSeconds: number;
    series: Array<{ second: number; kbps: number }>;
  };
}

export interface TimelineEntry {
  label: string;
  value: string;
  utc?: string;
  tz?: string;
  anomaly?: string;
  source?: string;
  tagRef?: string;
  isZeroed?: boolean;
}

export interface LocationInfo {
  lat: number;
  lon: number;
  latDms: string;
  lonDms: string;
  alt?: number;
  direction?: number;
  source: string;
  accuracyNote?: string;
}

export interface ProvenanceInfo {
  c2pa?: {
    present: boolean;
    valid?: boolean;
    signer?: string;
    actions?: string[];
    signedAt?: string;
    claimGenerator?: string;
    statusMessage?: string;
  };
  aiMarkers: Array<{
    source: string;
    indicator: string;
    confidence: Confidence;
    detail: string;
  }>;
  processingChain: string[];
}

export interface CoverageInfo {
  mapped: boolean;
  explainedBytes: number;
  totalBytes: number;
  unexplained: Array<{ offset: number; size: number }>;
  segments?: Array<{ label: string; offset: number; size: number; colorKey: string }>;
}

export interface CheckResult {
  id: string;
  name: string;
  nameEn?: string;
  status: CheckStatus;
  detail?: string;
  detailEn?: string;
}

export interface Finding {
  id: string;
  text: string;
  textEn?: string;
  confidence: Confidence;
  evidence: string[];
  evidenceLinks?: Array<{
    label: string;
    kind: 'tag' | 'offset' | 'section';
    target: string | number;
  }>;
}

export interface PrivacyItem {
  id: string;
  severity: Severity;
  weight: number;
  text: string;
  textEn?: string;
  advice: string;
  adviceEn?: string;
  evidence?: string[];
}

export interface HashTestResult {
  tagName: string;
  tagNamespace: string;
  algorithm: 'md5' | 'sha1' | 'sha256';
  tagHash: string;
  matches: Array<{
    region: string;
    computedHash: string;
    matched: boolean;
  }>;
  anyMatched: boolean;
}

export interface AnalyzerWarning {
  analyzer: string;
  message: string;
}

export interface Report {
  meta: {
    schema: '1.0';
    analyzedAt: string;
    mode: AnalysisMode;
    analyzers: Record<string, string>;
    completedAnalyzers: number;
    totalAnalyzers: number;
    durationMs?: number;
    deepModeFallback?: string;
  };
  file: {
    name: string;
    size: number;
    detectedType: string;
    detectedMime: string;
    detectedFamily: 'video' | 'image' | 'audio' | 'pdf' | 'office' | 'archive' | 'unknown';
    extension: string;
    extensionMatches: boolean;
    hashes: {
      md5: string;
      sha1: string;
      sha256: string;
    };
  };
  tags: TagEntry[];
  technical: {
    video?: VideoInfo;
    image?: ImageInfo;
    audio?: AudioInfo;
    document?: DocInfo;
  };
  structure: BoxNode[];
  bitstream?: BitstreamInfo;
  stats?: VideoStats;
  timeline: TimelineEntry[];
  location?: LocationInfo;
  provenance?: ProvenanceInfo;
  coverage: CoverageInfo;
  hashTests?: HashTestResult[];
  checks: CheckResult[];
  findings: Finding[];
  privacy: {
    score: number;
    items: PrivacyItem[];
  };
  warnings: AnalyzerWarning[];
}

export interface DiffReport {
  fileA: { name: string; size: number; detectedType: string; md5: string; sha256: string; privacyScore: number };
  fileB: { name: string; size: number; detectedType: string; md5: string; sha256: string; privacyScore: number };
  hashesMatch: boolean;
  privacyDelta: number;
  tags: {
    added: TagEntry[];
    removed: TagEntry[];
    changed: Array<{ key: string; ns: string; name: string; before: string; after: string }>;
    unchangedCount: number;
  };
  structure: {
    added: BoxNode[];
    removed: BoxNode[];
    resized: Array<{ path: string; type: string; beforeSize: number; afterSize: number }>;
  };
  findings: {
    added: Finding[];
    removed: Finding[];
  };
}
