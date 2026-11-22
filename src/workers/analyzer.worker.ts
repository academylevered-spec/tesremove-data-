import { analyzeFilePrivate } from '../engine/orchestrator';
import type { Report } from '../engine/types';

export interface WorkerAnalyzeRequest {
  type: 'analyze';
  jobId: string;
  file: Blob;
  filename: string;
}

export interface WorkerCancelRequest {
  type: 'cancel';
  jobId: string;
}

export type WorkerResponse =
  | { type: 'progress'; jobId: string; stage: string; fraction: number }
  | { type: 'result'; jobId: string; report: Report }
  | { type: 'error'; jobId: string; message: string; aborted?: boolean };

const controllers = new Map<string, AbortController>();

self.onmessage = async (event: MessageEvent<WorkerAnalyzeRequest | WorkerCancelRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    const ctrl = controllers.get(msg.jobId);
    if (ctrl) {
      ctrl.abort();
      controllers.delete(msg.jobId);
    }
    return;
  }

  if (msg.type === 'analyze') {
    const ctrl = new AbortController();
    controllers.set(msg.jobId, ctrl);
    try {
      const report = await analyzeFilePrivate(msg.file, {
        filename: msg.filename,
        mode: 'privat',
        signal: ctrl.signal,
        // C2PA WASM uses window/fetch paths when present; handle safely inside main or worker
        onProgress: (stage, fraction) => {
          const progressMsg: WorkerResponse = { type: 'progress', jobId: msg.jobId, stage, fraction };
          self.postMessage(progressMsg);
        },
      });
      const resMsg: WorkerResponse = { type: 'result', jobId: msg.jobId, report };
      self.postMessage(resMsg);
    } catch (err) {
      const isAbort = (err as Error)?.name === 'AbortError';
      const errMsg: WorkerResponse = {
        type: 'error',
        jobId: msg.jobId,
        message: isAbort ? 'Analisis dibatalkan' : (err as Error)?.message || 'Kesalahan internal worker',
        aborted: isAbort,
      };
      self.postMessage(errMsg);
    } finally {
      controllers.delete(msg.jobId);
    }
  }
};
