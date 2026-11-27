import {
  createEmptyResources,
  type ConstructionStage,
  type CreatureActivity,
  type CreatureRole,
  type LifeStage,
  type ResourceBundle,
  type ResourceType,
  type SpeciesId,
  type Vec2,
} from '@core/Types';
import { SPECIES_CATALOG, type SpeciesDefinition } from './SpeciesCatalog';

/** Age thresholds (in simulation days) governing the creature lifecycle. */
export const YOUNG_MAX_AGE_DAYS = 0.75;
export const ADULT_AGE_DAYS = 1.6;
export const ELDER_AGE_DAYS = 16.0;

export function resolveLifeStage(ageDays: number): LifeStage {
  if (ageDays < YOUNG_MAX_AGE_DAYS) return 'young';
  if (ageDays < ADULT_AGE_DAYS) return 'juvenile';
  if (ageDays < ELDER_AGE_DAYS) return 'adult';
  return 'elder';
}

export interface CreaturePersonality {
  readonly friendliness: number; // 0..1
  readonly ambition: number; // 0..1
  readonly bravery: number; // 0..1
  readonly piety: number; // 0..1
  readonly curiosity: number; // 0..1
}

export interface CreatureSnapshot {
  readonly id: string;
  readonly name: string;
  readonly species: SpeciesId;
  readonly personality: CreaturePersonality;
  readonly settlementId: string;
  readonly role: CreatureRole;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly flightAltitude: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly energy: number;
  readonly hunger: number;
  readonly mood: number;
  readonly devotion: number;
  readonly ageDays: number;
  readonly lifeStage: LifeStage;
  readonly lifespanDays: number;
  readonly generation: number;
  readonly wealth: number;
  readonly mateId: string | null;
  readonly parentIds: readonly string[];
  readonly litterId: string | null;
  readonly offspringIds: readonly string[];
  readonly reproductionCooldown: number;
  readonly activity: CreatureActivity;
  readonly thought: string;
  readonly actionTimer: number;
  readonly attackCooldown: number;
  readonly animPhase: number;
  readonly alive: boolean;
  readonly targetResourceId: string | null;
  readonly targetBuildingId: string | null;
  readonly targetBridgeId: string | null;
  readonly targetCreatureId: string | null;
  readonly tradeDestinationSettlementId: string | null;
  readonly tradeCarrying: ResourceType | null;
  readonly tradeCargoAmount: number;
  readonly isActivelyWorking: boolean;
  readonly activeConstructionStage: ConstructionStage | null;
  readonly emigrationPartyId: string | null;
  readonly emigrationTargetX: number | null;
  readonly emigrationTargetZ: number | null;
  readonly activeCelebrationId: string | null;
  readonly celebrationHostSettlementId: string | null;
  readonly isDancingAtCelebration: boolean;
  readonly inventory: ResourceBundle;
  readonly relationships: readonly [string, number][];
}

export class Creature {
  readonly id: string;
  readonly name: string;
  readonly species: SpeciesId;
  readonly def: SpeciesDefinition;
  readonly personality: CreaturePersonality;

  settlementId: string;
  role: CreatureRole;

  x: number;
  y: number;
  z: number;
  heading: number;
  targetX: number;
  targetZ: number;
  flightAltitude = 0;

  health: number;
  maxHealth: number;
  energy = 90; // 0..100
  hunger = 15; // 0..100 (higher = hungrier)
  mood = 72; // 0..100
  devotion = 45; // 0..100
  ageDays = 0;
  lifeStage: LifeStage = 'adult';
  lifespanDays = 25;
  generation = 1;
  wealth = 8;

  /** Family lineage, bonded mate, and litter state for the creature lifecycle. */
  mateId: string | null = null;
  readonly parentIds: readonly string[];
  readonly litterId: string | null;
  readonly offspringIds: string[] = [];
  reproductionCooldown = 0;

  activity: CreatureActivity = 'idle';
  thought = 'Admiring the canopy';
  actionTimer = 0;
  attackCooldown = 0;
  animPhase: number;
  alive = true;

  /** Navigation progress & committed wall-following state to prevent tight loops. */
  navBestGoalDist = Infinity;
  navProgressTimer = 0;
  navLoopCount = 0;
  detourSign: -1 | 0 | 1 = 0;
  detourTimer = 0;
  /** Last target coordinates & obstacle map version validated for obstacle clearance. */
  validatedTargetX = NaN;
  validatedTargetZ = NaN;
  validatedObstacleVersion = -1;

  /** Optional target entity IDs for active behaviors. */
  targetResourceId: string | null = null;
  targetBuildingId: string | null = null;
  targetBridgeId: string | null = null;
  targetCreatureId: string | null = null;
  tradeDestinationSettlementId: string | null = null;
  tradeCarrying: ResourceType | null = null;
  tradeCargoAmount = 0;

  /** Live construction tool & animation state (true while actively working on a building or bridge). */
  isActivelyWorking = false;
  activeConstructionStage: ConstructionStage | null = null;

  /** Emigration pioneer party state when trekking to found a new village. */
  emigrationPartyId: string | null = null;
  emigrationTargetX: number | null = null;
  emigrationTargetZ: number | null = null;

  /** Active festival, regional event, or national holiday participation state. */
  activeCelebrationId: string | null = null;
  celebrationHostSettlementId: string | null = null;
  isDancingAtCelebration = false;

  readonly inventory: ResourceBundle = createEmptyResources();
  /** Maps another creature ID -> affinity score in [-100, 100]. */
  readonly relationships = new Map<string, number>();

  constructor(params: {
    id: string;
    name: string;
    species: SpeciesId;
    settlementId: string;
    role: CreatureRole;
    x: number;
    y: number;
    z: number;
    personality: CreaturePersonality;
    animPhase: number;
    ageDays?: number;
    lifespanDays?: number;
    generation?: number;
    parentIds?: readonly string[];
    litterId?: string | null;
    reproductionCooldown?: number;
  }) {
    this.id = params.id;
    this.name = params.name;
    this.species = params.species;
    this.def = SPECIES_CATALOG[params.species];
    this.settlementId = params.settlementId;
    this.role = params.role;
    this.x = params.x;
    this.y = params.y;
    this.z = params.z;
    this.targetX = params.x;
    this.targetZ = params.z;
    this.heading = params.animPhase;
    this.personality = params.personality;
    this.animPhase = params.animPhase;
    this.ageDays = params.ageDays ?? 3.5;
    this.lifeStage = resolveLifeStage(this.ageDays);
    this.lifespanDays = params.lifespanDays ?? 25;
    this.generation = params.generation ?? 1;
    this.parentIds = params.parentIds ? [...params.parentIds] : [];
    this.litterId = params.litterId ?? null;
    this.reproductionCooldown = params.reproductionCooldown ?? 18;
    this.maxHealth = this.def.maxHealth;
    this.health = this.def.maxHealth;
    if (this.lifeStage === 'young') {
      this.thought = `Cuddling close as a newborn ${this.def.youngSingular}`;
      this.wealth = 0;
    }
  }

  /** Smooth developmental body scale multiplier (0.44 newborn -> 0.68 juvenile -> 1.0 adult). */
  getGrowthScale(): number {
    if (this.ageDays < YOUNG_MAX_AGE_DAYS) {
      const t = Math.max(0, this.ageDays / YOUNG_MAX_AGE_DAYS);
      return 0.44 + t * 0.22;
    }
    if (this.ageDays < ADULT_AGE_DAYS) {
      const t = (this.ageDays - YOUNG_MAX_AGE_DAYS) / (ADULT_AGE_DAYS - YOUNG_MAX_AGE_DAYS);
      return 0.66 + t * 0.34;
    }
    if (this.lifeStage === 'elder') {
      return 0.96;
    }
    return 1.0;
  }

  /** Effective world body scale combining species baseline and developmental growth stage. */
  getSizeScale(): number {
    return this.def.bodyScale * this.getGrowthScale();
  }

  isYoung(): boolean {
    return this.lifeStage === 'young';
  }

  isAdult(): boolean {
    return this.lifeStage === 'adult' || this.lifeStage === 'elder';
  }

  canReproduce(): boolean {
    return this.alive && this.lifeStage === 'adult' && this.reproductionCooldown <= 0;
  }

  isCloseKinOf(other: Creature): boolean {
    if (other.id === this.id) return true;
    if (this.litterId && other.litterId && this.litterId === other.litterId) return true;
    if (this.parentIds.includes(other.id) || other.parentIds.includes(this.id)) return true;
    if (
      this.parentIds.length > 0 &&
      other.parentIds.length > 0 &&
      this.parentIds.some((pid) => other.parentIds.includes(pid))
    ) {
      return true;
    }
    return false;
  }

  /** Resets loop-detection anchor and committed detour when starting a fresh route. */
  resetNavigationState(): void {
    this.navBestGoalDist = Infinity;
    this.navProgressTimer = 0;
    this.navLoopCount = 0;
    this.detourSign = 0;
    this.detourTimer = 0;
  }

  get position2D(): Vec2 {
    return { x: this.x, z: this.z };
  }

  getTotalInventory(): number {
    return (
      this.inventory.timber +
      this.inventory.berries +
      this.inventory.acorns +
      this.inventory.stone +
      this.inventory.herbs +
      this.inventory.crafts
    );
  }

  adjustRelationship(otherId: string, delta: number): number {
    const current = this.relationships.get(otherId) ?? 0;
    const next = Math.max(-100, Math.min(100, current + delta));
    this.relationships.set(otherId, next);
    return next;
  }

  getFriendCount(): number {
    let count = 0;
    for (const score of this.relationships.values()) {
      if (score >= 25) count++;
    }
    return count;
  }

  getRivalCount(): number {
    let count = 0;
    for (const score of this.relationships.values()) {
      if (score <= -25) count++;
    }
    return count;
  }

  toSnapshot(): CreatureSnapshot {
    return {
      id: this.id,
      name: this.name,
      species: this.species,
      personality: { ...this.personality },
      settlementId: this.settlementId,
      role: this.role,
      x: this.x,
      y: this.y,
      z: this.z,
      heading: this.heading,
      targetX: this.targetX,
      targetZ: this.targetZ,
      flightAltitude: this.flightAltitude,
      health: this.health,
      maxHealth: this.maxHealth,
      energy: this.energy,
      hunger: this.hunger,
      mood: this.mood,
      devotion: this.devotion,
      ageDays: this.ageDays,
      lifeStage: this.lifeStage,
      lifespanDays: this.lifespanDays,
      generation: this.generation,
      wealth: this.wealth,
      mateId: this.mateId,
      parentIds: [...this.parentIds],
      litterId: this.litterId,
      offspringIds: [...this.offspringIds],
      reproductionCooldown: this.reproductionCooldown,
      activity: this.activity,
      thought: this.thought,
      actionTimer: this.actionTimer,
      attackCooldown: this.attackCooldown,
      animPhase: this.animPhase,
      alive: this.alive,
      targetResourceId: this.targetResourceId,
      targetBuildingId: this.targetBuildingId,
      targetBridgeId: this.targetBridgeId,
      targetCreatureId: this.targetCreatureId,
      tradeDestinationSettlementId: this.tradeDestinationSettlementId,
      tradeCarrying: this.tradeCarrying,
      tradeCargoAmount: this.tradeCargoAmount,
      isActivelyWorking: this.isActivelyWorking,
      activeConstructionStage: this.activeConstructionStage,
      emigrationPartyId: this.emigrationPartyId,
      emigrationTargetX: this.emigrationTargetX,
      emigrationTargetZ: this.emigrationTargetZ,
      activeCelebrationId: this.activeCelebrationId,
      celebrationHostSettlementId: this.celebrationHostSettlementId,
      isDancingAtCelebration: this.isDancingAtCelebration,
      inventory: { ...this.inventory },
      relationships: Array.from(this.relationships.entries()),
    };
  }

  static fromSnapshot(snapshot: CreatureSnapshot): Creature {
    const c = new Creature({
      id: snapshot.id,
      name: snapshot.name,
      species: snapshot.species,
      settlementId: snapshot.settlementId,
      role: snapshot.role,
      x: snapshot.x,
      y: snapshot.y,
      z: snapshot.z,
      personality: { ...snapshot.personality },
      animPhase: snapshot.animPhase,
      ageDays: snapshot.ageDays,
      lifespanDays: snapshot.lifespanDays,
      generation: snapshot.generation,
      parentIds: snapshot.parentIds,
      litterId: snapshot.litterId,
      reproductionCooldown: snapshot.reproductionCooldown,
    });
    c.heading = snapshot.heading;
    c.targetX = snapshot.targetX;
    c.targetZ = snapshot.targetZ;
    c.flightAltitude = snapshot.flightAltitude;
    c.health = snapshot.health;
    c.maxHealth = snapshot.maxHealth;
    c.energy = snapshot.energy;
    c.hunger = snapshot.hunger;
    c.mood = snapshot.mood;
    c.devotion = snapshot.devotion;
    c.lifeStage = snapshot.lifeStage;
    c.wealth = snapshot.wealth;
    c.mateId = snapshot.mateId;
    c.offspringIds.length = 0;
    c.offspringIds.push(...snapshot.offspringIds);
    c.activity = snapshot.activity;
    c.thought = snapshot.thought;
    c.actionTimer = snapshot.actionTimer;
    c.attackCooldown = snapshot.attackCooldown;
    c.alive = snapshot.alive;
    c.targetResourceId = snapshot.targetResourceId;
    c.targetBuildingId = snapshot.targetBuildingId;
    c.targetBridgeId = snapshot.targetBridgeId;
    c.targetCreatureId = snapshot.targetCreatureId;
    c.tradeDestinationSettlementId = snapshot.tradeDestinationSettlementId;
    c.tradeCarrying = snapshot.tradeCarrying;
    c.tradeCargoAmount = snapshot.tradeCargoAmount;
    c.isActivelyWorking = snapshot.isActivelyWorking;
    c.activeConstructionStage = snapshot.activeConstructionStage;
    c.emigrationPartyId = snapshot.emigrationPartyId;
    c.emigrationTargetX = snapshot.emigrationTargetX;
    c.emigrationTargetZ = snapshot.emigrationTargetZ;
    c.activeCelebrationId = snapshot.activeCelebrationId;
    c.celebrationHostSettlementId = snapshot.celebrationHostSettlementId;
    c.isDancingAtCelebration = snapshot.isDancingAtCelebration;
    Object.assign(c.inventory, snapshot.inventory);
    c.relationships.clear();
    for (const [otherId, score] of snapshot.relationships) {
      c.relationships.set(otherId, score);
    }
    return c;
  }
}
