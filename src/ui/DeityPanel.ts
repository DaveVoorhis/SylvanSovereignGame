import type { PrayerIntent } from '@core/Types';
import type { WorldState } from '@simulation/WorldState';

export class DeityPanel {
  readonly element: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly feedbackEl: HTMLElement;
  private readonly whisperButtons: HTMLButtonElement[] = [];
  private open = true;

  constructor(
    private readonly onWhisper: (intent: PrayerIntent) => string,
    private readonly onClose: () => void,
  ) {
    this.element = document.createElement('aside');
    this.element.className = 'hud-deity glass-panel';

    const title = document.createElement('div');
    title.className = 'panel-header';

    const titleLabel = document.createElement('span');
    titleLabel.textContent = '✦ Deity';

    const headerActions = document.createElement('div');
    headerActions.className = 'panel-header-actions';

    const autoBadge = document.createElement('span');
    autoBadge.className = 'badge-auto';
    autoBadge.textContent = 'Autonomous';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close Deity panel';
    closeBtn.setAttribute('aria-label', 'Close Deity panel');
    closeBtn.addEventListener('click', () => this.onClose());

    headerActions.append(autoBadge, closeBtn);
    title.append(titleLabel, headerActions);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'deity-body';

    const whisperSection = document.createElement('div');
    whisperSection.className = 'whisper-section';
    const whisperLabel = document.createElement('div');
    whisperLabel.className = 'whisper-label';
    whisperLabel.textContent = 'Subtle Spectator Whispers (Optional Nudge)';

    const btnGrid = document.createElement('div');
    btnGrid.className = 'whisper-grid';

    const intents: [PrayerIntent, string][] = [
      ['prosperity', '🌿 Bloom'],
      ['peace', '🕊 Peace'],
      ['drama', '⚡ Drama'],
      ['mystery', '✨ Omen'],
    ];

    for (const [intent, label] of intents) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn small';
      btn.textContent = label;
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
