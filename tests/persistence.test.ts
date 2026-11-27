import { describe, expect, it } from 'vitest';
import { EventBus } from '@core/EventBus';
import {
  buildSaveRecord,
  DEFAULT_AUTOSAVE_SLOT_ID,
  isQualityPreset,
  isValidSaveRecord,
  makeManualSlotId,
  SaveStore,
  type SaveGameRecord,
} from '@core/SaveStore';
import { WorldState } from '@simulation/WorldState';

/** Minimal synchronous-callback IDBFactory fake for testing SaveStore in Node. */
function createFakeIndexedDB(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();

  const fakeDb = {
    objectStoreNames: {
      contains(name: string): boolean {
        return stores.has(name);
      },
    },
    createObjectStore(name: string): unknown {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      return {};
    },
    close(): void {
      // no-op
    },
    transaction(storeName: string): IDBTransaction {
      const backing = stores.get(storeName) ?? new Map<string, unknown>();
      const tx: Record<string, unknown> = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore() {
          return {
            put(value: { slotId: string }) {
              backing.set(value.slotId, structuredClone(value));
              queueMicrotask(() => {
                if (typeof tx.oncomplete === 'function') (tx.oncomplete as () => void)();
              });
              return {};
            },
            get(key: string) {
              const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                req.result = backing.has(key) ? structuredClone(backing.get(key)) : undefined;
                if (typeof req.onsuccess === 'function') (req.onsuccess as () => void)();
              });
              return req;
            },
            getAll() {
              const req: Record<string, unknown> = { result: [], onsuccess: null, onerror: null };
              queueMicrotask(() => {
                req.result = Array.from(backing.values()).map((v) => structuredClone(v));
                if (typeof req.onsuccess === 'function') (req.onsuccess as () => void)();
              });
              return req;
            },
            delete(key: string) {
              backing.delete(key);
              queueMicrotask(() => {
                if (typeof tx.oncomplete === 'function') (tx.oncomplete as () => void)();
              });
              return {};
            },
          };
        },
      };
      return tx as unknown as IDBTransaction;
    },
  };

  return {
    open() {
      const req: Record<string, unknown> = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (!stores.has('saves') && typeof req.onupgradeneeded === 'function') {
          (req.onupgradeneeded as () => void)();
        }
        if (typeof req.onsuccess === 'function') {
          (req.onsuccess as () => void)();
        }
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe('WorldState persistence & IndexedDB SaveStore', () => {
  it('round-trips full WorldState through JSON snapshot without losing simulation state', () => {
    const bus = new EventBus();
    const world = new WorldState(bus, {
      seed: 424242,
      initialSettlements: 2,
      initialWaterwaySettlements: 1,
      initialCreaturesPerSettlement: 6,
    });

    // Advance simulation so buildings, creatures, diplomacy, deity, and resources evolve
    for (let i = 0; i < 60; i++) {
      world.step(0.1);
    }

    // Mutate specific lineage, relationship, resource depletion, and trade fields to test exact fidelity
    const [home, neighbor] = world.settlements;
    const creatures = world.creatures.filter((c) => c.alive);
    creatures[0].mateId = creatures[1].id;
    creatures[1].mateId = creatures[0].id;
    creatures[0].adjustRelationship(creatures[1].id, 62);
    creatures[0].wealth = 147;
    const sampleNode = world.terrain.resourceNodes[0];
    sampleNode.amount = Math.max(0, sampleNode.maxAmount - 4.25);
    // Trigger rare Deity ecological influences to verify active epochs, scars, and adaptations persist
    world.deity.triggerInfluence('great_deluge', world, home);
    world.deity.triggerInfluence('habitat_clearing', world, neighbor);
    for (let i = 0; i < 15; i++) {
      world.step(0.1);
    }

    const record = buildSaveRecord({
      slotId: DEFAULT_AUTOSAVE_SLOT_ID,
      name: 'Autosave',
      world,
      view: {
        simSpeed: 2,
        cameraPosition: { x: 12, y: 24, z: 36 },
        cameraTarget: { x: 1, y: 2, z: 3 },
        cinematicDrift: true,
        povCreatureId: null,
        selection: { kind: 'settlement', id: home.id },
        deityPanelOpen: false,
        chroniclePanelOpen: true,
        qualityPreset: 'ultra',
      },
    });

    // Simulate full JSON serialization round-trip (as in file export / IndexedDB storage)
    const cloned = JSON.parse(JSON.stringify(record)) as unknown;
    expect(isValidSaveRecord(cloned)).toBe(true);
    const parsed = cloned as SaveGameRecord;
    expect(parsed.view?.qualityPreset).toBe('ultra');
    expect(isQualityPreset(parsed.view?.qualityPreset)).toBe(true);
    expect(isQualityPreset('balanced')).toBe(true);
    expect(isQualityPreset('high')).toBe(true);
    expect(isQualityPreset('invalid')).toBe(false);

    const restored = WorldState.fromSnapshot(new EventBus(), parsed.world);

    expect(restored.config.seed).toBe(world.config.seed);
    expect(restored.day).toBe(world.day);
    expect(restored.timeOfDay).toBeCloseTo(world.timeOfDay, 8);
    expect(restored.season).toBe(world.season);
    expect(restored.weather).toBe(world.weather);
    expect(restored.elapsedSeconds).toBeCloseTo(world.elapsedSeconds, 8);
    expect(restored.rng.getState()).toBe(world.rng.getState());

    expect(restored.settlements.length).toBe(world.settlements.length);
    expect(restored.settlements[0].name).toBe(home.name);
    expect(restored.settlements[0].treasury).toBeCloseTo(home.treasury, 6);
    expect(restored.settlements[0].buildings.length).toBe(home.buildings.length);

    expect(restored.creatures.length).toBe(world.creatures.length);
    expect(restored.creatures[0].mateId).toBe(creatures[1].id);
    expect(restored.creatures[0].wealth).toBe(147);
    expect(restored.creatures[0].relationships.get(creatures[1].id)).toBe(
      creatures[0].relationships.get(creatures[1].id),
    );

    expect(restored.deity.name).toBe(world.deity.name);
    expect(restored.deity.energy).toBeCloseTo(world.deity.energy, 6);
    expect(restored.activeInfluences.length).toBe(world.activeInfluences.length);
    expect(restored.activeInfluences.length).toBeGreaterThanOrEqual(2);
    expect(restored.habitatScars.length).toBe(world.habitatScars.length);
    expect(restored.habitatScars.length).toBeGreaterThanOrEqual(1);
    expect(restored.floodSurge).toBeCloseTo(world.floodSurge, 6);
    expect(restored.settlements[0].environmentalResilience).toBeCloseTo(home.environmentalResilience, 6);
    expect(restored.settlements[0].adaptationFocus).toEqual(home.adaptationFocus);
    expect(restored.chronicle.entries.length).toBe(world.chronicle.entries.length);
    expect(restored.diplomacy.getScore(home.id, neighbor.id)).toBeCloseTo(
      world.diplomacy.getScore(home.id, neighbor.id),
      6,
    );

    const restoredNode = restored.terrain.getResourceNode(sampleNode.id);
    expect(restoredNode).toBeDefined();
    expect(restoredNode!.amount).toBeCloseTo(sampleNode.amount, 2);

    // Stepping the restored world continues cleanly without errors or NaNs
    for (let i = 0; i < 30; i++) {
      restored.step(0.1);
    }
    for (const c of restored.creatures) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
      expect(Number.isFinite(c.z)).toBe(true);
    }
  });

  it('saves, lists (autosave first), loads, and deletes slots via IndexedDB SaveStore', async () => {
    const store = new SaveStore(createFakeIndexedDB());
    expect(store.isAvailable()).toBe(true);

    const world = new WorldState(new EventBus(), {
      seed: 98765,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 4,
    });

    const olderManual = buildSaveRecord({
      slotId: makeManualSlotId('Early Spring'),
      name: 'Early Spring',
      world,
      savedAt: 1_700_000_001_000,
    });
    const autosave = buildSaveRecord({
      slotId: DEFAULT_AUTOSAVE_SLOT_ID,
      name: 'Autosave',
      world,
      savedAt: 1_700_000_002_000,
    });
    const newerManual = buildSaveRecord({
      slotId: makeManualSlotId('Golden Harvest'),
      name: 'Golden Harvest',
      world,
      savedAt: 1_700_000_003_000,
    });

    await store.save(olderManual);
    await store.save(newerManual);
    await store.save(autosave);

    const listed = await store.listSlots();
    expect(listed.map((s) => s.name)).toEqual(['Autosave', 'Golden Harvest', 'Early Spring']);

    const loadedAuto = await store.loadAutosave();
    expect(loadedAuto).not.toBeNull();
    expect(loadedAuto?.meta.seed).toBe(98765);

    await store.deleteSlot(olderManual.slotId);
    const afterDelete = await store.listSlots();
    expect(afterDelete.map((s) => s.name)).toEqual(['Autosave', 'Golden Harvest']);

    // Unavailable IndexedDB degrades gracefully without throwing
    const offlineStore = new SaveStore(null);
    expect(offlineStore.isAvailable()).toBe(false);
    expect(await offlineStore.loadAutosave()).toBeNull();
    expect(await offlineStore.listSlots()).toEqual([]);

    // Malformed payloads are rejected safely
    expect(isValidSaveRecord({ version: 99 })).toBe(false);
    expect(isValidSaveRecord(null)).toBe(false);
  });
});
