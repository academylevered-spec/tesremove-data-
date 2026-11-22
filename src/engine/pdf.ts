import type { BoxNode, CoverageInfo, DocInfo, TagEntry, TimelineEntry } from './types';

function decodePdfString(raw: string): string {
  // Handle basic PDF escape sequences & UTF-16BE BOM
  if (raw.startsWith('<') && raw.endsWith('>')) {
    const hex = raw.slice(1, -1).replace(/\s+/g, '');
    const bytes: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be', { fatal: false }).decode(new Uint8Array(bytes.slice(2)));
    }
    return new TextDecoder('latin1').decode(new Uint8Array(bytes));
  }
  return raw
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function parsePdfDate(raw: string): { display: string; utc?: string; tz?: string; anomaly?: string } {
  const cleaned = raw.replace(/^D:/, '');
  const m = cleaned.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-]\d{2}'?\d{2}'?)?/);
  if (!m) return { display: raw };
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tzRaw] = m;
  let tz = 'Z';
  if (tzRaw && tzRaw !== 'Z') {
    const cleanTz = tzRaw.replace(/'/g, '');
    tz = cleanTz.length === 5 ? `${cleanTz.slice(0, 3)}:${cleanTz.slice(3)}` : cleanTz;
  }
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${tz}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { display: raw };
  const anomaly = dt.getTime() > Date.now() + 86400000 ? 'tanggal di masa depan' : undefined;
  return {
    display: `${y}-${mo}-${d} ${h}:${mi}:${s} ${tzRaw ?? 'UTC'}`,
    utc: dt.toISOString(),
    tz: tzRaw ?? 'UTC',
    anomaly,
  };
}

export interface PdfAnalysisOutput {
  structure: BoxNode[];
  tags: TagEntry[];
  technical: DocInfo;
  timeline: TimelineEntry[];
  coverage: CoverageInfo;
}

export async function analyzePdf(file: Blob): Promise<PdfAnalysisOutput> {
  // Read up to 24 MB for structure/info scan (PDF metadata, xref, trailers)
  const scanSize = Math.min(file.size, 24 * 1024 * 1024);
  const bytes = new Uint8Array(await file.slice(0, scanSize).arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);

  const structure: BoxNode[] = [];
  const tags: TagEntry[] = [];
  const timeline: TimelineEntry[] = [];

  // PDF Version header
  const verMatch = text.match(/%PDF-(\d+\.\d+)/);
  const pdfVersion = verMatch ? verMatch[1] : undefined;
  if (pdfVersion) {
    structure.push({ path: '/PDF_HEADER', type: 'HEADER', offset: verMatch?.index ?? 0, size: 10, detail: `PDF ${pdfVersion}` });
    tags.push({ ns: 'PDF/Header', name: 'PDFVersion', raw: pdfVersion, decoded: pdfVersion, source: 'pdf-parser', offset: verMatch?.index ?? 0 });
  }

  // Count %%EOF markers (incremental updates / revisions)
  const eofMatches = [...text.matchAll(/%%EOF/g)];
  const eofCount = eofMatches.length;
  for (let i = 0; i < eofMatches.length; i++) {
    const off = eofMatches[i].index ?? 0;
    structure.push({
      path: `/EOF_${i + 1}`,
      type: '%%EOF',
      offset: off,
      size: 5,
      detail: `Revisi #${i + 1}`,
    });
  }

  // Locate indirect objects (cap at 500 structure nodes for performance)
  const objRegex = /(\d+)\s+(\d+)\s+obj\b/g;
  let objMatch: RegExpExecArray | null;
  let objCount = 0;
  let explainedBytes = pdfVersion ? 10 : 0;
  const segments: Array<{ label: string; offset: number; size: number; colorKey: string }> = [];

  while ((objMatch = objRegex.exec(text)) !== null) {
    objCount++;
    const startOff = objMatch.index;
    const endIdx = text.indexOf('endobj', startOff + objMatch[0].length);
    const size = endIdx >= 0 ? endIdx + 6 - startOff : 32;
    explainedBytes += size;
    if (structure.length < 400) {
      structure.push({
        path: `/obj_${objMatch[1]}_${objMatch[2]}`,
        type: 'OBJ',
        offset: startOff,
        size,
        detail: `Object ${objMatch[1]} ${objMatch[2]}`,
      });
    }
    if (segments.length < 40) {
      segments.push({ label: `Obj ${objMatch[1]}`, offset: startOff, size, colorKey: 'media' });
    }
  }

  // Locate xref & trailer
  const xrefMatches = [...text.matchAll(/\bxref\b/g)];
  for (let i = 0; i < xrefMatches.length; i++) {
    const off = xrefMatches[i].index ?? 0;
    structure.push({ path: `/xref_${i + 1}`, type: 'XREF', offset: off, size: 64, detail: 'Cross-reference table' });
    explainedBytes += 64;
  }
  const trailerMatches = [...text.matchAll(/\btrailer\b[\s\S]{0,600}?>>/g)];
  for (let i = 0; i < trailerMatches.length; i++) {
    const m = trailerMatches[i];
    const off = m.index ?? 0;
    structure.push({ path: `/trailer_${i + 1}`, type: 'TRAILER', offset: off, size: m[0].length });
    explainedBytes += m[0].length;
  }

  // Info dictionary fields
  const infoKeys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];
  const extractedInfo: Record<string, string> = {};
  for (const key of infoKeys) {
    const re = new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]+>)`, 'g');
    const matches = [...text.matchAll(re)];
    if (matches.length > 0) {
      // Take the last occurrence (latest incremental revision)
      const last = matches[matches.length - 1];
      const val = decodePdfString(last[1]);
      extractedInfo[key] = val;
      tags.push({
        ns: 'PDF/Info',
        name: key,
        raw: last[1],
        decoded: val,
        source: 'pdf-parser',
        offset: last.index,
      });

      if (key === 'CreationDate' || key === 'ModDate') {
        const parsed = parsePdfDate(val);
        timeline.push({
          label: `PDF ${key}`,
          value: parsed.display,
          utc: parsed.utc,
          tz: parsed.tz,
          anomaly: parsed.anomaly,
          source: 'pdf-info',
          tagRef: `PDF/Info:${key}`,
        });
      }
    }
  }

  // Extract XMP packet safely (no XML entity execution)
  const xmpMatch = text.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/);
  if (xmpMatch) {
    const xmp = xmpMatch[0];
    const xmpFields = [
      ['xmp:CreatorTool', 'CreatorTool'],
      ['pdf:Producer', 'Producer'],
      ['xmp:CreateDate', 'CreateDate'],
      ['xmp:ModifyDate', 'ModifyDate'],
      ['xmp:MetadataDate', 'MetadataDate'],
      ['dc:creator', 'Creator'],
      ['dc:title', 'Title'],
      ['xmpMM:DocumentID', 'DocumentID'],
      ['xmpMM:InstanceID', 'InstanceID'],
    ];
    for (const [tag, name] of xmpFields) {
      const m = xmp.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (m) {
        const cleaned = m[1].replace(/<[^>]+>/g, '').trim();
        if (cleaned) {
          tags.push({ ns: 'PDF/XMP', name, raw: cleaned, decoded: cleaned, source: 'pdf-xmp', offset: xmpMatch.index });
          if (name.includes('Date')) {
            const dt = new Date(cleaned);
            timeline.push({
              label: `PDF XMP ${name}`,
              value: cleaned,
              utc: !Number.isNaN(dt.getTime()) ? dt.toISOString() : undefined,
              source: 'pdf-xmp',
              tagRef: `PDF/XMP:${name}`,
            });
          }
        }
      }
    }
  }

  // Count pages (/Type /Page but not /Pages)
  const pageMatches = text.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCount = pageMatches ? pageMatches.length : undefined;

  // Detect JavaScript, EmbeddedFiles, Annotations, Digital Signatures, Fonts
  const hasJavaScript = /\/JavaScript\b|\/JS\s*(\(|<|\d+\s+\d+\s+R)/i.test(text);
  const hasEmbeddedFiles = /\/EmbeddedFiles\b|\/Filespec\b/.test(text);
  const embeddedFiles: string[] = [];
  if (hasEmbeddedFiles) {
    for (const m of text.matchAll(/\/F\s*\(([^)]{1,200})\)/g)) {
      if (!embeddedFiles.includes(m[1])) embeddedFiles.push(m[1]);
    }
  }
  const hasDigitalSignature = /\/Type\s*\/Sig\b|\/SubFilter\s*\/adbe\.pkcs7|\/SubFilter\s*\/ETSI\.CAdES/.test(text);
  const annotMatches = text.match(/\/Subtype\s*\/(Text|FreeText|Highlight|Underline|Link|Popup|Stamp|Widget)\b/g);
  const annotationCount = annotMatches ? annotMatches.length : 0;

  const fontSet = new Set<string>();
  for (const m of text.matchAll(/\/BaseFont\s*\/([A-Za-z0-9_+.-]{2,80})/g)) {
    fontSet.add(m[1]);
  }
  const fonts = [...fontSet].slice(0, 60);

  tags.push({ ns: 'PDF/Structure', name: 'EOFRevisions', raw: eofCount, decoded: String(eofCount), source: 'pdf-parser' });
  tags.push({ ns: 'PDF/Structure', name: 'ObjectCount', raw: objCount, decoded: String(objCount), source: 'pdf-parser' });
  tags.push({ ns: 'PDF/Security', name: 'HasJavaScript', raw: hasJavaScript, decoded: hasJavaScript ? 'Ya' : 'Tidak', source: 'pdf-parser' });
  tags.push({ ns: 'PDF/Security', name: 'HasDigitalSignature', raw: hasDigitalSignature, decoded: hasDigitalSignature ? 'Ya' : 'Tidak', source: 'pdf-parser' });

  const clampedExplained = Math.min(explainedBytes, file.size);
  const unexplained: Array<{ offset: number; size: number }> = [];
  const lastEof = eofMatches.length > 0 ? (eofMatches[eofMatches.length - 1].index ?? 0) + 5 : file.size;
  if (lastEof + 4 < file.size) {
    unexplained.push({ offset: lastEof, size: file.size - lastEof });
  } else if (clampedExplained < file.size) {
    unexplained.push({ offset: clampedExplained, size: file.size - clampedExplained });
  }

  return {
    structure,
    tags,
    technical: {
      format: 'PDF',
      pdfVersion,
      pageCount,
      eofCount,
      revisions: Math.max(1, eofCount),
      producer: extractedInfo.Producer,
      creator: extractedInfo.Creator,
      author: extractedInfo.Author,
      hasJavaScript,
      hasEmbeddedFiles,
      embeddedFiles: embeddedFiles.length > 0 ? embeddedFiles : undefined,
      hasDigitalSignature,
      annotationCount,
      fonts: fonts.length > 0 ? fonts : undefined,
    },
    timeline,
    coverage: {
      mapped: true,
      explainedBytes: clampedExplained,
      totalBytes: file.size,
      unexplained,
      segments,
    },
  };
}
