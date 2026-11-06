#!/usr/bin/env python3
"""Build the self-contained intake triage board from the newest snapshot.

    python3 docs/triage/build_board.py                 # writes index.html
    python3 docs/triage/build_board.py --artifact OUT  # also writes the claude.ai artifact page
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Checked-in upstream state, written by refresh.py. Exactly one is kept.
SNAPSHOT = max(ROOT.glob("snapshot-*.json"))
OUT_HTML = ROOT / "index.html"
# Buckets of the board as it stood at the last refresh, written by refresh.py.
# Rows that are new or in a different bucket get a badge and the Changed filter.
PREVIOUS = ROOT / "previous-buckets.json"

MAINTAINERS = {
    "eoghanmurray": "Eoghan",
    "Juice10": "Justin",
    "YunFeng0817": "Yun",
}

TRIAGE_RANK = {
    "merge-now": 0,
    "adopt": 1,
    "review": 2,
    "discuss": 3,
    "cleanup": 4,
    "reject": 5,
    "bulk": 6,
}

TRIAGE_LABEL = {
    "merge-now": "Merge now",
    "adopt": "Adopt",
    "review": "Review individually",
    "discuss": "Discuss in team",
    "cleanup": "Request clean-up",
    "reject": "Reject",
    "bulk": "Bulk hygiene",
}

# Semantic overlay. Computed tags (who, draft, review state, GitHub labels)
# are added in assemble().
# Fields: triage, reason, notes, next, tags, downstream, related
PR = {}


def pr(
    number: int,
    triage: str,
    *,
    reason: str,
    next_step: str,
    notes: str = "",
    tags: tuple[str, ...] = (),
    downstream: str = "",
    related: tuple[int, ...] = (),
    message: str = "",
) -> None:
    PR[number] = {
        "triage": triage,
        "reason": reason,
        "notes": notes,
        "next": next_step,
        "tags": list(tags),
        "downstream": downstream,
        "related": list(related),
        "message": message,
    }


# --- Merge now: approved upstream, only the merge button is left --------
pr(1995, "merge-now", reason="Eoghan's one-line rrdom fix resets document scrollData in destroyTree so a skip forward past scroll events followed by a scrub back to an earlier full snapshot no longer reapplies a stale scroll offset; includes a diff test and changeset. Justin approved on 2026-11-03.", next_step="Eoghan: merge.")
pr(1993, "merge-now", reason="Stops absolutifyURLs rewriting fragment-only css urls like url(#filter), which broke SVG filters, masks and gradients on replay. Three tests added. Eoghan approved on 2026-10-31 and the author applied his changeset suggestion the same day.", next_step="Eoghan: merge.")
pr(1987, "merge-now", reason="Eoghan's fix moving the id-to-CSSStyleSheet map out of the record-side StyleSheetMirror into the replayer, so adopted stylesheets are released by GC instead of being pinned for the whole recording. Follow-up to 1971. Justin approved on 2026-11-06 and main was merged in the same day; mergeable.", next_step="Eoghan: merge.")
pr(1986, "merge-now", reason="Adds paths-ignore for markdown and .changeset to the ESLint and Bundle Stats workflows so docs-only pushes do not run them; Tests already ignored markdown. Justin approved on 2026-11-06.", next_step="Eoghan: merge.")
pr(1979, "merge-now", reason="Runs the WebKit CI job inside the Playwright Docker image, removing the per-run browser and apt install. Approved on 2026-10-28 by kevinvandijk (write access) and merged with main the same day.", next_step="Eoghan: merge.")
pr(1965, "merge-now", reason="Skips inlining and load listeners for images that are blocked, so a blocked placeholder never gets rr_dataURL and no canvas encode runs. Eoghan approved on 2026-10-25, the author merged main on 2026-11-05, checks pass and the branch is MERGEABLE. Fixes open issue 1919.", next_step="Eoghan: merge.", tags=("strengthens-privacy",), related=(1919,))
pr(1956, "merge-now", reason="Keeps blob: urls unchanged in absolutifyURLs, matching how data: urls and src/href blobs are already handled, with unit tests and a changeset. Eoghan's changeset suggestion was applied on 2026-11-06 and Justin approved the same day. Closes #1955.", next_step="Justin: merge.")
pr(1841, "merge-now", reason="Backfills the pre-Changesets v2 alpha release notes into six package changelogs. Eoghan approved on 2026-05-30 with three wording suggestions; Justin merged main and added a note on the transition to shared monorepo versions on 2026-10-23. Review decision is APPROVED and the branch is mergeable.", next_step="Justin: merge.")
pr(1770, "merge-now", reason="Removes the temporary iframe in getUntaintedPrototype when contentWindow is null or the lookup throws; fixes #1627 with a changeset. Approved on 2026-10-28 by kevinvandijk (write access) and merged with main the same day. main still leaks the iframe on the throw path. 1934 edits the same function and should rebase after.", next_step="Eoghan: merge; then Justin rebases 1934.", tags=("posthog-backed",), downstream="Already in PostHog's fork.", related=(1627, 1934))
pr(1744, "merge-now", reason="Fixes six broken relative links in docs/recipes (console, dive-into-event, plugin, plus zh_CN copies) to the plugins and types packages. Justin approved on 2025-10-14. The new targets exist on main.", next_step="Justin: merge.")

# --- Adopt: small, correct, tested; one review and it can merge ----------
pr(2004, "adopt", reason="Replayer skips autocomplete attribute mutations on input and textarea so the autocomplete=off applied at rebuild is not undone by recorded changes (issue 1315, open, labelled good first issue and privacy). Seven-line change with a replayer test covering virtual and real DOM and a patch changeset. Opened 2026-11-05, mergeable.", next_step="Eoghan: review and merge.", tags=("strengthens-privacy",), related=(1315,))
pr(2002, "adopt", reason="Replayer.applyMutation reassigned d.removes to the mirror-filtered list, so a removal whose node was transiently missing was deleted from the event and every later seek or new Replayer left the node on screen. The fix filters into a local variable and uses it in the three places that read removes. Comes with an events fixture, a replayer test and a changeset, and relates to open #1449.", next_step="Eoghan: review and merge.", related=(1449,))
pr(2001, "adopt", reason="Records TouchCancel on pointercancel so a touch that scrolls the page no longer leaves the replay touch indicator on. Small diff with an integration test and a changeset; Eoghan's changeset suggestion of 2026-11-05 was applied the same minute. Mergeable.", next_step="Eoghan: review and merge.")
pr(1992, "adopt", reason="Justin adds Blacksmith as an infrastructure sponsor in the README, hosting the badge in a gist rather than the repo. Six commits, the last on 2026-11-06; no longer a draft. Justin is the assignee.", next_step="Justin: get a quick approval from Eoghan and merge.")
pr(1988, "adopt", reason="Three-line fix in the mutation buffer's walk-up loop so a shadow child whose host is queued later in addedSet jumps through the ShadowRoot to the host instead of being dropped, plus a five-scenario test file; ported from PostHog at Eoghan's request on top of the merged 1652. Eoghan requested changes on 2026-10-29 (trim comment, shorten changeset, add @rrweb/record patch); the author addressed all four the same day and merged main on 2026-11-06. Eoghan owes the re-review.", next_step="Eoghan: re-review and merge.", tags=("posthog-backed",), downstream="Ported from PostHog/posthog-js 5244, where Eoghan asked the author to upstream the jump and the tests on top of 1652.")
pr(1980, "adopt", reason="Eoghan adds AGENTS.md (comment policy for agents, search open PRs first) and a one-line CLAUDE.md that imports it. Docs only, mergeable, no review yet.", next_step="Justin: review the wording and merge.")
pr(1977, "adopt", reason="Five Chromium regression tests for recording continuing after an iframe navigates from a same-origin document to a cross-origin one. Eoghan requested changes on 2026-10-24: the source fix was already in 1971, keep only the tests. The author narrowed the PR to iframe-navigation.test.ts on 2026-10-26, so the stale CHANGES_REQUESTED is answered and the re-review is owed.", next_step="Eoghan: re-review the test-only PR and merge.", message="Thanks for narrowing this to the tests as Eoghan asked. They cover ground #1971 did not, so they are worth landing as a regression check.")
pr(1962, "adopt", reason="In the network plugin's no-Resource-Timing fallback, keeps the observed HTTP status and the wrapper's measured start, end and duration for fetch and XHR, marks rejected fetches as status 0, with three tests and a changeset; fixes open issue 1942. 87 lines in one plugin, two-way door. One nit: xhr.status is read after the polling delay, so an abort or reopen in between could change it.", next_step="Eoghan: review, ask for xhr.status to be captured at completion time, and merge.", related=(1942,))
pr(1950, "adopt", reason="hookSetter defines a descriptor with only a setter; Firefox Xray wrappers in extension content scripts do not merge descriptors, so input.value and checked read undefined while recording and after stop(). The PR passes the original getter and configurable: true, which is a no-op on merging engines. Unit tests model the Xray case, and a changeset is included. main still has the bare setter descriptor.", next_step="Justin: review and merge.", tags=("commercial",))
pr(1938, "adopt", reason="One-condition fix in rebuild.ts: the srcset backup branch did not check the attribute name, so every attribute on an inlined img with srcset was dropped (issue 1937, open). main still has the bug. Comes with a rebuild test that fails without the fix, a patch changeset and a live repro.", next_step="Eoghan: review and merge.", related=(1937,))
pr(1810, "adopt", reason="Justin's one-line CI change sets fail-on-error: false on the eslint-annotate step of the privileged workflow so lint findings stop painting the relay job red while the ESLint Report Analysis check still fails on real errors. Main does not have the setting yet; the file moved since so it needs a trivial rebase.", next_step="Justin: rebase the one-liner and merge.")
pr(1802, "adopt", reason="Moves querySelector and querySelectorAll from testableAccessors to testableMethods in @rrweb/utils, because they are methods and the accessor check always failed, so rrweb created a throwaway iframe for them on every call. main still has them under testableAccessors; 1633 (merged 2026-10-26) did not touch this list. Nine lines with a changeset.", next_step="Eoghan: review and merge.", tags=("posthog-backed",), downstream="Already in PostHog's vendored rrweb.")
pr(1796, "adopt", reason="Replayer hover simulation used classList, which deduplicates class tokens and breaks attribute selectors like [class*=\"center aligned\"]; the fix sets the class attribute text directly. Small replay-only change with a fixture and a puppeteer test, Copilot nits addressed the same day, MERGEABLE. Missing a changeset.", next_step="Eoghan: review, add an @rrweb/replay patch changeset, merge.")
pr(1792, "adopt", reason="Justin's three-line turbo.json change swaps the stale prepublish outputs (lib, es, typings) for the ones packages actually emit (build, umd, dist). main still lists the old paths and rrweb publishes umd and dist.", next_step="Eoghan: review and merge.")
pr(1789, "adopt", reason="Justin's two-line build change switching tsconfig.base.json moduleResolution from Node to bundler so TypeScript resolves package exports the way Vite and Rollup do. Zero bundle size change; only risk is type-check fallout, which CI will show after a rebase.", next_step="Justin: rebase, confirm check-types passes in CI, merge.")
pr(1732, "adopt", reason="Justin's docs-only PR adding Sentry, StatCounter and Recordonce sponsor logos to the README and the 22 package READMEs. No code, empty changeset. It has sat since 2025-09-06 and the README edits will need a rebase.", next_step="Justin: rebase and merge.")
pr(1691, "adopt", reason="rrdom diffProps skips setAttribute when the attribute already has that value, because Chrome drops insertRule rules when type=text/css is re-set on a style element. Comes with a rrdom unit test, a replayer test and a changeset. main still calls setAttribute unconditionally. No review yet since 2025-05-15.", next_step="Yun: review and merge.", tags=("posthog-backed",), downstream="Already in PostHog's fork. Grafana independently re-implemented the same skip-unchanged setAttribute in rrdom (grafana/rrweb 31).")
pr(1686, "adopt", reason="One-line optional chaining: stringifyRule read rule.styleSheet.href on an @import whose styleSheet was null, which threw, was caught upstream and nulled the whole _cssText. main still has the bare access. Has a changeset.", next_step="Eoghan: review and merge.", tags=("posthog-nudge",), downstream="On PostHog's own open-PR nudge list.")
pr(1463, "adopt", reason="Three-line change so wrapped functions from patch() return the original's toString, which stops Stencil from thinking attachShadow was polyfilled and breaking recording. Includes a changeset. On main patch() has moved to packages/utils/src/index.ts and does not set toString, so the fix still applies but needs porting to the new file.", next_step="Eoghan: port the toString override to patch() in packages/utils and merge.", downstream="On PostHog planned batch-2 list; never executed.")
pr(1392, "adopt", reason="One-character regex change so URL schemes with a hyphen (chrome-extension://) are recognised as absolute and not rewritten in stylesheets; fixes #1391, changeset included. Correct per RFC 3986 scheme syntax. The constant has since moved to rrweb-snapshot/src/utils.ts on main, so the patch needs re-applying there.", next_step="Eoghan: re-apply the one-line change on main (URL_PROTOCOL_MATCH in rrweb-snapshot/src/utils.ts) and merge.", related=(1391,))
pr(1290, "adopt", reason="Adds a launchOptions field to the rrvideo config file and passes it to chromium.launch, so Linux users can set --no-sandbox (issue 1289, still open). Small and self-contained; main still only exposes headless. No changeset and the 2023 cli.ts typing may need a rebase.", next_step="Yun: rebase if needed, add a changeset for rrvideo and merge.", related=(1289,))

# --- Review individually ------------------------------------------------
pr(2000, "review", reason="Dependabot security group bump (vite 6 to 8, happy-dom, sveltekit 3 and others). Eoghan approved on 2026-11-04 and pushed a tsconfig fix, then Justin pushed a Vite 8.3.6 workspace upgrade on 2026-11-06 after which both Tests jobs fail at Run tests. Approval stands but CI is red.", next_step="Justin: fix the failing Tests jobs from the Vite 8 upgrade, then merge.")
pr(1984, "review", reason="rrvideo renders .mp4 frame by frame on a virtual clock through ffmpeg, with idle stretches rendered once after Eoghan's 2026-10-26 concern, and fixes the rrwebPlayer constructor bug that produced blank videos. Nine files, test, changeset, CI installs ffmpeg, MERGEABLE, checks green. Overlaps Justin's draft 1951.", next_step="Eoghan: re-review after the 2026-10-27 idle-frame commit and merge, unless the team picks 1951 instead.", related=(1951,))
pr(1982, "review", reason="Adds an opt-in cursor: { mode: 'state' } replayer option that draws the element's actual cursor (hand, I-beam, resize) from computed style, a built-in SVG pack, a CursorChange event, and fixes touch sessions hiding the cursor; includes tests, guide docs and a changeset. Eoghan requested changes on 2026-10-29 (plain SVGs instead of base64, changeset packages, extra setTimeout); the author answered all three with commits on 2026-11-04. Eoghan owes the re-review.", next_step="Eoghan: re-review the 2026-11-04 revision.", related=(1983,))
pr(1981, "review", reason="Changesets release PR for 2.2.1, regenerated 2026-11-05. It bundles the postcss CVE bump (1998), the media element fix (1673), blob url fix (1956) and the Angular zone change (1633).", next_step="Team: merge when the team wants to publish 2.2.1.", message="Release PR from Changesets. Merge when we want to publish; nothing to review beyond the changelog.")
pr(1978, "review", reason="Records and replays closed shadow roots by keeping the root from the attachShadow hook in a WeakMap, and adds record.registerShadowRoot for roots created earlier. Eoghan closed his own 1739 on 2026-10-25 in favor of this, contributed integration tests on 2026-10-26, and the author rebased over the 1971 teardown changes on 2026-10-28 and asked what else is needed. 20 files, MERGEABLE, checks green.", next_step="Eoghan: review the observer and shadow-dom-manager changes and the registerShadowRoot API, then merge.", tags=("impacts-privacy", "commercial"), downstream="Amplitude opened a closed-shadow mutation port (amplitude/rrweb 102, unmerged). Highlight has a Salesforce LWC / closed-shadow PR (highlight/rrweb 118).", related=(1977,))
pr(1972, "review", reason="Omits checked state for checkbox and radio inputs when input masking is on, in snapshots, mutations and input events, with tests. Eoghan requested changes on 2026-10-25 (also hide click and key targets on the input and its label) and on 2026-10-27 flagged the .svelte-kit files. The author pushed review fixes and label tests the afternoon of 2026-10-27, after Eoghan's comments. The diff still deletes the committed packages/rrweb-player/.svelte-kit files from the repo, and there is no changeset.", next_step="Eoghan: re-review the 2026-10-27 push; ask the author to drop the .svelte-kit deletions into a separate PR and add a changeset.", tags=("strengthens-privacy",), related=(1164,))
pr(1966, "review", reason="Re-requests cross-origin iframe snapshots after the parent's full snapshot so the iframe does not go blank (#1720); four regression tests, changeset, mergeable. Eoghan left three questions on 2026-10-25 at 17:29; the author pushed a rework at 17:40 moving the request into IframeManager.addIframe but did not reply in the thread. Same approach as 1465, which has changes requested and no tests, so this is the better one.", next_step="Eoghan: re-review the 2026-10-25 rework; author replies to the double-snapshot question.", related=(1720, 1465))
pr(1957, "review", reason="Justin's rework of @rrweb/browser-client transport: coordinated HTTP fallback after WebSocket disconnects, bounded retries with backoff, queue and payload caps, lifecycle cleanup, with transport tests and README. About 1000 lines, CI green per the description, only Codex has reviewed it. This is the rrweb Cloud client path.", next_step="Eoghan: review.", tags=("commercial",))
pr(1934, "review", reason="Justin's rewrite of 1812 (closed): recover a native Proxy constructor via the shared iframe lookup so libraries that overwrite window.Proxy do not break stylesheet observers. Chromium and WebKit tests, changeset. Only Copilot comments so far (bound-function toString check, Safari iframe retention). Touches the same function as 1770.", next_step="Eoghan: review after 1770 merges; Justin rebases.", tags=("posthog-backed",), downstream="PostHog listed 1812 on their batch-2 list; this carries that fix forward.", related=(1770,))
pr(1933, "review", reason="Eoghan's change stops emitting repeated text and attribute mutations for the same node while throttled or frozen, and reimplements the per-element mutation throttling from closed 1694. 14 files with changesets, docs and new tests, commits through 2026-10-27, MERGEABLE, checks green, no reviewer yet.", next_step="Justin: review the mutation.ts rewrite and merge.")
pr(1927, "review", reason="Justin's draft observes canvas APIs on same-origin iframe windows and serializes drawImage image arguments across realms, with a regression test (issue 1881). Still draft, never reviewed, and now conflicts after the 2.2.0 teardown rewrite. 1428 covers similar ground for canvas in iframes and shadow DOM.", next_step="Justin: rebase on the 1971 iframe observer structure, mark ready, and reconcile with 1428.", related=(1881, 1428))
pr(1897, "review", reason="Adds an opt-in hackCssPseudoClasses option to rebuild so :active, :focus, :focus-visible and :focus-within are mirrored as classes like :hover (issue 1896, open). Defaults keep current behaviour, has css and integration tests plus a changeset, rebased 2026-09-16. The author asked which option shape the maintainers prefer; no maintainer has answered.", next_step="Eoghan: review and answer the option-shape question (separate option vs extending hackCss).", related=(1896,))
pr(1875, "review", reason="Justin's docs change points CDN ESM examples at .min.js assets. Eoghan requested changes on 2026-06-12 (packages/record/README.md did not exist; remove the pinned-version note after the CDN backfill). Justin replied 'fixed' on 2026-06-18 and the README now exists on main, so the re-review is owed. The text assumes the .min.js backfill for older versions is done.", next_step="Eoghan: re-review and confirm the CDN backfill is complete before merging.")
pr(1861, "review", reason="Justin adds a browser-client-managed sequenceId to every event sent to rrweb Cloud, persisted in sessionStorage per recording id, and extends the sequential-id record plugin to resume from a given id. Copilot's points (changeset split, best-effort storage, recording-scoped start token) were addressed on 2026-06-05. No maintainer review yet; 2370 lines including spec and plan docs.", next_step="Eoghan: review the browser-client and plugin changes.", tags=("commercial",))
pr(1830, "review", reason="Eoghan's fix so a <canvas> recorded without recordCanvas still carries its width and height at replay, otherwise it can collapse and break layout (lazysizes case). Comes with an rrweb-snapshot integration test, an image snapshot and a changeset. Main's rebuild.ts has no such dimension handling, so nothing merged covers it.", next_step="Justin: review and merge.")
pr(1784, "review", reason="Eoghan removes postcss from the record bundle by resolving workspace imports to source and marking rrweb-snapshot side-effect free; record.js shrinks about 60 percent. Justin requested changes on 2026-02-10 and again on 2026-05-19, the open point being that a globalThis.Node instanceof check breaks for iframes. Eoghan replied the same day asking whether that came up in a test or needs one; Justin, the assignee, has not answered.", next_step="Justin: answer whether the iframe Node check needs a test, then re-review.", tags=("commercial",))
pr(1748, "review", reason="Rewrites eight relative links in the root README to absolute github.com URLs so they work on npm. Justin replied on 2025-11-19 that every package README has the same problem and suggested fixing the npm repository link instead; the author asked on 2025-12-02 whether to do that here or in a new PR and has had no answer.", next_step="Justin: answer the author; either merge this root README fix or ask for the package.json repository link change instead.")
pr(1745, "review", reason="Adds hidden inputs to the maskAllInputs defaults so their values are masked (issue 1609, open, labelled bug and privacy), with a form fixture and updated snapshots. It is a byte-for-byte re-submission of 1610 to get fresh CI, so 1745 is the one to take. Eoghan commented on 2026-10-27 that hidden inputs should probably be masked even without maskAllInputs, like password fields; that scope call is still open and there is no changeset.", next_step="Eoghan: decide whether hidden inputs are masked always or only under maskAllInputs, then have the author add a changeset and merge.", tags=("strengthens-privacy",), related=(1609, 1610))
pr(1740, "review", reason="Eoghan's fix for #1702: CDATA sections now record their textContent and rebuild as text nodes, because createCDATASection throws in HTML documents. Includes an SVG fixture test and is mergeable. main still records CDATA as empty and calls createCDATASection. The changeset has empty frontmatter and needs an rrweb-snapshot patch entry.", next_step="Justin: review and merge; Eoghan fills in the changeset.")
pr(1735, "review", reason="Strips empty declarations like 'border-top-style: ;' from rule.cssText so replay no longer throws CssSyntaxError Unclosed string (issue 1734). Has a changeset and a unit test. Eoghan is assigned and wrote on the issue (2025-09-15) that his 1322 proposal would fix the same thing. The changeset names @rrweb/record although the change is in rrweb-snapshot.", next_step="Eoghan: decide between this regex and the 1322 approach; if this one, have the author point the changeset at rrweb-snapshot.", related=(1322, 1734))
pr(1733, "review", reason="Fixes absolutifyURLs resolving relative url() paths against a hash-router base URL by stripping the fragment before splitting, and runs the existing tests against both a stylesheet href and an inline-style hash href. Eoghan requested changes on 2025-09-17 (new URL is slow and can throw) and suggested split('#')[0]; the author pushed exactly that the same day with a changeset. Eoghan owes the re-review.", next_step="Eoghan: re-review the 2025-09-17 revision and merge.", related=(1993,))
pr(1718, "review", reason="In rrdom diffChildren, a mismatched node type replaced the old child and lost its nextSibling, so the loop ended early and dropped later siblings and styles. The PR inserts the new node before the old child instead and keeps the loop going, with a diff test. Eoghan asked for the real-world scenario on 2025-09-05 and the author answered the same day (Dark Reader extension). Has a changeset.", next_step="Eoghan: re-review now that the motivating scenario is explained.")
pr(1697, "review", reason="Eoghan's small recorder change with a changeset: when the page is frozen, MediaInteraction, StyleSheetRule, CanvasMutation, Font, Log, StyleDeclaration and AdoptedStyleSheet events no longer count as user activity that unfreezes it, so a looping background video cannot defeat freezing. Main still only exempts Mutation, so the merged 1673 (replay-side media safety) does not cover this. No test.", next_step="Justin: review the new exempt list and merge; ask for a test if the freeze semantics worry you.", tags=("posthog-backed", "posthog-shipped"), downstream="Shipped in posthog-js 4131 (near-verbatim plus a Set hoist). Checkout timers can still unfreeze.")
pr(1641, "review", reason="With virtual DOM, node removals run before adopted stylesheets are applied, so styles owned by a removed node are never stored and a later node that adopts them is unstyled. The PR caches the missed styles in a styleMap and applies them when a styleId is requested. Has a changeset, an event fixture and a replayer test; the types change is only a type alias extraction. Never reviewed.", next_step="Yun: review the replayer styleMap logic.", tags=("posthog-nudge",), downstream="PostHog wants tests. Amplitude shipped inline adoptedStyleSheets in the full snapshot (101) and has a mutation-add follow-up open (133).")
pr(1586, "review", reason="Adds replaceChromeGridTemplateAreas to rebuild grid-template-areas from rule.style when Chrome's cssText drops rows (Chromium bug 40227336). Replaces the closed regex PR 1396, has a changeset and unit tests, and has never been reviewed. main has no grid handling, so nothing merged covers it. Whether the Chromium bug is still live was not checked. Verified 2026-11-06: Chrome 152 serializes grid-template-areas, repeat() rows and the grid-template shorthand correctly, so the bug this works around is fixed in current Chrome; the value depends on how old a Chrome the team still supports.", next_step="Eoghan: decide whether the supported Chrome range still needs the workaround; close if not, otherwise review.", downstream="Amplitude rrweb 126 (unmerged) serializes grid-template-areas faithfully.")
pr(1373, "review", reason="Lets maskTextClass and blockClass be null so class matching is skipped for a perf win when only selectors are used. Eoghan called it great on 2024-04-13 and asked for a rebase; the author rebased on 2024-05-01 and nobody looked again. Two-line change with a changeset, MERGEABLE, but the TypeScript types were not widened to accept null.", next_step="Eoghan: re-review; ask for the option types to accept null before merging.", tags=("posthog-declined",), downstream="PostHog declined: unreachable under their hard-coded classes.")
pr(1322, "review", reason="Eoghan's draft holds only a failing test showing that CSSOM serializes a shorthand set from a CSS variable as empty longhands (w3c csswg-drafts 2515). Eoghan sketched an innerText-comparison fix in 2024-06; eliavb43 reported on 2026-10-19 that rrweb 2.1.7 still breaks GitHub button borders and shared a workaround that keeps the original source when a stringified sheet has empty declarations. Nobody has turned either into a fix.", next_step="Eoghan: decide whether to adopt the empty-declaration fallback from the 2026-10-19 comment as a real fix, or convert this draft into an issue.")
pr(1320, "review", reason="Eoghan's replay fix: queueToResolveTrees puts a root tree first when another root depends on it, avoiding cascading requeues that hit the 500ms timeout on large table inserts. JonasBa flagged the O(n^2) unshift on 2023-10-09 and accepted the reasoning. Running at Statcounter since Oct 2023 (comment 2026-06-11), rebased 2026-06-26, but has no regression test and is not on main.", next_step="Justin: review and merge; ask Eoghan for a small fixture test if cheap.")
pr(558, "review", reason="Eoghan's 2021 PR that keeps event timestamps weakly ascending when mouse-move batching is interrupted. He rebased it onto 2.x on 2026-10-25, added record tests, a changeset and a quantitative note (2026-09-24) on the extra mouse-move events it produces, and fixed a rebase mistake on 2026-10-27. No maintainer has reviewed the 2026 version.", next_step="Justin: review the rebased PR and merge.", downstream="On PostHog planned batch-2.", related=(1475,), message="Eoghan's corpus analysis answers the open question from 2021: about 54% more mousemove events, same positions, negligible extra bytes. Needs a second maintainer review, then it can merge.")

# --- Discuss in team ---------------------------------------------------
pr(1996, "discuss", reason="Draft adding a crossOriginIframeTransport option (send and subscribe hooks) so an embedder can route recorder messages off window.postMessage. It changes who can carry cross-origin recording traffic and sits in the same area as Eoghan's 1991 origin-scoped iframe recording. No maintainer has commented since 2026-11-03, and most of the description is unrelated Electron PDF diagnostics.", next_step="Team meeting: decide whether a pluggable iframe transport belongs in core alongside 1991; ask the author to trim the description.", tags=("impacts-privacy",), related=(1991,))
pr(1991, "discuss", reason="Eoghan's alternative to 1679: replaces recordCrossOriginIframes with origin-scoped collectFromOrigins (parent) and emitToOrigin (child), with docs and tests. Justin commented on the trust guidance on 2026-10-29, Eoghan noted minor versus patch on 2026-10-28 and asked on 2026-11-06 whether emitToOrigin should stop top-level emission. Competing designs and a security model question.", next_step="Team meeting: pick 1991 or 1679 as the cross-origin trust model and settle the version bump.", tags=("strengthens-privacy",), related=(1679, 1800, 1256, 1726, 1996))
pr(1990, "discuss", reason="Eoghan's CI change enables Turborepo remote cache via Vercel OIDC on internal branches, gated off for forks. On 2026-11-06 Eoghan commented that the team is trying Blacksmith first, so this is on hold pending that trial. MERGEABLE, 22 added lines.", next_step="Eoghan: convert to draft or close until the Blacksmith trial decides the CI caching approach.")
pr(1989, "discuss", reason="Draft that makes @rrweb/browser-client default maskInputFn to a bucketMasker so masked inputs no longer reveal exact length. roggernaut argued on 2026-10-29 that bucketing hides only one to two bits and proposed a constant placeholder plus inputKinds instead. This is a new masking default that overlaps the privacy policy work. drakonen is the assignee.", next_step="drakonen: take the bucketing versus placeholder question into the privacy policy discussion before continuing.", tags=("privacy-overlap", "strengthens-privacy"))
pr(1985, "discuss", reason="Justin's draft adds an agent takeover skill under .agents, .claude and .codex plus a CI job that tests it. No rrweb runtime change. Whether agent skill directories and their CI belong in the repo is a process decision for the team.", next_step="Team meeting: decide whether agent skills live in the repo; then Justin marks it ready.")
pr(1951, "discuss", reason="Justin's draft adds ffmpeg frame capture and an experimental compositor backend to rrvideo, 37 files with benchmarks and a new workflow. The smaller 1984 from a community author implements the same virtual-clock MP4 export, is ready for review, and Eoghan engaged with it on 2026-10-26. Two designs for one feature.", next_step="Justin: decide whether to close 1951 in favor of 1984 or rebase the compositor backend on top of it.", related=(1984,))
pr(1949, "discuss", reason="Makes rrweb-snapshot capture document and shadow-root adoptedStyleSheets into a new adoptedStyleSheets field on serializedNode and rebuild them, for direct rrweb-snapshot users (issue 1567, open since 2024). It changes the shared snapshot format in @rrweb/types and duplicates the AdoptedStyleSheet incremental path rrweb already uses, which Eoghan's 1987 and 1641 also touch. Format changes need the team.", next_step="Team meeting: decide whether constructed stylesheets belong in the full snapshot format or stay on the incremental path.", related=(1567, 1987, 1641))
pr(1936, "discuss", reason="Justin's draft stops the web extension from recording inside cross-origin frames and sets recordCrossOriginIframes false, so frame content is not posted to window.parent where the host page can read it. Eoghan asked on 2026-09-08 whether each frame then becomes its own recording, and on 2026-11-06 whether frames could post straight to the extension instead of dropping child content. Both unanswered.", next_step="Justin: answer Eoghan on posting frame events directly to the extension, then take the draft out of draft or close it.", tags=("strengthens-privacy", "commercial"))
pr(1917, "discuss", reason="Adds an opt-in adaptCssInTextMutations replayer option so consumers who pre-process recordings can skip the postcss :hover rewrite on style text mutations, with benchmarks showing a 9 second first-apply stall, a test and a changeset. Eoghan's open 1480 replaces the postcss rewrite with stylesheet mutation, which would remove the cost this knob works around, so the team should decide which lands.", next_step="Team meeting: decide whether 1480 lands first; if it does, close this, otherwise Eoghan reviews it.", related=(1480,))
pr(1914, "discuss", reason="Eoghan's new record-only click-track plugin for heatmaps, built on his external semantic-selector library. Justin reviewed on 2026-09-07 asking for the event types to move to @rrweb/types and for rrweb to be listed as a dependency; Eoghan has not answered. A new plugin package with a new third-party dependency is a team call, and the diff drags in .svelte-kit generated files and yarn.lock.", next_step="Eoghan: answer Justin's 2026-09-07 comments and drop the stray .svelte-kit files; team decides on taking the semantic-selector dependency.", tags=("commercial",))
pr(1912, "discuss", reason="Masks input and textarea placeholder attributes through maskInputValue when maskAllInputs or maskInputOptions is set, in snapshot and in attribute mutations, with an integration test. It extends the masking contract and overlaps the privacy policy work and 1257's attribute masking. No changeset, no maintainer comment.", next_step="Team meeting: decide placeholder handling inside privacy-at-capture together with 1257.", tags=("privacy-overlap", "strengthens-privacy"), downstream="Mixpanel shipped this. New Relic opened the same mask-placeholder change (closed unmerged). Datadog hides placeholders in their own recorder.", related=(1257,))
pr(1909, "discuss", reason="Justin's draft adds manual session uploads from the web extension to api.rrweb.com with a configurable base URL and bearer token stored locally; +3156 lines across 18 files with tests. Asked Eoghan for review on 2026-07-22 with no response. It sends recordings off the device, so the consent and endpoint design needs the team.", next_step="Team meeting: agree the extension upload and consent design, then Justin marks it ready for Eoghan's review.", tags=("commercial", "impacts-privacy"))
pr(1900, "discuss", reason="Adds two new plugin packages (popup-record and popup-replay) that record window.alert, confirm and prompt calls and the user's response, with tests, README, recipe and changeset. The author pinged Justin on 2026-09-16 with no reply. Adding plugins to the monorepo and the shape of the events are plugin-direction questions for the team.", next_step="Team meeting: decide whether new interaction plugins live in the monorepo; Justin answers the author either way.")
pr(1892, "review", reason="Justin moves plugins off a hard rrweb peer dependency: adds a host-neutral ReplayPlugin type to @rrweb/types, declares real runtime deps in each plugin's package.json, documents compatible hosts and adds a packed-package smoke test. The body lays out the options and picks no host peer. Copilot noted the smoke test still installs the monolithic host. No maintainer review. Justin documented the options and picked no host peer; no second maintainer has weighed in, so this is one maintainer's yes or no rather than a meeting.", next_step="Eoghan: agree or object to the no-host-peer contract Justin chose; if agreed, review the smoke test's dependency list and merge.")
pr(1874, "discuss", reason="Justin's draft experiment migrates formatting, linting and Vitest to Vite+ across 47 files, replacing Prettier and the legacy ESLint config and bumping the yarn packageManager. Eoghan asked on 2026-06-23 whether this is the alternative to Biome and Justin confirmed. It is a tooling direction choice for the team, not something a reviewer can decide.", next_step="Team meeting: choose between Vite+ and Biome for formatting and lint; Justin then finishes or closes the experiment.", tags=("maintainer-close",))
pr(1848, "discuss", reason="Justin's draft against the next prerelease branch adds captureAssets end to end and switches browser-client to stylesheet asset capture by default. It is a second implementation of the asset work in 1475 (different asset-manager code, 52 files). MERGEABLE but untouched since 2026-06-01 and Copilot flagged a lookbehind regex and a timeout sentinel bug.", next_step="Team meeting: choose between 1848 and 1475 as the asset implementation and whether next is still the release channel for it.", tags=("commercial",), related=(1475,))
pr(1843, "discuss", reason="Justin's codex-generated migration from Yarn to pnpm across 46 files, plus CI browser install changes. Eoghan asked 'Is this a 2.0 PR?' on 2026-05-31 with no answer, and Justin's own review notes flag a webgl test that tests the wrong thing. main is still on yarn 1 and the branch conflicts. A package manager switch is a team decision.", next_step="Team meeting: decide whether to move to pnpm and when; Justin then regenerates the PR on current main.")
pr(1828, "discuss", reason="Justin's docs-only draft plan for a downstream next prerelease channel (Changesets prerelease tag, retiring alpha on master, separate Chrome Web Store listing). The body lists four open decisions plus the package name, so it needs the team.", next_step="Team meeting: answer the decisions listed in the PR body, then Justin marks it ready.", tags=("commercial",))
pr(1800, "discuss", reason="Adds an allowedIframeOrigins option so cross-origin iframe events are only accepted from and posted to listed origins instead of '*'. Copilot flagged a fail-open on empty allowlists and postMessage DOMExceptions when the parent origin is not listed; the author pushed once on 2026-03-16. Eoghan opened 1991 as an alternative with per-relationship collectFromOrigins and emitToOrigin and asked on 2026-11-06 for that to be reviewed instead.", next_step="Team meeting: pick between 1800's single allowlist and 1991's origin-scoped options, then close the other.", tags=("strengthens-privacy",), related=(1991,))
pr(1730, "discuss", reason="Eoghan adds an rrdom-to-HTML serializer (document.ts, escape.ts) so a FullSnapshot plus mutations can be rendered statically without puppeteer, and wires it into packages/rrweb-cutter. The PR is based on the trim branch, not main, and the cutter package does not exist on main. No changeset, no review.", next_step="Eoghan: decide whether the trim/cutter branch lands in 2.x; if the rrdom toHTML method is wanted on its own, retarget it at main with a changeset.", tags=("commercial",), related=(1149,))
pr(1679, "discuss", reason="Adds a config option so cross-origin child frames postMessage to a specific parent origin instead of '*'. Justin approved on 2026-10-23 after rebasing it; Eoghan requested changes on 2026-10-28 only to flag 1991, his alternative that scopes both the send and receive side (collectFromOrigins / emitToOrigin), and to make the changeset a patch. Two competing designs for the same security hole.", next_step="Team meeting: pick 1679 (single parent-origin option) or 1991 (origin-scoped both ways); Eoghan drives.", tags=("strengthens-privacy",), related=(1991,), message="Thanks for this. It is approved on the send side, and Eoghan opened #1991 to cover the receive side with the same shape (it carries your commits). We will decide between the two as one cross-origin trust model and come back here.")
pr(1642, "discuss", reason="Adds a blockElementFn callback so consumers can whitelist or block elements by arbitrary logic, with a changeset and tests. Labeled privacy. Eoghan asked on 2026-11-06 for a concrete use case and production evidence because the callback cannot be optimized like a selector. Branch is CONFLICTING.", next_step="Author: answer Eoghan's 2026-11-06 use-case question; team folds the callback idea into the privacy policy API.", tags=("privacy-overlap",))
pr(1480, "discuss", reason="Eoghan's draft replaces regex rewriting of :hover selectors in rebuilt CSS with programmatic mutation of the stylesheet after insertion, removing the postcss dependency on the replay side. It is an alternative to the postcss route and, per Eoghan's 2026-10-23 comment, a candidate fix for #1675 (regex too large) that 1681 patches narrowly. The checklist (eslint, virtual DOM path, caching, perf) is still open.", next_step="Team meeting: choose between the CSSOM approach here and 1681's selector filtering for #1675, then either finish this draft or close it.", related=(1681, 1675))
pr(1475, "discuss", reason="The assets and stylesheet-assets feature (new Asset event, captureAssets config, async stylesheet processing, replay asset manager), 106 files, labeled 2.1. Last review activity Eoghan 2025-02-20 and commits to 2026-06-18; CONFLICTING since. A parallel asset implementation sits in 1848 on the next branch, so the team has to pick one line and schedule it.", next_step="Team meeting: decide whether 1475 or 1848 is the asset line for 2.x, then Eoghan rebases that one.", tags=("commercial", "impacts-privacy"), related=(1848,))
pr(1257, "discuss", reason="Sentry's billyvg adds a maskAttributeFn callback to rrweb-snapshot and the mutation observer so attributes such as placeholder can be masked. It is a new masking knob that overlaps the privacy policy API, and 1912 covers the placeholder case with a narrower change. Eoghan asked on 2026-11-06 whether it fixes #1581 (open, labelled privacy).", next_step="Team meeting: fold attribute masking into the privacy-at-capture design together with 1912 and #1581, then tell billyvg whether the callback shape survives.", tags=("privacy-overlap", "strengthens-privacy"), related=(1581, 1912))
pr(1164, "discuss", reason="Extends maskAllInputs to mask option text and the value attribute of option, radio and checkbox inputs. Yun requested changes on 2023-03-05 and said on 2023-03-19 he would merge once a radio leak in input mutations was fixed; the author fixed it on 2023-03-20 and rebased on 2023-07-07, then nothing until Eoghan added the privacy label and requested a review from drakonen on 2026-11-06. It changes the masking contract and overlaps the privacy policy work and drakonen's 1972, which omits checked state for masked checkbox and radio inputs.", next_step="Eoghan: fold this into the privacy-at-capture design together with 1972, and decide whether the author should rebase the 2023 branch.", tags=("privacy-overlap", "strengthens-privacy"), related=(1972, 1989, 1912))
pr(1149, "discuss", reason="Yun's draft adding a new @rrweb/cutter package (session cutting, branch pruning) and a SyncReplayer inside rrweb, about 8.8k lines across 48 files. Last merge from upstream 2025-09-16, still draft with open TODOs for tests, docs and interface tweaks. Whether a new package and a second replayer belong in the 2.x monorepo is a team decision, and the diff carries stray .svelte-kit generated files and yarn.lock changes.", next_step="Team meeting: decide whether @rrweb/cutter and SyncReplayer ship in 2.x; if yes Yun splits SyncReplayer into its own PR first.", tags=("commercial",))
pr(1097, "discuss", reason="Makes maskTextClass and maskTextSelector apply to input values and passes maskInputFn to the initial snapshot; cut down on 2023-12-08 to fix #874 only after a long review with Justin, Yun and billyvg. The last ping (2024-05-01) got no maintainer answer. It changes the masking precedence contract between text and input options, so it belongs with the privacy-at-capture design.", next_step="Team meeting: decide in the privacy policy design whether text masking rules apply to inputs, then ask the author to rebase or close.", tags=("privacy-overlap",), related=(874, 1096))
pr(1023, "discuss", reason="Adds a record() option to pass a custom Window (window.top, parent, or an iframe's contentWindow) so a third-party tag injected in an iframe can record the host page. Competes with 294 (always use window.top). Eoghan said in 2023-01 the core team should decide which model to adopt; nothing since. Branch conflicts.", next_step="Eoghan: bring 1023 and 294 to the team and pick one window model, then ask the author to rebase or close.", tags=("impacts-privacy",), related=(294,))
pr(960, "discuss", reason="Four-line draft from 2022 by former maintainer Yuyz0112 that counts Custom events toward checkoutEveryNth. The author opened it as a question (count all event types or only custom?); Yun preferred counting all events and Justin wanted it in 2.0 (2022-08-18). Nothing since, and the linked issues 958 and 763 are still open.", next_step="Team meeting: decide whether checkoutEveryNth and checkoutEveryNms count non-incremental events (issues 958, 763), then finish or close this draft.", related=(958, 763))
pr(661, "discuss", reason="Eoghan's 2021 PR renames packages/rrweb-player to rrweb-playback-ui across 29 files. It carries the upstream 3.0 label, Eoghan parked it in 2021 and called it a nice-to-have in 2025, and Justin proposed a different target (packages/playback-ui, @rrweb/playback-ui) on 2026-05-13. The current diff cannot land; the open question is the package name for the 3.0 layout.", next_step="Team meeting: pick the player package name for 3.0; Eoghan then closes this and opens a fresh rename.")
pr(294, "discuss", reason="Eoghan's 2020 PR makes rrweb record window.top when loaded inside a same-origin iframe. The design question (default to the top window, or let the caller pick a window as 1023 proposes) was raised in 2022 and Eoghan said in 2023 both would be good; nobody decided. Branch is CONFLICTING and a user asked for a decision on 2026-06-10.", next_step="Team meeting: pick between 294 (default to top) and 1023 (caller-supplied window), then Eoghan rebases the winner.", tags=("impacts-privacy",), related=(1023,))

# --- Request clean-up: the author owes something before review ----------
pr(1983, "cleanup", reason="Adds opt-in smoothCursor (per-frame spline interpolation) and smoothScroll (frame interpolation and re-applied scroll positions) to the replayer, 677 lines with unit and puppeteer tests. Eoghan requested changes on 2026-11-05: smooth.ts is too tightly coupled to play(), it should hook replayer events, and scroll tracking alone would make a better first PR. The author has not answered yet. A CI workflow commit is mixed in.", next_step="Author: split out scroll tracking as a first PR, move the hooks onto replayer events, and drop the unrelated workflow commit.", message="Thanks for the instant-scroll fix. Eoghan's suggestion on 2026-11-05 is the open point: translate the mouse-trail canvas with the document as a layer before drawing, which may let this PR shed some of its own scroll handling. A reply on whether that works for you is enough to pick the review back up.")
pr(1975, "cleanup", reason="Justin's follow-up to 1971 scopes recorder teardown per document and per recording: iframe unload cleanup, idempotent stop handlers, Safari constructor leases, cancellation of deferred iframe loads, canvas loop cancellation and shadow root rebinding. It was stacked on the fix/recorder-memory-leaks branch, which merged as 1971 on 2026-10-24, and is now CONFLICTING; Eoghan noted on 2026-10-24 that two of its commits already landed in 1971. A user measured on 2026-10-29 that 2.2.0 still grows about 300 ms per iframe navigation and this branch keeps it flat.", next_step="Justin: retarget to main and rebase out the two fixes that landed in 1971, then hand to Eoghan for review.", tags=("commercial",), message="#1971 merged on 2026-10-24 with two of these fixes. A rebase onto main and a changeset would make the rest reviewable; the onceIframeLoaded listener growth reported on 2026-10-29 looks like the first thing to keep.")
pr(1974, "cleanup", reason="Justin's script that adds matching @rrweb/record and @rrweb/replay changeset entries when rrweb record or replay sources change, plus a CI check. Eoghan requested changes on 2026-10-24 with a concrete suggestion to also map rrweb-snapshot's snapshot and rebuild files; Justin has not responded.", next_step="Justin: apply Eoghan's 2026-10-24 file-mapping suggestion and re-request review.", message="Eoghan's note from 2026-10-24 is the blocker: edits under record/ and replay/ also change the material output of record.js and replay.js, so the path mapping alone does not decide the wrapper bump. Address that or close.")
pr(1954, "cleanup", reason="Public external timeline-marker API for rrweb-player, +3393/-185 across 45 files including browser-client changes. It was stacked on 1928, which merged 2026-10-15; the branch still carries 53 commits. Eoghan asked on 2026-10-20 whether it should be rebased or closed and raised naming of the nested type field; no reply.", next_step="Justin: rebase onto main so only the marker API remains, answer Eoghan's naming point, then request review.", tags=("commercial",), message="Does this build on #1928 now that it's merged, or does #1928 cover it? If it still adds something, a rebase onto current `main` would let us review it.")
pr(1907, "cleanup", reason="Eoghan's refactor of the replay mutation DOMException catch from 620: extends the protection to rrdom errors and to appendChild. Three files with a changeset and no tests by design. CONFLICTING against main's replay/index.ts and unreviewed since 2026-07-18.", next_step="Eoghan: rebase onto main; then Justin reviews.")
pr(1905, "cleanup", reason="Skips setting srcdoc when rebuilding an iframe so the browser's own load does not race rrweb's reconstruction (issue 1736). Eoghan requested changes on 2026-09-08 after the author's last push: when a sandboxed iframe has no contentDocument, srcdoc is the only content we have and dropping it loses the frame. No reply. Also carries two duplicate changesets.", next_step="Author: keep srcdoc when the iframe has no recorded child document, drop the duplicate changeset, and reply to Eoghan.", related=(1736,), message="Thanks for picking this up. Eoghan's note above is the blocker: a sandboxed iframe without `allow-same-origin` has no `contentDocument`, so `srcdoc` is the only copy we have. Could you only drop `srcdoc` when `sandbox` is absent or includes `allow-same-origin`? Blanking it at record time, as Eoghan suggests, would also save storing the document twice.")
pr(1877, "cleanup", reason="Eoghan's docs-only PR collapses repeated empty dependency-bump entries in eight CHANGELOGs. The 2.2.0 release on 2026-10-24 rewrote those files, so the branch is CONFLICTING, and Eoghan's own body says the clean-up is not important after the fact.", next_step="Eoghan: rebase if still wanted, otherwise close.", tags=("maintainer-close",))
pr(1856, "cleanup", reason="Adds tracelane and peek to the README user list. Justin applied a suggestion on 2026-09-08 and asked for a logo mark with the name, sized like the others; the author applied the suggestion but has not answered the logo request.", next_step="Author: replace the square logos with wordmarks sized like the others.", message="Hi @harry-harish, Justin asked on 2026-09-08 for a logo mark with the project name on it, sized like the other logos in the list (the square one shows very large). Could you update the images? Then this can go in.")
pr(1839, "cleanup", reason="Justin's codex refactor splitting rrweb-snapshot utils.ts into shared, snapshot and rebuild modules with a compatibility shim. On 2026-05-20 Justin and Eoghan decided to defer it until the backlog of PRs touching utils.ts is cleared; Eoghan's 2026-06-05 checklist still has nine open PRs on that file. Copilot also flagged that the CSSImportRule type stops being exported.", next_step="Justin: rebase once the utils.ts PRs in Eoghan's 2026-06-05 list are merged or closed, and keep the CSSImportRule export.", related=(1735, 1733, 1686, 1586, 1483, 1475, 1356, 1164, 1097))
pr(1814, "cleanup", reason="Routes rrweb's on() helper through untainted EventTarget add/removeEventListener so monkey-patched frameworks cannot intercept it; main's utils still lack EventTarget support. Justin requested changes on 2026-09-08 and the author addressed them on 2026-10-02, but Justin's prettier suggestions (2026-10-23) and Eoghan's changeset fix (2026-11-06) are unapplied and Format Check fails.", next_step="Author: apply the three pending suggestions so Format Check passes; then Justin merges.", tags=("posthog-backed",), downstream="PostHog's own PR. In their fork.", message="This is close. Three suggestions are still unapplied: Justin's two prettier fixes from 2026-10-23 and Eoghan's changeset fix from 2026-11-06, and Format Check fails on them. Once those are in, Justin can merge.")
pr(1811, "cleanup", reason="Justin's CI change runs changeset status in the eslint and release workflows and bumps @changesets/cli. main already has @changesets/cli ^2.31.0, so the lockfile part is stale and the branch conflicts. The workflow fetches origin master, but the default branch is now main and on fork PRs origin is the fork (Copilot flagged this on 2026-06-01).", next_step="Justin: rebase, drop the lockfile bump, and fetch main from the upstream repo before running changeset status.")
pr(1790, "cleanup", reason="Justin's docs PR adds a 2,900-line privacy guide in English and Chinese and links it from guide.md; the description says it was vibe-documented and not verified. Copilot's 2026-02-13 review found factual errors (ignoreCSSAttributes example uses data-* attributes that can never match, type described as array, broken ../guide.md links, misleading timing example) that are still unaddressed. The privacy policy API work will also change what this guide should say.", next_step="Justin: fix the ignoreCSSAttributes examples and broken links, or park the guide until the privacy-at-capture API settles.")
pr(1766, "cleanup", reason="Adds a csp player option that sets the csp attribute on the replay iframe. That attribute is Chrome-only and gives a false sense of security elsewhere. Justin asked on 2026-01-02 for documentation of the limitation and guide entries; no reply in ten months. No test, and the branch conflicts.", next_step="Author: document browser support in guide.md and the player readme, add a test, and rebase; otherwise close.", downstream="LaunchDarkly rrweb 36 shipped cspContent as a meta CSP on rebuild — same product need, not this PR’s iframe attribute.")
pr(1737, "cleanup", reason="One-line optional chaining on image.currentSrc in rebuild, which is undefined in virtual DOM mode and still crashes on main. Eoghan asked on 2025-09-17 for a test reproducing the scenario; the author only replied that virtual DOM mode triggers it (2025-09-30) and added no test.", next_step="Author: add the virtual-DOM rebuild test Eoghan asked for on 2025-09-17; then Eoghan merges.", tags=("posthog-backed",), downstream="On PostHog planned batch-2 stability list. Never executed as a later port.", message="Thanks for the fix. Could you add a test that rebuilds an img with rr_dataURL in virtual DOM mode (useVirtualDom) so the undefined currentSrc case is covered? With that, this can go in.")
pr(1711, "cleanup", reason="Makes rebuild insert a DocumentType node before an existing root element instead of appending it, with a unit test and changeset, to avoid HierarchyRequestError during replay. Eoghan asked on 2025-07-04 whether the out-of-order doctype in the test is a real recording or synthetic, since the real fix might belong at record time; the author never answered.", next_step="Author: answer Eoghan's 2025-07-04 question with a real recording or the record-time cause.", tags=("posthog-backed",), downstream="Already in PostHog's fork.")
pr(1676, "cleanup", reason="No description. The diff bundles four unrelated changes: treating <frame> like <iframe> in snapshot, mutation and replay; a new public replayEvent(index) API plus a FlushEnd emitter event; skipping the sandbox attribute when rebuilding iframes; and the 1624 document-append workaround. Labelled testcase needed; Eoghan asked for tests on 2025-09-17 and the author has not answered.", next_step="Author: split into one PR per change with a test and changeset each, starting with <frame> support.", related=(1624, 1720))
pr(1638, "cleanup", reason="Changes movedSet handling in the recorder so a moved node whose parent is in addedSet is not skipped, and makes the replayer keep resolve trees whose parent id is about to be added in the same batch. The title says tests will be added later and none were; the replay helper recomputes the full id set once per tree inside the loop. 1652 (merged 2026-09-17) and 1988 rework the same addedSet code, so the recorder change needs re-checking on main.", next_step="Author: rebase onto main, add a test that reproduces the missing-parent case, and compute the id set once per batch.", related=(1988,))
pr(1635, "cleanup", reason="Changes the Chrome blank-frame check in onceIframeLoaded so iframes whose custom elements are defined in the body get serialised; main still has the old condition. The 10-line change also drops the src === '' branch and gates on readyState, with only videos as evidence and no test. Changeset marks rrweb-snapshot as minor for a fix.", next_step="Author: add a snapshot test for an iframe that defines a custom element in its body, explain the dropped src === '' case, and make the changeset a patch.", tags=("posthog-nudge",), downstream="On PostHog's own open-PR nudge list.", message="Thanks for the fix. Could you add a test (an iframe that defines a custom element in its body) so we can see the case it fixes, note why the src === '' branch can go, and change the changeset to a patch?")
pr(1624, "cleanup", reason="Replayer workaround that skips appending a #document node to a parent that is not an iframe, which otherwise throws and blanks the replay (#1414, #1619). Yun said on 2025-01-15 the workaround looked fine and asked for a changeset (added) and the underlying scenario. Eoghan asked on 2025-02-04 for a recording that reproduces it, since the PR may hide a wrong parent id. No reply since. The same author re-includes this change in 1676.", next_step="Author: share a recording that reproduces the crash so Eoghan can judge whether the parent id is wrong on the record side.", related=(1414, 1619, 1676))
pr(1483, "cleanup", reason="Eoghan's 2024 draft generalising link rel=stylesheet mutation handling and fixing stylesheet href updates, built on 1437 (merged 2024-08-06). No commits since 2024-05-22, still draft, and it is one of the PRs Eoghan listed on 2026-06-05 as touching rrweb-snapshot utils.ts and blocking 1839. It needs a rebase onto 2.2 before anyone can review it.", next_step="Eoghan: rebase onto main and mark ready, or close it in favour of 1475.", related=(1475, 1839))
pr(1469, "cleanup", reason="Wraps createImageBitmap in callbackWrapper so a throwing bitmap goes to errorHandler instead of an unhandled rejection. Eoghan asked on 2024-05-03 whether the CI failure was related; no answer in two years. main still awaits createImageBitmap bare, so the fix is still relevant.", next_step="Author: rebase, confirm the test failure is unrelated, and add a changeset.", tags=("posthog-nudge",), downstream="On PostHog 3765 adopt-high; confirm still open and still wanted.")
pr(1465, "cleanup", reason="Parent frame posts a message to cross-origin child iframes so they take a full snapshot whenever the parent does. Eoghan requested changes on 2024-05-09 (duplicate snapshot risk, needs tests), Justin asked for a test on 2024-07-25, and the author said on 2024-08-01 the tests were still to be written. Labelled testcase needed; nothing since.", next_step="Author: add the cross-origin iframe test Justin described on 2024-07-25 and re-request review.", message="Eoghan's 2024-05-09 review and Justin's 2024-07-25 note still stand: this needs a test for a cross-origin child iframe re-snapshotting when the parent does, and a guard against double snapshots. If you can add that we will pick the review back up; otherwise we will close it and you can reopen with the test.")
pr(1439, "cleanup", reason="Changes throttle() to shallow-copy event args and clear a one-shot timeout, claiming scroll targets are lost on mobile smooth scrolling. Eoghan asked three times (2024-04-09 and 04-11) why the transformation is needed when the closure already holds args; the last question was never answered. The spread copies an Event into a plain object, which drops its prototype, and there is no test.", next_step="Author: explain the failing scenario with a reproduction and a test, or close.")
pr(1428, "cleanup", reason="Records canvas elements inside same-origin iframes and shadow DOM, with sampling all mode, ShadowDomManager integration and tests; resolves open issues 1081 and 1412 and is the most complete of three attempts (1413 and 1235 are the others). Only a community approval (okejminja, 2024-09-05); Justin is assigned but has not reviewed, users asked for progress in November 2024, and the author has been silent since April 2024. The 2.2.0 canvas manager rewrite and Justin's draft 1927 (iframe canvas drawImage) mean it needs a rebase before review.", next_step="Justin: decide whether to rebase 1428 onto the 2.2.0 canvas manager yourself or ask the author, and close 1413 and 1235 in its favour.", related=(1413, 1235, 1927, 1081, 1412))
pr(1357, "cleanup", reason="Fixes CSSStyleSheet.insertRule() styles being lost when the rrdom diff moves a style element (issue 1344). Eoghan requested changes on 2024-05-08: the branch picked up unrelated commits and eslint fails. The author promised a clean branch but never pushed it, and billyvg reported a differ perf regression from innerText reflow (2025-01-06). Yun was asked to judge the rrdom approach and has not.", next_step="Author: push a clean branch with only the insertBefore fix, switch innerText to textContent, then ask Yun to review the rrdom approach.", related=(1344,), message="Thanks for sticking with this. To get it reviewable: push a branch with only the insertBefore fix (Eoghan's 2024-05-08 request), switch innerText to textContent so the differ does not reflow (billyvg's 2025-01-06 regression), and then Yun can look at the rrdom approach.")
pr(1356, "cleanup", reason="Routes setTimeout, addEventListener and requestAnimationFrame in record code to the pre-zone.js natives so Angular change detection does not loop at 100 percent CPU. Justin requested changes on 2023-12-01 asking for a guard against future accidental use of the patched setTimeout; the author answered on 2023-12-05 with renames and fixes but no guard, and added an rAF commit in May 2024. Since then 1328 removed the rAF loop, 1971 rewrote observer.ts and the managers, and 1633 (merged 2026-10-26) added a Zone.__symbol__ helper in @rrweb/utils that this should reuse, so the branch needs a rebuild before a re-review is useful.", next_step="Author: rebase onto 2.2.0, drop the rAF commit, and build on the angularZoneUnpatchedAlternative helper from 1633.", tags=("posthog-declined",), downstream="PostHog declined: they have their own Zone path.", message="Justin's 2023-12-01 request for a guard against accidental use of the patched setTimeout is still open. Since then #1633 landed an angularZoneUnpatchedAlternative helper; please rebase onto 2.2.0, drop the rAF commit, and build on that helper so the two approaches do not diverge.")
pr(1336, "cleanup", reason="Lets callers pass fflate ZlibOptions to pack() to control compression level (issue 1335, open), with a test. The patch targets packages/rrweb/src/packer, but the packer now lives in packages/packer and PackFn is exported from @rrweb/types, so the PR has to be redone against the new layout and needs a changeset.", next_step="Author: redo the change against packages/packer and the PackFn type in @rrweb/types, add a changeset.", related=(1335,), message="Thanks, the idea is fine. The packer moved to packages/packer and PackFn now lives in @rrweb/types, so could you redo the change there, keep the test, and add a changeset?")
pr(1313, "cleanup", reason="Guards hookSetter against re-hooking the same property with a __hooked__ marker, for open issue 731 (too much recursion). Eoghan asked on 2023-10-06 to use an rrweb-branded marker name like __rrHooked and the author never replied. Main's hookSetter is unchanged, so the fix is still relevant and the branch is MERGEABLE.", next_step="Author: rename the marker as Eoghan asked on 2023-10-06, restore the deleted comment, add a changeset; then Eoghan reviews.", downstream="PostHog batch-2 candidate; no later production write-up.", related=(731,))
pr(1212, "cleanup", reason="Adds customMaskTextRule, an array of selector plus maskFn pairs that takes priority over maskTextSelector and maskTextFn. Eoghan asked on 2023-10-13 whether merged 1310 (maskTextFn receives the element) already covers the need; no reply in three years. It is also a new masking knob that overlaps the privacy policy work. Branch conflicts.", next_step="Author: say whether 1310 covers the use case; otherwise fold the request into the privacy policy discussion and close this.", tags=("privacy-overlap",))
pr(1140, "cleanup", reason="Eoghan's 2023 replayer change to render the full snapshot synchronously when scrubbing to time zero, with three changesets. Justin said on 2023-03-03 it looked good once tests pass; Eoghan's last push on 2023-04-13 adjusted expected event counts and asked whether that was right. No activity since and the branch is three years behind main.", next_step="Eoghan: rebase onto main and settle the replayer test expectations, or close if the scrub-to-zero behaviour is no longer wanted.")
pr(815, "cleanup", reason="Makes setConfig({skipInactive: true}) start fast-forwarding immediately instead of waiting for the next incremental event. Labelled testcase needed; Justin asked on 2022-03-13 for a failing test and the author never answered. main's setConfig still lacks this, so the idea is alive but the PR owes a test and a rebase.", next_step="Author: add a failing-then-passing test and rebase, or the team closes it.", message="Hi @troglotit, Justin asked in March 2022 for a test that fails before this change and passes after it. If you still want this in, could you add that test and rebase onto main? Otherwise we will close it.")
pr(768, "cleanup", reason="Absolutifies url() values inside per-property style mutations (the styleDiff path), which main still emits raw. Eoghan requested changes on 2022-02-22 (call absoluteToStylesheet directly, drop the binary test images) and the author never answered. Assigned to Eoghan; branch is CONFLICTING against the rewritten mutation.ts.", next_step="Author: rebase onto main, apply Eoghan's 2022-02-22 review (absoluteToStylesheet on newValue, remove the PNG fixtures), then Eoghan re-reviews.", message="Eoghan's review still stands and the branch is years behind main. If you want to keep this, please rebase it onto the current transform utilities; otherwise we will close it and you can open a fresh PR.")

# --- Reject with explanation --------------------------------------------
pr(1963, "reject", reason="Justin's draft from 2026-10-15 unregisters each mutation buffer by identity on stop and stores a checkout timestamp instead of the full snapshot event. 1971 merged on 2026-10-24 and main now keeps mutationBuffers as a Set that each observer deletes itself from, so the core fix landed; the branch conflicts. Only the lastFullSnapshotEvent retention and the heap regression test are not on main.", next_step="Justin: close; re-cut the checkout timestamp change and stop-memory test as a small PR if the retention still shows up.", tags=("maintainer-close",))
pr(1879, "reject", reason="Fixes the rrweb-player dist bundling Svelte SSR stubs (#1872). That issue was closed on 2026-07-16 by 1901 (vite config change), so this is superseded.", next_step="Justin: close as superseded by 1901.")
pr(1873, "reject", reason="Adds an attributeFilter record option passed straight to MutationObserver.observe to skip style attribute churn. Eoghan said on 2026-09-21 he is leaning wontfix because a filter hides newly added attributes and is hard to document safely, and pointed to 1933 (collapsing throttled style mutations, open) as the fix for the underlying cost. No wontfix label yet and the author has not replied.", next_step="Eoghan: close as wontfix pointing at 1933, or label it so.", tags=("posthog-shipped",), downstream="Shipped posthog-js 4129. At port time: shadow roots were not filtered; empty [] observed no attributes. No later attributeFilter bugfix.", related=(1933,), message="Thanks for the detailed numbers. We're leaning towards not adding attributeFilter as a record option: any filter stops us seeing newly added attributes, and that gap is hard to document safely. Could you try #1933's per-element throttling on your noisiest site and share CPU numbers? If that covers your case we'll close this one.")
pr(1798, "reject", reason="Guards MediaInteraction replay against non AUDIO/VIDEO targets (lottie player pause). Duplicate of Justin's 1462 and covered by 1673, merged 2026-10-26, which wraps play/pause in try/catch so the replay no longer throws. Verified 2026-11-06: main's record handler drops non-media targets and the replayer catches play/pause errors, so this guard would only change a warning into a debug message.", next_step="Justin: close pointing at 1673.", downstream="Mixpanel rrweb 10 cites this PR as the upstream they shipped.", related=(1462,), message="Closing: #1673 merged on 2026-10-26 and makes the replayer safe against play/pause on a non-media target, and #1688 carries the record-side guard. Thanks for the report and the patch.")
pr(1768, "reject", reason="Copilot sub-PR of 1762 that makes the rrvideo replay timeout scale with event duration and playback speed. 1762 merged on 2026-02-06 and main's rrvideo already computes expectedPlaybackTime plus a two-minute buffer, so this is landed. Branch is CONFLICTING and carries 27 files of stale 1762 history.", next_step="Justin: close as already merged via 1762.")
pr(1726, "reject", reason="Adds an emitFromIframe flag so a middle iframe can emit locally while collecting from child iframes. Proof of concept with no tests; pauldambra and Justin (2025-09-05) asked for tests and were unsure about the flag and naming. 1991 replaces the single switch with collectFromOrigins and emitToOrigin, which covers this nested case with origin scoping. Verified 2026-11-06: under 1991 a middle frame that sets collectFromOrigins without emitToOrigin emits locally and collects from its children, which is exactly this flag's case.", next_step="Justin: close pointing the author to 1991 and ask them to confirm it covers the host-without-rrweb case.", related=(1991,))
pr(1722, "reject", reason="Rewrites the dev-only repl.js injection with a single debounced timer across all frames, a fixed one-second sleep, and adds --disable-web-security to the repl browser. The shared debounce drops injection into child frames, which the script exists to record, and the description is Chinese-only with no motivating bug. No maintainer response since 2025-08.", next_step="Eoghan: close; invite a narrower PR if a specific repl failure can be shown.")
pr(1709, "reject", reason="Renames the guide's install sections to Option 1/2 and tells readers to fall back to the rrweb@1.1.3 CDN build because the 2.x links did not work. Eoghan noted on 2025-06-26 that the guide would be fixed by 1704 (umd folder), which merged 2026-02-13 and restored the CDN paths, so the fallback advice is now wrong.", next_step="Eoghan: close with a note that 1704 fixed the CDN links.")
pr(1688, "reject", reason="Guards MediaInteraction replay against non-media targets and skips blocked media elements. Eoghan said on 2026-10-26 that 1673 covers the replay crash and 1673 merged the same day with try/catch around pause and play in the media manager. He routed the remaining idea (not emitting media events for blocked elements) to the blockClass/blockSelector work. Verified 2026-11-06: main's record handler already drops events whose target is not an HTMLMediaElement, and the replayer wraps play and pause in try/catch, so both halves are covered.", next_step="Eoghan: close with thanks, pointing to merged 1673 and the blocking work for the blocked-media case.", tags=("posthog-backed",), downstream="Already in PostHog's fork. Mixpanel shipped the same MediaInteraction guard (their write-up cites 1798).")
pr(1681, "reject", reason="Rewrites the postcss-hover-classes plugin to prefilter :hover selectors and use a WeakSet, claiming to fix the regex-too-large error in issue 1675. Eoghan reviewed on 2026-10-25, could not reproduce any improvement on the included test or the 1675 example, said 1480 is the better fix because it avoids postcss and regex entirely, and said he will close; the author acknowledged on 2026-10-26.", next_step="Eoghan: close as announced, pointing to 1480.", related=(1480, 1675), message="As Eoghan noted on 2026-10-25, we could not reproduce an improvement with this change on either test case, and #1480 removes the regex path entirely. Closing unless you can share a reproducible example where this helps.")
pr(1653, "reject", reason="Eoghan's bridging refactor between 1543 and 1652 that drops isParentRemoved in favour of direct Set lookups. 1652 merged 2026-09-17 and main already does removesSubTreeCache.has(parentNode) directly, so nothing is left.", next_step="Eoghan: close.", tags=("maintainer-close",))
pr(1616, "reject", reason="Draft utility to merge events within a time window for #1560. Eoghan said on 2025-02-06 that it does not solve #1560 and that he plans a record-time mutation rate limit instead. No author reply since.", next_step="Eoghan: close with a pointer to the rate-limit plan.", related=(1560,))
pr(1610, "reject", reason="Adds hidden: true to the maskAllInputs preset and a hidden key to MaskInputOptions, for issue 1609 (labeled bug and privacy). No maintainer has commented. The change is one line each in snapshot and record plus stale 2024 snapshot files, no changeset, and no test asserting the value is masked. Whether maskAllInputs should cover hidden inputs by default belongs with the privacy policy work.", next_step="Close in favor of 1745, the byte-identical resubmission with fresh CI.", tags=("strengthens-privacy",), related=(1745, 1609))
pr(1534, "reject", reason="Eoghan's 2024 speculative draft wraps record in packages/record to remember the options and exports a public isBlocked(node) built on them. The diff calls utils.isBlocked without importing utils, so it does not compile as-is, and Eoghan himself questioned whether record.utils should be exposed at all. Whether and how to expose a blocking predicate belongs to the privacy policy API design.", next_step="Eoghan: close the draft and carry the public isBlocked requirement into the privacy-at-capture API discussion.", tags=("privacy-overlap", "maintainer-close"))
pr(1477, "reject", reason="Draft adding a husky pre-commit hook that runs prettier on staged files, plus an unrelated yarn.lock change. Justin asked on 2024-05-16 why not lint-staged and Eoghan said on 2024-05-20 to try that first. Nothing since; main has no husky hook at all.", next_step="Eoghan: close. Redo as a lint-staged setup if still wanted.", tags=("maintainer-close",))
pr(1466, "reject", reason="Eoghan's 2024 draft adds one integration test showing absoluteToDoc follows history.replaceState, and exports absoluteToDoc from rrweb-snapshot only so the test can call it. It was prompted by a suspected bug that could not be reproduced, Eoghan said there is no rush, and nothing has moved since 2024-05-02. A public export added for a test of a non-bug is not worth carrying.", next_step="Eoghan: close the draft.", tags=("maintainer-close",))
pr(1462, "reject", reason="Justin's guard in MediaManager.mediaMutation to skip non AUDIO/VIDEO targets ('pause is not a function'). 1673 merged 2026-10-26 wraps play/pause in try/catch in the same manager, so the replay no longer throws for this case. Also duplicated by 1798. Verified 2026-11-06: main guards the record side (instanceof HTMLMediaElement) and the replay side (try/catch).", next_step="Justin: close as covered by 1673.", tags=("maintainer-close", "posthog-in-fork"), downstream="In PostHog fork — do not adopt from that fact.", related=(1798,), message="Closing: #1673 merged on 2026-10-26 and covers this.")
pr(1448, "reject", reason="Adds an rrweb-worker package to escape rollup-plugin-web-worker-loader bugs. The build moved to Vite and the canvas worker is now imported with ?worker&inline (PR 1762, merged 2026-02-06), so the rollup loader this works around is gone. Branch is CONFLICTING.", next_step="Eoghan: close as superseded by the Vite worker build (1762); ask the author to reopen issues 1376/1377 only if they still reproduce on 2.x.", related=(1376, 1377))
pr(1416, "reject", reason="Adds a playerClassName prop and height:100% styles to rrweb-player. Yun asked on 2024-02-26 for the use case, docs and a changeset; the author never answered. Labelled waiting-for-more-info.", next_step="Close. Yun's 2024-02-26 questions went unanswered for two years.")
pr(1413, "reject", reason="Fixes open issue #1412: the canvas manager's rAF snapshotter only finds canvases with document.querySelectorAll, so canvases inside shadow roots are never captured. The PR walks every element's shadowRoot recursively. Main still has the document-only lookup, so nothing merged covers it. No test, no changeset, and the querySelectorAll('*') walk runs on every snapshot tick. Verified 2026-11-06: 1428 finds shadow-root canvases through the ShadowDomManager and iframe canvases through addWindow, with tests; this PR walks every element each tick and has no test.", next_step="Close in favor of 1428, which covers canvases in iframes and shadow roots together.", tags=("posthog-in-fork",), downstream="In PostHog fork — do not adopt from that fact.", related=(1428, 1235))
pr(1302, "reject", reason="Re-inserts nodes into addedSet to fix emit order for shuffled addLists. mdellanoce showed a performance regression on jstree-style mutations (2023-10-27) and the author moved it to draft saying the approach is not optimal (2023-10-30). The linear-time alternative lives in 1300, which the thread treats as the follow-up. Eoghan's 2025-02-04 question about 1277 went unanswered. Verified 2026-11-06: 1652's merged description names this PR as the prior attempt at the case it solves.", next_step="Eoghan: close; 1652 (merged 2026-09-17) covers the ordering case and 1300 closes with it.", tags=("posthog-shipped",), downstream="Shipped posthog-js 4130. They almost diverged to Set.delete; reverted to upstream has→delete→add. Later 4697: empty-payload early return skips addedSet/droppedSet reset — still present here.", message="Closing: #1652 merged on 2026-09-17 and reworked addedSet iteration for exactly these shuffled addList cases, and this branch had a measured regression on jstree-style mutations. Thanks for pushing on it; the benchmark fixtures would still be welcome as a separate PR if they show a gap on 2.2.x.")
pr(1300, "reject", reason="Draft from 2023 that adds two mutation benchmarks and a naive extra pass over addList to fix N squared worst-case recording cost for shuffled node insertions. Eoghan's 1652, merged 2026-09-17, refactored addedSet iteration specifically to solve those pathological addList cases and cites 1302 as a prior attempt. The fix here is superseded; the benchmark HTML fixtures may still be worth having on their own. Verified 2026-11-06: 1652's merged description names the repeated pushAdd onto the secondary addList as the pathological case it solves and lists 1302 as the prior attempt.", next_step="Eoghan: close with a pointer to 1652; invite the author to resubmit just the two benchmark fixtures if they still show a gap.", message="Closing: #1652 merged on 2026-09-17 and solves the pathological addList ordering this targeted. If the two benchmark fixtures still show a gap on 2.2.x, please resubmit just those.")
pr(1256, "reject", reason="Adds recordSafeCrossOrigin as the postMessage target origin for child iframes (#1190). Yun left doc suggestions on 2023-08-04 and nothing since. 1679 does the same thing and 1991 goes further with origin scoping on both send and receive sides, so this is superseded.", next_step="Eoghan: close pointing at 1991 (or 1679) once the team picks one.", tags=("strengthens-privacy",), related=(1991, 1679, 1190))
pr(1235, "reject", reason="Bundles three unrelated changes: canvas capture inside iframe shadow DOM (tracking roots with WeakRef), a mouseCursor replayer option, and rrweb-player width/height props. No tests, no changeset, tsconfig lib edits, and the branch is CONFLICTING since 2023. Main's canvas manager still has no shadow DOM or iframe awareness, so the first part may still be a real gap. Verified 2026-11-06: 1428 covers both the iframe and the shadow DOM canvas cases with tests.", next_step="Close in favor of 1428. The shadow DOM canvas part is covered there; the player and cursor changes do not belong in this PR.", related=(1428, 1413))
pr(1046, "reject", reason="Justin's 2022 draft streams video elements (blob: and srcObject) over WebRTC via the canvas-webrtc plugin. Most of its commits (cross-origin iframe recording) merged separately long ago; what is left is a 41-file CONFLICTING draft untouched since 2024-04-08, when Justin said it is still wanted for live-stream bandwidth.", next_step="Justin: close this draft, and if video streaming is still wanted restart it as a small change to rrweb-plugin-canvas-webrtc.", tags=("impacts-privacy", "commercial", "maintainer-close"))
pr(1015, "reject", reason="Eoghan's 2022 draft splits window monkeypatching (canvas and webgl hooks) into an early-loading rrweb-init.js that talks to rrweb over postMessage, for extension injection at document_start. It patches packages/rrweb/rollup.config.js, which no longer exists since the Vite migration, and the canvas manager was rewritten in 2.2.0. The last discussion was in January 2023 with open design questions on the communication layer and node addressing.", next_step="Eoghan: close the draft and file an issue for the extension early-injection design if it is still wanted.", tags=("maintainer-close", "commercial"))
pr(863, "reject", reason="2022 PR adding puppeteer scripts to rrweb-snapshot for saving and viewing snapshots. Justin and Yuyz0112 asked for repl-style packaging in 2022; on 2024-04-18 the author said they no longer use rrweb, will not continue, and the team is free to close.", next_step="Justin: close with thanks; nobody picked the scripts up.")
pr(724, "reject", reason="Eoghan's 2021 PR passes the iframe id through onIframeLoad because the __sn DOM attribute was vanishing. rrweb no longer stores ids on the DOM, the original scenario is gone, and Justin proposed closing it until it recurs with a test (2024-04-08). Eoghan agreed the cause is unknown (2024-04-05).", next_step="Eoghan: close; reopen with a test case if the iframe id ever goes missing again.", tags=("maintainer-close", "posthog-in-fork"), downstream="In PostHog fork — do not adopt from that fact. We already reject.")
pr(549, "reject", reason="2021 PR adding a setMetaDataSubscriber hook to the replayer so live-mode addEvent callers can watch totalTime change. It targets the pre-monorepo src/ layout. Eoghan asked on 2024-04-05 whether the use case still stands and whether liveMode covers it; the author never replied and the PR carries the waiting-for-more-info label.", next_step="Eoghan: close; callers can re-read getMetaData() after addEvent, and the branch cannot be rebased onto the monorepo.")
pr(389, "reject", reason="2020 PR against the pre-monorepo src/record/index.ts that adds record.stop(cleanup) to wipe the mirror. Justin approved it on 2021-07-07 and then noted on 2022-08-19 that the mirror refactor broke it. The file no longer exists and the 2.2.0 teardown rewrite (1971, merged) covers recorder cleanup.", next_step="Eoghan: close.", tags=("maintainer-close",))


ISSUE: dict[int, dict] = {}


def issue(
    number: int,
    triage: str,
    *,
    reason: str,
    next_step: str,
    notes: str = "",
    tags: tuple[str, ...] = (),
    downstream: str = "",
    related: tuple[int, ...] = (),
    message: str = "",
) -> None:
    ISSUE[number] = {
        "triage": triage,
        "reason": reason,
        "notes": notes,
        "next": next_step,
        "tags": list(tags),
        "downstream": downstream,
        "related": list(related),
        "message": message,
    }


issue(1736, "adopt", reason="PR 1905 fixes it once Eoghan's sandbox change is in.", next_step="Close when 1905 merges.", tags=("strengthens-privacy",), related=(1905,))
issue(1609, "adopt", reason="Hidden-input leak, labeled bug and privacy. PR 1745 adds hidden to maskAllInputs; Eoghan (2026-10-27) wants hidden masked even without maskAllInputs. 1610 is the same patch, older.", next_step="drakonen: land 1745 after Eoghan settles the scope, close 1610, then close this.", tags=("strengthens-privacy",), related=(1745, 1610))
issue(1315, "review", reason="PR 1771 (merged 2026-09-08) turns autocomplete off during replay. Eoghan (2026-10-23) still wants the recorded attribute renamed to rr_autocomplete or dropped. PR 2004 (2026-11-05) keeps autocomplete off when a replayed attribute mutation sets it.", next_step="Eoghan: merge 2004, then decide whether the record-side rr_autocomplete rename is still wanted before closing.", tags=("strengthens-privacy",), related=(2004,), message="#1771 stops the replayer's browser offering autofill, and #2004 keeps it off when a recorded attribute change would re-enable it. What remains is whether we also record `autocomplete` as `rr_autocomplete` so replay never sees the original attribute.")
issue(1680, "discuss", reason="Cross-origin iframe origins. Eoghan's 1991 and community 1800 both add the parent-side allowlist; 1679 covers only the child side. One trust model to pick.", next_step="Team meeting: pick 1991, 1800 or 1679, land it, then close.", tags=("strengthens-privacy",), related=(1991, 1800, 1679))
issue(1675, "review", reason=":hover regex overflow. Eoghan took it on 2026-10-25: 1681 did not improve either test case, and his draft 1480 avoids the regex entirely.", next_step="Eoghan: finish 1480, then close this and 1681.", related=(1480, 1681), message="Eoghan is on this. #1681 did not reproduce an improvement in his tests; #1480 removes the regex path and is the planned fix.")
issue(1734, "review", reason="Empty CSS declarations (border-top-style: ;) still break replay with CssSyntaxError. PR 1735 strips them with a regex; Eoghan (2025-09-15) says his 1322 approach fixes the same thing.", next_step="Eoghan: pick 1735 or the 1322 approach, land it, then close.", related=(1735, 1322, 1692))
issue(1692, "review", reason="CSS splitting corrupted stylesheets. 1948 fixed the split points and 1906/1931 added regression tests; Eoghan is assigned and the issue is still open, so a confirmation on 2.2.x is missing.", next_step="Eoghan: confirm it no longer reproduces on 2.2.x, then close; otherwise decide with 1734.", related=(1734, 1735))
issue(874, "adopt", reason="Has PR 1097. Same masking hole as 1385/1488.", next_step="drakonen: keep open until the masking discussion lands.", tags=("strengthens-privacy",), related=(1097, 1385, 1488))

issue(1955, "adopt", reason="blob: urls in CSS url() recorded as broken relative paths. PR 1956.", next_step="Merge PR 1956, then close.", related=(1956,))
issue(1942, "adopt", reason="Network fallback drops status and timing. PR 1962.", next_step="Merge PR 1962, then close.", related=(1962,))
issue(1937, "adopt", reason="rebuild() strips attributes from <img> with srcset. PR 1938. Justin expects the 1475 image rework to cover it too.", next_step="Merge PR 1938, then close.", related=(1938, 1475))
issue(1925, "review", reason="Justin's plan for browser-ready preview assets on preview.cdn.rrweb.com. 1926 already ships npm previews via pkg.pr.new.", next_step="Justin owns it. No intake action.", tags=("maintainer",), message="Tracking issue for preview assets. Justin owns it; no intake action needed.")

issue(1919, "adopt", reason="Blocked <img> still pays the full inlineImages encode. Block is a privacy control; encoding the bytes anyway is a leak plus a perf bug. PR 1965 is approved (2026-10-25).", next_step="Merge PR 1965, then close.", tags=("strengthens-privacy", "commercial"), related=(1965,))
issue(1881, "review", reason="Canvas mutations in same-origin iframes. Justin has draft PR 1927.", next_step="Close when 1927 merges.", related=(1927,), tags=("impacts-privacy", "commercial"))
issue(1816, "review", reason="<select> wrong during forward play, right on seek.", next_step="Assign an owner. Repro-able replay bug.")
issue(1786, "review", reason="UMD global inconsistency.", next_step="Assign an owner.", tags=("commercial",))
issue(1785, "review", reason="Record bundle size.", next_step="Assign an owner.", tags=("commercial",), related=(1742,))
issue(1742, "review", reason="Record bundle size.", next_step="Assign an owner.", tags=("commercial",), related=(1785,))
issue(1724, "review", reason="Web-extension broken.", next_step="Assign an owner.", tags=("commercial",))
issue(1720, "review", reason="Cross-origin iframe blanks after parent fullSnapshot. PR 1966 fixes it with four tests; the author reworked it after Eoghan's 2026-10-25 questions.", next_step="Eoghan: re-review 1966, merge, then close.", related=(1966,))
issue(1707, "review", reason="Memory/CPU on rel=preload links.", next_step="Assign an owner. PostHog and Sprig already shipped a production fix for the endless preload-as-style poll.", downstream="PostHog posthog-js 3667 shipped. Sprig/UserLeap rrweb 2 cites this issue and that port.")
issue(1701, "review", reason="Popover API. Modern UI fidelity.", next_step="Assign an owner.", tags=("commercial",))
issue(1690, "review", reason="Mobile DOM order.", next_step="Assign an owner.")
issue(1667, "review", reason="background shorthand expands empty. Related CSSOM bugs.", next_step="Assign an owner.")
issue(1585, "review", reason="Same-origin iframe leaks. 1755, 1958 and 1971 merged; sibling 1628 closed 2026-10-24. Justin's 1975 and Eoghan's 1987 cover what 1971 left.", next_step="Ask the reporter to re-test on 2.2.1, then close.", related=(1975, 1987, 1963), message="#1971 merged on 2026-10-24 and releases the iframe observers and buffers on teardown (2.2.1). Could you re-test on that release? #1975 and #1987 cover two remaining leaks if you still see growth.")
issue(1626, "review", reason="Adopted stylesheets missing from first full snapshot.", next_step="Assign an owner. Amplitude already ships the full-snapshot inline.", related=(1567,), downstream="Amplitude rrweb 101.")
issue(1567, "review", reason="Adopted stylesheets missing from first full snapshot. PR 1949 adds them to the snapshot format for direct rrweb-snapshot users, which is a format decision.", next_step="Decide 1949 in the team meeting. Amplitude already ships the full-snapshot inline.", related=(1626, 1949), downstream="Amplitude rrweb 101.")
issue(1577, "review", reason="Duplicate cross-origin message listeners.", next_step="Assign an owner.", tags=("impacts-privacy",), related=(1590,))
issue(1590, "review", reason="Duplicate cross-origin message listeners.", next_step="Assign an owner.", tags=("impacts-privacy",), related=(1577,))
issue(1564, "review", reason="Table alignment in replay.", next_step="Assign an owner.")
issue(1505, "review", reason="all: unset expansion.", next_step="Assign an owner.")
issue(1488, "review", reason="maskInputFn skipped.", next_step="Same hole as 1097 / 1385.", tags=("strengthens-privacy",), related=(1097, 1385, 874))
issue(1385, "review", reason="maskInputFn skipped.", next_step="Eoghan: same hole as 1097 / 1488; decide with the masking discussion.", tags=("strengthens-privacy",), related=(1097, 1488, 874))
issue(1395, "review", reason="Grid template areas. PR 1586. Chrome 152 serializes grid-template-areas correctly (checked 2026-11-06), so the bug is fixed upstream in current Chrome.", next_step="Eoghan: close if the supported Chrome range no longer needs 1586; otherwise review 1586.", related=(1586,), downstream="Amplitude rrweb 126.")
issue(816, "review", reason="Strict CSP vs style mutation. 34 comments, still open.", next_step="Keep open. Security of the recorded app.", tags=("strengthens-privacy",))
issue(423, "review", reason="Inline/blob workers vs CSP.", next_step="Keep open with 1699.", tags=("strengthens-privacy",), related=(1699,))
issue(1699, "review", reason="Inline/blob workers vs CSP.", next_step="Keep open with 423.", tags=("strengthens-privacy",), related=(423,))
issue(88, "review", reason="removeChild DOMException. Ancient, 17 comments; may already be PR 1907.", next_step="Check whether PR 1907 covers it before closing.", related=(1907,))

issue(1918, "discuss", reason="inlineImages encodes full natural resolution with no cap. Retention cost and high-res PII.", next_step="Team meeting.", tags=("impacts-privacy", "commercial"))
issue(1913, "discuss", reason="UNSAFE_replayCanvas adds allow-scripts. Documented unsafe, still a footgun.", next_step="Answer with the sandbox ADR, then close or turn into implement-the-ADR.", tags=("impacts-privacy",), related=())
issue(1899, "discuss", reason="Replay pre-process plugins.", next_step="Team meeting.", tags=("commercial",))
issue(1896, "discuss", reason="More pseudo-classes. PR 1897. Justin replied 2026-09-16; the authors are exploring an rrweb-level version.", next_step="Decide with PR 1897.", tags=("commercial",), related=(1897,))
issue(1880, "discuss", reason="Record a subtree only. Can strengthen privacy (less capture) and is commercially useful for widgets.", next_step="Team meeting with 1659 / 111.", tags=("impacts-privacy", "commercial"), related=(1659, 111))
issue(1659, "discuss", reason="Record a subtree only.", next_step="Team meeting with 1880 / 111.", tags=("impacts-privacy", "commercial"), related=(1880, 111))
issue(111, "discuss", reason="Record a subtree only.", next_step="Team meeting with 1880 / 1659.", tags=("impacts-privacy", "commercial"), related=(1880, 1659))
issue(1773, "discuss", reason="Remote control / MITM. Recommend reject, but confirm the product line.", next_step="Confirm out of scope, then close with 987.", tags=("commercial", "impacts-privacy"), related=(987,))
issue(987, "discuss", reason="Remote control / MITM. Recommend reject.", next_step="Confirm out of scope, then close with 1773.", tags=("commercial", "impacts-privacy"), related=(1773,))
issue(1671, "discuss", reason="When is 2.0? Trust and adoption.", next_step="Write one public status, then close 1664/1778/1420 as answered here.", tags=("commercial",), related=(1664, 1778, 1420))
issue(1664, "discuss", reason="2.0 schedule duplicate.", next_step="Close as answered in 1671.", tags=("commercial",), related=(1671,))
issue(1778, "discuss", reason="2.0 schedule duplicate.", next_step="Close as answered in 1671.", tags=("commercial",), related=(1671,))
issue(1420, "discuss", reason="2.0 schedule duplicate.", next_step="Close as answered in 1671.", tags=("commercial",), related=(1671,))
issue(1644, "discuss", reason="Fine-grained blocking. PR 1642.", next_step="Discuss with PR 1642 against the policy API.", tags=("strengthens-privacy", "commercial"), related=(1642,))
issue(1581, "discuss", reason="Mask attributes. PR 1257.", next_step="Discuss with PR 1257. Do not land a second API.", tags=("strengthens-privacy", "commercial"), related=(1257,))
issue(1563, "discuss", reason="maskAllText flag.", next_step="Fold into the privacy-at-capture discussion.", tags=("strengthens-privacy",))
issue(1560, "discuss", reason="Cut / merge / clip sessions.", next_step="Team meeting with Yun 1149 / 398 / 160.", tags=("commercial",), related=(1149, 398, 160))
issue(398, "discuss", reason="Session cutter / clip.", next_step="Team meeting with 1149 / 1560 / 160.", tags=("commercial",), related=(1149, 1560, 160))
issue(160, "discuss", reason="Session cutter / clip.", next_step="Team meeting with 1149 / 1560 / 398.", tags=("commercial",), related=(1149, 1560, 398))
issue(1528, "discuss", reason="Sanitization vs sandbox. Same debate as the ADR.", next_step="Answer with the sandbox ADR.", tags=("impacts-privacy",))
issue(1491, "discuss", reason="CSS animation currentTime.", next_step="Team meeting.", tags=("commercial",))
issue(1337, "discuss", reason="Full snapshot perf.", next_step="Team meeting. Related to 1933 / 1547.", tags=("commercial",), related=(1933, 1547))
issue(1547, "discuss", reason="Snapshot / mutation perf. 1652 merged 2026-09-17; 1933 carries the throttling from closed 1694.", next_step="Re-measure after 1933, then close or keep.", tags=("commercial",), related=(1933, 1337))
issue(1143, "discuss", reason="Web Animations API.", next_step="Yun: bring to the team meeting.", tags=("commercial",))
issue(419, "discuss", reason="rrdom as an analytics engine. Strategic, not a bug.", next_step="Keep until the matching discussion happens.", tags=("commercial",))
issue(860, "discuss", reason="Deferred / asset events. The assets PRs.", next_step="Discuss with 1475 / 1848.", tags=("impacts-privacy", "commercial"), related=(1475, 1848))

CLEANUP_ISSUES = {
    1824, 1727, 1713, 1650, 1608, 1595, 1558, 1514, 1473, 1232, 1192, 1075, 951, 377, 1658, 1622, 1723,
}
for n in CLEANUP_ISSUES:
    extra = {
        1658: "Extension “obfuscated code” complaint — ask for the exact file/build.",
        1622: "Turbo on M1.",
        1723: "pauseAnimation docs question.",
    }.get(n, "Need a reproduction, English summary, or a reduced test case.")
    issue(n, "cleanup", reason=extra, next_step="Use the issue template; close after 14 days of silence. Label reproduction needed.")

issue(1878, "reject", reason="Captcha/stealth evasion is out of scope and hostile to end users.", next_step="Close. Do not help hide recording from the page or from the user.", tags=("impacts-privacy",))
issue(1801, "reject", reason="WeChat mini programs / React Native are not DOM.", next_step="Close as out of scope.")
issue(1606, "reject", reason="Recording JS execution is a profiler, not rrweb.", next_step="Close as out of scope.")
issue(1048, "reject", reason="IE11.", next_step="Close.")


TAG_LABEL = {
    "approved": "Approved",
    "waiting-on-review": "Waiting on review",
    "changes-requested": "Changes requested",
    "strengthens-privacy": "Strengthens privacy",
    "impacts-privacy": "Impacts privacy",
    "commercial": "Commercial",
    "posthog-backed": "PostHog-backed",
    "posthog-shipped": "PostHog shipped",
    "posthog-declined": "PostHog declined",
    "posthog-in-fork": "In PostHog fork — do not adopt",
    "posthog-nudge": "PostHog nudge",
    "sentry-backed": "Sentry-backed",
    "datadog-diverged": "Datadog diverged",
    "newrelic-backed": "New Relic-backed",
    "amplitude-backed": "Amplitude-backed",
    "mixpanel-backed": "Mixpanel-backed",
    "grafana-backed": "Grafana-backed",
    "sprig-backed": "Sprig-backed",
    "launchdarkly-backed": "LaunchDarkly-backed",
    "highlight-backed": "Highlight-backed",
    "privacy-overlap": "Privacy-at-capture overlap",
    "maintainer-close": "Maintainer close",
    "draft": "Draft",
    "maintainer": "Maintainer",
    "community": "Community",
    "bulk-updated": "Bulk-updated 2026-06-08",
}

TAG_RANK = {
    "approved": 0,
    "posthog-backed": 1,
    "posthog-shipped": 2,
    "strengthens-privacy": 3,
    "impacts-privacy": 4,
    "privacy-overlap": 5,
    "waiting-on-review": 6,
    "changes-requested": 7,
    "maintainer-close": 8,
    "commercial": 9,
    "posthog-declined": 10,
    "posthog-in-fork": 11,
    "posthog-nudge": 12,
    "mixpanel-backed": 12.1,
    "amplitude-backed": 12.2,
    "newrelic-backed": 12.3,
    "grafana-backed": 12.4,
    "sprig-backed": 12.5,
    "launchdarkly-backed": 12.6,
    "highlight-backed": 12.7,
    "sentry-backed": 12.8,
    "datadog-diverged": 12.9,
    "draft": 13,
    "maintainer": 14,
    "community": 15,
    "bulk-updated": 16,
}


def ev(label: str, url: str, note: str = "") -> dict:
    return {"label": label, "url": url, "note": note}


PH = "https://github.com/PostHog/posthog-js"
MX = "https://github.com/mixpanel/rrweb"
AMP = "https://github.com/amplitude/rrweb"
NR = "https://github.com/newrelic-forks/rrweb"
DD = "https://github.com/DataDog/browser-sdk"
GF = "https://github.com/grafana/rrweb"
LD = "https://github.com/launchdarkly/rrweb"
UL = "https://github.com/UserLeap/rrweb"
HL = "https://github.com/highlight/rrweb"

PH_DIVERGENCE = "https://github.com/PostHog/posthog-js/issues/3766"

PH_TRACKER = ev(
    "PostHog/posthog-js#3765",
    f"{PH}/issues/3765",
    "Their public pull-in tracker. Evidence is the row for this upstream PR.",
)
PH_ALREADY = ev(
    "PostHog/posthog-js#3765",
    f"{PH}/issues/3765",
    "Listed as already in their vendored rrweb (verified by them, not re-verified here).",
)
PH_ADOPT = ev(
    "PostHog/posthog-js#3765",
    f"{PH}/issues/3765",
    "On their adopt / adopt-high list. Not treated as shipped unless a port PR is linked.",
)
PH_DECLINE = ev(
    "PostHog/posthog-js#3765",
    f"{PH}/issues/3765",
    "They explicitly declined to adopt this from that review.",
)
PH_NUDGE = ev(
    "PostHog/posthog-js#3765",
    f"{PH}/issues/3765",
    "On their own-open / nudge list — needs tests or a cluster decision.",
)

# Links to the vendor PR/issue that provides the evidence. Only rows we
# actually opened. Datadog is an in-tree fork that has diverged.
EVIDENCE: dict[int, list[dict]] = {
    1737: [PH_ADOPT],
    1802: [PH_ALREADY],
    1688: [
        PH_ALREADY,
        ev("mixpanel/rrweb#10", f"{MX}/pull/10", "Shipped the MediaInteraction isSupportedMediaElement guard. Their write-up cites the weaker duplicate 1798, not this PR."),
    ],
    1691: [
        PH_ALREADY,
        ev("grafana/rrweb#31", f"{GF}/pull/31", "Independent re-implementation of skip-unchanged setAttribute in rrdom diffProps (plus SVG NS + iframe src coverage). Open on their fork."),
    ],
    1711: [PH_ALREADY],
    1770: [PH_ALREADY],
    1814: [PH_ADOPT],
    1697: [ev("PostHog/posthog-js#4131", f"{PH}/pull/4131", "Shipped adopt of this PR (plus a Set hoist). Checkout timers can still unfreeze.")],
    1934: [
        PH_ADOPT,
        ev("PostHog/posthog-js#3766", PH_DIVERGENCE, "Their divergence tracker says this PR overtook their own iframe keepalive patch (4128) with a tighter MutationObserver-only scope. They plan a review comment, not a port."),
    ],
    1873: [
        ev("PostHog/posthog-js#4129", f"{PH}/pull/4129", "Shipped adopt. At port time: shadow roots were not filtered; empty [] observed no attributes."),
        ev("PostHog/posthog-js#3766", PH_DIVERGENCE, "They plan review comments on shadow-root plumbing and an empty-array guard."),
    ],
    1302: [
        ev("PostHog/posthog-js#4130", f"{PH}/pull/4130", "Shipped adopt. They kept has→delete→add."),
        ev("PostHog/posthog-js#4697", f"{PH}/pull/4697", "Empty-payload early return skips addedSet reset — still missing in this tree."),
    ],
    1745: [
        PH_ADOPT,
        ev("mixpanel/rrweb#4", f"{MX}/pull/4", "Re-implemented hidden-input masking (maskInputOptions.hidden)."),
    ],
    1610: [
        PH_TRACKER,
        ev("mixpanel/rrweb#4", f"{MX}/pull/4", "They shipped a hidden-input fix. Close this duplicate; keep 1745."),
    ],
    1912: [
        ev("mixpanel/rrweb#18", f"{MX}/pull/18", "Shipped placeholder masking when input masking is on."),
        ev("newrelic-forks/rrweb#19", f"{NR}/pull/19", "Same product: mask placeholder via maskInputValue. Closed unmerged on their fork."),
        ev("DataDog/browser-sdk#1660", f"{DD}/pull/1660", "Datadog hides placeholders under mask privacy in their own recorder — not a port of this PR."),
    ],
    1798: [
        ev("mixpanel/rrweb#10", f"{MX}/pull/10", "They shipped this weaker duplicate and cited it as the upstream. Prefer 1688 + 1673."),
    ],
    1978: [
        ev("amplitude/rrweb#102", f"{AMP}/pull/102", "Closed-mode shadow mutation capture (patchAttachShadow used element.shadowRoot which is null for closed roots). Open, not merged. Same need as this PR and closed 1739."),
        ev("highlight/rrweb#118", f"{HL}/pull/118", "Salesforce LWC / closed shadow recording. Same product need, not a port of this PR."),
    ],
    1988: [
        ev("PostHog/posthog-js#5244", f"{PH}/pull/5244", "Eoghan asked the author there to upstream the ShadowRoot walk-up jump and its tests on top of 1652. This PR is that port."),
    ],
    1586: [
        ev("amplitude/rrweb#126", f"{AMP}/pull/126", "Serialize grid-template-areas faithfully (mobile replay overlap). Same Chrome grid-template hole. Open, not merged."),
    ],
    1641: [
        PH_NUDGE,
        ev("amplitude/rrweb#101", f"{AMP}/pull/101", "Shipped inline adoptedStyleSheets in the full snapshot so dropped incremental style events cannot leave shadow CSS empty."),
        ev("amplitude/rrweb#133", f"{AMP}/pull/133", "Follow-up: inline adoptedStyleSheets on mutation add as well. Open."),
    ],
    1766: [
        ev("launchdarkly/rrweb#36", f"{LD}/pull/36", "Shipped optional replayer CSP (cspContent → meta http-equiv). Same product need, different API than this PR’s iframe CSP."),
    ],
    1707: [
        ev("PostHog/posthog-js#3667", f"{PH}/pull/3667", "Shipped: stop polling preload-as-style <link> forever (Next.js chunked CSS)."),
        ev("UserLeap/rrweb#2", f"{UL}/pull/2", "Sprig/UserLeap shipped the same preload event-listener leak fix; their write-up cites this issue and PostHog 3667."),
    ],
    1395: [
        ev("amplitude/rrweb#126", f"{AMP}/pull/126", "Amplitude’s grid-template-areas serializer. Review with PR 1586."),
    ],
    1626: [
        ev("amplitude/rrweb#101", f"{AMP}/pull/101", "Shipped inline adoptedStyleSheets in the full snapshot."),
    ],
    1567: [
        ev("amplitude/rrweb#101", f"{AMP}/pull/101", "Shipped inline adoptedStyleSheets in the full snapshot."),
    ],
    1800: [ev("mixpanel/rrweb#9", f"{MX}/pull/9", "Their public fork has allowedIframeOrigins (own cross-origin port).")],
    1609: [
        ev("mixpanel/rrweb#4", f"{MX}/pull/4", "Re-implemented hidden-input masking."),
        ev("PostHog/posthog-js#3765", f"{PH}/issues/3765", "They list upstream 1745, not 1610."),
    ],
    1680: [ev("mixpanel/rrweb#9", f"{MX}/pull/9", "Mixpanel already ships an iframe-origin allowlist in their fork.")],
    1469: [PH_ADOPT],
    1635: [PH_NUDGE],
    1642: [PH_ADOPT],
    1686: [PH_NUDGE],
    1164: [PH_ADOPT],
    1097: [PH_ADOPT],
    1257: [PH_ADOPT],
    1356: [PH_DECLINE],
    1373: [PH_DECLINE],
    1313: [PH_ADOPT],
    1463: [PH_ADOPT],
    1428: [PH_ADOPT],
    1413: [PH_ALREADY],
    1462: [PH_ALREADY],
    724: [PH_ALREADY],
    558: [PH_ADOPT],
    1320: [PH_ADOPT],
    1854: [
        ev("PostHog/posthog-js#4128", f"{PH}/pull/4128", "Shipped adopt. Already on upstream main."),
        ev("PostHog/posthog-js#4325", f"{PH}/pull/4325", "Later widened Safari keepalive to WebKit."),
    ],
}

EVIDENCE_TAGS: dict[int, tuple[str, ...]] = {
    1912: ("mixpanel-backed", "newrelic-backed"),
    1745: ("mixpanel-backed",),
    1610: ("mixpanel-backed",),
    1800: ("mixpanel-backed",),
    1609: ("mixpanel-backed",),
    1680: ("mixpanel-backed",),
    1688: ("mixpanel-backed",),
    1798: ("mixpanel-backed",),
    1691: ("grafana-backed",),
    1978: ("amplitude-backed", "highlight-backed"),
    1586: ("amplitude-backed",),
    1395: ("amplitude-backed",),
    1641: ("amplitude-backed",),
    1626: ("amplitude-backed",),
    1567: ("amplitude-backed",),
    1766: ("launchdarkly-backed",),
    1707: ("sprig-backed", "posthog-shipped"),
}


def load_json(path: Path):
    return json.loads(path.read_text())


def previous_buckets() -> dict[str, str]:
    return load_json(PREVIOUS)["buckets"] if PREVIOUS.exists() else {}


def who_of(login: str) -> tuple[str, str]:
    if login in MAINTAINERS:
        return "maintainer", MAINTAINERS[login]
    return "community", "Community"


def _sentence(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    return text if text.endswith((".", "!", "?")) else text + "."


def _keep_ref(related: list) -> str | None:
    return f"#{related[0]}" if related else None


def _close_footer(kind: str) -> str:
    if kind == "pr":
        return (
            "If this is still relevant, please open a new PR against current `main` "
            "with a rebase, a changeset, and a regression test. We’re closing stale "
            "work so intake can restart."
        )
    return (
        "If this is still relevant, please open a new issue with a reduced "
        "reproduction on a current release. We’re closing stale work so intake "
        "can restart."
    )


def compose_message(kind: str, overlay: dict, who: str) -> str:
    if overlay.get("message"):
        return overlay["message"]
    triage = overlay["triage"]
    reason = _sentence(overlay.get("reason") or "")
    next_step = _sentence(overlay.get("next") or "")
    related = overlay.get("related") or []
    tags = overlay.get("tags") or []
    keep = _keep_ref(related)
    noun = "pull request" if kind == "pr" else "issue"

    if triage == "reject":
        if keep:
            return (
                f"Closing in favor of {keep}, which covers the same ground. "
                "Please move any extra test cases there.\n\n"
                f"{reason}\n\n{_close_footer(kind)}"
            )
        lowered = reason.lower()
        if any(
            token in lowered
            for token in (
                "out of scope",
                "stealth",
                "captcha",
                "mitm",
                "remote control",
                "wechat",
                "profiler",
            )
        ):
            return (
                "rrweb records and replays the DOM. Remote control, captcha evasion, "
                "and host-app MITM are out of scope for this repo. Please don’t "
                f"re-open that class of request.\n\n{reason}"
            )
        if who == "maintainer":
            return (
                f"Closing this stale {noun} as part of intake cleanup.\n\n"
                f"{reason}\n\n{_close_footer(kind)}"
            )
        return (
            f"Closing this {noun} as part of intake cleanup.\n\n"
            f"{reason}\n\n{_close_footer(kind)}"
        )

    if triage == "cleanup":
        if kind == "issue":
            return (
                "Thanks for filing this. We need a reduced reproduction, an English "
                "summary, or a failing fixture before we can spend review time on it. "
                "If that doesn’t happen in two weeks we’ll close it; open a new issue "
                f"if this is still relevant.\n\n{reason}"
            )
        if who == "maintainer":
            return (
                "This still needs a rebase / tests / split before review is worth "
                "the time. If it stays stale we should close it and open a new PR "
                f"against current `main` if it is still relevant.\n\n{reason}\n\n{next_step}"
            ).strip()
        return (
            "Thanks for this — the direction looks useful. Before we can review it on "
            "current `main`, please rebase, add a changeset, and add a regression test "
            "for the reported case. If that doesn’t happen in two weeks we’ll close "
            "it; open a new PR if this is still relevant.\n\n"
            f"{reason}"
        )

    if triage == "review":
        if "changes-requested" in tags:
            return (
                "A maintainer already reviewed this. Please address the requested "
                "changes and we’ll pick it back up — no need to re-review from "
                f"scratch.\n\n{reason}"
            )
        if kind == "issue":
            return (
                "This looks like a real bug or a small, well-scoped feature. "
                f"Putting it in the individual-review queue.\n\n{reason}\n\n{next_step}"
            ).strip()
        return (
            "Could someone from core take a look at this? It’s a focused change, "
            f"not a product-strategy fork.\n\n{reason}\n\n{next_step}"
        ).strip()

    if triage == "discuss":
        return (
            "Holding this for a team discussion rather than merging or closing from "
            f"the thread.\n\n{reason}"
        )

    if triage == "merge-now":
        return f"Review is already done. Merging this onto current `main`.\n\n{reason}"

    if triage == "adopt":
        extra = f" Related: {', '.join(f'#{n}' for n in related)}." if related else ""
        if kind == "issue":
            return (
                f"This has a known fix in the adopt queue.{extra}\n\n{reason}\n\n{next_step}"
            ).strip()
        return (
            "This looks small and correct enough to adopt after rebase + green CI. "
            f"Approving.\n\n{reason}{extra}"
        )

    return (
        "Closing as part of intake cleanup. This was not individually reviewed "
        "in the first pass: questions go to the guide, 2.0 duplicates to 1671, "
        "privacy duplicates to the policy comment, and reports without a reduced "
        f"fixture need a reproduction.\n\n{reason}\n\n{_close_footer(kind)}"
    )


def upstream_labels(raw: dict) -> list[str]:
    return sorted(lab if isinstance(lab, str) else lab["name"] for lab in raw.get("labels") or [])


def upstream_assignees(raw: dict) -> list[str]:
    return sorted(a["login"] for a in raw.get("assignees") or [])


def assemble() -> list[dict]:
    snapshot = load_json(SNAPSHOT)
    prs = snapshot["pr"]
    issues = snapshot["issue"]
    items: list[dict] = []
    missing_prs = []

    for raw in prs:
        n = raw["number"]
        overlay = PR.get(n)
        if overlay is None:
            missing_prs.append(n)
            overlay = {
                "triage": "review",
                "reason": "Open at snapshot; not given a dedicated row.",
                "notes": "",
                "next": "Skim title and files; then bucket.",
                "tags": [],
                "downstream": "",
                "related": [],
                "message": "",
            }
        login = (raw.get("author") or {}).get("login") or "unknown"
        who_kind, who_label = who_of(login)
        tags = list(overlay["tags"])
        if who_kind == "maintainer":
            tags.append("maintainer")
        else:
            tags.append("community")
        if raw.get("isDraft"):
            tags.append("draft")
        decision = raw.get("reviewDecision") or ""
        if decision == "APPROVED":
            tags.append("approved")
        elif decision == "CHANGES_REQUESTED":
            tags.append("changes-requested")
        elif not raw.get("isDraft") and decision in ("REVIEW_REQUIRED", ""):
            tags.append("waiting-on-review")
        if (raw.get("updatedAt") or "").startswith("2026-06-08"):
            tags.append("bulk-updated")
        for t in EVIDENCE_TAGS.get(n, ()):
            tags.append(t)
        # de-dupe preserving order
        seen = set()
        uniq = []
        for t in tags:
            if t not in seen:
                seen.add(t)
                uniq.append(t)
        items.append(
            {
                "id": n,
                "kind": "pr",
                "title": raw["title"],
                "url": raw.get("url") or f"https://github.com/rrweb-io/rrweb/pull/{n}",
                "author": login,
                "authorName": (raw.get("author") or {}).get("name") or login,
                "createdAt": raw["createdAt"],
                "updatedAt": raw["updatedAt"],
                "draft": bool(raw.get("isDraft")),
                "reviewDecision": decision or "NONE",
                "who": who_kind,
                "whoLabel": who_label,
                "triage": overlay["triage"],
                "tags": uniq,
                "next": overlay["next"],
                "reason": overlay["reason"],
                "notes": overlay["notes"],
                "downstream": overlay["downstream"],
                "downstreamLinks": EVIDENCE.get(n, []),
                "related": overlay["related"],
                "message": compose_message("pr", overlay, who_kind),
                "additions": raw.get("additions"),
                "deletions": raw.get("deletions"),
                "changedFiles": raw.get("changedFiles"),
                "mergeable": raw.get("mergeable"),
                "labels": upstream_labels(raw),
                "assignees": upstream_assignees(raw),
            }
        )

    if missing_prs:
        raise SystemExit(f"Missing PR overlay for: {missing_prs}")

    for raw in issues:
        n = raw["number"]
        overlay = ISSUE.get(n)
        if overlay is None:
            overlay = {
                "triage": "bulk",
                "reason": "Not individually reviewed in the first pass (~180 issues).",
                "notes": "Bulk rule: questions → guide; 2.0 dupes → 1671; privacy dupes → policy comment; Chinese-only with no fixture → ask for a reduced case.",
                "next": "Apply bulk hygiene. Do not spend a review slot unless a repro appears.",
                "tags": [],
                "downstream": "",
                "related": [],
                "message": "",
            }
        login = (raw.get("author") or {}).get("login") or "unknown"
        who_kind, who_label = who_of(login)
        tags = list(overlay["tags"])
        tags.append("maintainer" if who_kind == "maintainer" else "community")
        if (raw.get("updatedAt") or "").startswith("2026-06-08"):
            tags.append("bulk-updated")
        for t in EVIDENCE_TAGS.get(n, ()):
            tags.append(t)
        seen = set()
        uniq = []
        for t in tags:
            if t not in seen:
                seen.add(t)
                uniq.append(t)
        items.append(
            {
                "id": n,
                "kind": "issue",
                "title": raw["title"],
                "url": raw.get("url") or f"https://github.com/rrweb-io/rrweb/issues/{n}",
                "author": login,
                "authorName": (raw.get("author") or {}).get("name") or login,
                "createdAt": raw["createdAt"],
                "updatedAt": raw["updatedAt"],
                "draft": False,
                "reviewDecision": "",
                "who": who_kind,
                "whoLabel": who_label,
                "triage": overlay["triage"],
                "tags": uniq,
                "next": overlay["next"],
                "reason": overlay["reason"],
                "notes": overlay["notes"],
                "downstream": overlay["downstream"],
                "downstreamLinks": EVIDENCE.get(n, []),
                "related": overlay["related"],
                "message": compose_message("issue", overlay, who_kind),
                "additions": None,
                "deletions": None,
                "changedFiles": None,
                "mergeable": None,
                "labels": upstream_labels(raw),
                "assignees": upstream_assignees(raw),
            }
        )

    previous = previous_buckets()
    for item in items:
        was = previous.get(f"{item['kind']}:{item['id']}")
        item["change"] = None if not previous else "new" if was is None else "moved" if was != item["triage"] else None
        item["movedFrom"] = was if item["change"] == "moved" else None

    items.sort(key=lambda x: (0 if x["kind"] == "pr" else 1, -x["id"]))
    return items


HTML_HEAD = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>rrweb intake triage — {{SNAPSHOT_DATE}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #12140f;
    --bg-2: #1b1e16;
    --bg-3: #23281c;
    --ink: #f3efe2;
    --muted: #9a937c;
    --line: #3a3f2f;
    --accent: #d4a017;
    --accent-2: #7eb8a0;
    --merge: #d4a017;
    --adopt: #7eb8a0;
    --review: #8aa4d4;
    --discuss: #c48bdb;
    --cleanup: #d4b07a;
    --reject: #d37a6a;
    --bulk: #7a7668;
    --chip: #2a2e22;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.45 "IBM Plex Sans", "Source Sans 3", "Segoe UI", sans-serif; }
  a { color: #e8c56a; }
  a:hover { color: #ffe08a; }
  header.page {
    padding: 16px 28px 8px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, #191c13 0%, var(--bg) 100%);
    position: sticky; top: 0; z-index: 20;
  }
  h1 { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 2px; }
  .lede { color: var(--muted); margin: 0 0 10px; font-size: 12px; }
  /* Two rows of pills: buckets (any of the selected), then narrowing filters (all of the selected). */
  .filters { display: grid; gap: 6px; margin: 0 0 10px; }
  .frow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .flabel { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; width: 52px; flex: 0 0 52px; }
  .pill {
    appearance: none; border: 1px solid var(--line); background: transparent;
    color: var(--ink); padding: 3px 9px 3px 7px; border-radius: 999px; cursor: pointer;
    font: inherit; font-size: 12px; line-height: 1.3; display: inline-flex; align-items: center; gap: 6px;
  }
  .pill:hover, .pill:focus-visible { border-color: var(--muted); }
  .pill .n { color: var(--muted); font-variant-numeric: tabular-nums; }
  .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pill, var(--muted)); flex: none; }
  .pill svg { width: 12px; height: 12px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .pill.bucket[aria-pressed="true"] { background: var(--pill); border-color: var(--pill); color: #14130b; }
  .pill.bucket[aria-pressed="true"] .dot { background: #14130b; opacity: 0.55; }
  .pill.bucket[aria-pressed="true"] .n { color: #14130b; opacity: 0.75; }
  .pill.narrow[aria-pressed="true"] { background: #1c2a22; border-color: var(--accent-2); color: var(--accent-2); }
  .pill.narrow[aria-pressed="true"] .n { color: var(--accent-2); opacity: 0.8; }
  .pill.view[aria-pressed="true"] { background: #2a2410; border-color: var(--accent); color: #ffe08a; }
  .pill.clear { border-style: dashed; color: var(--muted); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-bottom: 6px; }
  .toolbar label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; display: inline-flex; align-items: center; gap: 5px; }
  select, input[type="search"] {
    background: var(--bg-2); color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 3px 7px; font: inherit; font-size: 12px;
  }
  input[type="search"] { min-width: 200px; }
  .sorts { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-left: auto; }
  .sorts button {
    appearance: none; border: 1px solid var(--line); background: var(--bg-3);
    color: var(--ink); padding: 3px 8px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px;
  }
  .sorts button.active { border-color: var(--accent-2); color: var(--accent-2); }
  .meta { color: var(--muted); font-size: 12px; margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
  .meta-actions { display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .meta-actions label { text-transform: none; letter-spacing: 0; font-size: 12px; color: var(--muted); display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
  .ghost {
    appearance: none; border: 1px solid var(--line); background: var(--bg-3);
    color: var(--ink); padding: 3px 9px; border-radius: 6px; cursor: pointer;
    font: inherit; font-size: 12px; white-space: nowrap;
  }
  .ghost:hover, .ghost:focus-visible { border-color: var(--accent); color: #ffe08a; }
  .ghost.copied { border-color: var(--adopt); color: var(--adopt); background: #1c2a22; }
  main { padding: 16px 28px 80px; }
  .row {
    background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 14px 10px; margin: 0 0 8px;
  }
  .row.done { opacity: 0.55; }
  .row.done .title { text-decoration: line-through; }
  .row-top { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; }
  .id a { font-weight: 650; text-decoration: none; font-variant-numeric: tabular-nums; }
  .kind { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .title { flex: 1 1 280px; font-weight: 550; }
  .triage {
    font-size: 12px; font-weight: 650; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--line); white-space: nowrap;
  }
  .triage.merge-now { color: #1b1404; background: var(--merge); border-color: var(--merge); }
  .triage.adopt { color: #10241c; background: var(--adopt); border-color: var(--adopt); }
  .triage.review { color: #0e1728; background: var(--review); border-color: var(--review); }
  .triage.discuss { color: #1d1024; background: var(--discuss); border-color: var(--discuss); }
  .triage.cleanup { color: #241a0c; background: var(--cleanup); border-color: var(--cleanup); }
  .triage.reject { color: #2a100c; background: var(--reject); border-color: var(--reject); }
  .triage.bulk { color: var(--ink); background: #3a382e; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 6px; }
  .tag {
    font-size: 11px; padding: 2px 7px; border-radius: 4px; background: var(--chip);
    color: #d9d2b8; border: 1px solid #3d4233;
  }
  .tag.upstream-label { background: transparent; border-color: var(--review); color: var(--review); }
  .tag.strengthens-privacy { color: #b8f0d4; border-color: #3d6b55; }
  .tag.impacts-privacy { color: #ffc9b8; border-color: #6b3d33; }
  .tag.posthog-backed, .tag.posthog-shipped { color: #b8e0ff; border-color: #33556b; }
  .tag.approved { color: #1b1404; background: var(--merge); border-color: var(--merge); }
  .tag.change { color: #10241c; background: var(--accent-2); border-color: var(--accent-2); font-weight: 650; }
  .sub { color: var(--muted); font-size: 12px; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-top: 8px;
  }
  @media (max-width: 1100px) { .grid { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } header.page, main { padding-left: 14px; padding-right: 14px; } .flabel { width: 100%; flex-basis: 100%; } .sorts { margin-left: 0; } }
  .cell h3 {
    margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); font-weight: 650;
  }
  .cell p { margin: 0; color: #e6e0cf; }
  .cell.empty p { color: #6d6858; font-style: italic; }
  .related a { margin-right: 8px; }
  .ev-links { margin: 6px 0 0; padding-left: 18px; }
  .ev-links li { margin: 0 0 4px; }
  .ev-links a { font-weight: 550; }
  .empty-board { color: var(--muted); padding: 40px 8px; }
  .msg { position: relative; display: inline-flex; }
  .copy-msg {
    appearance: none; border: 1px solid var(--line); background: var(--bg-3);
    color: var(--ink); padding: 3px 9px; border-radius: 6px; cursor: pointer;
    font: inherit; font-size: 12px; white-space: nowrap;
  }
  .copy-msg:hover, .copy-msg:focus-visible,
  .mark-done:hover, .mark-done:focus-visible {
    border-color: var(--accent); color: #ffe08a;
  }
  .copy-msg.copied { border-color: var(--adopt); color: var(--adopt); background: #1c2a22; }
  .mark-done.done-on { border-color: var(--reject); color: #ffc9b8; }
  .row-actions { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; }
  .msg:has(.copy-msg.copied) .msg-tip { display: none; }
  .msg-tip {
    display: none; position: absolute; right: 0; top: calc(100% + 6px);
    z-index: 40; width: min(440px, 78vw); background: #2a2718;
    border: 1px solid var(--accent); color: var(--ink); padding: 10px 12px;
    border-radius: 8px; white-space: pre-wrap; font-size: 12px; line-height: 1.45;
    box-shadow: 0 10px 28px rgba(0,0,0,0.45);
  }
  .msg:hover .msg-tip, .msg:focus-within .msg-tip { display: block; }
</style>
</head>
<body>
<header class="page">
  <h1>rrweb-io/rrweb intake triage</h1>
  <p class="lede">
    Snapshot {{SNAPSHOT_DATE}}.
  </p>
  <div class="filters">
    <div class="frow" id="buckets"></div>
    <div class="frow" id="narrows"></div>
  </div>
  <div class="toolbar">
    <label>Kind
      <select id="kind">
        <option value="all">PRs + issues</option>
        <option value="pr">PRs only</option>
        <option value="issue">Issues only</option>
      </select>
    </label>
    <label>Who
      <select id="who">
        <option value="all">Everyone</option>
        <option value="maintainer">Maintainers</option>
        <option value="community">Community</option>
      </select>
    </label>
    <label>Assignee
      <select id="assignee"></select>
    </label>
    <input type="search" id="q" placeholder="Filter title, author, tags, notes…" />
    <div class="sorts" id="sorts"></div>
  </div>
  <p class="meta">
    <span id="meta-count"></span>
    <span class="meta-actions">
      <span id="view-done"></span>
      <label><input type="checkbox" id="show-done" /> Show done</label>
      <button type="button" class="ghost" id="copy-done">Copy done IDs</button>
    </span>
  </p>
</header>
<main id="board"></main>
<script>
"""

HTML_TAIL = r"""
const TRIAGE_LABEL = {
  "merge-now": "Merge now",
  "adopt": "Adopt",
  "review": "Review individually",
  "discuss": "Discuss in team",
  "cleanup": "Request clean-up",
  "reject": "Reject",
  "bulk": "Bulk hygiene",
};
const TRIAGE_RANK = { "merge-now": 0, adopt: 1, review: 2, discuss: 3, cleanup: 4, reject: 5, bulk: 6 };
const TAG_LABEL = {
  "approved": "Approved",
  "waiting-on-review": "Waiting on review",
  "changes-requested": "Changes requested",
  "strengthens-privacy": "Strengthens privacy",
  "impacts-privacy": "Impacts privacy",
  "commercial": "Commercial",
  "posthog-backed": "PostHog-backed",
  "posthog-shipped": "PostHog shipped",
  "posthog-declined": "PostHog declined",
  "posthog-in-fork": "In PostHog fork — do not adopt",
  "posthog-nudge": "PostHog nudge",
  "sentry-backed": "Sentry-backed",
  "datadog-diverged": "Datadog diverged",
  "newrelic-backed": "New Relic-backed",
  "amplitude-backed": "Amplitude-backed",
  "mixpanel-backed": "Mixpanel-backed",
  "grafana-backed": "Grafana-backed",
  "sprig-backed": "Sprig-backed",
  "launchdarkly-backed": "LaunchDarkly-backed",
  "highlight-backed": "Highlight-backed",
  "privacy-overlap": "Privacy-at-capture overlap",
  "maintainer-close": "Maintainer close",
  "draft": "Draft",
  "maintainer": "Maintainer",
  "community": "Community",
  "bulk-updated": "Bulk-updated 2026-06-08",
};
const TAG_RANK = {
  "approved": 0, "posthog-backed": 1, "posthog-shipped": 2,
  "strengthens-privacy": 3, "impacts-privacy": 4, "privacy-overlap": 5,
  "waiting-on-review": 6, "changes-requested": 7, "maintainer-close": 8,
  "commercial": 9, "posthog-declined": 10, "posthog-in-fork": 11,
  "posthog-nudge": 12, "mixpanel-backed": 12.1, "amplitude-backed": 12.2,
  "newrelic-backed": 12.3, "grafana-backed": 12.4, "sprig-backed": 12.5,
  "launchdarkly-backed": 12.6, "highlight-backed": 12.7,
  "sentry-backed": 12.8, "datadog-diverged": 12.9,
  "draft": 13, "maintainer": 14, "community": 15, "bulk-updated": 16,
};

// Row one: buckets. Selected buckets combine as OR; none selected means all.
const BUCKETS = [
  { id: "merge-now", label: "Merge now", color: "var(--merge)" },
  { id: "adopt", label: "Adopt", color: "var(--adopt)" },
  { id: "review", label: "Review", color: "var(--review)" },
  { id: "discuss", label: "Discuss", color: "var(--discuss)" },
  { id: "cleanup", label: "Clean-up", color: "var(--cleanup)" },
  { id: "reject", label: "Reject", color: "var(--reject)" },
];
// Row two: narrowing filters. Selected ones combine as AND with the buckets.
const NARROWS = [
  { id: "changed", label: "Changed" },
  { id: "privacy", label: "Strengthens privacy" },
  { id: "waiting", label: "Waiting on review" },
  { id: "posthog", label: "PostHog-backed" },
  { id: "vendor", label: "Other vendors" },
  { id: "maintainer-close", label: "Maintainer close" },
];
const ICONS = {
  changed: '<path d="M8 3l5 10H3z"/>',
  privacy: '<path d="M8 2l5 2v4c0 3.4-2.1 5.6-5 6.5C5.1 13.6 3 11.4 3 8V4z"/>',
  waiting: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  posthog: '<path d="M4 14V3h8l-2 3 2 3H4"/>',
  vendor: '<path d="M8 3L2 6l6 3 6-3z"/><path d="M2 10l6 3 6-3"/>',
  "maintainer-close": '<circle cx="8" cy="8" r="5.5"/><path d="M6 6l4 4M10 6l-4 4"/>',
  done: '<path d="M3 8.5l3 3 7-7"/>',
  clear: '<path d="M4 4l8 8M12 4l-8 8"/>',
};
function icon(id) {
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[id] || ""}</svg>`;
}

const SORTS = [
  { id: "recency", label: "Recency" },
  { id: "number", label: "Number" },
  { id: "triage", label: "Triage status" },
  { id: "tags", label: "Tags" },
];

const state = {
  buckets: new Set(["adopt"]), narrow: new Set(), view: "open",
  kind: "all", who: "all", assignee: "all", q: "", sort: "recency", showDone: false,
};

// Filter choices stay in this browser between loads.
const FILTER_KEY = "rrweb-triage-filters";
function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
    if (!saved) return;
    const known = (ids, list) => new Set((ids || []).filter((id) => list.some((x) => x.id === id)));
    state.buckets = known(saved.buckets, BUCKETS);
    state.narrow = known(saved.narrow, NARROWS);
    if (["all", "pr", "issue"].includes(saved.kind)) state.kind = saved.kind;
    if (["all", "maintainer", "community"].includes(saved.who)) state.who = saved.who;
    if (SORTS.some((x) => x.id === saved.sort)) state.sort = saved.sort;
  } catch {}
}
function saveFilters() {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify({
      buckets: [...state.buckets], narrow: [...state.narrow], kind: state.kind, who: state.who, sort: state.sort,
    }));
  } catch {}
}

// One key across snapshots so marks survive a refresh. Earlier builds used
// a per-snapshot key ("rrweb-triage-done:<date>"); those are merged in once,
// on the first load without DONE_KEY, and left in place.
const DONE_KEY = "rrweb-triage-done";
const LEGACY_DONE_PREFIX = "rrweb-triage-done:";

function itemKey(item) {
  return item.kind + ":" + item.id;
}

function readDoneKey(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function loadDone() {
  const merged = {};
  try {
    if (localStorage.getItem(DONE_KEY) !== null) return readDoneKey(DONE_KEY);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_DONE_PREFIX)) Object.assign(merged, readDoneKey(key));
    }
  } catch {
    return {};
  }
  return merged;
}

let doneMap = loadDone();

function saveDone() {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(doneMap));
  } catch {}
}

saveDone();

function isDone(item) {
  return Boolean(doneMap[itemKey(item)]);
}

// Opened as a claude.ai artifact, Done marks live in the artifact's shared
// db ("done/<kind>-<id>") and every viewer sees them live. Anywhere else
// (GitHub Pages, a local file) they stay in this browser's localStorage.
let sharedDone = null;
let sharedReadOnly = false;
let viewerId = null;

function sharedDocId(item) {
  return item.kind + "-" + item.id;
}

async function connectShared() {
  if (!window.claude || typeof window.claude.use !== "function") return;
  const db = await window.claude.use("db");
  if (!db) return;
  const user = await window.claude.use("user");
  viewerId = user ? await user.id() : null;
  if (user && (await user.can("data.write")) === false) sharedReadOnly = true;
  const col = db.collection("done");
  col.limit(1000).onSnapshot(
    (snap) => {
      const next = {};
      for (const doc of snap.docs) {
        const body = doc.data();
        if (body && typeof body.key === "string") next[body.key] = true;
      }
      sharedDone = col;
      doneMap = next;
      render();
    },
    () => {
      sharedDone = null;
      doneMap = loadDone();
      render();
    },
  );
}

async function writeShared(item, on) {
  const ref = sharedDone.doc(sharedDocId(item));
  try {
    if (on) await ref.set({ key: itemKey(item), by: viewerId, at: new Date().toISOString() });
    else await ref.delete();
  } catch (e) {
    if (e && e.code === "invalid_argument") sharedReadOnly = true;
    if (on) delete doneMap[itemKey(item)];
    else doneMap[itemKey(item)] = true;
    render();
  }
}

function setDone(item, on) {
  if (sharedDone && sharedReadOnly) return;
  if (on) doneMap[itemKey(item)] = true;
  else delete doneMap[itemKey(item)];
  if (sharedDone) writeShared(item, on);
  else saveDone();
}

function doneItems() {
  return ITEMS.filter(isDone);
}

function doneCount() {
  return doneItems().length;
}

function matchesPre(item, pre) {
  if (pre === "all") return true;
  if (pre === "changed") return Boolean(item.change);
  if (BUCKETS.some((b) => b.id === pre)) return item.triage === pre;
  if (pre === "posthog") return item.tags.includes("posthog-backed") || item.tags.includes("posthog-shipped");
  if (pre === "vendor") return [
    "mixpanel-backed", "amplitude-backed", "newrelic-backed", "grafana-backed",
    "sprig-backed", "launchdarkly-backed", "highlight-backed",
  ].some((t) => item.tags.includes(t));
  if (pre === "privacy") return item.tags.includes("strengthens-privacy");
  if (pre === "waiting") return item.kind === "pr" && item.tags.includes("waiting-on-review");
  if (pre === "maintainer-close") return item.tags.includes("maintainer-close") || (item.who === "maintainer" && item.triage === "reject");
  if (pre === "done") return isDone(item);
  return true;
}

// Buckets OR together; narrowing filters AND with them. The Done view shows
// the marked rows on their own, whatever the pills say.
function matchesFilters(item, buckets = state.buckets, narrow = state.narrow) {
  if (state.view === "done") return isDone(item);
  if (buckets.size && !buckets.has(item.triage)) return false;
  for (const n of narrow) if (!matchesPre(item, n)) return false;
  return true;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return ITEMS.filter((item) => {
    if (!matchesFilters(item)) return false;
    if (state.view !== "done" && !state.showDone && isDone(item)) return false;
    if (state.kind !== "all" && item.kind !== state.kind) return false;
    if (state.who !== "all" && item.who !== state.who) return false;
    if (!matchesAssignee(item)) return false;
    if (!q) return true;
    const hay = [
      item.id, item.title, item.author, item.authorName, item.triage,
      ...item.labels, ...item.assignees,
      TRIAGE_LABEL[item.triage], item.next, item.reason, item.notes,
      item.downstream, item.message, ...(item.tags || []), ...(item.related || []),
      item.change ? changeLabel(item) : "",
      ...((item.downstreamLinks || []).map((l) => [l.label, l.note, l.url].join(" "))),
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function tagKey(item) {
  const ranked = (item.tags || []).map((t) => TAG_RANK[t] ?? 50);
  const min = ranked.length ? Math.min(...ranked) : 99;
  const names = (item.tags || []).map((t) => TAG_LABEL[t] || t).sort().join(",");
  return [min, names];
}

function sorted(list) {
  const out = list.slice();
  out.sort((a, b) => {
    if (state.sort === "recency") {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return b.id - a.id;
    }
    if (state.sort === "number") return b.id - a.id;
    if (state.sort === "triage") {
      const d = (TRIAGE_RANK[a.triage] ?? 9) - (TRIAGE_RANK[b.triage] ?? 9);
      if (d) return d;
      return b.id - a.id;
    }
    if (state.sort === "tags") {
      const [ar, an] = tagKey(a);
      const [br, bn] = tagKey(b);
      if (ar !== br) return ar - br;
      if (an !== bn) return an < bn ? -1 : 1;
      return b.id - a.id;
    }
    return 0;
  });
  return out;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function relatedUrl(id) {
  const hit = ITEMS.find((x) => x.id === id);
  if (hit) return hit.url;
  return "https://github.com/rrweb-io/rrweb/issues/" + id;
}

function cell(title, text) {
  const empty = !text;
  return `<div class="cell${empty ? " empty" : ""}"><h3>${esc(title)}</h3><p>${empty ? "None recorded." : esc(text)}</p></div>`;
}

function downstreamCell(item) {
  const links = item.downstreamLinks || [];
  const empty = !item.downstream && !links.length;
  const list = links.length
    ? `<ul class="ev-links">${links.map((l) =>
        `<li><a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.label)}</a>${l.note ? " — " + esc(l.note) : ""}</li>`
      ).join("")}</ul>`
    : "";
  const body = item.downstream
    ? `<p>${esc(item.downstream)}</p>${list}`
    : (list || `<p>None recorded.</p>`);
  return `<div class="cell${empty ? " empty" : ""}"><h3>Downstream evidence</h3>${body}</div>`;
}

function changeLabel(item) {
  if (item.change === "new") return "New since " + PREVIOUS_DATE;
  return "Moved from " + (TRIAGE_LABEL[item.movedFrom] || item.movedFrom);
}

function renderRow(item) {
  const tags = item.labels.map((l) =>
    `<span class="tag upstream-label" title="Label on GitHub">${esc(l)}</span>`
  ).join("") + (item.tags || []).map((t) =>
    `<span class="tag ${esc(t)}">${esc(TAG_LABEL[t] || t)}</span>`
  ).join("");
  const rel = (item.related || []).map((id) =>
    `<a href="${esc(relatedUrl(id))}" target="_blank" rel="noreferrer">#${id}</a>`
  ).join("");
  const review = item.kind === "pr"
    ? ` · ${esc(item.reviewDecision)}${item.draft ? " · draft" : ""}`
    : "";
  const msg = item.message
    ? `<button type="button" class="copy-msg" data-id="${item.id}" data-kind="${item.kind}">Copy message</button>
        <span class="msg-tip">${esc(item.message)}</span>`
    : "";
  const marked = isDone(item);
  return `<article class="row${marked ? " done" : ""}" data-id="${item.id}" data-kind="${item.kind}">
    <div class="row-top">
      <span class="kind">${item.kind === "pr" ? "PR" : "Issue"}</span>
      <span class="id"><a href="${esc(item.url)}" target="_blank" rel="noreferrer">#${item.id}</a></span>
      <span class="title">${esc(item.title)}</span>
      <span class="triage ${esc(item.triage)}">${esc(TRIAGE_LABEL[item.triage] || item.triage)}</span>
      ${item.change ? `<span class="tag change" title="Compared with the ${PREVIOUS_DATE} board">${esc(changeLabel(item))}</span>` : ""}
      <span class="row-actions">
        <button type="button" class="mark-done ghost${marked ? " done-on" : ""}" data-id="${item.id}" data-kind="${item.kind}">${marked ? "Undo" : "Done"}</button>
        ${msg ? `<span class="msg">${msg}</span>` : ""}
      </span>
    </div>
    <div class="sub">${esc(item.authorName || item.author)} (@${esc(item.author)}) · ${esc(item.whoLabel)} · updated ${fmtDate(item.updatedAt)} · opened ${fmtDate(item.createdAt)}${review} · ${item.assignees.length ? "assigned to " + item.assignees.map((a) => "@" + esc(a)).join(", ") : "unassigned"}</div>
    <div class="tags">${tags || '<span class="tag">No extra tags</span>'}</div>
    <div class="grid">
      ${downstreamCell(item)}
      ${cell("Reason", item.reason)}
      ${cell("Notes", item.notes)}
      ${cell("Suggested next step", item.next)}
    </div>
    ${rel ? `<div class="sub related" style="margin-top:8px">Related: ${rel}</div>` : ""}
  </article>`;
}

function matchesAssignee(item) {
  if (state.assignee === "all") return true;
  if (state.assignee === "none") return item.assignees.length === 0;
  return item.assignees.includes(state.assignee);
}

// What a pill would show: its own rows, under the other row's selection and the dropdowns.
function countWith(buckets, narrow, doneView = false) {
  return ITEMS.filter((item) => {
    if (doneView) { if (!isDone(item)) return false; }
    else {
      if (buckets.size && !buckets.has(item.triage)) return false;
      for (const n of narrow) if (!matchesPre(item, n)) return false;
      if (!state.showDone && isDone(item)) return false;
    }
    if (state.kind !== "all" && item.kind !== state.kind) return false;
    if (state.who !== "all" && item.who !== state.who) return false;
    if (!matchesAssignee(item)) return false;
    return true;
  }).length;
}

function renderFilters() {
  const pill = (cls, id, label, pressed, count, lead, style = "") =>
    `<button type="button" class="pill ${cls}" data-id="${id}" aria-pressed="${pressed}"${style ? ` style="${style}"` : ""}>${lead}${esc(label)}<span class="n">${count}</span></button>`;
  document.getElementById("buckets").innerHTML =
    `<span class="flabel">Bucket</span>` +
    BUCKETS.map((b) => pill("bucket", b.id, b.label, state.buckets.has(b.id),
      countWith(new Set([b.id]), state.narrow), `<i class="dot"></i>`, `--pill:${b.color}`)).join("");
  const anySelected = state.buckets.size || state.narrow.size;
  document.getElementById("narrows").innerHTML =
    `<span class="flabel">Narrow</span>` +
    NARROWS.map((n) => pill("narrow", n.id, n.label, state.narrow.has(n.id),
      countWith(state.buckets, new Set([...state.narrow, n.id])), icon(n.id))).join("") +
    (anySelected ? `<button type="button" class="pill clear" data-id="clear">${icon("clear")}Clear</button>` : "");
  document.getElementById("view-done").innerHTML =
    pill("view", "done", "Done rows", state.view === "done", countWith(null, null, true), icon("done"));
}

function render() {
  const list = sorted(filtered());
  renderFilters();
  document.getElementById("sorts").innerHTML =
    `<label>Sort</label>` +
    SORTS.map((s) =>
      `<button type="button" data-sort="${s.id}" class="${state.sort === s.id ? "active" : ""}">${esc(s.label)}</button>`
    ).join("");
  document.getElementById("meta-count").textContent =
    `${list.length} shown · ${doneCount()} ${!sharedDone ? "done in this browser" : sharedReadOnly ? "done by the team (view only)" : "done by the team"} · snapshot {{SNAPSHOT_DATE}}`;
  document.getElementById("board").innerHTML = list.length
    ? list.map(renderRow).join("")
    : `<p class="empty-board">No rows match these filters.</p>`;
}

function toggle(set, id) {
  if (set.has(id)) set.delete(id); else set.add(id);
}
function onFilterClick(e) {
  const btn = e.target.closest("button.pill");
  if (!btn) return;
  const id = btn.dataset.id;
  if (id === "clear") { state.buckets.clear(); state.narrow.clear(); }
  else if (id === "done") state.view = state.view === "done" ? "open" : "done";
  else if (btn.classList.contains("bucket")) toggle(state.buckets, id);
  else toggle(state.narrow, id);
  saveFilters();
  render();
}
document.getElementById("buckets").addEventListener("click", onFilterClick);
document.getElementById("narrows").addEventListener("click", onFilterClick);
document.getElementById("view-done").addEventListener("click", onFilterClick);
document.getElementById("sorts").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sort]");
  if (!btn) return;
  state.sort = btn.dataset.sort;
  saveFilters();
  render();
});
document.getElementById("kind").addEventListener("change", (e) => { state.kind = e.target.value; saveFilters(); render(); });
document.getElementById("who").addEventListener("change", (e) => { state.who = e.target.value; saveFilters(); render(); });
document.getElementById("assignee").innerHTML =
  `<option value="all">Anyone</option><option value="none">Unassigned</option>` +
  [...new Set(ITEMS.flatMap((i) => i.assignees))].sort().map((a) =>
    `<option value="${esc(a)}">@${esc(a)}</option>`
  ).join("");
document.getElementById("assignee").addEventListener("change", (e) => { state.assignee = e.target.value; render(); });
document.getElementById("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
document.getElementById("show-done").addEventListener("change", (e) => {
  state.showDone = e.target.checked;
  render();
});
document.getElementById("copy-done").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const lines = doneItems().map((item) =>
    `${item.kind === "pr" ? "PR" : "Issue"} ${item.id}  ${item.title}`
  );
  const text = lines.length ? lines.join("\n") : "None marked done.";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  btn.classList.add("copied");
  btn.textContent = "Copied";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = "Copy done IDs";
  }, 1400);
});
document.getElementById("board").addEventListener("click", async (e) => {
  const doneBtn = e.target.closest("button.mark-done");
  if (doneBtn) {
    const id = Number(doneBtn.dataset.id);
    const kind = doneBtn.dataset.kind;
    const item = ITEMS.find((x) => x.id === id && x.kind === kind);
    if (!item) return;
    setDone(item, !isDone(item));
    render();
    return;
  }
  const btn = e.target.closest("button.copy-msg");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const kind = btn.dataset.kind;
  const item = ITEMS.find((x) => x.id === id && x.kind === kind);
  if (!item || !item.message) return;
  try {
    await navigator.clipboard.writeText(item.message);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = item.message;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  btn.classList.add("copied");
  btn.textContent = "Copied";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = "Copy message";
  }, 1400);
});

loadFilters();
document.getElementById("kind").value = state.kind;
document.getElementById("who").value = state.who;
render();
connectShared();
</script>
</body>
</html>
"""


def render_html(items: list[dict]) -> str:
    # Escaping "</" keeps a title or message from closing the inline script.
    payload = json.dumps(items, ensure_ascii=False).replace("</", "<\\/")
    html = HTML_HEAD + "const PREVIOUS_DATE = {{PREVIOUS_DATE}};\n" + f"const ITEMS = {payload};\n" + HTML_TAIL
    previous_date = load_json(PREVIOUS)["taken"] if PREVIOUS.exists() else None
    return (
        html.replace("{{SNAPSHOT_DATE}}", load_json(SNAPSHOT)["taken"])
        .replace("{{PREVIOUS_DATE}}", json.dumps(previous_date))
    )


def artifact_html(html: str) -> str:
    """The same page for a claude.ai artifact, which supplies its own doctype,
    head and body, and lists pages by title."""
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
    head = re.sub(r'<meta (charset|name="viewport")[^>]*>\s*', "", head)
    head = re.sub(r"<title>.*?</title>", "<title>rrweb Intake Triage</title>", head)
    return head.strip() + "\n" + body.strip() + "\n"


def main() -> None:
    items = assemble()
    html = render_html(items)
    OUT_HTML.write_text(html)
    if "--artifact" in sys.argv:
        Path(sys.argv[sys.argv.index("--artifact") + 1]).write_text(artifact_html(html))
    prs = [i for i in items if i["kind"] == "pr"]
    issues = [i for i in items if i["kind"] == "issue"]
    print(f"Wrote {OUT_HTML} ({len(html)} bytes)")
    print(f"PRs {len(prs)}  issues {len(issues)}")
    from collections import Counter
    print("PR triage", dict(Counter(i["triage"] for i in prs)))
    print("Issue triage", dict(Counter(i["triage"] for i in issues)))
    print("Merge now", [i["id"] for i in prs if i["triage"] == "merge-now"])
    print("Adopt", sorted(i["id"] for i in prs if i["triage"] == "adopt"))
    print("PostHog-backed", sorted(i["id"] for i in items if "posthog-backed" in i["tags"] or "posthog-shipped" in i["tags"]))
    vendor_tags = (
        "mixpanel-backed", "amplitude-backed", "newrelic-backed", "grafana-backed",
        "sprig-backed", "launchdarkly-backed", "highlight-backed",
    )
    print("Other vendors", sorted(i["id"] for i in items if any(t in i["tags"] for t in vendor_tags)))
    print("Maintainer close", sorted(i["id"] for i in items if "maintainer-close" in i["tags"] or (i["who"] == "maintainer" and i["triage"] == "reject")))


if __name__ == "__main__":
    main()