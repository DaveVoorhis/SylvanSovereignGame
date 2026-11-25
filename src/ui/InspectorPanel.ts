import type { SelectionTarget } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import type { WorldState } from '@simulation/WorldState';

export interface InspectorCallbacks {
  onClose: () => void;
  onFollowCreature: (creatureId: string) => void;
  onEnterCreaturePov: (creatureId: string) => void;
  onExitCreaturePov: () => void;
  onFocusSettlement: (settlementId: string) => void;
}

export class InspectorPanel {
  readonly element: HTMLElement;
  private readonly contentEl: HTMLElement;

  constructor(private readonly callbacks: InspectorCallbacks) {
    this.element = document.createElement('aside');
    this.element.className = 'hud-inspector glass-panel hidden';
    this.contentEl = document.createElement('div');
    this.element.appendChild(this.contentEl);
  }

  update(
    selection: SelectionTarget,
    world: WorldState,
    isFollowing: boolean,
    povCreatureId: string | null,
  ): void {
    if (!selection) {
      this.element.classList.add('hidden');
      return;
    }
    this.element.classList.remove('hidden');

    if (selection.kind === 'creature') {
      const c = world.getCreature(selection.id);
      if (!c) {
        this.element.classList.add('hidden');
        return;
      }
      const home = world.getSettlement(c.settlementId);
      const statusText = c.alive ? c.activity.replace('_', ' ') : 'fallen';
      const isInThisPov = povCreatureId === c.id;

      this.contentEl.innerHTML = `
        <div class="panel-header">
          <span>🐾 ${c.name}</span>
          <button class="close-btn" data-action="close">✕</button>
        </div>
        <div class="inspector-sub">${c.def.displayName} ${c.role} · ${home?.name ?? 'Wanderer'}</div>
        <div class="inspector-lore">${c.def.lore}</div>
        <div class="inspector-thought">💭 “${c.thought}”</div>
        <div class="kv-grid">
          <div>Activity</div><div><strong>${statusText}</strong></div>
          <div>Health</div><div>${Math.round(c.health)} / ${c.maxHealth}</div>
          <div>Energy</div><div>${Math.round(c.energy)}%</div>
          <div>Mood</div><div>${Math.round(c.mood)}%</div>
          <div>Devotion</div><div>${Math.round(c.devotion)}%</div>
          <div>Wealth</div><div>${Math.round(c.wealth)} acorns</div>
          <div>Social</div><div>${c.getFriendCount()} friends · ${c.getRivalCount()} rivals</div>
        </div>
        <div class="inspector-actions">
          ${
            c.alive
              ? `<button class="hud-btn accent" data-action="pov">${
                  isInThisPov ? '🌍 Exit Eye View' : '👁 Eye View'
                }</button>`
              : ''
          }
          <button class="hud-btn" data-action="follow">${isFollowing ? 'Following ✓' : 'Follow'}</button>
          ${home ? `<button class="hud-btn" data-action="home">${home.name}</button>` : ''}
        </div>
      `;

      this.contentEl.querySelector('[data-action="close"]')?.addEventListener('click', () => {
        this.callbacks.onClose();
      });
      this.contentEl.querySelector('[data-action="pov"]')?.addEventListener('click', () => {
        if (isInThisPov) {
          this.callbacks.onExitCreaturePov();
        } else {
          this.callbacks.onEnterCreaturePov(c.id);
        }
      });
      this.contentEl.querySelector('[data-action="follow"]')?.addEventListener('click', () => {
        this.callbacks.onFollowCreature(c.id);
      });
      this.contentEl.querySelector('[data-action="home"]')?.addEventListener('click', () => {
        if (home) this.callbacks.onFocusSettlement(home.id);
      });
      return;
    }

    if (selection.kind === 'settlement') {
      const s = world.getSettlement(selection.id);
      if (!s) {
        this.element.classList.add('hidden');
        return;
      }
      const pop = world.getSettlementPopulation(s.id);
      const cap = s.getHousingCapacity();

      const diploRows = world.settlements
        .filter((other) => other.id !== s.id)
        .map((other) => {
          const stance = world.diplomacy.getStance(s.id, other.id);
          return `<div class="diplo-row"><span>${other.name}</span><span class="stance-${stance}">${stance}</span></div>`;
        })
        .join('');

      this.contentEl.innerHTML = `
        <div class="panel-header">
          <span>🏰 ${s.name}</span>
          <button class="close-btn" data-action="close">✕</button>
        </div>
        <div class="inspector-sub">Woodland ${s.tier.toUpperCase()} · Prosperity ${s.prosperity}</div>
        <div class="kv-grid">
          <div>Population</div><div>${pop} / ${cap}</div>
          <div>Buildings</div><div>${s.getCompletedCount()} built (${s.buildings.length} total)</div>
          <div>Treasury</div><div>${Math.round(s.treasury)} acorns</div>
          <div>Trades</div><div>${s.tradeVolume} caravans</div>
          <div>Timber / Stone</div><div>${Math.floor(s.stockpile.timber)} / ${Math.floor(s.stockpile.stone)}</div>
          <div>Food / Herbs</div><div>${Math.floor(s.stockpile.berries + s.stockpile.acorns)} / ${Math.floor(s.stockpile.herbs)}</div>
          <div>Crafts</div><div>${Math.floor(s.stockpile.crafts)}</div>
        </div>
        <div class="section-mini-title">Diplomacy</div>
        <div class="diplo-list">${diploRows}</div>
        <div class="inspector-actions">
          <button class="hud-btn accent" data-action="focus">Center Camera</button>
        </div>
      `;

      this.contentEl.querySelector('[data-action="close"]')?.addEventListener('click', () => {
        this.callbacks.onClose();
      });
      this.contentEl.querySelector('[data-action="focus"]')?.addEventListener('click', () => {
        this.callbacks.onFocusSettlement(s.id);
      });
      return;
    }

    if (selection.kind === 'building') {
      let foundBuilding = null;
      let owner = null;
      for (const s of world.settlements) {
        const b = s.buildings.find((item) => item.id === selection.id);
        if (b) {
          foundBuilding = b;
          owner = s;
          break;
        }
      }
      if (!foundBuilding || !owner) {
        this.element.classList.add('hidden');
        return;
      }
      const bp = BUILDING_CATALOG[foundBuilding.type];
      this.contentEl.innerHTML = `
        <div class="panel-header">
          <span>🏡 ${bp.displayName}</span>
          <button class="close-btn" data-action="close">✕</button>
        </div>
        <div class="inspector-sub">${owner.name} · ${foundBuilding.completed ? 'Completed' : `${Math.round(foundBuilding.progress)}% Built`}</div>
        <div class="inspector-lore">${bp.description}</div>
        <div class="kv-grid">
          <div>Housing</div><div>+${bp.housingCapacity}</div>
          <div>Prosperity</div><div>+${bp.prosperityValue}</div>
          <div>Devotion</div><div>+${bp.devotionValue}</div>
        </div>
        <div class="inspector-actions">
          <button class="hud-btn" data-action="owner">Inspect ${owner.name}</button>
        </div>
      `;
      this.contentEl.querySelector('[data-action="close"]')?.addEventListener('click', () => {
        this.callbacks.onClose();
      });
      this.contentEl.querySelector('[data-action="owner"]')?.addEventListener('click', () => {
        if (owner) this.callbacks.onFocusSettlement(owner.id);
      });
    }
  }
}
