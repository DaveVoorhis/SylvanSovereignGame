import type {
  ActiveWar,
  SpeciesId,
  Vec2,
  WarOutcome,
  WarPhase,
  WarWeapon,
} from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import type { Settlement } from '@simulation/settlements/Settlement';
import type { WorldState } from '@simulation/WorldState';

export interface WeaponStats {
  readonly weapon: WarWeapon;
  readonly label: string;
  readonly icon: string;
  readonly range: number;
  readonly minRange: number;
  readonly damageMult: number;
  readonly cooldown: number;
  readonly strikeDuration: number;
  readonly knockback: number;
  readonly hasShield: boolean;
}

export const WEAPON_CATALOG: Record<WarWeapon, WeaponStats> = {
  spear: {
    weapon: 'spear',
    label: 'War Spear',
    icon: '🔱',
    range: 2.75,
    minRange: 0,
    damageMult: 1.15,
    cooldown: 1.02,
    strikeDuration: 0.4,
    knockback: 0.58,
    hasShield: true,
  },
  sword: {
    weapon: 'sword',
    label: 'Broadsword',
    icon: '⚔️',
    range: 2.35,
    minRange: 0,
    damageMult: 1.12,
    cooldown: 0.86,
    strikeDuration: 0.36,
    knockback: 0.48,
    hasShield: true,
  },
  battle_axe: {
    weapon: 'battle_axe',
    label: 'Battle-Axe',
    icon: '🪓',
    range: 2.45,
    minRange: 0,
    damageMult: 1.52,
    cooldown: 1.28,
    strikeDuration: 0.5,
    knockback: 0.96,
    hasShield: false,
  },
  war_club: {
    weapon: 'war_club',
    label: 'Spiked War-Club',
    icon: '🏏',
    range: 2.25,
    minRange: 0,
    damageMult: 1.38,
    cooldown: 1.16,
    strikeDuration: 0.46,
    knockback: 1.18,
    hasShield: true,
  },
  bow: {
    weapon: 'bow',
    label: 'Yew Longbow',
    icon: '🏹',
    range: 13.5,
    minRange: 4.2,
    damageMult: 0.9,
    cooldown: 1.4,
    strikeDuration: 0.42,
    knockback: 0.3,
    hasShield: false,
  },
};

export const UNARMED_SKIRMISH_STATS: WeaponStats = {
  weapon: 'war_club',
  label: 'Claws & Tooth',
  icon: '🐾',
  range: 2.2,
  minRange: 0,
  damageMult: 0.92,
  cooldown: 1.15,
  strikeDuration: 0.38,
  knockback: 0.4,
  hasShield: false,
};

export function getWeaponStats(weapon: WarWeapon | null): WeaponStats {
  return weapon ? WEAPON_CATALOG[weapon] : UNARMED_SKIRMISH_STATS;
}

const HEAVY_WARRIOR_SPECIES = new Set<SpeciesId>([
  'bear',
  'badger',
  'wolf',
  'beaver',
  'turtle',
  'hedgehog',
]);

export interface WarSnapshot {
  readonly seq: number;
  readonly totalWarsFought: number;
  readonly totalVictories: number;
  readonly totalTruces: number;
  readonly truceCooldowns: readonly [string, number][];
  readonly activeWars: readonly ActiveWar[];
}

export interface WarArmyStats {
  readonly survivingA: number;
  readonly survivingB: number;
  readonly totalSurviving: number;
  readonly atRallyA: number;
  readonly atRallyB: number;
  readonly atFieldA: number;
  readonly atFieldB: number;
}

/**
 * Orchestrates organized woodland border wars between rival settlements:
 * - Amasses armed armies of villagers (guards + mobilized militia) at village rally points
 * - Equips soldiers with melee & ranged weapons (spears, swords, battle-axes, war-clubs, bows)
 * - Marches both armies to a walkable battlefield between the two villages
 * - Resolves pitched battles until one side achieves a clear victory by a significant majority
 *   of surviving members, or a truce is declared (diplomatically or through war weariness).
 */
export class WarSystem {
  readonly activeWars: ActiveWar[] = [];
  totalWarsFought = 0;
  totalVictories = 0;
  totalTruces = 0;

  private seq = 1;
  private readonly truceCooldowns = new Map<string, number>();

  static pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  isOnWarCooldown(aId: string, bId: string): boolean {
    return (this.truceCooldowns.get(WarSystem.pairKey(aId, bId)) ?? 0) > 0;
  }

  getWarById(id: string): ActiveWar | undefined {
    for (let i = 0; i < this.activeWars.length; i++) {
      if (this.activeWars[i].id === id) return this.activeWars[i];
    }
    return undefined;
  }

  getWarBetween(aId: string, bId: string): ActiveWar | undefined {
    const key = WarSystem.pairKey(aId, bId);
    for (let i = 0; i < this.activeWars.length; i++) {
      const w = this.activeWars[i];
      if (WarSystem.pairKey(w.settlementAId, w.settlementBId) === key) {
        return w;
      }
    }
    return undefined;
  }

  getWarForSettlement(settlementId: string): ActiveWar | undefined {
    for (let i = 0; i < this.activeWars.length; i++) {
      const w = this.activeWars[i];
      if (w.settlementAId === settlementId || w.settlementBId === settlementId) {
        return w;
      }
    }
    return undefined;
  }

  getEnemySettlementId(war: ActiveWar, settlementId: string): string {
    return war.settlementAId === settlementId ? war.settlementBId : war.settlementAId;
  }

  /** Computes a neat multi-rank warband formation slot around a rally or vanguard anchor. */
  getArmyTargetSlotPosition(
    war: ActiveWar,
    creature: Creature,
    anchorKind: 'rally' | 'front',
  ): Vec2 {
    const isSideA = creature.settlementId === war.settlementAId;
    const anchor =
      anchorKind === 'rally'
        ? isSideA
          ? war.rallyA
          : war.rallyB
        : isSideA
          ? war.frontA
          : war.frontB;

    const toEnemyX = war.battlefield.x - anchor.x;
    const toEnemyZ = war.battlefield.z - anchor.z;
    const len = Math.hypot(toEnemyX, toEnemyZ);
    const fwdX = len > 0.01 ? toEnemyX / len : isSideA ? 1 : -1;
    const fwdZ = len > 0.01 ? toEnemyZ / len : 0;
    const rightX = -fwdZ;
    const rightZ = fwdX;

    // Archers stand slightly behind the melee front line; melee forms ranks abreast
    const isArcher = creature.warWeapon === 'bow';
    const slot = creature.warFormationSlot;
    const cols = 5;
    const col = slot % cols;
    const row = Math.floor(slot / cols) + (isArcher ? 1.4 : 0);
    const lateralIndex = col - (cols - 1) * 0.5;
    const lateralSpacing = anchorKind === 'front' ? 2.15 : 1.75;
    const depthSpacing = anchorKind === 'front' ? 2.1 : 1.7;

    return {
      x: anchor.x + rightX * (lateralIndex * lateralSpacing) - fwdX * (row * depthSpacing),
      z: anchor.z + rightZ * (lateralIndex * lateralSpacing) - fwdZ * (row * depthSpacing),
    };
  }

  /** Counts active surviving soldiers and rally/battlefield arrival progress for both sides. */
  getActiveArmyStats(war: ActiveWar, world: WorldState): WarArmyStats {
    let survivingA = 0;
    let atRallyA = 0;
    let atFieldA = 0;
    for (let i = 0; i < war.armyAIds.length; i++) {
      const c = world.getCreature(war.armyAIds[i]);
      if (!c || !c.alive || c.activeWarId !== war.id) continue;
      survivingA++;
      if (Math.hypot(c.x - war.rallyA.x, c.z - war.rallyA.z) <= 11.5) atRallyA++;
      if (Math.hypot(c.x - war.battlefield.x, c.z - war.battlefield.z) <= 22) atFieldA++;
    }

    let survivingB = 0;
    let atRallyB = 0;
    let atFieldB = 0;
    for (let i = 0; i < war.armyBIds.length; i++) {
      const c = world.getCreature(war.armyBIds[i]);
      if (!c || !c.alive || c.activeWarId !== war.id) continue;
      survivingB++;
      if (Math.hypot(c.x - war.rallyB.x, c.z - war.rallyB.z) <= 11.5) atRallyB++;
      if (Math.hypot(c.x - war.battlefield.x, c.z - war.battlefield.z) <= 22) atFieldB++;
    }

    return {
      survivingA,
      survivingB,
      totalSurviving: survivingA + survivingB,
      atRallyA,
      atRallyB,
      atFieldA,
      atFieldB,
    };
  }

  /** Launches a war campaign between two settlements, amassing armed armies and picking a battlefield between them. */
  startWar(
    a: Settlement,
    b: Settlement,
    world: WorldState,
    reason?: string,
  ): ActiveWar | null {
    if (a.id === b.id) return null;
    const existing = this.getWarBetween(a.id, b.id);
    if (existing) return existing;

    const dx = b.center.x - a.center.x;
    const dz = b.center.z - a.center.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const ux = dx / dist;
    const uz = dz / dist;
    const perpX = -uz;
    const perpZ = ux;

    // Pick a walkable battlefield located between the two villages
    const midFrac = world.rng.range(0.42, 0.58);
    const latOffset = world.rng.range(-0.08, 0.08) * Math.min(dist, 64);
    const idealFieldX = a.center.x + dx * midFrac + perpX * latOffset;
    const idealFieldZ = a.center.z + dz * midFrac + perpZ * latOffset;
    const battlefield = this.findWalkableBattlefield(idealFieldX, idealFieldZ, a, b, world);

    // Rally staging points just outside each village facing the battlefield
    const dirToFieldAX = battlefield.x - a.center.x;
    const dirToFieldAZ = battlefield.z - a.center.z;
    const distAF = Math.max(1, Math.hypot(dirToFieldAX, dirToFieldAZ));
    const rallyDistA = Math.min(distAF * 0.35, Math.max(a.radius + 3.2, 9.5));
    const rallyA = this.clampToWalkableSpot(
      a.center.x + (dirToFieldAX / distAF) * rallyDistA,
      a.center.z + (dirToFieldAZ / distAF) * rallyDistA,
      a.center,
      world,
    );

    const dirToFieldBX = battlefield.x - b.center.x;
    const dirToFieldBZ = battlefield.z - b.center.z;
    const distBF = Math.max(1, Math.hypot(dirToFieldBX, dirToFieldBZ));
    const rallyDistB = Math.min(distBF * 0.35, Math.max(b.radius + 3.2, 9.5));
    const rallyB = this.clampToWalkableSpot(
      b.center.x + (dirToFieldBX / distBF) * rallyDistB,
      b.center.z + (dirToFieldBZ / distBF) * rallyDistB,
      b.center,
      world,
    );

    // Vanguard lines opposite each other across the battlefield center
    const frontOffset = Math.min(8.5, Math.max(4.2, dist * 0.14));
    const frontA = this.clampToWalkableSpot(
      battlefield.x - (dirToFieldAX / distAF) * frontOffset,
      battlefield.z - (dirToFieldAZ / distAF) * frontOffset,
      battlefield,
      world,
    );
    const frontB = this.clampToWalkableSpot(
      battlefield.x - (dirToFieldBX / distBF) * frontOffset,
      battlefield.z - (dirToFieldBZ / distBF) * frontOffset,
      battlefield,
      world,
    );

    const war: ActiveWar = {
      id: `war_${this.seq++}`,
      settlementAId: a.id,
      settlementBId: b.id,
      startedAt: world.elapsedSeconds,
      startedDay: world.day,
      phase: 'mustering',
      phaseElapsed: 0,
      battlefield,
      rallyA,
      rallyB,
      frontA,
      frontB,
      armyAIds: [],
      armyBIds: [],
      initialCountA: 0,
      initialCountB: 0,
      casualtiesA: 0,
      casualtiesB: 0,
      routedA: 0,
      routedB: 0,
      totalStrikes: 0,
      engagedSeconds: 0,
    };

    war.armyAIds = this.mobilizeArmy(war, a, b, world);
    war.armyBIds = this.mobilizeArmy(war, b, a, world);
    war.initialCountA = war.armyAIds.length;
    war.initialCountB = war.armyBIds.length;

    this.activeWars.push(war);
    this.totalWarsFought++;

    world.chronicle.record(
      world.day,
      world.season,
      'combat',
      `📯 Warhorns Sound: ${a.name} vs ${b.name}`,
      `${a.name} (${war.initialCountA} armed kin) and ${b.name} (${war.initialCountB} armed kin) are amassing armies to march and clash between their villages${reason ? ` (${reason})` : ''}!`,
      battlefield,
    );
    return war;
  }

  /** Advances war phases, synchronizes with diplomacy, and resolves clear victories or truces. */
  tick(world: WorldState, dt: number): void {
    // 1. Decay post-war cooldown timers
    for (const [key, remaining] of this.truceCooldowns) {
      const next = remaining - dt;
      if (next <= 0) {
        this.truceCooldowns.delete(key);
      } else {
        this.truceCooldowns.set(key, next);
      }
    }

    // 2. Ensure every settlement pair at 'war' stance has an active war campaign
    if (world.diplomacy.hasActiveWarRelations()) {
      const warPairs = world.diplomacy.getPairsByStance(world.settlements, 'war');
      for (let i = 0; i < warPairs.length; i++) {
        const [sA, sB] = warPairs[i];
        if (!this.getWarBetween(sA.id, sB.id)) {
          this.startWar(sA, sB, world);
        }
      }
    }

    // 3. Step each active war
    for (let i = this.activeWars.length - 1; i >= 0; i--) {
      const war = this.activeWars[i];
      const sA = world.getSettlement(war.settlementAId);
      const sB = world.getSettlement(war.settlementBId);

      // External truce or missing settlement?
      if (!sA || !sB || world.diplomacy.getStance(war.settlementAId, war.settlementBId) !== 'war') {
        this.concludeWar(war, 'truce', world, true);
        continue;
      }

      // Prune fallen / demobilized soldiers from rosters cleanly
      this.pruneRoster(war.armyAIds, war.id, world);
      this.pruneRoster(war.armyBIds, war.id, world);

      war.phaseElapsed += dt;
      const stats = this.getActiveArmyStats(war, world);

      if (war.phase === 'mustering') {
        const readyA = stats.survivingA === 0 || stats.atRallyA >= Math.ceil(stats.survivingA * 0.72);
        const readyB = stats.survivingB === 0 || stats.atRallyB >= Math.ceil(stats.survivingB * 0.72);
        const mustered = (war.phaseElapsed >= 3.2 && readyA && readyB) || war.phaseElapsed >= 7.5;
        if (mustered) {
          this.transitionToMarching(war, sA, sB, world);
        }
      } else if (war.phase === 'marching') {
        const closestEnemyDist = this.measureClosestArmyDistance(war, world, 22);
        const vanguardsArrived =
          stats.atFieldA >= Math.max(1, Math.ceil(stats.survivingA * 0.35)) &&
          stats.atFieldB >= Math.max(1, Math.ceil(stats.survivingB * 0.35));
        const oneSideEmptyAtField =
          (stats.survivingA === 0 && stats.atFieldB > 0) ||
          (stats.survivingB === 0 && stats.atFieldA > 0) ||
          (stats.survivingA === 0 && stats.survivingB === 0);

        if (
          closestEnemyDist <= 22 ||
          vanguardsArrived ||
          oneSideEmptyAtField ||
          war.phaseElapsed >= 42
        ) {
          this.transitionToEngaged(war, sA, sB, stats, world);
        }
      } else if (war.phase === 'engaged') {
        war.engagedSeconds += dt;
        const outcome = this.evaluateBattleOutcome(war, stats, world);
        if (outcome) {
          this.concludeWar(war, outcome, world, false);
        }
      }
    }
  }

  /** Called when DiplomacySystem lifts two warring settlements out of 'war' externally. */
  onExternalTruce(aId: string, bId: string, world: WorldState): void {
    const war = this.getWarBetween(aId, bId);
    if (!war) return;
    this.concludeWar(war, 'truce', world, true);
  }

  /** Explicitly declares a truce in an active war, ending hostilities and demobilizing both armies. */
  declareTruce(warId: string, world: WorldState): boolean {
    const war = this.getWarById(warId);
    if (!war) return false;
    this.concludeWar(war, 'truce', world, false);
    return true;
  }

  /** Records a soldier killed or routed from an active war army. */
  recordCasualty(
    warId: string,
    settlementId: string,
    kind: 'killed' | 'routed',
    creatureId: string,
  ): void {
    const war = this.getWarById(warId);
    if (!war) return;
    const isSideA = settlementId === war.settlementAId;
    if (isSideA) {
      if (kind === 'killed') war.casualtiesA++;
      else war.routedA++;
      const idx = war.armyAIds.indexOf(creatureId);
      if (idx >= 0) war.armyAIds.splice(idx, 1);
    } else if (settlementId === war.settlementBId) {
      if (kind === 'killed') war.casualtiesB++;
      else war.routedB++;
      const idx = war.armyBIds.indexOf(creatureId);
      if (idx >= 0) war.armyBIds.splice(idx, 1);
    }
  }

  /** Selects the best opposing combatant for a soldier during an engaged battle. */
  pickBattleOpponent(soldier: Creature, war: ActiveWar, world: WorldState): Creature | null {
    const enemyIds = soldier.settlementId === war.settlementAId ? war.armyBIds : war.armyAIds;
    const alliedIds = soldier.settlementId === war.settlementAId ? war.armyAIds : war.armyBIds;

    // Count how many allies are already targeting each enemy so soldiers spread across the battle line
    const targetLoad = new Map<string, number>();
    for (let i = 0; i < alliedIds.length; i++) {
      const ally = world.getCreature(alliedIds[i]);
      if (ally && ally.alive && ally.id !== soldier.id && ally.targetCreatureId) {
        targetLoad.set(ally.targetCreatureId, (targetLoad.get(ally.targetCreatureId) ?? 0) + 1);
      }
    }

    let best: Creature | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < enemyIds.length; i++) {
      const foe = world.getCreature(enemyIds[i]);
      if (!foe || !foe.alive || foe.activeWarId !== war.id) continue;
      const d = Math.hypot(foe.x - soldier.x, foe.z - soldier.z);
      const crowdPenalty = (targetLoad.get(foe.id) ?? 0) * 4.5;
      const score = d + crowdPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = foe;
      }
    }
    return best;
  }

  /** Mobilizes a village's army of guards and able-bodied villagers with diverse war weapons. */
  private mobilizeArmy(
    war: ActiveWar,
    home: Settlement,
    enemy: Settlement,
    world: WorldState,
  ): string[] {
    const eligible = world.aliveCreatures.filter(
      (c) =>
        c.alive &&
        c.settlementId === home.id &&
        c.isAdult() &&
        !c.def.strictlyAquatic &&
        c.activeWarId === null &&
        c.activity !== 'emigrating' &&
        c.health > c.maxHealth * 0.35,
    );

    if (eligible.length === 0) return [];

    // Prioritize guards and the bravest, strongest villagers
    eligible.sort((a, b) => {
      const scoreA = (a.role === 'guard' ? 1.5 : 0) + a.personality.bravery + a.def.strength * 0.04;
      const scoreB = (b.role === 'guard' ? 1.5 : 0) + b.personality.bravery + b.def.strength * 0.04;
      return scoreB - scoreA;
    });

    // Amass a substantial army (~68% of able-bodied adults) while leaving at least 1-2 caretakers when possible
    const desiredCount =
      eligible.length <= 2
        ? eligible.length
        : Math.max(2, Math.min(18, Math.min(eligible.length - 1, Math.round(eligible.length * 0.7))));

    const chosen = eligible.slice(0, desiredCount);
    const maxArchers = Math.max(1, Math.floor(chosen.length * 0.32));
    let archerCount = 0;
    const roster: string[] = [];

    for (let i = 0; i < chosen.length; i++) {
      const soldier = chosen[i];
      const weapon = this.assignWeapon(soldier, archerCount < maxArchers, world);
      if (weapon === 'bow') archerCount++;

      soldier.activeWarId = war.id;
      soldier.warWeapon = weapon;
      soldier.warFormationSlot = i;
      soldier.activity = 'marching';
      soldier.activeCelebrationId = null;
      soldier.celebrationHostSettlementId = null;
      soldier.isDancingAtCelebration = false;
      soldier.isActivelyWorking = false;
      soldier.activeConstructionStage = null;
      soldier.targetResourceId = null;
      soldier.targetBuildingId = null;
      soldier.targetBridgeId = null;
      soldier.targetCreatureId = null;
      soldier.tradeDestinationSettlementId = null;
      soldier.tradeCarrying = null;
      soldier.tradeCargoAmount = 0;

      const rallySlot = this.getArmyTargetSlotPosition(war, soldier, 'rally');
      soldier.targetX = rallySlot.x;
      soldier.targetZ = rallySlot.z;
      soldier.actionTimer = 180;
      const stats = WEAPON_CATALOG[weapon];
      soldier.thought = `Wielding my ${stats.label.toLowerCase()} — mustering against ${enemy.name}!`;
      soldier.resetNavigationState();

      roster.push(soldier.id);
    }

    return roster;
  }

  private assignWeapon(
    creature: Creature,
    allowBow: boolean,
    world: WorldState,
  ): WarWeapon {
    if (creature.role === 'guard') {
      return world.rng.weightedPick([
        { item: 'spear' as const, weight: 46 },
        { item: 'sword' as const, weight: 36 },
        { item: 'battle_axe' as const, weight: 18 },
      ]);
    }
    if (creature.def.aerial) {
      return world.rng.weightedPick([
        { item: 'spear' as const, weight: 58 },
        { item: 'sword' as const, weight: 42 },
      ]);
    }
    if (HEAVY_WARRIOR_SPECIES.has(creature.species)) {
      return world.rng.weightedPick([
        { item: 'battle_axe' as const, weight: 42 },
        { item: 'war_club' as const, weight: 34 },
        { item: 'spear' as const, weight: 24 },
      ]);
    }
    const pool: { item: WarWeapon; weight: number }[] = [
      { item: 'sword', weight: 36 },
      { item: 'spear', weight: 28 },
      { item: 'war_club', weight: 16 },
      { item: 'battle_axe', weight: 12 },
    ];
    if (allowBow) {
      pool.push({ item: 'bow', weight: 28 });
    }
    return world.rng.weightedPick(pool);
  }

  private transitionToMarching(
    war: ActiveWar,
    sA: Settlement,
    sB: Settlement,
    world: WorldState,
  ): void {
    war.phase = 'marching';
    war.phaseElapsed = 0;

    const assignMarch = (ids: readonly string[], enemy: Settlement) => {
      for (let i = 0; i < ids.length; i++) {
        const c = world.getCreature(ids[i]);
        if (!c || !c.alive || c.activeWarId !== war.id) continue;
        c.activity = 'marching';
        const slot = this.getArmyTargetSlotPosition(war, c, 'front');
        c.targetX = slot.x;
        c.targetZ = slot.z;
        c.actionTimer = 180;
        const wLabel = getWeaponStats(c.warWeapon).label.toLowerCase();
        c.thought = `Marching to war with ${wLabel} against ${enemy.name}!`;
        c.resetNavigationState();
      }
    };

    assignMarch(war.armyAIds, sB);
    assignMarch(war.armyBIds, sA);
  }

  private transitionToEngaged(
    war: ActiveWar,
    sA: Settlement,
    sB: Settlement,
    stats: WarArmyStats,
    world: WorldState,
  ): void {
    war.phase = 'engaged';
    war.phaseElapsed = 0;

    const engageSide = (ids: readonly string[], enemy: Settlement) => {
      for (let i = 0; i < ids.length; i++) {
        const c = world.getCreature(ids[i]);
        if (!c || !c.alive || c.activeWarId !== war.id) continue;
        c.activity = 'fighting';
        c.actionTimer = 45;
        const foe = this.pickBattleOpponent(c, war, world);
        c.targetCreatureId = foe?.id ?? null;
        c.thought = foe
          ? `Charging ${foe.name} of ${enemy.name}!`
          : `Holding the battlefield against ${enemy.name}!`;
        c.resetNavigationState();
      }
    };

    engageSide(war.armyAIds, sB);
    engageSide(war.armyBIds, sA);

    world.chronicle.record(
      world.day,
      world.season,
      'combat',
      `⚔️ Battle Joined: ${sA.name} vs ${sB.name}`,
      `Armies of ${sA.name} (${stats.survivingA}) and ${sB.name} (${stats.survivingB}) clashed on the field between their villages with spears, swords, axes, and bows!`,
      war.battlefield,
    );
    world.deity.observeConflict(2.5);
  }

  /**
   * Evaluates whether the battle has ended by clear victory (significant majority of surviving
   * members or complete defeat) or by battlefield truce (prolonged stalemate / war weariness).
   */
  private evaluateBattleOutcome(
    war: ActiveWar,
    stats: WarArmyStats,
    world: WorldState,
  ): WarOutcome | null {
    const { survivingA, survivingB, totalSurviving } = stats;

    // 1. Mutual annihilation / complete mutual rout
    if (survivingA === 0 && survivingB === 0) {
      return 'truce';
    }

    // 2. Total elimination / rout of one army
    if (survivingA > 0 && survivingB === 0) {
      return 'victory_a';
    }
    if (survivingB > 0 && survivingA === 0) {
      return 'victory_b';
    }

    // 3. Clear victory by a significant majority of surviving members (>= 72% and >= 2 advantage)
    //    after genuine violent combat has taken place
    const lossesA = war.casualtiesA + war.routedA;
    const lossesB = war.casualtiesB + war.routedB;
    const combatSubstantial =
      war.engagedSeconds >= 4.5 &&
      (war.totalStrikes >= 4 || lossesA + lossesB >= 2);

    if (combatSubstantial && totalSurviving > 0) {
      const shareA = survivingA / totalSurviving;
      const shareB = survivingB / totalSurviving;

      if (
        shareA >= 0.72 &&
        survivingA - survivingB >= 2 &&
        lossesB >= Math.max(1, Math.ceil(war.initialCountB * 0.35))
      ) {
        return 'victory_a';
      }
      if (
        shareB >= 0.72 &&
        survivingB - survivingA >= 2 &&
        lossesA >= Math.max(1, Math.ceil(war.initialCountA * 0.35))
      ) {
        return 'victory_b';
      }
    }

    // 4. Battlefield truce via mutual exhaustion / protracted stalemate
    const align = world.deity.getMoralAlignment(world);
    const totalInitial = Math.max(1, war.initialCountA + war.initialCountB);
    const lossRatio = (lossesA + lossesB) / totalInitial;
    const exhaustionThresholdSec = align > 0.25 ? 20 : align < -0.25 ? 42 : 30;
    const hardCapSec = align < -0.25 ? 72 : 55;

    if (
      (war.engagedSeconds >= exhaustionThresholdSec &&
        lossRatio >= 0.45 &&
        Math.abs(survivingA - survivingB) <= 1) ||
      war.engagedSeconds >= hardCapSec
    ) {
      return 'truce';
    }

    return null;
  }

  private concludeWar(
    war: ActiveWar,
    outcome: WarOutcome,
    world: WorldState,
    externalTruce: boolean,
  ): void {
    const idx = this.activeWars.indexOf(war);
    if (idx >= 0) {
      this.activeWars.splice(idx, 1);
    }

    this.truceCooldowns.set(WarSystem.pairKey(war.settlementAId, war.settlementBId), 95);

    const sA = world.getSettlement(war.settlementAId);
    const sB = world.getSettlement(war.settlementBId);
    const stats = this.getActiveArmyStats(war, world);

    // Demobilize all soldiers still linked to this war
    for (const c of world.creatures) {
      if (c.activeWarId !== war.id) continue;
      const isSideA = c.settlementId === war.settlementAId;
      c.activeWarId = null;
      c.warWeapon = null;
      c.targetCreatureId = null;
      c.combatStrikeTimer = 0;
      c.combatHitTimer = 0;
      c.combatStaggerX = 0;
      c.combatStaggerZ = 0;

      if (!c.alive) continue;
      if (c.activity === 'fighting' || c.activity === 'marching') {
        c.activity = 'idle';
        const home = world.getSettlement(c.settlementId);
        if (home) {
          const ang = world.rng.range(0, Math.PI * 2);
          const r = world.rng.range(2.2, Math.max(3.6, home.radius * 0.65));
          c.targetX = home.center.x + Math.cos(ang) * r;
          c.targetZ = home.center.z + Math.sin(ang) * r;
          c.actionTimer = 24;
          c.resetNavigationState();
        }

        if (outcome === 'truce') {
          c.mood = Math.min(100, c.mood + 6);
          c.thought = 'Lowering my weapon — a truce has been declared!';
        } else {
          const won = (outcome === 'victory_a' && isSideA) || (outcome === 'victory_b' && !isSideA);
          if (won) {
            c.mood = Math.min(100, c.mood + 18);
            const loserName = isSideA ? sB?.name ?? 'our rivals' : sA?.name ?? 'our rivals';
            c.thought = `Marching home victorious over ${loserName}!`;
          } else {
            c.mood = Math.max(12, c.mood - 14);
            const winnerName = isSideA ? sB?.name ?? 'our rivals' : sA?.name ?? 'our rivals';
            c.thought = `Returning home after yielding the field to ${winnerName}`;
          }
        }
      }
    }

    if (outcome === 'victory_a' || outcome === 'victory_b') {
      this.totalVictories++;
      const winner = outcome === 'victory_a' ? sA : sB;
      const loser = outcome === 'victory_a' ? sB : sA;
      const winSurviving = outcome === 'victory_a' ? stats.survivingA : stats.survivingB;
      const loseSurviving = outcome === 'victory_a' ? stats.survivingB : stats.survivingA;

      if (winner && loser) {
        // War spoils & morale shift
        const tribute = Math.min(loser.treasury * 0.22, 24);
        loser.treasury = Math.max(0, loser.treasury - tribute);
        winner.treasury += tribute;
        const timberSpoils = Math.min(loser.stockpile.timber * 0.18, 12);
        loser.stockpile.timber = Math.max(0, loser.stockpile.timber - timberSpoils);
        winner.stockpile.timber += timberSpoils;
        winner.prosperity = Math.min(100, winner.prosperity + 6);
        loser.prosperity = Math.max(5, loser.prosperity - 5);

        // End active war stance cleanly into uneasy post-war tense peace
        world.diplomacy.concludeWarWithPeace(winner, loser, -32);

        const totalFallen = war.casualtiesA + war.casualtiesB;
        const totalRouted = war.routedA + war.routedB;
        world.chronicle.record(
          world.day,
          world.season,
          'combat',
          `🏆 ${winner.name} Wins the Border War`,
          `${winner.name} won a clear victory over ${loser.name} (${winSurviving} vs ${loseSurviving} surviving; ${totalFallen} fallen${totalRouted > 0 ? `, ${totalRouted} routed` : ''}). The war has ended.`,
          war.battlefield,
        );
      }
    } else {
      this.totalTruces++;
      if (!externalTruce && sA && sB) {
        const align = world.deity.getMoralAlignment(world);
        world.diplomacy.concludeWarWithPeace(sA, sB, align > 0.2 ? -10 : -22);
        const totalFallen = war.casualtiesA + war.casualtiesB;
        world.chronicle.record(
          world.day,
          world.season,
          'social',
          `🏳️ Truce Declared: ${sA.name} & ${sB.name}`,
          `Envoys of ${sA.name} (${stats.survivingA} surviving) and ${sB.name} (${stats.survivingB} surviving) laid down arms and declared a truce after ${totalFallen} fell in battle.`,
          war.battlefield,
        );
      }
    }
  }

  private pruneRoster(roster: string[], warId: string, world: WorldState): void {
    for (let i = roster.length - 1; i >= 0; i--) {
      const c = world.getCreature(roster[i]);
      if (!c || !c.alive || c.activeWarId !== warId) {
        roster.splice(i, 1);
      }
    }
  }

  private measureClosestArmyDistance(
    war: ActiveWar,
    world: WorldState,
    earlyStopDist = 0,
  ): number {
    const armyB: Creature[] = [];
    for (let j = 0; j < war.armyBIds.length; j++) {
      const b = world.getCreature(war.armyBIds[j]);
      if (b && b.alive && b.activeWarId === war.id) {
        armyB.push(b);
      }
    }
    if (armyB.length === 0) return Infinity;

    const stopSq = earlyStopDist > 0 ? earlyStopDist * earlyStopDist : -1;
    let minDistSq = Infinity;
    for (let i = 0; i < war.armyAIds.length; i++) {
      const a = world.getCreature(war.armyAIds[i]);
      if (!a || !a.alive || a.activeWarId !== war.id) continue;
      const ax = a.x;
      const az = a.z;
      for (let j = 0; j < armyB.length; j++) {
        const b = armyB[j];
        const dx = ax - b.x;
        const dz = az - b.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          if (stopSq >= 0 && minDistSq <= stopSq) {
            return Math.sqrt(minDistSq);
          }
        }
      }
    }
    return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
  }

  private findWalkableBattlefield(
    idealX: number,
    idealZ: number,
    a: Settlement,
    b: Settlement,
    world: WorldState,
  ): Vec2 {
    const isGoodField = (x: number, z: number, strictDry: boolean): boolean => {
      if (Math.hypot(x, z) > world.terrain.playableRadius - 6) return false;
      const dA = Math.hypot(x - a.center.x, z - a.center.z);
      const dB = Math.hypot(x - b.center.x, z - b.center.z);
      if (dA < Math.min(a.radius + 2, Math.hypot(b.center.x - a.center.x, b.center.z - a.center.z) * 0.35)) {
        return false;
      }
      if (dB < Math.min(b.radius + 2, Math.hypot(b.center.x - a.center.x, b.center.z - a.center.z) * 0.35)) {
        return false;
      }
      return strictDry
        ? world.terrain.isWalkable(x, z, false)
        : world.terrain.canEmigrantTraverse(x, z);
    };

    // First try strict dry walkable land spiraling out from the midpoint
    for (let ring = 0; ring <= 8; ring++) {
      const r = ring * 6;
      const steps = ring === 0 ? 1 : 12;
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const cx = idealX + Math.cos(ang) * r;
        const cz = idealZ + Math.sin(ang) * r;
        if (isGoodField(cx, cz, true)) {
          const safe = world.obstacles.pushPointOutsideObstacles(cx, cz, idealX, idealZ, 1.4, 0, 0.35, ang);
          if (world.terrain.isWalkable(safe.x, safe.z, false)) {
            return { x: safe.x, z: safe.z };
          }
        }
      }
    }

    // Fallback: traversable shallows/bank near midpoint
    for (let ring = 0; ring <= 8; ring++) {
      const r = ring * 6;
      const steps = ring === 0 ? 1 : 10;
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const cx = idealX + Math.cos(ang) * r;
        const cz = idealZ + Math.sin(ang) * r;
        if (isGoodField(cx, cz, false)) {
          return { x: cx, z: cz };
        }
      }
    }

    return { x: idealX, z: idealZ };
  }

  private clampToWalkableSpot(
    x: number,
    z: number,
    fallback: Vec2,
    world: WorldState,
  ): Vec2 {
    const safe = world.obstacles.pushPointOutsideObstacles(x, z, fallback.x, fallback.z, 0.9, 0, 0.25, 0);
    if (world.terrain.isWalkable(safe.x, safe.z, false)) {
      return { x: safe.x, z: safe.z };
    }
    for (let r = 3; r <= 18; r += 3) {
      for (let s = 0; s < 8; s++) {
        const ang = (s / 8) * Math.PI * 2;
        const cx = x + Math.cos(ang) * r;
        const cz = z + Math.sin(ang) * r;
        if (world.terrain.isWalkable(cx, cz, false)) {
          return { x: cx, z: cz };
        }
      }
    }
    return { x: safe.x, z: safe.z };
  }

  exportSnapshot(): WarSnapshot {
    return {
      seq: this.seq,
      totalWarsFought: this.totalWarsFought,
      totalVictories: this.totalVictories,
      totalTruces: this.totalTruces,
      truceCooldowns: Array.from(this.truceCooldowns.entries()),
      activeWars: this.activeWars.map((w) => ({
        ...w,
        battlefield: { ...w.battlefield },
        rallyA: { ...w.rallyA },
        rallyB: { ...w.rallyB },
        frontA: { ...w.frontA },
        frontB: { ...w.frontB },
        armyAIds: [...w.armyAIds],
        armyBIds: [...w.armyBIds],
      })),
    };
  }

  importSnapshot(snapshot?: WarSnapshot): void {
    this.activeWars.length = 0;
    this.truceCooldowns.clear();
    if (!snapshot) {
      this.seq = 1;
      this.totalWarsFought = 0;
      this.totalVictories = 0;
      this.totalTruces = 0;
      return;
    }
    this.seq = snapshot.seq;
    this.totalWarsFought = snapshot.totalWarsFought;
    this.totalVictories = snapshot.totalVictories;
    this.totalTruces = snapshot.totalTruces;
    for (const [k, v] of snapshot.truceCooldowns) {
      this.truceCooldowns.set(k, v);
    }
    for (const w of snapshot.activeWars) {
      this.activeWars.push({
        ...w,
        battlefield: { ...w.battlefield },
        rallyA: { ...w.rallyA },
        rallyB: { ...w.rallyB },
        frontA: { ...w.frontA },
        frontB: { ...w.frontB },
        armyAIds: [...w.armyAIds],
        armyBIds: [...w.armyBIds],
      });
    }
  }
}

export function formatWarPhaseLabel(phase: WarPhase): string {
  switch (phase) {
    case 'mustering':
      return 'Mustering Armies';
    case 'marching':
      return 'Marching to Battle';
    case 'engaged':
      return 'Battle Raging';
  }
}
