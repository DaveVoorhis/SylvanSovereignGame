import type { QualityPreset } from '@core/Config';
import type { PrayerIntent, SelectionTarget, Vec2 } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import { ChroniclePanel } from './ChroniclePanel';
import { CreaturePovBar } from './CreaturePovBar';
import { DeityPanel } from './DeityPanel';
import { InspectorPanel } from './InspectorPanel';
import { TopBar } from './TopBar';

export interface HudCallbacks {
  onSetSpeed: (speed: number) => void;
  onToggleCinematic: () => boolean;
  onToggleCreatureView: () => void;
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
  onFollowCreature: (creatureId: string) => void;
  onClearSelection: () => void;
}

/**
 * Coordinates the minimalist spectator HUD with throttled updates
 * so UI refreshes never stall the 3D render loop.
 */
export class HudManager {
  private readonly topBar: TopBar;
  private readonly deityPanel: DeityPanel;
  private readonly chroniclePanel: ChroniclePanel;
  private readonly inspectorPanel: InspectorPanel;
  private readonly povBar: CreaturePovBar;
  private readonly footerHint: HTMLElement;
  private accumSec = 0.25;

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    root.innerHTML = '';

    this.topBar = new TopBar({
      onSetSpeed: callbacks.onSetSpeed,
      onToggleCinematic: callbacks.onToggleCinematic,
      onToggleCreatureView: callbacks.onToggleCreatureView,
      onResetOverview: callbacks.onResetOverview,
      onNewWorld: callbacks.onNewWorld,
      onChangeQuality: callbacks.onChangeQuality,
      onFocusSettlement: callbacks.onFocusSettlement,
    });

    this.deityPanel = new DeityPanel(callbacks.onWhisper);
    this.chroniclePanel = new ChroniclePanel(callbacks.onFocusPosition);
    this.inspectorPanel = new InspectorPanel({
      onClose: callbacks.onClearSelection,
      onFollowCreature: callbacks.onFollowCreature,
      onEnterCreaturePov: callbacks.onEnterCreaturePov,
      onExitCreaturePov: callbacks.onExitCreaturePov,
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
      'Drag to orbit · Scroll to zoom · WASD to pan · Click creature to inspect · Press V for Creature Eye View';

    root.append(
      this.topBar.element,
      this.deityPanel.element,
      this.chroniclePanel.element,
      this.inspectorPanel.element,
      this.povBar.element,
      this.footerHint,
    );
  }

  update(
    dt: number,
    world: WorldState,
    selection: SelectionTarget,
    isFollowing: boolean,
    povCreatureId: string | null,
    force = false,
  ): void {
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
}
