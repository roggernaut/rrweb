#!/usr/bin/env python3
"""Post the board's suggested messages for the rows marked Done.

    pbpaste | python3 docs/triage/post_messages.py            # dry run: show what would be posted
    pbpaste | python3 docs/triage/post_messages.py --post     # post the comments

Input is the text that "Copy done IDs" puts on the clipboard, one row per
line ("PR 1234  title" / "Issue 1234  title"); bare "pr 1234" or "issue 1234"
lines work too. Each row's message is the one the board shows under Copy
message. This only comments; it never closes, labels or merges. Needs the
GitHub CLI, signed in, with write access to rrweb-io/rrweb.
"""

from __future__ import annotations

import re
import subprocess
import sys

import build_board as board

REPO = "rrweb-io/rrweb"
LINE = re.compile(r"^\s*(pr|issue)\s+#?(\d+)", re.I)


def main() -> int:
    post = "--post" in sys.argv
    wanted: list[tuple[str, int]] = []
    for line in sys.stdin:
        m = LINE.match(line)
        if m:
            wanted.append((m.group(1).lower(), int(m.group(2))))
    if not wanted:
        print("No rows found on stdin. Paste the output of Copy done IDs.", file=sys.stderr)
        return 2

    items = {(i["kind"], i["id"]): i for i in board.assemble()}
    missing = [f"{k} {n}" for k, n in wanted if (k, n) not in items]
    if missing:
        print("Not on the board (closed, or wrong kind): " + ", ".join(missing), file=sys.stderr)
        return 2

    for kind, n in wanted:
        item = items[(kind, n)]
        print(f"=== {kind.upper()} {n}: {item['title']}\n{item['message']}\n")
        if not post:
            continue
        sub = "pr" if kind == "pr" else "issue"
        subprocess.run(
            ["gh", sub, "comment", str(n), "--repo", REPO, "--body-file", "-"],
            input=item["message"], text=True, check=True,
        )
        print(f"posted on {kind} {n}", file=sys.stderr)

    if not post:
        print(f"Dry run: {len(wanted)} message(s) shown. Add --post to send them.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
