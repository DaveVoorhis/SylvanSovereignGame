import {
  createEmptyResources,
  type CreatureActivity,
  type CreatureRole,
  type ResourceBundle,
  type ResourceType,
  type SpeciesId,
  type Vec2,
} from '@core/Types';
import { SPECIES_CATALOG, type SpeciesDefinition } from './SpeciesCatalog';

export interface CreaturePersonality {
  readonly friendliness: number; // 0..1
  readonly ambition: number; // 0..1
  readonly bravery: number; // 0..1
  readonly piety: number; // 0..1
  readonly curiosity: number; // 0..1
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
  wealth = 8;

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
    this.maxHealth = this.def.maxHealth;
    this.health = this.def.maxHealth;
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
}
