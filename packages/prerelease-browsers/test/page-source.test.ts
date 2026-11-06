import {
  composePage,
  escapeInlineScript,
  readRrwebUmd,
} from '../src/node/page-source.ts';
const meta = { id: 'x-check', kind: 'functional', tier: 'full' } as const;

test('scripts appear in protocol order', () => {
  const html = composePage(
    { ...meta, head: '<style>.a{}</style>' },
    'BUNDLE',
    'RRWEB',
  );
  const order = [
    '<style>.a{}</style>',
    'BUNDLE',
    '__prerelease.beforeRrweb("x-check")',
    'RRWEB',
  ];
  const at = order.map((s) => html.indexOf(s));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(html).not.toContain('__prerelease.start(');
});
test('startDuringLoad adds the start call after rrweb', () => {
  const html = composePage(
    { ...meta, startDuringLoad: true },
    'BUNDLE_STUB',
    'RRWEB_STUB',
  );
  const rrwebAt = html.indexOf('RRWEB_STUB');
  const startAt = html.indexOf('__prerelease.start("x-check", {})');
  expect(rrwebAt).toBeGreaterThanOrEqual(0);
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(startAt).toBeGreaterThan(rrwebAt);
});
test('inlined sources cannot close their script tag', () => {
  expect(escapeInlineScript('a="</script>";b="</SCRIPT >"')).toBe(
    'a="<\\/script>";b="<\\/SCRIPT >"',
  );
  expect(composePage(meta, 'x="</script>"', 'y')).not.toMatch(/x="<\/script>"/);
});
test('missing rrweb build gives the build command', () => {
  expect(() => readRrwebUmd('/nonexistent')).toThrow(
    'yarn turbo run prepublish --filter=rrweb',
  );
});
