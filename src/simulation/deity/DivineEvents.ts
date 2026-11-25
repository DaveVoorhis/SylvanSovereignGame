import type { DivineEventType, WeatherType } from '@core/Types';

export interface DivineEventDefinition {
  readonly type: DivineEventType;
  readonly label: string;
  readonly colorHex: number;
  readonly energyCost: number;
  readonly radius: number;
  readonly duration: number;
  readonly weatherShift?: WeatherType;
  readonly alignment: 'benevolent' | 'wrathful' | 'mystic' | 'chaotic';
  readonly description: string;
}

export const DIVINE_EVENT_CATALOG: Record<DivineEventType, DivineEventDefinition> = {
  bountiful_bloom: {
    type: 'bountiful_bloom',
    label: 'Bountiful Bloom',
    colorHex: 0x73e688,
    energyCost: 24,
    radius: 22,
    duration: 12,
    weatherShift: 'blossom',
    alignment: 'benevolent',
    description: 'Ancient roots surge with sap, replenishing berries, acorns, and herbs.',
  },
  sunlit_blessing: {
    type: 'sunlit_blessing',
    label: 'Sunlit Blessing',
    colorHex: 0xffd56b,
    energyCost: 22,
    radius: 18,
    duration: 10,
    weatherShift: 'sunbeams',
    alignment: 'benevolent',
    description: 'Golden shafts of canopy light warm a settlement and inspire rapid building.',
  },
  healing_dew: {
    type: 'healing_dew',
    label: 'Healing Dew',
    colorHex: 0x6ce5d8,
    energyCost: 20,
    radius: 20,
    duration: 10,
    weatherShift: 'mist',
    alignment: 'benevolent',
    description: 'Luminous forest mist mends wounded woodland folk and eases old rivalries.',
  },
  silver_rain: {
    type: 'silver_rain',
    label: 'Silver Rain',
    colorHex: 0x7ab4ff,
    energyCost: 18,
    radius: 28,
    duration: 14,
    weatherShift: 'rain',
    alignment: 'mystic',
    description: 'A nourishing silver shower feeds the stream and fills mossy hollows.',
  },
  spirit_lanterns: {
    type: 'spirit_lanterns',
    label: 'Spirit Lanterns',
    colorHex: 0xc299ff,
    energyCost: 20,
    radius: 20,
    duration: 12,
    alignment: 'mystic',
    description: 'Floating wisps drift through the canopy, awakening awe and shrine devotion.',
  },
  wanderers_omen: {
    type: 'wanderers_omen',
    label: "Wanderer's Omen",
    colorHex: 0x52c7b8,
    energyCost: 25,
    radius: 16,
    duration: 9,
    alignment: 'mystic',
    description: 'Calls a rare woodland traveler to join a favored settlement.',
  },
  ancient_whisper: {
    type: 'ancient_whisper',
    label: 'Ancient Whisper',
    colorHex: 0xeda66b,
    energyCost: 18,
    radius: 20,
    duration: 9,
    alignment: 'chaotic',
    description: 'Mischievous winds stir ambition, bold trades, and unpredictable diplomacy.',
  },
  thunder_judgment: {
    type: 'thunder_judgment',
    label: 'Thunder Judgment',
    colorHex: 0xff6b57,
    energyCost: 30,
    radius: 19,
    duration: 11,
    weatherShift: 'storm',
    alignment: 'wrathful',
    description: 'Crackling storm clouds rebuke greedy or warring settlements with awe.',
  },
  thorn_blight: {
    type: 'thorn_blight',
    label: 'Thorn Blight',
    colorHex: 0xb8466e,
    energyCost: 26,
    radius: 18,
    duration: 11,
    weatherShift: 'mist',
    alignment: 'wrathful',
    description: 'Creeping brambles briefly wither nearby forage, testing woodland resilience.',
  },
  frost_veil: {
    type: 'frost_veil',
    label: 'Frost Veil',
    colorHex: 0xb8e4ff,
    energyCost: 24,
    radius: 24,
    duration: 12,
    weatherShift: 'snow',
    alignment: 'chaotic',
    description: 'A sudden crystalline chill blankets the boughs, drawing creatures to their hearths.',
  },
};
