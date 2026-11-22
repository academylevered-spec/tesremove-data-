import { strToU8, zipSync } from 'fflate';
import { crc32 } from './image';

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function u16be(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, false);
  return b;
}

function asciiBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function mp4Box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const body = concatBytes(...payloads);
  return concatBytes(u32be(8 + body.length), asciiBytes(type), body);
}

function fullBox(type: string, version: number, flags: number, ...payloads: Uint8Array[]): Uint8Array {
  const vf = new Uint8Array(4);
  vf[0] = version & 0xff;
  vf[1] = (flags >> 16) & 0xff;
  vf[2] = (flags >> 8) & 0xff;
  vf[3] = flags & 0xff;
  return mp4Box(type, vf, ...payloads);
}

/**
 * Builds a deterministic, structurally accurate MP4 (HEVC Main Level 4.0 + AAC-LC)
 * matching all structural patterns, hvcC arrays, SEI ByteVC1-v1.10.0.4, QuickTime Keys,
 * zeroed dates, faststart layout, 10 keyframes, and 4/4 cross-checks from Lampiran A.
 */
export function buildSampleMp4(): { name: string; bytes: Uint8Array; mime: string } {
  const videoFrames = 1418;
  const audioPackets = 2038;
  const videoTimescale = 15360;
  const frameDelta = 512; // 15360 / 512 = 30 fps
  const audioTimescale = 44100;
  const audioDelta = 1024;
  const keyframeFrames1Based = [1, 257, 399, 562, 600, 856, 1112, 1153, 1282, 1351];

  // Build first sample NAL units: 32 (VPS 28B), 33 (SPS 64B), 34 (PPS 7B), 39 (SEI ByteVC1), 19 (IDR_W_RADL)
  const makeHevcNal = (nalType: number, body: Uint8Array): Uint8Array => {
    const hdr = new Uint8Array([(nalType << 1) & 0x7e, 0x01]);
    const nal = concatBytes(hdr, body);
    return concatBytes(u32be(nal.length), nal);
  };

  const seiUuid = hexToBytes('2ca2de09b51747dbbb55a4fe7fc2fc4e');
  const seiText = asciiBytes('ByteVC1-v1.10.0.4');
  const seiPayloadSize = seiUuid.length + seiText.length; // 33
  const seiRbsp = concatBytes(new Uint8Array([5, seiPayloadSize]), seiUuid, seiText, new Uint8Array([0x80]));

  const firstSampleData = concatBytes(
    makeHevcNal(32, new Uint8Array(26)),
    makeHevcNal(33, new Uint8Array(62)),
    makeHevcNal(34, new Uint8Array(5)),
    makeHevcNal(39, seiRbsp),
    makeHevcNal(19, new Uint8Array(1200)),
  );

  // Build hvcC payload (profile_idc=1, tier=0, compat=60000000, level_idc=120, chroma=1, bitDepth=8, temporalLayers=2, nalLen=4, 4 arrays)
  const hvccHeader = new Uint8Array(23);
  hvccHeader[0] = 1; // configurationVersion
  hvccHeader[1] = 1; // tier=0, profile_idc=1 (Main)
  hvccHeader.set(hexToBytes('60000000'), 2);
  hvccHeader[12] = 120; // Level 4.0
  hvccHeader[16] = 0xfc | 1; // chromaFormat = 1 (4:2:0)
  hvccHeader[17] = 0xf8 | 0; // bitDepthLuma = 8
  hvccHeader[18] = 0xf8 | 0; // bitDepthChroma = 8
  hvccHeader[21] = (2 << 3) | 3; // temporalLayers=2, nalLengthSize = 3+1 = 4
  hvccHeader[22] = 4; // numArrays = 4

  const makeHvccArray = (nalType: number, len: number): Uint8Array =>
    concatBytes(new Uint8Array([0x80 | nalType, 0x00, 0x01]), u16be(len), new Uint8Array(len));

  const hvccBox = mp4Box(
    'hvcC',
    hvccHeader,
    makeHvccArray(32, 28),
    makeHvccArray(33, 64),
    makeHvccArray(34, 7),
    makeHvccArray(39, 39),
  );

  const colrBox = mp4Box('colr', asciiBytes('nclx'), u16be(1), u16be(1), u16be(1), new Uint8Array([0x00]));

  // hvc1 VisualSampleEntry (78 bytes header + hvcC + colr)
  const hvc1Head = new Uint8Array(78);
  const hv = new DataView(hvc1Head.buffer);
  hv.setUint16(6, 1, false); // data_reference_index
  hv.setUint16(24, 720, false); // width
  hv.setUint16(26, 1280, false); // height
  const hvc1Box = mp4Box('hvc1', hvc1Head, hvccBox, colrBox);
  const videoStsd = fullBox('stsd', 0, 0, u32be(1), hvc1Box);

  // Video stts, stsz, stss
  const videoStts = fullBox('stts', 0, 0, u32be(1), u32be(videoFrames), u32be(frameDelta));
  const videoSampleSizes = new Uint8Array(videoFrames * 4);
  const vszView = new DataView(videoSampleSizes.buffer);
  vszView.setUint32(0, firstSampleData.length, false);
  for (let i = 1; i < videoFrames; i++) {
    // Realistic varying frame sizes (~5080 bytes/frame => ~1220 kbps at 30fps)
    const sz = 4000 + ((i * 733) % 2400);
    vszView.setUint32(i * 4, sz, false);
  }
  const videoStsz = fullBox('stsz', 0, 0, u32be(0), u32be(videoFrames), videoSampleSizes);
  const videoStssBody = new Uint8Array(keyframeFrames1Based.length * 4);
  const stssView = new DataView(videoStssBody.buffer);
  keyframeFrames1Based.forEach((f, i) => stssView.setUint32(i * 4, f, false));
  const videoStss = fullBox('stss', 0, 0, u32be(keyframeFrames1Based.length), videoStssBody);

  // Audio track (mp4a + esds AAC-LC + stts + stsz)
  const esdsBox = fullBox('esds', 0, 0, new Uint8Array([0x03, 0x19, 0x00, 0x02, 0x00, 0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00, 0x00, 0x01, 0xf4, 0x00, 0x00, 0x01, 0xf4, 0x00, 0x05, 0x02, 0x12, 0x10]));
  const mp4aHead = new Uint8Array(28);
  const av = new DataView(mp4aHead.buffer);
  av.setUint16(6, 1, false);
  av.setUint16(16, 2, false); // stereo
  av.setUint32(24, audioTimescale * 65536, false);
  const audioStsd = fullBox('stsd', 0, 0, u32be(1), mp4Box('mp4a', mp4aHead, esdsBox));
  const audioStts = fullBox('stts', 0, 0, u32be(1), u32be(audioPackets), u32be(audioDelta));
  const audioStsz = fullBox('stsz', 0, 0, u32be(372), u32be(audioPackets));

  // QuickTime meta/keys/ilst
  const keyDefs = [
    ['aigc_info', '{"aigc_label_type":0}'],
    ['comment', 'vid:v1c044g50000dambobnog65qtvdvv6fg'],
    ['vid_md5', '0941e508f60083e629cd249271199c7f'],
    ['encoder', 'Lavf58.76.100'],
  ];
  const keyEntries = keyDefs.map(([k]) => {
    const kb = asciiBytes(k);
    return concatBytes(u32be(8 + kb.length), asciiBytes('mdta'), kb);
  });
  const keysBox = fullBox('keys', 0, 0, u32be(keyDefs.length), ...keyEntries);
  const ilstItems = keyDefs.map(([, v], idx) => {
    const vb = asciiBytes(v);
    const dataBox = mp4Box('data', u32be(1), u32be(0), vb);
    return concatBytes(u32be(8 + dataBox.length), u32be(idx + 1), dataBox);
  });
  const ilstBox = mp4Box('ilst', ...ilstItems);
  const hdlrMdta = fullBox('hdlr', 0, 0, u32be(0), asciiBytes('mdta'), new Uint8Array(12));
  const metaBox = fullBox('meta', 0, 0, hdlrMdta, keysBox, ilstBox);

  // Build mvhd, tkhd, mdhd (all dates 0 => "dikosongkan")
  const mvhdBody = new Uint8Array(96);
  const mvhdV = new DataView(mvhdBody.buffer);
  mvhdV.setUint32(8, 1000, false); // timescale
  mvhdV.setUint32(12, 47274, false); // duration 47.274 s
  const mvhd = fullBox('mvhd', 0, 0, mvhdBody);

  const makeTkhd = (id: number, durMs: number, w: number, h: number) => {
    const b = new Uint8Array(80);
    const v = new DataView(b.buffer);
    v.setUint32(8, id, false);
    v.setUint32(16, durMs, false);
    v.setUint32(72, w * 65536, false);
    v.setUint32(76, h * 65536, false);
    return fullBox('tkhd', 0, 3, b);
  };

  const makeMdhd = (ts: number, dur: number) => {
    const b = new Uint8Array(20);
    const v = new DataView(b.buffer);
    v.setUint32(8, ts, false);
    v.setUint32(12, dur, false);
    return fullBox('mdhd', 0, 0, b);
  };

  const makeHdlr = (h: string) => fullBox('hdlr', 0, 0, u32be(0), asciiBytes(h), new Uint8Array(12));

  // Audio elst with media_time = 2048 => -0.04644 s priming offset
  const audioElst = fullBox('elst', 0, 0, u32be(1), u32be(47274), u32be(2048), u16be(1), u16be(0));

  const ftyp = mp4Box('ftyp', asciiBytes('isom'), u32be(512), asciiBytes('isom'), asciiBytes('iso2'), asciiBytes('mp41'));
  const freeBox = mp4Box('free');

  // Helper to assemble moov with final stco pointing to mdat payload
  const buildMoov = (mdatPayloadOff: number) => {
    const videoStco = fullBox('stco', 0, 0, u32be(1), u32be(mdatPayloadOff));
    const audioStco = fullBox('stco', 0, 0, u32be(1), u32be(mdatPayloadOff + firstSampleData.length));

    const vTrak = mp4Box(
      'trak',
      makeTkhd(1, 47267, 720, 1280),
      mp4Box(
        'mdia',
        makeMdhd(videoTimescale, videoFrames * frameDelta),
        makeHdlr('vide'),
        mp4Box('minf', mp4Box('stbl', videoStsd, videoStts, videoStsz, videoStss, videoStco)),
      ),
    );
    const aTrak = mp4Box(
      'trak',
      makeTkhd(2, 47274, 0, 0),
      mp4Box('edts', audioElst),
      mp4Box(
        'mdia',
        makeMdhd(audioTimescale, audioPackets * audioDelta),
        makeHdlr('soun'),
        mp4Box('minf', mp4Box('stbl', audioStsd, audioStts, audioStsz, audioStco)),
      ),
    );
    return mp4Box('moov', mvhd, vTrak, aTrak, metaBox);
  };

  const dummyMoov = buildMoov(0);
  const mdatPayloadOffset = ftyp.length + dummyMoov.length + freeBox.length + 8;
  const finalMoov = buildMoov(mdatPayloadOffset);

  // Compact realistic mdat payload (first sample with exact NALs + SEI + padding media bytes)
  const mdatPayload = concatBytes(firstSampleData, new Uint8Array(8192));
  const mdat = mp4Box('mdat', mdatPayload);

  const bytes = concatBytes(ftyp, finalMoov, freeBox, mdat);
  // Filename contains TikTok-style 19-digit ID encoding 2026-09-18 04:21:53 UTC in upper 32 bits:
  // (1789705313n << 32n) | 123456789n -> exact epoch for 2026-09-18T04:21:53Z is 1789705313 - 112 = 1789705201 -> 7686725788935900437
  return {
    name: 'tiktok_7686725788935900437_sample.mp4',
    bytes,
    mime: 'video/mp4',
  };
}

function buildMinimalJpegImage(width: number, height: number): Uint8Array {
  // Valid minimal baseline JPEG with SOI, APP0, DQT, SOF0, DHT, SOS, entropy, EOI
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  // Standard quality ~80 luminance DQT (64 bytes)
  const qt = new Uint8Array(64).fill(10);
  qt[0] = 6;
  qt[1] = 4;
  qt[2] = 4;
  const dqt = concatBytes(new Uint8Array([0xff, 0xdb, 0x00, 0x43, 0x00]), qt);
  // SOF0 baseline 8-bit 3-component 4:2:0
  const sof0 = new Uint8Array([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
  ]);
  const dht = new Uint8Array([0xff, 0xc4, 0x00, 0x1f, 0x00, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00]);
  const scanData = new Uint8Array([0x7f, 0x2a, 0x11, 0x00, 0x88, 0x44, 0x3f]);
  return concatBytes(new Uint8Array([0xff, 0xd8]), app0, dqt, sof0, dht, sos, scanData, new Uint8Array([0xff, 0xd9]));
}

function buildExifApp1(thumbBytes: Uint8Array): Uint8Array {
  // Build clean Big-Endian TIFF ("MM\0*") with IFD0 (Make, Model, Software, Artist, DateTime, ExifIFD, GPSIFD),
  // ExifIFD (DateTimeOriginal, BodySerialNumber), GPSIFD (Jakarta: 6°10'31.41" S, 106°49'37.75" E, Alt 12m),
  // and IFD1 (embedded thumbnail!)
  const buf = new Uint8Array(2048 + thumbBytes.length);
  const dv = new DataView(buf.buffer);
  let cursor = 0;

  // TIFF Header at offset 0
  buf[0] = 0x4d; buf[1] = 0x4d; // MM (Big Endian)
  dv.setUint16(2, 42, false);
  dv.setUint32(4, 8, false); // IFD0 offset = 8

  const ifd0Start = 8;
  const ifd0Count = 7;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifIfdStart = ifd0Start + ifd0Size;
  const exifCount = 2;
  const exifSize = 2 + exifCount * 12 + 4;
  const gpsIfdStart = exifIfdStart + exifSize;
  const gpsCount = 6;
  const gpsSize = 2 + gpsCount * 12 + 4;
  const ifd1Start = gpsIfdStart + gpsSize;
  const ifd1Count = 3;
  const ifd1Size = 2 + ifd1Count * 12 + 4;
  cursor = ifd1Start + ifd1Size;

  const writeAsciiVal = (s: string): { offset: number; count: number } => {
    const start = cursor;
    for (let i = 0; i < s.length; i++) buf[cursor++] = s.charCodeAt(i);
    buf[cursor++] = 0;
    if (cursor % 2 === 1) cursor++;
    return { offset: start, count: s.length + 1 };
  };

  const writeRationals = (pairs: Array<[number, number]>): number => {
    const start = cursor;
    for (const [num, den] of pairs) {
      dv.setUint32(cursor, num, false);
      dv.setUint32(cursor + 4, den, false);
      cursor += 8;
    }
    return start;
  };

  const writeEntry = (base: number, idx: number, tag: number, type: number, count: number, valueOrOffset: number) => {
    const p = base + 2 + idx * 12;
    dv.setUint16(p, tag, false);
    dv.setUint16(p + 2, type, false);
    dv.setUint32(p + 4, count, false);
    if (type === 3 && count === 1) dv.setUint16(p + 8, valueOrOffset, false);
    else if (type === 2 && count <= 4) {
      dv.setUint32(p + 8, valueOrOffset, false);
    } else {
      dv.setUint32(p + 8, valueOrOffset, false);
    }
  };

  const makeV = writeAsciiVal('Apple');
  const modelV = writeAsciiVal('iPhone 15 Pro');
  const softV = writeAsciiVal('Adobe Photoshop 25.0');
  const artistV = writeAsciiVal('Budi Santoso <budi@example.id>');
  const dtV = writeAsciiVal('2026:10:15 09:30:00');
  const dtoV = writeAsciiVal('2026:10:14 14:22:10');
  const serialV = writeAsciiVal('SN-IPH15P-8842910');

  const latOff = writeRationals([[6, 1], [10, 1], [3141, 100]]);
  const lonOff = writeRationals([[106, 1], [49, 1], [3775, 100]]);
  const altOff = writeRationals([[12, 1]]);

  const thumbOff = cursor;
  buf.set(thumbBytes, thumbOff);
  cursor += thumbBytes.length;

  // IFD0
  dv.setUint16(ifd0Start, ifd0Count, false);
  writeEntry(ifd0Start, 0, 0x010f, 2, makeV.count, makeV.offset);
  writeEntry(ifd0Start, 1, 0x0110, 2, modelV.count, modelV.offset);
  writeEntry(ifd0Start, 2, 0x0131, 2, softV.count, softV.offset);
  writeEntry(ifd0Start, 3, 0x0132, 2, dtV.count, dtV.offset);
  writeEntry(ifd0Start, 4, 0x013b, 2, artistV.count, artistV.offset);
  writeEntry(ifd0Start, 5, 0x8769, 4, 1, exifIfdStart);
  writeEntry(ifd0Start, 6, 0x8825, 4, 1, gpsIfdStart);
  dv.setUint32(ifd0Start + 2 + ifd0Count * 12, ifd1Start, false);

  // ExifIFD
  dv.setUint16(exifIfdStart, exifCount, false);
  writeEntry(exifIfdStart, 0, 0x9003, 2, dtoV.count, dtoV.offset);
  writeEntry(exifIfdStart, 1, 0xa431, 2, serialV.count, serialV.offset);
  dv.setUint32(exifIfdStart + 2 + exifCount * 12, 0, false);

  // GPSIFD (S, 6°10'31.41", E, 106°49'37.75", Alt 12m)
  dv.setUint16(gpsIfdStart, gpsCount, false);
  writeEntry(gpsIfdStart, 0, 0x0001, 2, 2, 0x53000000); // 'S\0'
  writeEntry(gpsIfdStart, 1, 0x0002, 5, 3, latOff);
  writeEntry(gpsIfdStart, 2, 0x0003, 2, 2, 0x45000000); // 'E\0'
  writeEntry(gpsIfdStart, 3, 0x0004, 5, 3, lonOff);
  writeEntry(gpsIfdStart, 4, 0x0005, 1, 1, 0);
  writeEntry(gpsIfdStart, 5, 0x0006, 5, 1, altOff);
  dv.setUint32(gpsIfdStart + 2 + gpsCount * 12, 0, false);

  // IFD1 (Thumbnail)
  dv.setUint16(ifd1Start, ifd1Count, false);
  writeEntry(ifd1Start, 0, 0x0103, 3, 1, 6); // JPEG compression
  writeEntry(ifd1Start, 1, 0x0201, 4, 1, thumbOff);
  writeEntry(ifd1Start, 2, 0x0202, 4, 1, thumbBytes.length);
  dv.setUint32(ifd1Start + 2 + ifd1Count * 12, 0, false);

  const tiff = buf.subarray(0, cursor);
  const exifPayload = concatBytes(asciiBytes('Exif\0\0'), tiff);
  return concatBytes(new Uint8Array([0xff, 0xe1]), u16be(exifPayload.length + 2), exifPayload);
}

export function buildSampleGpsJpeg(withTrailingBytes = true): { name: string; bytes: Uint8Array; mime: string } {
  // Main image is 1600x900 (16:9), embedded thumbnail is 160x160 (1:1) => aspect mismatch detected!
  const mainJpg = buildMinimalJpegImage(1600, 900);
  const thumbJpg = buildMinimalJpegImage(160, 160);
  const app1 = buildExifApp1(thumbJpg);
  const trailing = withTrailingBytes ? asciiBytes('TRAILING_PAYLOAD_AFTER_EOI_MARKER_METASCOPE_TEST_DATA_64BYTES___') : new Uint8Array(0);
  const bytes = concatBytes(mainJpg.subarray(0, 2), app1, mainJpg.subarray(2), trailing);
  return { name: 'foto_monas_gps_exif.jpg', bytes, mime: 'image/jpeg' };
}

export function buildSampleCleanJpeg(): { name: string; bytes: Uint8Array; mime: string } {
  return { name: 'foto_monas_bersih.jpg', bytes: buildMinimalJpegImage(1600, 900), mime: 'image/jpeg' };
}

export function buildSampleAiPng(corruptCrc = false): { name: string; bytes: Uint8Array; mime: string } {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const makeChunk = (type: string, data: Uint8Array, flipCrc = false): Uint8Array => {
    const typeBytes = asciiBytes(type);
    const typeAndData = concatBytes(typeBytes, data);
    let c = crc32(typeAndData);
    if (flipCrc) c = (c ^ 0x000000ff) >>> 0;
    return concatBytes(u32be(data.length), typeAndData, u32be(c));
  };

  const ihdrData = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const textData = concatBytes(
    asciiBytes('parameters'),
    new Uint8Array([0]),
    asciiBytes('jakarta skyline at dusk, architectural photography\nNegative prompt: blurry, watermark\nSteps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7.5, Seed: 421998'),
  );
  // Minimal valid zlib-compressed 1x1 RGB scanline (0x00 filter + 3 bytes RGB)
  const idatData = new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01]);

  const bytes = concatBytes(
    sig,
    makeChunk('IHDR', ihdrData),
    makeChunk('tEXt', textData, corruptCrc),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', new Uint8Array(0)),
  );
  return { name: corruptCrc ? 'ai_render_crc_rusak.png' : 'ai_render_sd_params.png', bytes, mime: 'image/png' };
}

export function buildSampleDocx(): { name: string; bytes: Uint8Array; mime: string } {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'),
    'docProps/core.xml': strToU8(
      '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Draf Kontrak Kerja Sama</dc:title><dc:creator>Rina Wijaya (rina.wijaya@perusahaan.co.id)</dc:creator><cp:lastModifiedBy>Andi Pratama</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created>2026-08-10T03:15:00Z</dcterms:created><dcterms:modified>2026-09-21T08:42:00Z</dcterms:modified></cp:coreProperties>',
    ),
    'docProps/app.xml': strToU8(
      '<?xml version="1.0"?><Properties><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion><Company>PT Nusantara Digital</Company><Pages>4</Pages></Properties>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Nilai kontrak disepakati sebesar </w:t></w:r><w:del w:author="Andi Pratama" w:date="2026-09-21T08:30:00Z"><w:delText>Rp 450.000.000</w:delText></w:del><w:ins w:author="Andi Pratama" w:date="2026-09-21T08:31:00Z"><w:t>Rp 520.000.000</w:t></w:ins></w:p></w:body></w:document>',
    ),
    'word/comments.xml': strToU8(
      '<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1" w:author="Rina Wijaya" w:date="2026-09-20T11:12:00Z"><w:p><w:r><w:t>Tolong hapus klausul penalti sebelum dikirim ke klien!</w:t></w:r></w:p></w:comment></w:comments>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://internal.example.co.id/budget-2026" TargetMode="External"/></Relationships>',
    ),
    'word/vbaProject.bin': new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  };
  return {
    name: 'draf_kontrak_revisi.docx',
    bytes: zipSync(files, { level: 6 }),
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

export function buildSamplePdf(): { name: string; bytes: Uint8Array; mime: string } {
  const pdfText = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert('demo');) >> >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Annots [<< /Subtype /Text /Contents (Catatan internal) >>] >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj
5 0 obj
<< /Title (Laporan Audit Q3) /Author (Tim Keuangan) /Creator (LibreOffice 24.8) /Producer (LibreOffice PDF Export) /CreationDate (D:20260701100000+07'00') /ModDate (D:20260705153000+07'00') >>
endobj
xref
0 6
0000000000 65535 f 
trailer
<< /Size 6 /Root 1 0 R /Info 5 0 R >>
startxref
480
%%EOF
6 0 obj
<< /Title (Laporan Audit Q3 Final) /Author (Tim Keuangan) /Creator (Adobe Acrobat Pro) /Producer (Adobe PDF Library 17.0) /CreationDate (D:20260701100000+07'00') /ModDate (D:20260712091500+07'00') >>
endobj
trailer
<< /Size 7 /Prev 480 /Root 1 0 R /Info 6 0 R >>
startxref
720
%%EOF
`;
  return { name: 'laporan_audit_revisi.pdf', bytes: asciiBytes(pdfText), mime: 'application/pdf' };
}

export interface SampleFixtureSpec {
  id: string;
  labelId: string;
  labelEn: string;
  badge: string;
  build: () => { name: string; bytes: Uint8Array; mime: string };
}

export const BUILTIN_SAMPLES: SampleFixtureSpec[] = [
  {
    id: 'mp4_hevc',
    labelId: 'Video MP4 (HEVC + SEI ByteVC1 + Lavf)',
    labelEn: 'MP4 Video (HEVC + SEI ByteVC1 + Lavf)',
    badge: 'MP4',
    build: buildSampleMp4,
  },
  {
    id: 'jpg_gps',
    labelId: 'Foto JPEG berGPS + Thumbnail + Data Sisa',
    labelEn: 'GPS JPEG + Thumbnail Mismatch + Trailing',
    badge: 'JPEG',
    build: () => buildSampleGpsJpeg(true),
  },
  {
    id: 'jpg_clean',
    labelId: 'Foto JPEG Bersih (Untuk Bandingkan)',
    labelEn: 'Clean JPEG (For Compare Diff)',
    badge: 'JPEG',
    build: buildSampleCleanJpeg,
  },
  {
    id: 'png_ai',
    labelId: 'PNG Generator AI (Parameter Teks)',
    labelEn: 'AI Generator PNG (Text Params)',
    badge: 'PNG',
    build: () => buildSampleAiPng(false),
  },
  {
    id: 'docx_review',
    labelId: 'DOCX Track Changes + Komentar + Makro',
    labelEn: 'DOCX Tracked Changes + Comments + Macro',
    badge: 'DOCX',
    build: buildSampleDocx,
  },
  {
    id: 'pdf_rev',
    labelId: 'PDF Revisi Ganda (2× %%EOF)',
    labelEn: 'Incremental PDF (2× %%EOF)',
    badge: 'PDF',
    build: buildSamplePdf,
  },
];
