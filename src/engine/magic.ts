export interface MagicDetection {
  type: string;
  mime: string;
  family: 'video' | 'image' | 'audio' | 'pdf' | 'office' | 'archive' | 'unknown';
  expectedExtensions: string[];
  extension: string;
  extensionMatches: boolean;
  majorBrand?: string;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42',
  'avc1', 'hvc1', 'hev1', 'M4V ', 'M4A ', 'M4B ', 'M4P ', 'dash', 'msdh', 'msix', 'f4v ',
]);
const MOV_BRANDS = new Set(['qt  ', 'mqt ']);
const THREE_GP_BRANDS = new Set(['3gp4', '3gp5', '3gp6', '3gp7', '3g2a', '3g2b']);

function ascii(bytes: Uint8Array, start: number, len: number): string {
  if (bytes.length < start + len) return '';
  let out = '';
  for (let i = start; i < start + len; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

export function extractExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

export function detectFromMagicBytes(headerBytes: Uint8Array, filename: string): MagicDetection {
  const ext = extractExtension(filename);
  const b = headerBytes;

  const make = (
    type: string,
    mime: string,
    family: MagicDetection['family'],
    expectedExtensions: string[],
    majorBrand?: string,
  ): MagicDetection => ({
    type,
    mime,
    family,
    expectedExtensions,
    extension: ext,
    extensionMatches: expectedExtensions.length === 0 || ext === '' ? true : expectedExtensions.includes(ext),
    majorBrand,
  });

  // ISO Base Media File Format (ftyp at offset 4)
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    const trimmed = brand.trim();
    if (HEIC_BRANDS.has(brand) || HEIC_BRANDS.has(trimmed)) {
      return make('HEIC/HEIF', 'image/heic', 'image', ['heic', 'heif', 'hif'], trimmed);
    }
    if (AVIF_BRANDS.has(brand) || AVIF_BRANDS.has(trimmed)) {
      return make('AVIF', 'image/avif', 'image', ['avif'], trimmed);
    }
    if (MOV_BRANDS.has(brand)) {
      return make('QuickTime MOV', 'video/quicktime', 'video', ['mov', 'qt', 'mp4'], trimmed);
    }
    if (brand === 'M4A ' || brand === 'M4B ') {
      return make('M4A Audio (MP4)', 'audio/mp4', 'audio', ['m4a', 'm4b', 'mp4', 'aac'], trimmed);
    }
    if (THREE_GP_BRANDS.has(brand)) {
      return make('3GP Video (MP4)', 'video/3gpp', 'video', ['3gp', '3g2', 'mp4'], trimmed);
    }
    if (MP4_BRANDS.has(brand) || /^[a-zA-Z0-9 _-]{4}$/.test(brand)) {
      return make('MP4', 'video/mp4', 'video', ['mp4', 'm4v', 'mov', 'm4a', '3gp'], trimmed);
    }
  }

  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return make('JPEG', 'image/jpeg', 'image', ['jpg', 'jpeg', 'jpe', 'jfif']);
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return make('PNG', 'image/png', 'image', ['png']);
  }

  // GIF87a / GIF89a
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) {
    return make('GIF', 'image/gif', 'image', ['gif']);
  }

  // RIFF containers (WebP, WAV, AVI)
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF') {
    const form = ascii(b, 8, 4);
    if (form === 'WEBP') return make('WebP', 'image/webp', 'image', ['webp']);
    if (form === 'WAVE') return make('WAV', 'audio/wav', 'audio', ['wav', 'wave']);
    if (form === 'AVI ') return make('AVI', 'video/x-msvideo', 'video', ['avi']);
  }

  // AIFF / AIFC
  if (b.length >= 12 && ascii(b, 0, 4) === 'FORM' && (ascii(b, 8, 4) === 'AIFF' || ascii(b, 8, 4) === 'AIFC')) {
    return make('AIFF', 'audio/aiff', 'audio', ['aif', 'aiff', 'aifc']);
  }

  // TIFF (II*\0 or MM\0*)
  if (
    b.length >= 4 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))
  ) {
    return make('TIFF', 'image/tiff', 'image', ['tif', 'tiff', 'dng', 'nef', 'arw', 'cr2']);
  }

  // BMP
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return make('BMP', 'image/bmp', 'image', ['bmp']);
  }

  // PDF: %PDF-
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') {
    return make('PDF', 'application/pdf', 'pdf', ['pdf']);
  }

  // ZIP / Office OOXML / ODF / EPUB: PK\x03\x04 or PK\x05\x06
  if (
    b.length >= 4 &&
    b[0] === 0x50 && b[1] === 0x4b &&
    ((b[2] === 0x03 && b[3] === 0x04) || (b[2] === 0x05 && b[3] === 0x06))
  ) {
    const headerStr = ascii(b, 0, Math.min(b.length, 256));
    if (ext === 'docx' || headerStr.includes('word/')) {
      return make('DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'office', ['docx', 'zip']);
    }
    if (ext === 'xlsx' || headerStr.includes('xl/')) {
      return make('XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'office', ['xlsx', 'zip']);
    }
    if (ext === 'pptx' || headerStr.includes('ppt/')) {
      return make('PPTX', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'office', ['pptx', 'zip']);
    }
    if (ext === 'epub' || headerStr.includes('application/epub+zip')) {
      return make('EPUB', 'application/epub+zip', 'office', ['epub', 'zip']);
    }
    if (ext === 'odt' || ext === 'ods' || ext === 'odp' || headerStr.includes('opendocument')) {
      return make(ext.toUpperCase() || 'ODF', 'application/vnd.oasis.opendocument', 'office', ['odt', 'ods', 'odp', 'zip']);
    }
    return make('ZIP', 'application/zip', 'archive', ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'jar']);
  }

  // GZIP: 1F 8B
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) {
    return make('GZIP', 'application/gzip', 'archive', ['gz', 'gzip', 'tgz']);
  }

  // 7z: 37 7A BC AF 27 1C
  if (
    b.length >= 6 &&
    b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf && b[4] === 0x27 && b[5] === 0x1c
  ) {
    return make('7z', 'application/x-7z-compressed', 'archive', ['7z']);
  }

  // TAR (ustar at offset 257)
  if (b.length >= 263 && ascii(b, 257, 5) === 'ustar') {
    return make('TAR', 'application/x-tar', 'archive', ['tar']);
  }

  // FLAC: fLaC
  if (b.length >= 4 && ascii(b, 0, 4) === 'fLaC') {
    return make('FLAC', 'audio/flac', 'audio', ['flac']);
  }

  // OGG: OggS
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') {
    return make('OGG', 'audio/ogg', 'audio', ['ogg', 'oga', 'opus', 'ogv']);
  }

  // MP3: ID3 or frame sync FF FB / FF F3 / FF F2
  if (
    (b.length >= 3 && ascii(b, 0, 3) === 'ID3') ||
    (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0x00)
  ) {
    return make('MP3', 'audio/mpeg', 'audio', ['mp3']);
  }

  // Matroska / WebM EBML: 1A 45 DF A3
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const head = ascii(b, 0, Math.min(b.length, 64));
    if (head.includes('webm')) {
      return make('WebM', 'video/webm', 'video', ['webm', 'mkv']);
    }
    return make('Matroska (MKV)', 'video/x-matroska', 'video', ['mkv', 'mka', 'webm']);
  }

  // SVG text check
  const textHead = ascii(b, 0, Math.min(b.length, 256)).trimStart();
  if (textHead.startsWith('<svg') || (textHead.startsWith('<?xml') && textHead.includes('<svg'))) {
    return make('SVG', 'image/svg+xml', 'image', ['svg']);
  }

  return make('Tidak dikenal (biner)', 'application/octet-stream', 'unknown', []);
}

export async function detectFileMagic(file: Blob, filename: string): Promise<MagicDetection> {
  const slice = file.slice(0, Math.min(file.size, 512));
  const buf = new Uint8Array(await slice.arrayBuffer());
  return detectFromMagicBytes(buf, filename);
}
