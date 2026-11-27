import type { ResourceType, Vec2 } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import {
  buildBuildingsSummary,
  buildPioneersSummary,
  buildTradeSummary,
  buildYoungSummary,
  type RealmOverviewTab,
} from './RealmOverviewLogic';

export interface RealmOverviewCallbacks {
  onClose: () => void;
  onTabChange: (tab: RealmOverviewTab) => void;
  onInspectCreature: (creatureId: string) => void;
  onEnterCreaturePov: (creatureId: string) => void;
  onFocusSettlement: (settlementId: string) => void;
  onFocusPosition: (pos: Vec2) => void;
  onOpenLineage: (creatureId: string) => void;
}

const RESOURCE_ICONS: Record<ResourceType, string> = {
  timber: '🪵',
  berries: '🫐',
  acorns: '🌰',
  stone: '🪨',
  herbs: '🌿',
  crafts: '🏺',
};

const TAB_META: Record<RealmOverviewTab, { title: string; icon: string; label: string }> = {
  young: { title: 'Nursery & Young Woodland Kin', icon: '🐣', label: 'Young' },
  buildings: { title: 'Realm Architecture & Public Works', icon: '🏡', label: 'Buildings' },
  trade: { title: 'Caravans, Markets & Trade Ledger', icon: '⚖️', label: 'Trade' },
  pioneers: { title: 'Pioneer Expeditions & Frontier', icon: '🧭', label: 'Pioneers' },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatResourceTags(resources: readonly ResourceType[]): string {
  if (resources.length === 0) return '<span class="ro-muted">—</span>';
  return resources
    .map(
      (r) =>
        `<span class="ro-res-chip">${RESOURCE_ICONS[r]} ${escapeHtml(r[0].toUpperCase() + r.slice(1))}</span>`,
    )
    .join('');
}

/**
 * Interactive 4-tab Realm Overview modal backing the top-bar telemetry pills:
 * Young, Buildings, Trade, and Pioneers.
 */
export class RealmOverviewModal {
  readonly element: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly tabButtons = new Map<
    RealmOverviewTab,
    { btn: HTMLButtonElement; badgeEl: HTMLElement }
  >();
  private readonly bodyEl: HTMLElement;

  private open = false;
  private activeTab: RealmOverviewTab = 'young';
  private youngVillageFilter = 'all';
  private buildingVillageFilter = 'all';
  private buildingStatusFilter: 'all' | 'active' | 'completed' = 'all';

  private lastWorld: WorldState | null = null;
  private refreshAccumSec = 0;
  private lastWorldElapsed = -1;
  private lastRenderedHtml = '';
  private lastSummaryText = '';

  constructor(private readonly callbacks: RealmOverviewCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'creature-modal-backdrop hidden';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Realm Overview');

    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    });

    const stopPropagation = (e: Event) => e.stopPropagation();
    for (const evt of ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'dblclick']) {
      this.element.addEventListener(evt, stopPropagation);
    }

    const card = document.createElement('div');
    card.className = 'creature-modal ro-modal glass-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'cmodal-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'cmodal-title-wrap';
    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'cmodal-title';
    this.titleEl.textContent = TAB_META.young.title;
    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'cmodal-summary';
    titleWrap.append(this.titleEl, this.summaryEl);

    const headerRight = document.createElement('div');
    headerRight.className = 'cmodal-header-right';

    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'cmodal-tabs';

    for (const tab of ['young', 'buildings', 'trade', 'pioneers'] as RealmOverviewTab[]) {
      const meta = TAB_META[tab];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cmodal-tab ro-tab';
      const labelEl = document.createElement('span');
      labelEl.textContent = `${meta.icon} ${meta.label}`;
      const badgeEl = document.createElement('span');
      badgeEl.className = 'ro-tab-badge';
      badgeEl.textContent = '0';
      btn.append(labelEl, badgeEl);
      btn.addEventListener('click', () => this.setActiveTab(tab));
      this.tabButtons.set(tab, { btn, badgeEl });
      tabsWrap.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cmodal-close';
    closeBtn.title = 'Close (Esc)';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    headerRight.append(tabsWrap, closeBtn);
    header.append(titleWrap, headerRight);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'cmodal-body ro-body';
    this.bodyEl.addEventListener('click', (e) => this.handleBodyClick(e));
    this.bodyEl.addEventListener('change', (e) => this.handleBodyChange(e));

    card.append(header, this.bodyEl);
    this.element.appendChild(card);
    this.syncTabButtons();
  }

  isOpen(): boolean {
    return this.open;
  }

  getActiveTab(): RealmOverviewTab {
    return this.activeTab;
  }

  isTabOpen(tab: RealmOverviewTab): boolean {
    return this.open && this.activeTab === tab;
  }

  openTab(world: WorldState, tab: RealmOverviewTab): void {
    this.lastWorld = world;
    this.activeTab = tab;
    this.open = true;
    this.refreshAccumSec = 0;
    this.element.classList.remove('hidden');
    this.syncTabButtons();
    this.render(world);
    this.callbacks.onTabChange(tab);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.element.classList.add('hidden');
    this.callbacks.onClose();
  }

  update(dt: number, world: WorldState, force = false): void {
    this.lastWorld = world;
    if (!this.open) return;
    this.refreshAccumSec += dt;
    if (!force && this.refreshAccumSec < 0.75) return;
    this.refreshAccumSec = 0;
    if (!force && this.lastRenderedHtml !== '' && world.elapsedSeconds === this.lastWorldElapsed) {
      return;
    }
    this.render(world);
  }

  private setActiveTab(tab: RealmOverviewTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.syncTabButtons();
    this.bodyEl.scrollTop = 0;
    if (this.lastWorld) {
      this.render(this.lastWorld);
    }
    this.callbacks.onTabChange(tab);
  }

  private syncTabButtons(): void {
    const meta = TAB_META[this.activeTab];
    this.titleEl.textContent = meta.title;
    for (const [tab, nodes] of this.tabButtons) {
      nodes.btn.classList.toggle('active', tab === this.activeTab);
    }
  }

  private updateTabBadges(world: WorldState): void {
    let youngCount = 0;
    let caravans = 0;
    let pioneers = 0;
    for (const c of world.creatures) {
      if (!c.alive) continue;
      if (c.lifeStage === 'young' || c.lifeStage === 'juvenile') youngCount++;
      if (c.activity === 'trading') caravans++;
      else if (c.activity === 'emigrating') pioneers++;
    }
    const completedBldgs = world.settlements.reduce((sum, s) => sum + s.getCompletedCount(), 0);

    const counts: Record<RealmOverviewTab, number> = {
      young: youngCount,
      buildings: completedBldgs,
      trade: caravans,
      pioneers,
    };

    for (const [tab, nodes] of this.tabButtons) {
      const next = String(counts[tab]);
      if (nodes.badgeEl.textContent !== next) {
        nodes.badgeEl.textContent = next;
      }
    }
  }

  private setSummaryText(text: string): void {
    if (this.lastSummaryText === text) return;
    this.lastSummaryText = text;
    this.summaryEl.textContent = text;
  }

  private render(world: WorldState): void {
    this.lastWorldElapsed = world.elapsedSeconds;
    this.updateTabBadges(world);

    let nextHtml: string;
    switch (this.activeTab) {
      case 'young':
        nextHtml = this.renderYoungTab(world);
        break;
      case 'buildings':
        nextHtml = this.renderBuildingsTab(world);
        break;
      case 'trade':
        nextHtml = this.renderTradeTab(world);
        break;
      case 'pioneers':
        nextHtml = this.renderPioneersTab(world);
        break;
    }

    if (nextHtml === this.lastRenderedHtml) return;
    this.lastRenderedHtml = nextHtml;
    const prevScroll = this.bodyEl.scrollTop;
    this.bodyEl.innerHTML = nextHtml;
    this.bodyEl.scrollTop = prevScroll;
  }

  /* =========================================================================
     TAB 1: YOUNG & NURSERY
     ========================================================================= */
  private renderYoungTab(world: WorldState): string {
    const snap = buildYoungSummary(world);
    this.setSummaryText(
      snap.totalYoung > 0
        ? `${snap.totalYoung} young (${snap.newbornCount} newborn, ${snap.juvenileCount} juvenile) · ${snap.activeLitters} active litters · ${snap.bondedPairsCount} bonded pairs`
        : `No young currently growing · ${snap.bondedPairsCount} bonded pairs across ${world.settlements.length} villages`,
    );

    if (
      this.youngVillageFilter !== 'all' &&
      !world.settlements.some((s) => s.id === this.youngVillageFilter)
    ) {
      this.youngVillageFilter = 'all';
    }

    const filteredEntries =
      this.youngVillageFilter === 'all'
        ? snap.entries
        : snap.entries.filter((e) => e.settlementId === this.youngVillageFilter);

    const villageOptions = [
      `<option value="all"${this.youngVillageFilter === 'all' ? ' selected' : ''}>All Villages</option>`,
      ...snap.settlements.map(
        (s) =>
          `<option value="${escapeHtml(s.settlementId)}"${this.youngVillageFilter === s.settlementId ? ' selected' : ''}>${escapeHtml(s.settlementName)} (${s.youngCount})</option>`,
      ),
    ].join('');

    const kpiHtml = `
      <div class="ro-kpi-grid">
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Total Young</span>
          <strong class="ro-kpi-value">${snap.totalYoung}</strong>
          <span class="ro-kpi-sub">${snap.newbornCount} newborn · ${snap.juvenileCount} juvenile</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Active Litters</span>
          <strong class="ro-kpi-value">${snap.activeLitters}</strong>
          <span class="ro-kpi-sub">Growing broods &amp; clutches</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Bonded Pairs</span>
          <strong class="ro-kpi-value">${snap.bondedPairsCount}</strong>
          <span class="ro-kpi-sub">${snap.bondedPairs.filter((p) => p.readyToNest).length} ready to nest</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Nursery Mood</span>
          <strong class="ro-kpi-value">${snap.totalYoung > 0 ? `${snap.averageMood}%` : '—'}</strong>
          <span class="ro-kpi-sub">Average happiness of young</span>
        </div>
      </div>
    `;

    const nurseryCardsHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Village Nurseries</h3>
          <div class="ro-filter-row">
            <label class="ro-filter-label">Village
              <select class="hud-select cmodal-select" data-filter="young-village">${villageOptions}</select>
            </label>
          </div>
        </div>
        <div class="ro-card-grid">
          ${snap.settlements
            .map(
              (s) => `
            <div class="ro-info-card">
              <div class="ro-card-top">
                <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(s.settlementId)}">
                  <span class="color-dot" style="background:${s.settlementColor}"></span>
                  ${escapeHtml(s.settlementName)}
                </button>
                <span class="ro-pill-badge">${s.youngCount} young</span>
              </div>
              <div class="ro-card-metrics">
                <span>🐣 ${s.newbornCount} newborn · ${s.juvenileCount} juv</span>
                <span>❤️ ${s.bondedPairs} pairs</span>
                <span>🏡 ${s.population}/${s.housingCapacity} beds</span>
              </div>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;

    const youngTableHtml =
      filteredEntries.length === 0
        ? `<div class="cmodal-empty">No young woodland kin${this.youngVillageFilter === 'all' ? ' yet — bonded pairs will raise litters once settled and well-fed.' : ' in this village right now.'}</div>`
        : `
        <div class="cmodal-table-wrap">
          <table class="creature-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Species &amp; Stage</th>
                <th>Growth to Adult</th>
                <th>Village</th>
                <th>Parents</th>
                <th>Activity</th>
                <th class="col-num">Mood</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredEntries
                .map((e) => {
                  const stageClass = e.lifeStage === 'young' ? 'stage-young' : 'stage-juvenile';
                  const stageText =
                    e.lifeStage === 'young'
                      ? e.youngTerm[0].toUpperCase() + e.youngTerm.slice(1)
                      : 'Juvenile';
                  const parentsHtml =
                    e.parents.length > 0
                      ? e.parents
                          .map(
                            (p) =>
                              `<button type="button" class="ro-inline-link" data-action="inspect" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`,
                          )
                          .join(' &amp; ')
                      : '<span class="ro-muted">Foundling</span>';

                  return `
                  <tr class="c-row">
                    <td>
                      <button type="button" class="c-name-btn" data-action="inspect" data-id="${escapeHtml(e.id)}" title="${escapeHtml(e.thought)}">
                        <span class="c-name-text">${escapeHtml(e.name)}</span>
                      </button>
                      <span class="ro-gen-tag">G${e.generation}</span>
                    </td>
                    <td>
                      <span class="species-chip">
                        <span class="color-dot" style="background:${e.speciesColor}"></span>
                        ${escapeHtml(e.speciesName)}
                      </span>
                      <span class="stage-badge ${stageClass}">${escapeHtml(stageText)}</span>
                    </td>
                    <td>
                      <div class="ro-progress-cell" title="${e.ageDays.toFixed(2)}d old · ${e.daysToAdulthood.toFixed(1)}d until adulthood">
                        <div class="ro-progress-track"><div class="ro-progress-fill" style="width:${e.growthPct}%"></div></div>
                        <span class="ro-progress-text">${e.growthPct}% · ${e.ageDays.toFixed(1)}d</span>
                      </div>
                    </td>
                    <td>
                      <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(e.settlementId)}">
                        <span class="color-dot small" style="background:${e.settlementColor}"></span>
                        ${escapeHtml(e.settlementName)}
                      </button>
                    </td>
                    <td>${parentsHtml}${e.littermatesCount > 0 ? ` <span class="ro-muted">(+${e.littermatesCount} sib)</span>` : ''}</td>
                    <td>${escapeHtml(e.activity)}</td>
                    <td class="col-num">${e.mood}%</td>
                    <td class="col-actions">
                      <button type="button" class="c-act-btn" data-action="lineage" data-id="${escapeHtml(e.id)}" title="Open Family Tree">🌳</button>
                      <button type="button" class="c-act-btn" data-action="inspect" data-id="${escapeHtml(e.id)}" title="Inspect creature">🔍</button>
                      <button type="button" class="c-act-btn" data-action="pov" data-id="${escapeHtml(e.id)}" title="Enter Creature Eye View">👁</button>
                    </td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;

    const pairsHtml =
      snap.bondedPairs.length === 0
        ? ''
        : `
        <div class="ro-section">
          <div class="ro-section-head">
            <h3>Bonded Woodland Pairs (${snap.bondedPairs.length})</h3>
            <span class="ro-muted">Couples that raise future litters</span>
          </div>
          <div class="ro-card-grid">
            ${snap.bondedPairs
              .slice(0, 12)
              .map(
                (p) => `
              <div class="ro-info-card">
                <div class="ro-card-top">
                  <span class="species-chip">
                    <span class="color-dot" style="background:${p.speciesColor}"></span>
                    <button type="button" class="ro-inline-link" data-action="inspect" data-id="${escapeHtml(p.firstId)}">${escapeHtml(p.firstName)}</button>
                    <span class="ro-muted">&amp;</span>
                    <button type="button" class="ro-inline-link" data-action="inspect" data-id="${escapeHtml(p.secondId)}">${escapeHtml(p.secondName)}</button>
                  </span>
                  <span class="ro-status-pill ${p.readyToNest ? 'is-ready' : ''}">${p.readyToNest ? 'Nesting Ready' : `${p.livingOffspring} kin`}</span>
                </div>
                <div class="ro-card-metrics">
                  <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(p.settlementId)}">
                    <span class="color-dot small" style="background:${p.settlementColor}"></span>
                    ${escapeHtml(p.settlementName)}
                  </button>
                  <span>${escapeHtml(p.speciesName)} · ${p.livingOffspring} living offspring</span>
                </div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      `;

    return `
      ${kpiHtml}
      ${nurseryCardsHtml}
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Growing Kin (${filteredEntries.length})</h3>
        </div>
        ${youngTableHtml}
      </div>
      ${pairsHtml}
    `;
  }

  /* =========================================================================
     TAB 2: BUILDINGS & PUBLIC WORKS
     ========================================================================= */
  private renderBuildingsTab(world: WorldState): string {
    const snap = buildBuildingsSummary(world);
    const totalActive = snap.underConstruction + snap.disassembling + snap.bridgesInProgress;
    this.setSummaryText(
      `${snap.completedBuildings} completed buildings · ${totalActive} active works · ${snap.completedBridges} bridges · ${snap.totalPopulation}/${snap.totalHousingCapacity} housing`,
    );

    if (
      this.buildingVillageFilter !== 'all' &&
      !world.settlements.some((s) => s.id === this.buildingVillageFilter)
    ) {
      this.buildingVillageFilter = 'all';
    }

    const filteredBuildings = snap.buildings.filter((b) => {
      if (this.buildingVillageFilter !== 'all' && b.settlementId !== this.buildingVillageFilter) {
        return false;
      }
      if (this.buildingStatusFilter === 'active') return !b.completed;
      if (this.buildingStatusFilter === 'completed') return b.completed;
      return true;
    });

    const villageOptions = [
      `<option value="all"${this.buildingVillageFilter === 'all' ? ' selected' : ''}>All Villages</option>`,
      ...snap.settlements.map(
        (s) =>
          `<option value="${escapeHtml(s.settlementId)}"${this.buildingVillageFilter === s.settlementId ? ' selected' : ''}>${escapeHtml(s.settlementName)} (${s.completedCount})</option>`,
      ),
    ].join('');

    const kpiHtml = `
      <div class="ro-kpi-grid">
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Completed Bldgs</span>
          <strong class="ro-kpi-value">${snap.completedBuildings}</strong>
          <span class="ro-kpi-sub">${snap.distinctTypes} distinct architectural types</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Active Works</span>
          <strong class="ro-kpi-value">${snap.underConstruction + snap.disassembling}</strong>
          <span class="ro-kpi-sub">${snap.underConstruction} building · ${snap.disassembling} redeveloping</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Housing Beds</span>
          <strong class="ro-kpi-value">${snap.totalPopulation} / ${snap.totalHousingCapacity}</strong>
          <span class="ro-kpi-sub">${Math.max(0, snap.totalHousingCapacity - snap.totalPopulation)} open beds across realm</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Bridges</span>
          <strong class="ro-kpi-value">${snap.completedBridges}</strong>
          <span class="ro-kpi-sub">${snap.bridgesInProgress} span${snap.bridgesInProgress === 1 ? '' : 's'} under construction</span>
        </div>
      </div>
    `;

    const settlementCardsHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Civic Growth by Settlement</h3>
        </div>
        <div class="ro-card-grid">
          ${snap.settlements
            .map(
              (s) => `
            <div class="ro-info-card">
              <div class="ro-card-top">
                <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(s.settlementId)}">
                  <span class="color-dot" style="background:${s.settlementColor}"></span>
                  ${escapeHtml(s.settlementName)}
                </button>
                <span class="ro-pill-badge">${s.adaptationIcon} ${escapeHtml(s.tier[0].toUpperCase() + s.tier.slice(1))}</span>
              </div>
              <div class="ro-card-metrics">
                <span>🏡 ${s.completedCount} done${s.activeCount > 0 ? ` · 🔨 ${s.activeCount} active` : ''}</span>
                <span>🛏 ${s.population}/${s.housingCapacity}</span>
                <span>✨ ${s.prosperity} prosp.</span>
              </div>
              ${
                s.nextPlannedName
                  ? `<div class="ro-card-foot">Next planned: <strong>${escapeHtml(s.nextPlannedName)}</strong></div>`
                  : ''
              }
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;

    const activeWorksHtml =
      snap.activeWorks.length === 0
        ? ''
        : `
        <div class="ro-section">
          <div class="ro-section-head">
            <h3>Active Construction Sites (${snap.activeWorks.length})</h3>
            <span class="ro-muted">Click Fly To to watch builders at work</span>
          </div>
          <div class="ro-card-grid">
            ${snap.activeWorks
              .map(
                (w) => `
              <div class="ro-info-card is-highlight">
                <div class="ro-card-top">
                  <strong>${w.disassembling ? '♻️' : '🔨'} ${escapeHtml(w.displayName)}${w.replacementName ? ` → ${escapeHtml(w.replacementName)}` : ''}</strong>
                  <button type="button" class="c-act-btn" data-action="fly-pos" data-x="${w.position.x.toFixed(2)}" data-z="${w.position.z.toFixed(2)}" title="Fly camera to construction site">📍 Fly To</button>
                </div>
                <div class="ro-progress-cell">
                  <div class="ro-progress-track"><div class="ro-progress-fill ${w.disassembling ? 'is-amber' : ''}" style="width:${w.progress}%"></div></div>
                  <span class="ro-progress-text">${w.progress}%</span>
                </div>
                <div class="ro-card-metrics">
                  <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(w.settlementId)}">
                    <span class="color-dot small" style="background:${w.settlementColor}"></span>
                    ${escapeHtml(w.settlementName)}
                  </button>
                  <span>${escapeHtml(w.stageLabel)}</span>
                </div>
                <div class="ro-card-foot">
                  ${
                    w.assignedBuilders.length > 0
                      ? `Builders: ${w.assignedBuilders
                          .map(
                            (b) =>
                              `<button type="button" class="ro-inline-link" data-action="inspect" data-id="${escapeHtml(b.id)}">${escapeHtml(b.name)}</button>`,
                          )
                          .join(', ')}`
                      : '<span class="ro-muted">Awaiting available builder</span>'
                  }
                </div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      `;

    const catalogChipsHtml =
      snap.catalogCounts.length === 0
        ? ''
        : `
        <div class="ro-section">
          <div class="ro-section-head">
            <h3>Architectural Mix</h3>
          </div>
          <div class="ro-chip-cloud">
            ${snap.catalogCounts
              .map(
                (c) =>
                  `<span class="ro-arch-chip">${escapeHtml(c.displayName)} <strong>${c.completed}</strong>${c.inProgress > 0 ? ` <em class="ro-muted">(+${c.inProgress})</em>` : ''}</span>`,
              )
              .join('')}
          </div>
        </div>
      `;

    const buildingsTableHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Structure Directory (${filteredBuildings.length})</h3>
          <div class="ro-filter-row">
            <select class="hud-select cmodal-select" data-filter="bldg-village">${villageOptions}</select>
            <select class="hud-select cmodal-select" data-filter="bldg-status">
              <option value="all"${this.buildingStatusFilter === 'all' ? ' selected' : ''}>All Statuses</option>
              <option value="active"${this.buildingStatusFilter === 'active' ? ' selected' : ''}>Under Construction</option>
              <option value="completed"${this.buildingStatusFilter === 'completed' ? ' selected' : ''}>Completed</option>
            </select>
          </div>
        </div>
        ${
          filteredBuildings.length === 0
            ? '<div class="cmodal-empty">No structures match this filter.</div>'
            : `
            <div class="cmodal-table-wrap">
              <table class="creature-table">
                <thead>
                  <tr>
                    <th>Structure</th>
                    <th>Settlement</th>
                    <th>Status / Stage</th>
                    <th class="col-num">Housing</th>
                    <th class="col-num">Prosperity</th>
                    <th class="col-num">Devotion</th>
                    <th class="col-actions">View</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredBuildings
                    .map(
                      (b) => `
                    <tr class="c-row">
                      <td title="${escapeHtml(b.description)}">
                        <strong>${escapeHtml(b.displayName)}</strong>
                        <span class="ro-gen-tag">${b.frameStyle === 'masonry' ? 'Stone' : 'Timber'}</span>
                      </td>
                      <td>
                        <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(b.settlementId)}">
                          <span class="color-dot small" style="background:${b.settlementColor}"></span>
                          ${escapeHtml(b.settlementName)}
                        </button>
                      </td>
                      <td>
                        ${
                          b.completed
                            ? '<span class="ro-status-pill is-ready">Completed</span>'
                            : `<div class="ro-progress-cell"><div class="ro-progress-track"><div class="ro-progress-fill ${b.disassembling ? 'is-amber' : ''}" style="width:${b.progress}%"></div></div><span class="ro-progress-text">${b.progress}% · ${escapeHtml(b.stageLabel)}</span></div>`
                        }
                      </td>
                      <td class="col-num">${b.housingCapacity > 0 ? `+${b.housingCapacity}` : '—'}</td>
                      <td class="col-num">+${b.prosperityValue}</td>
                      <td class="col-num">${b.devotionValue > 0 ? `+${b.devotionValue}` : '—'}</td>
                      <td class="col-actions">
                        <button type="button" class="c-act-btn" data-action="fly-pos" data-x="${b.position.x.toFixed(2)}" data-z="${b.position.z.toFixed(2)}" title="Fly to structure">📍</button>
                      </td>
                    </tr>
                  `,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `
        }
      </div>
    `;

    const bridgesHtml =
      snap.bridges.length === 0
        ? ''
        : `
        <div class="ro-section">
          <div class="ro-section-head">
            <h3>Waterway Bridges (${snap.bridges.length})</h3>
          </div>
          <div class="cmodal-table-wrap">
            <table class="creature-table">
              <thead>
                <tr>
                  <th>Bridge</th>
                  <th>Sponsor Settlement</th>
                  <th class="col-num">Span</th>
                  <th>Status</th>
                  <th class="col-actions">View</th>
                </tr>
              </thead>
              <tbody>
                ${snap.bridges
                  .map(
                    (br) => `
                  <tr class="c-row">
                    <td><strong>${escapeHtml(br.displayName)}</strong></td>
                    <td>
                      <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(br.settlementId)}">
                        <span class="color-dot small" style="background:${br.settlementColor}"></span>
                        ${escapeHtml(br.settlementName)}
                      </button>
                    </td>
                    <td class="col-num">${br.length}m</td>
                    <td>
                      ${
                        br.completed
                          ? '<span class="ro-status-pill is-ready">Open</span>'
                          : `<div class="ro-progress-cell"><div class="ro-progress-track"><div class="ro-progress-fill" style="width:${br.progress}%"></div></div><span class="ro-progress-text">${br.progress}%</span></div>`
                      }
                    </td>
                    <td class="col-actions">
                      <button type="button" class="c-act-btn" data-action="fly-pos" data-x="${br.position.x.toFixed(2)}" data-z="${br.position.z.toFixed(2)}" title="Fly to bridge">📍</button>
                    </td>
                  </tr>
                `,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

    return `
      ${kpiHtml}
      ${settlementCardsHtml}
      ${activeWorksHtml}
      ${catalogChipsHtml}
      ${buildingsTableHtml}
      ${bridgesHtml}
    `;
  }

  /* =========================================================================
     TAB 3: TRADE & CARAVANS
     ========================================================================= */
  private renderTradeTab(world: WorldState): string {
    const snap = buildTradeSummary(world);
    this.setSummaryText(
      `${snap.activeCaravans} active caravan${snap.activeCaravans === 1 ? '' : 's'} on ${snap.activeRoutes} route${snap.activeRoutes === 1 ? '' : 's'} · ${snap.totalTradeVolume} completed trades · ${snap.totalTreasury} realm treasury`,
    );

    const kpiHtml = `
      <div class="ro-kpi-grid">
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Active Caravans</span>
          <strong class="ro-kpi-value">${snap.activeCaravans}</strong>
          <span class="ro-kpi-sub">${snap.totalMerchants} merchants across realm</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Active Routes</span>
          <strong class="ro-kpi-value">${snap.activeRoutes}</strong>
          <span class="ro-kpi-sub">${snap.alliedPairs} allied · ${snap.warPairs} at war</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Completed Trades</span>
          <strong class="ro-kpi-value">${snap.totalTradeVolume}</strong>
          <span class="ro-kpi-sub">Cumulative village exchanges</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Realm Treasury</span>
          <strong class="ro-kpi-value">${snap.totalTreasury}</strong>
          <span class="ro-kpi-sub">Combined acorn-coin reserves</span>
        </div>
      </div>
    `;

    const caravansHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Active Merchant Caravans (${snap.caravans.length})</h3>
        </div>
        ${
          snap.caravans.length === 0
            ? '<div class="cmodal-empty">No merchant caravans are currently on the road. Merchants dispatch once a village builds surplus goods and has peaceful trading partners.</div>'
            : `
            <div class="cmodal-table-wrap">
              <table class="creature-table">
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Route</th>
                    <th>Cargo</th>
                    <th>Journey</th>
                    <th class="col-num">Wealth</th>
                    <th class="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${snap.caravans
                    .map(
                      (c) => `
                    <tr class="c-row">
                      <td>
                        <button type="button" class="c-name-btn" data-action="inspect" data-id="${escapeHtml(c.creatureId)}">
                          <span class="color-dot" style="background:${c.speciesColor}"></span>
                          <span class="c-name-text">${escapeHtml(c.merchantName)}</span>
                        </button>
                        <span class="ro-muted">${escapeHtml(c.speciesName)}</span>
                      </td>
                      <td>
                        <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(c.originId)}">
                          <span class="color-dot small" style="background:${c.originColor}"></span>
                          ${escapeHtml(c.originName)}
                        </button>
                        <span class="ro-arrow">→</span>
                        ${
                          c.destinationId
                            ? `<button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(c.destinationId)}"><span class="color-dot small" style="background:${c.destinationColor}"></span>${escapeHtml(c.destinationName)}</button>`
                            : `<span class="ro-muted">${escapeHtml(c.destinationName)}</span>`
                        }
                      </td>
                      <td>
                        ${
                          c.cargoGood
                            ? `<span class="ro-res-chip">${RESOURCE_ICONS[c.cargoGood]} ${c.cargoAmount} ${escapeHtml(c.cargoGood)}</span>`
                            : '<span class="ro-muted">Returning</span>'
                        }
                      </td>
                      <td>
                        <div class="ro-progress-cell">
                          <div class="ro-progress-track"><div class="ro-progress-fill" style="width:${c.progressPct}%"></div></div>
                          <span class="ro-progress-text">${c.progressPct}% · ${c.remainingDist}m</span>
                        </div>
                      </td>
                      <td class="col-num">${c.wealth}</td>
                      <td class="col-actions">
                        <button type="button" class="c-act-btn" data-action="inspect" data-id="${escapeHtml(c.creatureId)}" title="Inspect merchant">🔍</button>
                        <button type="button" class="c-act-btn" data-action="pov" data-id="${escapeHtml(c.creatureId)}" title="Ride along in Eye View">👁</button>
                        <button type="button" class="c-act-btn" data-action="fly-pos" data-x="${c.position.x.toFixed(2)}" data-z="${c.position.z.toFixed(2)}" title="Fly to caravan">📍</button>
                      </td>
                    </tr>
                  `,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `
        }
      </div>
    `;

    const routesHtml =
      snap.routes.length === 0
        ? ''
        : `
        <div class="ro-section">
          <div class="ro-section-head">
            <h3>Active Cross-Biome Corridors (${snap.routes.length})</h3>
          </div>
          <div class="ro-card-grid">
            ${snap.routes
              .map(
                (r) => `
              <div class="ro-info-card">
                <div class="ro-card-top">
                  <span>
                    <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(r.fromId)}">
                      <span class="color-dot small" style="background:${r.fromColor}"></span>${escapeHtml(r.fromName)}
                    </button>
                    <span class="ro-arrow">↔</span>
                    <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(r.toId)}">
                      <span class="color-dot small" style="background:${r.toColor}"></span>${escapeHtml(r.toName)}
                    </button>
                  </span>
                  <span class="ro-stance-pill stance-${r.stance}">${escapeHtml(r.stance)} (${r.relationScore > 0 ? `+${r.relationScore}` : r.relationScore})</span>
                </div>
                <div class="ro-card-metrics">
                  <span>⚖️ ${r.activeCaravans} caravan${r.activeCaravans === 1 ? '' : 's'} active</span>
                  <span>${escapeHtml(r.fromAdaptation)} ↔ ${escapeHtml(r.toAdaptation)}</span>
                </div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      `;

    const economyTableHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Village Commerce &amp; Regional Specialties</h3>
        </div>
        <div class="cmodal-table-wrap">
          <table class="creature-table">
            <thead>
              <tr>
                <th>Settlement</th>
                <th class="col-num">Treasury</th>
                <th class="col-num">Trades</th>
                <th class="col-num">Markets</th>
                <th>Export Specialties</th>
                <th>Import Needs</th>
                <th>Key Stockpile</th>
              </tr>
            </thead>
            <tbody>
              ${snap.settlements
                .map(
                  (s) => `
                <tr class="c-row">
                  <td>
                    <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(s.settlementId)}">
                      <span class="color-dot small" style="background:${s.settlementColor}"></span>
                      ${escapeHtml(s.settlementName)}
                    </button>
                    <span class="ro-muted">${s.adaptationIcon}</span>
                  </td>
                  <td class="col-num"><strong>${s.treasury}</strong></td>
                  <td class="col-num">${s.tradeVolume}</td>
                  <td class="col-num">${s.marketCount}</td>
                  <td>${formatResourceTags(s.exportSpecialties)}</td>
                  <td>${formatResourceTags(s.importNeeds)}</td>
                  <td class="ro-stockpile-cell">
                    🪵${s.stockpile.timber} 🫐${s.stockpile.berries} 🌰${s.stockpile.acorns} 🪨${s.stockpile.stone} 🌿${s.stockpile.herbs} 🏺${s.stockpile.crafts}
                  </td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const recentTradesHtml =
      snap.recentTrades.length === 0
        ? ''
        : `
        <div class="ro-section">
          <div class="ro-section-head">
            <h3>Recent Trade Ledger</h3>
          </div>
          <div class="ro-ledger-list">
            ${snap.recentTrades
              .map(
                (entry) => `
              <div class="ro-ledger-item">
                <div class="ro-ledger-text">
                  <span class="ro-ledger-day">Day ${entry.timestampDay}</span>
                  <span>${escapeHtml(entry.detail)}</span>
                </div>
                ${
                  entry.position
                    ? `<button type="button" class="c-act-btn" data-action="fly-pos" data-x="${entry.position.x.toFixed(2)}" data-z="${entry.position.z.toFixed(2)}" title="Fly to destination">📍</button>`
                    : ''
                }
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      `;

    return `
      ${kpiHtml}
      ${caravansHtml}
      ${routesHtml}
      ${economyTableHtml}
      ${recentTradesHtml}
    `;
  }

  /* =========================================================================
     TAB 4: PIONEERS & FRONTIER
     ========================================================================= */
  private renderPioneersTab(world: WorldState): string {
    const snap = buildPioneersSummary(world);
    this.setSummaryText(
      snap.activeParties > 0
        ? `${snap.activeParties} active expedition${snap.activeParties === 1 ? '' : 's'} (${snap.totalPioneers} pioneers) · ${snap.settlementCount}/${snap.maxSettlements} settlements`
        : `No expeditions en route · ${snap.settlementCount}/${snap.maxSettlements} settlements (${snap.canExpandMore ? 'frontier open' : 'realm cap reached'})`,
    );

    const kpiHtml = `
      <div class="ro-kpi-grid">
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Active Expeditions</span>
          <strong class="ro-kpi-value">${snap.activeParties}</strong>
          <span class="ro-kpi-sub">${snap.totalPioneers} pioneers trekking overland</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Realm Settlements</span>
          <strong class="ro-kpi-value">${snap.settlementCount} / ${snap.maxSettlements}</strong>
          <span class="ro-kpi-sub">${snap.canExpandMore ? `${snap.maxSettlements - snap.settlementCount - snap.activeParties} frontier slots open` : 'Maximum realm settlements'}</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Ready Sponsors</span>
          <strong class="ro-kpi-value">${snap.readiness.filter((r) => r.ready).length}</strong>
          <span class="ro-kpi-sub">Villages meeting expedition thresholds</span>
        </div>
        <div class="ro-kpi-card">
          <span class="ro-kpi-label">Founded Villages</span>
          <strong class="ro-kpi-value">${snap.foundedHistory.length}</strong>
          <span class="ro-kpi-sub">Recorded in the Living Chronicle</span>
        </div>
      </div>
    `;

    const partiesHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Active Pioneer Expeditions (${snap.parties.length})</h3>
        </div>
        ${
          snap.parties.length === 0
            ? `<div class="cmodal-empty">${
                snap.canExpandMore
                  ? 'No pioneer parties are currently trekking across the wilderness. Thriving villages with 10+ kin, 3+ completed buildings, and surplus timber &amp; food will dispatch settlers to colonize new biomes.'
                  : 'The realm has reached its maximum number of settlements — all frontier horizons are now home to thriving woodland villages.'
              }</div>`
            : `
            <div class="ro-party-list">
              ${snap.parties
                .map(
                  (party) => `
                <div class="ro-info-card is-highlight">
                  <div class="ro-card-top">
                    <div>
                      <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(party.sourceSettlementId)}">
                        <span class="color-dot" style="background:${party.sourceSettlementColor}"></span>
                        ${escapeHtml(party.sourceSettlementName)}
                      </button>
                      <span class="ro-arrow">→</span>
                      <strong>${party.targetAdaptationIcon} ${escapeHtml(party.targetAdaptationTitle)}</strong>
                      <span class="ro-muted">(${escapeHtml(party.targetBiomeName)})</span>
                    </div>
                    <div class="ro-btn-group">
                      <button type="button" class="c-act-btn" data-action="fly-pos" data-x="${party.partyPosition.x.toFixed(2)}" data-z="${party.partyPosition.z.toFixed(2)}" title="Fly to pioneer party">🧭 Party</button>
                      <button type="button" class="c-act-btn" data-action="fly-pos" data-x="${party.targetPosition.x.toFixed(2)}" data-z="${party.targetPosition.z.toFixed(2)}" title="Preview destination frontier site">📍 Site</button>
                    </div>
                  </div>
                  <div class="ro-progress-cell">
                    <div class="ro-progress-track"><div class="ro-progress-fill" style="width:${party.progressPct}%"></div></div>
                    <span class="ro-progress-text">${party.progressPct}% · ${party.remainingDist}m to frontier</span>
                  </div>
                  <div class="ro-member-list">
                    ${party.members
                      .map(
                        (m) => `
                      <div class="ro-member-row">
                        <span class="species-chip">
                          <span class="color-dot small" style="background:${m.speciesColor}"></span>
                          <button type="button" class="ro-inline-link" data-action="inspect" data-id="${escapeHtml(m.id)}">${escapeHtml(m.name)}</button>
                          <span class="ro-muted">${escapeHtml(m.speciesName)} · ${escapeHtml(m.role)}</span>
                        </span>
                        <span class="ro-member-meta">
                          <span>❤️ ${m.health}/${m.maxHealth}</span>
                          <span>😊 ${m.mood}%</span>
                          <button type="button" class="c-act-btn" data-action="inspect" data-id="${escapeHtml(m.id)}" title="Inspect pioneer">🔍</button>
                          <button type="button" class="c-act-btn" data-action="pov" data-id="${escapeHtml(m.id)}" title="Walk with pioneer in Eye View">👁</button>
                        </span>
                      </div>
                    `,
                      )
                      .join('')}
                  </div>
                </div>
              `,
                )
                .join('')}
            </div>
          `
        }
      </div>
    `;

    const readinessHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Settlement Expedition Readiness</h3>
          <span class="ro-muted">Thresholds to launch a new pioneer party</span>
        </div>
        <div class="cmodal-table-wrap">
          <table class="creature-table">
            <thead>
              <tr>
                <th>Settlement</th>
                <th class="col-num">Kin</th>
                <th class="col-num">Bldgs</th>
                <th class="col-num">Timber</th>
                <th class="col-num">Food</th>
                <th class="col-num">Adults</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${snap.readiness
                .map(
                  (r) => `
                <tr class="c-row">
                  <td>
                    <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(r.settlementId)}">
                      <span class="color-dot small" style="background:${r.settlementColor}"></span>
                      ${escapeHtml(r.settlementName)}
                    </button>
                  </td>
                  <td class="col-num">${r.population}/${r.minPopulation}</td>
                  <td class="col-num">${r.completedBuildings}/${r.minBuildings}</td>
                  <td class="col-num">${r.timber}/10</td>
                  <td class="col-num">${r.food}/10</td>
                  <td class="col-num">${r.eligibleAdults}/3</td>
                  <td>
                    <span class="ro-status-pill ${r.ready ? 'is-ready' : ''}">${escapeHtml(r.blockerSummary)}</span>
                  </td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const historyHtml =
      snap.foundedHistory.length === 0
        ? ''
        : `
        <div class="ro-section">
          <div class="ro-section-head">
            <h3>Frontier &amp; Founding Chronicle</h3>
          </div>
          <div class="ro-ledger-list">
            ${snap.foundedHistory
              .map(
                (entry) => `
              <div class="ro-ledger-item">
                <div class="ro-ledger-text">
                  <span class="ro-ledger-day">Day ${entry.timestampDay}</span>
                  <strong>${escapeHtml(entry.title)}</strong>
                  <span class="ro-muted">— ${escapeHtml(entry.detail)}</span>
                </div>
                ${
                  entry.position
                    ? `<button type="button" class="c-act-btn" data-action="fly-pos" data-x="${entry.position.x.toFixed(2)}" data-z="${entry.position.z.toFixed(2)}" title="Fly to settlement">📍</button>`
                    : ''
                }
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      `;

    return `
      ${kpiHtml}
      ${partiesHtml}
      ${readinessHtml}
      ${historyHtml}
    `;
  }

  private handleBodyChange(e: Event): void {
    const target = e.target as HTMLSelectElement | null;
    if (!target || !target.dataset.filter) return;

    switch (target.dataset.filter) {
      case 'young-village':
        this.youngVillageFilter = target.value;
        break;
      case 'bldg-village':
        this.buildingVillageFilter = target.value;
        break;
      case 'bldg-status':
        this.buildingStatusFilter = target.value as 'all' | 'active' | 'completed';
        break;
    }

    if (this.lastWorld) {
      this.render(this.lastWorld);
    }
  }

  private handleBodyClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    switch (action) {
      case 'inspect':
        if (id) {
          this.close();
          this.callbacks.onInspectCreature(id);
        }
        break;
      case 'pov':
        if (id) {
          this.close();
          this.callbacks.onEnterCreaturePov(id);
        }
        break;
      case 'lineage':
        if (id) {
          this.close();
          this.callbacks.onOpenLineage(id);
        }
        break;
      case 'focus-village': {
        const villageId = actionEl.dataset.villageId;
        if (villageId) {
          this.close();
          this.callbacks.onFocusSettlement(villageId);
        }
        break;
      }
      case 'fly-pos': {
        const x = Number(actionEl.dataset.x);
        const z = Number(actionEl.dataset.z);
        if (Number.isFinite(x) && Number.isFinite(z)) {
          this.close();
          this.callbacks.onFocusPosition({ x, z });
        }
        break;
      }
    }
  }
}
