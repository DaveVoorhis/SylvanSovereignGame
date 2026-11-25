import type { ResourceType } from '@core/Types';
import {
  HEARTH_FIRE_KEEP_OUT_RADIUS,
  getBuildingCollisionRadius,
  type SolidObstacle,
} from '@simulation/terrain/ObstacleMap';
import type { WorldState } from '@simulation/WorldState';
import type { Creature } from './Creature';

export { HEARTH_FIRE_KEEP_OUT_RADIUS };

/** Horizontal collision radius of a creature against static world obstacles. */
export function getCreatureObstacleRadius(creature: Creature): number {
  return Math.max(0.26, creature.def.bodyScale * 0.36);
}

/** Personal-space horizontal radius used for creature-to-creature avoidance and separation. */
export function getCreaturePersonalRadius(creature: Creature): number {
  return Math.max(0.32, creature.def.bodyScale * 0.42);
}

/**
 * Candidate relative steering offsets (radians) evaluated when obstacles, other creatures,
 * or unwalkable terrain block the forward path. Covers up to ±2.85 rad so creatures can
 * cleanly back out of deep cul-de-sacs instead of getting pinned.
 */
const STEER_OFFSETS = [0, 0.38, -0.38, 0.78, -0.78, 1.22, -1.22, 1.72, -1.72, 2.28, -2.28, 2.85, -2.85];

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
  private readonly nearbyCreatures: Creature[] = [];
  private readonly creatureCells = new Map<number, Creature[]>();
  private creatureGridStep = -1;

  /** Rebuilds the lightweight spatial hash of alive creatures once per simulation step. */
  prepareStep(world: WorldState): void {
    this.rebuildCreatureGrid(world);
    this.creatureGridStep = world.elapsedSeconds;
  }

  private rebuildCreatureGrid(world: WorldState): void {
    for (const bucket of this.creatureCells.values()) {
      bucket.length = 0;
    }
    for (const c of world.creatures) {
      if (!c.alive) continue;
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

    // Passive physiological drift
    creature.ageDays += dt / world.config.dayLengthSeconds;
    creature.hunger = Math.min(100, creature.hunger + dt * 0.52);
    creature.energy = Math.max(
      0,
      creature.energy - dt * (creature.activity === 'resting' ? -4.8 : 0.42),
    );
    creature.attackCooldown = Math.max(0, creature.attackCooldown - dt);
    creature.actionTimer = Math.max(0, creature.actionTimer - dt);

    // Subtle weather & mood influence
    if (world.weather === 'storm' && creature.activity !== 'resting') {
      creature.mood = Math.max(10, creature.mood - dt * 0.8);
    } else if (world.weather === 'sunbeams' || world.weather === 'blossom') {
      creature.mood = Math.min(100, creature.mood + dt * 0.5);
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

    const sightRange = creature.role === 'guard' ? 16 : 9.5;
    for (const other of world.creatures) {
      if (!other.alive || other.id === creature.id) continue;
      if (other.settlementId === creature.settlementId) continue;

      const stance = world.diplomacy.getStance(creature.settlementId, other.settlementId);
      const personalScore = creature.relationships.get(other.id) ?? 0;
      const hostile = stance === 'war' || personalScore <= -55;
      if (!hostile) continue;

      const dist = Math.hypot(other.x - creature.x, other.z - creature.z);
      if (dist > sightRange) continue;

      const braveEnough =
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

  private chooseNextActivity(creature: Creature, world: WorldState): void {
    const home = world.getSettlement(creature.settlementId);
    if (!home) return;

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

    // 3. Unfinished buildings need builders (builders & artisans eagerly pitch in across expanding districts!)
    const unfinishedList = home.buildings.filter((b) => !b.completed);
    if (
      unfinishedList.length > 0 &&
      (creature.role === 'builder' ||
        (creature.role === 'artisan' && world.rng.chance(0.55)) ||
        world.rng.chance(0.42 * creature.def.buildSkill))
    ) {
      // Pick the nearest unfinished construction site so builders spread across active projects
      let chosenSite = unfinishedList[0];
      let bestDist = Infinity;
      for (const site of unfinishedList) {
        const d = Math.hypot(site.position.x - creature.x, site.position.z - creature.z);
        if (d < bestDist) {
          bestDist = d;
          chosenSite = site;
        }
      }
      creature.activity = 'building';
      creature.targetBuildingId = chosenSite.id;
      const approachAng = Math.atan2(
        creature.z - chosenSite.position.z,
        creature.x - chosenSite.position.x,
      );
      const standAngle = approachAng + world.rng.range(-0.9, 0.9);
      const standR = getBuildingCollisionRadius(chosenSite.type) + this.getCreatureRadius(creature) + 0.55;
      creature.targetX = chosenSite.position.x + Math.cos(standAngle) * standR;
      creature.targetZ = chosenSite.position.z + Math.sin(standAngle) * standR;
      creature.actionTimer = 24;
      creature.thought = `Raising a new ${chosenSite.type.replace(/_/g, ' ')}`;
      return;
    }

    // 4. Trade caravan if merchant or trade-inclined and peaceful neighbor exists
    if (
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
          creature.actionTimer = 38;
          creature.thought = `Carrying ${good} to ${partner.name}`;
          return;
        }
      }
    }

    // 5. Pray at a woodland shrine or study at an Owl Archive (feeds the Procedural God)
    const sacredSite = home.buildings.find(
      (b) => b.completed && (b.type === 'shrine' || b.type === 'library'),
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
            b.type === 'guildhall'),
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
      creature.thought =
        hangout?.type === 'fountain_plaza'
          ? 'Admiring the shimmering starlight fountain'
          : hangout?.type === 'bakery'
            ? 'Savoring fresh warm acorn loaves'
            : hangout?.type === 'guildhall'
              ? 'Debating city blueprints at the guildhall'
              : hangout
                ? 'Sharing tales over berry cider'
                : 'Chatting with neighbors by the hearth';
      return;
    }

    // 7. Guard patrol or raid if at war
    if (creature.role === 'guard') {
      const enemySettlement = world.diplomacy.findWarTarget(home.id, world.settlements);
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
      creature.thought = `Patrolling the edges of ${home.name}`;
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

    let node = world.terrain.findNearestResource(creature.position2D, desiredTypes, 1.2);
    if (!node) {
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

    // Fallback wander
    const angle = world.rng.range(0, Math.PI * 2);
    const radius = world.rng.range(3, home.radius + 6);
    creature.targetX = home.center.x + Math.cos(angle) * radius;
    creature.targetZ = home.center.z + Math.sin(angle) * radius;
    creature.actionTimer = world.rng.range(5, 9);
    creature.thought = 'Exploring the sunlit glade';
  }

  private handleGathering(creature: Creature, world: WorldState, dt: number): void {
    const node = world.terrain.resourceNodes.find((n) => n.id === creature.targetResourceId);
    if (!node || node.amount < 0.5 || creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.targetResourceId = null;
      return;
    }

    const dist = Math.hypot(node.position.x - creature.x, node.position.z - creature.z);
    if (dist < 3.15) {
      const rate = 2.0 * (0.75 + creature.def.buildSkill * 0.5) * dt;
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
    const bld = home?.buildings.find((b) => b.id === creature.targetBuildingId);
    if (!home || !bld || bld.completed || creature.actionTimer <= 0) {
      creature.activity = 'idle';
      creature.targetBuildingId = null;
      return;
    }

    const dist = Math.hypot(bld.position.x - creature.x, bld.position.z - creature.z);
    const buildReach =
      getBuildingCollisionRadius(bld.type) + this.getCreatureRadius(creature) + 1.5;
    if (dist < buildReach) {
      // Once comfortably within hammering reach, settle and face the construction site
      if (dist < buildReach - 0.35) {
        creature.targetX = creature.x;
        creature.targetZ = creature.z;
        creature.heading = Math.atan2(bld.position.x - creature.x, bld.position.z - creature.z);
      }
      const work = dt * (11.0 + creature.def.buildSkill * 11.0);
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
        const nearby = world.creatures.find(
          (other) =>
            other.alive &&
            other.id !== creature.id &&
            Math.hypot(other.x - creature.x, other.z - creature.z) < 5.5,
        );
        if (nearby) {
          const sameFaction = nearby.settlementId === creature.settlementId;
          const compat =
            (creature.personality.friendliness + nearby.personality.friendliness) * 0.5 +
            (sameFaction ? 0.2 : -0.05);

          if (world.rng.chance(compat)) {
            const score = creature.adjustRelationship(nearby.id, 10);
            nearby.adjustRelationship(creature.id, 10);
            creature.thought = `Laughing with ${nearby.name}`;
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

  private handlePraying(creature: Creature, world: WorldState, dt: number): void {
    const dist = Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z);
    if (dist < 3.0) {
      creature.devotion = Math.min(100, creature.devotion + dt * 4.5);
      creature.mood = Math.min(100, creature.mood + dt * 2.2);
      world.deity.receivePrayer(dt * 0.9, creature.settlementId);
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
    const target = world.creatures.find((c) => c.id === creature.targetCreatureId && c.alive);
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
    if (
      creature.def.aerial ||
      world.terrain.isWalkable(creature.targetX, creature.targetZ, creature.def.amphibious)
    ) {
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
        if (world.terrain.isWalkable(safe.x, safe.z, creature.def.amphibious)) {
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
      if (world.terrain.isWalkable(px, pz, creature.def.amphibious)) {
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

    creature.activity = 'idle';
    creature.targetResourceId = null;
    creature.targetBuildingId = null;
    creature.targetCreatureId = null;
    creature.tradeDestinationSettlementId = null;
    creature.tradeCarrying = null;
    creature.tradeCargoAmount = 0;
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
        if (!creature.def.aerial && !world.terrain.isWalkable(cx, cz, creature.def.amphibious)) continue;

        // Verify midpoint is also walkable so the escape vector doesn't cross water
        const midX = creature.x + dx * (dist * 0.5);
        const midZ = creature.z + dz * (dist * 0.5);
        if (!creature.def.aerial && !world.terrain.isWalkable(midX, midZ, creature.def.amphibious)) continue;

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
    creature.actionTimer = bestScore > -Infinity ? 3.2 : 0.4;
    creature.thought = 'Finding a clearer woodland path';
  }

  private updateCreatureElevation(creature: Creature, world: WorldState): void {
    const groundY = world.terrain.getHeightAt(creature.x, creature.z);
    const surfaceY = Math.max(groundY, world.terrain.waterLevel);
    creature.y =
      (creature.def.amphibious ? Math.max(groundY, world.terrain.waterLevel - 0.08) : surfaceY) +
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

    // Query nearby creatures once for crowd courtesy & predictive passing
    this.queryNearbyCreatures(creature, creature.x, creature.z, 4.2, world, this.nearbyCreatures);

    const dx = creature.targetX - creature.x;
    const dz = creature.targetZ - creature.z;
    let dist = Math.hypot(dx, dz);

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
        const otherToTarget = Math.hypot(other.x - creature.targetX, other.z - creature.targetZ);
        if (otherToTarget < pairR + 0.1) {
          creature.targetX = creature.x;
          creature.targetZ = creature.z;
          dist = 0;
          break;
        }
      }
    }

    if (dist > 0.25) {
      const speedMult =
        creature.activity === 'fleeing'
          ? 1.35
          : creature.activity === 'fighting'
            ? 1.2
            : creature.activity === 'trading'
              ? 1.1
              : 1.0;

      const step = Math.min(dist, creature.def.baseSpeed * speedMult * dt);
      let dirX = dx / dist;
      let dirZ = dz / dist;
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
        if (!world.terrain.isWalkable(terrainProbeX, terrainProbeZ, creature.def.amphibious)) {
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

        const baseAngle = Math.atan2(baseDirZ, baseDirX);
        const prevDirX = Math.sin(creature.heading);
        const prevDirZ = Math.cos(creature.heading);

        let bestScore = -Infinity;
        let bestX = baseDirX;
        let bestZ = baseDirZ;
        let bestOffset = 0;
        let straightHazard = 0;

        for (let k = 0; k < STEER_OFFSETS.length; k++) {
          const offset = STEER_OFFSETS[k];
          const ang = baseAngle + offset;
          const cx = Math.cos(ang);
          const cz = Math.sin(ang);
          const probeStep = Math.max(step, 0.45);
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
            if (!world.terrain.isWalkable(nearProbeX, nearProbeZ, creature.def.amphibious)) {
              hazard += 7.0;
            }
            const midProbeX = creature.x + cx * Math.min(lookahead, 1.35);
            const midProbeZ = creature.z + cz * Math.min(lookahead, 1.35);
            if (!world.terrain.isWalkable(midProbeX, midProbeZ, creature.def.amphibious)) {
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
          const creatureLookahead = Math.min(lookahead, 2.4);
          for (let i = 0; i < this.nearbyCreatures.length; i++) {
            const other = this.nearbyCreatures[i];
            if (creature.activity === 'fighting' && other.id === creature.targetCreatureId) continue;

            const pairR = personalR + getCreaturePersonalRadius(other);
            const toOtherX = other.x - creature.x;
            const toOtherZ = other.z - creature.z;
            const dSq = toOtherX * toOtherX + toOtherZ * toOtherZ;
            const proj = toOtherX * cx + toOtherZ * cz;

            const probeDist = Math.hypot(nearProbeX - other.x, nearProbeZ - other.z);
            if (probeDist < pairR + 0.1) {
              hazard += 4.2 * (1 + (pairR + 0.1 - probeDist));
            }

            if (proj > 0 && proj < creatureLookahead + pairR) {
              const perpDist = Math.sqrt(Math.max(0, dSq - proj * proj));
              const clearMargin = pairR + 0.2;
              if (perpDist < clearMargin) {
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
      const nr = Math.hypot(nx, nz);
      if (nr > maxR && nr > 0.001) {
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

      if (
        creature.def.aerial ||
        world.terrain.isWalkable(nx, nz, creature.def.amphibious)
      ) {
        creature.x = nx;
        creature.z = nz;
      } else {
        // Detour around steep slopes or deep water (try perpendiculars, then wider back-out angles)
        const baseDirAng = Math.atan2(dirZ, dirX);
        const fallbackAngles = [Math.PI * 0.5, -Math.PI * 0.5, 2.2, -2.2, Math.PI];
        let moved = false;
        for (const off of fallbackAngles) {
          const ang = baseDirAng + off;
          const detourX = creature.x + Math.cos(ang) * step;
          const detourZ = creature.z + Math.sin(ang) * step;
          if (!world.terrain.isWalkable(detourX, detourZ, creature.def.amphibious)) continue;
          const altSep = world.obstacles.resolveCollisions(
            detourX,
            detourZ,
            creatureR,
            altitude,
            creature.heading,
          );
          if (world.terrain.isWalkable(altSep.x, altSep.z, creature.def.amphibious)) {
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
      if (dist > 1.0 && creature.activity !== 'fighting') {
        const postDist = Math.hypot(creature.targetX - creature.x, creature.targetZ - creature.z);
        if (creature.navBestGoalDist === Infinity) {
          creature.navBestGoalDist = postDist;
          creature.navProgressTimer = 0;
        } else if (postDist < creature.navBestGoalDist - 0.85) {
          creature.navBestGoalDist = postDist;
          creature.navProgressTimer = 0;
          creature.navLoopCount = 0;
        } else {
          creature.navProgressTimer += dt;
          if (creature.navProgressTimer >= 2.2) {
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
    const tryDisplace = (
      c: Creature,
      dx: number,
      dz: number,
    ): { applied: boolean; x: number; z: number } => {
      let nx = c.x + dx;
      let nz = c.z + dz;
      const nr = Math.hypot(nx, nz);
      if (nr > maxR && nr > 0.001) {
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
      if (!c.def.aerial && !world.terrain.isWalkable(sep.x, sep.z, c.def.amphibious)) {
        return { applied: false, x: c.x, z: c.z };
      }
      const movedSq = (sep.x - c.x) * (sep.x - c.x) + (sep.z - c.z) * (sep.z - c.z);
      return { applied: movedSq > 1e-6, x: sep.x, z: sep.z };
    };

    const movedSet = new Set<Creature>();

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

              const resA = tryDisplace(a, -ux * half, -uz * half);
              const resB = tryDisplace(b, ux * half, uz * half);

              if (resA.applied && resB.applied) {
                a.x = resA.x;
                a.z = resA.z;
                b.x = resB.x;
                b.z = resB.z;
                movedSet.add(a);
                movedSet.add(b);
                anySeparated = true;
              } else if (resA.applied && !resB.applied) {
                const fullA = tryDisplace(a, -ux * pen, -uz * pen);
                a.x = fullA.applied ? fullA.x : resA.x;
                a.z = fullA.applied ? fullA.z : resA.z;
                movedSet.add(a);
                anySeparated = true;
              } else if (!resA.applied && resB.applied) {
                const fullB = tryDisplace(b, ux * pen, uz * pen);
                b.x = fullB.applied ? fullB.x : resB.x;
                b.z = fullB.applied ? fullB.z : resB.z;
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
  }
}
