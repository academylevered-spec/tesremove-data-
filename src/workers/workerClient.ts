import { analyzeFilePrivate } from '../engine/orchestrator';
import type { Report } from '../engine/types';
import type { WorkerResponse } from './analyzer.worker';

export interface RunAnalysisHandle {
  promise: Promise<Report>;
  cancel: () => void;
}

/**
 * Scales Web Worker concurrency safely to device CPU cores:
 * mobile/low-core devices stay responsive (2), multi-core desktops run faster (up to 4).
 */
export function getOptimalWorkerConcurrency(): number {
  if (typeof navigator === 'undefined') return 2;
  const cores = Number(navigator.hardwareConcurrency) || 4;
  if (cores <= 2) return 1;
  if (cores <= 4) return 2;
  if (cores <= 6) return 3;
  return 4;
}

export function runPrivateAnalysisInWorker(
  file: Blob,
  filename: string,
  onProgress?: (stage: string, fraction: number) => void,
): RunAnalysisHandle {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fallbackController = new AbortController();
  let worker: Worker | null = null;
  let cancelled = false;

  const promise = new Promise<Report>((resolve, reject) => {
    if (typeof Worker !== 'undefined') {
      try {
        worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (msg.jobId !== jobId) return;
          if (msg.type === 'progress') {
            onProgress?.(msg.stage, msg.fraction);
          } else if (msg.type === 'result') {
            worker?.terminate();
            worker = null;
            resolve(msg.report);
          } else if (msg.type === 'error') {
            worker?.terminate();
            worker = null;
            const err = new Error(msg.message);
            if (msg.aborted) err.name = 'AbortError';
            reject(err);
          }
        };
        worker.onerror = () => {
          worker?.terminate();
          worker = null;
          if (cancelled) {
            const err = new Error('Analisis dibatalkan');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          // Graceful fallback to chunked async analysis if module worker fails to load
          analyzeFilePrivate(file, {
            filename,
            mode: 'privat',
            onProgress,
            signal: fallbackController.signal,
          })
            .then(resolve)
            .catch(reject);
        };
        worker.postMessage({ type: 'analyze', jobId, file, filename });
        return;
      } catch {
        worker?.terminate();
        worker = null;
      }
    }

    analyzeFilePrivate(file, {
      filename,
      mode: 'privat',
      onProgress,
      signal: fallbackController.signal,
    })
      .then(resolve)
      .catch(reject);
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (worker) {
        worker.postMessage({ type: 'cancel', jobId });
        worker.terminate();
        worker = null;
      }
      fallbackController.abort();
    },
  };
}
