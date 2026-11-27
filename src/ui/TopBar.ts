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
}

interface SettlementPillNodes {
  readonly button: HTMLButtonElement;
  readonly dotEl: HTMLElement;
  readonly iconEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly metaLabelEl: HTMLElement;
  readonly popEl: HTMLElement;
  readonly pillHandle: DialogPillHandle;
  readonly tooltipState: { base: string };
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

  // Band 2: reconciled settlement pills + dedicated right-anchored event slot
  private readonly settlementsBar: HTMLElement;
  private readonly settlementPills = new Map<string, SettlementPillNodes>();
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
    seedBtn.title = 'Generate a brand-new procedural world';
    seedBtn.addEventListener('click', () => this.callbacks.onNewWorld());

    worldGroup.append(this.qualitySelect, this.saveBtn, seedBtn);
    controls.append(speedGroup, viewGroup, worldGroup);

    mainRow.append(leftZone, telemetry, controls);

    // === BAND 2: Reconciled Settlement Strip + Right-Anchored Celebration Slot ===
    const subRow = document.createElement('div');
    subRow.className = 'topbar-subrow';

    this.settlementsBar = document.createElement('div');
    this.settlementsBar.className = 'settlement-pills';

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

    subRow.append(this.settlementsBar, eventSlot);
    this.element.append(mainRow, subRow);
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
    for (const nodes of this.settlementPills.values()) {
      nodes.pillHandle.sync();
    }
  }

  update(world: WorldState, inCreaturePov: boolean, selection: SelectionTarget = null): void {
    this.activeSelection = selection;

    // 1. POV button text (fixed min-width in CSS prevents horizontal shift)
    const nextPovText = inCreaturePov ? '🌍 World View' : '👁 Creature View';
    if (this.povToggleBtn.textContent !== nextPovText) {
      this.povToggleBtn.textContent = nextPovText;
    }
    this.povToggleBtn.classList.toggle('active', inCreaturePov);

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

    for (const c of world.creatures) {
      if (!c.alive) continue;
      aliveCount++;
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
    this.deityEventBadgeEl.classList.remove('polarity-disruptive', 'polarity-restorative', 'is-hidden');
    if (activeInf) {
      this.activeInfluencePos = { ...activeInf.position };
      this.deityEventBadgeEl.disabled = false;
      this.deityEventBadgeEl.classList.add(`polarity-${activeInf.polarity}`);
      const rem = Math.max(0, Math.ceil(activeInf.startedAt + activeInf.duration - world.elapsedSeconds));
      const meta = DIVINE_EVENT_CATALOG[activeInf.type];
      this.setTextIfChanged(this.deityEventIconEl, activeInf.icon);
      this.setTextIfChanged(this.deityEventTextEl, `${activeInf.label} (${rem}s)`);
      this.deityEventBadgeEl.title = `${meta.ecologicalReflection} — Click to fly to epicenter`;
    } else {
      this.activeInfluencePos = null;
      this.deityEventBadgeEl.disabled = true;
      this.deityEventBadgeEl.classList.add('is-hidden');
      this.deityEventBadgeEl.title = '';
    }

    // 4. Right-anchored Celebration Event Slot (never nudges Band 1 or settlement pills)
    const nationalHoliday = world.festivals.getNationalHoliday();
    const activeRegional = world.festivals.activeCelebrations.find((c) => c.scope === 'regional');
    const activeLocals = world.festivals.activeCelebrations.filter((c) => c.scope === 'local');

    let nextTargets: string[] = [];

    this.eventBadgeEl.classList.remove('scope-national', 'scope-regional', 'scope-local', 'is-idle');
    if (nationalHoliday) {
      nextTargets = [
        nationalHoliday.hostSettlementId,
        ...nationalHoliday.participatingSettlementIds.filter((id) => id !== nationalHoliday.hostSettlementId),
      ];
      const hostName = world.getSettlement(nationalHoliday.hostSettlementId)?.name;
      this.eventBadgeEl.classList.add('scope-national');
      this.eventTooltipClosed = hostName
        ? `${nationalHoliday.theme} — Click to go to ${hostName}`
        : `${nationalHoliday.theme} — Click to visit celebration`;
      this.eventTooltipOpen = `${nationalHoliday.theme} — Click to close inspector`;
      this.setTextIfChanged(this.eventIconEl, nationalHoliday.icon);
      this.setTextIfChanged(this.eventTextEl, `Holiday: ${nationalHoliday.name}`);
    } else if (activeRegional) {
      nextTargets = [activeRegional.hostSettlementId];
      const hostName = world.getSettlement(activeRegional.hostSettlementId)?.name;
      this.eventBadgeEl.classList.add('scope-regional');
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
      this.eventBadgeEl.classList.add('scope-local');
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
      this.eventBadgeEl.classList.add('is-idle');
      this.eventTooltipClosed = '';
      this.eventTooltipOpen = '';
    }

    this.activeEventSettlementIds = nextTargets;
    this.eventBadgeEl.disabled = nextTargets.length === 0;

    // 5. Reconcile settlement pills in-place by settlement.id (preserves hover & DOM stability)
    const activeIds = new Set<string>();
    for (const s of world.settlements) {
      activeIds.add(s.id);
      let nodes = this.settlementPills.get(s.id);
      if (!nodes) {
        nodes = this.createSettlementPill(s.id);
        this.settlementPills.set(s.id, nodes);
        this.settlementsBar.appendChild(nodes.button);
      }

      const cel = world.festivals.getCelebrationForSettlement(s.id);
      const war = world.wars.getWarForSettlement(s.id);
      const hex = `#${s.bannerColor.toString(16).padStart(6, '0')}`;
      const pop = world.getSettlementPopulation(s.id);
      const profile = s.getAdaptationProfile();

      nodes.button.classList.toggle('at-war', Boolean(war));
      nodes.button.classList.toggle('celebrating', Boolean(cel));
      nodes.button.classList.toggle('scope-national', cel?.scope === 'national');
      nodes.button.classList.toggle('scope-regional', cel?.scope === 'regional');
      nodes.button.classList.toggle('scope-local', cel?.scope === 'local');

      if (nodes.dotEl.style.background !== hex) {
        nodes.dotEl.style.background = hex;
      }

      // Swap the fixed-width icon box to the festival icon during celebrations so pill width never shifts
      const displayIcon = war ? '⚔️' : cel ? cel.icon : profile.icon;
      this.setTextIfChanged(nodes.iconEl, displayIcon);
      this.setTextIfChanged(nodes.nameEl, s.name);
      this.setTextIfChanged(nodes.metaLabelEl, profile.shortLabel);
      this.setTextIfChanged(nodes.popEl, String(pop));

      if (war) {
        const enemyId = war.settlementAId === s.id ? war.settlementBId : war.settlementAId;
        const enemyName = world.getSettlement(enemyId)?.name ?? 'Rival Village';
        nodes.tooltipState.base = `${s.name} — ⚔️ At War with ${enemyName} (${formatWarPhaseLabel(war.phase)})`;
      } else {
        nodes.tooltipState.base = cel
          ? `${s.name} — ${cel.icon} ${cel.name} (${cel.scope}): ${cel.theme}`
          : `${s.name} — ${profile.title} (${getBiomeDisplayName(s.biome)}): ${profile.summary}`;
      }
    }

    // Remove pills only if a settlement no longer exists (e.g. after New World reset)
    for (const [id, nodes] of this.settlementPills) {
      if (!activeIds.has(id)) {
        nodes.pillHandle.dispose();
        nodes.button.remove();
        this.settlementPills.delete(id);
      }
    }

    this.syncDialogPills();
  }

  dispose(): void {
    this.kinPill.dispose();
    this.youngSlot.pillHandle.dispose();
    this.buildingsSlot.pillHandle.dispose();
    this.tradeSlot.pillHandle.dispose();
    this.pioneersSlot.pillHandle.dispose();
    this.deityPill.dispose();
    this.chroniclePill.dispose();
    this.savePill.dispose();
    this.eventPill.dispose();
    for (const nodes of this.settlementPills.values()) {
      nodes.pillHandle.dispose();
    }
    this.settlementPills.clear();
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

    return { root, valueEl, pillHandle };
  }

  private createSettlementPill(settlementId: string): SettlementPillNodes {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settlement-pill';
    button.dataset.settlementId = settlementId;

    const dotEl = document.createElement('span');
    dotEl.className = 'dot';

    const iconEl = document.createElement('span');
    iconEl.className = 'adapt-icon';

    const nameEl = document.createElement('span');
    nameEl.className = 'settlement-name';

    const metaWrap = document.createElement('small');
    metaWrap.className = 'settlement-meta';
    const metaLabelEl = document.createElement('span');
    const sepEl = document.createElement('span');
    sepEl.textContent = ' · ';
    const popEl = document.createElement('span');
    popEl.className = 'settlement-pop';
    metaWrap.append(metaLabelEl, sepEl, popEl);

    button.append(dotEl, iconEl, nameEl, metaWrap);

    const tooltipState = { base: '' };
    const pillHandle = bindDialogPill({
      button,
      isOpen: () =>
        this.activeSelection?.kind === 'settlement' && this.activeSelection.id === settlementId,
      open: () => this.callbacks.onFocusSettlement(settlementId),
      close: () => this.callbacks.onCloseInspector(),
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
      metaLabelEl,
      popEl,
      pillHandle,
      tooltipState,
    };
  }

  private updateSlot(slot: TelemetrySlotNodes, count: number): void {
    this.setTextIfChanged(slot.valueEl, String(count));
    slot.root.classList.toggle('is-empty', count === 0);
  }

  private setTextIfChanged(el: HTMLElement, text: string): void {
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }
}
