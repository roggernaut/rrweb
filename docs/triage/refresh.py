#!/usr/bin/env python3
"""Fetch the open rrweb-io/rrweb queue into a new snapshot and report what changed.

    python3 docs/triage/refresh.py > /tmp/triage-report.md

Writes snapshot-<today>.json, deletes the previous snapshot file, and prints a
Markdown report comparing the two. The report is the worklist for editing the
overlays in build_board.py; see RUNBOOK.md. Needs the GitHub CLI, signed in.
"""

from __future__ import annotations

import datetime
import json
import subprocess
import sys
from pathlib import Path

import build_board as board

REPO = "rrweb-io/rrweb"
PR_FIELDS = "number,title,url,author,assignees,createdAt,updatedAt,isDraft,reviewDecision,labels,additions,deletions,changedFiles,mergeable"
ISSUE_FIELDS = "number,title,url,author,assignees,createdAt,updatedAt,labels"


def gh_json(*args: str):
    return json.loads(subprocess.check_output(["gh", *args], text=True))


def graphql(fields: dict[str, str]) -> dict:
    """Run one aliased query per entry against the repository, 25 at a time."""
    out: dict = {}
    keys = list(fields)
    for start in range(0, len(keys), 25):
        body = "".join(f"{k}:{fields[k]} " for k in keys[start:start + 25])
        query = f'query{{repository(owner:"rrweb-io",name:"rrweb"){{{body}}}}}'
        out.update(gh_json("api", "graphql", "-f", f"query={query}")["data"]["repository"])
    return out


def names(rows) -> list[str]:
    return sorted(r.get("login") or r.get("name") for r in rows or [])


def main() -> None:
    previous_path = board.SNAPSHOT
    previous = board.load_json(previous_path)
    since = previous["taken"]
    today = datetime.date.today().isoformat()

    prs = gh_json("pr", "list", "--repo", REPO, "--state", "open", "--limit", "1000", "--json", PR_FIELDS)
    issues = gh_json("issue", "list", "--repo", REPO, "--state", "open", "--limit", "2000", "--json", ISSUE_FIELDS)
    snapshot = {
        "taken": today,
        "repo": REPO,
        "pr": sorted(prs, key=lambda p: -p["number"]),
        "issue": sorted(issues, key=lambda i: -i["number"]),
    }
    path = board.ROOT / f"snapshot-{today}.json"
    with path.open("w") as f:
        json.dump(snapshot, f, indent=1, ensure_ascii=False)
        f.write("\n")
    if previous_path != path:
        previous_path.unlink()

    out = []
    p = out.append
    p(f"# Triage refresh {since} → {today}\n")
    p(f"Open now: {len(prs)} PRs ({sum(x['isDraft'] for x in prs)} drafts), {len(issues)} issues.\n")

    for kind, old_rows, new_rows, overlays in (
        ("pr", previous["pr"], prs, board.PR),
        ("issue", previous["issue"], issues, board.ISSUE),
    ):
        old = {r["number"]: r for r in old_rows}
        new = {r["number"]: r for r in new_rows}
        noun, lower = ("PRs", "PRs") if kind == "pr" else ("Issues", "issues")

        gone = sorted(set(old) - set(new), reverse=True)
        if gone:
            gql_kind = "pullRequest" if kind == "pr" else "issue"
            extra = "mergedAt" if kind == "pr" else "stateReason"
            states = graphql({f"n{n}": f"{gql_kind}(number:{n}){{number state closedAt {extra}}}" for n in gone})
            p(f"## {noun} closed since {since}\n")
            p("Delete each overlay listed here and add the item to the changelog in the notes.\n")
            for n in gone:
                s = states[f"n{n}"]
                how = "merged" if s.get("mergedAt") else (s.get("stateReason") or s["state"]).lower()
                has = "overlay" if n in overlays else "no overlay"
                p(f"- {n} {how} {(s.get('mergedAt') or s.get('closedAt') or '')[:10]} ({has}): {old[n]['title']}")
            p("")

        added = sorted(set(new) - set(old), reverse=True)
        if added:
            p(f"## New {lower} since {since}\n")
            p("Every new PR needs an overlay. New issues fall into Bulk hygiene unless given one.\n")
            for n in added:
                r = new[n]
                who = board.MAINTAINERS.get(r["author"]["login"], "community")
                draft = " draft" if r.get("isDraft") else ""
                p(f"- {n} ({who}{draft}): {r['title']}")
            p("")

        moved = []
        for n in sorted(set(old) & set(new), reverse=True):
            a, b = old[n], new[n]
            notes = []
            for field, label in (("reviewDecision", "review"), ("isDraft", "draft")):
                if field in a and a.get(field) != b.get(field):
                    notes.append(f"{label} {a.get(field) or 'none'} → {b.get(field) or 'none'}")
            for field in ("labels", "assignees"):
                was, now = names(a.get(field)), names(b.get(field))
                if field in a and was != now:
                    notes.append(f"{field} {', '.join(was) or 'none'} → {', '.join(now) or 'none'}")
            if notes:
                moved.append(f"- {n}: {'; '.join(notes)}")
        if moved:
            p(f"## {noun} whose upstream state changed\n")
            p("\n".join(moved) + "\n")

    # Maintainer comments and reviews since the last snapshot drive re-bucketing.
    recent = [("pullRequest", r) for r in prs if r["updatedAt"][:10] >= since]
    recent += [("issue", r) for r in issues if r["updatedAt"][:10] >= since]
    fields = {}
    for gql_kind, r in recent:
        reviews = "reviews(last:20){nodes{author{login} state submittedAt body}}" if gql_kind == "pullRequest" else ""
        fields[f"n{r['number']}"] = (
            f"{gql_kind}(number:{r['number']}){{number title "
            f"comments(last:30){{nodes{{author{{login}} createdAt body}}}} {reviews}}}"
        )
    activity = graphql(fields) if fields else {}
    lines = []
    for key in sorted(activity, key=lambda k: -activity[k]["number"]):
        node = activity[key]
        events = []
        for c in node["comments"]["nodes"]:
            login = (c.get("author") or {}).get("login")
            if login in board.MAINTAINERS and c["createdAt"][:10] >= since:
                events.append(f"  - {board.MAINTAINERS[login]} commented {c['createdAt'][:10]}: {' '.join(c['body'].split())[:400]}")
        for rv in (node.get("reviews") or {}).get("nodes", []):
            login = (rv.get("author") or {}).get("login")
            if login in board.MAINTAINERS and (rv.get("submittedAt") or "")[:10] >= since:
                body = " ".join((rv.get("body") or "").split())[:400]
                events.append(f"  - {board.MAINTAINERS[login]} {rv['state'].lower()} {rv['submittedAt'][:10]}{': ' + body if body else ''}")
        if events:
            lines.append(f"- {node['number']}: {node['title']}\n" + "\n".join(events))
    if lines:
        p(f"## Maintainer activity since {since}\n")
        p("Re-read each row's reason, next step and message against these.\n")
        p("\n".join(lines) + "\n")

    sys.stdout.write("\n".join(out))
    print(f"Wrote {path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
