import { parseBlob } from 'music-metadata';
import type { AudioInfo, BoxNode, CoverageInfo, TagEntry, TimelineEntry } from './types';

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

function decodeAscii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

async function walkAudioStructure(file: Blob, detectedType: string): Promise<{ nodes: BoxNode[]; coverage: CoverageInfo }> {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
  const nodes: BoxNode[] = [];
  const segments: Array<{ label: string; offset: number; size: number; colorKey: string }> = [];

  if (detectedType === 'WAV' && head.length >= 12) {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    nodes.push({ path: '/RIFF_WAVE', type: 'RIFF', offset: 0, size: 12, detail: 'RIFF WAVE Header' });
    segments.push({ label: 'RIFF', offset: 0, size: 12, colorKey: 'header' });
    let pos = 12;
    let explained = 12;
    while (pos + 8 <= file.size) {
      const hdr = new Uint8Array(await file.slice(pos, Math.min(pos + 8, file.size)).arrayBuffer());
      if (hdr.length < 8) break;
      const dv = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
      const id = decodeAscii(hdr, 0, 4);
      const sz = dv.getUint32(4, true);
      const padded = sz + (sz % 2);
      if (pos + 8 + sz > file.size) {
        nodes.push({ path: `/${id}`, type: id, offset: pos, size: file.size - pos, error: 'truncated WAV chunk' });
        break;
      }
      nodes.push({ path: `/${id}`, type: id, offset: pos, size: 8 + padded });
      segments.push({ label: id, offset: pos, size: 8 + padded, colorKey: id === 'data' ? 'media' : 'metadata' });
      explained += 8 + padded;
      pos += 8 + padded;
      if (nodes.length > 200) break;
    }
    return {
      nodes,
      coverage: {
        mapped: true,
        explainedBytes: Math.min(explained, file.size),
        totalBytes: file.size,
        unexplained: explained < file.size ? [{ offset: explained, size: file.size - explained }] : [],
        segments,
      },
    };
  }

  if (detectedType === 'MP3' && head.length >= 10 && decodeAscii(head, 0, 3) === 'ID3') {
    // Synchsafe 28-bit ID3v2 size
    const id3Size =
      ((head[6] & 0x7f) << 21) |
      ((head[7] & 0x7f) << 14) |
      ((head[8] & 0x7f) << 7) |
      (head[9] & 0x7f);
    const totalId3 = 10 + id3Size;
    nodes.push({ path: '/ID3v2', type: 'ID3v2', offset: 0, size: Math.min(totalId3, file.size), detail: `ID3v2.${head[3]}.${head[4]}` });
    segments.push({ label: 'ID3v2', offset: 0, size: Math.min(totalId3, file.size), colorKey: 'metadata' });
    if (totalId3 < file.size) {
      nodes.push({ path: '/MPEG_FRAMES', type: 'AUDIO', offset: totalId3, size: file.size - totalId3 });
      segments.push({ label: 'MPEG Frames', offset: totalId3, size: file.size - totalId3, colorKey: 'media' });
    }
    return {
      nodes,
      coverage: { mapped: true, explainedBytes: file.size, totalBytes: file.size, unexplained: [], segments },
    };
  }

  if (detectedType === 'FLAC' && head.length >= 8 && decodeAscii(head, 0, 4) === 'fLaC') {
    nodes.push({ path: '/FLAC_SIG', type: 'SIG', offset: 0, size: 4 });
    let pos = 4;
    let isLast = false;
    const blockNames: Record<number, string> = {
      0: 'STREAMINFO',
      1: 'PADDING',
      2: 'APPLICATION',
      3: 'SEEKTABLE',
      4: 'VORBIS_COMMENT',
      5: 'CUESHEET',
      6: 'PICTURE',
    };
    while (!isLast && pos + 4 <= head.length) {
      const flagByte = head[pos];
      isLast = (flagByte & 0x80) !== 0;
      const bType = flagByte & 0x7f;
      const bLen = (head[pos + 1] << 16) | (head[pos + 2] << 8) | head[pos + 3];
      const name = blockNames[bType] ?? `BLOCK_${bType}`;
      nodes.push({ path: `/${name}`, type: name, offset: pos, size: 4 + bLen });
      segments.push({ label: name, offset: pos, size: 4 + bLen, colorKey: 'metadata' });
      pos += 4 + bLen;
    }
    if (pos < file.size) {
      nodes.push({ path: '/FLAC_FRAMES', type: 'AUDIO', offset: pos, size: file.size - pos });
      segments.push({ label: 'Audio Frames', offset: pos, size: file.size - pos, colorKey: 'media' });
    }
    return {
      nodes,
      coverage: { mapped: true, explainedBytes: file.size, totalBytes: file.size, unexplained: [], segments },
    };
  }

  return {
    nodes,
    coverage: { mapped: false, explainedBytes: 0, totalBytes: file.size, unexplained: [{ offset: 0, size: file.size }] },
  };
}

export interface AudioAnalysisOutput {
  structure: BoxNode[];
  tags: TagEntry[];
  technical: AudioInfo;
  timeline: TimelineEntry[];
  coverage: CoverageInfo;
}

export async function analyzeAudio(file: Blob, detectedType: string): Promise<AudioAnalysisOutput> {
  const { nodes: structure, coverage } = await walkAudioStructure(file, detectedType);
  const tags: TagEntry[] = [];
  const timeline: TimelineEntry[] = [];
  const audioInfo: AudioInfo = { format: detectedType };

  const metadata = await parseBlob(file, { duration: true, skipCovers: false });
  const { format, common, native } = metadata;

  audioInfo.codec = format.codec ?? format.container ?? detectedType;
  audioInfo.durationSec = format.duration !== undefined ? Number(format.duration.toFixed(3)) : undefined;
  audioInfo.bitrateBps = format.bitrate !== undefined ? Math.round(format.bitrate) : undefined;
  audioInfo.sampleRate = format.sampleRate;
  audioInfo.channels = format.numberOfChannels;
  audioInfo.bitsPerSample = format.bitsPerSample;
  audioInfo.encoder = common.encodedby || format.tool;

  // ReplayGain
  const rg: Record<string, string | number> = {};
  if (common.replaygain_track_gain?.dB !== undefined) rg.trackGain = `${common.replaygain_track_gain.dB} dB`;
  if (common.replaygain_album_gain?.dB !== undefined) rg.albumGain = `${common.replaygain_album_gain.dB} dB`;
  if (common.replaygain_track_peak?.ratio !== undefined) rg.trackPeak = common.replaygain_track_peak.ratio;
  if (Object.keys(rg).length > 0) audioInfo.replayGain = rg;

  // Cover art
  if (common.picture && common.picture.length > 0) {
    audioInfo.coverArt = common.picture.map((pic) => ({
      mimeType: pic.format || 'image/jpeg',
      size: pic.data.byteLength,
      description: pic.description || pic.type,
      dataUrl: bytesToBase64DataUrl(new Uint8Array(pic.data), pic.format || 'image/jpeg'),
    }));
    tags.push({
      ns: 'Audio/Cover',
      name: 'EmbeddedPictureCount',
      raw: common.picture.length,
      decoded: `${common.picture.length} gambar sampul`,
      source: 'music-metadata',
    });
  }

  // Common tags
  const commonPairs: Array<[string, unknown]> = [
    ['Title', common.title],
    ['Artist', common.artist],
    ['Album', common.album],
    ['AlbumArtist', common.albumartist],
    ['Year', common.year],
    ['Date', common.date],
    ['Genre', common.genre?.join(', ')],
    ['EncodedBy', common.encodedby],
    ['EncoderSettings', common.encodersettings],
    ['Comment', common.comment?.map((c) => (typeof c === 'string' ? c : c.text)).filter(Boolean).join('; ')],
    ['Copyright', common.copyright],
    ['ISRC', common.isrc?.join(', ')],
  ];
  for (const [name, val] of commonPairs) {
    if (val !== undefined && val !== '') {
      tags.push({ ns: 'Audio/Common', name, raw: val, decoded: String(val), source: 'music-metadata' });
      if (name === 'Date' && typeof val === 'string') {
        const dt = new Date(val);
        timeline.push({
          label: 'Audio Date',
          value: val,
          utc: !Number.isNaN(dt.getTime()) ? dt.toISOString() : undefined,
          source: 'music-metadata',
          tagRef: 'Audio/Common:Date',
        });
      }
    }
  }

  // Native tags (ID3v1, ID3v2, Vorbis, APE, etc.) — keep ALL including unknown tags!
  for (const [nativeType, list] of Object.entries(native)) {
    for (const item of list) {
      if (item.id === 'APIC' || item.id === 'PIC' || item.id === 'METADATA_BLOCK_PICTURE') {
        tags.push({ ns: `Audio/${nativeType}`, name: item.id, raw: '<cover art binary>', decoded: '<embedded cover art>', source: 'music-metadata' });
        continue;
      }
      const valStr = typeof item.value === 'object' && item.value !== null ? JSON.stringify(item.value) : String(item.value ?? '');
      tags.push({
        ns: `Audio/${nativeType}`,
        name: item.id,
        raw: item.value,
        decoded: valStr,
        source: 'music-metadata',
      });
    }
  }

  return { structure, tags, technical: audioInfo, timeline, coverage };
}
