import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT_ID =
  "Kamu adalah penjelas laporan metadata. Kamu HANYA menjelaskan isi JSON laporan yang diberikan. Dilarang menebak nilai yang tidak ada di JSON, dilarang menyimpulkan identitas orang, dan dilarang menyajikan heuristik sebagai fakta. Setiap klaim wajib mengutip field atau temuan sumbernya (id). Gunakan label keyakinan yang sama dengan laporan (pasti, kuat, heuristik). Jika informasi tidak ada di laporan, jawab 'tidak ada di laporan'. Jelaskan dalam bahasa Indonesia yang sederhana, singkat, dan netral, tanpa menakut-nakuti.";

const SYSTEM_PROMPT_EN =
  "You are a metadata report explainer. You ONLY explain the contents of the provided report JSON. Never guess values absent from the JSON, never infer personal identities, and never present heuristics as facts. Every claim must cite its source field or finding id. Use the exact same confidence labels as the report (pasti/certain, kuat/strong, heuristik/heuristic). If information is not in the report, answer 'tidak ada di laporan' (not in the report). Explain in simple, concise, neutral English without fear-mongering.";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
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

function serverSanitizeReport(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // Strip any accidental binary/base64/dataUrl/hex payloads before sending to Gemini
  const json = JSON.stringify(raw, (key, value) => {
    if (key === 'dataUrl' || key === 'hex' || key === 'rawBytes' || key === 'buffer') return undefined;
    if (typeof value === 'string' && value.startsWith('data:') && value.length > 256) return '<omitted-binary>';
    return value;
  });
  if (json.length > 150_000) {
    // Trim oversized tag arrays while preserving summary/findings/checks/privacy/technical
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (Array.isArray(obj.tags) && obj.tags.length > 200) {
      obj.tags = obj.tags.slice(0, 200);
    }
    if (Array.isArray(obj.structure) && obj.structure.length > 100) {
      obj.structure = obj.structure.slice(0, 100);
    }
    return obj;
  }
  return JSON.parse(json) as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local';

  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { error: 'Batas permintaan AI Insight tercapai. Coba lagi sebentar lagi.' },
      { status: 429 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return NextResponse.json(
      {
        error:
          'Layanan AI Insight belum dikonfigurasi (GEMINI_API_KEY tidak tersedia di server). Laporan analisis lokal tetap utuh.',
      },
      { status: 503 },
    );
  }

  try {
    const body = (await req.json()) as {
      action?: 'summary' | 'explainTerm' | 'qa';
      locale?: 'id' | 'en';
      report?: unknown;
      term?: string;
      question?: string;
      history?: Array<{ role: 'user' | 'assistant'; text: string }>;
    };

    const sanitizedReport = serverSanitizeReport(body.report);
    if (!sanitizedReport) {
      return NextResponse.json({ error: 'Laporan JSON tidak valid.' }, { status: 400 });
    }

    const locale = body.locale === 'en' ? 'en' : 'id';
    const action = body.action ?? 'summary';
    const reportJsonStr = JSON.stringify(sanitizedReport);

    let userPrompt = '';
    if (action === 'summary') {
      userPrompt =
        locale === 'id'
          ? `Buat ringkasan bahasa awam maksimal 8 kalimat dari JSON laporan berikut, lalu berikan 2-3 saran langkah privasi singkat yang netral berdasarkan isi privacy.items. Wajib kutip field atau id temuan.\n\nJSON LAPORAN:\n${reportJsonStr}`
          : `Write a plain-language summary of at most 8 sentences from the following report JSON, followed by 2-3 brief neutral privacy action steps based strictly on privacy.items. Cite source fields or finding IDs.\n\nREPORT JSON:\n${reportJsonStr}`;
    } else if (action === 'explainTerm') {
      const term = String(body.term ?? '').trim().slice(0, 120);
      if (!term) return NextResponse.json({ error: 'Istilah tidak boleh kosong.' }, { status: 400 });
      userPrompt =
        locale === 'id'
          ? `Jelaskan secara singkat dan sederhana apa arti istilah teknis "${term}" dalam konteks JSON laporan berikut. Jika istilah atau nilainya tidak ada di laporan, jawab 'tidak ada di laporan'.\n\nJSON LAPORAN:\n${reportJsonStr}`
          : `Briefly explain in plain language what the technical term "${term}" means in the context of this report JSON. If the term or its value is absent from the report, answer 'tidak ada di laporan' (not in the report).\n\nREPORT JSON:\n${reportJsonStr}`;
    } else {
      const question = String(body.question ?? '').trim().slice(0, 600);
      if (!question) return NextResponse.json({ error: 'Pertanyaan tidak boleh kosong.' }, { status: 400 });
      const histText = Array.isArray(body.history)
        ? body.history
            .slice(-6)
            .map((h) => `${h.role === 'user' ? 'Pengguna' : 'Asisten'}: ${String(h.text).slice(0, 400)}`)
            .join('\n')
        : '';
      userPrompt = `${histText ? `RIWAYAT PERCAKAPAN SESI:\n${histText}\n\n` : ''}PERTANYAAN PENGGUNA:\n${question}\n\nJSON LAPORAN:\n${reportJsonStr}`;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: userPrompt,
      config: {
        systemInstruction: locale === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return NextResponse.json(
        { error: 'Model tidak mengembalikan respons teks. Silakan coba lagi.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ text, model: 'gemini-4-hydrogen' });
  } catch (err) {
    const msg = (err as Error)?.message || 'Terjadi kesalahan saat menghubungi layanan Gemini.';
    return NextResponse.json(
      { error: `Gagal memuat AI Insight: ${msg}` },
      { status: 502 },
    );
  }
}
