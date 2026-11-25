export type QualityPreset = 'balanced' | 'high' | 'ultra';

export interface WorldConfig {
  readonly seed: number;
  readonly worldSize: number; // playable valley diameter in meters (centered at 0,0)
  readonly terrainSegments: number;
  readonly waterLevel: number;
  readonly initialSettlements: number;
  readonly maxSettlements: number;
  readonly initialCreaturesPerSettlement: number;
  readonly maxPopulation: number;
  readonly dayLengthSeconds: number;
  readonly daysPerSeason: number;
  readonly treeCount: number;
  readonly undergrowthCount: number;
  readonly rockCount: number;
  readonly grassBladeCount: number;
  readonly deityDecisionIntervalSec: number;
  readonly tradeIntervalSec: number;
  readonly diplomacyIntervalSec: number;
}

export interface QualityConfig {
  readonly pixelRatioCap: number;
  readonly shadowMapSize: number;
  readonly enableBloom: boolean;
  readonly dofTaps: number;
  readonly grassMultiplier: number;
  readonly textureResolution: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  balanced: {
    pixelRatioCap: 1.5,
    shadowMapSize: 1024,
    enableBloom: false,
    dofTaps: 10,
    grassMultiplier: 0.55,
    textureResolution: 256,
  },
  high: {
    pixelRatioCap: 2.0,
    shadowMapSize: 2048,
    enableBloom: true,
    dofTaps: 16,
    grassMultiplier: 1.0,
    textureResolution: 512,
  },
  ultra: {
    pixelRatioCap: 2.0,
    shadowMapSize: 4096,
    enableBloom: true,
    dofTaps: 20,
    grassMultiplier: 1.45,
    textureResolution: 512,
  },
};

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  seed: 20261123,
  worldSize: 640,
  terrainSegments: 224,
  waterLevel: -0.65,
  initialSettlements: 1,
  maxSettlements: 12,
  initialCreaturesPerSettlement: 12,
  maxPopulation: 340,
  dayLengthSeconds: 110,
  daysPerSeason: 6,
  treeCount: 1150,
  undergrowthCount: 1250,
  rockCount: 460,
  grassBladeCount: 16000,
  deityDecisionIntervalSec: 16,
  tradeIntervalSec: 12,
  diplomacyIntervalSec: 18,
};
