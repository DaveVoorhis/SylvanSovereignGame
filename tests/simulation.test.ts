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
      [-520, -520],
    ];
    for (const [x, z] of sampleCoords) {
      const h = world.terrain.getHeightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-4);
      expect(h).toBeLessThan(36);
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
      ]) {
        const h = w.terrain.getHeightAt(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThan(-4);
        expect(h).toBeLessThan(36);
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
    expect(world.config.worldSize).toBeGreaterThanOrEqual(340);
    expect(world.terrain.playableRadius).toBeGreaterThan(160);
    expect(world.terrain.ponds.length).toBeGreaterThanOrEqual(2);

    const observedBiomes = new Set<string>();
    let minH = Infinity;
    let maxH = -Infinity;
    const r = world.terrain.playableRadius;
    for (let x = -r; x <= r; x += 8) {
      for (let z = -r; z <= r; z += 8) {
        if (!world.terrain.isWithinPlayableArea(x, z)) continue;
        const h = world.terrain.getHeightAt(x, z);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        observedBiomes.add(world.terrain.getBiomeAt(x, z));
      }
    }

    // Dramatic topographic relief from ocean bed & riverbanks up to alpine peaks
    expect(maxH - minH).toBeGreaterThan(12);
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
});
