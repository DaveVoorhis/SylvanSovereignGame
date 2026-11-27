export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type WeatherType = 'clear' | 'sunbeams' | 'mist' | 'rain' | 'storm' | 'snow' | 'blossom';

export type BiomeType =
  | 'deep_woods'
  | 'meadow'
  | 'prairie'
  | 'desert'
  | 'seashore'
  | 'riverbank'
  | 'rocky_ridge'
  | 'moss_hollow'
  | 'alpine_crag'
  | 'water';

export type VillageAdaptationId =
  | 'forest_canopy'
  | 'coastal_harbor'
  | 'desert_oasis'
  | 'prairie_pastoral'
  | 'mountain_stone'
  | 'riverside_stilts'
  | 'waterway_haven';

export type ResourceType = 'timber' | 'berries' | 'acorns' | 'stone' | 'herbs' | 'crafts';

export type ResourceBundle = Record<ResourceType, number>;

export type SpeciesId =
  | 'crow'
  | 'sparrow'
  | 'robin'
  | 'squirrel'
  | 'mouse'
  | 'rat'
  | 'frog'
  | 'rabbit'
  | 'fox'
  | 'hedgehog'
  | 'badger'
  | 'owl'
  | 'bear'
  | 'wolf'
  | 'cat'
  | 'raccoon'
  | 'weasel'
  | 'snake'
  | 'turtle'
  | 'pigeon'
  | 'magpie'
  | 'beaver'
  | 'otter'
  | 'fish';

export type LocomotionKind = 'walk' | 'hop' | 'scurry' | 'fly' | 'slither' | 'swim';

export type LifeStage = 'young' | 'juvenile' | 'adult' | 'elder';

export type CreatureActivity =
  | 'idle'
  | 'foraging'
  | 'gathering_timber'
  | 'building'
  | 'emigrating'
  | 'trading'
  | 'socialising'
  | 'courting'
  | 'nesting'
  | 'playing'
  | 'celebrating'
  | 'fighting'
  | 'fleeing'
  | 'resting'
  | 'praying';

export type ConstructionStage =
  | 'clearing'
  | 'leveling'
  | 'foundation'
  | 'framing'
  | 'finishing'
  | 'completed'
  | 'disassembling';

export type CreatureRole =
  | 'forager'
  | 'builder'
  | 'merchant'
  | 'guard'
  | 'artisan'
  | 'mystic';

export type BuildingType =
  | 'burrow_cottage'
  | 'timber_house'
  | 'granary'
  | 'market_stall'
  | 'tavern'
  | 'workshop'
  | 'watchtower'
  | 'shrine'
  | 'bakery'
  | 'windmill'
  | 'greenhouse'
  | 'library'
  | 'fountain_plaza'
  | 'guildhall'
  | 'beaver_lodge'
  | 'otter_boathouse'
  | 'waterwheel_mill'
  | 'lily_market'
  | 'aquatic_sanctuary'
  | 'tide_shrine';

export type SettlementTier = 'hamlet' | 'village' | 'town' | 'city' | 'metropolis';

export type DiplomaticStance = 'allied' | 'friendly' | 'neutral' | 'tense' | 'war';

export type DeityAspect =
  | 'The Whispering Canopy'
  | 'The Golden Harvest'
  | 'The Ember-Eyed Judge'
  | 'The Trickster of Thorns'
  | 'The Mist-Walker'
  | 'The Hearth-Keeper';

export type DivineEventType =
  | 'great_deluge'
  | 'scorching_drought'
  | 'habitat_clearing'
  | 'ashen_miasma'
  | 'polar_snap'
  | 'sanctuary_rewilding'
  | 'migration_corridor'
  | 'sunlit_blessing';

export type DivineImpactPolarity = 'disruptive' | 'restorative';

export type PrayerIntent = 'prosperity' | 'peace' | 'drama' | 'mystery';

export type ChronicleCategory =
  | 'deity'
  | 'settlement'
  | 'trade'
  | 'social'
  | 'festival'
  | 'combat'
  | 'nature';

export type CelebrationScope = 'local' | 'regional' | 'national';

export interface ActiveCelebration {
  readonly id: string;
  readonly scope: CelebrationScope;
  readonly name: string;
  readonly theme: string;
  readonly icon: string;
  /** Primary host settlement (local host, regional gathering host, or leading realm capital). */
  readonly hostSettlementId: string;
  /** All settlements participating in this celebration. */
  readonly participatingSettlementIds: readonly string[];
  /** Primary world plaza position for Chronicle camera focus. */
  readonly position: Vec2;
  readonly colorHex: number;
  readonly secondaryColorHex: number;
  readonly startedAt: number;
  readonly startedDay: number;
  readonly duration: number;
  /** Target fraction of invited population attending (local ~0.85, regional ~0.55, national 1.0). */
  readonly attendanceRatio: number;
}

export interface ActiveDivineInfluence {
  readonly id: number;
  readonly type: DivineEventType;
  readonly label: string;
  readonly icon: string;
  readonly polarity: DivineImpactPolarity;
  readonly position: Vec2;
  readonly radius: number;
  readonly targetSettlementId: string | null;
  readonly startedAt: number;
  readonly duration: number;
  readonly severity: number;
  casualties: number;
  buildingsAffected: number;
  treesAffected: number;
  adaptationsTriggered: number;
  migrationTriggered: boolean;
  readonly summary: string;
}

export interface HabitatScar {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  remainingSec: number;
  readonly maxDurationSec: number;
}

export interface ChronicleEntry {
  readonly id: number;
  readonly timestampDay: number;
  readonly season: Season;
  readonly category: ChronicleCategory;
  readonly title: string;
  readonly detail: string;
  readonly position?: Vec2;
}

export interface DivineEffectVisual {
  readonly id: number;
  readonly type: DivineEventType;
  readonly position: Vec2;
  readonly radius: number;
  readonly colorHex: number;
  readonly createdAt: number;
  readonly duration: number;
}

export interface CombatSparkVisual {
  readonly id: number;
  readonly position: Vec3;
  readonly createdAt: number;
  readonly duration: number;
}

export interface TradeRouteVisual {
  readonly fromSettlementId: string;
  readonly toSettlementId: string;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly activeCount: number;
}

export type SelectionTarget =
  | { kind: 'creature'; id: string }
  | { kind: 'settlement'; id: string }
  | { kind: 'building'; id: string }
  | null;

export function createEmptyResources(): ResourceBundle {
  return {
    timber: 0,
    berries: 0,
    acorns: 0,
    stone: 0,
    herbs: 0,
    crafts: 0,
  };
}
