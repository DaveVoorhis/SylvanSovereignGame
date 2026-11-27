import { SeededRandom } from '@core/SeededRandom';
import type {
  ActiveDivineInfluence,
  DeityAspect,
  DeityStance,
  DivineEventType,
  PrayerIntent,
  SpeciesId,
  Vec2,
} from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import { ALL_SPECIES_IDS } from '@simulation/creatures/SpeciesCatalog';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import type { Settlement } from '@simulation/settlements/Settlement';
import type { WorldState } from '@simulation/WorldState';
import { DIVINE_EVENT_CATALOG } from './DivineEvents';

export const DEITY_STANCE_LABELS: Readonly<Record<DeityStance, string>> = {
  benevolent: 'Steward',
  neutral: 'Balanced',
  destructive: 'Exploiter',
};

export const PRAYER_INTENT_LABELS: Readonly<Record<PrayerIntent, string>> = {
  prosperity: 'Rewilding',
  peace: 'Climate Healing',
  drama: 'Habitat Destruction',
  mystery: 'Climate Crisis',
};

export interface DeityTraits {
  benevolence: number; // 0..1
  wrath: number; // 0..1
  chaos: number; // 0..1
  verdancy: number; // 0..1
  curiosity: number; // 0..1
}

export interface DeitySnapshot {
  readonly name: string;
  readonly epithet: string;
  readonly traits: DeityTraits;
  readonly aspect: DeityAspect;
  readonly stance?: DeityStance;
  readonly energy: number;
  readonly lastOmen: string;
  readonly lastActionName: string;
  readonly favoredSettlementId: string | null;
  readonly whisperCooldown: number;
  readonly decisionTimer: number;
  readonly effectSeq: number;
  readonly influenceSeq?: number;
  readonly settlementFavor: readonly [string, number][];
}

const DEITY_PREFIXES = [
  'Sylva', 'Oakh', 'Bramb', 'Vesper', 'Aurel', 'Thorn', 'Mire', 'Linden', 'Cinder', 'Moss',
];
const DEITY_SUFFIXES = [
  'arion', 'enis', 'orath', 'iel', 'wyn', 'os', 'alor', 'eth', 'irion', 'aeon',
];
const DEITY_EPITHETS = [
  'of the Deep Roots',
  'of the Gilded Bough',
  'of the Starlit Dew',
  'of the Whispering Bark',
  'of the Ember Hollow',
  'of the Turning Leaves',
];

const HEAT_HARDY_SPECIES = new Set<SpeciesId>([
  'snake',
  'fox',
  'cat',
  'crow',
  'pigeon',
  'owl',
  'sparrow',
]);

const COLD_HARDY_SPECIES = new Set<SpeciesId>([
  'bear',
  'wolf',
  'badger',
  'owl',
  'fox',
  'squirrel',
  'crow',
  'magpie',
]);

/**
 * The dynamically procedural "God" of the forest — a subtle ecological metaphor for
 * human influence upon the natural world.
 *
 * Interventions are intentionally rare, weighty, and enduring: sudden floods, climate
 * warming or cold snaps, habitat clearings, and ashen runoff force woodland civilizations
 * to adapt, rebuild, migrate, and tragically mourn losses; while deliberate acts of
 * rewilding, wildlife corridors, and stewardship heal scarred land and renew biodiversity.
 */
export class ProceduralGod {
  name: string;
  epithet: string;
  readonly traits: DeityTraits;

  aspect: DeityAspect = 'The Whispering Canopy';
  stance: DeityStance = 'neutral';
  energy = 36; // 0..100
  lastOmen = 'The valley rests in quiet balance beneath the ancient canopy.';
  lastActionName = 'Quiet Watch';
  favoredSettlementId: string | null = null;
  whisperCooldown = 0;

  private decisionTimer: number;
  private effectSeq = 1;
  private influenceSeq = 1;
  private hazardTickAccum = 0;
  private readonly settlementFavor = new Map<string, number>();

  constructor(seed: number, decisionIntervalSec: number) {
    const rng = new SeededRandom(seed ^ 0x9e3779b9);
    this.name = `${rng.pick(DEITY_PREFIXES)}${rng.pick(DEITY_SUFFIXES)}`;
    this.epithet = rng.pick(DEITY_EPITHETS);

    this.traits = {
      benevolence: rng.range(0.42, 0.72),
      wrath: rng.range(0.24, 0.52),
      chaos: rng.range(0.28, 0.62),
      verdancy: rng.range(0.46, 0.78),
      curiosity: rng.range(0.38, 0.75),
    };
    this.decisionTimer = decisionIntervalSec * 0.65;
    this.recomputeAspect();
  }

  receivePrayer(amount: number, settlementId: string): void {
    this.energy = Math.min(100, this.energy + amount * 0.65);
    this.traits.benevolence = this.clamp01(this.traits.benevolence + amount * 0.004);
    this.traits.verdancy = this.clamp01(this.traits.verdancy + amount * 0.003);
    this.traits.wrath = this.clamp01(this.traits.wrath - amount * 0.003);

    const prev = this.settlementFavor.get(settlementId) ?? 0;
    this.settlementFavor.set(settlementId, prev + amount);
    this.updateFavoredSettlement();
  }

  observeConflict(severity: number): void {
    this.traits.wrath = this.clamp01(this.traits.wrath + severity * 0.032);
    this.traits.chaos = this.clamp01(this.traits.chaos + severity * 0.022);
    this.traits.benevolence = this.clamp01(this.traits.benevolence - severity * 0.015);
    this.energy = Math.min(100, this.energy + severity * 1.4);
    this.recomputeAspect();
  }

  observeCivilizationMilestone(settlement: Settlement): void {
    // Rapid settlement growth subtly heightens ecological pressure (mirroring human expansion)
    this.traits.curiosity = this.clamp01(this.traits.curiosity + 0.05);
    this.traits.chaos = this.clamp01(this.traits.chaos + 0.05);
    this.traits.wrath = this.clamp01(this.traits.wrath + 0.035);
    this.traits.verdancy = this.clamp01(this.traits.verdancy - 0.04);
    const prev = this.settlementFavor.get(settlement.id) ?? 0;
    this.settlementFavor.set(settlement.id, prev + 8);
    this.updateFavoredSettlement();
    this.recomputeAspect();
  }

  /**
   * Continuous moral/ecological alignment in [-1, +1]:
   * +1 = Benevolent Steward (rewilding, climate healing, peaceful cooperation)
   *  0 = Neutral Balance
   * -1 = Destructive Exploiter (habitat destruction, climate crisis, warlike conflict)
   */
  getMoralAlignment(world?: WorldState): number {
    const traitBalance =
      (this.traits.benevolence + this.traits.verdancy) * 0.5 -
      (this.traits.wrath + this.traits.chaos) * 0.5;
    const stanceAnchor =
      this.stance === 'benevolent' ? 0.42 : this.stance === 'destructive' ? -0.42 : 0;
    const ecoBalance = world
      ? world.rewildingBoost * 0.16 -
        (world.climateHeat + world.climateFreeze * 0.7 + world.miasmaIntensity) * 0.18 -
        Math.min(0.28, world.habitatScars.length * 0.09)
      : 0;
    return Math.max(-1, Math.min(1, traitBalance + stanceAnchor + ecoBalance));
  }

  /** Summarizes how the deity's current moral/ecological influence shapes creature society. */
  getSocialClimate(world?: WorldState): {
    readonly label: string;
    readonly icon: string;
    readonly tone: 'good' | 'calm' | 'warn' | 'bad';
  } {
    const a = this.getMoralAlignment(world);
    if (a >= 0.35) {
      return { label: 'Peaceful & Cooperative', icon: '🕊', tone: 'good' };
    }
    if (a <= -0.45) {
      return { label: 'Warlike & Fractured', icon: '⚔️', tone: 'bad' };
    }
    if (a <= -0.18) {
      return { label: 'Tense & Competitive', icon: '⚡', tone: 'warn' };
    }
    return { label: 'Balanced & Cautious', icon: '⚖️', tone: 'calm' };
  }

  /**
   * Dynamically steers the deity's ongoing moral disposition (Good Steward, Neutral Balance,
   * or Destructive Exploiter) — immediately reshaping temperament, diplomatic tone, and upcoming acts.
   */
  setStance(stance: DeityStance, world: WorldState): string {
    const prev = this.stance;
    this.stance = stance;

    if (stance === 'benevolent') {
      this.traits.benevolence = this.clamp01(Math.max(0.80, this.traits.benevolence + 0.32));
      this.traits.verdancy = this.clamp01(Math.max(0.78, this.traits.verdancy + 0.30));
      this.traits.wrath = this.clamp01(Math.min(0.18, this.traits.wrath - 0.32));
      this.traits.chaos = this.clamp01(Math.min(0.22, this.traits.chaos - 0.28));
      this.energy = Math.max(this.energy, 68);
      this.decisionTimer = Math.min(this.decisionTimer, 5);
      this.lastOmen =
        'A sheltering stillness settles over the watershed; the unseen hand turns toward rewilding and climate healing.';
      if (prev !== stance) {
        world.diplomacy.applyRealmMoralShift(18, world, 'age of stewardship');
        this.shiftCreatureRelationships(16, world);
        world.chronicle.record(
          world.day,
          world.season,
          'deity',
          '🌱 A Turning Toward Stewardship',
          `${this.name} embraced benevolence and renewal — forests mend, skies clear, and woodland kin grow cooperative.`,
        );
      }
    } else if (stance === 'destructive') {
      this.traits.wrath = this.clamp01(Math.max(0.82, this.traits.wrath + 0.36));
      this.traits.chaos = this.clamp01(Math.max(0.78, this.traits.chaos + 0.32));
      this.traits.benevolence = this.clamp01(Math.min(0.16, this.traits.benevolence - 0.34));
      this.traits.verdancy = this.clamp01(Math.min(0.18, this.traits.verdancy - 0.32));
      this.energy = Math.max(this.energy, 68);
      this.decisionTimer = Math.min(this.decisionTimer, 5);
      this.lastOmen =
        'Smoke-tinged winds and restless ambition grip the realm; habitat destruction and climate crisis loom ahead.';
      if (prev !== stance) {
        world.diplomacy.applyRealmMoralShift(-26, world, 'scarcity and territorial strife');
        this.shiftCreatureRelationships(-22, world);
        world.chronicle.record(
          world.day,
          world.season,
          'deity',
          '🔥 An Era of Reckless Exploitation',
          `${this.name} turned ruthless and exploitative — habitats face clearing, climate stress mounts, and factions turn competitive and warlike.`,
        );
      }
    } else {
      this.traits.benevolence = this.clamp01(this.traits.benevolence * 0.5 + 0.27);
      this.traits.verdancy = this.clamp01(this.traits.verdancy * 0.5 + 0.28);
      this.traits.wrath = this.clamp01(this.traits.wrath * 0.5 + 0.19);
      this.traits.chaos = this.clamp01(this.traits.chaos * 0.5 + 0.21);
      this.lastOmen = 'The unseen hand releases its grip, letting woodland nature ebb and flow on its own.';
      if (prev !== stance) {
        world.chronicle.record(
          world.day,
          world.season,
          'deity',
          '⚖️ Return to Natural Balance',
          `${this.name} stepped back into neutral balance, letting seasons, diplomacy, and wild ecosystems unfold freely.`,
        );
      }
    }

    this.recomputeAspect();
    const label = DEITY_STANCE_LABELS[stance];
    return `${this.name} is now steered toward ${label}.`;
  }

  /**
   * Direct high-impact spectator invocation.
   * Immediately reshapes the deity's temperament AND manifests a visible ecological act
   * (rewilding, climate healing, habitat destruction, or climate crisis) with social fallout.
   */
  receiveSpectatorWhisper(intent: PrayerIntent, world: WorldState): string {
    if (this.whisperCooldown > 0) {
      return `${this.name} is still pondering the last whisper.`;
    }
    this.whisperCooldown = 10;
    this.energy = Math.min(100, Math.max(this.energy + 45, 72));

    const activeTypes = new Set(world.activeInfluences.map((inf) => inf.type));
    let chosenAct: DivineEventType;

    if (intent === 'prosperity') {
      // Rewilding: restore scarred woods, replant dense groves, foster harmony
      this.traits.benevolence = this.clamp01(this.traits.benevolence + 0.24);
      this.traits.verdancy = this.clamp01(this.traits.verdancy + 0.28);
      this.traits.wrath = this.clamp01(this.traits.wrath - 0.20);
      this.traits.chaos = this.clamp01(this.traits.chaos - 0.14);
      if (this.stance === 'destructive') this.stance = 'neutral';
      chosenAct = activeTypes.has('sanctuary_rewilding') ? 'migration_corridor' : 'sanctuary_rewilding';
      world.diplomacy.applyRealmMoralShift(14, world, 'shared rewilding effort');
      this.shiftCreatureRelationships(12, world);
    } else if (intent === 'peace') {
      // Climate Healing: actively quell ongoing climate crises, clear skies, reconcile rivals
      this.traits.benevolence = this.clamp01(this.traits.benevolence + 0.26);
      this.traits.verdancy = this.clamp01(this.traits.verdancy + 0.20);
      this.traits.wrath = this.clamp01(this.traits.wrath - 0.28);
      this.traits.chaos = this.clamp01(this.traits.chaos - 0.22);
      if (this.stance === 'destructive') this.stance = 'neutral';
      for (let i = world.activeInfluences.length - 1; i >= 0; i--) {
        if (world.activeInfluences[i].polarity === 'disruptive') {
          this.concludeInfluence(world.activeInfluences[i], world);
          world.activeInfluences.splice(i, 1);
        }
      }
      world.climateHeat *= 0.35;
      world.climateFreeze *= 0.35;
      world.miasmaIntensity *= 0.35;
      world.floodSurge *= 0.35;
      chosenAct = activeTypes.has('sunlit_blessing') ? 'migration_corridor' : 'sunlit_blessing';
      world.diplomacy.applyRealmMoralShift(26, world, 'climate healing accord');
      this.shiftCreatureRelationships(18, world);
    } else if (intent === 'drama') {
      // Habitat Destruction: immediately strip woodland canopy, scar earth, spark territorial competition
      this.traits.chaos = this.clamp01(this.traits.chaos + 0.26);
      this.traits.wrath = this.clamp01(this.traits.wrath + 0.24);
      this.traits.benevolence = this.clamp01(this.traits.benevolence - 0.22);
      this.traits.verdancy = this.clamp01(this.traits.verdancy - 0.26);
      if (this.stance === 'benevolent') this.stance = 'neutral';
      chosenAct = 'habitat_clearing';
      world.diplomacy.applyRealmMoralShift(-22, world, 'bitter habitat destruction');
      this.shiftCreatureRelationships(-18, world);
    } else {
      // Climate Crisis: trigger scorching drought, ashen smog, rising deluge, or polar snap
      this.traits.wrath = this.clamp01(this.traits.wrath + 0.28);
      this.traits.chaos = this.clamp01(this.traits.chaos + 0.24);
      this.traits.benevolence = this.clamp01(this.traits.benevolence - 0.24);
      this.traits.verdancy = this.clamp01(this.traits.verdancy - 0.22);
      if (this.stance === 'benevolent') this.stance = 'neutral';
      const climateDisasters: DivineEventType[] = [
        'scorching_drought',
        'ashen_miasma',
        'great_deluge',
        'polar_snap',
      ];
      const freshDisasters = climateDisasters.filter((t) => !activeTypes.has(t));
      chosenAct = world.rng.pick(freshDisasters.length > 0 ? freshDisasters : climateDisasters);
      world.diplomacy.applyRealmMoralShift(-24, world, 'climate crisis scarcity');
      this.shiftCreatureRelationships(-20, world);
    }

    this.recomputeAspect();
    // Keep active influence stack tidy so immediate spectator acts always manifest cleanly
    while (world.activeInfluences.length >= 2) {
      const oldest = world.activeInfluences.shift();
      if (oldest) this.concludeInfluence(oldest, world);
    }

    const intentLabel = PRAYER_INTENT_LABELS[intent].toLowerCase();
    const act = this.executeDivineAct(chosenAct, world);
    world.chronicle.record(
      world.day,
      world.season,
      'deity',
      'A Call Shapes the Canopy',
      `An unseen spectator whispered of ${intentLabel}; ${this.name} (${this.aspect}) answered with ${act.label}.`,
      act.position,
    );

    return `${this.name} heard your whisper of ${intentLabel} — ${act.icon} ${act.label}!`;
  }

  /** Shifts creature-to-creature friendships or rivalries across the realm when moral climate pivots. */
  private shiftCreatureRelationships(delta: number, world: WorldState): void {
    const alive = world.creatures.filter((c) => c.alive && c.isAdult());
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      // Adjust existing relationships
      for (const [otherId, score] of a.relationships.entries()) {
        const next = Math.max(-100, Math.min(100, score + delta * 0.7));
        a.relationships.set(otherId, next);
      }
      // Seed fresh rivalries or camaraderie among nearby peers so behavioral shift shows up fast
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        if (a.mateId === b.id || a.isCloseKinOf(b)) continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        if (dx * dx + dz * dz > 26 * 26) continue;
        if (world.rng.chance(0.32)) {
          a.adjustRelationship(b.id, delta);
          b.adjustRelationship(a.id, delta);
        }
      }
    }
  }

  tick(world: WorldState, dt: number): void {
    this.whisperCooldown = Math.max(0, this.whisperCooldown - dt);

    // Charge energy smoothly in proportion to the configured rarity interval
    const baseChargeRate = Math.max(0.68, 56 / Math.max(4, world.config.deityDecisionIntervalSec));
    const stanceRateBoost = this.stance === 'neutral' ? 1.0 : 1.45;
    this.energy = Math.min(
      100,
      this.energy + dt * (baseChargeRate * stanceRateBoost + this.traits.curiosity * 0.12),
    );

    // Advance any ongoing ecological upheavals / restorations
    this.tickActiveInfluences(world, dt);

    // Personality evolution: follows spectator's chosen stance, or drifts organically when balanced
    if (this.stance === 'benevolent') {
      const pull = dt * 0.032;
      this.traits.benevolence = this.clamp01(this.traits.benevolence + (0.88 - this.traits.benevolence) * pull);
      this.traits.verdancy = this.clamp01(this.traits.verdancy + (0.86 - this.traits.verdancy) * pull);
      this.traits.wrath = this.clamp01(this.traits.wrath + (0.12 - this.traits.wrath) * pull);
      this.traits.chaos = this.clamp01(this.traits.chaos + (0.16 - this.traits.chaos) * pull);
    } else if (this.stance === 'destructive') {
      const pull = dt * 0.032;
      this.traits.wrath = this.clamp01(this.traits.wrath + (0.90 - this.traits.wrath) * pull);
      this.traits.chaos = this.clamp01(this.traits.chaos + (0.86 - this.traits.chaos) * pull);
      this.traits.benevolence = this.clamp01(this.traits.benevolence + (0.10 - this.traits.benevolence) * pull);
      this.traits.verdancy = this.clamp01(this.traits.verdancy + (0.12 - this.traits.verdancy) * pull);
    } else {
      const drift = dt * 0.007;
      this.traits.benevolence = this.clamp01(this.traits.benevolence + (world.rng.next() - 0.5) * drift);
      this.traits.wrath = this.clamp01(this.traits.wrath + (world.rng.next() - 0.495) * drift);
      this.traits.chaos = this.clamp01(this.traits.chaos + (world.rng.next() - 0.495) * drift);
      this.traits.verdancy = this.clamp01(this.traits.verdancy + (world.rng.next() - 0.5) * drift);
      this.traits.curiosity = this.clamp01(this.traits.curiosity + (world.rng.next() - 0.495) * drift);
    }

    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return;

    const interval = world.config.deityDecisionIntervalSec;
    const stanceIntervalMult = this.stance === 'neutral' ? 1.0 : 0.56;
    this.decisionTimer = interval * stanceIntervalMult * world.rng.range(0.85, 1.3);

    this.recomputeAspect();
    if (this.energy < 52 || world.settlements.length === 0) return;

    // Neutral stays uncluttered (1 epoch); active Exploiter/Steward steering allows up to 2 compounding epochs
    const maxConcurrent = this.stance !== 'neutral' || interval < 20 ? 2 : 1;
    if (world.activeInfluences.length >= maxConcurrent) return;

    const chosenEvent = this.chooseDivineAct(world);
    this.executeDivineAct(chosenEvent, world);
  }

  /** Triggers a specific divine influence immediately (used internally and for deterministic testing). */
  triggerInfluence(
    type: DivineEventType,
    world: WorldState,
    explicitTarget?: Settlement | null,
  ): ActiveDivineInfluence {
    return this.executeDivineAct(type, world, explicitTarget);
  }

  private recomputeAspect(): void {
    const t = this.traits;
    if (t.wrath > 0.62) {
      this.aspect = 'The Ember-Eyed Judge';
    } else if (t.chaos > 0.65) {
      this.aspect = 'The Trickster of Thorns';
    } else if (t.verdancy > 0.68 && t.benevolence > 0.55) {
      this.aspect = 'The Golden Harvest';
    } else if (t.curiosity > 0.68) {
      this.aspect = 'The Mist-Walker';
    } else if (t.benevolence > 0.68) {
      this.aspect = 'The Hearth-Keeper';
    } else {
      this.aspect = 'The Whispering Canopy';
    }
  }

  private chooseDivineAct(world: WorldState): DivineEventType {
    const t = this.traits;
    const isWinter = world.season === 'winter';
    const isSummer = world.season === 'summer';
    const hasScars = world.habitatScars.length > 0;
    const totalBuildings = world.settlements.reduce((sum, s) => sum + s.getCompletedCount(), 0);
    const totalAlive = world.creatures.reduce((sum, c) => sum + (c.alive ? 1 : 0), 0);
    const crowdedFactor = Math.min(1.8, 0.75 + totalBuildings / 18 + totalAlive / 85);
    const activeTypes = new Set(world.activeInfluences.map((inf) => inf.type));

    const hasWaterfront = world.settlements.some(
      (s) =>
        s.adaptation === 'riverside_stilts' ||
        s.adaptation === 'coastal_harbor' ||
        s.adaptation === 'waterway_haven' ||
        world.terrain.getHeightAt(s.center.x, s.center.z) < world.terrain.waterLevel + 3.0,
    );

    // Subtle ecological pressure: expanding civilizations attract both disruption and restorative stewardship
    const weighted: { item: DivineEventType; weight: number }[] = [
      {
        item: 'great_deluge',
        weight:
          (t.wrath * 1.15 + t.chaos * 0.95 + 0.2) *
          (hasWaterfront ? 1.35 : 0.8) *
          (isWinter ? 0.55 : 1.05),
      },
      {
        item: 'scorching_drought',
        weight:
          (t.wrath * 1.1 + t.chaos * 0.85 + 0.18) *
          (isSummer ? 1.55 : isWinter ? 0.28 : 0.95) *
          crowdedFactor,
      },
      {
        item: 'habitat_clearing',
        weight: (t.chaos * 1.15 + t.wrath * 0.9 + 0.2) * crowdedFactor,
      },
      {
        item: 'ashen_miasma',
        weight: (t.wrath * 1.2 + t.chaos * 0.75 + 0.15) * (totalBuildings >= 5 ? crowdedFactor : 0.45),
      },
      {
        item: 'polar_snap',
        weight: (isWinter ? 1.55 : 0.55) * (t.chaos * 1.0 + t.wrath * 0.75 + 0.25),
      },
      {
        item: 'sanctuary_rewilding',
        weight:
          (t.verdancy * 1.35 + t.benevolence * 1.1 + 0.2) *
          (hasScars ? 2.4 : 1.0) *
          (isWinter ? 0.65 : 1.1),
      },
      {
        item: 'migration_corridor',
        weight:
          (t.curiosity * 1.25 + t.benevolence * 0.9 + 0.2) *
          (totalAlive < 24 ? 1.55 : 1.0),
      },
      {
        item: 'sunlit_blessing',
        weight: (t.benevolence * 1.35 + t.verdancy * 0.85 + 0.2) * (hasScars ? 1.35 : 1.0),
      },
    ];

    // Honor explicit spectator moral stance: Steward exclusively heals; Exploiter exclusively disrupts
    const stancePool =
      this.stance === 'benevolent'
        ? weighted.filter((w) => DIVINE_EVENT_CATALOG[w.item].polarity === 'restorative')
        : this.stance === 'destructive'
          ? weighted.filter((w) => DIVINE_EVENT_CATALOG[w.item].polarity === 'disruptive')
          : weighted;

    const filtered = stancePool.filter((w) => !activeTypes.has(w.item));
    return world.rng.weightedPick(filtered.length > 0 ? filtered : stancePool);
  }

  private executeDivineAct(
    type: DivineEventType,
    world: WorldState,
    explicitTarget?: Settlement | null,
  ): ActiveDivineInfluence {
    const def = DIVINE_EVENT_CATALOG[type];
    this.energy = Math.max(0, this.energy - def.energyCost);
    this.lastActionName = def.label;

    const targetSettlement =
      explicitTarget !== undefined ? explicitTarget : this.pickTargetSettlement(type, world);
    const position: Vec2 = this.pickInfluencePosition(type, targetSettlement, world);

    if (def.weatherShift) {
      world.setWeather(def.weatherShift, def.influenceDuration);
    }

    const severity = world.rng.range(0.82, 1.18);
    const influence: ActiveDivineInfluence = {
      id: this.influenceSeq++,
      type,
      label: def.label,
      icon: def.icon,
      polarity: def.polarity,
      position: { x: position.x, z: position.z },
      radius: def.radius,
      targetSettlementId: targetSettlement?.id ?? null,
      startedAt: world.elapsedSeconds,
      duration: def.influenceDuration,
      severity,
      casualties: 0,
      buildingsAffected: 0,
      treesAffected: 0,
      adaptationsTriggered: 0,
      migrationTriggered: false,
      summary: def.ecologicalReflection,
    };

    world.activeInfluences.push(influence);

    // Apply immediate dramatic impact & force adaptation
    switch (type) {
      case 'great_deluge':
        this.applyGreatDelugeImpact(influence, targetSettlement, world);
        break;
      case 'scorching_drought':
        this.applyScorchingDroughtImpact(influence, targetSettlement, world);
        break;
      case 'habitat_clearing':
        this.applyHabitatClearingImpact(influence, targetSettlement, world);
        break;
      case 'ashen_miasma':
        this.applyAshenMiasmaImpact(influence, targetSettlement, world);
        break;
      case 'polar_snap':
        this.applyPolarSnapImpact(influence, targetSettlement, world);
        break;
      case 'sanctuary_rewilding':
        this.applySanctuaryRewildingImpact(influence, targetSettlement, world);
        break;
      case 'migration_corridor':
        this.applyMigrationCorridorImpact(influence, targetSettlement, world);
        break;
      case 'sunlit_blessing':
        this.applyStewardsHarvestImpact(influence, targetSettlement, world);
        break;
    }

    // Natural cyclic ebb & flow: severe disruption softens wrath slightly so recovery can follow,
    // while restorative epochs let ecological tension slowly gather again later.
    if (this.stance === 'neutral') {
      if (def.polarity === 'disruptive') {
        this.traits.wrath = this.clamp01(this.traits.wrath - 0.08);
        this.traits.benevolence = this.clamp01(this.traits.benevolence + 0.05);
      } else {
        this.traits.verdancy = this.clamp01(this.traits.verdancy - 0.04);
        this.traits.chaos = this.clamp01(this.traits.chaos + 0.04);
      }
    }
    this.recomputeAspect();

    world.emitDivineEffect({
      id: this.effectSeq++,
      type,
      position,
      radius: def.radius,
      colorHex: def.colorHex,
      createdAt: world.elapsedSeconds,
      duration: def.duration,
    });

    world.chronicle.record(
      world.day,
      world.season,
      'deity',
      `${def.icon} ${def.label}`,
      `${this.lastOmen} ${def.ecologicalReflection}`,
      position,
    );

    return influence;
  }

  // ---------------------------------------------------------------------------
  // Immediate Dramatic Impact Handlers
  // ---------------------------------------------------------------------------

  private applyGreatDelugeImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the lower watershed';
    const floodAdapted = target ? this.isFloodAdaptedSettlement(target) : false;

    if (target) {
      // Floodwaters wash away ground-stored berries & acorns (stilt/waterway villages lose far less)
      const lossFrac = floodAdapted ? 0.16 : 0.48;
      target.stockpile.berries = Math.max(2, target.stockpile.berries * (1 - lossFrac));
      target.stockpile.acorns = Math.max(2, target.stockpile.acorns * (1 - lossFrac));

      // Unadapted lowland villages can suffer structural damage or collapse
      if (!floodAdapted) {
        const damaged = this.damageSettlementStructures(target, world, 2, true, 'floodwaters');
        influence.buildingsAffected += damaged;
      } else {
        influence.adaptationsTriggered++;
      }

      // Settlement learns flood resilience & prioritizes food storage and elevated/sturdy builds
      target.recordEnvironmentalAdaptation({ granary: 20, timber_house: 16, workshop: 12 }, 0.16);
      influence.adaptationsTriggered++;

      // Spook exposed non-aquatic creatures uphill; risk injury to frail lowland kin
      const targetPop = world.getSettlementPopulation(target.id);
      for (const c of world.creatures) {
        if (!c.alive) continue;
        const dist = Math.hypot(c.x - influence.position.x, c.z - influence.position.z);
        if (dist > influence.radius + 16 && c.settlementId !== target.id) continue;

        if (this.isFloodHardenedSpecies(c)) {
          c.thought = 'Navigating the surging currents with ease';
          continue;
        }
        c.mood = Math.max(12, c.mood - 24);
        c.energy = Math.max(10, c.energy - 18);
        c.thought = 'Fleeing the rising floodwaters for higher ground!';
        this.pushCreatureToHigherGround(c, target, world);

        const groundH = world.terrain.getHeightAt(c.x, c.z);
        const lowGroundExposure = groundH < world.terrain.waterLevel + 2.2 ? 1.0 : 0.45;
        const dmg =
          (floodAdapted ? 10 : 28) *
          lowGroundExposure *
          (1 - target.environmentalResilience * 0.45) *
          (c.lifeStage === 'elder' ? 1.35 : 1.0);
        this.applyEnvironmentalHarm(
          c,
          dmg,
          targetPop,
          influence,
          world,
          'Lost to the Rising Deluge',
          `${c.name} (${c.def.displayName}) was swept away when surging waters overwhelmed ${placeName}.`,
        );
      }
    }

    this.lastOmen = floodAdapted
      ? `Swollen waters surged through ${placeName}, yet its flood-adapted pilings and riverfolk endured the crest.`
      : `Torrential floodwaters burst their banks around ${placeName}, submerging lowlands and forcing kin to flee uphill.`;
  }

  private applyScorchingDroughtImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the sun-baked valley';
    const oasisAdapted = target?.adaptation === 'desert_oasis';

    // Parched earth withers forage nodes across a broad swath
    for (const node of world.terrain.resourceNodes) {
      if (node.type === 'stone') continue;
      const dist = Math.hypot(node.position.x - influence.position.x, node.position.z - influence.position.z);
      if (dist < influence.radius * 1.7) {
        const retain = node.type === 'timber' ? 0.65 : 0.22;
        node.amount = Math.max(1, node.amount * retain);
      }
    }

    if (target) {
      const spoilFrac = oasisAdapted ? 0.12 : 0.42;
      target.stockpile.berries = Math.max(2, target.stockpile.berries * (1 - spoilFrac));
      target.stockpile.herbs = Math.max(1, target.stockpile.herbs * (1 - spoilFrac));
      target.recordEnvironmentalAdaptation(
        { fountain_plaza: 24, greenhouse: 22, granary: 18 },
        0.15,
      );
      influence.adaptationsTriggered++;

      const targetPop = world.getSettlementPopulation(target.id);
      for (const c of world.creatures) {
        if (!c.alive) continue;
        if (c.settlementId !== target.id && Math.hypot(c.x - influence.position.x, c.z - influence.position.z) > influence.radius) {
          continue;
        }
        const hardy = HEAT_HARDY_SPECIES.has(c.species) || oasisAdapted;
        c.hunger = Math.min(95, c.hunger + (hardy ? 8 : 24));
        c.energy = Math.max(10, c.energy - (hardy ? 8 : 22));
        c.mood = Math.max(14, c.mood - (hardy ? 6 : 20));
        c.thought = hardy
          ? 'Enduring the relentless heat beneath shaded eaves'
          : 'The berry groves are parched — we must ration and seek water!';

        if (!hardy) {
          const dmg =
            22 *
            (1 - target.environmentalResilience * 0.45) *
            (c.lifeStage === 'elder' ? 1.4 : 1.0);
          this.applyEnvironmentalHarm(
            c,
            dmg,
            targetPop,
            influence,
            world,
            'Claimed by the Long Scorch',
            `${c.name} (${c.def.displayName}) succumbed to heat and drought during the Long Scorch around ${placeName}.`,
          );
        }
      }
    }

    this.lastOmen = oasisAdapted
      ? `A blistering heatwave rolled across ${placeName}, though its cisterns and desert-wise kin weathered the glare.`
      : `A punishing climate fever descended on ${placeName}, parching wild groves and straining every harvest.`;
  }

  private applyHabitatClearingImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the ancient timberland';

    // Carve a persistent cleared scar into the forest canopy (~3 game days to naturally regrow)
    const scarRadius = world.rng.range(28, 36);
    const scar = world.addHabitatScar(influence.position.x, influence.position.z, scarRadius, 310);

    // Count trees visibly felled inside the scar
    let felledTrees = 0;
    const rSq = scar.radius * scar.radius;
    for (const tree of world.terrain.trees) {
      const dx = tree.x - scar.x;
      const dz = tree.z - scar.z;
      if (dx * dx + dz * dz < rSq) {
        felledTrees++;
      }
    }
    influence.treesAffected = felledTrees;

    // Strip organic resource nodes inside the cleared habitat scar down to bare ground
    for (const node of world.terrain.resourceNodes) {
      if (node.type === 'stone') continue;
      const dx = node.position.x - scar.x;
      const dz = node.position.z - scar.z;
      if (dx * dx + dz * dz < (scar.radius + 10) * (scar.radius + 10)) {
        node.amount = Math.max(0.5, node.amount * 0.08);
      }
    }

    if (target) {
      // Collapse or damage outlying structures caught by habitat destruction
      const damaged = this.damageSettlementStructures(target, world, 2, true, 'the great clearing');
      influence.buildingsAffected += damaged;
      target.recordEnvironmentalAdaptation({ greenhouse: 24, workshop: 18, granary: 14 }, 0.16);
      influence.adaptationsTriggered++;

      const targetPop = world.getSettlementPopulation(target.id);
      for (const c of world.creatures) {
        if (!c.alive) continue;
        const dist = Math.hypot(c.x - scar.x, c.z - scar.z);
        if (dist > scar.radius + 18 && c.settlementId !== target.id) continue;

        c.mood = Math.max(10, c.mood - 28);
        c.thought = 'Our woodland grove was stripped bare — we must adapt or seek new woods!';
        if (dist < scar.radius + 4) {
          c.activity = 'fleeing';
          c.actionTimer = 8;
          const awayAngle = Math.atan2(c.z - scar.z, c.x - scar.x);
          c.targetX = c.x + Math.cos(awayAngle) * 18;
          c.targetZ = c.z + Math.sin(awayAngle) * 18;

          const dmg =
            (c.def.aerial ? 12 : 30) *
            (1 - target.environmentalResilience * 0.4) *
            (c.lifeStage === 'elder' ? 1.3 : 1.0);
          this.applyEnvironmentalHarm(
            c,
            dmg,
            targetPop,
            influence,
            world,
            'Fell Beneath the Clearing',
            `${c.name} (${c.def.displayName}) perished when ancient timber collapsed near ${placeName}.`,
          );
        }
      }
    }

    const treeText = felledTrees > 0 ? `${felledTrees} towering trees were felled` : 'wide foraging grounds were stripped bare';
    this.lastOmen = `A sudden clearing carved through the woods beside ${placeName}: ${treeText}, fragmenting shelter and forage.`;
  }

  private applyAshenMiasmaImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the crowded valley';

    // Contaminate nearby berries, herbs, and watershed forage
    for (const node of world.terrain.resourceNodes) {
      if (node.type !== 'berries' && node.type !== 'herbs' && node.type !== 'acorns') continue;
      const dist = Math.hypot(node.position.x - influence.position.x, node.position.z - influence.position.z);
      if (dist < influence.radius + 14) {
        node.amount = Math.max(1, node.amount * 0.2);
      }
    }

    if (target) {
      // Green & sacred civic buildings buffer pollution (subtly teaching ecological buffers!)
      const buffers =
        target.getCompletedCount('greenhouse') +
        target.getCompletedCount('shrine') +
        target.getCompletedCount('aquatic_sanctuary') +
        target.getCompletedCount('fountain_plaza') +
        target.getCompletedCount('tide_shrine');
      const mitigation = Math.min(0.68, buffers * 0.16 + target.environmentalResilience * 0.35);

      target.stockpile.herbs = Math.max(0, target.stockpile.herbs * (0.45 + mitigation * 0.4));
      target.recordEnvironmentalAdaptation(
        { greenhouse: 26, shrine: 20, aquatic_sanctuary: 26, fountain_plaza: 20 },
        0.16,
      );
      influence.adaptationsTriggered++;

      const targetPop = world.getSettlementPopulation(target.id);
      for (const c of world.creatures) {
        if (!c.alive) continue;
        const dist = Math.hypot(c.x - influence.position.x, c.z - influence.position.z);
        if (dist > influence.radius + 10 && c.settlementId !== target.id) continue;

        const watershedSensitive = c.def.aquatic || c.def.amphibious || c.def.strictlyAquatic;
        c.mood = Math.max(10, c.mood - (watershedSensitive ? 30 : 20) * (1 - mitigation * 0.5));
        c.thought = watershedSensitive
          ? 'The stream tastes bitter with ash — seeking clean water!'
          : 'A bitter smoky pall hangs over our roofs — gathering near the sanctuary!';

        const dmg =
          (watershedSensitive ? 32 : 20) *
          (1 - mitigation) *
          (c.lifeStage === 'elder' ? 1.35 : 1.0);
        this.applyEnvironmentalHarm(
          c,
          dmg,
          targetPop,
          influence,
          world,
          'Overcome by the Ashen Pall',
          `${c.name} (${c.def.displayName}) fell ill and passed beneath the bitter runoff fouling ${placeName}.`,
        );
      }
    }

    this.lastOmen = `An acrid pall and fouled runoff settled over ${placeName}, sickening the waterside and testing the village's sanctuaries.`;
  }

  private applyPolarSnapImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the valley';
    const mountainAdapted = target?.adaptation === 'mountain_stone';

    for (const node of world.terrain.resourceNodes) {
      if (node.type === 'berries' || node.type === 'herbs') {
        node.amount = Math.max(1, node.amount * 0.38);
      }
    }

    if (target) {
      const pop = world.getSettlementPopulation(target.id);
      const housing = target.getHousingCapacity();
      const crowdingRatio = Math.max(0, (pop - housing) / Math.max(1, pop));

      target.recordEnvironmentalAdaptation(
        { burrow_cottage: 20, timber_house: 22, bakery: 18, granary: 16 },
        0.15,
      );
      influence.adaptationsTriggered++;

      for (const c of world.creatures) {
        if (!c.alive) continue;
        if (c.settlementId !== target.id && Math.hypot(c.x - influence.position.x, c.z - influence.position.z) > influence.radius) {
          continue;
        }
        const coldHardy = COLD_HARDY_SPECIES.has(c.species) || mountainAdapted;
        c.energy = Math.max(8, c.energy - (coldHardy ? 10 : 24));
        c.hunger = Math.min(95, c.hunger + (coldHardy ? 6 : 18));
        c.thought = coldHardy
          ? 'Braving the biting freeze in thick winter fur'
          : 'A sudden freeze locked the boughs — huddling toward the hearth!';

        if (!coldHardy) {
          const exposure = (0.65 + crowdingRatio * 1.1) * (1 - target.environmentalResilience * 0.4);
          const dmg = 20 * exposure * (c.lifeStage === 'elder' ? 1.4 : 1.0);
          this.applyEnvironmentalHarm(
            c,
            dmg,
            pop,
            influence,
            world,
            'Lost to the Unseasonal Freeze',
            `${c.name} (${c.def.displayName}) could not survive the sudden deep freeze that struck ${placeName}.`,
          );
        }
      }
    }

    this.lastOmen = mountainAdapted
      ? `A sudden polar freeze swept ${placeName}, though its stone hearths and fur-clad kin held fast.`
      : `An unseasonal arctic freeze gripped ${placeName}, locking berries in ice and driving every creature toward shelter.`;
  }

  private applySanctuaryRewildingImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the woodland heartland';

    // Heal & regrow active cleared habitat scars (trees visibly return!)
    const healedScars = world.healHabitatScars(influence.position, 180);
    influence.treesAffected = healedScars;

    // Purge active miasma or scorching drought
    for (let i = world.activeInfluences.length - 1; i >= 0; i--) {
      const other = world.activeInfluences[i];
      if (other.id !== influence.id && (other.type === 'ashen_miasma' || other.type === 'scorching_drought')) {
        world.activeInfluences.splice(i, 1);
      }
    }

    // Overflowing ecological renewal of resource nodes
    for (const node of world.terrain.resourceNodes) {
      const dist = Math.hypot(node.position.x - influence.position.x, node.position.z - influence.position.z);
      if (dist < influence.radius * 1.65) {
        node.amount = node.maxAmount;
      }
    }

    if (target) {
      target.stockpile.berries += 22;
      target.stockpile.acorns += 18;
      target.stockpile.herbs += 16;
      target.stockpile.timber += 16;
    }

    for (const c of world.creatures) {
      if (!c.alive) continue;
      if (
        (target && c.settlementId === target.id) ||
        Math.hypot(c.x - influence.position.x, c.z - influence.position.z) < influence.radius + 20
      ) {
        c.health = c.maxHealth;
        c.mood = Math.min(100, c.mood + 28);
        c.devotion = Math.min(100, c.devotion + 18);
        c.reproductionCooldown = Math.max(0, c.reproductionCooldown - 24);
        c.thought = healedScars > 0
          ? 'Fresh saplings are reclaiming the scarred clearing!'
          : 'Wildflowers and berry boughs are flourishing everywhere!';
      }
    }

    this.lastOmen =
      healedScars > 0
        ? `Protected roots surged back across ${placeName}, regrowing ${healedScars} scarred clearing${healedScars > 1 ? 's' : ''} and renewing wild forage.`
        : `A wave of living rewilding swept across ${placeName}, restoring lush groves, clean herbs, and vibrant woodland life.`;
  }

  private applyMigrationCorridorImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the valley';
    let arrivals = 0;

    if (target) {
      const aliveTotal = world.creatures.filter((c) => c.alive).length;
      const room = Math.max(0, world.config.maxPopulation - aliveTotal);
      const count = Math.min(room, world.rng.int(2, 4));

      // Prefer biome-adapted or underrepresented species to restore biodiversity!
      const profile = target.getAdaptationProfile();
      const existingCounts = new Map<SpeciesId, number>();
      for (const c of world.creatures) {
        if (c.alive && c.settlementId === target.id) {
          existingCounts.set(c.species, (existingCounts.get(c.species) ?? 0) + 1);
        }
      }
      const candidateSpecies = [...profile.adaptedSpecies].sort(
        (a, b) => (existingCounts.get(a) ?? 0) - (existingCounts.get(b) ?? 0),
      );
      const chosenSpecies =
        candidateSpecies[0] ?? world.rng.pick(ALL_SPECIES_IDS);

      const spawned: Creature[] = [];
      for (let i = 0; i < count; i++) {
        const sp = i < 2 ? chosenSpecies : candidateSpecies[1] ?? chosenSpecies;
        const role = i === 0 ? 'builder' : i === 1 ? 'forager' : 'merchant';
        const newcomer = world.spawnCreature(target, sp, role, {
          ageDays: world.rng.range(2.2, 4.5),
          reproductionCooldown: world.rng.range(6, 16),
        });
        newcomer.thought = `Arrived via the sheltered wildlife corridor to help ${target.name} thrive!`;
        spawned.push(newcomer);
        arrivals++;
      }

      // Pair first two arrivals if same species so returning wildlife can raise new generations
      if (spawned.length >= 2 && spawned[0].species === spawned[1].species) {
        world.pairCreatures(spawned[0], spawned[1], target.name);
      }

      // Advance under-construction bridges and civic buildings along the corridor
      for (const br of world.bridges) {
        if (!br.completed) {
          br.progress = Math.min(99, br.progress + 65);
          influence.buildingsAffected++;
        }
      }
      for (const b of target.buildings) {
        if (!b.completed && !b.disassembling) {
          b.progress = Math.min(99, b.progress + 50);
          influence.buildingsAffected++;
        }
      }

      // Knit fractured diplomacy across the realm
      for (const other of world.settlements) {
        if (other.id === target.id) continue;
        world.diplomacy.adjustRelation(target, other, 24, world, 'sheltered wildlife corridor');
      }
      influence.adaptationsTriggered++;
    }

    this.lastOmen =
      arrivals > 0
        ? `A sheltered corridor opened into ${placeName}, welcoming ${arrivals} returning woodland kin and knitting neighbor villages together.`
        : `Sheltered wildlife passages linked ${placeName} to neighboring groves, easing tensions and speeding river crossings.`;
  }

  private applyStewardsHarvestImpact(
    influence: ActiveDivineInfluence,
    target: Settlement | null,
    world: WorldState,
  ): void {
    const placeName = target?.name ?? 'the realm';

    // Calm active floods or scorching drought
    for (let i = world.activeInfluences.length - 1; i >= 0; i--) {
      const other = world.activeInfluences[i];
      if (other.id !== influence.id && (other.type === 'great_deluge' || other.type === 'scorching_drought')) {
        world.activeInfluences.splice(i, 1);
      }
    }

    if (target) {
      target.stockpile.timber += 22;
      target.stockpile.berries += 24;
      target.stockpile.acorns += 20;
      target.stockpile.herbs += 12;
      target.stockpile.stone += 12;

      for (const b of target.buildings) {
        if (!b.completed && !b.disassembling) {
          b.progress = Math.min(99, b.progress + 58);
          influence.buildingsAffected++;
        }
      }

      for (const c of world.creatures) {
        if (c.alive && c.settlementId === target.id) {
          c.health = c.maxHealth;
          c.energy = 100;
          c.hunger = Math.max(5, c.hunger - 35);
          c.mood = Math.min(100, c.mood + 26);
          c.devotion = Math.min(100, c.devotion + 14);
          c.thought = 'Warm stewardship fills our granaries and mends broken roofs!';
        }
      }
    }

    this.lastOmen = `Generous sunbeams crowned ${placeName}, refilling granaries, healing weary kin, and speeding the rebuilding of broken roofs.`;
  }

  // ---------------------------------------------------------------------------
  // Ongoing Multi-Minute Epoch Tick & Adaptation Loops
  // ---------------------------------------------------------------------------

  private tickActiveInfluences(world: WorldState, dt: number): void {
    // 1. Compute target global environmental anomaly levels from active influences
    let targetFlood = 0;
    let targetHeat = this.stance === 'destructive' ? 0.28 : 0;
    let targetFreeze = 0;
    let targetMiasma = this.stance === 'destructive' ? 0.22 : 0;
    let targetRewilding = this.stance === 'benevolent' ? 0.28 : 0;

    for (let i = world.activeInfluences.length - 1; i >= 0; i--) {
      const inf = world.activeInfluences[i];
      const elapsed = world.elapsedSeconds - inf.startedAt;
      if (elapsed >= inf.duration) {
        this.concludeInfluence(inf, world);
        world.activeInfluences.splice(i, 1);
        continue;
      }

      const pct = elapsed / inf.duration;
      // Smooth envelope: rise over first 18%, plateau across core, ease down over final 24%
      const env =
        pct < 0.18
          ? pct / 0.18
          : pct > 0.76
            ? Math.max(0, (1 - pct) / 0.24)
            : 1.0;

      if (inf.type === 'great_deluge') {
        targetFlood = Math.max(targetFlood, 1.12 * inf.severity * env);
      } else if (inf.type === 'scorching_drought') {
        targetHeat = Math.max(targetHeat, env);
      } else if (inf.type === 'polar_snap') {
        targetFreeze = Math.max(targetFreeze, env);
      } else if (inf.type === 'ashen_miasma') {
        targetMiasma = Math.max(targetMiasma, env);
      } else if (inf.type === 'sanctuary_rewilding' || inf.type === 'sunlit_blessing') {
        targetRewilding = Math.max(targetRewilding, env);
      }
    }

    const healRateBoost = this.stance === 'benevolent' ? 1.85 : 1.0;
    const rate = Math.min(1, dt * 0.45 * healRateBoost);
    world.floodSurge += (targetFlood - world.floodSurge) * rate;
    world.climateHeat += (targetHeat - world.climateHeat) * rate;
    world.climateFreeze += (targetFreeze - world.climateFreeze) * rate;
    world.miasmaIntensity += (targetMiasma - world.miasmaIntensity) * rate;
    world.rewildingBoost += (targetRewilding - world.rewildingBoost) * rate;

    if (world.floodSurge < 0.004 && targetFlood === 0) world.floodSurge = 0;
    if (world.climateHeat < 0.004 && targetHeat === 0) world.climateHeat = 0;
    if (world.climateFreeze < 0.004 && targetFreeze === 0) world.climateFreeze = 0;
    if (world.miasmaIntensity < 0.004 && targetMiasma === 0) world.miasmaIntensity = 0;
    if (world.rewildingBoost < 0.004 && targetRewilding === 0) world.rewildingBoost = 0;

    if (world.activeInfluences.length === 0) return;

    // 2. Periodic ecological pressure & adaptation pulse (every 3.0s so cost is negligible)
    this.hazardTickAccum += dt;
    if (this.hazardTickAccum < 3.0) return;
    const stepSec = this.hazardTickAccum;
    this.hazardTickAccum = 0;

    for (const inf of world.activeInfluences) {
      this.pulseInfluenceEffects(inf, world, stepSec);
    }
  }

  private pulseInfluenceEffects(
    inf: ActiveDivineInfluence,
    world: WorldState,
    stepSec: number,
  ): void {
    const target = inf.targetSettlementId ? world.getSettlement(inf.targetSettlementId) : null;
    const elapsed = world.elapsedSeconds - inf.startedAt;

    // Forced adaptation migration: after enduring ~25% of a disruptive upheaval, resilient survivors
    // may pack up and trek to found a new refuge settlement in safer terrain!
    if (
      inf.polarity === 'disruptive' &&
      !inf.migrationTriggered &&
      target &&
      elapsed >= inf.duration * 0.22
    ) {
      inf.migrationTriggered = true;
      const shouldMigrate =
        (inf.type === 'habitat_clearing' ||
          inf.type === 'great_deluge' ||
          inf.type === 'scorching_drought' ||
          inf.type === 'ashen_miasma') &&
        world.rng.chance(0.72);
      if (shouldMigrate) {
        const reason =
          inf.type === 'great_deluge'
            ? 'seeking higher ground after the Rising Deluge'
            : inf.type === 'habitat_clearing'
              ? 'seeking intact woodland after the Great Clearing'
              : inf.type === 'scorching_drought'
                ? 'seeking cooler pastures during the Long Scorch'
                : 'seeking cleaner air beyond the Ashen Pall';
        const migrated = world.settlementManager.triggerAdaptationMigration(
          target,
          world,
          reason,
          inf.type === 'great_deluge',
        );
        if (migrated) {
          inf.adaptationsTriggered++;
        }
      }
    }

    // Apply sustained ecological effects to creatures inside the influence zone
    const effWater = world.getEffectiveWaterLevel();
    for (const c of world.creatures) {
      if (!c.alive) continue;
      const home = world.getSettlement(c.settlementId);
      const dist = Math.hypot(c.x - inf.position.x, c.z - inf.position.z);
      const inZone =
        dist <= inf.radius + 14 ||
        (inf.targetSettlementId !== null && c.settlementId === inf.targetSettlementId);

      if (inf.type === 'great_deluge') {
        if (!inZone) continue;
        if (this.isFloodHardenedSpecies(c)) continue;
        const groundH = world.terrain.getHeightAt(c.x, c.z);
        if (groundH < effWater + 0.15) {
          c.energy = Math.max(5, c.energy - stepSec * 2.4);
          const pop = home ? world.getSettlementPopulation(home.id) : 0;
          const adapted = home ? this.isFloodAdaptedSettlement(home) : false;
          if (!adapted) {
            this.applyEnvironmentalHarm(
              c,
              stepSec * 2.2 * (c.lifeStage === 'elder' ? 1.3 : 1.0),
              pop,
              inf,
              world,
              'Lost to the Rising Deluge',
              `${c.name} (${c.def.displayName}) was overcome by lingering floodwaters near ${home?.name ?? 'the valley'}.`,
            );
          }
          if (c.alive && home) {
            this.pushCreatureToHigherGround(c, home, world);
          }
        }
      } else if (inf.type === 'scorching_drought') {
        // Realm-wide warming, strongest near epicenter
        const intensity = inZone ? 1.0 : 0.45;
        const oasis = home?.adaptation === 'desert_oasis';
        if (HEAT_HARDY_SPECIES.has(c.species) || oasis) continue;
        c.hunger = Math.min(100, c.hunger + stepSec * 0.75 * intensity);
        c.energy = Math.max(8, c.energy - stepSec * 0.9 * intensity);
        if (inZone && c.hunger > 82) {
          const pop = home ? world.getSettlementPopulation(home.id) : 0;
          this.applyEnvironmentalHarm(
            c,
            stepSec * 2.0 * (c.lifeStage === 'elder' ? 1.35 : 1.0),
            pop,
            inf,
            world,
            'Claimed by the Long Scorch',
            `${c.name} (${c.def.displayName}) perished from famine and heat in ${home?.name ?? 'the parched valley'}.`,
          );
        }
      } else if (inf.type === 'ashen_miasma') {
        if (!inZone) continue;
        const buffers = home
          ? home.getCompletedCount('greenhouse') +
            home.getCompletedCount('shrine') +
            home.getCompletedCount('aquatic_sanctuary') +
            home.getCompletedCount('fountain_plaza')
          : 0;
        const mitigation = Math.min(0.72, buffers * 0.16 + (home?.environmentalResilience ?? 0) * 0.35);
        const sensitive = c.def.aquatic || c.def.amphibious || c.def.strictlyAquatic;
        c.mood = Math.max(8, c.mood - stepSec * (sensitive ? 2.0 : 1.1) * (1 - mitigation));
        const pop = home ? world.getSettlementPopulation(home.id) : 0;
        this.applyEnvironmentalHarm(
          c,
          stepSec * (sensitive ? 2.4 : 1.35) * (1 - mitigation),
          pop,
          inf,
          world,
          'Overcome by the Ashen Pall',
          `${c.name} (${c.def.displayName}) succumbed to lingering toxic haze in ${home?.name ?? 'the valley'}.`,
        );
      } else if (inf.type === 'polar_snap') {
        const mountain = home?.adaptation === 'mountain_stone';
        if (COLD_HARDY_SPECIES.has(c.species) || mountain) continue;
        const farFromHearth = home
          ? Math.hypot(c.x - home.center.x, c.z - home.center.z) > home.radius + 6
          : true;
        if (farFromHearth) {
          c.energy = Math.max(5, c.energy - stepSec * 1.45);
          c.hunger = Math.min(100, c.hunger + stepSec * 0.55);
          if (inZone && c.energy < 22) {
            const pop = home ? world.getSettlementPopulation(home.id) : 0;
            this.applyEnvironmentalHarm(
              c,
              stepSec * 2.1 * (c.lifeStage === 'elder' ? 1.35 : 1.0),
              pop,
              inf,
              world,
              'Lost to the Unseasonal Freeze',
              `${c.name} (${c.def.displayName}) succumbed to exposure during the Unseasonal Freeze near ${home?.name ?? 'the woods'}.`,
            );
          }
        }
      } else if (inf.type === 'sanctuary_rewilding' || inf.type === 'sunlit_blessing') {
        if (!inZone) continue;
        c.health = Math.min(c.maxHealth, c.health + stepSec * 4.5);
        c.mood = Math.min(100, c.mood + stepSec * 2.4);
        c.energy = Math.min(100, c.energy + stepSec * 2.2);
      }
    }
  }

  private concludeInfluence(inf: ActiveDivineInfluence, world: WorldState): void {
    const target = inf.targetSettlementId ? world.getSettlement(inf.targetSettlementId) : null;
    const place = target?.name ?? 'the realm';

    if (inf.polarity === 'disruptive') {
      const notes: string[] = [];
      if (inf.treesAffected > 0) notes.push(`${inf.treesAffected} trees lost`);
      if (inf.buildingsAffected > 0) {
        notes.push(`${inf.buildingsAffected} structure${inf.buildingsAffected > 1 ? 's' : ''} battered`);
      }
      if (inf.casualties > 0) {
        notes.push(`${inf.casualties} woodland kin mourned`);
      }
      if (inf.migrationTriggered) {
        notes.push('pioneers set out to adapt elsewhere');
      }
      const tally = notes.length > 0 ? ` (${notes.join('; ')})` : '';
      world.chronicle.record(
        world.day,
        world.season,
        'nature',
        `Aftermath of ${inf.label}`,
        `${inf.label} finally eased around ${place}${tally}. Survivors now mend their homes and adapt to the changed land.`,
        inf.position,
      );
    } else {
      world.chronicle.record(
        world.day,
        world.season,
        'nature',
        `Legacy of ${inf.label}`,
        `The radiance of ${inf.label} faded over ${place}, leaving healthier soil, renewed lineages, and resilient communities behind.`,
        inf.position,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Ecological & Resilience Helpers
  // ---------------------------------------------------------------------------

  private isFloodAdaptedSettlement(s: Settlement): boolean {
    return s.adaptation === 'riverside_stilts' || s.adaptation === 'waterway_haven';
  }

  private isFloodHardenedSpecies(c: Creature): boolean {
    return Boolean(c.def.aquatic || c.def.amphibious || c.def.strictlyAquatic || c.def.aerial);
  }

  private pushCreatureToHigherGround(c: Creature, home: Settlement, world: WorldState): void {
    if (c.activity === 'emigrating' || c.activity === 'fighting') return;
    let bestX = home.center.x;
    let bestZ = home.center.z;
    let bestH = world.terrain.getHeightAt(bestX, bestZ);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const candX = home.center.x + Math.cos(a) * Math.min(18, home.radius + 6);
      const candZ = home.center.z + Math.sin(a) * Math.min(18, home.radius + 6);
      if (!world.terrain.isWithinPlayableArea(candX, candZ, 8)) continue;
      const h = world.terrain.getHeightAt(candX, candZ);
      if (h > bestH) {
        bestH = h;
        bestX = candX;
        bestZ = candZ;
      }
    }
    c.activity = 'fleeing';
    c.actionTimer = Math.max(c.actionTimer, 6.5);
    c.targetX = bestX;
    c.targetZ = bestZ;
  }

  /**
   * Damages or collapses outlying structures in a settlement during a severe upheaval,
   * always preserving at least 2 core completed structures so survivors can rebuild.
   */
  private damageSettlementStructures(
    settlement: Settlement,
    world: WorldState,
    maxAffected: number,
    allowCollapse: boolean,
    causeLabel: string,
  ): number {
    const completed = settlement.buildings.filter((b) => b.completed && !b.disassembling);
    if (completed.length < 4) return 0;

    // Prefer outlying buildings farthest from the central hearth
    const sorted = [...completed].sort((a, b) => {
      const da = Math.hypot(a.position.x - settlement.center.x, a.position.z - settlement.center.z);
      const db = Math.hypot(b.position.x - settlement.center.x, b.position.z - settlement.center.z);
      return db - da;
    });

    const removableBudget = Math.min(maxAffected, completed.length - 2);
    let affected = 0;

    for (let i = 0; i < removableBudget && i < sorted.length; i++) {
      const bld = sorted[i];
      const bp = BUILDING_CATALOG[bld.type];
      if (allowCollapse && i === 0 && completed.length >= 6 && world.rng.chance(0.55)) {
        // Collapse one outlying structure, salvaging some timber & stone for rebuilding
        const idx = settlement.buildings.findIndex((b) => b.id === bld.id);
        if (idx !== -1) {
          settlement.buildings.splice(idx, 1);
          settlement.stockpile.timber += Math.round((bp.cost.timber ?? 0) * 0.35);
          settlement.stockpile.stone += Math.round((bp.cost.stone ?? 0) * 0.35);
          world.chronicle.record(
            world.day,
            world.season,
            'settlement',
            `${bp.displayName} Collapsed`,
            `A ${bp.displayName} on the edge of ${settlement.name} was lost to ${causeLabel}.`,
            bld.position,
          );
          affected++;
        }
      } else {
        // Severely batter the structure back into framing/foundation so builders swarm to repair it!
        bld.completed = false;
        bld.progress = Math.round(world.rng.range(36, 56));
        affected++;
      }
    }

    if (affected > 0) {
      settlement.recalculateTierAndRadius();
      world.structureRevision++;
    }
    return affected;
  }

  /**
   * Applies environmental damage to a creature with compassionate settlement-survival safeguards:
   * catastrophes can tragically claim exposed or frail kin, while never wiping a settlement below
   * 3 survivors or exceeding ~25% casualties in a single event so adaptation & recovery stay alive.
   */
  private applyEnvironmentalHarm(
    creature: Creature,
    damage: number,
    settlementPop: number,
    influence: ActiveDivineInfluence,
    world: WorldState,
    causeTitle: string,
    causeDetail: string,
  ): void {
    if (!creature.alive || damage <= 0) return;

    const maxCasualtiesForEvent = Math.min(5, Math.max(1, Math.floor(settlementPop * 0.25)));
    const canBeFatal =
      settlementPop > 3 &&
      influence.casualties < maxCasualtiesForEvent &&
      creature.lifeStage !== 'young'; // Spare tiny newborns from instant shock fatalities unless extreme

    const nextHealth = creature.health - damage;
    if (nextHealth <= 0) {
      if (canBeFatal) {
        world.recordEnvironmentalLoss(creature, causeTitle, causeDetail, influence);
      } else {
        // Severely battered survivor who clings to life and seeks shelter
        creature.health = Math.max(4, creature.maxHealth * 0.14);
        creature.mood = Math.max(8, creature.mood - 12);
      }
    } else {
      creature.health = nextHealth;
    }
  }

  private pickTargetSettlement(type: DivineEventType, world: WorldState): Settlement | null {
    if (world.settlements.length === 0) return null;
    const def = DIVINE_EVENT_CATALOG[type];

    if (type === 'great_deluge') {
      // Prefer riverside, coastal, or lowest-lying settlements for authentic flood storytelling
      const byElevation = [...world.settlements].sort((a, b) => a.groundY - b.groundY);
      return byElevation[0];
    }

    if (type === 'habitat_clearing') {
      const forested = world.settlements.filter(
        (s) => s.adaptation === 'forest_canopy' || s.biome === 'deep_woods' || s.biome === 'meadow',
      );
      if (forested.length > 0) return world.rng.pick(forested);
    }

    if (type === 'sanctuary_rewilding' && world.habitatScars.length > 0) {
      // Target the settlement nearest to an existing habitat scar!
      const scar = world.habitatScars[0];
      let nearest = world.settlements[0];
      let bestDist = Infinity;
      for (const s of world.settlements) {
        const d = Math.hypot(s.center.x - scar.x, s.center.z - scar.z);
        if (d < bestDist) {
          bestDist = d;
          nearest = s;
        }
      }
      return nearest;
    }

    if (type === 'migration_corridor') {
      // Aid the smallest or most isolated settlement so biodiversity returns where needed most
      const byPop = [...world.settlements].sort(
        (a, b) => world.getSettlementPopulation(a.id) - world.getSettlementPopulation(b.id),
      );
      return byPop[0];
    }

    if (def.alignment === 'benevolent' && this.favoredSettlementId && world.rng.chance(0.55)) {
      const favored = world.getSettlement(this.favoredSettlementId);
      if (favored) return favored;
    }

    if (def.polarity === 'disruptive') {
      // Disruptive anthropogenic pressures tend to strike the most developed, populous settlements
      const sorted = [...world.settlements].sort((a, b) => b.prosperity - a.prosperity);
      return sorted[0];
    }

    return world.rng.pick(world.settlements);
  }

  private pickInfluencePosition(
    type: DivineEventType,
    target: Settlement | null,
    world: WorldState,
  ): Vec2 {
    if (!target) return { x: 0, z: 0 };

    if (type === 'habitat_clearing') {
      // Place the deforestation scar on the forested edge of the settlement so trees visibly vanish
      let bestPos: Vec2 = { x: target.center.x + 18, z: target.center.z };
      let bestTreeCount = -1;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + world.rng.range(-0.2, 0.2);
        const dist = Math.max(18, target.radius + 10);
        const cx = target.center.x + Math.cos(angle) * dist;
        const cz = target.center.z + Math.sin(angle) * dist;
        if (!world.terrain.isWithinPlayableArea(cx, cz, 24)) continue;
        let count = 0;
        for (const tree of world.terrain.trees) {
          const dx = tree.x - cx;
          const dz = tree.z - cz;
          if (dx * dx + dz * dz < 32 * 32) count++;
        }
        if (count > bestTreeCount) {
          bestTreeCount = count;
          bestPos = { x: cx, z: cz };
        }
      }
      return bestPos;
    }

    if (type === 'sanctuary_rewilding' && world.habitatScars.length > 0) {
      const scar = world.habitatScars[0];
      return { x: scar.x, z: scar.z };
    }

    return { x: target.center.x, z: target.center.z };
  }

  private updateFavoredSettlement(): void {
    let bestId: string | null = null;
    let bestScore = -1;
    for (const [id, score] of this.settlementFavor.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    this.favoredSettlementId = bestId;
  }

  private clamp01(v: number): number {
    return Math.max(0.05, Math.min(0.98, v));
  }

  exportSnapshot(): DeitySnapshot {
    return {
      name: this.name,
      epithet: this.epithet,
      traits: { ...this.traits },
      aspect: this.aspect,
      stance: this.stance,
      energy: this.energy,
      lastOmen: this.lastOmen,
      lastActionName: this.lastActionName,
      favoredSettlementId: this.favoredSettlementId,
      whisperCooldown: this.whisperCooldown,
      decisionTimer: this.decisionTimer,
      effectSeq: this.effectSeq,
      influenceSeq: this.influenceSeq,
      settlementFavor: Array.from(this.settlementFavor.entries()),
    };
  }

  importSnapshot(snapshot: DeitySnapshot): void {
    this.name = snapshot.name;
    this.epithet = snapshot.epithet;
    Object.assign(this.traits, snapshot.traits);
    this.aspect = snapshot.aspect;
    this.stance = snapshot.stance ?? 'neutral';
    this.energy = snapshot.energy;
    this.lastOmen = snapshot.lastOmen;
    this.lastActionName = snapshot.lastActionName;
    this.favoredSettlementId = snapshot.favoredSettlementId;
    this.whisperCooldown = snapshot.whisperCooldown;
    this.decisionTimer = snapshot.decisionTimer;
    this.effectSeq = snapshot.effectSeq;
    this.influenceSeq = snapshot.influenceSeq ?? 1;
    this.settlementFavor.clear();
    for (const [id, score] of snapshot.settlementFavor) {
      this.settlementFavor.set(id, score);
    }
  }
}
