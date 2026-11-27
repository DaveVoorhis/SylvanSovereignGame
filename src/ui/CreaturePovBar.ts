import type { WorldState } from '@simulation/WorldState';

export interface CreaturePovBarCallbacks {
  onPrevCreature: () => void;
  onNextCreature: () => void;
  onRandomCreature: () => void;
  onFollowCreature: (creatureId: string) => void;
  onExitPov: () => void;
}

/**
 * Floating bottom-center HUD bar shown while viewing the forest
 * through a woodland creature's eyes (first-person POV).
 */
export class CreaturePovBar {
  readonly element: HTMLElement;
  private readonly infoEl: HTMLElement;
  private currentCreatureId: string | null = null;
  private visible = false;
  private lastInfoHtml = '';

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

    const followBtn = document.createElement('button');
    followBtn.className = 'hud-btn small';
    followBtn.textContent = '🎯 Follow';
    followBtn.title = 'Switch to third-person Follow mode for this creature';
    followBtn.addEventListener('click', () => {
      if (this.currentCreatureId) {
        this.callbacks.onFollowCreature(this.currentCreatureId);
      }
    });

    const exitBtn = document.createElement('button');
    exitBtn.className = 'hud-btn small accent';
    exitBtn.textContent = '🌍 World View';
    exitBtn.title = 'Return to world overview (Esc or V)';
    exitBtn.addEventListener('click', () => this.callbacks.onExitPov());

    actions.append(prevBtn, randBtn, nextBtn, followBtn, exitBtn);

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
      this.currentCreatureId = null;
      if (this.visible) {
        this.visible = false;
        this.element.classList.add('hidden');
      }
      return;
    }

    const c = world.getCreature(povCreatureId);
    if (!c || !c.alive) {
      this.currentCreatureId = null;
      if (this.visible) {
        this.visible = false;
        this.element.classList.add('hidden');
      }
      return;
    }

    this.currentCreatureId = c.id;
    if (!this.visible) {
      this.visible = true;
      this.element.classList.remove('hidden');
    }
    const home = world.getSettlement(c.settlementId);
    let aliveCount = 0;
    let idx = -1;
    for (let i = 0; i < world.creatures.length; i++) {
      const item = world.creatures[i];
      if (!item.alive) continue;
      if (item.id === c.id) {
        idx = aliveCount;
      }
      aliveCount++;
    }

    const nextHtml = `
      <div class="pov-name">${c.name} <small>(${idx + 1}/${aliveCount})</small></div>
      <div class="pov-meta">${c.def.displayName} ${c.role} · ${home?.name ?? 'Wanderer'} · <em>“${c.thought}”</em></div>
    `;
    if (nextHtml !== this.lastInfoHtml) {
      this.lastInfoHtml = nextHtml;
      this.infoEl.innerHTML = nextHtml;
    }
  }
}
