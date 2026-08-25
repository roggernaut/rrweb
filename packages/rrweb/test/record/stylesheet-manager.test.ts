/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { applyPrivacyDetectors, compilePrivacyPolicy } from 'rrweb-snapshot';
import { StylesheetManager } from '../../src/record/stylesheet-manager';

describe('StylesheetManager privacy', () => {
  it('masks PII in newly adopted stylesheet rules', () => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    const style = document.createElement('style');
    style.textContent = '.x { content: "person@example.com"; }';
    document.head.appendChild(style);
    expect(style.sheet?.cssRules.length).toBeGreaterThan(0);

    const emitted: unknown[] = [];
    const manager = new StylesheetManager({
      mutationCb: () => undefined,
      adoptedStyleSheetCb: (data) => {
        emitted.push(data);
      },
      privacy: compilePrivacyPolicy(
        applyPrivacyDetectors({ version: 1, preset: 'balanced' }),
      ),
    });
    manager.adoptStyleSheets([style.sheet!], 1);

    const payload = JSON.stringify(emitted);
    expect(payload).not.toContain('person@example.com');
    expect(payload).toContain('xxxxxx@xxxxxxx.xxx');
  });
});
