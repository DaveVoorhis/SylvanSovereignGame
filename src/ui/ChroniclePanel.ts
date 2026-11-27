import type { ChronicleEntry, Vec2 } from '@core/Types';

export class ChroniclePanel {
  readonly element: HTMLElement;
  private readonly listEl: HTMLElement;
  private lastHeadId = -1;
  private lastEntryCount = -1;
  private open = true;
  private visiblePositions: (Vec2 | undefined)[] = [];

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
    this.listEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      const rowEl = target?.closest?.('.chronicle-item[data-entry-idx]') as HTMLElement | null;
      if (!rowEl) return;
      const rawIdx = rowEl.dataset?.entryIdx ?? rowEl.getAttribute?.('data-entry-idx');
      if (rawIdx === null || rawIdx === undefined) return;
      const pos = this.visiblePositions[Number(rawIdx)];
      if (pos) {
        this.onFocusPosition(pos);
      }
    });

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
    const entryCount = entries.length;
    if (!force && headId === this.lastHeadId && entryCount === this.lastEntryCount) return;
    this.lastHeadId = headId;
    this.lastEntryCount = entryCount;

    this.listEl.innerHTML = '';
    const count = Math.min(26, entryCount);
    this.visiblePositions.length = count;
    const container: DocumentFragment | HTMLElement =
      typeof document.createDocumentFragment === 'function'
        ? document.createDocumentFragment()
        : this.listEl;

    for (let i = 0; i < count; i++) {
      const entry = entries[i];
      this.visiblePositions[i] = entry.position;
      const row = document.createElement('div');
      row.className = `chronicle-item cat-${entry.category}${entry.position ? ' clickable' : ''}`;
      if (entry.position) {
        row.dataset.entryIdx = String(i);
      }
      row.innerHTML = `
        <div class="chronicle-meta">Day ${entry.timestampDay} · ${entry.season}</div>
        <div class="chronicle-title">${entry.title}</div>
        <div class="chronicle-detail">${entry.detail}</div>
      `;
      container.appendChild(row);
    }
    if (container !== this.listEl) {
      this.listEl.appendChild(container);
    }
  }
}
