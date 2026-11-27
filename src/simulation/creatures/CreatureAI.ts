import type { ResourceType } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { getBuildingStage, getConstructionStageLabel } from '@simulation/settlements/Settlement';
import { getBiomeDisplayName } from '@simulation/settlements/VillageAdaptation';
import { getBridgeApproach, getBridgeDeckHeightAt } from '@simulation/terrain/Bridge';
import {
  HEARTH_FIRE_KEEP_OUT_RADIUS,
  getBuildingCollisionRadius,
  type SolidObstacle,
} from '@simulation/terrain/ObstacleMap';
import type { WorldState } from '@simulation/WorldState';
import { resolveLifeStage, type Creature } from './Creature';

export { HEARTH_FIRE_KEEP_OUT_RADIUS };

/** Horizontal collision radius of a creature against static world obstacles. */
export function getCreatureObstacleRadius(creature: Creature): number {
  return Math.max(0.16, creature.getSizeScale() * 0.36);
}

/** Personal-space horizontal radius used for creature-to-creature avoidance and separation. */
export function getCreaturePersonalRadius(creature: Creature): number {
  return Math.max(0.2, creature.getSizeScale() * 0.42);
}

/**
 * Candidate relative steering offsets (radians) evaluated when obstacles, other creatures,
 * or unwalkable terrain block the forward path. Covers up to ±2.85 rad so creatures can
 * cleanly back out of deep cul-de-sacs instead of getting pinned.
 */
const STEER_OFFSETS = [0, 0.38, -0.38, 0.78, -0.78, 1.22, -1.22, 1.72, -1.72, 2.28, -2.28, 2.85, -2.85];
const STEER_COS = Float64Array.from(STEER_OFFSETS, (a) => Math.cos(a));
const STEER_SIN = Float64Array.from(STEER_OFFSETS, (a) => Math.sin(a));
const FALLBACK_DETOUR_ANGLES = [Math.PI * 0.5, -Math.PI * 0.5, 2.2, -2.2, Math.PI];

const CREATURE_CELL_SIZE = 4.0;
const INV_CREATURE_CELL_SIZE = 1 / CREATURE_CELL_SIZE;
const CREATURE_GRID_OFFSET = 512;
const CREATURE_GRID_STRIDE = 1024;
const VERTICAL_SEPARATION_BAND = 1.15;

function creatureCellKey(cx: number, cz: number): number {
  return (cx + CREATURE_GRID_OFFSET) * CREATURE_GRID_STRIDE + (cz + CREATURE_GRID_OFFSET);
}

/**
 * Autonomous utility-driven AI for anthropomorphic woodland creatures:
 * foraging, continuous city building, inter-settlement trading, tavern/square socialising,
 * shrine devotion, skirmish combat, night-time resting, stuck/loop recovery, creature-to-creature
 * avoidance, and smooth obstacle avoidance around buildings, trees, boulders, bushes, benches,
 * and town hearth fires.
 */
export class CreatureAI {
  private readonly nearbyObstacles: SolidObstacle[] = [];
  private readonly activeObsX: number[] = [];
  private readonly activeObsZ: number[] = [];
  private readonly activeObsToX: number[] = [];
  private readonly activeObsToZ: number[] = [];
  private readonly activeObsDSq: number[] = [];
  private readonly activeObsMinR: number[] = [];
  private readonly activeCrX: number[] = [];
  private readonly activeCrZ: number[] = [];
  private readonly activeCrToX: number[] = [];
  private readonly activeCrToZ: number[] = [];
  private readonly activeCrDSq: number[] = [];
  private readonly activeCrPairR: number[] = [];
  private readonly nearbyCreatures: Creature[] = [];
  private readonly creatureCells = new Map<number, Creature[]>();
  private readonly movedCreatures = new Set<Creature>();
  private creatureGridStep = -1;
  private hasMultipleSettlementCreatures = false;
  private dispApplied = false;
  private dispX = 0;
  private dispZ = 0;

  /** Rebuilds the lightweight spatial hash of alive creatures once per simulation step. */
  prepareStep(world: WorldState): void {
    this.rebuildCreatureGrid(world);
    this.creatureGridStep = world.elapsedSeconds;
  }

  private rebuildCreatureGrid(world: WorldState): void {
    for (const bucket of this.creatureCells.values()) {
      bucket.length = 0;
    }
    let firstSettlementId: string | null = null;
    let multiSettlement = false;
    for (const c of world.creatures) {
      if (!c.alive) continue;
      if (firstSettlementId === null) {
        firstSettlementId = c.settlementId;
      } else if (!multiSettlement && c.settlementId !== firstSettlementId) {
        multiSettlement = true;
      }
      const cx = Math.floor(c.x * INV_CREATURE_CELL_SIZE);
      const cz = Math.floor(c.z * INV_CREATURE_CELL_SIZE);
      const key = creatureCellKey(cx, cz);
      let bucket = this.creatureCells.get(key);
      if (!bucket) {
        bucket = [];
        this.creatureCells.set(key, bucket);
      }
      bucket.push(c);
    }
    this.hasMultipleSettlementCreatures = multiSettlement;
  }

  private queryNearbyCreatures(
    self: Creature,
    x: number,
    z: number,
    searchRadius: number,
    world: WorldState,
    out: Creature[],
  ): void {
    if (this.creatureGridStep !== world.elapsedSeconds) {
      this.prepareStep(world);
    }
    out.length = 0;
    const selfAlt = self.def.aerial ? self.flightAltitude : 0;
    const rSq = searchRadius * searchRadius;
    const minCx = Math.floor((x - searchRadius) * INV_CREATURE_CELL_SIZE);
    const maxCx = Math.floor((x + searchRadius) * INV_CREATURE_CELL_SIZE);
    const minCz = Math.floor((z - searchRadius) * INV_CREATURE_CELL_SIZE);
    const maxCz = Math.floor((z + searchRadius) * INV_CREATURE_CELL_SIZE);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.creatureCells.get(creatureCellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i];
          if (!other.alive || other.id === self.id) continue;
          const otherAlt = other.def.aerial ? other.flightAltitude : 0;
          if (Math.abs(otherAlt - selfAlt) >= VERTICAL_SEPARATION_BAND) continue;
          const dx = other.x - x;
          const dz = other.z - z;
          if (dx * dx + dz * dz <= rSq) {
            out.push(other);
          }
        }
      }
    }
  }

  updateCreature(creature: Creature, world: WorldState, dt: number): void {
    if (!creature.alive) return;

    creature.isActivelyWorking = false;
    creature.activeConstructionStage = null;
    creature.isDancingAtCelebration = false;

    // Passive physiological drift
    creature.ageDays += dt / world.config.dayLengthSeconds;
    creature.reproductionCooldown = Math.max(0, creature.reproductionCooldown - dt);

    // Natural life-stage progression (young -> juvenile -> adult -> elder -> peaceful passing)
    const nextStage = resolveLifeStage(creature.ageDays);
    if (nextStage !== creature.lifeStage) {
      const prevStage = creature.lifeStage;
      creature.lifeStage = nextStage;
      if (nextStage === 'juvenile') {
        creature.thought = `Growing fast and exploring the village!`;
      } else if (nextStage === 'adult') {
        creature.reproductionCooldown = world.rng.range(10, 22);
        creature.wealth += 5;
        creature.thought = `Come of age — ready to work and find a mate!`;
        if (prevStage === 'juvenile' && creature.generation >= 2) {
          const home = world.getSettlement(creature.settlementId);
          world.chronicle.record(
            world.day,
            world.season,
            'social',
            'Coming of Age',
            `${creature.name}, a ${creature.def.displayName} of generation ${creature.generation}, grew into adulthood${home ? ` in ${home.name}` : ''}.`,
            creature.position2D,
          );
        }
      } else if (nextStage === 'elder') {
        creature.thought = 'Sharing hard-won woodland wisdom with the young';
      }
    }

    if (creature.ageDays >= creature.lifespanDays) {
      creature.alive = false;
      creature.health = 0;
      if (creature.mateId) {
        const mate = world.getCreature(creature.mateId);
        if (mate && mate.mateId === creature.id) {
          mate.mateId = null;
        }
        creature.mateId = null;
      }
      const home = world.getSettlement(creature.settlementId);
      world.chronicle.record(
        world.day,
        world.season,
        'social',
        'Peaceful Passing',
        `Elder ${creature.name} (${creature.def.displayName}) passed peacefully in ${home?.name ?? 'the wilds'} after ${Math.round(creature.ageDays)} days.`,
        creature.position2D,
      );
      return;
    }

    const hungerRate = 0.52 * (1 + world.climateHeat * 0.55 + world.climateFreeze * 0.32);
    creature.hunger = Math.min(100, creature.hunger + dt * hungerRate);
    const energyDrain =
      creature.activity === 'resting'
        ? -4.8
        : 0.42 * (1 + world.climateHeat * 0.4 + world.climateFreeze * 0.45);
    creature.energy = Math.max(
      0,
      creature.energy - dt * energyDrain,
    );
    creature.attackCooldown = Math.max(0, creature.attackCooldown - dt);
    creature.actionTimer = Math.max(0, creature.actionTimer - dt);

    // Weather & active ecological influence mood response
    if ((world.weather === 'storm' || world.miasmaIntensity > 0.25) && creature.activity !== 'resting') {
      creature.mood = Math.max(10, creature.mood - dt * 0.8);
    } else if (
      world.weather === 'sunbeams' ||
      world.weather === 'blossom' ||
      world.rewildingBoost > 0.25
    ) {
      creature.mood = Math.min(100, creature.mood + dt * (0.5 + world.rewildingBoost * 0.6));
    }

    // Eat carried berries/acorns if hungry
    if (creature.hunger > 65) {
      if (creature.inventory.berries >= 1) {
        creature.inventory.berries -= 1;
        creature.hunger = Math.max(5, creature.hunger - 36);
        creature.health = Math.min(creature.maxHealth, creature.health + 6);
      } else if (creature.inventory.acorns >= 1) {
        creature.inventory.acorns -= 1;
        creature.hunger = Math.max(5, creature.hunger - 34);
        creature.health = Math.min(creature.maxHealth, creature.health + 5);
      } else {
        const home = world.getSettlement(creature.settlementId);
        if (home && Math.hypot(home.center.x - creature.x, home.center.z - creature.z) < home.radius + 3) {
          if (home.stockpile.berries >= 1) {
            home.stockpile.berries -= 1;
            creature.hunger = Math.max(8, creature.hunger - 35);
          } else if (home.stockpile.acorns >= 1) {
            home.stockpile.acorns -= 1;
            creature.hunger = Math.max(8, creature.hunger - 32);
          }
        }
      }
    }

    // Immediate threat check (enemy factions at war or severe rivals)
    this.checkForThreats(creature, world);

    // Execute current behavior or choose a new one
    if (creature.activity === 'fighting') {
      this.handleFighting(creature, world, dt);
    } else if (creature.activity === 'fleeing') {
      this.handleFleeing(creature, world, dt);
    } else if (creature.activity === 'emigrating') {
      this.handleEmigrating(creature, world, dt);
    } else if (creature.activity === 'courting') {
      this.handleCourting(creature, world, dt);
    } else if (creature.activity === 'nesting') {
      this.handleNesting(creature, world, dt);
    } else if (creature.activity === 'playing') {
      this.handlePlaying(creature, world, dt);
    } else if (creature.activity === 'celebrating') {
      this.handleCelebrating(creature, world, dt);
    } else if (creature.activity === 'trading') {
      this.handleTrading(creature, world, dt);
    } else if (creature.activity === 'building') {
      this.handleBuilding(creature, world, dt);
    } else if (creature.activity === 'foraging' || creature.activity === 'gathering_timber') {
      this.handleGathering(creature, world, dt);
    } else if (creature.activity === 'socialising') {
      this.handleSocialising(creature, world, dt);
    } else if (creature.activity === 'praying') {
      this.handlePraying(creature, world, dt);
    } else if (creature.activity === 'resting') {
      this.handleResting(creature, world, dt);
    } else {
      // Deposit carried goods immediately upon arriving home while hauling in 'idle'
      const home = world.getSettlement(creature.settlementId);
      if (home && creature.getTotalInventory() >= 5) {
        const distHome = Math.hypot(home.center.x - creature.x, home.center.z - creature.z);
        if (distHome < home.radius + 3.5) {
          this.depositInventory(creature, home);
          creature.actionTimer = 0;
        }
      }

      // Stay committed to an active idle/hauling/patrol destination until arrival or timer expiry
      const distToTarget = Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z);
      if (creature.actionTimer <= 0 || distToTarget <= 0.65) {
        this.chooseNextActivity(creature, world);
        this.ensureReachableTarget(creature, world);
        creature.resetNavigationState();
      }
    }

    // Move smoothly toward target
    this.moveCreature(creature, world, dt);
  }

  private checkForThreats(creature: Creature, world: WorldState): void {
    if (creature.activity === 'fighting' || creature.activity === 'fleeing') return;
    if (this.creatureGridStep !== world.elapsedSeconds) {
      this.prepareStep(world);
    }
    if (!this.hasMultipleSettlementCreatures) return;

    const sightRange = creature.role === 'guard' ? 16 : 9.5;
    const sightRangeSq = sightRange * sightRange;
    const minCx = Math.floor((creature.x - sightRange) * INV_CREATURE_CELL_SIZE);
    const maxCx = Math.floor((creature.x + sightRange) * INV_CREATURE_CELL_SIZE);
    const minCz = Math.floor((creature.z - sightRange) * INV_CREATURE_CELL_SIZE);
    const maxCz = Math.floor((creature.z + sightRange) * INV_CREATURE_CELL_SIZE);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.creatureCells.get(creatureCellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i];
          if (!other.alive || other.id === creature.id) continue;
          if (other.settlementId === creature.settlementId) continue;

          const dx = other.x - creature.x;
          const dz = other.z - creature.z;
          if (dx * dx + dz * dz > sightRangeSq) continue;

          const stance = world.diplomacy.getStance(creature.settlementId, other.settlementId);
          const personalScore = creature.relationships.get(other.id) ?? 0;
          const hostile = stance === 'war' || personalScore <= -55;
          if (!hostile) continue;

          const braveEnough =
            creature.isAdult() &&
            creature.health > creature.maxHealth * 0.42 &&
            (creature.role === 'guard' ||
              creature.def.courage + creature.personality.bravery * 0.4 > 0.78);

          if (braveEnough) {
            creature.activity = 'fighting';
            creature.targetCreatureId = other.id;
            creature.thought = `Defending kin against ${other.name}!`;
            creature.actionTimer = 10;
          } else {
            creature.activity = 'fleeing';
            creature.targetCreatureId = other.id;
            creature.thought = `Fleeing from ${other.name}!`;
            creature.actionTimer = 6;
          }
          return;
        }
      }
    }
  }

  private chooseNextActivity(creature: Creature, world: WorldState): void {
    const home = world.getSettlement(creature.settlementId);
    if (!home) return;
    const profile = home.getAdaptationProfile();

    // 0. If a National Holiday is underway, rejoin the realm-wide celebration immediately
    const nationalHoliday = world.festivals.getNationalHoliday();
    if (nationalHoliday && creature.health > creature.maxHealth * 0.35) {
      const spot = world.festivals.pickCelebrationSpot(home, world);
      creature.activity = 'celebrating';
      creature.activeCelebrationId = nationalHoliday.id;
      creature.celebrationHostSettlementId = home.id;
      creature.targetX = spot.x;
      creature.targetZ = spot.z;
      creature.actionTimer = world.rng.range(4, 7);
      creature.thought = `Joining everyone for ${nationalHoliday.name}!`;
      return;
    }

    // 1. Low health or low energy -> rest at home
    const isNight = world.timeOfDay < 0.22 || world.timeOfDay > 0.84;
    if (
      creature.energy < 24 ||
      creature.health < creature.maxHealth * 0.55 ||
      (isNight && creature.species !== 'owl' && world.rng.chance(0.45))
    ) {
      creature.activity = 'resting';
      creature.targetX = home.center.x + world.rng.range(-home.radius * 0.6, home.radius * 0.6);
      creature.targetZ = home.center.z + world.rng.range(-home.radius * 0.6, home.radius * 0.6);
      creature.actionTimer = world.rng.range(6, 10);
      creature.thought = isNight ? 'Nestling in for the night' : 'Catching a warm rest';
      return;
    }

    // 1b. Young kits/chicks/pups form playful litters around their parents and stay safe in the village
    if (creature.lifeStage === 'young') {
      this.chooseYoungActivity(creature, home, world);
      return;
    }

    // 1c. Juveniles balance playful sibling time with light village foraging & socializing
    if (creature.lifeStage === 'juvenile' && world.rng.chance(0.42)) {
      this.chooseYoungActivity(creature, home, world);
      return;
    }

    // 1d. Unbonded adults naturally look for a same-species mate in their village
    if (creature.lifeStage === 'adult' && world.rng.chance(0.24)) {
      const existingMate = creature.mateId ? world.getCreature(creature.mateId) : undefined;
      if (!existingMate || !existingMate.alive) {
        creature.mateId = null;
        const suitor = world.creatures.find(
          (other) =>
            other.alive &&
            other.id !== creature.id &&
            other.settlementId === home.id &&
            other.species === creature.species &&
            other.lifeStage === 'adult' &&
            other.activity !== 'emigrating' &&
            other.activity !== 'fighting' &&
            other.activity !== 'fleeing' &&
            other.activity !== 'nesting' &&
            (!other.mateId || !world.getCreature(other.mateId)?.alive) &&
            !creature.isCloseKinOf(other),
        );
        if (suitor) {
          creature.activity = 'courting';
          creature.targetCreatureId = suitor.id;
          creature.targetX = suitor.x;
          creature.targetZ = suitor.z;
          creature.actionTimer = 14;
          creature.thought = `Seeking out ${suitor.name} to court`;
          return;
        }
      }
    }

    // 2. Deposit carried resources if hands are full
    if (creature.getTotalInventory() >= 5) {
      const distHome = Math.hypot(home.center.x - creature.x, home.center.z - creature.z);
      if (distHome < home.radius + 3.5) {
        this.depositInventory(creature, home);
      } else {
        const haulAngle = world.rng.range(0, Math.PI * 2);
        const haulR = world.rng.range(2.3, Math.min(5.2, Math.max(3.2, home.radius * 0.65)));
        creature.targetX = home.center.x + Math.cos(haulAngle) * haulR;
        creature.targetZ = home.center.z + Math.sin(haulAngle) * haulR;
        creature.actionTimer = 14;
        creature.thought = 'Hauling goods to the storehouse';
        return;
      }
    }

    // 3a. Unfinished waterway bridges need builders on the riverbank
    const unfinishedBridge = world.bridges.find(
      (b) => b.settlementId === home.id && !b.completed,
    );
    if (
      unfinishedBridge &&
      (creature.role === 'builder' ||
        (creature.role === 'artisan' && world.rng.chance(0.5)) ||
        world.rng.chance(0.32 * creature.def.buildSkill))
    ) {
      creature.activity = 'building';
      creature.targetBridgeId = unfinishedBridge.id;
      creature.targetBuildingId = null;
      creature.targetX = unfinishedBridge.startX - unfinishedBridge.dirX * 0.55;
      creature.targetZ = unfinishedBridge.startZ - unfinishedBridge.dirZ * 0.55;
      creature.actionTimer = 32;
      creature.thought = `Building a ${unfinishedBridge.style === 'stone_arch' ? 'stone' : 'timber'} bridge across the stream`;
      return;
    }

    // 3b. Unfinished buildings need builders (builders & artisans eagerly pitch in across expanding districts!)
    const unfinishedList = home.buildings.filter((b) => !b.completed || b.disassembling);
    if (
      unfinishedList.length > 0 &&
      (creature.role === 'builder' ||
        (creature.role === 'artisan' && world.rng.chance(0.55)) ||
        world.rng.chance(0.42 * creature.def.buildSkill))
    ) {
      // Pick the nearest unfinished construction site so builders spread across active projects
      let chosenSite = unfinishedList[0];
      let bestScore = Infinity;
      for (const site of unfinishedList) {
        const d = Math.hypot(site.position.x - creature.x, site.position.z - creature.z);
        const score = d - (site.disassembling ? 4.5 : 0);
        if (score < bestScore) {
          bestScore = score;
          chosenSite = site;
        }
      }
      creature.activity = 'building';
      creature.targetBuildingId = chosenSite.id;
      creature.targetBridgeId = null;
      const approachAng = Math.atan2(
        creature.z - chosenSite.position.z,
        creature.x - chosenSite.position.x,
      );
      const standAngle = approachAng + world.rng.range(-0.9, 0.9);
      const standR = getBuildingCollisionRadius(chosenSite.type) + this.getCreatureRadius(creature) + 0.55;
      creature.targetX = chosenSite.position.x + Math.cos(standAngle) * standR;
      creature.targetZ = chosenSite.position.z + Math.sin(standAngle) * standR;
      creature.actionTimer = 24;
      const bp = BUILDING_CATALOG[chosenSite.type];
      if (chosenSite.disassembling) {
        const repName = chosenSite.replacementType
          ? BUILDING_CATALOG[chosenSite.replacementType].displayName
          : 'a larger building';
        creature.thought = `Disassembling ${bp.displayName} for ${repName}`;
      } else {
        const stage = getBuildingStage(chosenSite);
        creature.thought = `${getConstructionStageLabel(stage, bp.frameStyle)} for ${bp.displayName}`;
      }
      return;
    }

    // 4. Trade caravan if merchant or trade-inclined and peaceful neighbor exists
    if (
      creature.isAdult() &&
      !creature.def.strictlyAquatic &&
      (creature.role === 'merchant' || world.rng.chance(0.18 * creature.def.tradeAffinity)) &&
      world.settlements.length > 1
    ) {
      const partner = world.economy.pickTradeDestination(home, world);
      if (partner) {
        const good = world.economy.pickExportGood(home);
        if (good) {
          home.stockpile[good] = Math.max(0, home.stockpile[good] - 4);
          creature.activity = 'trading';
          creature.tradeDestinationSettlementId = partner.id;
          creature.tradeCarrying = good;
          creature.tradeCargoAmount = 4;
          creature.targetX = partner.center.x + world.rng.range(-3.5, 3.5);
          creature.targetZ = partner.center.z + world.rng.range(-3.5, 3.5);
          const tradeDist = Math.hypot(partner.center.x - creature.x, partner.center.z - creature.z);
          creature.actionTimer = Math.max(44, tradeDist / 2.0 + 24);
          creature.thought =
            partner.adaptation !== home.adaptation
              ? `Carrying ${home.name}'s ${good} across biomes to ${partner.name}`
              : `Carrying ${good} to ${partner.name}`;
          return;
        }
      }
    }

    // 5. Pray at a woodland/tide shrine or study at an Owl Archive / Aquatic Sanctuary (feeds the Procedural God)
    const sacredSite = home.buildings.find(
      (b) =>
        b.completed &&
        (b.type === 'shrine' ||
          b.type === 'library' ||
          b.type === 'tide_shrine' ||
          b.type === 'aquatic_sanctuary'),
    );
    if (
      sacredSite &&
      (creature.role === 'mystic' || world.rng.chance(0.12 + creature.personality.piety * 0.2))
    ) {
      creature.activity = 'praying';
      creature.targetBuildingId = sacredSite.id;
      const prayApproach = Math.atan2(
        creature.z - sacredSite.position.z,
        creature.x - sacredSite.position.x,
      );
      const prayAngle = prayApproach + world.rng.range(-1.1, 1.1);
      const prayR = getBuildingCollisionRadius(sacredSite.type) + this.getCreatureRadius(creature) + 0.65;
      creature.targetX = sacredSite.position.x + Math.cos(prayAngle) * prayR;
      creature.targetZ = sacredSite.position.z + Math.sin(prayAngle) * prayR;
      creature.actionTimer = world.rng.range(6, 10);
      creature.thought =
        sacredSite.type === 'library'
          ? `Reading star-scrolls in ${home.name}'s archive`
          : sacredSite.type === 'aquatic_sanctuary'
            ? `Contemplating glowing river pearls in ${home.name}'s sanctuary`
            : sacredSite.type === 'tide_shrine'
              ? `Sending ripple-prayers to ${world.deity.name}`
              : `Offering whispers to ${world.deity.name}`;
      return;
    }

    // 6. Socialising at tavern, fountain plaza, bakery, market, guildhall, or town square
    if (creature.mood < 68 || world.rng.chance(0.22 * creature.def.sociability)) {
      const hangouts = home.buildings.filter(
        (b) =>
          b.completed &&
          (b.type === 'tavern' ||
            b.type === 'market_stall' ||
            b.type === 'fountain_plaza' ||
            b.type === 'bakery' ||
            b.type === 'guildhall' ||
            b.type === 'lily_market' ||
            b.type === 'otter_boathouse' ||
            b.type === 'aquatic_sanctuary'),
      );
      const hangout = hangouts.length > 0 ? world.rng.pick(hangouts) : null;
      creature.activity = 'socialising';
      const chatAngle = world.rng.range(0, Math.PI * 2);
      if (hangout) {
        const chatR =
          getBuildingCollisionRadius(hangout.type) + this.getCreatureRadius(creature) + world.rng.range(0.75, 1.9);
        creature.targetX = hangout.position.x + Math.cos(chatAngle) * chatR;
        creature.targetZ = hangout.position.z + Math.sin(chatAngle) * chatR;
      } else {
        const chatR = world.rng.range(2.2, 4.2);
        creature.targetX = home.center.x + Math.cos(chatAngle) * chatR;
        creature.targetZ = home.center.z + Math.sin(chatAngle) * chatR;
      }
      creature.actionTimer = world.rng.range(6, 10);
      if (world.rng.chance(0.32) && profile.thoughts.length > 0) {
        creature.thought = world.rng.pick(profile.thoughts);
      } else {
        creature.thought =
          hangout?.type === 'fountain_plaza'
            ? 'Admiring the shimmering starlight fountain'
            : hangout?.type === 'bakery'
              ? 'Savoring fresh warm acorn loaves'
              : hangout?.type === 'guildhall'
                ? 'Debating city blueprints at the guildhall'
                : hangout?.type === 'lily_market'
                  ? 'Browsing river pearls at the Lily-Pad Market'
                  : hangout?.type === 'otter_boathouse'
                    ? 'Swapping river tales beside the boathouse'
                    : hangout?.type === 'aquatic_sanctuary'
                      ? 'Admiring shimmering lanterns in the Aquatic Sanctuary'
                      : hangout
                        ? 'Sharing tales over berry cider'
                        : 'Chatting with neighbors by the hearth';
      }
      return;
    }

    // 7. Guard patrol or raid if at war
    if (creature.role === 'guard') {
      const enemySettlement = !creature.def.strictlyAquatic
        ? world.diplomacy.findWarTarget(home.id, world.settlements)
        : undefined;
      if (enemySettlement && world.rng.chance(0.32)) {
        creature.targetX = enemySettlement.center.x + world.rng.range(-8, 8);
        creature.targetZ = enemySettlement.center.z + world.rng.range(-8, 8);
        creature.thought = `Marching toward ${enemySettlement.name}'s border`;
        creature.actionTimer = 14;
        return;
      }
      const angle = world.rng.range(0, Math.PI * 2);
      const r = home.radius + world.rng.range(2, 7);
      creature.targetX = home.center.x + Math.cos(angle) * r;
      creature.targetZ = home.center.z + Math.sin(angle) * r;
      creature.thought =
        world.rng.chance(0.35) && profile.thoughts.length > 0
          ? world.rng.pick(profile.thoughts)
          : `Patrolling the edges of ${home.name}`;
      creature.actionTimer = 8;
      return;
    }

    // 8. Gather resources actively needed for the city's next planned building & food supply
    const neededForNext = world.settlementManager.getMostNeededResource(home);
    let desiredTypes: ResourceType[];
    if (creature.hunger > 45 || home.stockpile.berries + home.stockpile.acorns < 16) {
      desiredTypes = ['berries', 'acorns', 'herbs'];
    } else if (neededForNext) {
      desiredTypes = [neededForNext];
    } else if (home.stockpile.stone < 16) {
      desiredTypes = ['stone', 'timber'];
    } else if (home.stockpile.timber < 28) {
      desiredTypes = ['timber', 'stone'];
    } else if (home.stockpile.herbs < 10) {
      desiredTypes = ['herbs', 'berries'];
    } else {
      desiredTypes = ['timber', 'stone', 'berries', 'acorns', 'herbs'];
    }

    // Strictly aquatic creatures (River Koi) forage river kelp, berries & sunken driftwood in swimmable water
    if (creature.def.strictlyAquatic) {
      for (let attempt = 0; attempt < 14; attempt++) {
        const angle = world.rng.range(0, Math.PI * 2);
        const radius = world.rng.range(3.5, Math.max(12, home.radius + 10));
        const wx = home.center.x + Math.cos(angle) * radius;
        const wz = home.center.z + Math.sin(angle) * radius;
        if (world.terrain.isSwimmable(wx, wz)) {
          creature.activity = 'foraging';
          creature.targetResourceId = null;
          creature.targetX = wx;
          creature.targetZ = wz;
          creature.actionTimer = 16;
          creature.thought = `Foraging river kelp & driftwood for ${home.name}`;
          return;
        }
      }
    }

    let node = creature.def.strictlyAquatic
      ? undefined
      : world.terrain.findNearestResource(creature.position2D, desiredTypes, 1.2);
    if (!node && !creature.def.strictlyAquatic) {
      node = world.terrain.findNearestResource(
        creature.position2D,
        ['timber', 'stone', 'berries', 'acorns', 'herbs'],
        1.0,
      );
    }
    if (node) {
      creature.activity =
        node.type === 'timber' || node.type === 'stone' ? 'gathering_timber' : 'foraging';
      creature.targetResourceId = node.id;
      creature.targetX = node.position.x + world.rng.range(-1.4, 1.4);
      creature.targetZ = node.position.z + world.rng.range(-1.4, 1.4);
      creature.actionTimer = 18;
      creature.thought = `Gathering ${node.type} for ${home.name}`;
      return;
    }

    // Fallback wander (keep strictly aquatic creatures within swimmable waterways)
    let wanderX = home.center.x;
    let wanderZ = home.center.z;
    const wanderTries = creature.def.strictlyAquatic ? 12 : 1;
    for (let attempt = 0; attempt < wanderTries; attempt++) {
      const angle = world.rng.range(0, Math.PI * 2);
      const radius = world.rng.range(3, home.radius + 6);
      const cx = home.center.x + Math.cos(angle) * radius;
      const cz = home.center.z + Math.sin(angle) * radius;
      wanderX = cx;
      wanderZ = cz;
      if (!creature.def.strictlyAquatic || world.terrain.isSwimmable(cx, cz)) break;
    }
    creature.targetX = wanderX;
    creature.targetZ = wanderZ;
    creature.actionTimer = world.rng.range(5, 9);
    creature.thought =
      profile.thoughts.length > 0 && world.rng.chance(0.6)
        ? world.rng.pick(profile.thoughts)
        : `Exploring around ${home.name}`;
  }

  private handleGathering(creature: Creature, world: WorldState, dt: number): void {
    // Waterway foraging for strictly aquatic creatures (kelp, riverberries, sunken driftwood)
    if (creature.targetResourceId === null && creature.def.strictlyAquatic) {
      if (creature.actionTimer <= 0) {
        creature.activity = 'idle';
        return;
      }
      const dist = Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z);
      if (dist < 2.6) {
        const home = world.getSettlement(creature.settlementId);
        const needed = home ? world.settlementManager.getMostNeededResource(home) : null;
        const yieldType: ResourceType =
          needed && (needed === 'herbs' || needed === 'berries' || needed === 'timber' || needed === 'stone')
            ? needed
            : world.rng.pick(['herbs', 'berries', 'timber'] as const);
        const rate = 1.9 * (0.75 + creature.def.buildSkill * 0.45) * dt;
        creature.inventory[yieldType] += rate;
        if (creature.getTotalInventory() >= 5.0) {
          creature.activity = 'idle';
        }
      }
      return;
    }

    const node = world.terrain.getResourceNode(creature.targetResourceId);
    if (!node || node.amount < 0.5 || creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.targetResourceId = null;
      return;
    }

    const dist = Math.hypot(node.position.x - creature.x, node.position.z - creature.z);
    if (dist < 3.15) {
      if (creature.activity === 'gathering_timber') {
        creature.isActivelyWorking = true;
        creature.activeConstructionStage = 'clearing';
        creature.heading = Math.atan2(node.position.x - creature.x, node.position.z - creature.z);
      }
      const home = world.getSettlement(creature.settlementId);
      const biomeGatherMult = home?.getAdaptationProfile().gatherBonus[node.type] ?? 1.0;
      const rate = 2.0 * (0.75 + creature.def.buildSkill * 0.5) * biomeGatherMult * dt;
      const taken = Math.min(node.amount, rate);
      node.amount -= taken;
      creature.inventory[node.type] += taken;
      if (creature.getTotalInventory() >= 5.5) {
        creature.activity = 'idle';
        creature.targetResourceId = null;
      }
    }
  }

  private handleBuilding(creature: Creature, world: WorldState, dt: number): void {
    const home = world.getSettlement(creature.settlementId);
    if (creature.targetBridgeId) {
      const bridge = world.getBridge(creature.targetBridgeId);
      if (!home || !bridge || bridge.completed || creature.actionTimer <= 0) {
        creature.activity = 'idle';
        creature.targetBridgeId = null;
        return;
      }

      const distStart = Math.hypot(bridge.startX - creature.x, bridge.startZ - creature.z);
      const distEnd = Math.hypot(bridge.endX - creature.x, bridge.endZ - creature.z);
      const nearDist = Math.min(distStart, distEnd);
      if (nearDist < 3.4) {
        creature.isActivelyWorking = true;
        creature.activeConstructionStage =
          bridge.progress < 25 ? 'clearing' : bridge.progress < 50 ? 'foundation' : 'framing';
        if (nearDist < 2.5) {
          creature.targetX = creature.x;
          creature.targetZ = creature.z;
          creature.heading = Math.atan2(
            bridge.centerX - creature.x,
            bridge.centerZ - creature.z,
          );
        }
        const bridgeAdaptMult =
          home.adaptation === 'riverside_stilts' || home.adaptation === 'coastal_harbor'
            ? 1.24
            : 1.0;
        const work = dt * (9.0 + creature.def.buildSkill * 10.0) * bridgeAdaptMult;
        bridge.progress = Math.min(100, bridge.progress + work);
        if (bridge.progress >= 100 && !bridge.completed) {
          bridge.completed = true;
          creature.mood = Math.min(100, creature.mood + 16);
          creature.wealth += 5;
          world.settlementManager.onBridgeCompleted(home, bridge, creature, world);
          creature.activity = 'idle';
          creature.targetBridgeId = null;
        }
      }
      return;
    }

    const bld = home?.buildings.find((b) => b.id === creature.targetBuildingId);
    if (!home || !bld || (bld.completed && !bld.disassembling) || creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.targetBuildingId = null;
      return;
    }

    const dist = Math.hypot(bld.position.x - creature.x, bld.position.z - creature.z);
    const buildReach =
      getBuildingCollisionRadius(bld.type) + this.getCreatureRadius(creature) + 1.5;
    if (dist < buildReach) {
      const bp = BUILDING_CATALOG[bld.type];
      const stage = getBuildingStage(bld);
      creature.isActivelyWorking = true;
      creature.activeConstructionStage = stage;
      // Once comfortably within hammering reach, settle and face the construction site
      if (dist < buildReach - 0.35) {
        creature.targetX = creature.x;
        creature.targetZ = creature.z;
        creature.heading = Math.atan2(bld.position.x - creature.x, bld.position.z - creature.z);
      }
      const profile = home.getAdaptationProfile();
      const styleMult = profile.buildSpeedBonus[bp.frameStyle];
      const stewardshipBoost = 1 + world.rewildingBoost * 0.42;
      const work = dt * (11.0 + creature.def.buildSkill * 11.0) * styleMult * stewardshipBoost;
      if (bld.disassembling) {
        const repName = bld.replacementType
          ? BUILDING_CATALOG[bld.replacementType].displayName
          : 'a larger building';
        creature.thought = `Disassembling ${bp.displayName} for ${repName}`;
        bld.progress = Math.max(0, bld.progress - work * 1.25);
        if (bld.progress <= 0) {
          creature.mood = Math.min(100, creature.mood + 10);
          creature.wealth += 3;
          world.settlementManager.onBuildingDisassembled(home, bld, creature, world);
          creature.activity = 'idle';
          creature.targetBuildingId = null;
        }
      } else {
        creature.thought = `${getConstructionStageLabel(stage, bp.frameStyle)} for ${bp.displayName}`;
        bld.progress = Math.min(100, bld.progress + work);
        if (bld.progress >= 100 && !bld.completed) {
          bld.completed = true;
          creature.mood = Math.min(100, creature.mood + 14);
          creature.wealth += 4;
          world.settlementManager.onBuildingCompleted(home, bld, creature, world);
          creature.activity = 'idle';
          creature.targetBuildingId = null;
        }
      }
    }
  }

  private handleEmigrating(creature: Creature, world: WorldState, _dt: number): void {
    const partyId = creature.emigrationPartyId;
    const tx = creature.emigrationTargetX;
    const tz = creature.emigrationTargetZ;
    const party = partyId ? world.settlementManager.getEmigrationParty(partyId) : undefined;
    if (
      !partyId ||
      !party ||
      tx === null ||
      tz === null ||
      creature.actionTimer <= 0
    ) {
      creature.emigrationPartyId = null;
      creature.emigrationTargetX = null;
      creature.emigrationTargetZ = null;
      creature.activity = 'idle';
      return;
    }

    // Advance intermediate scouting waypoints as pioneers wander across distant biomes
    world.settlementManager.advanceEmigrationWaypoint(partyId, creature.x, creature.z);
    const activeGoal =
      party.waypointIndex < party.waypoints.length
        ? party.waypoints[party.waypointIndex]
        : { x: tx, z: tz };

    if (creature.detourTimer <= 0) {
      creature.targetX = activeGoal.x;
      creature.targetZ = activeGoal.z;
    }

    // Refresh pioneer thoughts based on the environment they are crossing
    if (world.rng.chance(0.02)) {
      const curBiome = world.terrain.getBiomeAt(creature.x, creature.z);
      const destBiome = world.terrain.getBiomeAt(tx, tz);
      if (curBiome === 'water') {
        creature.thought = `Fording the waterway on our trek to the ${getBiomeDisplayName(destBiome)}`;
      } else if (curBiome !== destBiome) {
        creature.thought = `Wandering across the ${getBiomeDisplayName(curBiome)} toward the ${getBiomeDisplayName(destBiome)}`;
      } else {
        creature.thought = `Scouting the ${getBiomeDisplayName(destBiome)} for a new village hearth`;
      }
    }

    if (Math.hypot(tx - creature.x, tz - creature.z) <= 5.2) {
      world.settlementManager.foundEmigrantVillage(partyId, creature, world);
    }
  }

  private handleTrading(creature: Creature, world: WorldState, _dt: number): void {
    const dest = world.getSettlement(creature.tradeDestinationSettlementId ?? '');
    const home = world.getSettlement(creature.settlementId);
    if (!dest || !home || creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.tradeDestinationSettlementId = null;
      creature.tradeCarrying = null;
      creature.tradeCargoAmount = 0;
      return;
    }

    const dist = Math.hypot(dest.center.x - creature.x, dest.center.z - creature.z);
    if (dist < dest.radius + 2.5) {
      world.economy.completeCaravanTrade(creature, home, dest, world);
      creature.activity = 'idle';
      creature.tradeDestinationSettlementId = null;
      creature.tradeCarrying = null;
      creature.tradeCargoAmount = 0;
    }
  }

  private handleSocialising(creature: Creature, world: WorldState, dt: number): void {
    const dist = Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z);
    if (dist < 3.5) {
      creature.mood = Math.min(100, creature.mood + dt * 3.8);

      // Interact with nearby creature
      if (world.rng.chance(dt * 0.42)) {
        this.queryNearbyCreatures(creature, creature.x, creature.z, 5.5, world, this.nearbyCreatures);
        let nearby: Creature | undefined;
        for (let i = 0; i < this.nearbyCreatures.length; i++) {
          const other = this.nearbyCreatures[i];
          const dx = other.x - creature.x;
          const dz = other.z - creature.z;
          if (dx * dx + dz * dz < 5.5 * 5.5) {
            nearby = other;
            break;
          }
        }
        if (nearby) {
          const sameFaction = nearby.settlementId === creature.settlementId;
          const compat =
            (creature.personality.friendliness + nearby.personality.friendliness) * 0.5 +
            (sameFaction ? 0.2 : -0.05);

          if (world.rng.chance(compat)) {
            const score = creature.adjustRelationship(nearby.id, 10);
            nearby.adjustRelationship(creature.id, 10);
            creature.thought = `Laughing with ${nearby.name}`;
            // Same-species unbonded adults who grow fond of one another can pair off naturally!
            if (
              sameFaction &&
              score >= 22 &&
              creature.lifeStage === 'adult' &&
              nearby.lifeStage === 'adult' &&
              creature.species === nearby.species &&
              !creature.isCloseKinOf(nearby) &&
              world.rng.chance(0.45)
            ) {
              const home = world.getSettlement(creature.settlementId);
              world.pairCreatures(creature, nearby, home?.name);
            }
            if (score >= 45 && score - 10 < 45) {
              world.chronicle.record(
                world.day,
                world.season,
                'social',
                'Woodland Friendship',
                `${creature.name} (${creature.def.displayName}) and ${nearby.name} (${nearby.def.displayName}) became fast friends.`,
                creature.position2D,
              );
            }
          } else {
            const score = creature.adjustRelationship(nearby.id, -14);
            nearby.adjustRelationship(creature.id, -14);
            creature.thought = `Arguing with ${nearby.name} over acorns`;
            if (score <= -45 && score + 14 > -45) {
              world.chronicle.record(
                world.day,
                world.season,
                'social',
                'Bitter Rivalry',
                `A heated quarrel sparked a rivalry between ${creature.name} and ${nearby.name}.`,
                creature.position2D,
              );
            }
          }
        }
      }
    }

    if (creature.actionTimer <= 0) {
      creature.activity = 'idle';
    }
  }

  /** Chooses safe, lively village play & parent-following behaviors for litters of young & juveniles. */
  private chooseYoungActivity(
    creature: Creature,
    home: { center: { x: number; z: number }; radius: number; name: string },
    world: WorldState,
  ): void {
    creature.activity = 'playing';
    creature.actionTimer = world.rng.range(4.5, 8.5);

    // Gather with littermates or follow closely behind a parent
    const littermates = creature.litterId
      ? world.creatures.filter(
          (c) =>
            c.alive &&
            c.id !== creature.id &&
            c.litterId === creature.litterId &&
            c.settlementId === creature.settlementId,
        )
      : [];
    const parents = creature.parentIds
      .map((pid) => world.getCreature(pid))
      .filter(
        (p): p is Creature =>
          Boolean(p && p.alive && p.settlementId === creature.settlementId && p.activity !== 'emigrating'),
      );

    if (parents.length > 0 && (littermates.length === 0 || world.rng.chance(0.55))) {
      const parent = world.rng.pick(parents);
      const angle = world.rng.range(0, Math.PI * 2);
      const dist = world.rng.range(0.9, 2.2);
      creature.targetCreatureId = parent.id;
      creature.targetX = parent.x + Math.cos(angle) * dist;
      creature.targetZ = parent.z + Math.sin(angle) * dist;
      creature.thought = `Following closely behind ${parent.name}`;
      return;
    }

    if (littermates.length > 0) {
      const sibling = world.rng.pick(littermates);
      const angle = world.rng.range(0, Math.PI * 2);
      const dist = world.rng.range(0.65, 1.85);
      creature.targetCreatureId = sibling.id;
      creature.targetX = sibling.x + Math.cos(angle) * dist;
      creature.targetZ = sibling.z + Math.sin(angle) * dist;
      creature.thought = `Tumbling & playing with littermate ${sibling.name.split(' ')[0]}`;
      return;
    }

    const angle = world.rng.range(0, Math.PI * 2);
    const dist = world.rng.range(2.2, Math.min(7.5, Math.max(3.4, home.radius * 0.65)));
    creature.targetCreatureId = null;
    creature.targetX = home.center.x + Math.cos(angle) * dist;
    creature.targetZ = home.center.z + Math.sin(angle) * dist;
    creature.thought = `Frolicking around ${home.name}`;
  }

  private handlePlaying(creature: Creature, world: WorldState, dt: number): void {
    creature.mood = Math.min(100, creature.mood + dt * 3.4);
    const home = world.getSettlement(creature.settlementId);

    // Keep young gently fed from village stores or nearby parents so litters thrive
    if (creature.hunger > 50 && home) {
      if (home.stockpile.berries >= 0.5) {
        home.stockpile.berries = Math.max(0, home.stockpile.berries - 0.5);
        creature.hunger = Math.max(8, creature.hunger - 32);
      } else if (home.stockpile.acorns >= 0.5) {
        home.stockpile.acorns = Math.max(0, home.stockpile.acorns - 0.5);
        creature.hunger = Math.max(8, creature.hunger - 30);
      }
    }

    // Track a parent or littermate smoothly while playing together
    if (creature.targetCreatureId) {
      const buddy = world.getCreature(creature.targetCreatureId);
      if (buddy && buddy.alive && buddy.settlementId === creature.settlementId) {
        const dBuddy = Math.hypot(buddy.x - creature.x, buddy.z - creature.z);
        if (dBuddy > 3.2) {
          creature.targetX = buddy.x + Math.cos(creature.animPhase) * 1.1;
          creature.targetZ = buddy.z + Math.sin(creature.animPhase) * 1.1;
        }
      }
    }

    // Gently keep tiny young inside their home village bounds
    if (home && creature.lifeStage === 'young') {
      const dHome = Math.hypot(creature.x - home.center.x, creature.z - home.center.z);
      if (dHome > Math.max(10, home.radius + 3.5)) {
        creature.targetX = home.center.x + world.rng.range(-3.0, 3.0);
        creature.targetZ = home.center.z + world.rng.range(-3.0, 3.0);
      }
    }

    if (creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.targetCreatureId = null;
    }
  }

  private handleCourting(creature: Creature, world: WorldState, dt: number): void {
    const partner = creature.targetCreatureId
      ? world.getCreature(creature.targetCreatureId)
      : undefined;
    if (
      !partner ||
      !partner.alive ||
      partner.settlementId !== creature.settlementId ||
      creature.actionTimer <= 0
    ) {
      creature.activity = 'idle';
      creature.targetCreatureId = null;
      return;
    }

    // Already paired? Transition smoothly to idle / family life
    if (creature.mateId && world.getCreature(creature.mateId)?.alive) {
      creature.activity = 'idle';
      creature.targetCreatureId = null;
      return;
    }

    const dist = Math.hypot(partner.x - creature.x, partner.z - creature.z);
    if (dist > 2.2) {
      creature.targetX = partner.x;
      creature.targetZ = partner.z;
    } else {
      creature.targetX = creature.x;
      creature.targetZ = creature.z;
      creature.heading = Math.atan2(partner.x - creature.x, partner.z - creature.z);
      creature.mood = Math.min(100, creature.mood + dt * 5.0);
      const affinity = creature.adjustRelationship(partner.id, dt * 16);
      partner.adjustRelationship(creature.id, dt * 16);
      if (affinity >= 18) {
        const home = world.getSettlement(creature.settlementId);
        world.pairCreatures(creature, partner, home?.name);
        creature.activity = 'idle';
        creature.targetCreatureId = null;
        if (partner.activity === 'courting' && partner.targetCreatureId === creature.id) {
          partner.activity = 'idle';
          partner.targetCreatureId = null;
        }
      }
    }
  }

  private handleNesting(creature: Creature, world: WorldState, dt: number): void {
    const mate = creature.mateId ? world.getCreature(creature.mateId) : undefined;
    const home = world.getSettlement(creature.settlementId);
    if (!mate || !mate.alive || !home || mate.settlementId !== home.id) {
      creature.activity = 'idle';
      creature.targetCreatureId = null;
      return;
    }

    const distMate = Math.hypot(mate.x - creature.x, mate.z - creature.z);
    if (distMate > 3.2) {
      creature.targetX = (creature.targetX + mate.x) * 0.5;
      creature.targetZ = (creature.targetZ + mate.z) * 0.5;
    } else {
      creature.mood = Math.min(100, creature.mood + dt * 4.5);
      creature.energy = Math.min(100, creature.energy + dt * 3.0);
    }

    if (creature.actionTimer <= 0) {
      // Only one of the two mates triggers the actual birth when both are ready
      if (creature.canReproduce() && mate.canReproduce() && distMate < 8.5) {
        const food = home.stockpile.berries + home.stockpile.acorns;
        if (food >= 8) {
          home.stockpile.berries = Math.max(0, home.stockpile.berries - 5);
          home.stockpile.acorns = Math.max(0, home.stockpile.acorns - 3);
          world.spawnLitter(creature, mate, home);
        }
      }
      creature.activity = 'idle';
      creature.targetCreatureId = null;
      if (mate.activity === 'nesting') {
        mate.activity = 'idle';
        mate.targetCreatureId = null;
      }
    }
  }

  private handlePraying(creature: Creature, world: WorldState, dt: number): void {
    const dist = Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z);
    if (dist < 3.0) {
      const home = world.getSettlement(creature.settlementId);
      const devotionMult = home?.getAdaptationProfile().devotionBonusMultiplier ?? 1.0;
      creature.devotion = Math.min(100, creature.devotion + dt * 4.5 * devotionMult);
      creature.mood = Math.min(100, creature.mood + dt * 2.2);
      world.deity.receivePrayer(dt * 0.9 * devotionMult, creature.settlementId);
    }
    if (creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.targetBuildingId = null;
    }
  }

  private handleResting(creature: Creature, _world: WorldState, dt: number): void {
    const dist = Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z);
    if (dist < 3.5) {
      creature.health = Math.min(creature.maxHealth, creature.health + dt * 4.2);
      creature.energy = Math.min(100, creature.energy + dt * 6.5);
    }
    if (creature.actionTimer <= 0 && creature.energy > 65) {
      creature.activity = 'idle';
    }
  }

  private handleFighting(creature: Creature, world: WorldState, _dt: number): void {
    const rawTarget = creature.targetCreatureId
      ? world.getCreature(creature.targetCreatureId)
      : undefined;
    const target = rawTarget && rawTarget.alive ? rawTarget : undefined;
    if (!target || creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.targetCreatureId = null;
      return;
    }

    // Retreat if severely wounded
    if (creature.health < creature.maxHealth * 0.25) {
      creature.activity = 'fleeing';
      creature.thought = 'Retreating to mend wounds!';
      creature.actionTimer = 5;
      return;
    }

    const dist = Math.hypot(target.x - creature.x, target.z - creature.z);
    const meleeStandoff =
      getCreaturePersonalRadius(creature) + getCreaturePersonalRadius(target) + 0.32;
    if (dist > meleeStandoff) {
      creature.targetX = target.x;
      creature.targetZ = target.z;
    } else {
      // Stand face-to-face at melee reach instead of pushing into each other's body radius
      creature.targetX = creature.x;
      creature.targetZ = creature.z;
      creature.heading = Math.atan2(target.x - creature.x, target.z - creature.z);
    }

    if (dist < 2.2 && creature.attackCooldown <= 0) {
      const dmg = Math.max(4, creature.def.strength * world.rng.range(0.65, 1.15));
      target.health -= dmg;
      creature.attackCooldown = 1.25;
      creature.adjustRelationship(target.id, -18);
      target.adjustRelationship(creature.id, -18);

      world.emitCombatSpark({
        x: (creature.x + target.x) * 0.5,
        y: (creature.y + target.y) * 0.5 + 0.9,
        z: (creature.z + target.z) * 0.5,
      });

      world.deity.observeConflict(0.6);

      if (target.health <= 0) {
        if (world.rng.chance(0.28)) {
          target.alive = false;
          target.health = 0;
          world.chronicle.record(
            world.day,
            world.season,
            'combat',
            'Fallen in Skirmish',
            `${creature.name} (${creature.def.displayName}) bested ${target.name} (${target.def.displayName}) in woodland combat.`,
            creature.position2D,
          );
          world.deity.observeConflict(2.5);
        } else {
          target.health = target.maxHealth * 0.22;
          target.activity = 'fleeing';
          target.actionTimer = 7;
          target.thought = `Yielding to ${creature.name}!`;
          world.chronicle.record(
            world.day,
            world.season,
            'combat',
            'Woodland Clash',
            `${creature.name} drove ${target.name} back in a fierce territorial clash.`,
            creature.position2D,
          );
        }
        creature.activity = 'idle';
        creature.targetCreatureId = null;
      } else if (target.activity !== 'fighting' && target.activity !== 'fleeing') {
        target.activity = 'fighting';
        target.targetCreatureId = creature.id;
        target.actionTimer = 8;
        target.thought = `Clashing with ${creature.name}!`;
      }
    }
  }

  private handleFleeing(creature: Creature, world: WorldState, _dt: number): void {
    const home = world.getSettlement(creature.settlementId);
    if (home) {
      // Flee to the safe rim of the home hearth plaza rather than directly into the fire
      const rx = creature.x - home.center.x;
      const rz = creature.z - home.center.z;
      const rd = Math.hypot(rx, rz);
      const safeR = HEARTH_FIRE_KEEP_OUT_RADIUS + 0.75;
      if (rd > safeR + 1.2) {
        const dirX = rx / rd;
        const dirZ = rz / rd;
        creature.targetX = home.center.x + dirX * safeR;
        creature.targetZ = home.center.z + dirZ * safeR;
      }
    }
    if (creature.actionTimer <= 0) {
      creature.activity = 'resting';
      creature.targetCreatureId = null;
      creature.actionTimer = 6;
    }
  }

  private handleCelebrating(creature: Creature, world: WorldState, dt: number): void {
    const cel = creature.activeCelebrationId
      ? world.festivals.getCelebrationById(creature.activeCelebrationId)
      : undefined;
    if (!cel) {
      creature.activeCelebrationId = null;
      creature.celebrationHostSettlementId = null;
      creature.isDancingAtCelebration = false;
      if (creature.emigrationPartyId && creature.emigrationTargetX !== null && creature.emigrationTargetZ !== null) {
        creature.activity = 'emigrating';
        creature.targetX = creature.emigrationTargetX;
        creature.targetZ = creature.emigrationTargetZ;
      } else {
        creature.activity = 'idle';
        creature.actionTimer = 0.25;
      }
      return;
    }

    // Pioneers on a distant trek pause to cheer on the trail during a National Holiday
    if (cel.scope === 'national' && creature.emigrationPartyId) {
      creature.isDancingAtCelebration = true;
      creature.targetX = creature.x;
      creature.targetZ = creature.z;
      creature.mood = Math.min(100, creature.mood + dt * 5.0);
      creature.devotion = Math.min(100, creature.devotion + dt * 2.0);
      return;
    }

    const venue =
      world.getSettlement(creature.celebrationHostSettlementId ?? cel.hostSettlementId) ??
      world.getSettlement(creature.settlementId);
    if (!venue) {
      creature.activity = 'idle';
      creature.activeCelebrationId = null;
      creature.celebrationHostSettlementId = null;
      return;
    }

    const distToPlaza = Math.hypot(venue.center.x - creature.x, venue.center.z - creature.z);
    const plazaRange = Math.max(5.5, Math.min(10.5, venue.radius * 0.88));

    if (distToPlaza <= plazaRange) {
      creature.isDancingAtCelebration = true;
      creature.mood = Math.min(100, creature.mood + dt * 5.5);
      creature.energy = Math.min(100, creature.energy + dt * 2.2);
      if (cel.scope === 'national') {
        creature.devotion = Math.min(100, creature.devotion + dt * 2.2);
      }

      if (creature.actionTimer <= 0) {
        const spot = world.festivals.pickCelebrationSpot(venue, world);
        creature.targetX = spot.x;
        creature.targetZ = spot.z;
        this.ensureReachableTarget(creature, world);
        creature.actionTimer = world.rng.range(3.2, 6.2);

        // Warm bonds with nearby fellow celebrants (building cross-village friendships at regional events!)
        this.queryNearbyCreatures(creature, creature.x, creature.z, 5.5, world, this.nearbyCreatures);
        let mingledWith: Creature | null = null;
        for (let i = 0; i < this.nearbyCreatures.length; i++) {
          const other = this.nearbyCreatures[i];
          if (other.activity === 'celebrating') {
            creature.adjustRelationship(other.id, cel.scope === 'regional' ? 7 : 5);
            other.adjustRelationship(creature.id, cel.scope === 'regional' ? 7 : 5);
            mingledWith = other;
            break;
          }
        }

        if (cel.scope === 'national') {
          creature.thought = mingledWith
            ? `Toasting ${cel.name} with ${mingledWith.name}!`
            : `Celebrating ${cel.name} with the whole realm!`;
        } else if (cel.scope === 'regional') {
          creature.thought = mingledWith
            ? `Dancing with ${mingledWith.name} at ${cel.name}!`
            : `Enjoying ${cel.name} in ${venue.name}!`;
        } else {
          creature.thought = mingledWith
            ? `Dancing and laughing with ${mingledWith.name} at ${cel.name}!`
            : `Reveling at ${cel.name}!`;
        }
      }
    } else if (
      creature.actionTimer <= 0 ||
      Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z) <= 0.85
    ) {
      const spot = world.festivals.pickCelebrationSpot(venue, world);
      creature.targetX = spot.x;
      creature.targetZ = spot.z;
      this.ensureReachableTarget(creature, world);
      creature.actionTimer = world.rng.range(5, 9);
    }
  }

  private depositInventory(creature: Creature, home: { stockpile: Record<ResourceType, number> }): void {
    const keys: ResourceType[] = ['timber', 'berries', 'acorns', 'stone', 'herbs', 'crafts'];
    for (const k of keys) {
      if (creature.inventory[k] > 0) {
        home.stockpile[k] += creature.inventory[k];
        creature.wealth += creature.inventory[k] * 0.5;
        creature.inventory[k] = 0;
      }
    }
  }

  /** Physical horizontal body radius of a creature scaled to its species size. */
  private getCreatureRadius(creature: Creature): number {
    return getCreatureObstacleRadius(creature);
  }

  /** Ensures a creature's destination never lands inside any building, tree, boulder, bush, or firepit. */
  private pushTargetOutsideObstacles(creature: Creature, world: WorldState): void {
    const creatureR = this.getCreatureRadius(creature);
    const fallbackAngle = (creature.id.charCodeAt(creature.id.length - 1) || 1) * 1.13;
    const safe = world.obstacles.pushPointOutsideObstacles(
      creature.targetX,
      creature.targetZ,
      creature.x,
      creature.z,
      creatureR,
      0,
      0.24,
      fallbackAngle,
    );
    creature.targetX = safe.x;
    creature.targetZ = safe.z;
  }

  /**
   * Ensures a freshly chosen target lies outside all solid obstacles AND on walkable terrain
   * (for non-aerial creatures), snapping toward the creature's side of any water/cliff edge.
   */
  private ensureReachableTarget(creature: Creature, world: WorldState): void {
    this.pushTargetOutsideObstacles(creature, world);
    const isTargetOk = (tx: number, tz: number): boolean =>
      world.terrain.canCreatureTraverse(tx, tz, creature.def);
    if (isTargetOk(creature.targetX, creature.targetZ)) {
      return;
    }

    const creatureR = this.getCreatureRadius(creature);
    const towardSelf = Math.atan2(creature.z - creature.targetZ, creature.x - creature.targetX);
    const baseX = creature.targetX;
    const baseZ = creature.targetZ;
    const ringRadii = [1.4, 2.8, 4.4];
    const angleOffsets = [0, 0.55, -0.55, 1.15, -1.15, 1.85, -1.85, Math.PI];

    for (const r of ringRadii) {
      for (const off of angleOffsets) {
        const ang = towardSelf + off;
        const cx = baseX + Math.cos(ang) * r;
        const cz = baseZ + Math.sin(ang) * r;
        const safe = world.obstacles.pushPointOutsideObstacles(
          cx,
          cz,
          creature.x,
          creature.z,
          creatureR,
          0,
          0.2,
          ang,
        );
        if (isTargetOk(safe.x, safe.z)) {
          creature.targetX = safe.x;
          creature.targetZ = safe.z;
          return;
        }
      }
    }

    // Pull target partway back toward the creature until it sits on walkable ground
    for (let t = 0.25; t <= 1.0; t += 0.25) {
      const px = baseX + (creature.x - baseX) * t;
      const pz = baseZ + (creature.z - baseZ) * t;
      if (isTargetOk(px, pz)) {
        creature.targetX = px;
        creature.targetZ = pz;
        return;
      }
    }
  }

  /**
   * Recovers a creature caught in a tight nonproductive loop (e.g. wedged behind dense buildings
   * or targeting an unreachable spot across a river) by canceling the blocked task and steering
   * out into nearby open walkable ground.
   */
  private recoverFromStuck(creature: Creature, world: WorldState): void {
    const home = world.getSettlement(creature.settlementId);
    if (creature.activity === 'trading' && creature.tradeCarrying && creature.tradeCargoAmount > 0 && home) {
      home.stockpile[creature.tradeCarrying] += creature.tradeCargoAmount;
    }

    const keepEmigrating =
      creature.activity === 'emigrating' &&
      creature.emigrationPartyId !== null &&
      creature.emigrationTargetX !== null &&
      creature.emigrationTargetZ !== null &&
      creature.actionTimer > 12;

    creature.activity = 'idle';
    creature.targetResourceId = null;
    creature.targetBuildingId = null;
    creature.targetBridgeId = null;
    creature.targetCreatureId = null;
    creature.tradeDestinationSettlementId = null;
    creature.tradeCarrying = null;
    creature.tradeCargoAmount = 0;
    if (!keepEmigrating) {
      creature.emigrationPartyId = null;
      creature.emigrationTargetX = null;
      creature.emigrationTargetZ = null;
    }
    creature.resetNavigationState();

    const creatureR = this.getCreatureRadius(creature);
    const baseAng = home
      ? Math.atan2(home.center.z - creature.z, home.center.x - creature.x)
      : creature.heading;

    let bestX = creature.x;
    let bestZ = creature.z;
    let bestScore = -Infinity;
    const escapeDists = [4.8, 3.2];

    for (let k = 0; k < 12; k++) {
      const ang = baseAng + (k * Math.PI * 2) / 12;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);

      for (const dist of escapeDists) {
        const cx = creature.x + dx * dist;
        const cz = creature.z + dz * dist;
        if (Math.hypot(cx, cz) > world.terrain.playableRadius - 1.5) continue;
        const stepOk =
          keepEmigrating && !creature.def.strictlyAquatic
            ? world.terrain.canEmigrantTraverse(cx, cz)
            : world.terrain.canCreatureTraverse(cx, cz, creature.def);
        if (!stepOk) continue;

        // Verify midpoint is also traversable so the escape vector doesn't cross hazards
        const midX = creature.x + dx * (dist * 0.5);
        const midZ = creature.z + dz * (dist * 0.5);
        const midOk =
          keepEmigrating && !creature.def.strictlyAquatic
            ? world.terrain.canEmigrantTraverse(midX, midZ)
            : world.terrain.canCreatureTraverse(midX, midZ, creature.def);
        if (!midOk) continue;

        const sep = world.obstacles.resolveCollisions(cx, cz, creatureR, 0, ang);
        if (sep.collided) continue;

        const midSep = world.obstacles.resolveCollisions(midX, midZ, creatureR, 0, ang);
        const score = (midSep.collided ? -2.0 : 2.0) + dist * 0.35 + (k === 0 ? 0.5 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestX = cx;
          bestZ = cz;
        }
      }
    }

    creature.targetX = bestX;
    creature.targetZ = bestZ;
    if (keepEmigrating) {
      creature.activity = 'emigrating';
      creature.detourTimer = 3.2;
      creature.detourSign = creature.detourSign === 0 ? 1 : ((-creature.detourSign) as -1 | 1);
      creature.thought = 'Blazing a trail around obstacles toward a new village';
    } else {
      creature.actionTimer = bestScore > -Infinity ? 3.2 : 0.4;
      creature.thought = 'Finding a clearer woodland path';
    }
  }

  private updateCreatureElevation(creature: Creature, world: WorldState): void {
    const groundY = world.terrain.getHeightAt(creature.x, creature.z);
    const bridgeY = world.terrain.getBridgeDeckY(creature.x, creature.z);
    if (creature.def.strictlyAquatic) {
      const waterDepth = Math.max(0.28, world.terrain.waterLevel - groundY);
      const targetSubmersion = Math.min(0.38, Math.max(0.24, waterDepth * 0.52));
      const bob = Math.sin(creature.animPhase * 0.7) * 0.03;
      creature.y = Math.max(groundY + 0.1, world.terrain.waterLevel - targetSubmersion + bob);
      return;
    }
    if (creature.def.aquatic && groundY < world.terrain.waterLevel - 0.02 && bridgeY === null) {
      creature.y = Math.max(groundY, world.terrain.waterLevel - 0.44);
      return;
    }
    const isRegionalFestivalTraveler =
      creature.activity === 'celebrating' &&
      !creature.isDancingAtCelebration &&
      creature.celebrationHostSettlementId !== null &&
      creature.celebrationHostSettlementId !== creature.settlementId;
    const waterFloor =
      creature.def.amphibious || creature.activity === 'emigrating' || isRegionalFestivalTraveler
        ? world.terrain.waterLevel - 0.06
        : world.terrain.waterLevel;
    creature.y =
      Math.max(groundY, bridgeY ?? -Infinity, waterFloor) +
      creature.flightAltitude;
  }

  private moveCreature(creature: Creature, world: WorldState, dt: number): void {
    const obsVersion = world.obstacles.version;
    const obstaclesChanged = creature.validatedObstacleVersion !== obsVersion;
    if (
      obstaclesChanged ||
      creature.targetX !== creature.validatedTargetX ||
      creature.targetZ !== creature.validatedTargetZ
    ) {
      this.pushTargetOutsideObstacles(creature, world);
      creature.validatedTargetX = creature.targetX;
      creature.validatedTargetZ = creature.targetZ;
      creature.validatedObstacleVersion = obsVersion;
    }

    const startX = creature.x;
    const startZ = creature.z;
    const creatureR = this.getCreatureRadius(creature);
    const personalR = getCreaturePersonalRadius(creature);
    const altitude = creature.def.aerial ? creature.flightAltitude : 0;
    creature.detourTimer = Math.max(0, creature.detourTimer - dt);
    if (creature.detourTimer <= 0) {
      creature.detourSign = 0;
    }

    const dx = creature.targetX - creature.x;
    const dz = creature.targetZ - creature.z;
    let dist = Math.sqrt(dx * dx + dz * dz);

    // Query nearby creatures only when moving (crowd courtesy & predictive passing)
    if (dist > 0.25) {
      this.queryNearbyCreatures(creature, creature.x, creature.z, 4.2, world, this.nearbyCreatures);
    }

    // Crowd courtesy: if our exact destination spot is already occupied by another creature nearby,
    // settle comfortably beside them instead of orbiting each other over the same square inch.
    if (
      dist > 0.25 &&
      dist < 1.55 &&
      creature.activity !== 'fighting' &&
      creature.activity !== 'fleeing'
    ) {
      for (let i = 0; i < this.nearbyCreatures.length; i++) {
        const other = this.nearbyCreatures[i];
        const pairR = personalR + getCreaturePersonalRadius(other);
        const ox = other.x - creature.targetX;
        const oz = other.z - creature.targetZ;
        const lim = pairR + 0.1;
        if (ox * ox + oz * oz < lim * lim) {
          creature.targetX = creature.x;
          creature.targetZ = creature.z;
          dist = 0;
          break;
        }
      }
    }

    if (dist > 0.25) {
      const isEmigrating = creature.activity === 'emigrating';
      const isRegionalFestivalTraveler =
        creature.activity === 'celebrating' &&
        !creature.isDancingAtCelebration &&
        creature.celebrationHostSettlementId !== null &&
        creature.celebrationHostSettlementId !== creature.settlementId;
      const canFordWater = isEmigrating || isRegionalFestivalTraveler;
      const terrain = world.terrain;
      const isFordingWater =
        canFordWater &&
        !creature.def.aerial &&
        world.terrain.getBridgeDeckY(creature.x, creature.z) === null &&
        world.terrain.getHeightAt(creature.x, creature.z) < world.terrain.waterLevel + 0.05;

      const speedMult =
        creature.activity === 'fleeing'
          ? 1.35
          : creature.activity === 'fighting'
            ? 1.2
            : creature.activity === 'trading'
              ? 1.1
              : isEmigrating
                ? isFordingWater
                  ? 0.82
                  : 1.42
                : isRegionalFestivalTraveler
                  ? isFordingWater
                    ? 0.84
                    : 1.24
                  : creature.isDancingAtCelebration
                    ? 0.78
                : 1.0;

      const step = Math.min(dist, creature.def.baseSpeed * speedMult * dt);
      let dirX = dx / dist;
      let dirZ = dz / dist;

      // Smart waterway bridge guidance: route grounded travelers onto nearby completed bridges
      // when a stream blocks their direct path, and keep them aligned down the arched deck.
      if (!creature.def.aerial && !creature.def.aquatic && world.bridges.length > 0 && dist > 2.2) {
        let guidedX: number | null = null;
        let guidedZ: number | null = null;

        // If currently standing on a completed bridge, guide cleanly toward the exit bank closer to target
        for (let i = 0; i < world.bridges.length; i++) {
          const br = world.bridges[i];
          if (!br.completed) continue;
          if (getBridgeDeckHeightAt(br, creature.x, creature.z, 0.2, 0.7) !== null) {
            const dStartTgt = Math.hypot(br.startX - creature.targetX, br.startZ - creature.targetZ);
            const dEndTgt = Math.hypot(br.endX - creature.targetX, br.endZ - creature.targetZ);
            const exitX = dEndTgt <= dStartTgt ? br.endX + br.dirX * 1.1 : br.startX - br.dirX * 1.1;
            const exitZ = dEndTgt <= dStartTgt ? br.endZ + br.dirZ * 1.1 : br.startZ - br.dirZ * 1.1;
            if (Math.hypot(exitX - creature.x, exitZ - creature.z) > 0.6) {
              guidedX = exitX;
              guidedZ = exitZ;
            }
            break;
          }
        }

        // Otherwise, if a waterway lies ahead on our direct line, head to a nearby completed bridge crossing
        if (guidedX === null) {
          const p1x = creature.x + dirX * Math.min(dist * 0.5, 2.4);
          const p1z = creature.z + dirZ * Math.min(dist * 0.5, 2.4);
          const p2x = creature.x + dirX * Math.min(dist * 0.8, 5.4);
          const p2z = creature.z + dirZ * Math.min(dist * 0.8, 5.4);
          const waterAhead =
            (!world.terrain.isWalkable(p1x, p1z, creature.def.amphibious) &&
              world.terrain.getHeightAt(p1x, p1z) < world.terrain.waterLevel + 0.12) ||
            (!world.terrain.isWalkable(p2x, p2z, creature.def.amphibious) &&
              world.terrain.getHeightAt(p2x, p2z) < world.terrain.waterLevel + 0.12);

          if (waterAhead) {
            let bestCost = Infinity;
            const maxBridgeSearch =
              isEmigrating || creature.activity === 'trading' ? 64 : 34;
            for (let i = 0; i < world.bridges.length; i++) {
              const br = world.bridges[i];
              if (!br.completed) continue;
              const approach = getBridgeApproach(br, creature.x, creature.z);
              if (approach.nearDist > maxBridgeSearch) continue;
              const nearToTarget = Math.hypot(approach.nearX - creature.targetX, approach.nearZ - creature.targetZ);
              const farToTarget = Math.hypot(approach.farX - creature.targetX, approach.farZ - creature.targetZ);
              if (farToTarget + 1.2 >= nearToTarget) continue;
              const totalCost = approach.nearDist + farToTarget;
              if (totalCost < bestCost) {
                bestCost = totalCost;
                if (approach.nearDist < 2.2) {
                  guidedX = approach.farX;
                  guidedZ = approach.farZ;
                } else {
                  guidedX = approach.nearX;
                  guidedZ = approach.nearZ;
                }
              }
            }
          }
        }

        if (guidedX !== null && guidedZ !== null) {
          const gx = guidedX - creature.x;
          const gz = guidedZ - creature.z;
          const gLen = Math.hypot(gx, gz);
          if (gLen > 0.2) {
            dirX = gx / gLen;
            dirZ = gz / gLen;
          }
        }
      }

      const baseDirX = dirX;
      const baseDirZ = dirZ;

      // Context-based local steering around buildings, trees, rocks, bushes, benches, fires & creatures
      const lookahead = Math.min(dist, 3.0);
      world.obstacles.queryNearby(
        creature.x + baseDirX * (lookahead * 0.45),
        creature.z + baseDirZ * (lookahead * 0.45),
        5.0 + lookahead * 0.5,
        this.nearbyObstacles,
      );

      let pathBlocked = creature.detourTimer > 0;

      // Check forward terrain walkability so creatures curve along riverbanks proactively
      if (!pathBlocked && !creature.def.aerial) {
        const terrainProbeX = creature.x + baseDirX * Math.min(lookahead, 1.25);
        const terrainProbeZ = creature.z + baseDirZ * Math.min(lookahead, 1.25);
        const probeOk =
          canFordWater && !creature.def.strictlyAquatic
            ? terrain.canEmigrantTraverse(terrainProbeX, terrainProbeZ)
            : terrain.canCreatureTraverse(terrainProbeX, terrainProbeZ, creature.def);
        if (!probeOk) {
          pathBlocked = true;
        }
      }

      if (!pathBlocked) {
        for (let i = 0; i < this.nearbyObstacles.length; i++) {
          const obs = this.nearbyObstacles[i];
          if (altitude > obs.height) continue;

          const minR = world.obstacles.getEffectiveRadius(obs, creatureR);
          const toObsX = obs.x - creature.x;
          const toObsZ = obs.z - creature.z;
          const dSq = toObsX * toObsX + toObsZ * toObsZ;
          if (dSq < (minR + 0.9) * (minR + 0.9)) {
            pathBlocked = true;
            break;
          }
          const proj = toObsX * baseDirX + toObsZ * baseDirZ;
          if (proj > 0 && proj < lookahead + minR) {
            const perpSq = Math.max(0, dSq - proj * proj);
            if (perpSq < (minR + 0.45) * (minR + 0.45)) {
              pathBlocked = true;
              break;
            }
          }
        }
      }

      if (!pathBlocked) {
        const creatureLookahead = Math.min(lookahead, 2.4);
        for (let i = 0; i < this.nearbyCreatures.length; i++) {
          const other = this.nearbyCreatures[i];
          if (creature.activity === 'fighting' && other.id === creature.targetCreatureId) continue;
          const pairR = personalR + getCreaturePersonalRadius(other);
          const toOtherX = other.x - creature.x;
          const toOtherZ = other.z - creature.z;
          const dSq = toOtherX * toOtherX + toOtherZ * toOtherZ;
          if (dSq < (pairR + 0.5) * (pairR + 0.5)) {
            pathBlocked = true;
            break;
          }
          const proj = toOtherX * baseDirX + toOtherZ * baseDirZ;
          if (proj > 0 && proj < creatureLookahead + pairR) {
            const perpSq = Math.max(0, dSq - proj * proj);
            if (perpSq < (pairR + 0.22) * (pairR + 0.22)) {
              pathBlocked = true;
              break;
            }
          }
        }
      }

      const tieSign = (creature.id.charCodeAt(creature.id.length - 1) & 1) === 0 ? 1 : -1;

      if (pathBlocked) {
        // Pre-filter nearby obstacles to only those within ray-interaction range (10x fewer inner-loop checks)
        let activeObsCount = 0;
        for (let i = 0; i < this.nearbyObstacles.length; i++) {
          const obs = this.nearbyObstacles[i];
          if (altitude > obs.height) continue;
          const minR = world.obstacles.getEffectiveRadius(obs, creatureR);
          const toObsX = obs.x - creature.x;
          const toObsZ = obs.z - creature.z;
          const dSq = toObsX * toObsX + toObsZ * toObsZ;
          const maxReach = lookahead + minR + 0.6;
          if (dSq > maxReach * maxReach) continue;
          this.activeObsX[activeObsCount] = obs.x;
          this.activeObsZ[activeObsCount] = obs.z;
          this.activeObsToX[activeObsCount] = toObsX;
          this.activeObsToZ[activeObsCount] = toObsZ;
          this.activeObsDSq[activeObsCount] = dSq;
          this.activeObsMinR[activeObsCount] = minR;
          activeObsCount++;
        }

        const creatureLookahead = Math.min(lookahead, 2.4);
        let activeCrCount = 0;
        for (let i = 0; i < this.nearbyCreatures.length; i++) {
          const other = this.nearbyCreatures[i];
          if (creature.activity === 'fighting' && other.id === creature.targetCreatureId) continue;
          const pairR = personalR + getCreaturePersonalRadius(other);
          const toOtherX = other.x - creature.x;
          const toOtherZ = other.z - creature.z;
          const dSq = toOtherX * toOtherX + toOtherZ * toOtherZ;
          const maxReach = creatureLookahead + pairR + 0.6;
          if (dSq > maxReach * maxReach) continue;
          this.activeCrX[activeCrCount] = other.x;
          this.activeCrZ[activeCrCount] = other.z;
          this.activeCrToX[activeCrCount] = toOtherX;
          this.activeCrToZ[activeCrCount] = toOtherZ;
          this.activeCrDSq[activeCrCount] = dSq;
          this.activeCrPairR[activeCrCount] = pairR;
          activeCrCount++;
        }

        const prevDirX = Math.sin(creature.heading);
        const prevDirZ = Math.cos(creature.heading);
        const probeStep = Math.max(step, 0.45);
        const midProbeStep = Math.min(lookahead, 1.35);

        let bestScore = -Infinity;
        let bestX = baseDirX;
        let bestZ = baseDirZ;
        let bestOffset = 0;
        let straightHazard = 0;

        for (let k = 0; k < STEER_OFFSETS.length; k++) {
          const offset = STEER_OFFSETS[k];
          const cosOff = STEER_COS[k];
          const sinOff = STEER_SIN[k];
          const cx = baseDirX * cosOff - baseDirZ * sinOff;
          const cz = baseDirZ * cosOff + baseDirX * sinOff;
          const nearProbeX = creature.x + cx * probeStep;
          const nearProbeZ = creature.z + cz * probeStep;

          // Goal progress + heading momentum + committed wall-following consistency
          let score =
            (cx * baseDirX + cz * baseDirZ) * 1.15 +
            (cx * prevDirX + cz * prevDirZ) * 0.45 +
            (offset > 0 ? 0.06 : 0);

          if (creature.detourSign !== 0 && creature.detourTimer > 0) {
            if (offset * creature.detourSign > 0) {
              score += 0.85;
            } else if (offset * creature.detourSign < 0) {
              score -= 0.35;
            }
          } else if (offset * tieSign > 0) {
            score += 0.03;
          }

          let hazard = 0;

          // Avoid steering into unwalkable water or cliffs
          if (!creature.def.aerial) {
            const nearOk =
              canFordWater && !creature.def.strictlyAquatic
                ? terrain.canEmigrantTraverse(nearProbeX, nearProbeZ)
                : terrain.canCreatureTraverse(nearProbeX, nearProbeZ, creature.def);
            if (!nearOk) {
              hazard += 7.0;
            }
            const midProbeX = creature.x + cx * midProbeStep;
            const midProbeZ = creature.z + cz * midProbeStep;
            const midOk =
              canFordWater && !creature.def.strictlyAquatic
                ? terrain.canEmigrantTraverse(midProbeX, midProbeZ)
                : terrain.canCreatureTraverse(midProbeX, midProbeZ, creature.def);
            if (!midOk) {
              hazard += 2.6;
            }
          }

          // Evaluate obstacle clearance along this candidate ray
          for (let i = 0; i < activeObsCount; i++) {
            const minR = this.activeObsMinR[i];
            const toObsX = this.activeObsToX[i];
            const toObsZ = this.activeObsToZ[i];
            const dSq = this.activeObsDSq[i];
            const proj = toObsX * cx + toObsZ * cz;

            // Penalize stepping deeper into an obstacle already touching us
            const pdx = nearProbeX - this.activeObsX[i];
            const pdz = nearProbeZ - this.activeObsZ[i];
            const probeR = minR + 0.12;
            const probeDSq = pdx * pdx + pdz * pdz;
            if (probeDSq < probeR * probeR) {
              hazard += 5.0 * (1 + (probeR - Math.sqrt(probeDSq)));
            }

            // Penalize rays that intersect an obstacle within lookahead distance
            if (proj > 0 && proj < lookahead + minR) {
              const clearMargin = minR + 0.32;
              const perpSq = Math.max(0, dSq - proj * proj);
              if (perpSq < clearMargin * clearMargin) {
                const perpDist = Math.sqrt(perpSq);
                const hitSeverity = (clearMargin - perpDist) / clearMargin;
                const distFactor = 1 - Math.max(0, proj - minR) / (lookahead + 0.5);
                hazard += 3.2 * (0.35 + hitSeverity) * (0.4 + 0.6 * distFactor);
              }
            }
          }

          // Evaluate passing clearance around other creatures in the same altitude band
          for (let i = 0; i < activeCrCount; i++) {
            const pairR = this.activeCrPairR[i];
            const toOtherX = this.activeCrToX[i];
            const toOtherZ = this.activeCrToZ[i];
            const dSq = this.activeCrDSq[i];
            const proj = toOtherX * cx + toOtherZ * cz;

            const pdx = nearProbeX - this.activeCrX[i];
            const pdz = nearProbeZ - this.activeCrZ[i];
            const probeR = pairR + 0.1;
            const probeDSq = pdx * pdx + pdz * pdz;
            if (probeDSq < probeR * probeR) {
              hazard += 4.2 * (1 + (probeR - Math.sqrt(probeDSq)));
            }

            if (proj > 0 && proj < creatureLookahead + pairR) {
              const clearMargin = pairR + 0.2;
              const perpSq = Math.max(0, dSq - proj * proj);
              if (perpSq < clearMargin * clearMargin) {
                const perpDist = Math.sqrt(perpSq);
                const hitSeverity = (clearMargin - perpDist) / clearMargin;
                const distFactor = 1 - Math.max(0, proj - pairR) / (creatureLookahead + 0.5);
                hazard += 2.4 * (0.35 + hitSeverity) * (0.4 + 0.6 * distFactor);
              }
            }
          }

          if (k === 0) straightHazard = hazard;
          score -= hazard;

          if (score > bestScore) {
            bestScore = score;
            bestX = cx;
            bestZ = cz;
            bestOffset = offset;
          }
        }

        dirX = bestX;
        dirZ = bestZ;

        if (straightHazard < 0.05 && Math.abs(bestOffset) < 0.01) {
          // Direct path is clear again — release detour lock cleanly
          creature.detourTimer = 0;
          creature.detourSign = 0;
        } else if (Math.abs(bestOffset) > 0.2 && creature.detourTimer <= 0) {
          creature.detourSign = bestOffset > 0 ? 1 : -1;
          creature.detourTimer = 1.6;
        }
      }

      const prevX = creature.x;
      const prevZ = creature.z;
      let nx = creature.x + dirX * step;
      let nz = creature.z + dirZ * step;

      // Invisible circular valley boundary: smoothly steer inward rather than clipping a square wall
      const maxR = world.terrain.playableRadius;
      const nrSq = nx * nx + nz * nz;
      if (nrSq > maxR * maxR && nrSq > 1e-6) {
        const nr = Math.sqrt(nrSq);
        nx = (nx / nr) * maxR;
        nz = (nz / nr) * maxR;
      }

      // Hard multi-pass separation so grounded/low-flying creatures never clip any solid world feature
      const sep = world.obstacles.resolveCollisions(
        nx,
        nz,
        creatureR,
        altitude,
        creature.heading,
      );
      nx = sep.x;
      nz = sep.z;

      const canStep = (px: number, pz: number): boolean =>
        canFordWater && !creature.def.aerial && !creature.def.strictlyAquatic
          ? terrain.canEmigrantTraverse(px, pz)
          : terrain.canCreatureTraverse(px, pz, creature.def);
      const primaryOk = canStep(nx, nz);
      if (primaryOk) {
        creature.x = nx;
        creature.z = nz;
      } else {
        // Detour around steep slopes, deep sea, or impassable alpine peaks
        const baseDirAng = Math.atan2(dirZ, dirX);
        let moved = false;
        for (let fi = 0; fi < FALLBACK_DETOUR_ANGLES.length; fi++) {
          const ang = baseDirAng + FALLBACK_DETOUR_ANGLES[fi];
          const detourX = creature.x + Math.cos(ang) * step;
          const detourZ = creature.z + Math.sin(ang) * step;
          const detourOk = canStep(detourX, detourZ);
          if (!detourOk) continue;
          const altSep = world.obstacles.resolveCollisions(
            detourX,
            detourZ,
            creatureR,
            altitude,
            creature.heading,
          );
          const altOk = canStep(altSep.x, altSep.z);
          if (altOk) {
            creature.x = altSep.x;
            creature.z = altSep.z;
            moved = true;
            break;
          }
        }
        if (!moved) {
          // Accelerate stuck recovery rather than freezing silently in place
          creature.navProgressTimer += 1.2;
        }
      }

      const movedX = creature.x - prevX;
      const movedZ = creature.z - prevZ;
      if (movedX * movedX + movedZ * movedZ > 0.0001) {
        creature.heading = Math.atan2(movedX, movedZ);
      } else {
        creature.heading = Math.atan2(dirX, dirZ);
      }
      creature.animPhase += dt * (creature.def.baseSpeed * 2.4);

      if (creature.def.aerial) {
        const targetAlt = dist > 5 ? 2.4 + Math.sin(creature.animPhase * 0.4) * 0.5 : 0.2;
        creature.flightAltitude += (targetAlt - creature.flightAltitude) * Math.min(1, dt * 3.5);
      }

      // Goal-distance progress & loop detection (catches both pinned stalls and orbiting loops of any radius)
      if (dist > 0.3 && creature.activity !== 'fighting') {
        const pdx = creature.targetX - creature.x;
        const pdz = creature.targetZ - creature.z;
        const postDist = Math.sqrt(pdx * pdx + pdz * pdz);
        const progressReq = dist > 1.5 ? 0.85 : 0.35;
        if (creature.navBestGoalDist === Infinity) {
          creature.navBestGoalDist = postDist;
          creature.navProgressTimer = 0;
        } else if (postDist < creature.navBestGoalDist - progressReq) {
          creature.navBestGoalDist = postDist;
          creature.navProgressTimer = 0;
          creature.navLoopCount = 0;
        } else {
          creature.navProgressTimer += dt;
          if (creature.navProgressTimer >= 1.6) {
            creature.navBestGoalDist = postDist;
            creature.navProgressTimer = 0;
            creature.navLoopCount += 1;

            if (creature.navLoopCount === 1) {
              // First stall: commit firmly to the opposite side around the obstruction
              creature.detourSign =
                creature.detourSign === 0
                  ? (tieSign as -1 | 1)
                  : ((-creature.detourSign) as -1 | 1);
              creature.detourTimer = 3.2;

              // If heading to a specific building, retarget the side of that building facing us
              if (creature.targetBuildingId) {
                const home = world.getSettlement(creature.settlementId);
                const bld = home?.buildings.find((b) => b.id === creature.targetBuildingId);
                if (bld) {
                  const faceAng = Math.atan2(creature.z - bld.position.z, creature.x - bld.position.x);
                  const standR = getBuildingCollisionRadius(bld.type) + creatureR + 0.65;
                  creature.targetX = bld.position.x + Math.cos(faceAng) * standR;
                  creature.targetZ = bld.position.z + Math.sin(faceAng) * standR;
                  this.ensureReachableTarget(creature, world);
                  creature.navBestGoalDist = Math.hypot(
                    creature.targetX - creature.x,
                    creature.targetZ - creature.z,
                  );
                }
              }
            } else {
              // Second consecutive stall: escape cleanly into open ground and pick a new task
              this.recoverFromStuck(creature, world);
            }
          }
        }
      } else {
        creature.navBestGoalDist = Infinity;
        creature.navProgressTimer = 0;
      }
    } else if (creature.def.aerial) {
      creature.flightAltitude += (0 - creature.flightAltitude) * Math.min(1, dt * 4.5);
      creature.navBestGoalDist = Infinity;
      creature.navProgressTimer = 0;
    } else {
      creature.navBestGoalDist = Infinity;
      creature.navProgressTimer = 0;
    }

    // Keep stationary/just-landed creatures outside newly placed buildings & obstacles
    if (dist <= 0.25 && (obstaclesChanged || creature.def.aerial)) {
      const finalSep = world.obstacles.resolveCollisions(
        creature.x,
        creature.z,
        creatureR,
        creature.def.aerial ? creature.flightAltitude : 0,
        creature.heading,
      );
      if (finalSep.collided) {
        creature.x = finalSep.x;
        creature.z = finalSep.z;
      }
    }

    if (creature.x !== startX || creature.z !== startZ || creature.def.aerial) {
      this.updateCreatureElevation(creature, world);
    }
  }

  /**
   * Multi-pass post-step creature-to-creature collision solver.
   * Guarantees creatures in the same altitude band never walk through or stand inside one another,
   * while strictly preserving static obstacle clearance and walkable terrain constraints.
   */
  resolveCreatureCollisions(world: WorldState): void {
    const maxR = world.terrain.playableRadius;
    const maxRSq = maxR * maxR;
    const tryDisplace = (
      c: Creature,
      dx: number,
      dz: number,
    ): boolean => {
      let nx = c.x + dx;
      let nz = c.z + dz;
      const nrSq = nx * nx + nz * nz;
      if (nrSq > maxRSq && nrSq > 1e-6) {
        const nr = Math.sqrt(nrSq);
        nx = (nx / nr) * maxR;
        nz = (nz / nr) * maxR;
      }
      const alt = c.def.aerial ? c.flightAltitude : 0;
      const sep = world.obstacles.resolveCollisions(
        nx,
        nz,
        getCreatureObstacleRadius(c),
        alt,
        c.heading,
      );
      if (!world.terrain.canCreatureTraverse(sep.x, sep.z, c.def)) {
        this.dispApplied = false;
        this.dispX = c.x;
        this.dispZ = c.z;
        return false;
      }
      const movedSq = (sep.x - c.x) * (sep.x - c.x) + (sep.z - c.z) * (sep.z - c.z);
      this.dispApplied = movedSq > 1e-6;
      this.dispX = sep.x;
      this.dispZ = sep.z;
      return this.dispApplied;
    };

    const movedSet = this.movedCreatures;
    movedSet.clear();

    for (let pass = 0; pass < 3; pass++) {
      this.rebuildCreatureGrid(world);
      let anySeparated = false;

      for (let i = 0; i < world.creatures.length; i++) {
        const a = world.creatures[i];
        if (!a.alive) continue;
        const aR = getCreaturePersonalRadius(a);
        const aAlt = a.def.aerial ? a.flightAltitude : 0;
        const cx = Math.floor(a.x * INV_CREATURE_CELL_SIZE);
        const cz = Math.floor(a.z * INV_CREATURE_CELL_SIZE);

        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gz = cz - 1; gz <= cz + 1; gz++) {
            const bucket = this.creatureCells.get(creatureCellKey(gx, gz));
            if (!bucket) continue;

            for (let j = 0; j < bucket.length; j++) {
              const b = bucket[j];
              if (!b.alive || a.id >= b.id) continue;

              const bAlt = b.def.aerial ? b.flightAltitude : 0;
              if (Math.abs(aAlt - bAlt) >= VERTICAL_SEPARATION_BAND) continue;

              const minDist = aR + getCreaturePersonalRadius(b);
              const dx = b.x - a.x;
              const dz = b.z - a.z;
              const dSq = dx * dx + dz * dz;
              if (dSq >= minDist * minDist) continue;

              let ux: number;
              let uz: number;
              let dist: number;
              if (dSq > 1e-6) {
                dist = Math.sqrt(dSq);
                ux = dx / dist;
                uz = dz / dist;
              } else {
                dist = 0;
                const seedAng =
                  ((a.id.charCodeAt(a.id.length - 1) + b.id.charCodeAt(b.id.length - 1)) % 12) *
                  (Math.PI / 6);
                ux = Math.cos(seedAng);
                uz = Math.sin(seedAng);
              }

              const pen = minDist - dist + 0.008;
              const half = pen * 0.52;

              const appliedA = tryDisplace(a, -ux * half, -uz * half);
              const ax = this.dispX;
              const az = this.dispZ;
              const appliedB = tryDisplace(b, ux * half, uz * half);
              const bx = this.dispX;
              const bz = this.dispZ;

              if (appliedA && appliedB) {
                a.x = ax;
                a.z = az;
                b.x = bx;
                b.z = bz;
                movedSet.add(a);
                movedSet.add(b);
                anySeparated = true;
              } else if (appliedA && !appliedB) {
                const fullA = tryDisplace(a, -ux * pen, -uz * pen);
                a.x = fullA ? this.dispX : ax;
                a.z = fullA ? this.dispZ : az;
                movedSet.add(a);
                anySeparated = true;
              } else if (!appliedA && appliedB) {
                const fullB = tryDisplace(b, ux * pen, uz * pen);
                b.x = fullB ? this.dispX : bx;
                b.z = fullB ? this.dispZ : bz;
                movedSet.add(b);
                anySeparated = true;
              }
            }
          }
        }
      }

      if (!anySeparated) break;
    }

    for (const c of movedSet) {
      this.updateCreatureElevation(c, world);
    }
    movedSet.clear();
  }
}
