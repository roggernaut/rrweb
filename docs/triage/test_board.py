"""Offline checks: overlays match the snapshot, and index.html is up to date."""
import re
import unittest

import build_board as board


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = board.load_json(board.SNAPSHOT)
        self.items = board.assemble()

    def test_every_open_item_is_on_the_board_once(self):
        keys = [(i["kind"], i["id"]) for i in self.items]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(sorted(i["id"] for i in self.items if i["kind"] == "pr"),
                         sorted(p["number"] for p in self.snapshot["pr"]))
        self.assertEqual(sorted(i["id"] for i in self.items if i["kind"] == "issue"),
                         sorted(i["number"] for i in self.snapshot["issue"]))

    def test_no_overlay_for_a_closed_item(self):
        open_prs = {p["number"] for p in self.snapshot["pr"]}
        open_issues = {i["number"] for i in self.snapshot["issue"]}
        self.assertEqual(sorted(set(board.PR) - open_prs), [])
        self.assertEqual(sorted(set(board.ISSUE) - open_issues), [])

    def test_next_step_names_the_assignee(self):
        """Upstream assignees are the source of truth: the next step names them."""
        for item in self.items:
            if item["triage"] == "bulk" or not item["assignees"]:
                continue
            names = [board.MAINTAINERS.get(login, login) for login in item["assignees"]]
            self.assertTrue(any(n in item["next"] for n in names), (item["kind"], item["id"], names, item["next"]))

    def test_related_only_lists_open_items(self):
        open_ids = {p["number"] for p in self.snapshot["pr"]} | {i["number"] for i in self.snapshot["issue"]}
        for item in self.items:
            closed = sorted(set(item["related"]) - open_ids)
            self.assertEqual(closed, [], (item["kind"], item["id"]))

    def test_every_triage_and_tag_has_a_label(self):
        for item in self.items:
            self.assertIn(item["triage"], board.TRIAGE_LABEL, item["id"])
            self.assertTrue(item["message"], item["id"])

    def test_embedded_data_cannot_close_the_script(self):
        html = board.OUT_HTML.read_text()
        payload = re.search(r"const ITEMS = (\[.*?\]);\n", html, re.S).group(1)
        self.assertNotIn("</", payload)

    def test_one_snapshot_and_its_date_on_the_page(self):
        self.assertEqual(len(list(board.ROOT.glob("snapshot-*.json"))), 1)
        html = board.OUT_HTML.read_text()
        self.assertIn(f"Snapshot {self.snapshot['taken']}.", html)
        self.assertNotIn("{{SNAPSHOT_DATE}}", html)

    def test_generated_html_matches(self):
        self.assertEqual(board.OUT_HTML.read_text(), board.render_html(self.items),
                         "index.html is stale: run build_board.py")


if __name__ == "__main__":
    unittest.main()
