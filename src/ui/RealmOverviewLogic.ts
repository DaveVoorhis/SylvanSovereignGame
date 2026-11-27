import type {
  BuildingType,
  ChronicleEntry,
  ConstructionStage,
  DiplomaticStance,
  LifeStage,
  ResourceType,
  SettlementTier,
  SpeciesId,
  Vec2,
} from '@core/Types';
import { ADULT_AGE_DAYS } from '@simulation/creatures/Creature';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { getBuildingStage, getConstructionStageLabel } from '@simulation/settlements/Settlement';
import {
  getBiomeDisplayName,
  VILLAGE_ADAPTATION_CATALOG,
} from '@simulation/settlements/VillageAdaptation';
import type { BridgeStyle } from '@simulation/terrain/Bridge';
import type { WorldState } from '@simulation/WorldState';

export type RealmOverviewTab = 'young' | 'buildings' | 'trade' | 'pioneers';

function colorHex(num: number): string {
  return `#${num.toString(16).padStart(6, '0')}`;
}

/* =========================================================================
   1. YOUNG & NURSERY SUMMARY
   ========================================================================= */

export interface YoungCreatureRow {
  readonly id: string;
  readonly name: string;
  readonly species: SpeciesId;
  readonly speciesName: string;
  readonly speciesColor: string;
  readonly youngTerm: string;
  readonly lifeStage: Extract<LifeStage, 'young' | 'juvenile'>;
  readonly ageDays: number;
  readonly growthPct: number;
  readonly daysToAdulthood: number;
  readonly generation: number;
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly parents: readonly { readonly id: string; readonly name: string }[];
  readonly littermatesCount: number;
  readonly activity: string;
  readonly mood: number;
  readonly thought: string;
}

export interface BondedPairSummary {
  readonly pairKey: string;
  readonly firstId: string;
  readonly firstName: string;
  readonly secondId: string;
  readonly secondName: string;
  readonly speciesName: string;
  readonly speciesColor: string;
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly livingOffspring: number;
  readonly readyToNest: boolean;
}

export interface SettlementNurserySummary {
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly youngCount: number;
  readonly newbornCount: number;
  readonly juvenileCount: number;
  readonly bondedPairs: number;
  readonly population: number;
  readonly housingCapacity: number;
}

export interface YoungSummarySnapshot {
  readonly totalYoung: number;
  readonly newbornCount: number;
  readonly juvenileCount: number;
  readonly activeLitters: number;
  readonly bondedPairsCount: number;
  readonly averageMood: number;
  readonly settlements: readonly SettlementNurserySummary[];
  readonly entries: readonly YoungCreatureRow[];
  readonly bondedPairs: readonly BondedPairSummary[];
}

export function buildYoungSummary(world: WorldState): YoungSummarySnapshot {
  const settlementById = new Map(world.settlements.map((s) => [s.id, s]));
  const creatureById = new Map(world.creatures.map((c) => [c.id, c]));

  const litterCounts = new Map<string, number>();
  for (const c of world.creatures) {
    if (!c.alive || !c.litterId) continue;
    litterCounts.set(c.litterId, (litterCounts.get(c.litterId) ?? 0) + 1);
  }

  const entries: YoungCreatureRow[] = [];
  const activeLitterIds = new Set<string>();
  let newbornCount = 0;
  let juvenileCount = 0;
  let moodSum = 0;

  const nurseryCounts = new Map<
    string,
    { newborn: number; juvenile: number; pairs: number; pop: number }
  >();
  for (const s of world.settlements) {
    nurseryCounts.set(s.id, { newborn: 0, juvenile: 0, pairs: 0, pop: 0 });
  }

  const seenPairs = new Set<string>();
  const bondedPairs: BondedPairSummary[] = [];

  for (const c of world.creatures) {
    if (!c.alive) continue;
    const settlement = settlementById.get(c.settlementId);
    const settlementBucket = nurseryCounts.get(c.settlementId);
    if (settlementBucket) settlementBucket.pop++;

    if (c.lifeStage === 'young' || c.lifeStage === 'juvenile') {
      if (c.lifeStage === 'young') {
        newbornCount++;
        const bucket = nurseryCounts.get(c.settlementId);
        if (bucket) bucket.newborn++;
      } else {
        juvenileCount++;
        const bucket = nurseryCounts.get(c.settlementId);
        if (bucket) bucket.juvenile++;
      }
      if (c.litterId) activeLitterIds.add(c.litterId);
      moodSum += c.mood;

      const parents = c.parentIds
        .map((pid) => creatureById.get(pid))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({ id: p.id, name: p.name }));

      const litterTotal = c.litterId ? (litterCounts.get(c.litterId) ?? 1) : 1;
      const growthPct = Math.max(0, Math.min(100, Math.round((c.ageDays / ADULT_AGE_DAYS) * 100)));

      entries.push({
        id: c.id,
        name: c.name,
        species: c.species,
        speciesName: c.def.displayName,
        speciesColor: colorHex(c.def.primaryColor),
        youngTerm: c.def.youngSingular,
        lifeStage: c.lifeStage,
        ageDays: c.ageDays,
        growthPct,
        daysToAdulthood: Math.max(0, ADULT_AGE_DAYS - c.ageDays),
        generation: c.generation,
        settlementId: c.settlementId,
        settlementName: settlement?.name ?? 'Wanderer',
        settlementColor: settlement ? colorHex(settlement.bannerColor) : '#8aa68b',
        parents,
        littermatesCount: Math.max(0, litterTotal - 1),
        activity: c.activity.replace('_', ' '),
        mood: Math.round(c.mood),
        thought: c.thought,
      });
    } else if (c.mateId) {
      const mate = creatureById.get(c.mateId);
      if (mate && mate.alive) {
        const pairKey = c.id < mate.id ? `${c.id}|${mate.id}` : `${mate.id}|${c.id}`;
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          const bucket = nurseryCounts.get(c.settlementId);
          if (bucket) bucket.pairs++;

          const sharedOffspring = new Set<string>();
          for (const oid of [...c.offspringIds, ...mate.offspringIds]) {
            const child = creatureById.get(oid);
            if (child && child.alive) sharedOffspring.add(oid);
          }

          bondedPairs.push({
            pairKey,
            firstId: c.id,
            firstName: c.name,
            secondId: mate.id,
            secondName: mate.name,
            speciesName: c.def.displayName,
            speciesColor: colorHex(c.def.primaryColor),
            settlementId: c.settlementId,
            settlementName: settlement?.name ?? 'Wanderer',
            settlementColor: settlement ? colorHex(settlement.bannerColor) : '#8aa68b',
            livingOffspring: sharedOffspring.size,
            readyToNest: c.canReproduce() && mate.canReproduce(),
          });
        }
      }
    }
  }

  entries.sort((a, b) => a.ageDays - b.ageDays || a.name.localeCompare(b.name));
  bondedPairs.sort(
    (a, b) => Number(b.readyToNest) - Number(a.readyToNest) || b.livingOffspring - a.livingOffspring,
  );

  const settlements: SettlementNurserySummary[] = world.settlements.map((s) => {
    const bucket = nurseryCounts.get(s.id) ?? { newborn: 0, juvenile: 0, pairs: 0, pop: 0 };
    return {
      settlementId: s.id,
      settlementName: s.name,
      settlementColor: colorHex(s.bannerColor),
      youngCount: bucket.newborn + bucket.juvenile,
      newbornCount: bucket.newborn,
      juvenileCount: bucket.juvenile,
      bondedPairs: bucket.pairs,
      population: bucket.pop,
      housingCapacity: s.getHousingCapacity(),
    };
  });

  return {
    totalYoung: entries.length,
    newbornCount,
    juvenileCount,
    activeLitters: activeLitterIds.size,
    bondedPairsCount: bondedPairs.length,
    averageMood: entries.length > 0 ? Math.round(moodSum / entries.length) : 0,
    settlements,
    entries,
    bondedPairs,
  };
}

/* =========================================================================
   2. BUILDINGS & PUBLIC WORKS SUMMARY
   ========================================================================= */

export interface BuildingRow {
  readonly id: string;
  readonly type: BuildingType;
  readonly displayName: string;
  readonly description: string;
  readonly frameStyle: 'timber' | 'masonry';
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly position: Vec2;
  readonly progress: number;
  readonly completed: boolean;
  readonly disassembling: boolean;
  readonly replacementName: string | null;
  readonly stage: ConstructionStage;
  readonly stageLabel: string;
  readonly housingCapacity: number;
  readonly prosperityValue: number;
  readonly devotionValue: number;
  readonly assignedBuilders: readonly { readonly id: string; readonly name: string }[];
}

export interface BridgeRow {
  readonly id: string;
  readonly style: BridgeStyle;
  readonly displayName: string;
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly position: Vec2;
  readonly length: number;
  readonly progress: number;
  readonly completed: boolean;
  readonly assignedBuilders: readonly { readonly id: string; readonly name: string }[];
}

export interface SettlementBuildingsSummary {
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly tier: SettlementTier;
  readonly adaptationIcon: string;
  readonly adaptationLabel: string;
  readonly completedCount: number;
  readonly activeCount: number;
  readonly population: number;
  readonly housingCapacity: number;
  readonly prosperity: number;
  readonly nextPlannedName: string | null;
}

export interface BuildingTypeCount {
  readonly type: BuildingType;
  readonly displayName: string;
  readonly completed: number;
  readonly inProgress: number;
}

export interface BuildingsSummarySnapshot {
  readonly completedBuildings: number;
  readonly underConstruction: number;
  readonly disassembling: number;
  readonly completedBridges: number;
  readonly bridgesInProgress: number;
  readonly totalHousingCapacity: number;
  readonly totalPopulation: number;
  readonly distinctTypes: number;
  readonly settlements: readonly SettlementBuildingsSummary[];
  readonly activeWorks: readonly BuildingRow[];
  readonly buildings: readonly BuildingRow[];
  readonly bridges: readonly BridgeRow[];
  readonly catalogCounts: readonly BuildingTypeCount[];
}

export function buildBuildingsSummary(world: WorldState): BuildingsSummarySnapshot {
  const settlementById = new Map(world.settlements.map((s) => [s.id, s]));

  // Map active builders to their target building or bridge
  const buildingBuilders = new Map<string, { id: string; name: string }[]>();
  const bridgeBuilders = new Map<string, { id: string; name: string }[]>();
  const popBySettlement = new Map<string, number>();
  for (const c of world.creatures) {
    if (!c.alive) continue;
    popBySettlement.set(c.settlementId, (popBySettlement.get(c.settlementId) ?? 0) + 1);
    if (c.activity !== 'building') continue;
    if (c.targetBuildingId) {
      const list = buildingBuilders.get(c.targetBuildingId) ?? [];
      list.push({ id: c.id, name: c.name });
      buildingBuilders.set(c.targetBuildingId, list);
    }
    if (c.targetBridgeId) {
      const list = bridgeBuilders.get(c.targetBridgeId) ?? [];
      list.push({ id: c.id, name: c.name });
      bridgeBuilders.set(c.targetBridgeId, list);
    }
  }

  let completedBuildings = 0;
  let underConstruction = 0;
  let disassembling = 0;
  let totalHousingCapacity = 0;
  let totalPopulation = 0;

  const buildings: BuildingRow[] = [];
  const activeWorks: BuildingRow[] = [];
  const typeBuckets = new Map<BuildingType, { completed: number; inProgress: number }>();

  const settlements: SettlementBuildingsSummary[] = [];

  for (const s of world.settlements) {
    const profile = s.getAdaptationProfile();
    const pop = popBySettlement.get(s.id) ?? 0;
    const cap = s.getHousingCapacity();
    totalHousingCapacity += cap;
    totalPopulation += pop;

    let sCompleted = 0;
    let sActive = 0;

    for (const b of s.buildings) {
      const bp = BUILDING_CATALOG[b.type];
      const stage = getBuildingStage(b);
      const stageLabel = getConstructionStageLabel(stage, bp.frameStyle);
      const isDisassembling = Boolean(b.disassembling);

      const bucket = typeBuckets.get(b.type) ?? { completed: 0, inProgress: 0 };
      if (isDisassembling) {
        disassembling++;
        sActive++;
        bucket.inProgress++;
      } else if (b.completed) {
        completedBuildings++;
        sCompleted++;
        bucket.completed++;
      } else {
        underConstruction++;
        sActive++;
        bucket.inProgress++;
      }
      typeBuckets.set(b.type, bucket);

      const row: BuildingRow = {
        id: b.id,
        type: b.type,
        displayName: bp.displayName,
        description: bp.description,
        frameStyle: bp.frameStyle,
        settlementId: s.id,
        settlementName: s.name,
        settlementColor: colorHex(s.bannerColor),
        position: b.position,
        progress: Math.round(b.progress),
        completed: b.completed && !isDisassembling,
        disassembling: isDisassembling,
        replacementName: b.replacementType ? BUILDING_CATALOG[b.replacementType].displayName : null,
        stage,
        stageLabel,
        housingCapacity: bp.housingCapacity,
        prosperityValue: bp.prosperityValue,
        devotionValue: bp.devotionValue,
        assignedBuilders: buildingBuilders.get(b.id) ?? [],
      };
      buildings.push(row);
      if (!row.completed) {
        activeWorks.push(row);
      }
    }

    settlements.push({
      settlementId: s.id,
      settlementName: s.name,
      settlementColor: colorHex(s.bannerColor),
      tier: s.tier,
      adaptationIcon: profile.icon,
      adaptationLabel: profile.shortLabel,
      completedCount: sCompleted,
      activeCount: sActive,
      population: pop,
      housingCapacity: cap,
      prosperity: s.prosperity,
      nextPlannedName: s.nextPlannedBuilding
        ? BUILDING_CATALOG[s.nextPlannedBuilding].displayName
        : null,
    });
  }

  activeWorks.sort(
    (a, b) =>
      b.assignedBuilders.length - a.assignedBuilders.length ||
      b.progress - a.progress ||
      a.displayName.localeCompare(b.displayName),
  );

  buildings.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (!a.completed && a.progress !== b.progress) return b.progress - a.progress;
    return a.settlementName.localeCompare(b.settlementName) || a.displayName.localeCompare(b.displayName);
  });

  let completedBridges = 0;
  let bridgesInProgress = 0;
  const bridges: BridgeRow[] = world.bridges.map((br) => {
    const s = settlementById.get(br.settlementId);
    if (br.completed) completedBridges++;
    else bridgesInProgress++;
    return {
      id: br.id,
      style: br.style,
      displayName: br.style === 'stone_arch' ? 'Stone Arch Bridge' : 'Timber Arch Bridge',
      settlementId: br.settlementId,
      settlementName: s?.name ?? 'Realm Crossing',
      settlementColor: s ? colorHex(s.bannerColor) : '#a8b8aa',
      position: { x: br.centerX, z: br.centerZ },
      length: Math.round(br.length),
      progress: Math.round(br.progress),
      completed: br.completed,
      assignedBuilders: bridgeBuilders.get(br.id) ?? [],
    };
  });

  const catalogCounts: BuildingTypeCount[] = Array.from(typeBuckets.entries())
    .map(([type, counts]) => ({
      type,
      displayName: BUILDING_CATALOG[type].displayName,
      completed: counts.completed,
      inProgress: counts.inProgress,
    }))
    .sort((a, b) => b.completed + b.inProgress - (a.completed + a.inProgress));

  return {
    completedBuildings,
    underConstruction,
    disassembling,
    completedBridges,
    bridgesInProgress,
    totalHousingCapacity,
    totalPopulation,
    distinctTypes: typeBuckets.size,
    settlements,
    activeWorks,
    buildings,
    bridges,
    catalogCounts,
  };
}

/* =========================================================================
   3. TRADE & CARAVANS SUMMARY
   ========================================================================= */

export interface ActiveCaravanRow {
  readonly creatureId: string;
  readonly merchantName: string;
  readonly speciesName: string;
  readonly speciesColor: string;
  readonly originId: string;
  readonly originName: string;
  readonly originColor: string;
  readonly destinationId: string;
  readonly destinationName: string;
  readonly destinationColor: string;
  readonly cargoGood: ResourceType | null;
  readonly cargoAmount: number;
  readonly progressPct: number;
  readonly remainingDist: number;
  readonly wealth: number;
  readonly position: Vec2;
}

export interface TradeRouteRow {
  readonly fromId: string;
  readonly fromName: string;
  readonly fromColor: string;
  readonly fromAdaptation: string;
  readonly toId: string;
  readonly toName: string;
  readonly toColor: string;
  readonly toAdaptation: string;
  readonly activeCaravans: number;
  readonly stance: DiplomaticStance;
  readonly relationScore: number;
}

export interface SettlementEconomyRow {
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly adaptationIcon: string;
  readonly adaptationLabel: string;
  readonly treasury: number;
  readonly tradeVolume: number;
  readonly marketCount: number;
  readonly merchantCount: number;
  readonly exportSpecialties: readonly ResourceType[];
  readonly importNeeds: readonly ResourceType[];
  readonly stockpile: Readonly<Record<ResourceType, number>>;
}

export interface TradeSummarySnapshot {
  readonly activeCaravans: number;
  readonly activeRoutes: number;
  readonly totalTradeVolume: number;
  readonly totalTreasury: number;
  readonly totalMerchants: number;
  readonly alliedPairs: number;
  readonly warPairs: number;
  readonly caravans: readonly ActiveCaravanRow[];
  readonly routes: readonly TradeRouteRow[];
  readonly settlements: readonly SettlementEconomyRow[];
  readonly recentTrades: readonly ChronicleEntry[];
}

export function buildTradeSummary(world: WorldState): TradeSummarySnapshot {
  const settlementById = new Map(world.settlements.map((s) => [s.id, s]));
  const merchantsBySettlement = new Map<string, number>();

  const caravans: ActiveCaravanRow[] = [];
  let totalMerchants = 0;

  for (const c of world.creatures) {
    if (!c.alive) continue;
    if (c.role === 'merchant') {
      totalMerchants++;
      merchantsBySettlement.set(c.settlementId, (merchantsBySettlement.get(c.settlementId) ?? 0) + 1);
    }

    if (c.activity !== 'trading') continue;
    const origin = settlementById.get(c.settlementId);
    const dest = c.tradeDestinationSettlementId
      ? settlementById.get(c.tradeDestinationSettlementId)
      : undefined;

    const totalDist =
      origin && dest
        ? Math.max(1, Math.hypot(dest.center.x - origin.center.x, dest.center.z - origin.center.z))
        : 1;
    const remainingDist = dest ? Math.hypot(dest.center.x - c.x, dest.center.z - c.z) : 0;
    const progressPct = dest
      ? Math.max(0, Math.min(100, Math.round((1 - remainingDist / totalDist) * 100)))
      : 0;

    caravans.push({
      creatureId: c.id,
      merchantName: c.name,
      speciesName: c.def.displayName,
      speciesColor: colorHex(c.def.primaryColor),
      originId: c.settlementId,
      originName: origin?.name ?? 'Unknown',
      originColor: origin ? colorHex(origin.bannerColor) : '#9aa89b',
      destinationId: dest?.id ?? '',
      destinationName: dest?.name ?? 'Open Road',
      destinationColor: dest ? colorHex(dest.bannerColor) : '#9aa89b',
      cargoGood: c.tradeCarrying,
      cargoAmount: Math.round(c.tradeCargoAmount),
      progressPct,
      remainingDist: Math.round(remainingDist),
      wealth: Math.round(c.wealth),
      position: { x: c.x, z: c.z },
    });
  }

  caravans.sort((a, b) => b.progressPct - a.progressPct || a.merchantName.localeCompare(b.merchantName));

  // Build route pairs directly from live caravans (or economy.activeRoutes fallback) so summary is always fresh
  const routeMap = new Map<string, { fromId: string; toId: string; count: number }>();
  for (const car of caravans) {
    if (!car.destinationId) continue;
    const key =
      car.originId < car.destinationId
        ? `${car.originId}|${car.destinationId}`
        : `${car.destinationId}|${car.originId}`;
    const existing = routeMap.get(key);
    if (existing) existing.count++;
    else routeMap.set(key, { fromId: car.originId, toId: car.destinationId, count: 1 });
  }

  const routes: TradeRouteRow[] = [];
  for (const entry of routeMap.values()) {
    const from = settlementById.get(entry.fromId);
    const to = settlementById.get(entry.toId);
    if (!from || !to) continue;
    routes.push({
      fromId: from.id,
      fromName: from.name,
      fromColor: colorHex(from.bannerColor),
      fromAdaptation: from.getAdaptationProfile().shortLabel,
      toId: to.id,
      toName: to.name,
      toColor: colorHex(to.bannerColor),
      toAdaptation: to.getAdaptationProfile().shortLabel,
      activeCaravans: entry.count,
      stance: world.diplomacy.getStance(from.id, to.id),
      relationScore: Math.round(world.diplomacy.getScore(from.id, to.id)),
    });
  }
  routes.sort((a, b) => b.activeCaravans - a.activeCaravans || b.relationScore - a.relationScore);

  let totalTradeVolume = 0;
  let totalTreasury = 0;
  const settlements: SettlementEconomyRow[] = world.settlements.map((s) => {
    const profile = s.getAdaptationProfile();
    totalTradeVolume += s.tradeVolume;
    totalTreasury += Math.round(s.treasury);
    let marketCount = 0;
    for (let i = 0; i < s.buildings.length; i++) {
      const b = s.buildings[i];
      if (
        b.completed &&
        (b.type === 'market_stall' || b.type === 'lily_market' || b.type === 'guildhall')
      ) {
        marketCount++;
      }
    }
    return {
      settlementId: s.id,
      settlementName: s.name,
      settlementColor: colorHex(s.bannerColor),
      adaptationIcon: profile.icon,
      adaptationLabel: profile.shortLabel,
      treasury: Math.round(s.treasury),
      tradeVolume: s.tradeVolume,
      marketCount,
      merchantCount: merchantsBySettlement.get(s.id) ?? 0,
      exportSpecialties: profile.exportSpecialties,
      importNeeds: profile.importNeeds,
      stockpile: {
        timber: Math.round(s.stockpile.timber),
        berries: Math.round(s.stockpile.berries),
        acorns: Math.round(s.stockpile.acorns),
        stone: Math.round(s.stockpile.stone),
        herbs: Math.round(s.stockpile.herbs),
        crafts: Math.round(s.stockpile.crafts),
      },
    };
  });
  settlements.sort((a, b) => b.tradeVolume - a.tradeVolume || b.treasury - a.treasury);

  let alliedPairs = 0;
  let warPairs = 0;
  for (let i = 0; i < world.settlements.length; i++) {
    for (let j = i + 1; j < world.settlements.length; j++) {
      const stance = world.diplomacy.getStance(world.settlements[i].id, world.settlements[j].id);
      if (stance === 'allied') alliedPairs++;
      else if (stance === 'war') warPairs++;
    }
  }

  const recentTrades = world.chronicle.entries
    .filter((e) => e.category === 'trade')
    .slice(0, 8);

  return {
    activeCaravans: caravans.length,
    activeRoutes: routes.length,
    totalTradeVolume,
    totalTreasury,
    totalMerchants,
    alliedPairs,
    warPairs,
    caravans,
    routes,
    settlements,
    recentTrades,
  };
}

/* =========================================================================
   4. PIONEERS & FRONTIER SUMMARY
   ========================================================================= */

export interface PioneerMemberRow {
  readonly id: string;
  readonly name: string;
  readonly speciesName: string;
  readonly speciesColor: string;
  readonly role: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly mood: number;
  readonly distanceToTarget: number;
}

export interface PioneerPartyRow {
  readonly id: string;
  readonly sourceSettlementId: string;
  readonly sourceSettlementName: string;
  readonly sourceSettlementColor: string;
  readonly targetPosition: Vec2;
  readonly targetBiomeName: string;
  readonly targetAdaptationIcon: string;
  readonly targetAdaptationTitle: string;
  readonly partyPosition: Vec2;
  readonly progressPct: number;
  readonly remainingDist: number;
  readonly members: readonly PioneerMemberRow[];
}

export interface SettlementExpansionReadiness {
  readonly settlementId: string;
  readonly settlementName: string;
  readonly settlementColor: string;
  readonly population: number;
  readonly minPopulation: number;
  readonly completedBuildings: number;
  readonly minBuildings: number;
  readonly timber: number;
  readonly food: number;
  readonly eligibleAdults: number;
  readonly ready: boolean;
  readonly blockerSummary: string;
}

export interface PioneersSummarySnapshot {
  readonly activeParties: number;
  readonly totalPioneers: number;
  readonly settlementCount: number;
  readonly maxSettlements: number;
  readonly canExpandMore: boolean;
  readonly parties: readonly PioneerPartyRow[];
  readonly readiness: readonly SettlementExpansionReadiness[];
  readonly foundedHistory: readonly ChronicleEntry[];
}

export function buildPioneersSummary(world: WorldState): PioneersSummarySnapshot {
  const settlementById = new Map(world.settlements.map((s) => [s.id, s]));
  const rawParties = world.settlementManager.getActiveEmigrations();

  const membersByParty = new Map<string, PioneerMemberRow[]>();
  const coordsByParty = new Map<string, { sumX: number; sumZ: number; count: number }>();
  const popBySettlement = new Map<string, number>();
  const eligibleAdultsBySettlement = new Map<string, number>();

  let totalPioneers = 0;
  for (const c of world.creatures) {
    if (!c.alive) continue;
    popBySettlement.set(c.settlementId, (popBySettlement.get(c.settlementId) ?? 0) + 1);
    if (
      c.lifeStage === 'adult' &&
      !c.def.strictlyAquatic &&
      c.activity !== 'fighting' &&
      c.activity !== 'marching' &&
      c.activity !== 'fleeing' &&
      c.activity !== 'nesting' &&
      c.activity !== 'emigrating' &&
      c.activeWarId === null
    ) {
      eligibleAdultsBySettlement.set(
        c.settlementId,
        (eligibleAdultsBySettlement.get(c.settlementId) ?? 0) + 1,
      );
    }
    if (c.activity !== 'emigrating') continue;
    totalPioneers++;
    if (!c.emigrationPartyId) continue;

    const targetX = c.emigrationTargetX ?? c.targetX;
    const targetZ = c.emigrationTargetZ ?? c.targetZ;
    const dist = Math.hypot(targetX - c.x, targetZ - c.z);

    const list = membersByParty.get(c.emigrationPartyId) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      speciesName: c.def.displayName,
      speciesColor: colorHex(c.def.primaryColor),
      role: c.role,
      health: Math.round(c.health),
      maxHealth: Math.round(c.maxHealth),
      mood: Math.round(c.mood),
      distanceToTarget: Math.round(dist),
    });
    membersByParty.set(c.emigrationPartyId, list);

    const acc = coordsByParty.get(c.emigrationPartyId) ?? { sumX: 0, sumZ: 0, count: 0 };
    acc.sumX += c.x;
    acc.sumZ += c.z;
    acc.count++;
    coordsByParty.set(c.emigrationPartyId, acc);
  }

  const parties: PioneerPartyRow[] = rawParties.map((party) => {
    const source = settlementById.get(party.sourceSettlementId);
    const targetBiome = world.terrain.getBiomeAt(party.targetX, party.targetZ);
    const targetAdaptation = world.terrain.getSiteAdaptation(party.targetX, party.targetZ);
    const targetProfile = VILLAGE_ADAPTATION_CATALOG[targetAdaptation];

    const coords = coordsByParty.get(party.id);
    const partyPosition: Vec2 =
      coords && coords.count > 0
        ? { x: coords.sumX / coords.count, z: coords.sumZ / coords.count }
        : source?.center ?? { x: party.targetX, z: party.targetZ };

    const totalDist = source
      ? Math.max(1, Math.hypot(party.targetX - source.center.x, party.targetZ - source.center.z))
      : 1;
    const remainingDist = Math.hypot(party.targetX - partyPosition.x, party.targetZ - partyPosition.z);
    const progressPct = Math.max(
      0,
      Math.min(100, Math.round((1 - remainingDist / totalDist) * 100)),
    );

    return {
      id: party.id,
      sourceSettlementId: party.sourceSettlementId,
      sourceSettlementName: source?.name ?? 'Unknown Village',
      sourceSettlementColor: source ? colorHex(source.bannerColor) : '#8aa68b',
      targetPosition: { x: party.targetX, z: party.targetZ },
      targetBiomeName: getBiomeDisplayName(targetBiome),
      targetAdaptationIcon: targetProfile.icon,
      targetAdaptationTitle: targetProfile.title,
      partyPosition,
      progressPct,
      remainingDist: Math.round(remainingDist),
      members: membersByParty.get(party.id) ?? [],
    };
  });

  const minPopulation = world.settlements.length === 1 ? 9 : 10;
  const minBuildings = 3;
  const canExpandMore =
    world.settlements.length + rawParties.length < world.config.maxSettlements;

  const readiness: SettlementExpansionReadiness[] = world.settlements.map((s) => {
    const population = popBySettlement.get(s.id) ?? 0;
    const completedBuildings = s.getCompletedCount();
    const timber = Math.round(s.stockpile.timber);
    const food = Math.round(s.stockpile.berries + s.stockpile.acorns);
    const eligibleAdults = eligibleAdultsBySettlement.get(s.id) ?? 0;

    const blockers: string[] = [];
    if (!canExpandMore) blockers.push('Realm settlement cap reached');
    if (population < minPopulation) blockers.push(`Need ${minPopulation - population} more kin`);
    if (completedBuildings < minBuildings) {
      blockers.push(`Need ${minBuildings - completedBuildings} more bldgs`);
    }
    if (timber < 10) blockers.push(`Need ${10 - timber} timber`);
    if (food < 10) blockers.push(`Need ${10 - food} food`);
    if (eligibleAdults < 3) blockers.push('Need 3 overland adults');

    return {
      settlementId: s.id,
      settlementName: s.name,
      settlementColor: colorHex(s.bannerColor),
      population,
      minPopulation,
      completedBuildings,
      minBuildings,
      timber,
      food,
      eligibleAdults,
      ready: blockers.length === 0,
      blockerSummary: blockers.length === 0 ? 'Ready to sponsor pioneers' : blockers.join(' · '),
    };
  });

  const foundedHistory = world.chronicle.entries
    .filter((e) => e.category === 'settlement')
    .slice(0, 10);

  return {
    activeParties: parties.length,
    totalPioneers,
    settlementCount: world.settlements.length,
    maxSettlements: world.config.maxSettlements,
    canExpandMore,
    parties,
    readiness,
    foundedHistory,
  };
}
