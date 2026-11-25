# Sylvan Sovereign — Procedural Woodland God Game

A 3D, high-resolution, browser-based largely-spectator god game set in a living forest populated by anthropomorphic woodland creatures (**crows, sparrows, robins, squirrels, mice, rats, frogs, rabbits, foxes, hedgehogs, badgers, and owls**).

Unlike traditional god games where the player micromanages miracles, the **deity itself is dynamically procedural**: it awakens with a generated mythic identity and evolving temperament (`Benevolence`, `Verdancy`, `Curiosity`, `Chaos`, `Wrath`), watches woodland civilizations rise, and autonomously unleashes blooms, sunbeams, mists, spirit-lanterns, storms, and omens. As a spectator, you freely orbit, jump into any creature's first-person eye view, hop from creature to creature, follow cities, inspect relationships and trade caravans, and optionally offer subtle *Whispers* to the canopy.

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
| `npm run build` | Type-check (`tsc --noEmit`) and build production bundle |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run strict TypeScript type checking |
| `npm test` | Run Vitest unit tests against the headless simulation |

## Project Structure

```text
Forest/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   └── ARCHITECTURE.md          # Architectural overview & asset upgrade guide
├── public/
│   └── favicon.svg
├── tests/
│   └── simulation.test.ts       # Deterministic headless simulation tests
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
    │   │   ├── Noise.ts
    │   │   └── TerrainMap.ts
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
    │   │   └── SettlementManager.ts
    │   └── society/
    │       ├── Chronicle.ts
    │       ├── DiplomacySystem.ts
    │       └── EconomySystem.ts
    ├── rendering/               # Photorealistic Three.js WebGL2 PBR presentation layer
    │   ├── AtmosphereSystem.ts
    │   ├── CameraController.ts
    │   ├── CreatureRenderer.ts
    │   ├── FloraRenderer.ts
    │   ├── ProceduralTextures.ts
    │   ├── SceneManager.ts
    │   ├── SettlementRenderer.ts
    │   └── TerrainRenderer.ts
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
- **Left-drag**: Orbit camera around the woodland valley
- **Right-drag / WASD / Arrow keys**: Pan across the forest
- **Scroll wheel**: Zoom in to creature-eye level or pull back to canopy overview
- **Left-click creature / building / town square**: Open live Inspector
- **Click Chronicle events / Settlement pills**: Smoothly fly camera to the location
- **`🌿 Zen` button or press `Z`**: Enter full-screen Zen Mode, hiding all floating dialogs, panels, and text for complete immersion; press **`Z`** or **`Esc`** to return

### Creature Eye View (First-Person POV)
- **`👁 Creature View` button or press `V`**: Enter first-person eye view of the selected (or first living) creature; press `V` again or **`Esc`** / **`🌍 World View`** to smoothly return to viewing the world
- **`👁 Eye View` in the Creature Inspector**: Jump directly into any inspected creature's eyes
- **Left-drag in Eye View**: Look around freely from the creature's perspective
- **`◀ Prev` / `Next ▶` buttons (or `[` / `]`, `←` / `→`)**: Hop directly from one creature to another
- **`🎲 Random` button (or press `R`)**: Jump into a random woodland creature's eyes
- **Click another creature while in Eye View**: Seamlessly transfer into that creature's eyes
