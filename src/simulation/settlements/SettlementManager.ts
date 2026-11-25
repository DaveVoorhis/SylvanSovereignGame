import type { BuildingType, CreatureRole, ResourceType, SpeciesId, Vec2 } from '@core/Types';
import { SeededRandom } from '@core/SeededRandom';
import type { Creature } from '@simulation/creatures/Creature';
import type { BridgeInstance, BridgeStyle } from '@simulation/terrain/Bridge';
import type { WorldState } from '@simulation/WorldState';
import {
  ALL_BUILDING_TYPES,
  BUILDING_CATALOG,
  FACTION_BANNER_COLORS,
  SETTLEMENT_NAMES,
} from './BuildingCatalog';
import { Settlement, type BuildingInstance } from './Settlement';

const MAX_BUILDINGS_PER_SETTLEMENT = 34;
const MAX_BRIDGES_PER_WORLD = 6;
const MAX_BRIDGES_PER_SETTLEMENT = 2;

const SPECIES_GROUPS: readonly SpeciesId[][] = [
  ['squirrel', 'robin', 'mouse', 'owl'],
  ['rabbit', 'hedgehog', 'sparrow', 'badger'],
  ['fox', 'crow', 'rat', 'squirrel'],
  ['frog', 'sparrow', 'mouse', 'robin'],
  ['badger', 'hedgehog', 'owl', 'rabbit'],
];

const STARTER_CIVICS: readonly BuildingType[] = [
  'workshop',
  'market_stall',
  'bakery',
  'granary',
  'shrine',
];

export interface EmigrationParty {
  readonly id: string;
  readonly sourceSettlementId: string;
  readonly targetX: number;
  readonly targetZ: number;
  readonly species: SpeciesId[];
}

/**
 * Manages woodland settlement creation, organic multi-ring city expansion,
 * pioneer emigration to found new villages, structural disassembly & redevelopment,
 * waterway bridge spans, civic production, and population growth.
 */
export class SettlementManager {
  private settlementSeq = 1;
  private buildingSeq = 1;
  private bridgeSeq = 1;
  private emigrationSeq = 1;
  private expansionCooldown = 2.5;
  private bridgeCooldown = 5.5;
  private emigrationCooldown = 14.0;
  private bridgeRng: SeededRandom | null = null;
  private emigrationRng: SeededRandom | null = null;
  private readonly activeEmigrations = new Map<string, EmigrationParty>();

  createInitialSettlements(world: WorldState): void {
    const sites = world.terrain.findSettlementSites(
      world.config.initialSettlements,
      world.rng,
    );

    sites.forEach((site, idx) => {
      const id = `settlement_${this.settlementSeq++}`;
      const name = SETTLEMENT_NAMES[idx % SETTLEMENT_NAMES.length];
      const bannerColor = FACTION_BANNER_COLORS[idx % FACTION_BANNER_COLORS.length];
      const groundY = world.terrain.getHeightAt(site.x, site.z);

      const settlement = new Settlement({
        id,
        name,
        bannerColor,
        center: site,
        groundY,
        foundingSpecies: [...SPECIES_GROUPS[idx % SPECIES_GROUPS.length]],
      });

      world.settlements.push(settlement);
      world.structureRevision++;

      // Start each founding village with a cozy cottage, a starter civic hall, and a fresh stage-0 build plot
      this.placeBuilding(settlement, 'burrow_cottage', world, true);
      this.placeBuilding(settlement, STARTER_CIVICS[idx % STARTER_CIVICS.length], world, true);
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

    this.bridgeCooldown -= dt;
    if (this.bridgeCooldown <= 0) {
      this.bridgeCooldown = 6.0;
      if (!this.bridgeRng) {
        this.bridgeRng = new SeededRandom(world.config.seed ^ 0x42524944);
      }
      for (const settlement of world.settlements) {
        this.considerNewBridge(settlement, world, this.bridgeRng);
      }
    }

    this.emigrationCooldown -= dt;
    if (this.emigrationCooldown <= 0) {
      this.emigrationCooldown = 14.0;
      if (!this.emigrationRng) {
        this.emigrationRng = new SeededRandom(world.config.seed ^ 0x454d4947);
      }
      this.pruneStaleEmigrations(world);
      for (const settlement of world.settlements) {
        this.considerEmigration(settlement, world, this.emigrationRng);
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

  /**
   * Called once builders finish disassembling an older structure: salvages timber & stone,
   * removes the old structure, and raises the larger replacement building on the reclaimed plot.
   */
  onBuildingDisassembled(
    settlement: Settlement,
    building: BuildingInstance,
    builder: Creature,
    world: WorldState,
  ): void {
    const oldBp = BUILDING_CATALOG[building.type];
    const salvagedTimber = Math.round((oldBp.cost.timber ?? 0) * 0.5);
    const salvagedStone = Math.round((oldBp.cost.stone ?? 0) * 0.5);
    settlement.stockpile.timber += salvagedTimber;
    settlement.stockpile.stone += salvagedStone;

    const idx = settlement.buildings.findIndex((b) => b.id === building.id);
    if (idx !== -1) {
      settlement.buildings.splice(idx, 1);
    }
    world.structureRevision++;

    const replacement = building.replacementType;
    if (replacement) {
      const newBp = BUILDING_CATALOG[replacement];
      if (this.canAfford(settlement, newBp.cost)) {
        this.spendResources(settlement, newBp.cost);
        // Plot is already cleared; begin leveling & foundation for the larger replacement
        this.commitBuilding(
          settlement,
          replacement,
          {
            x: building.position.x,
            z: building.position.z,
            groundY: building.groundY,
            rotation: building.rotation,
          },
          false,
          world,
          20,
        );
        settlement.lastBuiltType = replacement;
        settlement.recalculateTierAndRadius();
        world.chronicle.record(
          world.day,
          world.season,
          'settlement',
          `${oldBp.displayName} Replaced`,
          `${builder.name} dismantled an old ${oldBp.displayName} in ${settlement.name} to make room for a ${newBp.displayName}.`,
          building.position,
        );
        return;
      }
    }

    settlement.recalculateTierAndRadius();
    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      `${oldBp.displayName} Disassembled`,
      `${builder.name} carefully dismantled an older ${oldBp.displayName} in ${settlement.name}, salvaging materials.`,
      building.position,
    );
  }

  /**
   * Founds a brand-new woodland village when emigrating pioneer creatures arrive at their chosen clearing.
   */
  foundEmigrantVillage(partyId: string, leader: Creature, world: WorldState): Settlement | null {
    const party = this.activeEmigrations.get(partyId);
    if (!party) return null;
    this.activeEmigrations.delete(partyId);

    if (world.settlements.length >= world.config.maxSettlements) {
      this.clearPartyCreatures(partyId, world);
      return null;
    }

    const parent = world.getSettlement(party.sourceSettlementId);
    const seqIdx = this.settlementSeq - 1;
    const id = `settlement_${this.settlementSeq++}`;
    const usedNames = new Set(world.settlements.map((s) => s.name));
    const name =
      SETTLEMENT_NAMES.find((n) => !usedNames.has(n)) ??
      SETTLEMENT_NAMES[seqIdx % SETTLEMENT_NAMES.length];
    const bannerColor = FACTION_BANNER_COLORS[seqIdx % FACTION_BANNER_COLORS.length];
    const groundY = world.terrain.getHeightAt(party.targetX, party.targetZ);

    const settlement = new Settlement({
      id,
      name,
      bannerColor,
      center: { x: party.targetX, z: party.targetZ },
      groundY,
      foundingSpecies: [...party.species],
    });
    // Pioneers arrive with modest starter supplies (less than the founding capital)
    settlement.stockpile.timber = 24;
    settlement.stockpile.stone = 12;
    settlement.stockpile.berries = 20;
    settlement.stockpile.acorns = 18;
    settlement.stockpile.herbs = 8;
    settlement.stockpile.crafts = 3;

    world.settlements.push(settlement);
    world.structureRevision++;

    // Transfer all living emigrants in the party to their new village
    for (const c of world.creatures) {
      if (c.alive && c.emigrationPartyId === partyId) {
        c.settlementId = settlement.id;
        c.emigrationPartyId = null;
        c.emigrationTargetX = null;
        c.emigrationTargetZ = null;
        c.activity = 'idle';
        c.targetX = settlement.center.x + world.rng.range(-3, 3);
        c.targetZ = settlement.center.z + world.rng.range(-3, 3);
        c.mood = Math.min(100, c.mood + 20);
        c.thought = `Founding our new home at ${settlement.name}!`;
      }
    }

    // Accompanying kin who traveled with the settlers help break ground right away
    const companionRoles: CreatureRole[] = ['builder', 'forager', 'builder', 'artisan'];
    for (const role of companionRoles) {
      if (world.creatures.filter((c) => c.alive).length >= world.config.maxPopulation) break;
      const species = world.rng.pick(settlement.foundingSpecies);
      world.spawnCreature(settlement, species, role);
    }

    // Stake out the fledgling village's very first construction plots at stage 0 (clearing land!)
    this.placeBuilding(settlement, 'burrow_cottage', world, false);
    this.placeBuilding(settlement, STARTER_CIVICS[seqIdx % STARTER_CIVICS.length], world, false);
    settlement.recalculateTierAndRadius();

    world.diplomacy.registerSettlement(settlement, world, parent);

    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      `${settlement.name} Founded by Pioneers`,
      `${leader.name} and pioneers from ${parent?.name ?? 'the valley'} settled ${settlement.name} and began clearing land.`,
      settlement.center,
    );
    return settlement;
  }

  /** Returns active pioneer expeditions currently trekking across the valley. */
  getActiveEmigrations(): readonly EmigrationParty[] {
    return Array.from(this.activeEmigrations.values());
  }

  private clearPartyCreatures(partyId: string, world: WorldState): void {
    for (const c of world.creatures) {
      if (c.emigrationPartyId === partyId) {
        c.emigrationPartyId = null;
        c.emigrationTargetX = null;
        c.emigrationTargetZ = null;
        if (c.activity === 'emigrating') c.activity = 'idle';
      }
    }
  }

  private pruneStaleEmigrations(world: WorldState): void {
    for (const [partyId] of this.activeEmigrations) {
      const hasLivingPioneer = world.creatures.some(
        (c) => c.alive && c.emigrationPartyId === partyId && c.activity === 'emigrating',
      );
      if (!hasLivingPioneer) {
        this.activeEmigrations.delete(partyId);
      }
    }
  }

  onBridgeCompleted(
    settlement: Settlement,
    bridge: BridgeInstance,
    builder: Creature,
    world: WorldState,
  ): void {
    world.terrain.registerCompletedBridge(bridge);
    settlement.devotionTotal += 6;
    settlement.recalculateTierAndRadius();

    const styleLabel = bridge.style === 'stone_arch' ? 'stone arch bridge' : 'timber arch bridge';
    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      'Woodland Bridge Completed',
      `${builder.name} completed a ${styleLabel} across the waterway for ${settlement.name}.`,
      { x: bridge.centerX, z: bridge.centerZ },
    );
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

    // As villages grow, creatures may disassemble an older small structure to make space for a larger one
    if (this.considerRedevelopment(settlement, world, candidates)) {
      return;
    }

    for (const type of candidates) {
      const bp = BUILDING_CATALOG[type];
      if (!this.canAfford(settlement, bp.cost)) continue;

      // Verify a valid building spot BEFORE spending resources so stockpiles are never wasted
      const spot = this.findBuildingSpot(settlement, type, world);
      if (!spot) {
        // Plot space is full: try disassembling a smaller older structure for this larger one
        if (this.tryScheduleDisassemblyFor(settlement, type, world)) {
          return;
        }
        continue;
      }

      this.spendResources(settlement, bp.cost);
      this.commitBuilding(settlement, type, spot, false, world, 0);
      settlement.lastBuiltType = type;
      settlement.recalculateTierAndRadius();
      return;
    }
  }

  /**
   * Organically schedules redevelopment when a growing village has older small structures
   * and wants to raise a grander, larger civic or residential building in prime town space.
   */
  private considerRedevelopment(
    settlement: Settlement,
    world: WorldState,
    candidates: readonly BuildingType[],
  ): boolean {
    if (settlement.getCompletedCount() < 5) return false;
    if (settlement.buildings.some((b) => b.disassembling)) return false;
    if (!world.rng.chance(0.24)) return false;

    for (const desired of candidates) {
      const bp = BUILDING_CATALOG[desired];
      if (bp.footprintRadius < 2.5 && bp.prosperityValue < 22) continue;
      if (this.tryScheduleDisassemblyFor(settlement, desired, world)) {
        return true;
      }
    }
    return false;
  }

  private tryScheduleDisassemblyFor(
    settlement: Settlement,
    replacementType: BuildingType,
    world: WorldState,
  ): boolean {
    if (settlement.buildings.some((b) => b.disassembling)) return false;
    const newBp = BUILDING_CATALOG[replacementType];

    // Prefer replacing smaller, earlier structures (cottages, stalls, duplicate small workshops/granaries)
    const replaceable = settlement.buildings.filter((b) => {
      if (!b.completed || b.disassembling) return false;
      const oldBp = BUILDING_CATALOG[b.type];
      const isStrictlyLarger = newBp.footprintRadius > oldBp.footprintRadius + 0.05;
      const isMuchGrander = newBp.prosperityValue >= oldBp.prosperityValue + 12;
      if (!isStrictlyLarger && !isMuchGrander) return false;
      if (b.type === 'burrow_cottage') return settlement.getCompletedCount('burrow_cottage') >= 2;
      if (b.type === 'market_stall' || b.type === 'granary' || b.type === 'workshop') {
        return settlement.getCompletedCount(b.type) >= 2 || oldBp.footprintRadius < newBp.footprintRadius;
      }
      return false;
    });
    if (replaceable.length === 0) return false;

    for (const victim of replaceable) {
      const oldBp = BUILDING_CATALOG[victim.type];
      // Verify affordability factoring in 50% salvaged timber/stone
      const effectiveCost: Partial<Record<ResourceType, number>> = { ...newBp.cost };
      if (effectiveCost.timber) {
        effectiveCost.timber = Math.max(
          0,
          effectiveCost.timber - Math.round((oldBp.cost.timber ?? 0) * 0.5),
        );
      }
      if (effectiveCost.stone) {
        effectiveCost.stone = Math.max(
          0,
          effectiveCost.stone - Math.round((oldBp.cost.stone ?? 0) * 0.5),
        );
      }
      if (!this.canAfford(settlement, effectiveCost)) continue;

      // Check that the larger footprint fits cleanly on the victim's plot
      let fits = true;
      const minCenterDist = 3.5 + newBp.footprintRadius * 0.45;
      if (
        Math.hypot(settlement.center.x - victim.position.x, settlement.center.z - victim.position.z) <
        minCenterDist
      ) {
        fits = false;
      }
      if (fits) {
        for (const otherSettlement of world.settlements) {
          for (const existing of otherSettlement.buildings) {
            if (existing.id === victim.id) continue;
            const minGap =
              newBp.footprintRadius + BUILDING_CATALOG[existing.type].footprintRadius + 0.55;
            if (
              Math.hypot(
                existing.position.x - victim.position.x,
                existing.position.z - victim.position.z,
              ) < minGap
            ) {
              fits = false;
              break;
            }
          }
          if (!fits) break;
        }
      }
      if (!fits) continue;

      victim.disassembling = true;
      victim.completed = false;
      victim.replacementType = replacementType;
      world.structureRevision++;

      world.chronicle.record(
        world.day,
        world.season,
        'settlement',
        `Redeveloping ${settlement.name}`,
        `Builders began disassembling an older ${oldBp.displayName} in ${settlement.name} to make space for a ${newBp.displayName}.`,
        victim.position,
      );
      return true;
    }

    return false;
  }

  /**
   * Dispatches adventurous pioneer creatures from growing settlements to emigrate across
   * the valley and establish new villages.
   */
  private considerEmigration(settlement: Settlement, world: WorldState, rng: SeededRandom): void {
    if (world.settlements.length + this.activeEmigrations.size >= world.config.maxSettlements) return;

    const pop = world.getSettlementPopulation(settlement.id);
    const minPop = world.settlements.length === 1 ? 9 : 11;
    if (pop < minPop || settlement.getCompletedCount() < 3) return;
    if (settlement.stockpile.timber < 10 || settlement.stockpile.berries + settlement.stockpile.acorns < 10) {
      return;
    }

    const launchChance = world.settlements.length === 1 ? 0.68 : 0.42;
    if (!rng.chance(launchChance)) return;

    const occupied: Vec2[] = world.settlements.map((s) => s.center);
    for (const active of this.activeEmigrations.values()) {
      occupied.push({ x: active.targetX, z: active.targetZ });
    }
    const site = world.terrain.findNewSettlementSite(occupied, rng);
    if (!site) return;

    // Pick 2-3 sturdy pioneers (preferring at least 1 builder and 1 forager)
    const eligible = world.creatures.filter(
      (c) =>
        c.alive &&
        c.settlementId === settlement.id &&
        c.activity !== 'fighting' &&
        c.activity !== 'fleeing' &&
        c.activity !== 'emigrating',
    );
    if (eligible.length < 4) return;

    const pioneers: Creature[] = [];
    const pickByRole = (role: CreatureRole) => {
      const found = eligible.find((c) => c.role === role && !pioneers.includes(c));
      if (found) pioneers.push(found);
    };
    pickByRole('builder');
    pickByRole('forager');
    for (const c of eligible) {
      if (pioneers.length >= 3) break;
      if (!pioneers.includes(c)) pioneers.push(c);
    }
    if (pioneers.length < 2) return;

    settlement.stockpile.timber = Math.max(0, settlement.stockpile.timber - 10);
    settlement.stockpile.berries = Math.max(0, settlement.stockpile.berries - 6);
    settlement.stockpile.acorns = Math.max(0, settlement.stockpile.acorns - 4);

    const partyId = `emig_${this.emigrationSeq++}`;
    const speciesGroup = SPECIES_GROUPS[(world.settlements.length + this.emigrationSeq) % SPECIES_GROUPS.length];
    const partySpecies = Array.from(new Set([...pioneers.map((p) => p.species), ...speciesGroup])).slice(0, 4);

    const party: EmigrationParty = {
      id: partyId,
      sourceSettlementId: settlement.id,
      targetX: site.x,
      targetZ: site.z,
      species: partySpecies,
    };
    this.activeEmigrations.set(partyId, party);

    for (const pioneer of pioneers) {
      pioneer.activity = 'emigrating';
      pioneer.emigrationPartyId = partyId;
      pioneer.emigrationTargetX = site.x;
      pioneer.emigrationTargetZ = site.z;
      pioneer.targetBuildingId = null;
      pioneer.targetBridgeId = null;
      pioneer.targetResourceId = null;
      pioneer.targetX = site.x + rng.range(-1.5, 1.5);
      pioneer.targetZ = site.z + rng.range(-1.5, 1.5);
      pioneer.actionTimer = 75;
      pioneer.thought = `Emigrating from ${settlement.name} to found a new woodland village`;
    }

    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      'Woodland Pioneers Depart',
      `${pioneers.map((p) => p.name).join(', ')} set out from ${settlement.name} to establish a new village across the valley.`,
      settlement.center,
    );
  }

  /**
   * Lets settlements autonomously decide to span nearby waterways with curved timber
   * or mossy stone bridges whenever materials and riverbank crossings allow.
   */
  private considerNewBridge(settlement: Settlement, world: WorldState, rng: SeededRandom): void {
    if (world.bridges.length >= MAX_BRIDGES_PER_WORLD) return;

    let ownedCount = 0;
    for (const b of world.bridges) {
      if (b.settlementId === settlement.id) {
        ownedCount++;
        if (!b.completed) return;
      }
    }
    if (ownedCount >= MAX_BRIDGES_PER_SETTLEMENT) return;

    // Organic pacing so settlements raise bridges when inspired rather than all at once
    if (!rng.chance(0.35)) return;

    const preferStone =
      (settlement.tier === 'town' || settlement.tier === 'city' || settlement.tier === 'metropolis') &&
      settlement.stockpile.stone >= 10 &&
      settlement.stockpile.timber >= 6;
    const style: BridgeStyle = preferStone ? 'stone_arch' : 'timber_arch';
    const cost = style === 'stone_arch' ? { timber: 6, stone: 10 } : { timber: 11, stone: 3 };
    if (!this.canAfford(settlement, cost)) return;

    const avoidPoints: { x: number; z: number; radius: number }[] = [];
    for (const s of world.settlements) {
      avoidPoints.push({ x: s.center.x, z: s.center.z, radius: 4.5 });
      for (const b of s.buildings) {
        avoidPoints.push({
          x: b.position.x,
          z: b.position.z,
          radius: BUILDING_CATALOG[b.type].footprintRadius + 0.8,
        });
      }
    }

    const crossing = world.terrain.findRiverCrossingNear(
      settlement.center.x,
      settlement.center.z,
      rng,
      world.bridges,
      avoidPoints,
      54,
    );
    if (!crossing) return;

    this.spendResources(settlement, cost);
    const bridge: BridgeInstance = {
      id: `bridge_${this.bridgeSeq++}`,
      settlementId: settlement.id,
      style,
      ...crossing,
      progress: 0,
      completed: false,
    };
    world.bridges.push(bridge);
    world.structureRevision++;

    const styleLabel = style === 'stone_arch' ? 'stone arch bridge' : 'timber footbridge';
    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      'Bridge Span Begun',
      `Builders from ${settlement.name} began raising a ${styleLabel} across the stream.`,
      { x: bridge.centerX, z: bridge.centerZ },
    );
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
    return this.commitBuilding(settlement, type, spot, completed, world, 0);
  }

  private commitBuilding(
    settlement: Settlement,
    type: BuildingType,
    spot: { x: number; z: number; groundY: number; rotation: number },
    completed: boolean,
    world: WorldState,
    initialProgress = 0,
  ): BuildingInstance {
    const instance: BuildingInstance = {
      id: `bld_${this.buildingSeq++}`,
      settlementId: settlement.id,
      type,
      position: { x: spot.x, z: spot.z },
      groundY: spot.groundY,
      rotation: spot.rotation,
      progress: completed ? 100 : initialProgress,
      completed,
    };
    settlement.buildings.push(instance);
    world.structureRevision++;
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
