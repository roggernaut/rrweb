/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { StylesheetManager } from '../../src/record/stylesheet-manager';

describe('StylesheetManager privacy', () => {
  it('records adopted stylesheet rules unmodified even under a strict privacy policy', () => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    const style = document.createElement('style');
    style.textContent = '.x { content: "person@example.com"; }';
    document.head.appendChild(style);
    expect(style.sheet?.cssRules.length).toBeGreaterThan(0);

    const emitted: unknown[] = [];
    // CSS is never masked, on any path: StylesheetManager has no privacy
    // hook at all, so adopted-sheet rules pass through verbatim regardless
    // of the caller's privacyPolicy (e.g. { version: 1, preset: 'strict' }).
    const manager = new StylesheetManager({
      mutationCb: () => undefined,
      adoptedStyleSheetCb: (data) => {
        emitted.push(data);
      },
    });
    manager.adoptStyleSheets([style.sheet!], 1);

    const payload = JSON.stringify(emitted);
    expect(payload).toContain('person@example.com');
    expect(payload).not.toContain('xxxxxx@xxxxxxx.xxx');
  });
});
