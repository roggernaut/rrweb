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
  b.run('state.q = "release observers, buffers and listeners"; render()');
  assert.equal(b.rows(), 1);
  b.run('state.q = ""; render()');
  assert.equal((b.elements.board.innerHTML.match(/class="copy-msg"/g) || []).length, total);

  // Local Done marks: a mark hides the row, survives a reload, and undoes.
  b.run("setDone(ITEMS.find((i) => i.id === 1971), true); render()");
  assert.equal(b.rows(), total - 1);
  const reopened = openBoard({ storage: b.storage });
  reopened.run('state.pre = "done"; render()');
  assert.equal(reopened.rows(), 1);
  reopened.run("setDone(ITEMS.find((i) => i.id === 1971), false); render()");
  assert.equal(reopened.rows(), 0);

  // Marks saved under an earlier per-snapshot key carry over once.
  const legacy = openBoard({
    storage: memoryStorage({ "rrweb-triage-done:2026-09-03": JSON.stringify({ "pr:1970": true }) }),
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
  alice.run("setDone(ITEMS.find((i) => i.id === 1970), true)");
  await tick();
  assert.deepEqual({ ...docs.get("pr-1970"), at: undefined }, { key: "pr:1970", by: "u-true", at: undefined });
  for (const other of [bob, guest]) assert.equal(other.run('isDone(ITEMS.find((i) => i.id === 1970))'), true);
  guest.run("setDone(ITEMS.find((i) => i.id === 1970), false)");
  await tick();
  assert.equal(alice.run('isDone(ITEMS.find((i) => i.id === 1970))'), true);
  assert.match(guest.elements["meta-count"].textContent, /view only/);
  bob.run("setDone(ITEMS.find((i) => i.id === 1970), false)");
  await tick();
  assert.equal(alice.run('isDone(ITEMS.find((i) => i.id === 1970))'), false);

  console.log("PASS: filters, search, sorting, copy actions, local and shared Done marks");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
