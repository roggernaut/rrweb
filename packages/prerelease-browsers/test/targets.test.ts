import { githubTargets } from '../src/node/targets.ts';

const mocks = vi.hoisted(() => ({
  startDriverProcess: vi.fn(),
  connectSelenium: vi.fn(),
}));

vi.mock('../src/node/driver-process.ts', () => ({
  startDriverProcess: mocks.startDriverProcess,
}));
vi.mock('../src/node/drivers/selenium.ts', () => ({
  connectSelenium: mocks.connectSelenium,
}));

describe('firefox-android-nightly capabilities', () => {
  test('carry the Fenix intent arguments that skip its onboarding screen', async () => {
    mocks.startDriverProcess.mockResolvedValue({
      url: 'http://127.0.0.1:4444',
      stop: () => Promise.resolve(),
    });
    mocks.connectSelenium.mockResolvedValue({});
    vi.stubEnv('GECKODRIVER', '/fake/geckodriver');
    try {
      const target = githubTargets.find(
        (t) => t.id === 'firefox-android-nightly',
      );
      if (!target) throw new Error('firefox-android-nightly target missing');
      await target.connect();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(mocks.connectSelenium).toHaveBeenCalledOnce();
    const [opts] = mocks.connectSelenium.mock.calls[0] as [
      { capabilities: unknown },
    ];
    const { capabilities } = opts;
    // Setting androidIntentArguments replaces geckodriver's defaults, so the
    // action and URL pairs repeat them. Without `performancetest`, a fresh
    // profile stays on the onboarding screen and requestAnimationFrame never
    // fires.
    expect(capabilities).toEqual({
      browserName: 'firefox',
      'moz:firefoxOptions': {
        androidPackage: 'org.mozilla.fenix',
        androidDeviceSerial: 'emulator-5554',
        androidIntentArguments: [
          '-a',
          'android.intent.action.VIEW',
          '-d',
          'about:blank',
          '--ez',
          'performancetest',
          'true',
        ],
      },
    });
  });
});
