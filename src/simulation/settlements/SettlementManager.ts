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
import { getBiomeDisplayName, VILLAGE_ADAPTATION_CATALOG } from './VillageAdaptation';

const MAX_BUILDINGS_PER_SETTLEMENT = 34;
const MAX_BRIDGES_PER_WORLD = 12;
const MAX_BRIDGES_PER_SETTLEMENT = 3;

export interface EmigrationParty {
  readonly id: string;
  readonly sourceSettlementId: string;
  readonly targetX: number;
  readonly targetZ: number;
  readonly waypoints: readonly Vec2[];
  waypointIndex: number;
  readonly species: SpeciesId[];
}

export interface SettlementManagerSnapshot {
  readonly settlementSeq: number;
  readonly buildingSeq: number;
  readonly bridgeSeq: number;
  readonly emigrationSeq: number;
  readonly expansionCooldown: number;
  readonly bridgeCooldown: number;
  readonly emigrationCooldown: number;
  readonly expansionCursor: number;
  readonly bridgeCursor: number;
  readonly emigrationCursor: number;
  readonly bridgeRngState: number | null;
  readonly emigrationRngState: number | null;
  readonly activeEmigrations: readonly EmigrationParty[];
  readonly bridgeNoRiverUntilSec: readonly [string, number][];
}

/**
 * Manages woodland settlement creation, organic multi-ring city expansion,
 * environmental adaptation of villages to their biome, pioneer emigration to found new villages,
 * structural disassembly & redevelopment, waterway bridge spans, civic production, and population growth.
 */
export class SettlementManager {
  private settlementSeq = 1;
  private buildingSeq = 1;
  private bridgeSeq = 1;
  private emigrationSeq = 1;
  private expansionCooldown = 2.5;
  private bridgeCooldown = 5.5;
  private emigrationCooldown = 14.0;
  private expansionCursor = 0;
  private bridgeCursor = 0;
  private emigrationCursor = 0;
  private bridgeRng: SeededRandom | null = null;
  private emigrationRng: SeededRandom | null = null;
  private readonly activeEmigrations = new Map<string, EmigrationParty>();
  private readonly bridgeNoRiverUntilSec = new Map<string, number>();

  createInitialSettlements(world: WorldState): void {
    const sites = world.terrain.findSettlementSites(
      world.config.initialSettlements,
      world.rng,
    );

    const usedNames = new Set<string>();

    sites.forEach((site, idx) => {
      const id = `settlement_${this.settlementSeq++}`;
      const biome = world.terrain.getBiomeAt(site.x, site.z);
      const adaptation = world.terrain.getSiteAdaptation(site.x, site.z);
      const profile = VILLAGE_ADAPTATION_CATALOG[adaptation];

      const name =
        profile.settlementNames.find((n) => !usedNames.has(n)) ??
        SETTLEMENT_NAMES.find((n) => !usedNames.has(n)) ??
        SETTLEMENT_NAMES[idx % SETTLEMENT_NAMES.length];
      usedNames.add(name);

      const bannerColor = FACTION_BANNER_COLORS[idx % FACTION_BANNER_COLORS.length];
      const groundY =
        adaptation === 'waterway_haven'
          ? world.terrain.waterLevel
          : world.terrain.getHeightAt(site.x, site.z);

      const settlement = new Settlement({
        id,
        name,
        bannerColor,
        center: site,
        groundY,
        biome,
        adaptation,
        foundingSpecies: [...profile.adaptedSpecies],
      });

      world.settlements.push(settlement);
      world.structureRevision++;

      // Start each founding village with biome-adapted starter architecture plus a fresh stage-0 build plot
      this.placeBuilding(settlement, profile.starterHome, world, true);
      this.placeBuilding(settlement, profile.starterCivic, world, true);
      const plot = this.placeBuilding(settlement, profile.starterPlot, world, false);
      if (!plot) {
        this.placeBuilding(
          settlement,
          adaptation === 'waterway_haven' ? 'beaver_lodge' : 'burrow_cottage',
          world,
          false,
        );
      }
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
        // Spawn founding species in matched pairs so adults can pair off and raise litters
        const species =
          settlement.foundingSpecies[Math.floor(i / 2) % settlement.foundingSpecies.length];
        const role = roles[i % roles.length];
        world.spawnCreature(settlement, species, role, {
          ageDays: world.rng.range(2.4, 5.4),
          reproductionCooldown: world.rng.range(8, 22),
        });
      }

      world.chronicle.record(
        world.day,
        world.season,
        'settlement',
        `${settlement.name} Founded (${profile.shortLabel})`,
        `Woodland kin settled ${settlement.name} as a ${profile.title} in the ${getBiomeDisplayName(biome)} with ${world.config.initialCreaturesPerSettlement} inhabitants.`,
        settlement.center,
      );
    });

    // Spawn dedicated aquatic waterway villages (beavers, otters, river koi) when configured
    const extraWaterwayCount = world.config.initialWaterwaySettlements ?? 0;
    if (extraWaterwayCount > 0) {
      const occupied: Vec2[] = world.settlements.map((s) => s.center);
      const origin = sites[0];
      const waterSpacing = Math.max(40, world.terrain.size * 0.12);
      const maxRadius = world.terrain.playableRadius - 22;

      for (let w = 0; w < extraWaterwayCount; w++) {
        const waterSite = world.terrain.findWaterwaySettlementSite(
          occupied,
          waterSpacing,
          maxRadius,
          world.rng,
          origin,
        );
        if (!waterSite) break;
        occupied.push(waterSite);

        const seqIdx = this.settlementSeq - 1;
        const id = `settlement_${this.settlementSeq++}`;
        const adaptation = 'waterway_haven' as const;
        const profile = VILLAGE_ADAPTATION_CATALOG[adaptation];
        const name =
          profile.settlementNames.find((n) => !usedNames.has(n)) ??
          SETTLEMENT_NAMES.find((n) => !usedNames.has(n)) ??
          `Willow-Dam ${w + 1}`;
        usedNames.add(name);

        const bannerColor = FACTION_BANNER_COLORS[seqIdx % FACTION_BANNER_COLORS.length];
        const settlement = new Settlement({
          id,
          name,
          bannerColor,
          center: waterSite,
          groundY: world.terrain.waterLevel,
          biome: 'water',
          adaptation,
          foundingSpecies: [...profile.adaptedSpecies],
        });

        world.settlements.push(settlement);
        world.structureRevision++;

        this.placeBuilding(settlement, profile.starterHome, world, true);
        this.placeBuilding(settlement, profile.starterCivic, world, true);
        const plot = this.placeBuilding(settlement, profile.starterPlot, world, false);
        if (!plot) {
          this.placeBuilding(settlement, 'beaver_lodge', world, false);
        }
        settlement.recalculateTierAndRadius();

        // Populate with matched pairs of beavers, otters, and river koi!
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
        const aquaticFounders: SpeciesId[] = ['beaver', 'otter', 'fish'];
        for (let i = 0; i < world.config.initialCreaturesPerSettlement; i++) {
          const species = aquaticFounders[Math.floor(i / 2) % aquaticFounders.length];
          const role = roles[i % roles.length];
          world.spawnCreature(settlement, species, role, {
            ageDays: world.rng.range(2.4, 5.4),
            reproductionCooldown: world.rng.range(8, 22),
          });
        }

        world.chronicle.record(
          world.day,
          world.season,
          'settlement',
          `${settlement.name} Founded (${profile.shortLabel})`,
          `Beavers, otters, and river koi founded ${settlement.name} as a ${profile.title} in the Woodland Waterway with ${world.config.initialCreaturesPerSettlement} inhabitants.`,
          settlement.center,
        );
      }
    }
  }

  tick(world: WorldState, dt: number): void {
    this.expansionCooldown -= dt;

    for (const settlement of world.settlements) {
      // Regional environmental adaptation yields local specialties naturally
      const profile = settlement.getAdaptationProfile();
      for (const [key, rate] of Object.entries(profile.passiveYield)) {
        const res = key as ResourceType;
        if (rate) {
          settlement.stockpile[res] += rate * dt;
        }
      }

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

      // Waterwheel Mills saw driftwood timber, grind reed flour & fashion river crafts
      const waterwheels = settlement.getCompletedCount('waterwheel_mill');
      if (waterwheels > 0) {
        settlement.stockpile.timber += waterwheels * 0.25 * dt;
        settlement.stockpile.acorns += waterwheels * 0.16 * dt;
        settlement.stockpile.crafts += waterwheels * 0.12 * dt;
      }

      // Lily-Pad Markets harvest aquatic herbs, riverberries, and trade coin
      const lilyMarkets = settlement.getCompletedCount('lily_market');
      if (lilyMarkets > 0) {
        settlement.stockpile.herbs += lilyMarkets * 0.18 * dt;
        settlement.stockpile.berries += lilyMarkets * 0.16 * dt;
        settlement.treasury += lilyMarkets * 0.26 * dt;
      }

      // Aquatic Sanctuaries cultivate lotus herbs, pearl crafts & river devotion
      const sanctuaries = settlement.getCompletedCount('aquatic_sanctuary');
      if (sanctuaries > 0) {
        settlement.stockpile.herbs += sanctuaries * 0.22 * dt;
        settlement.stockpile.crafts += sanctuaries * 0.18 * dt;
        settlement.devotionTotal += sanctuaries * 0.12 * dt;
      }

      // Tide Shrines channel serene waterway prayers
      const tideShrines = settlement.getCompletedCount('tide_shrine');
      if (tideShrines > 0) {
        settlement.devotionTotal += tideShrines * 0.15 * dt;
      }
    }

    const settlementCount = world.settlements.length;
    if (settlementCount === 0) return;

    // Stagger heavy per-settlement terrain & expansion checks round-robin (1 settlement per window)
    // so growing worlds with 10–16 villages never run synchronized terrain-search spikes on one frame.
    this.bridgeCooldown -= dt;
    if (this.bridgeCooldown <= 0) {
      this.bridgeCooldown = Math.max(0.55, 6.0 / settlementCount);
      if (!this.bridgeRng) {
        this.bridgeRng = new SeededRandom(world.config.seed ^ 0x42524944);
      }
      const settlement = world.settlements[this.bridgeCursor % settlementCount];
      this.bridgeCursor = (this.bridgeCursor + 1) % settlementCount;
      this.considerNewBridge(settlement, world, this.bridgeRng);
    }

    this.emigrationCooldown -= dt;
    if (this.emigrationCooldown <= 0) {
      this.emigrationCooldown = Math.max(1.2, 14.0 / settlementCount);
      if (!this.emigrationRng) {
        this.emigrationRng = new SeededRandom(world.config.seed ^ 0x454d4947);
      }
      this.pruneStaleEmigrations(world);
      if (world.settlements.length > 0) {
        const idx = this.emigrationCursor % world.settlements.length;
        this.emigrationCursor = (idx + 1) % world.settlements.length;
        this.considerEmigration(world.settlements[idx], world, this.emigrationRng);
      }
    }

    if (this.expansionCooldown > 0) return;
    this.expansionCooldown = Math.max(0.3, 3.0 / world.settlements.length);

    if (world.settlements.length > 0) {
      const idx = this.expansionCursor % world.settlements.length;
      this.expansionCursor = (idx + 1) % world.settlements.length;
      const settlement = world.settlements[idx];
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
   * Founds a brand-new woodland village when emigrating pioneer creatures arrive at their chosen clearing,
   * adopting the architectural and ecological adaptations suited to the new biome.
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
    const biome = world.terrain.getBiomeAt(party.targetX, party.targetZ);
    const adaptation = world.terrain.getSiteAdaptation(party.targetX, party.targetZ);
    const profile = VILLAGE_ADAPTATION_CATALOG[adaptation];

    const usedNames = new Set(world.settlements.map((s) => s.name));
    const name =
      profile.settlementNames.find((n) => !usedNames.has(n)) ??
      SETTLEMENT_NAMES.find((n) => !usedNames.has(n)) ??
      SETTLEMENT_NAMES[seqIdx % SETTLEMENT_NAMES.length];
    const bannerColor = FACTION_BANNER_COLORS[seqIdx % FACTION_BANNER_COLORS.length];
    const groundY =
      adaptation === 'waterway_haven'
        ? world.terrain.waterLevel
        : world.terrain.getHeightAt(party.targetX, party.targetZ);

    const foundingSpecies = Array.from(
      new Set(
        adaptation === 'waterway_haven'
          ? [...profile.adaptedSpecies, ...party.species]
          : [...party.species, ...profile.adaptedSpecies],
      ),
    ).slice(0, 4);

    const settlement = new Settlement({
      id,
      name,
      bannerColor,
      center: { x: party.targetX, z: party.targetZ },
      groundY,
      biome,
      adaptation,
      foundingSpecies,
    });
    // Pioneers arrive with modest starter supplies (less than a founding capital)
    settlement.stockpile.timber = 24;
    settlement.stockpile.stone = adaptation === 'mountain_stone' ? 18 : 12;
    settlement.stockpile.berries = 20;
    settlement.stockpile.acorns = 18;
    settlement.stockpile.herbs =
      adaptation === 'riverside_stilts' || adaptation === 'coastal_harbor' ? 12 : 8;
    settlement.stockpile.crafts =
      adaptation === 'desert_oasis' || adaptation === 'coastal_harbor' ? 6 : 3;

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
        c.thought = `Adapting to life at our new ${profile.shortLabel}, ${settlement.name}!`;
      }
    }

    // Accompanying kin who traveled with the settlers help break ground right away
    const companionRoles: CreatureRole[] = ['builder', 'forager', 'builder', 'artisan'];
    for (const role of companionRoles) {
      if (world.creatures.filter((c) => c.alive).length >= world.config.maxPopulation) break;
      const species = world.rng.pick(settlement.foundingSpecies);
      world.spawnCreature(settlement, species, role);
    }

    // Stake out the fledgling village's very first adapted construction plots at stage 0 (clearing land!)
    this.placeBuilding(settlement, profile.starterHome, world, false);
    this.placeBuilding(settlement, profile.starterCivic, world, false);
    settlement.recalculateTierAndRadius();

    world.diplomacy.registerSettlement(settlement, world, parent);

    const trekMeters = parent
      ? Math.round(
          Math.hypot(settlement.center.x - parent.center.x, settlement.center.z - parent.center.z),
        )
      : 0;
    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      `${settlement.name} Founded (${profile.shortLabel})`,
      `${leader.name} and pioneers from ${parent?.name ?? 'the valley'} wandered ${trekMeters > 0 ? `${trekMeters}m ` : ''}to settle ${settlement.name} as a ${profile.title} in the ${getBiomeDisplayName(biome)}.`,
      settlement.center,
    );
    return settlement;
  }

  /** Returns active pioneer expeditions currently trekking across the valley. */
  getActiveEmigrations(): readonly EmigrationParty[] {
    return Array.from(this.activeEmigrations.values());
  }

  /** Returns the active scouting waypoint (or final destination) for a wandering pioneer party. */
  getEmigrationParty(partyId: string): EmigrationParty | undefined {
    return this.activeEmigrations.get(partyId);
  }

  /** Advances a pioneer party's scouting waypoint once a member reaches it. */
  advanceEmigrationWaypoint(partyId: string, px: number, pz: number): void {
    const party = this.activeEmigrations.get(partyId);
    if (!party || party.waypointIndex >= party.waypoints.length) return;
    const wp = party.waypoints[party.waypointIndex];
    if (Math.hypot(wp.x - px, wp.z - pz) <= 10.5) {
      party.waypointIndex++;
    }
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
      if (b.type === 'burrow_cottage' || b.type === 'beaver_lodge') {
        return settlement.getCompletedCount(b.type) >= 2;
      }
      if (
        b.type === 'market_stall' ||
        b.type === 'granary' ||
        b.type === 'workshop' ||
        b.type === 'lily_market' ||
        b.type === 'otter_boathouse'
      ) {
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
   * the larger realm and establish new biome-adapted villages.
   */
  private considerEmigration(settlement: Settlement, world: WorldState, rng: SeededRandom): void {
    if (world.settlements.length + this.activeEmigrations.size >= world.config.maxSettlements) return;
    const maxConcurrentParties = world.settlements.length <= 2 ? 1 : 2;
    if (this.activeEmigrations.size >= maxConcurrentParties) return;

    const pop = world.getSettlementPopulation(settlement.id);
    const minPop = world.settlements.length === 1 ? 9 : 10;
    if (pop < minPop || settlement.getCompletedCount() < 3) return;
    if (settlement.stockpile.timber < 10 || settlement.stockpile.berries + settlement.stockpile.acorns < 10) {
      return;
    }

    const launchChance =
      world.settlements.length === 1 ? 0.74 : world.settlements.length < 5 ? 0.52 : 0.36;
    if (!rng.chance(launchChance)) return;

    const occupied: Vec2[] = world.settlements.map((s) => s.center);
    for (const active of this.activeEmigrations.values()) {
      occupied.push({ x: active.targetX, z: active.targetZ });
    }
    const existingAdaptations = [
      ...world.settlements.map((s) => s.adaptation),
      ...Array.from(this.activeEmigrations.values()).map((p) =>
        world.terrain.getSiteAdaptation(p.targetX, p.targetZ),
      ),
    ];
    const site = world.terrain.findNewSettlementSite(
      occupied,
      rng,
      existingAdaptations,
      settlement.center,
    );
    if (!site) return;

    // Pick 2-3 sturdy pioneers (preferring at least 1 builder and 1 forager)
    const eligible = world.creatures.filter(
      (c) =>
        c.alive &&
        c.lifeStage === 'adult' &&
        !c.def.strictlyAquatic &&
        c.settlementId === settlement.id &&
        c.activity !== 'fighting' &&
        c.activity !== 'fleeing' &&
        c.activity !== 'nesting' &&
        c.activity !== 'emigrating',
    );
    if (eligible.length < 3) return;

    const pioneers: Creature[] = [];
    const pickByRole = (role: CreatureRole) => {
      const found = eligible.find((c) => c.role === role && !pioneers.includes(c));
      if (found) pioneers.push(found);
    };
    pickByRole('builder');
    pickByRole('forager');
    // If a chosen pioneer has an eligible bonded mate in the village, bring them along together
    for (const p of [...pioneers]) {
      if (pioneers.length >= 3) break;
      if (p.mateId) {
        const mate = eligible.find((c) => c.id === p.mateId && !pioneers.includes(c));
        if (mate) pioneers.push(mate);
      }
    }
    for (const c of eligible) {
      if (pioneers.length >= 3) break;
      if (!pioneers.includes(c)) pioneers.push(c);
    }
    if (pioneers.length < 2) return;

    settlement.stockpile.timber = Math.max(0, settlement.stockpile.timber - 10);
    settlement.stockpile.berries = Math.max(0, settlement.stockpile.berries - 6);
    settlement.stockpile.acorns = Math.max(0, settlement.stockpile.acorns - 4);

    const destBiome = world.terrain.getBiomeAt(site.x, site.z);
    const destAdaptation = world.terrain.getSiteAdaptation(site.x, site.z);
    const destProfile = VILLAGE_ADAPTATION_CATALOG[destAdaptation];

    const partyId = `emig_${this.emigrationSeq++}`;
    const partySpecies = Array.from(
      new Set([...pioneers.map((p) => p.species), ...destProfile.adaptedSpecies]),
    ).slice(0, 4);

    // Build 1 scenic mid-trek scouting waypoint for long expeditions so pioneers visibly wander across biomes
    const trekDist = Math.hypot(site.x - settlement.center.x, site.z - settlement.center.z);
    const waypoints: Vec2[] = [];
    if (trekDist > 62) {
      const midX = (settlement.center.x + site.x) * 0.5;
      const midZ = (settlement.center.z + site.z) * 0.5;
      const perpX = -(site.z - settlement.center.z) / trekDist;
      const perpZ = (site.x - settlement.center.x) / trekDist;
      const swing = (rng.chance(0.5) ? 1 : -1) * Math.min(34, trekDist * 0.24);
      const candX = midX + perpX * swing;
      const candZ = midZ + perpZ * swing;
      if (
        world.terrain.isWithinPlayableArea(candX, candZ, 12) &&
        !world.terrain.isDeepSeaAt(candX, candZ) &&
        !world.terrain.isImpassableMountainAt(candX, candZ) &&
        world.terrain.getSlopeAt(candX, candZ) < 0.3
      ) {
        waypoints.push({ x: candX, z: candZ });
      }
    }

    const party: EmigrationParty = {
      id: partyId,
      sourceSettlementId: settlement.id,
      targetX: site.x,
      targetZ: site.z,
      waypoints,
      waypointIndex: 0,
      species: partySpecies,
    };
    this.activeEmigrations.set(partyId, party);

    const firstGoal = waypoints.length > 0 ? waypoints[0] : site;
    const trekTimeout = Math.max(150, trekDist / 1.2 + 80);

    for (const pioneer of pioneers) {
      pioneer.activity = 'emigrating';
      pioneer.emigrationPartyId = partyId;
      pioneer.emigrationTargetX = site.x;
      pioneer.emigrationTargetZ = site.z;
      pioneer.targetBuildingId = null;
      pioneer.targetBridgeId = null;
      pioneer.targetResourceId = null;
      pioneer.targetX = firstGoal.x + rng.range(-1.5, 1.5);
      pioneer.targetZ = firstGoal.z + rng.range(-1.5, 1.5);
      pioneer.actionTimer = trekTimeout;
      pioneer.thought = `Wandering far toward the ${getBiomeDisplayName(destBiome)} to found a new village`;
    }

    world.chronicle.record(
      world.day,
      world.season,
      'settlement',
      'Pioneers Depart for Distant Lands',
      `${pioneers.map((p) => p.name).join(', ')} left ${settlement.name} to wander ${Math.round(trekDist)}m toward the ${getBiomeDisplayName(destBiome)} in search of a new village site.`,
      settlement.center,
    );
  }

  /**
   * Lets settlements autonomously decide to span nearby waterways with curved timber
   * or mossy stone bridges whenever materials and riverbank crossings allow.
   */
  private considerNewBridge(settlement: Settlement, world: WorldState, rng: SeededRandom): void {
    if (world.bridges.length >= MAX_BRIDGES_PER_WORLD) return;
    const retryAt = this.bridgeNoRiverUntilSec.get(settlement.id);
    if (retryAt !== undefined && world.elapsedSeconds < retryAt) return;


    let ownedCount = 0;
    for (const b of world.bridges) {
      if (b.settlementId === settlement.id) {
        ownedCount++;
        if (!b.completed) return;
      }
    }
    if (ownedCount >= MAX_BRIDGES_PER_SETTLEMENT) return;

    const profile = settlement.getAdaptationProfile();
    // Wetland stilt-villages are especially eager to span rivers & tributary channels
    if (!rng.chance(profile.bridgeEagerness)) return;

    const preferStone =
      (profile.preferredBridgeStyle === 'stone_arch' && settlement.stockpile.stone >= 10) ||
      ((settlement.tier === 'town' || settlement.tier === 'city' || settlement.tier === 'metropolis') &&
        settlement.stockpile.stone >= 10 &&
        settlement.stockpile.timber >= 6);
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
      Math.max(85, world.terrain.size * 0.25),
    );
    if (!crossing) {
      // Back off inland/desert/mountain villages that have no bridgeable river nearby
      this.bridgeNoRiverUntilSec.set(settlement.id, world.elapsedSeconds + 90);
      return;
    }

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
    const profile = settlement.getAdaptationProfile();

    const isWaterway = settlement.adaptation === 'waterway_haven';
    const eligible = ALL_BUILDING_TYPES.filter((type) => {
      const bp = BUILDING_CATALOG[type];
      if (isWaterway ? !bp.waterwayOnly : Boolean(bp.waterwayOnly)) {
        return false;
      }
      if (bp.minCompletedToUnlock && completedTotal < bp.minCompletedToUnlock) {
        return false;
      }
      return settlement.getBuildingCount(type) < bp.maxPerSettlement;
    });

    if (eligible.length === 0) return [];

    // Score each eligible building to guarantee rich biome-adapted architectural skylines
    const scored = eligible.map((type, idx) => {
      const bp = BUILDING_CATALOG[type];
      const count = settlement.getBuildingCount(type);
      const fillRatio = count / bp.maxPerSettlement;

      let score = (1 - fillRatio) * 40;

      // Strong regional adaptation preference shapes each village's distinct silhouette
      score += profile.favoredBuildings[type] ?? 0;

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
        (type === 'workshop' ||
          type === 'granary' ||
          type === 'market_stall' ||
          type === 'bakery' ||
          type === 'waterwheel_mill' ||
          type === 'lily_market')
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
          type === 'guildhall' ||
          type === 'aquatic_sanctuary' ||
          type === 'tide_shrine')
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
    let aliveTotal = 0;
    for (let i = 0; i < world.creatures.length; i++) {
      if (world.creatures[i].alive) aliveTotal++;
    }
    if (aliveTotal >= world.config.maxPopulation) return;

    const pop = world.getSettlementPopulation(settlement.id);
    const cap = settlement.getHousingCapacity();
    const food = settlement.stockpile.berries + settlement.stockpile.acorns;
    if (food < 14) return;

    const residents = world.creatures.filter(
      (c) =>
        c.alive &&
        c.settlementId === settlement.id &&
        c.lifeStage === 'adult' &&
        (c.activity === 'idle' ||
          c.activity === 'foraging' ||
          c.activity === 'gathering_timber' ||
          c.activity === 'resting'),
    );

    // 1. Encourage ready bonded pairs to nest and raise a fresh litter of young!
    if (pop < cap + 2) {
      for (const adult of residents) {
        if (!adult.mateId || !adult.canReproduce() || adult.activity === 'nesting') continue;
        const mate = world.getCreature(adult.mateId);
        if (
          !mate ||
          !mate.alive ||
          mate.settlementId !== settlement.id ||
          !mate.canReproduce() ||
          mate.activity === 'nesting' ||
          mate.activity === 'emigrating' ||
          mate.activity === 'fighting' ||
          mate.activity === 'fleeing' ||
          mate.activity === 'trading'
        ) {
          continue;
        }
        if (world.rng.chance(0.68)) {
          let nx = settlement.center.x;
          let nz = settlement.center.z;
          if (adult.def.aquatic) {
            const maxNestR = Math.min(6.8, Math.max(3.4, settlement.radius * 0.55));
            for (let tries = 0; tries < 10; tries++) {
              const nestAngle = world.rng.range(0, Math.PI * 2);
              const nestR = world.rng.range(2.4, maxNestR);
              const candX = settlement.center.x + Math.cos(nestAngle) * nestR;
              const candZ = settlement.center.z + Math.sin(nestAngle) * nestR;
              nx = candX;
              nz = candZ;
              if (world.terrain.canCreatureTraverse(candX, candZ, adult.def)) break;
            }
          } else {
            const nestAngle = world.rng.range(0, Math.PI * 2);
            const nestR = world.rng.range(2.6, Math.min(6.2, Math.max(3.4, settlement.radius * 0.55)));
            nx = settlement.center.x + Math.cos(nestAngle) * nestR;
            nz = settlement.center.z + Math.sin(nestAngle) * nestR;
          }
          adult.activity = 'nesting';
          adult.targetCreatureId = mate.id;
          adult.targetX = nx;
          adult.targetZ = nz;
          adult.actionTimer = 5.5;
          adult.thought = `Preparing a cozy nest with ${mate.name}`;

          mate.activity = 'nesting';
          mate.targetCreatureId = adult.id;
          mate.targetX = nx + 0.65;
          mate.targetZ = nz + 0.45;
          mate.actionTimer = 5.5;
          mate.thought = `Nesting together with ${adult.name}`;
          return;
        }
      }
    }

    // 2. Encourage eligible unbonded same-species adults to court and pair off!
    const unbonded = residents.filter((c) => {
      if (c.activity === 'courting' || c.activity === 'nesting') return false;
      if (!c.mateId) return true;
      const existing = world.getCreature(c.mateId);
      return !existing || !existing.alive;
    });
    for (let i = 0; i < unbonded.length; i++) {
      const a = unbonded[i];
      const partner = unbonded.find(
        (b, j) => j > i && b.species === a.species && !a.isCloseKinOf(b),
      );
      if (partner && world.rng.chance(0.55)) {
        a.activity = 'courting';
        a.targetCreatureId = partner.id;
        a.targetX = partner.x;
        a.targetZ = partner.z;
        a.actionTimer = 16;
        a.thought = `Courting ${partner.name}`;

        partner.activity = 'courting';
        partner.targetCreatureId = a.id;
        partner.targetX = a.x;
        partner.targetZ = a.z;
        partner.actionTimer = 16;
        partner.thought = `Sharing a warm stroll with ${a.name}`;
        return;
      }
    }

    // 3. Fallback: small frontier outposts with < 5 adults can welcome a wandering young adult
    //    matching a resident species so pioneer villages can establish breeding pairs!
    const hasSameSpeciesPair = residents.some((a, i) =>
      residents.some((b, j) => j > i && b.species === a.species && !a.isCloseKinOf(b)),
    );
    if (pop < cap && food >= 20 && (!hasSameSpeciesPair || residents.length < 5) && world.rng.chance(0.42)) {
      settlement.stockpile.berries = Math.max(0, settlement.stockpile.berries - 6);
      settlement.stockpile.acorns = Math.max(0, settlement.stockpile.acorns - 4);

      const species =
        residents.length > 0 && world.rng.chance(0.75)
          ? world.rng.pick(residents).species
          : world.rng.pick(settlement.foundingSpecies);

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
      const newcomer = world.spawnCreature(settlement, species, role, {
        ageDays: world.rng.range(2.0, 4.2),
        reproductionCooldown: world.rng.range(10, 22),
      });

      world.chronicle.record(
        world.day,
        world.season,
        'social',
        'Wandering Settler Arrives',
        `${newcomer.name}, a young adult ${newcomer.def.displayName}, arrived to settle in ${settlement.name} as a ${role}.`,
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
    const isWaterwayBuilding = Boolean(bp.waterwayOnly) || settlement.adaptation === 'waterway_haven';
    const maxSlope = settlement.adaptation === 'mountain_stone' ? 0.27 : 0.22;

    // Measure current farthest building so cities grow organically outward in concentric rings
    let farthest = 6.5;
    for (const existing of settlement.buildings) {
      const d = Math.hypot(
        existing.position.x - settlement.center.x,
        existing.position.z - settlement.center.z,
      );
      if (d > farthest) farthest = d;
    }

    const maxAllowedRadius = isWaterwayBuilding
      ? Math.min(36, Math.max(settlement.radius + 7, farthest + 10.5))
      : Math.min(31, Math.max(settlement.radius + 6, farthest + 9.5));
    const ringBands: [number, number][] = isWaterwayBuilding
      ? [
          [3.8, Math.min(12.0, maxAllowedRadius)],
          [8.5, Math.min(19.5, maxAllowedRadius)],
          [14.0, Math.min(27.0, maxAllowedRadius)],
          [19.0, maxAllowedRadius],
        ]
      : [
          [3.8, Math.min(11.5, maxAllowedRadius)],
          [8.5, Math.min(18.5, maxAllowedRadius)],
          [14.0, Math.min(25.0, maxAllowedRadius)],
          [19.0, maxAllowedRadius],
        ];
    const attemptsPerRing = isWaterwayBuilding ? 56 : 34;

    for (const [rMin, rMax] of ringBands) {
      if (rMax <= rMin + 0.5) continue;

      for (let attempt = 0; attempt < attemptsPerRing; attempt++) {
        const angle = world.rng.range(0, Math.PI * 2);
        const dist = world.rng.range(rMin, rMax);
        const x = settlement.center.x + Math.cos(angle) * dist;
        const z = settlement.center.z + Math.sin(angle) * dist;

        if (!world.terrain.isWithinPlayableArea(x, z, 3.5)) continue;
        if (isWaterwayBuilding) {
          const swimmable = world.terrain.isSwimmable(x, z);
          const bankEdgeOk =
            !swimmable &&
            (type === 'beaver_lodge' || type === 'waterwheel_mill') &&
            world.terrain.getCoastSignedDistance(x, z) > 12 &&
            world.terrain.getHeightAt(x, z) <= world.terrain.waterLevel + 0.26 &&
            world.terrain.getWaterDistance(x, z) < 3.6;
          if (!swimmable && !bankEdgeOk) continue;
        } else {
          if (!world.terrain.isWalkable(x, z, false)) continue;
          if (world.terrain.getSlopeAt(x, z) > maxSlope) continue;
        }

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

        const groundY = isWaterwayBuilding
          ? world.terrain.waterLevel
          : world.terrain.getHeightAt(x, z);
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

  exportSnapshot(): SettlementManagerSnapshot {
    return {
      settlementSeq: this.settlementSeq,
      buildingSeq: this.buildingSeq,
      bridgeSeq: this.bridgeSeq,
      emigrationSeq: this.emigrationSeq,
      expansionCooldown: this.expansionCooldown,
      bridgeCooldown: this.bridgeCooldown,
      emigrationCooldown: this.emigrationCooldown,
      expansionCursor: this.expansionCursor,
      bridgeCursor: this.bridgeCursor,
      emigrationCursor: this.emigrationCursor,
      bridgeRngState: this.bridgeRng ? this.bridgeRng.getState() : null,
      emigrationRngState: this.emigrationRng ? this.emigrationRng.getState() : null,
      activeEmigrations: Array.from(this.activeEmigrations.values()).map((p) => ({
        ...p,
        waypoints: p.waypoints.map((w) => ({ x: w.x, z: w.z })),
        species: [...p.species],
      })),
      bridgeNoRiverUntilSec: Array.from(this.bridgeNoRiverUntilSec.entries()),
    };
  }

  importSnapshot(snapshot: SettlementManagerSnapshot): void {
    this.settlementSeq = snapshot.settlementSeq;
    this.buildingSeq = snapshot.buildingSeq;
    this.bridgeSeq = snapshot.bridgeSeq;
    this.emigrationSeq = snapshot.emigrationSeq;
    this.expansionCooldown = snapshot.expansionCooldown;
    this.bridgeCooldown = snapshot.bridgeCooldown;
    this.emigrationCooldown = snapshot.emigrationCooldown;
    this.expansionCursor = snapshot.expansionCursor;
    this.bridgeCursor = snapshot.bridgeCursor;
    this.emigrationCursor = snapshot.emigrationCursor;
    this.bridgeRng =
      snapshot.bridgeRngState !== null ? new SeededRandom(snapshot.bridgeRngState) : null;
    this.emigrationRng =
      snapshot.emigrationRngState !== null ? new SeededRandom(snapshot.emigrationRngState) : null;
    this.activeEmigrations.clear();
    for (const p of snapshot.activeEmigrations) {
      this.activeEmigrations.set(p.id, {
        ...p,
        waypoints: p.waypoints.map((w) => ({ x: w.x, z: w.z })),
        species: [...p.species],
      });
    }
    this.bridgeNoRiverUntilSec.clear();
    for (const [id, sec] of snapshot.bridgeNoRiverUntilSec) {
      this.bridgeNoRiverUntilSec.set(id, sec);
    }
  }
}

export type SettlementSpot = Vec2;
