import type { DivineEventType, DivineImpactPolarity, WeatherType } from '@core/Types';

export interface DivineEventDefinition {
  readonly type: DivineEventType;
  readonly label: string;
  readonly icon: string;
  readonly colorHex: number;
  readonly energyCost: number;
  readonly radius: number;
  /** Duration (seconds) of the visible heavenly manifestation beam & shockwave. */
  readonly duration: number;
  /** Duration (seconds) of the lasting ecological upheaval or restoration epoch. */
  readonly influenceDuration: number;
  readonly weatherShift?: WeatherType;
  readonly alignment: 'benevolent' | 'wrathful' | 'mystic' | 'chaotic';
  readonly polarity: DivineImpactPolarity;
  readonly description: string;
  /** Subtle ecological reflection echoing real-world environmental pressures & stewardship. */
  readonly ecologicalReflection: string;
}

export const DIVINE_EVENT_CATALOG: Record<DivineEventType, DivineEventDefinition> = {
  great_deluge: {
    type: 'great_deluge',
    label: 'The Rising Deluge',
    icon: '🌊',
    colorHex: 0x3b8ed6,
    energyCost: 60,
    radius: 42,
    duration: 18,
    influenceDuration: 68,
    weatherShift: 'storm',
    alignment: 'wrathful',
    polarity: 'disruptive',
    description:
      'Swollen rivers and surging coastal tides drown low-lying ground, washing away stores and testing flood-adapted homes.',
    ecologicalReflection:
      'Rising waters spare stilted pilings and riverfolk while forcing lowland kin to flee uphill and rebuild.',
  },
  scorching_drought: {
    type: 'scorching_drought',
    label: 'The Long Scorch',
    icon: '🔥',
    colorHex: 0xf27d3b,
    energyCost: 62,
    radius: 54,
    duration: 19,
    influenceDuration: 80,
    weatherShift: 'clear',
    alignment: 'wrathful',
    polarity: 'disruptive',
    description:
      'A relentless fever bakes the valley, parching berry groves, slowing regrowth, and straining harvests across the realm.',
    ecologicalReflection:
      'Climate warmth favors arid-adapted kin and cistern towns while lush groves must ration, trade, or seek cooler ground.',
  },
  habitat_clearing: {
    type: 'habitat_clearing',
    label: 'The Great Clearing',
    icon: '🪓',
    colorHex: 0xd9563f,
    energyCost: 64,
    radius: 34,
    duration: 17,
    influenceDuration: 62,
    alignment: 'chaotic',
    polarity: 'disruptive',
    description:
      'An unseen force strips a broad swath of ancient canopy to bare earth, shattering nests and fragmenting foraging grounds.',
    ecologicalReflection:
      'Lost woodland leaves a lasting scar; displaced kin must range farther afield, adapt, or trek to untouched wilds.',
  },
  ashen_miasma: {
    type: 'ashen_miasma',
    label: 'The Ashen Pall',
    icon: '🌫️',
    colorHex: 0x9b8268,
    energyCost: 58,
    radius: 38,
    duration: 17,
    influenceDuration: 64,
    alignment: 'wrathful',
    polarity: 'disruptive',
    description:
      'A bitter, smoky haze and fouled runoff settle over a crowded valley, poisoning forage and weakening vulnerable waterside kin.',
    ecologicalReflection:
      'Polluted air and streams strike river-dwellers hardest; greenhouses, shrines, and sanctuaries shelter those who endure.',
  },
  polar_snap: {
    type: 'polar_snap',
    label: 'The Unseasonal Freeze',
    icon: '❄️',
    colorHex: 0x8cc9ff,
    energyCost: 56,
    radius: 48,
    duration: 17,
    influenceDuration: 66,
    weatherShift: 'snow',
    alignment: 'chaotic',
    polarity: 'disruptive',
    description:
      'An erratic arctic plunge locks the canopy in biting snow, freezing wild forage and testing every hearth and roof.',
    ecologicalReflection:
      'Sudden climate swings reward stout mountain holds and well-housed villages while leaving exposed kin vulnerable to the cold.',
  },
  sanctuary_rewilding: {
    type: 'sanctuary_rewilding',
    label: 'The Living Rewilding',
    icon: '🌱',
    colorHex: 0x57db7d,
    energyCost: 56,
    radius: 52,
    duration: 18,
    influenceDuration: 72,
    weatherShift: 'blossom',
    alignment: 'benevolent',
    polarity: 'restorative',
    description:
      'Saplings surge across scarred clearings, blighted soil clears, and wild berry, herb, and acorn groves return in abundance.',
    ecologicalReflection:
      'Deliberate protection lets felled woods regrow and wounded ecosystems recover stronger than before.',
  },
  migration_corridor: {
    type: 'migration_corridor',
    label: 'The Safe Corridor',
    icon: '🦌',
    colorHex: 0x4fd1c5,
    energyCost: 54,
    radius: 40,
    duration: 16,
    influenceDuration: 60,
    alignment: 'mystic',
    polarity: 'restorative',
    description:
      'Sheltered passages open across the valley, welcoming returning species, mending river crossings, and uniting distant kin.',
    ecologicalReflection:
      'Connected habitats restore lost biodiversity, knit fractured settlements together, and renew struggling lineages.',
  },
  sunlit_blessing: {
    type: 'sunlit_blessing',
    label: "Steward's Harvest",
    icon: '☀️',
    colorHex: 0xffd56b,
    energyCost: 54,
    radius: 44,
    duration: 16,
    influenceDuration: 62,
    weatherShift: 'sunbeams',
    alignment: 'benevolent',
    polarity: 'restorative',
    description:
      'Gentle sunbeams calm turbulent waters, refill village granaries, heal weary kin, and speed the rebuilding of broken roofs.',
    ecologicalReflection:
      'Patient care and shared abundance mend what upheaval broke, helping resilient communities flourish anew.',
  },
};
