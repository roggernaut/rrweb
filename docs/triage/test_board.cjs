// Offline checks of the page logic. Run after build_board.py with Node.js.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const tick = () => new Promise((r) => setTimeout(r, 5));

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

// A minimal stand-in for the artifact db: one "done" collection, live.
function fakeDb() {
  const docs = new Map();
  const listeners = [];
  const snap = () => ({ docs: [...docs.entries()].map(([id, body]) => ({ id, data: () => body })) });
  const emit = () => listeners.forEach((l) => l(snap()));
  const col = {
    limit: () => ({ onSnapshot(next) { listeners.push(next); setTimeout(() => next(snap())); return () => {}; } }),
    doc: (id) => ({
      async set(body) { docs.set(id, body); emit(); },
      async delete() { docs.delete(id); emit(); },
    }),
  };
  return { docs, db: { collection: () => col } };
}

function openBoard({ storage = memoryStorage(), claude } = {}) {
  const elements = {};
  const context = {
    document: { getElementById: (id) => (elements[id] ||= { addEventListener() {} }) },
    localStorage: storage,
  };
  context.window = context;
  if (claude) context.claude = claude;
  vm.createContext(context);
  vm.runInContext(script, context);
  const run = (code) => vm.runInContext(code, context);
  const rows = () => (elements.board.innerHTML.match(/<article /g) || []).length;
  return { run, rows, storage, elements };
}

(async () => {
  // Filters, search and sorting.
  const b = openBoard();
  const total = b.run("ITEMS.length");
  assert.equal(b.run("state.pre"), "adopt");
  assert.equal(b.rows(), b.run('ITEMS.filter((i) => i.triage === "adopt").length'));
  assert.ok(b.rows() > 0, "the default filter must not open on an empty list");
  b.run('state.pre = "all"; render()');
  assert.equal(b.rows(), total);
  for (const sort of ["number", "triage", "tags", "recency"]) {
    b.run(`state.sort = "${sort}"; render()`);
    assert.equal(b.rows(), total);
  }
  // Search: a row's own reason text narrows the list to the rows that carry it.
  const probe = b.run('ITEMS.find((i) => i.kind === "pr" && i.reason.length > 80).reason');
  b.run(`state.q = ${JSON.stringify(probe)}; render()`);
  const hits = b.run(`ITEMS.filter((i) => [i.reason, i.message, i.notes].join(" ").toLowerCase().includes(${JSON.stringify(probe.toLowerCase())})).length`);
  assert.ok(hits >= 1 && hits < total, "the probe must match some rows but not all");
  assert.equal(b.rows(), hits);
  b.run('state.q = ""; state.assignee = "none"; render()');
  assert.equal(b.rows(), b.run("ITEMS.filter((i) => i.assignees.length === 0).length"));
  const someone = b.run("ITEMS.flatMap((i) => i.assignees)[0] || null");
  if (someone) {
    b.run(`state.assignee = ${JSON.stringify(someone)}; render()`);
    assert.equal(b.rows(), b.run(`ITEMS.filter((i) => i.assignees.includes(${JSON.stringify(someone)})).length`));
  }
  b.run('state.assignee = "all"; render()');
  assert.equal((b.elements.board.innerHTML.match(/class="copy-msg"/g) || []).length, total);

  // Two open PRs from the current snapshot, so the test survives refreshes.
  const [one, two] = b.run('ITEMS.filter((i) => i.kind === "pr").slice(0, 2).map((i) => i.id)');

  // Local Done marks: a mark hides the row, survives a reload, and undoes.
  b.run(`setDone(ITEMS.find((i) => i.id === ${one}), true); render()`);
  assert.equal(b.rows(), total - 1);
  const reopened = openBoard({ storage: b.storage });
  reopened.run('state.pre = "done"; render()');
  assert.equal(reopened.rows(), 1);
  reopened.run(`setDone(ITEMS.find((i) => i.id === ${one}), false); render()`);
  assert.equal(reopened.rows(), 0);

  // Marks saved under an earlier per-snapshot key carry over once.
  const legacy = openBoard({
    storage: memoryStorage({ "rrweb-triage-done:2026-09-03": JSON.stringify({ [`pr:${two}`]: true }) }),
  });
  legacy.run('state.pre = "done"; render()');
  assert.equal(legacy.rows(), 1);

  // Shared Done marks: one editor's mark reaches everyone; view-only stays read-only.
  const { db, docs } = fakeDb();
  const viewer = (canWrite) => ({
    use: async (name) =>
      name === "db" ? db : { id: async () => "u-" + canWrite, can: async () => canWrite },
  });
  const alice = openBoard({ claude: viewer(true) });
  const bob = openBoard({ claude: viewer(true) });
  const guest = openBoard({ claude: viewer(false) });
  await tick();
  const isDoneTwo = `isDone(ITEMS.find((i) => i.id === ${two}))`;
  alice.run(`setDone(ITEMS.find((i) => i.id === ${two}), true)`);
  await tick();
  assert.deepEqual({ ...docs.get(`pr-${two}`), at: undefined }, { key: `pr:${two}`, by: "u-true", at: undefined });
  for (const other of [bob, guest]) assert.equal(other.run(isDoneTwo), true);
  guest.run(`setDone(ITEMS.find((i) => i.id === ${two}), false)`);
  await tick();
  assert.equal(alice.run(isDoneTwo), true);
  assert.match(guest.elements["meta-count"].textContent, /view only/);
  bob.run(`setDone(ITEMS.find((i) => i.id === ${two}), false)`);
  await tick();
  assert.equal(alice.run(isDoneTwo), false);

  console.log("PASS: filters, search, sorting, copy actions, local and shared Done marks");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
