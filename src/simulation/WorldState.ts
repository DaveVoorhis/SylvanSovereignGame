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
import { SPECIES_CATALOG, generateCreatureName } from './creatures/SpeciesCatalog';
import { ProceduralGod } from './deity/ProceduralGod';
import type { Settlement } from './settlements/Settlement';
import { SettlementManager } from './settlements/SettlementManager';
import { Chronicle } from './society/Chronicle';
import { DiplomacySystem } from './society/DiplomacySystem';
import { EconomySystem } from './society/EconomySystem';
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

  readonly settlements: Settlement[] = [];
  readonly bridges: BridgeInstance[] = [];
  readonly creatures: Creature[] = [];
  readonly activeDivineEffects: DivineEffectVisual[] = [];
  readonly activeCombatSparks: CombatSparkVisual[] = [];

  elapsedSeconds = 0;
  day = 1;
  timeOfDay = 0.34; // 0..1 (0.25 dawn, 0.5 noon, 0.78 dusk, 0/1 midnight)
  season: Season = 'spring';
  weather: WeatherType = 'sunbeams';

  private weatherTimer = 40;
  private creatureSeq = 1;
  private sparkSeq = 1;
  private routeRefreshTimer = 0;

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

    this.settlementManager.createInitialSettlements(this);
    this.obstacles.sync(this.terrain, this.settlements, this.bridges);
    this.diplomacy.initialize(this.settlements, this);

    this.chronicle.record(
      1,
      this.season,
      'deity',
      `${this.deity.name} ${this.deity.epithet}`,
      `A new woodland age begins under ${this.deity.name} (${this.deity.aspect}).`,
    );
  }

  spawnCreature(settlement: Settlement, species: SpeciesId, role: CreatureRole): Creature {
    this.obstacles.sync(this.terrain, this.settlements, this.bridges);
    const def = SPECIES_CATALOG[species];
    const obstacleR = Math.max(0.26, def.bodyScale * 0.36);
    const personalR = Math.max(0.32, def.bodyScale * 0.42);
    const maxSpawnR = Math.min(7.5, Math.max(3.6, settlement.radius * 0.82));

    let x = settlement.center.x + 2.6;
    let z = settlement.center.z;
    let bestClearance = -Infinity;

    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const radius = this.rng.range(2.2, maxSpawnR);
      const rawX = settlement.center.x + Math.cos(angle) * radius;
      const rawZ = settlement.center.z + Math.sin(angle) * radius;
      const safe = this.obstacles.pushPointOutsideObstacles(
        rawX,
        rawZ,
        settlement.center.x,
        settlement.center.z,
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
        const otherR = Math.max(0.32, other.def.bodyScale * 0.42);
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

    const creature = new Creature({
      id: `cr_${this.creatureSeq++}`,
      name: generateCreatureName(() => this.rng.next()),
      species,
      settlementId: settlement.id,
      role,
      x,
      y,
      z,
      animPhase: this.rng.range(0, Math.PI * 2),
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

  getSettlement(id: string): Settlement | undefined {
    return this.settlements.find((s) => s.id === id);
  }

  getBridge(id: string): BridgeInstance | undefined {
    return this.bridges.find((b) => b.id === id);
  }

  getCreature(id: string): Creature | undefined {
    return this.creatures.find((c) => c.id === id);
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
    this.obstacles.sync(this.terrain, this.settlements, this.bridges);
    this.diplomacy.tick(this, dt);

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
