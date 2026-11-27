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
import {
  MUSHROOM_MAX_LIFESPAN_DAYS,
  MUSHROOM_MIN_LIFESPAN_DAYS,
  MUSHROOM_NEAR_TREE_RADIUS,
  evaluateMushroomVisualState,
  resolveMushroomStage,
} from '@simulation/terrain/MushroomSystem';
import { TerrainMap } from '@simulation/terrain/TerrainMap';
import { WorldState } from '@simulation/WorldState';
import {
  buildCreatureDirectorySnapshot,
  collectLineageHighlightIds,
  filterCreatureEntries,
  filterLineageTrees,
  sortCreatureEntries,
  sortLineageTrees,
} from '@ui/CreatureDirectoryLogic';

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
      'badger',
      'owl',
      'bear',
      'wolf',
      'cat',
      'raccoon',
      'weasel',
      'snake',
      'turtle',
      'pigeon',
      'magpie',
      'beaver',
      'otter',
      'fish',
    ];
    expect(ALL_SPECIES_IDS).toHaveLength(24);
    for (const id of required) {
      expect(ALL_SPECIES_IDS).toContain(id);
      expect(SPECIES_CATALOG[id as keyof typeof SPECIES_CATALOG].displayName.length).toBeGreaterThan(0);
    }
    expect(SPECIES_CATALOG.snake.locomotion).toBe('slither');
    expect(SPECIES_CATALOG.turtle.amphibious).toBe(true);
    expect(SPECIES_CATALOG.pigeon.aerial).toBe(true);
    expect(SPECIES_CATALOG.magpie.aerial).toBe(true);
    expect(SPECIES_CATALOG.beaver.aquatic).toBe(true);
    expect(SPECIES_CATALOG.otter.aquatic).toBe(true);
    expect(SPECIES_CATALOG.fish.strictlyAquatic).toBe(true);
    expect(SPECIES_CATALOG.fish.locomotion).toBe('swim');
    // Every species must be naturally adapted to at least one biome village adaptation
    const covered = new Set(
      ALL_VILLAGE_ADAPTATIONS.flatMap((id) => VILLAGE_ADAPTATION_CATALOG[id].adaptedSpecies),
    );
    expect(covered.size).toBe(ALL_SPECIES_IDS.length);
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

      expect(ALL_BUILDING_TYPES.length).toBe(20);
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
    expect(response).toContain('whisper of rewilding');
    expect(world.activeInfluences.some((inf) => inf.polarity === 'restorative')).toBe(true);
    expect(world.deity.traits.benevolence).toBeGreaterThanOrEqual(beforeBenevolence);
    expect(world.deity.whisperCooldown).toBeGreaterThan(0);

    const expectedLabels = [
      ['drama', 'habitat destruction', 'disruptive'],
      ['mystery', 'climate crisis', 'disruptive'],
      ['peace', 'climate healing', 'restorative'],
    ] as const;
    for (const [intent, label, expectedPolarity] of expectedLabels) {
      world.deity.whisperCooldown = 0;
      const msg = world.deity.receiveSpectatorWhisper(intent, world);
      expect(msg).toContain(`${world.deity.name} heard your whisper of ${label}`);
      const latestAct = world.activeInfluences[world.activeInfluences.length - 1];
      expect(latestAct?.polarity).toBe(expectedPolarity);
      const latestEntry = world.chronicle.entries[0];
      expect(latestEntry?.detail).toContain(`whispered of ${label}`);
    }
    // Climate healing must actively quell prior disruptive influences
    expect(world.activeInfluences.every((inf) => inf.polarity === 'restorative')).toBe(true);
  });

  it('lets the spectator steer the deity between Good Steward, Neutral, and Bad Exploiter with visible ecological and behavioral fallout', () => {
    const world = new WorldState(new EventBus(), {
      seed: 919191,
      initialSettlements: 2,
      initialCreaturesPerSettlement: 8,
    });
    const [sA, sB] = world.settlements;
    expect(sA).toBeDefined();
    expect(sB).toBeDefined();

    // 1. Steer toward Destructive Exploiter + unleash habitat destruction & climate crisis
    const badMsg = world.deity.setStance('destructive', world);
    expect(badMsg).toContain('Exploiter');
    expect(world.deity.stance).toBe('destructive');
    expect(world.deity.getMoralAlignment(world)).toBeLessThan(-0.45);
    expect(world.deity.getSocialClimate(world).tone).toBe('bad');

    world.deity.receiveSpectatorWhisper('drama', world);
    expect(world.habitatScars.length).toBeGreaterThan(0);
    world.deity.whisperCooldown = 0;
    world.deity.receiveSpectatorWhisper('mystery', world);

    for (let i = 0; i < 60; i++) {
      world.step(0.25);
    }
    const destructiveDiplomacy = world.diplomacy.getScore(sA.id, sB.id);
    const destructiveClimateStress = world.climateHeat + world.miasmaIntensity + world.climateFreeze + world.floodSurge;
    expect(destructiveClimateStress).toBeGreaterThan(0.25);
    expect(destructiveDiplomacy).toBeLessThan(0);

    // Snapshot round-trip preserves stance
    const snap = world.deity.exportSnapshot();
    expect(snap.stance).toBe('destructive');

    // 2. Pivot dynamically to Benevolent Steward + invoke climate healing & rewilding
    const goodMsg = world.deity.setStance('benevolent', world);
    expect(goodMsg).toContain('Steward');
    expect(world.deity.stance).toBe('benevolent');

    world.deity.whisperCooldown = 0;
    world.deity.receiveSpectatorWhisper('peace', world);
    world.deity.whisperCooldown = 0;
    world.deity.receiveSpectatorWhisper('prosperity', world);

    for (let i = 0; i < 60; i++) {
      world.step(0.25);
    }
    expect(world.deity.getMoralAlignment(world)).toBeGreaterThan(0.45);
    expect(world.deity.getSocialClimate(world).tone).toBe('good');
    expect(world.rewildingBoost).toBeGreaterThan(0.2);
    expect(world.diplomacy.getScore(sA.id, sB.id)).toBeGreaterThan(destructiveDiplomacy + 25);

    // 3. Return to Neutral Balance
    const neutralMsg = world.deity.setStance('neutral', world);
    expect(neutralMsg).toContain('Balanced');
    expect(world.deity.stance).toBe('neutral');
    expect(world.deity.disposition).toBe(0);
  });

  it('continuously scales deity moral alignment, traits, and persistence across Steward (-1) to Exploiter (+1) disposition values', () => {
    const world = new WorldState(new EventBus(), {
      seed: 929292,
      initialSettlements: 2,
      initialCreaturesPerSettlement: 6,
    });

    const startChronicleCount = world.chronicle.entries.length;

    // Live drag previews (commit = false) update disposition & alignment smoothly without spamming chronicle entries
    world.deity.setDisposition(-0.35, world, false);
    const mildStewardAlign = world.deity.getMoralAlignment(world);
    world.deity.setDisposition(-0.85, world, false);
    const strongStewardAlign = world.deity.getMoralAlignment(world);
    expect(strongStewardAlign).toBeGreaterThan(mildStewardAlign);
    expect(world.chronicle.entries.length).toBe(startChronicleCount);

    // Committing intermediate Exploiter (+0.55) shifts alignment below balanced and records one chronicle turning
    const midExploitMsg = world.deity.setDisposition(0.55, world, true);
    expect(midExploitMsg).toContain('Exploiter 55%');
    expect(world.deity.disposition).toBeCloseTo(0.55, 5);
    expect(world.deity.stance).toBe('destructive');
    const midExploitAlign = world.deity.getMoralAlignment(world);
    expect(midExploitAlign).toBeLessThan(mildStewardAlign);
    expect(world.chronicle.entries.length).toBe(startChronicleCount + 1);

    // Snapshot preserves exact continuous disposition
    const snap = world.deity.exportSnapshot();
    expect(snap.disposition).toBeCloseTo(0.55, 5);

    const restored = new WorldState(new EventBus(), { seed: 929292 });
    restored.deity.importSnapshot(snap);
    expect(restored.deity.disposition).toBeCloseTo(0.55, 5);
    expect(restored.deity.stance).toBe('destructive');

    // Legacy snapshot without numeric disposition falls back cleanly from stance
    const legacySnap = { ...snap, disposition: undefined, stance: 'benevolent' as const };
    restored.deity.importSnapshot(legacySnap);
    expect(restored.deity.disposition).toBe(-1);
    expect(restored.deity.stance).toBe('benevolent');
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
  }, 15_000);

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

    // All 7 adaptation catalog profiles (including aquatic Waterway Haven) are complete and distinct
    expect(ALL_VILLAGE_ADAPTATIONS.length).toBe(7);
    const shortLabels = new Set(
      ALL_VILLAGE_ADAPTATIONS.map((id) => VILLAGE_ADAPTATION_CATALOG[id].shortLabel),
    );
    expect(shortLabels.size).toBe(7);
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

  it('hosts occasional local festivals, regional inter-settlement events, and very occasional realm-wide national holidays', () => {
    const world = new WorldState(new EventBus(), {
      seed: 20260704,
      initialSettlements: 3,
      initialCreaturesPerSettlement: 10,
      deityDecisionIntervalSec: 999,
      diplomacyIntervalSec: 999,
    });
    expect(world.settlements.length).toBe(3);

    const [s0, s1, s2] = world.settlements;
    // Ensure peaceful regional neighbors so all 3 can attend regional events together
    world.diplomacy.adjustRelation(s0, s1, 25, world);
    world.diplomacy.adjustRelation(s0, s2, 25, world);
    world.diplomacy.adjustRelation(s1, s2, 25, world);

    // 1. Local village/town/city festival: attended by its own inhabitants only
    const s0Pop = world.getSettlementPopulation(s0.id);
    const localFest = world.festivals.startLocalFestival(world, s0);
    expect(localFest).not.toBeNull();
    expect(localFest!.scope).toBe('local');
    expect(localFest!.participatingSettlementIds).toEqual([s0.id]);

    const localAttendeesS0 = world.creatures.filter(
      (c) => c.alive && c.settlementId === s0.id && c.activity === 'celebrating',
    ).length;
    const localAttendeesOthers = world.creatures.filter(
      (c) => c.alive && c.settlementId !== s0.id && c.activity === 'celebrating',
    ).length;
    expect(localAttendeesS0).toBeGreaterThanOrEqual(Math.floor(s0Pop * 0.75));
    expect(localAttendeesOthers).toBe(0);

    // Step forward so attendees dance at the plaza and then let the local festival conclude cleanly
    let sawDancing = false;
    for (let i = 0; i < 450; i++) {
      world.step(0.1);
      if (world.creatures.some((c) => c.alive && c.isDancingAtCelebration)) {
        sawDancing = true;
      }
      if (!world.festivals.getCelebrationById(localFest!.id)) break;
    }
    expect(sawDancing).toBe(true);
    expect(world.festivals.getCelebrationById(localFest!.id)).toBeUndefined();

    // 2. Regional event: significant proportion across multiple settlements attend at the host plaza
    const preRelation01 = world.diplomacy.getScore(s0.id, s1.id);
    const regional = world.festivals.startRegionalEvent(world, s0);
    expect(regional).not.toBeNull();
    expect(regional!.scope).toBe('regional');
    expect(regional!.participatingSettlementIds.length).toBeGreaterThanOrEqual(2);

    const participatingSet = new Set(regional!.participatingSettlementIds);
    const totalRegionalPop = world.creatures.filter(
      (c) => c.alive && participatingSet.has(c.settlementId),
    ).length;
    const regionalAttendees = world.festivals.getAttendeeCount(world, regional!.id);
    const visitingNeighbors = world.creatures.filter(
      (c) =>
        c.alive &&
        c.activity === 'celebrating' &&
        c.activeCelebrationId === regional!.id &&
        c.settlementId !== s0.id &&
        c.celebrationHostSettlementId === s0.id,
    ).length;
    expect(regionalAttendees / Math.max(1, totalRegionalPop)).toBeGreaterThanOrEqual(0.45);
    expect(regionalAttendees / Math.max(1, totalRegionalPop)).toBeLessThanOrEqual(0.85);
    expect(visitingNeighbors).toBeGreaterThanOrEqual(4);

    // Fast-forward past regional event end and verify diplomatic warming
    for (let i = 0; i < 650; i++) {
      world.step(0.1);
      if (!world.festivals.getCelebrationById(regional!.id)) break;
    }
    expect(world.festivals.getCelebrationById(regional!.id)).toBeUndefined();
    expect(world.diplomacy.getScore(s0.id, s1.id)).toBeGreaterThan(preRelation01);

    // 3. National holiday: everyone across all settlements celebrates simultaneously
    const holiday = world.festivals.startNationalHoliday(world);
    expect(holiday).not.toBeNull();
    expect(holiday!.scope).toBe('national');
    expect(holiday!.participatingSettlementIds.length).toBe(world.settlements.length);

    const eligibleRealmPop = world.creatures.filter(
      (c) => c.alive && c.activity !== 'fighting' && c.activity !== 'fleeing',
    ).length;
    const holidayAttendees = world.festivals.getAttendeeCount(world, holiday!.id);
    expect(holidayAttendees).toBe(eligibleRealmPop);
    for (const s of world.settlements) {
      expect(world.festivals.getVenueCelebration(s.id)?.id).toBe(holiday!.id);
    }

    // Verify Chronicle recorded festival entries for all three celebration tiers
    const festivalChronicles = world.chronicle.entries.filter((e) => e.category === 'festival');
    expect(festivalChronicles.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps optimized terrain biome sampling and O(1) WorldState/TerrainMap caches consistent under mutations', () => {
    const world = new WorldState(new EventBus(), { seed: 424242, initialSettlements: 2 });

    // 1. getBiomeAtKnownHeight(x, z, h) must match getBiomeAtSample(x, z, h, slope) identically across the world
    const r = world.terrain.playableRadius;
    let checked = 0;
    for (let x = -r; x <= r; x += 28) {
      for (let z = -r; z <= r; z += 28) {
        const h = world.terrain.getHeightAt(x, z);
        const slope = world.terrain.getSlopeAt(x, z);
        expect(world.terrain.getBiomeAtKnownHeight(x, z, h)).toBe(
          world.terrain.getBiomeAtSample(x, z, h, slope),
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(800);

    // 2. O(1) resource node lookup matches direct array entries
    const firstNode = world.terrain.resourceNodes[0];
    expect(world.terrain.getResourceNode(firstNode.id)).toBe(firstNode);
    expect(world.terrain.getResourceNode(null)).toBeUndefined();

    // 3. WorldState O(1) creature/settlement/bridge index caches stay accurate across direct array mutations
    const c0 = world.creatures[0];
    const cLast = world.creatures[world.creatures.length - 1];
    expect(world.getCreature(c0.id)).toBe(c0);
    expect(world.getCreature(cLast.id)).toBe(cLast);

    // Remove first creature via splice (shifts all indices)
    world.creatures.splice(0, 1);
    expect(world.getCreature(c0.id)).toBeUndefined();
    expect(world.getCreature(cLast.id)).toBe(cLast);

    // Clear settlements directly and verify cache reconciles cleanly
    const s0 = world.settlements[0];
    expect(world.getSettlement(s0.id)).toBe(s0);
    world.settlements.splice(0, 1);
    expect(world.getSettlement(s0.id)).toBeUndefined();
    world.settlements.push(s0);
    expect(world.getSettlement(s0.id)).toBe(s0);
  });

  it('builds sortable creature census snapshots and multi-generation lineage family trees', () => {
    const world = new WorldState(new EventBus(), {
      seed: 901234,
      initialSettlements: 2,
      initialCreaturesPerSettlement: 2,
    });
    const s0 = world.settlements[0];
    const s1 = world.settlements[1];

    // Clear initial random creatures so we can verify exact multi-generation genealogy
    world.creatures.length = 0;

    const f1 = world.spawnCreature(s0, 'fox', 'forager', {
      ageDays: 10.5,
      familySurname: 'Briarwood',
    });
    const f2 = world.spawnCreature(s0, 'fox', 'builder', {
      ageDays: 9.2,
      familySurname: 'Briarwood',
    });
    f1.wealth = 42;
    f2.wealth = 18;
    expect(world.pairCreatures(f1, f2, s0.name)).toBe(true);

    // Gen 2 litter from f1 & f2
    const childA = world.spawnCreature(s0, 'fox', 'artisan', {
      ageDays: 4.5,
      generation: 2,
      parentIds: [f1.id, f2.id],
      litterId: 'lit_1',
      familySurname: 'Briarwood',
    });
    const childB = world.spawnCreature(s0, 'fox', 'guard', {
      ageDays: 4.5,
      generation: 2,
      parentIds: [f1.id, f2.id],
      litterId: 'lit_1',
      familySurname: 'Briarwood',
    });

    // Second independent founding bloodline in settlement 2
    const o1 = world.spawnCreature(s1, 'owl', 'mystic', {
      ageDays: 14.0,
      familySurname: 'Moonfeather',
    });
    o1.mood = 96;

    // Cross-lineage marriage & Gen 3 grandchild
    const outsiderFox = world.spawnCreature(s1, 'fox', 'merchant', {
      ageDays: 4.8,
      familySurname: 'Fernbrook',
    });
    expect(world.pairCreatures(childA, outsiderFox, s0.name)).toBe(true);
    const grandKit = world.spawnCreature(s0, 'fox', 'forager', {
      ageDays: 0.4,
      generation: 3,
      parentIds: [childA.id, outsiderFox.id],
      litterId: 'lit_2',
      familySurname: 'Briarwood',
    });

    // Mark founder f1 as deceased to verify fallen ancestors remain visible in family trees
    f1.alive = false;

    const snap = buildCreatureDirectorySnapshot(world.creatures, world.settlements);
    expect(snap.entries.length).toBe(7);
    expect(snap.totalLiving).toBe(6);
    expect(snap.totalFallen).toBe(1);
    expect(snap.trees.length).toBeGreaterThanOrEqual(2);

    // Verify Briarwood tree spans 3 generations with founding couple + cross-lineage mate + grandchild
    const briarTree = snap.trees.find((t) => t.memberIds.has(grandKit.id));
    expect(briarTree).toBeDefined();
    expect(briarTree!.maxGeneration).toBe(3);
    expect(briarTree!.memberIds.has(f1.id)).toBe(true);
    expect(briarTree!.memberIds.has(f2.id)).toBe(true);
    expect(briarTree!.memberIds.has(childA.id)).toBe(true);
    expect(briarTree!.memberIds.has(childB.id)).toBe(true);
    expect(briarTree!.root.mate?.id).toBe(f2.id);
    const childANode = briarTree!.root.children.find((n) => n.primary.id === childA.id);
    expect(childANode?.mate?.id).toBe(outsiderFox.id);
    expect(childANode?.mateIsCrossLineage).toBe(true);
    expect(childANode?.children.map((n) => n.primary.id)).toContain(grandKit.id);

    // Highlight path from Gen 3 grandchild walks up to Gen 1 founders & parents
    const highlight = collectLineageHighlightIds(briarTree!, grandKit.id);
    expect(highlight.has(grandKit.id)).toBe(true);
    expect(highlight.has(childA.id)).toBe(true);
    expect(highlight.has(f1.id)).toBe(true);
    expect(snap.entriesById.get(f1.id)?.offspringCount).toBe(2);
    expect(snap.entriesById.get(childA.id)?.offspringCount).toBe(1);

    // Sorting & filtering verification (species, lineage, age, wealth, includeFallen)
    const livingOnly = filterCreatureEntries(snap.entries, {
      search: '',
      species: 'all',
      settlementId: 'all',
      lifeStage: 'all',
      includeFallen: false,
    });
    expect(livingOnly.length).toBe(6);
    expect(livingOnly.some((e) => e.id === f1.id)).toBe(false);

    const byAgeDesc = sortCreatureEntries(snap.entries, 'age', 'desc');
    expect(byAgeDesc[0].id).toBe(o1.id);
    expect(byAgeDesc[byAgeDesc.length - 1].id).toBe(grandKit.id);

    const bySpeciesAsc = sortCreatureEntries(snap.entries, 'species', 'asc');
    expect(bySpeciesAsc[0].species).toBe('fox');
    expect(bySpeciesAsc[bySpeciesAsc.length - 1].species).toBe('owl');

    const byLineageAsc = sortCreatureEntries(snap.entries, 'lineage', 'asc');
    expect(byLineageAsc[0].lineageName.localeCompare(byLineageAsc[byLineageAsc.length - 1].lineageName)).toBeLessThanOrEqual(0);

    const sortedTrees = sortLineageTrees(
      filterLineageTrees(snap.trees, {
        search: '',
        species: 'all',
        settlementId: 'all',
        lifeStage: 'all',
        includeFallen: true,
      }),
      'depth',
      'desc',
    );
    expect(sortedTrees[0].maxGeneration).toBe(3);
  });

  it('steps a densely populated multi-settlement world smoothly without multi-second frame freezes', () => {
    const world = new WorldState(new EventBus(), {
      seed: 777123,
      initialSettlements: 8,
      initialCreaturesPerSettlement: 18,
    });
    expect(world.settlements.length).toBeGreaterThanOrEqual(6);
    expect(world.creatures.length).toBeGreaterThanOrEqual(100);

    // Step 24 seconds across bridge, emigration, expansion, festival & trade windows
    let maxStepMs = 0;
    for (let i = 0; i < 240; i++) {
      const t0 = performance.now();
      world.step(0.1);
      const dtMs = performance.now() - t0;
      if (dtMs > maxStepMs) maxStepMs = dtMs;
    }

    // Every individual simulation step must stay far below multi-second freeze territory
    expect(maxStepMs).toBeLessThan(250);
  });

  it('founds aquatic waterway villages of beavers, otters, and river koi with exclusive watery homes and buildings', () => {
    const world = new WorldState(new EventBus(), {
      seed: 4242,
      initialSettlements: 1,
      initialWaterwaySettlements: 1,
      initialCreaturesPerSettlement: 8,
    });

    const waterwayVillage = world.settlements.find((s) => s.adaptation === 'waterway_haven');
    expect(waterwayVillage).toBeDefined();
    expect(world.terrain.isSwimmable(waterwayVillage!.center.x, waterwayVillage!.center.z)).toBe(true);
    expect(world.terrain.isDeepSeaAt(waterwayVillage!.center.x, waterwayVillage!.center.z)).toBe(false);
    expect(waterwayVillage!.groundY).toBeCloseTo(world.terrain.waterLevel, 3);

    // Populated with beavers, otters, and river koi
    const residents = world.creatures.filter((c) => c.settlementId === waterwayVillage!.id);
    const speciesPresent = new Set(residents.map((c) => c.species));
    expect(speciesPresent.has('beaver')).toBe(true);
    expect(speciesPresent.has('otter')).toBe(true);
    expect(speciesPresent.has('fish')).toBe(true);

    // Only waterway-exclusive buildings belong to waterway villages; land villages never build them
    for (const b of waterwayVillage!.buildings) {
      expect(BUILDING_CATALOG[b.type].waterwayOnly).toBe(true);
    }
    const landVillage = world.settlements.find((s) => s.adaptation !== 'waterway_haven')!;
    for (const b of landVillage.buildings) {
      expect(Boolean(BUILDING_CATALOG[b.type].waterwayOnly)).toBe(false);
    }

    // Supply abundant river materials & step 70s of autonomous building and swimming
    waterwayVillage!.stockpile.timber += 120;
    waterwayVillage!.stockpile.stone += 80;
    waterwayVillage!.stockpile.herbs += 60;
    waterwayVillage!.stockpile.crafts += 40;
    const initialCount = waterwayVillage!.buildings.length;

    for (let i = 0; i < 700; i++) {
      world.step(0.1);
    }

    expect(waterwayVillage!.buildings.length).toBeGreaterThan(initialCount);
    for (const b of waterwayVillage!.buildings) {
      expect(BUILDING_CATALOG[b.type].waterwayOnly).toBe(true);
    }

    // Strictly aquatic River Koi stay cleanly inside inland freshwater with finite coordinates
    const koi = world.creatures.filter((c) => c.alive && c.species === 'fish');
    expect(koi.length).toBeGreaterThan(0);
    for (const fish of koi) {
      expect(Number.isFinite(fish.x) && Number.isFinite(fish.y) && Number.isFinite(fish.z)).toBe(true);
      expect(world.terrain.isSwimmable(fish.x, fish.z)).toBe(true);
      expect(world.terrain.isDeepSeaAt(fish.x, fish.z)).toBe(false);
      // Fish swim submerged inside the water column (below waterLevel, above the riverbed)
      expect(fish.y).toBeLessThan(world.terrain.waterLevel - 0.14);
      expect(fish.y).toBeGreaterThan(world.terrain.getHeightAt(fish.x, fish.z));
    }
  });

  it('keeps autonomous Deity influences rare by default and models dramatic ecological disruptions, adaptations, and restorative stewardship', () => {
    // Autonomous interventions should be genuinely rare (~1.5+ minutes apart at 1x speed)
    expect(DEFAULT_WORLD_CONFIG.deityDecisionIntervalSec).toBeGreaterThanOrEqual(80);

    const world = new WorldState(new EventBus(), {
      seed: 20260815,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 12,
      deityDecisionIntervalSec: 999,
      diplomacyIntervalSec: 999,
    });

    const village = world.settlements[0];
    // Give village extra completed buildings so we can verify building damage & survival floors
    const extraTypes = ['granary', 'workshop', 'market_stall', 'bakery'] as const;
    for (let i = 0; i < extraTypes.length; i++) {
      const ang = (i / extraTypes.length) * Math.PI * 2;
      const bx = village.center.x + Math.cos(ang) * 14;
      const bz = village.center.z + Math.sin(ang) * 14;
      village.buildings.push({
        id: `test_eco_bldg_${i}`,
        settlementId: village.id,
        type: extraTypes[i],
        position: { x: bx, z: bz },
        groundY: world.terrain.getHeightAt(bx, bz),
        rotation: 0,
        progress: 100,
        completed: true,
      });
    }
    village.stockpile.berries = 90;

    // 1. Great Deluge: raises floodwaters, batters structures/stores, teaches adaptation, preserves minimum survivors
    const flood = world.deity.triggerInfluence('great_deluge', world, village);
    expect(flood).not.toBeNull();
    expect(flood!.polarity).toBe('disruptive');
    expect(world.activeInfluences.length).toBe(1);

    for (let i = 0; i < 150; i++) {
      world.step(0.1);
    }
    expect(world.floodSurge).toBeGreaterThan(0.75);
    expect(world.getEffectiveWaterLevel()).toBeGreaterThan(world.terrain.waterLevel + 0.75);
    expect(village.environmentalResilience).toBeGreaterThan(0);
    expect(Object.keys(village.adaptationFocus).length).toBeGreaterThan(0);
    expect(world.getSettlementPopulation(village.id)).toBeGreaterThanOrEqual(3);
    expect(village.getCompletedCount()).toBeGreaterThanOrEqual(2);

    // 2. Habitat Clearing: carves a persistent scar that clears tree obstacles; Sanctuary Rewilding heals it back
    const targetTree = world.terrain.trees.find(
      (t) => Math.hypot(t.x - village.center.x, t.z - village.center.z) > 26,
    )!;
    expect(targetTree).toBeDefined();
    const clearing = world.deity.triggerInfluence('habitat_clearing', world, village);
    expect(clearing).not.toBeNull();
    expect(world.habitatScars.length).toBeGreaterThanOrEqual(1);
    const scar = world.habitatScars[0];
    expect(world.isPointInHabitatScar(scar.x, scar.z)).toBe(true);
    const revBeforeHeal = world.structureRevision;

    const rewild = world.deity.triggerInfluence('sanctuary_rewilding', world, village);
    expect(rewild).not.toBeNull();
    expect(rewild!.polarity).toBe('restorative');
    expect(world.habitatScars.length).toBe(0);
    expect(world.structureRevision).toBeGreaterThan(revBeforeHeal);
    for (let i = 0; i < 120; i++) {
      world.step(0.1);
    }
    expect(world.rewildingBoost).toBeGreaterThan(0.5);

    // 3. Climate extremes (Heatwave, Ashen Miasma, Polar Snap) drive distinct world anomalies
    world.deity.triggerInfluence('scorching_drought', world, village);
    for (let i = 0; i < 140; i++) world.step(0.1);
    expect(world.climateHeat).toBeGreaterThan(0.6);

    world.deity.triggerInfluence('ashen_miasma', world, village);
    for (let i = 0; i < 140; i++) world.step(0.1);
    expect(world.miasmaIntensity).toBeGreaterThan(0.6);

    world.deity.triggerInfluence('polar_snap', world, village);
    for (let i = 0; i < 140; i++) world.step(0.1);
    expect(world.climateFreeze).toBeGreaterThan(0.6);
    expect(world.weather).toBe('snow');

    // 4. Migration Corridor reintroduces paired kin and boosts diplomacy
    const popBeforeCorridor = world.creatures.filter((c) => c.alive).length;
    const corridor = world.deity.triggerInfluence('migration_corridor', world, village);
    expect(corridor).not.toBeNull();
    expect(corridor!.polarity).toBe('restorative');
    const popAfterCorridor = world.creatures.filter((c) => c.alive).length;
    expect(popAfterCorridor).toBeGreaterThanOrEqual(popBeforeCorridor + 2);
  });

  it('keeps creature headings and movement smooth without single-frame snaps or rapid flip-flops across seeds', () => {
    const angleDiff = (a: number, b: number): number => {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    };

    const dt = 1 / 60;
    for (const seed of [1337, 424242, 777888]) {
      const world = new WorldState(new EventBus(), { seed });
      const prev = new Map<string, { x: number; z: number; heading: number; dh: number }>();
      let bigHeadingJumps = 0;
      let headingFlipFlops = 0;
      let totalDistance = 0;

      for (let f = 0; f < 900; f++) {
        world.step(dt);
        for (const c of world.creatures) {
          if (!c.alive) continue;
          const p = prev.get(c.id);
          if (p) {
            totalDistance += Math.hypot(c.x - p.x, c.z - p.z);
            const dh = angleDiff(p.heading, c.heading);
            if (Math.abs(dh) > 0.25) bigHeadingJumps++;
            if (Math.abs(p.dh) > 0.05 && Math.abs(dh) > 0.05 && p.dh * dh < 0) {
              headingFlipFlops++;
            }
            prev.set(c.id, { x: c.x, z: c.z, heading: c.heading, dh });
          } else {
            prev.set(c.id, { x: c.x, z: c.z, heading: c.heading, dh: 0 });
          }
        }
      }

      expect(totalDistance).toBeGreaterThan(50);
      expect(bigHeadingJumps).toBe(0);
      expect(headingFlipFlops).toBe(0);
    }
  });

  it('transitions creatures smoothly between slow stroll, steady walk, and brisk run gaits as appropriate', () => {
    const world = new WorldState(new EventBus(), {
      seed: 314159,
      initialSettlements: 1,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 0,
      deityDecisionIntervalSec: 999,
    });
    const home = world.settlements[0];

    const measurePace = (activity: 'socialising' | 'resting', weather: 'clear' | 'storm') => {
      world.weather = weather;
      const c = world.spawnCreature(home, 'fox', 'forager');
      c.x = home.center.x + 5;
      c.z = home.center.z;
      c.targetX = c.x + 24;
      c.targetZ = c.z;
      c.heading = Math.PI * 0.5;
      c.steerHeading = Math.PI * 0.5;
      c.activity = activity;
      c.actionTimer = 30;
      c.energy = 95;
      c.hunger = 10;
      for (let i = 0; i < 65; i++) {
        c.activity = activity;
        c.actionTimer = 30;
        c.targetX = c.x + 18;
        c.targetZ = c.z;
        world.step(1 / 30);
      }
      const res = { speed: c.currentSpeed, gait: c.gait, effort: c.gaitEffort };
      c.alive = false;
      return res;
    };

    const stroll = measurePace('socialising', 'clear');
    const walk = measurePace('resting', 'clear');
    const run = measurePace('resting', 'storm');

    expect(stroll.gait).toBe('stroll');
    expect(walk.gait).toBe('walk');
    expect(run.gait).toBe('run');
    expect(stroll.speed).toBeLessThan(walk.speed);
    expect(walk.speed).toBeLessThan(run.speed);
  });

  it('amasses armed village armies that march to an inter-village battlefield, fight dynamically with weapons, and end on decisive victory', () => {
    const world = new WorldState(new EventBus(), {
      seed: 20260711,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 8,
      deityDecisionIntervalSec: 999,
    });
    const sA = world.settlements[0];
    const sB = world.settlements[1];
    expect(sA).toBeDefined();
    expect(sB).toBeDefined();

    // Add a strong veteran vanguard to Village A so it holds a decisive battlefield advantage,
    // plus a young creature in each village to verify young stay safe at home.
    for (let i = 0; i < 6; i++) {
      world.spawnCreature(sA, i % 2 === 0 ? 'bear' : 'wolf', 'guard');
    }
    const youngA = world.spawnCreature(sA, 'fox', 'forager', { ageDays: 0.1 });
    const youngB = world.spawnCreature(sB, 'rabbit', 'forager', { ageDays: 0.1 });

    // Spark war between the two villages
    world.diplomacy.adjustRelation(sA, sB, -100, world, 'border dispute');
    expect(world.diplomacy.getStance(sA.id, sB.id)).toBe('war');
    expect(world.wars.activeWars.length).toBe(1);

    const war = world.wars.activeWars[0];
    expect(war.armyAIds.length).toBeGreaterThanOrEqual(5);
    expect(war.armyBIds.length).toBeGreaterThanOrEqual(3);

    // Young creatures are never drafted into war armies
    expect(youngA.activeWarId).toBeNull();
    expect(youngA.warWeapon).toBeNull();
    expect(youngB.activeWarId).toBeNull();
    expect(youngB.warWeapon).toBeNull();

    // Every mobilized soldier is equipped with a war weapon
    const weaponsSeen = new Set<string>();
    for (const id of [...war.armyAIds, ...war.armyBIds]) {
      const soldier = world.getCreature(id)!;
      expect(soldier.activeWarId).toBe(war.id);
      expect(soldier.warWeapon).not.toBeNull();
      weaponsSeen.add(soldier.warWeapon!);
    }
    expect(weaponsSeen.size).toBeGreaterThanOrEqual(2);

    // Battlefield lies on walkable dry ground between the two villages
    expect(world.terrain.isWalkable(war.battlefield.x, war.battlefield.z, false)).toBe(true);
    const villageSep = Math.hypot(sB.center.x - sA.center.x, sB.center.z - sA.center.z);
    const distFromA = Math.hypot(war.battlefield.x - sA.center.x, war.battlefield.z - sA.center.z);
    const distFromB = Math.hypot(war.battlefield.x - sB.center.x, war.battlefield.z - sB.center.z);
    expect(distFromA).toBeLessThan(villageSep * 0.92);
    expect(distFromB).toBeLessThan(villageSep * 0.92);

    // Simulate the full war campaign and track marching, battle engagement, active combat motion, and strikes
    let sawMarchingPhase = false;
    let sawEngagedPhase = false;
    let peakStrikes = 0;
    let sawCombatVfx = false;
    let fightingMotionDist = 0;
    const lastPos = new Map<string, { x: number; z: number }>();

    for (let step = 0; step < 900; step++) {
      world.step(0.2);
      const active = world.wars.getWarById(war.id);
      if (active) {
        if (active.phase === 'marching') sawMarchingPhase = true;
        if (active.phase === 'engaged') sawEngagedPhase = true;
        peakStrikes = Math.max(peakStrikes, active.totalStrikes);
      }
      if (world.activeCombatSparks.some((s) => s.kind === 'hit' || s.kind === 'heavy_hit' || s.kind === 'arrow' || s.kind === 'fatal')) {
        sawCombatVfx = true;
      }
      for (const c of world.creatures) {
        if (!c.alive) continue;
        if (c.activity === 'fighting' && c.activeWarId === war.id) {
          const prev = lastPos.get(c.id);
          if (prev) {
            fightingMotionDist += Math.hypot(c.x - prev.x, c.z - prev.z);
          }
          lastPos.set(c.id, { x: c.x, z: c.z });
        }
      }
      if (world.wars.activeWars.length === 0) break;
    }

    expect(sawMarchingPhase || sawEngagedPhase).toBe(true);
    expect(sawEngagedPhase).toBe(true);
    expect(peakStrikes).toBeGreaterThanOrEqual(4);
    expect(sawCombatVfx).toBe(true);
    // Fighters actively maneuver, strafe, charge, and knock back rather than standing motionless
    expect(fightingMotionDist).toBeGreaterThan(8);

    // War concluded cleanly on decisive victory by surviving majority
    expect(world.wars.activeWars.length).toBe(0);
    expect(world.wars.totalVictories).toBeGreaterThanOrEqual(1);
    expect(world.diplomacy.getStance(sA.id, sB.id)).not.toBe('war');

    // All surviving soldiers have lowered their weapons and demobilized
    for (const c of world.creatures) {
      if (!c.alive) continue;
      expect(c.activeWarId).toBeNull();
      expect(c.warWeapon).toBeNull();
      expect(c.activity).not.toBe('marching');
    }
  });

  it('concludes active wars cleanly when a truce is declared directly or via diplomacy', () => {
    const world = new WorldState(new EventBus(), {
      seed: 20260712,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 7,
      deityDecisionIntervalSec: 999,
    });
    const sA = world.settlements[0];
    const sB = world.settlements[1];

    // 1. Direct truce declaration via WarSystem
    world.diplomacy.adjustRelation(sA, sB, -100, world, 'timber feud');
    expect(world.wars.activeWars.length).toBe(1);
    const warId = world.wars.activeWars[0].id;
    const draftedCount = world.creatures.filter((c) => c.activeWarId === warId && c.warWeapon !== null).length;
    expect(draftedCount).toBeGreaterThanOrEqual(4);

    expect(world.wars.declareTruce(warId, world)).toBe(true);
    expect(world.wars.activeWars.length).toBe(0);
    expect(world.wars.totalTruces).toBe(1);
    expect(world.diplomacy.getStance(sA.id, sB.id)).not.toBe('war');
    expect(world.creatures.every((c) => c.activeWarId === null && c.warWeapon === null)).toBe(true);

    // 2. Diplomatic peace intervention also cleanly demobilizes an active war
    world.diplomacy.adjustRelation(sA, sB, -100, world, 'renewed clash');
    expect(world.wars.activeWars.length).toBe(1);
    world.diplomacy.adjustRelation(sA, sB, +100, world, 'divine peacemaking');
    expect(world.wars.activeWars.length).toBe(0);
    expect(world.wars.totalTruces).toBe(2);
    expect(world.diplomacy.getStance(sA.id, sB.id)).not.toBe('war');
    expect(world.creatures.every((c) => c.activeWarId === null && c.warWeapon === null)).toBe(true);
  });

  it('ends a battle via clear victory once one side attains a significant majority of surviving members', () => {
    const world = new WorldState(new EventBus(), {
      seed: 20260713,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 8,
      deityDecisionIntervalSec: 999,
    });
    const sA = world.settlements[0];
    const sB = world.settlements[1];

    world.diplomacy.adjustRelation(sA, sB, -100, world, 'territorial dispute');
    const war = world.wars.activeWars[0];
    expect(war).toBeDefined();

    // Place armies on the battlefield in engaged phase after real combat
    war.phase = 'engaged';
    war.engagedSeconds = 6;
    war.totalStrikes = 8;
    for (const id of war.armyAIds) {
      const c = world.getCreature(id)!;
      c.x = war.frontA.x;
      c.z = war.frontA.z;
      c.activity = 'fighting';
    }
    // Inflict heavy casualties on side B leaving only 1 survivor against side A's overwhelming majority
    const keepB = war.armyBIds[0];
    const victimsB = war.armyBIds.slice(1);
    for (const victimId of victimsB) {
      const fallen = world.getCreature(victimId)!;
      fallen.alive = false;
      fallen.health = 0;
      world.wars.recordCasualty(war.id, fallen.settlementId, 'killed', fallen.id);
    }
    const lastB = world.getCreature(keepB)!;
    lastB.x = war.frontB.x;
    lastB.z = war.frontB.z;
    lastB.activity = 'fighting';

    // One tick evaluates the surviving majority and concludes with a clear victory for Village A
    world.wars.tick(world, 0.2);
    expect(world.wars.activeWars.length).toBe(0);
    expect(world.wars.totalVictories).toBe(1);
    expect(world.diplomacy.getStance(sA.id, sB.id)).not.toBe('war');
    expect(lastB.activeWarId).toBeNull();
    expect(lastB.warWeapon).toBeNull();
  });

  it('sprouts, grows, and rots mushrooms away completely within 1 to 2 days', () => {
    const world = new WorldState(new EventBus(), {
      seed: 912345,
      initialSettlements: 1,
      initialCreaturesPerSettlement: 6,
      dayLengthSeconds: 20, // fast calendar days for lifecycle verification
      deityDecisionIntervalSec: 999,
    });

    // Static terrain undergrowth should no longer contain permanent toadstools (variant === 2)
    expect(world.terrain.undergrowth.some((u) => u.variant === 2)).toBe(false);

    // Initial world is seeded with ephemeral mushrooms, all strictly capped to 1-2 day lifespans
    expect(world.mushrooms.patches.length).toBeGreaterThan(200);
    const initialIds = new Set<number>();
    for (const m of world.mushrooms.patches) {
      initialIds.add(m.id);
      expect(m.lifespanDays).toBeGreaterThanOrEqual(MUSHROOM_MIN_LIFESPAN_DAYS);
      expect(m.lifespanDays).toBeLessThanOrEqual(MUSHROOM_MAX_LIFESPAN_DAYS);
      expect(m.ageDays).toBeGreaterThanOrEqual(0);
      expect(m.ageDays).toBeLessThan(m.lifespanDays);
    }

    // Verify single-mushroom stage progression through sprouting -> growing -> mature -> rotting -> gone
    const fresh = world.mushrooms.trySpawnPatch(world, 0);
    expect(fresh).not.toBeNull();
    const freshId = fresh!.id;
    const observedStages = new Set<string>();
    observedStages.add(resolveMushroomStage(fresh!.ageDays, fresh!.lifespanDays));

    // Evaluate continuous visual cues across the lifecycle
    const sproutVis = evaluateMushroomVisualState(0.05 * fresh!.lifespanDays, fresh!.lifespanDays);
    const growVis = evaluateMushroomVisualState(0.32 * fresh!.lifespanDays, fresh!.lifespanDays);
    const matureVis = evaluateMushroomVisualState(0.58 * fresh!.lifespanDays, fresh!.lifespanDays);
    const rotVis = evaluateMushroomVisualState(0.92 * fresh!.lifespanDays, fresh!.lifespanDays);
    expect(sproutVis.stage).toBe('sprouting');
    expect(growVis.stage).toBe('growing');
    expect(matureVis.stage).toBe('mature');
    expect(rotVis.stage).toBe('rotting');
    expect(sproutVis.scaleY).toBeLessThan(growVis.scaleY);
    expect(growVis.scaleY).toBeLessThan(matureVis.scaleY);
    expect(rotVis.scaleY).toBeLessThan(matureVis.scaleY * 0.5);
    expect(rotVis.rotAmount).toBeGreaterThan(0.7);
    expect(rotVis.rotTilt).toBeGreaterThan(0.3);

    // Advance simulation by ~2.3 in-game days
    let elapsedDays = 0;
    const startDayTime = world.day - 1 + world.timeOfDay;
    while (elapsedDays < 2.3) {
      world.step(0.1);
      const live = world.mushrooms.patches.find((p) => p.id === freshId);
      if (live) {
        observedStages.add(resolveMushroomStage(live.ageDays, live.lifespanDays));
      }
      elapsedDays = world.day - 1 + world.timeOfDay - startDayTime;
    }

    // Our freshly sprouted mushroom passed through every lifecycle stage and completely rotted away
    expect(observedStages.has('sprouting')).toBe(true);
    expect(observedStages.has('growing')).toBe(true);
    expect(observedStages.has('mature')).toBe(true);
    expect(observedStages.has('rotting')).toBe(true);
    expect(world.mushrooms.patches.some((p) => p.id === freshId)).toBe(false);

    // Every single initial mushroom from Day 1 has rotted away within 2 days
    const survivingInitial = world.mushrooms.patches.filter((p) => initialIds.has(p.id));
    expect(survivingInitial.length).toBe(0);

    // Meanwhile new mushrooms have continuously sprouted to sustain the woodland ecosystem
    expect(world.mushrooms.patches.length).toBeGreaterThan(200);
    expect(world.mushrooms.totalRottedCount).toBeGreaterThanOrEqual(initialIds.size);
    expect(world.mushrooms.totalSproutedCount).toBeGreaterThan(initialIds.size + 150);
  });

  it('makes mushrooms far more likely to appear near trees and least likely near the sea', () => {
    const world = new WorldState(new EventBus(), {
      seed: 445566,
      initialSettlements: 1,
      initialCreaturesPerSettlement: 4,
      deityDecisionIntervalSec: 999,
    });

    // 1. Direct habitat probability comparison across inland near-tree, inland open, and near-sea land
    let nearTreeWeightSum = 0;
    let nearTreeSamples = 0;
    let inlandOpenWeightSum = 0;
    let inlandOpenSamples = 0;
    let nearSeaWeightSum = 0;
    let nearSeaSamples = 0;

    const half = world.terrain.halfSize;
    for (let x = -half; x <= half; x += 14) {
      for (let z = -half; z <= half; z += 14) {
        const h = world.terrain.getHeightAt(x, z);
        if (h < world.terrain.waterLevel + 0.25 || h > 16.0) continue;
        if (world.terrain.getSlopeAt(x, z) > 0.28) continue;
        const biome = world.terrain.getBiomeAtKnownHeight(x, z, h);
        if (biome === 'desert' || biome === 'water') continue;

        const evalRes = world.mushrooms.evaluateHabitatWeight(x, z);
        if (evalRes.coastDist > 1.5 && evalRes.coastDist < 28) {
          nearSeaWeightSum += evalRes.weight;
          nearSeaSamples++;
        } else if (evalRes.coastDist >= 95) {
          if (evalRes.nearestTreeDist >= 0.8 && evalRes.nearestTreeDist <= MUSHROOM_NEAR_TREE_RADIUS) {
            nearTreeWeightSum += evalRes.weight;
            nearTreeSamples++;
          } else if (evalRes.nearestTreeDist > 9.0) {
            inlandOpenWeightSum += evalRes.weight;
            inlandOpenSamples++;
          }
        }
      }
    }

    expect(nearTreeSamples).toBeGreaterThan(40);
    expect(inlandOpenSamples).toBeGreaterThan(40);
    expect(nearSeaSamples).toBeGreaterThan(20);

    const avgNearTree = nearTreeWeightSum / nearTreeSamples;
    const avgInlandOpen = inlandOpenWeightSum / inlandOpenSamples;
    const avgNearSea = nearSeaWeightSum / nearSeaSamples;

    // Highest probability near trees, lower away from trees, lowest near the sea
    expect(avgNearTree).toBeGreaterThan(avgInlandOpen * 4.0);
    expect(avgInlandOpen).toBeGreaterThan(avgNearSea * 4.0);

    // 2. Empirical distribution across sprouted mushrooms over several simulated cycles
    const sampled = [...world.mushrooms.patches];
    for (let cycle = 0; cycle < 3; cycle++) {
      world.mushrooms.tick(world, 0.75);
      sampled.push(...world.mushrooms.patches);
    }
    // Deduplicate by patch id
    const unique = new Map(sampled.map((m) => [m.id, m]));
    const all = Array.from(unique.values());
    expect(all.length).toBeGreaterThan(650);

    let nearTreeCount = 0;
    let inlandOpenCount = 0;
    let nearSeaCount = 0;
    for (const m of all) {
      expect(world.terrain.getBiomeAtKnownHeight(m.x, m.z, m.y)).not.toBe('desert');
      expect(m.y).toBeGreaterThanOrEqual(world.terrain.waterLevel + 0.2);
      if (m.coastDistance < 28) nearSeaCount++;
      else if (m.nearestTreeDist <= MUSHROOM_NEAR_TREE_RADIUS) nearTreeCount++;
      else inlandOpenCount++;
    }

    // Strong majority of mushrooms appear near trees; near-sea appearances are the rarest
    expect(nearTreeCount / all.length).toBeGreaterThan(0.65);
    expect(nearSeaCount / all.length).toBeLessThan(0.03);
    expect(nearSeaCount).toBeLessThan(inlandOpenCount);
  });
});
