// `eventmodelers init --prototype` and `eventmodelers prototype …` — a local, prompt-editable prototype of one context
// that syncs back to the board. Self-contained and removable: delete this folder, test/prototype-local.test.js and the
// three hooks in cli.js (the import, `--prototype`/`--no-claude` on init plus its one-line delegate, registerPrototype()).
// `eventmodelers prototype remove` cleans a project first. Project state lives in .prototype/.
import { createInterface } from 'node:readline/promises';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchAuthError, runFetch } from '../../lib/fetch.js';
import { SKILL_SRC, VENDOR_FILES, assemble, plan, status } from './local-build.js';
import { serve, watchModel } from './serve.js';
import { resolveAcpAgent } from '../../shared/build-kit/lib/acp-session.js';
import { createEmptyPrototype } from './empty.js';
import { startAgentLoop } from './loop.js';
import { OUTCOMES, REQUESTS, claim, control, markProcessed, markTranslated, stateOf } from './control.js';
import { addChange } from './changes.js';
import { listTools } from './mcp.js';
import { runChanges, submitApplied } from './pipeline.js';
import { hasLocalChanges, runSync } from './sync.js';
import { playLink, share } from './share.js';
import { buildWalkthrough, walkthroughText } from './walkthrough.js';
import { DIR, editedScreens, hasScreenBaseline, loadScreens, loadSlices, paths, readJson, snapshotBaseline, snapshotScreens, writeJson, writeScreens } from './state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', '..', 'cli.js');
const APP = 'https://app.eventmodelers.ai';
const START = '<!-- eventmodelers-prototype:start -->';
const END = '<!-- eventmodelers-prototype:end -->';

const SYNC_SWEEP_MS = 30_000;
const SKILLS = ['local-prototype', 'local-prototype-model', 'local-prototype-build', 'local-prototype-control', 'local-apply-feedback'];
const SHARED = join(HERE, '..', '..', 'shared', 'skills');
// The event modeling rules a change has to follow (an automation needs a todo-list read model, every field a source, every slice scenarios …) are
// the modeling kit's own skills, copied as they are: the translator reads them for the rules and expresses the result as changes — it does not run
// their board-writing steps. They are not removed again by `prototype remove` (a folder may use them for other work too).
const MODELING_KIT_SKILLS = join(HERE, '..', '..', 'stacks', 'modeling-kit', 'templates', '.claude', 'skills');
export const MODELING_RULES = [
  'eventmodeling-core-rules', 'eventmodeling-designing-event-models', 'eventmodeling-slicing-event-models', 'eventmodeling-identifying-inputs',
  'eventmodeling-identifying-outputs', 'eventmodeling-designing-automation-chains', 'eventmodeling-translating-external-events',
  'eventmodeling-information-completeness', 'eventmodeling-elaborating-scenarios', 'eventmodeling-validating-event-models',
  'eventmodeling-validating-event-models-checklist', 'eventmodeling-applying-conways-law', 'attributes', 'add-next-slice', 'place-element', 'html-screen', 'storyboard-screen',
];

/** Installs the skills into .claude/skills/ and the rules block into ./CLAUDE.md (between markers; the rest is untouched). */
// What this extension installed before its skills got the local- prefix. Removed on (re-)init — but only when the folder really is ours:
// the platform's modeling kit has skills called `prototype` and `apply-feedback`, which must stay (they never call this CLI's `prototype`).
const LEGACY = ['prototype', 'prototype-model', 'prototype-build', 'prototype-control', 'apply-feedback'];
function dropLegacySkills(cwd) {
  for (const name of LEGACY) {
    const file = join(cwd, '.claude', 'skills', name, 'SKILL.md');
    if (existsSync(file) && /cli\.js" prototype /.test(readFileSync(file, 'utf8'))) rmSync(join(cwd, '.claude', 'skills', name), { recursive: true, force: true });
  }
}

// The agent works on the local model and records changes; the board is written when the changes are executed (in order, with the conflict check),
// never by the agent's own MCP tools. The write tools of the board's MCP server are therefore denied in this folder (reads stay: get_*, list_*, validate_*).
export const BOARD_WRITE_TOOLS = [
  'add_column', 'add_comment', 'add_lane', 'add_scenario', 'add_storyline', 'auto_connect_node', 'claim_slice', 'clear_cell', 'commit_board_to_git',
  'create_chapter', 'create_drawing', 'create_prompt', 'create_screen', 'create_slice', 'create_slice_definition', 'create_snippet_type', 'delete_column',
  'delete_node', 'drop_node_to_cell', 'link_element', 'move_node_in_timeline', 'move_timeline_position', 'move_timeline_structure', 'place_element',
  'place_image', 'post_chat_message', 'remove_lane', 'render_screen', 'set_connection', 'submit_node_events', 'update_comment', 'update_prompt_status',
  'update_slice_status',
].map((t) => `mcp__eventmodelers__${t}`);

/** Adds (or removes) the board's write tools to permissions.deny of .claude/settings.local.json, keeping everything else in the file. */
export function denyBoardWrites(cwd, deny = true) {
  const file = join(cwd, '.claude', 'settings.local.json');
  let settings = {};
  try { settings = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ }
  const have = new Set(settings.permissions?.deny || []);
  for (const t of BOARD_WRITE_TOOLS) { if (deny) have.add(t); else have.delete(t); }
  if (!deny && !existsSync(file)) return;
  settings.permissions = { ...(settings.permissions || {}), deny: [...have] };
  if (!deny && !settings.permissions.deny.length) delete settings.permissions.deny;
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
}

export function installSkills(cwd) {
  dropLegacySkills(cwd);
  denyBoardWrites(cwd);
  const fill = (text) => text.replaceAll('{{CLI}}', `node "${CLI}"`);
  const skills = join(cwd, '.claude', 'skills');
  for (const name of SKILLS) {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), fill(readFileSync(join(HERE, 'skills', name, 'SKILL.md'), 'utf8')));
  }
  cpSync(join(SHARED, 'connect'), join(skills, 'connect'), { recursive: true }); // asks for the board credentials
  cpSync(join(SHARED, 'learn-eventmodelers-api'), join(skills, 'learn-eventmodelers-api'), { recursive: true }); // what the modeling skills look endpoints up in
  for (const name of MODELING_RULES) if (existsSync(join(MODELING_KIT_SKILLS, name))) cpSync(join(MODELING_KIT_SKILLS, name), join(skills, name), { recursive: true });
  const refs = join(skills, 'local-prototype-build', 'references');
  mkdirSync(refs, { recursive: true });
  copyFileSync(join(SKILL_SRC, 'SKILL.md'), join(refs, 'block-rules.md'));
  copyFileSync(join(SKILL_SRC, 'assets', 'slices.example.html'), join(refs, 'slices.example.html'));

  const block = `${START}\n${fill(readFileSync(join(HERE, 'claude-block.md'), 'utf8')).trim()}\n${END}\n`;
  const file = join(cwd, 'CLAUDE.md');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const i = current.indexOf(START), j = current.indexOf(END);
  writeFileSync(file, i >= 0 && j > i ? current.slice(0, i) + block + current.slice(j + END.length).replace(/^\n/, '') : current ? `${current.trimEnd()}\n\n${block}` : block);
}

const REQUIRED = ['organizationId', 'boardId', 'token'];

/** The board credentials: from the usual config files, asked for (once) when missing — the way `init --modeling` does it. */
async function resolveCredentials(deps, { cwd, config, print, force = false, overrides = {} }) {
  const effective = deps.loadEffectiveConfig(cwd, deps.findInstalledKitDir(cwd), config);
  // Flags win over the config files, as everywhere (`run --prototype --base-url … --board-id …`).
  let cfg = { ...effective.config, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
  let prompted = false;
  const configPath = config ? resolve(cwd, config) : join(cwd, '.eventmodelers', 'config.json');
  const prompt = async (f = false) => {
    cfg = await deps.configureCredentials({ config: cfg, configPath, targetDir: cwd, requiredFields: REQUIRED, boardIdOptional: false, overrides: {}, print, force: f });
    if (REQUIRED.some((k) => !cfg[k])) throw new Error('Still missing token/organizationId/boardId.');
  };
  if (force || REQUIRED.some((k) => !cfg[k])) {
    if (!process.stdin.isTTY) throw new Error('No board credentials here yet — run `eventmodelers init --prototype` (or the connect skill) first; they are saved to .eventmodelers/config.json.');
    await prompt(force);
    prompted = true;
  }
  return { cfg, prompted, source: effective.configPath, reprompt: async () => { await prompt(); return cfg; } };
}

const apiOf = (cfg) => `${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;

/** The board's contexts: [{ id, title, type }] — MODEL_CONTEXTs first, then timelines. */
export async function listContexts(cfg) {
  const headers = { 'x-token': cfg.token, 'x-user-id': 'prototype-local' };
  const found = [];
  for (const type of ['MODEL_CONTEXT', 'CHAPTER']) {
    const res = await fetch(`${apiOf(cfg)}/nodes?type=${type}&projection=line`, { headers });
    if (res.status === 401 || res.status === 403) throw new Error(`The board rejected these credentials (HTTP ${res.status}) — run \`eventmodelers init --prototype --force\`.`);
    if (!res.ok) throw new Error(`Listing ${type} nodes failed: HTTP ${res.status}`);
    const body = await res.json();
    for (const n of Array.isArray(body) ? body : body.nodes || []) found.push({ id: n.id, title: n.title || '', type });
  }
  return found;
}

// The CLI's fetch (lib/fetch.js) ends the whole process on a failure — right for `eventmodelers fetch`, fatal for a long-running player: a refused
// Fetch or a 404 after a change took the server down, and the page went white. Inside the player that exit becomes an error the caller reports.
async function withoutExit(fn) {
  const real = process.exit;
  process.exit = (code) => { throw new Error(`the fetch failed (exit ${code ?? 0}) — the message above says why`); };
  try { return await fn(); } finally { process.exit = real; }
}

/** `fetchContext` for the running player: a failure rejects instead of ending the process. */
export const refetchSafely = (cwd, creds, context) => withoutExit(() => fetchContext(cwd, creds, context));

/** Fetches one context's model and screens into <cwd>/.slices and .prototype/, and takes the baseline. */
async function fetchContext(cwd, { cfg, reprompt }, context) {
  const p = paths(cwd);
  mkdirSync(p.root, { recursive: true });
  let use = cfg;
  try {
    await runFetch({ cwd, kitDir: null, cfg: use, opts: { context } });
  } catch (err) {
    if (!(err instanceof FetchAuthError)) throw err;
    console.error(`❌ ${err.message}`);
    use = await reprompt();
    await runFetch({ cwd, kitDir: null, cfg: use, opts: { context } });
  }
  const name = readJson(join(p.slices, 'current_context.json'), {}).name || context;
  // The board's id of this context / timeline (a chapter), for whoever writes a board tool call — the model has only names.
  let contextRef = {};
  try { const hit = (await listContexts(use)).find((c) => c.id === context || c.title === name); if (hit) contextRef = { contextId: hit.id, contextType: hit.type === 'CHAPTER' ? 'timeline' : 'context' }; } catch { /* the id is looked up again when it is asked for */ }
  writeJson(p.state, { ...readJson(p.state, {}), context: name, ...contextRef, fetchedAt: new Date().toISOString() });
  const ids = [...new Set(loadSlices(p).flatMap(({ slice }) => (slice.screens || []).map((x) => x.linkedId || x.id)))];
  // A screen edited here is kept: the board's version of the slices comes in, the screen files you changed do not get overwritten.
  // A project fetched before screens were remembered cannot tell an edit from the board's version: its screens are copied aside first, once.
  if (!hasScreenBaseline(p) && existsSync(p.screens)) {
    const backup = join(p.work, `screens-before-fetch-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    cpSync(p.screens, backup, { recursive: true });
    console.log(`   screens copied to ${join(DIR, 'work', backup.split('/').pop())} first — this fetch cannot tell your edits from the board's version yet`);
  }
  const edited = editedScreens(p).filter((id) => ids.includes(id));
  const kept = join(p.work, 'kept-screens');
  rmSync(kept, { recursive: true, force: true });
  for (const id of edited) cpSync(join(p.screens, id), join(kept, id), { recursive: true });
  await fetchScreens(cwd, use, ids);
  for (const id of edited) { rmSync(join(p.screens, id), { recursive: true, force: true }); cpSync(join(kept, id), join(p.screens, id), { recursive: true }); }
  rmSync(kept, { recursive: true, force: true });
  if (edited.length) console.log(`   kept ${edited.length} screen${edited.length === 1 ? '' : 's'} you edited here (not synced to the board yet — Sync writes them): ${edited.join(', ')}`);
  snapshotBaseline(p);
  snapshotScreens(p, edited);
  await ensureVendor(cwd);
}

// The CLI's own prompt (one readline on stdin for the whole process). A second readline here would echo every key twice
// while the credentials step's one is still open, and could swallow piped input.
let sharedPrompt = null;
async function ask(question) {
  if (sharedPrompt) return sharedPrompt(question);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
const askYesNo = async (question, yes = true) => {
  const a = (await ask(`${question} [${yes ? 'Y/n' : 'y/N'}] `)).toLowerCase();
  return a ? a.startsWith('y') : yes;
};

/** A numbered pick from the board's contexts — a number, a name or an id. */
async function pickContext(contexts) {
  contexts.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c.title || '(unnamed)'}  [${c.type === 'CHAPTER' ? 'timeline' : 'context'}]`));
  for (;;) {
    const a = await ask('Which one? (number, name or id) ');
    const hit = contexts[Number(a) - 1] || contexts.find((c) => c.id === a || c.title.toLowerCase() === a.toLowerCase());
    if (hit) return hit.id;
    console.log('  Not one of the above.');
  }
}

/** `init --prototype`, like `init --modeling`: install the skills, ask for the board credentials. Claude is started by the user. */
export async function initPrototype(deps, { cwd = process.cwd(), config, print, force, empty = false, refresh = false } = {}) {
  sharedPrompt = deps.prompt || null;
  // A prototype gets a folder of its own: it writes its rules into this folder's CLAUDE.md, which a build or modeling kit would share.
  const kitDir = !refresh && deps.findInstalledKitDir(cwd);
  if (kitDir) {
    console.error(`❌ This folder already has a kit (${basename(kitDir)}/). A prototype needs a folder of its own — run \`eventmodelers init --prototype\` in an empty directory.`);
    process.exit(1);
  }
  if (refresh && !force) {
    // `re-init` in a prototype folder: the skills, the CLAUDE.md block and the page libraries from this CLI version — no questions, the model and
    // .prototype/ untouched, credentials as they are (a folder without a board stays without one; --force asks for them again).
    installSkills(cwd);
    await ensureVendor(cwd);
    try {
      const cfg = deps.loadEffectiveConfig(cwd, deps.findInstalledKitDir(cwd), config).config;
      if (REQUIRED.every((k) => cfg[k])) deps.registerMcp(cwd, cfg);
    } catch { /* no usable config: nothing to register */ }
    console.log('✅ Prototype refreshed: skills local-prototype, local-prototype-model, local-prototype-build, local-prototype-control, local-apply-feedback, connect and the event modeling rules (eventmodeling-*); rules in CLAUDE.md; page libraries. The model and .prototype/ are untouched.');
    return;
  }
  if (empty) {
    // No board, no credentials: a local model of one Hello World page. An existing model is never touched.
    const p = paths(cwd);
    if (existsSync(p.state)) console.log('A local model is already here — nothing created (delete .prototype/ and .slices/ to start over).');
    else {
      const made = createEmptyPrototype(cwd);
      console.log(`✅ Empty prototype created: one slice "Hello World" with its page (context "${made.context}"), no board needed.`);
    }
    installSkills(cwd);
    await ensureVendor(cwd);
    console.log('✅ Skills local-prototype, local-prototype-model, local-prototype-build, local-prototype-control, local-apply-feedback installed; rules added to CLAUDE.md.');
    console.log('\nRun `eventmodelers run --prototype` to see it, and `claude` to change it. To connect a board later: the connect skill (it saves .eventmodelers/config.json).');
    return;
  }
  const creds = await resolveCredentials(deps, { cwd, config, print, force });
  const { cfg, prompted, source } = creds;
  console.log(prompted
    ? `✅ Board credentials saved (board ${cfg.boardId}).`
    : `✅ Using the existing board credentials from ${source ? source.replace(process.env.HOME, '~') : 'the environment'} (board ${cfg.boardId}). To use another board: eventmodelers init --prototype --force`);
  // The eventmodelers MCP server, the way every other install registers it: in place before the first `claude` starts.
  deps.registerMcp(cwd, cfg);
  console.log('✅ MCP server registered (.mcp.json) — the board tools are available in the next `claude` session.');
  const p = paths(cwd);
  const interactive = process.stdin.isTTY;

  // 1. the model
  let fetched = false;
  const have = existsSync(p.state);
  if (interactive) {
    const unsynced = have && hasLocalChanges(cwd);
    const q = have ? `\nA local model is already here${unsynced ? ' with UNSYNCED changes' : ''}. Fetch it again from the board${unsynced ? ' (discards them)' : ''}?` : '\nShould I fetch the model from the board?';
    if (await askYesNo(q, !have)) {
      try {
        const contexts = await listContexts(cfg);
        if (!contexts.length) console.log('   The board has no contexts or timelines yet.');
        else await fetchContext(cwd, { cfg, reprompt: async () => cfg }, await pickContext(contexts));
        fetched = contexts.length > 0;
      } catch (err) {
        console.error(`❌ ${err.message}`);
      }
    }
  }

  // 2. the prototype
  if (!interactive || (await askYesNo('\nShould I initialize the prototype here (skills, CLAUDE.md rules, page libraries)?', true))) {
    installSkills(cwd);
    await ensureVendor(cwd);
    console.log('✅ Prototype initialized: skills local-prototype, local-prototype-model, local-prototype-build, local-prototype-control, local-apply-feedback, connect; rules added to CLAUDE.md.');
  }
  console.log(existsSync(p.state)
    ? `\n${fetched ? 'The model is fetched.' : 'A local model is here.'} Run \`claude\`, then /local-prototype — it builds the page from it and serves it.`
    : '\nNo model yet. Run `claude`, then /local-prototype, or: eventmodelers prototype fetch --context <name>');
}

function removeRules(cwd) {
  dropLegacySkills(cwd);
  denyBoardWrites(cwd, false);
  for (const name of SKILLS) rmSync(join(cwd, '.claude', 'skills', name), { recursive: true, force: true });
  const file = join(cwd, 'CLAUDE.md');
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  const i = text.indexOf(START), j = text.indexOf(END);
  if (i < 0 || j < i) return;
  const rest = (text.slice(0, i) + text.slice(j + END.length)).trim();
  if (rest) writeFileSync(file, rest + '\n');
  else rmSync(file);
}

async function ensureVendor(cwd) {
  const p = paths(cwd);
  mkdirSync(p.vendor, { recursive: true });
  for (const f of VENDOR_FILES) {
    if (existsSync(join(p.vendor, f))) continue;
    const res = await fetch(`${APP}/vendor/${f}`);
    if (!res.ok) throw new Error(`Could not download ${APP}/vendor/${f}: HTTP ${res.status}`);
    writeFileSync(join(p.vendor, f), Buffer.from(await res.arrayBuffer()));
  }
}

/** Screens (HTML pages, marks, sketches) of every slice, the way the platform's prototype skill reads them. */
async function fetchScreens(cwd, cfg, ids) {
  const api = `${(cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, '')}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;
  const headers = { 'x-token': cfg.token, 'x-user-id': 'prototype-local', 'content-type': 'application/json' };
  const screens = {};
  if (ids.length) {
    const res = await fetch(`${api}/nodes/query`, { method: 'POST', headers, body: JSON.stringify({ ids }) });
    if (!res.ok) throw new Error(`Reading screens failed: HTTP ${res.status} ${await res.text()}`);
    for (const node of await res.json()) {
      const meta = typeof node.meta === 'string' ? JSON.parse(node.meta) : node.meta || {};
      const frameworks = meta.cssFrameworks || node.cssFrameworks || node.data?.cssFrameworks || [];
      screens[node.id] = { type: node.type || meta.type, title: meta.title || node.data?.title || node.title || '', pages: meta.pages || null, marks: meta.marks || null, cssFrameworks: frameworks };
    }
    await Promise.all(Object.entries(screens).filter(([, s]) => !s.pages).map(async ([id, s]) => {
      const res = await fetch(`${api}/images/${id}/description`, { headers });
      s.sketch = res.ok ? await res.json() : null;
    }));
  }
  writeScreens(paths(cwd), screens);
}

export function registerPrototype(program, deps) {
  for (const name of ['prototype', 'contexts', 'fetch', 'sync', 'assemble', 'remove', 'events', 'claim', 'processed', 'changes', 'add', 'translated', 'run', 'submit', 'board', 'tools', 'share']) deps.noInitRequired.add(name); // `status` already is

  // The board in EM Studio, for the player's "Jump to Board" link: the board of this folder's config (none: no link — an empty prototype has no board).
  const studioUrl = (deps, cwd, command) => {
    try {
      const g = command.optsWithGlobals();
      const cfg = { ...deps.loadEffectiveConfig(cwd, deps.findInstalledKitDir(cwd), g.config).config, ...Object.fromEntries(Object.entries({ boardId: g.boardId, baseUrl: g.baseUrl }).filter(([, v]) => v !== undefined)) };
      if (!cfg.boardId) return null;
      // The app lives next to the API: api.eventmodelers.ai → app.eventmodelers.ai (beta-api → beta-app).
      const host = cfg.baseUrl ? new URL(cfg.baseUrl).host.replace(/(^|-)api\./, '$1app.') : new URL(APP).host;
      const origin = cfg.baseUrl && /^http:/.test(cfg.baseUrl) ? `http://${host}` : `https://${host}`;
      return `${origin}/?board=${encodeURIComponent(cfg.boardId)}`;
    } catch { return null; }
  };

  // Which board this folder is connected to, without the token: what the agent is told, and what the banner says.
  const connectionOf = (deps, cwd, command) => {
    try {
      const g = command.optsWithGlobals();
      const cfg = { ...deps.loadEffectiveConfig(cwd, deps.findInstalledKitDir(cwd), g.config).config, ...Object.fromEntries(Object.entries({ boardId: g.boardId, organizationId: g.organizationId, baseUrl: g.baseUrl }).filter(([, v]) => v !== undefined)) };
      if (!cfg.boardId) return null;
      const state = readJson(paths(cwd).state, {});
      return { boardId: cfg.boardId, organizationId: cfg.organizationId || null, api: (cfg.baseUrl || 'https://api.eventmodelers.ai').replace(/\/$/, ''), studio: studioUrl(deps, cwd, command), context: state.context || null, contextId: state.contextId || null, contextType: state.contextType || null };
    } catch { return null; }
  };

  const credentials = (command) => {
    const g = command.optsWithGlobals();
    return resolveCredentials(deps, { cwd: process.cwd(), config: g.config, print: g.print, overrides: { token: g.token, boardId: g.boardId, organizationId: g.organizationId, baseUrl: g.baseUrl } });
  };

  /** Serves the prototype in this folder and watches the model; shared by `prototype` and `run --prototype`. */
  const runPrototype = async (opts, command) => {
    const cwd = process.cwd();
    const p = paths(cwd);
    if (!existsSync(p.state)) { console.error('❌ No prototype in this folder yet. Run `eventmodelers init --prototype`, then /local-prototype in Claude Code — or `eventmodelers prototype fetch --context <name>`.'); process.exit(1); }
    await ensureVendor(cwd);
    // A long-running player: an error in a background task is reported, it does not end the process.
    const keepAlive = (err) => console.error(`❌ ${err && err.stack ? err.stack.split('\n').slice(0, 2).join(' ') : err}`);
    process.on('unhandledRejection', keepAlive);
    process.on('uncaughtException', keepAlive);
    const stale = () => plan(cwd).slices.filter((s) => s.state !== 'unchanged');
    let agent = null; // the agent loop (run --prototype)
    const server = await serve({ cwd, port: opts.port, studio: studioUrl(deps, cwd, command), runtime: () => ({ sync: !!opts.sync, agent: !!agent, busy: !!(agent && agent.busy()) }) });
    console.log(`\n✅ Prototype: ${server.url}`);
    console.log('   Change it with prompts in Claude Code (`claude` in this folder, or /local-prototype): local-prototype-model changes the model, local-prototype-build reflects it here.');
    if (stale().length) console.log(`   ${stale().length} slice${stale().length === 1 ? '' : 's'} not built into the page yet.`);
    const connection = connectionOf(deps, cwd, command);
    console.log(connection ? `   Board: ${connection.boardId} on ${connection.api.replace(/^https?:\/\//, '')}${connection.context ? ` — ${connection.contextType || 'context'} "${connection.context}"${connection.contextId ? ` (${connection.contextId})` : ''}` : ''}` : '   Board: none connected (a local-only prototype — `connect` adds one).');

    let cred = null;
    let syncing = false, again = false;
    const syncNow = async () => {
      // While the agent loop executes changes, the board gets them one by one in order — the watcher's sync would send the same edits unordered.
      if (agent && agent.busy()) { setTimeout(syncNow, 3000); return; }
      if (syncing) { again = true; return; }
      syncing = true;
      try {
        cred ??= await credentials(command);
        await runSync({ cwd, cfg: cred.cfg, yes: true });
      } catch (err) {
        console.error(`❌ Sync failed: ${err.message}`);
      } finally {
        syncing = false;
        if (again) { again = false; syncNow(); }
      }
    };
    const watcher = watchModel({
      cwd,
      onChange: (files) => {
        console.log(`\n✎ Model changed (${files.length} file${files.length === 1 ? '' : 's'})${stale().length ? ` — ${stale().length} slice block${stale().length === 1 ? '' : 's'} to rebuild` : ''}`);
        if (opts.sync) syncNow();
        else console.log('   `eventmodelers prototype sync` writes it back to the board.');
      },
    });
    // The sync loop: besides pushing on every change, sweep every SYNC_SWEEP_MS so a failed push (offline, expired token) is retried.
    const sweep = opts.sync ? setInterval(() => { if (hasLocalChanges(cwd)) syncNow(); }, SYNC_SWEEP_MS) : null;
    if (opts.sync && hasLocalChanges(cwd)) syncNow();
    // `run --prototype`: the agent loop reads the control log each iteration (a saved feedback, Sync, Rebuild pressed in the player).
    if (opts.loop) {
      // The agent is told which board and which timeline (chapter) it works on: look the id up once, if this folder was fetched before it was kept.
      try {
        const known = readJson(p.state, {});
        if (connection && !known.contextId && known.context) {
          cred ??= await credentials(command);
          const hit = (await listContexts(cred.cfg)).find((c) => c.title === known.context);
          if (hit) { writeJson(p.state, { ...known, contextId: hit.id, contextType: hit.type === 'CHAPTER' ? 'timeline' : 'context' }); Object.assign(connection, { contextId: hit.id, contextType: hit.type === 'CHAPTER' ? 'timeline' : 'context' }); }
        }
      } catch { /* the agent looks it up itself: prototype board */ }
      try {
        const acp = resolveAcpAgent({ name: opts.acpAgent?.name || 'claude', cmd: opts.acpAgent?.cmd });
        agent = startAgentLoop({ cwd, agent: acp, connection, direct: !!opts.sync, stale: () => stale(), refetch: async () => { cred ??= await credentials(command); await refetchSafely(cwd, cred, readJson(p.state, {}).context); }, credentials: async () => (cred ??= await credentials(command)) });
      } catch (err) { console.error(`❌ ${err.message}`); }
    }
    if (agent) console.log(`   Agent loop: each iteration it reads what Sync / Rebuild / saved feedback recorded in the player — Sync and Rebuild are done right away, feedback is translated into changes and applied to the local model, ${opts.sync ? 'and written to the board right away, one by one (--sync)' : 'and the changes stay local until `prototype sync` (--sync writes them to the board right away)'}. Warm ${opts.acpAgent?.cmd ? 'ACP' : (opts.acpAgent?.name || 'claude')} session.`);
    console.log(opts.sync ? '   --sync: changes go back to the board automatically (and are retried every 30s until they land). Ctrl+c stops.' : '   Changes stay local until `eventmodelers prototype sync` (or Sync in the player). Ctrl+c stops.');
    await new Promise((done) => process.once('SIGINT', done));
    if (agent) agent.stop();
    if (sweep) clearInterval(sweep);
    watcher.close();
    server.close();
    process.off('unhandledRejection', keepAlive);
    process.off('uncaughtException', keepAlive);
  };

  const proto = program
    .command('prototype')
    .description('Serve and watch the local prototype in this folder (set up with `init --prototype`, fetched by the /local-prototype skill). Subcommands: contexts, fetch, sync, share, status, assemble, events, remove')
    .option('--port <port>', 'Port to serve on (the next free one is used when it is taken)', (v) => parseInt(v, 10), 4173)
    .option('--sync', 'Write model changes back to the board automatically, a moment after the files settle (retried every 30s until they land)')
    .action(runPrototype);

  proto.command('board').description('Everything a board tool call needs that the local model lacks: the board, the context / timeline (chapter) id, the slices\' ids — and the studio link')
    .action(async (_, command) => {
      try {
        const cwd = process.cwd();
        const { cfg } = await credentials(command);
        const state = readJson(paths(cwd).state, {});
        let ctx = state.contextId ? { id: state.contextId, type: state.contextType } : null;
        if (!ctx) {
          const hit = (await listContexts(cfg)).find((c) => c.title === state.context);
          if (hit) { ctx = { id: hit.id, type: hit.type === 'CHAPTER' ? 'timeline' : 'context' }; writeJson(paths(cwd).state, { ...state, contextId: ctx.id, contextType: ctx.type }); }
        }
        console.log(JSON.stringify({
          boardId: cfg.boardId, organizationId: cfg.organizationId, studio: studioUrl(deps, cwd, command),
          context: { name: state.context, ...(ctx || {}) },
          note: 'A timeline is a chapter: its id is the chapterId / timelineId a tool asks for. Tool inputs: `prototype tools <name>`. boardId is filled in when a tool call is executed.',
          slices: loadSlices(paths(cwd)).map(({ id, slice }) => ({ id, title: slice.title, chapter: slice.chapter, sliceType: slice.sliceType })),
        }, null, 2));
      } catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    });

  proto.command('tools').description('The board\'s tools (the eventmodelers MCP tools) a change can call: names, or with a name the exact input schema — so a tool call is written exactly, not guessed')
    .argument('[name]', 'A tool name: prints its description and input schema')
    .action(async (name, _, command) => {
      try {
        const { cfg } = await credentials(command);
        const tools = await listTools(cfg);
        if (!name) { for (const t of tools) console.log(`${t.name}  ${t.description.split('\n')[0].slice(0, 110)}`); return; }
        const tool = tools.find((t) => t.name === name.replace(/^mcp__eventmodelers__/, ''));
        if (!tool) { console.error(`❌ No tool "${name}". \`prototype tools\` lists them.`); process.exit(1); }
        console.log(JSON.stringify(tool, null, 2));
      } catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    });

  proto.command('contexts').description('List the board\'s contexts and timelines — the names `fetch --context` takes')
    .action(async (_, command) => {
      try {
        const { cfg } = await credentials(command);
        for (const c of await listContexts(cfg)) console.log(`${c.type === 'CHAPTER' ? 'timeline' : 'context '}  ${c.title || '(unnamed)'}  ${c.id}`);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });

  proto.command('fetch')
    .description('Fetch one context\'s model and screens into .prototype/ (credentials from .eventmodelers/config.json; refuses while there are unsynced local changes, unless --force)')
    .requiredOption('--context <name>', 'Context (or timeline) name or id')
    .option('--force', 'Discard unsynced local changes')
    .action(async (opts, command) => {
      const cwd = process.cwd();
      if (!opts.force && existsSync(paths(cwd).state) && hasLocalChanges(cwd)) { console.error('❌ There are local model changes that are not synced. Run `eventmodelers prototype sync` first, or pass --force to discard them.'); process.exit(1); }
      try {
        await fetchContext(cwd, await credentials(command), opts.context);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      console.log('Fetched. Build the page with the local-prototype-build skill, then `eventmodelers prototype` serves it.');
    });

  proto.command('sync').description('Write everything local back to the board: first the changes feedback was translated into — each executed one by one, in order, as its node:changed event or recorded tool call — then the rest of the local model\'s differences (fields, descriptions and HTML screens; the rest is listed as not synced)')
    .option('--yes', 'Do not ask for confirmation').option('--dry-run', 'Only list what would be written')
    .action(async (opts, command) => {
      const cwd = process.cwd();
      if (!existsSync(paths(cwd).state)) { console.error('❌ No prototype in this folder.'); process.exit(1); }
      try {
        const c = control(cwd);
        const todo = c.changes.filter((ch) => ['requested', 'working', 'applied'].includes(ch.state)); // in global order
        if (todo.length) {
          console.log(`\nChanges, in order:`);
          for (const ch of todo) console.log(`  ${ch.state === 'requested' || ch.state === 'working' ? 'execute  ' : 'to board '}#${ch.seq} ${ch.summary}  [${ch.exec.kind === 'node:changed' ? 'node:changed ' + Object.keys(ch.exec.event.meta).join(',') : ch.exec.call.name}]`);
        }
        if (opts.dryRun) { await runSync({ cwd, cfg: null, dryRun: true }); return; }
        const { cfg } = await credentials(command);
        if (todo.length && !opts.yes && !(await askYesNo(`\nExecute ${todo.length} change${todo.length === 1 ? '' : 's'} against the board?`, false))) return;
        if (todo.length) await runChanges(cwd, cfg, { toBoard: true, log: console.log }); // one ordered pass: pending ones executed, applied ones sent
        await runSync({ cwd, cfg, yes: opts.yes || todo.length > 0 });
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });

  proto.command('share').description('Store the page on the platform, for the context it was fetched from — what the board\'s ▶ button plays, the same as the platform prototype skill\'s upload. Prints the link; the platform sanitizes the page')
    .action(async (_, command) => {
      const cwd = process.cwd();
      if (!existsSync(paths(cwd).state)) { console.error('❌ No prototype in this folder.'); process.exit(1); }
      try {
        const { cfg } = await credentials(command);
        const r = await share(cwd, cfg, { contexts: listContexts });
        for (const w of r.warnings) console.log(`⚠ ${w}`);
        console.log(`✅ Stored "${r.stored.contextName}" (${r.stored.bytes} bytes, ${r.stored.gzippedBytes} gzipped)`);
        if (r.stored.removed.length) console.log(`   The platform removed ${r.stored.removed.length} thing(s) from the page:\n     ${r.stored.removed.join('\n     ')}`);
        console.log(`   Play it: ${playLink(APP, cfg, r.contextId, r.context)}  (needs a login with access to the board)`);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });

  proto.command('status').description('Which slices need a block (new / changed / unchanged) — used by Claude when rebuilding')
    .action(() => {
      const r = status(process.cwd());
      for (const s of r.slices) console.log(`${s.state.padEnd(9)} ${s.hash}  ${s.id}  ${s.title}`);
      for (const s of r.removed) console.log(`removed   ${''.padEnd(16)}  ${s.id}  ${s.title}`);
      console.log(`\n${r.slices.filter((s) => s.state !== 'unchanged').length} of ${r.slices.length} slices to build — see ${join(DIR, 'work', 'status.json')}`);
    });

  proto.command('walkthrough').description('Everything that is only local, slice by slice — one walkthrough of what differs from the board (also the player\'s "Walk me through it" button, at /walkthrough). Changes nothing')
    .option('--json', 'Print it as JSON')
    .action((opts) => {
      const w = buildWalkthrough(process.cwd());
      console.log(opts.json ? JSON.stringify(w, null, 2) : walkthroughText(w));
    });

  proto.command('assemble').description('Build .prototype/index.html from the slice blocks').action(() => {
    try {
      const r = assemble(process.cwd());
      console.log(`Wrote ${r.page} — ${r.blocks} slice blocks`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

  const events = proto.command('events').description('The control channel between the player and the agent: what the player asked for (a saved feedback → FeedbackRecorded, Sync → SyncRequested, Rebuild → RebuildRequested) and what was processed')
    .option('--pending', 'Only the requests nobody has processed yet').option('--type <types>', 'Only these event types, comma separated')
    .action((opts) => {
      const c = control(process.cwd());
      const want = opts.type ? opts.type.split(',') : null;
      const list = (opts.pending ? c.pending : c.events.filter((e) => REQUESTS.includes(e.type) || e.type === 'FeedbackSubmitted')).filter((e) => !want || want.includes(e.type));
      if (opts.pending && want && want.includes('FeedbackSubmitted')) list.push(...c.events.filter((e) => e.type === 'FeedbackSubmitted' && !c.processed.has(e.id)));
      console.log(JSON.stringify(list.map((e) => ({ ...e, state: stateOf(c, e.id), ...(c.processed.get(e.id) ? { processed: c.processed.get(e.id) } : {}) })), null, 2));
    });
  events.command('claim').description('Say you started on a request').argument('<id>')
    .action((id) => { claim(process.cwd(), id); console.log(`Claimed ${id}.`); });
  events.command('processed').description('Say you are done with a request — a processed request is not picked up again').argument('<id>', 'The request\'s event id')
    .requiredOption('--outcome <outcome>', `One of: ${OUTCOMES.join(', ')}`).option('--note <text>', 'What was done, or what you need from the person')
    .action((id, opts) => {
      try { markProcessed(process.cwd(), id, opts.outcome, opts.note); console.log(`Processed ${id} (${opts.outcome}).`); } catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    });

  // Stage two and three of a multi-stage update (changes.js): the feedback translated into changes, applied one by one.
  const changes = proto.command('changes').description('The changes feedback was translated into (.prototype/changes/, next to events/, one global order): what to change in which node, slice or the board, and how far each got')
    .option('--pending', 'Only the changes not applied to the local model yet')
    .action((opts) => {
      const c = control(process.cwd());
      console.log(JSON.stringify((opts.pending ? c.pendingChanges : c.changes), null, 2));
    });
  changes.command('add').description('Record one change a feedback asks for (stage two) — JSON from --json or stdin: summary, scope, target, action, change, exec ({kind: node:changed, attribute, value} or {kind: tool-call, tool, input})')
    .requiredOption('--from <feedbackEventId>', 'The FeedbackRecorded / FeedbackAnswered event it comes from').option('--json <json>', 'The change as JSON').option('--file <path>', 'The change as a JSON file — for a big value (a screen\'s pages), write the file and pass its path instead of quoting it into the shell')
    .action(async (opts) => {
      try {
        const raw = opts.json ?? (opts.file ? readFileSync(resolve(process.cwd(), opts.file), 'utf8') : await new Promise((ok) => { let b = ''; process.stdin.on('data', (d) => { b += d; }); process.stdin.on('end', () => ok(b)); })); // --json, --file, or stdin
        const cwd = process.cwd();
        const from = control(cwd).requests.find((e) => (e.type === 'FeedbackRecorded' || e.type === 'FeedbackAnswered') && (e.id === opts.from || e.id.startsWith(opts.from)));
        if (!from) throw new Error(`No such feedback request: ${opts.from}`);
        const ch = addChange(cwd, from.id, JSON.parse(raw));
        console.log(`Recorded change #${ch.seq} (${ch.id}): ${ch.summary}`);
      } catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    });
  changes.command('translated').description('Say the feedback is translated: its changes are recorded; --question / --ask for what still needs the person').argument('<feedbackEventId>')
    .option('--question <text...>', 'A question the feedback leaves open, as plain text (repeatable)')
    .option('--ask <json...>', 'A question with options to click: {"question":"…","options":["…","…"]} (repeatable) — the player shows it in a modal and records the answer')
    .action((id, opts) => {
      try {
        const cwd = process.cwd();
        const asks = (opts.ask || []).map((j) => { try { return JSON.parse(j); } catch { throw new Error(`--ask needs JSON: ${j}`); } });
        const mine = markTranslated(cwd, id, [...(opts.question || []), ...asks]);
        console.log(`Translated into ${mine.length} change${mine.length === 1 ? '' : 's'}.`);
        // A new or changed field that a screen should show is two changes: the node's fields, and the screen's pages. Say so when only the first is there.
        for (const slice of [...new Set(mine.filter((c) => c.exec.kind === 'node:changed' && c.exec.event.meta.fields).map((c) => c.target.sliceTitle))]) {
          const screens = loadSlices(paths(cwd)).find((s) => s.slice.title === slice)?.slice.screens || [];
          const htmlScreens = screens.filter((s) => loadScreens(paths(cwd))[s.linkedId || s.id]?.pages);
          const pagesDone = mine.some((c) => c.target.sliceTitle === slice && c.exec.kind === 'node:changed' && c.exec.event.meta.pages);
          if (htmlScreens.length && !pagesDone) console.log(`⚠ "${slice}" changes fields but no change updates its screen's pages (${htmlScreens.map((s) => s.title).join(', ')}) — if the screen should show them, add a node:changed of pages (changes add --from ${id} …). The board's HTML screen is only updated by a change of pages.`);
        }
      } catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    });
  changes.command('run').description('Execute the pending changes one by one, in order (stage three): each is applied to the local model; with --board it is also written to the board — the node:changed event, or the recorded tool call. No agent involved')
    .option('--board', 'Also write them to the board (a tool call needs this)')
    .action(async (opts, command) => {
      try {
        const cfg = opts.board ? (await credentials(command)).cfg : null;
        const { results, local } = await runChanges(process.cwd(), cfg, { toBoard: !!opts.board, log: console.log });
        console.log(results.length ? `${results.filter((r) => r.applied).length} of ${results.length} applied.${local ? ' Rebuild the page: local-prototype-build.' : ''}` : 'No pending changes.');
      } catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    });
  changes.command('submit').description('Write the applied changes to the board, one by one in order — each as its node:changed event')
    .action(async (_, command) => {
      try {
        const { cfg } = await credentials(command);
        const done = await submitApplied(process.cwd(), cfg, console.log);
        console.log(done.length ? `Submitted ${done.filter((d) => d.status === 'submitted' || d.status === 'already').length} of ${done.length}.` : 'Nothing applied that is waiting for the board.');
      } catch (err) { console.error(`❌ ${err.message}`); process.exit(1); }
    });

  proto.command('remove').description('Delete .prototype/, the prototype skills and the prototype block in CLAUDE.md (refuses with unsynced changes, unless --discard)')
    .option('--discard', 'Remove even with unsynced local changes')
    .action((opts) => {
      const cwd = process.cwd();
      if (!opts.discard && existsSync(paths(cwd).state) && hasLocalChanges(cwd)) { console.error('❌ Unsynced local changes — run `eventmodelers prototype sync` or pass --discard.'); process.exit(1); }
      rmSync(paths(cwd).root, { recursive: true, force: true });
      removeRules(cwd);
      console.log(`Removed ${DIR}/, the prototype skills and the prototype block in CLAUDE.md.`);
    });

  return { runPrototype };
}
