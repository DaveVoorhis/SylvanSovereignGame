import type { QualityPreset } from '@core/Config';
import type { WorldState } from '@simulation/WorldState';

export interface TopBarCallbacks {
  onSetSpeed: (speed: number) => void;
  onToggleCinematic: () => boolean;
  onToggleCreatureView: () => void;
  onToggleZenMode: () => void;
  onResetOverview: () => void;
  onNewWorld: () => void;
  onChangeQuality: (preset: QualityPreset) => void;
  onFocusSettlement: (settlementId: string) => void;
}

export class TopBar {
  readonly element: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly settlementsBar: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly cinematicBtn: HTMLButtonElement;
  private readonly povToggleBtn: HTMLButtonElement;
  private readonly zenBtn: HTMLButtonElement;
  private readonly qualitySelect: HTMLSelectElement;

  constructor(private readonly callbacks: TopBarCallbacks) {
    this.element = document.createElement('header');
    this.element.className = 'hud-topbar glass-panel';

    const brand = document.createElement('div');
    brand.className = 'topbar-brand';
    brand.innerHTML = `<span class="brand-title">Sylvan Sovereign</span><span class="brand-sub">Procedural Woodland Spectator</span>`;

    this.clockEl = document.createElement('div');
    this.clockEl.className = 'topbar-clock';

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'topbar-stats';

    const controls = document.createElement('div');
    controls.className = 'topbar-controls';

    const speeds: [string, number][] = [
      ['⏸', 0],
      ['1×', 1],
      ['2×', 2],
      ['4×', 4],
    ];
    for (const [label, spd] of speeds) {
      const btn = document.createElement('button');
      btn.className = 'hud-btn';
      btn.textContent = label;
      btn.dataset.speed = String(spd);
      if (spd === 1) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.setActiveSpeed(spd);
        this.callbacks.onSetSpeed(spd);
      });
      this.speedButtons.push(btn);
      controls.appendChild(btn);
    }

    this.povToggleBtn = document.createElement('button');
    this.povToggleBtn.className = 'hud-btn';
    this.povToggleBtn.textContent = '👁 Creature View';
    this.povToggleBtn.title = 'View the forest from a creature’s eyes (V)';
    this.povToggleBtn.addEventListener('click', () => this.callbacks.onToggleCreatureView());
    controls.appendChild(this.povToggleBtn);

    const overviewBtn = document.createElement('button');
    overviewBtn.className = 'hud-btn';
    overviewBtn.textContent = 'Overview';
    overviewBtn.addEventListener('click', () => this.callbacks.onResetOverview());
    controls.appendChild(overviewBtn);

    this.cinematicBtn = document.createElement('button');
    this.cinematicBtn.className = 'hud-btn';
    this.cinematicBtn.textContent = 'Drift';
    this.cinematicBtn.title = 'Toggle gentle cinematic spectator camera orbit';
    this.cinematicBtn.addEventListener('click', () => {
      const active = this.callbacks.onToggleCinematic();
      this.cinematicBtn.classList.toggle('active', active);
    });
    controls.appendChild(this.cinematicBtn);

    this.zenBtn = document.createElement('button');
    this.zenBtn.className = 'hud-btn';
    this.zenBtn.textContent = '🌿 Zen';
    this.zenBtn.title = 'Enter full-screen Zen Mode — hide all UI (Z)';
    this.zenBtn.addEventListener('click', () => this.callbacks.onToggleZenMode());
    controls.appendChild(this.zenBtn);

    this.qualitySelect = document.createElement('select');
    this.qualitySelect.className = 'hud-select';
    this.qualitySelect.title = '3D Graphics Quality';
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
    controls.appendChild(this.qualitySelect);

    const seedBtn = document.createElement('button');
    seedBtn.className = 'hud-btn accent';
    seedBtn.textContent = 'New Forest';
    seedBtn.addEventListener('click', () => this.callbacks.onNewWorld());
    controls.appendChild(seedBtn);

    const topRow = document.createElement('div');
    topRow.className = 'topbar-row';
    topRow.append(brand, this.clockEl, this.statsEl, controls);

    this.settlementsBar = document.createElement('div');
    this.settlementsBar.className = 'settlement-pills';

    this.element.append(topRow, this.settlementsBar);
  }

  setActiveSpeed(speed: number): void {
    for (const btn of this.speedButtons) {
      btn.classList.toggle('active', Number(btn.dataset.speed) === speed);
    }
  }

  setZenActive(active: boolean): void {
    this.zenBtn.classList.toggle('active', active);
  }

  update(world: WorldState, inCreaturePov: boolean): void {
    this.povToggleBtn.textContent = inCreaturePov ? '🌍 World View' : '👁 Creature View';
    this.povToggleBtn.classList.toggle('active', inCreaturePov);

    const hours = Math.floor(world.timeOfDay * 24);
    const mins = Math.floor((world.timeOfDay * 24 - hours) * 60);
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    const seasonLabel = world.season[0].toUpperCase() + world.season.slice(1);
    const weatherLabel = world.weather[0].toUpperCase() + world.weather.slice(1);

    this.clockEl.innerHTML = `
      <span class="pill">Day ${world.day}</span>
      <span class="pill">${seasonLabel}</span>
      <span class="pill">${timeStr}</span>
      <span class="pill">${weatherLabel}</span>
    `;

    const aliveCount = world.creatures.filter((c) => c.alive).length;
    const totalBuildings = world.settlements.reduce((sum, s) => sum + s.getCompletedCount(), 0);
    const caravans = world.creatures.filter((c) => c.alive && c.activity === 'trading').length;
    this.statsEl.innerHTML = `
      <span>🐾 ${aliveCount} Kin</span>
      <span>🏡 ${totalBuildings} Bldgs</span>
      <span>⚖️ ${caravans} Caravans</span>
    `;

    this.settlementsBar.innerHTML = '';
    for (const s of world.settlements) {
      const btn = document.createElement('button');
      btn.className = 'settlement-pill';
      const hex = `#${s.bannerColor.toString(16).padStart(6, '0')}`;
      const pop = world.getSettlementPopulation(s.id);
      btn.innerHTML = `<span class="dot" style="background:${hex}"></span>${s.name} <small>(${s.tier} · ${pop})</small>`;
      btn.addEventListener('click', () => this.callbacks.onFocusSettlement(s.id));
      this.settlementsBar.appendChild(btn);
    }
  }
}
