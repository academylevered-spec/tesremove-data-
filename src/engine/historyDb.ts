import { sanitizeReportForExportOrAi } from './exporters';
import type { Report } from './types';

const DB_NAME = 'metascope_local_history_v1';
const STORE_NAME = 'reports';

export interface HistoryEntry {
  id: string;
  savedAt: string;
  fileName: string;
  fileSize: number;
  detectedType: string;
  privacyScore: number;
  report: Report;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveReportHistory(report: Report): Promise<HistoryEntry | null> {
  try {
    const db = await openDb();
    const clean = sanitizeReportForExportOrAi(report);
    const entry: HistoryEntry = {
      id: `${clean.file.hashes.sha256.slice(0, 12)}_${Date.now()}`,
      savedAt: new Date().toISOString(),
      fileName: clean.file.name,
      fileSize: clean.file.size,
      detectedType: clean.file.detectedType,
      privacyScore: clean.privacy.score,
      report: clean,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return entry;
  } catch {
    return null;
  }
}

export async function listReportHistory(): Promise<HistoryEntry[]> {
  try {
    const db = await openDb();
    const entries = await new Promise<HistoryEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as HistoryEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function clearAllHistory(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}
