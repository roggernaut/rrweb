# Pre-release browser testing for rrweb recording

Date: 2026-11-06
Status: draft for team review

## Why

We usually hear about browser problems from downstream users, after the
browser version has shipped. By then every site running rrweb on that browser
is affected, and our fix races the browser's rollout.

This project flips the order. Every two weeks, rrweb's recorder runs against
the newest upcoming browser builds we can reach: canary, nightly, dev, beta
and OS betas. When something breaks, we hear about it while the browser is
still pre-release. That leaves time to fix rrweb, or to report the bug to the
browser vendor before the change ships.

## Goals

- Catch three kinds of failure in upcoming browser builds:
  - **Broken recording:** something rrweb records today stops being recorded,
    or is recorded wrongly.
  - **Performance regressions:** recording gets much slower, freezes the page,
    or leaks memory.
  - **Privacy regressions:** content rrweb should mask or block shows up in
    recorded events.
- Cover every major engine and platform. Desktop Chrome and Firefox have the
  widest reach. iOS Safari has a smaller share but often serves high-value
  users, so it counts just as much.
- Alert every maintainer through a channel we already watch, without training
  us to ignore it.
- Finish a full run in under two hours.

**Out of scope:** replay, replacing per-PR CI, and absolute performance
budgets for rrweb.

**What would make this a failure even if it works:**

- One browser change opening ten issues.
- Alerts repeating every run for something already being worked on.
- Alerts for one-off failures nobody can reproduce.
- Not being able to tell "everything passed" from "the run never happened".

## Decisions

- **Cadence:** every two weeks, and runnable by hand.
- **Scope:** recording only.
- **All three failure kinds alert the same way.** A tripped performance limit
  is treated like a broken feature.
- **Alerts are GitHub issues in rrweb-io/rrweb only.** They reach Slack
  through the existing GitHub notifications channel.
- **Privacy failures are public issues**, not private security advisories.
  Downstream users can watch for them and react faster than we can ship a fix.
- **Firefox on Android and Safari Technology Preview are included.** Both
  were proven to work on GitHub's free runners.

## Where it runs

| Constraint            | Value                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub-hosted runners | Free because rrweb is public. At most 5 macOS jobs at once.                                                                             |
| BrowserStack          | Open-source plan: 5 parallel sessions, 5 queued. About 600 device-minutes per 2-hour run. Plan for about 450 to leave room for retries. |
| What gets tested      | The current `main` of rrweb-io/rrweb, built at run time.                                                                                |

GitHub runners have no session limit, so they take the earliest channels and
run every check. BrowserStack's minutes are limited, so it covers the real
devices and real browsers GitHub can't provide, with a focused set of checks.

| Target                                                                    | Where                               | Checks                 |
| ------------------------------------------------------------------------- | ----------------------------------- | ---------------------- |
| Chrome Canary and Chrome Dev                                              | GitHub Linux                        | All                    |
| Edge Dev                                                                  | GitHub Linux                        | All                    |
| Firefox Nightly                                                           | GitHub Linux                        | All                    |
| Playwright WebKit, built from WebKit main                                 | GitHub Linux                        | All                    |
| Safari Technology Preview, with stable Safari next to it                  | GitHub macOS 26                     | All                    |
| Firefox Nightly on Android                                                | Android 14 emulator on GitHub Linux | Functional and privacy |
| Chrome Beta and Edge Beta, each with stable                               | BrowserStack, Windows 11            | Focused                |
| Firefox Beta, with stable                                                 | BrowserStack, Windows 11            | Focused                |
| Safari on a newer macOS than GitHub has, when there is one                | BrowserStack                        | Focused                |
| Newest iOS or iOS beta, with the previous iOS on the same iPhone          | BrowserStack real devices           | Focused                |
| Chrome on the newest Android, with the previous Android on the same Pixel | BrowserStack real devices           | Focused                |
| Chrome on a low-end Android phone                                         | BrowserStack real device            | Focused, ceilings only |
| Samsung Internet on a Galaxy                                              | BrowserStack real device            | Focused, ceilings only |

Pairs use the same device model, because a speed ratio between two different
phones means nothing. BrowserStack's live list on 2026-11-06 allowed this: the
iPhone 15 offered iOS 26 and 27, and the Pixel 9 offered Android 15 to 17.
BrowserStack has no Firefox for Android, no Safari Technology Preview and no
Sony Xperia devices.

## What the checks cover

The checks follow where rrweb has actually broken. Our issue tracker has
almost no "version N broke rrweb" reports. Nearly every browser bug came from
engines behaving differently, from page code patching built-in APIs, or from
performance cliffs on large pages.

**Functional areas:**

- **CSS capture.** Safari rewriting shorthand in `cssText`
  ([#833](https://github.com/rrweb-io/rrweb/issues/833)) and leaving `:`
  unescaped ([#1208](https://github.com/rrweb-io/rrweb/issues/1208)). WebKit
  missing early stylesheets
  ([#1825](https://github.com/rrweb-io/rrweb/pull/1825)). Chrome mangling
  `grid-template-areas`
  ([#1395](https://github.com/rrweb-io/rrweb/issues/1395)). Constructed and
  adopted stylesheets ([#1626](https://github.com/rrweb-io/rrweb/issues/1626)),
  `insertRule` and nested rules.
- **Patched, tainted or missing built-in APIs.** zone.js breaking
  MutationObserver in Safari
  ([#1633](https://github.com/rrweb-io/rrweb/pull/1633),
  [#1854](https://github.com/rrweb-io/rrweb/pull/1854)), Firefox extension
  scripts losing input getters
  ([#1950](https://github.com/rrweb-io/rrweb/pull/1950)), iOS webviews lacking
  WebGL types ([#1776](https://github.com/rrweb-io/rrweb/issues/1776)).
- **Shadow DOM, custom elements, iframes and top-layer dialogs.**
- **Inputs and selection,** including new input types a browser adds.
- **Canvas and media,** including sampled canvas
  ([#1427](https://github.com/rrweb-io/rrweb/issues/1427)).
- **Mobile Safari node ordering**
  ([#1690](https://github.com/rrweb-io/rrweb/issues/1690)).

**Privacy.** Test pages plant fake personal data, such as a made-up card
number or one-time code, inside content rrweb should mask or block. The check
searches every recorded event for those strings, and any appearance fails.
This covers the masking options, sensitive input types, mutations after the
first snapshot, autofill, shadow DOM, constructed stylesheets and canvas.

**Performance scenarios:**

- A full snapshot with a 2 MB stylesheet
  ([#1350](https://github.com/rrweb-io/rrweb/issues/1350),
  [#1603](https://github.com/rrweb-io/rrweb/issues/1603)).
- Full snapshots at 5,000, 20,000 and 50,000 nodes.
- A burst adding 10,000 nodes
  ([#1652](https://github.com/rrweb-io/rrweb/pull/1652)).
- Several sampled canvases.
- 20 record-and-stop cycles, checking for leftover memory
  ([#1707](https://github.com/rrweb-io/rrweb/issues/1707)).

Each scenario runs on the upcoming build and on stable, on the same device, in
the same run. Nothing is stored between runs. Starting limits, to be tuned
against real runs:

| Rule                                                 | Starting value      |
| ---------------------------------------------------- | ------------------- |
| Upcoming build slower than stable, median of samples | more than 1.5 times |
| Longest single main-thread block, any target         | more than 1 second  |

Targets with no upcoming build to compare get only the 1-second ceiling.

**Checks assert properties, not exact output.** Engines legitimately serialize
some things differently, so a check asserts what must hold everywhere: the
right events exist, the right nodes are present, masked content never appears,
and a replayed snapshot has the same visible structure.

**A check failing on stable too is labelled "also fails on stable".** That
points at rrweb or the test rather than the browser.

## Run shape

1. Build rrweb from `main` once and share the build with every job.
2. Run all targets in parallel, keeping at most 5 BrowserStack sessions at
   once.
3. Retry a failing check twice on the same target. It counts only if it fails
   at least two times out of three.
4. Collect every job's results and update GitHub issues in one final step.

A run heading past two hours stops starting new work and reports itself as
incomplete. A partial run never looks like a pass.

## Alerting

- **One issue per failing check,** listing every target it fails on. A
  failure is identified by check name and kind, not browser version, so the
  next beta lands on the same issue.
- **Repeat failures edit the issue body** rather than commenting, so Slack
  only sees issues opened and closed.
- **Recovery closes the issue automatically.**
- **Many failures at once become one "run broken" issue.** That usually means
  a broken build, a BrowserStack outage or a sweeping engine change.
- **Known failures can be parked** in a list in the repository, each with a
  link to the upstream report and an expiry date.
- **An issue closed by hand stays closed.** If it keeps failing, it is listed
  as "closed but still failing" in the status issue. It reopens only if the
  failure spreads to a new engine.
- **Every issue is reproducible.** It carries exact versions, the rrweb
  commit, the recorded events, the session video where there is one, and one
  command that reruns the check.
- **A pinned status issue shows the latest run,** with date, versions tested
  and pass and fail counts. An old date means a run didn't happen.
- **Privacy failures get the most severe label.**

## Proven so far

A throwaway workflow on 2026-11-06
([run](https://github.com/roggernaut/rrweb/actions/runs/42222907126))
recorded a test page with `rrweb@2.2.0` on both targets GitHub alone can
reach. It checked for snapshot, mutation and input events, and confirmed that
planted private strings never appeared.

| Target                                                                      | Result | Job time  |
| --------------------------------------------------------------------------- | ------ | --------- |
| Safari Technology Preview 27.0 on `macos-26`, stable Safari 27.2 as control | Passed | 2 minutes |
| Firefox Nightly 162 on an Android 14 emulator                               | Passed | 2 minutes |

The same in-page test worked through both drivers unchanged.

## Open questions

- Where the cross-browser checks live, and how much of the existing Puppeteer
  suite to reuse.
- How to install Chrome Canary, Chrome Dev and Edge Dev on Linux runners.
- The mass-failure threshold, the known-failure file format, and label names.
- The exact BrowserStack device models, picked from the live list.

## Risks

- **Firefox on Android relies on a deprecated geckodriver flag,**
  `--android-storage internal`. If it disappears, we need another way to place
  the profile.
- **BrowserStack's iOS bridge is limited.** In-page calls must stay short and
  code is passed as strings.
- **Pre-release builds sometimes fail to launch.** That is reported in the
  status issue, not as an rrweb failure.
- **The two-hour budget is an estimate.** The first full runs will show the
  real figure.
