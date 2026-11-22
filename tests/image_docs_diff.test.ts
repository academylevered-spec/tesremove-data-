import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFilePrivate } from '../src/engine/orchestrator';
import { compareReports } from '../src/engine/diff';
import {
  exportBatchZip,
  exportReportMarkdown,
  exportStandaloneHtml,
  exportTagsCsv,
  sanitizeReportForExportOrAi,
} from '../src/engine/exporters';
import {
  buildSampleAiPng,
  buildSampleCleanJpeg,
  buildSampleDocx,
  buildSampleGpsJpeg,
  buildSamplePdf,
} from '../src/engine/samples';

test('GPS JPEG: extracts EXIF/GPS, thumbnail mismatch, trailing data after EOI, and high privacy score vs clean JPEG', async () => {
  const gpsJpg = buildSampleGpsJpeg(true);
  const cleanJpg = buildSampleCleanJpeg();

  const repGps = await analyzeFilePrivate(new Blob([gpsJpg.bytes as unknown as BlobPart], { type: gpsJpg.mime }), {
    filename: gpsJpg.name,
    skipC2pa: true,
  });
  const repClean = await analyzeFilePrivate(new Blob([cleanJpg.bytes as unknown as BlobPart], { type: cleanJpg.mime }), {
    filename: cleanJpg.name,
    skipC2pa: true,
  });

  // GPS decimal & DMS accuracy (Jakarta: -6.175392, 106.827153)
  assert.ok(repGps.location, 'GPS location must be extracted');
  assert.ok(Math.abs(repGps.location!.lat - -6.175392) < 0.001);
  assert.ok(Math.abs(repGps.location!.lon - 106.827153) < 0.001);
  assert.equal(repGps.location!.alt, 12);

  // Embedded thumbnail mismatch & trailing bytes after EOI
  assert.equal(repGps.technical.image?.thumbnail?.present, true);
  assert.ok((repGps.technical.image?.thumbnail?.aspectRatioDiff ?? 0) > 0.5);
  assert.equal(repGps.technical.image?.trailingData?.size, 64);

  assert.equal(repGps.checks.find((c) => c.id === 'image_end_marker')?.status, 'gagal');
  assert.equal(repGps.checks.find((c) => c.id === 'jpeg_thumbnail_aspect')?.status, 'gagal');
  assert.ok(repGps.findings.some((f) => f.id === 'image_thumbnail_mismatch' && f.confidence === 'kuat'));
  assert.ok(repGps.findings.some((f) => f.id === 'trailing_data_after_eof' && f.confidence === 'pasti'));

  // Privacy score strictly higher on GPS photo than clean photo
  assert.ok(repGps.privacy.score >= 70, `Expected high privacy score, got ${repGps.privacy.score}`);
  assert.equal(repClean.privacy.score, 0);
  assert.ok(repGps.privacy.items.some((i) => i.id === 'gps_coordinates' && i.severity === 'tinggi'));

  // Diff between GPS photo and stripped clean photo
  const diff = compareReports(repGps, repClean);
  assert.equal(diff.hashesMatch, false);
  assert.ok(diff.tags.removed.length > 5);
  assert.ok(diff.privacyDelta < -50);

  // Sanitizer strips thumbnail dataUrl for AI/export
  const sanitized = sanitizeReportForExportOrAi(repGps);
  assert.equal(sanitized.technical.image?.thumbnail?.dataUrl, undefined);
});

test('Extension mismatch: JPEG bytes renamed to .mp4 triggers warning and failed cross-check', async () => {
  const cleanJpg = buildSampleCleanJpeg();
  const rep = await analyzeFilePrivate(new Blob([cleanJpg.bytes as unknown as BlobPart], { type: 'video/mp4' }), {
    filename: 'fake_video.mp4',
    skipC2pa: true,
  });
  assert.equal(rep.file.detectedType, 'JPEG');
  assert.equal(rep.file.extensionMatches, false);
  assert.equal(rep.checks.find((c) => c.id === 'extension_matches_magic')?.status, 'gagal');
});

test('PNG: text chunks, AI heuristic marker, and corrupted CRC32 failure detection', async () => {
  const validPng = buildSampleAiPng(false);
  const badCrcPng = buildSampleAiPng(true);

  const repValid = await analyzeFilePrivate(new Blob([validPng.bytes as unknown as BlobPart], { type: validPng.mime }), {
    filename: validPng.name,
    skipC2pa: true,
  });
  const repBad = await analyzeFilePrivate(new Blob([badCrcPng.bytes as unknown as BlobPart], { type: badCrcPng.mime }), {
    filename: badCrcPng.name,
    skipC2pa: true,
  });

  assert.equal(repValid.checks.find((c) => c.id === 'png_crc_valid')?.status, 'lolos');
  assert.ok(repValid.technical.image?.pngTextChunks?.some((c) => c.keyword === 'parameters'));
  assert.ok(repValid.provenance?.aiMarkers.length && repValid.provenance.aiMarkers[0].confidence === 'heuristik');
  assert.ok(repValid.findings.some((f) => f.id === 'ai_marker_detected' && f.confidence === 'heuristik'));

  assert.equal(repBad.checks.find((c) => c.id === 'png_crc_valid')?.status, 'gagal');
});

test('PDF & DOCX: incremental %%EOF revisions, tracked changes, comments, macros, and safe HTML export escaping', async () => {
  const pdf = buildSamplePdf();
  const docx = buildSampleDocx();

  const repPdf = await analyzeFilePrivate(new Blob([pdf.bytes as unknown as BlobPart], { type: pdf.mime }), {
    filename: pdf.name,
    skipC2pa: true,
  });
  assert.equal(repPdf.technical.document?.pdfVersion, '1.7');
  assert.equal(repPdf.technical.document?.eofCount, 2);
  assert.equal(repPdf.technical.document?.hasJavaScript, true);
  assert.ok(repPdf.findings.some((f) => f.id === 'pdf_incremental_updates' && f.confidence === 'kuat'));

  const repDocx = await analyzeFilePrivate(new Blob([docx.bytes as unknown as BlobPart], { type: docx.mime }), {
    filename: docx.name,
    skipC2pa: true,
  });
  assert.equal(repDocx.file.detectedType, 'DOCX');
  assert.equal(repDocx.technical.document?.comments?.length, 1);
  assert.equal(repDocx.technical.document?.trackedChanges?.length, 2);
  assert.equal(repDocx.technical.document?.hasMacros, true);
  assert.ok(repDocx.privacy.items.some((i) => i.id === 'doc_comments_or_tracked' && i.severity === 'tinggi'));
  assert.ok(repDocx.privacy.items.some((i) => i.id === 'owner_author_with_email' && i.severity === 'tinggi'));

  // Exporters + XSS safety in standalone HTML
  repDocx.tags.push({ ns: 'XSS', name: 'Test', raw: '<script>alert(1)</script>', decoded: '<script>alert(1)</script>', source: 'test' });
  const html = exportStandaloneHtml(repDocx);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'HTML export must escape script tags');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('bukan bukti hukum'));

  const csv = exportTagsCsv(repDocx);
  assert.ok(csv.includes('namespace,name,raw,decoded,source,offset'));
  const md = exportReportMarkdown(repDocx);
  assert.ok(md.includes('# Laporan MetaScope'));
  const zip = exportBatchZip([repPdf, repDocx]);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
});
