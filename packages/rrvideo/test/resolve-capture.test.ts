import {
  resolveCapture,
  resolveConfig,
  shouldUseBeginFrame,
} from '../src/config';

describe('resolveCapture', () => {
  it('keeps Playwright video as the default for webm output', () => {
    expect(resolveCapture({ input: 'a.json' })).toBe('playwright');
    expect(resolveCapture({ input: 'a.json', output: 'out.webm' })).toBe(
      'playwright',
    );
  });

  it('selects ffmpeg for mp4 output or an explicit fps', () => {
    expect(resolveCapture({ input: 'a.json', output: 'out.mp4' })).toBe(
      'ffmpeg',
    );
    expect(resolveCapture({ input: 'a.json', fps: 60 })).toBe('ffmpeg');
    expect(
      resolveCapture({
        input: 'a.json',
        output: 'out.webm',
        capture: 'ffmpeg',
      }),
    ).toBe('ffmpeg');
  });
});

describe('shouldUseBeginFrame', () => {
  const platform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
  });

  it('defaults to BeginFrame only for headless Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const config = resolveConfig({ input: 'a.json', output: 'out.mp4' });
    expect(config.beginFrame).toBe('auto');
    expect(shouldUseBeginFrame(config)).toBe(true);
    expect(shouldUseBeginFrame({ ...config, headless: false })).toBe(false);

    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(shouldUseBeginFrame(config)).toBe(false);
  });

  it('respects an explicit setting', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const config = resolveConfig({ input: 'a.json', beginFrame: true });
    expect(shouldUseBeginFrame(config)).toBe(true);
    expect(shouldUseBeginFrame({ ...config, beginFrame: false })).toBe(false);
  });
});
