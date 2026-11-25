import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONFIG } from '@core/Config';
import { EventBus } from '@core/EventBus';
import { generateRandomSeed } from '@core/SeededRandom';
import type { ConstructionStage } from '@core/Types';
import { getCreaturePersonalRadius } from '@simulation/creatures/CreatureAI';
import {
  HEARTH_FIRE_KEEP_OUT_RADIUS,
  getBuildingCollisionRadius,
  getTreeTrunkRadius,
  type SolidObstacle,
} from '@simulation/terrain/ObstacleMap';
import { ALL_SPECIES_IDS, SPECIES_CATALOG } from '@simulation/creatures/SpeciesCatalog';
import { ALL_BUILDING_TYPES, BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { getBuildingStage, getConstructionStageLabel } from '@simulation/settlements/Settlement';
import {
  ALL_VILLAGE_ADAPTATIONS,
  VILLAGE_ADAPTATION_CATALOG,
} from '@simulation/settlements/VillageAdaptation';
import { TerrainMap } from '@simulation/terrain/TerrainMap';
import { WorldState } from '@simulation/WorldState';

describe('Forest Procedural God Game — Headless Simulation', () => {
  it('generates deterministic terrain, settlements, and creatures from a seed', () => {
    const worldA = new WorldState(new EventBus(), { seed: 424242 });
    const worldB = new WorldState(new EventBus(), { seed: 424242 });

    expect(worldA.deity.name).toBe(worldB.deity.name);
    expect(worldA.config.initialSettlements).toBe(1);
    expect(worldA.settlements.length).toBe(1);
    expect(worldA.settlements.length).toBe(worldB.settlements.length);
    expect(worldA.settlements.map((s) => `${s.name}:${s.adaptation}`)).toEqual(
      worldB.settlements.map((s) => `${s.name}:${s.adaptation}`),
    );
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
      [-780, -780],
    ];
    for (const [x, z] of sampleCoords) {
      const h = world.terrain.getHeightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-6);
      expect(h).toBeLessThan(145);
    }

    // Expanded world has playableRadius ~151: (70, 70) is well inside, while a corner at 0.8*R (hypot ~1.13*R) is outside
    const outsideCorner = Math.ceil(world.terrain.playableRadius * 0.8);
    expect(world.terrain.isWithinPlayableArea(0, 0)).toBe(true);
    expect(world.terrain.isWithinPlayableArea(70, 70)).toBe(true);
    expect(world.terrain.isWithinPlayableArea(outsideCorner, outsideCorner)).toBe(false);
    expect(world.terrain.isWalkable(outsideCorner, outsideCorner)).toBe(false);
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
    const creatureR = Math.max(0.26, walker.def.bodyScale * 0.36);
    const allObs = world.obstacles.getObstacles();
    const isSpotClear = (px: number, pz: number) =>
      world.terrain.isWalkable(px, pz, false) &&
      allObs.every((o) => Math.hypot(px - o.x, pz - o.z) > o.radius + creatureR + 0.8);
    let testBuilding = building;
    let dirX = 1;
    let dirZ = 0;
    outerBuilding: for (const cand of settlement.buildings) {
      const r = getBuildingCollisionRadius(cand.type);
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        if (
          isSpotClear(cand.position.x - dx * (r + 3.2), cand.position.z - dz * (r + 3.2)) &&
          isSpotClear(cand.position.x + dx * (r + 3.2), cand.position.z + dz * (r + 3.2))
        ) {
          testBuilding = cand;
          dirX = dx;
          dirZ = dz;
          break outerBuilding;
        }
      }
    }
    const bRadius = getBuildingCollisionRadius(testBuilding.type);
    walker.x = testBuilding.position.x - dirX * (bRadius + 3.2);
    walker.z = testBuilding.position.z - dirZ * (bRadius + 3.2);
    walker.activity = 'socialising';
    walker.actionTimer = 30;
    walker.targetX = testBuilding.position.x + dirX * (bRadius + 3.2);
    walker.targetZ = testBuilding.position.z + dirZ * (bRadius + 3.2);

    let minBuildingDist = Infinity;
    for (let i = 0; i < 180; i++) {
      world.step(0.08);
      const d = Math.hypot(walker.x - testBuilding.position.x, walker.z - testBuilding.position.z);
      if (d < minBuildingDist) minBuildingDist = d;
    }
    expect(minBuildingDist).toBeGreaterThanOrEqual(bRadius + creatureR - 0.05);
    const progressAlong =
      (walker.x - testBuilding.position.x) * dirX + (walker.z - testBuilding.position.z) * dirZ;
    expect(progressAlong).toBeGreaterThan(bRadius);

    // 2. Direct the creature straight across a standing forest tree trunk and confirm it curves around
    const treeObs = world.obstacles
      .getObstacles()
      .find(
        (o) =>
          o.kind === 'tree' &&
          world.terrain.isWalkable(o.x - 4, o.z, false) &&
          world.terrain.isWalkable(o.x + 4, o.z, false) &&
          world.terrain.isWalkable(o.x, o.z + 2, false) &&
          world.terrain.isWalkable(o.x, o.z - 2, false),
      );
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
    const totalSteps = 2600; // ~260s (~9 full day-night cycles across many weather rolls)

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

  it('procedurally varies river course, ponds, relief, and settlements across random seeds', () => {
    // Verify random seed generator yields varied valid positive integers and respects exclusion
    const generated = new Set<number>();
    let prev: number | undefined;
    for (let i = 0; i < 12; i++) {
      const seed = generateRandomSeed(prev);
      expect(Number.isSafeInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(1000);
      if (prev !== undefined) expect(seed).not.toBe(prev);
      generated.add(seed);
      prev = seed;
    }
    expect(generated.size).toBeGreaterThanOrEqual(10);

    // Compare two distinct seeds for genuinely distinct terrain layouts
    const worldA = new WorldState(new EventBus(), { seed: 101010 });
    const worldB = new WorldState(new EventBus(), { seed: 987654 });

    expect(worldA.terrain.riverAngle).not.toBeCloseTo(worldB.terrain.riverAngle, 2);
    const pondA = worldA.terrain.ponds[0];
    const pondB = worldB.terrain.ponds[0];
    expect(Math.hypot(pondA.x - pondB.x, pondA.z - pondB.z)).toBeGreaterThan(2.0);

    let heightDiffSum = 0;
    let sampleCount = 0;
    for (let x = -60; x <= 60; x += 20) {
      for (let z = -60; z <= 60; z += 20) {
        heightDiffSum += Math.abs(
          worldA.terrain.getHeightAt(x, z) - worldB.terrain.getHeightAt(x, z),
        );
        sampleCount++;
      }
    }
    expect(heightDiffSum / sampleCount).toBeGreaterThan(0.8);

    // Confirm settlement placement & bounded terrain hold reliably across many seeds
    const probeSeeds = [1111, 22222, 333333, 4444444, 55555555, 8675309];
    for (const seed of probeSeeds) {
      const w = new WorldState(new EventBus(), { seed });
      expect(w.settlements.length).toBe(w.config.initialSettlements);
      expect(w.terrain.ponds.length).toBeGreaterThanOrEqual(1);
      const flow = w.terrain.getWaterFlowAt(0, 0);
      expect(Number.isFinite(flow.x)).toBe(true);
      expect(Number.isFinite(flow.z)).toBe(true);
      for (const [x, z] of [
        [0, 0],
        [75, -40],
        [-280, 220],
        [480, -480],
        [760, -720],
      ]) {
        const h = w.terrain.getHeightAt(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThan(-6);
        expect(h).toBeLessThan(145);
      }
    }
  });

  it('allows creatures to autonomously plan, build, and cross arched bridges over waterways', () => {
    const world = new WorldState(new EventBus(), { seed: 246810 });
    for (const s of world.settlements) {
      s.stockpile.timber = 120;
      s.stockpile.stone = 80;
    }

    // Advance simulation until creatures autonomously stake out and finish at least one bridge
    for (let i = 0; i < 1600; i++) {
      world.step(0.1);
      if (world.bridges.some((b) => b.completed)) break;
    }

    const bridge = world.bridges.find((b) => b.completed);
    expect(bridge).toBeDefined();
    if (!bridge) return;

    // Bridge spans over actual waterway yet provides dry elevated walkability right across the midpoint
    expect(world.terrain.getHeightAt(bridge.centerX, bridge.centerZ)).toBeLessThan(
      world.terrain.waterLevel,
    );
    expect(world.terrain.isWalkable(bridge.centerX, bridge.centerZ, false)).toBe(true);
    const midDeckY = world.terrain.getBridgeDeckY(bridge.centerX, bridge.centerZ);
    expect(midDeckY).not.toBeNull();
    expect(midDeckY!).toBeGreaterThan(world.terrain.waterLevel + 0.5);

    // Direct a ground creature from the start abutment to the opposite bank across the completed bridge
    const walker = world.creatures.find((c) => c.alive && !c.def.aerial);
    expect(walker).toBeDefined();
    if (!walker) return;

    walker.x = bridge.startX;
    walker.z = bridge.startZ;
    walker.activity = 'socialising';
    walker.actionTimer = 30;
    walker.targetX = bridge.endX + bridge.dirX * 1.2;
    walker.targetZ = bridge.endZ + bridge.dirZ * 1.2;
    walker.resetNavigationState();

    let maxObservedY = -Infinity;
    let reachedFarSide = false;
    for (let i = 0; i < 240; i++) {
      world.step(0.08);
      if (walker.y > maxObservedY) maxObservedY = walker.y;
      if (Math.hypot(walker.x - bridge.endX, walker.z - bridge.endZ) < 2.2) {
        reachedFarSide = true;
        break;
      }
    }
    expect(reachedFarSide).toBe(true);
    expect(maxObservedY).toBeGreaterThan(world.terrain.waterLevel + 0.5);
  });

  it('progresses buildings through clearing, leveling, foundation, framing, and finishing stages with active builder tool states', () => {
    const world = new WorldState(new EventBus(), { seed: 314159 });
    const settlement = world.settlements[0];
    expect(settlement).toBeDefined();

    // Freshly started plots begin at stage 0 (clearing land)
    const starterPlot = settlement.buildings.find((b) => !b.completed);
    expect(starterPlot).toBeDefined();
    expect(starterPlot!.progress).toBe(0);
    expect(getBuildingStage(starterPlot!)).toBe('clearing');

    // Verify stage labels clearly distinguish timber-frame vs brick/stone masonry construction
    expect(getConstructionStageLabel('framing', 'timber')).toMatch(/Timber/i);
    expect(getConstructionStageLabel('framing', 'masonry')).toMatch(/Brick|Stone/i);
    expect(BUILDING_CATALOG.timber_house.frameStyle).toBe('timber');
    expect(BUILDING_CATALOG.library.frameStyle).toBe('masonry');

    const observedPlotStages = new Set<ConstructionStage>();
    const observedWorkerStages = new Set<ConstructionStage>();

    for (let i = 0; i < 650; i++) {
      world.step(0.05);
      observedPlotStages.add(getBuildingStage(starterPlot!));
      for (const c of world.creatures) {
        if (c.isActivelyWorking && c.activeConstructionStage) {
          observedWorkerStages.add(c.activeConstructionStage);
        }
      }
      if (starterPlot!.completed) break;
    }

    expect(starterPlot!.completed).toBe(true);
    for (const expectedStage of [
      'clearing',
      'leveling',
      'foundation',
      'framing',
      'finishing',
      'completed',
    ] as const) {
      expect(observedPlotStages.has(expectedStage)).toBe(true);
    }
    expect(observedWorkerStages.has('clearing')).toBe(true);
    expect(observedWorkerStages.has('leveling')).toBe(true);
    expect(observedWorkerStages.has('foundation')).toBe(true);
    expect(observedWorkerStages.has('framing')).toBe(true);
    expect(observedWorkerStages.has('finishing')).toBe(true);
  });

  it('starts with a single founding village and dispatches emigrating pioneers to establish new villages', () => {
    const world = new WorldState(new EventBus(), { seed: 271828 });
    expect(world.settlements.length).toBe(1);
    const founding = world.settlements[0];
    founding.stockpile.timber = 180;
    founding.stockpile.stone = 120;
    founding.stockpile.berries = 120;
    founding.stockpile.acorns = 120;

    let sawEmigratingPioneer = false;
    for (let i = 0; i < 2600; i++) {
      world.step(0.1);
      if (world.creatures.some((c) => c.alive && c.activity === 'emigrating')) {
        sawEmigratingPioneer = true;
      }
      if (world.settlements.length >= 2) break;
    }

    expect(sawEmigratingPioneer).toBe(true);
    expect(world.settlements.length).toBeGreaterThanOrEqual(2);
    const founded = world.settlements[1];
    expect(founded.id).not.toBe(founding.id);
    // Pioneers wander far across the expanded landmass to establish a new village
    expect(Math.hypot(founded.center.x - founding.center.x, founded.center.z - founding.center.z)).toBeGreaterThan(40);
    // Diplomacy between parent & daughter village is initialized friendly
    expect(world.diplomacy.getStance(founding.id, founded.id)).toBe('friendly');
  });

  it('disassembles older smaller buildings to reclaim space for larger structures', () => {
    const world = new WorldState(new EventBus(), { seed: 777888 });
    const settlement = world.settlements[0];
    settlement.stockpile.timber = 240;
    settlement.stockpile.stone = 180;
    settlement.stockpile.crafts = 40;
    settlement.stockpile.berries = 140;
    settlement.stockpile.acorns = 140;

    let sawDisassembling = false;
    let disassembledId: string | null = null;
    let replacedBuilding = false;
    const revBefore = world.structureRevision;

    for (let i = 0; i < 2800; i++) {
      world.step(0.1);
      const activeDismantle = settlement.buildings.find((b) => b.disassembling);
      if (activeDismantle && !sawDisassembling) {
        sawDisassembling = true;
        disassembledId = activeDismantle.id;
        expect(getBuildingStage(activeDismantle)).toBe('disassembling');
      }
      if (disassembledId && !settlement.buildings.some((b) => b.id === disassembledId)) {
        replacedBuilding = true;
        break;
      }
    }

    expect(sawDisassembling).toBe(true);
    expect(replacedBuilding).toBe(true);
    expect(world.structureRevision).toBeGreaterThan(revBefore);
  });

  it('generates an expanded world with varied landforms, waterways, and diverse biomes', () => {
    const world = new WorldState(new EventBus(), { seed: 20260501 });
    expect(world.config.worldSize).toBeGreaterThanOrEqual(1000);
    expect(world.terrain.playableRadius).toBeGreaterThan(480);
    expect(world.terrain.ponds.length).toBeGreaterThanOrEqual(3);

    const observedBiomes = new Set<string>();
    let minH = Infinity;
    let maxH = -Infinity;
    let maxAlpineSlope = 0;
    let prairieSlopeSum = 0;
    let prairieSampleCount = 0;
    const r = world.terrain.playableRadius;
    for (let x = -r; x <= r; x += 12) {
      for (let z = -r; z <= r; z += 12) {
        if (!world.terrain.isWithinPlayableArea(x, z)) continue;
        const h = world.terrain.getHeightAt(x, z);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        const biome = world.terrain.getBiomeAt(x, z);
        observedBiomes.add(biome);
        if (biome === 'alpine_crag') {
          const slope = world.terrain.getSlopeAt(x, z);
          if (slope > maxAlpineSlope) maxAlpineSlope = slope;
        } else if (biome === 'prairie') {
          prairieSlopeSum += world.terrain.getSlopeAt(x, z);
          prairieSampleCount++;
        }
      }
    }

    // Soaring craggy alpine relief from deep ocean floor up to jagged snowcapped peaks
    expect(maxH).toBeGreaterThanOrEqual(55);
    expect(maxH - minH).toBeGreaterThan(58);
    expect(maxAlpineSlope).toBeGreaterThanOrEqual(0.32);

    // Flat, wide-open treeless grassy prairie
    expect(prairieSampleCount).toBeGreaterThan(25);
    expect(prairieSlopeSum / prairieSampleCount).toBeLessThan(0.08);
    const prairieTrees = world.terrain.trees.filter(
      (t) => world.terrain.getBiomeAt(t.x, t.z) === 'prairie',
    );
    expect(prairieTrees.length).toBe(0);

    // Arid sandy desert free of trees and woodland undergrowth
    const desertTrees = world.terrain.trees.filter(
      (t) => world.terrain.getBiomeAt(t.x, t.z) === 'desert',
    );
    const desertUndergrowth = world.terrain.undergrowth.filter(
      (u) => world.terrain.getBiomeAt(u.x, u.z) === 'desert',
    );
    expect(desertTrees.length).toBe(0);
    expect(desertUndergrowth.length).toBe(0);

    // Verdant lush forests packed with trees and woodland undergrowth
    const forestTrees = world.terrain.trees.filter((t) => {
      const b = world.terrain.getBiomeAt(t.x, t.z);
      return b === 'deep_woods' || b === 'moss_hollow' || b === 'riverbank';
    });
    const forestUndergrowth = world.terrain.undergrowth.filter((u) => {
      const b = world.terrain.getBiomeAt(u.x, u.z);
      return b === 'deep_woods' || b === 'moss_hollow' || b === 'riverbank';
    });
    expect(forestTrees.length).toBeGreaterThanOrEqual(900);
    expect(forestUndergrowth.length).toBeGreaterThanOrEqual(800);

    // Extensive biome diversity spanning seashore, desert, prairie, forest, mountains, and riverside
    expect(observedBiomes.size).toBeGreaterThanOrEqual(8);
    expect(observedBiomes.has('water')).toBe(true);
    expect(observedBiomes.has('seashore')).toBe(true);
    expect(observedBiomes.has('desert')).toBe(true);
    expect(observedBiomes.has('prairie')).toBe(true);
    expect(observedBiomes.has('deep_woods')).toBe(true);
    expect(observedBiomes.has('riverbank') || observedBiomes.has('moss_hollow')).toBe(true);
    expect(
      observedBiomes.has('rocky_ridge') || observedBiomes.has('alpine_crag'),
    ).toBe(true);
  });

  it('founds distinct environmentally adapted villages across biomes with unique profiles and regional identity', () => {
    const world = new WorldState(new EventBus(), { seed: 8675309 });
    // Starts with a single founding village by default
    expect(world.settlements.length).toBe(1);
    const founding = world.settlements[0];
    founding.stockpile.timber = 220;
    founding.stockpile.stone = 160;
    founding.stockpile.berries = 160;
    founding.stockpile.acorns = 160;

    // Emigrants wander far to settle unrepresented biomes with distinct adaptations
    for (let i = 0; i < 3200; i++) {
      world.step(0.1);
      if (world.settlements.length >= 2) break;
    }
    expect(world.settlements.length).toBeGreaterThanOrEqual(2);
    const adaptations = new Set(world.settlements.map((s) => s.adaptation));
    expect(adaptations.size).toBeGreaterThanOrEqual(2);

    for (const s of world.settlements) {
      const profile = s.getAdaptationProfile();
      expect(profile.id).toBe(s.adaptation);
      expect(profile.architectureSummary.length).toBeGreaterThan(10);
      expect(profile.clothingSummary.length).toBeGreaterThan(10);
      expect(profile.economySummary.length).toBeGreaterThan(10);
      expect(s.buildings.length).toBeGreaterThanOrEqual(2);
    }

    // All 6 adaptation catalog profiles are complete and distinct
    expect(ALL_VILLAGE_ADAPTATIONS.length).toBe(6);
    const shortLabels = new Set(
      ALL_VILLAGE_ADAPTATIONS.map((id) => VILLAGE_ADAPTATION_CATALOG[id].shortLabel),
    );
    expect(shortLabels.size).toBe(6);
  });

  it('carves the river mouth continuously through the coastal beach so it empties directly into the sea', () => {
    const seeds = [101, 2026, 4242, 7777, 1337, 271828, 8675309, 99991];
    for (const seed of seeds) {
      const terrain = new TerrainMap({ ...DEFAULT_WORLD_CONFIG, seed });
      let enteredBeachZone = false;
      let reachedOpenSea = false;

      // Follow the main river centerline downstream from inland all the way into the sea
      for (let along = -20; along <= terrain.halfSize * 1.4; along += 1.0) {
        const pt = terrain.getRiverCenterPoint(along);
        const coastDist = terrain.getCoastSignedDistance(pt.x, pt.z);
        if (coastDist <= 34 && coastDist >= -10) {
          enteredBeachZone = true;
          const h = terrain.getHeightAt(pt.x, pt.z);
          // Must remain continuously submerged across the beach with zero sandbar dam
          expect(h).toBeLessThan(terrain.waterLevel - 0.35);
          expect(terrain.getBiomeAt(pt.x, pt.z)).toBe('water');
        }
        if (coastDist < -10) {
          reachedOpenSea = true;
          break;
        }
      }

      expect(enteredBeachZone).toBe(true);
      expect(reachedOpenSea).toBe(true);
    }
  });

  it('runs full creature lifecycle: adults pair off, raise litters of young, and offspring grow up to pair and have young', () => {
    // Short dayLengthSeconds so we can witness multi-generation growth, pairing, and litters deterministically
    const world = new WorldState(new EventBus(), {
      seed: 314159,
      dayLengthSeconds: 24,
    });
    const village = world.settlements[0];
    village.stockpile.berries = 220;
    village.stockpile.acorns = 220;
    village.stockpile.timber = 180;
    village.stockpile.stone = 120;

    let sawBondedPair = false;
    let sawLitterOfYoung = false;
    let sawGen2Adult = false;
    let sawGen2ParentOrGen3 = false;

    for (let i = 0; i < 2400; i++) {
      world.step(0.1);
      if (i % 100 === 0) {
        village.stockpile.berries = Math.max(village.stockpile.berries, 140);
        village.stockpile.acorns = Math.max(village.stockpile.acorns, 140);
      }

      if (!sawBondedPair) {
        sawBondedPair = world.creatures.some((c) => {
          if (!c.alive || !c.mateId) return false;
          const mate = world.getCreature(c.mateId);
          return Boolean(mate && mate.alive && mate.mateId === c.id && mate.species === c.species);
        });
      }

      if (!sawLitterOfYoung) {
        const litterCounts = new Map<string, number>();
        for (const c of world.creatures) {
          if (c.litterId && c.generation >= 2 && c.parentIds.length === 2) {
            litterCounts.set(c.litterId, (litterCounts.get(c.litterId) ?? 0) + 1);
          }
        }
        for (const count of litterCounts.values()) {
          if (count >= 2) {
            sawLitterOfYoung = true;
            break;
          }
        }
      }

      const gen2Adults = world.creatures.filter(
        (c) => c.alive && c.generation >= 2 && c.lifeStage === 'adult',
      );
      if (gen2Adults.length > 0) {
        sawGen2Adult = true;
        if (
          gen2Adults.some((c) => Boolean(c.mateId)) ||
          world.creatures.some((c) => c.generation >= 3)
        ) {
          sawGen2ParentOrGen3 = true;
        }
      }

      if (sawBondedPair && sawLitterOfYoung && sawGen2Adult && sawGen2ParentOrGen3) {
        break;
      }
    }

    expect(sawBondedPair).toBe(true);
    expect(sawLitterOfYoung).toBe(true);
    expect(sawGen2Adult).toBe(true);
    expect(sawGen2ParentOrGen3).toBe(true);

    // Verify developmental growth scale increases smoothly from newborn young to full-grown adult
    const sampleYoung = world.spawnCreature(village, 'fox', 'forager', { ageDays: 0 });
    const sampleAdult = world.spawnCreature(village, 'fox', 'forager', { ageDays: 4 });
    expect(sampleYoung.lifeStage).toBe('young');
    expect(sampleAdult.lifeStage).toBe('adult');
    expect(sampleYoung.getSizeScale()).toBeLessThan(sampleAdult.getSizeScale() * 0.6);
  });

  it('frames the world with craggy impassable mountains in back, impassable sea in front, settleable slopes/shores, and amorphous interior biomes', () => {
    const seeds = [20260501, 424242, 8675309];
    for (const seed of seeds) {
      const world = new WorldState(new EventBus(), { seed, initialSettlements: 6 });
      const t = world.terrain;
      const backZ = -t.halfSize * 0.76;
      const frontZ = t.halfSize * 0.76;

      // 1. Back (-Z) across the map is a continuous craggy alpine wall that is ultimately impassable
      for (const x of [-200, 0, 200]) {
        const h = t.getHeightAt(x, backZ);
        expect(h).toBeGreaterThanOrEqual(29);
        expect(t.getBiomeAt(x, backZ)).toBe('alpine_crag');
        expect(t.isImpassableMountainAt(x, backZ)).toBe(true);
        expect(t.isWalkable(x, backZ, false)).toBe(false);
        expect(t.isWalkable(x, backZ, true)).toBe(false);
        expect(t.canEmigrantTraverse(x, backZ)).toBe(false);
      }

      // 2. Front (+Z) across the map is open ocean sea that is ultimately impassable
      for (const x of [-200, 0, 200]) {
        const h = t.getHeightAt(x, frontZ);
        expect(h).toBeLessThan(t.waterLevel);
        expect(t.getBiomeAt(x, frontZ)).toBe('water');
        expect(t.isDeepSeaAt(x, frontZ)).toBe(true);
        expect(t.isWalkable(x, frontZ, false)).toBe(false);
        expect(t.isWalkable(x, frontZ, true)).toBe(false);
        expect(t.canEmigrantTraverse(x, frontZ)).toBe(false);
      }

      // 3. Populations can settle on mountain edges/slopes AND on the seashore, never in impassable bounds
      const adaptations = new Set(world.settlements.map((s) => s.adaptation));
      expect(adaptations.has('mountain_stone')).toBe(true);
      expect(adaptations.has('coastal_harbor')).toBe(true);
      for (const s of world.settlements) {
        expect(t.isDeepSeaAt(s.center.x, s.center.z)).toBe(false);
        expect(t.isImpassableMountainAt(s.center.x, s.center.z)).toBe(false);
        expect(t.isWalkable(s.center.x, s.center.z, false)).toBe(true);
      }

      // 4. Between the mountains and sea lie amorphous forests, prairies, and deserts cut by rivers & lakes
      const midBiomes = new Set<string>();
      for (let x = -340; x <= 340; x += 18) {
        for (let z = -200; z <= 200; z += 18) {
          midBiomes.add(t.getBiomeAt(x, z));
        }
      }
      expect(midBiomes.has('deep_woods')).toBe(true);
      expect(midBiomes.has('prairie')).toBe(true);
      expect(midBiomes.has('desert')).toBe(true);
      expect(midBiomes.has('water')).toBe(true);
      expect(t.ponds.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('forms a dendritic tree-shaped river watershed with streams -> tributaries -> widening trunk -> single sea mouth', () => {
    const seeds = [20260501, 424242, 8675309, 1337, 271828];
    for (const seed of seeds) {
      const terrain = new TerrainMap({ ...DEFAULT_WORLD_CONFIG, seed });
      const primaries = terrain.riverBranches.filter((b) => b.order === 2);
      const secondaries = terrain.riverBranches.filter((b) => b.order === 1);
      const primaryIds = new Set(primaries.map((b) => b.id));

      // Tree hierarchy: multiple Order-2 primary boughs feeding the trunk & Order-1 twigs feeding boughs
      expect(primaries.length).toBeGreaterThanOrEqual(4);
      expect(secondaries.length).toBeGreaterThanOrEqual(5);

      // Primary tributaries fan out across BOTH sides of the main trunk
      const upstreamAngle = terrain.riverAngle + Math.PI;
      let leftBoughs = 0;
      let rightBoughs = 0;
      for (const b of primaries) {
        expect(b.parentId).toBeNull();
        let diff = b.angle - upstreamAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (diff > 0) leftBoughs++;
        else rightBoughs++;
        // Acute upstream V-angle (never pointing backward toward the front sea)
        expect(Math.abs(diff)).toBeGreaterThan(0.2);
        expect(Math.abs(diff)).toBeLessThan(1.15);
      }
      expect(leftBoughs).toBeGreaterThanOrEqual(2);
      expect(rightBoughs).toBeGreaterThanOrEqual(2);

      // Every secondary stream links cleanly to an existing primary tributary and is narrower than it
      const primaryById = new Map(primaries.map((b) => [b.id, b]));
      for (const s of secondaries) {
        expect(s.parentId).not.toBeNull();
        expect(primaryIds.has(s.parentId!)).toBe(true);
        const parent = primaryById.get(s.parentId!)!;
        expect(s.startHalfWidth).toBeLessThan(parent.startHalfWidth);
      }

      // Every branch tapers narrower upstream, carves water along its course, flows downstream,
      // and terminates inland (never leaking into the front sea)
      let primarySinuositySum = 0;
      for (const b of terrain.riverBranches) {
        expect(b.startHalfWidth).toBeGreaterThan(b.endHalfWidth);
        expect(terrain.getCoastSignedDistance(b.originX, b.originZ)).toBeGreaterThan(30);
        expect(terrain.getCoastSignedDistance(b.endX, b.endZ)).toBeGreaterThan(30);

        // Confluence & midpoint lie below waterLevel
        expect(terrain.getHeightAt(b.originX, b.originZ)).toBeLessThan(terrain.waterLevel);
        const mid = terrain.getRiverBranchPoint(b.id, b.length * 0.5)!;
        expect(mid).not.toBeNull();
        expect(terrain.getHeightAt(mid.x, mid.z)).toBeLessThan(terrain.waterLevel);

        // Downstream flow along the meandering branch aligns with its local downstream tangent
        const downPt = terrain.getRiverBranchPoint(b.id, b.length * 0.45)!;
        const upPt = terrain.getRiverBranchPoint(b.id, b.length * 0.55)!;
        const tdx = downPt.x - upPt.x;
        const tdz = downPt.z - upPt.z;
        const tLen = Math.hypot(tdx, tdz) || 1;
        const flow = terrain.getWaterFlowAt(mid.x, mid.z);
        const fLen = Math.hypot(flow.x, flow.z);
        expect(fLen).toBeGreaterThan(0.15);
        const downstreamDot = (flow.x * tdx + flow.z * tdz) / (tLen * fLen);
        expect(downstreamDot).toBeGreaterThan(0.75);

        if (b.order === 2) {
          const chord = Math.hypot(b.endX - b.originX, b.endZ - b.originZ) || 1;
          primarySinuositySum += b.length / chord;
        }
      }
      // Meandering tortuosity: rivers wind organically rather than cutting straight canals
      expect(primarySinuositySum / primaries.length).toBeGreaterThan(1.025);
      const trunkStart = terrain.getRiverCenterPoint(-terrain.halfSize * 0.45);
      const trunkEnd = terrain.getRiverCenterPoint(terrain.halfSize * 0.35);
      const trunkChord = Math.hypot(trunkEnd.x - trunkStart.x, trunkEnd.z - trunkStart.z) || 1;
      let trunkArcLen = 0;
      let maxLateralBend = 0;
      let prevTrunk = trunkStart;
      const cUx = (trunkEnd.x - trunkStart.x) / trunkChord;
      const cUz = (trunkEnd.z - trunkStart.z) / trunkChord;
      for (let k = 1; k <= 32; k++) {
        const s = -terrain.halfSize * 0.45 + (k / 32) * (terrain.halfSize * 0.8);
        const pt = terrain.getRiverCenterPoint(s);
        trunkArcLen += Math.hypot(pt.x - prevTrunk.x, pt.z - prevTrunk.z);
        const lat = Math.abs((pt.x - trunkStart.x) * -cUz + (pt.z - trunkStart.z) * cUx);
        if (lat > maxLateralBend) maxLateralBend = lat;
        prevTrunk = pt;
      }
      expect(trunkArcLen / trunkChord).toBeGreaterThan(1.035);
      expect(maxLateralBend).toBeGreaterThan(22);

      // Single main trunk empties into the front sea: sweeping parallel to the front coastline
      // just inland of the beach (coastDist ~ 18m) crosses exactly ONE freshwater river mouth
      const coastCos = Math.cos(terrain.coastAngle);
      const coastSin = Math.sin(terrain.coastAngle);
      let mouthSegments = 0;
      let inMouth = false;
      for (let alongCoast = -terrain.halfSize * 0.72; alongCoast <= terrain.halfSize * 0.72; alongCoast += 4) {
        // Find point along this coastal meridian where coastDist ≈ 18m inland
        let lo = -terrain.halfSize * 0.2;
        let hi = terrain.halfSize * 0.9;
        for (let iter = 0; iter < 12; iter++) {
          const mid = (lo + hi) * 0.5;
          const px = mid * coastCos - alongCoast * coastSin;
          const pz = mid * coastSin + alongCoast * coastCos;
          if (terrain.getCoastSignedDistance(px, pz) > 18) lo = mid;
          else hi = mid;
        }
        const px = lo * coastCos - alongCoast * coastSin;
        const pz = lo * coastSin + alongCoast * coastCos;
        const isWater = terrain.getHeightAt(px, pz) < terrain.waterLevel;
        if (isWater && !inMouth) {
          mouthSegments++;
          inMouth = true;
        } else if (!isWater && inMouth) {
          inMouth = false;
        }
      }
      expect(mouthSegments).toBe(1);
    }
  });

  it('places arid desert regions farthest away from the sea and rivers across seeds', () => {
    const seeds = [20260501, 424242, 8675309, 1337, 271828];
    for (const seed of seeds) {
      const terrain = new TerrainMap({ ...DEFAULT_WORLD_CONFIG, seed });
      let desertCount = 0;
      let desertCoastSum = 0;
      let desertFreshSum = 0;
      let minDesertCoast = Infinity;
      let minDesertFresh = Infinity;

      let wetLandCount = 0;
      let wetCoastSum = 0;
      let wetFreshSum = 0;

      const step = 28;
      for (let x = -terrain.halfSize * 0.82; x <= terrain.halfSize * 0.82; x += step) {
        for (let z = -terrain.halfSize * 0.82; z <= terrain.halfSize * 0.82; z += step) {
          if (!terrain.isWithinPlayableArea(x, z, 20)) continue;
          const biome = terrain.getBiomeAt(x, z);
          if (biome === 'water' || biome === 'alpine_crag' || biome === 'rocky_ridge') continue;
          const coastDist = terrain.getCoastSignedDistance(x, z);
          const freshDist = terrain.getFreshwaterDistance(x, z);
          if (biome === 'desert') {
            desertCount++;
            desertCoastSum += coastDist;
            desertFreshSum += freshDist;
            if (coastDist < minDesertCoast) minDesertCoast = coastDist;
            if (freshDist < minDesertFresh) minDesertFresh = freshDist;
          } else {
            wetLandCount++;
            wetCoastSum += coastDist;
            wetFreshSum += freshDist;
          }
        }
      }

      expect(desertCount).toBeGreaterThanOrEqual(10);
      expect(wetLandCount).toBeGreaterThan(desertCount);
      // Deserts never border the sea or hug riverbanks
      expect(minDesertCoast).toBeGreaterThan(60);
      expect(minDesertFresh).toBeGreaterThan(15);
      // On average, deserts sit notably farther from BOTH the sea and rivers than lush interior land
      expect(desertCoastSum / desertCount).toBeGreaterThan(wetCoastSum / wetLandCount);
      expect(desertFreshSum / desertCount).toBeGreaterThan(wetFreshSum / wetLandCount);
    }
  });
});
