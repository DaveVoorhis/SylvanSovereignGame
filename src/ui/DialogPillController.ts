export interface DialogPillButton {
  disabled: boolean;
  title: string;
  classList: { toggle(token: string, force?: boolean): boolean };
  setAttribute(name: string, value: string): void;
  addEventListener(type: 'click', listener: () => void): void;
  removeEventListener(type: 'click', listener: () => void): void;
}

export interface DialogPillBinding {
  readonly button: DialogPillButton;
  /** Returns true while this pill's associated dialog or panel is open. */
  readonly isOpen: () => boolean;
  /** Opens (or focuses) the associated dialog or panel. */
  readonly open: () => void;
  /** Closes the associated dialog or panel. */
  readonly close: () => void;
  /** Optional tooltip text derived from open state. */
  readonly getTitle?: (open: boolean) => string;
}

export interface DialogPillHandle {
  /** Synchronizes `.active`, `aria-pressed`, and optional tooltip with `isOpen()`. */
  sync(): void;
  /** Enforces consistent toggle behavior: closes when open, opens when closed. */
  toggle(): void;
  /** Detaches the click handler (e.g. when removing dynamic settlement pills). */
  dispose(): void;
}

/**
 * Shared controller for every main-panel pill that opens a dialog box or floating panel.
 * Clicking a pill whose associated dialog is already open always closes it, and active
 * visual / ARIA state stays consistently synchronized across all pills.
 */
export function bindDialogPill(binding: DialogPillBinding): DialogPillHandle {
  const sync = (): void => {
    const open = binding.isOpen();
    binding.button.classList.toggle('active', open);
    binding.button.setAttribute('aria-pressed', String(open));
    if (binding.getTitle) {
      const nextTitle = binding.getTitle(open);
      if (binding.button.title !== nextTitle) {
        binding.button.title = nextTitle;
      }
    }
  };

  const toggle = (): void => {
    if (binding.button.disabled) return;
    if (binding.isOpen()) {
      binding.close();
    } else {
      binding.open();
    }
    sync();
  };

  const onClick = (): void => toggle();
  binding.button.addEventListener('click', onClick);
  sync();

  return {
    sync,
    toggle,
    dispose(): void {
      binding.button.removeEventListener('click', onClick);
    },
  };
}
