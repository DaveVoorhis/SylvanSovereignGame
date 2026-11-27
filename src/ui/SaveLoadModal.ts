import {
  DEFAULT_AUTOSAVE_SLOT_ID,
  isValidSaveRecord,
  type SaveGameRecord,
  type SaveSlotMeta,
} from '@core/SaveStore';

export interface SaveLoadCallbacks {
  onClose: () => void;
  onListSlots: () => Promise<SaveSlotMeta[]>;
  onSaveAutosave: () => Promise<SaveSlotMeta>;
  onSaveNewSlot: (name: string) => Promise<SaveSlotMeta>;
  onOverwriteSlot: (slotId: string, name: string) => Promise<SaveSlotMeta>;
  onLoadSlot: (slotId: string) => Promise<boolean>;
  onDeleteSlot: (slotId: string) => Promise<void>;
  onExportCurrent: () => SaveGameRecord;
  onImportRecord: (record: SaveGameRecord) => Promise<boolean>;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSavedTime(timestampMs: number): string {
  try {
    return new Date(timestampMs).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * Interactive Save / Load modal backed by browser IndexedDB, featuring the
 * automatic default slot (`autosave`), named manual save slots, and JSON export/import.
 */
export class SaveLoadModal {
  readonly element: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly bodyEl: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  private open = false;
  private busy = false;
  private slots: SaveSlotMeta[] = [];

  constructor(private readonly callbacks: SaveLoadCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'creature-modal-backdrop hidden';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Saved Realms');

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
    card.className = 'creature-modal save-modal glass-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'cmodal-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'cmodal-title-wrap';
    const title = document.createElement('h2');
    title.className = 'cmodal-title';
    title.textContent = '💾 Saved Realms';
    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'cmodal-summary';
    this.summaryEl.textContent = 'Saved locally in this browser · Autosaves automatically';
    titleWrap.append(title, this.summaryEl);

    const headerRight = document.createElement('div');
    headerRight.className = 'cmodal-header-right';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'hud-btn small';
    exportBtn.textContent = '⬇ Export JSON';
    exportBtn.title = 'Download the current realm state as a portable .json save file';
    exportBtn.addEventListener('click', () => this.handleExport());

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'hud-btn small';
    importBtn.textContent = '⬆ Import JSON';
    importBtn.title = 'Load a previously exported .json realm save file';
    importBtn.addEventListener('click', () => this.fileInput.click());

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json,.json';
    this.fileInput.className = 'hidden';
    this.fileInput.addEventListener('change', () => {
      void this.handleImportFile();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cmodal-close';
    closeBtn.title = 'Close (Esc)';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    headerRight.append(exportBtn, importBtn, this.fileInput, closeBtn);
    header.append(titleWrap, headerRight);

    // Toolbar: create new named slot
    const toolbar = document.createElement('div');
    toolbar.className = 'cmodal-toolbar save-toolbar';

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.className = 'cmodal-search';
    this.nameInput.maxLength = 60;
    this.nameInput.placeholder = 'New save slot name (optional — defaults to Day & Season)…';
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.handleCreateSlot();
      }
    });

    const saveNewBtn = document.createElement('button');
    saveNewBtn.type = 'button';
    saveNewBtn.className = 'hud-btn accent';
    saveNewBtn.textContent = '＋ Save New Slot';
    saveNewBtn.addEventListener('click', () => {
      void this.handleCreateSlot();
    });

    const autosaveNowBtn = document.createElement('button');
    autosaveNowBtn.type = 'button';
    autosaveNowBtn.className = 'hud-btn';
    autosaveNowBtn.textContent = '💾 Save Autosave Now';
    autosaveNowBtn.addEventListener('click', () => {
      void this.handleSaveAutosave();
    });

    toolbar.append(this.nameInput, saveNewBtn, autosaveNowBtn);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'save-status-banner hidden';

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'cmodal-body ro-body';
    this.bodyEl.addEventListener('click', (e) => {
      void this.handleBodyClick(e);
    });

    card.append(header, toolbar, this.statusEl, this.bodyEl);
    this.element.appendChild(card);
  }

  isOpen(): boolean {
    return this.open;
  }

  openModal(): void {
    this.open = true;
    this.element.classList.remove('hidden');
    this.clearStatus();
    void this.refreshList();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.element.classList.add('hidden');
    this.callbacks.onClose();
  }

  private setStatus(message: string, isError = false): void {
    this.statusEl.textContent = message;
    this.statusEl.classList.remove('hidden', 'is-error');
    if (isError) this.statusEl.classList.add('is-error');
  }

  private clearStatus(): void {
    this.statusEl.textContent = '';
    this.statusEl.classList.add('hidden');
    this.statusEl.classList.remove('is-error');
  }

  async refreshList(): Promise<void> {
    try {
      this.slots = await this.callbacks.onListSlots();
      this.render();
    } catch {
      this.setStatus('Could not access browser save storage in this window.', true);
    }
  }

  private async handleSaveAutosave(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const meta = await this.callbacks.onSaveAutosave();
      this.setStatus(`Autosave updated — Day ${meta.day} (${capitalize(meta.season)}).`);
      await this.refreshList();
    } catch {
      this.setStatus('Failed to save to the default autosave slot.', true);
    } finally {
      this.busy = false;
    }
  }

  private async handleCreateSlot(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const customName = this.nameInput.value.trim();
      const meta = await this.callbacks.onSaveNewSlot(customName);
      this.nameInput.value = '';
      this.setStatus(`Saved "${meta.name}" — Day ${meta.day} (${capitalize(meta.season)}).`);
      await this.refreshList();
    } catch {
      this.setStatus('Failed to create save slot.', true);
    } finally {
      this.busy = false;
    }
  }

  private handleExport(): void {
    try {
      const record = this.callbacks.onExportCurrent();
      const json = JSON.stringify(record, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sylvan-sovereign-day-${record.meta.day}-seed-${record.meta.seed}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.setStatus(`Exported Day ${record.meta.day} realm snapshot as JSON.`);
    } catch {
      this.setStatus('Failed to export JSON save file.', true);
    }
  }

  private async handleImportFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file || this.busy) return;
    this.busy = true;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isValidSaveRecord(parsed)) {
        this.setStatus('Selected file is not a valid Sylvan Sovereign save file.', true);
        return;
      }
      this.close();
      await this.callbacks.onImportRecord(parsed);
    } catch {
      this.setStatus('Failed to read or parse the selected save file.', true);
    } finally {
      this.busy = false;
    }
  }

  private async handleBodyClick(e: MouseEvent): Promise<void> {
    if (this.busy) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLElement>('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const slotId = btn.dataset.slotId;
    if (!slotId) return;

    this.busy = true;
    try {
      if (action === 'load') {
        this.close();
        await this.callbacks.onLoadSlot(slotId);
      } else if (action === 'overwrite') {
        const slot = this.slots.find((s) => s.slotId === slotId);
        const meta =
          slotId === DEFAULT_AUTOSAVE_SLOT_ID
            ? await this.callbacks.onSaveAutosave()
            : await this.callbacks.onOverwriteSlot(slotId, slot?.name ?? 'Saved Realm');
        this.setStatus(`Overwrote "${meta.name}" — Day ${meta.day} (${capitalize(meta.season)}).`);
        await this.refreshList();
      } else if (action === 'delete') {
        await this.callbacks.onDeleteSlot(slotId);
        this.setStatus('Deleted save slot.');
        await this.refreshList();
      }
    } catch {
      this.setStatus('Save slot operation failed.', true);
    } finally {
      this.busy = false;
    }
  }

  private render(): void {
    const autosave = this.slots.find((s) => s.isAutosave);
    const manualSlots = this.slots.filter((s) => !s.isAutosave);

    this.summaryEl.textContent = autosave
      ? `Autosave active (Day ${autosave.day}, ${formatSavedTime(autosave.savedAt)}) · ${manualSlots.length} manual slot${manualSlots.length === 1 ? '' : 's'}`
      : `Autosaves automatically every 25s & on tab close · ${manualSlots.length} manual slot${manualSlots.length === 1 ? '' : 's'}`;

    const autosaveHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Default Autosave Slot</h3>
          <span class="ro-muted">Automatically loaded on startup</span>
        </div>
        ${
          autosave
            ? this.renderSlotCard(autosave, true)
            : `
            <div class="ro-info-card">
              <div class="ro-card-top">
                <strong>🔄 Autosave (empty)</strong>
                <button type="button" class="hud-btn small" data-action="overwrite" data-slot-id="${DEFAULT_AUTOSAVE_SLOT_ID}">Save Now</button>
              </div>
              <div class="ro-card-metrics">
                <span>Your realm will autosave here periodically and whenever you switch away or close the tab.</span>
              </div>
            </div>
          `
        }
      </div>
    `;

    const manualHtml = `
      <div class="ro-section">
        <div class="ro-section-head">
          <h3>Manual Save Slots (${manualSlots.length})</h3>
        </div>
        ${
          manualSlots.length === 0
            ? '<div class="cmodal-empty">No manual save slots yet. Enter a name above and click <strong>Save New Slot</strong> to bookmark this realm at any point.</div>'
            : `<div class="ro-party-list">${manualSlots.map((slot) => this.renderSlotCard(slot, false)).join('')}</div>`
        }
      </div>
    `;

    this.bodyEl.innerHTML = `${autosaveHtml}${manualHtml}`;
  }

  private renderSlotCard(slot: SaveSlotMeta, isAutosave: boolean): string {
    return `
      <div class="ro-info-card ${isAutosave ? 'is-highlight' : ''}">
        <div class="ro-card-top">
          <div>
            <strong>${isAutosave ? '🔄 ' : '📜 '}${escapeHtml(slot.name)}</strong>
            <span class="ro-pill-badge">Day ${slot.day} · ${escapeHtml(capitalize(slot.season))}</span>
          </div>
          <div class="ro-btn-group">
            <button type="button" class="hud-btn small accent" data-action="load" data-slot-id="${escapeHtml(slot.slotId)}" title="Restore this saved realm">Load</button>
            <button type="button" class="hud-btn small" data-action="overwrite" data-slot-id="${escapeHtml(slot.slotId)}" title="Overwrite this slot with the current realm">Overwrite</button>
            <button type="button" class="c-act-btn save-del-btn" data-action="delete" data-slot-id="${escapeHtml(slot.slotId)}" title="Delete this save slot">🗑</button>
          </div>
        </div>
        <div class="ro-card-metrics">
          <span>🏘 ${slot.settlementCount} village${slot.settlementCount === 1 ? '' : 's'}</span>
          <span>🐾 ${slot.livingKinCount} kin</span>
          <span>🏡 ${slot.totalBuildings} bldgs</span>
          <span>✦ ${escapeHtml(slot.deityName)}</span>
          <span class="ro-muted">Seed #${slot.seed} · Saved ${escapeHtml(formatSavedTime(slot.savedAt))}</span>
        </div>
      </div>
    `;
  }
}
