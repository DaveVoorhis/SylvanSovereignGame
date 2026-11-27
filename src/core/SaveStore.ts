import type { QualityPreset } from './Config';
import type { Season, SelectionTarget, Vec3 } from './Types';
import type { WorldSnapshot, WorldState } from '@simulation/WorldState';

export const DEFAULT_AUTOSAVE_SLOT_ID = 'autosave';
export const SAVE_FORMAT_VERSION = 1 as const;

const DB_NAME = 'sylvan-sovereign-db';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

export function isQualityPreset(value: unknown): value is QualityPreset {
  return value === 'balanced' || value === 'high' || value === 'ultra';
}

export interface SaveViewState {
  readonly simSpeed: number;
  readonly cameraPosition: Vec3;
  readonly cameraTarget: Vec3;
  readonly cinematicDrift: boolean;
  readonly povCreatureId: string | null;
  readonly selection: SelectionTarget;
  readonly deityPanelOpen: boolean;
  readonly chroniclePanelOpen: boolean;
  readonly qualityPreset?: QualityPreset;
}

export interface SaveSlotMeta {
  readonly slotId: string;
  readonly name: string;
  readonly isAutosave: boolean;
  readonly savedAt: number;
  readonly day: number;
  readonly season: Season;
  readonly settlementCount: number;
  readonly livingKinCount: number;
  readonly totalBuildings: number;
  readonly deityName: string;
  readonly seed: number;
}

export interface SaveGameRecord {
  readonly version: typeof SAVE_FORMAT_VERSION;
  readonly slotId: string;
  readonly name: string;
  readonly isAutosave: boolean;
  readonly savedAt: number;
  readonly meta: SaveSlotMeta;
  readonly world: WorldSnapshot;
  readonly view?: SaveViewState;
}

export function buildSaveRecord(params: {
  slotId: string;
  name: string;
  world: WorldState;
  view?: SaveViewState;
  savedAt?: number;
}): SaveGameRecord {
  const savedAt = params.savedAt ?? Date.now();
  const isAutosave = params.slotId === DEFAULT_AUTOSAVE_SLOT_ID;
  const worldSnapshot = params.world.toSnapshot();

  let livingKinCount = 0;
  for (const c of params.world.creatures) {
    if (c.alive) livingKinCount++;
  }
  const totalBuildings = params.world.settlements.reduce((sum, s) => sum + s.getCompletedCount(), 0);

  const meta: SaveSlotMeta = {
    slotId: params.slotId,
    name: params.name,
    isAutosave,
    savedAt,
    day: params.world.day,
    season: params.world.season,
    settlementCount: params.world.settlements.length,
    livingKinCount,
    totalBuildings,
    deityName: params.world.deity.name,
    seed: params.world.config.seed,
  };

  return {
    version: SAVE_FORMAT_VERSION,
    slotId: params.slotId,
    name: params.name,
    isAutosave,
    savedAt,
    meta,
    world: worldSnapshot,
    view: params.view,
  };
}

export function isValidSaveRecord(value: unknown): value is SaveGameRecord {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Partial<SaveGameRecord>;
  if (rec.version !== SAVE_FORMAT_VERSION) return false;
  if (typeof rec.slotId !== 'string' || rec.slotId.length === 0) return false;
  if (typeof rec.name !== 'string') return false;
  if (!rec.world || typeof rec.world !== 'object') return false;
  const w = rec.world as Partial<WorldSnapshot>;
  if (w.version !== 1) return false;
  if (!w.config || typeof w.config.seed !== 'number') return false;
  if (!Array.isArray(w.settlements) || !Array.isArray(w.creatures) || !Array.isArray(w.bridges)) {
    return false;
  }
  if (!w.deity || !w.chronicle || !w.diplomacy || !w.festivals || !w.settlementManager) {
    return false;
  }
  return true;
}

export function makeManualSlotId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  const stamp = Date.now().toString(36);
  return `slot_${stamp}${slug ? `_${slug}` : ''}`;
}

/**
 * Browser IndexedDB save/load store supporting an automatic default slot (`autosave`)
 * as well as unlimited named manual save slots. Fails gracefully if IndexedDB is unavailable.
 */
export class SaveStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly idbFactory?: IDBFactory | null) {}

  private resolveFactory(): IDBFactory | null {
    if (this.idbFactory !== undefined) return this.idbFactory;
    if (typeof globalThis !== 'undefined' && 'indexedDB' in globalThis && globalThis.indexedDB) {
      return globalThis.indexedDB;
    }
    return null;
  }

  isAvailable(): boolean {
    return this.resolveFactory() !== null;
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const factory = this.resolveFactory();
    if (!factory) {
      return Promise.reject(new Error('IndexedDB is not available in this browser context.'));
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        this.dbPromise = null;
        reject(req.error ?? new Error('Failed to open IndexedDB save store.'));
      };
    });

    return this.dbPromise;
  }

  async save(record: SaveGameRecord): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write save record.'));
      tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted.'));
    });
  }

  async load(slotId: string): Promise<SaveGameRecord | null> {
    if (!this.isAvailable()) return null;
    try {
      const db = await this.openDb();
      const raw = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(slotId);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error ?? new Error('Failed to read save record.'));
      });
      return isValidSaveRecord(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  async loadAutosave(): Promise<SaveGameRecord | null> {
    return this.load(DEFAULT_AUTOSAVE_SLOT_ID);
  }

  async listSlots(): Promise<SaveSlotMeta[]> {
    if (!this.isAvailable()) return [];
    try {
      const db = await this.openDb();
      const all = await new Promise<unknown[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error ?? new Error('Failed to list save slots.'));
      });

      const metas: SaveSlotMeta[] = [];
      for (const item of all) {
        if (isValidSaveRecord(item)) {
          metas.push(item.meta);
        }
      }

      metas.sort((a, b) => {
        if (a.isAutosave !== b.isAutosave) return a.isAutosave ? -1 : 1;
        return b.savedAt - a.savedAt;
      });
      return metas;
    } catch {
      return [];
    }
  }

  async deleteSlot(slotId: string): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(slotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete save slot.'));
    });
  }
}
