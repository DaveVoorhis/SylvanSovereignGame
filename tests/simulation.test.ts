import { describe, expect, it } from 'vitest';
import { EventBus } from '@core/EventBus';
import { HEARTH_FIRE_KEEP_OUT_RADIUS } from '@simulation/creatures/CreatureAI';
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
    15000,
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
});
