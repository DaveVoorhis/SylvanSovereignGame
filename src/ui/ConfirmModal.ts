export interface ConfirmModalOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: 'default' | 'danger';
  readonly onConfirm: () => void;
  readonly onClose?: () => void;
}

/**
 * Lightweight glass-panel confirmation modal styled consistently with the HUD
 * (blocks pointer/wheel propagation, closes on backdrop click or Cancel,
 * and focuses Cancel by default to prevent accidental activation).
 */
export class ConfirmModal {
  readonly element: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;

  private open = false;
  private activeOnConfirm: (() => void) | null = null;
  private activeOnClose: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'creature-modal-backdrop hidden';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Confirmation');

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
    card.className = 'confirm-modal glass-panel';

    const header = document.createElement('div');
    header.className = 'cmodal-header';

    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'cmodal-title';

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'close-btn';
    this.closeBtn.textContent = '✕';
    this.closeBtn.title = 'Cancel (Esc)';
    this.closeBtn.setAttribute('aria-label', 'Cancel');
    this.closeBtn.addEventListener('click', () => this.close());

    header.append(this.titleEl, this.closeBtn);

    this.messageEl = document.createElement('p');
    this.messageEl.className = 'confirm-modal-message';

    const actions = document.createElement('div');
    actions.className = 'confirm-modal-actions';

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.className = 'hud-btn';
    this.cancelBtn.textContent = 'Cancel';
    this.cancelBtn.addEventListener('click', () => this.close());

    this.confirmBtn = document.createElement('button');
    this.confirmBtn.type = 'button';
    this.confirmBtn.className = 'hud-btn confirm-modal-primary';
    this.confirmBtn.addEventListener('click', () => {
      const cb = this.activeOnConfirm;
      this.close();
      cb?.();
    });

    actions.append(this.cancelBtn, this.confirmBtn);
    card.append(header, this.messageEl, actions);
    this.element.appendChild(card);
  }

  isOpen(): boolean {
    return this.open;
  }

  openModal(options: ConfirmModalOptions): void {
    this.open = true;
    this.activeOnConfirm = options.onConfirm;
    this.activeOnClose = options.onClose ?? null;
    this.element.setAttribute('aria-label', options.title);
    this.titleEl.textContent = options.title;
    this.messageEl.textContent = options.message;
    this.cancelBtn.textContent = options.cancelLabel ?? 'Cancel';
    this.confirmBtn.textContent = options.confirmLabel;
    this.confirmBtn.classList.toggle('danger', options.tone === 'danger');
    this.element.classList.remove('hidden');
    if (typeof this.cancelBtn.focus === 'function') {
      this.cancelBtn.focus();
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    const onClose = this.activeOnClose;
    this.activeOnConfirm = null;
    this.activeOnClose = null;
    this.element.classList.add('hidden');
    onClose?.();
  }
}
