import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { QUALITY_PRESETS, type QualityPreset } from '@core/Config';
import type { SelectionTarget } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import { AtmosphereSystem } from './AtmosphereSystem';
import { CameraController } from './CameraController';
import { CreatureRenderer } from './CreatureRenderer';
import { DistanceFocusBlurPass } from './DistanceFocusBlurPass';
import { FloraRenderer } from './FloraRenderer';
import { createTextureLibrary, type TextureLibrary } from './ProceduralTextures';
import { SettlementRenderer } from './SettlementRenderer';
import { TerrainRenderer } from './TerrainRenderer';

/**
 * Orchestrates the high-resolution storybook Three.js WebGL2 pipeline:
 * ACES Filmic tone mapping, PCF soft shadows, hardware-depth Distance Focus Blur
 * with infinite-horizon fade, optional subtle UnrealBloomPass, procedural PBR textures,
 * raycast entity inspection, and sub-renderers.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraController: CameraController;

  private composer: EffectComposer | null = null;
  private dofPass: DistanceFocusBlurPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private textures!: TextureLibrary;
  private atmosphere!: AtmosphereSystem;
  private terrainRenderer!: TerrainRenderer;
  private floraRenderer!: FloraRenderer;
  private settlementRenderer!: SettlementRenderer;
  private creatureRenderer!: CreatureRenderer;

  private quality: QualityPreset = 'high';
  private selection: SelectionTarget = null;
  private povCreatureId: string | null = null;
  private pointerDownPos = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly unsubscribes: (() => void)[] = [];

  private readonly onResizeBound: () => void;
  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerUpBound: (e: PointerEvent) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private world: WorldState,
    initialQuality: QualityPreset = 'high',
  ) {
    this.quality = initialQuality;
    const q = QUALITY_PRESETS[initialQuality];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.22,
      1650,
    );
    this.cameraController = new CameraController(this.camera, canvas);

    this.setupPostProcessing();
    this.buildWorldScene(world);
    this.focusFoundingVillage(world, true);

    this.onResizeBound = () => this.handleResize();
    this.onPointerDownBound = (e: PointerEvent) => {
      this.pointerDownPos.set(e.clientX, e.clientY);
    };
    this.onPointerUpBound = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 6) {
        return; // drag, not click
      }
      this.handleClickPick(e);
    };

    window.addEventListener('resize', this.onResizeBound);
    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    canvas.addEventListener('pointerup', this.onPointerUpBound);
  }

  getQuality(): QualityPreset {
    return this.quality;
  }

  setQuality(preset: QualityPreset): void {
    if (preset === this.quality) return;
    this.quality = preset;
    const q = QUALITY_PRESETS[preset];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
    this.rebuildWorldScene(this.world);
    this.setupPostProcessing();
  }

  setSelection(target: SelectionTarget): void {
    this.selection = target;
  }

  setPovCreatureId(creatureId: string | null): void {
    this.povCreatureId = creatureId;
  }

  /** Synchronizes renderer, camera aspect, and post-processing targets with current viewport dimensions. */
  resize(): void {
    this.handleResize();
  }

  rebuildWorldScene(newWorld: WorldState): void {
    this.povCreatureId = null;
    this.disposeWorldScene();
    this.world = newWorld;
    this.buildWorldScene(newWorld);
    this.focusFoundingVillage(newWorld, false);
  }

  private focusFoundingVillage(world: WorldState, immediate: boolean): void {
    const founding = world.settlements[0];
    if (!founding) {
      this.cameraController.resetOverview();
      return;
    }
    if (immediate) {
      this.cameraController.controls.target.set(founding.center.x, founding.groundY + 1.6, founding.center.z);
      this.camera.position.set(founding.center.x + 22, founding.groundY + 18, founding.center.z + 26);
      this.cameraController.controls.update();
    } else {
      this.cameraController.flyTo(founding.center, founding.groundY + 1.6, 34);
    }
  }

  renderFrame(dt: number): void {
    this.cameraController.update(dt);
    this.atmosphere.update(this.world, dt, this.camera, this.cameraController.controls.target);
    const sky = this.atmosphere.getSkyLightingState();
    this.terrainRenderer.update(dt, sky);
    this.floraRenderer.update(dt, sky);
    this.settlementRenderer.update(dt);
    this.creatureRenderer.update(dt, this.selection, this.povCreatureId);

    if (this.dofPass) {
      const isPov = this.cameraController.isInCreaturePov();
      const focusDistance = this.cameraController.getFocusDistance();
      this.dofPass.updateParams({
        focusDistance,
        focusRange: isPov ? 28 : Math.max(30, focusDistance * 0.72),
        maxBlur: isPov ? 0.011 : 0.0125,
        horizonFadeStart: isPov ? 220 : 340,
        horizonFadeEnd: isPov ? 520 : 760,
        horizonColor: sky.fogColor,
        isPov,
      });
    }

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private buildWorldScene(world: WorldState): void {
    const q = QUALITY_PRESETS[this.quality];
    this.cameraController.setWorldSize(world.config.worldSize);
    this.textures = createTextureLibrary(q.textureResolution);
    this.atmosphere = new AtmosphereSystem(
      this.scene,
      this.renderer,
      q.shadowMapSize,
      this.textures.softParticle,
    );
    this.terrainRenderer = new TerrainRenderer(this.scene, world, this.textures);
    this.floraRenderer = new FloraRenderer(this.scene, world, this.textures, q.grassMultiplier);
    this.settlementRenderer = new SettlementRenderer(this.scene, world, this.textures);
    this.creatureRenderer = new CreatureRenderer(this.scene, world, this.textures);

    this.unsubscribes.push(
      world.bus.on('divine:effect', (fx) => {
        const gy = world.terrain.getHeightAt(fx.position.x, fx.position.z);
        this.atmosphere.spawnDivineVisual(fx, Math.max(gy, world.terrain.waterLevel));
      }),
      world.bus.on('combat:spark', (sp) => {
        this.creatureRenderer.spawnCombatSpark(sp);
      }),
    );
  }

  private setupPostProcessing(): void {
    this.dofPass?.dispose();
    this.composer?.dispose();
    const q = QUALITY_PRESETS[this.quality];

    const pixelRatio = this.renderer.getPixelRatio();
    const rtWidth = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
    const rtHeight = Math.max(1, Math.floor(window.innerHeight * pixelRatio));

    const createDepthRenderTarget = () => {
      const depthTexture = new THREE.DepthTexture(rtWidth, rtHeight, THREE.UnsignedIntType);
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      return new THREE.WebGLRenderTarget(rtWidth, rtHeight, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        depthTexture,
      });
    };

    const rt1 = createDepthRenderTarget();
    const composer = new EffectComposer(this.renderer, rt1);
    // Ensure renderTarget2 also has its own independent DepthTexture after buffer swaps
    composer.renderTarget2.dispose();
    composer.renderTarget2 = createDepthRenderTarget();
    composer.readBuffer = composer.renderTarget2;
    composer.writeBuffer = composer.renderTarget1;
    composer.setPixelRatio(pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight);

    composer.addPass(new RenderPass(this.scene, this.camera));

    const dof = new DistanceFocusBlurPass(this.camera, q.dofTaps);
    composer.addPass(dof);

    let bloom: UnrealBloomPass | null = null;
    if (q.enableBloom) {
      bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.28,
        0.65,
        0.9,
      );
      composer.addPass(bloom);
    }

    composer.addPass(new OutputPass());

    this.composer = composer;
    this.dofPass = dof;
    this.bloomPass = bloom;
  }

  private handleClickPick(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      [this.creatureRenderer.rootGroup, this.settlementRenderer.rootGroup],
      true,
    );

    let picked: SelectionTarget = null;
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData.selectionTarget) {
          picked = obj.userData.selectionTarget as SelectionTarget;
          break;
        }
        obj = obj.parent;
      }
      if (picked) break;
    }

    this.selection = picked;
    this.world.bus.emit('selection:changed', picked);
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.dofPass?.setSize(w, h);
    this.bloomPass?.setSize(w, h);
  }

  private disposeWorldScene(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes.length = 0;

    this.atmosphere?.dispose();
    this.terrainRenderer?.dispose();
    this.floraRenderer?.dispose();
    this.settlementRenderer?.dispose();
    this.creatureRenderer?.dispose();
    this.textures?.dispose();

    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResizeBound);
    this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
    this.canvas.removeEventListener('pointerup', this.onPointerUpBound);
    this.disposeWorldScene();
    this.dofPass?.dispose();
    this.composer?.dispose();
    this.cameraController.dispose();
    this.renderer.dispose();
  }
}
