import type { EventBus } from '@core/EventBus';
import type { ChronicleCategory, ChronicleEntry, Season, Vec2 } from '@core/Types';

export interface ChronicleSnapshot {
  readonly seq: number;
  readonly entries: readonly ChronicleEntry[];
}

/**
 * Maintains the living mythic chronicle of the woodland realm.
 */
export class Chronicle {
  readonly entries: ChronicleEntry[] = [];
  private seq = 1;
  private readonly maxEntries = 140;

  constructor(private readonly bus: EventBus) {}

  record(
    timestampDay: number,
    season: Season,
    category: ChronicleCategory,
    title: string,
    detail: string,
    position?: Vec2,
  ): ChronicleEntry {
    const entry: ChronicleEntry = {
      id: this.seq++,
      timestampDay: Math.max(1, Math.floor(timestampDay)),
      season,
      category,
      title,
      detail,
      position,
    };

    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }

    this.bus.emit('chronicle:added', entry);
    return entry;
  }

  exportSnapshot(): ChronicleSnapshot {
    return {
      seq: this.seq,
      entries: this.entries.map((e) => ({
        ...e,
        position: e.position ? { x: e.position.x, z: e.position.z } : undefined,
      })),
    };
  }

  importSnapshot(snapshot: ChronicleSnapshot): void {
    this.seq = Math.max(1, Math.floor(snapshot.seq));
    this.entries.length = 0;
    for (const e of snapshot.entries.slice(0, this.maxEntries)) {
      this.entries.push({
        ...e,
        position: e.position ? { x: e.position.x, z: e.position.z } : undefined,
      });
    }
  }
}
