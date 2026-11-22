import type { Confidence, Finding, Report } from '../engine/types';

export interface InferenceRule {
  id: string;
  appliesTo: Array<Report['file']['detectedFamily'] | 'all'>;
  confidence: Confidence;
  evaluate: (report: Report) => Finding | null;
}

function mapLavfToFfmpeg(lavf: string): string {
  const m = lavf.match(/Lavf(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return lavf;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  if (major === 58 && minor >= 76) return `${lavf} (FFmpeg seri 4.4)`;
  if (major === 58 && minor >= 45) return `${lavf} (FFmpeg seri 4.3)`;
  if (major === 58 && minor >= 29) return `${lavf} (FFmpeg seri 4.2)`;
  if (major === 59 && minor >= 27) return `${lavf} (FFmpeg seri 5.1)`;
  if (major === 59) return `${lavf} (FFmpeg seri 5.0)`;
  if (major === 60 && minor >= 16) return `${lavf} (FFmpeg seri 6.1)`;
  if (major === 60) return `${lavf} (FFmpeg seri 6.0)`;
  if (major === 61) return `${lavf} (FFmpeg seri 7.x)`;
  return lavf;
}

const KNOWN_EDITORS = [
  'photoshop',
  'lightroom',
  'gimp',
  'snapseed',
  'canva',
  'pixelmator',
  'affinity',
  'capture one',
  'darktable',
  'vsco',
  'picsart',
  'capcut',
  'premiere',
  'davinci',
  'final cut',
];

const SERVER_ENCODERS = ['bytevc', 'x264', 'x265', 'libx264', 'libx265', 'svt-av1', 'lavc', 'ffmpeg'];

export const INFERENCE_RULES: InferenceRule[] = [
  {
    id: 'mp4_faststart',
    appliesTo: ['video'],
    confidence: 'pasti',
    evaluate: (r) => {
      const v = r.technical.video;
      if (!v || !v.faststart) return null;
      const moovOff = v.mp4Integrity?.moovOffset ?? 0;
      const mdatOff = v.mp4Integrity?.mdatOffset ?? 0;
      return {
        id: 'mp4_faststart',
        confidence: 'pasti',
        text: 'Siap streaming (faststart): atom moov ditempatkan sebelum mdat.',
        textEn: 'Streaming-ready (faststart): moov box is placed before mdat.',
        evidence: [`/moov @ 0x${moovOff.toString(16).toUpperCase()}`, `/mdat @ 0x${mdatOff.toString(16).toUpperCase()}`],
        evidenceLinks: [
          { label: `moov (0x${moovOff.toString(16).toUpperCase()})`, kind: 'offset', target: moovOff },
          { label: `mdat (0x${mdatOff.toString(16).toUpperCase()})`, kind: 'offset', target: mdatOff },
        ],
      };
    },
  },
  {
    id: 'mp4_sei_encoder',
    appliesTo: ['video'],
    confidence: 'kuat',
    evaluate: (r) => {
      const sei = r.bitstream?.seiUserData?.find((s) => s.text && s.text.length >= 3);
      if (!sei) return null;
      return {
        id: 'mp4_sei_encoder',
        confidence: 'kuat',
        text: `Video di-encode oleh ${sei.text} (terbaca dari SEI user_data_unregistered pada bitstream sampel pertama).`,
        textEn: `Video was encoded by ${sei.text} (extracted from first-sample bitstream SEI user_data_unregistered).`,
        evidence: [`SEI UUID ${sei.uuid}`, sei.text],
        evidenceLinks: sei.offset !== undefined ? [{ label: `SEI @ 0x${sei.offset.toString(16).toUpperCase()}`, kind: 'offset', target: sei.offset }] : [{ label: 'Teknis / Bitstream', kind: 'section', target: 'technical' }],
      };
    },
  },
  {
    id: 'mp4_lavf_muxer',
    appliesTo: ['video', 'audio'],
    confidence: 'kuat',
    evaluate: (r) => {
      const encTag = r.tags.find(
        (t) =>
          /encoder|handler|tool|software/i.test(t.name) &&
          typeof (t.decoded ?? t.raw) === 'string' &&
          /^Lavf/i.test(String(t.decoded ?? t.raw).trim()),
      );
      if (!encTag) return null;
      const val = String(encTag.decoded ?? encTag.raw).trim();
      const mapped = mapLavfToFfmpeg(val);
      return {
        id: 'mp4_lavf_muxer',
        confidence: 'kuat',
        text: `Kontainer ditulis oleh FFmpeg/libavformat ${mapped}.`,
        textEn: `Container was muxed by FFmpeg/libavformat ${mapped}.`,
        evidence: [`${encTag.ns}:${encTag.name} = "${val}"`],
        evidenceLinks: [
          { label: `${encTag.ns}:${encTag.name}`, kind: 'tag', target: `${encTag.ns}:${encTag.name}` },
          ...(encTag.offset !== undefined ? [{ label: `0x${encTag.offset.toString(16).toUpperCase()}`, kind: 'offset' as const, target: encTag.offset }] : []),
        ],
      };
    },
  },
  {
    id: 'mp4_device_metadata_stripped',
    appliesTo: ['video'],
    confidence: 'kuat',
    evaluate: (r) => {
      const zeroDates = r.timeline.filter((t) => t.isZeroed);
      const nonZeroDates = r.timeline.filter((t) => !t.isZeroed && t.utc);
      const hasMakeModel = r.tags.some((t) => /^(make|model|com\.apple\.quicktime\.make|com\.apple\.quicktime\.model)$/i.test(t.name));
      if (zeroDates.length > 0 && nonZeroDates.length === 0 && !r.location && !hasMakeModel) {
        return {
          id: 'mp4_device_metadata_stripped',
          confidence: 'kuat',
          text: 'Jejak perangkat dan waktu rekam sudah dihapus (semua tanggal kontainer bernilai nol, tanpa GPS/Make/Model).',
          textEn: 'Device fingerprint and capture timestamps were stripped (all container dates are zeroed, no GPS/Make/Model).',
          evidence: zeroDates.slice(0, 3).map((d) => `${d.label} = 0000:00:00`),
          evidenceLinks: zeroDates.slice(0, 2).map((d) => ({
            label: d.tagRef ?? d.label,
            kind: 'tag' as const,
            target: d.tagRef ?? 'MP4/mvhd:CreateDate',
          })),
        };
      }
      return null;
    },
  },
  {
    id: 'mp4_server_reencode',
    appliesTo: ['video'],
    confidence: 'kuat',
    evaluate: (r) => {
      const seiText = r.bitstream?.seiUserData?.map((s) => s.text.toLowerCase()).join(' ') ?? '';
      const hasServerEncoder = SERVER_ENCODERS.some((k) => seiText.includes(k));
      const encTag = r.tags.find((t) => /encoder/i.test(t.name) && /^Lavf/i.test(String(t.decoded ?? t.raw ?? '')));
      if (hasServerEncoder && encTag) {
        return {
          id: 'mp4_server_reencode',
          confidence: 'kuat',
          text: 'Kemungkinan hasil pemrosesan ulang (re-encode server), bukan rekaman langsung dari kamera perangkat.',
          textEn: 'Likely server-side re-encoded output rather than a direct camera recording.',
          evidence: [`SEI: ${r.bitstream?.seiUserData?.[0]?.text}`, `${encTag.ns}:${encTag.name} = ${encTag.decoded ?? encTag.raw}`],
          evidenceLinks: [
            { label: `${encTag.ns}:${encTag.name}`, kind: 'tag', target: `${encTag.ns}:${encTag.name}` },
          ],
        };
      }
      return null;
    },
  },
  {
    id: 'tag_hash_mismatch',
    appliesTo: ['all'],
    confidence: 'kuat',
    evaluate: (r) => {
      const failed = r.hashTests?.filter((ht) => !ht.anyMatched);
      if (!failed || failed.length === 0) return null;
      const first = failed[0];
      return {
        id: 'tag_hash_mismatch',
        confidence: 'kuat',
        text: `Hash di tag ${first.tagName} (${first.tagHash}) tidak merujuk ke file ini (tidak cocok dengan file utuh maupun payload mdat/moov).`,
        textEn: `Hash in tag ${first.tagName} (${first.tagHash}) does not match this file (tested against full file and mdat/moov regions).`,
        evidence: [
          `${first.tagNamespace}:${first.tagName} = ${first.tagHash}`,
          ...first.matches.map((m) => `${m.region}: ${m.computedHash}`),
        ],
        evidenceLinks: [{ label: `${first.tagNamespace}:${first.tagName}`, kind: 'tag', target: `${first.tagNamespace}:${first.tagName}` }],
      };
    },
  },
  {
    id: 'tiktok_id_filename_timestamp',
    appliesTo: ['video', 'all'],
    confidence: 'heuristik',
    evaluate: (r) => {
      // Match 18-19 digit ID between underscores or standalone token in filename
      const match = r.file.name.match(/(?:^|[_\-\s])(\d{18,19})(?:[_\-\s.]|$)/);
      if (!match) return null;
      try {
        const idBig = BigInt(match[1]);
        const epochSec = Number(idBig >> BigInt(32));
        // Plausible Unix timestamp between 2016-01-01 and 2035-01-01
        if (epochSec < 1451606400 || epochSec > 2051222400) return null;
        const utc = new Date(epochSec * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
        return {
          id: 'tiktok_id_filename_timestamp',
          confidence: 'heuristik',
          text: `Perkiraan waktu posting dari nama file: ${utc} (pola umum ID 64-bit TikTok dengan geser kanan 32 bit — bukan metadata di dalam isi file).`,
          textEn: `Estimated posting time from filename: ${utc} (common 64-bit TikTok ID right-shift 32 bits heuristic — not embedded file metadata).`,
          evidence: [`Filename ID: ${match[1]}`, `(${match[1]} >> 32) = ${epochSec} (${utc})`],
          evidenceLinks: [{ label: 'Waktu & Lokasi', kind: 'section', target: 'timeline' }],
        };
      } catch {
        return null;
      }
    },
  },
  {
    id: 'image_device_firmware',
    appliesTo: ['image'],
    confidence: 'kuat',
    evaluate: (r) => {
      const make = r.tags.find((t) => /^make$/i.test(t.name))?.decoded;
      const model = r.tags.find((t) => /^model$/i.test(t.name))?.decoded;
      const software = r.tags.find((t) => /^software$/i.test(t.name))?.decoded;
      if (!make && !model) return null;
      const device = [make, model].filter(Boolean).join(' ');
      return {
        id: 'image_device_firmware',
        confidence: 'kuat',
        text: `Perangkat teridentifikasi dari EXIF: ${device}${software ? ` (firmware/software: ${software})` : ''}.`,
        textEn: `Device identified from EXIF: ${device}${software ? ` (firmware/software: ${software})` : ''}.`,
        evidence: [make ? `Make=${make}` : '', model ? `Model=${model}` : '', software ? `Software=${software}` : ''].filter(Boolean),
        evidenceLinks: [{ label: 'IFD0:Model', kind: 'tag', target: 'Model' }],
      };
    },
  },
  {
    id: 'image_editor_detected',
    appliesTo: ['image'],
    confidence: 'kuat',
    evaluate: (r) => {
      const softTag = r.tags.find(
        (t) =>
          /software|creatortool|historysoftwareagent/i.test(t.name) &&
          KNOWN_EDITORS.some((ed) => String(t.decoded ?? t.raw ?? '').toLowerCase().includes(ed)),
      );
      if (!softTag) return null;
      return {
        id: 'image_editor_detected',
        confidence: 'kuat',
        text: `Gambar pernah diproses menggunakan perangkat lunak penyunting: ${softTag.decoded ?? softTag.raw}.`,
        textEn: `Image was processed with editing software: ${softTag.decoded ?? softTag.raw}.`,
        evidence: [`${softTag.ns}:${softTag.name} = "${softTag.decoded ?? softTag.raw}"`],
        evidenceLinks: [{ label: `${softTag.ns}:${softTag.name}`, kind: 'tag', target: `${softTag.ns}:${softTag.name}` }],
      };
    },
  },
  {
    id: 'image_thumbnail_mismatch',
    appliesTo: ['image'],
    confidence: 'kuat',
    evaluate: (r) => {
      const thumb = r.technical.image?.thumbnail;
      if (!thumb?.present || thumb.aspectRatioDiff === undefined || thumb.aspectRatioDiff <= 0.12) return null;
      return {
        id: 'image_thumbnail_mismatch',
        confidence: 'kuat',
        text: `Thumbnail tertanam (${thumb.width}×${thumb.height}) tidak sesuai dengan gambar utama (${r.technical.image?.width}×${r.technical.image?.height}) — kemungkinan gambar pernah dipotong atau diedit tanpa memperbarui thumbnail.`,
        textEn: `Embedded thumbnail (${thumb.width}×${thumb.height}) does not match the main image (${r.technical.image?.width}×${r.technical.image?.height}) — image was likely cropped or edited.`,
        evidence: [`Thumbnail ${thumb.width}×${thumb.height}`, `Main ${r.technical.image?.width}×${r.technical.image?.height}`, `Aspect diff ${thumb.aspectRatioDiff}`],
        evidenceLinks: [{ label: 'Teknis / Thumbnail', kind: 'section', target: 'technical' }],
      };
    },
  },
  {
    id: 'trailing_data_after_eof',
    appliesTo: ['image'],
    confidence: 'pasti',
    evaluate: (r) => {
      const td = r.technical.image?.trailingData;
      if (!td || td.size <= 0) return null;
      return {
        id: 'trailing_data_after_eof',
        confidence: 'pasti',
        text: `Terdapat ${td.size.toLocaleString('id-ID')} byte data tambahan setelah marker akhir gambar (offset 0x${td.offset.toString(16).toUpperCase()}).`,
        textEn: `${td.size.toLocaleString('en-US')} trailing bytes exist after the image end marker (offset 0x${td.offset.toString(16).toUpperCase()}).`,
        evidence: [`Trailing offset 0x${td.offset.toString(16).toUpperCase()}`, `${td.size} bytes`],
        evidenceLinks: [{ label: `Hex @ 0x${td.offset.toString(16).toUpperCase()}`, kind: 'offset', target: td.offset }],
      };
    },
  },
  {
    id: 'pdf_incremental_updates',
    appliesTo: ['pdf'],
    confidence: 'kuat',
    evaluate: (r) => {
      const eof = r.technical.document?.eofCount ?? 0;
      if (eof <= 1) return null;
      return {
        id: 'pdf_incremental_updates',
        confidence: 'kuat',
        text: `Dokumen PDF diubah setelah dibuat: ditemukan ${eof} marker %%EOF (update inkremental).`,
        textEn: `PDF document was modified after creation: ${eof} %%EOF markers detected (incremental updates).`,
        evidence: [`PDF/Structure:EOFRevisions = ${eof}`],
        evidenceLinks: [{ label: 'Struktur PDF', kind: 'section', target: 'structure' }],
      };
    },
  },
  {
    id: 'ai_marker_detected',
    appliesTo: ['all'],
    confidence: 'heuristik',
    evaluate: (r) => {
      const markers = r.provenance?.aiMarkers ?? [];
      if (markers.length === 0) return null;
      const hasStrongC2pa = markers.some((m) => m.confidence === 'kuat');
      return {
        id: 'ai_marker_detected',
        confidence: hasStrongC2pa ? 'kuat' : 'heuristik',
        text: `Terdeteksi penanda konten AI (${markers.map((m) => m.indicator).join(', ')}). Ketiadaan penanda bukan bukti konten bukan AI.`,
        textEn: `AI content marker(s) detected (${markers.map((m) => m.indicator).join(', ')}). Absence of markers does not prove non-AI origin.`,
        evidence: markers.map((m) => `${m.source}: ${m.detail}`),
        evidenceLinks: [{ label: 'Provenance', kind: 'section', target: 'provenance' }],
      };
    },
  },
];
