import { describe, expect, it } from 'vitest';
import { EventBus } from '@core/EventBus';
import { WorldState } from '@simulation/WorldState';
import { bindDialogPill, type DialogPillButton } from '@ui/DialogPillController';
import {
  buildBuildingsSummary,
  buildPioneersSummary,
  buildTradeSummary,
  buildYoungSummary,
  type RealmOverviewTab,
} from '@ui/RealmOverviewLogic';

interface FakePillButton extends DialogPillButton {
  readonly classes: Set<string>;
  readonly attrs: Map<string, string>;
  click(): void;
}

function createFakeButton(disabled = false): FakePillButton {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const listeners = new Set<() => void>();

  return {
    disabled,
    title: '',
    classes,
    attrs,
    classList: {
      toggle(token: string, force?: boolean): boolean {
        const shouldHave = force !== undefined ? force : !classes.has(token);
        if (shouldHave) {
          classes.add(token);
        } else {
          classes.delete(token);
        }
        return shouldHave;
      },
    },
    setAttribute(name: string, value: string): void {
      attrs.set(name, value);
    },
    addEventListener(_type: 'click', listener: () => void): void {
      listeners.add(listener);
    },
    removeEventListener(_type: 'click', listener: () => void): void {
      listeners.delete(listener);
    },
    click(): void {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

describe('DialogPillController', () => {
  it('opens when closed and closes when already open, syncing active/ARIA/title state', () => {
    const button = createFakeButton();
    let open = false;
    let opens = 0;
    let closes = 0;

    const pill = bindDialogPill({
      button,
      isOpen: () => open,
      open: () => {
        opens++;
        open = true;
      },
      close: () => {
        closes++;
        open = false;
      },
      getTitle: (isOpen) => (isOpen ? 'Close dialog' : 'Open dialog'),
    });

    expect(button.classes.has('active')).toBe(false);
    expect(button.attrs.get('aria-pressed')).toBe('false');
    expect(button.title).toBe('Open dialog');

    button.click();
    expect(opens).toBe(1);
    expect(closes).toBe(0);
    expect(button.classes.has('active')).toBe(true);
    expect(button.attrs.get('aria-pressed')).toBe('true');
    expect(button.title).toBe('Close dialog');

    button.click();
    expect(opens).toBe(1);
    expect(closes).toBe(1);
    expect(button.classes.has('active')).toBe(false);
    expect(button.attrs.get('aria-pressed')).toBe('false');
    expect(button.title).toBe('Open dialog');

    // External open (e.g. keyboard shortcut or close button) syncs cleanly
    open = true;
    pill.sync();
    expect(button.classes.has('active')).toBe(true);
    expect(button.attrs.get('aria-pressed')).toBe('true');
    expect(button.title).toBe('Close dialog');

    pill.dispose();
  });

  it('closes shared inspector when clicking an active settlement or celebration pill', () => {
    const settlementABtn = createFakeButton();
    const settlementBBtn = createFakeButton();
    const celebrationBtn = createFakeButton();

    let selectedSettlementId: string | null = null;
    const syncAll = (): void => {
      pillA.sync();
      pillB.sync();
      pillCel.sync();
    };

    const pillA = bindDialogPill({
      button: settlementABtn,
      isOpen: () => selectedSettlementId === 'goldfield',
      open: () => {
        selectedSettlementId = 'goldfield';
        syncAll();
      },
      close: () => {
        selectedSettlementId = null;
        syncAll();
      },
    });

    const pillB = bindDialogPill({
      button: settlementBBtn,
      isOpen: () => selectedSettlementId === 'beaverdam',
      open: () => {
        selectedSettlementId = 'beaverdam';
        syncAll();
      },
      close: () => {
        selectedSettlementId = null;
        syncAll();
      },
    });

    const pillCel = bindDialogPill({
      button: celebrationBtn,
      isOpen: () => selectedSettlementId === 'goldfield',
      open: () => {
        selectedSettlementId = 'goldfield';
        syncAll();
      },
      close: () => {
        selectedSettlementId = null;
        syncAll();
      },
    });

    settlementABtn.click();
    expect(selectedSettlementId).toBe('goldfield');
    expect(settlementABtn.classes.has('active')).toBe(true);
    expect(celebrationBtn.classes.has('active')).toBe(true);
    expect(settlementBBtn.classes.has('active')).toBe(false);

    settlementBBtn.click();
    expect(selectedSettlementId).toBe('beaverdam');
    expect(settlementABtn.classes.has('active')).toBe(false);
    expect(settlementBBtn.classes.has('active')).toBe(true);
    expect(celebrationBtn.classes.has('active')).toBe(false);

    settlementBBtn.click();
    expect(selectedSettlementId).toBeNull();
    expect(settlementBBtn.classes.has('active')).toBe(false);

    celebrationBtn.click();
    expect(selectedSettlementId).toBe('goldfield');
    expect(celebrationBtn.classes.has('active')).toBe(true);
    celebrationBtn.click();
    expect(selectedSettlementId).toBeNull();
    expect(celebrationBtn.classes.has('active')).toBe(false);

    pillA.dispose();
    pillB.dispose();
    pillCel.dispose();
  });

  it('switches tabs or closes when clicking telemetry pills sharing the Realm Overview modal', () => {
    const youngBtn = createFakeButton();
    const bldgsBtn = createFakeButton();
    let openTab: RealmOverviewTab | null = null;

    const syncAll = (): void => {
      youngPill.sync();
      bldgsPill.sync();
    };

    const youngPill = bindDialogPill({
      button: youngBtn,
      isOpen: () => openTab === 'young',
      open: () => {
        openTab = 'young';
        syncAll();
      },
      close: () => {
        openTab = null;
        syncAll();
      },
    });

    const bldgsPill = bindDialogPill({
      button: bldgsBtn,
      isOpen: () => openTab === 'buildings',
      open: () => {
        openTab = 'buildings';
        syncAll();
      },
      close: () => {
        openTab = null;
        syncAll();
      },
    });

    youngBtn.click();
    expect(openTab).toBe('young');
    expect(youngBtn.classes.has('active')).toBe(true);
    expect(bldgsBtn.classes.has('active')).toBe(false);

    bldgsBtn.click();
    expect(openTab).toBe('buildings');
    expect(youngBtn.classes.has('active')).toBe(false);
    expect(bldgsBtn.classes.has('active')).toBe(true);

    bldgsBtn.click();
    expect(openTab).toBeNull();
    expect(bldgsBtn.classes.has('active')).toBe(false);

    youngPill.dispose();
    bldgsPill.dispose();
  });

  it('ignores clicks when disabled and detaches listener on dispose', () => {
    const button = createFakeButton(true);
    let open = false;
    let calls = 0;

    const pill = bindDialogPill({
      button,
      isOpen: () => open,
      open: () => {
        calls++;
        open = true;
      },
      close: () => {
        calls++;
        open = false;
      },
    });

    button.click();
    expect(calls).toBe(0);
    expect(open).toBe(false);

    button.disabled = false;
    button.click();
    expect(calls).toBe(1);
    expect(open).toBe(true);

    pill.dispose();
    button.click();
    expect(calls).toBe(1);
    expect(open).toBe(true);
  });
});

describe('RealmOverviewLogic', () => {
  it('builds accurate Young, Buildings, Trade, and Pioneers summaries from WorldState', () => {
    const world = new WorldState(new EventBus(), {
      seed: 1337,
      initialSettlements: 2,
      initialWaterwaySettlements: 0,
      initialCreaturesPerSettlement: 8,
    });

    expect(world.settlements.length).toBe(2);
    const [home, neighbor] = world.settlements;

    // 1. Seed a bonded pair and a newborn + juvenile litter for Young summary
    const adults = world.creatures.filter((c) => c.settlementId === home.id && c.alive);
    const [parentA, parentB] = adults;
    parentA.mateId = parentB.id;
    parentB.mateId = parentA.id;
    const newborn = world.spawnCreature(home, parentA.species, 'forager', {
      ageDays: 0.25,
      generation: 2,
      parentIds: [parentA.id, parentB.id],
      litterId: 'litter_test_1',
    });
    const juvenile = world.spawnCreature(home, parentA.species, 'forager', {
      ageDays: 1.1,
      generation: 2,
      parentIds: [parentA.id, parentB.id],
      litterId: 'litter_test_1',
    });
    parentA.offspringIds.push(newborn.id, juvenile.id);
    parentB.offspringIds.push(newborn.id, juvenile.id);

    const youngSummary = buildYoungSummary(world);
    expect(youngSummary.totalYoung).toBe(2);
    expect(youngSummary.newbornCount).toBe(1);
    expect(youngSummary.juvenileCount).toBe(1);
    expect(youngSummary.activeLitters).toBe(1);
    expect(youngSummary.bondedPairsCount).toBeGreaterThanOrEqual(1);
    expect(youngSummary.entries[0].id).toBe(newborn.id);
    expect(youngSummary.entries[0].parents.length).toBe(2);
    expect(youngSummary.entries[0].littermatesCount).toBe(1);

    // 2. Buildings summary reflects completed starter buildings and active plot + assigned builder
    const activePlot = home.buildings.find((b) => !b.completed);
    expect(activePlot).toBeDefined();
    if (activePlot) {
      const builder = adults.find((c) => c.role === 'builder') ?? adults[2];
      builder.activity = 'building';
      builder.targetBuildingId = activePlot.id;
    }

    const buildingsSummary = buildBuildingsSummary(world);
    expect(buildingsSummary.completedBuildings).toBe(
      world.settlements.reduce((sum, s) => sum + s.getCompletedCount(), 0),
    );
    expect(buildingsSummary.underConstruction).toBeGreaterThanOrEqual(1);
    expect(buildingsSummary.settlements.length).toBe(2);
    if (activePlot) {
      const activeRow = buildingsSummary.activeWorks.find((w) => w.id === activePlot.id);
      expect(activeRow).toBeDefined();
      expect(activeRow?.assignedBuilders.length).toBeGreaterThanOrEqual(1);
    }

    // 3. Trade summary tracks active merchant caravans, routes, and settlement economies
    const merchant = adults.find((c) => c.role === 'merchant') ?? adults[3];
    merchant.activity = 'trading';
    merchant.tradeDestinationSettlementId = neighbor.id;
    merchant.tradeCarrying = 'crafts';
    merchant.tradeCargoAmount = 6;

    const tradeSummary = buildTradeSummary(world);
    expect(tradeSummary.activeCaravans).toBe(1);
    expect(tradeSummary.activeRoutes).toBe(1);
    expect(tradeSummary.caravans[0].merchantName).toBe(merchant.name);
    expect(tradeSummary.caravans[0].cargoGood).toBe('crafts');
    expect(tradeSummary.caravans[0].cargoAmount).toBe(6);
    expect(tradeSummary.settlements.length).toBe(2);

    // 4. Pioneers summary reports settlement expansion readiness and founding history
    const pioneersSummary = buildPioneersSummary(world);
    expect(pioneersSummary.settlementCount).toBe(2);
    expect(pioneersSummary.canExpandMore).toBe(true);
    expect(pioneersSummary.readiness.length).toBe(2);
    expect(pioneersSummary.foundedHistory.length).toBeGreaterThanOrEqual(2);
  });
});
