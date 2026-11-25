import { SeededRandom } from '@core/SeededRandom';
import type {
  DeityAspect,
  DivineEventType,
  PrayerIntent,
  Vec2,
} from '@core/Types';
import { ALL_SPECIES_IDS } from '@simulation/creatures/SpeciesCatalog';
import type { Settlement } from '@simulation/settlements/Settlement';
import type { WorldState } from '@simulation/WorldState';
import { DIVINE_EVENT_CATALOG } from './DivineEvents';

export interface DeityTraits {
  benevolence: number; // 0..1
  wrath: number; // 0..1
  chaos: number; // 0..1
  verdancy: number; // 0..1
  curiosity: number; // 0..1
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

/**
 * The dynamically procedural "God" of the forest.
 *
 * Rather than direct player micromanagement, this autonomous deity possesses an
 * evolving psyche, observes woodland civilizations, shifts its mythic Aspect,
 * and shapes weather, ecology, miracles, and trials on its own accord.
 * Spectators may offer subtle "Whispers" that the deity interprets (or subverts)
 * through its current temperament.
 */
export class ProceduralGod {
  readonly name: string;
  readonly epithet: string;
  readonly traits: DeityTraits;

  aspect: DeityAspect = 'The Whispering Canopy';
  energy = 55; // 0..100
  lastOmen = 'Watching the first lanterns kindle beneath the oaks.';
  lastActionName = 'Awakening';
  favoredSettlementId: string | null = null;
  whisperCooldown = 0;

  private decisionTimer: number;
  private effectSeq = 1;
  private readonly settlementFavor = new Map<string, number>();

  constructor(seed: number, decisionIntervalSec: number) {
    const rng = new SeededRandom(seed ^ 0x9e3779b9);
    this.name = `${rng.pick(DEITY_PREFIXES)}${rng.pick(DEITY_SUFFIXES)}`;
    this.epithet = rng.pick(DEITY_EPITHETS);

    this.traits = {
      benevolence: rng.range(0.42, 0.78),
      wrath: rng.range(0.15, 0.45),
      chaos: rng.range(0.22, 0.62),
      verdancy: rng.range(0.48, 0.85),
      curiosity: rng.range(0.38, 0.78),
    };
    this.decisionTimer = decisionIntervalSec * 0.55;
    this.recomputeAspect();
  }

  receivePrayer(amount: number, settlementId: string): void {
    this.energy = Math.min(100, this.energy + amount * 1.4);
    this.traits.benevolence = this.clamp01(this.traits.benevolence + amount * 0.004);
    this.traits.wrath = this.clamp01(this.traits.wrath - amount * 0.003);

    const prev = this.settlementFavor.get(settlementId) ?? 0;
    this.settlementFavor.set(settlementId, prev + amount);
    this.updateFavoredSettlement();
  }

  observeConflict(severity: number): void {
    this.traits.wrath = this.clamp01(this.traits.wrath + severity * 0.025);
    this.traits.chaos = this.clamp01(this.traits.chaos + severity * 0.015);
    this.traits.benevolence = this.clamp01(this.traits.benevolence - severity * 0.01);
    this.energy = Math.min(100, this.energy + severity * 1.2);
    this.recomputeAspect();
  }

  observeCivilizationMilestone(settlement: Settlement): void {
    this.traits.curiosity = this.clamp01(this.traits.curiosity + 0.05);
    this.traits.verdancy = this.clamp01(this.traits.verdancy - 0.02);
    const prev = this.settlementFavor.get(settlement.id) ?? 0;
    this.settlementFavor.set(settlement.id, prev + 8);
    this.updateFavoredSettlement();
    this.recomputeAspect();
  }

  /**
   * Optional spectator nudge ("Prayer Whisper").
   * Because the god is procedural and autonomous, it interprets the whisper
   * through its current personality rather than obeying blindly.
   */
  receiveSpectatorWhisper(intent: PrayerIntent, world: WorldState): string {
    if (this.whisperCooldown > 0) {
      return `${this.name} is still pondering the last whisper.`;
    }
    this.whisperCooldown = 14;
    this.energy = Math.min(100, this.energy + 18);

    if (intent === 'prosperity') {
      this.traits.benevolence = this.clamp01(this.traits.benevolence + 0.09);
      this.traits.verdancy = this.clamp01(this.traits.verdancy + 0.08);
      this.lastOmen = 'A gentle plea for abundance rustled through the high canopy.';
    } else if (intent === 'peace') {
      this.traits.benevolence = this.clamp01(this.traits.benevolence + 0.08);
      this.traits.wrath = this.clamp01(this.traits.wrath - 0.1);
      this.lastOmen = 'Soft chimes of harmony drifted toward the ancient shrine.';
    } else if (intent === 'drama') {
      this.traits.chaos = this.clamp01(this.traits.chaos + 0.12);
      this.traits.wrath = this.clamp01(this.traits.wrath + 0.08);
      this.lastOmen = 'Restless sparks danced along the forest ridges.';
    } else {
      this.traits.curiosity = this.clamp01(this.traits.curiosity + 0.12);
      this.traits.chaos = this.clamp01(this.traits.chaos + 0.06);
      this.lastOmen = 'Strange constellations reflected in the central glade pond.';
    }

    this.recomputeAspect();
    this.decisionTimer = Math.min(this.decisionTimer, 1.5);

    world.chronicle.record(
      world.day,
      world.season,
      'deity',
      'A Whisper Reaches the Canopy',
      `An unseen spectator whispered of ${intent}; ${this.name} (${this.aspect}) listened intently.`,
    );

    return `${this.name} heard your whisper of ${intent}.`;
  }

  tick(world: WorldState, dt: number): void {
    this.whisperCooldown = Math.max(0, this.whisperCooldown - dt);
    this.energy = Math.min(100, this.energy + dt * (1.35 + this.traits.curiosity * 0.4));

    // Slow procedural personality drift so the god's temperament evolves over seasons
    const drift = dt * 0.008;
    this.traits.benevolence = this.clamp01(this.traits.benevolence + (world.rng.next() - 0.49) * drift);
    this.traits.wrath = this.clamp01(this.traits.wrath + (world.rng.next() - 0.52) * drift);
    this.traits.chaos = this.clamp01(this.traits.chaos + (world.rng.next() - 0.5) * drift);
    this.traits.verdancy = this.clamp01(this.traits.verdancy + (world.rng.next() - 0.49) * drift);
    this.traits.curiosity = this.clamp01(this.traits.curiosity + (world.rng.next() - 0.49) * drift);

    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return;
    this.decisionTimer = world.config.deityDecisionIntervalSec * world.rng.range(0.75, 1.25);

    this.recomputeAspect();
    if (this.energy < 20 || world.settlements.length === 0) return;

    const chosenEvent = this.chooseDivineAct(world);
    this.executeDivineAct(chosenEvent, world);
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

    const weighted: { item: DivineEventType; weight: number }[] = [
      { item: 'bountiful_bloom', weight: (t.verdancy * 1.4 + t.benevolence) * (isWinter ? 0.35 : 1.1) },
      { item: 'sunlit_blessing', weight: t.benevolence * 1.5 + 0.25 },
      { item: 'healing_dew', weight: t.benevolence * 1.2 + t.verdancy * 0.5 },
      { item: 'silver_rain', weight: t.verdancy * 1.1 + t.curiosity * 0.7 },
      { item: 'spirit_lanterns', weight: t.curiosity * 1.5 + 0.2 },
      { item: 'wanderers_omen', weight: t.curiosity * 1.1 + t.benevolence * 0.5 },
      { item: 'ancient_whisper', weight: t.chaos * 1.4 + t.curiosity * 0.6 },
      { item: 'thunder_judgment', weight: t.wrath * 1.7 + t.chaos * 0.4 },
      { item: 'thorn_blight', weight: t.wrath * 1.3 + t.chaos * 0.6 },
      { item: 'frost_veil', weight: (isWinter ? 1.8 : 0.3) + t.chaos * 0.7 },
    ];

    return world.rng.weightedPick(weighted);
  }

  private executeDivineAct(type: DivineEventType, world: WorldState): void {
    const def = DIVINE_EVENT_CATALOG[type];
    this.energy = Math.max(0, this.energy - def.energyCost);
    this.lastActionName = def.label;

    const targetSettlement = this.pickTargetSettlement(type, world);
    const position: Vec2 = targetSettlement
      ? { x: targetSettlement.center.x, z: targetSettlement.center.z }
      : { x: 0, z: 0 };

    if (def.weatherShift) {
      world.setWeather(def.weatherShift, def.duration * 2.4);
    }

    // Apply tangible simulation effects
    switch (type) {
      case 'bountiful_bloom': {
        for (const node of world.terrain.resourceNodes) {
          if (Math.hypot(node.position.x - position.x, node.position.z - position.z) < 38) {
            node.amount = node.maxAmount;
          }
        }
        if (targetSettlement) {
          targetSettlement.stockpile.berries += 14;
          targetSettlement.stockpile.acorns += 12;
          targetSettlement.stockpile.herbs += 8;
        }
        this.lastOmen = `Blossoms surged around ${targetSettlement?.name ?? 'the central valley'}.`;
        break;
      }

      case 'sunlit_blessing': {
        if (targetSettlement) {
          targetSettlement.stockpile.timber += 12;
          for (const b of targetSettlement.buildings) {
            if (!b.completed) {
              b.progress = Math.min(99, b.progress + 40);
            }
          }
          for (const c of world.creatures) {
            if (c.alive && c.settlementId === targetSettlement.id) {
              c.mood = Math.min(100, c.mood + 18);
              c.energy = Math.min(100, c.energy + 25);
            }
          }
        }
        this.lastOmen = `Golden sunbeams crowned the rooftops of ${targetSettlement?.name ?? 'the woods'}.`;
        break;
      }

      case 'healing_dew': {
        for (const c of world.creatures) {
          if (!c.alive) continue;
          if (Math.hypot(c.x - position.x, c.z - position.z) < def.radius + 14) {
            c.health = c.maxHealth;
            c.mood = Math.min(100, c.mood + 16);
          }
        }
        if (targetSettlement && world.settlements.length > 1) {
          const other = world.rng.pick(world.settlements.filter((s) => s.id !== targetSettlement.id));
          if (other) {
            world.diplomacy.adjustRelation(targetSettlement, other, 16, world, 'soothing mist');
          }
        }
        this.lastOmen = `Luminous dew healed creatures near ${targetSettlement?.name ?? 'the glade'}.`;
        break;
      }

      case 'silver_rain': {
        world.terrain.tickResources(25, 2.2);
        this.lastOmen = 'Silver rain danced across the canopy, renewing springs and groves.';
        break;
      }

      case 'spirit_lanterns': {
        for (const c of world.creatures) {
          if (c.alive && Math.hypot(c.x - position.x, c.z - position.z) < 28) {
            c.devotion = Math.min(100, c.devotion + 22);
            c.mood = Math.min(100, c.mood + 12);
          }
        }
        this.lastOmen = `Floating spirit-lanterns entranced ${targetSettlement?.name ?? 'the woodland folk'}.`;
        break;
      }

      case 'wanderers_omen': {
        if (targetSettlement && world.creatures.filter((c) => c.alive).length < world.config.maxPopulation) {
          const rareSpecies = world.rng.pick(ALL_SPECIES_IDS);
          const wanderer = world.spawnCreature(targetSettlement, rareSpecies, 'mystic');
          this.lastOmen = `${wanderer.name}, a wandering ${wanderer.def.displayName}, arrived in ${targetSettlement.name} under starry omens.`;
        }
        break;
      }

      case 'ancient_whisper': {
        if (targetSettlement && world.settlements.length > 1) {
          const other = world.rng.pick(world.settlements.filter((s) => s.id !== targetSettlement.id));
          if (other) {
            const swing = world.rng.chance(0.5) ? 20 : -22;
            world.diplomacy.adjustRelation(targetSettlement, other, swing, world, 'ancient whisper');
            this.lastOmen = `Eerie winds stirred ${swing > 0 ? 'warmth' : 'jealousy'} between ${targetSettlement.name} and ${other.name}.`;
          }
        }
        break;
      }

      case 'thunder_judgment': {
        if (targetSettlement) {
          targetSettlement.stockpile.timber = Math.max(0, targetSettlement.stockpile.timber - 8);
          for (const c of world.creatures) {
            if (c.alive && c.settlementId === targetSettlement.id) {
              c.mood = Math.max(15, c.mood - 15);
              c.devotion = Math.min(100, c.devotion + 15);
            }
          }
        }
        this.lastOmen = `Thunder cracked above ${targetSettlement?.name ?? 'the ridge'}, humbling proud hearts.`;
        break;
      }

      case 'thorn_blight': {
        for (const node of world.terrain.resourceNodes) {
          if (Math.hypot(node.position.x - position.x, node.position.z - position.z) < 22) {
            node.amount = Math.max(1, node.amount * 0.45);
          }
        }
        this.lastOmen = `Bramble thorns tangled the groves near ${targetSettlement?.name ?? 'the woods'}.`;
        break;
      }

      case 'frost_veil': {
        for (const c of world.creatures) {
          if (c.alive && c.activity !== 'resting') {
            c.energy = Math.max(10, c.energy - 14);
          }
        }
        this.lastOmen = 'A shimmering frost veil swept down from the pines.';
        break;
      }
    }

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
      `${this.name}: ${def.label}`,
      this.lastOmen,
      position,
    );
  }

  private pickTargetSettlement(type: DivineEventType, world: WorldState): Settlement | null {
    if (world.settlements.length === 0) return null;
    const def = DIVINE_EVENT_CATALOG[type];

    if (def.alignment === 'benevolent' && this.favoredSettlementId && world.rng.chance(0.55)) {
      const favored = world.getSettlement(this.favoredSettlementId);
      if (favored) return favored;
    }

    if (def.alignment === 'wrathful') {
      // Pick the most prosperous or most aggressive settlement
      const sorted = [...world.settlements].sort((a, b) => b.prosperity - a.prosperity);
      return sorted[0];
    }

    return world.rng.pick(world.settlements);
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
}
