import { strToU8, zipSync } from 'fflate';
import type { Report } from './types';

const LEGAL_DISCLAIMER_ID = 'Metadata dapat diedit atau dihapus; laporan ini bukan bukti hukum.';

export function sanitizeReportForExportOrAi(report: Report): Report {
  // Deep clone without binary data URLs (thumbnails, cover art) so exports & AI never contain raw media
  const clone: Report = JSON.parse(JSON.stringify(report));
  if (clone.technical.image?.thumbnail?.dataUrl) {
    delete clone.technical.image.thumbnail.dataUrl;
  }
  if (clone.technical.audio?.coverArt) {
    clone.technical.audio.coverArt = clone.technical.audio.coverArt.map((c) => ({
      mimeType: c.mimeType,
      size: c.size,
      description: c.description,
    }));
  }
  return clone;
}

export function validateReportSchema(report: Report): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (report.meta?.schema !== '1.0') errors.push('meta.schema must be "1.0"');
  if (!report.file?.name) errors.push('file.name is required');
  if (typeof report.file?.size !== 'number') errors.push('file.size must be a number');
  if (!report.file?.hashes?.md5 || !report.file?.hashes?.sha256) errors.push('file.hashes incomplete');
  if (!Array.isArray(report.tags)) errors.push('tags must be an array');
  if (!Array.isArray(report.structure)) errors.push('structure must be an array');
  if (!Array.isArray(report.checks)) errors.push('checks must be an array');
  if (!Array.isArray(report.findings)) errors.push('findings must be an array');
  if (!Array.isArray(report.warnings)) errors.push('warnings must be an array');
  if (typeof report.privacy?.score !== 'number') errors.push('privacy.score must be a number');
  return { valid: errors.length === 0, errors };
}

export function exportReportJson(report: Report): string {
  const clean = sanitizeReportForExportOrAi(report);
  return JSON.stringify(clean, null, 2);
}

function escapeCsvCell(val: unknown): string {
  const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportTagsCsv(report: Report): string {
  const header = ['namespace', 'name', 'raw', 'decoded', 'source', 'offset'];
  const lines = [header.join(',')];
  for (const t of report.tags) {
    lines.push(
      [
        escapeCsvCell(t.ns),
        escapeCsvCell(t.name),
        escapeCsvCell(t.raw),
        escapeCsvCell(t.decoded ?? ''),
        escapeCsvCell(t.source),
        escapeCsvCell(t.offset ?? ''),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}

export function exportReportMarkdown(report: Report): string {
  const lines: string[] = [
    `# Laporan MetaScope — ${report.file.name}`,
    '',
    `> ${LEGAL_DISCLAIMER_ID}`,
    '',
    '## Identitas File (L0)',
    `- **Nama:** ${report.file.name}`,
    `- **Ukuran:** ${report.file.size.toLocaleString('id-ID')} byte`,
    `- **Tipe terdeteksi:** ${report.file.detectedType} (${report.file.detectedMime})`,
    `- **Ekstensi cocok:** ${report.file.extensionMatches ? 'Ya' : 'Tidak (peringatan)'}`,
    `- **MD5:** \`${report.file.hashes.md5}\``,
    `- **SHA-1:** \`${report.file.hashes.sha1}\``,
    `- **SHA-256:** \`${report.file.hashes.sha256}\``,
    `- **Skor Privasi:** ${report.privacy.score} / 100`,
    '',
    '## Temuan Utama',
  ];
  if (report.findings.length === 0) {
    lines.push('- Tidak ada temuan inferensial khusus.');
  } else {
    for (const f of report.findings) {
      lines.push(`- **[${f.confidence.toUpperCase()}]** ${f.text} _(Bukti: ${f.evidence.join(', ')})_`);
    }
  }
  lines.push('', '## Cross-Check Integritas');
  for (const c of report.checks) {
    lines.push(`- **${c.name}**: ${c.status}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  lines.push('', '## Daftar Tag', '| Namespace | Nama | Terdekode | Sumber |', '| --- | --- | --- | --- |');
  for (const t of report.tags.slice(0, 500)) {
    const val = (t.decoded ?? String(t.raw ?? '')).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    lines.push(`| ${t.ns} | ${t.name} | ${val} | ${t.source} |`);
  }
  return lines.join('\n');
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function exportStandaloneHtml(report: Report): string {
  const clean = sanitizeReportForExportOrAi(report);
  const findingsHtml = clean.findings
    .map(
      (f) =>
        `<tr><td><strong>${escapeHtml(f.confidence.toUpperCase())}</strong></td><td>${escapeHtml(f.text)}</td><td><code>${escapeHtml(f.evidence.join('; '))}</code></td></tr>`,
    )
    .join('');

  const checksHtml = clean.checks
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td><strong>${escapeHtml(c.status)}</strong></td><td>${escapeHtml(c.detail ?? '')}</td></tr>`,
    )
    .join('');

  const tagsHtml = clean.tags
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.ns)}</td><td>${escapeHtml(t.name)}</td><td><code>${escapeHtml(t.decoded ?? String(t.raw ?? ''))}</code></td><td>${escapeHtml(t.source)}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MetaScope — ${escapeHtml(clean.file.name)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 32px; line-height: 1.5; }
  .wrap { max-width: 1080px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; }
  h1, h2 { margin-top: 0; color: #0f172a; }
  h2 { margin-top: 28px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; font-size: 1.15rem; }
  .notice { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 12px 16px; border-radius: 8px; font-size: 0.9rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .kv { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
  .kv small { display: block; color: #64748b; font-size: 0.78rem; }
  .kv strong { font-family: ui-monospace, monospace; font-size: 0.9rem; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; color: #334155; }
  code { font-family: ui-monospace, monospace; font-size: 0.84rem; word-break: break-all; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Laporan Analisis MetaScope</h1>
  <div class="notice">${escapeHtml(LEGAL_DISCLAIMER_ID)} &middot; Dianalisis pada ${escapeHtml(clean.meta.analyzedAt)} (Mode: ${escapeHtml(clean.meta.mode)})</div>
  <div class="grid">
    <div class="kv"><small>Nama File</small><strong>${escapeHtml(clean.file.name)}</strong></div>
    <div class="kv"><small>Ukuran</small><strong>${escapeHtml(clean.file.size.toLocaleString('id-ID'))} byte</strong></div>
    <div class="kv"><small>Tipe Terdeteksi</small><strong>${escapeHtml(clean.file.detectedType)} (${escapeHtml(clean.file.detectedMime)})</strong></div>
    <div class="kv"><small>Skor Risiko Privasi</small><strong>${clean.privacy.score} / 100</strong></div>
    <div class="kv"><small>MD5</small><strong>${escapeHtml(clean.file.hashes.md5)}</strong></div>
    <div class="kv"><small>SHA-256</small><strong>${escapeHtml(clean.file.hashes.sha256)}</strong></div>
  </div>
  <h2>Temuan &amp; Inferensi</h2>
  <table><thead><tr><th>Keyakinan</th><th>Temuan</th><th>Bukti</th></tr></thead><tbody>${findingsHtml || '<tr><td colspan="3">Tidak ada temuan khusus.</td></tr>'}</tbody></table>
  <h2>Cross-Check Integritas</h2>
  <table><thead><tr><th>Pemeriksaan</th><th>Status</th><th>Detail</th></tr></thead><tbody>${checksHtml}</tbody></table>
  <h2>Daftar Tag (${clean.tags.length})</h2>
  <table><thead><tr><th>Namespace</th><th>Nama</th><th>Nilai</th><th>Sumber</th></tr></thead><tbody>${tagsHtml}</tbody></table>
</div>
</body>
</html>`;
}

export function exportBatchCsv(reports: Report[]): string {
  const header = ['file_name', 'detected_type', 'size_bytes', 'privacy_score', 'top_finding', 'checks_passed', 'checks_total', 'md5', 'sha256'];
  const lines = [header.join(',')];
  for (const r of reports) {
    const passed = r.checks.filter((c) => c.status === 'lolos').length;
    const applicable = r.checks.filter((c) => c.status !== 'tidak_berlaku').length;
    const top = r.findings[0]?.text ?? '-';
    lines.push(
      [
        escapeCsvCell(r.file.name),
        escapeCsvCell(r.file.detectedType),
        escapeCsvCell(r.file.size),
        escapeCsvCell(r.privacy.score),
        escapeCsvCell(top),
        escapeCsvCell(passed),
        escapeCsvCell(applicable),
        escapeCsvCell(r.file.hashes.md5),
        escapeCsvCell(r.file.hashes.sha256),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}

export function exportBatchZip(reports: Report[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const seen = new Map<string, number>();
  for (const r of reports) {
    const safeBase = r.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const count = (seen.get(safeBase) ?? 0) + 1;
    seen.set(safeBase, count);
    const filename = count > 1 ? `${safeBase}_${count}.report.json` : `${safeBase}.report.json`;
    files[filename] = strToU8(exportReportJson(r));
  }
  files['summary.csv'] = strToU8(exportBatchCsv(reports));
  return zipSync(files, { level: 6 });
}
