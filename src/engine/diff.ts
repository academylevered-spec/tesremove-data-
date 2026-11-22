import type { BoxNode, DiffReport, Report, TagEntry } from './types';

function flattenNodes(nodes: BoxNode[]): BoxNode[] {
  const out: BoxNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children) out.push(...flattenNodes(n.children));
  }
  return out;
}

function tagKey(t: TagEntry): string {
  return `${t.ns}::${t.name}`;
}

function tagValueStr(t: TagEntry): string {
  return t.decoded !== undefined ? t.decoded : typeof t.raw === 'object' ? JSON.stringify(t.raw) : String(t.raw ?? '');
}

export function compareReports(a: Report, b: Report): DiffReport {
  const mapA = new Map<string, TagEntry>();
  const mapB = new Map<string, TagEntry>();
  for (const t of a.tags) {
    const k = tagKey(t);
    if (!mapA.has(k)) mapA.set(k, t);
  }
  for (const t of b.tags) {
    const k = tagKey(t);
    if (!mapB.has(k)) mapB.set(k, t);
  }

  const added: TagEntry[] = [];
  const removed: TagEntry[] = [];
  const changed: DiffReport['tags']['changed'] = [];
  let unchangedCount = 0;

  for (const [k, tA] of mapA.entries()) {
    const tB = mapB.get(k);
    if (!tB) {
      removed.push(tA);
    } else {
      const vA = tagValueStr(tA);
      const vB = tagValueStr(tB);
      if (vA !== vB) {
        changed.push({ key: k, ns: tA.ns, name: tA.name, before: vA, after: vB });
      } else {
        unchangedCount++;
      }
    }
  }
  for (const [k, tB] of mapB.entries()) {
    if (!mapA.has(k)) added.push(tB);
  }

  // Structure diff
  const flatA = flattenNodes(a.structure);
  const flatB = flattenNodes(b.structure);
  const structMapA = new Map<string, BoxNode>();
  const structMapB = new Map<string, BoxNode>();
  flatA.forEach((n, idx) => structMapA.set(`${n.path}#${idx}`, n));
  flatB.forEach((n, idx) => structMapB.set(`${n.path}#${idx}`, n));

  const pathA = new Map<string, BoxNode>();
  const pathB = new Map<string, BoxNode>();
  for (const n of flatA) if (!pathA.has(n.path)) pathA.set(n.path, n);
  for (const n of flatB) if (!pathB.has(n.path)) pathB.set(n.path, n);

  const structAdded: BoxNode[] = [];
  const structRemoved: BoxNode[] = [];
  const structResized: DiffReport['structure']['resized'] = [];

  for (const [p, nA] of pathA.entries()) {
    const nB = pathB.get(p);
    if (!nB) structRemoved.push(nA);
    else if (nA.size !== nB.size) {
      structResized.push({ path: p, type: nA.type, beforeSize: nA.size, afterSize: nB.size });
    }
  }
  for (const [p, nB] of pathB.entries()) {
    if (!pathA.has(p)) structAdded.push(nB);
  }

  // Findings diff
  const fA = new Map(a.findings.map((f) => [f.id, f]));
  const fB = new Map(b.findings.map((f) => [f.id, f]));
  const findingsAdded = b.findings.filter((f) => !fA.has(f.id));
  const findingsRemoved = a.findings.filter((f) => !fB.has(f.id));

  return {
    fileA: {
      name: a.file.name,
      size: a.file.size,
      detectedType: a.file.detectedType,
      md5: a.file.hashes.md5,
      sha256: a.file.hashes.sha256,
      privacyScore: a.privacy.score,
    },
    fileB: {
      name: b.file.name,
      size: b.file.size,
      detectedType: b.file.detectedType,
      md5: b.file.hashes.md5,
      sha256: b.file.hashes.sha256,
      privacyScore: b.privacy.score,
    },
    hashesMatch: a.file.hashes.sha256 === b.file.hashes.sha256,
    privacyDelta: b.privacy.score - a.privacy.score,
    tags: { added, removed, changed, unchangedCount },
    structure: { added: structAdded, removed: structRemoved, resized: structResized },
    findings: { added: findingsAdded, removed: findingsRemoved },
  };
}
