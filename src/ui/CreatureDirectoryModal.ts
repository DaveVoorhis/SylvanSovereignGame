import type { LifeStage, SpeciesId } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';
import {
  buildCreatureDirectorySnapshot,
  collectLineageHighlightIds,
  filterCreatureEntries,
  filterLineageTrees,
  sortCreatureEntries,
  sortLineageTrees,
  type CreatureDirectoryEntry,
  type CreatureDirectorySnapshot,
  type CreatureFilterState,
  type CreatureSortKey,
  type FamilyTreeNode,
  type LineageFamilyTree,
  type LineageSortKey,
  type SortDirection,
} from './CreatureDirectoryLogic';

export type DirectoryViewMode = 'table' | 'tree';

export interface CreatureDirectoryCallbacks {
  onClose: () => void;
  onInspectCreature: (creatureId: string) => void;
  onEnterCreaturePov: (creatureId: string) => void;
  onFocusSettlement: (settlementId: string) => void;
}

const NUMERIC_SORT_KEYS = new Set<CreatureSortKey>([
  'age',
  'generation',
  'mood',
  'health',
  'wealth',
  'offspring',
]);

const TABLE_SORT_OPTIONS: { key: CreatureSortKey; label: string }[] = [
  { key: 'species', label: 'Species' },
  { key: 'lineage', label: 'Lineage' },
  { key: 'age', label: 'Age' },
  { key: 'name', label: 'Name' },
  { key: 'generation', label: 'Generation' },
  { key: 'village', label: 'Village' },
  { key: 'role', label: 'Role' },
  { key: 'activity', label: 'Activity' },
  { key: 'lifeStage', label: 'Life Stage' },
  { key: 'mood', label: 'Mood' },
  { key: 'health', label: 'Health' },
  { key: 'wealth', label: 'Wealth' },
  { key: 'offspring', label: 'Offspring' },
];

const TREE_SORT_OPTIONS: { key: LineageSortKey; label: string }[] = [
  { key: 'size', label: 'Largest Bloodline' },
  { key: 'depth', label: 'Deepest Generations' },
  { key: 'living', label: 'Most Living Kin' },
  { key: 'species', label: 'Species' },
  { key: 'founder', label: 'Bloodline Name' },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAge(days: number): string {
  return `${days.toFixed(1)}d`;
}

/**
 * Interactive Woodland Census & Family Tree modal displaying all creatures
 * in a sortable table as well as hierarchical multi-generation bloodline trees.
 */
export class CreatureDirectoryModal {
  readonly element: HTMLElement;
  private readonly modalCard: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly tableTabBtn: HTMLButtonElement;
  private readonly treeTabBtn: HTMLButtonElement;
  private readonly searchInput: HTMLInputElement;
  private readonly speciesSelect: HTMLSelectElement;
  private readonly villageSelect: HTMLSelectElement;
  private readonly stageSelect: HTMLSelectElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly sortDirBtn: HTMLButtonElement;
  private readonly fallenCheckbox: HTMLInputElement;
  private readonly fallenLabelText: HTMLElement;
  private readonly bodyEl: HTMLElement;

  private open = false;
  private viewMode: DirectoryViewMode = 'table';
  private tableSortKey: CreatureSortKey = 'species';
  private tableSortDir: SortDirection = 'asc';
  private treeSortKey: LineageSortKey = 'size';
  private treeSortDir: SortDirection = 'desc';
  private filter: CreatureFilterState = {
    search: '',
    species: 'all',
    settlementId: 'all',
    lifeStage: 'all',
    includeFallen: false,
  };

  private focusedCreatureId: string | null = null;
  private collapsedTreeIds = new Set<string>();
  private showUnbondedFounders = false;
  private lastWorld: WorldState | null = null;
  private lastSnapshot: CreatureDirectorySnapshot | null = null;
  private lastSpeciesOptionSig = '';
  private lastVillageOptionSig = '';
  private refreshAccumSec = 0;

  constructor(private readonly callbacks: CreatureDirectoryCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'creature-modal-backdrop hidden';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Woodland Census & Lineages');

    // Clicking the backdrop closes the modal
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    });

    // Prevent wheel/pointer events from leaking through to the 3D camera
    const stopPropagation = (e: Event) => e.stopPropagation();
    for (const evt of ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'dblclick']) {
      this.element.addEventListener(evt, stopPropagation);
    }

    this.modalCard = document.createElement('div');
    this.modalCard.className = 'creature-modal glass-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'cmodal-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'cmodal-title-wrap';
    const title = document.createElement('h2');
    title.className = 'cmodal-title';
    title.textContent = 'Woodland Census & Lineages';
    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'cmodal-summary';
    titleWrap.append(title, this.summaryEl);

    const headerRight = document.createElement('div');
    headerRight.className = 'cmodal-header-right';

    const modeSwitch = document.createElement('div');
    modeSwitch.className = 'cmodal-tabs';

    this.tableTabBtn = document.createElement('button');
    this.tableTabBtn.type = 'button';
    this.tableTabBtn.className = 'cmodal-tab active';
    this.tableTabBtn.textContent = '📋 Census Table';
    this.tableTabBtn.addEventListener('click', () => this.setViewMode('table'));

    this.treeTabBtn = document.createElement('button');
    this.treeTabBtn.type = 'button';
    this.treeTabBtn.className = 'cmodal-tab';
    this.treeTabBtn.textContent = '🌳 Family Trees';
    this.treeTabBtn.addEventListener('click', () => this.setViewMode('tree'));

    modeSwitch.append(this.tableTabBtn, this.treeTabBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cmodal-close';
    closeBtn.title = 'Close (Esc)';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    headerRight.append(modeSwitch, closeBtn);
    header.append(titleWrap, headerRight);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'cmodal-toolbar';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'cmodal-search';
    this.searchInput.placeholder = 'Search name, species, bloodline, village…';
    this.searchInput.addEventListener('input', () => {
      this.filter.search = this.searchInput.value;
      this.renderBody();
    });

    this.speciesSelect = document.createElement('select');
    this.speciesSelect.className = 'hud-select cmodal-select';
    this.speciesSelect.title = 'Filter by species';
    this.speciesSelect.addEventListener('change', () => {
      this.filter.species = this.speciesSelect.value as SpeciesId | 'all';
      this.renderBody();
    });

    this.villageSelect = document.createElement('select');
    this.villageSelect.className = 'hud-select cmodal-select';
    this.villageSelect.title = 'Filter by village';
    this.villageSelect.addEventListener('change', () => {
      this.filter.settlementId = this.villageSelect.value;
      this.renderBody();
    });

    this.stageSelect = document.createElement('select');
    this.stageSelect.className = 'hud-select cmodal-select';
    this.stageSelect.title = 'Filter by life stage';
    const stageOptions: [LifeStage | 'all', string][] = [
      ['all', 'All Stages'],
      ['young', 'Young'],
      ['juvenile', 'Juvenile'],
      ['adult', 'Adult'],
      ['elder', 'Elder'],
    ];
    for (const [val, label] of stageOptions) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      this.stageSelect.appendChild(opt);
    }
    this.stageSelect.addEventListener('change', () => {
      this.filter.lifeStage = this.stageSelect.value as LifeStage | 'all';
      this.renderBody();
    });

    const sortGroup = document.createElement('div');
    sortGroup.className = 'cmodal-sort-group';

    const sortLabel = document.createElement('span');
    sortLabel.className = 'cmodal-sort-label';
    sortLabel.textContent = 'Sort:';

    this.sortSelect = document.createElement('select');
    this.sortSelect.className = 'hud-select cmodal-select';
    this.sortSelect.title = 'Sort order';
    this.sortSelect.addEventListener('change', () => {
      if (this.viewMode === 'table') {
        const key = this.sortSelect.value as CreatureSortKey;
        this.tableSortKey = key;
        this.tableSortDir = NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc';
      } else {
        const key = this.sortSelect.value as LineageSortKey;
        this.treeSortKey = key;
        this.treeSortDir = key === 'species' || key === 'founder' ? 'asc' : 'desc';
      }
      this.syncSortControls();
      this.renderBody();
    });

    this.sortDirBtn = document.createElement('button');
    this.sortDirBtn.type = 'button';
    this.sortDirBtn.className = 'hud-btn cmodal-sort-dir';
    this.sortDirBtn.title = 'Toggle ascending / descending sort';
    this.sortDirBtn.addEventListener('click', () => {
      if (this.viewMode === 'table') {
        this.tableSortDir = this.tableSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.treeSortDir = this.treeSortDir === 'asc' ? 'desc' : 'asc';
      }
      this.syncSortControls();
      this.renderBody();
    });

    sortGroup.append(sortLabel, this.sortSelect, this.sortDirBtn);

    const fallenToggle = document.createElement('label');
    fallenToggle.className = 'cmodal-toggle';
    this.fallenCheckbox = document.createElement('input');
    this.fallenCheckbox.type = 'checkbox';
    this.fallenCheckbox.checked = this.filter.includeFallen;
    this.fallenCheckbox.addEventListener('change', () => {
      this.filter.includeFallen = this.fallenCheckbox.checked;
      this.renderBody();
    });
    this.fallenLabelText = document.createElement('span');
    this.fallenLabelText.textContent = 'Include fallen';
    fallenToggle.append(this.fallenCheckbox, this.fallenLabelText);

    toolbar.append(
      this.searchInput,
      this.speciesSelect,
      this.villageSelect,
      this.stageSelect,
      sortGroup,
      fallenToggle,
    );

    // Scrollable Body
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'cmodal-body';
    this.bodyEl.addEventListener('click', (e) => this.handleBodyClick(e));

    this.modalCard.append(header, toolbar, this.bodyEl);
    this.element.appendChild(this.modalCard);
    this.rebuildSortOptions();
  }

  isOpen(): boolean {
    return this.open;
  }

  openModal(world: WorldState, options?: { mode?: DirectoryViewMode; focusCreatureId?: string }): void {
    this.lastWorld = world;
    this.open = true;
    this.element.classList.remove('hidden');

    if (options?.mode) {
      this.viewMode = options.mode;
    }
    if (options?.focusCreatureId) {
      this.focusedCreatureId = options.focusCreatureId;
      // Clear restrictive filters so the focused creature is guaranteed visible
      this.filter.search = '';
      this.filter.species = 'all';
      this.filter.settlementId = 'all';
      this.filter.lifeStage = 'all';
      this.searchInput.value = '';
      this.speciesSelect.value = 'all';
      this.villageSelect.value = 'all';
      this.stageSelect.value = 'all';
    }

    this.tableTabBtn.classList.toggle('active', this.viewMode === 'table');
    this.treeTabBtn.classList.toggle('active', this.viewMode === 'tree');
    this.rebuildSortOptions();
    this.refreshNow(world);

    if (options?.focusCreatureId) {
      const targetId = options.focusCreatureId;
      const entry = this.lastSnapshot?.entriesById.get(targetId);
      if (entry) {
        this.collapsedTreeIds.delete(entry.lineageId);
        if (!entry.alive) {
          this.filter.includeFallen = true;
          this.fallenCheckbox.checked = true;
        }
        const tree = this.lastSnapshot?.treesByLineageId.get(entry.lineageId);
        if (tree && !tree.hasFamilyBonds) {
          this.showUnbondedFounders = true;
        }
        this.renderBody();
      }
      requestAnimationFrame(() => {
        const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(targetId) : targetId;
        const el = this.bodyEl.querySelector<HTMLElement>(
          `[data-creature-focus="${safeId}"]`,
        );
        el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      });
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.element.classList.add('hidden');
    this.callbacks.onClose();
  }

  toggle(world: WorldState): boolean {
    if (this.open) {
      this.close();
      return false;
    }
    this.openModal(world);
    return true;
  }

  /** Throttled live refresh invoked by HudManager while the modal is open. */
  update(dt: number, world: WorldState, force = false): void {
    this.lastWorld = world;
    if (!this.open) return;
    this.refreshAccumSec += dt;
    if (!force && this.refreshAccumSec < 0.65) return;
    this.refreshAccumSec = 0;
    this.refreshNow(world);
  }

  private setViewMode(mode: DirectoryViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.tableTabBtn.classList.toggle('active', mode === 'table');
    this.treeTabBtn.classList.toggle('active', mode === 'tree');
    this.rebuildSortOptions();
    this.renderBody();
  }

  private rebuildSortOptions(): void {
    this.sortSelect.innerHTML = '';
    if (this.viewMode === 'table') {
      for (const opt of TABLE_SORT_OPTIONS) {
        const el = document.createElement('option');
        el.value = opt.key;
        el.textContent = opt.label;
        this.sortSelect.appendChild(el);
      }
    } else {
      for (const opt of TREE_SORT_OPTIONS) {
        const el = document.createElement('option');
        el.value = opt.key;
        el.textContent = opt.label;
        this.sortSelect.appendChild(el);
      }
    }
    this.syncSortControls();
  }

  private syncSortControls(): void {
    if (this.viewMode === 'table') {
      this.sortSelect.value = this.tableSortKey;
      this.sortDirBtn.textContent = this.tableSortDir === 'asc' ? '▲ Asc' : '▼ Desc';
    } else {
      this.sortSelect.value = this.treeSortKey;
      this.sortDirBtn.textContent = this.treeSortDir === 'asc' ? '▲ Asc' : '▼ Desc';
    }
  }

  private refreshNow(world: WorldState): void {
    this.lastSnapshot = buildCreatureDirectorySnapshot(world.creatures, world.settlements);
    this.updateSummaryAndFilters(this.lastSnapshot, world);
    this.renderBody();
  }

  private updateSummaryAndFilters(snapshot: CreatureDirectorySnapshot, world: WorldState): void {
    this.summaryEl.textContent =
      `${snapshot.totalLiving} living kin · ${snapshot.speciesCount} species · ` +
      `${snapshot.familyLineCount} bloodlines · Max Gen ${snapshot.maxGeneration}` +
      (snapshot.totalFallen > 0 ? ` · ${snapshot.totalFallen} fallen` : '');

    this.fallenLabelText.textContent =
      snapshot.totalFallen > 0 ? `Fallen (${snapshot.totalFallen})` : 'Include fallen';

    // Update species dropdown only when species set changes
    const speciesMap = new Map<SpeciesId, string>();
    for (const e of snapshot.entries) {
      if (!speciesMap.has(e.species)) speciesMap.set(e.species, e.speciesName);
    }
    const sortedSpecies = [...speciesMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const speciesSig = sortedSpecies.map(([id]) => id).join(',');
    if (speciesSig !== this.lastSpeciesOptionSig) {
      this.lastSpeciesOptionSig = speciesSig;
      const prev = this.filter.species;
      this.speciesSelect.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = `All Species (${sortedSpecies.length})`;
      this.speciesSelect.appendChild(allOpt);
      for (const [id, name] of sortedSpecies) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        this.speciesSelect.appendChild(opt);
      }
      this.speciesSelect.value = speciesMap.has(prev as SpeciesId) ? prev : 'all';
      this.filter.species = this.speciesSelect.value as SpeciesId | 'all';
    }

    // Update village dropdown only when settlement list changes
    const villageSig = world.settlements.map((s) => `${s.id}:${s.name}`).join('|');
    if (villageSig !== this.lastVillageOptionSig) {
      this.lastVillageOptionSig = villageSig;
      const prev = this.filter.settlementId;
      this.villageSelect.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = `All Villages (${world.settlements.length})`;
      this.villageSelect.appendChild(allOpt);
      for (const s of world.settlements) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        this.villageSelect.appendChild(opt);
      }
      const stillExists = world.settlements.some((s) => s.id === prev);
      this.villageSelect.value = stillExists ? prev : 'all';
      this.filter.settlementId = this.villageSelect.value;
    }
  }

  private renderBody(): void {
    if (!this.lastSnapshot) return;
    const prevScrollTop = this.bodyEl.scrollTop;
    const prevScrollLeft = this.bodyEl.scrollLeft;

    if (this.viewMode === 'table') {
      this.renderTableView(this.lastSnapshot);
    } else {
      this.renderFamilyTreeView(this.lastSnapshot);
    }

    this.bodyEl.scrollTop = prevScrollTop;
    this.bodyEl.scrollLeft = prevScrollLeft;
  }

  private renderTableView(snapshot: CreatureDirectorySnapshot): void {
    const filtered = filterCreatureEntries(snapshot.entries, this.filter);
    const sorted = sortCreatureEntries(filtered, this.tableSortKey, this.tableSortDir);

    const sortArrow = (key: CreatureSortKey): string => {
      if (this.tableSortKey !== key) return '<span class="sort-ind">⇅</span>';
      return `<span class="sort-ind active">${this.tableSortDir === 'asc' ? '▲' : '▼'}</span>`;
    };

    const thClass = (key: CreatureSortKey, extra = ''): string =>
      `sortable${this.tableSortKey === key ? ' is-sorted' : ''}${extra ? ` ${extra}` : ''}`;

    const rowsHtml =
      sorted.length === 0
        ? `<tr><td colspan="11" class="cmodal-empty">No creatures match the active filters.</td></tr>`
        : sorted
            .map((e) => {
              const rowClasses = [
                'c-row',
                !e.alive ? 'is-fallen' : '',
                this.focusedCreatureId === e.id ? 'is-focused' : '',
              ]
                .filter(Boolean)
                .join(' ');

              const stageClass = !e.alive ? 'stage-fallen' : `stage-${e.lifeStage}`;
              const moodClass =
                e.mood >= 72 ? 'stat-good' : e.mood >= 42 ? 'stat-mid' : 'stat-low';
              const healthClass =
                e.healthPct >= 70 ? 'stat-good' : e.healthPct >= 35 ? 'stat-mid' : 'stat-low';

              const kinMeta: string[] = [];
              if (e.mateName) kinMeta.push(`♥ ${e.mateName.split(' ')[0]}`);
              if (e.offspringCount > 0) kinMeta.push(`${e.offspringCount} young`);
              const kinTitle = [
                `Bloodline: ${e.lineageName} (Gen ${e.generation})`,
                e.parentNames.length > 0 ? `Parents: ${e.parentNames.join(' & ')}` : 'Founding generation',
                e.mateName ? `Mate: ${e.mateName}` : null,
                e.offspringCount > 0
                  ? `Offspring: ${e.offspringCount} (${e.livingOffspringCount} living)`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');

              return `
                <tr class="${rowClasses}" data-creature-focus="${escapeHtml(e.id)}">
                  <td class="col-name">
                    <button type="button" class="c-name-btn" data-action="inspect" data-id="${escapeHtml(e.id)}" title="${escapeHtml(e.thought)}">
                      ${!e.alive ? '<span class="fallen-mark" title="Fallen">†</span>' : ''}
                      <span class="c-name-text">${escapeHtml(e.name)}</span>
                    </button>
                  </td>
                  <td class="col-species">
                    <span class="species-chip">
                      <span class="color-dot" style="background:${e.speciesColorHex}"></span>
                      ${escapeHtml(e.speciesName)}
                    </span>
                  </td>
                  <td class="col-lineage">
                    <button type="button" class="lineage-pill-btn" data-action="open-tree" data-id="${escapeHtml(e.id)}" title="${escapeHtml(kinTitle)}">
                      <span class="lineage-pill-name">🌳 ${escapeHtml(e.lineageName)}</span>
                      ${kinMeta.length > 0 ? `<span class="lineage-pill-meta">${escapeHtml(kinMeta.join(' · '))}</span>` : ''}
                    </button>
                  </td>
                  <td class="col-num col-gen">G${e.generation}</td>
                  <td class="col-age">
                    <span class="num-val">${formatAge(e.ageDays)}</span>
                    <span class="stage-badge ${stageClass}">${escapeHtml(e.lifeStageLabel)}</span>
                  </td>
                  <td class="col-village">
                    <button type="button" class="village-link-btn" data-action="focus-village" data-village-id="${escapeHtml(e.settlementId)}">
                      <span class="color-dot" style="background:${e.settlementColorHex}"></span>
                      ${escapeHtml(e.settlementName)}
                    </button>
                  </td>
                  <td class="col-role">${escapeHtml(e.roleLabel)}</td>
                  <td class="col-activity">${escapeHtml(e.activityLabel)}</td>
                  <td class="col-num">
                    <span class="stat-pill ${moodClass}" title="Health ${Math.round(e.healthPct)}% · Mood ${Math.round(e.mood)}%">
                      ${Math.round(e.mood)}%
                    </span>
                    <span class="health-mini-bar" title="Health ${Math.round(e.health)} / ${Math.round(e.maxHealth)}">
                      <span class="health-mini-fill ${healthClass}" style="width:${Math.round(e.healthPct)}%"></span>
                    </span>
                  </td>
                  <td class="col-num">${Math.round(e.wealth)}</td>
                  <td class="col-actions">
                    <button type="button" class="row-icon-btn" data-action="inspect" data-id="${escapeHtml(e.id)}" title="Locate & inspect creature">🎯</button>
                    ${
                      e.alive
                        ? `<button type="button" class="row-icon-btn" data-action="pov" data-id="${escapeHtml(e.id)}" title="Enter Creature Eye View">👁</button>`
                        : ''
                    }
                    <button type="button" class="row-icon-btn" data-action="open-tree" data-id="${escapeHtml(e.id)}" title="View family tree">🌳</button>
                  </td>
                </tr>
              `;
            })
            .join('');

    this.bodyEl.innerHTML = `
      <div class="cmodal-table-meta">
        Showing <strong>${sorted.length}</strong> of ${snapshot.entries.length} recorded creatures · Click any column header to sort, or click a bloodline to view its family tree.
      </div>
      <div class="cmodal-table-wrap">
        <table class="creature-table">
          <thead>
            <tr>
              <th class="${thClass('name')}" data-sort="name">Name ${sortArrow('name')}</th>
              <th class="${thClass('species')}" data-sort="species">Species ${sortArrow('species')}</th>
              <th class="${thClass('lineage')}" data-sort="lineage">Lineage ${sortArrow('lineage')}</th>
              <th class="${thClass('generation', 'col-num')}" data-sort="generation">Gen ${sortArrow('generation')}</th>
              <th class="${thClass('age')}" data-sort="age">Age & Stage ${sortArrow('age')}</th>
              <th class="${thClass('village')}" data-sort="village">Village ${sortArrow('village')}</th>
              <th class="${thClass('role')}" data-sort="role">Role ${sortArrow('role')}</th>
              <th class="${thClass('activity')}" data-sort="activity">Activity ${sortArrow('activity')}</th>
              <th class="${thClass('mood', 'col-num')}" data-sort="mood">Mood / HP ${sortArrow('mood')}</th>
              <th class="${thClass('wealth', 'col-num')}" data-sort="wealth">Acorns ${sortArrow('wealth')}</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  private renderFamilyTreeView(snapshot: CreatureDirectorySnapshot): void {
    const filteredTrees = filterLineageTrees(snapshot.trees, this.filter);
    const sortedTrees = sortLineageTrees(filteredTrees, this.treeSortKey, this.treeSortDir);

    const familyTrees = sortedTrees.filter((t) => t.hasFamilyBonds);
    const soloTrees = sortedTrees.filter((t) => !t.hasFamilyBonds);

    const focusedEntry = this.focusedCreatureId
      ? snapshot.entriesById.get(this.focusedCreatureId)
      : undefined;

    const focusBannerHtml = focusedEntry
      ? `
        <div class="lineage-focus-banner">
          <div class="lineage-focus-info">
            <span class="color-dot" style="background:${focusedEntry.speciesColorHex}"></span>
            <strong>${escapeHtml(focusedEntry.name)}</strong>
            <span>(${escapeHtml(focusedEntry.speciesName)} · Gen ${focusedEntry.generation} · ${escapeHtml(focusedEntry.lineageName)})</span>
            ${
              focusedEntry.parentNames.length > 0
                ? `<span class="lineage-focus-rel">Parents: ${escapeHtml(focusedEntry.parentNames.join(' & '))}</span>`
                : `<span class="lineage-focus-rel">Founding Ancestor</span>`
            }
            ${
              focusedEntry.mateName
                ? `<span class="lineage-focus-rel">♥ ${escapeHtml(focusedEntry.mateName)}</span>`
                : ''
            }
          </div>
          <div class="lineage-focus-actions">
            <button type="button" class="hud-btn small" data-action="inspect" data-id="${escapeHtml(focusedEntry.id)}">🎯 Locate</button>
            ${
              focusedEntry.alive
                ? `<button type="button" class="hud-btn small accent" data-action="pov" data-id="${escapeHtml(focusedEntry.id)}">👁 Eye View</button>`
                : ''
            }
            <button type="button" class="hud-btn small" data-action="clear-focus">Clear Highlight</button>
          </div>
        </div>
      `
      : '';

    const familyCardsHtml = familyTrees
      .map((tree) => this.renderLineageCard(tree))
      .join('');

    const soloSectionHtml =
      soloTrees.length > 0
        ? `
          <div class="solo-founders-section">
            <button type="button" class="solo-founders-toggle" data-action="toggle-solo">
              <span>${this.showUnbondedFounders || familyTrees.length === 0 ? '▾' : '▸'} Unbonded Founding Kin (${soloTrees.length})</span>
              <small>Creatures who have not yet paired or raised young</small>
            </button>
            ${
              this.showUnbondedFounders || familyTrees.length === 0
                ? `<div class="solo-founders-grid">
                    ${soloTrees
                      .map((t) => this.renderPersonCard(t.root.primary, false, false, false))
                      .join('')}
                  </div>`
                : ''
            }
          </div>
        `
        : '';

    const emptyHtml =
      sortedTrees.length === 0
        ? `<div class="cmodal-empty">No bloodlines match the active filters.</div>`
        : '';

    this.bodyEl.innerHTML = `
      <div class="cmodal-table-meta">
        Showing <strong>${familyTrees.length}</strong> bonded family ${familyTrees.length === 1 ? 'tree' : 'trees'}
        ${soloTrees.length > 0 ? `and <strong>${soloTrees.length}</strong> unbonded founders` : ''} ·
        Click any creature node to trace its direct ancestry and descendants.
      </div>
      ${focusBannerHtml}
      ${emptyHtml}
      <div class="lineage-forest">${familyCardsHtml}</div>
      ${soloSectionHtml}
    `;
  }

  private renderLineageCard(tree: LineageFamilyTree): string {
    const collapsed = this.collapsedTreeIds.has(tree.lineageId);
    const hasFocused =
      this.focusedCreatureId !== null && tree.memberIds.has(this.focusedCreatureId);
    const highlightIds =
      hasFocused && this.focusedCreatureId
        ? collectLineageHighlightIds(tree, this.focusedCreatureId)
        : null;

    const speciesBadges = tree.speciesList
      .map(
        (sp) =>
          `<span class="species-chip"><span class="color-dot" style="background:${sp.colorHex}"></span>${escapeHtml(sp.name)}</span>`,
      )
      .join('');

    const villagesText =
      tree.settlementNames.length <= 2
        ? tree.settlementNames.join(', ')
        : `${tree.settlementNames.slice(0, 2).join(', ')} +${tree.settlementNames.length - 2}`;

    return `
      <section class="lineage-card${hasFocused ? ' has-focus' : ''}${collapsed ? ' is-collapsed' : ''}" data-lineage-id="${escapeHtml(tree.lineageId)}">
        <div class="lineage-card-header" data-action="toggle-tree" data-lineage-id="${escapeHtml(tree.lineageId)}">
          <div class="lineage-card-title-group">
            <span class="lineage-chevron">${collapsed ? '▸' : '▾'}</span>
            <h3 class="lineage-card-title">${escapeHtml(tree.lineageName)}</h3>
            ${speciesBadges}
          </div>
          <div class="lineage-card-meta">
            <span class="lineage-meta-pill">${tree.livingMembers} living${tree.fallenMembers > 0 ? ` · ${tree.fallenMembers} †` : ''}</span>
            <span class="lineage-meta-pill">${tree.maxGeneration} ${tree.maxGeneration === 1 ? 'gen' : 'gens'}</span>
            <span class="lineage-meta-villages">${escapeHtml(villagesText)}</span>
          </div>
        </div>
        ${
          collapsed
            ? ''
            : `<div class="lineage-tree-scroll">
                <div class="lineage-tree-root">
                  ${this.renderTreeNode(tree.root, highlightIds)}
                </div>
              </div>`
        }
      </section>
    `;
  }

  private renderTreeNode(node: FamilyTreeNode, highlightIds: Set<string> | null): string {
    const primaryHighlighted = highlightIds ? highlightIds.has(node.primary.id) : false;
    const primaryFocused = this.focusedCreatureId === node.primary.id;
    const primaryDimmed = highlightIds !== null && !primaryHighlighted;

    let coupleHtml: string;
    if (node.mate) {
      const mateHighlighted = highlightIds ? highlightIds.has(node.mate.id) : false;
      const mateFocused = this.focusedCreatureId === node.mate.id;
      const mateDimmed = highlightIds !== null && !mateHighlighted;

      coupleHtml = `
        <div class="tree-couple">
          ${this.renderPersonCard(node.primary, primaryFocused, primaryHighlighted, primaryDimmed)}
          <span class="tree-bond-heart" title="Bonded mates">♥</span>
          ${this.renderPersonCard(
            node.mate,
            mateFocused,
            mateHighlighted,
            mateDimmed,
            node.mateIsCrossLineage ? node.mate.lineageName : undefined,
          )}
        </div>
      `;
    } else {
      coupleHtml = this.renderPersonCard(
        node.primary,
        primaryFocused,
        primaryHighlighted,
        primaryDimmed,
      );
    }

    const childrenHtml =
      node.children.length > 0
        ? `
          <ul class="tree-children">
            ${node.children
              .map((child) => `<li class="tree-branch">${this.renderTreeNode(child, highlightIds)}</li>`)
              .join('')}
          </ul>
        `
        : '';

    return `
      <div class="tree-node-wrap">
        ${coupleHtml}
        ${childrenHtml}
      </div>
    `;
  }

  private renderPersonCard(
    entry: CreatureDirectoryEntry,
    isFocused: boolean,
    isHighlighted: boolean,
    isDimmed: boolean,
    crossLineageLabel?: string,
  ): string {
    const classes = [
      'tree-person',
      !entry.alive ? 'is-fallen' : '',
      isFocused ? 'is-focused' : '',
      isHighlighted && !isFocused ? 'is-highlighted' : '',
      isDimmed ? 'is-dimmed' : '',
      crossLineageLabel ? 'is-married-in' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const stageClass = !entry.alive ? 'stage-fallen' : `stage-${entry.lifeStage}`;

    return `
      <div class="${classes}" data-creature-focus="${escapeHtml(entry.id)}" data-action="select-node" data-id="${escapeHtml(entry.id)}">
        <div class="tree-person-top">
          <span class="color-dot" style="background:${entry.speciesColorHex}"></span>
          <span class="tree-person-name" title="${escapeHtml(entry.name)}">
            ${!entry.alive ? '<span class="fallen-mark">†</span>' : ''}${escapeHtml(entry.name)}
          </span>
          <span class="tree-gen-tag">G${entry.generation}</span>
        </div>
        <div class="tree-person-sub">
          <span class="stage-badge ${stageClass}">${escapeHtml(entry.lifeStageLabel)}</span>
          <span class="num-val">${formatAge(entry.ageDays)}</span>
          <span>· ${escapeHtml(entry.roleLabel)}</span>
        </div>
        <div class="tree-person-foot">
          <span class="tree-person-village" title="${escapeHtml(entry.settlementName)}">
            <span class="color-dot small" style="background:${entry.settlementColorHex}"></span>
            ${escapeHtml(entry.settlementName)}
          </span>
          <span class="tree-person-actions">
            <button type="button" class="mini-act-btn" data-action="inspect" data-id="${escapeHtml(entry.id)}" title="Locate & inspect">🎯</button>
            ${
              entry.alive
                ? `<button type="button" class="mini-act-btn" data-action="pov" data-id="${escapeHtml(entry.id)}" title="Creature Eye View">👁</button>`
                : ''
            }
          </span>
        </div>
        ${
          crossLineageLabel
            ? `<button type="button" class="tree-origin-link" data-action="open-tree" data-id="${escapeHtml(entry.id)}" title="Jump to birth bloodline">↗ ${escapeHtml(crossLineageLabel)}</button>`
            : ''
        }
      </div>
    `;
  }

  private handleBodyClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Column header sorting in table view
    const th = target.closest<HTMLElement>('th[data-sort]');
    if (th && this.viewMode === 'table') {
      const key = th.dataset.sort as CreatureSortKey;
      if (this.tableSortKey === key) {
        this.tableSortDir = this.tableSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.tableSortKey = key;
        this.tableSortDir = NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc';
      }
      this.syncSortControls();
      this.renderBody();
      return;
    }

    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    switch (action) {
      case 'inspect':
        if (id) {
          this.focusedCreatureId = id;
          this.close();
          this.callbacks.onInspectCreature(id);
        }
        break;
      case 'pov':
        if (id) {
          this.focusedCreatureId = id;
          this.close();
          this.callbacks.onEnterCreaturePov(id);
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
      case 'open-tree':
        if (id && this.lastWorld) {
          this.openModal(this.lastWorld, { mode: 'tree', focusCreatureId: id });
        }
        break;
      case 'select-node':
        if (id) {
          this.focusedCreatureId = this.focusedCreatureId === id ? null : id;
          this.renderBody();
        }
        break;
      case 'clear-focus':
        this.focusedCreatureId = null;
        this.renderBody();
        break;
      case 'toggle-tree': {
        const lineageId = actionEl.dataset.lineageId;
        if (lineageId) {
          if (this.collapsedTreeIds.has(lineageId)) {
            this.collapsedTreeIds.delete(lineageId);
          } else {
            this.collapsedTreeIds.add(lineageId);
          }
          this.renderBody();
        }
        break;
      }
      case 'toggle-solo':
        this.showUnbondedFounders = !this.showUnbondedFounders;
        this.renderBody();
        break;
    }
  }
}
