export type LoadProgressCallback = (percent: number, stageLabel: string) => void;

export const WHIMSICAL_HINTS: readonly string[] = [
  'Woodland folk raise cottages, arched bridges, and bakeries all on their own — or you may whisper to their sovereign.',
  'Every pine on these ridges is grown uniquely from seed — no two share the same silhouette.',
  'Click any fox, badger, owl, or otter and press V to step straight into their eyes.',
  'Give the valley time, and bold pioneers will set out to found distant highland and coastal villages.',
  'Press Z at any time to slip into pure Zen Mode — nothing but wind, water, and living forest.',
];

/**
 * Yields control back to the browser long enough to commit a visual repaint of the
 * splash progress bar and whimsical stage text before the next synchronous build step.
 * Includes a short timer fallback so loading still completes cleanly in background tabs.
 */
export function nextPaintFrame(): Promise<void> {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(done, 45);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.clearTimeout(timer);
        done();
      });
    });
  });
}

/**
 * Controls the whimsical initial loading splash screen and progress bar,
 * and can also be re-shown smoothly when generating a brand-new world or changing quality.
 */
export class SplashScreen {
  private readonly root: HTMLElement | null;
  private readonly fillEl: HTMLElement | null;
  private readonly trackEl: HTMLElement | null;
  private readonly pctEl: HTMLElement | null;
  private readonly stageEl: HTMLElement | null;
  private readonly hintEl: HTMLElement | null;
  private readonly subtitleEl: HTMLElement | null;
  private currentPercent = 0;
  private hintIndex: number;
  private lastHintChangePct = -100;

  constructor(rootElement?: HTMLElement | null) {
    this.root =
      rootElement !== undefined
        ? rootElement
        : typeof document !== 'undefined'
          ? document.getElementById('splash-screen')
          : null;
    this.fillEl = this.root?.querySelector<HTMLElement>('[data-splash-fill]') ?? null;
    this.trackEl = this.root?.querySelector<HTMLElement>('[data-splash-track]') ?? null;
    this.pctEl = this.root?.querySelector<HTMLElement>('[data-splash-pct]') ?? null;
    this.stageEl = this.root?.querySelector<HTMLElement>('[data-splash-stage]') ?? null;
    this.hintEl = this.root?.querySelector<HTMLElement>('[data-splash-hint]') ?? null;
    this.subtitleEl = this.root?.querySelector<HTMLElement>('[data-splash-subtitle]') ?? null;
    this.hintIndex = Math.floor(Math.random() * WHIMSICAL_HINTS.length);
    this.renderHint();
  }

  getPercent(): number {
    return this.currentPercent;
  }

  show(subtitle = 'Weaving a living woodland realm…'): void {
    this.currentPercent = 0;
    this.lastHintChangePct = -100;
    this.hintIndex = (this.hintIndex + 1) % WHIMSICAL_HINTS.length;
    if (this.subtitleEl) {
      this.subtitleEl.textContent = subtitle;
    }
    this.renderHint();
    if (this.root) {
      this.root.classList.remove('splash-hidden');
      this.root.setAttribute('aria-hidden', 'false');
    }
    this.setProgress(2, 'Gathering dawn mist over the valley…');
  }

  setProgress(percent: number, stageLabel: string): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.currentPercent = Math.max(this.currentPercent, clamped);

    if (this.fillEl) {
      this.fillEl.style.width = `${this.currentPercent}%`;
    }
    if (this.trackEl) {
      this.trackEl.setAttribute('aria-valuenow', String(this.currentPercent));
    }
    if (this.pctEl) {
      this.pctEl.textContent = `${this.currentPercent}%`;
    }
    if (this.stageEl) {
      this.stageEl.textContent = stageLabel;
    }

    // Gently advance the whimsical field note midway through loading so longer loads feel alive
    if (this.currentPercent - this.lastHintChangePct >= 42 && this.currentPercent < 95) {
      this.lastHintChangePct = this.currentPercent;
      this.hintIndex = (this.hintIndex + 1) % WHIMSICAL_HINTS.length;
      this.renderHint();
    }
  }

  async dismiss(delayMs = 260): Promise<void> {
    if (!this.root) return;
    if (delayMs > 0 && typeof window !== 'undefined') {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    this.root.classList.add('splash-hidden');
    this.root.setAttribute('aria-hidden', 'true');
  }

  private renderHint(): void {
    if (this.hintEl) {
      this.hintEl.textContent = WHIMSICAL_HINTS[this.hintIndex];
    }
  }
}
