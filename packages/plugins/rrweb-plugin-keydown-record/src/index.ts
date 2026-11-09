import type { IMirror, RecordPlugin } from '@rrweb/types';

export type KeydownRecordOptions = {
  /**
   * Also record keys that type a character. That text already reaches the
   * recording through input events; here it is left out wherever the recorder
   * masks input, and in password fields.
   */
  recordPrintable: boolean;
};

export type KeydownPayload = {
  // -1 when the target is not in the mirror
  id: number;
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
};

export const PLUGIN_NAME = 'rrweb/keydown@1';

const defaultOptions: KeydownRecordOptions = {
  recordPrintable: false,
};

type KeyKind = 'modifier' | 'text' | 'command';

const MODIFIER_KEYS = ['Control', 'Alt', 'AltGraph', 'Shift', 'Meta'];

function getKeyKind(event: KeyboardEvent): KeyKind {
  if (MODIFIER_KEYS.includes(event.key)) return 'modifier';
  if (event.key.length !== 1) return 'command';
  // AltGr, and Option on macOS, compose characters; Alt alone is not a shortcut
  const shortcut =
    (event.ctrlKey || event.metaKey) && !event.getModifierState('AltGraph');
  return shortcut ? 'command' : 'text';
}

function getEventTarget(event: Event): Element | null {
  // events from a shadow root reach the document retargeted to its host
  const target = (event.composedPath()[0] || event.target) as Node | null;
  // not instanceof: the target may belong to an iframe's realm
  return target && target.nodeType === 1 ? (target as Element) : null;
}

// rrweb sets data-rr-is-password when a password input's type is changed
function isPassword(target: Element): boolean {
  return (
    target.tagName === 'INPUT' &&
    ((target as HTMLInputElement).type === 'password' ||
      target.hasAttribute('data-rr-is-password'))
  );
}

export const getRecordKeydownPlugin: (
  options?: Partial<KeydownRecordOptions>,
) => RecordPlugin<KeydownRecordOptions> = (options) => {
  const _options = Object.assign({}, defaultOptions, options);
  let mirror: IMirror<Node> | undefined;

  return {
    name: PLUGIN_NAME,
    options: _options,
    getMirror(mirrors) {
      mirror = mirrors.nodeMirror;
    },
    observer(cb, win, options, privacy) {
      const shouldRecord = (kind: KeyKind, target: Element | null): boolean => {
        if (target && privacy.isIgnored(target)) return false;
        switch (kind) {
          case 'modifier':
            return false;
          case 'command':
            return true;
          case 'text':
            return (
              options.recordPrintable &&
              !(target && (isPassword(target) || privacy.isMasked(target)))
            );
        }
      };
      const onKeydown = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        const target = getEventTarget(event);
        if (!shouldRecord(getKeyKind(event), target)) return;
        const payload: KeydownPayload = {
          id: target && mirror ? mirror.getId(target) : -1,
          key: event.key,
          code: event.code,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
        };
        cb(payload);
      };
      const listenerOptions = { capture: true, passive: true };
      win.document.addEventListener('keydown', onKeydown, listenerOptions);
      return () => {
        win.document.removeEventListener('keydown', onKeydown, listenerOptions);
      };
    },
  };
};
