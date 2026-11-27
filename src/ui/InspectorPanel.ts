import type { SelectionTarget } from '@core/Types';
import { BUILDING_CATALOG } from '@simulation/settlements/BuildingCatalog';
import { getBuildingStage, getConstructionStageLabel } from '@simulation/settlements/Settlement';
import { getBiomeDisplayName } from '@simulation/settlements/VillageAdaptation';
import { formatWarPhaseLabel, getWeaponStats } from '@simulation/society/WarSystem';
import type { WorldState } from '@simulation/WorldState';

export interface InspectorCallbacks {
  onClose: () => void;
  onFollowCreature: (creatureId: string) => void;
  onEnterCreaturePov: (creatureId: string) => void;
  onExitCreaturePov: () => void;
  onFocusSettlement: (settlementId: string) => void;
  onViewLineage?: (creatureId: string) => void;
}

export class InspectorPanel {
  readonly element: HTMLElement;
  private readonly contentEl: HTMLElement;
  private visible = false;
  private lastHtml = '';
  private cachedLitterKey = '';
  private cachedLittermates: string[] = [];
  private currentActionState:
    | { kind: 'creature'; creatureId: string; isInPov: boolean; homeId: string | null }
    | { kind: 'settlement'; settlementId: string }
    | { kind: 'building'; ownerId: string }
    | null = null;

  constructor(private readonly callbacks: InspectorCallbacks) {
    this.element = document.createElement('aside');
    this.element.className = 'hud-inspector glass-panel hidden';
    this.contentEl = document.createElement('div');
    this.contentEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      const actionEl = target?.closest?.('[data-action]') as HTMLElement | null;
      if (!actionEl) return;
      const action = actionEl.dataset?.action ?? actionEl.getAttribute?.('data-action');
      if (!action) return;
      if (action === 'close') {
        this.callbacks.onClose();
        return;
      }
      const state = this.currentActionState;
      if (!state) return;
      if (state.kind === 'creature') {
        if (action === 'pov') {
          if (state.isInPov) {
            this.callbacks.onExitCreaturePov();
          } else {
            this.callbacks.onEnterCreaturePov(state.creatureId);
          }
        } else if (action === 'follow') {
          this.callbacks.onFollowCreature(state.creatureId);
        } else if (action === 'lineage') {
          this.callbacks.onViewLineage?.(state.creatureId);
        } else if (action === 'home' && state.homeId) {
          this.callbacks.onFocusSettlement(state.homeId);
        }
      } else if (state.kind === 'settlement') {
        if (action === 'focus') {
          this.callbacks.onFocusSettlement(state.settlementId);
        }
      } else if (state.kind === 'building') {
        if (action === 'owner') {
          this.callbacks.onFocusSettlement(state.ownerId);
        }
      }
    });
    this.element.appendChild(this.contentEl);
  }

  isVisible(): boolean {
    return this.visible;
  }

  private setVisible(next: boolean): void {
    if (this.visible === next) return;
    this.visible = next;
    this.element.classList.toggle('hidden', !next);
  }

  private setContentHtml(nextHtml: string): void {
    if (nextHtml === this.lastHtml) return;
    this.lastHtml = nextHtml;
    this.contentEl.innerHTML = nextHtml;
  }

  update(
    selection: SelectionTarget,
    world: WorldState,
    isFollowing: boolean,
    povCreatureId: string | null,
  ): void {
    if (!selection) {
      this.currentActionState = null;
      this.setVisible(false);
      return;
    }

    if (selection.kind === 'creature') {
      const c = world.getCreature(selection.id);
      if (!c) {
        this.currentActionState = null;
        this.setVisible(false);
        return;
      }
      this.setVisible(true);
      const home = world.getSettlement(c.settlementId);
      const homeProfile = home?.getAdaptationProfile();
      const statusText = c.alive ? c.activity.replace(/_/g, ' ') : 'fallen';
      const weaponStats = c.warWeapon ? getWeaponStats(c.warWeapon) : null;
      const creatureWar = c.activeWarId ? world.wars.getWarById(c.activeWarId) : undefined;
      const warEnemyName = creatureWar
        ? world.getSettlement(
            creatureWar.settlementAId === c.settlementId ? creatureWar.settlementBId : creatureWar.settlementAId,
          )?.name ?? 'Rival Village'
        : null;
      const isInThisPov = povCreatureId === c.id;
      const stageLabel =
        c.lifeStage === 'young'
          ? `Young ${c.def.youngSingular}`
          : c.lifeStage === 'juvenile'
            ? 'Juvenile'
            : c.lifeStage === 'elder'
              ? 'Elder'
              : 'Adult';
      const mate = c.mateId ? world.getCreature(c.mateId) : undefined;
      const parents = c.parentIds
        .map((pid) => world.getCreature(pid)?.name)
        .filter((n): n is string => Boolean(n));
      let littermates: string[];
      if (c.litterId) {
        const litterKey = `${c.id}:${c.litterId}`;
        if (this.cachedLitterKey !== litterKey) {
          this.cachedLitterKey = litterKey;
          const found: string[] = [];
          for (let i = 0; i < world.creatures.length; i++) {
            const o = world.creatures[i];
            if (o.id !== c.id && o.litterId === c.litterId) {
              found.push(o.name.split(' ')[0]);
            }
          }
          this.cachedLittermates = found;
        }
        littermates = this.cachedLittermates;
      } else {
        littermates = [];
      }
      const livingOffspring = c.offspringIds
        .map((oid) => world.getCreature(oid))
        .filter((o): o is NonNullable<typeof o> => Boolean(o && o.alive));

      this.currentActionState = {
        kind: 'creature',
        creatureId: c.id,
        isInPov: isInThisPov,
        homeId: home?.id ?? null,
      };
      this.setContentHtml(`
        <div class="panel-header" title="Drag to move · Double-click to reset position">
          <span>🐾 ${c.name}</span>
          <button class="close-btn" data-action="close" title="Close inspector">✕</button>
        </div>
        <div class="inspector-sub">${stageLabel} ${c.def.displayName} ${c.isYoung() ? '' : c.role + ' '}· Gen ${c.generation} · ${home?.name ?? 'Wanderer'}</div>
        ${
          homeProfile
            ? `<div class="adaptation-badge">${homeProfile.icon} ${homeProfile.shortLabel} · ${homeProfile.clothingSummary}</div>`
            : ''
        }
        <div class="inspector-lore">${c.def.lore}</div>
        <div class="inspector-thought">💭 “${c.thought}”</div>
        <div class="kv-grid">
          <div>Life Stage</div><div><strong>${stageLabel}</strong> (${c.ageDays.toFixed(1)}d)</div>
          <div>Activity</div><div><strong>${statusText}</strong></div>
          ${weaponStats ? `<div>War Gear</div><div><strong>${weaponStats.icon} ${weaponStats.label}</strong>${warEnemyName ? ` (vs ${warEnemyName})` : ''}</div>` : ''}
          ${mate ? `<div>Mate</div><div>❤️ ${mate.name}${mate.alive ? '' : ' (late)'}</div>` : ''}
          ${parents.length > 0 ? `<div>Parents</div><div>${parents.join(' & ')}</div>` : ''}
          ${littermates.length > 0 ? `<div>Littermates</div><div>${littermates.join(', ')}</div>` : ''}
          ${livingOffspring.length > 0 ? `<div>Young</div><div>${livingOffspring.length} ${livingOffspring.length === 1 ? c.def.youngSingular : c.def.youngPlural}</div>` : ''}
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
          <button class="hud-btn" data-action="lineage" title="View family tree">🌳 Lineage</button>
          ${home ? `<button class="hud-btn" data-action="home">${home.name}</button>` : ''}
        </div>
      `);
      return;
    }

    if (selection.kind === 'settlement') {
      const s = world.getSettlement(selection.id);
      if (!s) {
        this.currentActionState = null;
        this.setVisible(false);
        return;
      }
      this.setVisible(true);
      const pop = world.getSettlementPopulation(s.id);
      const cap = s.getHousingCapacity();
      const profile = s.getAdaptationProfile();
      const biomeLabel = getBiomeDisplayName(s.biome);
      const activeCel = world.festivals.getCelebrationForSettlement(s.id);
      const activeCelAttendees = activeCel
        ? world.festivals.getAttendeeCount(world, activeCel.id)
        : 0;
      const scopeLabel = activeCel
        ? activeCel.scope === 'national'
          ? 'National Holiday'
          : activeCel.scope === 'regional'
            ? 'Regional Event'
            : `${s.tier[0].toUpperCase()}${s.tier.slice(1)} Festival`
        : '';

      const activeWar = world.wars.getWarForSettlement(s.id);
      let warBannerHtml = '';
      if (activeWar) {
        const isSideA = activeWar.settlementAId === s.id;
        const enemyId = isSideA ? activeWar.settlementBId : activeWar.settlementAId;
        const enemyName = world.getSettlement(enemyId)?.name ?? 'Rival Village';
        const stats = world.wars.getActiveArmyStats(activeWar, world);
        const ownAlive = isSideA ? stats.survivingA : stats.survivingB;
        const enemyAlive = isSideA ? stats.survivingB : stats.survivingA;
        const ownLosses = isSideA ? activeWar.casualtiesA : activeWar.casualtiesB;
        const enemyLosses = isSideA ? activeWar.casualtiesB : activeWar.casualtiesA;
        warBannerHtml = `<div class="war-banner">
          <div class="war-banner-title">⚔️ At War with ${enemyName}</div>
          <div class="war-banner-meta">${formatWarPhaseLabel(activeWar.phase)} · ${ownAlive} vs ${enemyAlive} armed</div>
          <div class="war-banner-theme">Fallen: ${ownLosses} ours · ${enemyLosses} theirs</div>
        </div>`;
      }

      const diploRows = world.settlements
        .filter((other) => other.id !== s.id)
        .map((other) => {
          const stance = world.diplomacy.getStance(s.id, other.id);
          return `<div class="diplo-row"><span>${other.name}</span><span class="stance-${stance}">${stance}</span></div>`;
        })
        .join('');

      this.currentActionState = { kind: 'settlement', settlementId: s.id };
      this.setContentHtml(`
        <div class="panel-header" title="Drag to move · Double-click to reset position">
          <span>${profile.icon} ${s.name}</span>
          <button class="close-btn" data-action="close" title="Close inspector">✕</button>
        </div>
        <div class="inspector-sub">${profile.title} (${s.tier}) · ${biomeLabel}</div>
        ${warBannerHtml}
        ${
          activeCel
            ? `<div class="festival-banner scope-${activeCel.scope}">
                <div class="festival-banner-title">${activeCel.icon} ${activeCel.name}</div>
                <div class="festival-banner-meta">${scopeLabel} · ${activeCelAttendees} attending</div>
                <div class="festival-banner-theme">${activeCel.theme}</div>
              </div>`
            : ''
        }
        <div class="adaptation-card">
          <div class="adaptation-summary">${profile.summary}</div>
          <div class="adaptation-row"><strong>Architecture:</strong> ${profile.architectureSummary}</div>
          <div class="adaptation-row"><strong>Attire:</strong> ${profile.clothingSummary}</div>
          <div class="adaptation-row"><strong>Economy:</strong> ${profile.economySummary}</div>
        </div>
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
      `);
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
        this.currentActionState = null;
        this.setVisible(false);
        return;
      }
      this.setVisible(true);
      const bp = BUILDING_CATALOG[foundBuilding.type];
      const stage = getBuildingStage(foundBuilding);
      const ownerProfile = owner.getAdaptationProfile();
      const statusLabel = foundBuilding.disassembling
        ? `Disassembling for ${
            foundBuilding.replacementType
              ? BUILDING_CATALOG[foundBuilding.replacementType].displayName
              : 'Larger Structure'
          } · ${Math.round(foundBuilding.progress)}% left`
        : foundBuilding.completed
          ? 'Completed'
          : `${getConstructionStageLabel(stage, bp.frameStyle)} · ${Math.round(foundBuilding.progress)}%`;
      this.currentActionState = { kind: 'building', ownerId: owner.id };
      this.setContentHtml(`
        <div class="panel-header" title="Drag to move · Double-click to reset position">
          <span>🏡 ${bp.displayName}</span>
          <button class="close-btn" data-action="close" title="Close inspector">✕</button>
        </div>
        <div class="inspector-sub">${owner.name} · ${statusLabel}</div>
        <div class="adaptation-badge">${ownerProfile.icon} ${ownerProfile.title} style (${getBiomeDisplayName(owner.biome)})</div>
        <div class="inspector-lore">${bp.description}</div>
        <div class="kv-grid">
          <div>Housing</div><div>+${bp.housingCapacity}</div>
          <div>Prosperity</div><div>+${bp.prosperityValue}</div>
          <div>Devotion</div><div>+${bp.devotionValue}</div>
        </div>
        <div class="inspector-actions">
          <button class="hud-btn" data-action="owner">Inspect ${owner.name}</button>
        </div>
      `);
    }
  }
}
