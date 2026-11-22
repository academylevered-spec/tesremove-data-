import type {
  BitstreamInfo,
  BoxNode,
  CoverageInfo,
  HvccNalArray,
  TagEntry,
  TimelineEntry,
  TrackSummary,
  VideoInfo,
  VideoStats,
} from './types';

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'dinf']);
const MAX_WALK_DEPTH = 16;
const MAX_BOX_NODES = 4000;
const EPOCH_1904_TO_1970_SEC = 2082844800;

const HEVC_NAL_NAMES: Record<number, string> = {
  0: 'TRAIL_N',
  1: 'TRAIL_R',
  19: 'IDR_W_RADL',
  20: 'IDR_N_LP',
  21: 'CRA_NUT',
  32: 'VPS',
  33: 'SPS',
  34: 'PPS',
  35: 'AUD',
  39: 'SEI_PREFIX',
  40: 'SEI_SUFFIX',
};

const HEVC_PROFILE_NAMES: Record<number, string> = {
  1: 'Main',
  2: 'Main 10',
  3: 'Main Still Picture',
  4: 'Range Extensions',
};

const AVC_PROFILE_NAMES: Record<number, string> = {
  66: 'Baseline',
  77: 'Main',
  88: 'Extended',
  100: 'High',
  110: 'High 10',
  122: 'High 4:2:2',
  244: 'High 4:4:4',
};

const CHROMA_FORMAT_NAMES: Record<number, string> = {
  0: 'Monochrome',
  1: 'yuv420p',
  2: 'yuv422p',
  3: 'yuv444p',
};

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function formatMacDate(secondsSince1904: number): {
  display: string;
  utc?: string;
  isZeroed: boolean;
  anomaly?: string;
} {
  if (!Number.isFinite(secondsSince1904) || secondsSince1904 === 0) {
    return {
      display: '0000:00:00 00:00:00 (dikosongkan)',
      isZeroed: true,
      anomaly: 'dikosongkan',
    };
  }
  const unixSec = secondsSince1904 - EPOCH_1904_TO_1970_SEC;
  const date = new Date(unixSec * 1000);
  if (Number.isNaN(date.getTime())) {
    return {
      display: `Invalid (${secondsSince1904})`,
      isZeroed: false,
      anomaly: 'tanggal tidak valid',
    };
  }
  const iso = date.toISOString();
  const nowPlusDay = Date.now() + 86400000;
  const anomaly = date.getTime() > nowPlusDay ? 'tanggal di masa depan' : undefined;
  return {
    display: iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'),
    utc: iso,
    isZeroed: false,
    anomaly,
  };
}

export async function walkBoxes(
  file: Blob,
  start = 0,
  end = file.size,
  parent = '',
  depth = 0,
  counter = { count: 0 },
): Promise<BoxNode[]> {
  const nodes: BoxNode[] = [];
  if (depth > MAX_WALK_DEPTH || start < 0 || end > file.size || start >= end) {
    return nodes;
  }

  let pos = start;
  while (pos + 8 <= end) {
    if (counter.count >= MAX_BOX_NODES) {
      nodes.push({
        path: `${parent}/_truncated`,
        type: 'WARN',
        offset: pos,
        size: end - pos,
        error: 'box node limit reached',
      });
      break;
    }

    const headerSliceEnd = Math.min(pos + 16, end);
    const headBuf = await file.slice(pos, headerSliceEnd).arrayBuffer();
    if (headBuf.byteLength < 8) break;
    const head = new DataView(headBuf);

    let size = head.getUint32(0);
    const type = readFourCC(head, 4);
    let hdr = 8;

    if (size === 1) {
      if (headBuf.byteLength < 16) {
        nodes.push({ path: `${parent}/${type}`, type, offset: pos, size: end - pos, error: 'truncated 64-bit size' });
        break;
      }
      try {
        const bigSize = head.getBigUint64(8);
        if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) {
          nodes.push({ path: `${parent}/${type}`, type, offset: pos, size: end - pos, error: '64-bit size overflow' });
          break;
        }
        size = Number(bigSize);
        hdr = 16;
      } catch {
        nodes.push({ path: `${parent}/${type}`, type, offset: pos, size: end - pos, error: 'invalid 64-bit size' });
        break;
      }
    } else if (size === 0) {
      size = end - pos;
    }

    const safeType = /^[\x20-\x7e]{4}$/.test(type) ? type : `0x${bytesToHex(new Uint8Array(headBuf, 4, 4))}`;
    const path = `${parent}/${safeType}`;

    if (size < hdr || pos + size > end) {
      nodes.push({
        path,
        type: safeType,
        offset: pos,
        size: Math.min(size, end - pos),
        error: `invalid size (${size} bytes, parent remaining ${end - pos})`,
      });
      break;
    }

    counter.count++;
    const node: BoxNode = { path, type: safeType, offset: pos, size };
    const body = pos + hdr;

    if (CONTAINERS.has(safeType)) {
      node.children = await walkBoxes(file, body, pos + size, path, depth + 1, counter);
    } else if (safeType === 'meta' && body + 4 <= pos + size) {
      const vBuf = await file.slice(body, Math.min(body + 8, pos + size)).arrayBuffer();
      const v = new DataView(vBuf);
      // ISO meta starts with 4-byte version/flags (usually 0); QuickTime meta starts directly with a child box
      const isIsoMeta = v.getUint32(0) === 0;
      const childStart = body + (isIsoMeta ? 4 : 0);
      if (childStart + 8 <= pos + size) {
        node.children = await walkBoxes(file, childStart, pos + size, path, depth + 1, counter);
      }
    }

    nodes.push(node);
    pos += size;
  }

  return nodes;
}

function findBoxesByType(nodes: BoxNode[], type: string): BoxNode[] {
  const result: BoxNode[] = [];
  for (const n of nodes) {
    if (n.type === type) result.push(n);
    if (n.children) result.push(...findBoxesByType(n.children, type));
  }
  return result;
}

function findFirstChild(node: BoxNode, type: string): BoxNode | undefined {
  if (!node.children) return undefined;
  for (const c of node.children) {
    if (c.type === type) return c;
    const found = findFirstChild(c, type);
    if (found) return found;
  }
  return undefined;
}

async function readBoxBytes(file: Blob, node: BoxNode, maxBytes = 16 * 1024 * 1024): Promise<Uint8Array> {
  const len = Math.min(node.size, maxBytes);
  return new Uint8Array(await file.slice(node.offset, node.offset + len).arrayBuffer());
}

function getBoxHeaderSize(bytes: Uint8Array): number {
  if (bytes.length < 8) return 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0) === 1 ? 16 : 8;
}

function removeEmulationPreventionBytes(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i >= 2 && data[i] === 0x03 && data[i - 1] === 0x00 && data[i - 2] === 0x00) {
      continue;
    }
    out.push(data[i]);
  }
  return new Uint8Array(out);
}

function parseSeiPayload(rbsp: Uint8Array, baseOffset?: number): Array<{ uuid: string; text: string; offset?: number }> {
  const results: Array<{ uuid: string; text: string; offset?: number }> = [];
  let p = 0;
  while (p < rbsp.length) {
    // Trailing RBSP stop bit (0x80)
    if (rbsp[p] === 0x80 && p === rbsp.length - 1) break;
    let payloadType = 0;
    while (p < rbsp.length && rbsp[p] === 0xff) {
      payloadType += 255;
      p++;
    }
    if (p >= rbsp.length) break;
    payloadType += rbsp[p++];

    let payloadSize = 0;
    while (p < rbsp.length && rbsp[p] === 0xff) {
      payloadSize += 255;
      p++;
    }
    if (p >= rbsp.length) break;
    payloadSize += rbsp[p++];

    if (p + payloadSize > rbsp.length) {
      // Partial SEI payload at end
      if (payloadType === 5 && rbsp.length - p >= 16) {
        const uuid = bytesToHex(rbsp.subarray(p, p + 16));
        const rawText = decodeLatin1(rbsp.subarray(p + 16));
        const text = rawText.replace(/[\x00\x80]+$/g, '').replace(/\x00/g, '').trim();
        results.push({ uuid, text, offset: baseOffset });
      }
      break;
    }

    if (payloadType === 5 && payloadSize >= 16) {
      const uuid = bytesToHex(rbsp.subarray(p, p + 16));
      const textBytes = rbsp.subarray(p + 16, p + payloadSize);
      const rawText = decodeLatin1(textBytes);
      const text = rawText.replace(/[\x00\x80]+$/g, '').replace(/\x00/g, '').trim();
      results.push({ uuid, text, offset: baseOffset });
    }
    p += payloadSize;
  }
  return results;
}

export function parseHvccPayload(b: Uint8Array): {
  config: Record<string, unknown>;
  nalLengthSize: number;
  nalArrays: HvccNalArray[];
  profileName: string;
  levelStr: string;
  pixelFormat: string;
} {
  if (b.length < 23) {
    return {
      config: { error: 'hvcC truncated' },
      nalLengthSize: 4,
      nalArrays: [],
      profileName: 'Unknown',
      levelStr: 'Unknown',
      pixelFormat: 'Unknown',
    };
  }

  const profileIdc = b[1] & 0x1f;
  const tier = (b[1] >> 5) & 1;
  const compatFlags = bytesToHex(b.subarray(2, 6));
  const levelIdc = b[12];
  const chromaFormat = b[16] & 3;
  const bitDepthLuma = (b[17] & 7) + 8;
  const bitDepthChroma = (b[18] & 7) + 8;
  const temporalLayers = (b[21] >> 3) & 7;
  const nalLengthSize = (b[21] & 3) + 1;
  const numArrays = b[22];

  const nalArrays: HvccNalArray[] = [];
  let p = 23;
  for (let a = 0; a < numArrays && p + 3 <= b.length; a++) {
    const nalType = b[p] & 0x3f;
    const count = (b[p + 1] << 8) | b[p + 2];
    p += 3;
    const lengths: number[] = [];
    for (let i = 0; i < count && p + 2 <= b.length; i++) {
      const len = (b[p] << 8) | b[p + 1];
      p += 2;
      lengths.push(len);
      p += len;
    }
    nalArrays.push({
      nalType,
      nalTypeName: HEVC_NAL_NAMES[nalType] ?? `NAL_${nalType}`,
      count,
      lengths,
    });
  }

  const profileName = HEVC_PROFILE_NAMES[profileIdc] ?? `Profile ${profileIdc}`;
  const levelStr = (levelIdc / 30).toFixed(1);
  const baseChroma = CHROMA_FORMAT_NAMES[chromaFormat] ?? `chroma_${chromaFormat}`;
  const pixelFormat = bitDepthLuma === 8 ? `${baseChroma} 8 bit` : `${baseChroma} ${bitDepthLuma} bit`;

  return {
    config: {
      configurationVersion: b[0],
      profileIdc,
      profileName,
      tier,
      compatFlags,
      levelIdc,
      level: levelStr,
      chromaFormat,
      bitDepthLuma,
      bitDepthChroma,
      temporalLayers,
      nalLengthSize,
      numArrays,
    },
    nalLengthSize,
    nalArrays,
    profileName,
    levelStr,
    pixelFormat,
  };
}

export function parseAvccPayload(b: Uint8Array): {
  config: Record<string, unknown>;
  nalLengthSize: number;
  profileName: string;
  levelStr: string;
} {
  if (b.length < 7) {
    return { config: { error: 'avcC truncated' }, nalLengthSize: 4, profileName: 'Unknown', levelStr: 'Unknown' };
  }
  const profileIdc = b[1];
  const profileCompat = b[2].toString(16).padStart(2, '0');
  const levelIdc = b[3];
  const nalLengthSize = (b[4] & 3) + 1;
  const numSps = b[5] & 0x1f;
  let p = 6;
  const spsLengths: number[] = [];
  for (let i = 0; i < numSps && p + 2 <= b.length; i++) {
    const len = (b[p] << 8) | b[p + 1];
    p += 2 + len;
    spsLengths.push(len);
  }
  let numPps = 0;
  const ppsLengths: number[] = [];
  if (p < b.length) {
    numPps = b[p++];
    for (let i = 0; i < numPps && p + 2 <= b.length; i++) {
      const len = (b[p] << 8) | b[p + 1];
      p += 2 + len;
      ppsLengths.push(len);
    }
  }
  const profileName = AVC_PROFILE_NAMES[profileIdc] ?? `Profile ${profileIdc}`;
  const levelStr = (levelIdc / 10).toFixed(1);
  return {
    config: {
      configurationVersion: b[0],
      profileIdc,
      profileName,
      profileCompat,
      levelIdc,
      level: levelStr,
      nalLengthSize,
      numSps,
      spsLengths,
      numPps,
      ppsLengths,
    },
    nalLengthSize,
    profileName,
    levelStr,
  };
}

function findFourCCOffset(bytes: Uint8Array, fourcc: string, start = 0): number {
  const c0 = fourcc.charCodeAt(0);
  const c1 = fourcc.charCodeAt(1);
  const c2 = fourcc.charCodeAt(2);
  const c3 = fourcc.charCodeAt(3);
  for (let i = Math.max(4, start); i <= bytes.length - 4; i++) {
    if (bytes[i] === c0 && bytes[i + 1] === c1 && bytes[i + 2] === c2 && bytes[i + 3] === c3) {
      const boxSize =
        ((bytes[i - 4] << 24) | (bytes[i - 3] << 16) | (bytes[i - 2] << 8) | bytes[i - 1]) >>> 0;
      if (boxSize >= 8 && i - 4 + boxSize <= bytes.length) {
        return i - 4;
      }
    }
  }
  return -1;
}

function parseColorBox(stsdBytes: Uint8Array): string | undefined {
  const colrPos = findFourCCOffset(stsdBytes, 'colr');
  if (colrPos < 0 || colrPos + 18 > stsdBytes.length) return undefined;
  const view = new DataView(stsdBytes.buffer, stsdBytes.byteOffset + colrPos);
  const colorType = readFourCC(view, 8);
  if (colorType !== 'nclx' && colorType !== 'nclc') return colorType;
  const primaries = view.getUint16(12);
  const transfer = view.getUint16(14);
  const matrix = view.getUint16(16);
  const fullRange = colorType === 'nclx' && colrPos + 19 <= stsdBytes.length ? (stsdBytes[colrPos + 18] & 0x80) !== 0 : false;
  const primaryMap: Record<number, string> = { 1: 'BT.709', 5: 'BT.601 PAL', 6: 'BT.601 NTSC', 9: 'BT.2020', 12: 'Display P3' };
  const name = primaryMap[primaries] ?? `primaries=${primaries}/transfer=${transfer}/matrix=${matrix}`;
  return `${name} ${fullRange ? 'full' : 'limited'}`;
}

function parseAacObjectType(stsdBytes: Uint8Array): string {
  const esdsPos = findFourCCOffset(stsdBytes, 'esds');
  if (esdsPos < 0) return 'AAC';
  const boxSize = new DataView(stsdBytes.buffer, stsdBytes.byteOffset + esdsPos).getUint32(0);
  const esds = stsdBytes.subarray(esdsPos + 12, Math.min(stsdBytes.length, esdsPos + boxSize));
  // Look for DecoderSpecificInfo tag 0x05 inside esds
  for (let i = 0; i < esds.length - 4; i++) {
    if (esds[i] === 0x05) {
      let j = i + 1;
      while (j < esds.length && (esds[j] & 0x80) !== 0) j++;
      j++; // length byte
      if (j < esds.length) {
        const audioObjectType = (esds[j] >> 3) & 0x1f;
        if (audioObjectType === 2) return 'AAC-LC';
        if (audioObjectType === 5) return 'HE-AAC (SBR)';
        if (audioObjectType === 29) return 'HE-AAC v2';
        if (audioObjectType === 1) return 'AAC-Main';
      }
    }
  }
  return 'AAC-LC';
}

export interface Mp4AnalysisOutput {
  structure: BoxNode[];
  tags: TagEntry[];
  technical: VideoInfo;
  bitstream?: BitstreamInfo;
  stats?: VideoStats;
  timeline: TimelineEntry[];
  coverage: CoverageInfo;
}

export async function analyzeMp4(file: Blob): Promise<Mp4AnalysisOutput> {
  const structure = await walkBoxes(file, 0, file.size, '');
  const tags: TagEntry[] = [];
  const timeline: TimelineEntry[] = [];

  // 1) Top-level box accounting & faststart
  let topLevelBoxSum = 0;
  let moovOffset: number | undefined;
  let moovSize: number | undefined;
  let mdatOffset: number | undefined;
  let mdatSize = 0;
  let mdatPayloadOffset: number | undefined;
  let mdatPayloadSize: number | undefined;
  const coverageSegments: Array<{ label: string; offset: number; size: number; colorKey: string }> = [];

  for (const box of structure) {
    if (!box.error) {
      topLevelBoxSum += box.size;
      coverageSegments.push({
        label: box.type,
        offset: box.offset,
        size: box.size,
        colorKey: box.type === 'mdat' ? 'media' : box.type === 'moov' ? 'metadata' : box.type === 'ftyp' ? 'header' : 'other',
      });
    }
    if (box.type === 'moov' && moovOffset === undefined) {
      moovOffset = box.offset;
      moovSize = box.size;
    }
    if (box.type === 'mdat') {
      if (mdatOffset === undefined) {
        mdatOffset = box.offset;
        const mdatHead = new Uint8Array(await file.slice(box.offset, Math.min(box.offset + 16, file.size)).arrayBuffer());
        const hdr = getBoxHeaderSize(mdatHead);
        mdatPayloadOffset = box.offset + hdr;
        mdatPayloadSize = Math.max(0, box.size - hdr);
      }
      mdatSize += box.size;
    }
  }

  const faststart = moovOffset !== undefined && mdatOffset !== undefined && moovOffset < mdatOffset;
  const nonMediaOverheadBytes = Math.max(0, file.size - (mdatPayloadSize ?? mdatSize));
  const nonMediaOverheadPercent = file.size > 0 ? Number(((nonMediaOverheadBytes / file.size) * 100).toFixed(2)) : 0;

  // 2) Parse ftyp
  let majorBrand: string | undefined;
  let minorVersion: number | undefined;
  const compatibleBrands: string[] = [];
  const ftypNode = structure.find((b) => b.type === 'ftyp');
  if (ftypNode && ftypNode.size >= 16) {
    const ftypBytes = await readBoxBytes(file, ftypNode, 4096);
    const hdr = getBoxHeaderSize(ftypBytes);
    if (ftypBytes.length >= hdr + 8) {
      const view = new DataView(ftypBytes.buffer, ftypBytes.byteOffset, ftypBytes.byteLength);
      majorBrand = readFourCC(view, hdr).trim();
      minorVersion = view.getUint32(hdr + 4);
      for (let p = hdr + 8; p + 4 <= ftypBytes.length; p += 4) {
        compatibleBrands.push(readFourCC(view, p).trim());
      }
      tags.push({ ns: 'MP4/ftyp', name: 'MajorBrand', raw: majorBrand, decoded: majorBrand, source: 'mp4-parser', offset: ftypNode.offset });
      tags.push({ ns: 'MP4/ftyp', name: 'MinorVersion', raw: minorVersion, decoded: String(minorVersion), source: 'mp4-parser', offset: ftypNode.offset + hdr + 4 });
      tags.push({ ns: 'MP4/ftyp', name: 'CompatibleBrands', raw: compatibleBrands, decoded: compatibleBrands.join(', '), source: 'mp4-parser', offset: ftypNode.offset + hdr + 8 });
    }
  }

  // 3) Parse mvhd
  let mvhdTimescale = 1000;
  let mvhdDurationSec = 0;
  const mvhdNode = findBoxesByType(structure, 'mvhd')[0];
  if (mvhdNode) {
    const bytes = await readBoxBytes(file, mvhdNode, 4096);
    const hdr = getBoxHeaderSize(bytes);
    if (bytes.length >= hdr + 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const version = bytes[hdr];
      let creation = 0;
      let modification = 0;
      let timescale = 1000;
      let duration = 0;
      if (version === 1 && bytes.length >= hdr + 36) {
        creation = Number(view.getBigUint64(hdr + 4));
        modification = Number(view.getBigUint64(hdr + 12));
        timescale = view.getUint32(hdr + 20);
        duration = Number(view.getBigUint64(hdr + 24));
      } else {
        creation = view.getUint32(hdr + 4);
        modification = view.getUint32(hdr + 8);
        timescale = view.getUint32(hdr + 12);
        duration = view.getUint32(hdr + 16);
      }
      mvhdTimescale = timescale || 1000;
      mvhdDurationSec = timescale > 0 ? duration / timescale : 0;

      const cFmt = formatMacDate(creation);
      const mFmt = formatMacDate(modification);
      tags.push({ ns: 'MP4/mvhd', name: 'CreateDate', raw: creation, decoded: cFmt.display, source: 'mp4-parser', offset: mvhdNode.offset });
      tags.push({ ns: 'MP4/mvhd', name: 'ModifyDate', raw: modification, decoded: mFmt.display, source: 'mp4-parser', offset: mvhdNode.offset });
      tags.push({ ns: 'MP4/mvhd', name: 'TimeScale', raw: timescale, decoded: `${timescale} Hz`, source: 'mp4-parser', offset: mvhdNode.offset });
      tags.push({ ns: 'MP4/mvhd', name: 'Duration', raw: duration, decoded: `${mvhdDurationSec.toFixed(6)} s`, source: 'mp4-parser', offset: mvhdNode.offset });

      timeline.push({ label: 'Movie CreateDate (mvhd)', value: cFmt.display, utc: cFmt.utc, anomaly: cFmt.anomaly, source: 'mvhd', tagRef: 'MP4/mvhd:CreateDate', isZeroed: cFmt.isZeroed });
      timeline.push({ label: 'Movie ModifyDate (mvhd)', value: mFmt.display, utc: mFmt.utc, anomaly: mFmt.anomaly, source: 'mvhd', tagRef: 'MP4/mvhd:ModifyDate', isZeroed: mFmt.isZeroed });
    }
  }

  // 4) Parse QuickTime meta/keys/ilst and iTunes udta/meta/ilst
  const metaNodes = findBoxesByType(structure, 'meta');
  for (const metaNode of metaNodes) {
    const keysNode = findFirstChild(metaNode, 'keys');
    const ilstNode = findFirstChild(metaNode, 'ilst');

    if (keysNode && ilstNode) {
      const keysBytes = await readBoxBytes(file, keysNode, 1024 * 1024);
      const keysHdr = getBoxHeaderSize(keysBytes);
      const keyNames: string[] = [];
      if (keysBytes.length >= keysHdr + 8) {
        const kv = new DataView(keysBytes.buffer, keysBytes.byteOffset, keysBytes.byteLength);
        const entryCount = kv.getUint32(keysHdr + 4);
        let kp = keysHdr + 8;
        for (let i = 0; i < entryCount && kp + 8 <= keysBytes.length; i++) {
          const entrySize = kv.getUint32(kp);
          if (entrySize < 8 || kp + entrySize > keysBytes.length) break;
          const ns = readFourCC(kv, kp + 4);
          const keyStr = decodeUtf8(keysBytes.subarray(kp + 8, kp + entrySize));
          keyNames.push(ns === 'mdta' ? keyStr : `${ns}:${keyStr}`);
          kp += entrySize;
        }
      }

      const ilstBytes = await readBoxBytes(file, ilstNode, 4 * 1024 * 1024);
      const ilstHdr = getBoxHeaderSize(ilstBytes);
      const iv = new DataView(ilstBytes.buffer, ilstBytes.byteOffset, ilstBytes.byteLength);
      let ip = ilstHdr;
      while (ip + 8 <= ilstBytes.length) {
        const itemSize = iv.getUint32(ip);
        const keyIndex = iv.getUint32(ip + 4); // 1-based index into keys
        if (itemSize < 8 || ip + itemSize > ilstBytes.length) break;
        const keyName = keyNames[keyIndex - 1] ?? `key_${keyIndex}`;

        // Parse nested 'data' atom inside item
        let dp = ip + 8;
        while (dp + 8 <= ip + itemSize) {
          const dataSize = iv.getUint32(dp);
          const dataTypeFourCC = readFourCC(iv, dp + 4);
          if (dataSize < 8 || dp + dataSize > ip + itemSize) break;
          if (dataTypeFourCC === 'data' && dataSize >= 16) {
            const typeIndicator = iv.getUint32(dp + 8);
            const valBytes = ilstBytes.subarray(dp + 16, dp + dataSize);
            let decoded = '';
            if (typeIndicator === 1 || typeIndicator === 0) {
              decoded = decodeUtf8(valBytes).replace(/\x00+$/g, '');
            } else if (typeIndicator === 2) {
              decoded = new TextDecoder('utf-16be', { fatal: false }).decode(valBytes);
            } else if (typeIndicator === 21 && valBytes.length <= 4) {
              let num = 0;
              for (const bt of valBytes) num = (num << 8) | bt;
              decoded = String(num);
            } else {
              decoded = decodeUtf8(valBytes).replace(/\x00+$/g, '');
            }
            const cleanKey = keyName.includes('.') ? keyName.split('.').pop() || keyName : keyName;
            tags.push({
              ns: 'Keys',
              name: cleanKey,
              raw: decoded,
              decoded,
              source: 'mp4-keys',
              offset: ilstNode.offset + ip,
            });
          }
          dp += dataSize;
        }
        ip += itemSize;
      }
    } else if (ilstNode && !keysNode) {
      // Standard iTunes ilst atoms (©too, ©nam, ©cmt, etc.)
      const ilstBytes = await readBoxBytes(file, ilstNode, 4 * 1024 * 1024);
      const ilstHdr = getBoxHeaderSize(ilstBytes);
      const iv = new DataView(ilstBytes.buffer, ilstBytes.byteOffset, ilstBytes.byteLength);
      let ip = ilstHdr;
      while (ip + 8 <= ilstBytes.length) {
        const itemSize = iv.getUint32(ip);
        const atomName = readFourCC(iv, ip + 4);
        if (itemSize < 8 || ip + itemSize > ilstBytes.length) break;
        const readableName =
          atomName === '\u00a9too'
            ? 'encoder'
            : atomName === '\u00a9cmt'
              ? 'comment'
              : atomName === '\u00a9nam'
                ? 'title'
                : atomName === '\u00a9day'
                  ? 'date'
                  : atomName === '\u00a9ART'
                    ? 'artist'
                    : atomName;
        let dp = ip + 8;
        while (dp + 8 <= ip + itemSize) {
          const dataSize = iv.getUint32(dp);
          const dataFourCC = readFourCC(iv, dp + 4);
          if (dataSize < 8 || dp + dataSize > ip + itemSize) break;
          if (dataFourCC === 'data' && dataSize >= 16) {
            const val = decodeUtf8(ilstBytes.subarray(dp + 16, dp + dataSize)).replace(/\x00+$/g, '');
            tags.push({
              ns: 'QuickTime/ilst',
              name: readableName,
              raw: val,
              decoded: val,
              source: 'mp4-ilst',
              offset: ilstNode.offset + ip,
            });
          }
          dp += dataSize;
        }
        ip += itemSize;
      }
    }
  }

  // 5) Parse tracks (trak)
  const trakNodes = findBoxesByType(structure, 'trak');
  const tracks: TrackSummary[] = [];
  let bitstream: BitstreamInfo | undefined;
  let stats: VideoStats | undefined;

  let videoDurationSec: number | undefined;
  let audioDurationSec: number | undefined;
  let videoWidth: number | undefined;
  let videoHeight: number | undefined;
  let videoFps: number | undefined;
  let videoCodec: string | undefined;
  let videoProfile: string | undefined;
  let videoLevel: string | undefined;
  let videoPixelFormat: string | undefined;
  let videoColorSpace: string | undefined;
  let videoBitrateBps: number | undefined;
  let bitDensity: number | undefined;

  let audioCodec: string | undefined;
  let audioSampleRate: number | undefined;
  let audioChannels: number | undefined;
  let audioBitrateBps: number | undefined;
  let audioPackets: number | undefined;
  let audioFirstPtsSec: number | undefined;

  let videoStszCount = 0;
  let videoSttsFrameCount = 0;
  let videoStssCount = 0;
  let audioStszCount = 0;
  let audioSttsPacketCount = 0;

  let trackNum = 0;
  for (const trak of trakNodes) {
    trackNum++;
    let trackId = trackNum;
    let handler = 'unkn';
    let trackType: TrackSummary['type'] = 'other';
    let tkhdWidth = 0;
    let tkhdHeight = 0;
    let mdhdTimescale = 1000;
    let mdhdDuration = 0;
    let elstMediaTime: number | undefined;

    // tkhd
    const tkhdNode = findFirstChild(trak, 'tkhd');
    if (tkhdNode) {
      const tb = await readBoxBytes(file, tkhdNode, 1024);
      const hdr = getBoxHeaderSize(tb);
      if (tb.length >= hdr + 84) {
        const tv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
        const ver = tb[hdr];
        let cTime = 0;
        let mTime = 0;
        if (ver === 1 && tb.length >= hdr + 96) {
          cTime = Number(tv.getBigUint64(hdr + 4));
          mTime = Number(tv.getBigUint64(hdr + 12));
          trackId = tv.getUint32(hdr + 20);
          tkhdWidth = tv.getUint32(hdr + 88) / 65536;
          tkhdHeight = tv.getUint32(hdr + 92) / 65536;
        } else {
          cTime = tv.getUint32(hdr + 4);
          mTime = tv.getUint32(hdr + 8);
          trackId = tv.getUint32(hdr + 12);
          tkhdWidth = tv.getUint32(hdr + 76) / 65536;
          tkhdHeight = tv.getUint32(hdr + 80) / 65536;
        }
        const cFmt = formatMacDate(cTime);
        const mFmt = formatMacDate(mTime);
        tags.push({ ns: `MP4/trak${trackId}`, name: 'TrackCreateDate', raw: cTime, decoded: cFmt.display, source: 'mp4-parser', offset: tkhdNode.offset });
        tags.push({ ns: `MP4/trak${trackId}`, name: 'TrackModifyDate', raw: mTime, decoded: mFmt.display, source: 'mp4-parser', offset: tkhdNode.offset });
        timeline.push({ label: `Track ${trackId} CreateDate (tkhd)`, value: cFmt.display, utc: cFmt.utc, anomaly: cFmt.anomaly, source: 'tkhd', tagRef: `MP4/trak${trackId}:TrackCreateDate`, isZeroed: cFmt.isZeroed });
      }
    }

    // elst (edit list)
    const elstNode = findFirstChild(trak, 'elst');
    if (elstNode) {
      const eb = await readBoxBytes(file, elstNode, 4096);
      const hdr = getBoxHeaderSize(eb);
      if (eb.length >= hdr + 8) {
        const ev = new DataView(eb.buffer, eb.byteOffset, eb.byteLength);
        const ver = eb[hdr];
        const count = ev.getUint32(hdr + 4);
        if (count > 0) {
          let p = hdr + 8;
          for (let i = 0; i < count; i++) {
            if (ver === 1 && p + 20 <= eb.length) {
              const mTime = Number(ev.getBigInt64(p + 8));
              if (mTime >= 0 && elstMediaTime === undefined) elstMediaTime = mTime;
              p += 20;
            } else if (ver === 0 && p + 12 <= eb.length) {
              const mTime = ev.getInt32(p + 4);
              if (mTime >= 0 && elstMediaTime === undefined) elstMediaTime = mTime;
              p += 12;
            }
          }
        }
      }
    }

    // hdlr
    const hdlrNode = findFirstChild(trak, 'hdlr');
    if (hdlrNode) {
      const hb = await readBoxBytes(file, hdlrNode, 1024);
      const hdr = getBoxHeaderSize(hb);
      if (hb.length >= hdr + 12) {
        const hv = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
        handler = readFourCC(hv, hdr + 8); // offset +16 from standard 8-byte box start
        if (handler === 'vide') trackType = 'video';
        else if (handler === 'soun') trackType = 'audio';
        else if (handler === 'subt' || handler === 'text' || handler === 'sbtl') trackType = 'subtitle';
      }
    }

    // mdhd
    const mdhdNode = findFirstChild(trak, 'mdhd');
    if (mdhdNode) {
      const mb = await readBoxBytes(file, mdhdNode, 1024);
      const hdr = getBoxHeaderSize(mb);
      if (mb.length >= hdr + 24) {
        const mv = new DataView(mb.buffer, mb.byteOffset, mb.byteLength);
        const ver = mb[hdr];
        let cTime = 0;
        let mTime = 0;
        if (ver === 1 && mb.length >= hdr + 36) {
          cTime = Number(mv.getBigUint64(hdr + 4));
          mTime = Number(mv.getBigUint64(hdr + 12));
          mdhdTimescale = mv.getUint32(hdr + 20) || 1000;
          mdhdDuration = Number(mv.getBigUint64(hdr + 24));
        } else {
          cTime = mv.getUint32(hdr + 4);
          mTime = mv.getUint32(hdr + 8);
          mdhdTimescale = mv.getUint32(hdr + 12) || 1000;
          mdhdDuration = mv.getUint32(hdr + 16);
        }
        const cFmt = formatMacDate(cTime);
        tags.push({ ns: `MP4/trak${trackId}`, name: 'MediaCreateDate', raw: cTime, decoded: cFmt.display, source: 'mp4-parser', offset: mdhdNode.offset });
        tags.push({ ns: `MP4/trak${trackId}`, name: 'MediaModifyDate', raw: mTime, decoded: formatMacDate(mTime).display, source: 'mp4-parser', offset: mdhdNode.offset });
        tags.push({ ns: `MP4/trak${trackId}`, name: 'MediaTimeScale', raw: mdhdTimescale, decoded: `${mdhdTimescale} Hz`, source: 'mp4-parser', offset: mdhdNode.offset });
        timeline.push({ label: `Track ${trackId} (${handler}) MediaCreateDate`, value: cFmt.display, utc: cFmt.utc, anomaly: cFmt.anomaly, source: 'mdhd', tagRef: `MP4/trak${trackId}:MediaCreateDate`, isZeroed: cFmt.isZeroed });
      }
    }

    const trackDurSec = mdhdTimescale > 0 ? mdhdDuration / mdhdTimescale : 0;

    // Sample tables: stsz, stss, stco/co64, stts, ctts
    const sampleSizes: number[] = [];
    let stszSampleCount = 0;
    const stszNode = findFirstChild(trak, 'stsz');
    if (stszNode) {
      const sb = await readBoxBytes(file, stszNode, 16 * 1024 * 1024);
      const hdr = getBoxHeaderSize(sb);
      if (sb.length >= hdr + 12) {
        const sv = new DataView(sb.buffer, sb.byteOffset, sb.byteLength);
        const uniformSize = sv.getUint32(hdr + 4);
        stszSampleCount = sv.getUint32(hdr + 8);
        if (uniformSize > 0) {
          for (let i = 0; i < stszSampleCount; i++) sampleSizes.push(uniformSize);
        } else {
          const available = Math.min(stszSampleCount, Math.floor((sb.length - (hdr + 12)) / 4));
          for (let i = 0; i < available; i++) {
            sampleSizes.push(sv.getUint32(hdr + 12 + i * 4));
          }
        }
      }
    }

    const keyframeIndices: number[] = []; // 1-based
    const stssNode = findFirstChild(trak, 'stss');
    if (stssNode) {
      const sb = await readBoxBytes(file, stssNode, 4 * 1024 * 1024);
      const hdr = getBoxHeaderSize(sb);
      if (sb.length >= hdr + 8) {
        const sv = new DataView(sb.buffer, sb.byteOffset, sb.byteLength);
        const count = sv.getUint32(hdr + 4);
        const available = Math.min(count, Math.floor((sb.length - (hdr + 8)) / 4));
        for (let i = 0; i < available; i++) {
          keyframeIndices.push(sv.getUint32(hdr + 8 + i * 4));
        }
      }
    }

    let firstChunkOffset: number | undefined;
    const stcoNode = findFirstChild(trak, 'stco');
    const co64Node = findFirstChild(trak, 'co64');
    if (stcoNode) {
      const cb = await readBoxBytes(file, stcoNode, 64);
      const hdr = getBoxHeaderSize(cb);
      if (cb.length >= hdr + 12) {
        const cv = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);
        const count = cv.getUint32(hdr + 4);
        if (count > 0) firstChunkOffset = cv.getUint32(hdr + 8);
      }
    } else if (co64Node) {
      const cb = await readBoxBytes(file, co64Node, 64);
      const hdr = getBoxHeaderSize(cb);
      if (cb.length >= hdr + 16) {
        const cv = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);
        const count = cv.getUint32(hdr + 4);
        if (count > 0) firstChunkOffset = Number(cv.getBigUint64(hdr + 8));
      }
    }

    const sttsEntries: Array<{ count: number; delta: number }> = [];
    let sttsTotalSamples = 0;
    const sttsNode = findFirstChild(trak, 'stts');
    if (sttsNode) {
      const tb = await readBoxBytes(file, sttsNode, 8 * 1024 * 1024);
      const hdr = getBoxHeaderSize(tb);
      if (tb.length >= hdr + 8) {
        const tv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
        const entryCount = tv.getUint32(hdr + 4);
        const available = Math.min(entryCount, Math.floor((tb.length - (hdr + 8)) / 8));
        for (let i = 0; i < available; i++) {
          const count = tv.getUint32(hdr + 8 + i * 8);
          const delta = tv.getUint32(hdr + 12 + i * 8);
          sttsEntries.push({ count, delta });
          sttsTotalSamples += count;
        }
      }
    }

    const cttsEntries: Array<{ count: number; offset: number }> = [];
    const cttsNode = findFirstChild(trak, 'ctts');
    if (cttsNode) {
      const cb = await readBoxBytes(file, cttsNode, 8 * 1024 * 1024);
      const hdr = getBoxHeaderSize(cb);
      if (cb.length >= hdr + 8) {
        const cv = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);
        const ver = cb[hdr];
        const entryCount = cv.getUint32(hdr + 4);
        const available = Math.min(entryCount, Math.floor((cb.length - (hdr + 8)) / 8));
        for (let i = 0; i < available; i++) {
          const count = cv.getUint32(hdr + 8 + i * 8);
          const off = ver === 1 ? cv.getInt32(hdr + 12 + i * 8) : cv.getUint32(hdr + 12 + i * 8);
          cttsEntries.push({ count, offset: off });
        }
      }
    }

    // stsd (codec details, dimensions, sample rate, hvcC / avcC)
    let codecFourCC = 'unknown';
    let codecLabel = 'Unknown';
    let stsdWidth = Math.round(tkhdWidth);
    let stsdHeight = Math.round(tkhdHeight);
    let trackSampleRate: number | undefined;
    let trackChannels: number | undefined;
    let trackColorSpace: string | undefined;
    let trackPixelFormat: string | undefined;

    const stsdNode = findFirstChild(trak, 'stsd');
    if (stsdNode) {
      const sb = await readBoxBytes(file, stsdNode, 256 * 1024);
      const hdr = getBoxHeaderSize(sb);
      if (sb.length >= hdr + 16) {
        const sv = new DataView(sb.buffer, sb.byteOffset, sb.byteLength);
        const entryStart = hdr + 8;
        codecFourCC = readFourCC(sv, entryStart + 4);
        codecLabel = codecFourCC;

        if (trackType === 'video') {
          if (sb.length >= entryStart + 36) {
            const w = sv.getUint16(entryStart + 32);
            const h = sv.getUint16(entryStart + 34);
            if (w > 0 && h > 0) {
              stsdWidth = w;
              stsdHeight = h;
            }
          }
          trackColorSpace = parseColorBox(sb);

          // Check hvcC (HEVC)
          const hvccPos = findFourCCOffset(sb, 'hvcC', entryStart);
          if (hvccPos >= 0) {
            const hvccSize = sv.getUint32(hvccPos);
            const hvccPayload = sb.subarray(hvccPos + 8, Math.min(sb.length, hvccPos + hvccSize));
            const parsedHvcc = parseHvccPayload(hvccPayload);
            codecLabel = `HEVC ${parsedHvcc.profileName}`;
            videoCodec = 'HEVC';
            videoProfile = parsedHvcc.profileName;
            videoLevel = parsedHvcc.levelStr;
            trackPixelFormat = parsedHvcc.pixelFormat;

            // Parse first video sample NALs + SEI
            const firstSampleNals: number[] = [];
            const seiUserData: Array<{ uuid: string; text: string; offset?: number }> = [];
            if (firstChunkOffset !== undefined && sampleSizes.length > 0 && sampleSizes[0] > 0) {
              const s0Size = Math.min(sampleSizes[0], 4 * 1024 * 1024);
              const s0Bytes = new Uint8Array(
                await file.slice(firstChunkOffset, Math.min(file.size, firstChunkOffset + s0Size)).arrayBuffer(),
              );
              const nalLenSize = parsedHvcc.nalLengthSize;
              let sp = 0;
              while (sp + nalLenSize <= s0Bytes.length) {
                let nalLen = 0;
                for (let k = 0; k < nalLenSize; k++) {
                  nalLen = nalLen * 256 + s0Bytes[sp + k];
                }
                sp += nalLenSize;
                if (nalLen <= 0 || sp + nalLen > s0Bytes.length) break;
                const nalType = (s0Bytes[sp] >> 1) & 0x3f;
                firstSampleNals.push(nalType);
                if ((nalType === 39 || nalType === 40) && nalLen > 2) {
                  const rbsp = removeEmulationPreventionBytes(s0Bytes.subarray(sp + 2, sp + nalLen));
                  const foundSei = parseSeiPayload(rbsp, firstChunkOffset + sp);
                  seiUserData.push(...foundSei);
                }
                sp += nalLen;
              }
            }

            bitstream = {
              codec: 'hevc',
              config: parsedHvcc.config,
              firstSampleNals,
              seiUserData,
              nalArrays: parsedHvcc.nalArrays,
            };
          } else {
            // Check avcC (H.264)
            const avccPos = findFourCCOffset(sb, 'avcC', entryStart);
            if (avccPos >= 0) {
              const avccSize = sv.getUint32(avccPos);
              const avccPayload = sb.subarray(avccPos + 8, Math.min(sb.length, avccPos + avccSize));
              const parsedAvcc = parseAvccPayload(avccPayload);
              codecLabel = `H.264 ${parsedAvcc.profileName}`;
              videoCodec = 'H.264/AVC';
              videoProfile = parsedAvcc.profileName;
              videoLevel = parsedAvcc.levelStr;

              const firstSampleNals: number[] = [];
              const seiUserData: Array<{ uuid: string; text: string; offset?: number }> = [];
              if (firstChunkOffset !== undefined && sampleSizes.length > 0 && sampleSizes[0] > 0) {
                const s0Size = Math.min(sampleSizes[0], 4 * 1024 * 1024);
                const s0Bytes = new Uint8Array(
                  await file.slice(firstChunkOffset, Math.min(file.size, firstChunkOffset + s0Size)).arrayBuffer(),
                );
                const nalLenSize = parsedAvcc.nalLengthSize;
                let sp = 0;
                while (sp + nalLenSize <= s0Bytes.length) {
                  let nalLen = 0;
                  for (let k = 0; k < nalLenSize; k++) {
                    nalLen = nalLen * 256 + s0Bytes[sp + k];
                  }
                  sp += nalLenSize;
                  if (nalLen <= 0 || sp + nalLen > s0Bytes.length) break;
                  const nalType = s0Bytes[sp] & 0x1f;
                  firstSampleNals.push(nalType);
                  if (nalType === 6 && nalLen > 1) {
                    const rbsp = removeEmulationPreventionBytes(s0Bytes.subarray(sp + 1, sp + nalLen));
                    seiUserData.push(...parseSeiPayload(rbsp, firstChunkOffset + sp));
                  }
                  sp += nalLen;
                }
              }

              bitstream = {
                codec: 'avc',
                config: parsedAvcc.config,
                firstSampleNals,
                seiUserData,
              };
            }
          }
        } else if (trackType === 'audio') {
          if (sb.length >= entryStart + 36) {
            trackChannels = sv.getUint16(entryStart + 24);
            trackSampleRate = sv.getUint32(entryStart + 32) / 65536;
          }
          if (codecFourCC === 'mp4a') {
            codecLabel = parseAacObjectType(sb);
          }
        }
      }
    }

    const totalSampleBytes = sampleSizes.reduce((acc, s) => acc + s, 0);
    const bitrateBps = trackDurSec > 0 ? Math.round((totalSampleBytes * 8) / trackDurSec) : undefined;

    if (trackType === 'video') {
      videoStszCount = stszSampleCount;
      videoSttsFrameCount = sttsTotalSamples;
      videoStssCount = keyframeIndices.length;
      videoDurationSec = trackDurSec;
      videoWidth = stsdWidth;
      videoHeight = stsdHeight;
      videoFps = trackDurSec > 0 && stszSampleCount > 0 ? Number((stszSampleCount / trackDurSec).toFixed(3)) : undefined;
      videoColorSpace = trackColorSpace;
      videoPixelFormat = trackPixelFormat;
      videoBitrateBps = bitrateBps;
      if (bitrateBps && stsdWidth > 0 && stsdHeight > 0 && videoFps && videoFps > 0) {
        bitDensity = Number((bitrateBps / (stsdWidth * stsdHeight * videoFps)).toFixed(4));
      }

      // Compute DTS/PTS per sample for keyframes, GOPs, and per-second bitrate
      const totalFrames = sampleSizes.length;
      if (totalFrames > 0 && mdhdTimescale > 0) {
        const dtsArr = new Float64Array(totalFrames);
        let curDts = 0;
        let idx = 0;
        for (const entry of sttsEntries) {
          for (let k = 0; k < entry.count && idx < totalFrames; k++) {
            dtsArr[idx++] = curDts;
            curDts += entry.delta;
          }
        }

        const ptsArr = new Float64Array(totalFrames);
        if (cttsEntries.length > 0) {
          let cIdx = 0;
          for (const entry of cttsEntries) {
            for (let k = 0; k < entry.count && cIdx < totalFrames; k++) {
              ptsArr[cIdx] = dtsArr[cIdx] + entry.offset;
              cIdx++;
            }
          }
          for (; cIdx < totalFrames; cIdx++) ptsArr[cIdx] = dtsArr[cIdx];
        } else {
          ptsArr.set(dtsArr);
        }

        // Apply edit-list mediaTime or normalize min PTS to 0
        let minPts = ptsArr[0];
        for (let i = 1; i < totalFrames; i++) {
          if (ptsArr[i] < minPts) minPts = ptsArr[i];
        }
        const ptsBase = elstMediaTime !== undefined ? elstMediaTime : minPts;

        const keyframeTimes: number[] = [];
        const keyframeFrames: number[] = [];
        const kfList = keyframeIndices.length > 0 ? keyframeIndices : [1];
        for (const kf1Based of kfList) {
          const i = kf1Based - 1;
          if (i >= 0 && i < totalFrames) {
            keyframeFrames.push(kf1Based);
            const tSec = Math.max(0, (ptsArr[i] - ptsBase) / mdhdTimescale);
            keyframeTimes.push(Number(tSec.toFixed(2)));
          }
        }

        const gopGaps: number[] = [];
        let maxGopFrames = 0;
        let maxGopSec = 0;
        for (let i = 1; i < keyframeTimes.length; i++) {
          const gapSec = Number((keyframeTimes[i] - keyframeTimes[i - 1]).toFixed(2));
          gopGaps.push(gapSec);
          if (gapSec > maxGopSec) maxGopSec = gapSec;
          const gapFrames = keyframeFrames[i] - keyframeFrames[i - 1];
          if (gapFrames > maxGopFrames) maxGopFrames = gapFrames;
        }

        // Bitrate per full second (PTS-based, dropping partial final second)
        const fullSecondsCount = Math.floor(trackDurSec);
        const bytesPerSec = new Map<number, number>();
        for (let i = 0; i < totalFrames; i++) {
          const sec = Math.floor(Math.max(0, (ptsArr[i] - ptsBase) / mdhdTimescale));
          bytesPerSec.set(sec, (bytesPerSec.get(sec) ?? 0) + sampleSizes[i]);
        }

        const fullSeries: Array<{ second: number; kbps: number }> = [];
        const valuesForStats: number[] = [];
        const limitSec = fullSecondsCount > 0 ? fullSecondsCount : Math.max(1, bytesPerSec.size);
        for (let s = 0; s < limitSec; s++) {
          const kbps = ((bytesPerSec.get(s) ?? 0) * 8) / 1000;
          fullSeries.push({ second: s, kbps: Number(kbps.toFixed(1)) });
          valuesForStats.push(kbps);
        }

        const sorted = [...valuesForStats].sort((a, b) => a - b);
        const mean = valuesForStats.length > 0 ? valuesForStats.reduce((a, b) => a + b, 0) / valuesForStats.length : 0;
        const median =
          sorted.length === 0
            ? 0
            : sorted.length % 2 === 1
              ? sorted[Math.floor(sorted.length / 2)]
              : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        const min = sorted.length > 0 ? sorted[0] : 0;
        const max = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
        const variance =
          valuesForStats.length > 0
            ? valuesForStats.reduce((acc, v) => acc + (v - mean) ** 2, 0) / valuesForStats.length
            : 0;
        const stdev = Math.sqrt(variance);

        stats = {
          frames: stszSampleCount,
          keyframes: keyframeIndices.length,
          keyframeTimes,
          keyframeFrames,
          gopGaps,
          maxGopFrames,
          maxGopSec,
          kbpsPerSecond: {
            mean: Math.round(mean),
            median: Math.round(median),
            min: Math.round(min),
            max: Math.round(max),
            stdev: Math.round(stdev),
            fullSeconds: fullSeries.length,
            series: fullSeries,
          },
        };
      }
    } else if (trackType === 'audio') {
      audioStszCount = stszSampleCount;
      audioSttsPacketCount = sttsTotalSamples;
      audioDurationSec = trackDurSec;
      audioCodec = codecLabel;
      audioSampleRate = trackSampleRate ? Math.round(trackSampleRate) : mdhdTimescale;
      audioChannels = trackChannels;
      audioBitrateBps = bitrateBps;
      audioPackets = stszSampleCount;
      if (elstMediaTime !== undefined && elstMediaTime > 0 && mdhdTimescale > 0) {
        audioFirstPtsSec = Number((-elstMediaTime / mdhdTimescale).toFixed(5));
      } else {
        audioFirstPtsSec = 0;
      }
    }

    tracks.push({
      id: trackId,
      type: trackType,
      handler,
      codec: codecLabel,
      codecDetail: codecFourCC,
      timescale: mdhdTimescale,
      durationSec: Number(trackDurSec.toFixed(6)),
      sampleCount: stszSampleCount,
      keyframeCount: trackType === 'video' ? keyframeIndices.length : undefined,
      width: trackType === 'video' ? stsdWidth : undefined,
      height: trackType === 'video' ? stsdHeight : undefined,
      fps: trackType === 'video' ? videoFps : undefined,
      bitrateBps,
      sampleRate: trackType === 'audio' ? audioSampleRate : undefined,
      channels: trackType === 'audio' ? audioChannels : undefined,
      firstPacketPtsSec: trackType === 'audio' ? audioFirstPtsSec : undefined,
      colorInfo: trackColorSpace,
      pixelFormat: trackPixelFormat,
    });
  }

  // Compute unexplained byte ranges
  const unexplained: Array<{ offset: number; size: number }> = [];
  if (topLevelBoxSum < file.size) {
    unexplained.push({ offset: topLevelBoxSum, size: file.size - topLevelBoxSum });
  }

  const technical: VideoInfo = {
    container: majorBrand === 'qt' ? 'QuickTime MOV' : 'MP4',
    majorBrand,
    minorVersion,
    compatibleBrands,
    durationSec: Number(mvhdDurationSec.toFixed(6)),
    videoDurationSec: videoDurationSec !== undefined ? Number(videoDurationSec.toFixed(6)) : undefined,
    audioDurationSec: audioDurationSec !== undefined ? Number(audioDurationSec.toFixed(6)) : undefined,
    width: videoWidth,
    height: videoHeight,
    fps: videoFps,
    codec: videoCodec,
    profile: videoProfile,
    level: videoLevel,
    pixelFormat: videoPixelFormat,
    colorSpace: videoColorSpace,
    videoBitrateBps,
    bitDensity,
    audioCodec,
    audioSampleRate,
    audioChannels,
    audioBitrateBps,
    audioPackets,
    audioFirstPtsSec,
    faststart,
    nonMediaOverheadBytes,
    nonMediaOverheadPercent,
    tracks,
    mp4Integrity: {
      videoStszCount,
      videoSttsFrameCount,
      videoStssCount,
      audioStszCount,
      audioSttsPacketCount,
      topLevelBoxSum,
      moovOffset,
      mdatOffset,
      mdatPayloadOffset,
      mdatPayloadSize,
      moovSize,
    },
  };

  return {
    structure,
    tags,
    technical,
    bitstream,
    stats,
    timeline,
    coverage: {
      mapped: true,
      explainedBytes: Math.min(topLevelBoxSum, file.size),
      totalBytes: file.size,
      unexplained,
      segments: coverageSegments,
    },
  };
}
