import type { PrivacyItem, Report, Severity } from '../engine/types';

export interface PrivacyWeightConfig {
  id: string;
  labelId: string;
  labelEn: string;
  severity: Severity;
  weight: number;
}

export const PRIVACY_WEIGHTS: Record<string, PrivacyWeightConfig> = {
  gps_coordinates: {
    id: 'gps_coordinates',
    labelId: 'Koordinat GPS tepat',
    labelEn: 'Exact GPS coordinates',
    severity: 'tinggi',
    weight: 35,
  },
  device_serial: {
    id: 'device_serial',
    labelId: 'Nomor seri perangkat atau ID unik',
    labelEn: 'Device serial number or unique ID',
    severity: 'tinggi',
    weight: 28,
  },
  owner_author_with_email: {
    id: 'owner_author_with_email',
    labelId: 'Nama pemilik/penulis disertai alamat email',
    labelEn: 'Owner/author name with email address',
    severity: 'tinggi',
    weight: 26,
  },
  owner_author: {
    id: 'owner_author',
    labelId: 'Nama pemilik, penulis, atau organisasi',
    labelEn: 'Owner, author, or organization name',
    severity: 'sedang',
    weight: 16,
  },
  capture_datetime: {
    id: 'capture_datetime',
    labelId: 'Tanggal dan jam pengambilan/pembuatan',
    labelEn: 'Capture or creation date and time',
    severity: 'sedang',
    weight: 12,
  },
  thumbnail_mismatch: {
    id: 'thumbnail_mismatch',
    labelId: 'Thumbnail tertanam berbeda dari gambar utama (risiko bocoran bagian terpotong)',
    labelEn: 'Embedded thumbnail differs from main image (cropped content leak risk)',
    severity: 'tinggi',
    weight: 25,
  },
  platform_post_id: {
    id: 'platform_post_id',
    labelId: 'ID platform yang menaut ke postingan publik',
    labelEn: 'Platform ID linking to a public post',
    severity: 'sedang',
    weight: 15,
  },
  device_model_software: {
    id: 'device_model_software',
    labelId: 'Model perangkat dan perangkat lunak',
    labelEn: 'Device model and software',
    severity: 'rendah',
    weight: 8,
  },
  doc_comments_or_tracked: {
    id: 'doc_comments_or_tracked',
    labelId: 'Komentar atau perubahan terlacak (track changes) pada dokumen',
    labelEn: 'Document comments or tracked changes',
    severity: 'tinggi',
    weight: 28,
  },
  doc_hidden_sheets: {
    id: 'doc_hidden_sheets',
    labelId: 'Sheet tersembunyi pada spreadsheet',
    labelEn: 'Hidden sheets in spreadsheet',
    severity: 'tinggi',
    weight: 25,
  },
  doc_macros: {
    id: 'doc_macros',
    labelId: 'Makro VBA atau JavaScript tertanam di dokumen',
    labelEn: 'Embedded VBA macros or PDF JavaScript',
    severity: 'info',
    weight: 5,
  },
  technical_only: {
    id: 'technical_only',
    labelId: 'Hanya data teknis (codec, dimensi, struktur)',
    labelEn: 'Technical metadata only (codec, dimensions, structure)',
    severity: 'info',
    weight: 0,
  },
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function evaluatePrivacyScore(report: Report): { score: number; items: PrivacyItem[] } {
  const items: PrivacyItem[] = [];

  // 1. Exact GPS coordinates
  if (report.location) {
    const w = PRIVACY_WEIGHTS.gps_coordinates;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: `Koordinat GPS tepat ditemukan (${report.location.lat}, ${report.location.lon}).`,
      textEn: `Exact GPS coordinates found (${report.location.lat}, ${report.location.lon}).`,
      advice: 'Hapus tag GPS sebelum membagikan file ke publik bila lokasi bersifat pribadi.',
      adviceEn: 'Strip GPS tags before sharing publicly if the location is private.',
      evidence: [`${report.location.source}: ${report.location.latDms}, ${report.location.lonDms}`],
    });
  }

  // 2. Device serial or unique ID
  const serialTag = report.tags.find((t) =>
    /^(BodySerialNumber|SerialNumber|InternalSerialNumber|CameraOwnerName|LensSerialNumber|ImageUniqueID)$/i.test(t.name),
  );
  if (serialTag) {
    const w = PRIVACY_WEIGHTS.device_serial;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: `Nomor seri perangkat atau ID unik ditemukan pada tag ${serialTag.name}.`,
      textEn: `Device serial number or unique ID found in tag ${serialTag.name}.`,
      advice: 'Bersihkan metadata EXIF sebelum mendistribusikan file jika ingin memutus tautan ke perangkat fisik.',
      adviceEn: 'Remove EXIF metadata before distributing if you want to unlink the physical device.',
      evidence: [`${serialTag.ns}:${serialTag.name}`],
    });
  }

  // 3. Owner / Author / Organization (with or without email)
  const authorTags = report.tags.filter((t) =>
    /^(Author|Artist|Creator|LastModifiedBy|Company|Manager|OwnerName|By-line|Copyright)$/i.test(t.name) &&
    String(t.decoded ?? t.raw ?? '').trim().length > 0,
  );
  if (authorTags.length > 0) {
    const combined = authorTags.map((t) => String(t.decoded ?? t.raw)).join(' ');
    const hasEmail = EMAIL_RE.test(combined);
    const w = hasEmail ? PRIVACY_WEIGHTS.owner_author_with_email : PRIVACY_WEIGHTS.owner_author;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: hasEmail
        ? `Nama penulis/pemilik disertai alamat email ditemukan (${authorTags.map((t) => t.name).join(', ')}).`
        : `Nama penulis, pemilik, atau organisasi ditemukan (${authorTags.map((t) => `${t.name}: ${t.decoded ?? t.raw}`).slice(0, 3).join('; ')}).`,
      textEn: hasEmail
        ? `Author/owner name with an email address found (${authorTags.map((t) => t.name).join(', ')}).`
        : `Author, owner, or organization name found (${authorTags.map((t) => `${t.name}: ${t.decoded ?? t.raw}`).slice(0, 3).join('; ')}).`,
      advice: 'Periksa properti dokumen/EXIF dan hapus informasi identitas bila file akan dikirim ke pihak eksternal.',
      adviceEn: 'Inspect document/EXIF properties and remove identity fields before sharing externally.',
      evidence: authorTags.slice(0, 4).map((t) => `${t.ns}:${t.name}`),
    });
  }

  // 4. Thumbnail mismatch (crop leakage)
  if (report.technical.image?.thumbnail?.present && (report.technical.image.thumbnail.aspectRatioDiff ?? 0) > 0.12) {
    const w = PRIVACY_WEIGHTS.thumbnail_mismatch;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: 'Thumbnail tertanam berbeda rasio dari gambar utama dan berpotensi menyimpan bagian gambar yang sudah dipotong.',
      textEn: 'Embedded thumbnail differs from the main image and may still show cropped-out content.',
      advice: 'Periksa tab Teknis untuk melihat thumbnail; ekspor ulang tanpa thumbnail EXIF bila bagian terpotong sensitif.',
      adviceEn: 'Inspect the thumbnail in the Technical tab; re-export without EXIF thumbnail if cropped areas are sensitive.',
      evidence: ['EXIF IFD1 Thumbnail'],
    });
  }

  // 5. Document comments / tracked changes
  const commentsCount = report.technical.document?.comments?.length ?? 0;
  const trackedCount = report.technical.document?.trackedChanges?.length ?? 0;
  if (commentsCount > 0 || trackedCount > 0) {
    const w = PRIVACY_WEIGHTS.doc_comments_or_tracked;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: `Dokumen masih menyimpan ${commentsCount} komentar dan ${trackedCount} perubahan terlacak beserta nama penyuntingnya.`,
      textEn: `Document retains ${commentsCount} comments and ${trackedCount} tracked changes along with author names.`,
      advice: 'Terima/tolak semua perubahan terlacak dan hapus komentar menggunakan fitur Inspect Document sebelum mengirim file.',
      adviceEn: 'Accept/reject tracked changes and remove comments using Document Inspector before sharing.',
      evidence: ['word/comments.xml', 'word/document.xml'],
    });
  }

  // 6. Document hidden sheets
  const hiddenSheets = report.technical.document?.hiddenSheets ?? [];
  if (hiddenSheets.length > 0) {
    const w = PRIVACY_WEIGHTS.doc_hidden_sheets;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: `Terdapat ${hiddenSheets.length} sheet tersembunyi (${hiddenSheets.join(', ')}).`,
      textEn: `Found ${hiddenSheets.length} hidden spreadsheet sheet(s) (${hiddenSheets.join(', ')}).`,
      advice: 'Pastikan sheet tersembunyi memang boleh dibagikan atau hapus sebelum mengirim workbook.',
      adviceEn: 'Verify whether hidden sheets should be shared or remove them prior to distribution.',
      evidence: ['xl/workbook.xml'],
    });
  }

  // 7. Capture / creation date & time (non-zeroed)
  const validDates = report.timeline.filter((e) => !e.isZeroed && e.utc);
  if (validDates.length > 0) {
    const w = PRIVACY_WEIGHTS.capture_datetime;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: `Terdapat ${validDates.length} timestamp aktif yang mencatat waktu pengambilan atau pengubahan file.`,
      textEn: `Found ${validDates.length} active timestamp(s) recording capture or modification time.`,
      advice: 'Hapus atau normalkan tanggal metadata bila waktu pembuatan perlu dirahasiakan.',
      adviceEn: 'Clear or normalize timestamps if exact creation timing should remain private.',
      evidence: validDates.slice(0, 3).map((d) => d.label),
    });
  }

  // 8. Platform ID linking to public post (e.g. comment containing vid:...)
  const platformTag = report.tags.find((t) => /\bvid:[a-z0-9_-]{8,}\b/i.test(String(t.decoded ?? t.raw ?? '')));
  if (platformTag) {
    const w = PRIVACY_WEIGHTS.platform_post_id;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: `Tag ${platformTag.name} memuat pengenal platform (${platformTag.decoded ?? platformTag.raw}) yang dapat menautkan file ke unggahan publik.`,
      textEn: `Tag ${platformTag.name} contains a platform identifier (${platformTag.decoded ?? platformTag.raw}) that may link to a public post.`,
      advice: 'Remux kontainer tanpa menyalin tag komentar jika ingin memutus pengenal platform.',
      adviceEn: 'Remux the container without copying comment tags to strip platform identifiers.',
      evidence: [`${platformTag.ns}:${platformTag.name}`],
    });
  }

  // 9. Device model and software
  const modelOrSoft = report.tags.filter((t) => /^(Make|Model|Software|Encoder|Producer|CreatorTool|Application)$/i.test(t.name));
  if (modelOrSoft.length > 0) {
    const w = PRIVACY_WEIGHTS.device_model_software;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: `Informasi perangkat atau perangkat lunak tercatat (${modelOrSoft.slice(0, 3).map((t) => `${t.name}: ${t.decoded ?? t.raw}`).join(', ')}).`,
      textEn: `Device or software metadata is recorded (${modelOrSoft.slice(0, 3).map((t) => `${t.name}: ${t.decoded ?? t.raw}`).join(', ')}).`,
      advice: 'Data ini berisiko rendah secara mandiri, namun dapat digabung dengan metadata lain untuk profil perangkat.',
      adviceEn: 'Low risk on its own, though it can contribute to device/workflow fingerprinting.',
      evidence: modelOrSoft.slice(0, 3).map((t) => `${t.ns}:${t.name}`),
    });
  }

  // 10. Document macros or PDF JavaScript
  if (report.technical.document?.hasMacros || report.technical.document?.hasJavaScript) {
    const w = PRIVACY_WEIGHTS.doc_macros;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: report.technical.document.hasMacros
        ? 'Dokumen mengandung proyek makro VBA (vbaProject.bin).'
        : 'Dokumen PDF mengandung skrip JavaScript tertanam.',
      textEn: report.technical.document.hasMacros
        ? 'Document contains a VBA macro project (vbaProject.bin).'
        : 'PDF document contains embedded JavaScript.',
      advice: 'Harap berhati-hati dan jangan mengaktifkan makro/skrip kecuali dokumen berasal dari sumber tepercaya.',
      adviceEn: 'Exercise caution and avoid enabling macros or scripts unless the file comes from a trusted source.',
      evidence: [report.technical.document.hasMacros ? 'vbaProject.bin' : 'PDF /JavaScript'],
    });
  }

  if (items.length === 0) {
    const w = PRIVACY_WEIGHTS.technical_only;
    items.push({
      id: w.id,
      severity: w.severity,
      weight: w.weight,
      text: 'Hanya metadata teknis dasar yang ditemukan; tidak ada penanda lokasi atau identitas langsung.',
      textEn: 'Only basic technical metadata found; no direct location or personal identity markers detected.',
      advice: 'Tidak diperlukan tindakan pembersihan khusus berdasarkan metadata yang terbaca.',
      adviceEn: 'No specific metadata sanitization needed based on parsed fields.',
    });
  }

  const rawSum = items.reduce((acc, item) => acc + item.weight, 0);
  const score = Math.min(100, Math.max(0, rawSum));

  const severityOrder: Record<Severity, number> = { kritis: 0, tinggi: 1, sedang: 2, rendah: 3, info: 4 };
  items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.weight - a.weight);

  return { score, items };
}
