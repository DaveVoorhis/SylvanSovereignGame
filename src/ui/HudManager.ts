import type { QualityPreset } from '@core/Config';
import type { PrayerIntent, SelectionTarget, Vec2 } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import { ChroniclePanel } from './ChroniclePanel';
import { CreatureDirectoryModal } from './CreatureDirectoryModal';
import { CreaturePovBar } from './CreaturePovBar';
import { DeityPanel } from './DeityPanel';
import { InspectorPanel } from './InspectorPanel';
import { TopBar } from './TopBar';

export interface HudCallbacks {
  onSetSpeed: (speed: number) => void;
  onToggleCinematic: () => boolean;
  onToggleCreatureView: () => void;
  onToggleZenMode: () => void;
  onEnterCreaturePov: (creatureId: string) => void;
  onExitCreaturePov: () => void;
  onPrevCreature: () => void;
  onNextCreature: () => void;
  onRandomCreature: () => void;
  onResetOverview: () => void;
  onNewWorld: () => void;
  onChangeQuality: (preset: QualityPreset) => void;
  onWhisper: (intent: PrayerIntent) => string;
  onFocusPosition: (pos: Vec2) => void;
  onFocusSettlement: (settlementId: string) => void;
  onInspectCreature: (creatureId: string) => void;
  onFollowCreature: (creatureId: string) => void;
  onClearSelection: () => void;
}

/**
 * Coordinates the minimalist spectator HUD with throttled updates
 * so UI refreshes never stall the 3D render loop.
 */
export class HudManager {
  private readonly root: HTMLElement;
  private readonly topBar: TopBar;
  private readonly deityPanel: DeityPanel;
  private readonly chroniclePanel: ChroniclePanel;
  private readonly inspectorPanel: InspectorPanel;
  private readonly directoryModal: CreatureDirectoryModal;
  private readonly povBar: CreaturePovBar;
  private readonly footerHint: HTMLElement;
  private readonly zenToast: HTMLElement;
  private readonly topBarResizeObserver: ResizeObserver | null = null;
  private lastWorld: WorldState | null = null;
  private zenMode = false;
  private zenToastTimer: number | null = null;
  private accumSec = 0.25;

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    root.innerHTML = '';

    this.topBar = new TopBar({
      onSetSpeed: callbacks.onSetSpeed,
      onToggleCinematic: callbacks.onToggleCinematic,
      onToggleCreatureView: callbacks.onToggleCreatureView,
      onToggleCreatureDirectory: () => this.toggleCreatureDirectory(),
      onToggleDeityPanel: () => this.toggleDeityPanel(),
      onToggleChroniclePanel: () => this.toggleChroniclePanel(),
      onToggleZenMode: callbacks.onToggleZenMode,
      onResetOverview: callbacks.onResetOverview,
      onNewWorld: callbacks.onNewWorld,
      onChangeQuality: callbacks.onChangeQuality,
      onFocusSettlement: callbacks.onFocusSettlement,
    });

    this.deityPanel = new DeityPanel(callbacks.onWhisper, () => this.setDeityPanelOpen(false));
    this.chroniclePanel = new ChroniclePanel(callbacks.onFocusPosition, () =>
      this.setChroniclePanelOpen(false),
    );
    this.topBar.setDeityOpen(this.deityPanel.isOpen());
    this.topBar.setChronicleOpen(this.chroniclePanel.isOpen());

    this.inspectorPanel = new InspectorPanel({
      onClose: callbacks.onClearSelection,
      onFollowCreature: callbacks.onFollowCreature,
      onEnterCreaturePov: callbacks.onEnterCreaturePov,
      onExitCreaturePov: callbacks.onExitCreaturePov,
      onFocusSettlement: callbacks.onFocusSettlement,
      onViewLineage: (creatureId) => this.openCreatureLineage(creatureId),
    });

    this.directoryModal = new CreatureDirectoryModal({
      onClose: () => {
        this.topBar.setDirectoryOpen(false);
      },
      onInspectCreature: callbacks.onInspectCreature,
      onEnterCreaturePov: callbacks.onEnterCreaturePov,
      onFocusSettlement: callbacks.onFocusSettlement,
    });

    this.povBar = new CreaturePovBar({
      onPrevCreature: callbacks.onPrevCreature,
      onNextCreature: callbacks.onNextCreature,
      onRandomCreature: callbacks.onRandomCreature,
      onExitPov: callbacks.onExitCreaturePov,
    });

    this.footerHint = document.createElement('div');
    this.footerHint.className = 'hud-controls-hint';
    this.footerHint.textContent =
      'Drag to orbit · Scroll to zoom · WASD to pan · Click to inspect · C Census · V Creature View · Z Zen Mode';

    this.zenToast = document.createElement('div');
    this.zenToast.className = 'zen-exit-toast';
    this.zenToast.textContent = 'Zen Mode · Press Z or Esc to return';

    root.append(
      this.topBar.element,
      this.deityPanel.element,
      this.chroniclePanel.element,
      this.inspectorPanel.element,
      this.povBar.element,
      this.footerHint,
      this.zenToast,
      this.directoryModal.element,
    );

    if (typeof ResizeObserver !== 'undefined') {
      const syncOffset = () => {
        const rect = this.topBar.element.getBoundingClientRect();
        if (rect.height > 0) {
          this.root.style.setProperty('--hud-top-offset', `${Math.ceil(rect.height + 22)}px`);
        }
      };
      this.topBarResizeObserver = new ResizeObserver(syncOffset);
      this.topBarResizeObserver.observe(this.topBar.element);
      syncOffset();
    }
  }

  setDeityPanelOpen(open: boolean): void {
    this.deityPanel.setOpen(open);
    this.topBar.setDeityOpen(open);
    if (open && this.lastWorld) {
      this.deityPanel.update(this.lastWorld);
    }
  }

  toggleDeityPanel(): void {
    this.setDeityPanelOpen(!this.deityPanel.isOpen());
  }

  setChroniclePanelOpen(open: boolean): void {
    this.chroniclePanel.setOpen(open);
    this.topBar.setChronicleOpen(open);
    if (open && this.lastWorld) {
      this.chroniclePanel.update(this.lastWorld.chronicle.entries, true);
    }
  }

  toggleChroniclePanel(): void {
    this.setChroniclePanelOpen(!this.chroniclePanel.isOpen());
  }

  isCreatureDirectoryOpen(): boolean {
    return this.directoryModal.isOpen();
  }

  toggleCreatureDirectory(): void {
    if (!this.lastWorld) return;
    const nowOpen = this.directoryModal.toggle(this.lastWorld);
    this.topBar.setDirectoryOpen(nowOpen);
  }

  openCreatureLineage(creatureId: string): void {
    if (!this.lastWorld) return;
    this.directoryModal.openModal(this.lastWorld, { mode: 'tree', focusCreatureId: creatureId });
    this.topBar.setDirectoryOpen(true);
  }

  closeCreatureDirectory(): void {
    if (!this.directoryModal.isOpen()) return;
    this.directoryModal.close();
    this.topBar.setDirectoryOpen(false);
  }

  /** Toggles Zen Mode: hides all floating HUD panels/text and briefly fades a whisper exit hint. */
  setZenMode(active: boolean): void {
    this.zenMode = active;
    if (active && this.directoryModal.isOpen()) {
      this.closeCreatureDirectory();
    }
    this.root.classList.toggle('zen-mode', active);
    this.topBar.setZenActive(active);

    if (this.zenToastTimer !== null) {
      window.clearTimeout(this.zenToastTimer);
      this.zenToastTimer = null;
    }

    if (active) {
      this.zenToast.classList.add('visible');
      this.zenToastTimer = window.setTimeout(() => {
        this.zenToast.classList.remove('visible');
        this.zenToastTimer = null;
      }, 2200);
    } else {
      this.zenToast.classList.remove('visible');
    }
  }

  update(
    dt: number,
    world: WorldState,
    selection: SelectionTarget,
    isFollowing: boolean,
    povCreatureId: string | null,
    force = false,
  ): void {
    this.lastWorld = world;
    if (this.zenMode) return;
    this.directoryModal.update(dt, world, force);
    this.accumSec += dt;
    if (!force && this.accumSec < 0.22) return;
    this.accumSec = 0;

    const inPov = povCreatureId !== null;
    this.topBar.update(world, inPov);
    this.deityPanel.update(world);
    this.chroniclePanel.update(world.chronicle.entries);
    this.inspectorPanel.update(selection, world, isFollowing, povCreatureId);
    this.povBar.update(world, povCreatureId);
    this.footerHint.classList.toggle('hidden', inPov);
  }

  dispose(): void {
    if (this.topBarResizeObserver) {
      this.topBarResizeObserver.disconnect();
    }
    if (this.zenToastTimer !== null) {
      window.clearTimeout(this.zenToastTimer);
      this.zenToastTimer = null;
    }
  }
}
