// THROWAWAY SPIKE: proves a WebDriver route can record a page with rrweb.
// Env: DRIVER_URL (a running safaridriver / geckodriver), CAPS (JSON capabilities),
//      PAGE_HOST (host the browser uses to reach this machine, default 127.0.0.1).
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Builder } from 'selenium-webdriver';

const require = createRequire(import.meta.url);
const bundle = readFileSync(require.resolve('rrweb/dist/rrweb.umd.cjs'), 'utf8');
const SECRET_TEXT = 'PRIVATE_CANARY_84271';
const SECRET_INPUT = 'INPUT_CANARY_55120';
const SECRET_MUTATED = 'MUTATED_CANARY_96321';
const PUBLIC = 'PUBLIC_CONTROL_57382';
const page = `<!doctype html><meta charset="utf-8"><title>spike</title>
<p class="rr-mask" id="masked">${SECRET_TEXT}</p>
<p id="public">${PUBLIC}</p>
<input id="field" value="">
<div id="host"></div>
<script>${bundle}</script>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});
await new Promise((r) => server.listen(8123, '0.0.0.0', r));
const url = `http://${process.env.PAGE_HOST || '127.0.0.1'}:8123/`;

const caps = JSON.parse(process.env.CAPS);
const t0 = Date.now();
const driver = await new Builder()
  .usingServer(process.env.DRIVER_URL)
  .withCapabilities(caps)
  .build();
const sessionMs = Date.now() - t0;
const failures = [];
let report = {};
try {
  const c = await driver.getCapabilities();
  report.browser = `${c.get('browserName')} ${c.get('browserVersion')}`;
  report.platform = c.get('platformName');
  report.sessionMs = sessionMs;
  await driver.get(url);
  await driver.executeScript(`
    window.__events = [];
    window.__stop = rrweb.record({
      emit: (e) => window.__events.push(e),
      maskTextClass: 'rr-mask',
      maskAllInputs: true,
    });
  `);
  await driver.executeScript(`
    document.getElementById('masked').textContent = '${SECRET_MUTATED}';
    const f = document.getElementById('field');
    f.value = '${SECRET_INPUT}';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    const host = document.getElementById('host');
    for (let i = 0; i < 50; i++) {
      const d = document.createElement('div');
      d.textContent = 'added ' + i;
      host.appendChild(d);
    }
  `);
  await driver.sleep(1000);
  // Small timing probe: full snapshot of a 5,000 node page.
  report.snapshotMs = await driver.executeScript(`
    const host = document.getElementById('host');
    for (let i = 0; i < 5000; i++) host.appendChild(document.createElement('span'));
    const t = performance.now();
    rrweb.record.takeFullSnapshot(true);
    return Math.round(performance.now() - t);
  `);
  await driver.sleep(500);
  const json = await driver.executeScript(
    `window.__stop && window.__stop(); return JSON.stringify(window.__events);`,
  );
  const events = JSON.parse(json);
  report.eventCount = events.length;
  report.eventTypes = [...new Set(events.map((e) => e.type))];
  if (!events.some((e) => e.type === 2)) failures.push('no full snapshot');
  if (!events.some((e) => e.type === 3 && e.data.source === 0))
    failures.push('no mutation event');
  if (!events.some((e) => e.type === 3 && e.data.source === 5))
    failures.push('no input event');
  for (const s of [SECRET_TEXT, SECRET_INPUT, SECRET_MUTATED])
    if (json.includes(s)) failures.push(`privacy leak: ${s}`);
  if (!json.includes(PUBLIC)) failures.push('public control text missing');
  writeFileSync('events.json', json);
} catch (e) {
  failures.push('error: ' + (e && e.stack ? e.stack : e));
} finally {
  await driver.quit().catch(() => {});
  server.close();
}
report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length ? 1 : 0);
