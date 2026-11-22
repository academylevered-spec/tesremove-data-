import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFilePrivate } from '../src/engine/orchestrator';
import { buildSampleAiPng, buildSampleDocx, buildSampleGpsJpeg, buildSampleMp4, buildSamplePdf } from '../src/engine/samples';

// Deterministic PRNG for reproducible fuzzing
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mutateBytes(src: Uint8Array, seed: number, mutationCount: number): Uint8Array {
  const rand = mulberry32(seed);
  const copy = new Uint8Array(src);
  // Keep first 8-12 magic bytes intact on half the cases so the format parser actually executes on corrupted headers
  const startOffset = seed % 2 === 0 ? Math.min(12, copy.length) : 0;
  for (let i = 0; i < mutationCount && copy.length > startOffset; i++) {
    const idx = startOffset + Math.floor(rand() * (copy.length - startOffset));
    copy[idx] = Math.floor(rand() * 256);
  }
  return copy;
}

test('Fuzzing: random byte mutations on MP4, JPEG, PNG, PDF, and ZIP never crash or hang (< 5s total)', async () => {
  const started = performance.now();
  const baseFixtures = [
    buildSampleMp4(),
    buildSampleGpsJpeg(true),
    buildSampleAiPng(false),
    buildSamplePdf(),
    buildSampleDocx(),
  ];

  let completedRuns = 0;
  for (const fx of baseFixtures) {
    for (let trial = 0; trial < 8; trial++) {
      const mutated = mutateBytes(fx.bytes, trial * 97 + fx.name.length, 24);
      const report = await analyzeFilePrivate(new Blob([mutated as unknown as BlobPart], { type: fx.mime }), {
        filename: fx.name,
        skipC2pa: true,
      });
      assert.equal(report.meta.schema, '1.0');
      assert.equal(report.file.size, mutated.length);
      completedRuns++;
    }
  }

  // Also fuzz truncated headers & adversarial box sizes (size=0, size=1, 0xFFFFFFFF)
  const adversarialPayloads = [
    new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x66, 0x74, 0x79, 0x70, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00, 0x00]),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x7f, 0xff, 0xff, 0xff, 0x49, 0x48, 0x44, 0x52]),
    new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0x00, 0x00]),
  ];

  for (let i = 0; i < adversarialPayloads.length; i++) {
    const p = adversarialPayloads[i];
    const rep = await analyzeFilePrivate(new Blob([p as unknown as BlobPart]), {
      filename: `adversarial_${i}.bin`,
      skipC2pa: true,
    });
    assert.equal(rep.meta.schema, '1.0');
    completedRuns++;
  }

  const elapsedMs = performance.now() - started;
  assert.equal(completedRuns, 45);
  assert.ok(elapsedMs < 5000, `Fuzz suite exceeded 5s budget (${Math.round(elapsedMs)} ms)`);
});
