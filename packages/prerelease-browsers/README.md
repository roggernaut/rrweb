# @rrweb/prerelease-browsers

Runs rrweb's recorder, built from `main`, against upcoming browser builds
(Chrome Canary and Dev, Edge Dev, Firefox Nightly, Safari Technology Preview,
Playwright's next WebKit, Firefox Nightly on Android, and BrowserStack
devices). Each upcoming build runs next to the stable build of the same
browser.

The workflow `.github/workflows/prerelease-browsers.yml` runs every other
Monday and can be started by hand from the Actions tab. It reports through
GitHub issues labelled `prerelease`. A failing check gets one issue, which
lists every target it fails on. A pinned status issue describes the latest
run. If the status issue shows an old date, a run didn't happen.

The package is private and is never published.

## Run one target locally

rrweb has to be built first, because the checks read
`packages/rrweb/dist/rrweb.umd.cjs` from disk. From the repository root:

```bash
yarn install
NODE_OPTIONS='--max-old-space-size=4096' yarn turbo run prepublish --filter=rrweb
```

Rebuild after changing rrweb. Set `RRWEB_DIST` to read the build from a
different directory.

The quickest targets are `local-chromium`, `local-firefox` and `local-webkit`.
They use Playwright's bundled engines:

```bash
cd packages/prerelease-browsers
npx playwright install chromium
yarn run-target --target local-chromium
```

The GitHub-runner targets are listed in `src/node/targets.ts`. Install the
browser first. `install.ts` prints `KEY=value` lines, which `run-target` reads
from the environment:

```bash
cd packages/prerelease-browsers
export $(node src/node/install.ts firefox-nightly ~/.cache/prerelease-browsers)
yarn run-target --target firefox-nightly
```

The installs are written for GitHub's Linux runners. `chrome-canary`,
`chrome-dev`, `firefox-nightly` and `firefox-stable` also install on macOS.
The Safari targets need nothing installed beyond Safari or Safari Technology
Preview, but each driver must be enabled once with
`sudo safaridriver --enable`. For Technology Preview, run the `safaridriver`
inside its app bundle.

Useful flags:

- `--check <id>` runs only that check. Repeat it for more than one.
- `--results <dir>` changes where results go. The default is `results/`. Each
  target writes `<target>.json` there, and the events of a failing check go
  under `<target>/`.
- `--port-offset <n>` moves the driver and fixture ports, so two Selenium
  targets can run on one machine at once.
- `--deadline <iso>` makes the run stop starting checks after that time.

BrowserStack targets run through `run-browserstack`. They need
`BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY`. `--only <id>` picks
targets, and `--check <id>` picks checks:

```bash
yarn run-browserstack --only bs-ios-upcoming --check css-nested-rules
```

## Reproduce an issue

Each issue has a **Reproduce** section with one command per failing target,
such as:

```bash
yarn --cwd packages/prerelease-browsers run-target --target chrome-canary --check css-nested-rules
```

Run it from the repository root, after building rrweb and installing the
browser as described above. A BrowserStack target's command uses
`run-browserstack --only <id>` instead, and needs the BrowserStack
credentials.

The issue also links the run. The run's `results-*` artifacts hold the
recorded events of the last failing attempt, at the path the issue names. A
BrowserStack failure also links the session, with its video, which opens
after you sign in to BrowserStack.

A check counts as failed only when it fails at least 2 of its 3 attempts. One
failure out of 3 is listed under **Flaky** in the status issue.

## Park a known failure

When a failure is a browser bug that's already reported upstream, park it in
`known-failures.json`. A parked failure opens no issue, and it's listed under
**Parked** in the status issue. The file is a list of entries:

```json
[
  {
    "key": "css-nested-rules:functional",
    "engines": ["webkit"],
    "upstream": "https://bugs.webkit.org/show_bug.cgi?id=000000",
    "expires": "2027-01-31",
    "note": "Fixed upstream, waiting for the next Technology Preview"
  }
]
```

- `key` is `<check-id>:<kind>`, where kind is `functional`, `privacy` or
  `performance`. Every issue body carries its key in a
  `<!-- prerelease:key=... -->` marker.
- `engines` is optional, and can hold `chromium`, `gecko` and `webkit`.
  Without it, the entry parks the failure on every engine. With it, a failure
  on any other engine still opens or updates the issue.
- `upstream` must be an `https:` link to the upstream report.
- `expires` is a date. A plain `YYYY-MM-DD` date stays active through the end
  of that day, UTC. After that, the report step logs a warning and reports the
  failure again, so the entry has to be renewed or removed.
- `note` is optional.

A malformed entry fails the report step instead of parking nothing.

## Change the limits

- **Performance** is in `src/report/compare.ts`.
  - `RATIO_LIMIT` (1.5) is how many times slower than stable an upcoming build
    may be.
  - `MIN_DIFF_MS` (50 ms) and `MIN_HEAP_DIFF` (5 MiB) are the smallest
    differences that can count as slower. They keep tiny measurements from
    tripping the ratio.
  - The longest-block ceiling defaults to 1000 ms in `src/node/run-targets.ts`.
    A target can set its own `ceilingMs` in `src/node/targets.ts`.
- **A broken run** is set in `src/report/issues-plan.ts`. When at least
  `MASS_FAILURE_MIN` (5) checks fail, and they are at least
  `MASS_FAILURE_SHARE` (0.3) of the checks that ran, the run opens one "run
  broken" issue instead of one issue per check.
- **Time.** Runners stop starting checks 105 minutes after the run starts.
  That's the `deadline` in the workflow's gate job, and the default in
  `src/node/cli.ts`. Each runner job has `timeout-minutes: 100`.

## Test on a fork

1. On the fork's **Actions** tab, enable workflows. Forks start with them
   disabled.
2. To include BrowserStack, add the repository secrets
   `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` under **Settings >
   Secrets and variables > Actions**.
3. Start **Pre-release browsers** from the Actions tab with **Run workflow**.
   Tick `browserstack` to include it. Set `targets` to a comma list, such as
   `chrome-dev,safari-tp`, to run only those GitHub targets.

The schedule runs only in `rrweb-io/rrweb`, so a fork runs only when started
by hand. Issues go to the repository the workflow runs in, so a fork's run
files them on the fork.
