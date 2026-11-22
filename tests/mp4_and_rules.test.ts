import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analyzeFilePrivate } from '../src/engine/orchestrator';
import { buildSampleMp4 } from '../src/engine/samples';
import { validateReportSchema } from '../src/engine/exporters';

test('MP4 Golden Fixture: structure, hvcC, SEI, stats, cross-checks, hash test, and inferences', async () => {
  const sample = buildSampleMp4();
  const blob = new Blob([sample.bytes as unknown as BlobPart], { type: sample.mime });

  const report = await analyzeFilePrivate(blob, {
    filename: sample.name,
    mode: 'privat',
    skipC2pa: true,
  });

  // Schema validity
  const schemaCheck = validateReportSchema(report);
  assert.equal(schemaCheck.valid, true, `Schema errors: ${schemaCheck.errors.join(', ')}`);

  // Exact streaming hashes match Node crypto (md5sum / sha256sum equivalence)
  const expectedMd5 = createHash('md5').update(sample.bytes).digest('hex');
  const expectedSha1 = createHash('sha1').update(sample.bytes).digest('hex');
  const expectedSha256 = createHash('sha256').update(sample.bytes).digest('hex');
  assert.equal(report.file.hashes.md5, expectedMd5);
  assert.equal(report.file.hashes.sha1, expectedSha1);
  assert.equal(report.file.hashes.sha256, expectedSha256);

  // Top-level boxes & faststart
  assert.deepEqual(
    report.structure.map((b) => b.type),
    ['ftyp', 'moov', 'free', 'mdat'],
  );
  assert.equal(report.technical.video?.faststart, true);
  assert.equal(report.coverage.explainedBytes, sample.bytes.length);
  assert.equal(report.coverage.unexplained.length, 0);

  // Video specs
  assert.equal(report.technical.video?.codec, 'HEVC');
  assert.equal(report.technical.video?.profile, 'Main');
  assert.equal(report.technical.video?.level, '4.0');
  assert.equal(report.technical.video?.width, 720);
  assert.equal(report.technical.video?.height, 1280);
  assert.equal(report.technical.video?.fps, 30);

  // Audio specs
  assert.equal(report.technical.video?.audioCodec, 'AAC-LC');
  assert.equal(report.technical.video?.audioSampleRate, 44100);
  assert.equal(report.technical.video?.audioChannels, 2);
  assert.equal(report.technical.video?.audioPackets, 2038);

  // hvcC & first-sample NALs & SEI
  assert.equal(report.bitstream?.codec, 'hevc');
  assert.equal(report.bitstream?.config.profileIdc, 1);
  assert.equal(report.bitstream?.config.temporalLayers, 2);
  assert.equal(report.bitstream?.config.nalLengthSize, 4);
  assert.equal(report.bitstream?.nalArrays?.length, 4);
  assert.deepEqual(
    report.bitstream?.nalArrays?.map((a) => [a.nalType, a.lengths[0]]),
    [
      [32, 28],
      [33, 64],
      [34, 7],
      [39, 39],
    ],
  );
  assert.deepEqual(report.bitstream?.firstSampleNals, [32, 33, 34, 39, 19]);
  assert.equal(report.bitstream?.seiUserData.length, 1);
  assert.equal(report.bitstream?.seiUserData[0].uuid, '2ca2de09b51747dbbb55a4fe7fc2fc4e');
  assert.equal(report.bitstream?.seiUserData[0].text, 'ByteVC1-v1.10.0.4');

  // Video frame & keyframe stats
  assert.equal(report.stats?.frames, 1418);
  assert.equal(report.stats?.keyframes, 10);
  assert.equal(report.stats?.keyframeTimes.length, 10);
  assert.equal(report.stats?.keyframeTimes[0], 0);
  assert.ok((report.stats?.kbpsPerSecond.mean ?? 0) > 1000);

  // QuickTime Keys tags & zeroed dates
  const keysMap = new Map(report.tags.filter((t) => t.ns === 'Keys').map((t) => [t.name, t.decoded]));
  assert.equal(keysMap.get('encoder'), 'Lavf58.76.100');
  assert.equal(keysMap.get('vid_md5'), '0941e508f60083e629cd249271199c7f');
  assert.equal(keysMap.get('aigc_info'), '{"aigc_label_type":0}');
  assert.equal(keysMap.get('comment'), 'vid:v1c044g50000dambobnog65qtvdvv6fg');
  assert.ok(report.timeline.every((t) => t.isZeroed === true));

  // 4 of 4 MP4 cross-checks passed
  const mp4CheckIds = ['mp4_video_stsz_stts', 'mp4_video_stss_keyframes', 'mp4_audio_stsz_stts', 'mp4_top_box_sum'];
  for (const id of mp4CheckIds) {
    const chk = report.checks.find((c) => c.id === id);
    assert.equal(chk?.status, 'lolos', `Expected ${id} to pass, got ${chk?.status}: ${chk?.detail}`);
  }

  // FR-14: vid_md5 does NOT match file, mdat, or moov
  const vidHashTest = report.hashTests?.find((h) => h.tagName === 'vid_md5');
  assert.ok(vidHashTest, 'Expected hash test for vid_md5');
  assert.equal(vidHashTest?.anyMatched, false);
  assert.ok(vidHashTest!.matches.length >= 2);

  // Confidence-labeled inferences
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  assert.equal(byId.get('mp4_faststart')?.confidence, 'pasti');
  assert.equal(byId.get('mp4_sei_encoder')?.confidence, 'kuat');
  assert.equal(byId.get('mp4_lavf_muxer')?.confidence, 'kuat');
  assert.ok(byId.get('mp4_lavf_muxer')?.text.includes('4.4'));
  assert.equal(byId.get('mp4_device_metadata_stripped')?.confidence, 'kuat');
  assert.equal(byId.get('mp4_server_reencode')?.confidence, 'kuat');
  assert.equal(byId.get('tag_hash_mismatch')?.confidence, 'kuat');
  assert.equal(byId.get('tiktok_id_filename_timestamp')?.confidence, 'heuristik');
  assert.ok(byId.get('tiktok_id_filename_timestamp')?.text.includes('2026-09-18 04:21:53 UTC'));
});
