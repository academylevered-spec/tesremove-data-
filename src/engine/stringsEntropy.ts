export interface ExtractedString {
  offset: number;
  value: string;
}

export interface EntropyPoint {
  offset: number;
  entropy: number; // 0.0 to 8.0 bits/byte
}

export async function extractStrings(
  file: Blob,
  minLength = 6,
  maxStrings = 800,
  maxScanBytes = 8 * 1024 * 1024,
): Promise<ExtractedString[]> {
  const results: ExtractedString[] = [];
  const limit = Math.min(file.size, maxScanBytes);
  const chunkSize = 512 * 1024;
  let offset = 0;
  let current = '';
  let currentStart = 0;

  while (offset < limit && results.length < maxStrings) {
    const end = Math.min(offset + chunkSize, limit);
    const buf = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 0x20 && b <= 0x7e) {
        if (current.length === 0) currentStart = offset + i;
        if (current.length < 256) current += String.fromCharCode(b);
      } else {
        if (current.length >= minLength) {
          results.push({ offset: currentStart, value: current });
          if (results.length >= maxStrings) break;
        }
        current = '';
      }
    }
    offset = end;
  }

  if (current.length >= minLength && results.length < maxStrings) {
    results.push({ offset: currentStart, value: current });
  }

  return results;
}

export async function computeEntropyProfile(file: Blob, buckets = 64): Promise<EntropyPoint[]> {
  if (file.size === 0) return [];
  const count = Math.min(buckets, Math.max(1, Math.ceil(file.size / 256)));
  const step = Math.floor(file.size / count);
  const windowSize = Math.min(4096, Math.max(256, step));
  const points: EntropyPoint[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * step;
    const end = Math.min(file.size, start + windowSize);
    const buf = new Uint8Array(await file.slice(start, end).arrayBuffer());
    if (buf.length === 0) continue;
    const freq = new Uint32Array(256);
    for (let k = 0; k < buf.length; k++) freq[buf[k]]++;
    let entropy = 0;
    const len = buf.length;
    for (let v = 0; v < 256; v++) {
      if (freq[v] > 0) {
        const p = freq[v] / len;
        entropy -= p * Math.log2(p);
      }
    }
    points.push({ offset: start, entropy: Number(entropy.toFixed(3)) });
  }

  return points;
}
