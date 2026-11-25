import type { ChronicleEntry, Vec2 } from '@core/Types';

export class ChroniclePanel {
  readonly element: HTMLElement;
  private readonly listEl: HTMLElement;
  private lastHeadId = -1;

  constructor(private readonly onFocusPosition: (pos: Vec2) => void) {
    this.element = document.createElement('section');
    this.element.className = 'hud-chronicle glass-panel';

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `<span>📜 Living Chronicle</span><span class="hint">Click event to fly</span>`;

    this.listEl = document.createElement('div');
    this.listEl.className = 'chronicle-list';

    this.element.append(header, this.listEl);
  }

  update(entries: readonly ChronicleEntry[]): void {
    const headId = entries[0]?.id ?? -1;
    if (headId === this.lastHeadId) return;
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
