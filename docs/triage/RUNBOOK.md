# Refreshing the triage board

Refresh the board every two weeks, the day before the triage meeting. One
person (or an agent working from this file) does it end to end. Expect 30 to
60 minutes, most of it reading the change report.

The board is done when both tests pass, the notes have a changelog for the
period, and both published copies show the new snapshot date.

## What you need

- The GitHub CLI, signed in (`gh auth status`)
- Python 3 and Node.js
- Push access to the board branch, `cursor/pr-issue-triage-d529` on
  `roggernaut/rrweb`
- For the shared board: a Claude session that can publish to
  https://claude.ai/artifact/P3XqLqRDV441i4y2tNP47X (the owner's account)

## Steps

### 1. Start from the published branch

```sh
git fetch origin
git switch cursor/pr-issue-triage-d529
git pull --ff-only
```

### 2. Fetch the snapshot and the change report

```sh
python3 docs/triage/refresh.py > ../triage-report.md
```

This replaces `snapshot-<old date>.json` with `snapshot-<today>.json` and
writes a report (keep it outside the repo) with four sections:

- PRs and issues closed since the last snapshot, merged or not
- New PRs and issues
- Items whose review decision, draft state, labels or assignees changed
- Maintainer comments and reviews since the last snapshot, quoted

### 3. Work the report into the overlays

All triage calls live in `build_board.py` as `pr(...)` and `issue(...)`
calls. Work the report top to bottom:

1. **Closed items.** Delete the overlay. Delete their entries in `EVIDENCE`
   and `EVIDENCE_TAGS` too. Search for the number elsewhere: a `related=`
   list or a `reason` that says "merge 1234 first" now needs rewording.
2. **New PRs.** Every new PR needs a `pr(...)` overlay; the build fails
   without one. Add them under a `# --- New since <last date> ---` heading.
   Read the PR description and linked issue before choosing a bucket.
3. **New issues.** Give an overlay only to issues worth a decision: a PR
   fixes it, it is a privacy or security report, or a maintainer opened it.
   The rest fall into Bulk hygiene.
4. **Upstream state changes.** A new `CHANGES_REQUESTED` or `APPROVED`
   usually changes the next step. A label such as `wontfix` or `duplicate`
   is a team decision: follow it.
5. **Maintainer activity.** Re-read the row's reason, next step and message
   against what the maintainer said. Move the bucket when their comment
   changes the call (a wontfix lean, a revived PR, a requested change).

#### Labels and assignees

Upstream labels and assignees on rrweb-io/rrweb are the source of truth. The
board shows labels as outlined chips beside its own tags, shows each row's
assignees, and filters by assignee. Keep the overlays consistent with them:

- When an item has an assignee, the next step names that person.
- When a label records a decision (`wontfix`, `duplicate`, `has PR`,
  `reproduction needed`), the bucket and message agree with it.
- Never copy a label into an overlay's `tags`. Labels show on their own.

#### Buckets

| Bucket | Use it when |
| --- | --- |
| `merge-now` | Approved and green. Only the merge button is left. |
| `adopt` | Small, correct, tested. One review and it can merge. |
| `review` | A real fix or focused feature that needs one reviewer. |
| `discuss` | Privacy, security, API or product direction. Needs the team. |
| `cleanup` | Plausible, but the author owes a rebase, test or change first. |
| `reject` | Duplicate, superseded, out of scope, or a maintainer leans wontfix. |

The flags (`strengthens-privacy`, `impacts-privacy`, `commercial`) are
defined in the notes file. Add them only where the flag is the point of the
change.

#### Writing a row

- `reason`: what the item does and the fact that sets its bucket, with dates
  for anything that happened since the last snapshot.
- `next_step`: one action with one owner ("Eoghan: review", "Author: add the
  sandbox check"). The assignee is the owner when there is one.
- `message`: the comment the team can paste on GitHub. The generator writes
  one from the bucket, and it is wrong in three known cases. Write `message=`
  by hand when:
  - a `reject` row has `related=` items that are not replacements (the
    generated text says "Closing in favor of" the first one)
  - an `adopt` issue's fix already merged (the generated text says the fix is
    still queued)
  - the thread already has a specific maintainer request (point at it)

Write plainly: short sentences, no em dashes, no "this, not that" framing.

### 4. Build and test

```sh
python3 docs/triage/build_board.py --artifact ../rrweb-intake-triage.html
python3 docs/triage/test_board.py
node docs/triage/test_board.cjs
```

`test_board.py` fails with the exact list of what is left: open PRs with no
overlay, overlays for closed items, or a stale `index.html`. Fix and rerun
until both suites pass.

### 5. Update the notes

In `2026-09-03-open-prs-and-issues.md`:

- Update the headline numbers at the top from the report's first line and the
  build output.
- Add a `## Since <last date>` section above the previous one: what merged,
  what closed, which rows moved bucket and why, and what is new. Keep older
  sections; they are the history.

### 6. Publish

```sh
git add -A docs/triage
git commit -m "docs: refresh triage board to the <today> snapshot"
git push
```

GitHub Pages redeploys the branch within a few minutes. Check that
https://roggernaut.github.io/rrweb/docs/triage/ shows "Snapshot <today>".

Then republish the shared board. In a Claude session, ask:

> Publish ../rrweb-intake-triage.html to
> https://claude.ai/artifact/P3XqLqRDV441i4y2tNP47X

Republishing keeps the URL, its sharing and every Done mark. Open it and
check the header date.

### 7. Done marks before the meeting

Shared Done marks persist from one meeting to the next. A row marked Done
last time that is still open stays hidden. At the start of the meeting,
turn on **Show done** and unmark anything that needs another look.

## When something fails

- **`refresh.py` stops with a `gh` error.** Run `gh auth status`. A
  rate limit clears within the hour; rerun the script.
- **The build says `Missing PR overlay for: [...]`.** Those PRs are new since
  the report or were missed. Add overlays (step 3.2).
- **`test_no_overlay_for_a_closed_item` fails.** Delete the overlays it lists.
- **The shared board shows an old date.** The publish went to a new URL or
  failed. Publish again to the exact URL above.
