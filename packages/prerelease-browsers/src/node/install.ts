import { spawn } from 'node:child_process';
import { createWriteStream, realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import {
  Browser,
  Cache,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  resolveBuildId,
} from '@puppeteer/browsers';

export const geckodriverVersion = '0.37.1';
const fenixNightlyRoot = 'https://ftp.mozilla.org/pub/fenix/nightly';

/** Fetches a directory listing; undefined when the directory doesn't exist. */
export type FetchListing = (url: string) => Promise<string | undefined>;

/**
 * Installs the browser (and driver) for one GitHub-runner target under `dir`.
 * Returns the env values the target's connect() reads; the workflow appends
 * them to $GITHUB_ENV. Safari targets and chrome-stable need nothing here:
 * the workflow installs Safari, and the runner image has Chrome.
 */
export async function installTarget(
  id: string,
  dir: string,
): Promise<Record<string, string>> {
  dir = resolve(dir);
  await mkdir(dir, { recursive: true });
  switch (id) {
    case 'chrome-canary':
      return {
        CHROME_PATH: await installBrowser(Browser.CHROME, 'canary', dir),
      };
    case 'chrome-dev':
      return { CHROME_PATH: await installBrowser(Browser.CHROME, 'dev', dir) };
    case 'edge-dev':
      await run(process.execPath, [
        playwrightCli(),
        'install',
        '--with-deps',
        'msedge-dev',
      ]);
      return {};
    case 'edge-stable':
      await run(process.execPath, [
        playwrightCli(),
        'install',
        '--with-deps',
        'msedge',
      ]);
      return {};
    case 'firefox-nightly':
    case 'firefox-stable':
      return {
        FIREFOX_BINARY: await installBrowser(
          Browser.FIREFOX,
          id === 'firefox-nightly' ? 'nightly' : 'stable',
          dir,
        ),
        GECKODRIVER: await installGeckodriver(dir),
      };
    case 'webkit-next': {
      const prefix = join(dir, 'pw-next');
      await run('npm', ['install', '--prefix', prefix, 'playwright@next']);
      const playwright = join(prefix, 'node_modules', 'playwright');
      await run(process.execPath, [
        join(playwright, 'cli.js'),
        'install',
        '--with-deps',
        'webkit',
      ]);
      return { PLAYWRIGHT_NEXT: playwright };
    }
    case 'firefox-android-nightly': {
      const apk = await findFenixNightlyApk(new Date(), fetchListing);
      return {
        FENIX_APK: await download(
          apk,
          join(dir, basename(new URL(apk).pathname)),
        ),
        GECKODRIVER: await installGeckodriver(dir),
      };
    }
    case 'chrome-stable':
    case 'safari-tp':
    case 'safari-stable':
      return {};
    default:
      throw new Error(`no install for target "${id}"`);
  }
}

/** Installs a Chrome for Testing or Firefox build for a channel; returns its executable. */
async function installBrowser(
  browser: Browser,
  tag: string,
  dir: string,
): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform)
    throw new Error('@puppeteer/browsers does not know this platform');
  const buildId = await resolveBuildId(browser, platform, tag);
  log(`installing ${browser} ${buildId} (${tag})`);
  if (browser !== Browser.CHROME) {
    return (await install({ browser, buildId, cacheDir: dir })).executablePath;
  }
  // Chrome for Testing ships as a zip, and the extract-zip that
  // @puppeteer/browsers unpacks it with never settles on Node 26: it stops
  // after a few dozen files and the process exits mid-await. The system
  // unzip does the same job.
  const archive = await install({
    browser,
    buildId,
    cacheDir: dir,
    unpack: false,
  });
  const target = new Cache(dir).installationDir(browser, platform, buildId);
  await run('unzip', ['-q', '-o', archive, '-d', target]);
  await rm(archive);
  return computeExecutablePath({ browser, buildId, cacheDir: dir, platform });
}

/** The geckodriver release asset name for this machine. */
function geckodriverAsset(): string {
  const key = `${process.platform}-${process.arch}`;
  const names: Record<string, string> = {
    'linux-x64': 'linux64',
    'linux-arm64': 'linux-aarch64',
    'darwin-x64': 'macos',
    'darwin-arm64': 'macos-aarch64',
  };
  const name = names[key];
  if (!name) throw new Error(`no geckodriver build for ${key}`);
  return `geckodriver-v${geckodriverVersion}-${name}.tar.gz`;
}

async function installGeckodriver(dir: string): Promise<string> {
  const asset = geckodriverAsset();
  const target = join(dir, `geckodriver-${geckodriverVersion}`);
  await mkdir(target, { recursive: true });
  const archive = await download(
    `https://github.com/mozilla/geckodriver/releases/download/v${geckodriverVersion}/${asset}`,
    join(target, asset),
  );
  await run('tar', ['-xzf', archive, '-C', target]);
  return join(target, 'geckodriver');
}

function previousMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

/** Absolute URLs of every link in a directory listing. */
function listingLinks(html: string, base: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map(
    (m) => new URL(m[1], base).href,
  );
}

/**
 * Finds the newest Firefox for Android nightly APK for x86_64 emulators. Builds
 * live in one directory per month; early in a month there may be none yet, so
 * the previous month is the fallback.
 */
export async function findFenixNightlyApk(
  now: Date,
  fetchListing: FetchListing,
): Promise<string> {
  for (const month of [now, previousMonth(now)]) {
    const yyyy = month.getUTCFullYear();
    const mm = String(month.getUTCMonth() + 1).padStart(2, '0');
    const monthUrl = `${fenixNightlyRoot}/${yyyy}/${mm}/`;
    const html = await fetchListing(monthUrl);
    if (!html) continue;
    // Directory names start with the build's timestamp, so they sort by age.
    const builds = listingLinks(html, monthUrl)
      .filter(
        (url) => url.startsWith(monthUrl) && url.endsWith('-android-x86_64/'),
      )
      .sort()
      .reverse();
    for (const build of builds) {
      const listing = await fetchListing(build);
      const apk = listingLinks(listing ?? '', build).find((url) =>
        url.endsWith('.multi.android-x86_64.apk'),
      );
      if (apk) return apk;
    }
  }
  throw new Error(
    `no Fenix nightly x86_64 APK in ${fenixNightlyRoot} for this month or the last`,
  );
}

const fetchListing: FetchListing = async (url) => {
  const res = await fetch(url);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return res.text();
};

async function download(url: string, path: string): Promise<string> {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body)
    throw new Error(`GET ${url} answered ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as ReadableStream),
    createWriteStream(path),
  );
  return path;
}

function playwrightCli(): string {
  const pkg = createRequire(import.meta.url).resolve('playwright/package.json');
  return join(dirname(pkg), 'cli.js');
}

/** Progress goes to stderr: stdout carries only the KEY=value lines. */
function log(message: string): void {
  console.error(message);
}

function run(cmd: string, args: string[]): Promise<void> {
  log(`$ ${cmd} ${args.join(' ')}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 2, 2] });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [id, dir] = process.argv.slice(2);
  try {
    if (!id || !dir) throw new Error('usage: install.ts <target-id> <dir>');
    const env = await installTarget(id, dir);
    for (const [key, value] of Object.entries(env))
      console.log(`${key}=${value}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
