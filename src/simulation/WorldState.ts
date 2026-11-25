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
import { generateCreatureName } from './creatures/SpeciesCatalog';
import { ProceduralGod } from './deity/ProceduralGod';
import type { Settlement } from './settlements/Settlement';
import { SettlementManager } from './settlements/SettlementManager';
import { Chronicle } from './society/Chronicle';
import { DiplomacySystem } from './society/DiplomacySystem';
import { EconomySystem } from './society/EconomySystem';
import { TerrainMap } from './terrain/TerrainMap';

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * Central headless simulation container.
 * Has zero Three.js dependencies so it can be unit-tested or run in a Worker.
 */
export class WorldState {
  readonly config: WorldConfig;
  readonly rng: SeededRandom;
  readonly terrain: TerrainMap;
  readonly deity: ProceduralGod;
  readonly chronicle: Chronicle;
  readonly creatureAI: CreatureAI;
  readonly settlementManager: SettlementManager;
  readonly economy: EconomySystem;
  readonly diplomacy: DiplomacySystem;

  readonly settlements: Settlement[] = [];
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
    this.deity = new ProceduralGod(this.config.seed, this.config.deityDecisionIntervalSec);
    this.chronicle = new Chronicle(bus);
    this.creatureAI = new CreatureAI();
    this.settlementManager = new SettlementManager();
    this.economy = new EconomySystem();
    this.diplomacy = new DiplomacySystem();

    this.settlementManager.createInitialSettlements(this);
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
    const angle = this.rng.range(0, Math.PI * 2);
    const radius = this.rng.range(2.2, Math.min(6.8, Math.max(3.2, settlement.radius * 0.78)));
    const x = settlement.center.x + Math.cos(angle) * radius;
    const z = settlement.center.z + Math.sin(angle) * radius;
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

    // Advance day / time-of-day / seasons
    const dayFraction = dt / this.config.dayLengthSeconds;
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
    this.diplomacy.tick(this, dt);

    for (const creature of this.creatures) {
      if (creature.alive) {
        this.creatureAI.updateCreature(creature, this, dt);
      }
    }

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
    const pool: Record<Season, WeatherType[]> = {
      spring: ['sunbeams', 'blossom', 'clear', 'rain', 'mist'],
      summer: ['clear', 'sunbeams', 'clear', 'rain', 'storm'],
      autumn: ['mist', 'clear', 'sunbeams', 'rain', 'storm'],
      winter: ['snow', 'mist', 'clear', 'snow'],
    };
    this.weather = this.rng.pick(pool[this.season]);
    this.weatherTimer = this.rng.range(24, 52);
  }
}
