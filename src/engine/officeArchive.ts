import { unzipSync } from 'fflate';
import type { BoxNode, CoverageInfo, DocInfo, TagEntry, TimelineEntry } from './types';

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Safe non-executing XML tag extractor (zero XXE, zero DOM script evaluation)
function extractXmlTag(xml: string, tagName: string): string | undefined {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${escaped}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${escaped}>`, 'i'));
  if (!m) return undefined;
  const cleaned = decodeXmlEntities(m[1].replace(/<[^>]+>/g, '').trim());
  return cleaned || undefined;
}

function dosDateTimeToIso(dosDate: number, dosTime: number): string | undefined {
  if (dosDate === 0 && dosTime === 0) return undefined;
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = (dosDate >> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hour = (dosTime >> 11) & 0x1f;
  const min = (dosTime >> 5) & 0x3f;
  const sec = (dosTime & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}Z`;
}

interface ZipCdEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  modifiedAt?: string;
  comment?: string;
  localHeaderOffset: number;
  extraLength: number;
}

function parseZipCentralDirectory(bytes: Uint8Array): {
  entries: ZipCdEntry[];
  cdOffset: number;
  cdSize: number;
  eocdOffset: number;
  archiveComment?: string;
} | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find End of Central Directory (PK\x05\x06) scanning backwards from end
  const searchStart = Math.max(0, bytes.length - 65557);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const commentLen = view.getUint16(eocdOffset + 20, true);
  const archiveComment =
    commentLen > 0 && eocdOffset + 22 + commentLen <= bytes.length
      ? new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(eocdOffset + 22, eocdOffset + 22 + commentLen))
      : undefined;

  const entries: ZipCdEntry[] = [];
  let pos = cdOffset;
  const td = new TextDecoder('utf-8', { fatal: false });

  for (let i = 0; i < totalEntries && pos + 46 <= bytes.length; i++) {
    if (
      bytes[pos] !== 0x50 ||
      bytes[pos + 1] !== 0x4b ||
      bytes[pos + 2] !== 0x01 ||
      bytes[pos + 3] !== 0x02
    ) {
      break;
    }
    const modTime = view.getUint16(pos + 12, true);
    const modDate = view.getUint16(pos + 14, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const fileCommentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    if (pos + 46 + nameLen + extraLen + fileCommentLen > bytes.length) break;
    const name = td.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    const comment =
      fileCommentLen > 0
        ? td.decode(bytes.subarray(pos + 46 + nameLen + extraLen, pos + 46 + nameLen + extraLen + fileCommentLen))
        : undefined;

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      modifiedAt: dosDateTimeToIso(modDate, modTime),
      comment,
      localHeaderOffset,
      extraLength: extraLen,
    });
    pos += 46 + nameLen + extraLen + fileCommentLen;
  }

  return { entries, cdOffset, cdSize, eocdOffset, archiveComment };
}

export interface OfficeArchiveOutput {
  structure: BoxNode[];
  tags: TagEntry[];
  technical: DocInfo;
  timeline: TimelineEntry[];
  coverage: CoverageInfo;
  refinedType?: string;
  refinedFamily?: 'office' | 'archive';
}

export async function analyzeZipOrOffice(file: Blob, detectedType: string): Promise<OfficeArchiveOutput> {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 32 * 1024 * 1024)).arrayBuffer());
  const structure: BoxNode[] = [];
  const tags: TagEntry[] = [];
  const timeline: TimelineEntry[] = [];

  const cd = parseZipCentralDirectory(bytes);
  const entries = cd?.entries ?? [];
  let explainedBytes = 0;
  const segments: Array<{ label: string; offset: number; size: number; colorKey: string }> = [];

  for (const e of entries) {
    const approxEntrySize = 30 + e.name.length + e.extraLength + e.compressedSize;
    explainedBytes += approxEntrySize;
    structure.push({
      path: `/${e.name}`,
      type: 'ZIP_ENTRY',
      offset: e.localHeaderOffset,
      size: approxEntrySize,
      detail: `${e.uncompressedSize} B${e.modifiedAt ? ` · ${e.modifiedAt}` : ''}`,
    });
    if (segments.length < 25) {
      segments.push({ label: e.name, offset: e.localHeaderOffset, size: approxEntrySize, colorKey: 'media' });
    }
  }

  if (cd) {
    const eocdSize = bytes.length - cd.eocdOffset;
    structure.push({ path: '/CENTRAL_DIRECTORY', type: 'ZIP_CD', offset: cd.cdOffset, size: cd.cdSize, detail: `${entries.length} entries` });
    structure.push({ path: '/EOCD', type: 'ZIP_EOCD', offset: cd.eocdOffset, size: eocdSize });
    explainedBytes += cd.cdSize + eocdSize;
    segments.push({ label: 'Central Directory', offset: cd.cdOffset, size: cd.cdSize + eocdSize, colorKey: 'header' });
    if (cd.archiveComment) {
      tags.push({ ns: 'ZIP', name: 'ArchiveComment', raw: cd.archiveComment, decoded: cd.archiveComment, source: 'zip-parser', offset: cd.eocdOffset });
    }
  }

  tags.push({ ns: 'ZIP', name: 'EntryCount', raw: entries.length, decoded: String(entries.length), source: 'zip-parser' });

  // Detect Office/EPUB family from ZIP entries
  const entryNames = new Set(entries.map((e) => e.name));
  let refinedType = detectedType;
  let refinedFamily: 'office' | 'archive' = 'archive';

  const isDocx = entryNames.has('word/document.xml');
  const isXlsx = entryNames.has('xl/workbook.xml');
  const isPptx = entryNames.has('ppt/presentation.xml');
  const isOdf = entryNames.has('meta.xml') && entryNames.has('content.xml');
  const isEpub = entryNames.has('META-INF/container.xml');

  if (isDocx) { refinedType = 'DOCX'; refinedFamily = 'office'; }
  else if (isXlsx) { refinedType = 'XLSX'; refinedFamily = 'office'; }
  else if (isPptx) { refinedType = 'PPTX'; refinedFamily = 'office'; }
  else if (isOdf) { refinedType = detectedType.startsWith('OD') ? detectedType : 'ODF'; refinedFamily = 'office'; }
  else if (isEpub) { refinedType = 'EPUB'; refinedFamily = 'office'; }

  const docInfo: DocInfo = {
    format: refinedType,
    archiveEntries: entries.map((e) => ({
      name: e.name,
      compressedSize: e.compressedSize,
      uncompressedSize: e.uncompressedSize,
      modifiedAt: e.modifiedAt,
      comment: e.comment,
      offset: e.localHeaderOffset,
      extraLength: e.extraLength,
    })),
  };

  // Selectively inflate ONLY small metadata XML files (zip-bomb safe filter!)
  if (refinedFamily === 'office') {
    const td = new TextDecoder('utf-8', { fatal: false });
    const comments: NonNullable<DocInfo['comments']> = [];
    const trackedChanges: NonNullable<DocInfo['trackedChanges']> = [];
    const hiddenSheets: string[] = [];
    const externalLinks: string[] = [];
    const customXmlParts: string[] = [];

    for (const e of entries) {
      if (/vbaProject\.bin$/i.test(e.name)) {
        docInfo.hasMacros = true;
        tags.push({ ns: 'Office/Security', name: 'VBAMacroProject', raw: e.name, decoded: `Makro terdeteksi (${e.name})`, source: 'office-parser', offset: e.localHeaderOffset });
      }
      if (/^customXml\//i.test(e.name)) {
        customXmlParts.push(e.name);
      }
    }

    try {
      const files = unzipSync(bytes, {
        filter: (f) =>
          f.originalSize < 4 * 1024 * 1024 &&
          (f.name === 'docProps/core.xml' ||
            f.name === 'docProps/app.xml' ||
            f.name === 'docProps/custom.xml' ||
            f.name === 'meta.xml' ||
            f.name === 'word/document.xml' ||
            f.name === 'word/comments.xml' ||
            f.name === 'xl/workbook.xml' ||
            /^xl\/comments\d*\.xml$/i.test(f.name) ||
            /^ppt\/comments\/.*\.xml$/i.test(f.name) ||
            /\.rels$/i.test(f.name) ||
            /\.opf$/i.test(f.name)),
      });

      // docProps/core.xml
      if (files['docProps/core.xml']) {
        const xml = td.decode(files['docProps/core.xml']);
        const coreFields: Array<[string, string]> = [
          ['title', 'Title'],
          ['subject', 'Subject'],
          ['creator', 'Creator'],
          ['keywords', 'Keywords'],
          ['description', 'Description'],
          ['lastModifiedBy', 'LastModifiedBy'],
          ['revision', 'Revision'],
          ['created', 'CreateDate'],
          ['modified', 'ModifyDate'],
        ];
        for (const [tag, label] of coreFields) {
          const val = extractXmlTag(xml, tag);
          if (val) {
            tags.push({ ns: 'Office/Core', name: label, raw: val, decoded: val, source: 'office-parser' });
            if (label === 'Creator') docInfo.author = val;
            if (label === 'LastModifiedBy') docInfo.lastModifiedBy = val;
            if (label === 'Revision') docInfo.revisions = parseInt(val, 10) || undefined;
            if (label === 'CreateDate' || label === 'ModifyDate') {
              const dt = new Date(val);
              timeline.push({
                label: `Office ${label}`,
                value: val,
                utc: !Number.isNaN(dt.getTime()) ? dt.toISOString() : undefined,
                source: 'docProps/core.xml',
                tagRef: `Office/Core:${label}`,
              });
            }
          }
        }
      }

      // docProps/app.xml
      if (files['docProps/app.xml']) {
        const xml = td.decode(files['docProps/app.xml']);
        for (const [tag, label] of [
          ['Application', 'Application'],
          ['AppVersion', 'AppVersion'],
          ['Company', 'Company'],
          ['Manager', 'Manager'],
          ['TotalTime', 'TotalEditingTimeMinutes'],
          ['Pages', 'Pages'],
          ['Words', 'Words'],
          ['Template', 'Template'],
        ]) {
          const val = extractXmlTag(xml, tag);
          if (val) {
            tags.push({ ns: 'Office/App', name: label, raw: val, decoded: val, source: 'office-parser' });
            if (label === 'Application') docInfo.application = val;
            if (label === 'Company') docInfo.company = val;
            if (label === 'Pages') docInfo.pageCount = parseInt(val, 10) || undefined;
          }
        }
      }

      // ODF meta.xml
      if (files['meta.xml']) {
        const xml = td.decode(files['meta.xml']);
        for (const [tag, label] of [
          ['generator', 'Generator'],
          ['initial-creator', 'InitialCreator'],
          ['creator', 'LastModifiedBy'],
          ['creation-date', 'CreateDate'],
          ['date', 'ModifyDate'],
          ['editing-cycles', 'Revision'],
        ]) {
          const val = extractXmlTag(xml, tag);
          if (val) {
            tags.push({ ns: 'ODF/Meta', name: label, raw: val, decoded: val, source: 'office-parser' });
            if (label === 'InitialCreator') docInfo.author = val;
            if (label === 'LastModifiedBy') docInfo.lastModifiedBy = val;
            if (label === 'Generator') docInfo.application = val;
          }
        }
      }

      // Word comments
      if (files['word/comments.xml']) {
        const xml = td.decode(files['word/comments.xml']);
        for (const m of xml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/gi)) {
          const attrs = m[1];
          const author = attrs.match(/w:author="([^"]*)"/)?.[1];
          const date = attrs.match(/w:date="([^"]*)"/)?.[1];
          const body = decodeXmlEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          comments.push({ author, date, text: body, source: 'word/comments.xml' });
        }
      }

      // Word tracked changes (w:ins / w:del)
      if (files['word/document.xml']) {
        const xml = td.decode(files['word/document.xml']);
        for (const m of xml.matchAll(/<w:(ins|del)\b([^>]*)>([\s\S]*?)<\/w:(?:ins|del)>/gi)) {
          const kind = m[1].toLowerCase() === 'del' ? 'delete' : 'insert';
          const attrs = m[2];
          const author = attrs.match(/w:author="([^"]*)"/)?.[1];
          const date = attrs.match(/w:date="([^"]*)"/)?.[1];
          const body = decodeXmlEntities(m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          trackedChanges.push({ author, date, type: kind, text: body });
        }
      }

      // Excel hidden sheets
      if (files['xl/workbook.xml']) {
        const xml = td.decode(files['xl/workbook.xml']);
        for (const m of xml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
          const attrs = m[1];
          const state = attrs.match(/state="([^"]*)"/i)?.[1];
          const name = attrs.match(/name="([^"]*)"/i)?.[1];
          if (state && (state === 'hidden' || state === 'veryHidden') && name) {
            hiddenSheets.push(`${name} (${state})`);
          }
        }
      }

      // External links in .rels
      for (const [fname, content] of Object.entries(files)) {
        if (fname.endsWith('.rels')) {
          const xml = td.decode(content);
          for (const m of xml.matchAll(/Target="([^"]+)"[^>]*TargetMode="External"|TargetMode="External"[^>]*Target="([^"]+)"/gi)) {
            const link = m[1] || m[2];
            if (link && !externalLinks.includes(link)) externalLinks.push(link);
          }
        }
      }
    } catch {
      // Malformed zip entries: keep Central Directory listing safely
    }

    if (comments.length > 0) {
      docInfo.comments = comments;
      tags.push({ ns: 'Office/Review', name: 'CommentsCount', raw: comments.length, decoded: `${comments.length} komentar`, source: 'office-parser' });
    }
    if (trackedChanges.length > 0) {
      docInfo.trackedChanges = trackedChanges;
      tags.push({ ns: 'Office/Review', name: 'TrackedChangesCount', raw: trackedChanges.length, decoded: `${trackedChanges.length} perubahan terlacak`, source: 'office-parser' });
    }
    if (hiddenSheets.length > 0) {
      docInfo.hiddenSheets = hiddenSheets;
      tags.push({ ns: 'Office/Workbook', name: 'HiddenSheets', raw: hiddenSheets, decoded: hiddenSheets.join(', '), source: 'office-parser' });
    }
    if (externalLinks.length > 0) {
      docInfo.externalLinks = externalLinks;
      tags.push({ ns: 'Office/Links', name: 'ExternalLinks', raw: externalLinks, decoded: externalLinks.join(', '), source: 'office-parser' });
    }
    if (customXmlParts.length > 0) {
      docInfo.customXmlParts = customXmlParts;
    }
  }

  const clampedExplained = Math.min(explainedBytes, file.size);
  const unexplained: Array<{ offset: number; size: number }> = [];
  if (clampedExplained < file.size) {
    unexplained.push({ offset: clampedExplained, size: file.size - clampedExplained });
  }

  return {
    structure,
    tags,
    technical: docInfo,
    timeline,
    coverage: {
      mapped: Boolean(cd),
      explainedBytes: clampedExplained,
      totalBytes: file.size,
      unexplained,
      segments,
    },
    refinedType,
    refinedFamily,
  };
}

export async function analyzeTarOrGzip(file: Blob, detectedType: string): Promise<OfficeArchiveOutput> {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer());
  const structure: BoxNode[] = [];
  const tags: TagEntry[] = [];
  const timeline: TimelineEntry[] = [];
  const archiveEntries: NonNullable<DocInfo['archiveEntries']> = [];

  if (detectedType === 'GZIP' && bytes.length >= 10) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const flags = bytes[3];
    const mtime = view.getUint32(4, true);
    const osByte = bytes[9];
    let pos = 10;
    if ((flags & 0x04) !== 0 && pos + 2 <= bytes.length) {
      const xlen = view.getUint16(pos, true);
      pos += 2 + xlen;
    }
    let origName: string | undefined;
    if ((flags & 0x08) !== 0) {
      const end = bytes.indexOf(0, pos);
      if (end > pos) {
        origName = new TextDecoder('latin1').decode(bytes.subarray(pos, end));
        pos = end + 1;
      }
    }
    if (origName) {
      tags.push({ ns: 'GZIP', name: 'OriginalFileName', raw: origName, decoded: origName, source: 'gzip-parser', offset: 10 });
    }
    tags.push({ ns: 'GZIP', name: 'OS', raw: osByte, decoded: String(osByte), source: 'gzip-parser', offset: 9 });
    if (mtime > 0) {
      const iso = new Date(mtime * 1000).toISOString();
      tags.push({ ns: 'GZIP', name: 'ModifyDate', raw: mtime, decoded: iso, source: 'gzip-parser', offset: 4 });
      timeline.push({ label: 'GZIP mtime', value: iso, utc: iso, source: 'gzip', tagRef: 'GZIP:ModifyDate' });
    }
    structure.push({ path: '/GZIP_HEADER', type: 'HEADER', offset: 0, size: pos, detail: origName ?? 'GZIP stream' });
    structure.push({ path: '/DEFLATE_STREAM', type: 'DATA', offset: pos, size: Math.max(0, file.size - pos - 8) });
    if (file.size >= 8) {
      structure.push({ path: '/GZIP_TRAILER', type: 'TRAILER', offset: file.size - 8, size: 8, detail: 'CRC32 + ISIZE' });
    }
  } else if (detectedType === 'TAR') {
    const td = new TextDecoder('utf-8', { fatal: false });
    let pos = 0;
    while (pos + 512 <= bytes.length && archiveEntries.length < 1000) {
      const nameRaw = td.decode(bytes.subarray(pos, pos + 100)).replace(/\x00.*$/, '');
      if (!nameRaw) break;
      const sizeOctal = td.decode(bytes.subarray(pos + 124, pos + 136)).replace(/\x00.*$/, '').trim();
      const mtimeOctal = td.decode(bytes.subarray(pos + 136, pos + 148)).replace(/\x00.*$/, '').trim();
      const size = parseInt(sizeOctal, 8) || 0;
      const mtime = parseInt(mtimeOctal, 8) || 0;
      const modIso = mtime > 0 ? new Date(mtime * 1000).toISOString() : undefined;
      archiveEntries.push({ name: nameRaw, compressedSize: size, uncompressedSize: size, modifiedAt: modIso, offset: pos });
      structure.push({ path: `/${nameRaw}`, type: 'TAR_ENTRY', offset: pos, size: 512 + Math.ceil(size / 512) * 512 });
      pos += 512 + Math.ceil(size / 512) * 512;
    }
    tags.push({ ns: 'TAR', name: 'EntryCount', raw: archiveEntries.length, decoded: String(archiveEntries.length), source: 'tar-parser' });
  }

  return {
    structure,
    tags,
    technical: { format: detectedType, archiveEntries: archiveEntries.length > 0 ? archiveEntries : undefined },
    timeline,
    coverage: {
      mapped: structure.length > 0,
      explainedBytes: structure.length > 0 ? file.size : 0,
      totalBytes: file.size,
      unexplained: [],
    },
  };
}
