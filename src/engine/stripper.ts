import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { crc32 } from './image';
import { detectFileMagic } from './magic';

export interface StripOptions {
  preserveColorProfile: boolean;
  stripTrailingData: boolean;
  zeroTimestamps: boolean;
  stripOfficeCommentsAndMacros: boolean;
}

export const DEFAULT_STRIP_OPTIONS: StripOptions = {
  preserveColorProfile: true,
  stripTrailingData: true,
  zeroTimestamps: true,
  stripOfficeCommentsAndMacros: true,
};

export interface RemovedMetadataItem {
  category: string;
  label: string;
  detail: string;
  bytesSaved?: number;
}

export interface StripResult {
  supported: boolean;
  format: string;
  mime: string;
  originalFilename: string;
  cleanedFilename: string;
  originalSize: number;
  cleanedSize: number;
  bytesRemoved: number;
  cleanedBytes: Uint8Array;
  cleanedBlob: Blob;
  removedItems: RemovedMetadataItem[];
  keptItems: string[];
  notes: string[];
  unsupportedReason?: string;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  const end = Math.min(bytes.length, start + len);
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function makeCleanFilename(original: string): string {
  const dot = original.lastIndexOf('.');
  if (dot <= 0) return `${original}_clean`;
  return `${original.slice(0, dot)}_clean${original.slice(dot)}`;
}

// ============================================================================
// 1. JPEG Lossless Metadata Stripper
// ============================================================================
function stripJpeg(bytes: Uint8Array, options: StripOptions): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = ['Data kompresi piksel JPEG asli (100% lossless, tanpa re-encoding)'];
  const notes: string[] = [];

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { out: bytes, removed, kept: [], notes: ['Header JPEG SOI (FF D8) tidak valid.'] };
  }

  const outChunks: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let pos = 2;
  let keptIcc = false;

  while (pos + 2 <= bytes.length) {
    // Skip fill 0xFF padding bytes
    while (pos < bytes.length && bytes[pos] === 0xff && bytes[pos + 1] === 0xff) {
      pos++;
    }
    if (pos + 2 > bytes.length || bytes[pos] !== 0xff) break;

    const marker = bytes[pos + 1];

    // EOI (FF D9)
    if (marker === 0xd9) {
      outChunks.push(bytes.subarray(pos, pos + 2));
      pos += 2;
      break;
    }

    // Standalone markers (RST0..7, TEM, SOI)
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      outChunks.push(bytes.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }

    if (pos + 4 > bytes.length) break;
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (segLen < 2 || pos + 2 + segLen > bytes.length) {
      // Truncated segment — keep remaining safely
      outChunks.push(bytes.subarray(pos));
      pos = bytes.length;
      break;
    }

    const totalSegBytes = 2 + segLen;
    const segment = bytes.subarray(pos, pos + totalSegBytes);

    // SOS (Start of Scan): copy SOS header + entropy-coded scan until EOI (FF D9)
    if (marker === 0xda) {
      let scanEnd = pos + totalSegBytes;
      while (scanEnd + 1 < bytes.length) {
        if (bytes[scanEnd] === 0xff) {
          const next = bytes[scanEnd + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
            scanEnd += 2;
            continue;
          }
          if (next === 0xd9) {
            // Found EOI
            outChunks.push(bytes.subarray(pos, scanEnd + 2));
            pos = scanEnd + 2;
            break;
          }
        }
        scanEnd++;
      }
      if (pos < scanEnd) {
        // No EOI found — copy rest
        outChunks.push(bytes.subarray(pos));
        pos = bytes.length;
      }
      break;
    }

    // Decide keep vs strip for APPn / COM markers
    const isCom = marker === 0xfe;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (isCom) {
      removed.push({
        category: 'JPEG COM',
        label: 'Komentar JPEG (FF FE)',
        detail: readAscii(bytes, pos + 4, Math.min(segLen - 2, 80)).replace(/[^\x20-\x7e]/g, ' ').trim() || 'Segmen komentar biner',
        bytesSaved: totalSegBytes,
      });
    } else if (isApp) {
      const appNum = marker - 0xe0;
      const ident = readAscii(bytes, pos + 4, Math.min(segLen - 2, 29));
      const isJfif = appNum === 0 && ident.startsWith('JFIF');
      const isIcc = appNum === 2 && ident.startsWith('ICC_PROFILE');
      const isAdobeColor = appNum === 14 && ident.startsWith('Adobe');

      if (isJfif || isAdobeColor) {
        outChunks.push(segment);
      } else if (isIcc && options.preserveColorProfile) {
        outChunks.push(segment);
        keptIcc = true;
      } else {
        let label = `Segmen APP${appNum}`;
        if (ident.startsWith('Exif')) label = 'EXIF / GPS / Thumbnail (APP1)';
        else if (ident.includes('http://ns.adobe.com/xap')) label = 'Metadata XMP (APP1)';
        else if (ident.startsWith('Photoshop 3.0')) label = 'IPTC / Photoshop IRB (APP13)';
        else if (isIcc) label = 'Profil Warna ICC (APP2)';
        else if (ident.startsWith('MPF')) label = 'Multi-Picture Format (APP2)';

        removed.push({
          category: `JPEG APP${appNum}`,
          label,
          detail: `Offset 0x${pos.toString(16).toUpperCase()} · ${totalSegBytes} byte`,
          bytesSaved: totalSegBytes,
        });
      }
    } else {
      // Critical markers: DQT, DHT, SOF*, DRI, etc.
      outChunks.push(segment);
    }

    pos += totalSegBytes;
  }

  // Handle trailing bytes after EOI
  if (pos < bytes.length) {
    const trailingLen = bytes.length - pos;
    if (options.stripTrailingData) {
      removed.push({
        category: 'Data Sisa',
        label: 'Data tersembunyi setelah marker EOI (FF D9)',
        detail: `${trailingLen} byte setelah akhir gambar dihapus`,
        bytesSaved: trailingLen,
      });
    } else {
      outChunks.push(bytes.subarray(pos));
      kept.push(`Data sisa setelah EOI (${trailingLen} byte) dipertahankan sesuai pilihan`);
    }
  }

  if (keptIcc) kept.push('Profil warna ICC (APP2) dipertahankan agar akurasi warna tidak berubah');

  return { out: concatBytes(...outChunks), removed, kept, notes };
}

// ============================================================================
// 2. PNG Lossless Metadata Stripper
// ============================================================================
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG', 'eXIF']);
const PNG_COLOR_CHUNKS = new Set(['iCCP', 'sRGB', 'gAMA', 'cHRM']);

function stripPng(bytes: Uint8Array, options: StripOptions): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = ['Seluruh data piksel IDAT/IHDR asli (100% lossless)'];
  const notes: string[] = [];

  if (bytes.length < 8) return { out: bytes, removed, kept: [], notes: ['File PNG terlalu pendek.'] };

  const outChunks: Uint8Array[] = [bytes.subarray(0, 8)]; // 8-byte signature
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let keptColor = false;

  while (pos + 12 <= bytes.length) {
    const len = dv.getUint32(pos, false);
    const type = readAscii(bytes, pos + 4, 4);
    const total = 12 + len;
    if (pos + total > bytes.length) {
      outChunks.push(bytes.subarray(pos));
      pos = bytes.length;
      break;
    }

    const chunkSlice = bytes.subarray(pos, pos + total);
    const isMeta = PNG_METADATA_CHUNKS.has(type);
    const isColor = PNG_COLOR_CHUNKS.has(type);

    if (isMeta) {
      let extra = `${total} byte`;
      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        const keyEnd = bytes.indexOf(0, pos + 8);
        const key = keyEnd > pos + 8 && keyEnd < pos + 8 + Math.min(len, 64)
          ? readAscii(bytes, pos + 8, keyEnd - (pos + 8))
          : '';
        if (key) extra = `Keyword "${key}" · ${total} byte`;
      }
      removed.push({
        category: `PNG ${type}`,
        label: type === 'eXIf' ? 'Metadata EXIF (eXIf)' : type === 'tIME' ? 'Timestamp modifikasi (tIME)' : `Teks / Prompt / XMP (${type})`,
        detail: extra,
        bytesSaved: total,
      });
    } else if (isColor && !options.preserveColorProfile) {
      removed.push({
        category: `PNG ${type}`,
        label: `Profil warna (${type})`,
        detail: `${total} byte`,
        bytesSaved: total,
      });
    } else {
      if (isColor) keptColor = true;
      outChunks.push(chunkSlice);
    }

    pos += total;
    if (type === 'IEND') break;
  }

  if (pos < bytes.length) {
    const trailingLen = bytes.length - pos;
    if (options.stripTrailingData) {
      removed.push({
        category: 'Data Sisa',
        label: 'Data setelah chunk IEND',
        detail: `${trailingLen} byte setelah akhir PNG dihapus`,
        bytesSaved: trailingLen,
      });
    } else {
      outChunks.push(bytes.subarray(pos));
    }
  }

  if (keptColor) kept.push('Profil warna PNG (iCCP/sRGB/gAMA) dipertahankan');

  return { out: concatBytes(...outChunks), removed, kept, notes };
}

// ============================================================================
// 3. WebP Lossless Metadata Stripper (RIFF WEBP)
// ============================================================================
function stripWebp(bytes: Uint8Array, options: StripOptions): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = ['Bitstream gambar WebP asli (100% lossless)'];
  const notes: string[] = [];

  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
    return { out: bytes, removed, kept: [], notes: ['Header RIFF WEBP tidak valid.'] };
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keptChunks: Array<{ fourcc: string; chunk: Uint8Array }> = [];
  let pos = 12;
  let removedExif = false;
  let removedXmp = false;
  let removedIcc = false;

  while (pos + 8 <= bytes.length) {
    const fourcc = readAscii(bytes, pos, 4);
    const size = dv.getUint32(pos + 4, true);
    const padded = size + (size % 2);
    const total = 8 + padded;
    if (pos + 8 + size > bytes.length) break;

    const sliceEnd = Math.min(bytes.length, pos + total);
    const rawChunk = bytes.slice(pos, sliceEnd);

    if (fourcc === 'EXIF') {
      removedExif = true;
      removed.push({ category: 'WebP EXIF', label: 'Metadata EXIF / GPS', detail: `${rawChunk.length} byte`, bytesSaved: rawChunk.length });
    } else if (fourcc === 'XMP ') {
      removedXmp = true;
      removed.push({ category: 'WebP XMP', label: 'Metadata XMP', detail: `${rawChunk.length} byte`, bytesSaved: rawChunk.length });
    } else if (fourcc === 'ICCP' && !options.preserveColorProfile) {
      removedIcc = true;
      removed.push({ category: 'WebP ICCP', label: 'Profil Warna ICC', detail: `${rawChunk.length} byte`, bytesSaved: rawChunk.length });
    } else {
      keptChunks.push({ fourcc, chunk: rawChunk });
    }

    pos += total;
  }

  // Update VP8X feature flags if present
  for (const item of keptChunks) {
    if (item.fourcc === 'VP8X' && item.chunk.length >= 12) {
      if (removedExif) item.chunk[8] &= ~0x08;
      if (removedXmp) item.chunk[8] &= ~0x04;
      if (removedIcc) item.chunk[8] &= ~0x20;
    }
  }

  const body = concatBytes(...keptChunks.map((c) => c.chunk));
  const riffHead = new Uint8Array(12);
  riffHead.set(strToU8('RIFF'), 0);
  new DataView(riffHead.buffer).setUint32(4, 4 + body.length, true);
  riffHead.set(strToU8('WEBP'), 8);

  return { out: concatBytes(riffHead, body), removed, kept, notes };
}

// ============================================================================
// 4. GIF Lossless Comment & XMP Stripper
// ============================================================================
function stripGif(bytes: Uint8Array): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = ['Frame gambar & animasi GIF asli (100% lossless)'];
  const notes: string[] = [];

  if (bytes.length < 13) return { out: bytes, removed, kept: [], notes: ['File GIF terlalu pendek.'] };

  const outChunks: Uint8Array[] = [];
  const packed = bytes[10];
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = hasGct ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  let pos = 13 + gctSize;
  if (pos > bytes.length) return { out: bytes, removed, kept: [], notes: [] };
  outChunks.push(bytes.subarray(0, pos));

  const skipSubBlocks = (start: number): number => {
    let p = start;
    while (p < bytes.length) {
      const sz = bytes[p];
      p += 1;
      if (sz === 0) break;
      p += sz;
    }
    return Math.min(p, bytes.length);
  };

  while (pos < bytes.length) {
    const b = bytes[pos];
    if (b === 0x3b) {
      // Trailer
      outChunks.push(bytes.subarray(pos, pos + 1));
      pos++;
      break;
    }
    if (b === 0x21 && pos + 1 < bytes.length) {
      const label = bytes[pos + 1];
      if (label === 0xfe) {
        // Comment extension
        const end = skipSubBlocks(pos + 2);
        removed.push({
          category: 'GIF Comment',
          label: 'Ekstensi Komentar GIF (21 FE)',
          detail: `${end - pos} byte`,
          bytesSaved: end - pos,
        });
        pos = end;
        continue;
      }
      if (label === 0xff && pos + 14 <= bytes.length) {
        const blockSize = bytes[pos + 2];
        const appId = readAscii(bytes, pos + 3, Math.min(blockSize, 11));
        const end = skipSubBlocks(pos + 3 + blockSize);
        if (appId.startsWith('XMP Data')) {
          removed.push({
            category: 'GIF XMP',
            label: 'Metadata XMP GIF (21 FF)',
            detail: `${end - pos} byte`,
            bytesSaved: end - pos,
          });
          pos = end;
          continue;
        }
        outChunks.push(bytes.subarray(pos, end));
        pos = end;
        continue;
      }
      // Other extensions (Graphic Control 0xF9, Plain Text 0x01)
      const end = skipSubBlocks(pos + 2);
      outChunks.push(bytes.subarray(pos, end));
      pos = end;
      continue;
    }
    if (b === 0x2c && pos + 10 <= bytes.length) {
      // Image descriptor
      const lPacked = bytes[pos + 9];
      const hasLct = (lPacked & 0x80) !== 0;
      const lctSize = hasLct ? 3 * (1 << ((lPacked & 0x07) + 1)) : 0;
      const lzwStart = pos + 10 + lctSize + 1; // +1 for LZW min code size
      const end = skipSubBlocks(lzwStart);
      outChunks.push(bytes.subarray(pos, end));
      pos = end;
      continue;
    }
    // Unexpected byte — preserve rest
    outChunks.push(bytes.subarray(pos));
    break;
  }

  return { out: concatBytes(...outChunks), removed, kept, notes };
}

// ============================================================================
// 5. MP4 / MOV / M4A Lossless Container Stripper (with exact stco/co64 patching!)
// ============================================================================
interface RawBox {
  type: string;
  offset: number;
  size: number;
  hdrSize: number;
  bytes: Uint8Array;
}

function parseTopBoxes(buf: Uint8Array, start = 0, end = buf.length): RawBox[] {
  const boxes: RawBox[] = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = start;
  while (pos + 8 <= end) {
    let size = dv.getUint32(pos, false);
    const type = readAscii(buf, pos + 4, 4);
    let hdrSize = 8;
    if (size === 1 && pos + 16 <= end) {
      size = Number(dv.getBigUint64(pos + 8, false));
      hdrSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < hdrSize || pos + size > end) break;
    boxes.push({ type, offset: pos, size, hdrSize, bytes: buf.subarray(pos, pos + size) });
    pos += size;
  }
  return boxes;
}

function rebuildBox(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, 8 + body.length, false);
  out.set(strToU8(type), 4);
  out.set(body, 8);
  return out;
}

function zeroMp4HeaderTimestamps(box: RawBox): { bytes: Uint8Array; zeroed: boolean } {
  const copy = new Uint8Array(box.bytes);
  if (copy.length < box.hdrSize + 12) return { bytes: copy, zeroed: false };
  const dv = new DataView(copy.buffer);
  const version = copy[box.hdrSize];
  const off = box.hdrSize + 4; // after version + flags
  let changed = false;

  if (version === 0 && off + 8 <= copy.length) {
    const c = dv.getUint32(off, false);
    const m = dv.getUint32(off + 4, false);
    if (c !== 0 || m !== 0) {
      dv.setUint32(off, 0, false);
      dv.setUint32(off + 4, 0, false);
      changed = true;
    }
  } else if (version === 1 && off + 16 <= copy.length) {
    const c = dv.getBigUint64(off, false);
    const m = dv.getBigUint64(off + 8, false);
    if (c !== BigInt(0) || m !== BigInt(0)) {
      dv.setBigUint64(off, BigInt(0), false);
      dv.setBigUint64(off + 8, BigInt(0), false);
      changed = true;
    }
  }
  return { bytes: copy, zeroed: changed };
}

function patchMp4ChunkOffsets(boxBytes: Uint8Array, delta: number): Uint8Array {
  if (delta === 0) return boxBytes;
  const copy = new Uint8Array(boxBytes);
  const dv = new DataView(copy.buffer);

  const walkAndPatch = (start: number, end: number) => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = dv.getUint32(pos, false);
      const type = readAscii(copy, pos + 4, 4);
      let hdr = 8;
      if (size === 1 && pos + 16 <= end) {
        size = Number(dv.getBigUint64(pos + 8, false));
        hdr = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < hdr || pos + size > end) break;

      if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
        walkAndPatch(pos + hdr, pos + size);
      } else if (type === 'stco' && pos + hdr + 8 <= pos + size) {
        const count = dv.getUint32(pos + hdr + 4, false);
        for (let i = 0; i < count; i++) {
          const p = pos + hdr + 8 + i * 4;
          if (p + 4 > pos + size) break;
          const orig = dv.getUint32(p, false);
          dv.setUint32(p, Math.max(0, orig + delta), false);
        }
      } else if (type === 'co64' && pos + hdr + 8 <= pos + size) {
        const count = dv.getUint32(pos + hdr + 4, false);
        for (let i = 0; i < count; i++) {
          const p = pos + hdr + 8 + i * 8;
          if (p + 8 > pos + size) break;
          const orig = Number(dv.getBigUint64(p, false));
          dv.setBigUint64(p, BigInt(Math.max(0, orig + delta)), false);
        }
      }

      pos += size;
    }
  };

  walkAndPatch(0, copy.length);
  return copy;
}

function cleanMp4Container(
  boxBytes: Uint8Array,
  hdrSize: number,
  type: string,
  options: StripOptions,
  removed: RemovedMetadataItem[],
  parentPath: string,
): Uint8Array {
  const children = parseTopBoxes(boxBytes, hdrSize, boxBytes.length);
  const keptChildren: Uint8Array[] = [];

  for (const child of children) {
    const cPath = `${parentPath}/${child.type}`;
    if (child.type === 'udta' || child.type === 'meta' || child.type === 'free' || child.type === 'skip' || child.type === 'uuid') {
      removed.push({
        category: `MP4 ${child.type}`,
        label:
          child.type === 'meta'
            ? `Atom metadata QuickTime/ISO (${cPath})`
            : child.type === 'udta'
              ? `Atom User Data / GPS / Tag (${cPath})`
              : child.type === 'uuid'
                ? `Atom XMP / UUID (${cPath})`
                : `Atom padding (${cPath})`,
        detail: `${child.size} byte dihapus`,
        bytesSaved: child.size,
      });
      continue;
    }

    if (options.zeroTimestamps && (child.type === 'mvhd' || child.type === 'tkhd' || child.type === 'mdhd')) {
      const { bytes: zBytes, zeroed } = zeroMp4HeaderTimestamps(child);
      if (zeroed) {
        removed.push({
          category: `MP4 ${child.type}`,
          label: `Timestamp pembuatan/modifikasi (${cPath})`,
          detail: 'Dikosongkan ke 0 (epoch Mac 1904)',
          bytesSaved: 0,
        });
      }
      keptChildren.push(zBytes);
      continue;
    }

    if (child.type === 'trak' || child.type === 'mdia') {
      keptChildren.push(cleanMp4Container(child.bytes, child.hdrSize, child.type, options, removed, cPath));
    } else {
      keptChildren.push(child.bytes);
    }
  }

  return rebuildBox(type, concatBytes(...keptChildren));
}

function stripMp4(bytes: Uint8Array, options: StripOptions): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = [
    'Track video & audio mdat asli (100% lossless, tanpa transcode)',
    'Offset chunk stco/co64 diperbarui otomatis agar pemutaran tetap sinkron',
  ];
  const notes: string[] = [
    'Catatan teknis: Pembersihan MP4 di browser menghapus atom kontainer metadata (udta, meta, uuid, free) dan mengosongkan timestamp header tanpa mengubah bitstream video (SEI encoder tetap utuh jika ada di dalam mdat).',
  ];

  const topBoxes = parseTopBoxes(bytes);
  if (topBoxes.length === 0) {
    return { out: bytes, removed, kept: [], notes: ['Struktur atom MP4 tidak dapat diurai.'] };
  }

  const origMdat = topBoxes.find((b) => b.type === 'mdat');
  const origMdatOffset = origMdat ? origMdat.offset : -1;

  const rebuilt: Array<{ type: string; bytes: Uint8Array }> = [];
  for (const box of topBoxes) {
    if (box.type === 'udta' || box.type === 'meta' || box.type === 'free' || box.type === 'skip' || box.type === 'uuid') {
      removed.push({
        category: `MP4 /${box.type}`,
        label: `Atom tingkat atas /${box.type}`,
        detail: `${box.size} byte dihapus`,
        bytesSaved: box.size,
      });
      continue;
    }

    if (box.type === 'moov') {
      const cleanMoov = cleanMp4Container(box.bytes, box.hdrSize, 'moov', options, removed, '/moov');
      rebuilt.push({ type: 'moov', bytes: cleanMoov });
    } else {
      rebuilt.push({ type: box.type, bytes: box.bytes });
    }
  }

  // Compute new mdat offset and patch stco/co64 inside moov so the file stays 100% playable!
  let newOffset = 0;
  let newMdatOffset = -1;
  for (const b of rebuilt) {
    if (b.type === 'mdat') {
      newMdatOffset = newOffset;
      break;
    }
    newOffset += b.bytes.length;
  }

  const delta = origMdatOffset >= 0 && newMdatOffset >= 0 ? newMdatOffset - origMdatOffset : 0;
  const finalBoxes = rebuilt.map((b) => (b.type === 'moov' && delta !== 0 ? patchMp4ChunkOffsets(b.bytes, delta) : b.bytes));

  return { out: concatBytes(...finalBoxes), removed, kept, notes };
}

// ============================================================================
// 6. Office OOXML / ODF Stripper (DOCX, XLSX, PPTX, ODT, ODS, ODP)
// ============================================================================
function stripOffice(bytes: Uint8Array, options: StripOptions): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = ['Isi dokumen utama, tata letak, dan gaya asli dipertahankan'];
  const notes: string[] = [];

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { out: bytes, removed, kept: [], notes: ['Arsip ZIP dokumen tidak dapat dibaca.'] };
  }

  const cleanedEntries: Record<string, Uint8Array> = {};

  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();

    // Always sanitize core / app / custom metadata XMLs
    if (lower === 'docprops/core.xml') {
      const minimalCore = strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"></cp:coreProperties>',
      );
      cleanedEntries[path] = minimalCore;
      removed.push({
        category: 'Office Core',
        label: 'Properti Inti Dokumen (docProps/core.xml)',
        detail: 'Nama penulis, pengubah terakhir, judul, revisi, dan tanggal dikosongkan',
        bytesSaved: Math.max(0, data.length - minimalCore.length),
      });
      continue;
    }

    if (lower === 'docprops/app.xml') {
      const minimalApp = strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"></Properties>',
      );
      cleanedEntries[path] = minimalApp;
      removed.push({
        category: 'Office App',
        label: 'Properti Aplikasi & Perusahaan (docProps/app.xml)',
        detail: 'Nama perusahaan, versi Office, dan total waktu edit dihapus',
        bytesSaved: Math.max(0, data.length - minimalApp.length),
      });
      continue;
    }

    if (lower === 'docprops/custom.xml' || lower === 'meta.xml') {
      removed.push({
        category: 'Office Metadata',
        label: `File metadata (${path})`,
        detail: `${data.length} byte dihapus`,
        bytesSaved: data.length,
      });
      continue;
    }

    if (lower.startsWith('docprops/thumbnail')) {
      removed.push({
        category: 'Office Thumbnail',
        label: `Pratinjau gambar tersemat (${path})`,
        detail: `${data.length} byte dihapus`,
        bytesSaved: data.length,
      });
      continue;
    }

    // Optional: remove comments & macros
    if (options.stripOfficeCommentsAndMacros) {
      if (lower.includes('comments') && lower.endsWith('.xml')) {
        removed.push({
          category: 'Komentar Dokumen',
          label: `Komentar internal (${path})`,
          detail: `${data.length} byte dihapus`,
          bytesSaved: data.length,
        });
        continue;
      }
      if (lower.endsWith('vbaproject.bin')) {
        removed.push({
          category: 'Makro VBA',
          label: `Kode Makro VBA (${path})`,
          detail: `${data.length} byte dihapus`,
          bytesSaved: data.length,
        });
        continue;
      }
      if (lower === 'word/document.xml') {
        const xml = strFromU8(data);
        // Remove w:del deleted text and unwrap w:ins accepted insertions cleanly
        const scrubbed = xml
          .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
          .replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, '$1')
          .replace(/\sw:author="[^"]*"/g, ' w:author=""')
          .replace(/\sw:date="[^"]*"/g, '');
        if (scrubbed !== xml) {
          const nextBytes = strToU8(scrubbed);
          cleanedEntries[path] = nextBytes;
          removed.push({
            category: 'Track Changes',
            label: 'Riwayat revisi (<w:del> & <w:ins>) di word/document.xml',
            detail: 'Teks terhapus dibuang, revisi disetujui, dan nama penulis dihapus',
            bytesSaved: Math.max(0, data.length - nextBytes.length),
          });
          continue;
        }
      }
    }

    cleanedEntries[path] = data;
  }

  const out = zipSync(cleanedEntries, { level: 6 });
  return { out, removed, kept, notes };
}

// ============================================================================
// 7. MP3 Lossless ID3v2 / ID3v1 / APEv2 Stripper
// ============================================================================
function stripMp3(bytes: Uint8Array): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = ['Frame audio MPEG asli (100% lossless, tanpa re-encoding)'];
  const notes: string[] = [];

  let start = 0;
  let end = bytes.length;

  // Strip ID3v2 header(s) at start
  while (start + 10 <= end && readAscii(bytes, start, 3) === 'ID3') {
    const flags = bytes[start + 5];
    const hasFooter = (flags & 0x10) !== 0;
    const tagSize =
      ((bytes[start + 6] & 0x7f) << 21) |
      ((bytes[start + 7] & 0x7f) << 14) |
      ((bytes[start + 8] & 0x7f) << 7) |
      (bytes[start + 9] & 0x7f);
    const total = 10 + tagSize + (hasFooter ? 10 : 0);
    if (start + total > end) break;
    removed.push({
      category: 'MP3 ID3v2',
      label: `Tag ID3v2.${bytes[start + 3]} (judul, artis, cover art, encoder)`,
      detail: `${total} byte di awal file dihapus`,
      bytesSaved: total,
    });
    start += total;
  }

  // Strip ID3v1 (last 128 bytes starting with "TAG")
  if (end - start >= 128 && readAscii(bytes, end - 128, 3) === 'TAG') {
    removed.push({
      category: 'MP3 ID3v1',
      label: 'Tag ID3v1 di akhir file',
      detail: '128 byte dihapus',
      bytesSaved: 128,
    });
    end -= 128;
  }

  // Strip APEv2 footer at end ("APETAGEX")
  if (end - start >= 32 && readAscii(bytes, end - 32, 8) === 'APETAGEX') {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const apeSize = dv.getUint32(end - 20, true);
    const apeFlags = dv.getUint32(end - 12, true);
    const hasHeader = (apeFlags & 0x80000000) !== 0;
    const totalApe = apeSize + (hasHeader ? 32 : 0);
    if (totalApe <= end - start) {
      removed.push({
        category: 'MP3 APEv2',
        label: 'Tag APEv2 di akhir file',
        detail: `${totalApe} byte dihapus`,
        bytesSaved: totalApe,
      });
      end -= totalApe;
    }
  }

  return { out: bytes.slice(start, end), removed, kept, notes };
}

// ============================================================================
// 8. WAV Lossless Metadata Chunk Stripper
// ============================================================================
const WAV_META_CHUNKS = new Set(['LIST', 'id3 ', 'ID3 ', 'iXML', 'bext', 'axml', 'JUNK', 'PAD ']);

function stripWav(bytes: Uint8Array): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = ['Stream audio PCM WAV asli (fmt & data, 100% lossless)'];
  const notes: string[] = [];

  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WAVE') {
    return { out: bytes, removed, kept: [], notes: ['Header RIFF WAVE tidak valid.'] };
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keptChunks: Uint8Array[] = [];
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const id = readAscii(bytes, pos, 4);
    const sz = dv.getUint32(pos + 4, true);
    const padded = sz + (sz % 2);
    const total = 8 + padded;
    if (pos + 8 + sz > bytes.length) break;

    if (WAV_META_CHUNKS.has(id)) {
      removed.push({
        category: `WAV ${id.trim()}`,
        label: `Chunk metadata WAV (${id.trim()})`,
        detail: `${total} byte dihapus`,
        bytesSaved: total,
      });
    } else {
      keptChunks.push(bytes.subarray(pos, Math.min(bytes.length, pos + total)));
    }

    pos += total;
  }

  const body = concatBytes(...keptChunks);
  const head = new Uint8Array(12);
  head.set(strToU8('RIFF'), 0);
  new DataView(head.buffer).setUint32(4, 4 + body.length, true);
  head.set(strToU8('WAVE'), 8);

  return { out: concatBytes(head, body), removed, kept, notes };
}

// ============================================================================
// 9. PDF Safe In-Place Metadata Scrubber (Preserves Exact xref Byte Offsets!)
// ============================================================================
function stripPdf(bytes: Uint8Array): {
  out: Uint8Array;
  removed: RemovedMetadataItem[];
  kept: string[];
  notes: string[];
} {
  const removed: RemovedMetadataItem[] = [];
  const kept: string[] = [
    'Halaman, teks, font, dan tabel xref byte-offset PDF tetap valid 100%',
  ];
  const notes: string[] = [];

  const copy = new Uint8Array(bytes);
  // Decode as latin1 (1:1 byte-to-char mapping so indices match exact byte offsets!)
  let text = '';
  for (let i = 0; i < copy.length; i++) text += String.fromCharCode(copy[i]);

  const eofCount = (text.match(/%%EOF/g) || []).length;
  if (eofCount > 1) {
    notes.push(
      `PDF ini memiliki ${eofCount} revisi inkremental (%%EOF). Semua kamus /Info dan XMP pada tiap revisi telah disamarkan, namun untuk menghapus total riwayat objek lama disarankan ekspor ulang PDF melalui Print-to-PDF.`,
    );
  }

  // 1) Scrub /Title, /Author, /Subject, /Keywords, /Creator, /Producer, /CreationDate, /ModDate literal strings (...) in-place
  const infoRegex = /(\/(?:Title|Author|Subject|Keywords|Creator|Producer|CreationDate|ModDate)\s*\()((?:\\.|[^\\)])*)(\))/g;
  let match: RegExpExecArray | null;
  let scrubbedInfoCount = 0;
  while ((match = infoRegex.exec(text)) !== null) {
    const valStart = match.index + match[1].length;
    const valLen = match[2].length;
    if (valLen > 0) {
      for (let i = 0; i < valLen; i++) copy[valStart + i] = 0x20; // space-pad exact length
      scrubbedInfoCount++;
    }
  }
  if (scrubbedInfoCount > 0) {
    removed.push({
      category: 'PDF /Info',
      label: `${scrubbedInfoCount} field metadata kamus /Info dibersihkan`,
      detail: 'Author, Creator, Producer, Title, dan tanggal disamarkan tanpa merusak offset xref',
      bytesSaved: 0,
    });
  }

  // 2) Blank XMP packet <x:xmpmeta ...>...</x:xmpmeta> in-place with spaces
  const xmpRegex = /<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g;
  let xmpCount = 0;
  while ((match = xmpRegex.exec(text)) !== null) {
    for (let i = 0; i < match[0].length; i++) copy[match.index + i] = 0x20;
    xmpCount++;
  }
  if (xmpCount > 0) {
    removed.push({
      category: 'PDF XMP',
      label: `${xmpCount} paket XML metadata XMP dibersihkan`,
      detail: 'Isi paket XMP dikosongkan in-place dengan spasi agar ukuran stream PDF tetap konsisten',
      bytesSaved: 0,
    });
  }

  // Keep CRC helper referenced cleanly if needed in future chunk rebuilds
  void crc32;

  return { out: copy, removed, kept, notes };
}

// ============================================================================
// Main Universal Entry Point
// ============================================================================
export async function stripFileMetadata(
  file: Blob,
  filename: string,
  options: StripOptions = DEFAULT_STRIP_OPTIONS,
): Promise<StripResult> {
  const magic = await detectFileMagic(file, filename);
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const cleanedFilename = makeCleanFilename(filename);

  const buildResult = (
    supported: boolean,
    res: { out: Uint8Array; removed: RemovedMetadataItem[]; kept: string[]; notes: string[] },
    unsupportedReason?: string,
  ): StripResult => {
    const out = res.out;
    const blob = new Blob([out.buffer as ArrayBuffer], { type: magic.mime || 'application/octet-stream' });
    return {
      supported,
      format: magic.type,
      mime: magic.mime,
      originalFilename: filename,
      cleanedFilename,
      originalSize: rawBytes.length,
      cleanedSize: out.length,
      bytesRemoved: Math.max(0, rawBytes.length - out.length),
      cleanedBytes: out,
      cleanedBlob: blob,
      removedItems: res.removed,
      keptItems: res.kept,
      notes: res.notes,
      unsupportedReason,
    };
  };

  if (magic.type === 'JPEG') return buildResult(true, stripJpeg(rawBytes, options));
  if (magic.type === 'PNG') return buildResult(true, stripPng(rawBytes, options));
  if (magic.type === 'WebP') return buildResult(true, stripWebp(rawBytes, options));
  if (magic.type === 'GIF') return buildResult(true, stripGif(rawBytes));
  if (
    magic.type === 'MP4' ||
    magic.type === 'QuickTime MOV' ||
    magic.type === 'M4A Audio (MP4)' ||
    magic.type === '3GP Video (MP4)'
  ) {
    return buildResult(true, stripMp4(rawBytes, options));
  }
  if (magic.family === 'office') return buildResult(true, stripOffice(rawBytes, options));
  if (magic.type === 'MP3') return buildResult(true, stripMp3(rawBytes));
  if (magic.type === 'WAV') return buildResult(true, stripWav(rawBytes));
  if (magic.type === 'PDF') return buildResult(true, stripPdf(rawBytes));

  return buildResult(
    false,
    { out: rawBytes, removed: [], kept: [], notes: [] },
    `Pembersihan lossless otomatis di browser saat ini mendukung JPEG, PNG, WebP, GIF, MP4/MOV/M4A, DOCX/XLSX/PPTX/ODF, PDF, MP3, dan WAV. Format terdeteksi: ${magic.type}.`,
  );
}
