import type { ChronicleEntry, Vec2 } from '@core/Types';

export class ChroniclePanel {
  readonly element: HTMLElement;
  private readonly listEl: HTMLElement;
  private lastHeadId = -1;
  private open = true;

  constructor(
    private readonly onFocusPosition: (pos: Vec2) => void,
    private readonly onClose: () => void,
  ) {
    this.element = document.createElement('section');
    this.element.className = 'hud-chronicle glass-panel';

    const header = document.createElement('div');
    header.className = 'panel-header';

    const titleLabel = document.createElement('span');
    titleLabel.textContent = '📜 Living Chronicle';

    const headerActions = document.createElement('div');
    headerActions.className = 'panel-header-actions';

    const hintEl = document.createElement('span');
    hintEl.className = 'hint';
    hintEl.textContent = 'Click event to fly';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close Living Chronicle';
    closeBtn.setAttribute('aria-label', 'Close Living Chronicle');
    closeBtn.addEventListener('click', () => this.onClose());

    headerActions.append(hintEl, closeBtn);
    header.append(titleLabel, headerActions);

    this.listEl = document.createElement('div');
    this.listEl.className = 'chronicle-list';

    this.element.append(header, this.listEl);
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.element.classList.toggle('hidden', !open);
  }

  update(entries: readonly ChronicleEntry[], force = false): void {
    if (!this.open) return;
    const headId = entries[0]?.id ?? -1;
    if (!force && headId === this.lastHeadId) return;
    this.lastHeadId = headId;

    this.listEl.innerHTML = '';
    const visible = entries.slice(0, 26);

    for (const entry of visible) {
      const row = document.createElement('div');
      row.className = `chronicle-item cat-${entry.category}${entry.position ? ' clickable' : ''}`;
      row.innerHTML = `
        <div class="chronicle-meta">Day ${entry.timestampDay} · ${entry.season}</div>
        <div class="chronicle-title">${entry.title}</div>
        <div class="chronicle-detail">${entry.detail}</div>
      `;
      if (entry.position) {
        const targetPos = entry.position;
        row.addEventListener('click', () => this.onFocusPosition(targetPos));
      }
      this.listEl.appendChild(row);
    }
  }
}
