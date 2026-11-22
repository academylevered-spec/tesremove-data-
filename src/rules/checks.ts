import type { CheckResult, Report } from '../engine/types';

export interface CrossCheckRule {
  id: string;
  appliesTo: Array<Report['file']['detectedFamily'] | 'all'>;
  evaluate: (report: Report) => CheckResult;
}

export const CROSS_CHECK_RULES: CrossCheckRule[] = [
  {
    id: 'mp4_video_stsz_stts',
    appliesTo: ['video'],
    evaluate: (r) => {
      const m = r.technical.video?.mp4Integrity;
      if (!m || m.videoStszCount === 0) {
        return { id: 'mp4_video_stsz_stts', name: 'Sampel video stsz == stts', nameEn: 'Video samples stsz == stts', status: 'tidak_berlaku' };
      }
      const ok = m.videoStszCount === m.videoSttsFrameCount;
      return {
        id: 'mp4_video_stsz_stts',
        name: 'Sampel video stsz == stts',
        nameEn: 'Video samples stsz == stts',
        status: ok ? 'lolos' : 'gagal',
        detail: `stsz = ${m.videoStszCount.toLocaleString('id-ID')}, stts = ${m.videoSttsFrameCount.toLocaleString('id-ID')}`,
        detailEn: `stsz = ${m.videoStszCount.toLocaleString('en-US')}, stts = ${m.videoSttsFrameCount.toLocaleString('en-US')}`,
      };
    },
  },
  {
    id: 'mp4_video_stss_keyframes',
    appliesTo: ['video'],
    evaluate: (r) => {
      const m = r.technical.video?.mp4Integrity;
      if (!m || !r.stats) {
        return { id: 'mp4_video_stss_keyframes', name: 'Entri stss == jumlah keyframe', nameEn: 'stss entries == keyframe count', status: 'tidak_berlaku' };
      }
      const ok = m.videoStssCount === r.stats.keyframes && r.stats.keyframeTimes.length === m.videoStssCount;
      return {
        id: 'mp4_video_stss_keyframes',
        name: 'Entri stss == jumlah keyframe',
        nameEn: 'stss entries == keyframe count',
        status: ok ? 'lolos' : 'gagal',
        detail: `stss = ${m.videoStssCount}, keyframe terpetakan = ${r.stats.keyframeTimes.length}`,
        detailEn: `stss = ${m.videoStssCount}, mapped keyframes = ${r.stats.keyframeTimes.length}`,
      };
    },
  },
  {
    id: 'mp4_audio_stsz_stts',
    appliesTo: ['video'],
    evaluate: (r) => {
      const m = r.technical.video?.mp4Integrity;
      if (!m || m.audioStszCount === 0) {
        return { id: 'mp4_audio_stsz_stts', name: 'Paket audio stsz == stts', nameEn: 'Audio packets stsz == stts', status: 'tidak_berlaku' };
      }
      const ok = m.audioStszCount === m.audioSttsPacketCount;
      return {
        id: 'mp4_audio_stsz_stts',
        name: 'Paket audio stsz == stts',
        nameEn: 'Audio packets stsz == stts',
        status: ok ? 'lolos' : 'gagal',
        detail: `stsz = ${m.audioStszCount.toLocaleString('id-ID')}, stts = ${m.audioSttsPacketCount.toLocaleString('id-ID')}`,
        detailEn: `stsz = ${m.audioStszCount.toLocaleString('en-US')}, stts = ${m.audioSttsPacketCount.toLocaleString('en-US')}`,
      };
    },
  },
  {
    id: 'mp4_top_box_sum',
    appliesTo: ['video'],
    evaluate: (r) => {
      const m = r.technical.video?.mp4Integrity;
      if (!m) {
        return { id: 'mp4_top_box_sum', name: 'Jumlah box tingkat atas == ukuran file', nameEn: 'Top-level boxes sum == file size', status: 'tidak_berlaku' };
      }
      const ok = m.topLevelBoxSum === r.file.size;
      return {
        id: 'mp4_top_box_sum',
        name: 'Jumlah box tingkat atas == ukuran file',
        nameEn: 'Top-level boxes sum == file size',
        status: ok ? 'lolos' : 'gagal',
        detail: `Total box = ${m.topLevelBoxSum.toLocaleString('id-ID')} byte, file = ${r.file.size.toLocaleString('id-ID')} byte`,
        detailEn: `Boxes sum = ${m.topLevelBoxSum.toLocaleString('en-US')} bytes, file = ${r.file.size.toLocaleString('en-US')} bytes`,
      };
    },
  },
  {
    id: 'extension_matches_magic',
    appliesTo: ['all'],
    evaluate: (r) => {
      if (!r.file.extension || r.file.detectedFamily === 'unknown') {
        return {
          id: 'extension_matches_magic',
          name: 'Ekstensi cocok dengan magic bytes',
          nameEn: 'Extension matches magic bytes',
          status: 'tidak_berlaku',
          detail: 'Ekstensi tidak ada atau tipe biner tidak dikenal',
          detailEn: 'No extension or unrecognized binary format',
        };
      }
      return {
        id: 'extension_matches_magic',
        name: 'Ekstensi cocok dengan magic bytes',
        nameEn: 'Extension matches magic bytes',
        status: r.file.extensionMatches ? 'lolos' : 'gagal',
        detail: r.file.extensionMatches
          ? `Ekstensi .${r.file.extension} sesuai dengan isi ${r.file.detectedType}`
          : `Ekstensi .${r.file.extension} tidak sesuai dengan isi sebenarnya (${r.file.detectedType})`,
        detailEn: r.file.extensionMatches
          ? `Extension .${r.file.extension} matches detected ${r.file.detectedType}`
          : `Extension .${r.file.extension} does not match actual content (${r.file.detectedType})`,
      };
    },
  },
  {
    id: 'image_end_marker',
    appliesTo: ['image'],
    evaluate: (r) => {
      const img = r.technical.image;
      if (!img || (img.format !== 'JPEG' && img.format !== 'PNG')) {
        return { id: 'image_end_marker', name: 'Marker akhir file & data tambahan', nameEn: 'End-of-file marker & trailing data', status: 'tidak_berlaku' };
      }
      const markerName = img.format === 'JPEG' ? 'EOI (FF D9)' : 'IEND';
      if (!img.hasEndMarker) {
        return {
          id: 'image_end_marker',
          name: 'Marker akhir file & data tambahan',
          nameEn: 'End-of-file marker & trailing data',
          status: 'gagal',
          detail: `Marker akhir ${markerName} tidak ditemukan (file kemungkinan terpotong)`,
          detailEn: `End marker ${markerName} missing (file may be truncated)`,
        };
      }
      if (img.trailingData && img.trailingData.size > 0) {
        return {
          id: 'image_end_marker',
          name: 'Marker akhir file & data tambahan',
          nameEn: 'End-of-file marker & trailing data',
          status: 'gagal',
          detail: `Ditemukan data tambahan setelah akhir file (${markerName}): ${img.trailingData.size.toLocaleString('id-ID')} byte di offset 0x${img.trailingData.offset.toString(16).toUpperCase()}`,
          detailEn: `Trailing data found after ${markerName}: ${img.trailingData.size.toLocaleString('en-US')} bytes at offset 0x${img.trailingData.offset.toString(16).toUpperCase()}`,
        };
      }
      return {
        id: 'image_end_marker',
        name: 'Marker akhir file & data tambahan',
        nameEn: 'End-of-file marker & trailing data',
        status: 'lolos',
        detail: `Marker ${markerName} ditemukan tepat di akhir file tanpa byte sisa`,
        detailEn: `${markerName} marker cleanly terminates the file with no trailing bytes`,
      };
    },
  },
  {
    id: 'png_crc_valid',
    appliesTo: ['image'],
    evaluate: (r) => {
      const chunks = r.technical.image?.pngChunks;
      if (!chunks || chunks.length === 0) {
        return { id: 'png_crc_valid', name: 'Validitas CRC32 chunk PNG', nameEn: 'PNG chunk CRC32 validity', status: 'tidak_berlaku' };
      }
      const invalid = chunks.filter((c) => !c.crcValid);
      if (invalid.length > 0) {
        return {
          id: 'png_crc_valid',
          name: 'Validitas CRC32 chunk PNG',
          nameEn: 'PNG chunk CRC32 validity',
          status: 'gagal',
          detail: `${invalid.length} dari ${chunks.length} chunk memiliki CRC salah (${invalid.map((c) => c.type).join(', ')})`,
          detailEn: `${invalid.length} of ${chunks.length} chunks failed CRC check (${invalid.map((c) => c.type).join(', ')})`,
        };
      }
      return {
        id: 'png_crc_valid',
        name: 'Validitas CRC32 chunk PNG',
        nameEn: 'PNG chunk CRC32 validity',
        status: 'lolos',
        detail: `Semua ${chunks.length} chunk PNG memiliki CRC32 valid`,
        detailEn: `All ${chunks.length} PNG chunks passed CRC32 verification`,
      };
    },
  },
  {
    id: 'jpeg_thumbnail_aspect',
    appliesTo: ['image'],
    evaluate: (r) => {
      const thumb = r.technical.image?.thumbnail;
      if (!thumb?.present || thumb.aspectRatioDiff === undefined) {
        return { id: 'jpeg_thumbnail_aspect', name: 'Kesesuaian rasio aspek thumbnail', nameEn: 'Embedded thumbnail aspect ratio', status: 'tidak_berlaku' };
      }
      const ok = thumb.aspectRatioDiff <= 0.12;
      return {
        id: 'jpeg_thumbnail_aspect',
        name: 'Kesesuaian rasio aspek thumbnail',
        nameEn: 'Embedded thumbnail aspect ratio',
        status: ok ? 'lolos' : 'gagal',
        detail: ok
          ? `Thumbnail ${thumb.width}×${thumb.height} sesuai rasio gambar utama (selisih ${thumb.aspectRatioDiff})`
          : `Thumbnail ${thumb.width}×${thumb.height} berbeda rasio dengan gambar utama ${r.technical.image?.width}×${r.technical.image?.height} (selisih ${thumb.aspectRatioDiff})`,
        detailEn: ok
          ? `Thumbnail ${thumb.width}×${thumb.height} matches main image aspect ratio (delta ${thumb.aspectRatioDiff})`
          : `Thumbnail ${thumb.width}×${thumb.height} differs from main image ${r.technical.image?.width}×${r.technical.image?.height} (delta ${thumb.aspectRatioDiff})`,
      };
    },
  },
  {
    id: 'exif_make_model_consistent',
    appliesTo: ['image'],
    evaluate: (r) => {
      const make = r.tags.find((t) => /^make$/i.test(t.name))?.decoded;
      const model = r.tags.find((t) => /^model$/i.test(t.name))?.decoded;
      const software = r.tags.find((t) => /^software$/i.test(t.name))?.decoded;
      if (!make && !model) {
        return { id: 'exif_make_model_consistent', name: 'Konsistensi EXIF Make/Model/Software', nameEn: 'EXIF Make/Model/Software consistency', status: 'tidak_berlaku' };
      }
      const makeL = (make ?? '').toLowerCase();
      const modelL = (model ?? '').toLowerCase();
      const softL = (software ?? '').toLowerCase();
      const conflict =
        (makeL.includes('apple') && (modelL.includes('pixel') || modelL.includes('galaxy') || softL.includes('android'))) ||
        (makeL.includes('samsung') && modelL.includes('iphone'));
      return {
        id: 'exif_make_model_consistent',
        name: 'Konsistensi EXIF Make/Model/Software',
        nameEn: 'EXIF Make/Model/Software consistency',
        status: conflict ? 'gagal' : 'lolos',
        detail: conflict
          ? `Ketidakcocokan antara Make (${make}), Model (${model}), dan Software (${software ?? '-'})`
          : `Make (${make ?? '-'}) · Model (${model ?? '-'}) · Software (${software ?? '-'}) konsisten`,
        detailEn: conflict
          ? `Mismatch detected between Make (${make}), Model (${model}), and Software (${software ?? '-'})`
          : `Make (${make ?? '-'}) · Model (${model ?? '-'}) · Software (${software ?? '-'}) are consistent`,
      };
    },
  },
  {
    id: 'dates_consistent',
    appliesTo: ['all'],
    evaluate: (r) => {
      const dated = r.timeline.filter((e) => e.utc && !e.isZeroed);
      if (dated.length === 0) {
        return {
          id: 'dates_consistent',
          name: 'Konsistensi timestamp',
          nameEn: 'Timestamp consistency',
          status: 'tidak_berlaku',
          detail: r.timeline.some((e) => e.isZeroed)
            ? 'Semua tanggal dikosongkan (nol)'
            : 'Tidak ada timestamp valid untuk dibandingkan',
          detailEn: r.timeline.some((e) => e.isZeroed)
            ? 'All timestamps are zeroed/cleared'
            : 'No valid timestamps available to cross-check',
        };
      }
      const future = dated.filter((e) => new Date(e.utc!).getTime() > Date.now() + 86400000);
      const createEntry = dated.find((e) => /create|original|digitized/i.test(e.label));
      const modifyEntry = dated.find((e) => /modify/i.test(e.label));
      const createAfterModify =
        createEntry && modifyEntry && new Date(createEntry.utc!).getTime() > new Date(modifyEntry.utc!).getTime() + 60000;

      if (future.length > 0 || createAfterModify) {
        const reasons: string[] = [];
        if (future.length > 0) reasons.push(`${future.length} tanggal di masa depan`);
        if (createAfterModify) reasons.push('tanggal pembuatan lebih baru daripada tanggal modifikasi');
        return {
          id: 'dates_consistent',
          name: 'Konsistensi timestamp',
          nameEn: 'Timestamp consistency',
          status: 'gagal',
          detail: reasons.join('; '),
          detailEn: reasons.join('; '),
        };
      }
      return {
        id: 'dates_consistent',
        name: 'Konsistensi timestamp',
        nameEn: 'Timestamp consistency',
        status: 'lolos',
        detail: `${dated.length} timestamp valid dan kronologis (pembuatan ≤ modifikasi, tidak di masa depan)`,
        detailEn: `${dated.length} timestamps are valid and chronologically consistent`,
      };
    },
  },
  {
    id: 'pdf_eof_single',
    appliesTo: ['pdf'],
    evaluate: (r) => {
      const eof = r.technical.document?.eofCount;
      if (eof === undefined) {
        return { id: 'pdf_eof_single', name: 'Integritas akhir PDF (%%EOF)', nameEn: 'PDF end-of-file (%%EOF) integrity', status: 'tidak_berlaku' };
      }
      if (eof === 0) {
        return {
          id: 'pdf_eof_single',
          name: 'Integritas akhir PDF (%%EOF)',
          nameEn: 'PDF end-of-file (%%EOF) integrity',
          status: 'gagal',
          detail: 'Marker %%EOF tidak ditemukan',
          detailEn: 'No %%EOF marker found',
        };
      }
      return {
        id: 'pdf_eof_single',
        name: 'Integritas akhir PDF (%%EOF)',
        nameEn: 'PDF end-of-file (%%EOF) integrity',
        status: 'lolos',
        detail:
          eof > 1
            ? `Ditemukan ${eof} marker %%EOF (dokumen memiliki ${eof} revisi inkremental)`
            : '1 marker %%EOF ditemukan (tanpa update inkremental)',
        detailEn:
          eof > 1
            ? `Found ${eof} %%EOF markers (${eof} incremental revisions)`
            : '1 %%EOF marker found (no incremental updates)',
      };
    },
  },
  {
    id: 'tag_hash_match',
    appliesTo: ['all'],
    evaluate: (r) => {
      if (!r.hashTests || r.hashTests.length === 0) {
        return { id: 'tag_hash_match', name: 'Uji kecocokan hash di tag', nameEn: 'Tag hash region verification', status: 'tidak_berlaku' };
      }
      const unmatched = r.hashTests.filter((ht) => !ht.anyMatched);
      if (unmatched.length > 0) {
        return {
          id: 'tag_hash_match',
          name: 'Uji kecocokan hash di tag',
          nameEn: 'Tag hash region verification',
          status: 'gagal',
          detail: unmatched
            .map((u) => `${u.tagName} (${u.tagHash}) tidak cocok dengan file utuh maupun region internal (${u.matches.map((m) => m.region).join(', ')})`)
            .join('; '),
          detailEn: unmatched
            .map((u) => `${u.tagName} (${u.tagHash}) does not match full file or tested internal regions (${u.matches.map((m) => m.region).join(', ')})`)
            .join('; '),
        };
      }
      return {
        id: 'tag_hash_match',
        name: 'Uji kecocokan hash di tag',
        nameEn: 'Tag hash region verification',
        status: 'lolos',
        detail: `${r.hashTests.length} hash di tag cocok dengan region file`,
        detailEn: `${r.hashTests.length} tag hash(es) matched file regions`,
      };
    },
  },
];
