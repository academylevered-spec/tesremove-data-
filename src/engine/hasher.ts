import { createMD5, createSHA1, createSHA256 } from 'hash-wasm';

const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MiB chunks

export interface FileHashes {
  md5: string;
  sha1: string;
  sha256: string;
}

export async function computeStreamingHashes(
  file: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<FileHashes> {
  const [md5Hasher, sha1Hasher, sha256Hasher] = await Promise.all([
    createMD5(),
    createSHA1(),
    createSHA256(),
  ]);
  md5Hasher.init();
  sha1Hasher.init();
  sha256Hasher.init();

  const total = file.size;
  let offset = 0;

  while (offset < total) {
    if (signal?.aborted) {
      throw new DOMException('Analysis aborted', 'AbortError');
    }
    const end = Math.min(offset + chunkSize, total);
    const buf = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    md5Hasher.update(buf);
    sha1Hasher.update(buf);
    sha256Hasher.update(buf);
    offset = end;
    onProgress?.(total > 0 ? offset / total : 1);
  }

  return {
    md5: md5Hasher.digest('hex'),
    sha1: sha1Hasher.digest('hex'),
    sha256: sha256Hasher.digest('hex'),
  };
}

export async function computeRegionHash(
  file: Blob,
  start: number,
  length: number,
  algorithm: 'md5' | 'sha1' | 'sha256',
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<string> {
  const hasher =
    algorithm === 'md5'
      ? await createMD5()
      : algorithm === 'sha1'
        ? await createSHA1()
        : await createSHA256();
  hasher.init();

  const endLimit = Math.min(file.size, start + Math.max(0, length));
  let offset = Math.max(0, start);

  while (offset < endLimit) {
    const next = Math.min(offset + chunkSize, endLimit);
    const buf = new Uint8Array(await file.slice(offset, next).arrayBuffer());
    hasher.update(buf);
    offset = next;
  }

  return hasher.digest('hex');
}
