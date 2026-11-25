# Sylvan Sovereign — Procedural Woodland God Game

A 3D, high-resolution, browser-based largely-spectator god game set in a vast procedural world populated by anthropomorphic woodland creatures (**crows, sparrows, robins, squirrels, mice, rats, frogs, rabbits, foxes, hedgehogs, badgers, and owls**).

Unlike traditional god games where the player micromanages miracles, the **deity itself is dynamically procedural**: it awakens with a generated mythic identity and evolving temperament (`Benevolence`, `Verdancy`, `Curiosity`, `Chaos`, `Wrath`), watches civilizations rise across biomes, and autonomously unleashes blooms, towering sunbeams, mists, spirit-lanterns, storms, and omens. As a spectator, you freely orbit across the country-scale map, jump into any creature's first-person eye view, hop from creature to creature, follow expanding towns and cities, inspect relationships and trade caravans, and optionally offer subtle *Whispers* to the canopy.

## Key Features

- **Vast Naturally-Bounded World (`1120 m × 1120 m`)**: Framed by towering, craggy, impassable alpine mountains at the back (with settleable foothill edges and slopes) and an impassable front sea (with settleable sandy shores). Between them lie amorphous regions of **lush verdant forests**, **flat treeless grassy prairies**, and **arid sandy deserts** positioned in the driest inland basins farthest from the sea and rivers, with inland lakes dotting the fertile valleys.
- **Meandering Dendritic River Watershed**: A geological tree-shaped river system where upland streams feed meandering primary tributaries from both flanks into a progressively widening main trunk that winds through S-bends and carves continuously through the coastal beach into the open sea.
- **Organic Civilization & Pioneer Expansion**: Each world begins with a single founding village. As populations flourish, emigrating pioneers cross valleys and waterways to found up to 16 villages that grow from `Hamlet → Village → Town → City` and autonomously plan, construct, and cross arched timber-and-stone bridges.
- **Six Environmental Village Adaptations**: Villages adapt structurally and culturally to their biome — `forest_canopy`, `coastal_harbor`, `desert_oasis`, `prairie_pastoral`, `mountain_stone`, and `riverside_stilts` — shaping foundations (stilts, retaining terraces, awnings, gardens), building materials, and villager attire.
- **14 Storybook Building Types & 5-Stage Construction**: Cottages, timber houses, granaries, market stalls, bakeries, workshops, taverns, windmills, greenhouses, watchtowers, shrines, libraries, guildhalls, and carved two-tier stone plaza fountains (with parabolic arcing water jets, surface ripples, and ballistic droplet spray). Structures progress visually through `clearing → leveling → foundation → framing → finishing` with animated builder tools and reclaim older plots when upgrading.
- **Full Creature Lifecycle**: Adults pair off, raise smaller youthful litters of young, and offspring grow smoothly to adulthood to form new pairs across generations.
- **Procedural Deity & Living Society**: Inter-settlement diplomacy (`allied`, `friendly`, `neutral`, `tense`, `war`), trade caravans, a clickable living Chronicle, volumetric campfire hearths, and sky-reaching divine beams.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (default `http://localhost:5173`).

### Useful Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite development server with HMR |
| `npm run build` | Type-check (`tsc --noEmit`) and build single-file production bundle (`dist/index.html`) |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run strict TypeScript type checking |
| `npm test` | Run Vitest simulation and rendering unit test suites |
| `npm run test:watch` | Run Vitest in interactive watch mode |

## Project Structure

```text
Forest/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   └── ARCHITECTURE.md          # Layered architecture overview & asset upgrade guide
├── public/
│   └── favicon.svg
├── tests/
│   ├── rendering.test.ts        # Three.js procedural geometry, water, fountain & rig tests
│   └── simulation.test.ts       # Deterministic headless simulation & watershed tests
└── src/
    ├── main.ts                  # Application entry point
    ├── style.css                # Glassmorphic dark-forest spectator HUD styles
    ├── core/                    # Engine loop, config, PRNG, event bus, shared types
    │   ├── Config.ts
    │   ├── EventBus.ts
    │   ├── GameEngine.ts
    │   ├── SeededRandom.ts
    │   └── Types.ts
    ├── simulation/              # Pure headless TypeScript simulation (zero Three.js)
    │   ├── WorldState.ts
    │   ├── terrain/
    │   │   ├── Bridge.ts        # Autonomous arched bridge planning & deck geometry
    │   │   ├── Noise.ts         # Seeded gradient FBM & ridge noise
    │   │   ├── ObstacleMap.ts   # Spatial collision avoidance for structures & flora
    │   │   └── TerrainMap.ts    # Naturally-bounded terrain, biomes & dendritic rivers
    │   ├── deity/
    │   │   ├── DivineEvents.ts
    │   │   └── ProceduralGod.ts
    │   ├── creatures/
    │   │   ├── Creature.ts
    │   │   ├── CreatureAI.ts
    │   │   └── SpeciesCatalog.ts
    │   ├── settlements/
    │   │   ├── BuildingCatalog.ts
    │   │   ├── Settlement.ts
    │   │   ├── SettlementManager.ts
    │   │   └── VillageAdaptation.ts
    │   └── society/
    │       ├── Chronicle.ts
    │       ├── DiplomacySystem.ts
    │       └── EconomySystem.ts
    ├── rendering/               # Three.js WebGL2 PBR presentation layer
    │   ├── AtmosphereSystem.ts  # Dynamic sky shader, lighting, weather & deity beams
    │   ├── CameraController.ts  # World orbit, country Overview & first-person POV
    │   ├── CreatureRenderer.ts  # Articulated rigs, biome attire & youthful scaling
    │   ├── DistanceFocusBlurPass.ts # Distance depth-of-field post-processing pass
    │   ├── FireEffect.ts        # Volumetric blackbody hearth fires, sparks & smoke
    │   ├── FloraRenderer.ts     # Instanced forests, prairie grass, desert & alpine flora
    │   ├── GeometryHelpers.ts   # Procedural geometry utilities
    │   ├── ProceduralTextures.ts # Synthesized seamless PBR albedo/bump/roughness maps
    │   ├── SceneManager.ts      # WebGL2 renderer, composer & subsystem orchestration
    │   ├── SettlementRenderer.ts # 14 buildings, 5-stage construction kits, bridges & fountains
    │   ├── TerrainRenderer.ts   # Multi-biome terrain mesh & shoreline blending
    │   └── WaterShader.ts       # Animated flow-aware water surface shader
    └── ui/                      # Modular spectator HUD components
        ├── ChroniclePanel.ts
        ├── CreaturePovBar.ts
        ├── DeityPanel.ts
        ├── HudManager.ts
        ├── InspectorPanel.ts
        └── TopBar.ts
```

## Controls

### World Spectator View
- **Left-drag**: Orbit camera around the world
- **Right-drag / WASD / Arrow keys**: Pan across valleys, forests, prairies, deserts, and shores
- **Scroll wheel**: Zoom smoothly from creature-eye level out to country-wide overview
- **Left-click creature / building / town square**: Open live Inspector
- **Click Chronicle events / Settlement pills**: Smoothly fly camera to the location
- **Top Bar**: Adjust simulation speed (`⏸`, `1×`, `2×`, `4×`), jump to **`Overview`** (full country view), toggle **`Drift`** (gentle cinematic orbit), select graphics preset (`Balanced` / `High` / `Ultra GFX`), or click **`New World`** to generate a fresh procedural world
- **`🌿 Zen` button or press `Z`**: Enter full-screen Zen Mode, hiding all floating dialogs, panels, and text for complete immersion; press **`Z`** or **`Esc`** to return

### Creature Eye View (First-Person POV)
- **`👁 Creature View` button or press `V`**: Enter first-person eye view of the selected (or first living) creature; press `V` again or **`Esc`** / **`🌍 World View`** to smoothly return to viewing the world
- **`👁 Eye View` in the Creature Inspector**: Jump directly into any inspected creature's eyes
- **Left-drag in Eye View**: Look around freely from the creature's perspective
- **`◀ Prev` / `Next ▶` buttons (or `[` / `]`, `←` / `→`)**: Hop directly from one creature to another
- **`🎲 Random` button (or press `R`)**: Jump into a random woodland creature's eyes
- **Click another creature while in Eye View**: Seamlessly transfer into that creature's eyes
