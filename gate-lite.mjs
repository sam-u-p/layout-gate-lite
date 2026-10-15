/*
  Layout gate lite: one check, "page wider than the screen".
  For every route and viewport it samples document scrollWidth over time and
  lists the elements sticking out of the screen that no ancestor clips.

  Usage:
    node gate-lite.mjs / /contact/ --base http://127.0.0.1:8949 --cdp-port 9223
  Options: --config <file> --base <url> --cdp-port <n> --viewports 390x844,768x1024 --out <file.json>
  Environment: BASE, CDP_PORT, CHROME_BIN.
  Exit code: 0 no blocking finding, 1 at least one blocking finding, 2 setup problem.
*/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

function esci(message) {
  console.error(message);
  process.exit(2);
}

const USO = [
  'Layout gate lite. Measures sideways scroll (sampled over time) and elements sticking out of the screen.',
  '',
  'Usage:',
  '  node gate-lite.mjs / /contact/ --base http://127.0.0.1:8949 --cdp-port 9223',
  '',
  'Options: --config <file> --base <url> --cdp-port <n> --viewports 390x844,768x1024 --out <file.json>',
  'Environment: BASE, CDP_PORT, CHROME_BIN.',
  'Default viewports: 390x844 and 768x1024. Add 1440x900 with --viewports.',
  'If nothing listens on the CDP port, a headless Chrome is started for the run.',
  '',
  'Exit code: 0 no blocking finding, 1 at least one blocking finding, 2 setup problem.',
].join('\n');

function leggiArgv(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USO);
    process.exit(0);
  }
  const opt = {};
  const route = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) esci(`Missing value for --${key}`);
      opt[key] = value;
      i += 1;
      continue;
    }
    route.push(a);
  }
  return { opt, route };
}

function trovaConfig(given) {
  if (given) {
    const p = path.resolve(given);
    if (!fs.existsSync(p)) esci(`Config not found: ${p}`);
    return p;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const p = path.join(dir, 'gate-lite.config.json');
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function caricaConfig(given) {
  const p = trovaConfig(given);
  if (!p) return { cfg: {}, cfgPath: null };
  try {
    return { cfg: JSON.parse(fs.readFileSync(p, 'utf-8')), cfgPath: p };
  } catch (e) {
    esci(`Config unreadable (${p}): ${e.message}`);
  }
}

const lista = (v) => {
  if (!v) return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim()).filter(Boolean);
};

function leggiViewports(opt, cfg) {
  if (opt.viewports) {
    return lista(opt.viewports).map(v => {
      const m = /^(\d+)x(\d+)$/.exec(v);
      if (!m) esci(`Invalid viewport: "${v}". Expected format: 1440x900.`);
      return [Number(m[1]), Number(m[2])];
    });
  }
  if (Array.isArray(cfg.viewports) && cfg.viewports.length) {
    return cfg.viewports.map(v => (Array.isArray(v) ? v.map(Number) : null) || esci(`Invalid viewport in config: ${JSON.stringify(v)}`));
  }
  return [[390, 844], [768, 1024]];
}

const BADGE_PIATTAFORME = {
  lovable: ['[id^="lovable-badge"]', 'a[href*="utm_source=lovable-badge"]', 'a[href*="lovable.dev"]'],
  bolt: ['a[href*="bolt.new"]', '[id*="bolt-badge"]', '[class*="bolt-badge"]'],
  v0: ['a[href*="v0.dev"]', 'a[href*="v0.app"]', '[id*="v0-badge"]', '[class*="v0-badge"]'],
  framer: ['#__framer-badge-container', '.__framer-badge', '[data-framer-badge]', 'a[href*="framer.com"][href*="utm_"]'],
};
const BADGE_TESTO = '^(made|built|edit|edited|created|designed|powered)\\s+(with|in|by)\\s+(lovable|bolt|v0|framer)\\b';
const BADGE_JS = `
  const BADGE_SEL = ${JSON.stringify(BADGE_PIATTAFORME)};
  const BADGE_TUTTI = Object.values(BADGE_SEL).flat().join(',');
  const BADGE_RE = new RegExp(${JSON.stringify(BADGE_TESTO)}, 'i');
  const cacheBadge = new Map();
  const eBadge = el => {
    if (cacheBadge.has(el)) return cacheBadge.get(el);
    let r = !!el.closest(BADGE_TUTTI);
    for (let p = el, i = 0; !r && p && p !== document.body && i < 4; p = p.parentElement, i++) {
      const t = (p.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t.length <= 40 && BADGE_RE.test(t) && p.querySelectorAll('*').length < 10) r = true;
    }
    cacheBadge.set(el, r);
    return r;
  };
  const badgePresenti = () => Object.keys(BADGE_SEL).filter(k => document.querySelector(BADGE_SEL[k].join(',')));
`;

const CHECKS = `(async () => {
  ${BADGE_JS}
  const out = { badge: badgePresenti(), overflowDett: [] };
  // clientWidth, not innerWidth: mobile emulation zooms out to fit wide content and innerWidth would grow with it
  const vw = document.documentElement.clientWidth;
  const max = document.documentElement.scrollHeight - innerHeight;
  for (let y = 0; y <= max; y += 400) {
    scrollTo(0, y);
    await new Promise(r => setTimeout(r, 45));
  }
  await new Promise(r => setTimeout(r, 700));

  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push(document.documentElement.scrollWidth);
    await new Promise(r => setTimeout(r, 900));
  }
  out.scrollW = Math.max(...samples);
  out.vw = vw;
  // scrollWidth keeps reporting the full content width when the viewport overflow is hidden or clip, so the real scrollability is read from the style
  const htmlOx = getComputedStyle(document.documentElement).overflowX;
  const vpOx = htmlOx !== 'visible' ? htmlOx : getComputedStyle(document.body).overflowX;
  out.locked = vpOx === 'hidden' || vpOx === 'clip';

  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position === 'fixed') return;
    let p = el.parentElement, clipped = false;
    while (p) {
      if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; }
      p = p.parentElement;
    }
    if (clipped) return;
    if (eBadge(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width > 1 && (r.right > vw + 2 || r.left < -2) && r.left > -5000) {
      out.overflowDett.push({ sel: (el.className || el.tagName).toString().slice(0, 40), l: Math.round(r.left), r: Math.round(r.right) });
    }
  });

  out.overflowDett = Array.from(new Map(out.overflowDett.map(d => [d.sel, d])).values()).slice(0, 12);
  return JSON.stringify(out);
})()`;

async function inspect(route, width, height, cdpPort, base) {
  const target = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then(r => r.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let callId = 0;

  const erroreSetup = msg => Object.assign(new Error(msg), { setup: true });
  function send(method, params = {}, ms = 30000) {
    callId += 1;
    const id = callId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(erroreSetup(`${method} got no answer after ${ms} ms`)); }, ms);
      pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    });
  }
  function waitFor(method, ms = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(erroreSetup(`${method} not received after ${ms} ms`)); }, ms);
      const listener = event => {
        const message = JSON.parse(event.data);
        if (message.method !== method) return;
        socket.removeEventListener('message', listener);
        clearTimeout(timer);
        resolve(message.params);
      };
      socket.addEventListener('message', listener);
    });
  }
  socket.addEventListener('close', () => {
    for (const h of pending.values()) h.reject(erroreSetup('CDP connection closed, Chrome stopped or tab closed'));
    pending.clear();
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1,
    mobile: width < 768,
    screenWidth: width, screenHeight: height
  });
  const loaded = waitFor('Page.loadEventFired');
  const url = new URL(route, base);
  url.searchParams.set('gate', Date.now());
  const nav = await send('Page.navigate', { url: url.href });
  if (nav.errorText) throw Object.assign(new Error(`${url.href} ${nav.errorText}`), { setup: true });
  await loaded;
  await new Promise(r => setTimeout(r, 1600));

  const evalResult = await send('Runtime.evaluate', { expression: CHECKS, awaitPromise: true, returnByValue: true }, 240000);
  const data = JSON.parse(evalResult.result.value);

  socket.close();
  await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(() => {});
  return data;
}

const { opt, route } = leggiArgv(process.argv.slice(2));
const { cfg, cfgPath } = caricaConfig(opt.config);

const base = opt.base || process.env.BASE || cfg.base || 'http://127.0.0.1:8000';
const cdpPort = opt['cdp-port'] || process.env.CDP_PORT || cfg.cdpPort || '9223';
const viewports = leggiViewports(opt, cfg);

process.on('exit', code => {
  if (code === 13) {
    console.error('gate-lite: a wait never completed (no answer from Chrome or the server). Exit code 2.');
    process.exitCode = 2;
  }
});
const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function leggiVersione() {
  return fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
}
async function avviaChrome() {
  if (!fs.existsSync(CHROME_BIN)) esci(`No Chrome listening on CDP port ${cdpPort} and ${CHROME_BIN} does not exist (set CHROME_BIN).`);
  const profilo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-lite-chrome-'));
  const chrome = spawn(CHROME_BIN, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profilo}`, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { chrome.kill(); fs.rmSync(profilo, { recursive: true, force: true }); });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { return await leggiVersione(); } catch {}
  }
  esci(`Chrome was started but nothing answered on CDP port ${cdpPort} after 20 s.`);
}
try {
  let v;
  try {
    v = await leggiVersione();
  } catch {
    v = await avviaChrome();
  }
  console.log(`gate-lite  base ${base}  CDP ${cdpPort} (${v.Browser})  config ${cfgPath || 'none'}`);
} catch (e) {
  esci(`Could not reach Chrome on CDP port ${cdpPort}: ${e.message}`);
}

const pagine = route.length ? route : lista(cfg.routes);
if (!pagine.length) {
  esci('No route given.\nUsage: node gate-lite.mjs /page/ [...] --base http://127.0.0.1:8000');
}

try {
  await fetch(new URL(pagine[0], base).href);
} catch {
  esci(`Server not reachable at ${base}. Start the local server and pass --base again.`);
}

const TIPI = {
  'scroll-orizzontale': { classe: 'difetto', gravita: 'blocco', fix: (p) => `The page scrolls sideways (content ${p.sw}px wide on a ${p.vw}px screen). Find the widest element and cap it with max-width: 100%, or set overflow-x: clip on its container.` },
  'fuori-bordo': { classe: 'difetto', gravita: 'blocco', fix: (p) => `Bring ${p.sel} back inside the screen: it sticks out (left ${p.l}, right ${p.r}). Use max-width: 100%, or remove the margin or transform that pushes it out.` },
};
const segnalazioni = new Map();
function registra(tipo, route, vp, chiave, dettaglio, params, gravita) {
  const k = [tipo, route, chiave].join('|');
  let v = segnalazioni.get(k);
  if (!v) {
    v = { tipo, classe: TIPI[tipo].classe, gravita: gravita || TIPI[tipo].gravita, route, viewport: [], dettaglio, params };
    segnalazioni.set(k, v);
  }
  if (gravita === 'blocco') v.gravita = 'blocco';
  if (!v.viewport.includes(vp)) v.viewport.push(vp);
  return v;
}

let fail = 0;
const badgeIgnorati = new Set();
for (const r of pagine) {
  for (const [w, h] of viewports) {
    let dati;
    try {
      dati = await inspect(r, w, h, cdpPort, base);
    } catch (e) {
      esci(e.setup ? `Setup: page not reachable or Chrome stopped (${e.message}). Check the local server and Chrome.` : `Error while measuring ${r} @ ${w}x${h}: ${e.message}`);
    }
    const label = `${r} @ ${w}x${h}`;
    const vp = `${w}x${h}`;
    const bloccanti = [];
    const reg = (tipo, chiave, dettaglio, params, gravita) => {
      const v = registra(tipo, r, vp, chiave, dettaglio, params, gravita);
      if (gravita !== 'avviso' && v.gravita === 'blocco') bloccanti.push(dettaglio);
    };
    (dati.badge || []).forEach(b => badgeIgnorati.add(b));
    const scrolla = dati.scrollW > dati.vw && !dati.locked;
    if (scrolla) reg('scroll-orizzontale', 'scroll', `scrollW ${dati.scrollW} > ${dati.vw}`, { sw: dati.scrollW, vw: dati.vw });
    (dati.overflowDett || []).forEach(o => reg('fuori-bordo', o.sel, `sticks out: ${o.sel} L${o.l} R${o.r}`, o, scrolla ? 'blocco' : 'avviso'));
    if (bloccanti.length) {
      fail += 1;
      console.log(`FAIL  ${label}\n      ${bloccanti.join('\n      ')}`);
    } else {
      console.log(`PASS  ${label}`);
    }
  }
}
const elenco = Array.from(segnalazioni.values()).map((v, i) => ({
  id: i + 1,
  tipo: v.tipo,
  classe: v.classe,
  gravita: v.gravita,
  route: v.route,
  viewport: v.viewport,
  dettaglio: v.dettaglio,
  fix: TIPI[v.tipo].fix(v.params),
}));
const nBlocchi = elenco.filter(v => v.gravita === 'blocco').length;
const reportJson = {
  data: new Date().toISOString(),
  base,
  route: pagine,
  viewport: viewports.map(([w, h]) => `${w}x${h}`),
  badgePiattaformaIgnorati: Array.from(badgeIgnorati),
  esito: fail ? 1 : 0,
  conteggi: {
    segnalazioni: elenco.length,
    difettiBloccanti: nBlocchi,
    difettiAvviso: elenco.length - nBlocchi,
  },
  segnalazioni: elenco,
};
const outFile = path.resolve(process.cwd(), opt.out || 'gate-report.json');
fs.writeFileSync(outFile, JSON.stringify(reportJson, null, 2));

console.log('\n=== gate-lite summary ===');
console.log(`${base}  routes ${pagine.length}  viewports ${reportJson.viewport.join(', ')}`);
console.log(`Findings ${elenco.length} (blocking ${nBlocchi}, warnings ${elenco.length - nBlocchi})`);
if (badgeIgnorati.size) console.log(`Platform badges ignored: ${Array.from(badgeIgnorati).join(', ')}`);
for (const v of elenco) {
  console.log(`\n#${v.id} [${v.classe}/${v.gravita}] ${v.tipo}  ${v.route} @ ${v.viewport.join(', ')}\n   ${v.dettaglio}\n   fix: ${v.fix}`);
}
console.log(`\nJSON: ${outFile}`);
console.log(fail ? 'RESULT: there are blocking findings. Apply the fixes and run again.' : 'RESULT: no blocking findings.');

process.exit(fail ? 1 : 0);
