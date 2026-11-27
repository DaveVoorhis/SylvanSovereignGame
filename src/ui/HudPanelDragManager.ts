import {
  HUD_PANEL_IDS,
  sanitizeHudPanelPositions,
  type HudPanelId,
  type HudPanelPosition,
  type HudPanelPositions,
} from '@core/SaveStore';

const BASE_Z_INDEX = 13;
const DEFAULT_EDGE_MARGIN = 8;
const DEFAULT_DRAG_THRESHOLD_PX = 3;
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [data-no-drag]';

export interface DraggablePanelRegistration {
  readonly id: HudPanelId;
  readonly element: HTMLElement;
  /** CSS selector for the drag handle inside the element. If omitted, the whole element is draggable. */
  readonly handleSelector?: string;
}

export interface HudPanelDragOptions {
  /** Minimum margin in pixels from the viewport edges when clamping. Defaults to 8. */
  readonly edgeMargin?: number;
  /** Movement threshold in pixels before a pointer press becomes a drag. Defaults to 3. */
  readonly dragThresholdPx?: number;
  /** Called whenever a panel's saved position is added, moved, or reset. */
  readonly onPositionsChange?: (positions: HudPanelPositions) => void;
  /** Optional viewport dimensions provider (defaults to window.innerWidth / window.innerHeight). */
  readonly getViewportSize?: () => { width: number; height: number };
}

interface ActiveDragState {
  readonly id: HudPanelId;
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originLeft: number;
  readonly originTop: number;
  readonly width: number;
  readonly height: number;
  moved: boolean;
}

function getDefaultViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return {
    width: window.innerWidth ?? 0,
    height: window.innerHeight ?? 0,
  };
}

function targetMatchesHandle(
  target: EventTarget | null,
  panelEl: HTMLElement,
  handleSelector?: string,
): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (typeof el.closest === 'function' && el.closest(INTERACTIVE_SELECTOR)) {
    return false;
  }
  if (!handleSelector) {
    return true;
  }
  if (typeof el.closest !== 'function') {
    return false;
  }
  const handle = el.closest(handleSelector);
  if (!handle) return false;
  if (typeof panelEl.contains === 'function') {
    return panelEl.contains(handle);
  }
  return true;
}

/**
 * Enables drag-and-drop repositioning for floating HUD boxes with viewport clamping,
 * z-index focus stacking, double-click reset to default layout, and save/restore support.
 */
export class HudPanelDragManager {
  private readonly edgeMargin: number;
  private readonly dragThresholdPx: number;
  private readonly onPositionsChange?: (positions: HudPanelPositions) => void;
  private readonly getViewportSize: () => { width: number; height: number };

  private readonly panels = new Map<HudPanelId, DraggablePanelRegistration>();
  private readonly stackOrder: HudPanelId[] = [];
  private readonly positions: Partial<Record<HudPanelId, HudPanelPosition>> = {};
  private readonly cleanups: Array<() => void> = [];

  private activeDrag: ActiveDragState | null = null;
  private readonly onWindowPointerMoveBound: (ev: PointerEvent) => void;
  private readonly onWindowPointerUpBound: (ev: PointerEvent) => void;
  private readonly onWindowResizeBound: () => void;

  constructor(options: HudPanelDragOptions = {}) {
    this.edgeMargin = options.edgeMargin ?? DEFAULT_EDGE_MARGIN;
    this.dragThresholdPx = options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX;
    this.onPositionsChange = options.onPositionsChange;
    this.getViewportSize = options.getViewportSize ?? getDefaultViewportSize;

    this.onWindowPointerMoveBound = (ev) => this.handlePointerMove(ev);
    this.onWindowPointerUpBound = (ev) => this.handlePointerEnd(ev);
    this.onWindowResizeBound = () => this.clampAllVisible();

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', this.onWindowResizeBound);
    }
  }

  register(reg: DraggablePanelRegistration): void {
    this.panels.set(reg.id, reg);
    reg.element.classList?.add?.('hud-draggable');

    if (!this.stackOrder.includes(reg.id)) {
      this.stackOrder.push(reg.id);
      this.syncStackZIndices();
    }

    const onPointerDown = (ev: PointerEvent) => {
      this.bringToFront(reg.id);
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (!targetMatchesHandle(ev.target, reg.element, reg.handleSelector)) return;
      if (typeof reg.element.getBoundingClientRect !== 'function') return;

      const rect = reg.element.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) return;

      ev.stopPropagation?.();
      this.cancelActiveDrag();

      this.activeDrag = {
        id: reg.id,
        element: reg.element,
        pointerId: ev.pointerId,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
      };

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pointermove', this.onWindowPointerMoveBound);
        window.addEventListener('pointerup', this.onWindowPointerUpBound);
        window.addEventListener('pointercancel', this.onWindowPointerUpBound);
      }
    };

    const onDblClick = (ev: MouseEvent) => {
      if (!targetMatchesHandle(ev.target, reg.element, reg.handleSelector)) return;
      if (!this.positions[reg.id]) return;
      ev.stopPropagation?.();
      this.resetPanelPosition(reg.id);
    };

    reg.element.addEventListener('pointerdown', onPointerDown as EventListener);
    reg.element.addEventListener('dblclick', onDblClick as EventListener);

    this.cleanups.push(() => {
      reg.element.removeEventListener?.('pointerdown', onPointerDown as EventListener);
      reg.element.removeEventListener?.('dblclick', onDblClick as EventListener);
    });

    if (this.positions[reg.id]) {
      this.applyPanelStoredPosition(reg.id);
    }
  }

  getPositions(): HudPanelPositions {
    const out: Partial<Record<HudPanelId, HudPanelPosition>> = {};
    for (const id of HUD_PANEL_IDS) {
      const pos = this.positions[id];
      if (pos) {
        out[id] = { x: pos.x, y: pos.y };
      }
    }
    return out;
  }

  setPositions(positions: HudPanelPositions | undefined): void {
    this.cancelActiveDrag();
    const sanitized = sanitizeHudPanelPositions(positions);

    for (const id of HUD_PANEL_IDS) {
      delete this.positions[id];
    }

    for (const id of HUD_PANEL_IDS) {
      const next = sanitized[id];
      const reg = this.panels.get(id);
      if (next) {
        this.positions[id] = { x: next.x, y: next.y };
        if (reg) {
          this.applyPanelStoredPosition(id);
        }
      } else if (reg) {
        this.clearElementPosition(reg.element);
      }
    }
  }

  resetPanelPosition(id: HudPanelId): void {
    const hadPos = Boolean(this.positions[id]);
    delete this.positions[id];
    const reg = this.panels.get(id);
    if (reg) {
      this.clearElementPosition(reg.element);
    }
    if (hadPos) {
      this.onPositionsChange?.(this.getPositions());
    }
  }

  resetAllPositions(): void {
    let changed = false;
    for (const id of HUD_PANEL_IDS) {
      if (this.positions[id]) {
        delete this.positions[id];
        changed = true;
      }
      const reg = this.panels.get(id);
      if (reg) {
        this.clearElementPosition(reg.element);
      }
    }
    if (changed) {
      this.onPositionsChange?.(this.getPositions());
    }
  }

  clampPanel(id: HudPanelId): void {
    if (this.activeDrag?.id === id) return;
    if (!this.positions[id]) return;
    this.applyPanelStoredPosition(id);
  }

  clampAllVisible(): void {
    for (const id of this.panels.keys()) {
      this.clampPanel(id);
    }
  }

  bringToFront(id: HudPanelId): void {
    const idx = this.stackOrder.indexOf(id);
    if (idx === -1 || idx === this.stackOrder.length - 1) return;
    this.stackOrder.splice(idx, 1);
    this.stackOrder.push(id);
    this.syncStackZIndices();
  }

  dispose(): void {
    this.cancelActiveDrag();
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups.length = 0;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this.onWindowResizeBound);
    }
  }

  private handlePointerMove(ev: PointerEvent): void {
    const drag = this.activeDrag;
    if (!drag || ev.pointerId !== drag.pointerId) return;

    const dx = ev.clientX - drag.startClientX;
    const dy = ev.clientY - drag.startClientY;

    if (!drag.moved) {
      if (Math.hypot(dx, dy) < this.dragThresholdPx) return;
      drag.moved = true;
      drag.element.classList?.add?.('is-dragging');
      if (typeof document !== 'undefined') {
        document.body?.classList?.add?.('hud-panel-dragging');
      }
    }

    ev.preventDefault?.();

    const clamped = this.clampCoordinates(
      drag.originLeft + dx,
      drag.originTop + dy,
      drag.width,
      drag.height,
    );
    this.positions[drag.id] = clamped;
    this.applyElementPosition(drag.element, clamped);
  }

  private handlePointerEnd(ev: PointerEvent): void {
    const drag = this.activeDrag;
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const didMove = drag.moved;
    this.cancelActiveDrag();
    if (didMove) {
      this.onPositionsChange?.(this.getPositions());
    }
  }

  private cancelActiveDrag(): void {
    if (!this.activeDrag) return;
    const { element } = this.activeDrag;
    this.activeDrag = null;

    element.classList?.remove?.('is-dragging');
    if (typeof document !== 'undefined') {
      document.body?.classList?.remove?.('hud-panel-dragging');
    }

    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pointermove', this.onWindowPointerMoveBound);
      window.removeEventListener('pointerup', this.onWindowPointerUpBound);
      window.removeEventListener('pointercancel', this.onWindowPointerUpBound);
    }
  }

  private applyPanelStoredPosition(id: HudPanelId): void {
    const pos = this.positions[id];
    const reg = this.panels.get(id);
    if (!pos || !reg) return;

    let targetPos = pos;
    if (typeof reg.element.getBoundingClientRect === 'function') {
      const rect = reg.element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        targetPos = this.clampCoordinates(pos.x, pos.y, rect.width, rect.height);
      }
    }
    this.applyElementPosition(reg.element, targetPos);
  }

  private clampCoordinates(x: number, y: number, width: number, height: number): HudPanelPosition {
    const { width: vw, height: vh } = this.getViewportSize();
    if (vw <= 0 || vh <= 0) {
      return { x: Math.round(x), y: Math.round(y) };
    }
    const maxX = Math.max(this.edgeMargin, vw - width - this.edgeMargin);
    const maxY = Math.max(this.edgeMargin, vh - height - this.edgeMargin);
    const clampedX = Math.min(maxX, Math.max(this.edgeMargin, x));
    const clampedY = Math.min(maxY, Math.max(this.edgeMargin, y));
    return { x: Math.round(clampedX), y: Math.round(clampedY) };
  }

  private applyElementPosition(element: HTMLElement, pos: HudPanelPosition): void {
    const style = element.style;
    if (!style) return;
    const leftVal = `${pos.x}px`;
    const topVal = `${pos.y}px`;
    if (style.left !== leftVal) style.left = leftVal;
    if (style.top !== topVal) style.top = topVal;
    if (style.right !== 'auto') style.right = 'auto';
    if (style.bottom !== 'auto') style.bottom = 'auto';
    if (style.transform !== 'none') style.transform = 'none';
  }

  private clearElementPosition(element: HTMLElement): void {
    const style = element.style;
    if (!style) return;
    style.left = '';
    style.top = '';
    style.right = '';
    style.bottom = '';
    style.transform = '';
  }

  private syncStackZIndices(): void {
    for (let i = 0; i < this.stackOrder.length; i++) {
      const reg = this.panels.get(this.stackOrder[i]);
      if (reg?.element.style) {
        reg.element.style.zIndex = String(BASE_Z_INDEX + i);
      }
    }
  }
}
