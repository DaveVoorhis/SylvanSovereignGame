import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '@core/Config';
import type { EventBus } from '@core/EventBus';
import { SeededRandom } from '@core/SeededRandom';
import type {
  CombatSparkVisual,
  CreatureRole,
  DivineEffectVisual,
  Season,
  SpeciesId,
  Vec3,
  WeatherType,
} from '@core/Types';
import { Creature } from './creatures/Creature';
import { CreatureAI } from './creatures/CreatureAI';
import {
  SPECIES_CATALOG,
  extractSurname,
  generateCreatureName,
  generateOffspringName,
} from './creatures/SpeciesCatalog';
import { ProceduralGod } from './deity/ProceduralGod';
import type { Settlement } from './settlements/Settlement';
import { SettlementManager } from './settlements/SettlementManager';
import { Chronicle } from './society/Chronicle';
import { DiplomacySystem } from './society/DiplomacySystem';
import { EconomySystem } from './society/EconomySystem';
import { FestivalSystem } from './society/FestivalSystem';
import type { BridgeInstance } from './terrain/Bridge';
import { ObstacleMap } from './terrain/ObstacleMap';
import { TerrainMap } from './terrain/TerrainMap';

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * Smooth time-of-day pace multiplier that lingers in bright daylight & golden hour
 * (~80% of real play time) and passes briskly through deep night (~16-20% of real play time).
 */
export function getTimeOfDayPace(timeOfDay: number): number {
  const sunY = Math.sin((timeOfDay - 0.25) * Math.PI * 2);
  const t = Math.max(0, Math.min(1, (sunY + 0.18) / 0.33));
  const smooth = t * t * (3 - 2 * t);
  // Deep night (smooth = 0): 3.0x speed; bright daylight (smooth = 1): 0.68x speed
  return 3.0 + (0.68 - 3.0) * smooth;
}

/**
 * Central headless simulation container.
 * Has zero Three.js dependencies so it can be unit-tested or run in a Worker.
 */
export class WorldState {
  readonly config: WorldConfig;
  readonly rng: SeededRandom;
  readonly terrain: TerrainMap;
  readonly obstacles: ObstacleMap;
  readonly deity: ProceduralGod;
  readonly chronicle: Chronicle;
  readonly creatureAI: CreatureAI;
  readonly settlementManager: SettlementManager;
  readonly economy: EconomySystem;
  readonly diplomacy: DiplomacySystem;
  readonly festivals: FestivalSystem;

  readonly settlements: Settlement[] = [];
  readonly bridges: BridgeInstance[] = [];
  readonly creatures: Creature[] = [];
  readonly activeDivineEffects: DivineEffectVisual[] = [];
  readonly activeCombatSparks: CombatSparkVisual[] = [];

  elapsedSeconds = 0;
  day = 1;
  timeOfDay = 0.34; // 0..1 (0.25 dawn, 0.5 noon, 0.78 dusk, 0/1 midnight)
  season: Season = 'spring';
  /** Monotonic counter incremented whenever buildings, bridges, or settlements are added/removed/replaced. */
  structureRevision = 0;
  weather: WeatherType = 'sunbeams';

  private weatherTimer = 40;
  private creatureSeq = 1;
  private litterSeq = 1;
  private sparkSeq = 1;
  private routeRefreshTimer = 0;
  private readonly settlementIndex = new Map<string, number>();
  private cachedSettlementLen = -1;
  private readonly bridgeIndex = new Map<string, number>();
  private cachedBridgeLen = -1;
  private readonly creatureIndex = new Map<string, number>();
  private cachedCreatureLen = -1;

  constructor(
    readonly bus: EventBus,
    config: Partial<WorldConfig> = {},
  ) {
    this.config = { ...DEFAULT_WORLD_CONFIG, ...config };
    this.rng = new SeededRandom(this.config.seed);
    this.terrain = new TerrainMap(this.config);
    this.obstacles = new ObstacleMap();
    this.deity = new ProceduralGod(this.config.seed, this.config.deityDecisionIntervalSec);
    this.chronicle = new Chronicle(bus);
    this.creatureAI = new CreatureAI();
    this.settlementManager = new SettlementManager();
    this.economy = new EconomySystem();
    this.diplomacy = new DiplomacySystem();
    this.festivals = new FestivalSystem();

    this.settlementManager.createInitialSettlements(this);
    this.obstacles.sync(this.terrain, this.settlements, this.bridges, this.structureRevision);
    this.diplomacy.initialize(this.settlements, this);

    this.chronicle.record(
      1,
      this.season,
      'deity',
      `${this.deity.name} ${this.deity.epithet}`,
      `A new woodland age begins under ${this.deity.name} (${this.deity.aspect}).`,
    );
  }

  spawnCreature(
    settlement: Settlement,
    species: SpeciesId,
    role: CreatureRole,
    options: {
      ageDays?: number;
      lifespanDays?: number;
      generation?: number;
      parentIds?: readonly string[];
      litterId?: string | null;
      familySurname?: string;
      spawnNear?: { x: number; z: number };
      reproductionCooldown?: number;
    } = {},
  ): Creature {
    this.obstacles.sync(this.terrain, this.settlements, this.bridges, this.structureRevision);
    const def = SPECIES_CATALOG[species];
    const isNewborn = options.ageDays !== undefined && options.ageDays < 0.75;
    const sizeScale = def.bodyScale * (isNewborn ? 0.46 : 1.0);
    const obstacleR = Math.max(0.18, sizeScale * 0.36);
    const personalR = Math.max(0.22, sizeScale * 0.42);
    const anchorX = options.spawnNear?.x ?? settlement.center.x;
    const anchorZ = options.spawnNear?.z ?? settlement.center.z;
    const maxSpawnR = Math.min(7.5, Math.max(3.6, settlement.radius * 0.82));

    let x = anchorX + (options.spawnNear ? 0.9 : 2.6);
    let z = anchorZ;
    let bestClearance = -Infinity;

    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const radius = options.spawnNear ? this.rng.range(0.65, 2.35) : this.rng.range(2.2, maxSpawnR);
      const rawX = anchorX + Math.cos(angle) * radius;
      const rawZ = anchorZ + Math.sin(angle) * radius;
      const safe = this.obstacles.pushPointOutsideObstacles(
        rawX,
        rawZ,
        anchorX,
        anchorZ,
        obstacleR,
        0,
        0.18,
        angle,
      );
      if (!def.aerial && !this.terrain.isWalkable(safe.x, safe.z, def.amphibious)) {
        continue;
      }

      let minCreatureGap = Infinity;
      for (const other of this.creatures) {
        if (!other.alive || other.flightAltitude > 1.1) continue;
        const otherR = Math.max(0.22, other.getSizeScale() * 0.42);
        const gap = Math.hypot(safe.x - other.x, safe.z - other.z) - (personalR + otherR);
        if (gap < minCreatureGap) minCreatureGap = gap;
      }

      if (minCreatureGap > bestClearance) {
        bestClearance = minCreatureGap;
        x = safe.x;
        z = safe.z;
      }
      if (minCreatureGap >= 0.2) break;
    }

    const y = Math.max(this.terrain.getHeightAt(x, z), this.terrain.waterLevel);
    const name = options.familySurname
      ? generateOffspringName(() => this.rng.next(), options.familySurname)
      : generateCreatureName(() => this.rng.next());

    const creature = new Creature({
      id: `cr_${this.creatureSeq++}`,
      name,
      species,
      settlementId: settlement.id,
      role,
      x,
      y,
      z,
      animPhase: this.rng.range(0, Math.PI * 2),
      ageDays: options.ageDays ?? this.rng.range(2.4, 5.8),
      lifespanDays: options.lifespanDays ?? this.rng.range(22, 29),
      generation: options.generation ?? 1,
      parentIds: options.parentIds,
      litterId: options.litterId ?? null,
      reproductionCooldown: options.reproductionCooldown ?? this.rng.range(16, 36),
      personality: {
        friendliness: this.rng.range(0.25, 0.95),
        ambition: this.rng.range(0.2, 0.95),
        bravery: this.rng.range(0.2, 0.95),
        piety: this.rng.range(0.15, 0.92),
        curiosity: this.rng.range(0.25, 0.95),
      },
    });
    this.creatures.push(creature);
    return creature;
  }

  /** Bonds two eligible same-species adults as mates so they can raise litters together. */
  pairCreatures(a: Creature, b: Creature, settlementName?: string): boolean {
    if (!a.alive || !b.alive || a.id === b.id) return false;
    if (a.species !== b.species) return false;
    if (a.lifeStage !== 'adult' || b.lifeStage !== 'adult') return false;
    if (a.isCloseKinOf(b)) return false;

    const aMate = a.mateId ? this.getCreature(a.mateId) : undefined;
    const bMate = b.mateId ? this.getCreature(b.mateId) : undefined;
    if (aMate?.alive || bMate?.alive) return false;

    a.mateId = b.id;
    b.mateId = a.id;
    a.adjustRelationship(b.id, 38);
    b.adjustRelationship(a.id, 38);
    a.mood = Math.min(100, a.mood + 14);
    b.mood = Math.min(100, b.mood + 14);
    a.reproductionCooldown = Math.min(a.reproductionCooldown, this.rng.range(10, 22));
    b.reproductionCooldown = Math.min(b.reproductionCooldown, this.rng.range(10, 22));
    a.thought = `Paired for life with ${b.name}!`;
    b.thought = `Paired for life with ${a.name}!`;

    const place = settlementName ? ` in ${settlementName}` : '';
    this.chronicle.record(
      this.day,
      this.season,
      'social',
      'Bonded Pair',
      `${a.name} and ${b.name} (${a.def.pluralName}) paired off${place}.`,
      a.position2D,
    );
    return true;
  }

  /**
   * Spawns a litter of newborn young beside their bonded parents, linking family lineage,
   * littermate bonds, inherited surname, and recording the birth in the Chronicle.
   */
  spawnLitter(parentA: Creature, parentB: Creature, settlement: Settlement): Creature[] {
    const aliveTotal = this.creatures.filter((c) => c.alive).length;
    const room = this.config.maxPopulation - aliveTotal;
    if (room <= 0) return [];

    const [minLitter, maxLitter] = parentA.def.litterSizeRange;
    const desired = this.rng.int(minLitter, maxLitter);
    const count = Math.min(desired, room);
    if (count <= 0) return [];

    const litterId = `litter_${this.litterSeq++}`;
    const familySurname = extractSurname(this.rng.chance(0.5) ? parentA.name : parentB.name);
    const nextGen = Math.max(parentA.generation, parentB.generation) + 1;
    const roles: CreatureRole[] = [
      'builder',
      'forager',
      'artisan',
      'merchant',
      'guard',
      'mystic',
    ];
    const nestSpot = {
      x: (parentA.x + parentB.x) * 0.5,
      z: (parentA.z + parentB.z) * 0.5,
    };

    const litter: Creature[] = [];
    for (let i = 0; i < count; i++) {
      const role = this.rng.chance(0.55)
        ? this.rng.chance(0.5)
          ? parentA.role
          : parentB.role
        : this.rng.pick(roles);
      const baby = this.spawnCreature(settlement, parentA.species, role, {
        ageDays: 0,
        generation: nextGen,
        parentIds: [parentA.id, parentB.id],
        litterId,
        familySurname,
        spawnNear: nestSpot,
        reproductionCooldown: this.rng.range(18, 34),
      });
      baby.activity = 'playing';
      baby.thought = `Playing beside ${parentA.name} & ${parentB.name}`;
      baby.adjustRelationship(parentA.id, 72);
      baby.adjustRelationship(parentB.id, 72);
      parentA.adjustRelationship(baby.id, 72);
      parentB.adjustRelationship(baby.id, 72);
      parentA.offspringIds.push(baby.id);
      parentB.offspringIds.push(baby.id);
      litter.push(baby);
    }

    // Bond littermates warmly with one another so they naturally form tight playful litters
    for (let i = 0; i < litter.length; i++) {
      for (let j = i + 1; j < litter.length; j++) {
        litter[i].adjustRelationship(litter[j].id, 60);
        litter[j].adjustRelationship(litter[i].id, 60);
      }
    }

    const cooldown = this.rng.range(78, 125);
    parentA.reproductionCooldown = cooldown;
    parentB.reproductionCooldown = cooldown;
    parentA.mood = Math.min(100, parentA.mood + 18);
    parentB.mood = Math.min(100, parentB.mood + 18);
    parentA.thought = `Caring for our new litter of ${litter.length} ${parentA.def.youngPlural}!`;
    parentB.thought = `Watching over our new litter of ${litter.length} ${parentB.def.youngPlural}!`;

    const names = litter.map((b) => b.name.split(' ')[0]).join(', ');
    const youngLabel = litter.length === 1 ? parentA.def.youngSingular : parentA.def.youngPlural;
    this.chronicle.record(
      this.day,
      this.season,
      'social',
      `Litter of ${parentA.def.displayName} ${parentA.def.youngPlural.charAt(0).toUpperCase()}${parentA.def.youngPlural.slice(1)} Born`,
      `${parentA.name} and ${parentB.name} welcomed a litter of ${litter.length} ${youngLabel} (${names}) in ${settlement.name}!`,
      nestSpot,
    );
    return litter;
  }

  getSettlement(id: string): Settlement | undefined {
    const list = this.settlements;
    const idx = this.settlementIndex.get(id);
    if (idx !== undefined && idx < list.length && list[idx].id === id) {
      return list[idx];
    }
    if (this.cachedSettlementLen !== list.length) {
      this.settlementIndex.clear();
      for (let i = 0; i < list.length; i++) {
        this.settlementIndex.set(list[i].id, i);
      }
      this.cachedSettlementLen = list.length;
      const rebuilt = this.settlementIndex.get(id);
      return rebuilt !== undefined ? list[rebuilt] : undefined;
    }
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        this.settlementIndex.set(id, i);
        return list[i];
      }
    }
    return undefined;
  }

  getBridge(id: string): BridgeInstance | undefined {
    const list = this.bridges;
    const idx = this.bridgeIndex.get(id);
    if (idx !== undefined && idx < list.length && list[idx].id === id) {
      return list[idx];
    }
    if (this.cachedBridgeLen !== list.length) {
      this.bridgeIndex.clear();
      for (let i = 0; i < list.length; i++) {
        this.bridgeIndex.set(list[i].id, i);
      }
      this.cachedBridgeLen = list.length;
      const rebuilt = this.bridgeIndex.get(id);
      return rebuilt !== undefined ? list[rebuilt] : undefined;
    }
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        this.bridgeIndex.set(id, i);
        return list[i];
      }
    }
    return undefined;
  }

  getCreature(id: string): Creature | undefined {
    const list = this.creatures;
    const idx = this.creatureIndex.get(id);
    if (idx !== undefined && idx < list.length && list[idx].id === id) {
      return list[idx];
    }
    if (this.cachedCreatureLen !== list.length) {
      this.creatureIndex.clear();
      for (let i = 0; i < list.length; i++) {
        this.creatureIndex.set(list[i].id, i);
      }
      this.cachedCreatureLen = list.length;
      const rebuilt = this.creatureIndex.get(id);
      return rebuilt !== undefined ? list[rebuilt] : undefined;
    }
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        this.creatureIndex.set(id, i);
        return list[i];
      }
    }
    return undefined;
  }

  getSettlementPopulation(settlementId: string): number {
    let count = 0;
    for (const c of this.creatures) {
      if (c.alive && c.settlementId === settlementId) count++;
    }
    return count;
  }

  setWeather(weather: WeatherType, durationSec: number): void {
    this.weather = weather;
    this.weatherTimer = Math.max(10, durationSec);
  }

  emitDivineEffect(effect: DivineEffectVisual): void {
    this.activeDivineEffects.push(effect);
    this.bus.emit('divine:effect', effect);
  }

  emitCombatSpark(position: Vec3): void {
    const spark: CombatSparkVisual = {
      id: this.sparkSeq++,
      position,
      createdAt: this.elapsedSeconds,
      duration: 0.65,
    };
    this.activeCombatSparks.push(spark);
    this.bus.emit('combat:spark', spark);
  }

  /** Advances the entire woodland simulation by dt seconds (clamped for stability). */
  step(rawDt: number): void {
    const dt = Math.min(0.1, Math.max(0, rawDt));
    if (dt <= 0) return;

    this.elapsedSeconds += dt;

    // Advance day / time-of-day / seasons with daylight-biased pacing (lingering days, brisk nights)
    const dayFraction = (dt * getTimeOfDayPace(this.timeOfDay)) / this.config.dayLengthSeconds;
    this.timeOfDay += dayFraction;
    if (this.timeOfDay >= 1) {
      this.timeOfDay -= 1;
      this.day += 1;
      const seasonIdx = Math.floor((this.day - 1) / this.config.daysPerSeason) % SEASONS.length;
      const nextSeason = SEASONS[seasonIdx];
      if (nextSeason !== this.season) {
        this.season = nextSeason;
        this.chronicle.record(
          this.day,
          this.season,
          'nature',
          `The Turning to ${nextSeason.charAt(0).toUpperCase() + nextSeason.slice(1)}`,
          `The ancient forest breathes anew as ${nextSeason} settles across the valley.`,
        );
      }
    }

    // Natural weather cycle when not overridden by divine intervention
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.rollSeasonalWeather();
    }

    // Regenerate ecological nodes
    const seasonGrowth =
      this.season === 'spring'
        ? 1.35
        : this.season === 'summer'
          ? 1.15
          : this.season === 'autumn'
            ? 0.9
            : 0.45;
    this.terrain.tickResources(dt, seasonGrowth * (0.7 + this.deity.traits.verdancy * 0.6));

    // Step subsystems
    this.deity.tick(this, dt);
    this.settlementManager.tick(this, dt);
    this.obstacles.sync(this.terrain, this.settlements, this.bridges, this.structureRevision);
    this.diplomacy.tick(this, dt);
    this.festivals.tick(this, dt);

    this.creatureAI.prepareStep(this);
    for (const creature of this.creatures) {
      if (creature.alive) {
        this.creatureAI.updateCreature(creature, this, dt);
      }
    }
    this.creatureAI.resolveCreatureCollisions(this);

    // Refresh visual trade routes periodically
    this.routeRefreshTimer -= dt;
    if (this.routeRefreshTimer <= 0) {
      this.routeRefreshTimer = 1.2;
      this.economy.rebuildRouteSummary(this);
    }

    // Expire temporary VFX markers
    for (let i = this.activeDivineEffects.length - 1; i >= 0; i--) {
      const fx = this.activeDivineEffects[i];
      if (this.elapsedSeconds - fx.createdAt > fx.duration) {
        this.activeDivineEffects.splice(i, 1);
      }
    }
    for (let i = this.activeCombatSparks.length - 1; i >= 0; i--) {
      const sp = this.activeCombatSparks[i];
      if (this.elapsedSeconds - sp.createdAt > sp.duration) {
        this.activeCombatSparks.splice(i, 1);
      }
    }
  }

  private rollSeasonalWeather(): void {
    const weightedPool: Record<Season, { item: WeatherType; weight: number }[]> = {
      spring: [
        { item: 'sunbeams', weight: 36 },
        { item: 'clear', weight: 28 },
        { item: 'blossom', weight: 24 },
        { item: 'rain', weight: 10 },
        { item: 'mist', weight: 2 },
      ],
      summer: [
        { item: 'clear', weight: 40 },
        { item: 'sunbeams', weight: 38 },
        { item: 'rain', weight: 12 },
        { item: 'storm', weight: 8 },
        { item: 'mist', weight: 2 },
      ],
      autumn: [
        { item: 'clear', weight: 35 },
        { item: 'sunbeams', weight: 31 },
        { item: 'rain', weight: 18 },
        { item: 'storm', weight: 11 },
        { item: 'mist', weight: 5 },
      ],
      winter: [
        { item: 'clear', weight: 36 },
        { item: 'snow', weight: 42 },
        { item: 'sunbeams', weight: 19 },
        { item: 'mist', weight: 3 },
      ],
    };
    this.weather = this.rng.weightedPick(weightedPool[this.season]);
    // Keep rare misty spells brief while clear/sunny skies linger comfortably
    this.weatherTimer =
      this.weather === 'mist' ? this.rng.range(12, 20) : this.rng.range(28, 56);
  }
}
