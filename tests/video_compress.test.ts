import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildCompressedFilename,
  buildFfmpegArgs,
  buildScaleFilter,
  computeTargetBitratePlan,
  DEFAULT_COMPRESS_OPTIONS,
  parseSsimScore,
  PLATFORM_PRESETS,
  recommendCompressionPlan,
  sanitizeCompressOptions,
  type ProbedVideoInfo,
} from '../src/engine/videoCompress';
import { detectFromMagicBytes } from '../src/engine/magic';

const execFileAsync = promisify(execFile);
const PYTHON_ENGINE = path.resolve(process.cwd(), 'scripts', 'compressor_engine.py');

test('Video Compress Planner: sanitizes untrusted inputs and defaults to AV1 with Anti-Bloat Guard', () => {
  const sanitized = sanitizeCompressOptions({
    codec: 'invalid_codec; rm -rf /' as unknown as 'av1',
    crf: 999,
    targetSizeMb: -50,
    resolution: '9999' as unknown as '1080',
    fps: '999' as unknown as '30',
    audioMode: 'exec' as unknown as 'copy',
    smartDenoise: 'drop table' as unknown as 'auto',
  });

  assert.equal(sanitized.codec, 'av1');
  assert.equal(sanitized.crf, 48); // clamped to AV1 max
  assert.equal(sanitized.targetSizeMb, 0.2); // clamped floor
  assert.equal(sanitized.resolution, 'original');
  assert.equal(sanitized.fps, 'original');
  assert.equal(sanitized.audioMode, 'copy');
  assert.equal(sanitized.tenBit, false);
  assert.equal(sanitized.twoPass, true);
  assert.equal(sanitized.antiBloatGuard, true);
  assert.equal(sanitized.smartDenoise, 'auto');
});

test('Video Compress Planner: calculates target-size bitrate budget and quality warnings accurately', () => {
  const comfortable = computeTargetBitratePlan(10, 60, 'transparent', true, 'hevc');
  assert.ok(comfortable.videoBitrateKbps > 1000 && comfortable.videoBitrateKbps < 1350);
  assert.equal(comfortable.qualityWarning, 'none');

  const extreme = computeTargetBitratePlan(1, 120, 'compact', true, 'h264');
  assert.equal(extreme.qualityWarning, 'extreme');
  assert.ok(extreme.videoBitrateKbps >= 100);
});

test('Video Compress Planner: recommends AV1 for short/medium clips and HEVC 10-bit for long/4K clips with VBV anti-bloat flags', () => {
  const shortClip: ProbedVideoInfo = {
    durationSec: 25,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    audioCodec: 'aac',
    fps: 30,
    bitrateKbps: 6500,
    sizeBytes: 20_000_000,
  };

  const recShort = recommendCompressionPlan(shortClip);
  assert.equal(recShort.codec, 'av1');
  assert.equal(recShort.qualityPreset, 'visually_lossless');
  assert.equal(recShort.tenBit, false);

  const long4k: ProbedVideoInfo = { ...shortClip, width: 3840, height: 2160, durationSec: 180 };
  const rec4k = recommendCompressionPlan(long4k);
  assert.equal(rec4k.codec, 'hevc');
  assert.equal(rec4k.tenBit, true);

  // AV1 default includes TPL + AQ2 + DeltaQ + Constrained Quality VBV cap
  const av1Plan = buildFfmpegArgs('/tmp/in.bin', '/tmp/out.mp4', DEFAULT_COMPRESS_OPTIONS, shortClip);
  assert.ok(av1Plan.args.includes('libaom-av1'));
  assert.ok(av1Plan.args.includes('yuv420p'));
  assert.ok(av1Plan.args.includes('av01'));
  assert.ok(av1Plan.args.some((a) => a.includes('enable-tpl-model=1')));
  assert.ok(av1Plan.vbvMaxrateKbps && av1Plan.vbvMaxrateKbps < shortClip.bitrateKbps);

  // HEVC defaults to 10-bit yuv420p10le + no-sao=1 + aq-mode=3 + VBV maxrate cap
  const hevcPlan = buildFfmpegArgs(
    '/tmp/in.bin',
    '/tmp/out.mp4',
    { ...DEFAULT_COMPRESS_OPTIONS, codec: 'hevc', tenBit: true },
    shortClip,
  );
  assert.ok(hevcPlan.args.includes('libx265'));
  assert.ok(hevcPlan.args.includes('yuv420p10le'));
  assert.ok(hevcPlan.args.includes('hvc1'));
  assert.ok(hevcPlan.args.includes('-maxrate'));
  assert.ok(hevcPlan.args.some((a) => a.includes('no-sao=1')));

  // VP9 WebM with Opus 48kHz stereo
  const vp9Plan = buildFfmpegArgs('/tmp/in.bin', '/tmp/out.webm', { ...DEFAULT_COMPRESS_OPTIONS, codec: 'vp9' }, shortClip);
  assert.ok(vp9Plan.args.includes('libvpx-vp9'));
  assert.equal(vp9Plan.outputExt, 'webm');
  assert.equal(vp9Plan.args[vp9Plan.args.indexOf('-c:a') + 1], 'libopus');
  assert.equal(vp9Plan.args[vp9Plan.args.indexOf('-ar') + 1], '48000');

  // True 2-Pass Target Size encoding for H.264
  const twoPassPlan = buildFfmpegArgs(
    '/tmp/in.bin',
    '/tmp/out.mp4',
    {
      ...DEFAULT_COMPRESS_OPTIONS,
      codec: 'h264',
      mode: 'custom',
      customRateControl: 'target_size',
      targetSizeMb: 4,
      twoPass: true,
    },
    shortClip,
    '/tmp/passlog',
  );
  assert.equal(twoPassPlan.usesTwoPass, true);
  assert.ok(twoPassPlan.pass1Args?.includes('/dev/null'));
  assert.ok(twoPassPlan.pass1Args?.includes('-pass') && twoPassPlan.pass1Args.includes('1'));
  assert.ok(twoPassPlan.pass2Args?.includes('-pass') && twoPassPlan.pass2Args.includes('2'));

  assert.equal(buildCompressedFilename('my clip (1).mov', 'av1', 'mp4'), 'my_clip__1__av1_compressed.mp4');
});

test('Video Compress Planner: parseSsimScore extracts accurate 0..100 percentage from FFmpeg stderr', () => {
  assert.equal(parseSsimScore('[Parsed_ssim_2 @ 0x1] SSIM Y:0.991234 U:0.995111 V:0.994222 All:0.992345 (21.16)'), 99.2);
  assert.equal(parseSsimScore('SSIM All:1.000000 (inf)'), 100);
  assert.equal(parseSsimScore('no ssim metric here'), null);
});

test('Video Compress Planner: orientation-aware buildScaleFilter preserves portrait 9:16 short edge & normalizes SAR', () => {
  assert.equal(buildScaleFilter('original', 1080, 1920), 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1');

  const portrait1080 = buildScaleFilter('1080', 1080, 1920);
  assert.ok(portrait1080.includes("scale='min(iw,1080)':-2"), `Expected iw constraint for portrait, got ${portrait1080}`);
  assert.ok(portrait1080.includes('setsar=1'));

  const landscape1080 = buildScaleFilter('1080', 3840, 2160);
  assert.ok(landscape1080.includes("scale=-2:'min(ih,1080)'"), `Expected ih constraint for landscape, got ${landscape1080}`);
  assert.ok(landscape1080.includes('setsar=1'));
});

test('Video Compress Planner: all 6 Platform Media Presets produce valid FFmpeg arguments with Anti-Bloat active', () => {
  assert.equal(PLATFORM_PRESETS.length, 6);

  const portrait4k: ProbedVideoInfo = {
    durationSec: 25,
    width: 2160,
    height: 3840,
    videoCodec: 'hevc',
    audioCodec: 'aac',
    fps: 60,
    bitrateKbps: 18000,
    sizeBytes: 56_000_000,
  };

  for (const preset of PLATFORM_PRESETS) {
    const merged = sanitizeCompressOptions({ ...DEFAULT_COMPRESS_OPTIONS, ...preset.apply(portrait4k) });
    assert.equal(merged.platformPreset, preset.id);
    assert.equal(merged.antiBloatGuard, true);
    const plan = buildFfmpegArgs('/tmp/in.mov', `/tmp/out.${merged.codec === 'vp9' ? 'webm' : 'mp4'}`, merged, portrait4k, '/tmp/p');
    assert.ok(plan.args.includes('-vf'), `Preset ${preset.id} must include video filter`);
    assert.ok(plan.args.includes('-threads'), `Preset ${preset.id} must include multithreading`);
    if (preset.id === 'social_reels') {
      assert.equal(merged.resolution, '1080');
      const vf = plan.args[plan.args.indexOf('-vf') + 1];
      assert.ok(vf.includes("scale='min(iw,1080)':-2"), 'Reels preset must scale portrait by width');
    }
    if (preset.id === 'whatsapp') {
      assert.equal(merged.customRateControl, 'target_size');
      assert.equal(merged.targetSizeMb, 14);
      assert.equal(plan.usesTwoPass, true);
    }
  }
});

test('Universal Magic Bytes: detects MPEG-TS, M2TS, FLV, WMV, WMA, JPEG XL, PSD, ICO, AAC ADTS, and RAR', () => {
  const ts = new Uint8Array(400);
  ts[0] = 0x47; ts[188] = 0x47; ts[376] = 0x47;
  assert.equal(detectFromMagicBytes(ts, 'broadcast.ts').type, 'MPEG-TS Video');

  const m2ts = new Uint8Array(400);
  m2ts[4] = 0x47; m2ts[196] = 0x47; m2ts[388] = 0x47;
  assert.equal(detectFromMagicBytes(m2ts, 'bluray.m2ts').type, 'MPEG-2 TS (M2TS)');

  const flv = new Uint8Array([0x46, 0x4c, 0x56, 0x01, 0x05]);
  assert.equal(detectFromMagicBytes(flv, 'stream.flv').type, 'FLV Video');

  const asf = new Uint8Array([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectFromMagicBytes(asf, 'clip.wmv').type, 'WMV Video (ASF)');
  assert.equal(detectFromMagicBytes(asf, 'track.wma').type, 'WMA Audio (ASF)');

  const jxl = new Uint8Array([0xff, 0x0a, 0x00, 0x00]);
  assert.equal(detectFromMagicBytes(jxl, 'photo.jxl').type, 'JPEG XL');

  const psd = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
  assert.equal(detectFromMagicBytes(psd, 'design.psd').type, 'Photoshop PSD');

  const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00]);
  assert.equal(detectFromMagicBytes(ico, 'favicon.ico').type, 'ICO');

  const aac = new Uint8Array([0xff, 0xf1, 0x50, 0x80]);
  assert.equal(detectFromMagicBytes(aac, 'voice.aac').type, 'AAC Audio (ADTS)');

  const rar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01]);
  assert.equal(detectFromMagicBytes(rar, 'bundle.rar').type, 'RAR Archive');
});

test('Python 5-Stage Anti-Bloat Engine: crushes already-compressed grainy H.264 with ZERO bloat (AV1 + HEVC 10-bit + H.264 Guard)', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metascope_py_bloat_'));
  try {
    const srcPath = path.join(workDir, 'grain_h264.mp4');
    // Already-compressed grainy 720p H.264 (classic bloat trap for naive CRF 18!)
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=2,noise=alls=8:allf=t',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      srcPath,
    ]);

    // 1) AV1 Flagship Default -> must shrink >35% with high SSIM & PSNR
    const av1Work = path.join(workDir, 'w_av1');
    await fs.mkdir(av1Work);
    const av1Out = path.join(av1Work, 'out_av1.mp4');
    const av1Run = await execFileAsync(
      'python3',
      [
        PYTHON_ENGINE,
        '--input', srcPath,
        '--output', av1Out,
        '--workdir', av1Work,
        '--options-json', JSON.stringify({ ...DEFAULT_COMPRESS_OPTIONS, codec: 'av1', speedEffort: 'balanced' }),
      ],
      { timeout: 60_000 },
    );
    const av1Res = JSON.parse(av1Run.stdout.trim()) as {
      compressedSize: number;
      originalSize: number;
      reductionPercent: number;
      compressedCodec: string;
      ssimPercent: number;
      psnrDb: number;
      stages: unknown[];
    };
    assert.equal(av1Res.compressedCodec, 'av1');
    assert.ok(av1Res.compressedSize < av1Res.originalSize * 0.7, `Expected AV1 >30% shrink on grainy H.264, got ${av1Res.reductionPercent}%`);
    assert.ok(av1Res.ssimPercent >= 95, `Expected SSIM >= 95%, got ${av1Res.ssimPercent}`);
    assert.ok(av1Res.psnrDb >= 38, `Expected PSNR >= 38 dB, got ${av1Res.psnrDb}`);
    assert.ok(av1Res.stages.length >= 4);

    // 2) H.265 / HEVC 10-bit -> must shrink >30% with yuv420p10le
    const hevcWork = path.join(workDir, 'w_hevc');
    await fs.mkdir(hevcWork);
    const hevcOut = path.join(hevcWork, 'out_hevc.mp4');
    const hevcRun = await execFileAsync(
      'python3',
      [
        PYTHON_ENGINE,
        '--input', srcPath,
        '--output', hevcOut,
        '--workdir', hevcWork,
        '--options-json', JSON.stringify({ ...DEFAULT_COMPRESS_OPTIONS, codec: 'hevc', tenBit: true, speedEffort: 'fast' }),
      ],
      { timeout: 60_000 },
    );
    const hevcRes = JSON.parse(hevcRun.stdout.trim()) as {
      compressedSize: number;
      originalSize: number;
      compressedCodec: string;
      pixFmt: string;
      ssimPercent: number;
    };
    assert.equal(hevcRes.compressedCodec, 'hevc');
    assert.equal(hevcRes.pixFmt, 'yuv420p10le');
    assert.ok(hevcRes.compressedSize < hevcRes.originalSize * 0.72);
    assert.ok(hevcRes.ssimPercent >= 95);

    // 3) H.264 with Anti-Bloat Guard -> MUST NOT bloat (previously bloated +35.4%!)
    const h264Work = path.join(workDir, 'w_h264');
    await fs.mkdir(h264Work);
    const h264Out = path.join(h264Work, 'out_h264.mp4');
    const h264Run = await execFileAsync(
      'python3',
      [
        PYTHON_ENGINE,
        '--input', srcPath,
        '--output', h264Out,
        '--workdir', h264Work,
        '--options-json', JSON.stringify({ ...DEFAULT_COMPRESS_OPTIONS, codec: 'h264', speedEffort: 'fast' }),
      ],
      { timeout: 60_000 },
    );
    const h264Res = JSON.parse(h264Run.stdout.trim()) as {
      compressedSize: number;
      originalSize: number;
      reductionPercent: number;
      antiBloatTriggered: boolean;
      ssimPercent: number;
    };
    assert.ok(
      h264Res.compressedSize < h264Res.originalSize * 0.8,
      `H.264 Anti-Bloat Guard must shrink grainy H.264 >20%, got ${h264Res.reductionPercent}%`,
    );
    assert.ok(h264Res.ssimPercent >= 95);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Python 5-Stage Engine: true 2-Pass Custom Target Size (MB) & Portrait 9:16 stay accurate and vertical', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metascope_py_2pass_'));
  try {
    const srcPath = path.join(workDir, 'vert.mp4');
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      srcPath,
    ]);

    const w2 = path.join(workDir, 'w2');
    await fs.mkdir(w2);
    const outPath = path.join(w2, 'out_2pass.mp4');
    const run = await execFileAsync(
      'python3',
      [
        PYTHON_ENGINE,
        '--input', srcPath,
        '--output', outPath,
        '--workdir', w2,
        '--options-json', JSON.stringify({
          ...DEFAULT_COMPRESS_OPTIONS,
          codec: 'h264',
          mode: 'custom',
          customRateControl: 'target_size',
          targetSizeMb: 0.4,
          twoPass: true,
          resolution: '480',
          speedEffort: 'fast',
        }),
      ],
      { timeout: 60_000 },
    );
    const res = JSON.parse(run.stdout.trim()) as {
      usesTwoPass: boolean;
      width: number;
      height: number;
      compressedSize: number;
    };
    assert.equal(res.usesTwoPass, true);
    assert.equal(res.width, 480);
    assert.ok(res.height > res.width, `Expected portrait 9:16 output, got ${res.width}x${res.height}`);
    assert.ok(res.compressedSize > 10_000 && res.compressedSize < 520_000);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});
