import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import type { AnalyzerWarning, TagEntry } from '@/src/engine/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

// Simple in-memory per-IP sliding window rate limiter (15 req / 60s)
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 15;
const rateBuckets = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT) {
    rateBuckets.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(ip, timestamps);
  return true;
}

// Lazy singleton for ExifTool with graceful shutdown
let exiftoolSingleton: { read: (p: string, args?: string[]) => Promise<Record<string, unknown>>; end: () => Promise<void> } | null = null;
let shutdownRegistered = false;

async function getExifTool() {
  if (process.env.METASCOPE_DEEP_MODE_DISABLED === 'true') {
    return null;
  }
  if (exiftoolSingleton) return exiftoolSingleton;
  try {
    const mod = await import('exiftool-vendored');
    const instance = new mod.ExifTool({
      taskTimeoutMillis: 15_000,
      maxProcs: 2,
    });
    // Quick version probe to verify Perl & ExifTool actually run in this container
    await instance.version();
    exiftoolSingleton = instance as unknown as typeof exiftoolSingleton;
    if (!shutdownRegistered) {
      shutdownRegistered = true;
      const cleanup = () => {
        exiftoolSingleton?.end().catch(() => {});
      };
      process.once('SIGTERM', cleanup);
      process.once('SIGINT', cleanup);
    }
    return exiftoolSingleton;
  } catch {
    return null;
  }
}

async function runFfprobe(filePath: string): Promise<{ data?: Record<string, unknown>; warning?: AnalyzerWarning }> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', filePath],
      { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return { data: parsed };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return {
        warning: {
          analyzer: 'ffprobe',
          message: 'Biner ffprobe tidak tersedia di runtime server; analisis stream ffprobe dilewati.',
        },
      };
    }
    return {
      warning: {
        analyzer: 'ffprobe',
        message: 'ffprobe tidak dapat membaca format ini atau melampaui batas waktu.',
      },
    };
  }
}

function sanitizeExifValue(val: unknown): { raw: unknown; decoded: string } {
  if (val === null || val === undefined) return { raw: '', decoded: '' };
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return { raw: `<binary ${val.byteLength} bytes>`, decoded: `<binary ${val.byteLength} B>` };
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.rawValue === 'string') {
      return { raw: obj.rawValue, decoded: obj.rawValue };
    }
    if (typeof obj._ctor === 'string' && typeof obj.bytes === 'number') {
      return { raw: `<binary ${obj.bytes} bytes>`, decoded: `<binary ${obj.bytes} B>` };
    }
    try {
      const s = JSON.stringify(obj);
      if (s.length > 2048) {
        return { raw: `<truncated ${s.length} chars>`, decoded: `${s.slice(0, 200)}... (${s.length} chars)` };
      }
      return { raw: obj, decoded: s };
    } catch {
      return { raw: String(val), decoded: String(val) };
    }
  }
  const str = String(val);
  if (str.startsWith('(Binary data ')) {
    return { raw: str, decoded: str };
  }
  return { raw: val, decoded: str };
}

export async function POST(req: NextRequest) {
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local';

  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { status: 'error', message: 'Terlalu banyak permintaan. Coba lagi dalam satu menit.' },
      { status: 429 },
    );
  }

  // Check engine availability before accepting payload
  const exiftool = await getExifTool();
  if (!exiftool) {
    return NextResponse.json({
      status: 'engine_unavailable',
      message: 'ExifTool atau Perl tidak tersedia di runtime server ini. Turun otomatis ke Mode Privat.',
    });
  }

  const maxUploadMb = Math.max(1, Math.min(250, Number(process.env.METASCOPE_MAX_UPLOAD_MB || '100')));
  const maxBytes = maxUploadMb * 1024 * 1024;

  let tempFilePath: string | null = null;
  try {
    const formData = await req.formData();
    const uploaded = formData.get('file');
    if (!uploaded || !(uploaded instanceof Blob)) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter multipart "file" tidak ditemukan.' },
        { status: 400 },
      );
    }

    if (uploaded.size <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'File kosong.' },
        { status: 400 },
      );
    }

    if (uploaded.size > maxBytes) {
      return NextResponse.json(
        { status: 'error', message: `Ukuran file melampaui batas server (${maxUploadMb} MB).` },
        { status: 413 },
      );
    }

    // Confine temp file strictly inside os.tmpdir() with purely random UUID filename (never user filename!)
    const tmpBase = path.resolve(os.tmpdir());
    const safeRandomName = `metascope_${randomUUID()}.bin`;
    const candidatePath = path.resolve(tmpBase, safeRandomName);
    if (!candidatePath.startsWith(tmpBase + path.sep)) {
      return NextResponse.json({ status: 'error', message: 'Path sementara tidak valid.' }, { status: 500 });
    }
    tempFilePath = candidatePath;

    const arrayBuffer = await uploaded.arrayBuffer();
    await fs.writeFile(tempFilePath, Buffer.from(arrayBuffer), { mode: 0o600 });

    const warnings: AnalyzerWarning[] = [];
    const tags: TagEntry[] = [];
    const engines: Record<string, string> = {};

    // Run ExifTool with group names (-a -G1 -s -u -ee)
    try {
      const rawTags = await exiftool.read(tempFilePath, ['-a', '-G1', '-s', '-u', '-ee']);
      engines.exiftool = 'exiftool-vendored-39.4.0';
      const skipInternalKeys = new Set([
        'SourceFile',
        'Directory',
        'FileName',
        'FilePermissions',
        'FileAccessDate',
        'FileInodeChangeDate',
        'FileModifyDate',
        'ExifToolVersion',
        'errors',
        'warnings',
      ]);

      for (const [fullKey, val] of Object.entries(rawTags)) {
        if (skipInternalKeys.has(fullKey)) continue;
        const colonIdx = fullKey.indexOf(':');
        const ns = colonIdx > 0 ? `ExifTool/${fullKey.slice(0, colonIdx)}` : 'ExifTool';
        const name = colonIdx > 0 ? fullKey.slice(colonIdx + 1) : fullKey;
        if (skipInternalKeys.has(name)) continue;
        const norm = sanitizeExifValue(val);
        tags.push({
          ns,
          name,
          raw: norm.raw,
          decoded: norm.decoded,
          source: 'exiftool-server',
        });
      }
    } catch {
      warnings.push({
        analyzer: 'exiftool-server',
        message: 'ExifTool mengalami galat saat membaca beberapa tag file ini.',
      });
    }

    // Run ffprobe if available
    const ffprobeRes = await runFfprobe(tempFilePath);
    if (ffprobeRes.warning) {
      warnings.push(ffprobeRes.warning);
    } else if (ffprobeRes.data) {
      engines.ffprobe = 'system-ffprobe';
      const fmt = ffprobeRes.data.format as Record<string, unknown> | undefined;
      if (fmt?.tags && typeof fmt.tags === 'object') {
        for (const [k, v] of Object.entries(fmt.tags as Record<string, unknown>)) {
          tags.push({
            ns: 'ffprobe/format',
            name: k,
            raw: v,
            decoded: String(v ?? ''),
            source: 'ffprobe-server',
          });
        }
      }
    }

    return NextResponse.json({
      status: 'ok',
      tags,
      warnings,
      engines,
      ffprobe: ffprobeRes.data
        ? {
            formatName: (ffprobeRes.data.format as Record<string, unknown> | undefined)?.format_name,
            duration: (ffprobeRes.data.format as Record<string, unknown> | undefined)?.duration,
            streamCount: Array.isArray(ffprobeRes.data.streams) ? ffprobeRes.data.streams.length : 0,
            chapterCount: Array.isArray(ffprobeRes.data.chapters) ? ffprobeRes.data.chapters.length : 0,
          }
        : undefined,
    });
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Gagal memproses permintaan analisis mendalam.' },
      { status: 500 },
    );
  } finally {
    // Always erase temporary file unconditionally — never leave user files on disk
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }
}
