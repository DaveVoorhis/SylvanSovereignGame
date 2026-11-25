# Architecture Guide — Sylvan Sovereign

## Layered Separation of Concerns

The codebase is intentionally split into four cleanly bounded layers under `src/` so new species, buildings, divine behaviors, and photorealistic 3D assets can be iterated independently:

1. **`src/core/`** — Shared immutable contracts (`Types.ts`), deterministic randomness (`SeededRandom.ts`), centralized configuration & graphics presets (`Config.ts`), decoupled pub/sub (`EventBus.ts`), and the frame/tick coordinator (`GameEngine.ts`).
2. **`src/simulation/`** — **100% headless TypeScript** with zero Three.js or DOM imports. Because it is completely decoupled from rendering, it can be unit-tested via Vitest, fast-forwarded deterministically, or moved into a Web Worker later as world sizes scale up.
   - `terrain/`: Gradient FBM noise, meandering stream/pond carving, biomes, ecological resource regeneration.
   - `deity/`: `ProceduralGod` holds an evolving 5-axis psyche (`benevolence`, `wrath`, `chaos`, `verdancy`, `curiosity`), derives a mythic `Aspect`, responds to prayers & wars, and autonomously triggers events from `DivineEvents.ts`.
   - `creatures/`: `SpeciesCatalog.ts` defines all 12 anthropomorphic species; `CreatureAI.ts` runs utility-driven behaviors (foraging, construction, caravan trading, tavern/square socialising, shrine prayer, skirmish combat, fleeing, resting).
   - `settlements/`: Organic village-to-city growth (`Hamlet → Village → Town → City`), construction queues, housing, workshops, and demographic growth.
   - `society/`: Inter-settlement diplomacy (`allied`, `friendly`, `neutral`, `tense`, `war`), caravan economy, and the living `Chronicle`.
3. **`src/rendering/`** — **Three.js WebGL2 PBR Presentation Layer**.
   - ACES Filmic tone mapping, high-DPI rendering, `PCFSoftShadowMap`, `PMREMGenerator` environment probe derived from a custom GLSL atmospheric sky shader, and subtle `UnrealBloomPass` for lanterns, fireflies, and divine beams.
   - `ProceduralTextures.ts` synthesizes seamless PBR albedo, bump, and roughness maps out of the box with zero external asset dependency.
   - Instanced rendering (`FloraRenderer.ts`) keeps dense forests running smoothly.
4. **`src/ui/`** — Lightweight modular DOM components (`TopBar`, `DeityPanel`, `ChroniclePanel`, `InspectorPanel`) coordinated with throttled refreshes via `HudManager`.

## Extending Toward Photogrammetry & Rigged GLTF Assets

Because rendering is decoupled from simulation state:
- **Trees / Rocks / Architecture**: Replace procedural geometries in `FloraRenderer.ts` or `SettlementRenderer.ts` with `GLTFLoader` meshes (`.glb` + Draco/KTX2 compressed 2K/4K PBR maps) while keeping the exact same `TerrainMap` / `Settlement` data contracts.
- **Rigged Anthropomorphic Creatures**: Swap `CreatureRenderer.buildRig()` with skinned `.glb` models driven by `THREE.AnimationMixer` mapped to `creature.activity` and `creature.def.locomotion`.
- **HDRI Skyboxes**: Load `.exr` / `.hdr` equirectangular environment maps via `RGBELoader` in `AtmosphereSystem.ts` for studio-grade photorealistic image-based lighting.
