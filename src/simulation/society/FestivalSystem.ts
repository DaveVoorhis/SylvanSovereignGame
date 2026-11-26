import type {
  ActiveCelebration,
  CelebrationScope,
  Season,
  SettlementTier,
  Vec2,
  VillageAdaptationId,
} from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import type { Settlement } from '@simulation/settlements/Settlement';
import { HEARTH_FIRE_KEEP_OUT_RADIUS } from '@simulation/terrain/ObstacleMap';
import type { WorldState } from '@simulation/WorldState';

interface FestivalTemplate {
  readonly title: string;
  readonly theme: string;
  readonly icon: string;
  readonly colorHex: number;
  readonly secondaryColorHex: number;
}

const LOCAL_ADAPTATION_FESTIVALS: Record<VillageAdaptationId, readonly FestivalTemplate[]> = {
  forest_canopy: [
    {
      title: 'Canopy Lantern Jubilee',
      theme: 'Bough-hung fairy lanterns, woodland fiddles, and honeyed acorn cakes',
      icon: '🏮',
      colorHex: 0xffc857,
      secondaryColorHex: 0x62d68b,
    },
    {
      title: 'Moss-Ring Folkmoot',
      theme: 'Circle dances beneath the ancient oaks and storyteller tales',
      icon: '🎻',
      colorHex: 0x7be082,
      secondaryColorHex: 0xffa654,
    },
  ],
  coastal_harbor: [
    {
      title: 'Tide-Lantern Harbor Fair',
      theme: 'Driftwood bonfires, painted sails, and sea-salt cider toasts',
      icon: '⛵',
      colorHex: 0x4cc9f0,
      secondaryColorHex: 0xffbe55,
    },
    {
      title: 'Shell-Chime Seashore Feast',
      theme: 'Coastal ballads, shell-craft stalls, and shoreline dancing',
      icon: '🐚',
      colorHex: 0x56cfe1,
      secondaryColorHex: 0xf78c6b,
    },
  ],
  desert_oasis: [
    {
      title: 'Oasis Starlight Bazaar',
      theme: 'Saffron silk canopies, spiced tea, and dusk tambourine dances',
      icon: '🌟',
      colorHex: 0xffb703,
      secondaryColorHex: 0xe63973,
    },
    {
      title: 'Palm-Shade Caravan Feast',
      theme: 'Sweet dates, woven tapestries, and courtyard music around the wells',
      icon: '🌴',
      colorHex: 0xfb8500,
      secondaryColorHex: 0x2ec4b6,
    },
  ],
  prairie_pastoral: [
    {
      title: 'Sunmeadow Harvest Ceilidh',
      theme: 'Ribbon maypoles, fresh meadow pies, and joyful fiddle reels',
      icon: '🌻',
      colorHex: 0xffd166,
      secondaryColorHex: 0xef476f,
    },
    {
      title: 'Golden Sheaf Barn Dance',
      theme: 'Clover wreaths, windmill banners, and lively square dances',
      icon: '🌾',
      colorHex: 0xf4a261,
      secondaryColorHex: 0x4cc9f0,
    },
  ],
  mountain_stone: [
    {
      title: 'Highland Hearth & Horn Feast',
      theme: 'Roaring terrace fires, stone-carving showcases, and mountain reels',
      icon: '⛰️',
      colorHex: 0xf77f00,
      secondaryColorHex: 0x90e0ef,
    },
    {
      title: 'Craglight Lantern Vigil',
      theme: 'Warm spiced cider, highland pipes, and terrace bonfire dancing',
      icon: '🔥',
      colorHex: 0xff9f1c,
      secondaryColorHex: 0xc77dff,
    },
  ],
  riverside_stilts: [
    {
      title: 'River-Stilt Lantern Float',
      theme: 'Paper reed boats drifting past glowing piers and riverside songs',
      icon: '🚣',
      colorHex: 0x48bfe3,
      secondaryColorHex: 0xffd166,
    },
    {
      title: 'Willow-Bridge Water Carnival',
      theme: 'Ribbon-decked walkways, berry tarts, and bridge-side jigs',
      icon: '🎀',
      colorHex: 0x64dfdf,
      secondaryColorHex: 0xff6b9d,
    },
  ],
};

const SEASONAL_LOCAL_FESTIVALS: Record<Season, readonly FestivalTemplate[]> = {
  spring: [
    {
      title: 'Blossom-Bough May Festival',
      theme: 'Flower garlands, maypole ribbons, and welcome-of-spring dances',
      icon: '🌸',
      colorHex: 0xff8fab,
      secondaryColorHex: 0x80ed99,
    },
  ],
  summer: [
    {
      title: 'Midsummer Sunbeam Fair',
      theme: 'Long-evening feasting, firefly lanterns, and berry-wine toasts',
      icon: '☀️',
      colorHex: 0xffd166,
      secondaryColorHex: 0x06d6a0,
    },
  ],
  autumn: [
    {
      title: 'Acorn & Cider Harvest Festival',
      theme: 'Spiced orchard cider, golden wreaths, and overflowing harvest tables',
      icon: '🍂',
      colorHex: 0xf77f00,
      secondaryColorHex: 0xd62828,
    },
  ],
  winter: [
    {
      title: 'Frostfire Hearth Festival',
      theme: 'Evergreen garlands, hot spiced berries, and glowing snow-lanterns',
      icon: '❄️',
      colorHex: 0x90e0ef,
      secondaryColorHex: 0xffc857,
    },
  ],
};

const REGIONAL_EVENT_TEMPLATES: readonly FestivalTemplate[] = [
  {
    title: 'Grand Regional Trade & Craft Fair',
    theme: 'Neighbors from across the region gather for music, artisan stalls, and feasting',
    icon: '🎪',
    colorHex: 0xff9f1c,
    secondaryColorHex: 0x2ec4b6,
  },
  {
    title: 'Valley Folk-Song Jamboree',
    theme: 'Fiddlers, storytellers, and dancers from neighboring settlements share the square',
    icon: '🎶',
    colorHex: 0xe07be0,
    secondaryColorHex: 0xffd166,
  },
  {
    title: 'Crossroads Friendship Conclave',
    theme: 'Villagers and townsfolk from across the province celebrate peace and kinship',
    icon: '🤝',
    colorHex: 0x4cc9f0,
    secondaryColorHex: 0x80ed99,
  },
  {
    title: 'Regional Harvest & Games Moot',
    theme: 'Friendly contests, pie-baking tables, and lantern dancing uniting nearby towns',
    icon: '🏆',
    colorHex: 0xf94144,
    secondaryColorHex: 0xf9c74f,
  },
  {
    title: 'Provincial Lantern Carnival',
    theme: 'A luminous inter-town carnival of glowing paper lanterns and shared revelry',
    icon: '🏮',
    colorHex: 0xffbe0b,
    secondaryColorHex: 0x8338ec,
  },
];

const NATIONAL_HOLIDAY_TEMPLATES: Record<Season, readonly FestivalTemplate[]> = {
  spring: [
    {
      title: 'Grand Day of the First Sprout',
      theme: 'A rare realm-wide holiday celebrating renewal across every village, town, and city',
      icon: '🎆',
      colorHex: 0xffd166,
      secondaryColorHex: 0xff70a6,
    },
  ],
  summer: [
    {
      title: 'Sovereign’s Sunlit Jubilee',
      theme: 'A grand national holiday uniting the entire realm beneath golden summer skies',
      icon: '👑',
      colorHex: 0xffc300,
      secondaryColorHex: 0x4cc9f0,
    },
  ],
  autumn: [
    {
      title: 'Great Realm Founders’ Day',
      theme: 'Every kin across the continent pauses work to honor shared heritage and abundance',
      icon: '🎆',
      colorHex: 0xff9f1c,
      secondaryColorHex: 0xe63973,
    },
  ],
  winter: [
    {
      title: 'Festival of the Starlit Crown',
      theme: 'A joyous midwinter national holiday lighting every hearth and square across the land',
      icon: '✨',
      colorHex: 0x90e0ef,
      secondaryColorHex: 0xffd166,
    },
  ],
};

function tierNoun(tier: SettlementTier): string {
  switch (tier) {
    case 'hamlet':
      return 'Hamlet';
    case 'village':
      return 'Village';
    case 'town':
      return 'Town';
    case 'city':
      return 'City';
    case 'metropolis':
      return 'Metropolis';
  }
}

/**
 * Orchestrates three tiers of living woodland celebrations:
 * - Occasional local village/town/city festivals attended by the settlement's inhabitants
 * - Occasional regional events hosted at a central settlement and attended by a significant
 *   proportion (~50-60%) of the population across neighboring settlements
 * - Very occasional national holidays celebrated simultaneously by everyone across the realm
 */
export class FestivalSystem {
  readonly activeCelebrations: ActiveCelebration[] = [];
  totalLocalFestivalsHeld = 0;
  totalRegionalEventsHeld = 0;
  totalNationalHolidaysHeld = 0;

  private seq = 1;
  private localTimer = 68;
  private regionalTimer = 135;
  private nationalTimer = 300;
  private readonly settlementCooldowns = new Map<string, number>();

  /** Advances active celebrations, completes expired ones, and schedules new occasions. */
  tick(world: WorldState, dt: number): void {
    // Tick per-settlement local festival cooldowns
    for (const [id, remaining] of this.settlementCooldowns) {
      const next = remaining - dt;
      if (next <= 0) {
        this.settlementCooldowns.delete(id);
      } else {
        this.settlementCooldowns.set(id, next);
      }
    }

    // Expire completed celebrations
    for (let i = this.activeCelebrations.length - 1; i >= 0; i--) {
      const cel = this.activeCelebrations[i];
      if (world.elapsedSeconds - cel.startedAt >= cel.duration) {
        this.concludeCelebration(cel, world);
        this.activeCelebrations.splice(i, 1);
      }
    }

    if (world.settlements.length === 0) return;

    const hasNational = this.getNationalHoliday() !== undefined;

    // 1. Very occasional National Holidays (everyone across the realm celebrates together)
    this.nationalTimer -= dt;
    if (this.nationalTimer <= 0) {
      if (!hasNational) {
        this.startNationalHoliday(world);
      }
      this.nationalTimer = world.rng.range(310, 410);
    }

    // Do not start smaller festivals while a grand National Holiday is underway
    if (this.getNationalHoliday()) return;

    // 2. Occasional Regional Events (significant proportion of neighboring settlements attend)
    this.regionalTimer -= dt;
    if (this.regionalTimer <= 0) {
      const activeRegional = this.activeCelebrations.some((c) => c.scope === 'regional');
      if (!activeRegional && world.settlements.length >= 2) {
        this.startRegionalEvent(world);
      }
      this.regionalTimer = world.rng.range(130, 185);
    }

    // 3. Occasional Local Village / Town / City Festivals
    this.localTimer -= dt;
    if (this.localTimer <= 0) {
      const activeLocalCount = this.activeCelebrations.filter((c) => c.scope === 'local').length;
      if (activeLocalCount < 2) {
        const candidates = world.settlements.filter(
          (s) =>
            !this.isSettlementCelebrating(s.id) &&
            !this.settlementCooldowns.has(s.id) &&
            world.getSettlementPopulation(s.id) >= 4,
        );
        if (candidates.length > 0) {
          const host = world.rng.pick(candidates);
          this.startLocalFestival(world, host);
        }
      }
      this.localTimer = world.rng.range(65, 98);
    }
  }

  /** Launches a local village/town/city festival attended by the settlement's inhabitants. */
  startLocalFestival(world: WorldState, settlement: Settlement): ActiveCelebration | null {
    if (this.getNationalHoliday() || this.isSettlementCelebrating(settlement.id)) {
      return null;
    }

    const adaptPool = LOCAL_ADAPTATION_FESTIVALS[settlement.adaptation];
    const seasonPool = SEASONAL_LOCAL_FESTIVALS[world.season];
    const tpl = world.rng.chance(0.65) ? world.rng.pick(adaptPool) : world.rng.pick(seasonPool);
    const venue = this.resolvePlazaCenter(settlement);
    const tierLabel = tierNoun(settlement.tier);
    const celebration: ActiveCelebration = {
      id: `fest_${this.seq++}`,
      scope: 'local',
      name: `${settlement.name} ${tpl.title}`,
      theme: tpl.theme,
      icon: tpl.icon,
      hostSettlementId: settlement.id,
      participatingSettlementIds: [settlement.id],
      position: venue,
      colorHex: tpl.colorHex,
      secondaryColorHex: tpl.secondaryColorHex,
      startedAt: world.elapsedSeconds,
      startedDay: world.day,
      duration: world.rng.range(30, 40),
      attendanceRatio: 0.85,
    };

    this.activeCelebrations.push(celebration);
    this.totalLocalFestivalsHeld++;
    this.settlementCooldowns.set(settlement.id, 135);

    const attendees = this.rallyAttendees(world, celebration);
    world.chronicle.record(
      world.day,
      world.season,
      'festival',
      `${tpl.icon} ${celebration.name}`,
      `${tierLabel} ${settlement.name} is alive with revelry as ${attendees} inhabitants gather for ${tpl.theme.toLowerCase()}.`,
      venue,
    );
    return celebration;
  }

  /**
   * Launches an occasional regional event hosted at a central settlement and attended by
   * a significant proportion of the population across participating neighboring settlements.
   */
  startRegionalEvent(
    world: WorldState,
    explicitHost?: Settlement,
  ): ActiveCelebration | null {
    if (this.getNationalHoliday() || world.settlements.length < 2) {
      return null;
    }

    const host =
      explicitHost ??
      this.pickRegionalHost(world);
    if (!host) return null;

    // Select a regional cluster: non-at-war settlements within regional distance (or up to 4 nearest)
    const others = world.settlements
      .filter((s) => s.id !== host.id && world.diplomacy.getStance(host.id, s.id) !== 'war')
      .map((s) => ({
        settlement: s,
        dist: Math.hypot(s.center.x - host.center.x, s.center.z - host.center.z),
      }))
      .sort((a, b) => a.dist - b.dist);

    if (others.length === 0) return null;

    const regionalPeers = others
      .filter((entry, idx) => entry.dist <= 280 || idx < 2)
      .slice(0, 4)
      .map((entry) => entry.settlement);

    const participants = [host, ...regionalPeers];
    const participantIds = participants.map((s) => s.id);

    // Clear any local festivals in participating settlements so everyone joins the regional event
    this.supersedeLocalCelebrations(world, new Set(participantIds));

    const tpl = world.rng.pick(REGIONAL_EVENT_TEMPLATES);
    const venue = this.resolvePlazaCenter(host);
    const celebration: ActiveCelebration = {
      id: `reg_${this.seq++}`,
      scope: 'regional',
      name: `${tpl.title} at ${host.name}`,
      theme: tpl.theme,
      icon: tpl.icon,
      hostSettlementId: host.id,
      participatingSettlementIds: participantIds,
      position: venue,
      colorHex: tpl.colorHex,
      secondaryColorHex: tpl.secondaryColorHex,
      startedAt: world.elapsedSeconds,
      startedDay: world.day,
      duration: world.rng.range(46, 58),
      attendanceRatio: 0.56,
    };

    this.activeCelebrations.push(celebration);
    this.totalRegionalEventsHeld++;
    for (const s of participants) {
      this.settlementCooldowns.set(s.id, 110);
    }

    const attendees = this.rallyAttendees(world, celebration);
    const guestNames = regionalPeers.map((s) => s.name).join(', ');
    world.chronicle.record(
      world.day,
      world.season,
      'festival',
      `${tpl.icon} ${celebration.name}`,
      `${attendees} folk from ${host.name} and neighboring ${guestNames} are converging for a grand regional gathering: ${tpl.theme.toLowerCase()}.`,
      venue,
    );
    return celebration;
  }

  /** Launches a very occasional realm-wide national holiday celebrated by everyone. */
  startNationalHoliday(world: WorldState): ActiveCelebration | null {
    if (world.settlements.length === 0) return null;

    // Supersede any smaller active celebrations so the whole realm unites together
    this.supersedeAllCelebrations(world);

    // Choose the grandest / most populous settlement as ceremonial capital focus for Chronicle fly-to
    let capital = world.settlements[0];
    let bestPop = -1;
    for (const s of world.settlements) {
      const pop = world.getSettlementPopulation(s.id) + s.getCompletedCount() * 0.5;
      if (pop > bestPop) {
        bestPop = pop;
        capital = s;
      }
    }

    const seasonTemplates = NATIONAL_HOLIDAY_TEMPLATES[world.season];
    const tpl = world.rng.pick(seasonTemplates);
    const venue = this.resolvePlazaCenter(capital);
    const allIds = world.settlements.map((s) => s.id);

    const celebration: ActiveCelebration = {
      id: `nat_${this.seq++}`,
      scope: 'national',
      name: tpl.title,
      theme: tpl.theme,
      icon: tpl.icon,
      hostSettlementId: capital.id,
      participatingSettlementIds: allIds,
      position: venue,
      colorHex: tpl.colorHex,
      secondaryColorHex: tpl.secondaryColorHex,
      startedAt: world.elapsedSeconds,
      startedDay: world.day,
      duration: world.rng.range(48, 60),
      attendanceRatio: 1.0,
    };

    this.activeCelebrations.push(celebration);
    this.totalNationalHolidaysHeld++;
    for (const s of world.settlements) {
      this.settlementCooldowns.set(s.id, 130);
    }

    const attendees = this.rallyAttendees(world, celebration);
    world.chronicle.record(
      world.day,
      world.season,
      'festival',
      `${tpl.icon} National Holiday: ${celebration.name}`,
      `Bells ring out across every settlement! All ${attendees} woodland kin pause their labors to celebrate ${celebration.name} together.`,
      venue,
    );
    return celebration;
  }

  /** Returns the active National Holiday if one is currently underway. */
  getNationalHoliday(): ActiveCelebration | undefined {
    return this.activeCelebrations.find((c) => c.scope === 'national');
  }

  /** Returns an active celebration by ID. */
  getCelebrationById(id: string): ActiveCelebration | undefined {
    return this.activeCelebrations.find((c) => c.id === id);
  }

  /**
   * Returns the highest-priority celebration currently involving a settlement
   * (national > regional > local).
   */
  getCelebrationForSettlement(settlementId: string): ActiveCelebration | undefined {
    let best: ActiveCelebration | undefined;
    const rank = (scope: CelebrationScope): number =>
      scope === 'national' ? 3 : scope === 'regional' ? 2 : 1;
    for (const cel of this.activeCelebrations) {
      if (cel.participatingSettlementIds.includes(settlementId)) {
        if (!best || rank(cel.scope) > rank(best.scope)) {
          best = cel;
        }
      }
    }
    return best;
  }

  /**
   * Returns an active celebration whose 3D bunting & festivities should decorate this settlement's plaza.
   * - Local: host settlement only
   * - Regional: host settlement (where everyone gathers)
   * - National: EVERY settlement across the realm!
   */
  getVenueCelebration(settlementId: string): ActiveCelebration | undefined {
    const nat = this.getNationalHoliday();
    if (nat) return nat;
    for (const cel of this.activeCelebrations) {
      if (cel.hostSettlementId === settlementId) {
        return cel;
      }
    }
    return undefined;
  }

  isSettlementCelebrating(settlementId: string): boolean {
    return this.getCelebrationForSettlement(settlementId) !== undefined;
  }

  getAttendeeCount(world: WorldState, celebrationId: string): number {
    let count = 0;
    for (const c of world.creatures) {
      if (c.alive && c.activity === 'celebrating' && c.activeCelebrationId === celebrationId) {
        count++;
      }
    }
    return count;
  }

  /** Picks a festive standing/dancing spot around a settlement's plaza outside the hearth fire ring. */
  pickCelebrationSpot(settlement: Settlement, world: WorldState): Vec2 {
    const plaza = this.resolvePlazaCenter(settlement);
    const minR = HEARTH_FIRE_KEEP_OUT_RADIUS + 0.65;
    const maxR = Math.max(minR + 1.8, Math.min(8.2, settlement.radius * 0.72));
    const angle = world.rng.range(0, Math.PI * 2);
    const radius = world.rng.range(minR, maxR);
    return {
      x: plaza.x + Math.cos(angle) * radius,
      z: plaza.z + Math.sin(angle) * radius,
    };
  }

  /** Invites eligible creatures to attend a celebration and assigns their festive destinations. */
  private rallyAttendees(world: WorldState, celebration: ActiveCelebration): number {
    const participantSet = new Set(celebration.participatingSettlementIds);
    const hostSettlement = world.getSettlement(celebration.hostSettlementId);
    if (!hostSettlement) return 0;

    let attendees = 0;

    if (celebration.scope === 'national') {
      // Everyone across the entire realm celebrates simultaneously!
      for (const c of world.creatures) {
        if (!c.alive || c.activity === 'fighting' || c.activity === 'fleeing') continue;
        const home = world.getSettlement(c.settlementId) ?? hostSettlement;
        this.assignCreatureToCelebration(c, celebration, home, world);
        attendees++;
      }
      return attendees;
    }

    if (celebration.scope === 'local') {
      const eligible = world.creatures.filter(
        (c) =>
          c.alive &&
          c.settlementId === hostSettlement.id &&
          c.activity !== 'fighting' &&
          c.activity !== 'fleeing' &&
          c.activity !== 'emigrating' &&
          world.terrain.getBridgeDeckY(c.x, c.z) === null,
      );
      const targetCount = Math.max(
        Math.min(eligible.length, 3),
        Math.round(eligible.length * celebration.attendanceRatio),
      );
      const chosen = this.selectDeterministicSubset(eligible, targetCount, world);
      for (const c of chosen) {
        this.assignCreatureToCelebration(c, celebration, hostSettlement, world);
        attendees++;
      }
      return attendees;
    }

    // Regional event: ~75% of host settlement + ~52% of each participating neighboring settlement
    for (const settlementId of participantSet) {
      const settlement = world.getSettlement(settlementId);
      if (!settlement) continue;
      const eligible = world.creatures.filter(
        (c) =>
          c.alive &&
          c.settlementId === settlementId &&
          c.activity !== 'fighting' &&
          c.activity !== 'fleeing' &&
          c.activity !== 'emigrating' &&
          world.terrain.getBridgeDeckY(c.x, c.z) === null,
      );
      const ratio = settlementId === hostSettlement.id ? 0.76 : 0.54;
      const targetCount = Math.max(
        eligible.length > 0 ? 1 : 0,
        Math.round(eligible.length * ratio),
      );
      const chosen = this.selectDeterministicSubset(eligible, targetCount, world);
      for (const c of chosen) {
        this.assignCreatureToCelebration(c, celebration, hostSettlement, world);
        attendees++;
      }
    }

    return attendees;
  }

  private assignCreatureToCelebration(
    creature: Creature,
    celebration: ActiveCelebration,
    venueSettlement: Settlement,
    world: WorldState,
  ): void {
    creature.activity = 'celebrating';
    creature.activeCelebrationId = celebration.id;
    creature.celebrationHostSettlementId = venueSettlement.id;
    creature.isDancingAtCelebration = false;
    creature.targetBuildingId = null;
    creature.targetBridgeId = null;
    creature.targetResourceId = null;
    creature.targetCreatureId = null;
    creature.isActivelyWorking = false;
    creature.activeConstructionStage = null;

    // If a pioneer is far away on a trek during a National Holiday, let them celebrate joyfully right on the trail
    if (celebration.scope === 'national' && creature.emigrationPartyId) {
      creature.targetX = creature.x;
      creature.targetZ = creature.z;
      creature.isDancingAtCelebration = true;
      creature.actionTimer = world.rng.range(4, 7);
      creature.thought = `Cheering on the trail for ${celebration.name}!`;
      return;
    }

    const spot = this.pickCelebrationSpot(venueSettlement, world);
    creature.targetX = spot.x;
    creature.targetZ = spot.z;
    creature.actionTimer = world.rng.range(4, 8);
    creature.resetNavigationState();

    const travelingToNeighbor = venueSettlement.id !== creature.settlementId;
    if (celebration.scope === 'national') {
      creature.thought = `Heading to the square for ${celebration.name}!`;
    } else if (travelingToNeighbor) {
      creature.thought = `Traveling to ${venueSettlement.name} for ${celebration.name}!`;
    } else {
      creature.thought = `Heading to ${celebration.name}!`;
    }
  }

  private concludeCelebration(celebration: ActiveCelebration, world: WorldState): void {
    // Release all creatures participating in this celebration cleanly
    for (const c of world.creatures) {
      if (c.activeCelebrationId === celebration.id) {
        c.activeCelebrationId = null;
        c.celebrationHostSettlementId = null;
        c.isDancingAtCelebration = false;
        if (c.activity === 'celebrating') {
          if (c.emigrationPartyId && c.emigrationTargetX !== null && c.emigrationTargetZ !== null) {
            c.activity = 'emigrating';
            c.targetX = c.emigrationTargetX;
            c.targetZ = c.emigrationTargetZ;
            c.thought = 'Resuming the pioneer trek in high spirits!';
          } else {
            c.activity = 'idle';
            c.actionTimer = 0.2;
            c.thought = `Smiling after ${celebration.name}`;
          }
          c.resetNavigationState();
        }
      }
    }

    // Apply lasting cultural, prosperity, and diplomatic rewards
    const participating: Settlement[] = [];
    for (const id of celebration.participatingSettlementIds) {
      const s = world.getSettlement(id);
      if (s) participating.push(s);
    }

    if (celebration.scope === 'local') {
      for (const s of participating) {
        s.prosperity = Math.min(100, s.prosperity + 3.5);
      }
    } else if (celebration.scope === 'regional') {
      for (const s of participating) {
        s.prosperity = Math.min(100, s.prosperity + 5);
        s.tradeVolume += 4;
      }
      for (let i = 0; i < participating.length; i++) {
        for (let j = i + 1; j < participating.length; j++) {
          world.diplomacy.adjustRelation(
            participating[i],
            participating[j],
            8,
            world,
            celebration.name,
          );
        }
      }
    } else {
      // National holiday warms diplomacy and boosts prosperity across the entire realm
      for (const s of participating) {
        s.prosperity = Math.min(100, s.prosperity + 6);
        s.devotionTotal += 8;
      }
      for (let i = 0; i < participating.length; i++) {
        for (let j = i + 1; j < participating.length; j++) {
          world.diplomacy.adjustRelation(
            participating[i],
            participating[j],
            6,
            world,
            celebration.name,
          );
        }
      }
    }
  }

  private supersedeLocalCelebrations(world: WorldState, settlementIds: Set<string>): void {
    for (let i = this.activeCelebrations.length - 1; i >= 0; i--) {
      const cel = this.activeCelebrations[i];
      if (
        cel.scope === 'local' &&
        cel.participatingSettlementIds.some((id) => settlementIds.has(id))
      ) {
        this.concludeCelebration(cel, world);
        this.activeCelebrations.splice(i, 1);
      }
    }
  }

  private supersedeAllCelebrations(world: WorldState): void {
    for (let i = this.activeCelebrations.length - 1; i >= 0; i--) {
      this.concludeCelebration(this.activeCelebrations[i], world);
      this.activeCelebrations.splice(i, 1);
    }
  }

  private pickRegionalHost(world: WorldState): Settlement | undefined {
    const candidates = world.settlements.filter(
      (s) => world.getSettlementPopulation(s.id) >= 4,
    );
    if (candidates.length === 0) return undefined;
    // Prefer flourishing towns/cities with plazas or taverns, weighted deterministically
    const weighted = candidates.map((s) => {
      const bonus =
        1 +
        s.getCompletedCount('fountain_plaza') * 2 +
        s.getCompletedCount('tavern') * 1.4 +
        s.getCompletedCount('guildhall') * 1.5 +
        s.getCompletedCount('market_stall') * 0.8;
      return { item: s, weight: bonus };
    });
    return world.rng.weightedPick(weighted);
  }

  private resolvePlazaCenter(settlement: Settlement): Vec2 {
    // Prefer the settlement's central hearth plaza (where bunting & lanterns rise)
    return { x: settlement.center.x, z: settlement.center.z };
  }

  private selectDeterministicSubset<T>(items: readonly T[], count: number, world: WorldState): T[] {
    if (count >= items.length) return [...items];
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(world.rng.next() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy.slice(0, Math.max(0, count));
  }
}
