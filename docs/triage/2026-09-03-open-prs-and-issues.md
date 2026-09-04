# Proposed intake triage for rrweb-io/rrweb

A snapshot proposal for restarting pull-request and issue intake on
rrweb-io/rrweb. Taken 2026-09-03 from public GitHub read-only APIs.
This is a working document, not a decision log: buckets can change after
maintainer review.

IDs such as 1712 are rrweb-io/rrweb pull or issue numbers. They are
written as plain numbers, not tracker URLs, so this file does not create
GitHub cross-references. Look them up under the project's Pull requests
or Issues tabs.

- Open PRs: **138** (19 drafts). Oldest: 2020-08 (294). Newest: 2026-09-02 (1921).
  **52 are from core maintainers** (Eoghan 29, Justin 22, Yun 1); the other 86 are community.
- Open issues: **289**. Oldest: 2019-07 (88). Newest: 2026-09-01 (1919).
- Upstream `main` HEAD at snapshot: `37a946a5` (docs 1910).
- This repository also contains privacy-at-capture work that is ahead of
  upstream `main`. Several open masking PRs overlap that work; they should
  not be merged as parallel APIs.
- A second pass over 62 older PRs tightened duplicates and already-fixed
  patches (CSS crash 1735, media-target cluster, asset draft 1239, etc.).
- Most of the queue is waiting on review, not on authors. GitHub
  `reviewDecision` on 2026-09-03: **125 REVIEW_REQUIRED**, 9
  CHANGES_REQUESTED, 2 APPROVED and still open, 2 with no decision.
  Branch protection requires a human review. 107 PRs share an `updatedAt`
  of 2026-06-08 (a bulk touch, not a review pass).

The queue is years of un-triaged patches plus bugs that never got a
reproduction. A practical restart is to **accept a small high-confidence
slice, discuss a handful of product and privacy forks, and close or
bounce the rest with a short explanation**. The two already-approved PRs
can merge as soon as someone presses the button.

---

## How to read the buckets

| Bucket                      | Meaning                                                                                                                                | Default next action                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Obviously adopt**         | Small, correct-looking, tests and/or changeset, low product risk.                                                                      | Rebase onto current `main`, green CI, merge.                |
| **Review individually**     | Real bugfix or focused feature. Needs a maintainer to read the code, not a strategy meeting.                                           | Assign one reviewer.                                        |
| **Discuss in team**         | API, privacy contract, security model, 2.x/3.x, plugins, large refactors, competing designs.                                           | Agenda item. Do not merge from the issue thread.            |
| **Request clean-up**        | Direction is plausible, but rebase / tests / changeset / split / conflict resolution is required before review is worth anyone’s time. | Comment template below. Close if no reply in 14 days.       |
| **Reject with explanation** | Duplicate, superseded, stale lockfile, out of scope, or the wrong approach.                                                            | Close with the reason. Offer the alternative if one exists. |

`BEHIND` / `DIRTY` in GitHub is not by itself a reject. Almost everything is
behind because intake stopped. Use the bucket for _substance_; use clean-up
when the patch cannot be evaluated until it is refreshed.

## Flag legend

Applied only where the flag is the point of the change, not where a file path
happens to mention `canvas` or `plugin`.

| Flag                    | Meaning                                                                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Impacts privacy**     | Changes what gets recorded, who can receive it, or how replay executes untrusted data. Can expand collection, punch through a previous isolation boundary, or change the masking contract.                                                                                               |
| **Strengthens privacy** | Closes a leak, tightens masking/blocking, or reduces exfil / XSS surface.                                                                                                                                                                                                                |
| **Commercial value**    | Helps session-replay products, rrweb Cloud, the Chrome extension, heatmaps, assets, scale, or enterprise compliance. Privacy work is commercially valuable when it is what vendors need to ship.                                                                                         |
| **Waiting on review**   | Non-draft PR whose GitHub `reviewDecision` is `REVIEW_REQUIRED` (or empty) and no core-maintainer approve or request-changes exists. Distinct from **changes requested**, where a maintainer already looked and the author owes a revision. |

A single item can carry more than one flag. See [Review bottleneck](#review-bottleneck) for the counts.

**Who:** Core maintainers are **Eoghan** (`eoghanmurray`), **Yun** (`YunFeng0817`), and **Justin** (`Juice10`). Everyone else is community. Their 52 open PRs are listed in [Core maintainer queue](#core-maintainer-queue-eoghan-yun-justin) and are **not** mixed into the community bucket tables. Maintainer PRs can be rebased, merged, or closed without the community clean-up template.

## Suggested comment templates

Request clean-up:

> Thanks for this — the direction looks useful. Before we can review it on
> current `main`, please rebase, add a changeset, and add a regression test
> for the reported case. If that doesn’t happen in two weeks we’ll close and
> you can reopen when it’s ready.

Reject (duplicate / superseded):

> Closing in favor of #<n>, which covers the same ground. Please move any
> extra test cases there.

Reject (out of scope):

> rrweb records and replays the DOM. Remote control, captcha evasion, and
> host-app MITM are out of scope for this repo.

---

## Do this first (recommended order)

0. **Clear the review gate**  
   Merge the two already-approved community PRs (1712, and 1656 if the
   vitest pin is still the intent). Then approve the community
   obviously-adopt list — those are `REVIEW_REQUIRED` with no human
   review.
0b. **Maintainer queue hygiene**  
   52 of 138 open PRs are from Eoghan, Justin, or Yun. Closing stale
   own-drafts first makes the community queue easier to see: Justin 1239,
   Eoghan 1477/294/389/558/724, and any draft no longer intended
   (1046, 1015, 1874). 47 of those 52 are also `REVIEW_REQUIRED`.
1. **Team discussion (90 minutes), privacy + product only**
   - Masking API vs this repository’s privacy-at-capture policy (1257, 1164,
     1097, 1745/1610, 1912, 1642, 1581).
   - Collection expansion: closed shadow DOM (1739), assets (1475),
     heatmaps (1914), WebRTC A/V (1046), extension upload (1909).
   - Cross-origin postMessage allowlisting (1800 vs leftover 1679/1256 vs 1680).
   - Replay XSS: 1817, 1913, 1905, sandbox ADR already in this repo.
   - 2.0 / `next` channel (1671, Justin 1828/1848).
2. **Merge the community obviously-adopt slice** after rebase (list below).
   Separately, Eoghan/Justin land their own small adopt PRs (1673, 1891, 1732) once CI is green.
3. **Assign individual review** for community CSS/replay bugs. Maintainer
   review-individually PRs stay in the maintainer queue (Eoghan’s replay
   correctness cluster).
4. **Bulk-close** community stale dependabot, duplicate masking PRs, and
   out-of-scope issues with the templates.

---

## Review bottleneck

GitHub `reviewDecision` for all 138 open PRs, 2026-09-03. Branch protection
on `rrweb-io/rrweb` requires a review (`REVIEW_REQUIRED` / merge
`BLOCKED`). Almost none of the open PRs have cleared that gate.

| `reviewDecision`    |     All | Community | Maintainer (Eoghan/Yun/Justin) | What it means                                                                                              |
| ------------------- | ------: | --------: | -----------------------------: | ---------------------------------------------------------------------------------------------------------- |
| `REVIEW_REQUIRED`   | **125** |        78 |                             47 | Waiting on a core-maintainer review. Most have **no human review at all** (Copilot comments do not count). |
| `CHANGES_REQUESTED` |       9 |         6 |                              3 | A maintainer already reviewed. The author owes a revision — except maintainer-on-maintainer threads.       |
| `APPROVED`          |       2 |         2 |                              0 | Review done. Still open; merge or refresh against current `main`.                                          |
| (none)              |       2 |         0 |                              2 | Drafts / no review requested.                                                                              |

Non-draft and still `REVIEW_REQUIRED`: **109** (74 community, 35 maintainer).
Drafts: 19 (mostly maintainer WIP, not waiting on review).

107 PRs were last touched on **2026-06-08**. That is a bulk update, not 107
reviews. Treat `updatedAt` after that date as noise unless the PR is newer
than June 2026.

### Already approved — merge or refresh today

| PR      | Who approved                                   | Bucket                     | Why it is still open                                                                                                             |
| ------- | ---------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PR 1712 | **Justin** and **Eoghan** both APPROVED        | Community obviously adopt  | `console.log` → `warn`. Two-line change. Ready to merge.                                                                         |
| PR 1656 | **Justin** APPROVED (Eoghan earlier dismissed) | Community request clean-up | Vitest 1.6.1 CVE pin. DIRTY vs current tree — merge if the pin is still the intent, otherwise close and bump vitest in a new PR. |

### Changes requested — we engaged; don’t re-review from scratch

| PR      | Who requested changes                         | Next                                         |
| ------- | --------------------------------------------- | -------------------------------------------- |
| PR 1875 | **Eoghan** on Justin’s CDN docs               | Justin: address or close.                    |
| PR 1784 | **Justin** on Eoghan’s postcss-from-record.js | Maintainer-on-maintainer. Finish the thread. |
| PR 1239 | **Eoghan** on Justin’s asset draft            | Close in favor of Eoghan 1475.               |
| PR 1733 | **Eoghan**                                    | Author owes the perf/implementation fix.     |
| PR 1465 | **Eoghan**                                    | Author + testcase needed.                    |
| PR 1357 | **Eoghan**                                    | Author: drop the `innerText` reflow.         |
| PR 1356 | **Justin**                                    | Author: zone.js `setTimeout`.                |
| PR 1164 | **Yun**                                       | Author: option/radio/checkbox masking.       |
| PR 768  | **Eoghan**                                    | Author: inline-style URLs. Very stale.       |

### Community adopt list — waiting on review except 1712

These are small enough for a short approve pass. Authors are not waiting to revise.

Already-approved **1712**, then 1921, 1906, 1905, 1904, 1903, 1856,
1771, 1769, 1737, 1802.

---

## Flagged items (read these even if you skip the rest)

### Strengthens privacy

These are the patches and bugs that stop rrweb from shipping user data it
already promised to mask, or that shrink replay/XSS surface.

| ID                                            | Bucket                                       | Why                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 1912                                       | Request clean-up                             | Masks `placeholder` when input masking is on. Real PII leak (`"Enter email: user@…"`). This repository’s privacy policy already treats `placeholder` as a sensitive attribute — upstream `main` does not. Add changeset, rebase. |
| PR 1745 / PR 1610 / issue 1609                | Request clean-up (pick **1745**, close 1610) | `maskAllInputs` currently omits `hidden`. Tokens, CSRF, internal IDs leak. This repository marks `input[type=hidden]` protected under the new policy; upstream still needs the `maskAllInputs` gap closed.                       |
| PR 1257 / issue 1581                          | Discuss in team                              | Generic `maskAttributesFn`. Needed by PostHog-class vendors. Overlaps privacy-at-capture `SENSITIVE_ATTRIBUTES` / `maskAttributeFn`. Do not land a second API.                                                             |
| PR 1164                                       | Discuss in team                              | Masks option/radio/checkbox values. Correct privacy instinct; API should fold into the policy, not a one-off.                                                                                                              |
| PR 1097 / issue 874 / issue 1385 / issue 1488 | Discuss in team                              | Text-masking should apply to inputs; `maskInputFn` skipped on full snapshot. Several reports of the same hole.                                                                                                             |
| PR 1212                                       | Request clean-up                             | Custom mask selector / `maskTextFn` improvements. Stale, DIRTY.                                                                                                                                                            |
| PR 1642 / issue 1644                          | Discuss in team                              | `blockElementFN` whitelist/strict blocking. Enterprise control. Conflicts with policy selectors.                                                                                                                           |
| PR 1800                                       | Discuss in team                              | `allowedIframeOrigins` allowlist. This is the security model to decide.                                                                                                                                                    |
| PR 1679 / issue 1680                          | Reject with explanation                      | Sender-origin is not validated; narrower than 1800. Close in favor of the allowlist if that is the chosen model.                                                                                                           |
| PR 1256                                       | Reject with explanation                      | Earlier `safeCrossOrigin` sketch. Superseded by 1800.                                                                                                                                                                      |
| PR 1766                                       | Request clean-up                             | Optional CSP on the replay iframe. Complements sandbox ADR. Needs tests and a changeset.                                                                                                                                   |
| PR 1905 / issue 1736                          | Obviously adopt                              | Omit `srcdoc` on rebuild. Fixes a race **and** stops the browser parsing attacker HTML into the iframe. rrdom already omits `srcdoc`; snapshot rebuild does not.                                                           |
| PR 1771 / issue 1315                          | Obviously adopt                              | `autocomplete=off` during replay so the reviewer’s browser does not prompt-fill passwords into the session.                                                                                                                |
| PR 1790 **Justin**                            | Request clean-up                             | Privacy recipe docs. Author notes they were not verified. Rewrite against the policy, then merge.                                                                                                                          |
| issue 1919                                    | Review individually                          | Blocked `<img>` still pays the full `inlineImages` encode. Block is a privacy control; encoding the bytes anyway is a leak plus a perf bug.                                                                                |
| issue 816 / issue 423 / issue 1699            | Review individually                          | Strict CSP / no-`blob:` worker. Security of the _recorded_ app, not of replay.                                                                                                                                             |

### Impacts privacy (collection or contract changes)

Treat as “discuss” unless the expansion is clearly opt-in and documented.

| ID                                  | Bucket                  | Why                                                                                                                                                                |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR 1739 **Eoghan**                  | Discuss in team         | Records `attachShadow({mode:'closed'})`. Closed shadow was an isolation boundary; this punches through it. High replay-fidelity win, real privacy/ToS issue.       |
| PR 1914 **Eoghan**                  | Discuss in team         | Heatmap plugin. Extra semantic click payload (selector/text). PII in button labels. **Also commercial.**                                                           |
| PR 1900                             | Discuss in team         | Records `alert`/`confirm`/`prompt`. `prompt()` is often credentials or PII.                                                                                        |
| PR 1909 **Justin**                  | Discuss in team         | Extension upload to `api.rrweb.com` with a stored bearer token. Data leaves the machine. Draft. **Also commercial.**                                               |
| PR 1861 / PR 1848 **Justin**        | Discuss in team         | Cloud-bound sequence IDs / browser-client defaults (`maskAllInputs: true` already in this repository). Product + privacy defaults.                                       |
| PR 1475 **Eoghan**                  | Discuss in team         | Asset events capture image/media bytes. Retention and PII-in-images problem. **Also commercial.** Close Justin draft 1239.                                         |
| PR 1046 **Justin**                  | Discuss in team         | WebRTC streaming of `<video>`. Live biometric / meeting content. Draft, stale.                                                                                     |
| PR 1465                             | Discuss in team         | Parent forces a snapshot in a cross-origin iframe via postMessage.                                                                                                 |
| PR 1023                             | Discuss in team         | Inject recorder from another frame / custom `Window`. Changes the security origin story.                                                                           |
| PR 294 **Eoghan**                   | Reject with explanation | `window.top` / `window.top.document`. Cross-frame privilege grab. Six years stale.                                                                                 |
| PR 1873                             | Review individually     | Native `attributeFilter` on MutationObserver. Can drop sensitive attribute mutations _or_ drop the mutations masking depends on. Document the privacy implication. |
| PR 1373                             | Review individually     | Allow `maskTextClass`/`blockClass: null` to skip default class matching. Perf opt-out that disables a privacy default.                                             |
| PR 1726                             | Review individually     | `emitFromIframe` for nested iframes. More collection surface.                                                                                                      |
| PR 1534 **Eoghan**                  | Request clean-up        | Export `isBlocked`. Lets hosts implement their own policy; easy to misuse. Draft.                                                                                  |
| PR 1428                             | Request clean-up        | Canvas inside iframe/shadow. More pixels. Best of the cluster; rebase. Close 1413 and 1235.                                                                        |
| issue 1918                          | Discuss in team         | `inlineImages` encodes full natural resolution with no cap. Retention cost **and** high-res PII in screenshots.                                                    |
| issue 1913                          | Discuss in team         | `UNSAFE_replayCanvas` adds `allow-scripts`. Documented unsafe, still a footgun.                                                                                    |
| issue 1817                          | Discuss in team         | Rebuild may execute scripts. This repo already has the sandboxed-rebuild ADR; upstream issue is the public tracker for it.                                         |
| issue 1880 / issue 1659 / issue 111 | Discuss in team         | Record a subtree only. Can _strengthen_ privacy (less capture) and is commercially useful for widgets.                                                             |
| issue 1878                          | Reject with explanation | “Stealth” / captcha evasion. Do not help hide recording from the page or from the user.                                                                            |
| issue 1528                          | Discuss in team         | Sanitization vs sandbox. Same debate as the ADR.                                                                                                                   |

### Has commercial value

Session-replay vendors, Cloud, extension, and “can we sell this to a bank”
items. Privacy rows above that are also commercial are marked.

| ID                                                   | Bucket              | Why                                                                                                 |
| ---------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| PR 1914 **Eoghan**                                   | Discuss in team     | Heatmaps. Direct product feature.                                                                   |
| PR 1909 / PR 1908 **Justin**                         | Discuss in team     | Extension → Cloud upload and Chrome Web Store publish recovery.                                     |
| PR 1475 / PR 1848 **Eoghan / Justin**                | Discuss in team     | Asset capture. This is the fidelity gap every vendor hits (broken images, FOUC). Close Justin 1239. |
| PR 1652 **Eoghan**                                   | Discuss in team     | Large mutation-ordering refactor. Tests are good; blast radius is not a solo review.                |
| PR 1694 / issue 1547 / issue 1337                    | Review individually | Mutation throttle and snapshot perf. Smaller than 1652.                                             |
| PR 1448                                              | Request clean-up    | Worker package for canvas/off-main-thread. Stale.                                                   |
| PR 1149 **Yun** / issue 398 / issue 160 / issue 1560 | Discuss in team     | Session cutter / clip / merge events. Every hosted product needs this. Draft and huge.              |
| PR 1861 **Justin**                                   | Discuss in team     | Sequence IDs for Cloud ingest.                                                                      |
| PR 1900                                              | Discuss in team     | Dialog/prompt plugin. Completeness of “what the user saw.”                                          |
| PR 1897 / issue 1896                                 | Review individually | `:focus`/`:active` replay. Replay quality that buyers notice.                                       |
| PR 1336                                              | Review individually | Packer compression level. Storage cost.                                                             |
| issue 1918 / issue 1919                              | Review / Discuss    | Image payload size. Bandwidth and S3 bill.                                                          |
| issue 1785 / issue 1742                              | Review individually | Record bundle size.                                                                                 |
| issue 1672 / issue 1094                              | Discuss in team     | Chunked / paginated playback. Productized replay.                                                   |
| issue 419                                            | Discuss in team     | rrdom as an analytics engine. Strategic, not a bug.                                                 |
| issue 1701                                           | Review individually | Popover API. Modern UI fidelity.                                                                    |
| PR 1739 **Eoghan**                                   | Discuss in team     | Closed shadow DOM. Required for many design-system apps.                                            |
| issue 1671 / issue 1664 / issue 1778 / issue 1420    | Discuss in team     | “When is 2.0?” Trust and adoption.                                                                  |

---

## Core maintainer queue (Eoghan, Yun, Justin)

52 open PRs from core maintainers, listed separately from community
work. Default action is rebase, merge, or close. The 14-day community
clean-up template does not apply. Drafts are marked.

### Eoghan (`eoghanmurray`) — 29

Replay/record engine owner. Highest density of “this is the real product.”

| PR            | Bucket              | Notes                                                                | Flags                       |
| ------------- | ------------------- | -------------------------------------------------------------------- | --------------------------- |
| PR 1914       | Discuss in team     | Heatmap / click-track plugin.                                        | Impacts privacy, commercial |
| PR 1907       | Review individually | Replay mutation DOMException / rrdom swallow.                        |                             |
| PR 1877       | Discuss in team     | Changeset compress. Process, not product.                            |                             |
| PR 1871 draft | Discuss in team     | `inlineStylesheet` / `inlineImages` not deprecated. Ties to assets.  | Impacts privacy             |
| PR 1830       | Review individually | Canvas without `recordCanvas` must still affect layout. DIRTY.       |                             |
| PR 1784       | Review individually | Strip postcss from `record.js`. Bundle-size win.                     | Commercial                  |
| PR 1740       | Review individually | CDATA rebuild throw.                                                 |                             |
| PR 1739       | Discuss in team     | Record closed shadow DOM.                                            | Impacts privacy, commercial |
| PR 1730       | Request clean-up    | rrdom-to-html trim. Rare CLEAN status; still needs a why.            |                             |
| PR 1697       | Review individually | Video autoplay should not unfreeze the page.                         |                             |
| PR 1694       | Review individually | Mutation emission throttle.                                          | Commercial                  |
| PR 1673       | Obviously adopt     | Safer media play/pause. Pair with community 1688; close Justin 1462. |                             |
| PR 1653       | Request clean-up    | Micro perf. Fold into 1652 or drop.                                  |                             |
| PR 1652       | Discuss in team     | Mutation-ordering refactor. Strong tests, high blast radius.         | Commercial                  |
| PR 1534 draft | Request clean-up    | Export `isBlocked`.                                                  | Impacts privacy             |
| PR 1483 draft | Discuss in team     | `<link rel=stylesheet>` + mutations. Collides with 1917/1897.        |                             |
| PR 1480 draft | Discuss in team     | Hover rewrite via stylesheet mutation. Same collision.               |                             |
| PR 1477 draft | Reject              | Stale pre-commit prettier. Close; re-file repo-wide if wanted.       |                             |
| PR 1475       | Discuss in team     | Asset events. Successor to Justin 1239.                              | Impacts privacy, commercial |
| PR 1466 draft | Request clean-up    | History-change tests only. Land if they pass.                        |                             |
| PR 1322 draft | Request clean-up    | Failing CSS shorthand test. Make it an issue, not a red PR.          |                             |
| PR 1320       | Review individually | 500ms stylesheet timeout.                                            |                             |
| PR 1140       | Request clean-up    | Scrub-to-zero. Split unrelated pointer-event changes.                |                             |
| PR 1015 draft | Discuss in team     | Split monkeypatching into `rrweb-init.js`.                           | Impacts privacy             |
| PR 724        | Reject              | `__sn` / iframe id; unreproducible, mirror replaced it.              |                             |
| PR 661        | Discuss in team     | Rename `rrweb-player` → `rrweb-playback-ui`. 3.0.                    |                             |
| PR 558        | Reject              | Timestamp ordering; no reliable tests, later pipelines ate it.       |                             |
| PR 389        | Reject              | Destructor against the old snapshot repo. Redesign if still needed.  |                             |
| PR 294        | Reject              | `window.top`. Wrong isolation model.                                 | Impacts privacy             |

**Eoghan first:** merge 1673; review the replay cluster (1907, 1740, 1697, 1320, 1830, 1784, 1694); bring 1475/1739/1914/1652 to the team meeting; close 294/389/558/724/1477.

### Yun (`YunFeng0817`) — 1

| PR            | Bucket          | Notes                                                                                                                                                | Flags      |
| ------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| PR 1149 draft | Discuss in team | `@rrweb/cutter` + sync replayer. Huge, DIRTY, TODOs. Session clip is commercially real; this PR is not reviewable as-is. Split or close and re-file. | Commercial |

### Justin (`Juice10`) — 22

Cloud, extension, release plumbing, and several Codex-sized refactors.

| PR                          | Bucket           | Notes                                                                        | Flags                       |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------- | --------------------------- |
| PR 1909 draft               | Discuss in team  | Extension upload to `api.rrweb.com`. Token on disk.                          | Impacts privacy, commercial |
| PR 1908                     | Discuss in team  | Chrome Web Store publish recovery. Pairs with 1909.                          | Commercial                  |
| PR 1892                     | Discuss in team  | Plugin dependency metadata / host-neutral `ReplayPlugin`. DIRTY.             |                             |
| PR 1891                     | Obviously adopt  | `master` → `main` leftover refs. Mechanical.                                 |                             |
| PR 1875                     | Request clean-up | Prefer minified CDN ESM. Docs; rebase.                                       |                             |
| PR 1874 draft               | Discuss in team  | Vite+ migration experiment. DIRTY. Close unless this is the 2.x tooling bet. |                             |
| PR 1861                     | Discuss in team  | Browser-client sequence IDs for Cloud.                                       | Impacts privacy, commercial |
| PR 1848 draft               | Discuss in team  | Browser-client next release + assets. UNSTABLE.                              | Impacts privacy, commercial |
| PR 1843                     | Discuss in team  | yarn → pnpm. 158k-line lockfile. Decide yes/no, don’t leave it open.         |                             |
| PR 1841                     | Request clean-up | Changelog backfill. DIRTY.                                                   |                             |
| PR 1839                     | Discuss in team  | Split snapshot utils. Codex-sized.                                           |                             |
| PR 1828 draft               | Discuss in team  | Next prerelease channel plan.                                                | Commercial                  |
| PR 1811 / PR 1810 / PR 1809 | Request clean-up | CI / changeset / fork-comment plumbing. One hygiene PR.                      |                             |
| PR 1792 / PR 1789           | Request clean-up | Turbo outputs / tsconfig bundler. Tiny, behind.                              |                             |
| PR 1790                     | Request clean-up | Privacy recipe docs. Author says unverified. Rewrite against the policy.     | Strengthens privacy         |
| PR 1732                     | Obviously adopt  | Long-term sponsor recognition.                                               |                             |
| PR 1462                     | Reject           | Media-target bug; superseded by Eoghan 1673 + community 1688.                |                             |
| PR 1239 draft               | Reject           | Asset events v1. Already pointed review at Eoghan 1475. Close it.            | Impacts privacy, commercial |
| PR 1046 draft               | Discuss in team  | WebRTC A/V streaming. Stale, huge. Close unless live video is a 2.x goal.    | Impacts privacy, commercial |

**Justin first:** merge 1891/1732; close 1239/1462; squash CI hygiene (1811/1810/1809/1792/1789); bring Cloud/extension/assets (1909/1908/1861/1848, plus Eoghan 1475) to the team meeting.

---

## Community PRs by bucket

The remaining ~86 PRs. Maintainer PRs live only in the section above.

### Obviously adopt (11)

Ship after rebase + CI.

| PR      | Notes                                                                            | Flags                                |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| PR 1712 | `console.log` → `warn`. **Already APPROVED by Justin and Eoghan.** | Approved, unmerged                   |
| PR 1921 | `ignoreAttribute` tagName case. Tests + changeset. Fixes 1916.                   | Waiting on review                      |
| PR 1906 | Regression tests only for CSS crash 1734/1692.                                   | Waiting on review                      |
| PR 1905 | Omit iframe `srcdoc` on rebuild. Tests + changeset. rrdom already does this.     | Strengthens privacy, waiting on review |
| PR 1904 | Console plugin `this` binding. Fixes Chrome extension crash 1772.                | Waiting on review                      |
| PR 1903 | `repository.directory` so npm README links resolve. Fixes 1738.                  | Waiting on review                      |
| PR 1856 | “Who’s using rrweb?” logos. Verify the two names, then merge.                    | Waiting on review                      |
| PR 1771 | Disable autocomplete on replay inputs.                                           | Strengthens privacy, waiting on review |
| PR 1769 | One-line: emit custom events when seeking. Fixes 1666.                           | Waiting on review                      |
| PR 1737 | `image.currentSrc` can be undefined. One line.                                   | Waiting on review                      |
| PR 1802 | `querySelector` as untainted methods.                                            | Waiting on review                      |

### Review individually (29)

Worth a human read. Not a product fork.

**Correctness / CSS / replay**

| PR      | Notes                                                                           | Flags            |
| ------- | ------------------------------------------------------------------------------- | ---------------- |
| PR 1920 | Split `_cssText` on rule boundaries, not the middle of a rule. Related to 1692. |                  |
| PR 1917 | `adaptCssInTextMutations` player option. Hover rewrite on style text mutations. |                  |
| PR 1897 | More pseudo-classes on rebuild.                                                 | Commercial value |
| PR 1796 | Preserve class attribute text in `hoverElements` for `[class="…"]` selectors.   |                  |
| PR 1733 | `absolutifyURLs` edge cases. DIRTY.                                             |                  |
| PR 1718 | rrdom `oldChild` detach.                                                        |                  |
| PR 1711 | Inserting doctype.                                                              |                  |
| PR 1691 | Skip `setAttribute` when unchanged.                                             |                  |
| PR 1688 | Invalid media processing. Pair with Eoghan 1673.                                |                  |
| PR 1681 | `:hover` regex too large (1675).                                                |                  |
| PR 1641 | Preserve adopted styles when nodes are removed (virtual DOM).                   |                  |
| PR 1638 | Parent missing during record/playback.                                          |                  |
| PR 1635 | Iframes + custom elements in Chrome.                                            |                  |
| PR 1586 | Chrome `grid-template` inlining (1395).                                         |                  |
| PR 1357 | Inserted styles lost when moving elements.                                      |                  |

**Host-page hardening (untainted prototypes, leaks)**

| PR      | Notes                                                                                                               | Flags                           |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| PR 1814 | Untainted add/removeEventListener.                                                                                  |                                 |
| PR 1812 | Always use native `Proxy`.                                                                                          |                                 |
| PR 1770 | Iframe cleanup in `getUntaintedPrototype`.                                                                          |                                 |
| PR 1755 | Clear mutation buffer on iframe `pagehide`.                                                                         |                                 |
| PR 1791 | Iframe memory leaks. DIRTY. Related 1585/1628.                                                                      |                                 |
| PR 1633 | Untainted prototype access in Angular.                                                                              |                                 |
| PR 1356 | Native `setTimeout` under zone.js.                                                                                  |                                 |
| PR 1463 | Patched `toString` returns original. Detection-adjacent; still a correctness fix for apps that inspect native code. | Impacts privacy (weak: stealth) |
| PR 1873 | `attributeFilter`.                                                                                                  | Impacts privacy                 |
| PR 1373 | `null` mask/block class. Tiny and mergeable, but it is a privacy-default opt-out, so it still needs a privacy read.            | Impacts privacy                 |
| PR 1726 | Nested iframe emit.                                                                                                 | Impacts privacy                 |
| PR 1336 | Compression level.                                                                                                  | Commercial value                |

### Discuss in team (8)

Community proposals that still need a product/privacy call. Maintainer
strategy PRs (assets, heatmaps, Cloud, pnpm, cutter) are in the maintainer
queue.

| PR      | Topic                                                                                 | Flags                           |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| PR 1900 | Popup/dialog plugin. `prompt()` can hold PII.                                         | Impacts privacy, commercial     |
| PR 1800 | `allowedIframeOrigins`. Prefer this over 1679.                                        | Strengthens privacy             |
| PR 1642 | `blockElementFN`.                                                                     | Strengthens privacy, commercial |
| PR 1257 | `maskAttributesFn`.                                                                   | Strengthens privacy, commercial |
| PR 1164 | Option/radio/checkbox masking.                                                        | Strengthens privacy             |
| PR 1097 | Text mask → inputs.                                                                   | Strengthens privacy             |
| PR 1023 | Custom Window / inject from iframe. Preferable to Eoghan 294 if you need this at all. | Impacts privacy                 |
| PR 1465 | Force snapshot in cross-origin iframe.                                                | Impacts privacy                 |

### Request clean-up (24)

Ask for rebase + tests + changeset. Close if silent. Do **not** send this
template on maintainer PRs.

| PR                          | What to ask for                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| PR 1912                     | Placeholder masking. Tests are good; add a changeset and rebase.                                   | Strengthens privacy |
| PR 1745                     | Hidden-input masking. Fresher copy of 1610; add changeset and rebase.                              | Strengthens privacy |
| PR 1766                     | Replay iframe CSP. Add tests, changeset, browser-support note.                                     | Strengthens privacy |
| PR 1686                     | `stringifyRule` fallback. Needs a failing CSS-import test.                                         |
| PR 1681                     | `:hover` regex overflow. Tests exist; add changeset.                                               |
| PR 1638                     | Parent-missing recovery. Untested; needs an explanation.                                           |
| PR 1635                     | Chrome custom-element iframe. Needs a browser regression test.                                     |
| PR 1357                     | Moved styles. Isolate the fix; drop the `innerText` reflow cost.                                   |
| PR 1313                     | `hookSetter` recursion. Add a reproduction.                                                        |
| PR 1879                     | Svelte browser runtime. Likely superseded by merged 1901 — confirm, then close or rebase leftover. |
| PR 1768                     | Copilot timeout math. 27 files; needs a human to strip noise.                                      |
| PR 1748 / PR 1744 / PR 1709 | Broken docs links / guide wording. DIRTY. One docs PR can replace all three.                       |
| PR 1722                     | REPL script “security.” Chinese-only, no tests. Rewrite in English with tests or close.            |
| PR 1676                     | “Handle frames.” Labeled testcase needed.                                                          |
| PR 1656                     | Vitest CVE bump. DIRTY; refresh against current vitest rather than merging 1.6.1.                  |
| PR 1624                     | Iframe parent workaround. Needs a failing test.                                                    |
| PR 1616                     | Merge events. Draft. Needs design (see issue 1560).                                                |
| PR 1448                     | `rrweb-worker`. Rebase or extract the canvas-worker bugfix only.                                   | Commercial          |
| PR 1439                     | Smooth-scroll Y lag. Needs a test.                                                                 |
| PR 1428                     | Canvas in iframe/shadow. Best of the cluster; rebase. Close 1413 and 1235.                         | Impacts privacy     |
| PR 1392                     | Protocol URL regex. DIRTY, tiny.                                                                   |
| PR 1212                     | Mask selector/fn. Rebase onto privacy discussion.                                                  | Strengthens privacy |
| PR 815                      | `skipActivity` on `setConfig`. Testcase needed.                                                    |
| PR 1302 / PR 1300           | addList perf. Drafts. Fold into Eoghan 1652.                                                       |
| PR 1290                     | rrvideo Chrome launch options.                                                                     |
| PR 960                      | Custom event in checkout count. Draft, 4 lines, 2022.                                              |
| PR 863                      | Save/view snapshot scripts. Better as a recipe than a package dump.                                |
| PR 768                      | Dynamic inline-style URLs. Rebase onto current transform utilities.                                |

### Reject with explanation (14)

| PR                          | Reason to close                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| PR 1610                     | Exact older duplicate of 1745.                                                             | Strengthens privacy (the bug remains; keep 1745) |
| PR 1798                     | Weaker duplicate of 1688.                                                                  |
| PR 1735                     | Crash already handled by merged 1580 / 1600. Keep regression-only 1906.                    |
| PR 1679                     | Narrower than 1800 and does not validate senders.                                          | Strengthens privacy (keep 1800)                  |
| PR 1256                     | Superseded by 1800.                                                                        |
| PR 1413 / PR 1235           | Superseded by 1428. 1235 also mixes unrelated player changes.                              |
| PR 1259 / PR 1255 / PR 1238 | Dependabot against an ancient lockfile. Refresh in a new PR if the advisory still applies. |
| PR 1416                     | waiting-for-more-info, no author follow-up.                                                |
| PR 549                      | No info since 2021.                                                                        |

Try clean-up once on 1722 / 1768, then reject if silent.

---

## Duplicate / overlapping PR clusters

Resolve the cluster, don’t review every member.

| Cluster                     | Keep                                                             | Close or fold                                                         |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Hidden input masking        | 1745 (after changeset)                                           | 1610                                                                  |
| Cross-origin iframe origins | 1800                                                             | 1679, 1256                                                            |
| Canvas in iframe/shadow     | 1428                                                             | 1413, 1235                                                            |
| Asset capture               | Eoghan 1475 (and Justin 1848 if Cloud needs it)                  | Justin 1239                                                           |
| Invalid media targets       | community 1688 + Eoghan 1673                                     | Justin 1462, community 1798                                           |
| CSS crash “Unclosed string” | Regression tests 1906 (+ split-point fix 1920 if still needed)   | 1735 (already fixed on main)                                          |
| Hover / pseudo-class replay | Team picks 1897 / 1917 / 1480                                    | don’t land all three                                                  |
| Masking API                 | Privacy-at-capture policy in this repository, or a single upstream API | 1257, 1164, 1097, 1212, 1912 as separate knobs                        |
| Mutation perf               | 1652                                                             | 1653, 1300, 1302                                                      |
| Docs link rot               | One new PR                                                       | 1748, 1744, 1709, 1903 (keep 1903 — it is package.json, not markdown) |

---

## Issues by bucket

289 issues cannot all be individually reviewed in a first pass. Bucket the ones
that change the product or the privacy story; apply a bulk rule to the rest.

### Obviously adopt (issue → known PR or trivial)

| Issue                   | Action                                                                   |
| ----------------------- | ------------------------------------------------------------------------ | ------------------- |
| issue 1916              | Merge PR 1921.                                                           |
| issue 1772              | Merge PR 1904.                                                           |
| issue 1738              | Merge PR 1903.                                                           |
| issue 1736              | Merge PR 1905.                                                           |
| issue 1666              | Merge PR 1769.                                                           |
| issue 1609              | Merge PR 1745 (not 1610).                                                | Strengthens privacy |
| issue 1315              | Merge PR 1771.                                                           | Strengthens privacy |
| issue 1680              | Land 1800’s allowlist (not 1679).                                        | Strengthens privacy |
| issue 1675              | Merge PR 1681 after changeset.                                           |
| issue 1734 / issue 1692 | Close against merged 1580/1600; keep tests 1906 and split-point PR 1920. |
| issue 874               | Has PR 1097; don’t close until the masking discussion lands.             | Strengthens privacy |

### Review individually (issues)

Repro-able bugs and small features with a clear owner.

| Issue                   | Notes                                                                     | Flags                                     |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| issue 1919              | Blocked images still inline-encoded.                                      | Strengthens privacy, commercial           |
| issue 1881              | Canvas mutations in same-origin iframes.                                  | Impacts privacy (more pixels), commercial |
| issue 1816              | `<select>` wrong during forward play, right on seek.                      |                                           |
| issue 1786              | UMD global inconsistency.                                                 | Commercial                                |
| issue 1785 / issue 1742 | Record bundle size.                                                       | Commercial                                |
| issue 1724              | Web-extension broken.                                                     | Commercial                                |
| issue 1720              | Cross-origin iframe blanks after parent fullSnapshot.                     |                                           |
| issue 1707              | Memory/CPU on `rel=preload` links.                                        |                                           |
| issue 1701              | Popover API.                                                              | Commercial                                |
| issue 1690              | Mobile DOM order.                                                         |                                           |
| issue 1667              | `background` shorthand expands empty. Related CSSOM bugs.                 |                                           |
| issue 1628 / issue 1585 | Stop-recording / iframe leaks. Pair with PR 1791/1770.                    |                                           |
| issue 1626 / issue 1567 | Adopted stylesheets missing from first full snapshot.                     |                                           |
| issue 1577 / issue 1590 | Duplicate cross-origin message listeners.                                 | Impacts privacy (duplicate recording)     |
| issue 1564              | Table alignment in replay.                                                |                                           |
| issue 1505              | `all: unset` expansion.                                                   |                                           |
| issue 1488 / issue 1385 | `maskInputFn` skipped.                                                    | Strengthens privacy                       |
| issue 1395              | Grid template areas. PR 1586.                                             |                                           |
| issue 816               | Strict CSP vs style mutation. 34 comments, still open.                    | Strengthens privacy                       |
| issue 423 / issue 1699  | Inline/blob workers vs CSP.                                               | Strengthens privacy                       |
| issue 88                | `removeChild` DOMException. Ancient, 17 comments; may already be PR 1907. |                                           |

### Discuss in team (issues)

| Issue                                             | Topic                                                                      | Flags                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| issue 1918                                        | Cap `inlineImages` resolution.                                             | Impacts privacy, commercial                  |
| issue 1913                                        | `UNSAFE_replayCanvas` + `allow-scripts`.                                   | Impacts privacy                              |
| issue 1899                                        | Replay pre-process plugins.                                                | Commercial                                   |
| issue 1896                                        | More pseudo-classes. PR 1897.                                              | Commercial                                   |
| issue 1880 / issue 1659 / issue 111               | Record a subtree.                                                          | Impacts privacy (can strengthen), commercial |
| issue 1817                                        | Script execution on rebuild. Sandbox ADR.                                  | Impacts privacy                              |
| issue 1773 / issue 987                            | Remote control / MITM. **Recommend reject**, but confirm the product line. | Commercial, impacts privacy                  |
| issue 1671 / issue 1664 / issue 1778 / issue 1420 | 2.0 schedule. Write a public status, don’t leave four copies.              | Commercial                                   |
| issue 1644                                        | Fine-grained blocking. PR 1642.                                            | Strengthens privacy, commercial              |
| issue 1581                                        | Mask attributes. PR 1257.                                                  | Strengthens privacy, commercial              |
| issue 1563                                        | `maskAllText` flag.                                                        | Strengthens privacy                          |
| issue 1560 / issue 398 / issue 160                | Cut / merge / clip sessions.                                               | Commercial                                   |
| issue 1528                                        | Sanitize vs sandbox.                                                       | Impacts privacy                              |
| issue 1491                                        | CSS animation `currentTime`.                                               | Commercial                                   |
| issue 1337                                        | Full snapshot perf.                                                        | Commercial                                   |
| issue 1143                                        | Web Animations API.                                                        | Commercial                                   |
| issue 419                                         | rrdom as analytics.                                                        | Commercial                                   |
| issue 860                                         | Deferred / asset events. The assets PRs.                                   | Impacts privacy, commercial                  |

### Request clean-up (issues)

Need a reproduction, English summary, or a reduced test case. Use the issue
template; close after 14 days of silence.

Typical members (not exhaustive): 1824, 1727, 1713, 1650, 1608, 1595,
1558, 1514, 1473, 1232, 1192, 1075, 951, 377, 1658 (extension
“obfuscated code” complaint — ask for the exact file/build), 1622 (turbo on
M1), 1723 (`pauseAnimation` docs question).

Label `reproduction needed` already exists. Use it.

### Reject with explanation (issues)

| Issue                                                  | Close reason                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------- |
| issue 1878                                             | Captcha/stealth evasion is out of scope and hostile to end users.                                                     | Impacts privacy |
| issue 1773 / issue 987                                 | Remote control / MITM is a different product. Point at cobrowsing research, don’t take the issue.                     | Impacts privacy |
| issue 1801                                             | WeChat mini programs / React Native are not DOM.                                                                      |
| issue 1606                                             | Recording JS execution is a profiler, not rrweb.                                                                      |
| issue 1048                                             | IE11.                                                                                                                 |
| Anything 2019–2021 with no repro and no recent comment | “Stale, please reopen with a reproduction on 2.0.0-alpha.18+.” Keep 88/816/419 until the matching discussion happens. |

### Bulk hygiene for the other ~180 issues

1. Auto-close **questions** that are really Slack/Discord (“how do I splice
   10s chunks”, “how to use in Vue”) with a link to the guide.
2. One **2.0 status** comment, then close the duplicates as “answered in 1671”.
3. One **privacy roadmap** comment pointing at the policy work, then close
   duplicate mask-attribute / mask-all-text / hidden-input threads once the
   chosen PRs merge.
4. Do not spend review time on Chinese-only reports with no HTML fixture.
   Ask for a reduced case; that’s request-clean-up, not a translation project.

---

## Overlap with privacy-at-capture in this repository

This working tree already contains privacy-at-capture:

- `packages/rrweb-snapshot/src/privacy.ts` — `placeholder` is a sensitive
  attribute; `input[type=hidden]` is protected; versioned policy; opt-in
  detectors moved to a plugin.
- `@rrweb/browser-client` defaults `maskAllInputs: true`.
- Sandboxed-rebuild ADR under `docs/adr/`.

Consequences for upstream intake:

- **1912, 1745, 1257, 1164, 1097, 1212, 1642** must be re-evaluated
  against the policy API, not merged as parallel knobs.
- **1790** privacy docs should be rewritten to the policy language, not the
  old `maskAllInputs` laundry list.
- **1817 / 1913** should be answered with the sandbox ADR, then either
  closed or turned into “implement the ADR on upstream `main`.”
- If privacy-at-capture is meant to become upstream `main`, land that
  first, then cherry-pick only the non-overlapping obviously-adopt PRs.

---

## PostHog fork review (posthog-js 3765 / 3766, as of 2026-07-15)

Read-only check of PostHog’s two trackers. 3766 is contribute-back (their
divergences → us). 3765 is downstream pull-in (our open PRs → their
vendored `packages/rrweb`). They last re-verified the fork grep on
2026-07-11 and merged four adoption PRs on 2026-07-15.

PostHog’s own rule: they do **line-by-line review, not blind cherry-pick**.
“Already in our fork” means the patch is in production posthog-js, not
that the git blob is identical.

### Already in their fork — still open upstream — adopt on that review

These are the ones we can treat as pre-reviewed. Promote to obviously
adopt (rebase + CI) unless a row below says otherwise.

| PR   | Author       | Our previous bucket                | Why PostHog’s review is enough                                                                                                                                 |
| ---- | ------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1712 | pauldambra   | Obviously adopt (already APPROVED) | Their own two-line warn fix. Merge.                                                                                                                            |
| 1802 | juliecheng   | Obviously adopt                    | In their fork. Untainted `querySelector`.                                                                                                                      |
| 1688 | juliecheng   | Review individually                | In their fork. Pair with Eoghan 1673; close Justin 1462.                                                                                                       |
| 1691 | juliecheng   | Review individually                | In their fork. Skip unchanged `setAttribute`.                                                                                                                  |
| 1711 | JonaszJestem | Review individually                | In their fork. Doctype insert.                                                                                                                                 |
| 1770 | heathdutton  | Review individually                | In their fork. Iframe cleanup in `getUntaintedPrototype`.                                                                                                      |
| 1769 | heathdutton  | Obviously adopt                    | High-trust; they listed it as PostHog-adjacent. One line.                                                                                                      |
| 1771 | heathdutton  | Obviously adopt                    | Same. Replay `autocomplete=off`.                                                                                                                               |
| 1737 | QuentinLowe  | Obviously adopt                    | On their planned batch-2 stability list. One-line guard.                                                                                                       |
| 1812 | juliecheng   | Review individually                | Next on their batch-2 list after the July ports. Native `Proxy`.                                                                                               |
| 1697 | eoghanmurray | Review individually (maintainer)   | **Shipped in posthog-js 4131** (2026-07-15). They hoisted the event-source list into a Set; take that or land Eoghan’s version and let them feed the Set back. |
| 1633 | pauldambra   | Review individually                | Their own Angular untainted-prototype PR. Nudge/merge.                                                                                                         |
| 1814 | megboehlert  | Review individually                | Their own. Untainted add/removeEventListener.                                                                                                                  |

### Shipped in posthog-js after a real review — not verbatim

| PR   | posthog-js PR | Verdict for us                                                                                                                                                                                                                                       |
| ---- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1854 | 4128 (merged) | Already on upstream `main`. Ignore. They diverged (page-lifetime keepalive vs teardown).                                                                                                                                                             |
| 1302 | 4130 (merged) | 7-line `addedSet` order fix. Still a **draft** here; we had folded it into Eoghan 1652. PostHog’s port is the one to land if we do not want to wait on 1652.                                                                                         |
| 1873 | 4129 (merged) | Still needs a privacy review. PostHog found two bugs (shadow roots via `bypassOptions`; empty array silently disables all attribute recording). `attributeFilter` can drop mutations masking depends on. Take those two fixes if it lands. |
| 1697 | 4131 (merged) | See table above. Near-verbatim plus the Set hoist.                                                                                                                                                                                                   |

### In their fork — do not adopt from that fact

| PR                 | Why not                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 724                | We already reject (`__sn` / iframe id). Stale.                                                                                                                     |
| 1413               | Superseded by 1428.                                                                                                                                                |
| 1462               | Superseded by 1673 + 1688.                                                                                                                                         |
| 1791               | They **solved it differently**. Not their code.                                                                                                                    |
| 1825 / 1826 / 1806 | Closed unmerged upstream (2026-06-17). 1826 superseded by merged 1854. 1806’s backward-skip fix exists only on the closed branch; they may vendor that themselves. |

### Their own open PRs — nudge, but not a free merge

Need tests or are part of a cluster: 1635 (Chrome custom-element iframes),
1641 (adopted styles), 1686 (`stringifyRule`), 1755 (iframe `pagehide` —
they want this folded into a combined iframe-lifecycle PR with 1791).
1469 (bitmap errors) was on 3765 adopt-high; confirm it is still open.

### They explicitly declined (do not promote on their review)

1694 (mutation throttle — they already have SDK `MutationThrottler`;
upstream wraps the same `emit()` checkout uses). 1373 (`null` mask/block
class — unreachable under their hard-coded classes). 1356 (zone.js
`setTimeout` — CHANGES_REQUESTED, they have their own Zone path).

---

## Suggested first merges (upstream `main`, no strategy meeting required)

**Community**

1. **1712** (already approved by Justin + Eoghan). Decide 1656 the same day.
2. Approve+merge 1921, 1905, 1904, 1903, 1906 — all `REVIEW_REQUIRED`, no human review.
3. 1771, 1769, 1737, 1802, 1856 — same review state, authors are not waiting to revise.
4. **Already running in PostHog’s fork (posthog-js 3765):** 1688, 1691, 1711, 1770, 1812, 1633, 1814.
5. Stop. Hidden-input / placeholder masking (1745, 1912) need a changeset
   and a decision against privacy-at-capture. Cross-origin allowlisting is
   1800, not 1679. Invalid-media leftover 1798 should be closed. 1873 still
   needs a privacy review even though PostHog shipped a port.

**Maintainers, same day**

- Eoghan: merge 1673 and 1697 (PostHog already runs 1697); close 294/389/558/724/1477
- Justin: merge 1891/1732; close 1239/1462
- Yun: decide whether 1149 is split or closed
- Optional: land the 7-line 1302 `addedSet` fix instead of waiting on 1652

Then the team meeting (assets, heatmaps, Cloud/extension, closed shadow, 2.0).
