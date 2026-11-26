# Architecture Guide — Sylvan Sovereign

## Layered Separation of Concerns

The codebase is intentionally split into four cleanly bounded layers under `src/` so new species, buildings, biome adaptations, divine behaviors, and photorealistic 3D assets can be iterated independently:

1. **`src/core/`** — Shared immutable contracts (`Types.ts`), deterministic randomness (`SeededRandom.ts`), centralized world parameters & graphics presets (`Config.ts`), decoupled pub/sub (`EventBus.ts`), and the frame/tick coordinator (`GameEngine.ts`).
2. **`src/simulation/`** — **100% headless TypeScript** with zero Three.js or DOM imports. Because it is completely decoupled from rendering, it can be unit-tested via Vitest, fast-forwarded deterministically, or moved into a Web Worker as world sizes scale further.
   - `terrain/`:
     - `Noise.ts`: Seeded 2D gradient FBM and ridged noise primitives.
     - `TerrainMap.ts`: Country-scale (`1120 m × 1120 m`) terrain with natural impassable bounds (craggy alpine cordillera in back with settleable foothill slopes, open ocean sea in front with settleable sandy shores), amorphous interior regions of verdant forest, flat treeless prairie, and arid sandy desert placed in the driest inland basins farthest from both the sea and rivers, fertile inland lakes, and a **curvature-integrated meandering dendritic river watershed** (Order-1 streams → Order-2 primary tributaries → widening main trunk emptying continuously through the beach into the sea) accelerated by an O(1) `32 m` spatial hash grid.
     - `Bridge.ts`: Autonomous bridge planning and arched deck elevation queries across river narrows and tributaries.
     - `ObstacleMap.ts`: Spatial obstacle field keeping creatures clear of buildings, tree trunks, rocks, and settlement hearth fires.
   - `deity/`: `ProceduralGod` holds an evolving 5-axis psyche (`benevolence`, `wrath`, `chaos`, `verdancy`, `curiosity`), derives a mythic `Aspect`, responds to prayers, whispers, and wars, and autonomously triggers events from `DivineEvents.ts`.
   - `creatures/`: `SpeciesCatalog.ts` defines all 12 anthropomorphic species; `Creature.ts` tracks personality, lineage, pairing, and life stages (`young → adult`); `CreatureAI.ts` runs utility-driven behaviors (foraging, 5-stage construction with stage tools, bridge building/crossing, pioneer emigration, pairing and raising litters, caravan trading, tavern/square socialising, shrine prayer, skirmish combat, fleeing, resting).
   - `settlements/`: Starts from a single founding village and expands via emigrating pioneers up to 16 settlements (`Hamlet → Village → Town → City`). `BuildingCatalog.ts` defines 14 building types with footprints and frame styles; `VillageAdaptation.ts` maps biomes to 6 regional adaptations (`forest_canopy`, `coastal_harbor`, `desert_oasis`, `prairie_pastoral`, `mountain_stone`, `riverside_stilts`); `SettlementManager.ts` orchestrates construction queues, plot reclamation/disassembly, and demographic growth.
   - `society/`: Inter-settlement diplomacy (`allied`, `friendly`, `neutral`, `tense`, `war`), caravan economy, and the living `Chronicle`.
3. **`src/rendering/`** — **Three.js WebGL2 PBR Presentation Layer** (bundled cleanly to a single self-contained HTML artifact via `vite-plugin-singlefile` on `npm run build`).
   - `SceneManager.ts`, `AtmosphereSystem.ts`, `DistanceFocusBlurPass.ts`: ACES Filmic tone mapping, high-DPI rendering, `PCFSoftShadowMap`, `PMREMGenerator` environment lighting from a custom GLSL atmospheric sky shader, sky-reaching supernatural deity beams with translucent cathedral stained-glass rose-window light projections, polychromatic shockwave crests, rising clerestory aurora curtains, prismatic counter-rotating armillary halos, GPU ascending jewel-tinted stardust motes, and local illumination, plus subtle `UnrealBloomPass` and distance focus blur post-processing.
   - `TerrainRenderer.ts` & `WaterShader.ts`: Vertex-colored multi-biome terrain mesh and terrain-aware custom GLSL water shader with flow-aligned ripples, depth tinting, and shoreline blending extending smoothly to the horizon.
   - `ProceduralTextures.ts` & `GeometryHelpers.ts`: Synthesized seamless PBR albedo, bump, and roughness maps plus reusable procedural geometry helpers with zero external asset dependency.
   - `FloraRenderer.ts`: Instanced dense lush forest canopies, wind-swayed prairie grass blades, desert cacti/boulders, and alpine pines/crags.
   - `SettlementRenderer.ts` & `FireEffect.ts`: 14 storybook building models with 5-stage construction kits (clearing stakes, leveled pads, foundations, timber/masonry framing, scaffolding), regional adaptation structures (stilts, granite retaining terraces, sun-shade awnings, planters), creature-built arched bridges, carved two-tier stone plaza fountains (parabolic `TubeGeometry` arcing jets, surface ripples, and GPU ballistic droplet spray), and volumetric blackbody hearth fires with sparks and smoke plumes.
   - `CreatureRenderer.ts`: Articulated high-resolution rigs for all 12 species and 6 roles, live biome-adapted attire, animated construction stage tools, and smooth youthful-to-adult growth scaling.
   - `CameraController.ts`: Smooth world orbit, country-wide Overview zoom, gentle Drift mode, and interactive first-person Creature Eye View.
4. **`src/ui/`** — Lightweight modular DOM components (`TopBar`, `DeityPanel`, `ChroniclePanel`, `InspectorPanel`, `CreaturePovBar`) coordinated with throttled refreshes and full-screen Zen Mode via `HudManager`.

## Automated Verification (`tests/`)

- **`tests/simulation.test.ts`**: Verifies deterministic seed generation, infinite-horizon continuity, autonomous city growth, obstacle & hearth avoidance, crowd separation, daylight/weather cadence, arched bridge planning & crossing, 5-stage construction & disassembly, pioneer emigration, 6 regional village adaptations, continuous coastal river mouth carving, full generational creature lifecycle, natural mountain/sea world bounds, and meandering dendritic river watershed geometry/flow.
- **`tests/rendering.test.ts`**: Validates procedural flora/environment meshes, terrain-aware water surfaces, all 14 building models, all 12 articulated species rigs & 6 roles, 5-stage construction kit lifecycle, all 6 village adaptations, supernatural deity beam geometry, youthful-to-adult creature scaling, parabolic water fountains with droplet spray, and z-fighting-free cylindrical cottage steps.

## Extending Toward Photogrammetry & Rigged GLTF Assets

Because rendering is decoupled from simulation state:
- **Trees / Rocks / Architecture**: Replace procedural geometries in `FloraRenderer.ts` or `SettlementRenderer.ts` with `GLTFLoader` meshes (`.glb` + Draco/KTX2 compressed 2K/4K PBR maps) while keeping the exact same `TerrainMap` / `Settlement` data contracts.
- **Rigged Anthropomorphic Creatures**: Swap `CreatureRenderer.buildRig()` with skinned `.glb` models driven by `THREE.AnimationMixer` mapped to `creature.activity` and `creature.def.locomotion`.
- **HDRI Skyboxes**: Load `.exr` / `.hdr` equirectangular environment maps via `RGBELoader` in `AtmosphereSystem.ts` for studio-grade photorealistic image-based lighting.
