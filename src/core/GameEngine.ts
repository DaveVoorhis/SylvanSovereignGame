import type { QualityPreset } from './Config';
import { EventBus } from './EventBus';
import {
  buildSaveRecord,
  DEFAULT_AUTOSAVE_SLOT_ID,
  makeManualSlotId,
  SaveStore,
  type SaveGameRecord,
  type SaveSlotMeta,
  type SaveViewState,
} from './SaveStore';
import { generateRandomSeed } from './SeededRandom';
import type { SelectionTarget } from './Types';
import type { CreaturePovPose } from '@rendering/CameraController';
import { SceneManager } from '@rendering/SceneManager';
import type { Creature } from '@simulation/creatures/Creature';
import { WorldState } from '@simulation/WorldState';
import { HudManager } from '@ui/HudManager';
import { nextPaintFrame, type SplashScreen } from '@ui/SplashScreen';

const AUTOSAVE_INTERVAL_SEC = 25;

/**
 * Reads an explicit `?seed=<int>` URL query parameter if provided.
 */
function resolveExplicitUrlSeed(): number | null {
  if (typeof window !== 'undefined' && window.location?.search) {
    const raw = new URLSearchParams(window.location.search).get('seed');
    if (raw !== null && /^\d+$/.test(raw.trim())) {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function resolveInitialSeed(): number {
  return resolveExplicitUrlSeed() ?? generateRandomSeed();
}

/**
 * Top-level application coordinator linking the headless woodland simulation,
 * photorealistic 3D Three.js renderer, Creature Eye-View POV switching,
 * and minimalist spectator HUD.
 */
export class GameEngine {
  readonly bus: EventBus;
  private world: WorldState;
  private readonly sceneManager: SceneManager;
  private readonly hud: HudManager;
  private readonly splash: SplashScreen | null;
  private readonly saveStore: SaveStore;

  private simSpeed = 1;
  private selection: SelectionTarget = null;
  private povCreatureId: string | null = null;
  private zenMode = false;
  private enteredFullscreenForZen = false;
  private isRebuilding = false;
  private rafId: number | null = null;
  private lastFrameMs = 0;
  private autosaveAccumSec = 0;
  private autosaveInFlight = false;

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onFullscreenChangeBound: () => void;
  private readonly onVisibilityChangeBound: () => void;
  private readonly onPageHideBound: () => void;

  static async create(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    splash?: SplashScreen | null,
  ): Promise<GameEngine> {
    const bus = new EventBus();
    const saveStore = new SaveStore();
    const explicitSeed = resolveExplicitUrlSeed();

    let loadedAutosave: SaveGameRecord | null = null;
    if (explicitSeed === null && saveStore.isAvailable()) {
      splash?.setProgress(6, 'Checking saved woodland realms…');
      loadedAutosave = await saveStore.loadAutosave();
    }

    let world: WorldState;
    if (loadedAutosave) {
      splash?.setProgress(
        12,
        `Restoring saved realm (Day ${loadedAutosave.meta.day} · ${loadedAutosave.meta.deityName})…`,
      );
      await nextPaintFrame();
      world = WorldState.fromSnapshot(bus, loadedAutosave.world);
      splash?.setProgress(22, 'Rebuilding villages, kin & living memories…');
      await nextPaintFrame();
    } else {
      splash?.setProgress(10, 'Carving alpine peaks, watersheds & sunlit shores…');
      await nextPaintFrame();
      world = new WorldState(bus, {
        seed: explicitSeed ?? generateRandomSeed(),
        initialWaterwaySettlements: 1,
      });
      splash?.setProgress(22, 'Awakening the woodland sovereign & setting the stage…');
      await nextPaintFrame();
    }

    const engine = new GameEngine(canvas, hudRoot, {
      bus,
      world,
      saveStore,
      deferSceneBuild: true,
      splash: splash ?? null,
    });
    await engine.sceneManager.buildWorldSceneAsync(
      world,
      (pct, label) => splash?.setProgress(pct, label),
      true,
    );
    if (loadedAutosave?.view) {
      engine.applyViewState(loadedAutosave.view);
    } else if (!loadedAutosave && explicitSeed === null) {
      void engine.persistAutosaveQuietly();
    }
    engine.refreshHudNow();
    return engine;
  }

  constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    init?: {
      bus?: EventBus;
      world?: WorldState;
      saveStore?: SaveStore;
      deferSceneBuild?: boolean;
      splash?: SplashScreen | null;
    },
  ) {
    this.bus = init?.bus ?? new EventBus();
    this.splash = init?.splash ?? null;
    this.saveStore = init?.saveStore ?? new SaveStore();
    this.world = init?.world ?? new WorldState(this.bus, { seed: resolveInitialSeed(), initialWaterwaySettlements: 1 });
    this.sceneManager = new SceneManager(canvas, this.world, 'high', init?.deferSceneBuild ?? false);

    this.hud = new HudManager(hudRoot, {
      onSetSpeed: (speed) => {
        this.simSpeed = speed;
      },
      onToggleCinematic: () => {
        this.sceneManager.cameraController.cinematicDrift =
          !this.sceneManager.cameraController.cinematicDrift;
        return this.sceneManager.cameraController.cinematicDrift;
      },
      onToggleCreatureView: () => {
        if (this.povCreatureId) {
          this.exitCreaturePov();
        } else {
          this.enterSelectedOrFirstCreaturePov();
        }
      },
      onToggleZenMode: () => {
        this.toggleZenMode();
      },
      onEnterCreaturePov: (creatureId) => {
        this.enterCreaturePov(creatureId);
      },
      onExitCreaturePov: () => {
        this.exitCreaturePov();
      },
      onPrevCreature: () => {
        this.cycleCreaturePov(-1);
      },
      onNextCreature: () => {
        this.cycleCreaturePov(1);
      },
      onRandomCreature: () => {
        this.randomCreaturePov();
      },
      onResetOverview: () => {
        this.exitCreaturePov(false);
        this.sceneManager.cameraController.resetOverview();
      },
      onNewWorld: () => {
        void this.resetWorldAsync(generateRandomSeed(this.world.config.seed));
      },
      onChangeQuality: (preset: QualityPreset) => {
        void this.changeQualityAsync(preset);
      },
      onWhisper: (intent) => this.world.deity.receiveSpectatorWhisper(intent, this.world),
      onFocusPosition: (pos) => {
        this.exitCreaturePov(false);
        const y = Math.max(
          this.world.terrain.getHeightAt(pos.x, pos.z),
          this.world.terrain.waterLevel,
        );
        this.sceneManager.cameraController.flyTo(pos, y + 1.5, 24);
      },
      onFocusSettlement: (settlementId) => {
        const s = this.world.getSettlement(settlementId);
        if (!s) return;
        this.exitCreaturePov(false);
        this.selection = { kind: 'settlement', id: settlementId };
        this.sceneManager.setSelection(this.selection);
        this.sceneManager.cameraController.flyTo(s.center, s.groundY + 1.8, 25);
        this.refreshHudNow();
      },
      onInspectCreature: (creatureId) => {
        const c = this.world.getCreature(creatureId);
        if (!c) return;
        this.exitCreaturePov(false);
        this.selection = { kind: 'creature', id: creatureId };
        this.sceneManager.setSelection(this.selection);
        this.sceneManager.cameraController.flyTo({ x: c.x, z: c.z }, c.y + 0.9, 13);
        this.refreshHudNow();
      },
      onFollowCreature: (creatureId) => {
        const c = this.world.getCreature(creatureId);
        if (!c) return;
        if (this.povCreatureId) {
          this.exitCreaturePov(false);
        }
        if (this.sceneManager.cameraController.isFollowing()) {
          this.sceneManager.cameraController.follow(null);
        } else {
          this.sceneManager.cameraController.follow(() => {
            const live = this.world.getCreature(creatureId);
            return live && live.alive ? { x: live.x, y: live.y, z: live.z } : null;
          });
        }
        this.refreshHudNow();
      },
      onClearSelection: () => {
        this.selection = null;
        this.sceneManager.setSelection(null);
        this.sceneManager.cameraController.follow(null);
        this.refreshHudNow();
      },
      onListSaveSlots: () => this.saveStore.listSlots(),
      onSaveAutosave: () => this.saveSlot(DEFAULT_AUTOSAVE_SLOT_ID, 'Autosave'),
      onSaveNewSlot: (name) => {
        const fallback = `Day ${this.world.day} · ${this.world.season[0].toUpperCase()}${this.world.season.slice(1)}`;
        const cleanName = name.trim() || fallback;
        return this.saveSlot(makeManualSlotId(cleanName), cleanName);
      },
      onOverwriteSlot: (slotId, name) => this.saveSlot(slotId, name),
      onLoadSaveSlot: (slotId) => this.loadSlotAsync(slotId),
      onDeleteSaveSlot: (slotId) => this.saveStore.deleteSlot(slotId),
      onExportSaveRecord: () => this.buildCurrentSaveRecord(DEFAULT_AUTOSAVE_SLOT_ID, 'Exported Realm'),
      onImportSaveRecord: (record) => this.loadSaveRecordAsync(record),
    });

    this.bus.on('selection:changed', (target) => {
      // If already in Creature Eye View and the user clicks another creature, jump right into its eyes!
      if (this.povCreatureId && target?.kind === 'creature' && target.id !== this.povCreatureId) {
        this.enterCreaturePov(target.id);
        return;
      }

      // In Zen Mode world view, keep the forest completely pure with no selection rings or inspector popups
      if (this.zenMode && !this.povCreatureId) {
        this.selection = null;
        this.sceneManager.setSelection(null);
        return;
      }

      this.selection = target;
      if (!target) {
        this.sceneManager.cameraController.follow(null);
      }
      this.refreshHudNow();
    });

    this.onKeyDownBound = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.code === 'Escape' && this.hud.isAnyModalOpen()) {
        e.preventDefault();
        this.hud.closeModals();
        return;
      }
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

      if (e.code === 'KeyZ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.toggleZenMode();
      } else if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (!this.zenMode) {
          this.hud.toggleCreatureDirectory();
        }
      } else if (e.code === 'Escape' && this.zenMode) {
        e.preventDefault();
        this.exitZenMode();
      } else if (e.code === 'Escape' && this.povCreatureId) {
        e.preventDefault();
        this.exitCreaturePov();
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        if (this.povCreatureId) {
          this.exitCreaturePov();
        } else {
          this.enterSelectedOrFirstCreaturePov();
        }
      } else if (e.code === 'BracketLeft' || (this.povCreatureId && e.code === 'ArrowLeft')) {
        e.preventDefault();
        this.cycleCreaturePov(-1);
      } else if (e.code === 'BracketRight' || (this.povCreatureId && e.code === 'ArrowRight')) {
        e.preventDefault();
        this.cycleCreaturePov(1);
      } else if (this.povCreatureId && e.code === 'KeyR') {
        e.preventDefault();
        this.randomCreaturePov();
      }
    };
    window.addEventListener('keydown', this.onKeyDownBound);

    this.onFullscreenChangeBound = () => {
      this.sceneManager.resize();
      if (this.zenMode && this.enteredFullscreenForZen && !this.isDocumentFullscreen()) {
        this.enteredFullscreenForZen = false;
        this.exitZenMode();
      }
    };
    document.addEventListener('fullscreenchange', this.onFullscreenChangeBound);
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChangeBound);

    this.onVisibilityChangeBound = () => {
      if (document.visibilityState === 'hidden') {
        void this.persistAutosaveQuietly();
      }
    };
    this.onPageHideBound = () => {
      void this.persistAutosaveQuietly();
    };
    document.addEventListener('visibilitychange', this.onVisibilityChangeBound);
    window.addEventListener('pagehide', this.onPageHideBound);

    this.refreshHudNow();
  }

  isZenMode(): boolean {
    return this.zenMode;
  }

  toggleZenMode(): void {
    if (this.zenMode) {
      this.exitZenMode();
    } else {
      this.enterZenMode();
    }
  }

  enterZenMode(): void {
    if (this.zenMode) return;
    this.zenMode = true;

    if (!this.povCreatureId) {
      this.selection = null;
      this.sceneManager.setSelection(null);
    }

    document.body.classList.add('zen-mode');
    this.hud.setZenMode(true);

    if (!this.isDocumentFullscreen()) {
      const docEl = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const req = docEl.requestFullscreen ?? docEl.webkitRequestFullscreen;
      if (typeof req === 'function') {
        try {
          const result = req.call(docEl);
          this.enteredFullscreenForZen = true;
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch(() => {
              this.enteredFullscreenForZen = false;
            });
          }
        } catch {
          this.enteredFullscreenForZen = false;
        }
      }
    }
  }

  exitZenMode(): void {
    if (!this.zenMode) return;
    this.zenMode = false;
    const shouldExitFs = this.enteredFullscreenForZen && this.isDocumentFullscreen();
    this.enteredFullscreenForZen = false;

    document.body.classList.remove('zen-mode');
    this.hud.setZenMode(false);
    this.refreshHudNow();

    if (shouldExitFs) {
      const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
      const exitFs = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (typeof exitFs === 'function') {
        try {
          const res = exitFs.call(doc);
          if (res && typeof (res as Promise<void>).catch === 'function') {
            (res as Promise<void>).catch(() => {});
          }
        } catch {
          // Ignore fullscreen exit errors
        }
      }
    }
  }

  private isDocumentFullscreen(): boolean {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  }

  enterCreaturePov(creatureId: string): void {
    const creature = this.world.getCreature(creatureId);
    if (!creature || !creature.alive) return;

    this.povCreatureId = creature.id;
    this.selection = { kind: 'creature', id: creature.id };
    this.sceneManager.setSelection(this.selection);
    this.sceneManager.setPovCreatureId(creature.id);

    this.sceneManager.cameraController.enterCreaturePov(() =>
      this.buildCreaturePovPose(creature.id),
    );
    this.refreshHudNow();
  }

  exitCreaturePov(restoreSavedView = true): void {
    if (!this.povCreatureId) return;
    this.povCreatureId = null;
    this.sceneManager.setPovCreatureId(null);
    this.sceneManager.cameraController.exitCreaturePov(restoreSavedView);
    this.refreshHudNow();
  }

  cycleCreaturePov(delta: number): void {
    const alive = this.world.creatures.filter((c) => c.alive);
    if (alive.length === 0) return;

    if (!this.povCreatureId) {
      const startIndex = delta < 0 ? alive.length - 1 : 0;
      this.enterCreaturePov(alive[startIndex].id);
      return;
    }

    const currentIdx = alive.findIndex((c) => c.id === this.povCreatureId);
    const baseIdx = currentIdx === -1 ? 0 : currentIdx;
    const nextIdx = (baseIdx + delta + alive.length) % alive.length;
    this.enterCreaturePov(alive[nextIdx].id);
  }

  randomCreaturePov(): void {
    const alive = this.world.creatures.filter((c) => c.alive);
    if (alive.length === 0) return;
    const pool =
      alive.length > 1 && this.povCreatureId
        ? alive.filter((c) => c.id !== this.povCreatureId)
        : alive;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.enterCreaturePov(pick.id);
  }

  private enterSelectedOrFirstCreaturePov(): void {
    if (this.selection?.kind === 'creature') {
      const selected = this.world.getCreature(this.selection.id);
      if (selected?.alive) {
        this.enterCreaturePov(selected.id);
        return;
      }
    }
    const firstAlive = this.world.creatures.find((c) => c.alive);
    if (firstAlive) {
      this.enterCreaturePov(firstAlive.id);
    }
  }

  private buildCreaturePovPose(creatureId: string): CreaturePovPose | null {
    const c: Creature | undefined = this.world.getCreature(creatureId);
    if (!c) return null;

    let eyeHeight: number;
    if (c.def.strictlyAquatic) {
      // River Koi eyes sit inside the water column — keep Eye View cleanly submerged below waterLevel
      const waterLevel = this.world.terrain.waterLevel;
      const groundY = this.world.terrain.getHeightAt(c.x, c.z);
      const desiredEyeY = Math.min(waterLevel - 0.16, c.y + 0.04 * c.getSizeScale());
      const safeEyeY = Math.max(groundY + 0.12, desiredEyeY);
      eyeHeight = safeEyeY - c.y;
    } else {
      eyeHeight = Math.max(0.38, c.getSizeScale() * 1.04);
    }

    let bobOffset = 0;
    if (c.activity !== 'resting') {
      if (c.def.locomotion === 'hop') {
        bobOffset = Math.abs(Math.sin(c.animPhase)) * 0.2;
      } else if (c.def.locomotion === 'fly') {
        bobOffset = Math.sin(c.animPhase * 1.2) * 0.08;
      } else if (c.def.locomotion === 'swim') {
        bobOffset = Math.sin(c.animPhase * 1.2) * 0.025;
      } else if (c.def.locomotion === 'slither') {
        bobOffset = Math.sin(c.animPhase * 1.4) * 0.03;
      } else {
        bobOffset = Math.abs(Math.sin(c.animPhase)) * 0.07;
      }
    } else {
      bobOffset = c.def.strictlyAquatic ? -0.02 : -0.14;
    }

    return {
      x: c.x,
      y: c.y,
      z: c.z,
      heading: c.heading,
      eyeHeight,
      bobOffset,
      alive: c.alive,
    };
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastFrameMs = performance.now();
    const loop = (now: number) => {
      const realDt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;

      if (!this.isRebuilding && this.simSpeed > 0) {
        const simDt = realDt * this.simSpeed;
        const steps = Math.max(1, Math.ceil(simDt / 0.05));
        const stepDt = simDt / steps;
        for (let i = 0; i < steps; i++) {
          this.world.step(stepDt);
        }
        this.autosaveAccumSec += realDt;
        if (this.autosaveAccumSec >= AUTOSAVE_INTERVAL_SEC) {
          this.autosaveAccumSec = 0;
          void this.persistAutosaveQuietly();
        }
      }

      // If the currently viewed creature fell, smoothly jump to the next living creature or return to world view
      if (!this.isRebuilding && this.povCreatureId) {
        const host = this.world.getCreature(this.povCreatureId);
        if (!host || !host.alive) {
          const nextAlive = this.world.creatures.find((c) => c.alive);
          if (nextAlive) {
            this.enterCreaturePov(nextAlive.id);
          } else {
            this.exitCreaturePov();
          }
        }
      }

      if (!this.isRebuilding) {
        this.sceneManager.renderFrame(realDt);
        this.hud.update(
          realDt,
          this.world,
          this.selection,
          this.sceneManager.cameraController.isFollowing(),
          this.povCreatureId,
        );
      }

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  resetWorld(seed: number): void {
    this.povCreatureId = null;
    this.selection = null;
    this.sceneManager.setPovCreatureId(null);
    this.sceneManager.setSelection(null);
    this.sceneManager.cameraController.exitCreaturePov(false);
    this.sceneManager.cameraController.follow(null);
    this.world = new WorldState(this.bus, { seed, initialWaterwaySettlements: 1 });
    this.sceneManager.rebuildWorldScene(this.world);
    this.bus.emit('world:reset', { seed });
    this.refreshHudNow();
  }

  async resetWorldAsync(seed: number): Promise<void> {
    if (this.isRebuilding) return;
    this.isRebuilding = true;
    try {
      this.splash?.show('Dreaming up a brand-new valley…');
      this.splash?.setProgress(10, 'Carving alpine peaks, watersheds & sunlit shores…');
      await nextPaintFrame();

      this.povCreatureId = null;
      this.selection = null;
      this.sceneManager.setPovCreatureId(null);
      this.sceneManager.setSelection(null);
      this.sceneManager.cameraController.exitCreaturePov(false);
      this.sceneManager.cameraController.follow(null);

      this.world = new WorldState(this.bus, { seed, initialWaterwaySettlements: 1 });
      await this.sceneManager.rebuildWorldSceneAsync(
        this.world,
        (pct, label) => this.splash?.setProgress(pct, label),
        true,
      );
      this.autosaveAccumSec = 0;
      void this.persistAutosaveQuietly();
      this.bus.emit('world:reset', { seed });
      this.refreshHudNow();
      this.lastFrameMs = performance.now();
      await this.splash?.dismiss(220);
    } finally {
      this.isRebuilding = false;
    }
  }

  private captureViewState(): SaveViewState {
    const cam = this.sceneManager.cameraController.getWorldViewState();
    return {
      simSpeed: this.simSpeed,
      cameraPosition: cam.position,
      cameraTarget: cam.target,
      cinematicDrift: cam.cinematicDrift,
      povCreatureId: this.povCreatureId,
      selection: this.selection ? { ...this.selection } : null,
      deityPanelOpen: this.hud.isDeityPanelOpen(),
      chroniclePanelOpen: this.hud.isChroniclePanelOpen(),
    };
  }

  private applyViewState(view: SaveViewState): void {
    this.simSpeed = view.simSpeed;
    this.hud.setActiveSpeed(view.simSpeed);
    this.sceneManager.cameraController.setWorldViewState({
      position: view.cameraPosition,
      target: view.cameraTarget,
      cinematicDrift: view.cinematicDrift,
    });
    this.hud.setCinematicActive(view.cinematicDrift);
    this.hud.setDeityPanelOpen(view.deityPanelOpen);
    this.hud.setChroniclePanelOpen(view.chroniclePanelOpen);

    if (view.povCreatureId) {
      const host = this.world.getCreature(view.povCreatureId);
      if (host && host.alive) {
        this.enterCreaturePov(host.id);
        return;
      }
    }

    if (view.selection) {
      const valid =
        (view.selection.kind === 'creature' && Boolean(this.world.getCreature(view.selection.id))) ||
        (view.selection.kind === 'settlement' && Boolean(this.world.getSettlement(view.selection.id)));
      if (valid) {
        this.selection = { ...view.selection };
        this.sceneManager.setSelection(this.selection);
      }
    }
  }

  private buildCurrentSaveRecord(slotId: string, name: string): SaveGameRecord {
    return buildSaveRecord({
      slotId,
      name,
      world: this.world,
      view: this.captureViewState(),
    });
  }

  async saveSlot(slotId: string, name: string): Promise<SaveSlotMeta> {
    const record = this.buildCurrentSaveRecord(slotId, name);
    await this.saveStore.save(record);
    return record.meta;
  }

  private async persistAutosaveQuietly(): Promise<void> {
    if (this.isRebuilding || this.autosaveInFlight || !this.saveStore.isAvailable()) return;
    this.autosaveInFlight = true;
    try {
      await this.saveSlot(DEFAULT_AUTOSAVE_SLOT_ID, 'Autosave');
    } catch {
      // Swallow background autosave errors so gameplay is never interrupted
    } finally {
      this.autosaveInFlight = false;
    }
  }

  async loadSlotAsync(slotId: string): Promise<boolean> {
    const record = await this.saveStore.load(slotId);
    if (!record) return false;
    return this.loadSaveRecordAsync(record);
  }

  async loadSaveRecordAsync(record: SaveGameRecord): Promise<boolean> {
    if (this.isRebuilding) return false;
    this.isRebuilding = true;
    try {
      this.splash?.show(`Restoring "${record.name}"…`);
      this.splash?.setProgress(12, `Reconstructing Day ${record.meta.day} terrain & villages…`);
      await nextPaintFrame();

      this.povCreatureId = null;
      this.selection = null;
      this.sceneManager.setPovCreatureId(null);
      this.sceneManager.setSelection(null);
      this.sceneManager.cameraController.exitCreaturePov(false);
      this.sceneManager.cameraController.follow(null);

      this.world = WorldState.fromSnapshot(this.bus, record.world);
      await this.sceneManager.rebuildWorldSceneAsync(
        this.world,
        (pct, label) => this.splash?.setProgress(pct, label),
        true,
      );
      if (record.view) {
        this.applyViewState(record.view);
      }
      this.autosaveAccumSec = 0;
      this.bus.emit('world:reset', { seed: this.world.config.seed });
      this.refreshHudNow();
      this.lastFrameMs = performance.now();
      await this.splash?.dismiss(220);
      void this.persistAutosaveQuietly();
      return true;
    } finally {
      this.isRebuilding = false;
    }
  }

  private async changeQualityAsync(preset: QualityPreset): Promise<void> {
    if (this.isRebuilding || preset === this.sceneManager.getQuality()) return;
    this.isRebuilding = true;
    try {
      this.splash?.show('Refining woodland craft & morning light…');
      this.splash?.setProgress(16, 'Recalibrating shadows, textures & optical lens…');
      await nextPaintFrame();

      await this.sceneManager.setQualityAsync(preset, (pct, label) =>
        this.splash?.setProgress(pct, label),
      );
      this.lastFrameMs = performance.now();
      await this.splash?.dismiss(200);
    } finally {
      this.isRebuilding = false;
    }
  }

  private refreshHudNow(): void {
    this.hud.update(
      0,
      this.world,
      this.selection,
      this.sceneManager.cameraController.isFollowing(),
      this.povCreatureId,
      true,
    );
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    document.removeEventListener('fullscreenchange', this.onFullscreenChangeBound);
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChangeBound);
    document.removeEventListener('visibilitychange', this.onVisibilityChangeBound);
    window.removeEventListener('pagehide', this.onPageHideBound);
    this.hud.dispose();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.sceneManager.dispose();
    this.bus.clear();
  }
}
