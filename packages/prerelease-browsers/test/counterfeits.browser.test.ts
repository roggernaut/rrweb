import { runAttempt, runScenario } from '../src/node/run-check.ts';
import { buildPageBundle, readRrwebUmd } from '../src/node/page-source.ts';
import { launchPlaywright } from '../src/node/drivers/playwright.ts';
import type { PageDriver } from '../src/node/drivers/types.ts';
import { startFixtureServer } from '../src/node/fixture-server.ts';
import type { FixtureServer } from '../src/node/fixture-server.ts';
import { checks } from '../src/page/registry.ts';
import type { Engine } from '../src/types.ts';

/**
 * Each check must fail against a recorder that does less than rrweb does, or
 * it proves nothing: a recorder doing less also runs faster and leaks less.
 * A counterfeit is real rrweb with each event passed through `transform`, a
 * function in page JavaScript returning the event to emit, or null to drop it.
 * Working on recorded events keeps these tests off rrweb's internals.
 */
const counterfeit = (rrweb: string, transform: string) => `${rrweb}
;(() => {
  const real = window.rrweb;
  const transform = ${transform};
  const record = Object.assign(
    (options) =>
      real.record({
        ...options,
        emit(event, isCheckout) {
          const out = transform(event);
          if (out) options.emit(out, isCheckout);
        },
      }),
    real.record,
  );
  window.rrweb = { ...real, record };
})();`;

const INCREMENTAL = 'e.type === 3';
const walk = `function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
}`;
const onSnapshot = (visit: string) =>
  `(e) => { ${walk} if (e.type === 2) walk(e.data.node, ${visit}); return e; }`;
const allStars = `/^\\*+$/`;

/** Name, transform, and each check that must fail with the message it must give. */
const table: Array<[string, string, Array<[string, RegExp]>]> = [
  [
    'masked text dropped',
    `(e) => {
      ${walk}
      const clear = (n) => { if (n.type === 3 && ${allStars}.test(n.textContent)) n.textContent = ''; };
      if (e.type === 2) walk(e.data.node, clear);
      if (${INCREMENTAL} && e.data.source === 0) for (const a of e.data.adds) walk(a.node, clear);
      return e;
    }`,
    [['privacy-mask-text-class', /masked content not recorded/]],
  ],
  [
    'a modal dialog recorded on the wrong node',
    `(e) => {
      if (${INCREMENTAL} && e.data.source === 0)
        for (const a of e.data.attributes) if (a.attributes.rr_open_mode) a.id = 999999;
      return e;
    }`,
    [['dialog-top-layer', /the replayed dialog is not modal/]],
  ],
  [
    'a snapshot without the body',
    onSnapshot(`(n) => { if (n.tagName === 'body') n.childNodes = []; }`),
    [
      ['perf-snapshot-5k', /the snapshot holds/],
      ['perf-snapshot-20k', /the snapshot holds/],
      ['perf-snapshot-50k', /the snapshot holds/],
    ],
  ],
  [
    'a snapshot without the stylesheet',
    onSnapshot(
      `(n) => { if (n.tagName === 'style') { delete n.attributes._cssText; n.childNodes = []; } }`,
    ),
    [['perf-large-stylesheet', /does not hold the whole stylesheet/]],
  ],
  [
    'a mutation that loses most of its adds',
    `(e) => { if (${INCREMENTAL} && e.data.source === 0) e.data.adds = e.data.adds.slice(0, 10); return e; }`,
    [['perf-mutation-burst-10k', /Mutation events add 10 of/]],
  ],
  [
    'sampling only one canvas',
    `(() => { let first; return (e) => {
      if (${INCREMENTAL} && e.data.source === 9) { first ??= e.data.id; if (e.data.id !== first) return null; }
      return e;
    }; })()`,
    [['perf-sampled-canvases', /CanvasMutation events for 1 of/]],
  ],
  [
    'no record of a modal dialog',
    `(e) => { if (${INCREMENTAL} && e.data.source === 0) for (const a of e.data.attributes) delete a.attributes.rr_open_mode; return e; }`,
    [['dialog-top-layer', /recording the dialog as modal/]],
  ],
  [
    'canvas commands without their arguments',
    `(e) => { if (${INCREMENTAL} && e.data.source === 9) for (const c of e.data.commands) c.args = []; return e; }`,
    [
      ['canvas-2d', /canvas commands recorded/],
      ['canvas-webgl', /canvas commands recorded/],
    ],
  ],
  [
    'no sampled canvas frames',
    `(e) => { if (${INCREMENTAL} && e.data.source === 9) e.data.commands = e.data.commands.filter((c) => c.property !== 'drawImage'); return e; }`,
    [['canvas-sampled', /no sampled frame/]],
  ],
  [
    'no canvas recording',
    `(e) => (${INCREMENTAL} && e.data.source === 9 ? null : e)`,
    [['missing-webgl-types', /no CanvasMutation event/]],
  ],
  [
    'stylesheet rules recorded wrongly',
    `(e) => { if (${INCREMENTAL} && e.data.source === 8) for (const a of e.data.adds ?? []) a.rule = '.other{}'; return e; }`,
    [['missing-css-grouping-rule', /\.m2 color: live/]],
  ],
  [
    'masked input events dropped',
    `(e) => (${INCREMENTAL} && e.data.source === 5 && ${allStars}.test(e.data.text) ? null : e)`,
    [
      ['privacy-mask-all-inputs', /masked content not recorded/],
      ['privacy-input-types', /masked content not recorded/],
      ['privacy-password-default', /masked content not recorded/],
      ['privacy-mask-input-options', /masked content not recorded/],
      ['privacy-autofill', /masked content not recorded/],
    ],
  ],
  [
    'masked text edits dropped',
    `(e) => { if (${INCREMENTAL} && e.data.source === 0) e.data.texts = e.data.texts.filter((t) => !${allStars}.test(t.value)); return e; }`,
    [
      ['privacy-mask-text-selector', /masked content not recorded/],
      ['privacy-shadow-dom', /masked content not recorded/],
      ['privacy-adopted-stylesheet-shadow', /masked content not recorded/],
      ['privacy-mutation-after-snapshot', /masked content not recorded/],
    ],
  ],
  [
    'masked attributes dropped',
    `(e) => { if (${INCREMENTAL} && e.data.source === 0) e.data.attributes = e.data.attributes.filter((a) => !${allStars}.test(a.attributes.value)); return e; }`,
    [['privacy-attribute-mutation', /masked content not recorded/]],
  ],
  [
    'no placeholder for blocked elements',
    `(e) => JSON.parse(JSON.stringify(e).split('"rr_width"').join('"x"'))`,
    [
      ['privacy-block-class', /not recorded: blocked placeholder/],
      ['privacy-block-selector', /not recorded: blocked placeholder/],
    ],
  ],
  [
    'a replaced adopted stylesheet not recorded',
    `(e) => (${INCREMENTAL} && e.data.source === 15 && /rgb\\((0,\\s*128,\\s*0|13,\\s*14,\\s*15)\\)/.test(JSON.stringify(e.data)) ? null : e)`,
    [
      [
        'css-adopted-stylesheets',
        /no AdoptedStyleSheet event for the replaced/,
      ],
      [
        'privacy-adopted-stylesheet-shadow',
        /not recorded: the replaced stylesheet/,
      ],
    ],
  ],
  [
    'a cross-origin frame attached to the wrong parent',
    `(e) => { if (${INCREMENTAL} && e.data.source === 0 && e.data.isAttachIframe) for (const a of e.data.adds) a.parentId = 999999; return e; }`,
    [['iframe-cross-origin', /replayed iframe does not hold/]],
  ],
];

/** Checks rrweb main fails anyway, so failing here would prove nothing. */
const failsAnyway = ['privacy-canvas-block', 'tainted-input-getters'];

const timeoutMs = 60_000;
let bundle: string;
let rrweb: string;

beforeAll(async () => {
  bundle = await buildPageBundle();
  rrweb = readRrwebUmd();
  process.env.PRERELEASE_HTTP_PORT ??= '0';
}, 60_000);

async function withBrowser<T>(
  engine: Engine,
  umd: string,
  fn: (
    driver: PageDriver,
    src: { bundle: string; rrweb: string; httpOrigin: string },
  ) => Promise<T>,
): Promise<T> {
  const server: FixtureServer = await startFixtureServer({
    bundle,
    rrweb: umd,
  });
  const driver = await launchPlaywright({ engine });
  try {
    return await fn(driver, { bundle, rrweb: umd, httpOrigin: server.origin });
  } finally {
    await driver.close();
    await server.close();
  }
}

/** What one check reported: failing, and the message when it did. */
async function outcome(
  driver: PageDriver,
  id: string,
  src: { bundle: string; rrweb: string; httpOrigin: string },
) {
  const meta = checks.find((c) => c.id === id)!;
  if (meta.kind === 'performance') {
    const o = await runScenario(driver, meta, src, {
      samples: 1,
      timeoutMs,
      // Canvases are few, and scaling them down would leave only one.
      scale: id === 'perf-sampled-canvases' ? 1 : 0.02,
    });
    return { failed: o.status === 'fail', message: o.message };
  }
  const r = await runAttempt(driver, meta, src, { timeoutMs });
  return { failed: !r.ok, message: r.message };
}

describe.each(table)('against %s', (_name, transform, rows) => {
  test.each(rows)(
    '%s fails for that reason',
    { timeout: timeoutMs + 30_000 },
    async (id, reason) => {
      const { failed, message } = await withBrowser(
        'chromium',
        counterfeit(rrweb, transform),
        (driver, src) => outcome(driver, id, src),
      );
      expect(failed, `${id} passed`).toBe(true);
      expect(message).toMatch(reason);
    },
  );
});

test(
  'the same checks pass through a transform that changes nothing',
  { timeout: 5 * 60_000 },
  async () => {
    const ids = [
      ...new Set(table.flatMap(([, , rows]) => rows.map(([id]) => id))),
    ];
    const failing = await withBrowser(
      'chromium',
      counterfeit(rrweb, '(e) => e'),
      async (driver, src) => {
        const out: string[] = [];
        for (const id of ids) {
          const { failed, message } = await outcome(driver, id, src);
          if (failed) out.push(`${id}: ${message ?? ''}`);
        }
        return out;
      },
    );
    expect(failing).toEqual([]);
  },
);

test(
  'every check fails against a recorder that records nothing',
  { timeout: 5 * 60_000 },
  async () => {
    const passed = await withBrowser(
      'chromium',
      counterfeit(rrweb, '() => null'),
      async (driver, src) => {
        const out: string[] = [];
        for (const { id } of checks) {
          if (failsAnyway.includes(id)) continue;
          if (!(await outcome(driver, id, src)).failed) out.push(id);
        }
        return out;
      },
    );
    expect(passed).toEqual([]);
  },
);

// privacy-canvas-block is not here: it fails with masking on, so it would
// fail the same way with masking off and prove nothing.
const privacyIds = checks
  .filter((c) => c.kind === 'privacy' && !failsAnyway.includes(c.id))
  .map((c) => c.id);

describe.each<Engine>(['chromium', 'gecko', 'webkit'])(
  'with masking disabled on %s',
  (engine) => {
    test(
      'every privacy check leaks every canary',
      { timeout: 5 * 60_000 },
      async () => {
        const dead = await withBrowser(engine, rrweb, async (driver, src) => {
          const out: string[] = [];
          for (const id of privacyIds) {
            const result = await runAttempt(
              driver,
              checks.find((c) => c.id === id)!,
              src,
              { timeoutMs, disableMasking: true },
            );
            // A missing public control means recording broke, not masking,
            // and one live path says nothing about the others.
            if (
              result.kind !== 'privacy' ||
              result.canaries!.leaked.length !== result.canaries!.planted
            ) {
              out.push(`${id}: ${result.message ?? 'no leak'}`);
            }
          }
          return out;
        });
        expect(dead).toEqual([]);
      },
    );
  },
);
