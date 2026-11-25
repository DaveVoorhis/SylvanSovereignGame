import {
  createEmptyResources,
  type BuildingType,
  type ResourceBundle,
  type SettlementTier,
  type SpeciesId,
  type Vec2,
} from '@core/Types';
import { BUILDING_CATALOG } from './BuildingCatalog';

export interface BuildingInstance {
  readonly id: string;
  readonly settlementId: string;
  readonly type: BuildingType;
  readonly position: Vec2;
  readonly groundY: number;
  readonly rotation: number;
  progress: number; // 0..100
  completed: boolean;
}

export class Settlement {
  readonly id: string;
  readonly name: string;
  readonly bannerColor: number;
  readonly center: Vec2;
  readonly groundY: number;
  readonly foundingSpecies: SpeciesId[];
  readonly stockpile: ResourceBundle = createEmptyResources();
  readonly buildings: BuildingInstance[] = [];

  tier: SettlementTier = 'hamlet';
  radius = 9.5;
  treasury = 30;
  prosperity = 20;
  devotionTotal = 10;
  tradeVolume = 0;
  nextPlannedBuilding: BuildingType | null = null;
  lastBuiltType: BuildingType | null = null;

  constructor(params: {
    id: string;
    name: string;
    bannerColor: number;
    center: Vec2;
    groundY: number;
    foundingSpecies: SpeciesId[];
  }) {
    this.id = params.id;
    this.name = params.name;
    this.bannerColor = params.bannerColor;
    this.center = params.center;
    this.groundY = params.groundY;
    this.foundingSpecies = params.foundingSpecies;

    // Seed initial supplies so early building & trading begin quickly
    this.stockpile.timber = 30;
    this.stockpile.berries = 24;
    this.stockpile.acorns = 22;
    this.stockpile.stone = 16;
    this.stockpile.herbs = 10;
    this.stockpile.crafts = 6;
  }

  getHousingCapacity(): number {
    let cap = 6; // Central hearth & tree hollows
    for (const b of this.buildings) {
      if (b.completed) {
        cap += BUILDING_CATALOG[b.type].housingCapacity;
      }
    }
    return cap;
  }

  getCompletedCount(type?: BuildingType): number {
    let count = 0;
    for (const b of this.buildings) {
      if (b.completed && (!type || b.type === type)) {
        count++;
      }
    }
    return count;
  }

  /** Counts both completed and currently under-construction buildings of a given type. */
  getBuildingCount(type?: BuildingType): number {
    if (!type) return this.buildings.length;
    let count = 0;
    for (const b of this.buildings) {
      if (b.type === type) count++;
    }
    return count;
  }

  getDistinctBuildingTypeCount(completedOnly = false): number {
    const types = new Set<BuildingType>();
    for (const b of this.buildings) {
      if (!completedOnly || b.completed) {
        types.add(b.type);
      }
    }
    return types.size;
  }

  recalculateTierAndRadius(): SettlementTier {
    const completed = this.getCompletedCount();
    const varietyBonus = this.getDistinctBuildingTypeCount(true) * 8;
    let prosperity = 15 + this.treasury * 0.25 + this.tradeVolume * 0.6 + varietyBonus;
    let farthestDist = 5.5;
    for (const b of this.buildings) {
      const dist = Math.hypot(b.position.x - this.center.x, b.position.z - this.center.z);
      if (dist > farthestDist) farthestDist = dist;
      if (b.completed) {
        prosperity += BUILDING_CATALOG[b.type].prosperityValue;
      }
    }
    this.prosperity = Math.round(prosperity);

    let nextTier: SettlementTier = 'hamlet';
    if (completed >= 18 && this.prosperity >= 420) {
      nextTier = 'metropolis';
    } else if (completed >= 11 && this.prosperity >= 230) {
      nextTier = 'city';
    } else if (completed >= 6 && this.prosperity >= 125) {
      nextTier = 'town';
    } else if (completed >= 3 && this.prosperity >= 60) {
      nextTier = 'village';
    }

    this.tier = nextTier;
    const tierBaseRadius =
      nextTier === 'metropolis'
        ? 25
        : nextTier === 'city'
          ? 20.5
          : nextTier === 'town'
            ? 16.5
            : nextTier === 'village'
              ? 13
              : 9.5;
    this.radius = Math.min(31, Math.max(tierBaseRadius, farthestDist + 4.5));
    return nextTier;
  }
}
