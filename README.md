# Sylvan Sovereign — Procedural Woodland God Game

A 3D, high-resolution, browser-based largely-spectator god game set in a vast procedural world populated by **24 anthropomorphic woodland, alpine, aerial, and aquatic species** (**crows, sparrows, robins, pigeons, magpies, owls, squirrels, mice, rats, frogs, rabbits, foxes, hedgehogs, badgers, bears, wolves, cats, raccoons, weasels, snakes, turtles, beavers, otters, and River Koi**).

Unlike traditional god games where the player micromanages miracles, the **deity itself is dynamically procedural**: it awakens with a generated mythic identity and evolving temperament (`Benevolence`, `Verdancy`, `Curiosity`, `Chaos`, `Wrath`), watches civilizations rise across land and water biomes, and autonomously triggers rare, weighty ecological upheavals and restorative epochs. As a spectator, you freely orbit across the country-scale map, jump into any creature's first-person eye view (including underwater River Koi view), follow expanding towns and waterway havens, browse multi-generation bloodline family trees and realm ledgers, save/load realms in the browser, and optionally offer subtle *Whispers* to the canopy.

## Key Features

- **Vast Naturally-Bounded World (`1120 m × 1120 m`)**: Framed by towering, craggy, impassable alpine mountains at the back (with settleable foothill edges and slopes) and an impassable front sea extending to a flat oceanic horizon (with settleable sandy shores). Between them lie amorphous regions of **lush verdant forests**, **flat treeless grassy prairies**, and **arid sandy deserts** positioned in the driest inland basins farthest from the sea and rivers, with inland lakes dotting the fertile valleys.
- **Meandering Dendritic River Watershed & Natural Realism**: A geological tree-shaped river system where upland streams feed meandering primary tributaries from both flanks into a progressively widening main trunk that winds through S-bends and carves continuously through the coastal beach into the open sea — rendered with a dual-phase flow-aware water shader, uniquely seed-grown procedural conifers across six botanical habits, and GPU-animated ambient critters (**butterflies, bees, dragonflies, ladybugs, and fireflies**).
- **Organic Civilization, Aquatic Waterway Villages & Pioneer Expansion**: Each new browser realm begins with a founding land village and a founding aquatic waterway village. As populations flourish, emigrating pioneers cross valleys and waterways to found up to 16 settlements that grow from `Hamlet → Village → Town → City` and autonomously plan, construct, and cross arched timber-and-stone bridges.
- **Seven Environmental Village Adaptations**: Settlements adapt structurally and culturally to their biome — `forest_canopy`, `coastal_harbor`, `desert_oasis`, `prairie_pastoral`, `mountain_stone`, `riverside_stilts`, and `waterway_haven` (aquatic river/lake havens for beavers, otters, and River Koi) — shaping foundations (stilts, pilings, floating moorings, retaining terraces, awnings, gardens), building materials, economy bonuses, and villager attire.
- **20 Storybook Building Types & 5-Stage Construction**:
  - **14 Land Buildings**: Moss-roof cottages, gabled timber houses, acorn granaries, canopy market stalls, hearth bakeries, artisan workshops, lantern taverns, meadow windmills, canopy conservatories, bough watchtowers, sylvan shrines, owl archives, grand guildhalls, and carved two-tier stone plaza fountains (with parabolic arcing water jets, surface ripples, and ballistic droplet spray).
  - **6 Waterway-Only Buildings**: Beaver timber lodges, otter floating boathouses, river waterwheel mills (with unobstructed undershot river wheels), floating lily-pad bazaars, coral-glass koi sanctuaries, and river-pearl tide shrines.
  - Structures progress visually through `clearing → leveling → foundation → framing → finishing` with sculpted animated builder tools and reclaim older plots when upgrading.
- **Full Creature Lifecycle & Ground-Locked Kinematics**: Adults pair off, raise youthful litters (`young → juvenile → adult`), and form multi-generation bloodlines across generations. Creatures feature sculpted feet, physically reconciled stride kinematics with ground-locked gaits, smooth locomotion, natural walking head-bob in Eye View, and submerged underwater optics (with Snell's window and aquatic haze) when viewing through a River Koi's eyes.
- **Procedural Deity & Rare Ecological Influences**: The procedural deity acts as a subtle ecological metaphor, triggering rare, lasting disruptive upheavals (*The Rising Deluge*, *The Long Scorch*, *The Great Clearing*, *The Ashen Pall*, *The Unseasonal Freeze*) and restorative epochs (*The Living Rewilding*, *The Safe Corridor*, *Steward's Harvest*) — accompanied by sky-reaching post-fog supernatural beams with translucent cathedral stained-glass rose-window light displays, aurora curtains, and clickable epicenter badges.
- **Festivals, Regional Events & National Holidays**: Occasional local village/town/city festivals tailored to each settlement's biome adaptation and season, occasional regional inter-settlement gatherings attended by roughly half the neighboring population, and very occasional realm-wide national holidays celebrated by everyone — complete with plaza bunting garlands, glowing paper lanterns, floating sky lanterns, dancing creatures, and clickable HUD/Chronicle highlights.
- **Woodland Census, Family Trees & Realm Overview Modals**: Inspect every living (or fallen) creature in a searchable, sortable **Woodland Census** or trace multi-generation **Family Trees**, and open the 4-tab **Realm Overview** (`Young`, `Buildings`, `Trade`, `Pioneers`) directly from the top-bar telemetry strip.
- **IndexedDB Save/Load, Autosave & Illustrated Loading Screen**: Realms automatically save to a default browser IndexedDB autosave slot (periodically and on tab hide/close) and auto-restore on reload, alongside named manual save slots, JSON export/import, persisted graphics quality presets, optional `?seed=<int>` URL booting, and an illustrated progressive world-building splash screen.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (default `http://localhost:5173`). To force a specific deterministic world seed instead of auto-loading the last autosave, append `?seed=12345` to the URL.

### Useful Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite development server with HMR |
| `npm run build` | Type-check (`tsc --noEmit`) and build single-file production bundle (`dist/index.html`) |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run strict TypeScript type checking |
| `npm test` | Run Vitest simulation, rendering, persistence, and UI unit test suites |
| `npm run test:watch` | Run Vitest in interactive watch mode |

## Project Structure

```text
Forest/
├── index.html                   # Entry HTML + critical first-paint illustrated splash screen
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   └── ARCHITECTURE.md          # Layered architecture overview & asset upgrade guide
├── public/
│   └── favicon.svg
├── tests/
│   ├── persistence.test.ts      # World snapshot & IndexedDB save/load round-trip tests
│   ├── rendering.test.ts        # Three.js procedural geometry, water, fountain & rig tests
│   ├── simulation.test.ts       # Deterministic headless simulation, ecology & watershed tests
│   └── ui.test.ts               # Top-bar pills, Realm Overview logic & POV HUD tests
└── src/
    ├── main.ts                  # Application bootstrap & splash lifecycle
    ├── style.css                # Glassmorphic dark-forest spectator HUD & modal styles
    ├── core/                    # Engine loop, config, PRNG, persistence, event bus, types
    │   ├── Config.ts
    │   ├── EventBus.ts
    │   ├── GameEngine.ts
    │   ├── SaveStore.ts         # IndexedDB save slots, autosave & JSON export/import
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
    │   │   ├── DivineEvents.ts  # Disruptive & restorative ecological influence catalog
    │   │   └── ProceduralGod.ts # Autonomous procedural deity psyche & ecological epochs
    │   ├── creatures/
    │   │   ├── Creature.ts
    │   │   ├── CreatureAI.ts
    │   │   ├── SpeciesCatalog.ts    # 24 woodland, aerial & aquatic species definitions
    │   │   └── StrideKinematics.ts  # Ground-locked stride & hop kinematics
    │   ├── settlements/
    │   │   ├── BuildingCatalog.ts   # 14 land + 6 waterway building blueprints
    │   │   ├── Settlement.ts
    │   │   ├── SettlementManager.ts
    │   │   └── VillageAdaptation.ts # 7 biome & waterway adaptation profiles
    │   └── society/
    │       ├── Chronicle.ts
    │       ├── DiplomacySystem.ts
    │       ├── EconomySystem.ts
    │       └── FestivalSystem.ts    # Local festivals, regional events & national holidays
    ├── rendering/               # Three.js WebGL2 PBR presentation layer
    │   ├── AmbientCritterRenderer.ts # GPU wing-flapping butterflies, bees, dragonflies & fireflies
    │   ├── AtmosphereSystem.ts       # Dynamic sky shader, lighting, weather & deity beams
    │   ├── CameraController.ts       # World orbit, Overview, Follow & first-person POV
    │   ├── CreatureRenderer.ts       # 24 articulated rigs, sculpted feet, attire & tools
    │   ├── DistanceFocusBlurPass.ts  # Distance depth-of-field post-processing pass
    │   ├── FireEffect.ts             # Volumetric blackbody hearth fires, sparks & smoke
    │   ├── FloraRenderer.ts          # Instanced forests, prairie grass, desert & alpine flora
    │   ├── GeometryHelpers.ts        # Procedural geometry utilities
    │   ├── ProceduralPineBuilder.ts  # Unique seed-grown procedural conifers (6 habits)
    │   ├── ProceduralTextures.ts     # Synthesized seamless PBR albedo/bump/roughness maps
    │   ├── SceneManager.ts           # WebGL2 renderer, composer, underwater POV & orchestration
    │   ├── SettlementRenderer.ts     # 20 buildings, 5-stage kits, bridges, mills & fountains
    │   ├── TerrainRenderer.ts        # Multi-biome terrain mesh & shoreline blending
    │   └── WaterShader.ts            # Dual-phase flow-aware water & Snell's window shaders
    └── ui/                      # Modular spectator HUD & modal components
        ├── ChroniclePanel.ts
        ├── CreatureDirectoryLogic.ts # Census filtering, sorting & bloodline tree builder
        ├── CreatureDirectoryModal.ts # Woodland Census & Family Tree modal
        ├── CreaturePovBar.ts         # Floating Eye View bar with Prev/Next/Random/Follow
        ├── DeityPanel.ts             # Closable Deity panel with ecological Whispers
        ├── DialogPillController.ts   # Unified toggle controller for top-bar dialog pills
        ├── HudManager.ts             # Throttled HUD coordinator, modals & Zen Mode
        ├── InspectorPanel.ts         # Live creature, settlement & building inspector
        ├── RealmOverviewLogic.ts     # Summaries for Young, Buildings, Trade & Pioneers
        ├── RealmOverviewModal.ts     # 4-tab Realm Overview modal
        ├── SaveLoadModal.ts          # Saved Realms modal (autosave, slots, JSON I/O)
        ├── SplashScreen.ts           # Progressive world-building splash controller
        └── TopBar.ts                 # 2-band top bar, telemetry strip & view controls
```

## Controls

### World Spectator View
- **Left-drag**: Orbit camera around the world
- **Right-drag / WASD / Arrow keys**: Pan across valleys, forests, prairies, deserts, rivers, and shores
- **Scroll wheel**: Zoom smoothly from creature-eye level out to country-wide overview
- **Left-click creature / building / town square**: Open live Inspector
- **Click Chronicle events / Settlement pills / Active celebration or deity-epoch badges**: Smoothly fly camera to the location (clicking an active settlement or celebration pill again closes the Inspector)
- **Top Bar Telemetry**: Click **`🐾 Kin`** (or press **`C`**) to open the **Woodland Census & Family Trees** modal; click **`🐣 Young`**, **`🏡 Bldgs`**, **`⚖️ Trade`**, or **`🧭 Pioneers`** to open the 4-tab **Realm Overview** modal
- **Side Panels**: Click **`✦ Deity`** or **`📜 Chronicle`** in the top bar (or each panel's `✕` button) to toggle those panels
- **Top Bar Controls**: Adjust simulation speed (`⏸`, `1×`, `2×`, `4×`), jump to **`Overview`** (full country view), toggle **`Drift`** (gentle cinematic orbit), select graphics preset (`Balanced` / `High` / `Ultra GFX`, persisted locally), open **`💾 Saves`** (autosave, manual slots, JSON export/import), or click **`New World`** to generate a fresh procedural world
- **`⛶ Fullscreen` button or press `F`**: Toggle browser full-screen mode while keeping the HUD and controls visible
- **`🌿 Zen` button or press `Z`**: Enter full-screen Zen Mode, hiding all floating dialogs, panels, and text for complete immersion; press **`Z`** or **`Esc`** to return (stays in full-screen if you were already in full-screen beforehand)

### Creature Eye View (First-Person POV)
- **`👁 Creature View` button or press `V`**: Enter first-person eye view of the selected (or first living) creature — including submerged underwater view with Snell's window for River Koi; press `V` again or **`Esc`** / **`🌍 World View`** to smoothly return to viewing the world
- **`👁 Eye View`** in the Creature Inspector, Census, or Realm Overview: Jump directly into any creature's eyes
- **Left-drag in Eye View**: Look around freely from the creature's perspective
- **`◀ Prev` / `Next ▶` buttons (or `[` / `]`, `←` / `→`)**: Hop directly from one creature to another
- **`🎲 Random` button (or press `R`)**: Jump into a random woodland creature's eyes
- **`🎯 Follow` button in the Eye View bar**: Smoothly pull back into third-person Follow mode behind the currently viewed creature
- **Click another creature while in Eye View**: Seamlessly transfer into that creature's eyes
