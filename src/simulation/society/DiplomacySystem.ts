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
  /** Zero-allocation symmetric lookup table: first -> (second -> score). */
  private readonly relationByPair = new Map<string, Map<string, number>>();
  private warPairCount = 0;
  private timer = 10;

  private static pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private setPairScore(a: string, b: string, score: number): void {
    const first = a < b ? a : b;
    const second = a < b ? b : a;
    let inner = this.relationByPair.get(first);
    if (!inner) {
      inner = new Map<string, number>();
      this.relationByPair.set(first, inner);
    }
    const prev = inner.get(second);
    const wasWar = prev !== undefined && prev < -50;
    const isWar = score < -50;
    if (wasWar && !isWar) this.warPairCount = Math.max(0, this.warPairCount - 1);
    else if (!wasWar && isWar) this.warPairCount++;
    inner.set(second, score);
    this.relations.set(DiplomacySystem.pairKey(first, second), score);
  }

  /** O(1) check whether any settlement pair currently holds a 'war' diplomatic stance. */
  hasActiveWarRelations(): boolean {
    return this.warPairCount > 0;
  }

  initialize(settlements: readonly Settlement[], world: WorldState): void {
    this.relations.clear();
    this.relationByPair.clear();
    this.warPairCount = 0;
    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        this.setPairScore(settlements[i].id, settlements[j].id, world.rng.range(-18, 32));
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
      const first = newSettlement.id < other.id ? newSettlement.id : other.id;
      const second = newSettlement.id < other.id ? other.id : newSettlement.id;
      if (this.relationByPair.get(first)?.has(second)) continue;
      const initialScore =
        parentSettlement && other.id === parentSettlement.id ? 38 : world.rng.range(-10, 28);
      this.setPairScore(newSettlement.id, other.id, initialScore);
    }
  }

  getScore(a: string, b: string): number {
    if (a === b) return 100;
    const first = a < b ? a : b;
    const second = a < b ? b : a;
    return this.relationByPair.get(first)?.get(second) ?? 0;
  }

  getStance(a: string, b: string): DiplomaticStance {
    const score = this.getScore(a, b);
    if (score >= 55) return 'allied';
    if (score >= 18) return 'friendly';
    if (score >= -18) return 'neutral';
    if (score >= -50) return 'tense';
    return 'war';
  }

  /**
   * Ends an active war cleanly after battlefield victory or truce without emitting
   * a duplicate chronicle entry (WarSystem records the victory/truce chronicle).
   */
  concludeWarWithPeace(a: Settlement, b: Settlement, targetScore = -28): void {
    if (a.id === b.id) return;
    const first = a.id < b.id ? a.id : b.id;
    const second = a.id < b.id ? b.id : a.id;
    const cur = this.relationByPair.get(first)?.get(second) ?? -60;
    const clamped = Math.max(-45, Math.min(100, Math.max(cur, targetScore)));
    this.setPairScore(a.id, b.id, clamped);
  }

  adjustRelation(
    a: Settlement,
    b: Settlement,
    delta: number,
    world: WorldState,
    reason?: string,
  ): void {
    if (a.id === b.id) return;
    const prevStance = this.getStance(a.id, b.id);
    const next = Math.max(-100, Math.min(100, this.getScore(a.id, b.id) + delta));
    this.setPairScore(a.id, b.id, next);
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
        world.wars.startWar(a, b, world, reason);
      } else if (prevStance === 'war') {
        world.chronicle.record(
          world.day,
          world.season,
          'social',
          'Woodland Truce',
          `Envoys of ${a.name} and ${b.name} laid down spears and declared a truce.`,
          a.center,
        );
        world.wars.onExternalTruce(a.id, b.id, world);
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

  /** Finds an enemy settlement at war, or optionally a tense rival when destructive pressure peaks. */
  findRivalTarget(
    settlementId: string,
    settlements: readonly Settlement[],
    includeTense = false,
  ): Settlement | null {
    const warTarget = this.findWarTarget(settlementId, settlements);
    if (warTarget) return warTarget;
    if (!includeTense) return null;
    let mostTense: Settlement | null = null;
    let lowestScore = -18;
    for (const other of settlements) {
      if (other.id === settlementId) continue;
      const score = this.getScore(settlementId, other.id);
      if (score < lowestScore) {
        lowestScore = score;
        mostTense = other;
      }
    }
    return mostTense;
  }

  /** Shifts diplomatic relations across all settlement pairs in response to major ecological/moral turns. */
  applyRealmMoralShift(delta: number, world: WorldState, reason: string): void {
    const list = world.settlements;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const variance = world.rng.range(0.75, 1.25);
        this.adjustRelation(list[i], list[j], delta * variance, world, reason);
      }
    }
  }

  /** Counts active inter-settlement wars and alliances across the realm. */
  getRealmCounts(settlements: readonly Settlement[]): { wars: number; tense: number; alliances: number } {
    let wars = 0;
    let tense = 0;
    let alliances = 0;
    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        const st = this.getStance(settlements[i].id, settlements[j].id);
        if (st === 'war') wars++;
        else if (st === 'tense') tense++;
        else if (st === 'allied') alliances++;
      }
    }
    return { wars, tense, alliances };
  }

  /** Returns all unordered settlement pairs currently matching a given diplomatic stance. */
  getPairsByStance(
    settlements: readonly Settlement[],
    stance: DiplomaticStance,
  ): Array<[Settlement, Settlement]> {
    if (stance === 'war' && this.warPairCount === 0) return [];
    const pairs: Array<[Settlement, Settlement]> = [];
    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        if (this.getStance(settlements[i].id, settlements[j].id) === stance) {
          pairs.push([settlements[i], settlements[j]]);
        }
      }
    }
    return pairs;
  }

  tick(world: WorldState, dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    const alignment = world.deity.getMoralAlignment(world);
    const ecoStress = Math.min(
      1.5,
      world.climateHeat + world.climateFreeze * 0.7 + world.miasmaIntensity + world.habitatScars.length * 0.28,
    );
    const tempoMult = Math.abs(alignment) > 0.35 || ecoStress > 0.45 ? 0.62 : 1.0;
    this.timer = Math.max(4, world.config.diplomacyIntervalSec * tempoMult);

    const list = world.settlements;
    if (list.length < 2) return;

    const a = world.rng.pick(list);
    const b = world.rng.pick(list.filter((s) => s.id !== a.id));
    if (!b) return;

    const currentStance = this.getStance(a.id, b.id);
    if (currentStance === 'war') {
      // Let armies march out and join battle before random war-weariness truces interrupt,
      // unless strong benevolent stewardship intervenes directly to forge peace
      const activeWar = world.wars.getWarBetween(a.id, b.id);
      if (activeWar && activeWar.phase !== 'engaged' && alignment <= 0.45) {
        return;
      }
      if (activeWar && activeWar.phase === 'engaged' && activeWar.engagedSeconds < 10 && alignment <= 0.45) {
        return;
      }
      // Benevolent stewardship fosters swift reconciliation; destructive scarcity prolongs conflict
      const truceChance = alignment > 0.25 ? 0.62 : alignment < -0.25 ? 0.08 : 0.28;
      if (world.rng.chance(truceChance)) {
        this.adjustRelation(
          a,
          b,
          alignment > 0.25 ? 46 : 34,
          world,
          alignment > 0.25 ? 'stewardship reconciliation' : 'war weariness',
        );
      }
      return;
    }

    // Diplomatic drift strongly shaped by human-influence alignment & ecological scarcity/abundance
    const meanShift = alignment * 26 - ecoStress * 10;
    const roll = world.rng.gaussian(meanShift, 14);
    if (Math.abs(roll) > 7) {
      let effectiveRoll = roll;
      // Respect post-war truce cooldown so exhausted villages don't immediately re-ignite war
      if (effectiveRoll < 0 && world.wars.isOnWarCooldown(a.id, b.id)) {
        const curScore = this.getScore(a.id, b.id);
        if (curScore + effectiveRoll < -48) {
          effectiveRoll = Math.min(0, -48 - curScore);
        }
      }
      if (Math.abs(effectiveRoll) <= 0.5) return;

      const negReason =
        world.habitatScars.length > 0
          ? 'clash over shrinking woodland'
          : world.climateHeat > 0.25 || world.miasmaIntensity > 0.25
            ? 'scarcity-driven border raid'
            : 'foraging border dispute';
      const posReason =
        alignment > 0.3 || world.rewildingBoost > 0.2
          ? 'shared rewilding pact'
          : 'shared harvest festival';
      this.adjustRelation(
        a,
        b,
        effectiveRoll,
        world,
        effectiveRoll < 0 ? negReason : posReason,
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
    this.relationByPair.clear();
    this.warPairCount = 0;
    for (const [key, score] of snapshot.relations) {
      const sep = key.indexOf('|');
      if (sep > 0) {
        this.setPairScore(key.slice(0, sep), key.slice(sep + 1), score);
      } else {
        this.relations.set(key, score);
      }
    }
  }
}
