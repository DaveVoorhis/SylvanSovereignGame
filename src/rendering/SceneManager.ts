import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { QUALITY_PRESETS, type QualityPreset } from '@core/Config';
import type { SelectionTarget } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import { nextPaintFrame, type LoadProgressCallback } from '@ui/SplashScreen';
import { AmbientCritterRenderer } from './AmbientCritterRenderer';
import { AtmosphereSystem } from './AtmosphereSystem';
import { CameraController } from './CameraController';
import { CreatureRenderer } from './CreatureRenderer';
import { DistanceFocusBlurPass } from './DistanceFocusBlurPass';
import { FloraRenderer } from './FloraRenderer';
import { createTextureLibrary, type TextureLibrary } from './ProceduralTextures';
import { SettlementRenderer } from './SettlementRenderer';
import { TerrainRenderer } from './TerrainRenderer';

/**
 * Renders supernatural divine beam columns, shockwave rings, halos, and stardust AFTER
 * DistanceFocusBlurPass (so far-horizon mist behind a foreground beam never erases it)
 * while sampling the untouched scene depth buffer for exact mountain/building occlusion.
 */
class DivineOverlayPass extends Pass {
  constructor(
    private readonly getAtmosphere: () => AtmosphereSystem | undefined,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const atmosphere = this.getAtmosphere();
    if (!atmosphere) return;
    const hasBeams = atmosphere.syncDivineDepthUniforms(
      writeBuffer.depthTexture ?? null,
      readBuffer.width,
      readBuffer.height,
    );
    if (!hasBeams) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(atmosphere.divineOverlayScene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}

/**
 * Orchestrates the naturalistic photographic Three.js WebGL2 pipeline:
 * AgX filmic tone mapping, camera-adaptive PCF soft shadows, depth-reconstructed
 * contact AO + valley mist + Mie in-scattering + optical DOF, subtle HDR bloom,
 * procedural PBR + normal-mapped textures, raycast inspection, and sub-renderers.
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
  private ambientCritterRenderer!: AmbientCritterRenderer;
  private loadedTextureResolution = 0;
  private povUnderwaterNear = false;
  private readonly dofParamsScratch: {
    focusDistance: number;
    focusRange: number;
    maxBlur: number;
    horizonFadeStart: number;
    horizonFadeEnd: number;
    worldHorizonStart: number;
    worldHorizonEnd: number;
    horizonColor: THREE.Color;
    isPov: boolean;
    sunDirection: THREE.Vector3;
    sunColor: THREE.Color;
    daylight: number;
    waterLevel: number;
    fogDensity: number;
    aoStrength: number;
    mistStrength: number;
  } = {
    focusDistance: 30,
    focusRange: 42,
    maxBlur: 0.0018,
    horizonFadeStart: 2400,
    horizonFadeEnd: 5800,
    worldHorizonStart: 6000,
    worldHorizonEnd: 7000,
    horizonColor: new THREE.Color(),
    isPov: false,
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    daylight: 1,
    waterLevel: 0,
    fogDensity: 0.00058,
    aoStrength: 0.88,
    mistStrength: 0.34,
  };

  private quality: QualityPreset = 'high';
  private selection: SelectionTarget = null;
  private povCreatureId: string | null = null;
  private pointerDownPos = new THREE.Vector2();
  private readonly focusTargetScratch = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly unsubscribes: (() => void)[] = [];

  private readonly onResizeBound: () => void;
  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerUpBound: (e: PointerEvent) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private world: WorldState,
    initialQuality: QualityPreset = 'high',
    deferBuild = false,
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
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.22,
      16000,
    );
    this.cameraController = new CameraController(this.camera, canvas);

    this.setupPostProcessing();
    if (!deferBuild) {
      this.buildWorldScene(world);
      this.focusFoundingVillage(world, true);
    }

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

  async setQualityAsync(preset: QualityPreset, onProgress?: LoadProgressCallback): Promise<void> {
    if (preset === this.quality) return;
    this.quality = preset;
    const q = QUALITY_PRESETS[preset];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
    this.setupPostProcessing();
    await this.rebuildWorldSceneAsync(this.world, onProgress, true);
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
    this.disposeWorldScene(true);
    this.world = newWorld;
    this.buildWorldScene(newWorld);
    this.focusFoundingVillage(newWorld, false);
  }

  async rebuildWorldSceneAsync(
    newWorld: WorldState,
    onProgress?: LoadProgressCallback,
    immediateFocus = false,
    nextQuality?: QualityPreset,
  ): Promise<void> {
    this.povCreatureId = null;
    this.disposeWorldScene(true);
    if (nextQuality && nextQuality !== this.quality) {
      this.quality = nextQuality;
      const q = QUALITY_PRESETS[nextQuality];
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
      this.setupPostProcessing();
    }
    this.world = newWorld;
    await this.buildWorldSceneAsync(newWorld, onProgress, immediateFocus);
  }

  async buildWorldSceneAsync(
    world: WorldState,
    onProgress?: LoadProgressCallback,
    immediateFocus = true,
  ): Promise<void> {
    const q = QUALITY_PRESETS[this.quality];
    this.cameraController.setWorldSize(world.config.worldSize);

    if (!this.textures || this.loadedTextureResolution !== q.textureResolution) {
      this.textures?.dispose();
      onProgress?.(30, 'Mixing moss, granite, bark & timber pigments…');
      await nextPaintFrame();
      this.textures = createTextureLibrary(q.textureResolution);
      this.loadedTextureResolution = q.textureResolution;
    } else {
      onProgress?.(36, 'Reusing handcrafted forest pigments…');
    }

    onProgress?.(44, 'Raising the sky dome & brewing drifting clouds…');
    await nextPaintFrame();
    this.atmosphere = new AtmosphereSystem(
      this.scene,
      this.renderer,
      q.shadowMapSize,
      this.textures.softParticle,
    );

    onProgress?.(60, 'Pouring the rivers & rolling the endless sea…');
    await nextPaintFrame();
    this.terrainRenderer = new TerrainRenderer(this.scene, world, this.textures);

    onProgress?.(76, 'Growing every pine, bough & blade of grass uniquely…');
    await nextPaintFrame();
    this.floraRenderer = new FloraRenderer(this.scene, world, this.textures, q.grassMultiplier);

    onProgress?.(86, 'Thatching cottages & lighting the founding hearth…');
    await nextPaintFrame();
    this.settlementRenderer = new SettlementRenderer(this.scene, world, this.textures);

    onProgress?.(92, 'Tailoring cloaks for foxes, beavers, otters & river koi…');
    await nextPaintFrame();
    this.creatureRenderer = new CreatureRenderer(this.scene, world, this.textures);
    this.ambientCritterRenderer = new AmbientCritterRenderer(this.scene, world, q.grassMultiplier);

    this.bindWorldEvents(world);
    this.focusFoundingVillage(world, immediateFocus);

    onProgress?.(98, 'Opening the canopy to morning light…');
    await nextPaintFrame();
    // Pre-compile all runtime PBR & divine shaders and paint the first live frame behind the splash
    this.prewarmRuntimeShaders();
    this.renderFrame(0.016);

    onProgress?.(100, 'The realm awaits.');
  }

  /**
   * Pre-compiles distinct architectural, species, and divine shader permutations once behind
   * the loading splash so pioneering new biomes, species, or miracles never causes mid-game hitches.
   */
  private prewarmRuntimeShaders(): void {
    if (!this.settlementRenderer || !this.creatureRenderer || !this.atmosphere) return;
    const warmupGroup = new THREE.Group();
    const proxyGeo = new THREE.PlaneGeometry(0.01, 0.01);
    const seen = new Set<THREE.Material>();
    const allMats = [
      ...this.settlementRenderer.getWarmupMaterials(),
      ...this.creatureRenderer.getWarmupMaterials(),
      ...(this.ambientCritterRenderer?.getWarmupMaterials() ?? []),
    ];
    for (const mat of allMats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      const proxy = new THREE.Mesh(proxyGeo, mat);
      proxy.frustumCulled = false;
      warmupGroup.add(proxy);
    }
    this.scene.add(warmupGroup);
    try {
      this.renderer.compile(this.scene, this.camera);
      this.atmosphere.prewarmDivineShaders(this.renderer, this.camera);
    } finally {
      this.scene.remove(warmupGroup);
      proxyGeo.dispose();
    }
  }

  private focusFoundingVillage(world: WorldState, immediate: boolean): void {
    const founding = world.settlements[0];
    if (!founding) {
      this.cameraController.resetOverview();
      return;
    }
    if (immediate) {
      this.cameraController.controls.target.set(founding.center.x, founding.groundY + 1.6, founding.center.z);
      this.camera.position.set(founding.center.x + 14, founding.groundY + 18, founding.center.z + 30);
      this.cameraController.controls.update();
    } else {
      this.cameraController.flyTo(founding.center, founding.groundY + 1.6, 34);
    }
  }

  renderFrame(dt: number): void {
    if (!this.atmosphere || !this.terrainRenderer || !this.floraRenderer || !this.settlementRenderer || !this.creatureRenderer) {
      return;
    }
    this.cameraController.update(dt);
    const focusTarget = this.cameraController.getFocusTarget(this.focusTargetScratch);
    this.atmosphere.update(this.world, dt, this.camera, focusTarget);
    const sky = this.atmosphere.getSkyLightingState();
    this.terrainRenderer.update(dt, sky);
    this.floraRenderer.update(dt, sky);
    this.settlementRenderer.update(dt, sky, focusTarget);
    this.creatureRenderer.update(dt, this.selection, this.povCreatureId);
    this.ambientCritterRenderer?.update(dt, sky);

    if (this.dofPass) {
      const isPov = this.cameraController.isInCreaturePov();
      const focusDistance = this.cameraController.getFocusDistance();
      // Adapt camera near plane with zoom distance so zoomed-out overviews get ~25x better depth precision
      const effectiveWaterLevel = this.world.getEffectiveWaterLevel();
      if (!isPov) {
        this.povUnderwaterNear = false;
      } else if (this.povUnderwaterNear) {
        if (this.camera.position.y > effectiveWaterLevel + 0.02) {
          this.povUnderwaterNear = false;
        }
      } else if (this.camera.position.y < effectiveWaterLevel - 0.06) {
        this.povUnderwaterNear = true;
      }
      const targetNear = this.povUnderwaterNear
        ? 0.12
        : isPov
          ? 0.22
          : THREE.MathUtils.clamp(focusDistance * 0.012, 0.22, 6.0);
      if (Math.abs(this.camera.near - targetNear) > 0.02) {
        this.camera.near = targetNear;
        this.camera.updateProjectionMatrix();
      }

      const overviewFactor = isPov ? 0 : THREE.MathUtils.smoothstep(focusDistance, 160, 560);
      const mistStrength =
        this.world.weather === 'mist'
          ? 0.92
          : this.world.weather === 'rain' || this.world.weather === 'storm'
            ? 0.62
            : 0.34 + (1 - sky.daylight) * 0.22;
      const worldExtent = this.world.config.worldSize * 6.5;
      const horizonFadeStart = isPov ? 420 : Math.max(2400, focusDistance * 3.0);
      const horizonFadeEnd = isPov
        ? 1350
        : Math.max(horizonFadeStart + 2000, Math.min(worldExtent * 0.92, Math.max(5800, focusDistance * 5.8)));
      const p = this.dofParamsScratch;
      p.focusDistance = focusDistance;
      p.focusRange = isPov ? 26 : Math.max(42, focusDistance * (0.95 + overviewFactor * 1.1));
      p.maxBlur = isPov ? 0.0058 : 0.0018 * (1 - overviewFactor * 0.92);
      p.horizonFadeStart = horizonFadeStart;
      p.horizonFadeEnd = horizonFadeEnd;
      p.worldHorizonStart = worldExtent * 0.86;
      p.worldHorizonEnd = worldExtent * 0.97;
      p.horizonColor = sky.fogColor;
      p.isPov = isPov;
      p.sunDirection = sky.sunDirection;
      p.sunColor = sky.sunColor;
      p.daylight = sky.daylight;
      p.waterLevel = effectiveWaterLevel;
      p.fogDensity = sky.fogDensity;
      p.aoStrength = this.quality === 'balanced' ? 0.65 : 0.88;
      p.mistStrength = mistStrength * (1 - overviewFactor * 0.65);
      this.dofPass.updateParams(p);
    }

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
      const hasBeams = this.atmosphere.syncDivineDepthUniforms(null, window.innerWidth, window.innerHeight);
      if (hasBeams) {
        const prevAutoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.render(this.atmosphere.divineOverlayScene, this.camera);
        this.renderer.autoClear = prevAutoClear;
      }
    }
  }

  private buildWorldScene(world: WorldState): void {
    const q = QUALITY_PRESETS[this.quality];
    this.cameraController.setWorldSize(world.config.worldSize);
    if (!this.textures || this.loadedTextureResolution !== q.textureResolution) {
      this.textures?.dispose();
      this.textures = createTextureLibrary(q.textureResolution);
      this.loadedTextureResolution = q.textureResolution;
    }
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
    this.ambientCritterRenderer = new AmbientCritterRenderer(this.scene, world, q.grassMultiplier);
    this.bindWorldEvents(world);
  }

  private bindWorldEvents(world: WorldState): void {
    this.unsubscribes.push(
      world.bus.on('divine:effect', (fx) => {
        const gy = world.terrain.getHeightAt(fx.position.x, fx.position.z);
        this.atmosphere.spawnDivineVisual(fx, Math.max(gy, world.getEffectiveWaterLevel()));
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
    composer.addPass(new DivineOverlayPass(() => this.atmosphere, this.camera));

    let bloom: UnrealBloomPass | null = null;
    if (q.enableBloom) {
      // Restrained physical HDR bloom so only bright glints, flames, fireflies, and beams glow
      bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.14,
        0.45,
        1.05,
      );
      composer.addPass(bloom);
    }

    composer.addPass(new OutputPass());

    this.composer = composer;
    this.dofPass = dof;
    this.bloomPass = bloom;
  }

  private handleClickPick(event: PointerEvent): void {
    if (!this.creatureRenderer || !this.settlementRenderer) return;
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

  private disposeWorldScene(preserveTextures = false): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes.length = 0;

    this.atmosphere?.dispose();
    this.terrainRenderer?.dispose();
    this.floraRenderer?.dispose();
    this.settlementRenderer?.dispose();
    this.creatureRenderer?.dispose();
    this.ambientCritterRenderer?.dispose();
    if (!preserveTextures) {
      this.textures?.dispose();
      this.loadedTextureResolution = 0;
    }

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
