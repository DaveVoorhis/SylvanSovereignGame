import type { QualityPreset } from '@core/Config';
import type { Season, SelectionTarget, Vec2, WeatherType } from '@core/Types';
import { DIVINE_EVENT_CATALOG } from '@simulation/deity/DivineEvents';
import { getBiomeDisplayName } from '@simulation/settlements/VillageAdaptation';
import { formatWarPhaseLabel } from '@simulation/society/WarSystem';
import type { WorldState } from '@simulation/WorldState';
import { bindDialogPill, type DialogPillHandle } from './DialogPillController';
import type { RealmOverviewTab } from './RealmOverviewLogic';

export interface TopBarCallbacks {
  onSetSpeed: (speed: number) => void;
  onToggleCinematic: () => boolean;
  onToggleCreatureView: () => void;
  isCreatureDirectoryOpen: () => boolean;
  onSetCreatureDirectoryOpen: (open: boolean) => void;
  isRealmOverviewTabOpen: (tab: RealmOverviewTab) => boolean;
  onOpenRealmOverviewTab: (tab: RealmOverviewTab) => void;
  onCloseRealmOverview: () => void;
  isDeityPanelOpen: () => boolean;
  onSetDeityPanelOpen: (open: boolean) => void;
  isChroniclePanelOpen: () => boolean;
  onSetChroniclePanelOpen: (open: boolean) => void;
  isSaveModalOpen: () => boolean;
  onSetSaveModalOpen: (open: boolean) => void;
  onToggleFullscreen: () => void;
  onToggleZenMode: () => void;
  onToggleMute: () => boolean;
  onResetOverview: () => void;
  onNewWorld: () => void;
  onChangeQuality: (preset: QualityPreset) => void;
  onFocusSettlement: (settlementId: string) => void;
  onFocusPosition: (pos: Vec2) => void;
  onCloseInspector: () => void;
}

interface TelemetrySlotNodes {
  readonly root: HTMLButtonElement;
  readonly valueEl: HTMLElement;
  readonly pillHandle: DialogPillHandle;
  lastEmpty: boolean | null;
}

interface SettlementOptionNodes {
  readonly button: HTMLButtonElement;
  readonly dotEl: HTMLElement;
  readonly iconEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly statusEl: HTMLElement;
  readonly metaLabelEl: HTMLElement;
  readonly popEl: HTMLElement;
  readonly pillHandle: DialogPillHandle;
  readonly tooltipState: { base: string };
  lastBannerHex: string;
  lastWar: boolean;
  lastCel: boolean;
  lastScope: string | null;
  lastStatusClass: string;
  lastSelected: boolean | null;
}

const SEASON_ICONS: Record<Season, string> = {
  spring: '🌸',
  summer: '☀️',
  autumn: '🍂',
  winter: '❄️',
};

const WEATHER_ICONS: Record<WeatherType, string> = {
  clear: '☀️',
  sunbeams: '✨',
  mist: '🌫️',
  rain: '🌧️',
  storm: '⛈️',
  snow: '🌨️',
  blossom: '🌸',
};

export class TopBar {
  readonly element: HTMLElement;

  // Temporal capsule slots (updated in-place — never torn down)
  private readonly dayValueEl: HTMLElement;
  private readonly timeValueEl: HTMLElement;
  private readonly seasonIconEl: HTMLElement;
  private readonly seasonTextEl: HTMLElement;
  private readonly weatherIconEl: HTMLElement;
  private readonly weatherTextEl: HTMLElement;

  // Telemetry strip slots (always mounted so sibling layout never shifts)
  private readonly kinBtn: HTMLButtonElement;
  private readonly kinValueEl: HTMLElement;
  private readonly youngSlot: TelemetrySlotNodes;
  private readonly buildingsSlot: TelemetrySlotNodes;
  private readonly tradeSlot: TelemetrySlotNodes;
  private readonly pioneersSlot: TelemetrySlotNodes;

  // Controls
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly cinematicBtn: HTMLButtonElement;
  private readonly povToggleBtn: HTMLButtonElement;
  private readonly deityBtn: HTMLButtonElement;
  private readonly chronicleBtn: HTMLButtonElement;
  private readonly fullscreenBtn: HTMLButtonElement;
  private readonly zenBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly qualitySelect: HTMLSelectElement;

  // Shared dialog-pill handles so every dialog-opening pill toggles open/close consistently
  private readonly kinPill: DialogPillHandle;
  private readonly deityPill: DialogPillHandle;
  private readonly chroniclePill: DialogPillHandle;
  private readonly savePill: DialogPillHandle;
  private readonly eventPill: DialogPillHandle;

  // Band 2: compact Villages dropdown + dedicated right-anchored event & panel slot
  private readonly villageDropdownEl: HTMLElement;
  private readonly villageTriggerBtn: HTMLButtonElement;
  private readonly villageTriggerDotEl: HTMLElement;
  private readonly villageTriggerIconEl: HTMLElement;
  private readonly villageTriggerLabelEl: HTMLElement;
  private readonly villageTriggerMetaEl: HTMLElement;
  private readonly villageTriggerAdaptEl: HTMLElement;
  private readonly villageTriggerPopEl: HTMLElement;
  private readonly villageTriggerCountEl: HTMLElement;
  private readonly villageTriggerWarBadgeEl: HTMLElement;
  private readonly villageTriggerCelBadgeEl: HTMLElement;
  private readonly villageMenuEl: HTMLElement;
  private readonly villageMenuCountEl: HTMLElement;
  private readonly villageMenuSummaryEl: HTMLElement;
  private readonly villageListEl: HTMLElement;
  private readonly settlementOptions = new Map<string, SettlementOptionNodes>();
  private villageMenuOpen = false;
  private lastTriggerHasSelection = false;
  private lastTriggerBannerHex = '';
  private lastTriggerWar = false;
  private lastTriggerCel = false;
  private lastTriggerScope: string | null = null;
  private lastTriggerWarBadgeVisible = false;
  private lastTriggerCelBadgeVisible = false;
  private readonly onDocumentPointerDownBound: (ev: Event) => void;

  private readonly deityEventBadgeEl: HTMLButtonElement;
  private readonly deityEventIconEl: HTMLElement;
  private readonly deityEventTextEl: HTMLElement;
  private activeInfluencePos: Vec2 | null = null;
  private readonly eventBadgeEl: HTMLButtonElement;
  private readonly eventIconEl: HTMLElement;
  private readonly eventTextEl: HTMLElement;
  private activeSelection: SelectionTarget = null;
  private activeEventSettlementIds: string[] = [];
  private eventTooltipClosed = '';
  private eventTooltipOpen = '';
  private lastInCreaturePov = false;
  private lastDeityBadgeClass = 'is-hidden';
  private lastDeityBadgeDisabled = true;
  private lastEventBadgeClass = 'is-idle';
  private lastEventBadgeDisabled = true;
  private readonly activeSettlementIds = new Set<string>();
  private readonly settlementPopCounts = new Map<string, number>();

  constructor(private readonly callbacks: TopBarCallbacks) {
    this.element = document.createElement('header');
    this.element.className = 'hud-topbar glass-panel';

    // === BAND 1: Main Bar (3-zone stable grid) ===
    const mainRow = document.createElement('div');
    mainRow.className = 'topbar-main';

    // Left Zone: Brand + Temporal Capsule
    const leftZone = document.createElement('div');
    leftZone.className = 'topbar-left';

    const brand = document.createElement('div');
    brand.className = 'topbar-brand';
    const brandTitle = document.createElement('span');
    brandTitle.className = 'brand-title';
    brandTitle.textContent = 'Sylvan Sovereign';
    const brandSub = document.createElement('span');
    brandSub.className = 'brand-sub';
    brandSub.textContent = 'Living Woodland Realm';
    brand.append(brandTitle, brandSub);

    const clockCapsule = document.createElement('div');
    clockCapsule.className = 'clock-capsule';

    const daySeg = document.createElement('span');
    daySeg.className = 'clock-seg seg-day';
    const dayPrefix = document.createElement('span');
    dayPrefix.className = 'clock-muted';
    dayPrefix.textContent = 'Day';
    this.dayValueEl = document.createElement('span');
    this.dayValueEl.className = 'clock-num';
    this.dayValueEl.textContent = '1';
    daySeg.append(dayPrefix, this.dayValueEl);

    const timeSeg = document.createElement('span');
    timeSeg.className = 'clock-seg seg-time';
    this.timeValueEl = document.createElement('span');
    this.timeValueEl.className = 'clock-num';
    this.timeValueEl.textContent = '08:00';
    timeSeg.appendChild(this.timeValueEl);

    const seasonSeg = document.createElement('span');
    seasonSeg.className = 'clock-seg seg-season';
    this.seasonIconEl = document.createElement('span');
    this.seasonIconEl.className = 'clock-icon';
    this.seasonIconEl.textContent = '🌸';
    this.seasonTextEl = document.createElement('span');
    this.seasonTextEl.textContent = 'Spring';
    seasonSeg.append(this.seasonIconEl, this.seasonTextEl);

    const weatherSeg = document.createElement('span');
    weatherSeg.className = 'clock-seg seg-weather';
    this.weatherIconEl = document.createElement('span');
    this.weatherIconEl.className = 'clock-icon';
    this.weatherIconEl.textContent = '☀️';
    this.weatherTextEl = document.createElement('span');
    this.weatherTextEl.textContent = 'Clear';
    weatherSeg.append(this.weatherIconEl, this.weatherTextEl);

    clockCapsule.append(daySeg, timeSeg, seasonSeg, weatherSeg);
    leftZone.append(brand, clockCapsule);

    // Center Zone: Interactive Telemetry Strip (Census + Young/Bldgs/Trade/Pioneers summaries)
    const telemetry = document.createElement('div');
    telemetry.className = 'topbar-telemetry';

    this.kinBtn = document.createElement('button');
    this.kinBtn.type = 'button';
    this.kinBtn.className = 'telemetry-btn';
    const kinIcon = document.createElement('span');
    kinIcon.className = 'telemetry-icon';
    kinIcon.textContent = '🐾';
    this.kinValueEl = document.createElement('span');
    this.kinValueEl.className = 'telemetry-value';
    this.kinValueEl.textContent = '0';
    const kinLabel = document.createElement('span');
    kinLabel.className = 'telemetry-label';
    kinLabel.textContent = 'Kin';
    const kinCaret = document.createElement('span');
    kinCaret.className = 'telemetry-caret';
    kinCaret.textContent = '🌳';
    this.kinBtn.append(kinIcon, this.kinValueEl, kinLabel, kinCaret);
    this.kinPill = bindDialogPill({
      button: this.kinBtn,
      isOpen: () => this.callbacks.isCreatureDirectoryOpen(),
      open: () => this.callbacks.onSetCreatureDirectoryOpen(true),
      close: () => this.callbacks.onSetCreatureDirectoryOpen(false),
      getTitle: (open) =>
        open
          ? 'Close Woodland Census & Family Trees (C)'
          : 'Open Woodland Census & Family Trees (C)',
    });

    this.youngSlot = this.createTelemetryPill(
      'young',
      '🐣',
      'Young',
      'Nursery & Young Woodland Kin',
    );
    this.buildingsSlot = this.createTelemetryPill(
      'buildings',
      '🏡',
      'Bldgs',
      'Realm Architecture & Public Works',
    );
    this.tradeSlot = this.createTelemetryPill(
      'trade',
      '⚖️',
      'Trade',
      'Caravans, Markets & Trade Ledger',
    );
    this.pioneersSlot = this.createTelemetryPill(
      'pioneers',
      '🧭',
      'Pioneers',
      'Pioneer Expeditions & Frontier',
    );

    telemetry.append(
      this.kinBtn,
      this.youngSlot.root,
      this.buildingsSlot.root,
      this.tradeSlot.root,
      this.pioneersSlot.root,
    );

    // Right Zone: Grouped Controls
    const controls = document.createElement('div');
    controls.className = 'topbar-controls';

    const speedGroup = document.createElement('div');
    speedGroup.className = 'segmented-group';
    const speeds: [string, number, string][] = [
      ['⏸', 0, 'Pause simulation'],
      ['1×', 1, 'Normal speed'],
      ['2×', 2, '2× speed'],
      ['4×', 4, '4× speed'],
    ];
    for (const [label, spd, title] of speeds) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seg-btn';
      btn.textContent = label;
      btn.title = title;
      btn.dataset.speed = String(spd);
      if (spd === 1) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.setActiveSpeed(spd);
        this.callbacks.onSetSpeed(spd);
      });
      this.speedButtons.push(btn);
      speedGroup.appendChild(btn);
    }

    const viewGroup = document.createElement('div');
    viewGroup.className = 'control-group';

    this.povToggleBtn = document.createElement('button');
    this.povToggleBtn.type = 'button';
    this.povToggleBtn.className = 'hud-btn pov-btn';
    this.povToggleBtn.textContent = '👁 Creature View';
    this.povToggleBtn.title = 'View the forest from a creature’s eyes (V)';
    this.povToggleBtn.addEventListener('click', () => this.callbacks.onToggleCreatureView());

    const overviewBtn = document.createElement('button');
    overviewBtn.type = 'button';
    overviewBtn.className = 'hud-btn';
    overviewBtn.textContent = 'Overview';
    overviewBtn.title = 'Zoom out to view the entire country map';
    overviewBtn.addEventListener('click', () => this.callbacks.onResetOverview());

    this.cinematicBtn = document.createElement('button');
    this.cinematicBtn.type = 'button';
    this.cinematicBtn.className = 'hud-btn';
    this.cinematicBtn.textContent = 'Drift';
    this.cinematicBtn.title = 'Toggle gentle cinematic spectator camera orbit';
    this.cinematicBtn.addEventListener('click', () => {
      const active = this.callbacks.onToggleCinematic();
      this.cinematicBtn.classList.toggle('active', active);
    });

    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.type = 'button';
    this.fullscreenBtn.className = 'hud-btn';
    this.fullscreenBtn.textContent = '⛶ Fullscreen';
    this.fullscreenBtn.title = 'Enter full-screen mode (F)';
    this.fullscreenBtn.setAttribute('aria-pressed', 'false');
    this.fullscreenBtn.addEventListener('click', () => this.callbacks.onToggleFullscreen());

    this.zenBtn = document.createElement('button');
    this.zenBtn.type = 'button';
    this.zenBtn.className = 'hud-btn';
    this.zenBtn.textContent = '🌿 Zen';
    this.zenBtn.title = 'Enter full-screen Zen Mode — hide all UI (Z)';
    this.zenBtn.addEventListener('click', () => this.callbacks.onToggleZenMode());

    this.soundBtn = document.createElement('button');
    this.soundBtn.type = 'button';
    this.soundBtn.className = 'hud-btn sound-btn';
    this.soundBtn.textContent = '🔊 Sound';
    this.soundBtn.title = 'Mute sound (M)';
    this.soundBtn.setAttribute('aria-pressed', 'false');
    this.soundBtn.addEventListener('click', () => {
      const muted = this.callbacks.onToggleMute();
      this.setMuted(muted);
    });

    viewGroup.append(
      this.povToggleBtn,
      overviewBtn,
      this.cinematicBtn,
      this.fullscreenBtn,
      this.zenBtn,
      this.soundBtn,
    );

    const worldGroup = document.createElement('div');
    worldGroup.className = 'control-group';

    this.qualitySelect = document.createElement('select');
    this.qualitySelect.className = 'hud-select';
    this.qualitySelect.title = '3D Graphics Quality';
    this.qualitySelect.setAttribute('autocomplete', 'off');
    for (const preset of ['balanced', 'high', 'ultra'] as QualityPreset[]) {
      const opt = document.createElement('option');
      opt.value = preset;
      opt.textContent = `${preset[0].toUpperCase()}${preset.slice(1)} GFX`;
      if (preset === 'high') opt.selected = true;
      this.qualitySelect.appendChild(opt);
    }
    this.qualitySelect.addEventListener('change', () => {
      this.callbacks.onChangeQuality(this.qualitySelect.value as QualityPreset);
    });

    this.saveBtn = document.createElement('button');
    this.saveBtn.type = 'button';
    this.saveBtn.className = 'hud-btn';
    this.saveBtn.textContent = '💾 Saves';
    this.savePill = bindDialogPill({
      button: this.saveBtn,
      isOpen: () => this.callbacks.isSaveModalOpen(),
      open: () => this.callbacks.onSetSaveModalOpen(true),
      close: () => this.callbacks.onSetSaveModalOpen(false),
      getTitle: (open) => (open ? 'Close Saved Realms' : 'Open Saved Realms'),
    });

    const seedBtn = document.createElement('button');
    seedBtn.type = 'button';
    seedBtn.className = 'hud-btn accent';
    seedBtn.textContent = 'New World';
    seedBtn.title = 'Generate a brand-new world';
    seedBtn.addEventListener('click', () => this.callbacks.onNewWorld());

    worldGroup.append(this.qualitySelect, this.saveBtn, seedBtn);
    controls.append(speedGroup, viewGroup, worldGroup);

    mainRow.append(leftZone, telemetry, controls);

    // === BAND 2: Compact Village Dropdown + Right-Anchored Event & Panel Slot ===
    const subRow = document.createElement('div');
    subRow.className = 'topbar-subrow';

    this.villageDropdownEl = document.createElement('div');
    this.villageDropdownEl.className = 'village-dropdown';

    this.villageTriggerBtn = document.createElement('button');
    this.villageTriggerBtn.type = 'button';
    this.villageTriggerBtn.className = 'village-dropdown-trigger';
    this.villageTriggerBtn.setAttribute('aria-haspopup', 'listbox');
    this.villageTriggerBtn.setAttribute('aria-expanded', 'false');
    this.villageTriggerBtn.setAttribute('aria-controls', 'village-dropdown-list');
    this.villageTriggerBtn.title = 'Browse and jump to villages';

    this.villageTriggerDotEl = document.createElement('span');
    this.villageTriggerDotEl.className = 'dot is-hidden';

    this.villageTriggerIconEl = document.createElement('span');
    this.villageTriggerIconEl.className = 'adapt-icon';
    this.villageTriggerIconEl.textContent = '🏘️';

    this.villageTriggerLabelEl = document.createElement('span');
    this.villageTriggerLabelEl.className = 'village-trigger-label';
    this.villageTriggerLabelEl.textContent = 'Villages';

    this.villageTriggerMetaEl = document.createElement('small');
    this.villageTriggerMetaEl.className = 'village-trigger-meta is-hidden';
    this.villageTriggerAdaptEl = document.createElement('span');
    const triggerSepEl = document.createElement('span');
    triggerSepEl.textContent = ' · ';
    this.villageTriggerPopEl = document.createElement('span');
    this.villageTriggerPopEl.className = 'settlement-pop';
    this.villageTriggerMetaEl.append(this.villageTriggerAdaptEl, triggerSepEl, this.villageTriggerPopEl);

    this.villageTriggerCountEl = document.createElement('span');
    this.villageTriggerCountEl.className = 'village-trigger-count';
    this.villageTriggerCountEl.textContent = '0';

    this.villageTriggerWarBadgeEl = document.createElement('span');
    this.villageTriggerWarBadgeEl.className = 'village-alert-badge is-war is-hidden';

    this.villageTriggerCelBadgeEl = document.createElement('span');
    this.villageTriggerCelBadgeEl.className = 'village-alert-badge is-cel is-hidden';

    const triggerChevronEl = document.createElement('span');
    triggerChevronEl.className = 'village-trigger-chevron';
    triggerChevronEl.setAttribute('aria-hidden', 'true');
    triggerChevronEl.textContent = '▾';

    this.villageTriggerBtn.append(
      this.villageTriggerDotEl,
      this.villageTriggerIconEl,
      this.villageTriggerLabelEl,
      this.villageTriggerMetaEl,
      this.villageTriggerCountEl,
      this.villageTriggerWarBadgeEl,
      this.villageTriggerCelBadgeEl,
      triggerChevronEl,
    );
    this.villageTriggerBtn.addEventListener('click', () => {
      this.setVillageMenuOpen(!this.villageMenuOpen);
    });

    this.villageMenuEl = document.createElement('div');
    this.villageMenuEl.className = 'village-dropdown-menu hidden';

    const menuHeader = document.createElement('div');
    menuHeader.className = 'village-dropdown-header';
    const menuTitleGroup = document.createElement('span');
    menuTitleGroup.className = 'village-dropdown-title-group';
    const menuTitleEl = document.createElement('span');
    menuTitleEl.className = 'village-dropdown-title';
    menuTitleEl.textContent = 'Villages';
    this.villageMenuCountEl = document.createElement('span');
    this.villageMenuCountEl.className = 'village-dropdown-count';
    this.villageMenuCountEl.textContent = '0';
    menuTitleGroup.append(menuTitleEl, this.villageMenuCountEl);

    this.villageMenuSummaryEl = document.createElement('span');
    this.villageMenuSummaryEl.className = 'village-dropdown-summary';
    this.villageMenuSummaryEl.textContent = '0 kin';
    menuHeader.append(menuTitleGroup, this.villageMenuSummaryEl);

    this.villageListEl = document.createElement('div');
    this.villageListEl.className = 'village-dropdown-list';
    this.villageListEl.setAttribute('id', 'village-dropdown-list');
    this.villageListEl.setAttribute('role', 'listbox');
    this.villageListEl.setAttribute('aria-label', 'Select a village');

    this.villageMenuEl.append(menuHeader, this.villageListEl);
    this.villageDropdownEl.append(this.villageTriggerBtn, this.villageMenuEl);

    this.villageDropdownEl.addEventListener('keydown', (ev: Event) => {
      this.handleVillageDropdownKeyDown(ev as KeyboardEvent);
    });

    this.onDocumentPointerDownBound = (ev: Event) => {
      if (!this.villageMenuOpen) return;
      const target = ev.target as Node | null;
      if (
        target &&
        typeof this.villageDropdownEl.contains === 'function' &&
        this.villageDropdownEl.contains(target)
      ) {
        return;
      }
      this.setVillageMenuOpen(false);
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('pointerdown', this.onDocumentPointerDownBound);
    }

    const eventSlot = document.createElement('div');
    eventSlot.className = 'topbar-event-slot';

    this.deityEventBadgeEl = document.createElement('button');
    this.deityEventBadgeEl.type = 'button';
    this.deityEventBadgeEl.className = 'deity-event-pill is-hidden';
    this.deityEventBadgeEl.disabled = true;
    this.deityEventIconEl = document.createElement('span');
    this.deityEventIconEl.className = 'cel-slot-icon';
    this.deityEventTextEl = document.createElement('span');
    this.deityEventTextEl.className = 'cel-slot-text';
    this.deityEventBadgeEl.append(this.deityEventIconEl, this.deityEventTextEl);
    this.deityEventBadgeEl.addEventListener('click', () => {
      if (this.activeInfluencePos) {
        this.callbacks.onFocusPosition(this.activeInfluencePos);
      }
    });

    this.eventBadgeEl = document.createElement('button');
    this.eventBadgeEl.type = 'button';
    this.eventBadgeEl.className = 'celebration-pill is-idle';
    this.eventBadgeEl.disabled = true;
    this.eventIconEl = document.createElement('span');
    this.eventIconEl.className = 'cel-slot-icon';
    this.eventTextEl = document.createElement('span');
    this.eventTextEl.className = 'cel-slot-text';
    this.eventBadgeEl.append(this.eventIconEl, this.eventTextEl);
    this.eventPill = bindDialogPill({
      button: this.eventBadgeEl,
      isOpen: () =>
        this.activeEventSettlementIds.length > 0 &&
        this.activeSelection?.kind === 'settlement' &&
        this.activeEventSettlementIds.includes(this.activeSelection.id),
      open: () => {
        const targetId = this.activeEventSettlementIds[0];
        if (targetId) {
          this.callbacks.onFocusSettlement(targetId);
        }
      },
      close: () => this.callbacks.onCloseInspector(),
      getTitle: (open) => (open ? this.eventTooltipOpen : this.eventTooltipClosed),
    });

    const panelGroup = document.createElement('div');
    panelGroup.className = 'panel-toggle-group';

    this.deityBtn = document.createElement('button');
    this.deityBtn.type = 'button';
    this.deityBtn.className = 'hud-btn panel-toggle-btn';
    this.deityBtn.textContent = '✦ Deity';
    this.deityPill = bindDialogPill({
      button: this.deityBtn,
      isOpen: () => this.callbacks.isDeityPanelOpen(),
      open: () => this.callbacks.onSetDeityPanelOpen(true),
      close: () => this.callbacks.onSetDeityPanelOpen(false),
      getTitle: (open) => (open ? 'Close Deity panel' : 'Open Deity panel'),
    });

    this.chronicleBtn = document.createElement('button');
    this.chronicleBtn.type = 'button';
    this.chronicleBtn.className = 'hud-btn panel-toggle-btn';
    this.chronicleBtn.textContent = '📜 Chronicle';
    this.chroniclePill = bindDialogPill({
      button: this.chronicleBtn,
      isOpen: () => this.callbacks.isChroniclePanelOpen(),
      open: () => this.callbacks.onSetChroniclePanelOpen(true),
      close: () => this.callbacks.onSetChroniclePanelOpen(false),
      getTitle: (open) => (open ? 'Close Living Chronicle' : 'Open Living Chronicle'),
    });

    panelGroup.append(this.deityBtn, this.chronicleBtn);
    eventSlot.append(this.deityEventBadgeEl, this.eventBadgeEl, panelGroup);

    subRow.append(this.villageDropdownEl, eventSlot);
    this.element.append(mainRow, subRow);
  }

  isVillageMenuOpen(): boolean {
    return this.villageMenuOpen;
  }

  closeVillageMenu(): void {
    this.setVillageMenuOpen(false);
  }

  private setVillageMenuOpen(open: boolean): void {
    if (this.villageMenuOpen === open) return;
    this.villageMenuOpen = open;
    this.villageMenuEl.classList.toggle('hidden', !open);
    this.villageTriggerBtn.classList.toggle('is-open', open);
    this.element.classList.toggle('village-menu-open', open);
    this.villageTriggerBtn.setAttribute('aria-expanded', String(open));
  }

  private handleVillageDropdownKeyDown(ev: KeyboardEvent): void {
    const options = Array.from(this.settlementOptions.values()).map((n) => n.button);
    if (ev.key === 'Escape') {
      if (!this.villageMenuOpen) return;
      ev.preventDefault();
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
      this.setVillageMenuOpen(false);
      if (typeof this.villageTriggerBtn.focus === 'function') {
        this.villageTriggerBtn.focus();
      }
      return;
    }

    if (options.length === 0) return;

    const focusAt = (index: number): void => {
      const clamped = ((index % options.length) + options.length) % options.length;
      const target = options[clamped];
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    };

    const activeEl = typeof document !== 'undefined' ? (document.activeElement as unknown) : null;
    const currentIdx = options.findIndex((btn) => btn === activeEl);

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (!this.villageMenuOpen) {
        this.setVillageMenuOpen(true);
        const selectedIdx = this.findSelectedOptionIndex(options);
        focusAt(selectedIdx >= 0 ? selectedIdx : 0);
      } else {
        focusAt(currentIdx >= 0 ? currentIdx + 1 : 0);
      }
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!this.villageMenuOpen) {
        this.setVillageMenuOpen(true);
        const selectedIdx = this.findSelectedOptionIndex(options);
        focusAt(selectedIdx >= 0 ? selectedIdx : options.length - 1);
      } else {
        focusAt(currentIdx >= 0 ? currentIdx - 1 : options.length - 1);
      }
    } else if (this.villageMenuOpen && ev.key === 'Home') {
      ev.preventDefault();
      focusAt(0);
    } else if (this.villageMenuOpen && ev.key === 'End') {
      ev.preventDefault();
      focusAt(options.length - 1);
    }
  }

  private findSelectedOptionIndex(options: HTMLButtonElement[]): number {
    if (this.activeSelection?.kind !== 'settlement') return -1;
    const activeId = this.activeSelection.id;
    return options.findIndex((btn) => btn.dataset.settlementId === activeId);
  }

  setActiveSpeed(speed: number): void {
    for (const btn of this.speedButtons) {
      btn.classList.toggle('active', Number(btn.dataset.speed) === speed);
    }
  }

  setFullscreenActive(active: boolean): void {
    this.fullscreenBtn.classList.toggle('active', active);
    this.fullscreenBtn.setAttribute('aria-pressed', String(active));
    this.fullscreenBtn.title = active
      ? 'Exit full-screen mode (F)'
      : 'Enter full-screen mode (F)';
  }

  setZenActive(active: boolean): void {
    this.zenBtn.classList.toggle('active', active);
  }

  setMuted(muted: boolean): void {
    this.soundBtn.textContent = muted ? '🔇 Muted' : '🔊 Sound';
    this.soundBtn.classList.toggle('is-muted', muted);
    this.soundBtn.setAttribute('aria-pressed', String(muted));
    this.soundBtn.title = muted ? 'Unmute sound (M)' : 'Mute sound (M)';
  }

  setCinematicActive(active: boolean): void {
    this.cinematicBtn.classList.toggle('active', active);
  }

  setQualityPreset(preset: QualityPreset): void {
    if (this.qualitySelect.value !== preset) {
      this.qualitySelect.value = preset;
    }
  }

  /** Synchronizes every dialog-opening pill's active, ARIA, and tooltip state. */
  syncDialogPills(): void {
    this.kinPill.sync();
    this.youngSlot.pillHandle.sync();
    this.buildingsSlot.pillHandle.sync();
    this.tradeSlot.pillHandle.sync();
    this.pioneersSlot.pillHandle.sync();
    this.deityPill.sync();
    this.chroniclePill.sync();
    this.savePill.sync();
    this.eventPill.sync();
    for (const [id, nodes] of this.settlementOptions) {
      nodes.pillHandle.sync();
      const selected =
        this.activeSelection?.kind === 'settlement' && this.activeSelection.id === id;
      if (nodes.lastSelected !== selected) {
        nodes.lastSelected = selected;
        nodes.button.setAttribute('aria-selected', String(selected));
      }
    }
  }

  update(world: WorldState, inCreaturePov: boolean, selection: SelectionTarget = null): void {
    this.activeSelection = selection;

    // 1. POV button text (fixed min-width in CSS prevents horizontal shift)
    const nextPovText = inCreaturePov ? '🌍 World View' : '👁 Creature View';
    if (this.povToggleBtn.textContent !== nextPovText) {
      this.povToggleBtn.textContent = nextPovText;
    }
    if (inCreaturePov !== this.lastInCreaturePov) {
      this.lastInCreaturePov = inCreaturePov;
      this.povToggleBtn.classList.toggle('active', inCreaturePov);
    }

    // 2. Temporal Capsule (in-place text updates)
    const hours = Math.floor(world.timeOfDay * 24);
    const mins = Math.floor((world.timeOfDay * 24 - hours) * 60);
    const dayStr = String(world.day);
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    const seasonLabel = world.season[0].toUpperCase() + world.season.slice(1);
    const weatherLabel = world.weather[0].toUpperCase() + world.weather.slice(1);

    if (this.dayValueEl.textContent !== dayStr) this.dayValueEl.textContent = dayStr;
    if (this.timeValueEl.textContent !== timeStr) this.timeValueEl.textContent = timeStr;
    if (this.seasonIconEl.textContent !== SEASON_ICONS[world.season]) {
      this.seasonIconEl.textContent = SEASON_ICONS[world.season];
    }
    if (this.seasonTextEl.textContent !== seasonLabel) {
      this.seasonTextEl.textContent = seasonLabel;
    }
    if (this.weatherIconEl.textContent !== WEATHER_ICONS[world.weather]) {
      this.weatherIconEl.textContent = WEATHER_ICONS[world.weather];
    }
    if (this.weatherTextEl.textContent !== weatherLabel) {
      this.weatherTextEl.textContent = weatherLabel;
    }

    // 3. Single-pass creature telemetry counts (zero layout mount/unmount)
    let aliveCount = 0;
    let youngCount = 0;
    let caravans = 0;
    let pioneerCount = 0;
    let celebratingCount = 0;
    this.settlementPopCounts.clear();

    for (let i = 0; i < world.creatures.length; i++) {
      const c = world.creatures[i];
      if (!c.alive) continue;
      aliveCount++;
      this.settlementPopCounts.set(
        c.settlementId,
        (this.settlementPopCounts.get(c.settlementId) ?? 0) + 1,
      );
      if (c.lifeStage === 'young' || c.lifeStage === 'juvenile') youngCount++;
      if (c.activity === 'trading') caravans++;
      else if (c.activity === 'emigrating') pioneerCount++;
      else if (c.activity === 'celebrating') celebratingCount++;
    }

    const totalBuildings = world.settlements.reduce((sum, s) => sum + s.getCompletedCount(), 0);

    this.setTextIfChanged(this.kinValueEl, String(aliveCount));
    this.updateSlot(this.youngSlot, youngCount);
    this.updateSlot(this.buildingsSlot, totalBuildings);
    this.updateSlot(this.tradeSlot, caravans);
    this.updateSlot(this.pioneersSlot, pioneerCount);

    // 3b. Active Deity Ecological Influence Pill (only visible during rare active epochs)
    const activeInf = world.activeInfluences[0] ?? null;
    if (activeInf) {
      this.activeInfluencePos = { ...activeInf.position };
      if (this.lastDeityBadgeDisabled) {
        this.lastDeityBadgeDisabled = false;
        this.deityEventBadgeEl.disabled = false;
      }
      const nextClass = `polarity-${activeInf.polarity}`;
      if (this.lastDeityBadgeClass !== nextClass) {
        this.deityEventBadgeEl.classList.remove(this.lastDeityBadgeClass);
        this.deityEventBadgeEl.classList.add(nextClass);
        this.lastDeityBadgeClass = nextClass;
      }
      const rem = Math.max(
        0,
        Math.ceil(activeInf.startedAt + activeInf.duration - world.elapsedSeconds),
      );
      const meta = DIVINE_EVENT_CATALOG[activeInf.type];
      this.setTextIfChanged(this.deityEventIconEl, activeInf.icon);
      this.setTextIfChanged(this.deityEventTextEl, `${activeInf.label} (${rem}s)`);
      const nextTitle = `${meta.ecologicalReflection} — Click to fly to epicenter`;
      if (this.deityEventBadgeEl.title !== nextTitle) this.deityEventBadgeEl.title = nextTitle;
    } else {
      this.activeInfluencePos = null;
      if (!this.lastDeityBadgeDisabled) {
        this.lastDeityBadgeDisabled = true;
        this.deityEventBadgeEl.disabled = true;
      }
      if (this.lastDeityBadgeClass !== 'is-hidden') {
        this.deityEventBadgeEl.classList.remove(this.lastDeityBadgeClass);
        this.deityEventBadgeEl.classList.add('is-hidden');
        this.lastDeityBadgeClass = 'is-hidden';
      }
      if (this.deityEventBadgeEl.title !== '') this.deityEventBadgeEl.title = '';
    }

    // 4. Right-anchored Celebration Event Slot (never nudges Band 1 or village dropdown)
    const nationalHoliday = world.festivals.getNationalHoliday();
    const activeRegional = world.festivals.activeCelebrations.find((c) => c.scope === 'regional');
    const activeLocals = world.festivals.activeCelebrations.filter((c) => c.scope === 'local');

    let nextTargets: string[] = [];
    let nextEventBadgeClass = 'is-idle';

    if (nationalHoliday) {
      nextTargets = [
        nationalHoliday.hostSettlementId,
        ...nationalHoliday.participatingSettlementIds.filter(
          (id) => id !== nationalHoliday.hostSettlementId,
        ),
      ];
      const hostName = world.getSettlement(nationalHoliday.hostSettlementId)?.name;
      nextEventBadgeClass = 'scope-national';
      this.eventTooltipClosed = hostName
        ? `${nationalHoliday.theme} — Click to go to ${hostName}`
        : `${nationalHoliday.theme} — Click to visit celebration`;
      this.eventTooltipOpen = `${nationalHoliday.theme} — Click to close inspector`;
      this.setTextIfChanged(this.eventIconEl, nationalHoliday.icon);
      this.setTextIfChanged(this.eventTextEl, `Holiday: ${nationalHoliday.name}`);
    } else if (activeRegional) {
      nextTargets = [activeRegional.hostSettlementId];
      const hostName = world.getSettlement(activeRegional.hostSettlementId)?.name;
      nextEventBadgeClass = 'scope-regional';
      this.eventTooltipClosed = hostName
        ? `${activeRegional.theme} — Click to go to ${hostName}`
        : `${activeRegional.theme} — Click to visit celebration`;
      this.eventTooltipOpen = `${activeRegional.theme} — Click to close inspector`;
      this.setTextIfChanged(this.eventIconEl, activeRegional.icon);
      this.setTextIfChanged(this.eventTextEl, `${activeRegional.name} (${celebratingCount})`);
    } else if (activeLocals.length > 0 || celebratingCount > 0) {
      if (activeLocals.length > 0) {
        nextTargets = Array.from(new Set(activeLocals.map((c) => c.hostSettlementId)));
      } else {
        const fallbackIds = new Set<string>();
        for (const c of world.creatures) {
          if (c.alive && c.activity === 'celebrating') {
            fallbackIds.add(c.celebrationHostSettlementId ?? c.settlementId);
          }
        }
        nextTargets = Array.from(fallbackIds);
      }
      const primaryLocal = activeLocals[0];
      const hostName = nextTargets[0] ? world.getSettlement(nextTargets[0])?.name : undefined;
      nextEventBadgeClass = 'scope-local';
      this.eventTooltipClosed = primaryLocal
        ? `${primaryLocal.name}: ${primaryLocal.theme} — Click to go to ${hostName ?? 'celebration'}`
        : hostName
          ? `Village celebration underway — Click to go to ${hostName}`
          : 'Village celebration underway — Click to visit';
      this.eventTooltipOpen = primaryLocal
        ? `${primaryLocal.name}: ${primaryLocal.theme} — Click to close inspector`
        : 'Village celebration underway — Click to close inspector';
      this.setTextIfChanged(this.eventIconEl, primaryLocal?.icon ?? '🎉');
      this.setTextIfChanged(this.eventTextEl, `${celebratingCount} Celebrating`);
    } else {
      nextEventBadgeClass = 'is-idle';
      this.eventTooltipClosed = '';
      this.eventTooltipOpen = '';
    }

    if (this.lastEventBadgeClass !== nextEventBadgeClass) {
      this.eventBadgeEl.classList.remove(this.lastEventBadgeClass);
      this.eventBadgeEl.classList.add(nextEventBadgeClass);
      this.lastEventBadgeClass = nextEventBadgeClass;
    }

    this.activeEventSettlementIds = nextTargets;
    const nextEventDisabled = nextTargets.length === 0;
    if (this.lastEventBadgeDisabled !== nextEventDisabled) {
      this.lastEventBadgeDisabled = nextEventDisabled;
      this.eventBadgeEl.disabled = nextEventDisabled;
    }

    // 5. Reconcile village dropdown options in-place by settlement.id (preserves hover & DOM stability)
    const activeIds = this.activeSettlementIds;
    activeIds.clear();

    const selectedSettlementId =
      selection?.kind === 'settlement' ? selection.id : null;
    let totalVillagePop = 0;
    let warCount = 0;
    let celCount = 0;
    let selectedTriggerState: {
      hex: string;
      icon: string;
      name: string;
      shortLabel: string;
      pop: number;
      isWar: boolean;
      isCel: boolean;
      scope: string | null;
      tooltipBase: string;
    } | null = null;

    for (const s of world.settlements) {
      activeIds.add(s.id);
      let nodes = this.settlementOptions.get(s.id);
      if (!nodes) {
        nodes = this.createSettlementOption(s.id);
        this.settlementOptions.set(s.id, nodes);
        this.villageListEl.appendChild(nodes.button);
      }

      const cel = world.festivals.getCelebrationForSettlement(s.id);
      const war = world.wars.getWarForSettlement(s.id);
      const hex = `#${s.bannerColor.toString(16).padStart(6, '0')}`;
      const pop = this.settlementPopCounts.get(s.id) ?? 0;
      const profile = s.getAdaptationProfile();

      totalVillagePop += pop;
      const isWar = Boolean(war);
      const isCel = Boolean(cel);
      if (isWar) warCount++;
      if (isCel) celCount++;

      if (nodes.lastWar !== isWar) {
        nodes.lastWar = isWar;
        nodes.button.classList.toggle('at-war', isWar);
      }
      if (nodes.lastCel !== isCel) {
        nodes.lastCel = isCel;
        nodes.button.classList.toggle('celebrating', isCel);
      }
      const scope = cel?.scope ?? null;
      if (nodes.lastScope !== scope) {
        if (nodes.lastScope) {
          nodes.button.classList.remove(`scope-${nodes.lastScope}`);
        }
        if (scope) {
          nodes.button.classList.add(`scope-${scope}`);
        }
        nodes.lastScope = scope;
      }

      if (nodes.lastBannerHex !== hex) {
        nodes.lastBannerHex = hex;
        if (nodes.dotEl.style) {
          nodes.dotEl.style.background = hex;
        }
      }

      const displayIcon = war ? '⚔️' : cel ? cel.icon : profile.icon;
      this.setTextIfChanged(nodes.iconEl, displayIcon);
      this.setTextIfChanged(nodes.nameEl, s.name);
      this.setTextIfChanged(nodes.metaLabelEl, profile.shortLabel);
      this.setTextIfChanged(nodes.popEl, String(pop));

      let nextStatusClass = 'is-hidden';
      let nextStatusText = '';
      if (war) {
        nextStatusClass = 'is-war';
        nextStatusText = 'At War';
      } else if (cel) {
        nextStatusClass = scope === 'national' ? 'is-cel-national' : 'is-cel';
        nextStatusText = scope === 'national' ? 'Holiday' : 'Festival';
      }
      if (nodes.lastStatusClass !== nextStatusClass) {
        nodes.statusEl.classList.remove(nodes.lastStatusClass);
        nodes.statusEl.classList.add(nextStatusClass);
        nodes.lastStatusClass = nextStatusClass;
      }
      this.setTextIfChanged(nodes.statusEl, nextStatusText);

      if (war) {
        const enemyId = war.settlementAId === s.id ? war.settlementBId : war.settlementAId;
        const enemyName = world.getSettlement(enemyId)?.name ?? 'Rival Village';
        nodes.tooltipState.base = `${s.name} — ⚔️ At War with ${enemyName} (${formatWarPhaseLabel(war.phase)})`;
      } else {
        nodes.tooltipState.base = cel
          ? `${s.name} — ${cel.icon} ${cel.name} (${cel.scope}): ${cel.theme}`
          : `${s.name} — ${profile.title} (${getBiomeDisplayName(s.biome)}): ${profile.summary}`;
      }

      if (s.id === selectedSettlementId) {
        selectedTriggerState = {
          hex,
          icon: displayIcon,
          name: s.name,
          shortLabel: profile.shortLabel,
          pop,
          isWar,
          isCel,
          scope,
          tooltipBase: nodes.tooltipState.base,
        };
      }
    }

    // Remove options only if a settlement no longer exists (e.g. after New World reset)
    for (const [id, nodes] of this.settlementOptions) {
      if (!activeIds.has(id)) {
        nodes.pillHandle.dispose();
        if (typeof nodes.button.remove === 'function') {
          nodes.button.remove();
        }
        this.settlementOptions.delete(id);
      }
    }

    // 5b. Sync compact trigger button + dropdown header summary
    const settlementCount = world.settlements.length;
    const countStr = String(settlementCount);
    this.setTextIfChanged(this.villageTriggerCountEl, countStr);
    this.setTextIfChanged(this.villageMenuCountEl, countStr);

    const summaryParts = [`${totalVillagePop} kin`];
    if (warCount > 0) summaryParts.push(`⚔️ ${warCount} at war`);
    if (celCount > 0) summaryParts.push(`🎉 ${celCount} celebrating`);
    this.setTextIfChanged(this.villageMenuSummaryEl, summaryParts.join(' · '));

    const showWarBadge = warCount > 0;
    if (this.lastTriggerWarBadgeVisible !== showWarBadge) {
      this.lastTriggerWarBadgeVisible = showWarBadge;
      this.villageTriggerWarBadgeEl.classList.toggle('is-hidden', !showWarBadge);
    }
    if (showWarBadge) {
      this.setTextIfChanged(this.villageTriggerWarBadgeEl, `⚔️ ${warCount}`);
    }

    const showCelBadge = celCount > 0;
    if (this.lastTriggerCelBadgeVisible !== showCelBadge) {
      this.lastTriggerCelBadgeVisible = showCelBadge;
      this.villageTriggerCelBadgeEl.classList.toggle('is-hidden', !showCelBadge);
    }
    if (showCelBadge) {
      this.setTextIfChanged(this.villageTriggerCelBadgeEl, `🎉 ${celCount}`);
    }

    const hasSelection = selectedTriggerState !== null;
    if (this.lastTriggerHasSelection !== hasSelection) {
      this.lastTriggerHasSelection = hasSelection;
      this.villageTriggerBtn.classList.toggle('has-selection', hasSelection);
      this.villageTriggerDotEl.classList.toggle('is-hidden', !hasSelection);
      this.villageTriggerMetaEl.classList.toggle('is-hidden', !hasSelection);
    }

    const nextTriggerWar = selectedTriggerState?.isWar ?? false;
    if (this.lastTriggerWar !== nextTriggerWar) {
      this.lastTriggerWar = nextTriggerWar;
      this.villageTriggerBtn.classList.toggle('at-war', nextTriggerWar);
    }

    const nextTriggerCel = selectedTriggerState?.isCel ?? false;
    if (this.lastTriggerCel !== nextTriggerCel) {
      this.lastTriggerCel = nextTriggerCel;
      this.villageTriggerBtn.classList.toggle('celebrating', nextTriggerCel);
    }

    const nextTriggerScope = selectedTriggerState?.scope ?? null;
    if (this.lastTriggerScope !== nextTriggerScope) {
      if (this.lastTriggerScope) {
        this.villageTriggerBtn.classList.remove(`scope-${this.lastTriggerScope}`);
      }
      if (nextTriggerScope) {
        this.villageTriggerBtn.classList.add(`scope-${nextTriggerScope}`);
      }
      this.lastTriggerScope = nextTriggerScope;
    }

    if (selectedTriggerState) {
      if (this.lastTriggerBannerHex !== selectedTriggerState.hex) {
        this.lastTriggerBannerHex = selectedTriggerState.hex;
        if (this.villageTriggerDotEl.style) {
          this.villageTriggerDotEl.style.background = selectedTriggerState.hex;
        }
      }
      this.setTextIfChanged(this.villageTriggerIconEl, selectedTriggerState.icon);
      this.setTextIfChanged(this.villageTriggerLabelEl, selectedTriggerState.name);
      this.setTextIfChanged(this.villageTriggerAdaptEl, selectedTriggerState.shortLabel);
      this.setTextIfChanged(this.villageTriggerPopEl, String(selectedTriggerState.pop));
      const triggerTitle = `${selectedTriggerState.tooltipBase} — Click to browse villages`;
      if (this.villageTriggerBtn.title !== triggerTitle) {
        this.villageTriggerBtn.title = triggerTitle;
      }
    } else {
      this.setTextIfChanged(this.villageTriggerIconEl, '🏘️');
      this.setTextIfChanged(this.villageTriggerLabelEl, 'Villages');
      const villageWord = settlementCount === 1 ? 'village' : 'villages';
      const triggerTitle = `${settlementCount} ${villageWord} · ${summaryParts.join(' · ')} — Click to choose a village`;
      if (this.villageTriggerBtn.title !== triggerTitle) {
        this.villageTriggerBtn.title = triggerTitle;
      }
    }

    this.syncDialogPills();
  }

  dispose(): void {
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('pointerdown', this.onDocumentPointerDownBound);
    }
    this.kinPill.dispose();
    this.youngSlot.pillHandle.dispose();
    this.buildingsSlot.pillHandle.dispose();
    this.tradeSlot.pillHandle.dispose();
    this.pioneersSlot.pillHandle.dispose();
    this.deityPill.dispose();
    this.chroniclePill.dispose();
    this.savePill.dispose();
    this.eventPill.dispose();
    for (const nodes of this.settlementOptions.values()) {
      nodes.pillHandle.dispose();
    }
    this.settlementOptions.clear();
  }

  private createTelemetryPill(
    tab: RealmOverviewTab,
    icon: string,
    label: string,
    summaryTitle: string,
  ): TelemetrySlotNodes {
    const root = document.createElement('button');
    root.type = 'button';
    root.className = 'telemetry-slot telemetry-slot-btn';

    const iconEl = document.createElement('span');
    iconEl.className = 'telemetry-icon';
    iconEl.textContent = icon;

    const valueEl = document.createElement('span');
    valueEl.className = 'telemetry-value';
    valueEl.textContent = '0';

    const labelEl = document.createElement('span');
    labelEl.className = 'telemetry-label';
    labelEl.textContent = label;

    root.append(iconEl, valueEl, labelEl);

    const pillHandle = bindDialogPill({
      button: root,
      isOpen: () => this.callbacks.isRealmOverviewTabOpen(tab),
      open: () => this.callbacks.onOpenRealmOverviewTab(tab),
      close: () => this.callbacks.onCloseRealmOverview(),
      getTitle: (open) => (open ? `Close ${summaryTitle}` : `Open ${summaryTitle}`),
    });

    return { root, valueEl, pillHandle, lastEmpty: null };
  }

  private createSettlementOption(settlementId: string): SettlementOptionNodes {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'village-option';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.dataset.settlementId = settlementId;

    const dotEl = document.createElement('span');
    dotEl.className = 'dot';

    const iconEl = document.createElement('span');
    iconEl.className = 'adapt-icon';

    const nameEl = document.createElement('span');
    nameEl.className = 'settlement-name';

    const statusEl = document.createElement('span');
    statusEl.className = 'village-option-status is-hidden';

    const metaWrap = document.createElement('small');
    metaWrap.className = 'settlement-meta';
    const metaLabelEl = document.createElement('span');
    const sepEl = document.createElement('span');
    sepEl.textContent = ' · ';
    const popEl = document.createElement('span');
    popEl.className = 'settlement-pop';
    metaWrap.append(metaLabelEl, sepEl, popEl);

    button.append(dotEl, iconEl, nameEl, statusEl, metaWrap);

    const tooltipState = { base: '' };
    const pillHandle = bindDialogPill({
      button,
      isOpen: () =>
        this.activeSelection?.kind === 'settlement' && this.activeSelection.id === settlementId,
      open: () => {
        this.setVillageMenuOpen(false);
        this.callbacks.onFocusSettlement(settlementId);
      },
      close: () => {
        this.setVillageMenuOpen(false);
        this.callbacks.onCloseInspector();
      },
      getTitle: (open) => {
        if (!tooltipState.base) return '';
        return open
          ? `${tooltipState.base} — Click to close inspector`
          : `${tooltipState.base} — Click to inspect`;
      },
    });

    return {
      button,
      dotEl,
      iconEl,
      nameEl,
      statusEl,
      metaLabelEl,
      popEl,
      pillHandle,
      tooltipState,
      lastBannerHex: '',
      lastWar: false,
      lastCel: false,
      lastScope: null,
      lastStatusClass: 'is-hidden',
      lastSelected: null,
    };
  }

  private updateSlot(slot: TelemetrySlotNodes, count: number): void {
    this.setTextIfChanged(slot.valueEl, String(count));
    const isEmpty = count === 0;
    if (slot.lastEmpty !== isEmpty) {
      slot.lastEmpty = isEmpty;
      slot.root.classList.toggle('is-empty', isEmpty);
    }
  }

  private setTextIfChanged(el: HTMLElement, text: string): void {
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }
}
