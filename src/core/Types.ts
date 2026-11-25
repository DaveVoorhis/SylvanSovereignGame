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
  | 'riverside_stilts';

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
  | 'owl';

export type LocomotionKind = 'walk' | 'hop' | 'scurry' | 'fly';

export type CreatureActivity =
  | 'idle'
  | 'foraging'
  | 'gathering_timber'
  | 'building'
  | 'emigrating'
  | 'trading'
  | 'socialising'
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
  | 'guildhall';

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
  | 'bountiful_bloom'
  | 'sunlit_blessing'
  | 'healing_dew'
  | 'silver_rain'
  | 'thunder_judgment'
  | 'thorn_blight'
  | 'spirit_lanterns'
  | 'wanderers_omen'
  | 'ancient_whisper'
  | 'frost_veil';

export type PrayerIntent = 'prosperity' | 'peace' | 'drama' | 'mystery';

export type ChronicleCategory =
  | 'deity'
  | 'settlement'
  | 'trade'
  | 'social'
  | 'combat'
  | 'nature';

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
