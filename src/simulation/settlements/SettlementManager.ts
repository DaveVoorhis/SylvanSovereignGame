import type { BuildingType, CreatureRole, ResourceType, SpeciesId, Vec2 } from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import type { WorldState } from '@simulation/WorldState';
import {
  ALL_BUILDING_TYPES,
  BUILDING_CATALOG,
  FACTION_BANNER_COLORS,
  SETTLEMENT_NAMES,
} from './BuildingCatalog';
import { Settlement, type BuildingInstance } from './Settlement';

const MAX_BUILDINGS_PER_SETTLEMENT = 34;

/**
 * Manages woodland settlement creation, organic multi-ring city expansion,
 * variety-seeking building queues, civic production, and population growth.
 */
export class SettlementManager {
  private buildingSeq = 1;
  private expansionCooldown = 2.5;

  createInitialSettlements(world: WorldState): void {
    const sites = world.terrain.findSettlementSites(
      world.config.initialSettlements,
      world.rng,
    );

    const speciesGroups: SpeciesId[][] = [
      ['squirrel', 'robin', 'mouse', 'owl'],
      ['rabbit', 'hedgehog', 'sparrow', 'badger'],
      ['fox', 'crow', 'rat', 'squirrel'],
      ['frog', 'sparrow', 'mouse', 'robin'],
      ['badger', 'hedgehog', 'owl', 'rabbit'],
    ];

    const starterCivic: BuildingType[] = [
      'market_stall',
      'shrine',
      'bakery',
      'workshop',
      'granary',
    ];

    sites.forEach((site, idx) => {
      const id = `settlement_${idx + 1}`;
      const name = SETTLEMENT_NAMES[idx % SETTLEMENT_NAMES.length];
      const bannerColor = FACTION_BANNER_COLORS[idx % FACTION_BANNER_COLORS.length];
      const groundY = world.terrain.getHeightAt(site.x, site.z);

      const settlement = new Settlement({
        id,
        name,
        bannerColor,
        center: site,
        groundY,
        foundingSpecies: speciesGroups[idx % speciesGroups.length],
      });

      world.settlements.push(settlement);

      // Start each settlement with a cozy cottage, a signature civic building, and an active build site
      this.placeBuilding(settlement, 'burrow_cottage', world, true);
      this.placeBuilding(settlement, starterCivic[idx % starterCivic.length], world, true);
      this.placeBuilding(
        settlement,
        idx % 2 === 0 ? 'timber_house' : 'workshop',
        world,
        false,
      );
      settlement.recalculateTierAndRadius();

      // Spawn founding inhabitants with strong builder/forager coverage
      const roles: CreatureRole[] = [
        'builder',
        'forager',
        'builder',
        'merchant',
        'artisan',
        'forager',
        'guard',
        'mystic',
        'forager',
        'builder',
      ];
      for (let i = 0; i < world.config.initialCreaturesPerSettlement; i++) {
        const species = world.rng.pick(settlement.foundingSpecies);
        const role = roles[i % roles.length];
        world.spawnCreature(settlement, species, role);
      }

      world.chronicle.record(
        world.day,
        world.season,
        'settlement',
        `${settlement.name} Founded`,
        `Woodland kin settled ${settlement.name} with ${world.config.initialCreaturesPerSettlement} inhabitants.`,
        settlement.center,
      );
    });
  }

  tick(world: WorldState, dt: number): void {
    this.expansionCooldown -= dt;

    for (const settlement of world.settlements) {
      // Workshops refine timber into crafts and shape dressed stone for city masonry
      const workshops = settlement.getCompletedCount('workshop');
      if (workshops > 0) {
        if (settlement.stockpile.timber >= 0.35 * dt) {
          const made = workshops * 0.2 * dt;
          settlement.stockpile.timber = Math.max(0, settlement.stockpile.timber - made);
          settlement.stockpile.crafts += made * 1.4;
        }
        settlement.stockpile.stone += workshops * 0.14 * dt;
      }

      // Granaries preserve & cultivate berries and acorns
      const granaries = settlement.getCompletedCount('granary');
      if (granaries > 0) {
        settlement.stockpile.berries += granaries * 0.11 * dt;
        settlement.stockpile.acorns += granaries * 0.11 * dt;
      }

      // Bakeries turn harvest abundance into food surplus & bustling coin
      const bakeries = settlement.getCompletedCount('bakery');
      if (bakeries > 0) {
        settlement.stockpile.berries += bakeries * 0.14 * dt;
        settlement.stockpile.acorns += bakeries * 0.14 * dt;
        settlement.treasury += bakeries * 0.22 * dt;
      }

      // Windmills mill grain & saw timber planks for ongoing city construction
      const windmills = settlement.getCompletedCount('windmill');
      if (windmills > 0) {
        settlement.stockpile.timber += windmills * 0.22 * dt;
        settlement.stockpile.acorns += windmills * 0.18 * dt;
      }

      // Canopy Conservatories cultivate herbs and berries in every season
      const greenhouses = settlement.getCompletedCount('greenhouse');
      if (greenhouses > 0) {
        settlement.stockpile.herbs += greenhouses * 0.2 * dt;
        settlement.stockpile.berries += greenhouses * 0.15 * dt;
      }

      // Owl Archives inspire artisans & scholarly devotion
      const libraries = settlement.getCompletedCount('library');
      if (libraries > 0) {
        settlement.stockpile.crafts += libraries * 0.16 * dt;
        settlement.devotionTotal += libraries * 0.08 * dt;
      }

      // Grand Guildhalls coordinate city masonry, lumbering, and civic wealth
      const guildhalls = settlement.getCompletedCount('guildhall');
      if (guildhalls > 0) {
        settlement.stockpile.timber += guildhalls * 0.26 * dt;
        settlement.stockpile.stone += guildhalls * 0.22 * dt;
        settlement.treasury += guildhalls * 0.35 * dt;
      }
    }

    if (this.expansionCooldown > 0) return;
    this.expansionCooldown = 3.0;

    for (const settlement of world.settlements) {
      this.considerNewBuilding(settlement, world);
      this.considerPopulationGrowth(settlement, world);
    }
  }

  onBuildingCompleted(
    settlement: Settlement,
    building: BuildingInstance,
    builder: Creature,
    world: WorldState,
  ): void {
    const prevTier = settlement.tier;
    const blueprint = BUILDING_CATALOG[building.type];
    settlement.devotionTotal += blueprint.devotionValue;
    const nextTier = settlement.recalculateTierAndRadius();

    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      `${blueprint.displayName} Raised`,
      `${builder.name} finished constructing a ${blueprint.displayName} in ${settlement.name}.`,
      building.position,
    );

    if (nextTier !== prevTier) {
      world.chronicle.record(
        world.day,
        world.season,
        'settlement',
        `${settlement.name} Becomes a ${nextTier.toUpperCase()}`,
        `Bustling streets, spires, and warm lanterns mark ${settlement.name}'s rise to a woodland ${nextTier}!`,
        settlement.center,
      );
      world.deity.observeCivilizationMilestone(settlement);
    }
  }

  /** Returns the primary scarce resource holding back a settlement's next desired building. */
  getMostNeededResource(settlement: Settlement): ResourceType | null {
    const planned = settlement.nextPlannedBuilding;
    if (!planned) return null;
    const cost = BUILDING_CATALOG[planned].cost;
    let bestType: ResourceType | null = null;
    let biggestDeficit = 0;

    for (const [key, req] of Object.entries(cost)) {
      const res = key as ResourceType;
      if (res === 'crafts') continue; // refined in workshops, not gathered raw
      const have = settlement.stockpile[res] ?? 0;
      const deficit = (req ?? 0) - have;
      if (deficit > biggestDeficit) {
        biggestDeficit = deficit;
        bestType = res;
      }
    }
    return bestType;
  }

  private considerNewBuilding(settlement: Settlement, world: WorldState): void {
    const maxConcurrent =
      settlement.tier === 'town' || settlement.tier === 'city' || settlement.tier === 'metropolis'
        ? 3
        : 2;
    const underConstruction = settlement.buildings.filter((b) => !b.completed).length;
    if (
      underConstruction >= maxConcurrent ||
      settlement.buildings.length >= MAX_BUILDINGS_PER_SETTLEMENT
    ) {
      return;
    }

    const candidates = this.rankBuildingCandidates(settlement, world);
    settlement.nextPlannedBuilding = candidates[0] ?? null;

    for (const type of candidates) {
      const bp = BUILDING_CATALOG[type];
      if (!this.canAfford(settlement, bp.cost)) continue;

      // Verify a valid building spot BEFORE spending resources so stockpiles are never wasted
      const spot = this.findBuildingSpot(settlement, type, world);
      if (!spot) continue;

      this.spendResources(settlement, bp.cost);
      this.commitBuilding(settlement, type, spot, false);
      settlement.lastBuiltType = type;
      settlement.recalculateTierAndRadius();
      return;
    }
  }

  private rankBuildingCandidates(settlement: Settlement, world: WorldState): BuildingType[] {
    const completedTotal = settlement.getCompletedCount();
    const population = world.getSettlementPopulation(settlement.id);
    const housing = settlement.getHousingCapacity();

    const eligible = ALL_BUILDING_TYPES.filter((type) => {
      const bp = BUILDING_CATALOG[type];
      if (bp.minCompletedToUnlock && completedTotal < bp.minCompletedToUnlock) {
        return false;
      }
      return settlement.getBuildingCount(type) < bp.maxPerSettlement;
    });

    if (eligible.length === 0) return [];

    // Score each eligible building to guarantee rich architectural variety while meeting city needs
    const scored = eligible.map((type, idx) => {
      const bp = BUILDING_CATALOG[type];
      const count = settlement.getBuildingCount(type);
      const fillRatio = count / bp.maxPerSettlement;

      let score = (1 - fillRatio) * 40;

      // Strong diversity bonus for building types not yet represented in this city!
      if (count === 0) {
        score += 55;
      } else if (count === 1 && bp.maxPerSettlement >= 3) {
        score += 18;
      }

      // Housing priority when population approaches capacity
      if (population >= housing - 2 && bp.housingCapacity > 0) {
        score += 36 + bp.housingCapacity * 4;
      }

      // Early economic backbone
      if (
        count === 0 &&
        (type === 'workshop' || type === 'granary' || type === 'market_stall' || type === 'bakery')
      ) {
        score += 18;
      }

      // Iconic city landmarks get an extra push once unlocked
      if (
        count === 0 &&
        (type === 'windmill' ||
          type === 'greenhouse' ||
          type === 'fountain_plaza' ||
          type === 'library' ||
          type === 'guildhall')
      ) {
        score += 24;
      }

      // Avoid repeating the exact same type back-to-back so skylines diversify naturally
      if (type === settlement.lastBuiltType) {
        score -= 26;
      }

      // Deterministic per-settlement flavor jitter so each city develops its own personality
      const flavor =
        Math.sin(settlement.center.x * 0.43 + settlement.center.z * 0.31 + idx * 2.17) * 9;
      score += flavor;

      return { type, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((entry) => entry.type);
  }

  private considerPopulationGrowth(settlement: Settlement, world: WorldState): void {
    const aliveTotal = world.creatures.filter((c) => c.alive).length;
    if (aliveTotal >= world.config.maxPopulation) return;

    const pop = world.getSettlementPopulation(settlement.id);
    const cap = settlement.getHousingCapacity();
    const food = settlement.stockpile.berries + settlement.stockpile.acorns;

    if (pop < cap && food >= 18 && world.rng.chance(0.58)) {
      settlement.stockpile.berries = Math.max(0, settlement.stockpile.berries - 6);
      settlement.stockpile.acorns = Math.max(0, settlement.stockpile.acorns - 4);

      const species = world.rng.chance(0.75)
        ? world.rng.pick(settlement.foundingSpecies)
        : world.rng.pick([
            'crow',
            'sparrow',
            'robin',
            'squirrel',
            'mouse',
            'rat',
            'frog',
            'rabbit',
            'fox',
            'hedgehog',
            'badger',
            'owl',
          ] as const);

      // Keep growing cities well-staffed with builders and gatherers alongside merchants/artisans/guards/mystics
      const role = world.rng.pick([
        'builder',
        'builder',
        'forager',
        'forager',
        'artisan',
        'merchant',
        'guard',
        'mystic',
      ] as const);
      const newcomer = world.spawnCreature(settlement, species, role);

      world.chronicle.record(
        world.day,
        world.season,
        'social',
        'New Woodland Kin',
        `${newcomer.name}, a young ${newcomer.def.displayName}, joined ${settlement.name} as a ${role}.`,
        settlement.center,
      );
    }
  }

  private placeBuilding(
    settlement: Settlement,
    type: BuildingType,
    world: WorldState,
    completed: boolean,
  ): BuildingInstance | null {
    const spot = this.findBuildingSpot(settlement, type, world);
    if (!spot) return null;
    return this.commitBuilding(settlement, type, spot, completed);
  }

  private commitBuilding(
    settlement: Settlement,
    type: BuildingType,
    spot: { x: number; z: number; groundY: number; rotation: number },
    completed: boolean,
  ): BuildingInstance {
    const instance: BuildingInstance = {
      id: `bld_${this.buildingSeq++}`,
      settlementId: settlement.id,
      type,
      position: { x: spot.x, z: spot.z },
      groundY: spot.groundY,
      rotation: spot.rotation,
      progress: completed ? 100 : 14,
      completed,
    };
    settlement.buildings.push(instance);
    return instance;
  }

  private findBuildingSpot(
    settlement: Settlement,
    type: BuildingType,
    world: WorldState,
  ): { x: number; z: number; groundY: number; rotation: number } | null {
    const bp = BUILDING_CATALOG[type];

    // Measure current farthest building so cities grow organically outward in concentric rings
    let farthest = 6.5;
    for (const existing of settlement.buildings) {
      const d = Math.hypot(
        existing.position.x - settlement.center.x,
        existing.position.z - settlement.center.z,
      );
      if (d > farthest) farthest = d;
    }

    const maxAllowedRadius = Math.min(31, Math.max(settlement.radius + 6, farthest + 9.5));
    const ringBands: [number, number][] = [
      [3.8, Math.min(11.5, maxAllowedRadius)],
      [8.5, Math.min(18.5, maxAllowedRadius)],
      [14.0, Math.min(25.0, maxAllowedRadius)],
      [19.0, maxAllowedRadius],
    ];

    for (const [rMin, rMax] of ringBands) {
      if (rMax <= rMin + 0.5) continue;

      for (let attempt = 0; attempt < 34; attempt++) {
        const angle = world.rng.range(0, Math.PI * 2);
        const dist = world.rng.range(rMin, rMax);
        const x = settlement.center.x + Math.cos(angle) * dist;
        const z = settlement.center.z + Math.sin(angle) * dist;

        if (!world.terrain.isWithinPlayableArea(x, z, 3.5)) continue;
        if (!world.terrain.isWalkable(x, z, false)) continue;
        if (world.terrain.getSlopeAt(x, z) > 0.22) continue;

        // Avoid stepping onto any settlement's central hearth plaza
        let overlapsPlaza = false;
        for (const otherSettlement of world.settlements) {
          const minCenterDist = 3.5 + bp.footprintRadius * 0.45;
          if (
            Math.hypot(otherSettlement.center.x - x, otherSettlement.center.z - z) < minCenterDist
          ) {
            overlapsPlaza = true;
            break;
          }
        }
        if (overlapsPlaza) continue;

        // Avoid overlapping ANY building across ALL settlements
        let overlaps = false;
        for (const otherSettlement of world.settlements) {
          for (const existing of otherSettlement.buildings) {
            const minGap =
              bp.footprintRadius + BUILDING_CATALOG[existing.type].footprintRadius + 0.85;
            if (Math.hypot(existing.position.x - x, existing.position.z - z) < minGap) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) break;
        }
        if (overlaps) continue;

        const groundY = world.terrain.getHeightAt(x, z);
        const rotation =
          Math.atan2(settlement.center.x - x, settlement.center.z - z) +
          world.rng.range(-0.35, 0.35);

        return { x, z, groundY, rotation };
      }
    }

    return null;
  }

  private canAfford(
    settlement: Settlement,
    cost: Partial<Record<ResourceType, number>>,
  ): boolean {
    for (const [key, amount] of Object.entries(cost)) {
      if ((settlement.stockpile[key as ResourceType] ?? 0) < (amount ?? 0)) {
        return false;
      }
    }
    return true;
  }

  private spendResources(
    settlement: Settlement,
    cost: Partial<Record<ResourceType, number>>,
  ): void {
    for (const [key, amount] of Object.entries(cost)) {
      const res = key as ResourceType;
      settlement.stockpile[res] = Math.max(0, settlement.stockpile[res] - (amount ?? 0));
    }
  }
}

export type SettlementSpot = Vec2;
