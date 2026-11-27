import { describe, expect, it } from 'vitest';
import { EventBus } from '@core/EventBus';
import { WorldState } from '@simulation/WorldState';
import { ConfirmModal } from '@ui/ConfirmModal';
import { CreaturePovBar } from '@ui/CreaturePovBar';
import { DeityPanel } from '@ui/DeityPanel';
import { CreatureDirectoryModal } from '@ui/CreatureDirectoryModal';
import { bindDialogPill, type DialogPillButton } from '@ui/DialogPillController';
import { HudPanelDragManager } from '@ui/HudPanelDragManager';
import {
  buildBuildingsSummary,
  buildPioneersSummary,
  buildTradeSummary,
  buildYoungSummary,
  type RealmOverviewTab,
} from '@ui/RealmOverviewLogic';
import { TopBar } from '@ui/TopBar';

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

  it('renders complete long creature activity descriptions in CreaturePovBar without truncation', () => {
    type FakeNode = {
      className: string;
      textContent: string;
      innerHTML: string;
      title: string;
      children: FakeNode[];
      classList: {
        classes: Set<string>;
        add: (c: string) => void;
        remove: (c: string) => void;
        contains: (c: string) => boolean;
      };
      append: (...nodes: FakeNode[]) => void;
      addEventListener: (event: string, fn: () => void) => void;
      click: () => void;
    };
    const makeNode = (): FakeNode => {
      const classes = new Set<string>();
      const clickListeners: (() => void)[] = [];
      const node: FakeNode = {
        className: '',
        textContent: '',
        innerHTML: '',
        title: '',
        children: [],
        classList: {
          classes,
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          contains: (c: string) => classes.has(c),
        },
        append: (...nodes: FakeNode[]) => {
          node.children.push(...nodes);
        },
        addEventListener: (event: string, fn: () => void) => {
          if (event === 'click') clickListeners.push(fn);
        },
        click: () => {
          for (const fn of clickListeners) fn();
        },
      };
      return node;
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => makeNode(),
    };

    try {
      const world = new WorldState(new EventBus(), {
        seed: 818181,
        initialSettlements: 1,
        initialWaterwaySettlements: 0,
        initialCreaturesPerSettlement: 2,
      });
      const creature = world.creatures[0];
      const longThought =
        'Hauling timber and fine woodland crafts to Elderhollow across the river bridge';
      creature.thought = longThought;

      let followedId: string | null = null;
      const bar = new CreaturePovBar({
        onPrevCreature: () => {},
        onNextCreature: () => {},
        onRandomCreature: () => {},
        onFollowCreature: (id) => {
          followedId = id;
        },
        onExitPov: () => {},
      });
      bar.update(world, creature.id);

      const root = bar.element as unknown as FakeNode;
      const mainRow = root.children[0];
      const leftRow = mainRow.children[0];
      const infoEl = leftRow.children[1];
      expect(infoEl.innerHTML).toContain(longThought);
      expect(infoEl.innerHTML).toContain(creature.name);
      expect(root.classList.contains('hidden')).toBe(false);

      // Follow button switches from Eye View to Follow mode for the currently viewed creature
      const actionsRow = mainRow.children[1];
      const followBtn = actionsRow.children.find((btn) => btn.textContent.includes('Follow'));
      expect(followBtn).toBeDefined();
      followBtn!.click();
      expect(followedId).toBe(creature.id);
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('renders Fullscreen button beside Zen in TopBar and toggles fullscreen state independently of Zen', () => {
    type FakeNode = {
      tagName: string;
      type: string;
      className: string;
      textContent: string;
      title: string;
      value: string;
      selected: boolean;
      disabled: boolean;
      dataset: Record<string, string>;
      attrs: Map<string, string>;
      children: FakeNode[];
      classList: {
        classes: Set<string>;
        add: (...c: string[]) => void;
        remove: (...c: string[]) => void;
        toggle: (c: string, force?: boolean) => boolean;
        contains: (c: string) => boolean;
      };
      append: (...nodes: FakeNode[]) => void;
      appendChild: (node: FakeNode) => FakeNode;
      setAttribute: (name: string, value: string) => void;
      addEventListener: (event: string, fn: () => void) => void;
      removeEventListener: (event: string, fn: () => void) => void;
      click: () => void;
    };
    const makeNode = (tagName: string): FakeNode => {
      const classes = new Set<string>();
      const attrs = new Map<string, string>();
      const listeners = new Map<string, Set<() => void>>();
      const node: FakeNode = {
        tagName,
        type: '',
        className: '',
        textContent: '',
        title: '',
        value: '',
        selected: false,
        disabled: false,
        dataset: {},
        attrs,
        children: [],
        classList: {
          classes,
          add: (...c: string[]) => c.forEach((t) => classes.add(t)),
          remove: (...c: string[]) => c.forEach((t) => classes.delete(t)),
          toggle: (c: string, force?: boolean) => {
            const next = force !== undefined ? force : !classes.has(c);
            if (next) classes.add(c);
            else classes.delete(c);
            return next;
          },
          contains: (c: string) => classes.has(c),
        },
        append: (...nodes: FakeNode[]) => {
          node.children.push(...nodes);
        },
        appendChild: (child: FakeNode) => {
          node.children.push(child);
          return child;
        },
        setAttribute: (name: string, value: string) => {
          attrs.set(name, value);
        },
        addEventListener: (event: string, fn: () => void) => {
          let set = listeners.get(event);
          if (!set) {
            set = new Set();
            listeners.set(event, set);
          }
          set.add(fn);
        },
        removeEventListener: (event: string, fn: () => void) => {
          listeners.get(event)?.delete(fn);
        },
        click: () => {
          for (const fn of [...(listeners.get('click') ?? [])]) fn();
        },
      };
      return node;
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => makeNode(tag),
    };

    try {
      let fullscreenClicks = 0;
      let zenClicks = 0;
      let isMuted = false;
      let muteClicks = 0;
      const topBar = new TopBar({
        onSetSpeed: () => {},
        onToggleCinematic: () => false,
        onToggleCreatureView: () => {},
        isCreatureDirectoryOpen: () => false,
        onSetCreatureDirectoryOpen: () => {},
        isRealmOverviewTabOpen: () => false,
        onOpenRealmOverviewTab: () => {},
        onCloseRealmOverview: () => {},
        isDeityPanelOpen: () => true,
        onSetDeityPanelOpen: () => {},
        isChroniclePanelOpen: () => true,
        onSetChroniclePanelOpen: () => {},
        isSaveModalOpen: () => false,
        onSetSaveModalOpen: () => {},
        onToggleFullscreen: () => {
          fullscreenClicks++;
        },
        onToggleZenMode: () => {
          zenClicks++;
        },
        onToggleMute: () => {
          muteClicks++;
          isMuted = !isMuted;
          return isMuted;
        },
        onResetOverview: () => {},
        onNewWorld: () => {},
        onChangeQuality: () => {},
        onFocusSettlement: () => {},
        onFocusPosition: () => {},
        onCloseInspector: () => {},
      });

      const root = topBar.element as unknown as FakeNode;
      const mainRow = root.children[0];
      const controls = mainRow.children[2];
      const viewGroup = controls.children[1];
      const fsIdx = viewGroup.children.findIndex((n) => n.textContent.includes('Fullscreen'));
      const zenIdx = viewGroup.children.findIndex((n) => n.textContent.includes('Zen'));

      expect(fsIdx).toBeGreaterThanOrEqual(0);
      expect(zenIdx).toBeGreaterThanOrEqual(0);
      expect(Math.abs(fsIdx - zenIdx)).toBe(1);

      const fsBtn = viewGroup.children[fsIdx];
      expect(fsBtn.classList.contains('active')).toBe(false);
      expect(fsBtn.attrs.get('aria-pressed')).toBe('false');

      fsBtn.click();
      expect(fullscreenClicks).toBe(1);
      expect(zenClicks).toBe(0);

      topBar.setFullscreenActive(true);
      expect(fsBtn.classList.contains('active')).toBe(true);
      expect(fsBtn.attrs.get('aria-pressed')).toBe('true');
      expect(fsBtn.title).toContain('Exit full-screen');

      topBar.setFullscreenActive(false);
      expect(fsBtn.classList.contains('active')).toBe(false);
      expect(fsBtn.attrs.get('aria-pressed')).toBe('false');
      expect(fsBtn.title).toContain('Enter full-screen');

      // Mute button sits in the main top bar and toggles sound on/off cleanly
      const soundBtn = viewGroup.children.find((n) => n.className.includes('sound-btn'));
      expect(soundBtn).toBeDefined();
      expect(soundBtn!.textContent).toContain('Sound');
      expect(soundBtn!.attrs.get('aria-pressed')).toBe('false');
      expect(soundBtn!.classList.contains('is-muted')).toBe(false);

      soundBtn!.click();
      expect(muteClicks).toBe(1);
      expect(isMuted).toBe(true);
      expect(soundBtn!.textContent).toContain('Muted');
      expect(soundBtn!.attrs.get('aria-pressed')).toBe('true');
      expect(soundBtn!.classList.contains('is-muted')).toBe(true);
      expect(soundBtn!.title).toContain('Unmute sound');

      soundBtn!.click();
      expect(muteClicks).toBe(2);
      expect(isMuted).toBe(false);
      expect(soundBtn!.textContent).toContain('Sound');
      expect(soundBtn!.attrs.get('aria-pressed')).toBe('false');
      expect(soundBtn!.classList.contains('is-muted')).toBe(false);
      expect(soundBtn!.title).toContain('Mute sound');

      topBar.dispose();
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('requires explicit confirmation in ConfirmModal before firing destructive actions like New World', () => {
    type FakeNode = {
      tagName: string;
      className: string;
      textContent: string;
      title: string;
      type: string;
      children: FakeNode[];
      attrs: Map<string, string>;
      classSet: Set<string>;
      listeners: Map<string, Array<(e: { target: FakeNode; stopPropagation: () => void }) => void>>;
      focused: boolean;
      classList: {
        add: (token: string) => void;
        remove: (token: string) => void;
        toggle: (token: string, force?: boolean) => boolean;
        contains: (token: string) => boolean;
      };
      setAttribute: (name: string, value: string) => void;
      addEventListener: (
        type: string,
        fn: (e: { target: FakeNode; stopPropagation: () => void }) => void,
      ) => void;
      append: (...nodes: FakeNode[]) => void;
      appendChild: (node: FakeNode) => FakeNode;
      focus: () => void;
      click: (target?: FakeNode) => void;
    };

    const makeNode = (tagName: string): FakeNode => {
      const classSet = new Set<string>();
      const attrs = new Map<string, string>();
      const listeners = new Map<string, Array<(e: { target: FakeNode; stopPropagation: () => void }) => void>>();
      const node: FakeNode = {
        tagName,
        className: '',
        textContent: '',
        title: '',
        type: '',
        children: [],
        attrs,
        classSet,
        listeners,
        focused: false,
        classList: {
          add(token: string) {
            classSet.add(token);
          },
          remove(token: string) {
            classSet.delete(token);
          },
          toggle(token: string, force?: boolean) {
            const next = force !== undefined ? force : !classSet.has(token);
            if (next) classSet.add(token);
            else classSet.delete(token);
            return next;
          },
          contains(token: string) {
            return classSet.has(token);
          },
        },
        setAttribute(name: string, value: string) {
          attrs.set(name, value);
        },
        addEventListener(type, fn) {
          const list = listeners.get(type) ?? [];
          list.push(fn);
          listeners.set(type, list);
        },
        append(...nodes: FakeNode[]) {
          node.children.push(...nodes);
        },
        appendChild(child: FakeNode) {
          node.children.push(child);
          return child;
        },
        focus() {
          node.focused = true;
        },
        click(target?: FakeNode) {
          const ev = { target: target ?? node, stopPropagation: () => {} };
          for (const fn of listeners.get('click') ?? []) {
            fn(ev);
          }
        },
      };
      return node;
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => makeNode(tag),
    };

    try {
      const modal = new ConfirmModal();
      const backdrop = modal.element as unknown as FakeNode;
      const card = backdrop.children[0];
      const header = card.children[0];
      const closeBtn = header.children[1];
      const actions = card.children[2];
      const cancelBtn = actions.children[0];
      const confirmBtn = actions.children[1];

      let confirmed = 0;
      expect(modal.isOpen()).toBe(false);

      // Opening focuses Cancel by default; clicking Cancel or backdrop does NOT fire onConfirm
      modal.openModal({
        title: '🌱 Generate a New World?',
        message: 'Replace current world?',
        confirmLabel: '🌱 Create New World',
        cancelLabel: 'Keep Current World',
        tone: 'danger',
        onConfirm: () => {
          confirmed++;
        },
      });
      expect(modal.isOpen()).toBe(true);
      expect(cancelBtn.focused).toBe(true);
      cancelBtn.click();
      expect(modal.isOpen()).toBe(false);
      expect(confirmed).toBe(0);

      // Clicking backdrop or close button also cancels safely
      modal.openModal({
        title: '🌱 Generate a New World?',
        message: 'Replace current world?',
        confirmLabel: '🌱 Create New World',
        onConfirm: () => {
          confirmed++;
        },
      });
      backdrop.click(backdrop);
      expect(modal.isOpen()).toBe(false);
      expect(confirmed).toBe(0);

      modal.openModal({
        title: '🌱 Generate a New World?',
        message: 'Replace current world?',
        confirmLabel: '🌱 Create New World',
        onConfirm: () => {
          confirmed++;
        },
      });
      closeBtn.click();
      expect(modal.isOpen()).toBe(false);
      expect(confirmed).toBe(0);

      // Explicit confirmation closes modal and invokes callback exactly once
      modal.openModal({
        title: '🌱 Generate a New World?',
        message: 'Replace current world?',
        confirmLabel: '🌱 Create New World',
        tone: 'danger',
        onConfirm: () => {
          confirmed++;
        },
      });
      confirmBtn.click();
      expect(modal.isOpen()).toBe(false);
      expect(confirmed).toBe(1);
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('orders DeityPanel with trait bars on top, Disposition and environmental acts in the middle, and dynamic status/events at the bottom', () => {
    type FakeNode = {
      tagName: string;
      className: string;
      textContent: string;
      innerHTML: string;
      title: string;
      type: string;
      disabled: boolean;
      children: FakeNode[];
      attrs: Map<string, string>;
      listeners: Map<string, Array<(ev: unknown) => void>>;
      classList: {
        toggle: (token: string, force?: boolean) => boolean;
      };
      setAttribute: (name: string, value: string) => void;
      addEventListener: (type: string, fn: (ev: unknown) => void) => void;
      append: (...nodes: FakeNode[]) => void;
      appendChild: (node: FakeNode) => FakeNode;
      dispatchClick: (ev: unknown) => void;
    };

    const makeNode = (tagName: string): FakeNode => {
      const classes = new Set<string>();
      const attrs = new Map<string, string>();
      const listeners = new Map<string, Array<(ev: unknown) => void>>();
      const node: FakeNode = {
        tagName,
        className: '',
        textContent: '',
        innerHTML: '',
        title: '',
        type: '',
        disabled: false,
        children: [],
        attrs,
        listeners,
        classList: {
          toggle(token: string, force?: boolean) {
            const next = force !== undefined ? force : !classes.has(token);
            if (next) classes.add(token);
            else classes.delete(token);
            return next;
          },
        },
        setAttribute(name: string, value: string) {
          attrs.set(name, value);
        },
        addEventListener(type: string, fn: (ev: unknown) => void) {
          const list = listeners.get(type) ?? [];
          list.push(fn);
          listeners.set(type, list);
        },
        append(...nodes: FakeNode[]) {
          node.children.push(...nodes);
        },
        appendChild(child: FakeNode) {
          node.children.push(child);
          return child;
        },
        dispatchClick(ev: unknown) {
          for (const fn of listeners.get('click') ?? []) fn(ev);
        },
      };
      return node;
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => makeNode(tag),
    };

    try {
      const world = new WorldState(new EventBus(), {
        seed: 202607,
        initialSettlements: 2,
        initialWaterwaySettlements: 0,
        initialCreaturesPerSettlement: 4,
      });
      world.deity.receiveSpectatorWhisper('prosperity', world);

      let focusedPos: { x: number; z: number } | null = null;
      const panel = new DeityPanel(
        () => '',
        () => {},
        (pos) => {
          focusedPos = pos;
        },
        () => '',
      );
      panel.update(world);

      const root = panel.element as unknown as FakeNode;
      expect(root.children.map((c) => c.className)).toEqual([
        'panel-header',
        'deity-body',
        'whisper-section',
        'deity-status',
      ]);

      const [, bodyEl, whisperSection, statusEl] = root.children;
      expect(bodyEl.innerHTML).toContain('deity-bars');
      expect(bodyEl.innerHTML).toContain('Benevolence');
      expect(bodyEl.innerHTML).toContain('Verdancy');
      expect(bodyEl.innerHTML).not.toContain('deity-ecology-strip');
      expect(bodyEl.innerHTML).not.toContain('deity-epoch-banner');
      expect(bodyEl.innerHTML).not.toContain('deity-omen');

      expect(whisperSection.children[0].className).toBe('whisper-feedback');
      expect(whisperSection.children[0].textContent).toBe('Steer the unseen hand or invoke an act...');
      expect(whisperSection.children[1].className).toContain('disposition-header');
      expect(whisperSection.children[1].children[0].textContent).toBe('Disposition');
      expect(whisperSection.children[2].className).toContain('disposition-control');
      expect(whisperSection.children[3].textContent).toBe('Invoke Environmental Act');

      expect(statusEl.innerHTML).toContain('deity-ecology-strip');
      expect(statusEl.innerHTML).toContain('deity-epoch-banner');
      expect(statusEl.innerHTML).toContain('deity-omen');

      statusEl.dispatchClick({
        target: {
          closest: (selector: string) => (selector === '.deity-epoch-banner' ? {} : null),
        },
      });
      expect(focusedPos).not.toBeNull();
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('renders Disposition as a continuous slider from Steward (-1) through Balanced (0) to Exploiter (+1)', () => {
    type FakeNode = {
      tagName: string;
      className: string;
      textContent: string;
      innerHTML: string;
      title: string;
      type: string;
      min: string;
      max: string;
      step: string;
      value: string;
      disabled: boolean;
      children: FakeNode[];
      attrs: Map<string, string>;
      listeners: Map<string, Array<(ev: unknown) => void>>;
      classList: {
        toggle: (token: string, force?: boolean) => boolean;
        contains: (token: string) => boolean;
      };
      setAttribute: (name: string, value: string) => void;
      addEventListener: (type: string, fn: (ev: unknown) => void) => void;
      append: (...nodes: FakeNode[]) => void;
      appendChild: (node: FakeNode) => FakeNode;
      dispatch: (type: string, ev?: unknown) => void;
    };

    const makeNode = (tagName: string): FakeNode => {
      const classes = new Set<string>();
      const attrs = new Map<string, string>();
      const listeners = new Map<string, Array<(ev: unknown) => void>>();
      const node: FakeNode = {
        tagName,
        className: '',
        textContent: '',
        innerHTML: '',
        title: '',
        type: '',
        min: '',
        max: '',
        step: '',
        value: '',
        disabled: false,
        children: [],
        attrs,
        listeners,
        classList: {
          toggle(token: string, force?: boolean) {
            const next = force !== undefined ? force : !classes.has(token);
            if (next) classes.add(token);
            else classes.delete(token);
            return next;
          },
          contains(token: string) {
            return classes.has(token);
          },
        },
        setAttribute(name: string, value: string) {
          attrs.set(name, value);
        },
        addEventListener(type: string, fn: (ev: unknown) => void) {
          const list = listeners.get(type) ?? [];
          list.push(fn);
          listeners.set(type, list);
        },
        append(...nodes: FakeNode[]) {
          node.children.push(...nodes);
        },
        appendChild(child: FakeNode) {
          node.children.push(child);
          return child;
        },
        dispatch(type: string, ev: unknown = {}) {
          for (const fn of listeners.get(type) ?? []) fn(ev);
        },
      };
      return node;
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => makeNode(tag),
    };

    try {
      const world = new WorldState(new EventBus(), {
        seed: 202611,
        initialSettlements: 2,
        initialWaterwaySettlements: 0,
        initialCreaturesPerSettlement: 4,
      });

      const calls: Array<{ disposition: number; commit: boolean }> = [];
      const panel = new DeityPanel(
        () => '',
        () => {},
        undefined,
        (disposition, commit) => {
          calls.push({ disposition, commit });
          return world.deity.setDisposition(disposition, world, commit);
        },
      );
      panel.update(world);

      const root = panel.element as unknown as FakeNode;
      const whisperSection = root.children[2];
      const dispositionHeader = whisperSection.children[1];
      const valueBadge = dispositionHeader.children[1];
      const dispositionControl = whisperSection.children[2];
      const sliderWrap = dispositionControl.children[0];
      const slider = sliderWrap.children[1];
      const scaleRow = dispositionControl.children[1];

      expect(slider.tagName).toBe('input');
      expect(slider.type).toBe('range');
      expect(slider.min).toBe('-1');
      expect(slider.max).toBe('1');
      expect(slider.step).toBe('0.01');
      expect(slider.value).toBe('0');
      expect(valueBadge.textContent).toContain('Balanced');

      // Scale runs left-to-right: Steward -> Balanced -> Exploiter
      expect(scaleRow.children.map((c) => c.textContent)).toEqual([
        '🌱 Steward',
        '⚖️ Balanced',
        '🔥 Exploiter',
      ]);

      // Continuous live drag toward Steward (-0.45) previews without committing, then commits on change
      slider.value = '-0.45';
      slider.dispatch('input');
      expect(calls[calls.length - 1]).toEqual({ disposition: -0.45, commit: false });
      expect(valueBadge.textContent).toBe('🌱 Steward 45%');
      expect(valueBadge.classList.contains('is-steward')).toBe(true);

      slider.dispatch('change');
      expect(calls[calls.length - 1]).toEqual({ disposition: -0.45, commit: true });

      // Small value near center snaps cleanly to Balanced (0)
      slider.value = '0.02';
      slider.dispatch('input');
      expect(slider.value).toBe('0');
      expect(calls[calls.length - 1]).toEqual({ disposition: 0, commit: false });
      expect(valueBadge.textContent).toContain('Balanced');

      // Clicking right-hand Exploiter label commits full +1
      scaleRow.children[2].dispatch('click');
      expect(slider.value).toBe('1.00');
      expect(calls[calls.length - 1]).toEqual({ disposition: 1, commit: true });
      expect(valueBadge.textContent).toBe('🔥 Exploiter 100%');
      expect(valueBadge.classList.contains('is-exploiter')).toBe(true);

      // Double-clicking slider centers back to Balanced (0)
      slider.dispatch('dblclick');
      expect(slider.value).toBe('0');
      expect(calls[calls.length - 1]).toEqual({ disposition: 0, commit: true });
      expect(valueBadge.textContent).toContain('Balanced');
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('focuses map locations when clicking DeityPanel status pills such as Rewilding, Cleared Scars, and Border War', () => {
    type FakeNode = {
      tagName: string;
      className: string;
      textContent: string;
      innerHTML: string;
      title: string;
      type: string;
      disabled: boolean;
      children: FakeNode[];
      attrs: Map<string, string>;
      listeners: Map<string, Array<(ev: unknown) => void>>;
      classList: {
        toggle: (token: string, force?: boolean) => boolean;
      };
      setAttribute: (name: string, value: string) => void;
      addEventListener: (type: string, fn: (ev: unknown) => void) => void;
      append: (...nodes: FakeNode[]) => void;
      appendChild: (node: FakeNode) => FakeNode;
      dispatchClick: (ev: unknown) => void;
    };

    const makeNode = (tagName: string): FakeNode => {
      const classes = new Set<string>();
      const attrs = new Map<string, string>();
      const listeners = new Map<string, Array<(ev: unknown) => void>>();
      const node: FakeNode = {
        tagName,
        className: '',
        textContent: '',
        innerHTML: '',
        title: '',
        type: '',
        disabled: false,
        children: [],
        attrs,
        listeners,
        classList: {
          toggle(token: string, force?: boolean) {
            const next = force !== undefined ? force : !classes.has(token);
            if (next) classes.add(token);
            else classes.delete(token);
            return next;
          },
        },
        setAttribute(name: string, value: string) {
          attrs.set(name, value);
        },
        addEventListener(type: string, fn: (ev: unknown) => void) {
          const list = listeners.get(type) ?? [];
          list.push(fn);
          listeners.set(type, list);
        },
        append(...nodes: FakeNode[]) {
          node.children.push(...nodes);
        },
        appendChild(child: FakeNode) {
          node.children.push(child);
          return child;
        },
        dispatchClick(ev: unknown) {
          for (const fn of listeners.get('click') ?? []) fn(ev);
        },
      };
      return node;
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => makeNode(tag),
    };

    try {
      const world = new WorldState(new EventBus(), {
        seed: 202609,
        initialSettlements: 2,
        initialWaterwaySettlements: 0,
        initialCreaturesPerSettlement: 4,
      });
      const [sA, sB] = world.settlements;

      // Trigger rewilding, add a scar, and start a border war between sA and sB
      const rewildInf = world.deity.triggerInfluence('sanctuary_rewilding', world, sA);
      world.rewildingBoost = 0.65;
      const scar = world.addHabitatScar(sB.center.x + 12, sB.center.z - 8, 24, 180);
      world.diplomacy.adjustRelation(sA, sB, -100, world, 'border dispute');
      const fighter = world.creatures[0];
      fighter.activity = 'fighting';
      fighter.x = (sA.center.x + sB.center.x) * 0.5;
      fighter.z = (sA.center.z + sB.center.z) * 0.5;

      const focused: Array<{ x: number; z: number }> = [];
      const panel = new DeityPanel(
        () => '',
        () => {},
        (pos) => focused.push(pos),
        () => '',
      );
      panel.update(world);

      const root = panel.element as unknown as FakeNode;
      const statusEl = root.children[3];
      expect(statusEl.innerHTML).toContain('data-eco-key="rewilding"');
      expect(statusEl.innerHTML).toContain('data-eco-key="scars"');
      expect(statusEl.innerHTML).toContain('data-eco-key="wars"');

      const clickChip = (ecoKey: string) => {
        statusEl.dispatchClick({
          target: {
            closest: (selector: string) =>
              selector === '.eco-chip[data-eco-key]' ? { dataset: { ecoKey } } : null,
          },
        });
      };

      clickChip('rewilding');
      expect(focused[0]).toEqual({ x: rewildInf.position.x, z: rewildInf.position.z });

      clickChip('scars');
      expect(focused[1]).toEqual({ x: scar.x, z: scar.z });

      // Border war focuses active skirmish first, then cycles to warring settlements
      clickChip('wars');
      expect(focused[2]).toEqual({ x: fighter.x, z: fighter.z });
      clickChip('wars');
      expect(focused[3]).toEqual({ x: sA.center.x, z: sA.center.z });
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('places Living Chronicle initially to the right of the Deity box without overlapping it', async () => {
    const fsModuleName = 'node:fs';
    const fs = (await import(/* @vite-ignore */ fsModuleName)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const deityBlock = css.match(/\.hud-deity\s*\{([^}]*)\}/)?.[1] ?? '';
    const chronicleBlock = css.match(/\.hud-chronicle\s*\{([^}]*)\}/)?.[1] ?? '';

    const deityLeft = Number(deityBlock.match(/left:\s*(\d+)px/)?.[1]);
    const deityWidth = Number(deityBlock.match(/width:\s*(\d+)px/)?.[1]);
    const chronicleLeft = Number(chronicleBlock.match(/min\((\d+)px,\s*calc/)?.[1]);

    expect(deityLeft).toBe(12);
    expect(deityWidth).toBe(274);
    expect(chronicleBlock).toContain('top: var(--hud-top-offset, 108px)');
    expect(chronicleBlock).not.toContain('bottom:');
    expect(chronicleLeft).toBeGreaterThanOrEqual(deityLeft + deityWidth + 8);
  });

  it('supports dragging, clamping, z-index focus, double-click reset, and save/restore via HudPanelDragManager', () => {
    type FakeTarget = {
      closest: (selector: string) => FakeTarget | null;
    };
    type FakePanelEl = {
      rect: { left: number; top: number; width: number; height: number };
      classes: Set<string>;
      style: Record<string, string>;
      listeners: Map<string, Set<(ev: unknown) => void>>;
      classList: {
        add: (c: string) => void;
        remove: (c: string) => void;
        contains: (c: string) => boolean;
      };
      contains: (node: unknown) => boolean;
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
      addEventListener: (type: string, fn: (ev: unknown) => void) => void;
      removeEventListener: (type: string, fn: (ev: unknown) => void) => void;
      dispatch: (type: string, ev: unknown) => void;
    };

    const makePanel = (rect: { left: number; top: number; width: number; height: number }): FakePanelEl => {
      const classes = new Set<string>();
      const listeners = new Map<string, Set<(ev: unknown) => void>>();
      const style: Record<string, string> = {};
      const el: FakePanelEl = {
        rect,
        classes,
        style,
        listeners,
        classList: {
          add: (c: string) => {
            classes.add(c);
          },
          remove: (c: string) => {
            classes.delete(c);
          },
          contains: (c: string) => classes.has(c),
        },
        contains: () => true,
        getBoundingClientRect: () => ({
          left: style.left ? Number.parseFloat(style.left) : el.rect.left,
          top: style.top ? Number.parseFloat(style.top) : el.rect.top,
          width: el.rect.width,
          height: el.rect.height,
        }),
        addEventListener: (type, fn) => {
          let set = listeners.get(type);
          if (!set) {
            set = new Set();
            listeners.set(type, set);
          }
          set.add(fn);
        },
        removeEventListener: (type, fn) => {
          listeners.get(type)?.delete(fn);
        },
        dispatch: (type, ev) => {
          for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
        },
      };
      return el;
    };

    const windowListeners = new Map<string, Set<(ev: unknown) => void>>();
    let viewport = { width: 1280, height: 800 };
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      get innerWidth() {
        return viewport.width;
      },
      get innerHeight() {
        return viewport.height;
      },
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        let set = windowListeners.get(type);
        if (!set) {
          set = new Set();
          windowListeners.set(type, set);
        }
        set.add(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        windowListeners.get(type)?.delete(fn);
      },
    };
    const dispatchWindow = (type: string, ev: unknown = {}) => {
      for (const fn of [...(windowListeners.get(type) ?? [])]) fn(ev);
    };

    const headerTarget: FakeTarget = {
      closest: (sel: string) => (sel === '.panel-header' ? headerTarget : null),
    };
    const closeBtnTarget: FakeTarget = {
      closest: (sel: string) => (sel.includes('button') || sel === '.panel-header' ? closeBtnTarget : null),
    };
    const bodyTarget: FakeTarget = {
      closest: () => null,
    };

    try {
      const deityEl = makePanel({ left: 12, top: 108, width: 274, height: 420 });
      const chronicleEl = makePanel({ left: 298, top: 108, width: 310, height: 230 });
      const povEl = makePanel({ left: 170, top: 700, width: 940, height: 86 });

      const changeSnapshots: Array<ReturnType<HudPanelDragManager['getPositions']>> = [];
      const manager = new HudPanelDragManager({
        onPositionsChange: (pos) => changeSnapshots.push(pos),
      });
      manager.register({
        id: 'deity',
        element: deityEl as unknown as HTMLElement,
        handleSelector: '.panel-header',
      });
      manager.register({
        id: 'chronicle',
        element: chronicleEl as unknown as HTMLElement,
        handleSelector: '.panel-header',
      });
      manager.register({
        id: 'pov',
        element: povEl as unknown as HTMLElement,
      });

      expect(deityEl.classList.contains('hud-draggable')).toBe(true);
      expect(chronicleEl.classList.contains('hud-draggable')).toBe(true);

      // 1. Clicking close button inside header does NOT start a drag
      chronicleEl.dispatch('pointerdown', {
        pointerType: 'mouse',
        button: 0,
        pointerId: 1,
        clientX: 590,
        clientY: 120,
        target: closeBtnTarget,
      });
      dispatchWindow('pointermove', { pointerId: 1, clientX: 700, clientY: 200 });
      dispatchWindow('pointerup', { pointerId: 1 });
      expect(manager.getPositions()).toEqual({});
      expect(changeSnapshots.length).toBe(0);

      // 2. Micro-movement under threshold does NOT freeze CSS positioning
      chronicleEl.dispatch('pointerdown', {
        pointerType: 'mouse',
        button: 0,
        pointerId: 2,
        clientX: 350,
        clientY: 120,
        target: headerTarget,
      });
      dispatchWindow('pointermove', { pointerId: 2, clientX: 351, clientY: 121 });
      dispatchWindow('pointerup', { pointerId: 2 });
      expect(chronicleEl.style.left).toBeUndefined();
      expect(manager.getPositions()).toEqual({});

      // 3. Dragging Living Chronicle header moves it, brings it to front, and persists position
      chronicleEl.dispatch('pointerdown', {
        pointerType: 'mouse',
        button: 0,
        pointerId: 3,
        clientX: 350,
        clientY: 120,
        target: headerTarget,
      });
      dispatchWindow('pointermove', { pointerId: 3, clientX: 550, clientY: 270 });
      expect(chronicleEl.classList.contains('is-dragging')).toBe(true);
      expect(chronicleEl.style.left).toBe('498px');
      expect(chronicleEl.style.top).toBe('258px');
      expect(chronicleEl.style.right).toBe('auto');
      expect(chronicleEl.style.bottom).toBe('auto');
      expect(chronicleEl.style.transform).toBe('none');
      expect(Number(chronicleEl.style.zIndex)).toBeGreaterThan(Number(deityEl.style.zIndex));
      expect(Number(chronicleEl.style.zIndex)).toBeLessThan(20);

      dispatchWindow('pointerup', { pointerId: 3 });
      expect(chronicleEl.classList.contains('is-dragging')).toBe(false);
      expect(manager.getPositions()).toEqual({ chronicle: { x: 498, y: 258 } });
      expect(changeSnapshots.length).toBe(1);

      // 4. Dragging Deity panel past viewport bounds clamps safely inside viewport
      deityEl.dispatch('pointerdown', {
        pointerType: 'mouse',
        button: 0,
        pointerId: 4,
        clientX: 50,
        clientY: 120,
        target: headerTarget,
      });
      dispatchWindow('pointermove', { pointerId: 4, clientX: 2500, clientY: -200 });
      dispatchWindow('pointerup', { pointerId: 4 });
      // maxX = 1280 - 274 - 8 = 998; minY = 8
      expect(manager.getPositions().deity).toEqual({ x: 998, y: 8 });
      expect(Number(deityEl.style.zIndex)).toBeGreaterThan(Number(chronicleEl.style.zIndex));

      // 5. Dragging POV bar by non-button region works
      povEl.dispatch('pointerdown', {
        pointerType: 'mouse',
        button: 0,
        pointerId: 5,
        clientX: 300,
        clientY: 720,
        target: bodyTarget,
      });
      dispatchWindow('pointermove', { pointerId: 5, clientX: 250, clientY: 620 });
      dispatchWindow('pointerup', { pointerId: 5 });
      expect(manager.getPositions().pov).toEqual({ x: 120, y: 600 });

      // 6. Double-clicking Chronicle header resets it back to default CSS layout
      chronicleEl.dispatch('dblclick', { target: headerTarget });
      expect(chronicleEl.style.left).toBe('');
      expect(chronicleEl.style.top).toBe('');
      expect(manager.getPositions().chronicle).toBeUndefined();
      expect(manager.getPositions().deity).toEqual({ x: 998, y: 8 });

      // 7. Restoring saved positions applies present entries, resets omitted ones, and clamps on resize
      manager.setPositions({ chronicle: { x: 1100, y: 650 } });
      expect(deityEl.style.left).toBe('');
      expect(povEl.style.left).toBe('');
      // Clamped for 1280x800: maxX = 1280 - 310 - 8 = 962, maxY = 800 - 230 - 8 = 562
      expect(chronicleEl.style.left).toBe('962px');
      expect(chronicleEl.style.top).toBe('562px');

      // Shrinking viewport re-clamps visible panels automatically
      viewport = { width: 900, height: 600 };
      dispatchWindow('resize');
      expect(chronicleEl.style.left).toBe('582px');
      expect(chronicleEl.style.top).toBe('362px');

      manager.dispose();
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prevWindow;
      }
    }
  });

  it('preserves horizontal scroll position of broad family trees across live refreshes in CreatureDirectoryModal', () => {
    type FakeScroller = {
      dataset: Record<string, string>;
      scrollLeft: number;
      scrollTop: number;
      classList: { contains: (c: string) => boolean };
      getAttribute: (name: string) => string | null;
    };
    type FakeNode = {
      tagName: string;
      type: string;
      className: string;
      textContent: string;
      placeholder: string;
      title: string;
      value: string;
      checked: boolean;
      scrollTop: number;
      scrollLeft: number;
      children: FakeNode[];
      scrollers: FakeScroller[];
      listeners: Map<string, Set<(ev: unknown) => void>>;
      classList: {
        add: (c: string) => void;
        remove: (c: string) => void;
        toggle: (c: string, force?: boolean) => boolean;
        contains: (c: string) => boolean;
      };
      setAttribute: (name: string, value: string) => void;
      addEventListener: (type: string, fn: (ev: unknown) => void, opts?: unknown) => void;
      removeEventListener: (type: string, fn: (ev: unknown) => void) => void;
      append: (...nodes: FakeNode[]) => void;
      appendChild: (node: FakeNode) => FakeNode;
      querySelectorAll: (selector: string) => FakeScroller[];
      querySelector: (selector: string) => FakeScroller | null;
      dispatch: (type: string, ev?: unknown) => void;
      innerHTML: string;
    };

    const makeNode = (tagName: string): FakeNode => {
      const classes = new Set<string>();
      const listeners = new Map<string, Set<(ev: unknown) => void>>();
      let html = '';
      const node: FakeNode = {
        tagName,
        type: '',
        className: '',
        textContent: '',
        placeholder: '',
        title: '',
        value: '',
        checked: false,
        scrollTop: 0,
        scrollLeft: 0,
        children: [],
        scrollers: [],
        listeners,
        classList: {
          add: (c: string) => {
            classes.add(c);
          },
          remove: (c: string) => {
            classes.delete(c);
          },
          toggle: (c: string, force?: boolean) => {
            const next = force !== undefined ? force : !classes.has(c);
            if (next) classes.add(c);
            else classes.delete(c);
            return next;
          },
          contains: (c: string) => classes.has(c),
        },
        setAttribute: () => {},
        addEventListener: (type, fn) => {
          let set = listeners.get(type);
          if (!set) {
            set = new Set();
            listeners.set(type, set);
          }
          set.add(fn);
        },
        removeEventListener: (type, fn) => {
          listeners.get(type)?.delete(fn);
        },
        append: (...nodes) => {
          node.children.push(...nodes);
        },
        appendChild: (child) => {
          node.children.push(child);
          return child;
        },
        querySelectorAll: (selector: string) => {
          if (selector.includes('lineage-tree-scroll')) return node.scrollers;
          return [];
        },
        querySelector: () => null,
        dispatch: (type, ev = {}) => {
          for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
        },
        get innerHTML() {
          return html;
        },
        set innerHTML(next: string) {
          html = next;
          // Simulate browser replacing inner DOM and resetting new scrollers to scrollLeft = 0
          const ids = [...next.matchAll(/class="lineage-tree-scroll"\s+data-lineage-id="([^"]+)"/g)].map(
            (m) => m[1],
          );
          node.scrollers = ids.map((lineageId) => ({
            dataset: { lineageId },
            scrollLeft: 0,
            scrollTop: 0,
            classList: { contains: (c: string) => c === 'lineage-tree-scroll' },
            getAttribute: (name: string) => (name === 'data-lineage-id' ? lineageId : null),
          }));
        },
      };
      return node;
    };

    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => makeNode(tag),
    };

    try {
      const world = new WorldState(new EventBus(), {
        seed: 551199,
        initialSettlements: 1,
        initialWaterwaySettlements: 0,
        initialCreaturesPerSettlement: 4,
      });
      const [home] = world.settlements;
      const [parentA, parentB] = world.creatures;
      parentA.mateId = parentB.id;
      parentB.mateId = parentA.id;
      const child = world.spawnCreature(home, parentA.species, 'forager', {
        ageDays: 0.4,
        generation: 2,
        parentIds: [parentA.id, parentB.id],
      });
      parentA.offspringIds.push(child.id);
      parentB.offspringIds.push(child.id);

      const modal = new CreatureDirectoryModal({
        onClose: () => {},
        onInspectCreature: () => {},
        onEnterCreaturePov: () => {},
        onFocusSettlement: () => {},
      });
      modal.openModal(world, { mode: 'tree' });

      const backdrop = modal.element as unknown as FakeNode;
      const card = backdrop.children[0];
      const bodyEl = card.children[2];
      expect(bodyEl.scrollers.length).toBeGreaterThanOrEqual(1);

      // User scrolls the family tree horizontally to the right
      const treeScroller = bodyEl.scrollers[0];
      treeScroller.scrollLeft = 420;

      // Advance simulation so creature ages change and trigger a forced re-render
      world.step(1.0);
      parentA.ageDays += 1.5;
      modal.update(1.0, world, true);

      // Recreated scroller retains the user's horizontal scroll offset instead of bouncing back to 0
      expect(bodyEl.scrollers[0]).not.toBe(treeScroller);
      expect(bodyEl.scrollers[0].scrollLeft).toBe(420);
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });
});
