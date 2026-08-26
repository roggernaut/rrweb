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

  it('legacy without detectors leaves text untouched', () => {
    expect(serialize('<p>bob@example.com</p>', undefined)).toContain(
      'bob@example.com',
    );
  });
});
