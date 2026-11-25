import type { BuildingType, ResourceType } from '@core/Types';

export interface BuildingBlueprint {
  readonly type: BuildingType;
  readonly displayName: string;
  readonly cost: Partial<Record<ResourceType, number>>;
  readonly footprintRadius: number;
  readonly housingCapacity: number;
  readonly prosperityValue: number;
  readonly devotionValue: number;
  readonly maxPerSettlement: number;
  readonly minCompletedToUnlock?: number;
  readonly description: string;
}

export const ALL_BUILDING_TYPES: readonly BuildingType[] = [
  'burrow_cottage',
  'timber_house',
  'granary',
  'market_stall',
  'bakery',
  'workshop',
  'tavern',
  'windmill',
  'greenhouse',
  'watchtower',
  'shrine',
  'fountain_plaza',
  'library',
  'guildhall',
];

export const BUILDING_CATALOG: Record<BuildingType, BuildingBlueprint> = {
  burrow_cottage: {
    type: 'burrow_cottage',
    displayName: 'Moss-Roof Cottage',
    cost: { timber: 9 },
    footprintRadius: 2.2,
    housingCapacity: 3,
    prosperityValue: 8,
    devotionValue: 1,
    maxPerSettlement: 9,
    description: 'A snug timber-and-moss woodland dwelling with glowing circular windows.',
  },
  timber_house: {
    type: 'timber_house',
    displayName: 'Gabled Timber House',
    cost: { timber: 14, stone: 4 },
    footprintRadius: 2.6,
    housingCapacity: 5,
    prosperityValue: 15,
    devotionValue: 2,
    maxPerSettlement: 10,
    description: 'A two-story half-timbered woodland home crowned with carved eaves.',
  },
  granary: {
    type: 'granary',
    displayName: 'Acorn Granary',
    cost: { timber: 12, stone: 3 },
    footprintRadius: 2.4,
    housingCapacity: 0,
    prosperityValue: 14,
    devotionValue: 1,
    maxPerSettlement: 3,
    description: 'Elevated cedar silo preserving berries, grains, and winter acorns.',
  },
  market_stall: {
    type: 'market_stall',
    displayName: 'Canopy Market',
    cost: { timber: 11, berries: 4 },
    footprintRadius: 2.3,
    housingCapacity: 0,
    prosperityValue: 20,
    devotionValue: 1,
    maxPerSettlement: 4,
    description: 'Canvas-draped trading square drawing caravans from neighboring cities.',
  },
  bakery: {
    type: 'bakery',
    displayName: 'Hearth Bakery',
    cost: { timber: 12, stone: 5, berries: 4 },
    footprintRadius: 2.5,
    housingCapacity: 1,
    prosperityValue: 20,
    devotionValue: 1,
    maxPerSettlement: 3,
    description: 'Warm brick-oven bakery filling city lanes with golden acorn loaves and berry tarts.',
  },
  tavern: {
    type: 'tavern',
    displayName: 'Lantern Tavern',
    cost: { timber: 16, stone: 5, berries: 5 },
    footprintRadius: 2.9,
    housingCapacity: 2,
    prosperityValue: 24,
    devotionValue: 2,
    maxPerSettlement: 3,
    description: 'Warm hearth hall where woodland kin share stories, cider, and alliances.',
  },
  workshop: {
    type: 'workshop',
    displayName: 'Artisan Workshop',
    cost: { timber: 14, stone: 6 },
    footprintRadius: 2.5,
    housingCapacity: 1,
    prosperityValue: 22,
    devotionValue: 1,
    maxPerSettlement: 4,
    description: 'Craft hall refining timber, stone, and herbs into prized trade wares and masonry.',
  },
  windmill: {
    type: 'windmill',
    displayName: 'Meadow Windmill',
    cost: { timber: 16, stone: 6 },
    footprintRadius: 2.7,
    housingCapacity: 1,
    prosperityValue: 26,
    devotionValue: 2,
    maxPerSettlement: 2,
    minCompletedToUnlock: 3,
    description: 'Sweeping canvas-sailed mill tower grinding harvest grain and turning timber planks.',
  },
  greenhouse: {
    type: 'greenhouse',
    displayName: 'Canopy Conservatory',
    cost: { timber: 12, stone: 6, herbs: 4 },
    footprintRadius: 2.6,
    housingCapacity: 0,
    prosperityValue: 24,
    devotionValue: 4,
    maxPerSettlement: 3,
    minCompletedToUnlock: 3,
    description: 'Sunlit brass-and-glass botanical dome cultivating rare herbs and berries year-round.',
  },
  watchtower: {
    type: 'watchtower',
    displayName: 'Bough Watchtower',
    cost: { timber: 14, stone: 7 },
    footprintRadius: 2.1,
    housingCapacity: 1,
    prosperityValue: 15,
    devotionValue: 2,
    maxPerSettlement: 4,
    description: 'Tall timber lookout perched over the clearings to spot caravans, raiders, and omens.',
  },
  shrine: {
    type: 'shrine',
    displayName: 'Sylvan Shrine',
    cost: { timber: 11, stone: 9, herbs: 5 },
    footprintRadius: 2.4,
    housingCapacity: 0,
    prosperityValue: 18,
    devotionValue: 16,
    maxPerSettlement: 3,
    description: 'Mossy stone altar channeling creature prayers directly to the forest deity.',
  },
  fountain_plaza: {
    type: 'fountain_plaza',
    displayName: 'Starlight Fountain',
    cost: { stone: 10, herbs: 3 },
    footprintRadius: 2.6,
    housingCapacity: 0,
    prosperityValue: 28,
    devotionValue: 6,
    maxPerSettlement: 2,
    minCompletedToUnlock: 4,
    description: 'Carved stone water garden with shimmering spring jets, benches, and evening lanterns.',
  },
  library: {
    type: 'library',
    displayName: 'Owl Archive',
    cost: { timber: 16, stone: 10, herbs: 4 },
    footprintRadius: 2.8,
    housingCapacity: 2,
    prosperityValue: 32,
    devotionValue: 10,
    maxPerSettlement: 2,
    minCompletedToUnlock: 5,
    description: 'Domed octagonal woodland library preserving star-charts, lore scrolls, and craft blueprints.',
  },
  guildhall: {
    type: 'guildhall',
    displayName: 'Grand Guildhall',
    cost: { timber: 20, stone: 12, crafts: 4 },
    footprintRadius: 3.3,
    housingCapacity: 4,
    prosperityValue: 44,
    devotionValue: 8,
    maxPerSettlement: 2,
    minCompletedToUnlock: 6,
    description: 'Monumental civic hall with twin gables and a gleaming bell cupola anchoring a growing city.',
  },
};

export const SETTLEMENT_NAMES = [
  'Bramblehollow',
  'Mossmere',
  'Oakspire',
  'Fernwatch',
  'Cinderburrow',
  'Dewbrook',
  'Thornhaven',
  'Aldercrest',
  'Willowford',
  'Amberglade',
];

export const FACTION_BANNER_COLORS = [
  0xc96f32, // Autumn amber
  0x3f8f6b, // Moss emerald
  0x4b78b8, // River sapphire
  0xb5485b, // Berry crimson
  0xc7a338, // Golden pollen
  0x7e5ca8, // Twilight plum
];
