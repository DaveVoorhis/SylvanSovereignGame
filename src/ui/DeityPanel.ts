import type { PrayerIntent, Vec2 } from '@core/Types';
import { DIVINE_EVENT_CATALOG } from '@simulation/deity/DivineEvents';
import type { WorldState } from '@simulation/WorldState';

export class DeityPanel {
  readonly element: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly feedbackEl: HTMLElement;
  private readonly whisperButtons: HTMLButtonElement[] = [];
  private open = true;
  private activeInfluencePos: Vec2 | null = null;

  constructor(
    private readonly onWhisper: (intent: PrayerIntent) => string,
    private readonly onClose: () => void,
    private readonly onFocusPosition?: (pos: Vec2) => void,
  ) {
    this.element = document.createElement('aside');
    this.element.className = 'hud-deity glass-panel';

    const title = document.createElement('div');
    title.className = 'panel-header';

    const titleLabel = document.createElement('span');
    titleLabel.textContent = '✦ Deity';

    const headerActions = document.createElement('div');
    headerActions.className = 'panel-header-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close Deity panel';
    closeBtn.setAttribute('aria-label', 'Close Deity panel');
    closeBtn.addEventListener('click', () => this.onClose());

    headerActions.append(closeBtn);
    title.append(titleLabel, headerActions);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'deity-body';
    this.bodyEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest('.deity-epoch-banner') && this.activeInfluencePos && this.onFocusPosition) {
        this.onFocusPosition(this.activeInfluencePos);
      }
    });

    const whisperSection = document.createElement('div');
    whisperSection.className = 'whisper-section';
    const whisperLabel = document.createElement('div');
    whisperLabel.className = 'whisper-label';
    whisperLabel.textContent = 'Subtle Spectator Whispers (Optional Nudge)';

    const btnGrid = document.createElement('div');
    btnGrid.className = 'whisper-grid';

    const intents: [PrayerIntent, string, string][] = [
      ['prosperity', '🌿 Stewardship', 'Encourage restoration, rewilding & recovery'],
      ['peace', '🕊 Shelter', 'Encourage refuge, corridors & harmony'],
      ['drama', '⚡ Upheaval', 'Risk rare ecological tests that force adaptation'],
      ['mystery', '✨ Change', 'Shift the unseen hand toward unexpected ecological turns'],
    ];

    for (const [intent, label, tip] of intents) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn small';
      btn.textContent = label;
      btn.title = tip;
      btn.addEventListener('click', () => {
        const msg = this.onWhisper(intent);
        this.feedbackEl.textContent = msg;
      });
      this.whisperButtons.push(btn);
      btnGrid.appendChild(btn);
    }

    this.feedbackEl = document.createElement('div');
    this.feedbackEl.className = 'whisper-feedback';

    whisperSection.append(whisperLabel, btnGrid, this.feedbackEl);
    this.element.append(title, this.bodyEl, whisperSection);
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.element.classList.toggle('hidden', !open);
  }

  update(world: WorldState): void {
    if (!this.open) return;
    const d = world.deity;
    const favored = d.favoredSettlementId ? world.getSettlement(d.favoredSettlementId)?.name : 'None yet';

    // Active ecological influence banner (rare, weighty epochs)
    const activeInf = world.activeInfluences[0] ?? null;
    this.activeInfluencePos = activeInf ? { ...activeInf.position } : null;

    let epochHtml = '';
    if (activeInf) {
      const meta = DIVINE_EVENT_CATALOG[activeInf.type];
      const elapsed = Math.max(0, world.elapsedSeconds - activeInf.startedAt);
      const total = Math.max(1, activeInf.duration);
      const rem = Math.max(0, Math.ceil(activeInf.startedAt + total - world.elapsedSeconds));
      const pctLeft = Math.round(Math.max(0, Math.min(1, 1 - elapsed / total)) * 100);
      const isDisruptive = activeInf.polarity === 'disruptive';
      const polarityLabel = isDisruptive ? 'Upheaval' : 'Renewal';

      const chips: string[] = [];
      if (activeInf.treesAffected > 0) {
        chips.push(isDisruptive ? `🪓 ${activeInf.treesAffected} trees lost` : `🌱 ${activeInf.treesAffected} regrown`);
      }
      if (activeInf.buildingsAffected > 0) {
        chips.push(isDisruptive ? `🏚 ${activeInf.buildingsAffected} battered` : `🏡 ${activeInf.buildingsAffected} aided`);
      }
      if (activeInf.casualties > 0) {
        chips.push(`🕯 ${activeInf.casualties} mourned`);
      }
      if (activeInf.adaptationsTriggered > 0) {
        chips.push(`🛠 ${activeInf.adaptationsTriggered} adapted`);
      }
      if (activeInf.migrationTriggered) {
        chips.push(`🧭 Migration sparked`);
      }
      const chipsHtml = chips.length
        ? `<div class="deity-impact-chips">${chips.map((c) => `<span>${c}</span>`).join('')}</div>`
        : '';

      epochHtml = `
        <div class="deity-epoch-banner polarity-${activeInf.polarity}" title="Click to focus camera on epicenter">
          <div class="deity-epoch-head">
            <span class="deity-epoch-title">${activeInf.icon} ${activeInf.label}</span>
            <span class="deity-polarity-tag">${polarityLabel} · ${rem}s</span>
          </div>
          <div class="deity-epoch-track">
            <div class="deity-epoch-fill" style="width:${pctLeft}%"></div>
          </div>
          <div class="deity-epoch-note">${meta.ecologicalReflection}</div>
          ${chipsHtml}
        </div>
      `;
    }

    // Live Realm Ecology condition chips
    const ecoChips: string[] = [];
    if (world.floodSurge > 0.08) {
      ecoChips.push(`<span class="eco-chip warn">🌊 Flood +${world.floodSurge.toFixed(1)}m</span>`);
    }
    if (world.climateHeat > 0.12) {
      ecoChips.push(`<span class="eco-chip warn">🔥 Heatwave ${Math.round(world.climateHeat * 100)}%</span>`);
    }
    if (world.climateFreeze > 0.12) {
      ecoChips.push(`<span class="eco-chip warn">❄️ Deep Freeze ${Math.round(world.climateFreeze * 100)}%</span>`);
    }
    if (world.miasmaIntensity > 0.12) {
      ecoChips.push(`<span class="eco-chip warn">🌫 Ashen Pall ${Math.round(world.miasmaIntensity * 100)}%</span>`);
    }
    if (world.habitatScars.length > 0) {
      ecoChips.push(
        `<span class="eco-chip warn">🪓 ${world.habitatScars.length} Cleared Scar${world.habitatScars.length > 1 ? 's' : ''}</span>`,
      );
    }
    if (world.rewildingBoost > 0.12) {
      ecoChips.push(`<span class="eco-chip heal">🌱 Rewilding</span>`);
    }
    if (ecoChips.length === 0) {
      ecoChips.push(`<span class="eco-chip calm">🌿 Natural Balance</span>`);
    }

    const bar = (label: string, val: number, color: string) => `
      <div class="stat-bar">
        <div class="stat-bar-head"><span>${label}</span><span>${Math.round(val * 100)}%</span></div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round(val * 100)}%;background:${color}"></div></div>
      </div>
    `;

    this.bodyEl.innerHTML = `
      <div class="deity-name">${d.name} <small>${d.epithet}</small></div>
      <div class="deity-aspect">${d.aspect}</div>
      <div class="deity-meta">
        <span>Energy: <strong>${Math.round(d.energy)}%</strong></span>
        <span>Favored: <strong>${favored}</strong></span>
      </div>
      <div class="deity-ecology-strip">${ecoChips.join('')}</div>
      ${epochHtml}
      <div class="deity-bars">
        ${bar('Benevolence', d.traits.benevolence, '#6ad48a')}
        ${bar('Verdancy', d.traits.verdancy, '#49b879')}
        ${bar('Curiosity', d.traits.curiosity, '#69b8e8')}
        ${bar('Chaos', d.traits.chaos, '#e5a44d')}
        ${bar('Wrath', d.traits.wrath, '#e06258')}
      </div>
      <div class="deity-omen">“${d.lastOmen}”</div>
    `;

    const cooling = d.whisperCooldown > 0.5;
    for (const btn of this.whisperButtons) {
      btn.disabled = cooling;
    }
    if (!cooling && this.feedbackEl.textContent === '') {
      this.feedbackEl.textContent = 'The canopy listens silently...';
    }
  }
}
