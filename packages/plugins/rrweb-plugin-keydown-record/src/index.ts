import type { IMirror, RecordPlugin } from '@rrweb/types';

export type KeydownRecordOptions = {
  /**
   * Also record printable keys pressed without Control, Alt or Meta.
   * Off by default: typed text already reaches the recording through input
   * events, where rrweb's masking options apply. Recording printable keydowns
   * would be an unmasked second copy of everything typed, passwords included.
   */
  recordPrintable: boolean;
  /**
   * Keydowns whose target matches this selector, or sits inside an element
   * that does, are not recorded.
   */
  ignoreSelector: string;
};

export type KeydownPayload = {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  /** rrweb node id of the event target, or null when it is not in the mirror. */
  targetId: number | null;
};

export const PLUGIN_NAME = 'rrweb/keydown@1';

const defaultOptions: KeydownRecordOptions = {
  recordPrintable: false,
  ignoreSelector: '.rr-ignore, [data-rr-ignore]',
};

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

function isPrintable(event: KeyboardEvent): boolean {
  return event.key.length === 1;
}

function isSecretField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement &&
    target.type.toLowerCase() === 'password'
  );
}

function matchesIgnore(target: EventTarget | null, selector: string): boolean {
  if (!selector || !(target instanceof Element)) return false;
  try {
    return target.closest(selector) !== null;
  } catch {
    return false;
  }
}

/**
 * Records keydown events that rrweb core does not capture: Enter, Tab, Escape,
 * arrow keys, function keys and shortcuts such as Control+A. Each event carries
 * the rrweb id of the focused element so consumers can attribute the key press.
 */
export const getRecordKeydownPlugin: (
  options?: Partial<KeydownRecordOptions>,
) => RecordPlugin<KeydownRecordOptions> = (options) => {
  const _options: KeydownRecordOptions = Object.assign(
    {},
    defaultOptions,
    options,
  );
  let mirror: IMirror<Node> | null = null;

  return {
    name: PLUGIN_NAME,
    options: _options,
    getMirror(mirrors) {
      mirror = mirrors.nodeMirror;
    },
    observer(cb, win, opts) {
      const doc = win.document;
      const onKeydown = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        if (MODIFIER_KEYS.has(event.key)) return;
        if (matchesIgnore(event.target, opts.ignoreSelector)) return;
        const shortcut = event.ctrlKey || event.altKey || event.metaKey;
        if (isPrintable(event) && !shortcut) {
          // Printable keys never leave a password field, even when opted in.
          if (!opts.recordPrintable || isSecretField(event.target)) return;
        }
        const payload: KeydownPayload = {
          key: event.key,
          code: event.code,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          targetId:
            mirror && event.target instanceof Node
              ? mirror.getId(event.target)
              : null,
        };
        cb(payload);
      };
      doc.addEventListener('keydown', onKeydown, {
        capture: true,
        passive: true,
      });
      return () => {
        doc.removeEventListener('keydown', onKeydown, { capture: true });
      };
    },
  };
};
