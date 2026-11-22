import type { ProvenanceInfo } from './types';

const C2PA_SUPPORTED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/tiff',
  'video/mp4',
  'video/quicktime',
  'audio/wav',
  'audio/mp4',
  'application/pdf',
]);

// Lightweight binary signature scan for JUMBF / C2PA manifest box so we only load WASM when relevant
async function hasC2paSignature(file: Blob): Promise<boolean> {
  const sampleSize = Math.min(file.size, 4 * 1024 * 1024);
  const head = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head);
  return text.includes('c2pa') && (text.includes('jumb') || text.includes('c2cl') || text.includes('urn:uuid:'));
}

export async function analyzeC2pa(
  file: Blob,
  mimeType: string,
): Promise<ProvenanceInfo['c2pa']> {
  if (!C2PA_SUPPORTED_MIMES.has(mimeType)) {
    return {
      present: false,
      statusMessage: 'Format ini tidak mendukung Content Credentials (C2PA).',
    };
  }

  const maybeHasC2pa = await hasC2paSignature(file);
  if (!maybeHasC2pa) {
    return {
      present: false,
      statusMessage: 'Tidak ada Content Credentials (C2PA).',
    };
  }

  // Lazy-load @contentauth/c2pa-web strictly in browser runtime when a C2PA signature is actually detected
  if (typeof window !== 'undefined') {
    try {
      const c2paMod = await import('@contentauth/c2pa-web');
      if (typeof c2paMod.createC2pa === 'function' && c2paMod.Reader) {
        const c2pa = await c2paMod.createC2pa({
          wasmSrc: '/c2pa_bg.wasm',
        });
        const reader = await c2paMod.Reader.fromBlob(c2pa, mimeType, file);
        if (reader) {
          const store = await reader.manifestStore();
          await reader.free();
          const activeLabel = store.active_manifest;
          const active = activeLabel ? store.manifests?.[activeLabel] : undefined;
          if (active) {
            const actions: string[] = [];
            for (const assertion of active.assertions ?? []) {
              if (assertion.label?.startsWith('c2pa.actions') && assertion.data) {
                const rawActions = (assertion.data as { actions?: Array<{ action?: string }> }).actions ?? [];
                for (const a of rawActions) {
                  if (a.action) actions.push(a.action);
                }
              }
            }
            const validationErrors = store.validation_status?.filter((s) =>
              String(s.code ?? '').toLowerCase().includes('mismatch') ||
              String(s.code ?? '').toLowerCase().includes('invalid'),
            );
            return {
              present: true,
              valid: !validationErrors || validationErrors.length === 0,
              signer: active.signature_info?.issuer ?? active.signature_info?.common_name ?? undefined,
              signedAt: active.signature_info?.time ?? undefined,
              claimGenerator: active.claim_generator ?? undefined,
              actions,
              statusMessage:
                !validationErrors || validationErrors.length === 0
                  ? 'Manifest C2PA ditemukan dan tervalidasi.'
                  : 'Manifest C2PA ditemukan namun terdapat peringatan validasi.',
            };
          }
        }
      }
    } catch {
      // Fallback to structural JUMBF detection if WASM asset cannot be initialized in sandbox
    }
  }

  return {
    present: true,
    valid: undefined,
    statusMessage: 'Struktur JUMBF/C2PA terdeteksi di dalam file (validasi kriptografi WASM memerlukan berkas c2pa_bg.wasm).',
  };
}
