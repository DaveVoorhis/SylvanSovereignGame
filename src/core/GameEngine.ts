import type { QualityPreset } from './Config';
import { EventBus } from './EventBus';
import {
  buildSaveRecord,
  DEFAULT_AUTOSAVE_SLOT_ID,
  isQualityPreset,
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
import { computeStrideMetrics } from '@simulation/creatures/StrideKinematics';
import { WorldState } from '@simulation/WorldState';
import { HudManager } from '@ui/HudManager';
import { nextPaintFrame, type SplashScreen } from '@ui/SplashScreen';

const AUTOSAVE_INTERVAL_SEC = 25;
const QUALITY_STORAGE_KEY = 'sylvan-sovereign:qualityPreset';

function readStoredQualityPreset(): QualityPreset | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    return isQualityPreset(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredQualityPreset(preset: QualityPreset): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(QUALITY_STORAGE_KEY, preset);
  } catch {
    // Ignore storage quota / private browsing errors
  }
}

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
  private povBobPhase = 0;
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

    const initialQuality: QualityPreset = isQualityPreset(loadedAutosave?.view?.qualityPreset)
      ? loadedAutosave.view.qualityPreset
      : readStoredQualityPreset() ?? 'high';

    const engine = new GameEngine(canvas, hudRoot, {
      bus,
      world,
      saveStore,
      deferSceneBuild: true,
      splash: splash ?? null,
      initialQuality,
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
      initialQuality?: QualityPreset;
    },
  ) {
    this.bus = init?.bus ?? new EventBus();
    this.splash = init?.splash ?? null;
    this.saveStore = init?.saveStore ?? new SaveStore();
    this.world = init?.world ?? new WorldState(this.bus, { seed: resolveInitialSeed(), initialWaterwaySettlements: 1 });
    const initialQuality = init?.initialQuality ?? 'high';
    this.sceneManager = new SceneManager(canvas, this.world, initialQuality, init?.deferSceneBuild ?? false);

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
      onToggleFullscreen: () => {
        this.toggleFullscreen();
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
      onWhisper: (intent) => {
        const msg = this.world.deity.receiveSpectatorWhisper(intent, this.world);
        this.refreshHudNow();
        return msg;
      },
      onSetDeityStance: (stance) => {
        const msg = this.world.deity.setStance(stance, this.world);
        this.refreshHudNow();
        return msg;
      },
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
        const wasInPov = this.povCreatureId !== null;
        if (wasInPov) {
          this.exitCreaturePov(false);
        }
        if (!wasInPov && this.sceneManager.cameraController.isFollowing()) {
          this.sceneManager.cameraController.follow(null);
        } else {
          this.selection = { kind: 'creature', id: creatureId };
          this.sceneManager.setSelection(this.selection);
          const followProvider = () => {
            const live = this.world.getCreature(creatureId);
            return live && live.alive ? { x: live.x, y: live.y, z: live.z } : null;
          };
          if (wasInPov) {
            // Pull cleanly back behind & above the creature into third-person Follow mode
            const yaw = c.heading;
            const camX = c.x - Math.sin(yaw) * 7.5;
            const camZ = c.z - Math.cos(yaw) * 7.5;
            const terrainAtCam = this.world.terrain.getHeightAt(camX, camZ);
            const waterLevel = this.world.getEffectiveWaterLevel();
            const camY = Math.max(c.y + 3.6, terrainAtCam + 2.0, waterLevel + 1.8);
            this.sceneManager.cameraController.follow(followProvider, { x: camX, y: camY, z: camZ });
          } else {
            this.sceneManager.cameraController.follow(followProvider);
          }
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
    this.hud.setQualityPreset(initialQuality);
    this.hud.setFullscreenActive(this.isDocumentFullscreen());

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
      } else if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.toggleFullscreen();
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
      const isFs = this.isDocumentFullscreen();
      this.hud.setFullscreenActive(isFs);
      if (this.zenMode && this.enteredFullscreenForZen && !isFs) {
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

  isFullscreen(): boolean {
    return this.isDocumentFullscreen();
  }

  toggleFullscreen(): void {
    if (this.isDocumentFullscreen()) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }

  enterFullscreen(): boolean {
    if (this.isDocumentFullscreen()) return true;
    return this.requestDocumentFullscreen();
  }

  exitFullscreen(): void {
    if (!this.isDocumentFullscreen()) return;
    this.exitDocumentFullscreen();
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
      this.enteredFullscreenForZen = this.requestDocumentFullscreen(() => {
        this.enteredFullscreenForZen = false;
      });
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
      this.exitDocumentFullscreen();
    }
  }

  private requestDocumentFullscreen(onRejected?: () => void): boolean {
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const req = docEl.requestFullscreen ?? docEl.webkitRequestFullscreen;
    if (typeof req !== 'function') return false;
    try {
      const result = req.call(docEl);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          onRejected?.();
        });
      }
      return true;
    } catch {
      onRejected?.();
      return false;
    }
  }

  private exitDocumentFullscreen(): void {
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
    const exitFs = doc.exitFullscreen ?? doc.webkitExitFullscreen;
    if (typeof exitFs !== 'function') return;
    try {
      const res = exitFs.call(doc);
      if (res && typeof (res as Promise<void>).catch === 'function') {
        (res as Promise<void>).catch(() => {});
      }
    } catch {
      // Ignore fullscreen exit errors
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
    this.povBobPhase = 0;
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

    const waterLevel = this.world.getEffectiveWaterLevel();
    const move = c.activity === 'resting' ? 0 : c.moveIntensity;
    const pace = Math.max(0, Math.min(1, (c.gaitEffort - 0.32) / 0.96));
    const phase = this.povBobPhase;
    // Double-frequency smooth cosine step arc (two gentle footfalls per left+right stride cycle)
    const smoothStep = 0.5 - 0.5 * Math.cos(phase * 2);
    const lateralShift = Math.sin(phase);
    const isSwimmingInWater =
      Boolean(c.def.aquatic) &&
      this.world.terrain.getHeightAt(c.x, c.z) < waterLevel - 0.02;

    let bobOffset = 0;
    let swayOffset = 0;
    if (c.activity !== 'resting') {
      if (c.def.strictlyAquatic || isSwimmingInWater) {
        bobOffset = Math.sin(phase * 1.0) * 0.012 * (0.35 + 0.65 * move);
        swayOffset = lateralShift * 0.006 * move;
      } else if (c.def.locomotion === 'hop') {
        // Gentle hop rise scaled naturally from calm stroll hops to brisk bounding runs
        const smoothHop = 0.5 - 0.5 * Math.cos(phase);
        bobOffset = smoothHop * (0.042 + pace * 0.056) * move;
        swayOffset = lateralShift * 0.005 * move;
      } else if (c.def.locomotion === 'fly') {
        if (c.flightAltitude > 0.3) {
          bobOffset = Math.sin(phase * 1.0) * 0.03;
          swayOffset = Math.sin(phase * 0.5) * 0.008;
        } else {
          // Avian ground walking: crisp subtle step bob synced to feet
          bobOffset = smoothStep * (0.016 + pace * 0.026) * move;
          swayOffset = lateralShift * (0.006 + pace * 0.008) * move;
        }
      } else if (c.def.locomotion === 'slither') {
        bobOffset = Math.sin(phase * 1.0) * 0.008 * move;
        swayOffset = lateralShift * (0.008 + pace * 0.009) * move;
      } else {
        // Walking / strolling / running head-bob: gentle vertical step arc + subtle left-right weight shift
        bobOffset = smoothStep * (0.016 + pace * 0.036) * move;
        swayOffset = lateralShift * (0.008 + pace * 0.014) * move;
      }
    } else {
      bobOffset = c.def.strictlyAquatic ? -0.02 : -0.12;
    }

    let eyeHeight: number;
    if (c.def.strictlyAquatic) {
      // River Koi eyes sit inside the water column — keep Eye View cleanly submerged below effective waterLevel
      const groundY = this.world.terrain.getHeightAt(c.x, c.z);
      const desiredEyeY = Math.min(waterLevel - 0.24, c.y + 0.04 * c.getSizeScale());
      const safeEyeY = Math.max(groundY + 0.12, desiredEyeY);
      eyeHeight = safeEyeY - c.y;
    } else {
      const baseEyeY = c.y + Math.max(0.42, c.getSizeScale() * 1.04);
      // Keep non-fish surface swimmers/waders cleanly above the waterline so underwater fog never flickers
      const minClearY = waterLevel + 0.18 - Math.min(0, bobOffset);
      const safeEyeY = c.y < waterLevel + 0.25 ? Math.max(baseEyeY, minClearY) : baseEyeY;
      eyeHeight = safeEyeY - c.y;
    }

    return {
      x: c.x,
      y: c.y,
      z: c.z,
      heading: c.heading,
      eyeHeight,
      bobOffset,
      swayOffset,
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
        } else if (this.simSpeed > 0) {
          // Advance POV step phase in sync with the host creature's physical stride cycle
          // (gently capped at high sim speeds for comfortable first-person viewing)
          const simScale = 1 + Math.min(0.45, (Math.sqrt(Math.max(1, this.simSpeed)) - 1) * 0.35);
          const isAirborne = host.def.locomotion === 'fly' && host.flightAltitude > 0.3;
          let omega = 0;
          if (host.activity !== 'resting') {
            if (isAirborne) {
              omega = 3.6;
            } else if (host.def.strictlyAquatic) {
              omega = (1.8 + host.moveIntensity * 2.2);
            } else {
              const metrics = computeStrideMetrics(
                host.def.locomotion,
                host.gaitEffort,
                host.getSizeScale(),
              );
              const rawStrideOmega = (host.currentSpeed / metrics.cycleLengthWorld) * Math.PI * 2;
              omega = Math.min(18, rawStrideOmega);
            }
          }
          this.povBobPhase += realDt * omega * simScale;
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
      this.bus.emit('world:reset', { seed });
      this.refreshHudNow();
      this.lastFrameMs = performance.now();
      await this.persistAutosaveQuietly(true);
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
      qualityPreset: this.sceneManager.getQuality(),
    };
  }

  private applyViewState(view: SaveViewState): void {
    this.simSpeed = view.simSpeed;
    this.hud.setActiveSpeed(view.simSpeed);
    if (isQualityPreset(view.qualityPreset)) {
      this.hud.setQualityPreset(view.qualityPreset);
    }
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

  private async persistAutosaveQuietly(allowDuringRebuild = false): Promise<void> {
    if ((!allowDuringRebuild && this.isRebuilding) || this.autosaveInFlight || !this.saveStore.isAvailable()) {
      return;
    }
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
      const savedQuality = isQualityPreset(record.view?.qualityPreset)
        ? record.view.qualityPreset
        : undefined;
      await this.sceneManager.rebuildWorldSceneAsync(
        this.world,
        (pct, label) => this.splash?.setProgress(pct, label),
        true,
        savedQuality,
      );
      if (savedQuality) {
        this.hud.setQualityPreset(savedQuality);
        writeStoredQualityPreset(savedQuality);
      }
      if (record.view) {
        this.applyViewState(record.view);
      }
      this.autosaveAccumSec = 0;
      this.bus.emit('world:reset', { seed: this.world.config.seed });
      this.refreshHudNow();
      this.lastFrameMs = performance.now();
      await this.persistAutosaveQuietly(true);
      await this.splash?.dismiss(220);
      return true;
    } finally {
      this.isRebuilding = false;
    }
  }

  private async changeQualityAsync(preset: QualityPreset): Promise<void> {
    if (this.isRebuilding || preset === this.sceneManager.getQuality()) return;
    this.isRebuilding = true;
    writeStoredQualityPreset(preset);
    try {
      this.splash?.show('Refining woodland craft & morning light…');
      this.splash?.setProgress(16, 'Recalibrating shadows, textures & optical lens…');
      await nextPaintFrame();

      await this.sceneManager.setQualityAsync(preset, (pct, label) =>
        this.splash?.setProgress(pct, label),
      );
      this.hud.setQualityPreset(preset);
      await this.persistAutosaveQuietly(true);
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
