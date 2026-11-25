import type {
  BiomeType,
  BuildingType,
  ResourceType,
  SpeciesId,
  VillageAdaptationId,
} from '@core/Types';

export type AdaptationHatStyle =
  | 'reed_hat'
  | 'fur_collar'
  | 'straw_hat'
  | 'leaf_hood'
  | 'sun_scarf'
  | 'mariner_hat';

export interface VillageAdaptationProfile {
  readonly id: VillageAdaptationId;
  readonly title: string;
  readonly shortLabel: string;
  readonly icon: string;
  readonly primaryBiomes: readonly BiomeType[];
  readonly architectureSummary: string;
  readonly clothingSummary: string;
  readonly economySummary: string;
  readonly summary: string;
  readonly adaptedSpecies: readonly SpeciesId[];
  readonly settlementNames: readonly string[];
  readonly starterHome: BuildingType;
  readonly starterCivic: BuildingType;
  readonly starterPlot: BuildingType;
  readonly favoredBuildings: Partial<Record<BuildingType, number>>;
  readonly gatherBonus: Partial<Record<ResourceType, number>>;
  readonly passiveYield: Partial<Record<ResourceType, number>>;
  readonly buildSpeedBonus: { readonly timber: number; readonly masonry: number };
  readonly tradeBonusMultiplier: number;
  readonly devotionBonusMultiplier: number;
  readonly preferredBridgeStyle: 'timber_arch' | 'stone_arch';
  readonly bridgeEagerness: number;
  readonly exportSpecialties: readonly ResourceType[];
  readonly importNeeds: readonly ResourceType[];
  readonly attirePalette: {
    readonly mantleColor: number;
    readonly accentColor: number;
    readonly hatStyle: AdaptationHatStyle;
  };
  readonly thoughts: readonly string[];
}

export const ALL_VILLAGE_ADAPTATIONS: readonly VillageAdaptationId[] = [
  'forest_canopy',
  'coastal_harbor',
  'desert_oasis',
  'prairie_pastoral',
  'mountain_stone',
  'riverside_stilts',
];

export const VILLAGE_ADAPTATION_CATALOG: Record<VillageAdaptationId, VillageAdaptationProfile> = {
  forest_canopy: {
    id: 'forest_canopy',
    title: 'Deep-Forest Canopy Grove',
    shortLabel: 'Deep Forest',
    icon: '🌲',
    primaryBiomes: ['deep_woods'],
    architectureSummary:
      'Gnarled timber-framed cottages crowned with mossy living roofs, carved spirit-totem poles, and glowing fairy lanterns',
    clothingSummary: 'Leaf-woven woodland hoods, moss-green cloaks, and warm glowing belt trail-lanterns',
    economySummary: 'Abundant old-growth timber, acorns, and deep spiritual devotion at ancient shrines',
    summary:
      'Beneath towering old-growth oaks, forest dwellers weave living moss roofs and hang lantern trails through the dappled shade.',
    adaptedSpecies: ['owl', 'squirrel', 'fox', 'hedgehog', 'robin'],
    settlementNames: ['Elderhollow', 'Whisperbough', 'Bramblehaven', 'Oakenvale', 'Lanternshade', 'Mosswood'],
    starterHome: 'burrow_cottage',
    starterCivic: 'shrine',
    starterPlot: 'workshop',
    favoredBuildings: {
      shrine: 18,
      library: 14,
      workshop: 12,
      greenhouse: 10,
      burrow_cottage: 10,
    },
    gatherBonus: { timber: 1.32, acorns: 1.25, herbs: 1.12 },
    passiveYield: { timber: 0.72, acorns: 0.45 },
    buildSpeedBonus: { timber: 1.18, masonry: 1.0 },
    tradeBonusMultiplier: 1.08,
    devotionBonusMultiplier: 1.28,
    preferredBridgeStyle: 'timber_arch',
    bridgeEagerness: 0.48,
    exportSpecialties: ['timber', 'acorns'],
    importNeeds: ['stone', 'crafts'],
    attirePalette: {
      mantleColor: 0x3f6b3e,
      accentColor: 0xc2d86e,
      hatStyle: 'leaf_hood',
    },
    thoughts: [
      'Trimming glowing moss along our living eaves',
      'Stringing warm fairy lanterns through the ancient oaks',
      'Listening to the wind sigh through the deep canopy',
      'Gathering fallen oak timber beneath the boughs',
    ],
  },

  coastal_harbor: {
    id: 'coastal_harbor',
    title: 'Seashore Wharf & Harbor',
    shortLabel: 'Seashore',
    icon: '⛵',
    primaryBiomes: ['seashore'],
    architectureSummary:
      'Salt-weathered driftwood piers, sea-slate gabled roofs, harbor beacon lanterns, and moored wooden sailboats',
    clothingSummary: 'Waxed mariner storm-hats, sea-teal oilskin mantles, and brass harbor clasps',
    economySummary: 'Seafaring trade harbors, coastal kelp & herb foraging, and brisk driftwood carpentry',
    summary:
      'Set beside tidal sands and rolling waves, coastal villagers raise driftwood wharves, light harbor beacons, and trade far along the coast.',
    adaptedSpecies: ['crow', 'frog', 'fox', 'sparrow', 'rat'],
    settlementNames: ['Saltcrest', 'Driftwharf', 'Gullhaven', 'Tidewatch', 'Shellbay', 'Breakerpoint'],
    starterHome: 'timber_house',
    starterCivic: 'market_stall',
    starterPlot: 'watchtower',
    favoredBuildings: {
      market_stall: 18,
      watchtower: 16,
      tavern: 14,
      timber_house: 14,
      guildhall: 12,
    },
    gatherBonus: { herbs: 1.25, berries: 1.22, timber: 1.12 },
    passiveYield: { herbs: 0.55, crafts: 0.32, berries: 0.35 },
    buildSpeedBonus: { timber: 1.24, masonry: 1.04 },
    tradeBonusMultiplier: 1.3,
    devotionBonusMultiplier: 1.05,
    preferredBridgeStyle: 'timber_arch',
    bridgeEagerness: 0.72,
    exportSpecialties: ['herbs', 'crafts'],
    importNeeds: ['timber', 'stone'],
    attirePalette: {
      mantleColor: 0x2f687a,
      accentColor: 0xead79b,
      hatStyle: 'mariner_hat',
    },
    thoughts: [
      'Checking the moorings as the ocean tide rolls in',
      'Smelling salt spray and pine resin along the wharf',
      'Polishing the harbor beacon lantern before dusk',
      'Trading sea-salt herbs with inland caravans',
    ],
  },

  desert_oasis: {
    id: 'desert_oasis',
    title: 'Desert Adobe & Oasis',
    shortLabel: 'Desert',
    icon: '🏜️',
    primaryBiomes: ['desert'],
    architectureSummary:
      'Sun-baked adobe walls, cool terracotta roofs, woven ochre canvas shade-pergolas, clay water amphorae, and tiled oasis cisterns',
    clothingSummary: 'Flowing saffron sun-scarves, sand-pale desert headwraps, and terracotta trim',
    economySummary: 'Master artisans and far-ranging caravan merchants crafting glazed wares and oasis spices',
    summary:
      'Across golden dunes and sandstone mesas, desert settlers shade their plazas with ochre canvas, store cool water in amphorae, and lead rich caravans.',
    adaptedSpecies: ['fox', 'crow', 'sparrow', 'mouse', 'owl'],
    settlementNames: ['Sunspire', 'Ochre Oasis', 'Duneward', 'Saffron Well', 'Redmesa', 'Mirage Rest'],
    starterHome: 'burrow_cottage',
    starterCivic: 'fountain_plaza',
    starterPlot: 'workshop',
    favoredBuildings: {
      fountain_plaza: 22,
      workshop: 18,
      market_stall: 16,
      guildhall: 14,
      bakery: 10,
    },
    gatherBonus: { stone: 1.24, herbs: 1.18, acorns: 1.1 },
    passiveYield: { crafts: 0.44, stone: 0.42 },
    buildSpeedBonus: { timber: 1.02, masonry: 1.24 },
    tradeBonusMultiplier: 1.36,
    devotionBonusMultiplier: 1.14,
    preferredBridgeStyle: 'stone_arch',
    bridgeEagerness: 0.42,
    exportSpecialties: ['crafts', 'stone'],
    importNeeds: ['timber', 'berries'],
    attirePalette: {
      mantleColor: 0xc46b3b,
      accentColor: 0xf2c96b,
      hatStyle: 'sun_scarf',
    },
    thoughts: [
      'Resting beneath the cool ochre canvas pergola',
      'Drawing chilled spring water from the oasis cistern',
      'Glazing desert pottery to trade with distant forests',
      'Watching golden wind ripples shift across the dunes',
    ],
  },

  prairie_pastoral: {
    id: 'prairie_pastoral',
    title: 'Prairie & Meadow Homestead',
    shortLabel: 'Prairie',
    icon: '🌾',
    primaryBiomes: ['prairie', 'meadow'],
    architectureSummary:
      'Sun-warmed cottages with golden straw-thatch roofs, timber windmills, raised berry & grain beds, and windswept festive bunting',
    clothingSummary: 'Wide woven straw sun-hats, wheat-gold aprons, and clover-dyed linen mantles',
    economySummary: 'Abundant grain, berry, and acorn harvests feeding bustling mills, bakeries, and open markets',
    summary:
      'Across wide sunlit grasslands and wildflower plains, pastoral villagers harness steady prairie winds with windmills and harvest abundant stores.',
    adaptedSpecies: ['rabbit', 'mouse', 'sparrow', 'robin', 'hedgehog'],
    settlementNames: ['Goldfield', 'Windmeadow', 'Clovercrest', 'Sunsteppe', 'Wheatglen', 'Breezehollow'],
    starterHome: 'burrow_cottage',
    starterCivic: 'windmill',
    starterPlot: 'granary',
    favoredBuildings: {
      windmill: 20,
      granary: 18,
      bakery: 18,
      market_stall: 14,
      greenhouse: 12,
    },
    gatherBonus: { berries: 1.34, acorns: 1.3 },
    passiveYield: { berries: 0.62, acorns: 0.54 },
    buildSpeedBonus: { timber: 1.14, masonry: 1.04 },
    tradeBonusMultiplier: 1.18,
    devotionBonusMultiplier: 1.08,
    preferredBridgeStyle: 'timber_arch',
    bridgeEagerness: 0.5,
    exportSpecialties: ['berries', 'acorns'],
    importNeeds: ['stone', 'timber'],
    attirePalette: {
      mantleColor: 0xb88f3b,
      accentColor: 0xf4dc84,
      hatStyle: 'straw_hat',
    },
    thoughts: [
      'Watching the windmill sails turn in the prairie breeze',
      'Tending sweet wild berries along the sunlit fence',
      'Drying golden grain sheaves before market day',
      'Admiring endless rolling waves of prairie grass',
    ],
  },

  mountain_stone: {
    id: 'mountain_stone',
    title: 'Mountain Stone Hold',
    shortLabel: 'Mountain',
    icon: '⛰️',
    primaryBiomes: ['rocky_ridge', 'alpine_crag'],
    architectureSummary:
      'Deep buttressed granite retaining foundations, steep dark slate roofs, stone hearth windbreaks, and stout watchtowers',
    clothingSummary: 'Plush fur-trimmed alpine collars, thick heather wool cloaks, and forged brass clasps',
    economySummary: 'Rich mountain stone quarries, swift alpine masonry, and durable stone-arch bridges',
    summary:
      'Perched on terraced granite ledges below snow-dusted crags, mountain villagers anchor stone homes against fierce highland gales.',
    adaptedSpecies: ['badger', 'owl', 'crow', 'fox', 'hedgehog'],
    settlementNames: ['Cragwatch', 'Granitehearth', 'Frostspire', 'Stonebench', 'Cairnpeak', 'Ironridge'],
    starterHome: 'timber_house',
    starterCivic: 'watchtower',
    starterPlot: 'workshop',
    favoredBuildings: {
      watchtower: 18,
      workshop: 16,
      guildhall: 14,
      library: 12,
      timber_house: 12,
    },
    gatherBonus: { stone: 1.38, timber: 1.1 },
    passiveYield: { stone: 0.72, crafts: 0.24 },
    buildSpeedBonus: { timber: 1.02, masonry: 1.28 },
    tradeBonusMultiplier: 1.14,
    devotionBonusMultiplier: 1.12,
    preferredBridgeStyle: 'stone_arch',
    bridgeEagerness: 0.54,
    exportSpecialties: ['stone', 'crafts'],
    importNeeds: ['berries', 'herbs'],
    attirePalette: {
      mantleColor: 0x5c6775,
      accentColor: 0xdbe3ec,
      hatStyle: 'fur_collar',
    },
    thoughts: [
      'Stacking quarried granite against the mountain wind',
      'Pulling my warm fur collar tight in the crisp alpine air',
      'Gazing out from the stone terrace over the distant valleys',
      'Chiseling fresh slate shingles for the steep roof',
    ],
  },

  riverside_stilts: {
    id: 'riverside_stilts',
    title: 'Riverside Stilt-Village',
    shortLabel: 'Riverside',
    icon: '🛶',
    primaryBiomes: ['riverbank', 'moss_hollow'],
    architectureSummary:
      'Elevated cedar stilt pilings, broad timber boardwalk plazas, mossy flood-proof roofs, mooring posts, and river skiffs',
    clothingSummary: 'Woven conical reed rain hats, waxed willow-green cloaks, and bog-berry satchels',
    economySummary: 'Lush river-bank herbs, fertile fen berries, and eager timber-arch bridgecraft',
    summary:
      'Built high on pilings above rushing streams and misty fens, riverside folk keep dry above seasonal floods and span rivers with arched bridges.',
    adaptedSpecies: ['frog', 'rat', 'robin', 'badger', 'mouse'],
    settlementNames: ['Willowford', 'Reedwalk', 'Fenbridge', 'Creekstilt', 'Brookhaven', 'Mistybank'],
    starterHome: 'burrow_cottage',
    starterCivic: 'greenhouse',
    starterPlot: 'market_stall',
    favoredBuildings: {
      greenhouse: 18,
      tavern: 14,
      market_stall: 14,
      burrow_cottage: 12,
      fountain_plaza: 10,
    },
    gatherBonus: { herbs: 1.35, berries: 1.24, timber: 1.08 },
    passiveYield: { herbs: 0.62, berries: 0.42 },
    buildSpeedBonus: { timber: 1.22, masonry: 0.98 },
    tradeBonusMultiplier: 1.16,
    devotionBonusMultiplier: 1.06,
    preferredBridgeStyle: 'timber_arch',
    bridgeEagerness: 0.82,
    exportSpecialties: ['herbs', 'berries'],
    importNeeds: ['stone', 'crafts'],
    attirePalette: {
      mantleColor: 0x3b7a68,
      accentColor: 0x99d1b6,
      hatStyle: 'reed_hat',
    },
    thoughts: [
      'Checking the cedar stilt pilings before the spring thaw',
      'Gathering fragrant river-mint along the mossy bank',
      'Listening to the rushing stream beneath our boardwalk',
      'Pushing our skiff out into the cool river current',
    ],
  },
};

/** Maps terrain biome & micro-climate cues to the matching environmental village adaptation. */
export function resolveVillageAdaptation(
  biome: BiomeType,
  elevation: number,
  waterDist: number,
  moisture: number,
  coastDist = 999,
): VillageAdaptationId {
  if (biome === 'seashore' || (coastDist >= 0 && coastDist < 16 && elevation < 2.2)) {
    return 'coastal_harbor';
  }
  if (biome === 'desert') {
    return 'desert_oasis';
  }
  if (biome === 'alpine_crag' || biome === 'rocky_ridge' || elevation > 6.2) {
    return 'mountain_stone';
  }
  if (biome === 'riverbank' || biome === 'moss_hollow' || (waterDist < 10.5 && moisture > 0.56)) {
    return 'riverside_stilts';
  }
  if (biome === 'prairie' || biome === 'meadow') {
    return 'prairie_pastoral';
  }
  return 'forest_canopy';
}

export function getBiomeDisplayName(biome: BiomeType): string {
  switch (biome) {
    case 'deep_woods':
      return 'Deep Forest';
    case 'meadow':
      return 'Sunlit Meadow';
    case 'prairie':
      return 'Windswept Prairie';
    case 'desert':
      return 'Golden Desert';
    case 'seashore':
      return 'Sandy Seashore';
    case 'riverbank':
      return 'Riverside Bank';
    case 'rocky_ridge':
      return 'Mountain Foothills';
    case 'moss_hollow':
      return 'Misty Moss Fen';
    case 'alpine_crag':
      return 'Alpine Mountain Crag';
    case 'water':
      return 'Open Water';
  }
}
