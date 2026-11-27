import type { ResourceType, TradeRouteVisual } from '@core/Types';
import type { Creature } from '@simulation/creatures/Creature';
import type { Settlement } from '@simulation/settlements/Settlement';
import type { WorldState } from '@simulation/WorldState';

const RESOURCE_BASE_VALUE: Record<ResourceType, number> = {
  timber: 3,
  berries: 3.5,
  acorns: 3.5,
  stone: 4.5,
  herbs: 5.5,
  crafts: 8,
};

// Keep a healthy reserve of building materials so trade caravans never starve ongoing construction
const EXPORT_RESERVE: Record<ResourceType, number> = {
  crafts: 5,
  berries: 12,
  acorns: 12,
  herbs: 10,
  timber: 18,
  stone: 14,
};
const EXPORT_PRIORITY: readonly ResourceType[] = [
  'crafts',
  'berries',
  'acorns',
  'herbs',
  'timber',
  'stone',
];

/**
 * Coordinates woodland barter, inter-settlement merchant caravans,
 * cross-biome trade complementarity, price valuation, and diplomatic goodwill.
 */
export class EconomySystem {
  readonly activeRoutes: TradeRouteVisual[] = [];

  pickTradeDestination(origin: Settlement, world: WorldState): Settlement | null {
    const candidates = world.settlements.filter((other) => {
      if (other.id === origin.id) return false;
      const stance = world.diplomacy.getStance(origin.id, other.id);
      return stance !== 'war';
    });
    if (candidates.length === 0) return null;

    const originProfile = origin.getAdaptationProfile();

    // Prefer complementary biome trading partners, markets, guildhalls, and friendly ties
    return world.rng.weightedPick(
      candidates.map((c) => {
        const destProfile = c.getAdaptationProfile();
        const marketBonus =
          1 + c.getCompletedCount('market_stall') * 0.8 + c.getCompletedCount('guildhall') * 0.6;
        const stanceBonus = world.diplomacy.getScore(origin.id, c.id) > 15 ? 1.5 : 1.0;
        const biomeSynergy = c.adaptation !== origin.adaptation ? 1.55 : 0.9;
        const complementaryNeed = originProfile.exportSpecialties.some((g) =>
          destProfile.importNeeds.includes(g),
        )
          ? 1.35
          : 1.0;
        return { item: c, weight: marketBonus * stanceBonus * biomeSynergy * complementaryNeed };
      }),
    );
  }

  pickExportGood(origin: Settlement): ResourceType | null {
    const profile = origin.getAdaptationProfile();
    let best: ResourceType | null = null;
    let bestScore = 0;

    for (let i = 0; i < EXPORT_PRIORITY.length; i++) {
      const res = EXPORT_PRIORITY[i];
      const qty = origin.stockpile[res];
      const surplus = qty - EXPORT_RESERVE[res];
      if (surplus < 2) continue;
      const specialtyMult = profile.exportSpecialties.includes(res) ? 1.4 : 1.0;
      const score = surplus * RESOURCE_BASE_VALUE[res] * specialtyMult;
      if (score > bestScore) {
        bestScore = score;
        best = res;
      }
    }
    return best;
  }

  completeCaravanTrade(
    merchant: Creature,
    origin: Settlement,
    dest: Settlement,
    world: WorldState,
  ): void {
    const good = merchant.tradeCarrying;
    const amount = merchant.tradeCargoAmount;
    if (!good || amount <= 0) return;

    const originProfile = origin.getAdaptationProfile();
    const destProfile = dest.getAdaptationProfile();
    const needBonus = destProfile.importNeeds.includes(good) ? 1.25 : 1.0;

    const unitPrice =
      RESOURCE_BASE_VALUE[good] *
      originProfile.tradeBonusMultiplier *
      needBonus *
      (1 + dest.getCompletedCount('market_stall') * 0.15 + dest.getCompletedCount('guildhall') * 0.1);
    const totalValue = Math.round(unitPrice * amount);

    dest.stockpile[good] += amount;
    origin.treasury += totalValue;
    dest.treasury += Math.round(totalValue * 0.35);
    origin.tradeVolume += 1;
    dest.tradeVolume += 1;
    merchant.wealth += Math.round(totalValue * 0.3);
    merchant.mood = Math.min(100, merchant.mood + 10);

    // Destination shares a surplus regional specialty good back to origin
    const returnGood = this.pickExportGood(dest);
    if (returnGood && returnGood !== good && dest.stockpile[returnGood] >= EXPORT_RESERVE[returnGood]) {
      dest.stockpile[returnGood] -= 3;
      origin.stockpile[returnGood] += 3;
    }

    origin.recalculateTierAndRadius();
    dest.recalculateTierAndRadius();
    world.diplomacy.adjustRelation(origin, dest, 5.5, world, 'merchant caravan');
    world.emitCreatureInteraction({
      kind: 'trade',
      species: merchant.species,
      position: { x: merchant.x, y: merchant.y, z: merchant.z },
      lifeStage: merchant.lifeStage,
      intensity: 0.85,
    });

    if (world.rng.chance(0.42)) {
      world.chronicle.record(
        world.day,
        world.season,
        'trade',
        'Cross-Biome Caravan Trade',
        `${merchant.name} (${merchant.def.displayName}) traded ${amount} ${good} from ${origin.name} (${originProfile.shortLabel}) to ${dest.name} (${destProfile.shortLabel}) for ${totalValue} acorns-coin.`,
        dest.center,
      );
    }
  }

  rebuildRouteSummary(world: WorldState): void {
    this.activeRoutes.length = 0;
    const counts = new Map<string, { from: Settlement; to: Settlement; count: number }>();

    for (const c of world.aliveCreatures) {
      if (!c.alive || c.activity !== 'trading' || !c.tradeDestinationSettlementId) continue;
      const from = world.getSettlement(c.settlementId);
      const to = world.getSettlement(c.tradeDestinationSettlementId);
      if (!from || !to) continue;
      const key = from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { from, to, count: 1 });
      }
    }

    for (const entry of counts.values()) {
      this.activeRoutes.push({
        fromSettlementId: entry.from.id,
        toSettlementId: entry.to.id,
        from: entry.from.center,
        to: entry.to.center,
        activeCount: entry.count,
      });
    }
  }
}
