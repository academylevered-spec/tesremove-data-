import type { Confidence, Finding, ProvenanceInfo, Report } from '../engine/types';
import { CROSS_CHECK_RULES } from './checks';
import { INFERENCE_RULES } from './inferences';
import { evaluatePrivacyScore } from './privacy';

const AI_DIGITAL_SOURCE_RE = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia|digitalArt/i;
const PNG_AI_PARAM_RE = /(Steps:\s*\d+|Sampler:|CFG scale:|Negative prompt:|"class_type":|"ckpt_name":|Midjourney|DALL-E|Stable Diffusion)/i;

function collectProvenanceMarkers(report: Report): ProvenanceInfo {
  const aiMarkers: ProvenanceInfo['aiMarkers'] = [];
  const processingChain: string[] = [];

  // 1) C2PA valid AI assertion
  const c2pa = report.provenance?.c2pa;
  if (c2pa?.present) {
    if (c2pa.claimGenerator) processingChain.push(`C2PA: ${c2pa.claimGenerator}`);
    const actionsText = (c2pa.actions ?? []).join(' ');
    if (c2pa.valid && /trainedAlgorithmic|ai|generative/i.test(actionsText)) {
      aiMarkers.push({
        source: 'C2PA Content Credentials',
        indicator: 'C2PA AI Assertion',
        confidence: 'kuat',
        detail: actionsText,
      });
    }
  }

  // 2) XMP / EXIF DigitalSourceType
  for (const tag of report.tags) {
    const val = String(tag.decoded ?? tag.raw ?? '');
    if (/DigitalSourceType/i.test(tag.name) && AI_DIGITAL_SOURCE_RE.test(val)) {
      aiMarkers.push({
        source: `${tag.ns}:${tag.name}`,
        indicator: 'IPTC/XMP DigitalSourceType',
        confidence: 'heuristik',
        detail: val,
      });
    }
    if (/aigc_info/i.test(tag.name) && val) {
      // e.g. {"aigc_label_type":0} -> 0 means not labeled AI; nonzero means labeled
      const m = val.match(/"aigc_label_type"\s*:\s*(\d+)/);
      if (m && parseInt(m[1], 10) > 0) {
        aiMarkers.push({
          source: `${tag.ns}:${tag.name}`,
          indicator: 'Platform AIGC Label',
          confidence: 'heuristik',
          detail: val,
        });
      }
    }
  }

  // 3) PNG text generator parameters (Automatic1111, ComfyUI, Midjourney, etc.)
  for (const chunk of report.technical.image?.pngTextChunks ?? []) {
    if (
      /^(parameters|prompt|workflow|Comment|Software|Description)$/i.test(chunk.keyword) &&
      PNG_AI_PARAM_RE.test(chunk.text)
    ) {
      aiMarkers.push({
        source: `PNG ${chunk.chunkType}:${chunk.keyword}`,
        indicator: 'Parameter Generator Gambar PNG',
        confidence: 'heuristik',
        detail: chunk.text.slice(0, 140),
      });
    }
  }

  // Processing chain summary
  if (report.bitstream?.seiUserData?.[0]?.text) {
    processingChain.push(`Bitstream Encoder: ${report.bitstream.seiUserData[0].text}`);
  }
  const encoderTag = report.tags.find((t) => /^(encoder|software|Producer|CreatorTool|Application)$/i.test(t.name));
  if (encoderTag) {
    processingChain.push(`${encoderTag.name}: ${encoderTag.decoded ?? encoderTag.raw}`);
  }

  return {
    c2pa: c2pa ?? { present: false, statusMessage: 'Tidak ada Content Credentials (C2PA).' },
    aiMarkers,
    processingChain,
  };
}

export function evaluateAllRules(report: Report): Report {
  // Update provenance AI markers before running inference rules
  report.provenance = collectProvenanceMarkers(report);

  // Flag timeline creation-after-modification anomaly if present
  const validDates = report.timeline.filter((e) => e.utc && !e.isZeroed);
  const createEntry = validDates.find((e) => /create|original/i.test(e.label));
  const modifyEntry = validDates.find((e) => /modify/i.test(e.label));
  if (
    createEntry?.utc &&
    modifyEntry?.utc &&
    new Date(createEntry.utc).getTime() > new Date(modifyEntry.utc).getTime() + 60000
  ) {
    createEntry.anomaly = createEntry.anomaly
      ? `${createEntry.anomaly}; pembuatan > modifikasi`
      : 'pembuatan setelah modifikasi';
  }

  // Evaluate Cross-Checks
  const family = report.file.detectedFamily;
  const checks = CROSS_CHECK_RULES.filter(
    (rule) => rule.appliesTo.includes('all') || rule.appliesTo.includes(family),
  ).map((rule) => rule.evaluate(report));

  // Evaluate Inferences
  const findings: Finding[] = [];
  for (const rule of INFERENCE_RULES) {
    if (!rule.appliesTo.includes('all') && !rule.appliesTo.includes(family)) continue;
    const finding = rule.evaluate(report);
    if (finding) findings.push(finding);
  }

  // Sort findings by confidence (pasti -> kuat -> heuristik)
  const confOrder: Record<Confidence, number> = { pasti: 0, kuat: 1, heuristik: 2 };
  findings.sort((a, b) => confOrder[a.confidence] - confOrder[b.confidence]);

  // Evaluate Privacy Score
  const privacy = evaluatePrivacyScore(report);

  report.checks = checks;
  report.findings = findings;
  report.privacy = privacy;

  return report;
}
