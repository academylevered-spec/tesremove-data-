import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFilePrivate } from '../src/engine/orchestrator';
import {
  buildSampleAiPng,
  buildSampleDocx,
  buildSampleGpsJpeg,
  buildSampleMp4,
  buildSamplePdf,
} from '../src/engine/samples';
import { DEFAULT_STRIP_OPTIONS, stripFileMetadata } from '../src/engine/stripper';

test('Metadata Remover (JPEG): removes EXIF, GPS, embedded thumbnail, and trailing bytes while keeping valid JPEG', async () => {
  const sample = buildSampleGpsJpeg(true);
  const origBlob = new Blob([sample.bytes as unknown as BlobPart], { type: sample.mime });

  const before = await analyzeFilePrivate(origBlob, { filename: sample.name, skipC2pa: true });
  assert.ok(before.location, 'Original JPEG must contain GPS');
  assert.ok(before.privacy.score >= 50, 'Original JPEG must have high privacy risk');

  const stripped = await stripFileMetadata(origBlob, sample.name, DEFAULT_STRIP_OPTIONS);
  assert.equal(stripped.supported, true);
  assert.equal(stripped.format, 'JPEG');
  assert.equal(stripped.cleanedFilename, 'foto_monas_gps_exif_clean.jpg');
  assert.ok(stripped.bytesRemoved > 0, 'Stripped JPEG must be smaller');
  assert.ok(stripped.removedItems.some((i) => i.category === 'JPEG APP1'));
  assert.ok(stripped.removedItems.some((i) => i.category === 'Data Sisa'));

  // Re-analyze the cleaned file to prove zero GPS, zero trailing bytes, zero thumbnail, valid image
  const after = await analyzeFilePrivate(stripped.cleanedBlob, {
    filename: stripped.cleanedFilename,
    skipC2pa: true,
  });
  assert.equal(after.file.detectedType, 'JPEG');
  assert.equal(after.location, undefined, 'Cleaned JPEG must have zero GPS coordinates');
  assert.equal(after.technical.image?.trailingData, undefined, 'Trailing data after EOI must be gone');
  assert.equal(after.technical.image?.thumbnail?.present ?? false, false, 'Embedded thumbnail must be gone');
  assert.equal(after.checks.find((c) => c.id === 'image_end_marker')?.status, 'lolos');
  assert.ok(after.privacy.score < before.privacy.score, 'Privacy score must drop significantly');
  assert.equal(after.privacy.score, 0, 'Cleaned JPEG should reach 0 privacy score');
});

test('Metadata Remover (PNG): strips AI prompt tEXt chunks while keeping valid IHDR/IDAT/IEND', async () => {
  const sample = buildSampleAiPng(false);
  const origBlob = new Blob([sample.bytes as unknown as BlobPart], { type: sample.mime });

  const before = await analyzeFilePrivate(origBlob, { filename: sample.name, skipC2pa: true });
  assert.ok((before.provenance?.aiMarkers.length ?? 0) > 0, 'Original PNG has AI marker');

  const stripped = await stripFileMetadata(origBlob, sample.name, DEFAULT_STRIP_OPTIONS);
  assert.equal(stripped.supported, true);
  assert.ok(stripped.removedItems.some((i) => i.category === 'PNG tEXt'));

  const after = await analyzeFilePrivate(stripped.cleanedBlob, {
    filename: stripped.cleanedFilename,
    skipC2pa: true,
  });
  assert.equal(after.file.detectedType, 'PNG');
  assert.equal(after.provenance?.aiMarkers.length ?? 0, 0, 'Cleaned PNG must have zero AI text markers');
  assert.equal(after.checks.find((c) => c.id === 'png_crc_valid')?.status, 'lolos');
});

test('Metadata Remover (MP4): removes meta/free atoms and patches stco offsets so container stays valid', async () => {
  const sample = buildSampleMp4();
  const origBlob = new Blob([sample.bytes as unknown as BlobPart], { type: sample.mime });

  const stripped = await stripFileMetadata(origBlob, sample.name, DEFAULT_STRIP_OPTIONS);
  assert.equal(stripped.supported, true);
  assert.ok(stripped.removedItems.some((i) => i.category === 'MP4 meta'));
  assert.ok(stripped.bytesRemoved > 0);

  const after = await analyzeFilePrivate(stripped.cleanedBlob, {
    filename: stripped.cleanedFilename,
    skipC2pa: true,
  });
  assert.equal(after.file.detectedType, 'MP4');
  // QuickTime Keys (aigc_info, comment, vid_md5, encoder) must be completely gone!
  assert.equal(after.tags.filter((t) => t.ns === 'Keys').length, 0, 'QuickTime Keys metadata must be stripped');
  // Because stco offsets were patched accurately, first-sample bitstream inspection still works!
  assert.ok(after.bitstream, 'Patched MP4 chunk offsets must still point to valid video bitstream');
  assert.equal(after.findings.some((f) => f.id === 'mp4_faststart'), true, 'Faststart layout preserved');
});

test('Metadata Remover (DOCX): strips author/company properties, comments, tracked deletions, and VBA macro', async () => {
  const sample = buildSampleDocx();
  const origBlob = new Blob([sample.bytes as unknown as BlobPart], { type: sample.mime });

  const stripped = await stripFileMetadata(origBlob, sample.name, DEFAULT_STRIP_OPTIONS);
  assert.equal(stripped.supported, true);
  assert.ok(stripped.removedItems.some((i) => i.category === 'Office Core'));
  assert.ok(stripped.removedItems.some((i) => i.category === 'Komentar Dokumen'));
  assert.ok(stripped.removedItems.some((i) => i.category === 'Makro VBA'));

  const after = await analyzeFilePrivate(stripped.cleanedBlob, {
    filename: stripped.cleanedFilename,
    skipC2pa: true,
  });
  assert.equal(after.file.detectedType, 'DOCX');
  assert.equal(Boolean(after.technical.document?.hasMacros), false, 'VBA macro must be removed');
  assert.equal(after.technical.document?.comments?.length ?? 0, 0, 'Hidden comments must be removed');
  assert.equal(after.technical.document?.trackedChanges?.length ?? 0, 0, 'Tracked changes must be cleaned');
  assert.equal(after.privacy.score, 0, 'Cleaned DOCX should have 0 privacy risk score');
});

test('Metadata Remover (PDF): scrubs /Info metadata fields in-place without changing xref byte offsets', async () => {
  const sample = buildSamplePdf();
  const origBlob = new Blob([sample.bytes as unknown as BlobPart], { type: sample.mime });

  const stripped = await stripFileMetadata(origBlob, sample.name, DEFAULT_STRIP_OPTIONS);
  assert.equal(stripped.supported, true);
  assert.equal(stripped.cleanedSize, stripped.originalSize, 'In-place PDF scrub keeps exact byte offsets');
  assert.ok(stripped.removedItems.some((i) => i.category === 'PDF /Info'));
  assert.ok(stripped.notes.length > 0, 'Incremental revision note should be reported honestly');

  const cleanedText = new TextDecoder().decode(stripped.cleanedBytes);
  assert.equal(cleanedText.includes('Tim Keuangan'), false, 'Author name must be scrubbed');
  assert.equal(cleanedText.includes('LibreOffice'), false, 'Creator must be scrubbed');
  assert.equal(cleanedText.startsWith('%PDF-1.7'), true, 'Valid PDF header preserved');
});
