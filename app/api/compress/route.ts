import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildCompressedFilename,
  buildFfmpegArgs,
  CODEC_PROFILES,
  parseSsimScore,
  recommendCompressionPlan,
  sanitizeCompressOptions,
  type CompressOptions,
  type ProbedVideoInfo,
  type VideoCodecId,
} from '@/src/engine/videoCompress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);
const PYTHON_ENGINE_SCRIPT = path.resolve(process.cwd(), 'scripts', 'compressor_engine.py');

// Per-IP rate limiter (20 requests / 60s) & concurrency guard (max 2 simultaneous encodes)
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const rateBuckets = new Map<string, number[]>();
let activeEncodes = 0;
const MAX_CONCURRENT_ENCODES = 2;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 500) {
    for (const [k, vals] of rateBuckets.entries()) {
      if (vals.every((t) => now - t >= RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  const timestamps = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT) {
    rateBuckets.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(ip, timestamps);
  return true;
}

function runCommandAbortable(
  binary: 'ffmpeg' | 'python3',
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Kompresi dibatalkan oleh pengguna.');
      err.name = 'AbortError';
      reject(err);
      return;
    }

    const child = spawn(binary, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrTail = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      if (stdoutBuf.length > 262_144) stdoutBuf = stdoutBuf.slice(-262_144);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096);
    });

    let settled = false;
    let timedOut = false;

    const killChild = () => {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // already exited
          }
        }, 1500).unref();
      } catch {
        // already exited
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutMs);

    const onAbort = () => {
      killChild();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal?.aborted) {
        const err = new Error('Kompresi dibatalkan oleh pengguna.');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      if (timedOut) {
        const err = new Error('Timeout') as Error & { killed?: boolean };
        err.killed = true;
        reject(err);
        return;
      }
      if (code === 0) {
        resolve({ stdout: stdoutBuf, stderr: stderrTail });
      } else {
        reject(new Error(stderrTail.trim() || `${binary} exited with code ${code}`));
      }
    });
  });
}

async function measureQuickSsim(
  compressedPath: string,
  originalPath: string,
  outWidth: number,
  outHeight: number,
  signal?: AbortSignal,
): Promise<number | null> {
  if (signal?.aborted || outWidth <= 0 || outHeight <= 0) return null;
  try {
    const cmpH = Math.min(outHeight, 480);
    const cmpW = Math.max(2, Math.round((outWidth * (cmpH / outHeight)) / 2) * 2);
    const filter = `[0:v]scale=${cmpW}:${cmpH}:flags=bicubic,format=yuv420p[dist];[1:v]scale=${cmpW}:${cmpH}:flags=bicubic,format=yuv420p[ref];[dist][ref]ssim`;
    const { stderr } = await runCommandAbortable(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'info',
        '-t',
        '4',
        '-i',
        compressedPath,
        '-t',
        '4',
        '-i',
        originalPath,
        '-lavfi',
        filter,
        '-f',
        'null',
        '-',
      ],
      10_000,
      signal,
    );
    return parseSsimScore(stderr);
  } catch {
    return null;
  }
}

async function writeBlobToFile(blob: Blob, destPath: string): Promise<void> {
  if (typeof blob.stream === 'function') {
    const nodeReadable = Readable.fromWeb(blob.stream() as unknown as NodeWebReadableStream<Uint8Array>);
    await pipeline(nodeReadable, createWriteStream(destPath, { mode: 0o600 }));
    return;
  }
  await fs.writeFile(destPath, Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
}

interface EncoderCapabilities {
  available: boolean;
  pythonEngine: boolean;
  encoders: Record<VideoCodecId, boolean>;
  maxUploadMb: number;
}

let cachedCaps: EncoderCapabilities | null = null;

async function detectCapabilities(): Promise<EncoderCapabilities> {
  const maxUploadMb = Math.max(10, Math.min(500, Number(process.env.METASCOPE_MAX_VIDEO_MB || '200')));
  if (cachedCaps) return { ...cachedCaps, maxUploadMb };
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-encoders'], {
      timeout: 8_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    let pythonEngine = false;
    if (existsSync(PYTHON_ENGINE_SCRIPT)) {
      try {
        await execFileAsync('python3', ['--version'], { timeout: 3_000 });
        pythonEngine = true;
      } catch {
        pythonEngine = false;
      }
    }

    const caps: EncoderCapabilities = {
      available: true,
      pythonEngine,
      encoders: {
        av1: stdout.includes('libaom-av1'),
        hevc: stdout.includes('libx265'),
        vp9: stdout.includes('libvpx-vp9'),
        h264: stdout.includes('libx264'),
      },
      maxUploadMb,
    };
    cachedCaps = caps;
    return caps;
  } catch {
    return {
      available: false,
      pythonEngine: false,
      encoders: { av1: false, hevc: false, vp9: false, h264: false },
      maxUploadMb,
    };
  }
}

function parseFrameRate(raw: string | undefined): number {
  if (!raw) return 30;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

async function probeVideo(filePath: string, sizeBytes: number): Promise<ProbedVideoInfo> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const vStream = streams.find((s) => s.codec_type === 'video');
  if (!vStream || !vStream.width || !vStream.height) {
    throw new Error('File yang diunggah tidak mengandung stream video yang valid.');
  }
  const aStream = streams.find((s) => s.codec_type === 'audio');

  const durationSec = Math.max(0.1, Number(parsed.format?.duration || vStream.duration || 0) || 0);
  const bitrateBps =
    Number(parsed.format?.bit_rate || 0) || (durationSec > 0 ? (sizeBytes * 8) / durationSec : 0);

  return {
    durationSec: Math.round(durationSec * 100) / 100,
    width: vStream.width,
    height: vStream.height,
    videoCodec: vStream.codec_name || 'unknown',
    audioCodec: aStream?.codec_name ?? null,
    fps: parseFrameRate(vStream.avg_frame_rate !== '0/0' ? vStream.avg_frame_rate : vStream.r_frame_rate),
    bitrateKbps: Math.round(bitrateBps / 1000),
    sizeBytes,
    pixFmt: vStream.pix_fmt,
  };
}

async function createConfinedWorkDir(): Promise<string> {
  const tmpBase = path.resolve(os.tmpdir());
  const dir = path.resolve(tmpBase, `metascope_vc_${randomUUID()}`);
  if (!dir.startsWith(tmpBase + path.sep)) {
    throw new Error('Path kerja sementara tidak valid.');
  }
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function GET(req: NextRequest) {
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local';

  if (!checkRateLimit(clientIp)) {
    return NextResponse.json({ status: 'error', message: 'Terlalu banyak permintaan.' }, { status: 429 });
  }

  const caps = await detectCapabilities();

  if (req.nextUrl.searchParams.get('sample') === '1') {
    if (!caps.available || !caps.encoders.h264) {
      return NextResponse.json(
        { status: 'error', message: 'Mesin FFmpeg tidak tersedia untuk membuat video contoh.' },
        { status: 503 },
      );
    }

    let workDir: string | null = null;
    try {
      workDir = await createConfinedWorkDir();
      const samplePath = path.join(workDir, 'sample_hd.mp4');
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=1280x720:rate=30:duration=3',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=44100:duration=3',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '12',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-metadata',
          'title=MetaScope HD Sample Video',
          '-metadata',
          'comment=Sample high-bitrate H.264 recording for compression test',
          '-movflags',
          '+faststart',
          samplePath,
        ],
        { timeout: 25_000 },
      );
      const buf = await fs.readFile(samplePath);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(buf.length),
          'Content-Disposition': 'inline; filename="sample_hd_720p_3s.mp4"',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return NextResponse.json(
        { status: 'error', message: 'Gagal membuat video contoh HD.' },
        { status: 500 },
      );
    } finally {
      if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return NextResponse.json({
    status: 'ok',
    ...caps,
  });
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

  const caps = await detectCapabilities();
  if (!caps.available) {
    return NextResponse.json(
      { status: 'error', message: 'Mesin FFmpeg tidak tersedia di runtime server ini.' },
      { status: 503 },
    );
  }

  const maxBytes = caps.maxUploadMb * 1024 * 1024;
  let workDir: string | null = null;
  let encodeSlotAcquired = false;

  try {
    const formData = await req.formData();
    const uploaded = formData.get('file');
    const action = String(formData.get('action') || 'compress');
    const rawOptionsStr = formData.get('options');

    if (!uploaded || !(uploaded instanceof Blob)) {
      return NextResponse.json(
        { status: 'error', message: 'Parameter multipart "file" tidak ditemukan.' },
        { status: 400 },
      );
    }

    if (uploaded.size <= 0) {
      return NextResponse.json({ status: 'error', message: 'File video kosong.' }, { status: 400 });
    }

    if (uploaded.size > maxBytes) {
      return NextResponse.json(
        { status: 'error', message: `Ukuran video melampaui batas server (${caps.maxUploadMb} MB).` },
        { status: 413 },
      );
    }

    const originalFilename =
      typeof (uploaded as File).name === 'string' && (uploaded as File).name.trim().length > 0
        ? (uploaded as File).name.trim()
        : 'video.mp4';

    workDir = await createConfinedWorkDir();
    const inputPath = path.join(workDir, 'input.bin');
    await writeBlobToFile(uploaded, inputPath);

    let probed: ProbedVideoInfo;
    try {
      probed = await probeVideo(inputPath, uploaded.size);
    } catch (err) {
      return NextResponse.json(
        {
          status: 'error',
          message:
            (err as Error)?.message ||
            'File tidak dapat dibaca sebagai video valid oleh FFprobe. Pastikan format video tidak rusak.',
        },
        { status: 400 },
      );
    }

    if (action === 'probe') {
      return NextResponse.json({
        status: 'ok',
        probed,
        recommendation: recommendCompressionPlan(probed),
        capabilities: caps,
      });
    }

    let parsedRaw: Partial<CompressOptions> = {};
    if (typeof rawOptionsStr === 'string' && rawOptionsStr.trim()) {
      try {
        parsedRaw = JSON.parse(rawOptionsStr) as Partial<CompressOptions>;
      } catch {
        return NextResponse.json({ status: 'error', message: 'Format opsi kompresi tidak valid.' }, { status: 400 });
      }
    }
    const safeOptions = sanitizeCompressOptions(parsedRaw);

    if (!caps.encoders[safeOptions.codec]) {
      return NextResponse.json(
        {
          status: 'error',
          message: `Encoder ${CODEC_PROFILES[safeOptions.codec].name} tidak tersedia di server ini. Silakan pilih codec lain.`,
        },
        { status: 400 },
      );
    }

    if (activeEncodes >= MAX_CONCURRENT_ENCODES) {
      return NextResponse.json(
        { status: 'error', message: 'Antrean kompresi sedang penuh. Coba lagi beberapa detik lagi.' },
        { status: 429 },
      );
    }
    activeEncodes++;
    encodeSlotAcquired = true;

    const ext = CODEC_PROFILES[safeOptions.codec].ext;
    const mime = CODEC_PROFILES[safeOptions.codec].mime;
    const outputPath = path.join(workDir, `output.${ext}`);
    const outFilename = buildCompressedFilename(originalFilename, safeOptions.codec, ext);

    let statsPayload: Record<string, unknown>;

    if (caps.pythonEngine) {
      // Primary path: Structured 5-Stage Python Per-Title Anti-Bloat Engine
      const { stdout } = await runCommandAbortable(
        'python3',
        [
          PYTHON_ENGINE_SCRIPT,
          '--input',
          inputPath,
          '--output',
          outputPath,
          '--workdir',
          workDir,
          '--options-json',
          JSON.stringify(safeOptions),
        ],
        210_000,
        req.signal,
      );

      const engineResult = JSON.parse(stdout.trim()) as Record<string, unknown>;
      statsPayload = {
        ...engineResult,
        filename: outFilename,
        mime,
      };
    } else {
      // Safe fallback path if Python 3 is unavailable
      const passLogPrefix = path.join(workDir, 'passlog');
      const plan = buildFfmpegArgs(inputPath, outputPath, safeOptions, probed, passLogPrefix);
      const startedAt = Date.now();
      if (plan.usesTwoPass && plan.pass1Args && plan.pass2Args) {
        await runCommandAbortable('ffmpeg', plan.pass1Args, 90_000, req.signal);
        await runCommandAbortable('ffmpeg', plan.pass2Args, 150_000, req.signal);
      } else {
        await runCommandAbortable('ffmpeg', plan.args, 180_000, req.signal);
      }
      const elapsedMs = Date.now() - startedAt;
      const outStat = await fs.stat(outputPath);
      const outProbed = await probeVideo(outputPath, outStat.size);
      const ssimPercent = await measureQuickSsim(outputPath, inputPath, outProbed.width, outProbed.height, req.signal);
      statsPayload = {
        engine: 'ffmpeg-fallback',
        originalSize: probed.sizeBytes,
        compressedSize: outStat.size,
        bytesSaved: probed.sizeBytes - outStat.size,
        reductionPercent:
          probed.sizeBytes > 0 ? Math.round(((probed.sizeBytes - outStat.size) / probed.sizeBytes) * 1000) / 10 : 0,
        originalCodec: probed.videoCodec,
        compressedCodec: outProbed.videoCodec,
        originalBitrateKbps: probed.bitrateKbps,
        compressedBitrateKbps: outProbed.bitrateKbps,
        width: outProbed.width,
        height: outProbed.height,
        durationSec: outProbed.durationSec,
        pixFmt: outProbed.pixFmt || plan.pixFmt,
        effectiveCrf: plan.effectiveCrf,
        targetBitrateKbps: plan.targetPlan?.videoBitrateKbps ?? null,
        vbvMaxrateKbps: plan.vbvMaxrateKbps,
        usesTwoPass: plan.usesTwoPass,
        ssimPercent,
        psnrDb: null,
        antiBloatTriggered: false,
        attempts: 1,
        universalPlayable: safeOptions.codec === 'h264' && (outProbed.pixFmt || plan.pixFmt) === 'yuv420p',
        elapsedMs,
        filename: outFilename,
        mime: plan.outputMime,
        strippedMetadata: safeOptions.stripMetadata,
      };
    }

    const outBuffer = await fs.readFile(outputPath);
    if (outBuffer.length <= 0) {
      throw new Error('Hasil kompresi kosong.');
    }

    return new NextResponse(new Uint8Array(outBuffer), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(outBuffer.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${outFilename.replace(/["\\\r\n]/g, '')}"`,
        'X-MetaScope-Compress-Stats': encodeURIComponent(JSON.stringify(statsPayload)),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return NextResponse.json({ status: 'cancelled', message: 'Kompresi dibatalkan.' }, { status: 499 });
    }
    const isTimeout = (err as { killed?: boolean; signal?: string })?.killed;
    return NextResponse.json(
      {
        status: 'error',
        message: isTimeout
          ? 'Proses kompresi melampaui batas waktu (210 detik). Coba gunakan kecepatan "Cepat" atau codec H.265/HEVC.'
          : 'Gagal mengompres video. Pastikan file video valid dan coba lagi.',
      },
      { status: isTimeout ? 504 : 500 },
    );
  } finally {
    if (encodeSlotAcquired) activeEncodes = Math.max(0, activeEncodes - 1);
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
