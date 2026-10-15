import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, '..', 'gate-lite.mjs');
const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const CASES = [
  { file: 'wide-element.html', exit: 1, types: ['scroll-orizzontale', 'fuori-bordo'], blocking: true },
  { file: 'transform-spill.html', exit: 1, types: ['scroll-orizzontale'], blocking: true },
  { file: 'carousel-clipped.html', exit: 0, types: [], blocking: false },
  { file: 'body-hidden.html', exit: 0, types: [], blocking: false },
  { file: 'clean.html', exit: 0, types: [], blocking: false, findings: 0 },
];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const httpPort = await freePort();
const cdpPort = await freePort();

const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, 'http://x').pathname) || 'clean.html';
  const file = path.join(here, name);
  if (!name.endsWith('.html') || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(file));
});
await new Promise(r => server.listen(httpPort, '127.0.0.1', r));

if (!fs.existsSync(CHROME_BIN)) {
  console.error(`Chrome not found at ${CHROME_BIN} (set CHROME_BIN).`);
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-lite-test-'));
const chrome = spawn(CHROME_BIN, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => {
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
};

let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await new Promise(r => setTimeout(r, 500));
  ready = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(() => true, () => false);
}
if (!ready) {
  cleanup();
  console.error('Chrome did not start.');
  process.exit(2);
}

// async on purpose: a sync spawn would block the event loop that serves the fixtures
function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stderr }));
  });
}
let passed = 0;
for (const c of CASES) {
  const out = path.join(profile, `${c.file}.json`);
  const r = await run([gate, `/${c.file}`, '--base', `http://127.0.0.1:${httpPort}`, '--cdp-port', String(cdpPort), '--viewports', '390x844', '--out', out]);
  const report = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf-8')) : null;
  const errors = [];
  if (r.status !== c.exit) errors.push(`exit ${r.status}, expected ${c.exit}`);
  if (!report) errors.push('no JSON report');
  else {
    const found = report.segnalazioni.filter(s => s.gravita === 'blocco').map(s => s.tipo);
    for (const t of c.types) if (!found.includes(t)) errors.push(`missing blocking ${t}`);
    if (!c.blocking && found.length) errors.push(`unexpected blocking ${found.join(',')}`);
    if (c.findings !== undefined && report.segnalazioni.length !== c.findings) errors.push(`${report.segnalazioni.length} findings, expected ${c.findings}`);
  }
  if (errors.length) console.log(`FAIL ${c.file}: ${errors.join('; ')}\n${(r.stderr || '').trim()}`);
  else {
    passed += 1;
    console.log(`ok   ${c.file}`);
  }
}

cleanup();
console.log(`${passed}/${CASES.length} passed`);
process.exit(passed === CASES.length ? 0 : 1);
