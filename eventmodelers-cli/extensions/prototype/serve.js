// Static server for .prototype/ with live reload, plus the file watcher. Dependency-free.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { control, detail, progressOf, record, stateOf } from './control.js';
import { paths, readJson } from './state.js';
import { buildWalkthrough, walkthroughHtml } from './walkthrough.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, 'host.html');
const HOST_DIST = join(HERE, 'host', 'dist'); // the board app's player, built by host/build.mjs
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, fail) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 5e6) req.destroy(); }); req.on('end', () => ok(b)); req.on('error', fail); });

// The server is for the browser on this machine only: it answers to a loopback Host (against DNS rebinding) and, for a POST, to a
// loopback Origin or none at all (against any other web page the user has open — a non-browser client sends no Origin).
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const loopbackHost = (host, port) => LOOPBACK.some((h) => host === `${h}:${port}`);
const loopbackOrigin = (origin, port) => LOOPBACK.some((h) => origin === `http://${h}:${port}`);

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8' };

export async function serve({ cwd, port = 4173, studio = null, runtime = () => ({ sync: false, agent: false, busy: false }) }) {
  const p = paths(cwd);
  const clients = new Set();
  const server = createServer((req, res) => {
    try { handle(req, res); } catch (err) {
      // A file read under a rebuild, a bad request: answer, do not crash the server (the player would go blank).
      console.error(`❌ ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  const handle = (req, res) => {
    const refused = !loopbackHost(req.headers.host, port) || (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && !loopbackOrigin(req.headers.origin, port));
    if (refused) return json(res, 403, { error: 'Forbidden: the prototype server only answers to localhost' });
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/__reload') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // The player's own needs: the context's name, the page (it goes into the player's iframe), what Submit / Sync / Rebuild record.
    if (path === '/api/context') return json(res, 200, { name: (readJson(join(p.work, 'status.json'), {}) || {}).context || '', studio });
    // Whether this run writes changes to the board by itself (--sync) and whether an agent loop is answering the player's requests.
    if (path === '/api/status') return json(res, 200, runtime());
    // The control channel (see control.js): the player records what the user pressed; the agent's answers show up as state.
    if (path === '/api/control' && req.method === 'GET') {
      const c = control(cwd);
      return json(res, 200, c.requests.map((e) => ({ id: e.id, seq: e.seq, type: e.type, at: e.at, state: stateOf(c, e.id), note: (c.processed.get(e.id) || {}).note || progressOf(c, e.id) })));
    }
    if (path.startsWith('/api/control/') && req.method === 'GET') { const d = detail(cwd, path.slice('/api/control/'.length)); return d ? json(res, 200, d) : json(res, 404, { error: 'no such request' }); }
    if (path === '/api/control' && req.method === 'POST') {
      return readBody(req).then((b) => { const { type, data } = JSON.parse(b || '{}'); return json(res, 200, record(cwd, type, data)); }).catch((err) => json(res, 400, { error: err.message }));
    }
    // Everything that is only local, slice by slice — built fresh on every request from the model files; changes nothing.
    if (path === '/api/walkthrough') return json(res, 200, buildWalkthrough(cwd));
    if (path === '/walkthrough') {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      return res.end(walkthroughHtml({ ...buildWalkthrough(cwd), studio }));
    }
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      return res.end(readFileSync(HOST, 'utf8'));
    }
    if (path === '/page.html') {
      if (!existsSync(p.page)) return res.writeHead(404).end('no page yet');
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      return res.end(readFileSync(p.page, 'utf8'));
    }
    if (path === '/host/host.js' || path === '/host/host.css') {
      const dist = join(HOST_DIST, path.slice('/host/'.length));
      if (!existsSync(dist)) return res.writeHead(404).end('The player is not built: run host/build.mjs');
      res.writeHead(200, { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))], 'cache-control': 'no-store' });
      return res.end(readFileSync(dist));
    }
    const file = normalize(join(p.root, path));
    if (path.startsWith('/vendor/') && file.startsWith(p.vendor) && existsSync(file)) {
      res.writeHead(200, { 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
      return res.end(readFileSync(file));
    }
    res.writeHead(404).end('not found');
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((ok, fail) => server.once('error', fail).listen(port + attempt, '127.0.0.1', ok));
      port += attempt;
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' || attempt > 20) throw err;
    }
  }
  const reload = () => clients.forEach((c) => c.write('data: reload\n\n'));
  const pageWatcher = watch(p.root, (_, name) => name === 'index.html' && reload());
  return { url: `http://localhost:${port}/`, close: () => { pageWatcher.close(); clients.forEach((c) => c.end()); server.close(); } };
}

/** Calls `onChange(sliceFiles)` once the model files have been quiet for `quietMs`. */
export function watchModel({ cwd, quietMs = 1500, onChange }) {
  const p = paths(cwd);
  let timer = null;
  const touched = new Set();
  mkdirSync(p.slices, { recursive: true }); // a folder whose model is not fetched yet still serves the player and its control log
  const watcher = watch(p.slices, { recursive: true }, (_, name) => {
    if (!name || !name.endsWith('slice.json')) return;
    touched.add(name);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...touched];
      touched.clear();
      onChange(files);
    }, quietMs);
  });
  return { close: () => { clearTimeout(timer); watcher.close(); } };
}
