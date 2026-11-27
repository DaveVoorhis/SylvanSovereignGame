import type {
  ChronicleEntry,
  CombatSparkVisual,
  CreatureInteractionEvent,
  DivineEffectVisual,
  SelectionTarget,
} from './Types';

export interface EngineEventMap {
  'chronicle:added': ChronicleEntry;
  'divine:effect': DivineEffectVisual;
  'combat:spark': CombatSparkVisual;
  'creature:interaction': CreatureInteractionEvent;
  'selection:changed': SelectionTarget;
  'world:reset': { seed: number };
}

type Listener<T> = (payload: T) => void;

export class EventBus {
  private readonly listeners = new Map<keyof EngineEventMap, Set<Listener<unknown>>>();

  on<K extends keyof EngineEventMap>(
    event: K,
    listener: Listener<EngineEventMap[K]>,
  ): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener as Listener<unknown>);
    return () => {
      bucket?.delete(listener as Listener<unknown>);
    };
  }

  hasListeners<K extends keyof EngineEventMap>(event: K): boolean {
    const bucket = this.listeners.get(event);
    return Boolean(bucket && bucket.size > 0);
  }

  emit<K extends keyof EngineEventMap>(event: K, payload: EngineEventMap[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const listener of bucket) {
      (listener as Listener<EngineEventMap[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
