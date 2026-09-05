#!/usr/bin/env python3
"""Build the self-contained intake triage board from the 2026-09-03 snapshot."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE_PRS = Path("/tmp/open-prs.json")
CACHE_ISSUES = Path("/tmp/open-issues.json")
OUT_HTML = ROOT / "index.html"

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
) -> None:
    PR[number] = {
        "triage": triage,
        "reason": reason,
        "notes": notes,
        "next": next_step,
        "tags": list(tags),
        "downstream": downstream,
        "related": list(related),
    }


# --- Merge now --------------------------------------------------------------
pr(
    1712,
    "merge-now",
    reason="console.log → warn. Two-line change. Justin and Eoghan both APPROVED.",
    next_step="Merge now. Review gate is already clear.",
    notes="Still open only because nobody pressed the button.",
    tags=("approved", "posthog-backed"),
    downstream="In PostHog production. Their own two-line warn fix (posthog-js 3765).",
)
pr(
    1656,
    "merge-now",
    reason="Vitest 1.6.1 CVE pin. Justin APPROVED; Eoghan earlier dismissed. DIRTY vs current tree.",
    next_step="Decide today: merge if the pin is still the intent, otherwise close and rebump vitest in a new PR.",
    notes="Request-clean-up substance, but it is one of two already-approved PRs.",
    tags=("approved",),
    downstream="No PostHog signal.",
)

# --- Community adopt --------------------------------------------------------
pr(
    1921,
    "adopt",
    reason="ignoreAttribute tagName case. Tests + changeset. Fixes 1916.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("waiting-on-review",),
    related=(1916,),
)
pr(
    1906,
    "adopt",
    reason="Regression tests only for CSS crash 1734/1692. Keep this; close 1735.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("waiting-on-review",),
    related=(1734, 1692, 1735, 1920),
)
pr(
    1905,
    "adopt",
    reason="Omit iframe srcdoc on rebuild. Fixes a race and stops the browser parsing attacker HTML into the iframe. rrdom already omits srcdoc.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("strengthens-privacy", "waiting-on-review"),
    related=(1736,),
)
pr(
    1904,
    "adopt",
    reason="Console plugin this binding. Fixes Chrome extension crash 1772.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("waiting-on-review",),
    related=(1772,),
)
pr(
    1903,
    "adopt",
    reason="repository.directory so npm README links resolve. Fixes 1738.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("waiting-on-review",),
    related=(1738,),
)
pr(
    1856,
    "adopt",
    reason="Who's using rrweb? logos. Verify the two names, then merge.",
    next_step="Spot-check the two new names, then approve + merge.",
    tags=("waiting-on-review",),
)
pr(
    1771,
    "adopt",
    reason="autocomplete=off during replay so the reviewer's browser does not prompt-fill passwords.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("strengthens-privacy", "waiting-on-review", "posthog-backed"),
    downstream="In PostHog fork. High-trust heathdutton patch listed as PostHog-adjacent.",
    related=(1315,),
)
pr(
    1769,
    "adopt",
    reason="One-line: emit custom events when seeking. Fixes 1666.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("waiting-on-review", "posthog-backed"),
    downstream="In PostHog fork. High-trust; they listed it as PostHog-adjacent.",
    related=(1666,),
)
pr(
    1737,
    "adopt",
    reason="image.currentSrc can be undefined. One-line guard.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("waiting-on-review", "posthog-backed"),
    downstream="On PostHog planned batch-2 stability list. Never executed as a later port.",
)
pr(
    1802,
    "adopt",
    reason="querySelector as untainted methods.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("waiting-on-review", "posthog-backed"),
    downstream="Already in PostHog's vendored rrweb.",
)

# --- Maintainer adopt -------------------------------------------------------
pr(
    1673,
    "adopt",
    reason="Safer media play/pause. Pair with community 1688; close Justin 1462.",
    next_step="Eoghan: rebase, green CI, merge.",
    related=(1688, 1462, 1798),
)
pr(
    1891,
    "adopt",
    reason="master → main leftover refs. Mechanical.",
    next_step="Justin: merge.",
)
pr(
    1732,
    "adopt",
    reason="Long-term sponsor recognition.",
    next_step="Justin: merge.",
)
pr(
    1697,
    "adopt",
    reason="Video autoplay should not unfreeze the page. PostHog already runs this.",
    next_step="Eoghan: merge. Take their Set hoist. Guard checkoutEveryNth/Nms or document that those options still unfreeze.",
    notes="PostHog ignored the checkout hole because they do not use checkout.",
    tags=("posthog-backed", "posthog-shipped"),
    downstream="Shipped in posthog-js 4131 (near-verbatim plus a Set hoist). Checkout timers can still unfreeze.",
)

# --- PostHog-promoted community review → adopt ------------------------------
pr(
    1688,
    "adopt",
    reason="Invalid media processing. Pair with Eoghan 1673; close Justin 1462 and community 1798.",
    next_step="Approve + merge after rebase. Close 1462 and 1798 in the same pass.",
    tags=("posthog-backed",),
    downstream="Already in PostHog's fork.",
    related=(1673, 1462, 1798),
)
pr(
    1691,
    "adopt",
    reason="Skip setAttribute when unchanged.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("posthog-backed",),
    downstream="Already in PostHog's fork.",
)
pr(
    1711,
    "adopt",
    reason="Inserting doctype.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("posthog-backed",),
    downstream="Already in PostHog's fork.",
)
pr(
    1770,
    "adopt",
    reason="Iframe cleanup in getUntaintedPrototype.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("posthog-backed",),
    downstream="Already in PostHog's fork.",
)
pr(
    1812,
    "adopt",
    reason="Always use native Proxy.",
    next_step="Approve + merge after rebase and green CI.",
    tags=("posthog-backed",),
    downstream="Next on PostHog batch-2 list after the July ports. Never executed as a later port; still in their fork.",
)
pr(
    1633,
    "adopt",
    reason="Untainted prototype access in Angular. Paul's own PR.",
    next_step="Nudge/merge. Already running in PostHog.",
    tags=("posthog-backed",),
    downstream="PostHog's own Angular untainted-prototype PR. In their fork.",
)
pr(
    1814,
    "adopt",
    reason="Untainted add/removeEventListener.",
    next_step="Nudge/merge. Already running in PostHog.",
    tags=("posthog-backed",),
    downstream="PostHog's own PR. In their fork.",
)

# --- Community review -------------------------------------------------------
pr(1920, "review", reason="Split _cssText on rule boundaries, not the middle of a rule. Related to 1692.", next_step="Assign one reviewer. Related to the CSS crash cluster; keep 1906 tests.", related=(1692, 1906))
pr(1917, "review", reason="adaptCssInTextMutations player option. Hover rewrite on style text mutations.", next_step="Assign one reviewer. Do not land together with 1897 and Eoghan 1480 — pick one hover approach.", notes="Hover / pseudo-class cluster.", related=(1897, 1480))
pr(1897, "review", reason="More pseudo-classes on rebuild. Replay quality buyers notice.", next_step="Assign one reviewer. Team still picks 1897 / 1917 / 1480.", tags=("commercial",), related=(1896, 1917, 1480))
pr(1796, "review", reason="Preserve class attribute text in hoverElements for [class=\"…\"] selectors.", next_step="Assign one reviewer.")
pr(1733, "review", reason="absolutifyURLs edge cases. DIRTY. Eoghan requested changes.", next_step="Author owes the perf/implementation fix. Do not re-review from scratch.", tags=("changes-requested",))
pr(1718, "review", reason="rrdom oldChild detach.", next_step="Assign one reviewer.")
pr(1681, "review", reason=":hover regex too large (1675). Tests exist; also listed under clean-up for a changeset.", next_step="Add changeset, then review. Fixes 1675.", related=(1675,))
pr(1641, "review", reason="Preserve adopted styles when nodes are removed (virtual DOM).", next_step="Assign one reviewer. PostHog listed this as a nudge, not a free merge.", tags=("posthog-nudge",), downstream="PostHog wants tests; not treated as pre-reviewed.")
pr(1638, "review", reason="Parent missing during record/playback. Also listed under clean-up as untested.", next_step="Needs an explanation and tests before a real review.", related=())
pr(1635, "review", reason="Iframes + custom elements in Chrome.", next_step="Needs a browser regression test. PostHog nudge, not a free merge.", tags=("posthog-nudge",), downstream="On PostHog's own open-PR nudge list.")
pr(1586, "review", reason="Chrome grid-template inlining (1395).", next_step="Assign one reviewer.", related=(1395,))
pr(1357, "review", reason="Inserted styles lost when moving elements. Eoghan requested changes.", next_step="Author: isolate the fix; drop the innerText reflow cost.", tags=("changes-requested",))
pr(1814, "adopt", reason="Untainted add/removeEventListener.", next_step="Nudge/merge. Already running in PostHog.", tags=("posthog-backed",), downstream="PostHog's own PR. In their fork.")
pr(1755, "review", reason="Clear mutation buffer on iframe pagehide.", next_step="Review with 1791 as one iframe-lifecycle change. PostHog wants them folded together.", tags=("posthog-nudge",), downstream="PostHog: fold into a combined iframe-lifecycle PR with 1791.", related=(1791, 1770))
pr(1791, "review", reason="Iframe memory leaks. DIRTY. Related 1585/1628.", next_step="Do not adopt from the PostHog fork — they solved it differently. Review this branch on its own or fold with 1755.", tags=("posthog-in-fork",), downstream="In PostHog's fork but they solved the leak differently. Not their code.", related=(1585, 1628, 1755, 1770))
pr(1356, "review", reason="Native setTimeout under zone.js. Justin requested changes.", next_step="Author owes the revision. Do not promote on PostHog's review — they declined.", tags=("changes-requested", "posthog-declined", "impacts-privacy"), downstream="PostHog declined: they have their own Zone path.")
pr(1463, "review", reason="Patched toString returns original. Detection-adjacent; still a correctness fix for apps that inspect native code.", next_step="Assign one reviewer. Weak stealth adjacency — read the privacy note.", tags=("impacts-privacy",), downstream="On PostHog planned batch-2 list; never executed.")
pr(1873, "review", reason="Native attributeFilter on MutationObserver. Can drop sensitive attribute mutations or drop the mutations masking depends on.", next_step="Privacy review required even though PostHog shipped a port. Fold in shadow bypassOptions + treat [] as unset.", tags=("impacts-privacy", "posthog-shipped"), downstream="Shipped posthog-js 4129. At port time: shadow roots were not filtered; empty [] observed no attributes. No later attributeFilter bugfix.")
pr(1373, "review", reason="Allow maskTextClass/blockClass: null to skip default class matching. Perf opt-out that disables a privacy default.", next_step="Privacy read required. Tiny and mergeable, but do not promote on PostHog's review — they declined.", tags=("impacts-privacy", "posthog-declined"), downstream="PostHog declined: unreachable under their hard-coded classes.")
pr(1726, "review", reason="emitFromIframe for nested iframes. More collection surface.", next_step="Assign one reviewer. Collection-surface change.", tags=("impacts-privacy",))
pr(1336, "review", reason="Packer compression level. Storage cost.", next_step="Assign one reviewer.", tags=("commercial",))
pr(1469, "review", reason="Wrap canvas bitmap errors in callbackWrapper.", next_step="Confirm it is still wanted; was on PostHog 3765 adopt-high. Needs tests or a cluster decision.", tags=("posthog-nudge",), downstream="On PostHog 3765 adopt-high; confirm still open and still wanted.")
pr(1907, "review", reason="Replay mutation DOMException / rrdom swallow.", next_step="Eoghan: review the replay cluster (1907, 1740, 1697, 1320, 1830, 1784, 1694).", related=(88,))
pr(1830, "review", reason="Canvas without recordCanvas must still affect layout. DIRTY.", next_step="Eoghan: review in the replay cluster.")
pr(1784, "review", reason="Strip postcss from record.js. Bundle-size win. Justin requested changes on Eoghan.", next_step="Maintainer-on-maintainer. Finish the thread.", tags=("commercial", "changes-requested"))
pr(1740, "review", reason="CDATA rebuild throw.", next_step="Eoghan: review in the replay cluster.")
pr(1694, "review", reason="Mutation emission throttle. Smaller than 1652.", next_step="Review independently. Do not promote on PostHog's review — they declined.", tags=("commercial", "posthog-declined"), downstream="PostHog declined: they already have SDK MutationThrottler; upstream wraps the same emit() checkout uses.")
pr(1320, "review", reason="500ms stylesheet timeout.", next_step="Eoghan: review in the replay cluster.")

# --- Discuss ----------------------------------------------------------------
pr(1914, "discuss", reason="Heatmap / click-track plugin. Extra semantic click payload (selector/text). PII in button labels.", next_step="Team meeting. Do not merge from the thread.", tags=("impacts-privacy", "commercial"))
pr(1900, "discuss", reason="Records alert/confirm/prompt. prompt() is often credentials or PII.", next_step="Team meeting. Completeness vs PII.", tags=("impacts-privacy", "commercial"))
pr(1909, "discuss", reason="Extension upload to api.rrweb.com with a stored bearer token. Data leaves the machine. Draft.", next_step="Team meeting with 1908. Close unless Cloud upload is a 2.x goal.", tags=("impacts-privacy", "commercial"), related=(1908,))
pr(1908, "discuss", reason="Chrome Web Store publish recovery. Pairs with 1909.", next_step="Team meeting with 1909.", tags=("commercial",), related=(1909,))
pr(1861, "discuss", reason="Cloud-bound sequence IDs / browser-client defaults.", next_step="Team meeting. Product + privacy defaults (maskAllInputs: true already in this repository).", tags=("impacts-privacy", "commercial"), related=(1848,))
pr(1848, "discuss", reason="Browser-client next release + assets. UNSTABLE draft.", next_step="Team meeting with 1475/1861. Do not land as-is.", tags=("impacts-privacy", "commercial"), related=(1475, 1861, 1239))
pr(1475, "discuss", reason="Asset events capture image/media bytes. Retention and PII-in-images. Successor to Justin 1239.", next_step="Team meeting. Close Justin draft 1239.", tags=("impacts-privacy", "commercial"), related=(1239, 1848, 860))
pr(1046, "discuss", reason="WebRTC streaming of <video>. Live biometric / meeting content. Draft, stale.", next_step="Close unless live video is a 2.x goal. Also a maintainer-close candidate.", tags=("impacts-privacy", "commercial", "maintainer-close"))
pr(1465, "discuss", reason="Parent forces a snapshot in a cross-origin iframe via postMessage. Eoghan requested changes.", next_step="Author + testcase needed. Security-origin discussion.", tags=("impacts-privacy", "changes-requested"))
pr(1023, "discuss", reason="Inject recorder from another frame / custom Window. Changes the security origin story.", next_step="Team meeting. Preferable to Eoghan 294 if this is needed at all.", tags=("impacts-privacy",), related=(294,))
pr(1739, "discuss", reason="Records attachShadow({mode:'closed'}). Closed shadow was an isolation boundary.", next_step="Team meeting. High replay-fidelity win, real privacy/ToS issue.", tags=("impacts-privacy", "commercial"))
pr(1877, "discuss", reason="Changeset compress. Process, not product.", next_step="Agenda: process decision, not a code review.")
pr(1871, "discuss", reason="inlineStylesheet / inlineImages not deprecated. Ties to assets. Draft.", next_step="Discuss with the assets decision (1475).", tags=("impacts-privacy",), related=(1475,))
pr(1652, "discuss", reason="Large mutation-ordering refactor. Tests are good; blast radius is not a solo review.", next_step="Team meeting. Fold 1653/1300/1302 into this or land 1302 separately.", tags=("commercial",), related=(1653, 1300, 1302))
pr(1483, "discuss", reason="<link rel=stylesheet> + mutations. Collides with 1917/1897. Draft.", next_step="Team picks one hover/stylesheet approach.", related=(1917, 1897, 1480))
pr(1480, "discuss", reason="Hover rewrite via stylesheet mutation. Same collision. Draft.", next_step="Team picks 1897 / 1917 / 1480.", related=(1897, 1917, 1483))
pr(1015, "discuss", reason="Split monkeypatching into rrweb-init.js. Draft. Also a close-if-abandoned candidate.", next_step="Discuss isolation model, or close the stale draft.", tags=("impacts-privacy", "maintainer-close"))
pr(661, "discuss", reason="Rename rrweb-player → rrweb-playback-ui. 3.0.", next_step="Agenda for a 3.0 naming pass, not a drive-by merge.")
pr(1892, "discuss", reason="Plugin dependency metadata / host-neutral ReplayPlugin. DIRTY.", next_step="Team meeting. Plugin contract.")
pr(1874, "discuss", reason="Vite+ migration experiment. DIRTY draft. Close unless this is the 2.x tooling bet.", next_step="Decide yes/no. Maintainer-close candidate if not the tooling bet.", tags=("maintainer-close",))
pr(1843, "discuss", reason="yarn → pnpm. 158k-line lockfile.", next_step="Decide yes/no. Do not leave it open.")
pr(1839, "discuss", reason="Split snapshot utils. Codex-sized.", next_step="Team meeting. Scope / split.")
pr(1828, "discuss", reason="Next prerelease channel plan. Draft.", next_step="Team meeting with the 2.0 discussion.", tags=("commercial",), related=(1671, 1664))
pr(1800, "discuss", reason="allowedIframeOrigins allowlist. This is the security model to decide.", next_step="Agenda item. Prefer this over 1679 and 1256.", tags=("strengthens-privacy",), related=(1679, 1256, 1680))
pr(1642, "discuss", reason="blockElementFN whitelist/strict blocking. Enterprise control. Conflicts with privacy-at-capture selectors.", next_step="Discuss against the policy API. Do not land as a parallel knob.", tags=("strengthens-privacy", "commercial", "privacy-overlap"), related=(1644,))
pr(1257, "discuss", reason="Generic maskAttributesFn. Needed by PostHog-class vendors. Overlaps SENSITIVE_ATTRIBUTES / maskAttributeFn.", next_step="Do not land a second API if privacy-at-capture goes upstream.", tags=("strengthens-privacy", "commercial", "privacy-overlap"), related=(1581,))
pr(1164, "discuss", reason="Masks option/radio/checkbox values. Yun requested changes. Correct instinct; fold into the policy.", next_step="Author revision, then discuss as part of the masking API — not a one-off.", tags=("strengthens-privacy", "privacy-overlap", "changes-requested"))
pr(1097, "discuss", reason="Text-masking should apply to inputs; maskInputFn skipped on full snapshot.", next_step="Discuss with 874/1385/1488. Same hole, several reports.", tags=("strengthens-privacy", "privacy-overlap"), related=(874, 1385, 1488))
pr(1149, "discuss", reason="@rrweb/cutter + sync replayer. Huge, DIRTY, TODOs. Session clip is commercially real; this PR is not reviewable as-is.", next_step="Yun: split or close and re-file.", tags=("commercial",), related=(398, 160, 1560))

# --- Cleanup ----------------------------------------------------------------
pr(1912, "cleanup", reason="Masks placeholder when input masking is on. Real PII leak. This repository already treats placeholder as sensitive; upstream main does not.", next_step="Add changeset, rebase, then re-evaluate against privacy-at-capture. Do not land as a parallel knob.", tags=("strengthens-privacy", "privacy-overlap"))
pr(1745, "cleanup", reason="maskAllInputs currently omits hidden. Tokens, CSRF, internal IDs leak. Fresher copy of 1610.", next_step="Add changeset and rebase. Close 1610. Re-evaluate against privacy-at-capture.", tags=("strengthens-privacy", "privacy-overlap"), related=(1610, 1609))
pr(1766, "cleanup", reason="Optional CSP on the replay iframe. Complements sandbox ADR.", next_step="Add tests, changeset, and a browser-support note.", tags=("strengthens-privacy",))
pr(1686, "cleanup", reason="stringifyRule fallback.", next_step="Needs a failing CSS-import test. PostHog nudge.", tags=("posthog-nudge",), downstream="On PostHog's own open-PR nudge list.")
pr(1313, "cleanup", reason="hookSetter recursion.", next_step="Add a reproduction. On PostHog planned batch-2; never executed.", downstream="PostHog batch-2 candidate; no later production write-up.")
pr(1879, "cleanup", reason="Svelte browser runtime. Likely superseded by merged 1901.", next_step="Confirm 1901 covered it, then close or rebase leftover.")
pr(1768, "cleanup", reason="Copilot timeout math. 27 files; needs a human to strip noise.", next_step="Try clean-up once, then reject if silent.")
pr(1748, "cleanup", reason="Broken docs links. DIRTY. One docs PR can replace 1748/1744/1709.", next_step="Close in favor of one new docs PR.", related=(1744, 1709))
pr(1744, "cleanup", reason="Docs guide wording. DIRTY. Fold into one docs PR.", next_step="Close in favor of one new docs PR.", related=(1748, 1709))
pr(1709, "cleanup", reason="Docs link rot. DIRTY. Fold into one docs PR.", next_step="Close in favor of one new docs PR.", related=(1748, 1744))
pr(1722, "cleanup", reason="REPL script “security.” Chinese-only, no tests.", next_step="Rewrite in English with tests, or close. Try clean-up once, then reject if silent.")
pr(1676, "cleanup", reason="Handle frames.", next_step="Labeled testcase needed.")
pr(1624, "cleanup", reason="Iframe parent workaround.", next_step="Needs a failing test.")
pr(1616, "cleanup", reason="Merge events. Draft. Needs design (see issue 1560).", next_step="Wait on the cutter/clip discussion.", related=(1560, 1149))
pr(1448, "cleanup", reason="Worker package for canvas/off-main-thread. Stale.", next_step="Rebase or extract the canvas-worker bugfix only.", tags=("commercial",))
pr(1439, "cleanup", reason="Smooth-scroll Y lag.", next_step="Needs a test.")
pr(1428, "cleanup", reason="Canvas inside iframe/shadow. More pixels. Best of the cluster.", next_step="Rebase. Close 1413 and 1235.", tags=("impacts-privacy",), related=(1413, 1235))
pr(1392, "cleanup", reason="Protocol URL regex. DIRTY, tiny.", next_step="Rebase the one-liner or close and re-file.")
pr(1212, "cleanup", reason="Custom mask selector / maskTextFn improvements. Stale, DIRTY.", next_step="Rebase onto the privacy discussion. Do not land as a parallel knob.", tags=("strengthens-privacy", "privacy-overlap"))
pr(815, "cleanup", reason="skipActivity on setConfig.", next_step="Testcase needed.")
pr(1302, "cleanup", reason="addList perf / addedSet order. Draft. 7-line fix PostHog already shipped.", next_step="Optional same-day: land this instead of waiting on 1652. Keep has→delete→add. Also take PostHog 4697 empty-payload reset (still missing in this tree).", tags=("posthog-shipped",), downstream="Shipped posthog-js 4130. They almost diverged to Set.delete; reverted to upstream has→delete→add. Later 4697: empty-payload early return skips addedSet/droppedSet reset — still present here.", related=(1652, 1300))
pr(1300, "cleanup", reason="addList perf sibling of 1302. Draft. Fold into 1652.", next_step="Fold into 1652 or close in favor of 1302.", related=(1652, 1302))
pr(1290, "cleanup", reason="rrvideo Chrome launch options.", next_step="Ask for rebase + why, or close.")
pr(960, "cleanup", reason="Custom event in checkout count. Draft, 4 lines, 2022.", next_step="Land the four lines or close as abandoned.")
pr(863, "cleanup", reason="Save/view snapshot scripts. Better as a recipe than a package dump.", next_step="Move to a recipe or close.")
pr(768, "cleanup", reason="Dynamic inline-style URLs. Eoghan requested changes. Very stale.", next_step="Author: rebase onto current transform utilities. Very stale — close if silent.", tags=("changes-requested",))
pr(1730, "cleanup", reason="rrdom-to-html trim. Rare CLEAN status; still needs a why.", next_step="Eoghan: add the why or close.")
pr(1653, "cleanup", reason="Micro perf. Fold into 1652 or drop.", next_step="Fold into 1652 or close.", related=(1652,))
pr(1534, "cleanup", reason="Export isBlocked. Lets hosts implement their own policy; easy to misuse. Draft.", next_step="Decide whether exporting the predicate is the API, then rebase.", tags=("impacts-privacy",))
pr(1466, "cleanup", reason="History-change tests only. Draft.", next_step="Land if they pass.")
pr(1322, "cleanup", reason="Failing CSS shorthand test. Draft.", next_step="Make it an issue, not a red PR.")
pr(1140, "cleanup", reason="Scrub-to-zero. Split unrelated pointer-event changes.", next_step="Split, then review.")
pr(1875, "cleanup", reason="Prefer minified CDN ESM. Docs. Eoghan requested changes on Justin.", next_step="Justin: address or close.", tags=("changes-requested",))
pr(1841, "cleanup", reason="Changelog backfill. DIRTY.", next_step="Rebase or close.")
pr(1811, "cleanup", reason="CI / changeset / fork-comment plumbing.", next_step="Squash with 1810/1809/1792/1789 into one hygiene PR.", related=(1810, 1809, 1792, 1789))
pr(1810, "cleanup", reason="CI / changeset plumbing.", next_step="Squash into one hygiene PR with 1811/1809/1792/1789.", related=(1811, 1809, 1792, 1789))
pr(1809, "cleanup", reason="Fork-comment plumbing.", next_step="Squash into one hygiene PR with 1811/1810/1792/1789.", related=(1811, 1810, 1792, 1789))
pr(1792, "cleanup", reason="Turbo outputs. Tiny, behind.", next_step="Squash into one hygiene PR.", related=(1811, 1810, 1809, 1789))
pr(1789, "cleanup", reason="tsconfig bundler. Tiny, behind.", next_step="Squash into one hygiene PR.", related=(1811, 1810, 1809, 1792))
pr(1790, "cleanup", reason="Privacy recipe docs. Author notes they were not verified.", next_step="Rewrite against the privacy-at-capture policy, then merge.", tags=("strengthens-privacy", "privacy-overlap"))

# --- Reject -----------------------------------------------------------------
pr(1610, "reject", reason="Exact older duplicate of 1745.", next_step="Close in favor of 1745. The hidden-input bug remains.", tags=("strengthens-privacy",), related=(1745, 1609), notes="Keep 1745.")
pr(1798, "reject", reason="Weaker duplicate of 1688.", next_step="Close in favor of 1688 + Eoghan 1673.", related=(1688, 1673))
pr(1735, "reject", reason="Crash already handled by merged 1580 / 1600. Keep regression-only 1906.", next_step="Close. Point at 1906 and split-point 1920.", related=(1906, 1920, 1734, 1692))
pr(1679, "reject", reason="Sender-origin is not validated; narrower than 1800.", next_step="Close in favor of the 1800 allowlist if that is the chosen model.", tags=("strengthens-privacy",), related=(1800, 1256, 1680))
pr(1256, "reject", reason="Earlier safeCrossOrigin sketch. Superseded by 1800.", next_step="Close in favor of 1800.", related=(1800, 1679))
pr(1413, "reject", reason="Superseded by 1428.", next_step="Close in favor of 1428.", tags=("posthog-in-fork",), downstream="In PostHog fork — do not adopt from that fact.", related=(1428, 1235))
pr(1235, "reject", reason="Superseded by 1428. Also mixes unrelated player changes.", next_step="Close in favor of 1428.", related=(1428, 1413))
pr(1259, "reject", reason="Dependabot against an ancient lockfile.", next_step="Close. Refresh in a new PR if the advisory still applies.")
pr(1255, "reject", reason="Dependabot against an ancient lockfile.", next_step="Close. Refresh in a new PR if the advisory still applies.")
pr(1238, "reject", reason="Dependabot against an ancient lockfile.", next_step="Close. Refresh in a new PR if the advisory still applies.")
pr(1416, "reject", reason="waiting-for-more-info, no author follow-up.", next_step="Close.")
pr(549, "reject", reason="No info since 2021.", next_step="Close as abandoned.")
pr(1477, "reject", reason="Stale pre-commit prettier. Close; re-file repo-wide if wanted.", next_step="Eoghan: close.", tags=("maintainer-close",))
pr(724, "reject", reason="__sn / iframe id; unreproducible, mirror replaced it.", next_step="Eoghan: close.", tags=("maintainer-close", "posthog-in-fork"), downstream="In PostHog fork — do not adopt from that fact. We already reject.")
pr(558, "reject", reason="Timestamp ordering; no reliable tests, later pipelines ate it.", next_step="Eoghan: close.", tags=("maintainer-close",), downstream="On PostHog planned batch-2; do not adopt. We already reject.")
pr(389, "reject", reason="Destructor against the old snapshot repo. Redesign if still needed.", next_step="Eoghan: close.", tags=("maintainer-close",))
pr(294, "reject", reason="window.top / window.top.document. Cross-frame privilege grab. Six years stale.", next_step="Eoghan: close.", tags=("maintainer-close", "impacts-privacy"))
pr(1462, "reject", reason="Media-target bug; superseded by Eoghan 1673 + community 1688.", next_step="Justin: close.", tags=("maintainer-close", "posthog-in-fork"), downstream="In PostHog fork — do not adopt from that fact.", related=(1673, 1688))
pr(1239, "reject", reason="Asset events v1. Eoghan already pointed review at 1475.", next_step="Justin: close in favor of Eoghan 1475.", tags=("maintainer-close", "impacts-privacy", "commercial", "changes-requested"), related=(1475,))


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
) -> None:
    ISSUE[number] = {
        "triage": triage,
        "reason": reason,
        "notes": notes,
        "next": next_step,
        "tags": list(tags),
        "downstream": downstream,
        "related": list(related),
    }


issue(1916, "adopt", reason="Fixed by PR 1921.", next_step="Merge PR 1921, then close.", related=(1921,))
issue(1772, "adopt", reason="Fixed by PR 1904.", next_step="Merge PR 1904, then close.", related=(1904,))
issue(1738, "adopt", reason="Fixed by PR 1903.", next_step="Merge PR 1903, then close.", related=(1903,))
issue(1736, "adopt", reason="Fixed by PR 1905.", next_step="Merge PR 1905, then close.", tags=("strengthens-privacy",), related=(1905,))
issue(1666, "adopt", reason="Fixed by PR 1769.", next_step="Merge PR 1769, then close.", related=(1769,))
issue(1609, "adopt", reason="Hidden-input leak. Merge 1745, not 1610.", next_step="Merge PR 1745 (not 1610), then close.", tags=("strengthens-privacy",), related=(1745, 1610))
issue(1315, "adopt", reason="Fixed by PR 1771.", next_step="Merge PR 1771, then close.", tags=("strengthens-privacy",), related=(1771,))
issue(1680, "adopt", reason="Cross-origin iframe origins. Land 1800, not 1679.", next_step="Land 1800’s allowlist after the security discussion, then close.", tags=("strengthens-privacy",), related=(1800, 1679))
issue(1675, "adopt", reason=":hover regex overflow. PR 1681.", next_step="Merge PR 1681 after changeset, then close.", related=(1681,))
issue(1734, "adopt", reason="CSS crash already handled by merged 1580/1600.", next_step="Close against merged 1580/1600; keep tests 1906 and split-point PR 1920.", related=(1692, 1906, 1920, 1735))
issue(1692, "adopt", reason="CSS crash already handled by merged 1580/1600.", next_step="Close against merged 1580/1600; keep tests 1906 and split-point PR 1920.", related=(1734, 1906, 1920, 1735))
issue(874, "adopt", reason="Has PR 1097. Same masking hole as 1385/1488.", next_step="Do not close until the masking discussion lands.", tags=("strengthens-privacy",), related=(1097, 1385, 1488))

issue(1919, "review", reason="Blocked <img> still pays the full inlineImages encode. Block is a privacy control; encoding the bytes anyway is a leak plus a perf bug.", next_step="Assign an owner. Privacy + commercial.", tags=("strengthens-privacy", "commercial"))
issue(1881, "review", reason="Canvas mutations in same-origin iframes.", next_step="Assign an owner.", tags=("impacts-privacy", "commercial"))
issue(1816, "review", reason="<select> wrong during forward play, right on seek.", next_step="Assign an owner. Repro-able replay bug.")
issue(1786, "review", reason="UMD global inconsistency.", next_step="Assign an owner.", tags=("commercial",))
issue(1785, "review", reason="Record bundle size.", next_step="Assign an owner.", tags=("commercial",), related=(1742,))
issue(1742, "review", reason="Record bundle size.", next_step="Assign an owner.", tags=("commercial",), related=(1785,))
issue(1724, "review", reason="Web-extension broken.", next_step="Assign an owner.", tags=("commercial",))
issue(1720, "review", reason="Cross-origin iframe blanks after parent fullSnapshot.", next_step="Assign an owner.")
issue(1707, "review", reason="Memory/CPU on rel=preload links.", next_step="Assign an owner.")
issue(1701, "review", reason="Popover API. Modern UI fidelity.", next_step="Assign an owner.", tags=("commercial",))
issue(1690, "review", reason="Mobile DOM order.", next_step="Assign an owner.")
issue(1667, "review", reason="background shorthand expands empty. Related CSSOM bugs.", next_step="Assign an owner.")
issue(1628, "review", reason="Stop-recording / iframe leaks. Pair with PR 1791/1770.", next_step="Pair with PR 1791/1770.", related=(1585, 1791, 1770))
issue(1585, "review", reason="Iframe leaks. Pair with PR 1791/1770.", next_step="Pair with PR 1791/1770.", related=(1628, 1791, 1770))
issue(1626, "review", reason="Adopted stylesheets missing from first full snapshot.", next_step="Assign an owner.", related=(1567,))
issue(1567, "review", reason="Adopted stylesheets missing from first full snapshot.", next_step="Assign an owner.", related=(1626,))
issue(1577, "review", reason="Duplicate cross-origin message listeners.", next_step="Assign an owner.", tags=("impacts-privacy",), related=(1590,))
issue(1590, "review", reason="Duplicate cross-origin message listeners.", next_step="Assign an owner.", tags=("impacts-privacy",), related=(1577,))
issue(1564, "review", reason="Table alignment in replay.", next_step="Assign an owner.")
issue(1505, "review", reason="all: unset expansion.", next_step="Assign an owner.")
issue(1488, "review", reason="maskInputFn skipped.", next_step="Same hole as 1097 / 1385.", tags=("strengthens-privacy",), related=(1097, 1385, 874))
issue(1385, "review", reason="maskInputFn skipped.", next_step="Same hole as 1097 / 1488.", tags=("strengthens-privacy",), related=(1097, 1488, 874))
issue(1395, "review", reason="Grid template areas. PR 1586.", next_step="Review PR 1586.", related=(1586,))
issue(816, "review", reason="Strict CSP vs style mutation. 34 comments, still open.", next_step="Keep open. Security of the recorded app.", tags=("strengthens-privacy",))
issue(423, "review", reason="Inline/blob workers vs CSP.", next_step="Keep open with 1699.", tags=("strengthens-privacy",), related=(1699,))
issue(1699, "review", reason="Inline/blob workers vs CSP.", next_step="Keep open with 423.", tags=("strengthens-privacy",), related=(423,))
issue(88, "review", reason="removeChild DOMException. Ancient, 17 comments; may already be PR 1907.", next_step="Check whether PR 1907 covers it before closing.", related=(1907,))

issue(1918, "discuss", reason="inlineImages encodes full natural resolution with no cap. Retention cost and high-res PII.", next_step="Team meeting.", tags=("impacts-privacy", "commercial"))
issue(1913, "discuss", reason="UNSAFE_replayCanvas adds allow-scripts. Documented unsafe, still a footgun.", next_step="Answer with the sandbox ADR, then close or turn into implement-the-ADR.", tags=("impacts-privacy",), related=(1817,))
issue(1899, "discuss", reason="Replay pre-process plugins.", next_step="Team meeting.", tags=("commercial",))
issue(1896, "discuss", reason="More pseudo-classes. PR 1897.", next_step="Decide with PR 1897.", tags=("commercial",), related=(1897,))
issue(1880, "discuss", reason="Record a subtree only. Can strengthen privacy (less capture) and is commercially useful for widgets.", next_step="Team meeting with 1659 / 111.", tags=("impacts-privacy", "commercial"), related=(1659, 111))
issue(1659, "discuss", reason="Record a subtree only.", next_step="Team meeting with 1880 / 111.", tags=("impacts-privacy", "commercial"), related=(1880, 111))
issue(111, "discuss", reason="Record a subtree only.", next_step="Team meeting with 1880 / 1659.", tags=("impacts-privacy", "commercial"), related=(1880, 1659))
issue(1817, "discuss", reason="Rebuild may execute scripts. This repo already has the sandboxed-rebuild ADR.", next_step="Answer with the sandbox ADR.", tags=("impacts-privacy",), related=(1913,))
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
issue(1337, "discuss", reason="Full snapshot perf.", next_step="Team meeting. Related to 1694 / 1547.", tags=("commercial",), related=(1694, 1547))
issue(1547, "discuss", reason="Snapshot / mutation perf. Related to PR 1694.", next_step="Review with PR 1694.", tags=("commercial",), related=(1694, 1337))
issue(1143, "discuss", reason="Web Animations API.", next_step="Team meeting.", tags=("commercial",))
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
    "draft": 13,
    "maintainer": 14,
    "community": 15,
    "bulk-updated": 16,
}


def load_json(path: Path):
    return json.loads(path.read_text())


def who_of(login: str) -> tuple[str, str]:
    if login in MAINTAINERS:
        return "maintainer", MAINTAINERS[login]
    return "community", "Community"


def assemble() -> list[dict]:
    prs = load_json(CACHE_PRS)
    issues = load_json(CACHE_ISSUES)
    items: list[dict] = []
    missing_prs = []

    for raw in prs:
        n = raw["number"]
        overlay = PR.get(n)
        if overlay is None:
            missing_prs.append(n)
            overlay = {
                "triage": "review",
                "reason": "Open at snapshot; not given a dedicated row in the first-pass tables.",
                "notes": "",
                "next": "Skim title and files; then bucket.",
                "tags": [],
                "downstream": "",
                "related": [],
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
        for lab in raw.get("labels") or []:
            name = lab if isinstance(lab, str) else lab.get("name")
            if name and name not in tags:
                tags.append(name)
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
                "related": overlay["related"],
                "additions": raw.get("additions"),
                "deletions": raw.get("deletions"),
                "changedFiles": raw.get("changedFiles"),
                "mergeable": raw.get("mergeable"),
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
            }
        login = (raw.get("author") or {}).get("login") or "unknown"
        who_kind, who_label = who_of(login)
        tags = list(overlay["tags"])
        tags.append("maintainer" if who_kind == "maintainer" else "community")
        if (raw.get("updatedAt") or "").startswith("2026-06-08"):
            tags.append("bulk-updated")
        for lab in raw.get("labels") or []:
            name = lab if isinstance(lab, str) else lab.get("name")
            if name and name not in tags:
                tags.append(name)
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
                "related": overlay["related"],
                "additions": None,
                "deletions": None,
                "changedFiles": None,
                "mergeable": None,
            }
        )

    items.sort(key=lambda x: (0 if x["kind"] == "pr" else 1, -x["id"]))
    return items


HTML_HEAD = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>rrweb intake triage — 2026-09-03</title>
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
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.45 "IBM Plex Sans", "Source Sans 3", "Segoe UI", sans-serif; }
  a { color: #e8c56a; }
  a:hover { color: #ffe08a; }
  header.page {
    padding: 22px 28px 10px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, #191c13 0%, var(--bg) 100%);
    position: sticky; top: 0; z-index: 20;
  }
  h1 { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 6px; }
  .lede { color: var(--muted); max-width: 920px; margin: 0 0 14px; }
  .prefilters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  .prefilters button {
    appearance: none; border: 1px solid var(--line); background: var(--bg-2);
    color: var(--ink); padding: 7px 12px; border-radius: 999px; cursor: pointer;
    font: inherit; display: inline-flex; align-items: center; gap: 8px;
  }
  .prefilters button .n { background: var(--chip); color: var(--muted); padding: 1px 7px;
    border-radius: 999px; font-size: 12px; }
  .prefilters button.active { border-color: var(--accent); background: #2a2410; color: #ffe08a; }
  .prefilters button[data-filter="merge-now"].active { box-shadow: inset 0 0 0 1px var(--merge); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 8px; }
  .toolbar label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  select, input[type="search"] {
    background: var(--bg-2); color: var(--ink); border: 1px solid var(--line);
    border-radius: 8px; padding: 6px 10px; font: inherit;
  }
  input[type="search"] { min-width: 220px; }
  .sorts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .sorts button {
    appearance: none; border: 1px solid var(--line); background: var(--bg-3);
    color: var(--ink); padding: 5px 10px; border-radius: 6px; cursor: pointer; font: inherit;
  }
  .sorts button.active { border-color: var(--accent-2); color: var(--accent-2); }
  .meta { color: var(--muted); font-size: 12px; margin: 4px 0 0; }
  main { padding: 16px 28px 80px; }
  .row {
    background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 14px 10px; margin: 0 0 8px;
  }
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
  .tag.strengthens-privacy { color: #b8f0d4; border-color: #3d6b55; }
  .tag.impacts-privacy { color: #ffc9b8; border-color: #6b3d33; }
  .tag.posthog-backed, .tag.posthog-shipped { color: #b8e0ff; border-color: #33556b; }
  .tag.approved { color: #1b1404; background: var(--merge); border-color: var(--merge); }
  .sub { color: var(--muted); font-size: 12px; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-top: 8px;
  }
  @media (max-width: 1100px) { .grid { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } header.page, main { padding-left: 14px; padding-right: 14px; } }
  .cell h3 {
    margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); font-weight: 650;
  }
  .cell p { margin: 0; color: #e6e0cf; }
  .cell.empty p { color: #6d6858; font-style: italic; }
  .related a { margin-right: 8px; }
  .empty-board { color: var(--muted); padding: 40px 8px; }
</style>
</head>
<body>
<header class="page">
  <h1>rrweb-io/rrweb intake triage</h1>
  <p class="lede">
    Snapshot 2026-09-03 from public GitHub APIs. Numbers link to the upstream
    pull or issue. 107 PRs share an <code>updatedAt</code> of 2026-06-08
    (a bulk touch, not a review pass). Pre-filters run left to right by
    restart priority.
  </p>
  <div class="prefilters" id="prefilters"></div>
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
    <input type="search" id="q" placeholder="Filter title, author, tags, notes…" />
    <div class="sorts" id="sorts"></div>
  </div>
  <p class="meta" id="meta"></p>
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
  "posthog-nudge": 12, "draft": 13, "maintainer": 14, "community": 15,
  "bulk-updated": 16,
};

const PREFILTERS = [
  { id: "merge-now", label: "Merge now" },
  { id: "adopt", label: "Adopt" },
  { id: "posthog", label: "PostHog-backed" },
  { id: "privacy", label: "Strengthens privacy" },
  { id: "waiting", label: "Waiting on review" },
  { id: "maintainer-close", label: "Maintainer close" },
  { id: "discuss", label: "Discuss" },
  { id: "reject", label: "Reject" },
  { id: "all", label: "All" },
];

const SORTS = [
  { id: "recency", label: "Recency" },
  { id: "number", label: "Number" },
  { id: "triage", label: "Triage status" },
  { id: "tags", label: "Tags" },
];

const state = { pre: "merge-now", kind: "all", who: "all", q: "", sort: "recency" };

function matchesPre(item, pre) {
  if (pre === "all") return true;
  if (pre === "merge-now") return item.triage === "merge-now";
  if (pre === "adopt") return item.triage === "adopt";
  if (pre === "posthog") return item.tags.includes("posthog-backed") || item.tags.includes("posthog-shipped");
  if (pre === "privacy") return item.tags.includes("strengthens-privacy");
  if (pre === "waiting") return item.kind === "pr" && item.tags.includes("waiting-on-review");
  if (pre === "maintainer-close") return item.tags.includes("maintainer-close") || (item.who === "maintainer" && item.triage === "reject");
  if (pre === "discuss") return item.triage === "discuss";
  if (pre === "reject") return item.triage === "reject";
  return true;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return ITEMS.filter((item) => {
    if (!matchesPre(item, state.pre)) return false;
    if (state.kind !== "all" && item.kind !== state.kind) return false;
    if (state.who !== "all" && item.who !== state.who) return false;
    if (!q) return true;
    const hay = [
      item.id, item.title, item.author, item.authorName, item.triage,
      TRIAGE_LABEL[item.triage], item.next, item.reason, item.notes,
      item.downstream, ...(item.tags || []), ...(item.related || []),
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

function renderRow(item) {
  const tags = (item.tags || []).map((t) =>
    `<span class="tag ${esc(t)}">${esc(TAG_LABEL[t] || t)}</span>`
  ).join("");
  const rel = (item.related || []).map((id) =>
    `<a href="${esc(relatedUrl(id))}" target="_blank" rel="noreferrer">#${id}</a>`
  ).join("");
  const review = item.kind === "pr"
    ? ` · ${esc(item.reviewDecision)}${item.draft ? " · draft" : ""}`
    : "";
  return `<article class="row" data-id="${item.id}" data-kind="${item.kind}">
    <div class="row-top">
      <span class="kind">${item.kind === "pr" ? "PR" : "Issue"}</span>
      <span class="id"><a href="${esc(item.url)}" target="_blank" rel="noreferrer">#${item.id}</a></span>
      <span class="title">${esc(item.title)}</span>
      <span class="triage ${esc(item.triage)}">${esc(TRIAGE_LABEL[item.triage] || item.triage)}</span>
    </div>
    <div class="sub">${esc(item.authorName || item.author)} (@${esc(item.author)}) · ${esc(item.whoLabel)} · updated ${fmtDate(item.updatedAt)} · opened ${fmtDate(item.createdAt)}${review}</div>
    <div class="tags">${tags || '<span class="tag">No extra tags</span>'}</div>
    <div class="grid">
      ${cell("Downstream evidence", item.downstream)}
      ${cell("Reason", item.reason)}
      ${cell("Notes", item.notes)}
      ${cell("Suggested next step", item.next)}
    </div>
    ${rel ? `<div class="sub related" style="margin-top:8px">Related: ${rel}</div>` : ""}
  </article>`;
}

function countPre(id) {
  return ITEMS.filter((item) => matchesPre(item, id) && (state.kind === "all" || item.kind === state.kind) && (state.who === "all" || item.who === state.who)).length;
}

function render() {
  const list = sorted(filtered());
  document.getElementById("prefilters").innerHTML = PREFILTERS.map((p) =>
    `<button type="button" data-filter="${p.id}" class="${state.pre === p.id ? "active" : ""}">${esc(p.label)}<span class="n">${countPre(p.id)}</span></button>`
  ).join("");
  document.getElementById("sorts").innerHTML =
    `<label>Sort</label>` +
    SORTS.map((s) =>
      `<button type="button" data-sort="${s.id}" class="${state.sort === s.id ? "active" : ""}">${esc(s.label)}</button>`
    ).join("");
  document.getElementById("meta").textContent =
    `${list.length} shown · snapshot 2026-09-03 · ${ITEMS.filter(i => i.kind==="pr").length} open PRs · ${ITEMS.filter(i => i.kind==="issue").length} open issues`;
  document.getElementById("board").innerHTML = list.length
    ? list.map(renderRow).join("")
    : `<p class="empty-board">No rows match these filters.</p>`;
}

document.getElementById("prefilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  state.pre = btn.dataset.filter;
  render();
});
document.getElementById("sorts").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sort]");
  if (!btn) return;
  state.sort = btn.dataset.sort;
  render();
});
document.getElementById("kind").addEventListener("change", (e) => { state.kind = e.target.value; render(); });
document.getElementById("who").addEventListener("change", (e) => { state.who = e.target.value; render(); });
document.getElementById("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });

render();
</script>
</body>
</html>
"""


def main() -> None:
    items = assemble()
    payload = json.dumps(items, ensure_ascii=False)
    html = HTML_HEAD + f"const ITEMS = {payload};\n" + HTML_TAIL
    OUT_HTML.write_text(html)
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
    print("Maintainer close", sorted(i["id"] for i in items if "maintainer-close" in i["tags"] or (i["who"] == "maintainer" and i["triage"] == "reject")))


if __name__ == "__main__":
    main()