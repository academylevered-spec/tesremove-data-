import exifr from 'exifr';
import { unzlibSync } from 'fflate';
import { walkBoxes } from './mp4';
import type {
  BoxNode,
  CoverageInfo,
  ImageInfo,
  LocationInfo,
  TagEntry,
  TimelineEntry,
} from './types';

// Standard IEEE 802.3 CRC32 lookup table for PNG chunk verification
const CRC32_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[n] = c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function decimalToDms(deg: number, isLat: boolean): string {
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(2);
  return `${d}° ${m}' ${s}" ${dir}`;
}

function decodeAscii(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = '';
  for (let i = start; i < end && i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

// Standard Annex K Luminance Quantization Table (quality 50 baseline) for JPEG quality estimation
const STD_LUMINANCE_QT = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

function estimateJpegQuality(values: number[]): number | undefined {
  if (values.length !== 64) return undefined;
  let sumRatio = 0;
  for (let i = 0; i < 64; i++) {
    if (STD_LUMINANCE_QT[i] > 0) {
      sumRatio += (values[i] * 100) / STD_LUMINANCE_QT[i];
    }
  }
  const avgScale = sumRatio / 64;
  if (avgScale <= 0) return 100;
  let quality: number;
  if (avgScale <= 100) {
    quality = Math.round((200 - avgScale) / 2);
  } else {
    quality = Math.round(5000 / avgScale);
  }
  return Math.max(1, Math.min(100, quality));
}

function getJpegDimensionsFromBytes(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (len < 2 || pos + 2 + len > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
      if (pos + 9 <= bytes.length) {
        const height = (bytes[pos + 5] << 8) | bytes[pos + 6];
        const width = (bytes[pos + 7] << 8) | bytes[pos + 8];
        return { width, height };
      }
    }
    pos += 2 + len;
  }
  return undefined;
}

function bytesToBase64DataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof btoa === 'function') {
    return `data:${mime};base64,${btoa(binary)}`;
  }
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function walkJpegBuffer(bytes: Uint8Array): {
  nodes: BoxNode[];
  info: Partial<ImageInfo>;
  coverage: CoverageInfo;
} {
  const nodes: BoxNode[] = [];
  const quantizationTables: Array<{ id: number; precision: number; values: number[] }> = [];
  let width: number | undefined;
  let height: number | undefined;
  let progressive: boolean | undefined;
  let subsampling: string | undefined;
  let bitDepth: number | undefined;
  let hasEndMarker = false;
  let trailingData: { offset: number; size: number } | undefined;
  let explainedBytes = 0;
  const segments: Array<{ label: string; offset: number; size: number; colorKey: string }> = [];

  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return {
      nodes: [{ path: '/ERR', type: 'ERR', offset: 0, size: bytes.length, error: 'Missing JPEG SOI marker' }],
      info: { format: 'JPEG', hasEndMarker: false },
      coverage: { mapped: true, explainedBytes: 0, totalBytes: bytes.length, unexplained: [{ offset: 0, size: bytes.length }] },
    };
  }

  nodes.push({ path: '/SOI', type: 'SOI', offset: 0, size: 2, detail: 'Start of Image' });
  segments.push({ label: 'SOI', offset: 0, size: 2, colorKey: 'header' });
  explainedBytes += 2;

  let pos = 2;
  let safetyCounter = 0;

  while (pos + 2 <= bytes.length && safetyCounter < 5000) {
    safetyCounter++;
    // Skip padding 0xFF bytes
    while (pos < bytes.length && bytes[pos] === 0xff && pos + 1 < bytes.length && bytes[pos + 1] === 0xff) {
      pos++;
      explainedBytes++;
    }
    if (pos + 2 > bytes.length || bytes[pos] !== 0xff) {
      nodes.push({ path: `/INVALID_${pos}`, type: 'ERR', offset: pos, size: bytes.length - pos, error: 'Unexpected non-marker byte' });
      break;
    }

    const marker = bytes[pos + 1];

    // EOI
    if (marker === 0xd9) {
      nodes.push({ path: '/EOI', type: 'EOI', offset: pos, size: 2, detail: 'End of Image' });
      segments.push({ label: 'EOI', offset: pos, size: 2, colorKey: 'header' });
      explainedBytes += 2;
      hasEndMarker = true;
      pos += 2;
      if (pos < bytes.length) {
        trailingData = { offset: pos, size: bytes.length - pos };
        nodes.push({
          path: '/TRAILING_DATA',
          type: 'TRAILING',
          offset: pos,
          size: bytes.length - pos,
          detail: `${bytes.length - pos} byte tambahan setelah EOI`,
        });
      }
      break;
    }

    // Standalone RST0-RST7 or TEM
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      const name = marker === 0x01 ? 'TEM' : `RST${marker - 0xd0}`;
      nodes.push({ path: `/${name}`, type: name, offset: pos, size: 2 });
      explainedBytes += 2;
      pos += 2;
      continue;
    }

    if (pos + 4 > bytes.length) {
      nodes.push({ path: '/TRUNCATED', type: 'ERR', offset: pos, size: bytes.length - pos, error: 'Truncated segment length' });
      break;
    }

    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const totalSegSize = 2 + segLen;
    if (segLen < 2 || pos + totalSegSize > bytes.length) {
      nodes.push({
        path: `/M_0x${marker.toString(16).toUpperCase()}`,
        type: `0xFF${marker.toString(16).toUpperCase()}`,
        offset: pos,
        size: bytes.length - pos,
        error: `invalid segment length (${segLen})`,
      });
      break;
    }

    const payloadStart = pos + 4;
    const payloadEnd = pos + totalSegSize;
    const payload = bytes.subarray(payloadStart, payloadEnd);

    let typeName = `0xFF${marker.toString(16).toUpperCase()}`;
    let detail: string | undefined;
    let colorKey = 'other';

    if (marker >= 0xe0 && marker <= 0xef) {
      const appIdx = marker - 0xe0;
      typeName = `APP${appIdx}`;
      colorKey = 'metadata';
      const headStr = decodeAscii(payload, 0, Math.min(payload.length, 32));
      if (appIdx === 0 && headStr.startsWith('JFIF')) detail = 'JFIF';
      else if (appIdx === 1 && headStr.startsWith('Exif')) detail = 'Exif';
      else if (appIdx === 1 && headStr.startsWith('http://ns.adobe.com/xap/')) detail = 'XMP';
      else if (appIdx === 2 && headStr.startsWith('ICC_PROFILE')) detail = 'ICC Profile';
      else if (appIdx === 11 && headStr.includes('jumb')) detail = 'JUMBF / C2PA';
      else if (appIdx === 13 && headStr.startsWith('Photoshop')) detail = 'Photoshop / IPTC';
      else if (appIdx === 14 && headStr.startsWith('Adobe')) detail = 'Adobe DCT';
    } else if (marker === 0xdb) {
      typeName = 'DQT';
      detail = 'Quantization Table';
      colorKey = 'header';
      let qp = 0;
      while (qp < payload.length) {
        const pqTq = payload[qp++];
        const precision = (pqTq >> 4) === 0 ? 8 : 16;
        const id = pqTq & 0x0f;
        const count = precision === 8 ? 64 : 128;
        if (qp + count > payload.length) break;
        const values: number[] = [];
        for (let k = 0; k < 64; k++) {
          if (precision === 8) {
            values.push(payload[qp + k]);
          } else {
            values.push((payload[qp + k * 2] << 8) | payload[qp + k * 2 + 1]);
          }
        }
        quantizationTables.push({ id, precision, values });
        qp += count;
      }
    } else if (marker === 0xc4) {
      typeName = 'DHT';
      detail = 'Huffman Table';
      colorKey = 'header';
    } else if (marker === 0xdd) {
      typeName = 'DRI';
      detail = 'Restart Interval';
    } else if (marker === 0xfe) {
      typeName = 'COM';
      detail = decodeAscii(payload, 0, Math.min(payload.length, 80)).replace(/[^\x20-\x7e]/g, '');
      colorKey = 'metadata';
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      typeName = marker === 0xc0 ? 'SOF0' : marker === 0xc1 ? 'SOF1' : 'SOF2';
      progressive = marker === 0xc2;
      colorKey = 'header';
      if (payload.length >= 6) {
        bitDepth = payload[0];
        height = (payload[1] << 8) | payload[2];
        width = (payload[3] << 8) | payload[4];
        const comps = payload[5];
        if (comps === 3 && payload.length >= 15) {
          const ySamp = payload[7];
          const hY = (ySamp >> 4) & 0x0f;
          const vY = ySamp & 0x0f;
          if (hY === 2 && vY === 2) subsampling = '4:2:0';
          else if (hY === 2 && vY === 1) subsampling = '4:2:2';
          else if (hY === 1 && vY === 1) subsampling = '4:4:4';
          else subsampling = `${hY}x${vY}`;
        } else if (comps === 1) {
          subsampling = 'Grayscale';
        }
        detail = `${progressive ? 'Progressive' : 'Baseline'} ${width}×${height}${subsampling ? ` (${subsampling})` : ''}`;
      }
    } else if (marker === 0xda) {
      typeName = 'SOS';
      detail = 'Start of Scan';
      colorKey = 'media';
      nodes.push({ path: `/${typeName}`, type: typeName, offset: pos, size: totalSegSize, detail });
      segments.push({ label: 'SOS Header', offset: pos, size: totalSegSize, colorKey: 'header' });
      explainedBytes += totalSegSize;
      pos += totalSegSize;

      // Scan entropy-coded data properly skipping FF 00 stuffing and RST0..RST7
      const scanStart = pos;
      while (pos < bytes.length - 1) {
        if (bytes[pos] === 0xff) {
          const next = bytes[pos + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
            pos += next === 0xff ? 1 : 2;
            continue;
          }
          // Found next real marker (typically EOI 0xD9 or another SOS in progressive JPEG)
          break;
        }
        pos++;
      }
      const entropySize = pos - scanStart;
      if (entropySize > 0) {
        nodes.push({
          path: '/SCAN_DATA',
          type: 'ENTROPY',
          offset: scanStart,
          size: entropySize,
          detail: 'Entropy-coded image data',
        });
        segments.push({ label: 'Scan Data', offset: scanStart, size: entropySize, colorKey: 'media' });
        explainedBytes += entropySize;
      }
      continue;
    }

    nodes.push({
      path: `/${typeName}${detail ? ` (${detail})` : ''}`,
      type: typeName,
      offset: pos,
      size: totalSegSize,
      detail,
    });
    segments.push({ label: detail ? `${typeName} ${detail}` : typeName, offset: pos, size: totalSegSize, colorKey });
    explainedBytes += totalSegSize;
    pos += totalSegSize;
  }

  const lumaTable = quantizationTables.find((q) => q.id === 0) ?? quantizationTables[0];
  const estimatedQuality = lumaTable ? estimateJpegQuality(lumaTable.values) : undefined;

  const unexplained: Array<{ offset: number; size: number }> = [];
  if (trailingData) unexplained.push(trailingData);
  else if (explainedBytes < bytes.length) {
    unexplained.push({ offset: explainedBytes, size: bytes.length - explainedBytes });
  }

  return {
    nodes,
    info: {
      format: 'JPEG',
      width,
      height,
      bitDepth,
      subsampling,
      progressive,
      estimatedQuality,
      quantizationTables: quantizationTables.length > 0 ? quantizationTables : undefined,
      hasEndMarker,
      trailingData,
    },
    coverage: {
      mapped: true,
      explainedBytes: Math.min(explainedBytes, bytes.length),
      totalBytes: bytes.length,
      unexplained,
      segments,
    },
  };
}

function walkPngBuffer(bytes: Uint8Array): {
  nodes: BoxNode[];
  info: Partial<ImageInfo>;
  tags: TagEntry[];
  timeline: TimelineEntry[];
  coverage: CoverageInfo;
} {
  const nodes: BoxNode[] = [];
  const tags: TagEntry[] = [];
  const timeline: TimelineEntry[] = [];
  const pngChunks: NonNullable<ImageInfo['pngChunks']> = [];
  const pngTextChunks: NonNullable<ImageInfo['pngTextChunks']> = [];
  const segments: Array<{ label: string; offset: number; size: number; colorKey: string }> = [];

  let width: number | undefined;
  let height: number | undefined;
  let bitDepth: number | undefined;
  let colorSpace: string | undefined;
  let iccProfile: ImageInfo['iccProfile'];
  let hasEndMarker = false;
  let trailingData: { offset: number; size: number } | undefined;

  if (bytes.length < 8) {
    return {
      nodes: [{ path: '/ERR', type: 'ERR', offset: 0, size: bytes.length, error: 'Truncated PNG signature' }],
      info: { format: 'PNG', hasEndMarker: false },
      tags,
      timeline,
      coverage: { mapped: true, explainedBytes: 0, totalBytes: bytes.length, unexplained: [{ offset: 0, size: bytes.length }] },
    };
  }

  nodes.push({ path: '/PNG_SIG', type: 'SIG', offset: 0, size: 8, detail: 'PNG 8-byte signature' });
  segments.push({ label: 'Signature', offset: 0, size: 8, colorKey: 'header' });
  let explainedBytes = 8;
  let pos = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (pos + 12 <= bytes.length) {
    const dataLen = view.getUint32(pos);
    const totalChunkSize = 12 + dataLen;
    const type = decodeAscii(bytes, pos + 4, pos + 8);
    if (pos + totalChunkSize > bytes.length) {
      nodes.push({
        path: `/${type}`,
        type,
        offset: pos,
        size: bytes.length - pos,
        error: `invalid chunk length (${dataLen})`,
      });
      break;
    }

    const typeAndData = bytes.subarray(pos + 4, pos + 8 + dataLen);
    const actualCrc = view.getUint32(pos + 8 + dataLen);
    const expectedCrc = crc32(typeAndData);
    const crcValid = actualCrc === expectedCrc;
    const data = bytes.subarray(pos + 8, pos + 8 + dataLen);

    pngChunks.push({
      type,
      offset: pos,
      size: totalChunkSize,
      crcValid,
      expectedCrc: expectedCrc.toString(16).padStart(8, '0'),
      actualCrc: actualCrc.toString(16).padStart(8, '0'),
    });

    let detail: string | undefined;
    if (type === 'IHDR' && data.length >= 13) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0);
      height = dv.getUint32(4);
      bitDepth = data[8];
      const colorType = data[9];
      const colorNames: Record<number, string> = {
        0: 'Grayscale',
        2: 'RGB',
        3: 'Indexed',
        4: 'Grayscale+Alpha',
        6: 'RGBA',
      };
      colorSpace = colorNames[colorType] ?? `ColorType ${colorType}`;
      detail = `${width}×${height}, ${bitDepth}-bit ${colorSpace}`;
      tags.push({ ns: 'PNG/IHDR', name: 'ImageWidth', raw: width, decoded: `${width} px`, source: 'png-parser', offset: pos });
      tags.push({ ns: 'PNG/IHDR', name: 'ImageHeight', raw: height, decoded: `${height} px`, source: 'png-parser', offset: pos });
      tags.push({ ns: 'PNG/IHDR', name: 'ColorType', raw: colorType, decoded: colorSpace, source: 'png-parser', offset: pos });
      tags.push({ ns: 'PNG/IHDR', name: 'BitDepth', raw: bitDepth, decoded: `${bitDepth} bit`, source: 'png-parser', offset: pos });
    } else if (type === 'tEXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const keyword = decodeAscii(data, 0, nullIdx);
        const text = decodeAscii(data, nullIdx + 1, data.length);
        pngTextChunks.push({ keyword, text, chunkType: 'tEXt', offset: pos });
        tags.push({ ns: 'PNG/tEXt', name: keyword, raw: text, decoded: text, source: 'png-parser', offset: pos });
        detail = `${keyword}: ${text.slice(0, 60)}`;
      }
    } else if (type === 'zTXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0 && nullIdx + 2 <= data.length) {
        const keyword = decodeAscii(data, 0, nullIdx);
        try {
          const inflated = unzlibSync(data.subarray(nullIdx + 2));
          const text = new TextDecoder('latin1').decode(inflated);
          pngTextChunks.push({ keyword, text, chunkType: 'zTXt', offset: pos });
          tags.push({ ns: 'PNG/zTXt', name: keyword, raw: text, decoded: text, source: 'png-parser', offset: pos });
          detail = `${keyword} (compressed)`;
        } catch {
          tags.push({ ns: 'PNG/zTXt', name: keyword, raw: '<zlib inflate error>', source: 'png-parser', offset: pos });
        }
      }
    } else if (type === 'iTXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0 && nullIdx + 3 <= data.length) {
        const keyword = decodeAscii(data, 0, nullIdx);
        const compFlag = data[nullIdx + 1];
        let p = nullIdx + 3;
        const langEnd = data.indexOf(0, p);
        p = langEnd >= 0 ? langEnd + 1 : p;
        const transEnd = data.indexOf(0, p);
        p = transEnd >= 0 ? transEnd + 1 : p;
        let text = '';
        try {
          const payload = compFlag === 1 ? unzlibSync(data.subarray(p)) : data.subarray(p);
          text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
        } catch {
          text = decodeAscii(data, p, data.length);
        }
        pngTextChunks.push({ keyword, text, chunkType: 'iTXt', offset: pos });
        tags.push({ ns: 'PNG/iTXt', name: keyword, raw: text, decoded: text, source: 'png-parser', offset: pos });
        detail = `${keyword}: ${text.slice(0, 60)}`;
      }
    } else if (type === 'tIME' && data.length >= 7) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const yr = dv.getUint16(0);
      const mo = String(data[2]).padStart(2, '0');
      const dy = String(data[3]).padStart(2, '0');
      const hr = String(data[4]).padStart(2, '0');
      const mi = String(data[5]).padStart(2, '0');
      const sc = String(data[6]).padStart(2, '0');
      const iso = `${yr}-${mo}-${dy}T${hr}:${mi}:${sc}Z`;
      tags.push({ ns: 'PNG/tIME', name: 'ModifyDate', raw: iso, decoded: iso, source: 'png-parser', offset: pos });
      timeline.push({ label: 'PNG tIME ModifyDate', value: iso, utc: iso, source: 'png-tIME', tagRef: 'PNG/tIME:ModifyDate' });
    } else if (type === 'iCCP') {
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const name = decodeAscii(data, 0, nullIdx);
        iccProfile = { name, size: Math.max(0, data.length - nullIdx - 2) };
        tags.push({ ns: 'PNG/iCCP', name: 'ProfileName', raw: name, decoded: name, source: 'png-parser', offset: pos });
        detail = `ICC: ${name}`;
      }
    }

    nodes.push({
      path: `/${type}`,
      type,
      offset: pos,
      size: totalChunkSize,
      detail,
      error: crcValid ? undefined : `CRC mismatch (actual ${actualCrc.toString(16)}, expected ${expectedCrc.toString(16)})`,
    });
    segments.push({
      label: type,
      offset: pos,
      size: totalChunkSize,
      colorKey: type === 'IDAT' ? 'media' : type === 'IHDR' || type === 'IEND' ? 'header' : 'metadata',
    });

    explainedBytes += totalChunkSize;
    pos += totalChunkSize;

    if (type === 'IEND') {
      hasEndMarker = true;
      if (pos < bytes.length) {
        trailingData = { offset: pos, size: bytes.length - pos };
        nodes.push({
          path: '/TRAILING_DATA',
          type: 'TRAILING',
          offset: pos,
          size: bytes.length - pos,
          detail: `${bytes.length - pos} byte tambahan setelah IEND`,
        });
      }
      break;
    }
  }

  const unexplained: Array<{ offset: number; size: number }> = [];
  if (trailingData) unexplained.push(trailingData);
  else if (explainedBytes < bytes.length) {
    unexplained.push({ offset: explainedBytes, size: bytes.length - explainedBytes });
  }

  return {
    nodes,
    info: {
      format: 'PNG',
      width,
      height,
      bitDepth,
      colorSpace,
      iccProfile,
      pngChunks,
      pngTextChunks,
      hasEndMarker,
      trailingData,
    },
    tags,
    timeline,
    coverage: {
      mapped: true,
      explainedBytes: Math.min(explainedBytes, bytes.length),
      totalBytes: bytes.length,
      unexplained,
      segments,
    },
  };
}

function normalizeTagValue(val: unknown): { raw: unknown; decoded: string } {
  if (val instanceof Date) {
    const iso = val.toISOString();
    return { raw: iso, decoded: iso };
  }
  if (val instanceof Uint8Array || ArrayBuffer.isView(val)) {
    const arr = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    return { raw: `<${arr.length} bytes>`, decoded: `<binary ${arr.length} B>` };
  }
  if (Array.isArray(val)) {
    return { raw: val, decoded: val.map((v) => String(v)).join(', ') };
  }
  if (typeof val === 'object' && val !== null) {
    try {
      const s = JSON.stringify(val);
      return { raw: val, decoded: s };
    } catch {
      return { raw: String(val), decoded: String(val) };
    }
  }
  const str = String(val ?? '');
  if (str === '0000:00:00 00:00:00') {
    return { raw: str, decoded: '0000:00:00 00:00:00 (dikosongkan)' };
  }
  return { raw: val, decoded: str };
}

export interface ImageAnalysisOutput {
  structure: BoxNode[];
  tags: TagEntry[];
  technical: ImageInfo;
  timeline: TimelineEntry[];
  location?: LocationInfo;
  coverage: CoverageInfo;
}

export async function analyzeImage(file: Blob, detectedType: string): Promise<ImageAnalysisOutput> {
  const tags: TagEntry[] = [];
  const timeline: TimelineEntry[] = [];
  let structure: BoxNode[] = [];
  let info: ImageInfo = { format: detectedType };
  let coverage: CoverageInfo = { mapped: false, explainedBytes: 0, totalBytes: file.size, unexplained: [{ offset: 0, size: file.size }] };
  let location: LocationInfo | undefined;

  // Read full image if <= 64 MB (typical images are a few MB; larger ones use chunked walk)
  const buffer = file.size <= 64 * 1024 * 1024 ? new Uint8Array(await file.arrayBuffer()) : undefined;

  if (detectedType === 'JPEG' && buffer) {
    const walked = walkJpegBuffer(buffer);
    structure = walked.nodes;
    info = { ...info, ...walked.info };
    coverage = walked.coverage;
  } else if (detectedType === 'PNG' && buffer) {
    const walked = walkPngBuffer(buffer);
    structure = walked.nodes;
    info = { ...info, ...walked.info };
    tags.push(...walked.tags);
    timeline.push(...walked.timeline);
    coverage = walked.coverage;
  } else if (detectedType === 'HEIC/HEIF' || detectedType === 'AVIF') {
    structure = await walkBoxes(file, 0, file.size, '');
    const explained = structure.reduce((acc, n) => acc + (n.error ? 0 : n.size), 0);
    coverage = {
      mapped: true,
      explainedBytes: Math.min(explained, file.size),
      totalBytes: file.size,
      unexplained: explained < file.size ? [{ offset: explained, size: file.size - explained }] : [],
      segments: structure.map((n) => ({ label: n.type, offset: n.offset, size: n.size, colorKey: n.type === 'mdat' ? 'media' : 'metadata' })),
    };
  } else if (detectedType === 'WebP' && buffer && buffer.length >= 12) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let pos = 12;
    let explained = 12;
    structure.push({ path: '/RIFF_WEBP', type: 'RIFF', offset: 0, size: 12, detail: 'RIFF WEBP Header' });
    while (pos + 8 <= buffer.length) {
      const chunkId = decodeAscii(buffer, pos, pos + 4);
      const chunkSize = view.getUint32(pos + 4, true);
      const padded = chunkSize + (chunkSize % 2);
      if (pos + 8 + chunkSize > buffer.length) {
        structure.push({ path: `/${chunkId}`, type: chunkId, offset: pos, size: buffer.length - pos, error: 'truncated RIFF chunk' });
        break;
      }
      structure.push({ path: `/${chunkId}`, type: chunkId, offset: pos, size: 8 + padded });
      explained += 8 + padded;
      pos += 8 + padded;
    }
    coverage = {
      mapped: true,
      explainedBytes: Math.min(explained, buffer.length),
      totalBytes: buffer.length,
      unexplained: explained < buffer.length ? [{ offset: explained, size: buffer.length - explained }] : [],
      segments: structure.map((n) => ({ label: n.type, offset: n.offset, size: n.size, colorKey: n.type === 'VP8 ' || n.type === 'VP8L' ? 'media' : 'metadata' })),
    };
  } else if (detectedType === 'GIF' && buffer && buffer.length >= 10) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    info.width = view.getUint16(6, true);
    info.height = view.getUint16(8, true);
    structure.push({ path: '/GIF_HEADER', type: 'HEADER', offset: 0, size: 13, detail: `${decodeAscii(buffer, 0, 6)} ${info.width}×${info.height}` });
  }

  // Parse EXIF / GPS / IPTC / XMP / ICC / Thumbnail via exifr (keeps ALL tags including unknown numeric tags!)
  try {
    const parseInput = buffer ?? new Uint8Array(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer());
    const parsed = await exifr.parse(parseInput, {
      tiff: true,
      ifd1: true,
      exif: true,
      gps: true,
      interop: true,
      iptc: true,
      xmp: true,
      icc: true,
      jfif: true,
      ihdr: true,
      mergeOutput: false,
      reviveValues: false,
      translateKeys: true,
      translateValues: false,
      sanitize: false,
    });

    if (parsed && typeof parsed === 'object') {
      const seenDates = new Set<string>();
      for (const [segmentName, segmentObj] of Object.entries(parsed)) {
        if (!segmentObj || typeof segmentObj !== 'object') continue;
        const ns = segmentName.toUpperCase();
        for (const [k, v] of Object.entries(segmentObj as Record<string, unknown>)) {
          if (v === undefined) continue;
          const norm = normalizeTagValue(v);
          tags.push({
            ns,
            name: k,
            raw: norm.raw,
            decoded: norm.decoded,
            source: 'exifr',
          });

          // Collect dates into timeline
          if (/date|time/i.test(k) && !/exposure|shutter|offset|subsec|stamp/i.test(k) && typeof norm.decoded === 'string') {
            const keyId = `${ns}:${k}`;
            if (!seenDates.has(keyId)) {
              seenDates.add(keyId);
              const isZeroed = norm.decoded.startsWith('0000:00:00');
              let utc: string | undefined;
              let anomaly: string | undefined = isZeroed ? 'dikosongkan' : undefined;
              if (!isZeroed) {
                const normalizedIso = norm.decoded.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
                const dt = new Date(normalizedIso);
                if (!Number.isNaN(dt.getTime())) {
                  utc = dt.toISOString();
                  if (dt.getTime() > Date.now() + 86400000) {
                    anomaly = 'tanggal di masa depan';
                  }
                }
              }
              timeline.push({
                label: `${ns} ${k}`,
                value: norm.decoded,
                utc,
                anomaly,
                source: 'exifr',
                tagRef: keyId,
                isZeroed,
              });
            }
          }
        }
      }

      // Extract ICC summary
      const icc = (parsed as Record<string, Record<string, unknown>>).icc;
      if (icc) {
        info.iccProfile = {
          name: String(icc.ProfileDescription ?? icc.ProfileClass ?? 'ICC Profile'),
          colorSpace: icc.ColorSpaceData ? String(icc.ColorSpaceData) : undefined,
          description: icc.ProfileDescription ? String(icc.ProfileDescription) : undefined,
        };
      }

      // Dimensions fallback from EXIF/IFD0
      const ifd0 = (parsed as Record<string, Record<string, unknown>>).ifd0;
      const exif = (parsed as Record<string, Record<string, unknown>>).exif;
      if (!info.width) {
        const w = Number(exif?.ExifImageWidth ?? ifd0?.ImageWidth ?? 0);
        if (w > 0) info.width = w;
      }
      if (!info.height) {
        const h = Number(exif?.ExifImageHeight ?? ifd0?.ImageHeight ?? 0);
        if (h > 0) info.height = h;
      }
    }

    // GPS coordinates via exifr.gps (accurate decimal conversion)
    try {
      const gpsData = await exifr.gps(parseInput);
      if (gpsData && typeof gpsData.latitude === 'number' && typeof gpsData.longitude === 'number' && !Number.isNaN(gpsData.latitude) && !Number.isNaN(gpsData.longitude)) {
        const gpsSeg = (parsed as Record<string, Record<string, unknown>> | undefined)?.gps;
        const alt = typeof gpsSeg?.GPSAltitude === 'number' ? gpsSeg.GPSAltitude : undefined;
        const dir = typeof gpsSeg?.GPSImgDirection === 'number' ? gpsSeg.GPSImgDirection : undefined;
        location = {
          lat: Number(gpsData.latitude.toFixed(6)),
          lon: Number(gpsData.longitude.toFixed(6)),
          latDms: decimalToDms(gpsData.latitude, true),
          lonDms: decimalToDms(gpsData.longitude, false),
          alt,
          direction: dir,
          source: 'EXIF GPS',
        };
      }
    } catch {
      // No GPS data
    }

    // Embedded thumbnail via exifr.thumbnail
    try {
      const thumbBytes = await exifr.thumbnail(parseInput);
      if (thumbBytes && thumbBytes.length > 0) {
        const thumbDims = getJpegDimensionsFromBytes(thumbBytes);
        let aspectRatioDiff: number | undefined;
        if (thumbDims && info.width && info.height && info.height > 0 && thumbDims.height > 0) {
          const mainRatio = info.width / info.height;
          const thumbRatio = thumbDims.width / thumbDims.height;
          aspectRatioDiff = Number(Math.abs(mainRatio - thumbRatio).toFixed(3));
        }
        info.thumbnail = {
          present: true,
          size: thumbBytes.length,
          width: thumbDims?.width,
          height: thumbDims?.height,
          aspectRatioDiff,
          mimeType: 'image/jpeg',
          dataUrl: bytesToBase64DataUrl(thumbBytes, 'image/jpeg'),
        };
      }
    } catch {
      // No embedded thumbnail
    }
  } catch {
    // exifr may fail on non-EXIF images like plain GIF/BMP; ignore gracefully
  }

  return {
    structure,
    tags,
    technical: info,
    timeline,
    location,
    coverage,
  };
}
