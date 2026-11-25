import type { WorldState } from '@simulation/WorldState';

export interface CreaturePovBarCallbacks {
  onPrevCreature: () => void;
  onNextCreature: () => void;
  onRandomCreature: () => void;
  onExitPov: () => void;
}

/**
 * Floating bottom-center HUD bar shown while viewing the forest
 * through a woodland creature's eyes (first-person POV).
 */
export class CreaturePovBar {
  readonly element: HTMLElement;
  private readonly infoEl: HTMLElement;

  constructor(private readonly callbacks: CreaturePovBarCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'hud-pov-bar glass-panel hidden';

    const leftRow = document.createElement('div');
    leftRow.className = 'pov-bar-top';

    const badge = document.createElement('span');
    badge.className = 'pov-badge';
    badge.textContent = '👁 EYE VIEW';

    this.infoEl = document.createElement('div');
    this.infoEl.className = 'pov-info';

    leftRow.append(badge, this.infoEl);

    const actions = document.createElement('div');
    actions.className = 'pov-actions';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'hud-btn small';
    prevBtn.textContent = '◀ Prev';
    prevBtn.title = 'Previous creature ([ or ←)';
    prevBtn.addEventListener('click', () => this.callbacks.onPrevCreature());

    const randBtn = document.createElement('button');
    randBtn.className = 'hud-btn small';
    randBtn.textContent = '🎲 Random';
    randBtn.title = 'Jump to a random creature (R)';
    randBtn.addEventListener('click', () => this.callbacks.onRandomCreature());

    const nextBtn = document.createElement('button');
    nextBtn.className = 'hud-btn small';
    nextBtn.textContent = 'Next ▶';
    nextBtn.title = 'Next creature (] or →)';
    nextBtn.addEventListener('click', () => this.callbacks.onNextCreature());

    const exitBtn = document.createElement('button');
    exitBtn.className = 'hud-btn small accent';
    exitBtn.textContent = '🌍 World View';
    exitBtn.title = 'Return to world overview (Esc or V)';
    exitBtn.addEventListener('click', () => this.callbacks.onExitPov());

    actions.append(prevBtn, randBtn, nextBtn, exitBtn);

    const hint = document.createElement('div');
    hint.className = 'pov-hint';
    hint.textContent =
      'Drag to look around · Click another creature to jump in · [ / ] or ← / → switch · Esc returns to world';

    const mainRow = document.createElement('div');
    mainRow.className = 'pov-main-row';
    mainRow.append(leftRow, actions);

    this.element.append(mainRow, hint);
  }

  update(world: WorldState, povCreatureId: string | null): void {
    if (!povCreatureId) {
      this.element.classList.add('hidden');
      return;
    }

    const c = world.getCreature(povCreatureId);
    if (!c || !c.alive) {
      this.element.classList.add('hidden');
      return;
    }

    this.element.classList.remove('hidden');
    const home = world.getSettlement(c.settlementId);
    const aliveList = world.creatures.filter((item) => item.alive);
    const idx = aliveList.findIndex((item) => item.id === c.id);

    this.infoEl.innerHTML = `
      <div class="pov-name">${c.name} <small>(${idx + 1}/${aliveList.length})</small></div>
      <div class="pov-meta">${c.def.displayName} ${c.role} · ${home?.name ?? 'Wanderer'} · <em>“${c.thought}”</em></div>
    `;
  }
}
