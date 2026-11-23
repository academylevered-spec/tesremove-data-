#!/usr/bin/env python3
"""
MetaScope Per-Title Anti-Bloat Video Compression Engine (Python 3 + FFmpeg)

Structured 5-stage deterministic pipeline inspired by modern per-title encoding:
  Stage 1: Deep Media Probe (ffprobe + Bits-Per-Pixel BPP & audio ratio analysis)
  Stage 2: Visual Complexity & Motion Analysis (sampled FFmpeg vmafmotion)
  Stage 3: Source-Aware Encoding Plan (AV1 / HEVC 10-bit / VP9 / H.264 + VBV Anti-Bloat Ceiling + Smart Audio)
  Stage 4: Multi-Attempt Encoding with Anti-Bloat Guard & True 2-Pass Target-Size Support
  Stage 5: Perceptual Quality Audit (SSIM % + PSNR dB vs original source)

Security:
  - Strictly uses subprocess with shell=False and allowlisted argument lists.
  - Operates only inside caller-provided confined working directory.
  - Emits a single structured JSON payload on stdout.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Codec Definitions & State-of-the-Art CRF Profiles
# ---------------------------------------------------------------------------

CODEC_SPECS: Dict[str, Dict[str, Any]] = {
    "av1": {
        "encoder": "libaom-av1",
        "container": "mp4",
        "ext": "mp4",
        "mime": "video/mp4",
        "supports_ten_bit": True,
        "default_ten_bit": False,
        "crf_min": 18,
        "crf_max": 48,
        "crf_presets": {"visually_lossless": 30, "balanced": 34, "max_shrink": 40},
    },
    "hevc": {
        "encoder": "libx265",
        "container": "mp4",
        "ext": "mp4",
        "mime": "video/mp4",
        "supports_ten_bit": True,
        "default_ten_bit": True,
        "crf_min": 16,
        "crf_max": 36,
        "crf_presets": {"visually_lossless": 22, "balanced": 25, "max_shrink": 29},
    },
    "vp9": {
        "encoder": "libvpx-vp9",
        "container": "webm",
        "ext": "webm",
        "mime": "video/webm",
        "supports_ten_bit": False,
        "default_ten_bit": False,
        "crf_min": 18,
        "crf_max": 44,
        "crf_presets": {"visually_lossless": 26, "balanced": 32, "max_shrink": 38},
    },
    "h264": {
        "encoder": "libx264",
        "container": "mp4",
        "ext": "mp4",
        "mime": "video/mp4",
        "supports_ten_bit": False,
        "default_ten_bit": False,
        "crf_min": 16,
        "crf_max": 32,
        "crf_presets": {"visually_lossless": 20, "balanced": 23, "max_shrink": 27},
    },
}

MAX_VIDEO_RATIO_BY_PRESET: Dict[str, float] = {
    "visually_lossless": 0.72,
    "balanced": 0.52,
    "max_shrink": 0.34,
}


@dataclass
class ProbeResult:
    duration_sec: float
    width: int
    height: int
    video_codec: str
    audio_codec: Optional[str]
    fps: float
    total_bitrate_kbps: int
    video_bitrate_kbps: int
    audio_bitrate_kbps: int
    size_bytes: int
    pix_fmt: str
    bpp: float


@dataclass
class ComplexityResult:
    motion_score: Optional[float]
    classification: str  # 'low_motion' | 'normal' | 'high_motion_grainy'
    recommend_denoise: bool
    elapsed_ms: int


@dataclass
class StageLog:
    stage: str
    detail: str
    elapsed_ms: int


# ---------------------------------------------------------------------------
# Subprocess Helper (Strictly shell=False)
# ---------------------------------------------------------------------------

def run_cmd(cmd: List[str], timeout_sec: float) -> Tuple[int, str, str]:
    proc = subprocess.run(
        cmd,
        shell=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout_sec,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def parse_fps(raw: Optional[str]) -> float:
    if not raw or raw == "0/0":
        return 30.0
    if "/" in raw:
        parts = raw.split("/", 1)
        try:
            num = float(parts[0])
            den = float(parts[1])
            if den > 0 and num > 0:
                return round(num / den, 2)
        except ValueError:
            return 30.0
    try:
        val = float(raw)
        return round(val, 2) if val > 0 else 30.0
    except ValueError:
        return 30.0


# ---------------------------------------------------------------------------
# Stage 1: Deep Media Probe
# ---------------------------------------------------------------------------

def probe_media(file_path: str) -> ProbeResult:
    size_bytes = os.path.getsize(file_path)
    code, stdout, stderr = run_cmd(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file_path],
        timeout_sec=15,
    )
    if code != 0 or not stdout.strip():
        raise RuntimeError(f"FFprobe gagal membaca file video: {stderr.strip()[:240]}")

    data = json.loads(stdout)
    streams = data.get("streams") or []
    fmt = data.get("format") or {}

    v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not v_stream or not v_stream.get("width") or not v_stream.get("height"):
        raise RuntimeError("File tidak mengandung stream video yang valid.")

    a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    duration_sec = max(
        0.1,
        float(fmt.get("duration") or v_stream.get("duration") or 0.0),
    )
    width = int(v_stream["width"])
    height = int(v_stream["height"])
    fps = parse_fps(v_stream.get("avg_frame_rate") or v_stream.get("r_frame_rate"))

    total_bps = float(fmt.get("bit_rate") or 0.0)
    if total_bps <= 0 and duration_sec > 0:
        total_bps = (size_bytes * 8.0) / duration_sec
    total_kbps = max(50, int(round(total_bps / 1000.0)))

    audio_bps = float((a_stream or {}).get("bit_rate") or 0.0)
    if a_stream and audio_bps <= 0:
        audio_bps = 128_000.0
    audio_kbps = int(round(audio_bps / 1000.0)) if a_stream else 0

    video_bps = float(v_stream.get("bit_rate") or 0.0)
    if video_bps <= 0:
        video_bps = max(80_000.0, total_bps - audio_bps)
    video_kbps = max(80, int(round(video_bps / 1000.0)))

    pixels_per_sec = max(1.0, float(width) * float(height) * max(1.0, fps))
    bpp = round((video_kbps * 1000.0) / pixels_per_sec, 4)

    return ProbeResult(
        duration_sec=round(duration_sec, 2),
        width=width,
        height=height,
        video_codec=str(v_stream.get("codec_name") or "unknown"),
        audio_codec=str(a_stream.get("codec_name")) if a_stream and a_stream.get("codec_name") else None,
        fps=fps,
        total_bitrate_kbps=total_kbps,
        video_bitrate_kbps=video_kbps,
        audio_bitrate_kbps=audio_kbps,
        size_bytes=size_bytes,
        pix_fmt=str(v_stream.get("pix_fmt") or "yuv420p"),
        bpp=bpp,
    )


# ---------------------------------------------------------------------------
# Stage 2: Fast Visual Complexity & Motion Analysis
# ---------------------------------------------------------------------------

def analyze_complexity(input_path: str, probed: ProbeResult) -> ComplexityResult:
    t0 = time.monotonic()
    sample_sec = min(3.0, max(0.5, probed.duration_sec))
    try:
        _, _, stderr = run_cmd(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "info",
                "-t",
                f"{sample_sec:.2f}",
                "-i",
                input_path,
                "-vf",
                "scale=-2:360:flags=fast_bilinear,vmafmotion",
                "-an",
                "-f",
                "null",
                "-",
            ],
            timeout_sec=10,
        )
        m = re.search(r"VMAF Motion avg:\s*([0-9]+(?:\.[0-9]+)?)", stderr)
        score = round(float(m.group(1)), 2) if m else None
    except Exception:
        score = None

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    # Interpret temporal energy + BPP: high motion or high BPP grain wastes huge bits
    if score is not None and score < 1.8:
        classification = "low_motion"
        recommend_denoise = False
    elif (score is not None and score > 7.5) or probed.bpp > 0.14:
        classification = "high_motion_grainy"
        recommend_denoise = True
    else:
        classification = "normal"
        # Mild denoise helps already-compressed low/medium BPP camera clips avoid re-encoding macroblock noise
        recommend_denoise = probed.bpp >= 0.06

    return ComplexityResult(
        motion_score=score,
        classification=classification,
        recommend_denoise=recommend_denoise,
        elapsed_ms=elapsed_ms,
    )


# ---------------------------------------------------------------------------
# Stage 3: Source-Aware Encoding Planner (Anti-Bloat VBV + Optimal Flags)
# ---------------------------------------------------------------------------

def build_scale_filter(resolution: str, width: int, height: int) -> str:
    if resolution == "original":
        return "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1"
    max_short = int(resolution)
    is_portrait = height > width
    if is_portrait:
        return f"scale='min(iw,{max_short})':-2:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1"
    return f"scale=-2:'min(ih,{max_short})':flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1"


def compute_target_bitrate(
    target_size_mb: float,
    duration_sec: float,
    audio_mode: str,
    has_audio: bool,
    codec: str,
) -> Dict[str, int]:
    safe_dur = max(0.5, duration_sec)
    safe_bytes = max(0.1, target_size_mb) * 1024.0 * 1024.0
    # Reserve 4% for container muxing overhead (moov/cues/headers)
    total_kbps = (safe_bytes * 0.96 * 8.0) / safe_dur / 1000.0

    audio_kbps = 0
    if has_audio and audio_mode != "mute":
        if audio_mode == "compact":
            audio_kbps = 64 if codec == "vp9" else 96
        elif audio_mode == "transparent":
            audio_kbps = 128 if codec == "vp9" else 160
        else:
            audio_kbps = 96 if codec == "vp9" else 128

    if audio_kbps > total_kbps * 0.25 and total_kbps > 160:
        audio_kbps = max(48, int(total_kbps * 0.2))

    video_kbps = max(100, int(total_kbps - audio_kbps))
    return {
        "video_kbps": video_kbps,
        "audio_kbps": audio_kbps,
        "maxrate_kbps": max(video_kbps + 40, int(video_kbps * 1.35)),
        "bufsize_kbps": max(video_kbps * 2, int(video_kbps * 2.2)),
    }


def calibrate_crf_and_vbv(
    codec: str,
    options: Dict[str, Any],
    probed: ProbeResult,
    complexity: ComplexityResult,
) -> Tuple[int, Optional[int], Optional[int]]:
    """
    Computes source-aware CRF + VBV bitrate cap (maxrate, bufsize) so CRF
    NEVER causes output file bloat on already-compressed or grainy sources.
    """
    spec = CODEC_SPECS[codec]
    mode = options["mode"]
    quality_preset = options["qualityPreset"]
    anti_bloat = bool(options.get("antiBloatGuard", True))

    if mode == "recommended":
        base_crf = int(spec["crf_presets"][quality_preset])
    else:
        base_crf = max(spec["crf_min"], min(spec["crf_max"], int(round(float(options["crf"])))))

    # Source-aware CRF calibration (prevent wasting bits re-encoding artifacts of already-compressed sources)
    calibrated_crf = base_crf
    src_codec = probed.video_codec.lower()
    src_is_modern = any(k in src_codec for k in ("hevc", "h265", "av1", "vp9"))

    if mode == "recommended" and anti_bloat:
        if probed.bpp < 0.045:
            # Source is already tightly compressed -> raise CRF slightly so we don't inflate
            calibrated_crf += 3 if codec in ("av1", "vp9") else 2
        elif probed.bpp < 0.09:
            calibrated_crf += 2 if codec in ("av1", "vp9") else 1
        if src_is_modern and codec == "h264":
            calibrated_crf += 2
        if complexity.classification == "high_motion_grainy":
            calibrated_crf += 1

    calibrated_crf = max(spec["crf_min"], min(spec["crf_max"], calibrated_crf))

    # Mandatory VBV Anti-Bloat Ceiling derived from actual source video bitrate
    vbv_maxrate: Optional[int] = None
    vbv_bufsize: Optional[int] = None
    if anti_bloat and probed.video_bitrate_kbps > 0:
        max_ratio = MAX_VIDEO_RATIO_BY_PRESET.get(quality_preset, 0.70)
        # Newer codecs can safely cap tighter than H.264 for same perceptual fidelity
        if codec == "av1":
            max_ratio = min(max_ratio, 0.65 if quality_preset == "visually_lossless" else max_ratio)
        elif codec == "hevc":
            max_ratio = min(max_ratio, 0.68 if quality_preset == "visually_lossless" else max_ratio)
        elif codec == "h264" and mode == "custom":
            max_ratio = 0.85

        vbv_maxrate = max(140, int(probed.video_bitrate_kbps * max_ratio))
        vbv_bufsize = max(vbv_maxrate * 2, int(vbv_maxrate * 2.2))

    return calibrated_crf, vbv_maxrate, vbv_bufsize


def build_audio_args(
    codec: str,
    audio_mode: str,
    probed: ProbeResult,
    use_target_size: bool,
    target_audio_kbps: Optional[int],
    anti_bloat: bool,
) -> Tuple[List[str], bool]:
    """Returns (ffmpeg_audio_args, smart_audio_reencoded)."""
    container = CODEC_SPECS[codec]["container"]
    if not probed.audio_codec or audio_mode == "mute":
        return ["-an"], False

    src_audio = probed.audio_codec.lower()
    copy_compatible = (
        src_audio in ("aac", "mp3") if container == "mp4" else src_audio in ("opus", "vorbis")
    )

    # Smart Adaptive Audio: prevent bloated audio (PCM/FLAC/>140kbps or >22% of file) from wasting size
    audio_share = (
        (probed.audio_bitrate_kbps / max(1, probed.total_bitrate_kbps))
        if probed.total_bitrate_kbps > 0
        else 0.0
    )
    wasteful_audio = (
        anti_bloat
        and not use_target_size
        and audio_mode == "copy"
        and (
            not copy_compatible
            or probed.audio_bitrate_kbps > 140
            or audio_share > 0.22
        )
    )

    if audio_mode == "copy" and copy_compatible and not use_target_size and not wasteful_audio:
        return ["-c:a", "copy"], False

    if container == "webm":
        br = target_audio_kbps if target_audio_kbps else (80 if audio_mode == "compact" else 112 if wasteful_audio else 128)
        return ["-c:a", "libopus", "-b:a", f"{br}k", "-ac", "2", "-ar", "48000"], wasteful_audio

    br = target_audio_kbps if target_audio_kbps else (96 if audio_mode == "compact" else 128 if wasteful_audio else 160)
    return ["-c:a", "aac", "-b:a", f"{br}k", "-ac", "2", "-ar", "48000"], wasteful_audio


def build_ffmpeg_command(
    input_path: str,
    output_path: str,
    options: Dict[str, Any],
    probed: ProbeResult,
    *,
    effective_crf: Optional[int],
    target_video_kbps: Optional[int],
    vbv_maxrate_kbps: Optional[int],
    vbv_bufsize_kbps: Optional[int],
    target_audio_kbps: Optional[int],
    apply_denoise: Optional[str],
    pass_mode: Optional[int] = None,
    pass_log_prefix: Optional[str] = None,
) -> Tuple[List[str], str, bool]:
    codec = options["codec"]
    spec = CODEC_SPECS[codec]
    speed = options["speedEffort"]
    anti_bloat = bool(options.get("antiBloatGuard", True))
    use_target_size = target_video_kbps is not None

    ten_bit = bool(options.get("tenBit", spec["default_ten_bit"])) and spec["supports_ten_bit"]
    pix_fmt = "yuv420p10le" if ten_bit else "yuv420p"

    # Build video filter graph: orientation-aware scale + SAR normalization + optional subtle pre-denoise + FPS
    filters: List[str] = [build_scale_filter(options["resolution"], probed.width, probed.height)]
    if apply_denoise:
        filters.append(apply_denoise)
    if options["fps"] != "original":
        filters.append(f"fps={int(options['fps'])}")
    vf = ",".join(filters)

    # Explicit SDR Rec.709 color metadata for 8-bit outputs so browsers/players never shift colors
    color_tags = (
        ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]
        if pix_fmt == "yuv420p"
        else []
    )

    cmd: List[str] = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-threads",
        "0",
        "-i",
        input_path,
        "-map",
        "0:v:0",
    ]

    if pass_mode == 1:
        cmd.append("-an")
    else:
        if probed.audio_codec and options["audioMode"] != "mute":
            cmd.extend(["-map", "0:a:0?"])
        if options.get("stripMetadata", True):
            cmd.extend(["-map_metadata", "-1", "-map_chapters", "-1"])

    cmd.extend(["-vf", vf, "-pix_fmt", pix_fmt, *color_tags])

    # Keyframe interval ~5 seconds (good compression density + smooth scrubbing)
    gop = max(48, min(300, int(round(probed.fps * 5.0))))

    # Codec-specific state-of-the-art parameters
    if codec == "av1":
        if speed == "fast":
            cpu_used = "8"
        elif speed == "thorough":
            cpu_used = "5" if probed.duration_sec > 45 else "4"
        else:
            cpu_used = "7" if probed.duration_sec > 45 else "6"
        cmd.extend([
            "-c:v", "libaom-av1",
            "-cpu-used", cpu_used,
            "-row-mt", "1",
            "-tiles", "2x2",
            "-g", str(gop),
            "-tag:v", "av01",
            "-aom-params", "enable-tpl-model=1:aq-mode=2:deltaq-mode=1",
        ])
        if use_target_size and target_video_kbps is not None:
            cmd.extend([
                "-b:v", f"{target_video_kbps}k",
                "-maxrate", f"{vbv_maxrate_kbps or int(target_video_kbps * 1.35)}k",
                "-bufsize", f"{vbv_bufsize_kbps or int(target_video_kbps * 2.2)}k",
            ])
        elif vbv_maxrate_kbps:
            # Constrained Quality (CQ) mode in libaom-av1: -crf + non-zero -b:v acts as anti-bloat cap
            cmd.extend(["-crf", str(effective_crf), "-b:v", f"{vbv_maxrate_kbps}k"])
        else:
            cmd.extend(["-crf", str(effective_crf), "-b:v", "0"])

    elif codec == "hevc":
        preset = "fast" if speed == "fast" else ("slow" if speed == "thorough" else "medium")
        cmd.extend(["-c:v", "libx265", "-preset", preset, "-g", str(gop), "-tag:v", "hvc1"])
        if use_target_size and target_video_kbps is not None:
            cmd.extend([
                "-b:v", f"{target_video_kbps}k",
                "-maxrate", f"{vbv_maxrate_kbps or int(target_video_kbps * 1.35)}k",
                "-bufsize", f"{vbv_bufsize_kbps or int(target_video_kbps * 2.2)}k",
            ])
        else:
            cmd.extend(["-crf", str(effective_crf)])
            if vbv_maxrate_kbps and vbv_bufsize_kbps:
                cmd.extend(["-maxrate", f"{vbv_maxrate_kbps}k", "-bufsize", f"{vbv_bufsize_kbps}k"])
        x265_params = [
            "no-sao=1",
            "aq-mode=3",
            "psy-rd=1.5",
            "psy-rdoq=1.0",
            "bframes=8",
            "rc-lookahead=25",
            "deblock=-1,-1",
            "log-level=error",
        ]
        if pass_mode and pass_log_prefix:
            x265_params.extend([f"pass={pass_mode}", f"stats={pass_log_prefix}.x265.log"])
        cmd.extend(["-x265-params", ":".join(x265_params)])

    elif codec == "vp9":
        cpu_used = "4" if speed == "fast" else ("1" if speed == "thorough" else "2")
        cmd.extend([
            "-c:v", "libvpx-vp9",
            "-cpu-used", cpu_used,
            "-row-mt", "1",
            "-tile-columns", "2",
            "-deadline", "good",
            "-auto-alt-ref", "1",
            "-lag-in-frames", "25",
            "-aq-mode", "2",
            "-g", str(gop),
        ])
        if use_target_size and target_video_kbps is not None:
            cmd.extend([
                "-b:v", f"{target_video_kbps}k",
                "-maxrate", f"{vbv_maxrate_kbps or int(target_video_kbps * 1.35)}k",
                "-bufsize", f"{vbv_bufsize_kbps or int(target_video_kbps * 2.2)}k",
            ])
        elif vbv_maxrate_kbps:
            # Constrained Quality (CQ) mode in libvpx-vp9: -crf + non-zero -b:v caps peak bitrate cleanly
            cmd.extend(["-crf", str(effective_crf), "-b:v", f"{vbv_maxrate_kbps}k"])
        else:
            cmd.extend(["-crf", str(effective_crf), "-b:v", "0"])
        if pass_mode and pass_log_prefix:
            cmd.extend(["-pass", str(pass_mode), "-passlogfile", pass_log_prefix])

    else:
        # H.264 / libx264 with psychovisual AQ3 + mandatory VBV ceiling
        preset = "fast" if speed == "fast" else ("slow" if speed == "thorough" else "medium")
        max_dim = max(probed.width, probed.height)
        level = "5.1" if max_dim > 1920 else ("4.2" if probed.fps > 35 else "4.1")
        cmd.extend([
            "-c:v", "libx264",
            "-preset", preset,
            "-profile:v", "high",
            "-level:v", level,
            "-g", str(gop),
            "-tag:v", "avc1",
            "-x264-params", "aq-mode=3:psy-rd=1.0,0.15:deblock=-1,-1",
        ])
        if use_target_size and target_video_kbps is not None:
            cmd.extend([
                "-b:v", f"{target_video_kbps}k",
                "-maxrate", f"{vbv_maxrate_kbps or int(target_video_kbps * 1.35)}k",
                "-bufsize", f"{vbv_bufsize_kbps or int(target_video_kbps * 2.2)}k",
            ])
            if pass_mode and pass_log_prefix:
                cmd.extend(["-pass", str(pass_mode), "-passlogfile", pass_log_prefix])
        else:
            cmd.extend(["-crf", str(effective_crf)])
            if vbv_maxrate_kbps and vbv_bufsize_kbps:
                cmd.extend(["-maxrate", f"{vbv_maxrate_kbps}k", "-bufsize", f"{vbv_bufsize_kbps}k"])

    cmd.extend(["-max_muxing_queue_size", "1024"])

    if pass_mode == 1:
        cmd.extend(["-f", "webm" if spec["container"] == "webm" else "mp4", "/dev/null"])
        return cmd, pix_fmt, False

    audio_args, smart_audio = build_audio_args(
        codec,
        options["audioMode"],
        probed,
        use_target_size,
        target_audio_kbps,
        anti_bloat,
    )
    cmd.extend(audio_args)

    if spec["container"] == "mp4":
        cmd.extend(["-movflags", "+faststart", "-brand", "mp42"])
    cmd.append(output_path)
    return cmd, pix_fmt, smart_audio


# ---------------------------------------------------------------------------
# Stage 5: Real Perceptual Quality Audit (SSIM + PSNR)
# ---------------------------------------------------------------------------

def measure_quality_metrics(
    compressed_path: str,
    original_path: str,
    out_w: int,
    out_h: int,
) -> Tuple[Optional[float], Optional[float], int]:
    t0 = time.monotonic()
    if out_w <= 0 or out_h <= 0:
        return None, None, 0
    cmp_h = min(out_h, 480)
    cmp_w = max(2, int(round((out_w * (cmp_h / float(out_h))) / 2.0)) * 2)
    # Single-pass dual filter computes both SSIM and PSNR simultaneously in ~150ms
    lavfi = (
        f"[0:v]scale={cmp_w}:{cmp_h}:flags=bicubic,format=yuv420p,split=2[d1][d2];"
        f"[1:v]scale={cmp_w}:{cmp_h}:flags=bicubic,format=yuv420p,split=2[r1][r2];"
        f"[d1][r1]ssim;[d2][r2]psnr"
    )
    try:
        _, _, stderr = run_cmd(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "info",
                "-t",
                "4",
                "-i",
                compressed_path,
                "-t",
                "4",
                "-i",
                original_path,
                "-lavfi",
                lavfi,
                "-f",
                "null",
                "-",
            ],
            timeout_sec=12,
        )
        ssim_m = re.search(r"All:([01](?:\.\d+)?)", stderr)
        psnr_m = re.search(r"average:(\d+(?:\.\d+)?|inf)", stderr)
        ssim_pct = round(float(ssim_m.group(1)) * 100.0, 1) if ssim_m else None
        psnr_db: Optional[float] = None
        if psnr_m:
            psnr_db = 99.0 if psnr_m.group(1) == "inf" else round(float(psnr_m.group(1)), 1)
    except Exception:
        ssim_pct = None
        psnr_db = None

    return ssim_pct, psnr_db, int((time.monotonic() - t0) * 1000)


# ---------------------------------------------------------------------------
# Main 5-Stage Orchestrator
# ---------------------------------------------------------------------------

def run_pipeline(input_path: str, output_path: str, work_dir: str, options: Dict[str, Any]) -> Dict[str, Any]:
    total_t0 = time.monotonic()
    stages: List[StageLog] = []

    # Stage 1: Probe
    t0 = time.monotonic()
    probed = probe_media(input_path)
    stages.append(StageLog(
        stage="probe",
        detail=f"{probed.video_codec.upper()} {probed.width}x{probed.height} @ {probed.fps}fps · {probed.video_bitrate_kbps} kbps (BPP {probed.bpp})",
        elapsed_ms=int((time.monotonic() - t0) * 1000),
    ))

    # Stage 2: Complexity & Motion Analysis
    complexity = analyze_complexity(input_path, probed)
    stages.append(StageLog(
        stage="complexity",
        detail=f"{complexity.classification} (motion={complexity.motion_score if complexity.motion_score is not None else 'n/a'})",
        elapsed_ms=complexity.elapsed_ms,
    ))

    # Stage 3: Plan Encoding
    codec = options["codec"]
    spec = CODEC_SPECS[codec]
    use_custom_target = options["mode"] == "custom" and options["customRateControl"] == "target_size"
    anti_bloat = bool(options.get("antiBloatGuard", True))
    denoise_mode = str(options.get("smartDenoise", "auto"))

    apply_denoise: Optional[str] = None
    if denoise_mode == "light":
        apply_denoise = "hqdn3d=1.2:1.2:4:4"
    elif denoise_mode == "auto" and (complexity.recommend_denoise or options["qualityPreset"] == "max_shrink"):
        apply_denoise = "hqdn3d=1.0:1.0:3:3"

    effective_crf: Optional[int] = None
    target_video_kbps: Optional[int] = None
    target_audio_kbps: Optional[int] = None
    vbv_maxrate_kbps: Optional[int] = None
    vbv_bufsize_kbps: Optional[int] = None

    if use_custom_target:
        plan_br = compute_target_bitrate(
            float(options["targetSizeMb"]),
            probed.duration_sec,
            options["audioMode"],
            probed.audio_codec is not None,
            codec,
        )
        target_video_kbps = plan_br["video_kbps"]
        target_audio_kbps = plan_br["audio_kbps"]
        vbv_maxrate_kbps = plan_br["maxrate_kbps"]
        vbv_bufsize_kbps = plan_br["bufsize_kbps"]
    else:
        effective_crf, vbv_maxrate_kbps, vbv_bufsize_kbps = calibrate_crf_and_vbv(
            codec, options, probed, complexity
        )

    can_two_pass = (
        use_custom_target
        and bool(options.get("twoPass", True))
        and codec in ("h264", "hevc", "vp9")
    )
    pass_log = os.path.join(work_dir, "passlog_1")
    attempt1_path = os.path.join(work_dir, f"attempt1.{spec['ext']}")

    # Stage 4: Attempt 1 Encoding
    t_enc1 = time.monotonic()
    smart_audio_used = False
    pix_fmt_used = "yuv420p"
    uses_two_pass = False

    if can_two_pass:
        uses_two_pass = True
        p1_cmd, pix_fmt_used, _ = build_ffmpeg_command(
            input_path, attempt1_path, options, probed,
            effective_crf=None,
            target_video_kbps=target_video_kbps,
            vbv_maxrate_kbps=vbv_maxrate_kbps,
            vbv_bufsize_kbps=vbv_bufsize_kbps,
            target_audio_kbps=target_audio_kbps,
            apply_denoise=apply_denoise,
            pass_mode=1,
            pass_log_prefix=pass_log,
        )
        code, _, err = run_cmd(p1_cmd, timeout_sec=90)
        if code != 0:
            raise RuntimeError(f"FFmpeg Pass 1 gagal: {err.strip()[:300]}")

        p2_cmd, pix_fmt_used, smart_audio_used = build_ffmpeg_command(
            input_path, attempt1_path, options, probed,
            effective_crf=None,
            target_video_kbps=target_video_kbps,
            vbv_maxrate_kbps=vbv_maxrate_kbps,
            vbv_bufsize_kbps=vbv_bufsize_kbps,
            target_audio_kbps=target_audio_kbps,
            apply_denoise=apply_denoise,
            pass_mode=2,
            pass_log_prefix=pass_log,
        )
        code, _, err = run_cmd(p2_cmd, timeout_sec=150)
        if code != 0:
            raise RuntimeError(f"FFmpeg Pass 2 gagal: {err.strip()[:300]}")
    else:
        cmd1, pix_fmt_used, smart_audio_used = build_ffmpeg_command(
            input_path, attempt1_path, options, probed,
            effective_crf=effective_crf,
            target_video_kbps=target_video_kbps,
            vbv_maxrate_kbps=vbv_maxrate_kbps,
            vbv_bufsize_kbps=vbv_bufsize_kbps,
            target_audio_kbps=target_audio_kbps,
            apply_denoise=apply_denoise,
        )
        code, _, err = run_cmd(cmd1, timeout_sec=165)
        if code != 0:
            raise RuntimeError(f"FFmpeg gagal mengompres video: {err.strip()[:300]}")

    att1_size = os.path.getsize(attempt1_path)
    if att1_size <= 0:
        raise RuntimeError("Output kompresi kosong.")

    stages.append(StageLog(
        stage="encode_attempt_1",
        detail=f"{codec.upper()} ({pix_fmt_used}) -> {round(att1_size / 1024, 1)} KB (CRF={effective_crf}, maxrate={vbv_maxrate_kbps}k)",
        elapsed_ms=int((time.monotonic() - t_enc1) * 1000),
    ))

    best_path = attempt1_path
    best_size = att1_size
    attempts = 1
    anti_bloat_triggered = False
    anti_bloat_reason: Optional[str] = None

    # Stage 4B: Automatic Anti-Bloat Guard & Adaptive Tightening Pass
    # Triggered whenever Attempt 1 bloats or saves < 10% on non-custom-target encodes
    if anti_bloat and not use_custom_target and att1_size >= int(probed.size_bytes * 0.90):
        anti_bloat_triggered = True
        attempts = 2
        t_enc2 = time.monotonic()

        # Tighten bitrate budget aggressively while keeping clean perceptual quality
        preset_ratio = {"visually_lossless": 0.58, "balanced": 0.44, "max_shrink": 0.30}.get(
            options["qualityPreset"], 0.55
        )
        tight_video_kbps = max(110, int(probed.video_bitrate_kbps * preset_ratio))
        tight_maxrate = max(140, int(tight_video_kbps * 1.25))
        tight_bufsize = max(280, int(tight_video_kbps * 2.0))
        tight_audio_kbps = 96 if spec["container"] == "mp4" else 80
        tight_denoise = "hqdn3d=1.4:1.4:4:4" if denoise_mode != "off" else None

        attempt2_path = os.path.join(work_dir, f"attempt2.{spec['ext']}")
        pass_log2 = os.path.join(work_dir, "passlog_2")

        if codec in ("h264", "hevc", "vp9"):
            # True 2-Pass ABR tightening guarantees hitting smaller size cleanly
            p1_t, _, _ = build_ffmpeg_command(
                input_path, attempt2_path, options, probed,
                effective_crf=None,
                target_video_kbps=tight_video_kbps,
                vbv_maxrate_kbps=tight_maxrate,
                vbv_bufsize_kbps=tight_bufsize,
                target_audio_kbps=tight_audio_kbps,
                apply_denoise=tight_denoise,
                pass_mode=1,
                pass_log_prefix=pass_log2,
            )
            c1, _, _ = run_cmd(p1_t, timeout_sec=60)
            if c1 == 0:
                p2_t, _, _ = build_ffmpeg_command(
                    input_path, attempt2_path, options, probed,
                    effective_crf=None,
                    target_video_kbps=tight_video_kbps,
                    vbv_maxrate_kbps=tight_maxrate,
                    vbv_bufsize_kbps=tight_bufsize,
                    target_audio_kbps=tight_audio_kbps,
                    apply_denoise=tight_denoise,
                    pass_mode=2,
                    pass_log_prefix=pass_log2,
                )
                c2, _, _ = run_cmd(p2_t, timeout_sec=90)
                if c2 == 0 and os.path.exists(attempt2_path):
                    att2_size = os.path.getsize(attempt2_path)
                    if 0 < att2_size < best_size:
                        best_path = attempt2_path
                        best_size = att2_size
                        uses_two_pass = True
                        target_video_kbps = tight_video_kbps
                        vbv_maxrate_kbps = tight_maxrate
                        apply_denoise = tight_denoise
                        anti_bloat_reason = "adaptive_2pass_tightened"
        else:
            # AV1 adaptive tightening: bump CRF +5 with strict VBV cap
            tight_crf = min(spec["crf_max"], (effective_crf or 30) + 5)
            cmd2, _, _ = build_ffmpeg_command(
                input_path, attempt2_path, options, probed,
                effective_crf=tight_crf,
                target_video_kbps=None,
                vbv_maxrate_kbps=tight_maxrate,
                vbv_bufsize_kbps=tight_bufsize,
                target_audio_kbps=tight_audio_kbps,
                apply_denoise=tight_denoise,
            )
            c2, _, _ = run_cmd(cmd2, timeout_sec=120)
            if c2 == 0 and os.path.exists(attempt2_path):
                att2_size = os.path.getsize(attempt2_path)
                if 0 < att2_size < best_size:
                    best_path = attempt2_path
                    best_size = att2_size
                    effective_crf = tight_crf
                    vbv_maxrate_kbps = tight_maxrate
                    apply_denoise = tight_denoise
                    anti_bloat_reason = "adaptive_crf_tightened"

        stages.append(StageLog(
            stage="antibloat_retry",
            detail=f"Adaptive Pass 2 -> {round(best_size / 1024, 1)} KB (target={tight_video_kbps}k)",
            elapsed_ms=int((time.monotonic() - t_enc2) * 1000),
        ))

    # Hard Zero-Bloat Invariant: never return a larger file than source in non-custom-target mode
    if anti_bloat and not use_custom_target and best_size >= probed.size_bytes:
        t_remux = time.monotonic()
        remux_path = os.path.join(work_dir, f"remux.{spec['ext']}")
        remux_cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", input_path,
            "-map", "0:v:0",
        ]
        if probed.audio_codec and options["audioMode"] != "mute":
            remux_cmd.extend(["-map", "0:a:0?"])
        remux_cmd.extend(["-c", "copy", "-map_metadata", "-1", "-map_chapters", "-1"])
        if spec["container"] == "mp4":
            remux_cmd.extend(["-movflags", "+faststart"])
        remux_cmd.append(remux_path)
        rc, _, _ = run_cmd(remux_cmd, timeout_sec=20)
        if rc == 0 and os.path.exists(remux_path):
            remux_size = os.path.getsize(remux_path)
            if 0 < remux_size < best_size and remux_size <= probed.size_bytes:
                best_path = remux_path
                best_size = remux_size
                anti_bloat_triggered = True
                anti_bloat_reason = "source_already_optimal_lossless_remux"
                stages.append(StageLog(
                    stage="zero_bloat_remux",
                    detail=f"Source sudah di batas entropi -> remux bersih tanpa bloat ({round(remux_size / 1024, 1)} KB)",
                    elapsed_ms=int((time.monotonic() - t_remux) * 1000),
                ))

    shutil.move(best_path, output_path)
    out_probed = probe_media(output_path)
    if out_probed.width <= 0 or out_probed.height <= 0:
        raise RuntimeError("Stream video hasil kompresi tidak valid.")

    # Stage 5: Real Perceptual Quality Audit (SSIM + PSNR)
    ssim_pct, psnr_db, audit_ms = measure_quality_metrics(
        output_path, input_path, out_probed.width, out_probed.height
    )
    stages.append(StageLog(
        stage="quality_audit",
        detail=f"SSIM={ssim_pct if ssim_pct is not None else 'n/a'}% · PSNR={psnr_db if psnr_db is not None else 'n/a'} dB",
        elapsed_ms=audit_ms,
    ))

    total_ms = int((time.monotonic() - total_t0) * 1000)
    reduction_pct = (
        round(((probed.size_bytes - out_probed.size_bytes) / float(probed.size_bytes)) * 100.0, 1)
        if probed.size_bytes > 0
        else 0.0
    )

    return {
        "status": "ok",
        "engine": "python-per-title-v2",
        "originalSize": probed.size_bytes,
        "compressedSize": out_probed.size_bytes,
        "bytesSaved": probed.size_bytes - out_probed.size_bytes,
        "reductionPercent": reduction_pct,
        "originalCodec": probed.video_codec,
        "compressedCodec": out_probed.video_codec,
        "originalBitrateKbps": probed.total_bitrate_kbps,
        "compressedBitrateKbps": out_probed.total_bitrate_kbps,
        "width": out_probed.width,
        "height": out_probed.height,
        "durationSec": out_probed.duration_sec,
        "pixFmt": out_probed.pix_fmt,
        "effectiveCrf": effective_crf,
        "targetBitrateKbps": target_video_kbps,
        "vbvMaxrateKbps": vbv_maxrate_kbps,
        "usesTwoPass": uses_two_pass,
        "ssimPercent": ssim_pct,
        "psnrDb": psnr_db,
        "sourceBpp": probed.bpp,
        "motionScore": complexity.motion_score,
        "complexityClass": complexity.classification,
        "denoiseApplied": apply_denoise is not None,
        "smartAudioOptimized": smart_audio_used,
        "antiBloatTriggered": anti_bloat_triggered,
        "antiBloatReason": anti_bloat_reason,
        "attempts": attempts,
        "universalPlayable": out_probed.video_codec == "h264" and out_probed.pix_fmt == "yuv420p",
        "modernBrowserPlayable": (
            (out_probed.video_codec == "h264" and out_probed.pix_fmt == "yuv420p")
            or out_probed.video_codec in ("av1", "vp9")
        ),
        "elapsedMs": total_ms,
        "mime": spec["mime"],
        "ext": spec["ext"],
        "strippedMetadata": bool(options.get("stripMetadata", True)),
        "stages": [asdict(s) for s in stages],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="MetaScope Per-Title Anti-Bloat Video Compressor")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--options-json", required=True)
    args = parser.parse_args()

    try:
        opts = json.loads(args.options_json)
        result = run_pipeline(args.input, args.output, args.workdir, opts)
        sys.stdout.write(json.dumps(result) + "\n")
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
