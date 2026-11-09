import { DeadlineReached } from '../src/node/run-check.ts';
import { toTarget, type BrowserStackSpec } from '../src/node/browserstack.ts';

const key = 'access-key-that-must-never-appear';

const playwright = vi.hoisted(() => ({
  connect: vi.fn(),
}));
vi.mock('playwright', () => ({
  chromium: { connect: playwright.connect },
  webkit: { connect: playwright.connect },
  _android: { connect: playwright.connect },
}));

const spec: BrowserStackSpec = {
  id: 'bs-chrome-beta',
  route: 'playwright-desktop',
  caps: { browser: 'chrome' },
} as unknown as BrowserStackSpec;

const run = (deadline?: Date) => ({
  build: 'b',
  playwrightVersion: '1',
  ...(deadline ? { deadline } : {}),
});

const saved = { ...process.env };
beforeEach(() => {
  process.env.BROWSERSTACK_USERNAME = 'user';
  process.env.BROWSERSTACK_ACCESS_KEY = key;
  playwright.connect.mockReset();
});
afterEach(() => {
  process.env = { ...saved };
});

const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (err: unknown) => err as Error,
  );

test('a failed connect names no credentials', async () => {
  playwright.connect.mockRejectedValue(new Error(`refused for ${key}`));
  const err = await failure(toTarget(spec, run()).connect());
  expect(err?.message).toContain('refused for');
  expect(err?.message).not.toContain(key);
});

test('a session error after connecting names no credentials', async () => {
  const page = {
    evaluate: () => Promise.reject(new Error(`gone: ${key}`)),
  };
  const context = { newPage: () => Promise.resolve(page) };
  playwright.connect.mockResolvedValue({
    newContext: () => Promise.resolve(context),
    close: () => Promise.resolve(),
  });
  const driver = await toTarget(spec, run()).connect();
  const err = await failure(driver.evaluate('1'));
  expect(err?.message).toContain('gone:');
  expect(err?.message).not.toContain(key);
});

test('a connect that runs out the deadline is a DeadlineReached', async () => {
  const deadline = new Date(Date.now() + 20);
  playwright.connect.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 40));
    throw new Error(`timed out for ${key}`);
  });
  const err = await failure(toTarget(spec, run(deadline)).connect());
  expect(err).toBeInstanceOf(DeadlineReached);
  expect(err?.message).not.toContain(key);
});

test('another connect error is not a DeadlineReached', async () => {
  playwright.connect.mockRejectedValue(new Error('bad caps'));
  const err = await failure(
    toTarget(spec, run(new Date(Date.now() + 60_000))).connect(),
  );
  expect(err).not.toBeInstanceOf(DeadlineReached);
});
