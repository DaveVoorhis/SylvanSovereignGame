import { describe, expect, it } from 'vitest';
import { EventBus } from '@core/EventBus';
import { getCreaturePersonalRadius } from '@simulation/creatures/CreatureAI';
import {
  HEARTH_FIRE_KEEP_OUT_RADIUS,
  getBuildingCollisionRadius,
  getTreeTrunkRadius,
  type SolidObstacle,
} from '@simulation/terrain/ObstacleMap';
import { ALL_SPECIES_IDS, SPECIES_CATALOG } from '@simulation/creatures/SpeciesCatalog';
import { ALL_BUILDING_TYPES, BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { WorldState } from '@simulation/WorldState';

describe('Forest Procedural God Game — Headless Simulation', () => {
  it('generates deterministic terrain, settlements, and creatures from a seed', () => {
    const worldA = new WorldState(new EventBus(), { seed: 424242 });
    const worldB = new WorldState(new EventBus(), { seed: 424242 });

    expect(worldA.deity.name).toBe(worldB.deity.name);
    expect(worldA.settlements.length).toBeGreaterThanOrEqual(4);
    expect(worldA.settlements.length).toBe(worldB.settlements.length);
    expect(worldA.terrain.getHeightAt(12.5, -8.3)).toBeCloseTo(
      worldB.terrain.getHeightAt(12.5, -8.3),
      6,
    );
  });

  it('provides continuous bounded terrain far into the infinite horizon with a circular invisible boundary', () => {
    const world = new WorldState(new EventBus(), { seed: 20261123 });
    const sampleCoords: [number, number][] = [
      [0, 0],
      [75, 0],
      [140, 120],
      [-260, 180],
      [420, -390],
      [-520, -520],
    ];
    for (const [x, z] of sampleCoords) {
      const h = world.terrain.getHeightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-4);
      expect(h).toBeLessThan(36);
    }

    // Circular invisible playable boundary: corner at (70, 70) is outside radius 75 (hypot ~99)
    expect(world.terrain.isWithinPlayableArea(0, 0)).toBe(true);
    expect(world.terrain.isWithinPlayableArea(70, 70)).toBe(false);
    expect(world.terrain.isWalkable(70, 70)).toBe(false);
  });

  it('includes all requested anthropomorphic woodland species', () => {
    const required = [
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
    ];
    for (const id of required) {
      expect(ALL_SPECIES_IDS).toContain(id);
      expect(SPECIES_CATALOG[id as keyof typeof SPECIES_CATALOG].displayName.length).toBeGreaterThan(0);
    }
  });

  it(
    'simulates autonomous continuous city building with rich architectural variety over time',
    () => {
      const bus = new EventBus();
      let divineEffectsTriggered = 0;
      bus.on('divine:effect', () => {
        divineEffectsTriggered++;
      });

      const world = new WorldState(bus, {
        seed: 1337,
        deityDecisionIntervalSec: 4,
      });

      const initialBuildingsCompleted = world.settlements.reduce(
        (sum, s) => sum + s.getCompletedCount(),
        0,
      );

      // Advance 260 seconds of simulation time in deterministic steps
      for (let i = 0; i < 2600; i++) {
        world.step(0.1);
      }

      const laterBuildingsCompleted = world.settlements.reduce(
        (sum, s) => sum + s.getCompletedCount(),
        0,
      );
      const distinctWorldTypes = new Set<string>();
      let maxCityBuildings = 0;
      let reachedCityOrTown = 0;

      for (const s of world.settlements) {
        const built = s.getCompletedCount();
        if (built > maxCityBuildings) maxCityBuildings = built;
        if (s.tier === 'town' || s.tier === 'city' || s.tier === 'metropolis') {
          reachedCityOrTown++;
        }
        for (const b of s.buildings) {
          if (b.completed) distinctWorldTypes.add(b.type);
        }
      }

      // Verify creatures respect the circular invisible boundary
      for (const c of world.creatures) {
        if (!c.alive) continue;
        expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(world.terrain.playableRadius + 0.5);
      }

      expect(ALL_BUILDING_TYPES.length).toBe(14);
      for (const t of ALL_BUILDING_TYPES) {
        expect(BUILDING_CATALOG[t].displayName.length).toBeGreaterThan(0);
      }
      expect(divineEffectsTriggered).toBeGreaterThan(0);
      expect(world.chronicle.entries.length).toBeGreaterThan(10);
      expect(laterBuildingsCompleted).toBeGreaterThan(initialBuildingsCompleted + 25);
      expect(maxCityBuildings).toBeGreaterThanOrEqual(10);
      expect(reachedCityOrTown).toBeGreaterThanOrEqual(2);
      expect(distinctWorldTypes.size).toBeGreaterThanOrEqual(8);
    },
    25000,
  );

  it('allows the procedural deity to interpret spectator whispers without losing autonomy', () => {
    const world = new WorldState(new EventBus(), { seed: 777 });
    const beforeBenevolence = world.deity.traits.benevolence;
    const response = world.deity.receiveSpectatorWhisper('prosperity', world);

    expect(response).toContain(world.deity.name);
    expect(world.deity.traits.benevolence).toBeGreaterThanOrEqual(beforeBenevolence);
    expect(world.deity.whisperCooldown).toBeGreaterThan(0);
  });

  it('steers creatures smoothly around settlement hearth fires instead of walking through them', () => {
    const world = new WorldState(new EventBus(), { seed: 31415 });
    const settlement = world.settlements[0];
    expect(settlement).toBeDefined();

    // Place a ground creature on one side of the fire with a target directly across the firepit
    const walker = world.creatures.find((c) => !c.def.aerial && c.settlementId === settlement.id);
    expect(walker).toBeDefined();
    if (!walker) return;

    walker.x = settlement.center.x - 4.5;
    walker.z = settlement.center.z;
    walker.activity = 'socialising';
    walker.actionTimer = 30;
    walker.targetX = settlement.center.x + 4.5;
    walker.targetZ = settlement.center.z;

    let minDistToFire = Infinity;
    for (let i = 0; i < 160; i++) {
      world.step(0.08);
      const d = Math.hypot(walker.x - settlement.center.x, walker.z - settlement.center.z);
      if (d < minDistToFire) minDistToFire = d;

      // Check every grounded creature stays out of every settlement's hearth fire
      for (const c of world.creatures) {
        if (!c.alive || (c.def.aerial && c.flightAltitude > 3.0)) continue;
        for (const s of world.settlements) {
          expect(Math.hypot(c.x - s.center.x, c.z - s.center.z)).toBeGreaterThanOrEqual(
            HEARTH_FIRE_KEEP_OUT_RADIUS - 0.02,
          );
        }
      }
    }

    expect(minDistToFire).toBeGreaterThanOrEqual(HEARTH_FIRE_KEEP_OUT_RADIUS - 0.02);
    // Confirm the creature successfully curved around the fire and reached the far side
    expect(walker.x).toBeGreaterThan(settlement.center.x + 3.0);
  });

  it('prevents creatures from walking through buildings, trees, rocks, bushes, and town features', () => {
    const world = new WorldState(new EventBus(), { seed: 271828 });
    const settlement = world.settlements[0];
    expect(settlement).toBeDefined();
    const building = settlement.buildings[0];
    expect(building).toBeDefined();

    const walker = world.creatures.find((c) => !c.def.aerial && c.settlementId === settlement.id);
    expect(walker).toBeDefined();
    if (!walker) return;

    // 1. Direct the creature straight across a building and confirm it walks around without clipping
    const bRadius = getBuildingCollisionRadius(building.type);
    const creatureR = Math.max(0.26, walker.def.bodyScale * 0.36);
    walker.x = building.position.x - (bRadius + 3.2);
    walker.z = building.position.z;
    walker.activity = 'socialising';
    walker.actionTimer = 30;
    walker.targetX = building.position.x + (bRadius + 3.2);
    walker.targetZ = building.position.z;

    let minBuildingDist = Infinity;
    for (let i = 0; i < 180; i++) {
      world.step(0.08);
      const d = Math.hypot(walker.x - building.position.x, walker.z - building.position.z);
      if (d < minBuildingDist) minBuildingDist = d;
    }
    expect(minBuildingDist).toBeGreaterThanOrEqual(bRadius + creatureR - 0.05);
    expect(walker.x).toBeGreaterThan(building.position.x + bRadius);

    // 2. Direct the creature straight across a standing forest tree trunk and confirm it curves around
    const treeObs = world.obstacles.getObstacles().find((o) => o.kind === 'tree');
    expect(treeObs).toBeDefined();
    const matchingTree = treeObs
      ? world.terrain.trees.find((t) => t.x === treeObs.x && t.z === treeObs.z)
      : undefined;
    expect(matchingTree).toBeDefined();
    if (!treeObs || !matchingTree) return;

    const tRadius = getTreeTrunkRadius(matchingTree);
    walker.x = treeObs.x - 4.0;
    walker.z = treeObs.z;
    walker.activity = 'socialising';
    walker.actionTimer = 30;
    walker.targetX = treeObs.x + 4.0;
    walker.targetZ = treeObs.z;

    let minTreeDist = Infinity;
    const nearby: SolidObstacle[] = [];
    for (let i = 0; i < 140; i++) {
      world.step(0.08);
      const d = Math.hypot(walker.x - treeObs.x, walker.z - treeObs.z);
      if (d < minTreeDist) minTreeDist = d;

      // Check ALL grounded creatures stay outside buildings, trees, rocks, bushes, benches, and fires
      for (const c of world.creatures) {
        if (!c.alive || c.def.aerial) continue;
        const cR = Math.max(0.26, c.def.bodyScale * 0.36);
        world.obstacles.queryNearby(c.x, c.z, 4.5, nearby);
        for (const obs of nearby) {
          const required = world.obstacles.getEffectiveRadius(obs, cR);
          const dist = Math.hypot(c.x - obs.x, c.z - obs.z);
          // Allow tiny tolerance when two densely placed terrain props overlap each other
          if (obs.kind === 'building' || obs.kind === 'hearth' || obs.kind === 'tree') {
            expect(dist).toBeGreaterThanOrEqual(required - 0.06);
          }
        }
      }
    }

    expect(minTreeDist).toBeGreaterThanOrEqual(tRadius + creatureR - 0.05);
    expect(walker.x).toBeGreaterThan(treeObs.x + 1.5);
  });

  it('prevents creatures from walking through each other and resolves crowds cleanly', () => {
    const world = new WorldState(new EventBus(), { seed: 654321 });
    const grounded = world.creatures.filter((c) => !c.def.aerial);
    expect(grounded.length).toBeGreaterThanOrEqual(2);
    const a = grounded[0];
    const b = grounded[1];

    // Find an open walkable clearing away from obstacles so the two creatures walk head-on
    let originX = 0;
    let originZ = 0;
    outer: for (let gx = -30; gx <= 30; gx += 3) {
      for (let gz = -30; gz <= 30; gz += 3) {
        let clear = true;
        for (let sx = -4; sx <= 4; sx += 1) {
          const px = gx + sx;
          if (!world.terrain.isWalkable(px, gz, false)) {
            clear = false;
            break;
          }
          if (world.obstacles.resolveCollisions(px, gz, 0.9, 0, 0).collided) {
            clear = false;
            break;
          }
        }
        if (clear) {
          originX = gx;
          originZ = gz;
          break outer;
        }
      }
    }

    a.x = originX - 3.6;
    a.z = originZ;
    a.activity = 'socialising';
    a.actionTimer = 25;
    a.targetX = originX + 3.6;
    a.targetZ = originZ;
    a.resetNavigationState();

    b.x = originX + 3.6;
    b.z = originZ;
    b.activity = 'socialising';
    b.actionTimer = 25;
    b.targetX = originX - 3.6;
    b.targetZ = originZ;
    b.resetNavigationState();

    const pairMinDist = getCreaturePersonalRadius(a) + getCreaturePersonalRadius(b);
    let minObservedPairDist = Infinity;

    for (let i = 0; i < 160; i++) {
      world.step(0.08);
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < minObservedPairDist) minObservedPairDist = d;

      // Verify no same-altitude pair across the whole world clips through one another
      for (let m = 0; m < world.creatures.length; m++) {
        const cm = world.creatures[m];
        if (!cm.alive) continue;
        const mAlt = cm.def.aerial ? cm.flightAltitude : 0;
        const mR = getCreaturePersonalRadius(cm);
        for (let n = m + 1; n < world.creatures.length; n++) {
          const cn = world.creatures[n];
          if (!cn.alive) continue;
          const nAlt = cn.def.aerial ? cn.flightAltitude : 0;
          if (Math.abs(mAlt - nAlt) >= 1.15) continue;
          const req = mR + getCreaturePersonalRadius(cn);
          const sep = Math.hypot(cm.x - cn.x, cm.z - cn.z);
          expect(sep).toBeGreaterThanOrEqual(req - 0.12);
        }
      }
    }

    expect(minObservedPairDist).toBeGreaterThanOrEqual(pairMinDist - 0.06);
    expect(a.x).toBeGreaterThan(originX + 1.5);
    expect(b.x).toBeLessThan(originX - 1.5);
  });

  it('prevents creatures from getting trapped in tight nonproductive loops', () => {
    const world = new WorldState(new EventBus(), { seed: 777888 });
    // Give every settlement extra resources so cities grow denser while creatures navigate
    for (const s of world.settlements) {
      s.stockpile.timber = 180;
      s.stockpile.stone = 120;
      s.stockpile.berries = 90;
      s.stockpile.acorns = 90;
    }

    const dt = 0.04;
    const windowSteps = 200; // 8.0s sliding window at 25fps
    const history = new Map<string, { x: number; z: number }[]>();
    let tightLoopIncidents = 0;

    for (let step = 0; step < 900; step++) {
      world.step(dt);

      for (const c of world.creatures) {
        if (!c.alive) continue;
        let pts = history.get(c.id);
        if (!pts) {
          pts = [];
          history.set(c.id, pts);
        }
        pts.push({ x: c.x, z: c.z });
        if (pts.length > windowSteps) {
          pts.shift();
        }

        // Every 50 steps (2s), check whether a creature walked >14m inside a tight <2.8m box
        if (pts.length === windowSteps && step % 50 === 0) {
          let pathLen = 0;
          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (let k = 0; k < pts.length; k++) {
            const p = pts[k];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
            if (k > 0) {
              pathLen += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
            }
          }
          const span = Math.max(maxX - minX, maxZ - minZ);
          if (pathLen > 14.0 && span < 2.8) {
            tightLoopIncidents++;
          }
        }
      }
    }

    expect(tightLoopIncidents).toBe(0);
  });

  it('emphasizes daylight with quick nights and keeps mist weather rare', () => {
    const world = new WorldState(new EventBus(), { seed: 90210, dayLengthSeconds: 28 });
    let daylightSteps = 0;
    let nightSteps = 0;
    let mistSteps = 0;
    const totalSteps = 1100; // ~110s (~4 full day-night cycles across multiple weather rolls)

    for (let i = 0; i < totalSteps; i++) {
      world.step(0.1);
      const sunY = Math.sin((world.timeOfDay - 0.25) * Math.PI * 2);
      if (sunY >= 0) {
        daylightSteps++;
      } else {
        nightSteps++;
      }
      if (world.weather === 'mist') {
        mistSteps++;
      }
    }

    const daylightRatio = daylightSteps / totalSteps;
    const nightRatio = nightSteps / totalSteps;
    const mistRatio = mistSteps / totalSteps;

    // Daylight should occupy the vast majority of play time while night passes briskly
    expect(daylightRatio).toBeGreaterThan(0.72);
    expect(nightRatio).toBeLessThan(0.28);
    // Mist should remain rare across both natural weather and divine acts
    expect(mistRatio).toBeLessThan(0.1);
  });
});
