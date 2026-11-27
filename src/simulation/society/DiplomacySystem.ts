import type { DiplomaticStance } from '@core/Types';
import type { Settlement } from '@simulation/settlements/Settlement';
import type { WorldState } from '@simulation/WorldState';

export interface DiplomacySnapshot {
  readonly timer: number;
  readonly relations: readonly [string, number][];
}

/**
 * Tracks emergent relationships between woodland settlements:
 * alliances forged by trade, rivalries sparked by ambition, border wars, and truces.
 */
export class DiplomacySystem {
  private readonly relations = new Map<string, number>(); // key "a|b" -> [-100, 100]
  private timer = 10;

  private static pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  initialize(settlements: readonly Settlement[], world: WorldState): void {
    this.relations.clear();
    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        const key = DiplomacySystem.pairKey(settlements[i].id, settlements[j].id);
        this.relations.set(key, world.rng.range(-18, 32));
      }
    }
  }

  /** Registers diplomatic ties for a newly founded emigrant village (starting friendly with its parent). */
  registerSettlement(
    newSettlement: Settlement,
    world: WorldState,
    parentSettlement?: Settlement,
  ): void {
    for (const other of world.settlements) {
      if (other.id === newSettlement.id) continue;
      const key = DiplomacySystem.pairKey(newSettlement.id, other.id);
      if (this.relations.has(key)) continue;
      const initialScore =
        parentSettlement && other.id === parentSettlement.id ? 38 : world.rng.range(-10, 28);
      this.relations.set(key, initialScore);
    }
  }

  getScore(a: string, b: string): number {
    if (a === b) return 100;
    return this.relations.get(DiplomacySystem.pairKey(a, b)) ?? 0;
  }

  getStance(a: string, b: string): DiplomaticStance {
    const score = this.getScore(a, b);
    if (score >= 55) return 'allied';
    if (score >= 18) return 'friendly';
    if (score >= -18) return 'neutral';
    if (score >= -50) return 'tense';
    return 'war';
  }

  adjustRelation(
    a: Settlement,
    b: Settlement,
    delta: number,
    world: WorldState,
    reason?: string,
  ): void {
    if (a.id === b.id) return;
    const key = DiplomacySystem.pairKey(a.id, b.id);
    const prevStance = this.getStance(a.id, b.id);
    const next = Math.max(-100, Math.min(100, (this.relations.get(key) ?? 0) + delta));
    this.relations.set(key, next);
    const nextStance = this.getStance(a.id, b.id);

    if (prevStance !== nextStance) {
      if (nextStance === 'allied') {
        world.chronicle.record(
          world.day,
          world.season,
          'social',
          'Woodland Alliance',
          `${a.name} and ${b.name} swore a pact of friendship${reason ? ` (${reason})` : ''}.`,
          a.center,
        );
      } else if (nextStance === 'war') {
        world.chronicle.record(
          world.day,
          world.season,
          'combat',
          'Border War Declared',
          `Tensions boiled over—${a.name} and ${b.name} are now at war${reason ? ` (${reason})` : ''}!`,
          a.center,
        );
        world.deity.observeConflict(3.5);
      } else if (prevStance === 'war') {
        world.chronicle.record(
          world.day,
          world.season,
          'social',
          'Woodland Truce',
          `Envoys of ${a.name} and ${b.name} laid down spears and declared a truce.`,
          a.center,
        );
      }
    }
  }

  findWarTarget(settlementId: string, settlements: readonly Settlement[]): Settlement | null {
    for (const other of settlements) {
      if (other.id !== settlementId && this.getStance(settlementId, other.id) === 'war') {
        return other;
      }
    }
    return null;
  }

  tick(world: WorldState, dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = world.config.diplomacyIntervalSec;

    const list = world.settlements;
    if (list.length < 2) return;

    const a = world.rng.pick(list);
    const b = world.rng.pick(list.filter((s) => s.id !== a.id));
    if (!b) return;

    const currentStance = this.getStance(a.id, b.id);
    if (currentStance === 'war') {
      // Wars eventually exhaust themselves into truces
      if (world.rng.chance(0.32)) {
        this.adjustRelation(a, b, 34, world, 'war weariness');
      }
      return;
    }

    // Subtle organic drift influenced by the Procedural God's chaos/wrath vs benevolence
    const tensionBias = (world.deity.traits.wrath + world.deity.traits.chaos) * 0.5 - world.deity.traits.benevolence * 0.6;
    const roll = world.rng.gaussian(-tensionBias * 14, 16);
    if (Math.abs(roll) > 9) {
      this.adjustRelation(
        a,
        b,
        roll,
        world,
        roll < 0 ? 'foraging border dispute' : 'shared harvest festival',
      );
    }
  }

  exportSnapshot(): DiplomacySnapshot {
    return {
      timer: this.timer,
      relations: Array.from(this.relations.entries()),
    };
  }

  importSnapshot(snapshot: DiplomacySnapshot): void {
    this.timer = snapshot.timer;
    this.relations.clear();
    for (const [key, score] of snapshot.relations) {
      this.relations.set(key, score);
    }
  }
}
