import { analyzeAudio } from './audio';
import { analyzeC2pa } from './c2pa';
import { computeRegionHash, computeStreamingHashes } from './hasher';
import { analyzeImage } from './image';
import { detectFileMagic } from './magic';
import { analyzeMp4 } from './mp4';
import { analyzeTarOrGzip, analyzeZipOrOffice } from './officeArchive';
import { analyzePdf } from './pdf';
import { evaluateAllRules } from '../rules/engine';
import type {
  AnalysisMode,
  AnalyzerWarning,
  HashTestResult,
  Report,
  TagEntry,
} from './types';

export interface AnalyzeOptions {
  filename: string;
  mode?: AnalysisMode;
  onProgress?: (stage: string, fraction: number) => void;
  signal?: AbortSignal;
  skipC2pa?: boolean;
}

async function runTagHashTests(file: Blob, report: Report): Promise<HashTestResult[]> {
  const results: HashTestResult[] = [];
  const seen = new Set<string>();

  for (const tag of report.tags) {
    const rawStr = String(tag.decoded ?? tag.raw ?? '').trim().toLowerCase();
    let algorithm: 'md5' | 'sha1' | 'sha256' | null = null;
    if (/^[0-9a-f]{32}$/.test(rawStr)) algorithm = 'md5';
    else if (/^[0-9a-f]{40}$/.test(rawStr)) algorithm = 'sha1';
    else if (/^[0-9a-f]{64}$/.test(rawStr)) algorithm = 'sha256';
    if (!algorithm) continue;

    // Avoid matching pure hex UUIDs unless tag name looks like a hash/md5/sha/digest
    if (!/(md5|sha|hash|digest|checksum|etag)/i.test(tag.name) && algorithm === 'md5') {
      continue;
    }

    const dedup = `${tag.ns}:${tag.name}:${rawStr}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const matches: HashTestResult['matches'] = [];
    const fullHash = report.file.hashes[algorithm];
    matches.push({
      region: 'file utuh',
      computedHash: fullHash,
      matched: fullHash.toLowerCase() === rawStr,
    });

    // MP4 internal regions: mdat payload & moov box
    const mp4Int = report.technical.video?.mp4Integrity;
    if (mp4Int?.mdatPayloadOffset !== undefined && mp4Int.mdatPayloadSize !== undefined && mp4Int.mdatPayloadSize > 0) {
      const mdatHash = await computeRegionHash(file, mp4Int.mdatPayloadOffset, mp4Int.mdatPayloadSize, algorithm);
      matches.push({
        region: 'payload mdat',
        computedHash: mdatHash,
        matched: mdatHash.toLowerCase() === rawStr,
      });
    }
    if (mp4Int?.moovOffset !== undefined && mp4Int.moovSize !== undefined && mp4Int.moovSize > 0) {
      const moovHash = await computeRegionHash(file, mp4Int.moovOffset, mp4Int.moovSize, algorithm);
      matches.push({
        region: 'box moov',
        computedHash: moovHash,
        matched: moovHash.toLowerCase() === rawStr,
      });
    }

    results.push({
      tagName: tag.name,
      tagNamespace: tag.ns,
      algorithm,
      tagHash: rawStr,
      matches,
      anyMatched: matches.some((m) => m.matched),
    });
  }

  return results;
}

export async function analyzeFilePrivate(file: Blob, options: AnalyzeOptions): Promise<Report> {
  const startedAt = performance.now();
  const warnings: AnalyzerWarning[] = [];
  const analyzers: Record<string, string> = {};
  let completedAnalyzers = 0;
  let totalAnalyzers = 3; // magic + hash + rules

  options.onProgress?.('magic', 0.05);
  const magic = await detectFileMagic(file, options.filename);
  analyzers.magic = '1.0';
  completedAnalyzers++;

  if (options.signal?.aborted) {
    throw new DOMException('Analysis aborted', 'AbortError');
  }

  options.onProgress?.('hashes', 0.15);
  let hashes = { md5: '', sha1: '', sha256: '' };
  try {
    hashes = await computeStreamingHashes(
      file,
      (f) => options.onProgress?.('hashes', 0.15 + f * 0.35),
      options.signal,
    );
    analyzers.hasher = 'hash-wasm-4.13.0';
    completedAnalyzers++;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    warnings.push({ analyzer: 'hasher', message: (err as Error).message || 'Gagal menghitung hash' });
  }

  const report: Report = {
    meta: {
      schema: '1.0',
      analyzedAt: new Date().toISOString(),
      mode: options.mode ?? 'privat',
      analyzers,
      completedAnalyzers,
      totalAnalyzers,
    },
    file: {
      name: options.filename,
      size: file.size,
      detectedType: magic.type,
      detectedMime: magic.mime,
      detectedFamily: magic.family,
      extension: magic.extension,
      extensionMatches: magic.extensionMatches,
      hashes,
    },
    tags: [],
    technical: {},
    structure: [],
    timeline: [],
    coverage: {
      mapped: false,
      explainedBytes: 0,
      totalBytes: file.size,
      unexplained: file.size > 0 ? [{ offset: 0, size: file.size }] : [],
    },
    checks: [],
    findings: [],
    privacy: { score: 0, items: [] },
    warnings,
  };

  if (options.signal?.aborted) {
    throw new DOMException('Analysis aborted', 'AbortError');
  }

  // Format-specific analyzer (fault-isolated)
  options.onProgress?.('parser', 0.55);
  if (magic.type === 'MP4' || magic.type === 'QuickTime MOV' || magic.type === '3GP Video (MP4)' || magic.type === 'M4A Audio (MP4)') {
    totalAnalyzers++;
    try {
      const mp4Res = await analyzeMp4(file);
      report.structure = mp4Res.structure;
      report.tags.push(...mp4Res.tags);
      report.technical.video = mp4Res.technical;
      report.bitstream = mp4Res.bitstream;
      report.stats = mp4Res.stats;
      report.timeline.push(...mp4Res.timeline);
      report.coverage = mp4Res.coverage;
      analyzers.mp4 = 'custom-1.0';
      completedAnalyzers++;
    } catch (err) {
      warnings.push({ analyzer: 'mp4', message: (err as Error).message || 'Parser MP4 gagal' });
    }
    if (magic.family === 'audio') {
      totalAnalyzers++;
      try {
        const audioRes = await analyzeAudio(file, magic.type);
        report.technical.audio = audioRes.technical;
        report.tags.push(...audioRes.tags);
        analyzers.audio = 'music-metadata-12.8.0';
        completedAnalyzers++;
      } catch (err) {
        warnings.push({ analyzer: 'audio', message: (err as Error).message || 'Parser audio gagal' });
      }
    }
  } else if (magic.family === 'image') {
    totalAnalyzers++;
    try {
      const imgRes = await analyzeImage(file, magic.type);
      report.structure = imgRes.structure;
      report.tags.push(...imgRes.tags);
      report.technical.image = imgRes.technical;
      report.timeline.push(...imgRes.timeline);
      report.location = imgRes.location;
      report.coverage = imgRes.coverage;
      analyzers.image = 'custom+exifr-7.1.3';
      completedAnalyzers++;
    } catch (err) {
      warnings.push({ analyzer: 'image', message: (err as Error).message || 'Parser gambar gagal' });
    }
  } else if (magic.family === 'pdf') {
    totalAnalyzers++;
    try {
      const pdfRes = await analyzePdf(file);
      report.structure = pdfRes.structure;
      report.tags.push(...pdfRes.tags);
      report.technical.document = pdfRes.technical;
      report.timeline.push(...pdfRes.timeline);
      report.coverage = pdfRes.coverage;
      analyzers.pdf = 'custom-1.0';
      completedAnalyzers++;
    } catch (err) {
      warnings.push({ analyzer: 'pdf', message: (err as Error).message || 'Parser PDF gagal' });
    }
  } else if (magic.family === 'office' || magic.type === 'ZIP') {
    totalAnalyzers++;
    try {
      const zipRes = await analyzeZipOrOffice(file, magic.type);
      report.structure = zipRes.structure;
      report.tags.push(...zipRes.tags);
      report.technical.document = zipRes.technical;
      report.timeline.push(...zipRes.timeline);
      report.coverage = zipRes.coverage;
      if (zipRes.refinedType) report.file.detectedType = zipRes.refinedType;
      if (zipRes.refinedFamily) report.file.detectedFamily = zipRes.refinedFamily;
      analyzers.officeArchive = 'fflate-0.8.3';
      completedAnalyzers++;
    } catch (err) {
      warnings.push({ analyzer: 'officeArchive', message: (err as Error).message || 'Parser ZIP/Office gagal' });
    }
  } else if (magic.type === 'TAR' || magic.type === 'GZIP') {
    totalAnalyzers++;
    try {
      const archRes = await analyzeTarOrGzip(file, magic.type);
      report.structure = archRes.structure;
      report.tags.push(...archRes.tags);
      report.technical.document = archRes.technical;
      report.timeline.push(...archRes.timeline);
      report.coverage = archRes.coverage;
      analyzers.archive = 'custom-1.0';
      completedAnalyzers++;
    } catch (err) {
      warnings.push({ analyzer: 'archive', message: (err as Error).message || 'Parser arsip gagal' });
    }
  } else if (magic.family === 'audio') {
    totalAnalyzers++;
    try {
      const audioRes = await analyzeAudio(file, magic.type);
      report.structure = audioRes.structure;
      report.tags.push(...audioRes.tags);
      report.technical.audio = audioRes.technical;
      report.timeline.push(...audioRes.timeline);
      report.coverage = audioRes.coverage;
      analyzers.audio = 'music-metadata-12.8.0';
      completedAnalyzers++;
    } catch (err) {
      warnings.push({ analyzer: 'audio', message: (err as Error).message || 'Parser audio gagal' });
    }
  }

  // Lazy C2PA provenance check
  if (!options.skipC2pa && (magic.family === 'image' || magic.family === 'video' || magic.family === 'pdf' || magic.family === 'audio')) {
    totalAnalyzers++;
    try {
      const c2pa = await analyzeC2pa(file, magic.mime);
      report.provenance = { c2pa, aiMarkers: [], processingChain: [] };
      analyzers.c2pa = '@contentauth/c2pa-web-0.17.1';
      completedAnalyzers++;
    } catch (err) {
      warnings.push({ analyzer: 'c2pa', message: (err as Error).message || 'C2PA gagal dimuat' });
    }
  }

  // FR-14: Tag hash verification against file & container regions
  options.onProgress?.('hashTests', 0.82);
  try {
    const hashTests = await runTagHashTests(file, report);
    if (hashTests.length > 0) {
      report.hashTests = hashTests;
    }
  } catch (err) {
    warnings.push({ analyzer: 'hashTest', message: (err as Error).message || 'Uji hash tag gagal' });
  }

  // Evaluate declarative rules engine (L6 cross-checks, L7 inferences, privacy score)
  options.onProgress?.('rules', 0.92);
  try {
    evaluateAllRules(report);
    analyzers.rules = '1.0';
    completedAnalyzers++;
  } catch (err) {
    warnings.push({ analyzer: 'rules', message: (err as Error).message || 'Mesin aturan gagal' });
  }

  report.meta.completedAnalyzers = completedAnalyzers;
  report.meta.totalAnalyzers = totalAnalyzers;
  report.meta.durationMs = Math.round(performance.now() - startedAt);

  options.onProgress?.('done', 1);
  return report;
}

export interface DeepServerResponse {
  status: 'ok' | 'engine_unavailable' | 'error';
  message?: string;
  tags?: TagEntry[];
  warnings?: AnalyzerWarning[];
  ffprobe?: Record<string, unknown>;
  engines?: Record<string, string>;
}

export function mergeDeepServerResults(baseReport: Report, server: DeepServerResponse): Report {
  const merged: Report = JSON.parse(JSON.stringify(baseReport));
  if (server.status === 'engine_unavailable') {
    merged.meta.mode = 'privat';
    merged.meta.deepModeFallback =
      server.message || 'Engine server (ExifTool/Perl) tidak tersedia; turun otomatis ke Mode Privat.';
    merged.warnings.push({
      analyzer: 'deep-server',
      message: merged.meta.deepModeFallback,
    });
    return merged;
  }

  merged.meta.mode = 'mendalam';
  if (server.engines) {
    merged.meta.analyzers = { ...merged.meta.analyzers, ...server.engines };
  }
  if (server.warnings) {
    merged.warnings.push(...server.warnings);
  }

  // Merge tags & flag discrepancies ("selisih") rather than silently picking one!
  const byName = new Map<string, TagEntry>();
  for (const t of merged.tags) {
    byName.set(t.name.toLowerCase(), t);
  }

  for (const st of server.tags ?? []) {
    const existing = byName.get(st.name.toLowerCase());
    const serverVal = String(st.decoded ?? st.raw ?? '').trim();
    if (existing) {
      const localVal = String(existing.decoded ?? existing.raw ?? '').trim();
      if (localVal && serverVal && localVal !== serverVal) {
        existing.discrepancy = {
          otherSource: st.source,
          otherValue: serverVal,
        };
      }
      // Keep server tag as separate entry if namespace differs (e.g., MakerNotes)
      if (existing.ns !== st.ns) {
        merged.tags.push(st);
      }
    } else {
      merged.tags.push(st);
      byName.set(st.name.toLowerCase(), st);
    }
  }

  // Re-run rule engine with enriched server tags (e.g., MakerNotes, serial numbers)
  evaluateAllRules(merged);
  return merged;
}
