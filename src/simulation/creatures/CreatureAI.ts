import type { ResourceType } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import type { Creature } from './Creature';

/**
 * Autonomous utility-driven AI for anthropomorphic woodland creatures:
 * foraging, continuous city building, inter-settlement trading, tavern/square socialising,
 * shrine devotion, skirmish combat, and night-time resting.
 */
export class CreatureAI {
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
      this.chooseNextActivity(creature, world);
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
        creature.targetX = home.center.x + world.rng.range(-3, 3);
        creature.targetZ = home.center.z + world.rng.range(-3, 3);
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
      creature.targetX = chosenSite.position.x + world.rng.range(-1.9, 1.9);
      creature.targetZ = chosenSite.position.z + world.rng.range(-1.9, 1.9);
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
      creature.targetX = sacredSite.position.x + world.rng.range(-2.2, 2.2);
      creature.targetZ = sacredSite.position.z + world.rng.range(-2.2, 2.2);
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
      creature.targetX = (hangout ? hangout.position.x : home.center.x) + world.rng.range(-4, 4);
      creature.targetZ = (hangout ? hangout.position.z : home.center.z) + world.rng.range(-4, 4);
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
    if (dist < 2.6) {
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
    if (dist < 3.6) {
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

    creature.targetX = target.x;
    creature.targetZ = target.z;
    const dist = Math.hypot(target.x - creature.x, target.z - creature.z);

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
      creature.targetX = home.center.x;
      creature.targetZ = home.center.z;
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

  private moveCreature(creature: Creature, world: WorldState, dt: number): void {
    const dx = creature.targetX - creature.x;
    const dz = creature.targetZ - creature.z;
    const dist = Math.hypot(dx, dz);

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
      let nx = creature.x + (dx / dist) * step;
      let nz = creature.z + (dz / dist) * step;

      // Invisible circular valley boundary: smoothly steer inward rather than clipping a square wall
      const maxR = world.terrain.playableRadius;
      const nr = Math.hypot(nx, nz);
      if (nr > maxR && nr > 0.001) {
        nx = (nx / nr) * maxR;
        nz = (nz / nr) * maxR;
      }

      if (
        creature.def.aerial ||
        world.terrain.isWalkable(nx, nz, creature.def.amphibious)
      ) {
        creature.x = nx;
        creature.z = nz;
      } else {
        // Gentle detour around steep slopes or deep water
        const perpX = creature.x - (dz / dist) * step;
        const perpZ = creature.z + (dx / dist) * step;
        if (world.terrain.isWalkable(perpX, perpZ, creature.def.amphibious)) {
          creature.x = perpX;
          creature.z = perpZ;
        } else {
          creature.targetX = creature.x;
          creature.targetZ = creature.z;
        }
      }

      creature.heading = Math.atan2(dx, dz);
      creature.animPhase += dt * (creature.def.baseSpeed * 2.4);

      if (creature.def.aerial) {
        const targetAlt = dist > 5 ? 2.4 + Math.sin(creature.animPhase * 0.4) * 0.5 : 0.2;
        creature.flightAltitude += (targetAlt - creature.flightAltitude) * Math.min(1, dt * 3.5);
      }
    } else if (creature.def.aerial) {
      creature.flightAltitude += (0 - creature.flightAltitude) * Math.min(1, dt * 4.5);
    }

    const groundY = world.terrain.getHeightAt(creature.x, creature.z);
    const surfaceY = Math.max(groundY, world.terrain.waterLevel);
    creature.y =
      (creature.def.amphibious ? Math.max(groundY, world.terrain.waterLevel - 0.08) : surfaceY) +
      creature.flightAltitude;
  }
}
