/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import snapshot from '../src/snapshot';
import type { PrivacyPolicy } from '../src/types';

function serialize(html: string, privacyPolicy?: PrivacyPolicy): string {
  document.body.innerHTML = html;
  return JSON.stringify(snapshot(document, { privacyPolicy }));
}

/** Attaches an open shadow root to `#host` and fills it. */
function withShadowRoot(lightHtml: string, shadowHtml: string): void {
  document.body.innerHTML = lightHtml;
  const host = document.querySelector('#host') as HTMLElement;
  host.attachShadow({ mode: 'open' }).innerHTML = shadowHtml;
}

describe('text masking v2', () => {
  const strict: PrivacyPolicy = { version: 1, preset: 'strict' };

  it('strict masks page text', () => {
    expect(serialize('<p>hello world</p>', strict)).not.toContain(
      'hello world',
    );
  });

  it('never masks <style> text, even under strict inside masked subtrees', () => {
    const out = serialize(
      '<div><style>body{color:red}</style><p>secret</p></div>',
      strict,
    );
    expect(out).toMatch(/body\s*\{\s*color:\s*red/);
    expect(out).not.toContain('secret');
  });

  it('never masks the <style> text node itself when the css is not captured as _cssText', () => {
    document.body.innerHTML =
      '<div><style>body{color:red}</style><p>secret</p></div>';
    const styleEl = document.querySelector('style') as HTMLStyleElement;
    // with no CSSOM sheet (CSP, cross-origin) the CSS stays on the text node
    // instead of moving to `_cssText`, which is what actually exercises
    // serializeTextNode's `isStyle` exemption
    Object.defineProperty(styleEl, 'sheet', { get: () => null });
    const out = JSON.stringify(snapshot(document, { privacyPolicy: strict }));
    expect(out).toContain('body{color:red}');
    expect(out).not.toContain('secret');
  });

  it('unmask selector wins for its subtree, nearest ancestor decides', () => {
    const out = serialize(
      '<div class="rr-unmask"><p>visible</p><div class="rr-mask"><p>hidden</p></div></div>',
      strict,
    );
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
  });

  it('detectors mask the whole text node under legacy when configured', () => {
    const withDetectors: PrivacyPolicy = {
      version: 1,
      preset: 'legacy',
      detectors: { paymentCard: true, phone: true },
    };
    const out = serialize(
      '<p>call 5551234567 4111 1111 1111 1111 now</p>',
      withDetectors,
    );
    expect(out).not.toContain('4111 1111 1111 1111');
  });

  it('keeps masking inherited from an ancestor outside the shadow root', () => {
    withShadowRoot(
      '<div class="rr-mask"><div id="host"></div></div>',
      '<p>secret</p>',
    );
    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'balanced' },
      }),
    );
    expect(out).not.toContain('secret');
  });

  it('lets an unmask selector inside the shadow root escape a masked host', () => {
    withShadowRoot(
      '<div class="rr-mask"><div id="host"></div></div>',
      '<div class="rr-unmask"><p>visible</p></div>',
    );
    const out = JSON.stringify(
      snapshot(document, {
        privacyPolicy: { version: 1, preset: 'balanced' },
      }),
    );
    expect(out).toContain('visible');
  });

  it('masks a text node parented directly by a shadow root under strict', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector('#host') as HTMLElement;
    host
      .attachShadow({ mode: 'open' })
      .appendChild(document.createTextNode('secret'));
    const out = JSON.stringify(snapshot(document, { privacyPolicy: strict }));
    expect(out).not.toContain('secret');
  });

  it('legacy without detectors leaves text untouched', () => {
    expect(serialize('<p>bob@example.com</p>', undefined)).toContain(
      'bob@example.com',
    );
  });
});
