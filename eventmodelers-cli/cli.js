#!/usr/bin/env node

import { Command } from 'commander';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path';
import {
  existsSync,
  mkdirSync,
  cpSync,
  copyFileSync,
  rmSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from 'fs';
import { execSync, execFileSync, spawn } from 'child_process';
import { createInterface, emitKeypressEvents, moveCursor, clearScreenDown } from 'readline';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { runFetch, FetchAuthError } from './lib/fetch.js';
import { createModelingLocalAiRunner } from './lib/modeling-local-ai.js';
import { run as runSpecKittyAdapter } from './lib/adapters/spec-kitty-adapter.js';
// Not a root-level adapter like spec-kitty-adapter.js above: this is the one canonical
// copy that every useShared:true stack also gets copied into its installed kit (see
// copyDirContents in installStack) for ralph.js to import standalone — see
// shared/build-kit/lib/adapters/realtime-adapter.js for why it lives there instead.
import { createRealtimeAdapter } from './shared/build-kit/lib/adapters/realtime-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Each stack is a template set under stacks/<key>/templates/{.claude,root,<kitSubdir>}.
// Stacks with useShared:true also get shared/build-kit/* copied into their kit dir
// first (ralph.js, ralph-claude.js, ralph-local-ai.js, ralph-exec.js, ralph.sh, realtime-agent.js,
// code-export.mjs, lib/agent.sh, lib/local-ai-agent.js, package.json, README.md) —
// those files have no per-stack content, so they live once instead of being
// copy-pasted into every stack (that copy-pasting is exactly how they drifted out
// of sync before: a bugfix or default landing in one stack's copy but not another's).
// Each stack's own templates/<kitSubdir>/* is then overlaid on top for genuine
// per-stack differences (ralph-claude.js's build tooling, lib/prompt.md, etc.).
// modeling-kit (below) is the one kit that opts out of all of this (useShared:false)
// — it has no cold-spawn/tasks.json runtime at all, so none of shared/build-kit/*
// applies to it; see its own templates/kit for its (much smaller) self-contained set.
// --- Local-AI runner selection ------------------------------------------------
// One runner drives every local/self-hosted backend. What differs between Ollama,
// vLLM, LM Studio and llama.cpp is the wire dialect (native /api/chat vs the
// OpenAI-compatible /v1/chat/completions) plus a default URL — both handled inside
// lib/local-ai-agent.js. Splitting this per vendor would multiply the one file that
// is currently shared across every stack, so these are presets, not runners.
// Claude (ralph-claude.js) stays the default executor; this is opt-in.
const LOCAL_AI_TARGETS = ['ollama', 'vllm', 'lmstudio', 'llamacpp'];

// null = not requested. true = requested with no preset (the agent then falls back to
// LOCAL_AI_*/config, defaulting to Ollama). A string is a validated preset name.
function resolveLocalAiTarget(opts) {
  const raw = opts.localAi;
  if (raw === undefined || raw === false) return null;
  if (raw === true) return true;
  if (!LOCAL_AI_TARGETS.includes(raw)) {
    console.error(`❌ Unknown --local-ai target "${raw}" — one of: ${LOCAL_AI_TARGETS.join(', ')}.`);
    console.error('   Any other OpenAI-compatible server works by URL instead: LOCAL_AI_URL=http://host:8000/v1');
    process.exit(1);
  }
  return raw;
}

const STACKS = {
  node: {
    label: 'Node.js / TypeScript',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
  supabase: {
    label: 'Supabase',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
  axon: {
    label: 'Axon Framework (Java/Kotlin)',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
  opencqrs: {
    label: 'OpenCQRS (Java, EventSourcingDB)',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
  umadb: {
    label: 'UmaDB (Java)',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
  kurrent: {
    label: 'Kurrent (Java, KurrentDB)',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
  // Frontend-only kits (UI-only: build STATE_CHANGE/STATE_VIEW slices, not
  // AUTOMATION — those belong to whichever backend stack is installed alongside).
  // react overrides lib/ralph.js (+ralph-claude.js/ralph-local-ai.js/package.json/
  // README.md) for board-polling instead of the realtime channel every other
  // stack uses; supabase-react needs no overrides at all — it uses
  // shared/build-kit's realtime agent as-is. react's CLAUDE.md/build-*
  // skills/templates/root are still TODO-marked, same as a fresh `init
  // --build-kit` scaffold — supabase-react's are real, filled-in content
  // (Vite + React 19 + TypeScript + Supabase, plus init-style-guide/
  // learn-styleguide for on-brand generated UI).
  react: {
    label: 'React (frontend, board-polling sync) — TODO-marked, not yet filled in',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
  'supabase-react': {
    label: 'React + Supabase (frontend, UI-only, realtime sync)',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
};

// Not a stack — no backend scaffold, just skills + the agent loop. Installed via
// `init --modeling` instead of the `init --stack <name>` picker.
// useShared:false — unlike build-kit, modeling-kit has no cold-spawn/tasks.json
// runtime to reuse from shared/build-kit/*; its only runtime mode is the CLI's
// own warm, direct-dispatch loop (`run --modeling`), so its kit dir just needs
// lib/config.js for config resolution — see stacks/modeling-kit/templates/kit.
const MODELING_KIT = {
  key: 'modeling-kit',
  label: 'Modeling only — skills + agent loop, no backend scaffold',
  kitSubdir: 'kit',
  kitDirName: '.agent-modeling-kit',
  useShared: false,
  needsBoardId: false,
};

// Frameworks a bridge install can translate board slices into. Each key needs
// a matching `bridge-<key>-specify` skill under shared/bridge/ — see
// stacks/bridge/templates/bridge/lib/prompt.md for how the loop picks it up.
const BRIDGE_TARGETS = {
  'spec-kitty': { label: 'Spec Kitty' },
};

// Also not a stack — no backend scaffold, just the bridge-*/shared skills +
// the agent loop. Installed via `init --bridge --target <name>` instead of
// the `init --stack <name>` picker. useShared:true (unlike modeling-kit): a
// bridge agent reuses build-kit's cold-spawn/tasks.json engine as-is
// (lib/ralph.js) — it just reacts to every slice change instead of only
// "Planned" ones (see queueAllStatuses in lib/ralph.js) and translates
// instead of building. Its own templates/bridge overlay swaps in
// bridge-specific prompt.md/AGENT.md and a ralph-claude.js that omits
// onPlannedSlice entirely — see stacks/bridge/templates/bridge.
const BRIDGE_KIT = {
  key: 'bridge',
  label: 'Bridge — translate board slices into another spec framework, no backend scaffold',
  kitSubdir: 'bridge',
  kitDirName: '.bridge-kit',
  useShared: true,
  needsBoardId: true,
};

// Also not a stack — installed via `init --build-kit` instead of `init --stack <name>`.
// useShared:true, same as any real backend stack: it reuses build-kit's cold-spawn/
// tasks.json engine as-is (lib/ralph.js). Its templates/build-kit/CLAUDE.md,
// lib/{prompt,backend-prompt}.md, and templates/.claude/skills/build-*/SKILL.md are
// TODO-marked placeholders instead of real stack content (see stacks/blank/templates)
// — this is for a stack that isn't built into this CLI yet: fill in the TODOs against
// the real project this installs into, then optionally contribute it back as a
// first-class entry in STACKS (see README, "Adding a stack").
const BLANK_BUILD_KIT = {
  key: 'blank',
  label: 'Build kit — blank scaffold to fill in for a stack not built into this CLI yet',
  kitSubdir: 'build-kit',
  kitDirName: '.build-kit',
  useShared: true,
  needsBoardId: true,
};

const KIT_DIR_NAMES = [...new Set([...Object.values(STACKS), MODELING_KIT, BRIDGE_KIT, BLANK_BUILD_KIT].map((s) => s.kitDirName))];

// What `init --demo` installs, for the messages it prints. Kept in step with
// shared/demo-slices/ (context.json's name, and the slice folders beside it).
const DEMO_CONTEXT_NAME = 'Understanding Eventsourcing';
const DEMO_SLICE_COUNT = 16;

// Same principle Playwright MCP uses per harness: one shared server, but each coding
// agent has its own registration mechanism. Automate the ones with a real, verified
// CLI install command; for the rest, print manual steps instead of guessing at an
// unverified config file format (https://playwright.dev/mcp/clients/*).
const MCP_SERVER_NAME = 'eventmodelers';
const MCP_CLIENTS = {
  'claude-code': {
    label: 'Claude Code',
    command: (url) => `claude mcp add ${MCP_SERVER_NAME} --transport http ${url}`,
  },
  vscode: {
    label: 'VS Code',
    command: (url) => `code --add-mcp '${JSON.stringify({ name: MCP_SERVER_NAME, type: 'http', url })}'`,
  },
};
const MCP_MANUAL_CLIENTS = [
  { label: 'Cursor', hint: (url) => `Settings → MCP → Add new MCP Server → Type: http, URL: ${url}` },
  { label: 'Windsurf', hint: (url) => `Add an HTTP MCP server pointing at ${url} in Windsurf's MCP settings` },
];

// Other AI agent hosts can read our Event Modeling skills without us duplicating
// skill content per host: a thin stub file in the host's own command/workflow
// directory tells it to go read the canonical .claude/skills/<name>/SKILL.md and
// follow it — the same pattern spec-kitty uses (verified directly against its repo,
// not just its docs: every "stub" host below reads plain Markdown, no per-host
// format transform needed). Codex CLI, Mistral Vibe, Pi, Letta Code, and Hermes
// share one convention that already matches our native SKILL.md format, so those
// get the real file copied as-is instead of a stub. (Hermes also has a native
// .hermes/skills/ location, but its docs list .agents/skills/ as an equally
// first-class project skill root, so there's no reason to write the tree twice.)
const AGENT_HOSTS = {
  cursor: { label: 'Cursor', dir: '.cursor/commands', kind: 'stub' },
  windsurf: { label: 'Windsurf', dir: '.windsurf/workflows', kind: 'stub' },
  gemini: { label: 'Google Gemini CLI', dir: '.gemini/commands', kind: 'stub' },
  qwen: { label: 'Qwen Code', dir: '.qwen/commands', kind: 'stub' },
  opencode: { label: 'OpenCode', dir: '.opencode/command', kind: 'stub' },
  copilot: { label: 'GitHub Copilot', dir: '.github/prompts', kind: 'stub' },
  amazonq: { label: 'Amazon Q (legacy)', dir: '.amazonq/prompts', kind: 'stub' },
  kiro: { label: 'Kiro', dir: '.kiro/prompts', kind: 'stub' },
  kilocode: { label: 'Kilocode', dir: '.kilocode/workflows', kind: 'stub' },
  augment: { label: 'Augment Code', dir: '.augment/commands', kind: 'stub' },
  antigravity: { label: 'Google Antigravity', dir: '.agent/workflows', kind: 'stub' },
  codex: {
    label: 'Codex CLI / Mistral Vibe / Pi / Letta Code / Hermes (shared .agents/skills/ convention)',
    dir: '.agents/skills',
    kind: 'skill-package',
  },
};

// Several hosts share one directory convention, so they resolve to a single
// canonical entry above instead of each getting their own: writing the same
// .agents/skills/ tree four times would be pure duplication, and `--hosts all`
// would print four "installed" lines for one install. These exist so people can
// name the agent they actually use — `--hosts pi` is a friendlier spelling of
// `--hosts codex`, not a different install.
const AGENT_HOST_ALIASES = {
  pi: 'codex',
  hermes: 'codex',
  vibe: 'codex',
  'mistral-vibe': 'codex',
  letta: 'codex',
  'letta-code': 'codex',
};

// Alias -> canonical, deduped and order-preserving. Unknown keys pass through
// untouched so the caller keeps reporting them as unknown.
function resolveAgentHostKeys(keys) {
  return [...new Set(keys.map((k) => AGENT_HOST_ALIASES[k] || k))];
}

function agentHostStub(skillName) {
  return `# ${skillName} (eventmodelers)\n\nThis host should read the canonical skill at:\n\n**\`.claude/skills/${skillName}/SKILL.md\`**\n\nFollow those instructions when this command is invoked.\n`;
}

// Writes stub/skill-package files for the requested hosts and records exactly what
// it wrote into every installed kit dir's manifest — same convention as
// `mcpRegistered` — so `uninstall` can remove precisely these files later.
async function configureAgentHosts({ hosts, global: useGlobal } = {}) {
  const targetDir = process.cwd();
  const skillsDir = useGlobal ? join(homedir(), '.claude', 'skills') : join(targetDir, '.claude', 'skills');

  if (!existsSync(skillsDir)) {
    console.error(`❌ No skills found at ${relative(targetDir, skillsDir) || skillsDir} — run \`eventmodelers init\` or \`init --modeling\` first.`);
    process.exit(1);
  }
  const skills = readdirSync(skillsDir).filter((f) => existsSync(join(skillsDir, f, 'SKILL.md')));
  if (!skills.length) {
    console.error('❌ No installed skills found — nothing to expose.');
    process.exit(1);
  }

  let hostKeys = hosts;
  if (!hostKeys || !hostKeys.length) {
    console.log('\nAvailable agent hosts:');
    Object.entries(AGENT_HOSTS).forEach(([key, h]) => console.log(`  ${key.padEnd(12)} ${h.label}`));
    const aliasKeys = Object.keys(AGENT_HOST_ALIASES);
    if (aliasKeys.length) console.log(`\n  (also accepted: ${aliasKeys.join(', ')})`);
    const answer = await prompt('\nWhich hosts? (comma-separated keys, or "all"): ');
    hostKeys = answer.trim() === 'all'
      ? Object.keys(AGENT_HOSTS)
      : answer.split(',').map((s) => s.trim()).filter(Boolean);
  }
  hostKeys = resolveAgentHostKeys(hostKeys);

  const unknown = hostKeys.filter((k) => !AGENT_HOSTS[k]);
  if (unknown.length) {
    console.error(`❌ Unknown host(s): ${unknown.join(', ')}. Available: ${Object.keys(AGENT_HOSTS).join(', ')} (aliases: ${Object.keys(AGENT_HOST_ALIASES).join(', ')})`);
    process.exit(1);
  }
  if (!hostKeys.length) {
    console.log('ℹ️  No hosts selected — nothing to do.');
    return;
  }

  console.log(`\n📦 Exposing ${skills.length} skill(s) to ${hostKeys.length} host(s)...`);
  const generatedFiles = [];

  for (const key of hostKeys) {
    const host = AGENT_HOSTS[key];
    if (host.kind === 'stub') {
      const hostDir = join(targetDir, host.dir);
      mkdirSync(hostDir, { recursive: true });
      for (const skill of skills) {
        const filePath = join(hostDir, `${skill}.md`);
        writeFileSync(filePath, agentHostStub(skill));
        generatedFiles.push(relative(targetDir, filePath));
      }
    } else {
      // skill-package: copy the real SKILL.md verbatim — already the native format.
      for (const skill of skills) {
        const pkgDir = join(targetDir, host.dir, `eventmodelers.${skill}`);
        mkdirSync(pkgDir, { recursive: true });
        const dest = join(pkgDir, 'SKILL.md');
        copyFileSync(join(skillsDir, skill, 'SKILL.md'), dest);
        generatedFiles.push(relative(targetDir, dest));
      }
    }
    console.log(`  ✓ ${host.label} (${host.dir}/)`);
  }

  for (const dirName of KIT_DIR_NAMES) {
    const manifestPath = join(targetDir, dirName, '.eventmodelers', 'install-manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = readJsonSafe(manifestPath);
      manifest.agentHostFiles = [...new Set([...(manifest.agentHostFiles || []), ...generatedFiles])];
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  console.log(`\n✅ Done — ${generatedFiles.length} file(s) written.`);
}

// Every config field can also be set via an EVENTMODELERS_* env var — these always
// win over whatever's in config.json, so scripted/CI installs can skip prompts entirely.
const ENV_CONFIG_MAP = {
  EVENTMODELERS_ORGANIZATION_ID: 'organizationId',
  EVENTMODELERS_BOARD_ID: 'boardId',
  EVENTMODELERS_TOKEN: 'token',
  EVENTMODELERS_BASE_URL: 'baseUrl',
  EVENTMODELERS_ANTHROPIC_BASE_URL: 'anthropicBaseUrl',
  EVENTMODELERS_MODEL: 'model',
  EVENTMODELERS_SUBAGENT_MODEL: 'subagentModel',
  EVENTMODELERS_AGENT_NAME: 'agentName',
};

function applyEnvOverrides(config) {
  const result = { ...config };
  for (const [envVar, field] of Object.entries(ENV_CONFIG_MAP)) {
    if (process.env[envVar]) result[field] = process.env[envVar];
  }
  return result;
}

function maskSecret(value) {
  if (!value) return value;
  return value.length <= 8 ? '*'.repeat(value.length) : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// A single shared readline interface for the process lifetime. Opening and closing
// a new one per prompt() call drops buffered input when stdin is piped (e.g. tests,
// scripted installs) — the first interface can read ahead and consume lines meant
// for later prompts, leaving the next one waiting on a stream that already ended.
let sharedRl = null;
let sharedRlLines = null;
function getSharedRl() {
  if (!sharedRl) {
    sharedRl = createInterface({ input: process.stdin, output: process.stdout });
    sharedRlLines = sharedRl[Symbol.asyncIterator]();
  }
  return sharedRl;
}

// Pulls one line from the shared readline's own async iterator rather than calling
// its `.question()` — `.question()` attaches a one-shot 'line' listener *after* the
// prompt is issued, but when stdin is piped (a file, `<<<`, scripted/CI input) readline
// parses and emits 'line' events for an entire buffered chunk synchronously as soon as
// it arrives. So a second `.question()` call in the same process can miss a line that
// was already emitted — and dropped, no listener attached yet — before it was even
// called, hanging forever. Pulling from the iterator instead queues each line until
// something asks for it, so nothing emitted ahead of time is ever lost between prompts.
async function prompt(question = '') {
  const rl = getSharedRl();
  // selectPrompt pauses stdin when it tears down its raw-mode keypress handler. That was
  // invisible for as long as every menu came BEFORE the first prompt() — getSharedRl's
  // createInterface resumes stdin on the way in, so a freshly built readline never noticed.
  // Once a prompt runs first (the Board ID question), the interface already exists and is
  // reused, so the next prompt after a menu waits forever on a stream nobody resumed: the
  // event loop drains and node reports an unsettled top-level await instead of reading the
  // line. Both calls are no-ops when nothing paused anything.
  rl.resume();
  process.stdin.resume();
  if (question) process.stdout.write(question);
  const { value, done } = await sharedRlLines.next();
  return (done ? '' : value).trim();
}

// Reads a pasted block of credentials, which may span one line (minified JSON,
// or comma-separated values) or several (pretty-printed JSON). Stops as soon as
// the accumulated text parses, or on a blank line, so a single-line paste + Enter
// doesn't require a second Enter to finish.
async function promptPasteBlock() {
  const lines = [];
  while (lines.length < 20) {
    const line = await prompt();
    if (line.trim() === '') {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(line);
    try {
      JSON.parse(lines.join('\n'));
      break;
    } catch {
      // not yet valid JSON — if it's a single CSV-looking line, that's complete too
      if (lines.length === 1 && line.includes(',')) break;
    }
  }
  return lines.join('\n').trim();
}

// Platform base URL when a config doesn't specify one — every install method
// (paste, manual entry, or a hand-edited config.json) should fall back to this
// rather than silently disabling platform sync.
const DEFAULT_BASE_URL = 'https://api.eventmodelers.ai';

// How many subagents a self-directed --standalone turn may dispatch at once. It's a
// budget, not a mechanism: the turn runs inside one `claude` process, which is what
// actually spawns the agents, so the cap reaches it as part of the turn's instructions
// (buildStandaloneTurn) rather than as something the CLI can enforce from outside. Five
// keeps an unattended turn's cost in the same ballpark as a single prompt turn while
// still covering the usual burst — a handful of nodes across a couple of slices.
const DEFAULT_MAX_AGENTS = 5;

// What the subagents a turn fans out to run on (`subagentModel` in config.json, or
// EVENTMODELERS_SUBAGENT_MODEL). The session's own model — `model`, which is what the
// `claude` process is started with — is the one doing the judging: which areas need work,
// what each piece is, who owns what. By the time an Agent is dispatched that is settled, and
// what's left is execution against a written brief (fill in the examples, write the GWT
// scenarios, render the screen, batch the writes), which the cheap model does just as well.
// The agents inherit the session's model unless a turn says otherwise, so the turn says so.
// This reaches the agent as the `Agent` tool's own `model` argument, which takes a short alias
// (`sonnet`/`opus`/`haiku`) rather than the full model id `model` above is set with.
const DEFAULT_SUBAGENT_MODEL = 'sonnet';

// `--max-agents` is a cost guard, so a typo must not silently turn into "no limit" or
// into the default: anything that isn't a positive integer is rejected outright.
function parseMaxAgents(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MAX_AGENTS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`❌ --max-agents must be a positive integer (got "${raw}").`);
    process.exit(1);
  }
  return n;
}

// This CLI's own version, stamped into every install manifest so the global modeling
// install can tell whether it was written by the version now running (see ensureGlobalKit).
const CLI_VERSION = readJsonSafe(join(__dirname, 'package.json')).version || '0.0.0';

// Canonical order the account page pastes values in, regardless of which fields a
// given stack actually requires — a modeling-kit install (no boardId required) still
// gets a paste containing all 4 fields, so we must not drop the ones we don't need.
const PASTE_FIELD_ORDER = ['organizationId', 'boardId', 'token'];

// Values are sometimes copied with a "field=" prefix still attached (e.g. lifted
// straight out of a query string) — and occasionally under the wrong JSON key
// entirely, e.g. { "organizationId": "token=abc..." }. When a value carries its own
// "field=" prefix, that's a more reliable source of truth than whatever key/position
// it was pasted under, so it wins.
const PASTE_FIELD_ALIASES = { organizationId: 'organizationId', orgId: 'organizationId', boardId: 'boardId', token: 'token', baseUrl: 'baseUrl' };

function splitEmbeddedField(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([a-zA-Z]+)=(.+)$/);
  if (!match) return null;
  const field = PASTE_FIELD_ALIASES[match[1]];
  return field ? { field, value: match[2] } : null;
}

// Accepts either a JSON object (as copied from the account page) or a comma-separated
// line of values, in PASTE_FIELD_ORDER, with an optional base URL anywhere in the list.
function parseCredentialsPaste(text, requiredFields) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') {
      const raw = {};
      if (obj.organizationId || obj.orgId) raw.organizationId = obj.organizationId || obj.orgId;
      if (obj.boardId) raw.boardId = obj.boardId;
      if (obj.token) raw.token = obj.token;
      if (obj.baseUrl) raw.baseUrl = obj.baseUrl;

      const result = {};
      for (const [outerKey, value] of Object.entries(raw)) {
        const embedded = splitEmbeddedField(value);
        if (embedded) result[embedded.field] = embedded.value;
        else result[outerKey] = value;
      }
      if (requiredFields.every((f) => result[f])) return result;
      return null;
    }
  } catch {
    // not JSON — fall through to comma-separated parsing
  }

  const values = trimmed.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
  const result = {};
  const remaining = [];
  for (const v of values) {
    if (/^https?:\/\//i.test(v)) {
      result.baseUrl = v;
      continue;
    }
    const embedded = splitEmbeddedField(v);
    if (embedded) result[embedded.field] = embedded.value;
    else remaining.push(v);
  }
  if (remaining.length < requiredFields.length - Object.keys(result).length) return null;
  // If more values were pasted than this stack strictly requires (e.g. a boardId
  // in a modeling-kit paste), use the full canonical order so the extra field is
  // still captured instead of being mis-zipped against the shorter requiredFields
  // list and silently dropped/misassigned.
  const fieldOrder = remaining.length > requiredFields.length ? PASTE_FIELD_ORDER : requiredFields;
  let i = 0;
  for (const field of fieldOrder) {
    if (result[field]) continue; // already resolved via an embedded "field=" prefix
    if (remaining[i] !== undefined) result[field] = remaining[i];
    i++;
  }

  return requiredFields.every((f) => result[f]) ? result : null;
}

// Arrow-key single-select menu. Falls back to a numbered prompt on non-TTY stdin (e.g. piped input, CI).
async function selectPrompt(question, choices, defaultIndex = 0) {
  if (!process.stdin.isTTY) {
    console.log(`\n${question}`);
    choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.label}`));
    const answer = await prompt(`  Select [1-${choices.length}] (default ${defaultIndex + 1}): `);
    const idx = parseInt(answer, 10) - 1;
    return choices[Number.isInteger(idx) && idx >= 0 && idx < choices.length ? idx : defaultIndex].value;
  }

  return new Promise((resolve) => {
    let index = defaultIndex;
    const stdin = process.stdin;
    const render = () => choices.map((c, i) => `  ${i === index ? '●' : '○'} ${c.label}`);

    console.log(`\n${question}`);
    let lines = render();
    lines.forEach((l) => console.log(l));

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onKeypress = (str, key) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(1);
      }
      if (key.name === 'up' || key.name === 'k') {
        index = (index - 1 + choices.length) % choices.length;
      } else if (key.name === 'down' || key.name === 'j') {
        index = (index + 1) % choices.length;
      } else if (key.name === 'return') {
        cleanup();
        resolve(choices[index].value);
        return;
      } else {
        return;
      }
      moveCursor(process.stdout, 0, -lines.length);
      clearScreenDown(process.stdout);
      lines = render();
      lines.forEach((l) => console.log(l));
    };

    stdin.on('keypress', onKeypress);
    stdin.resume();
  });
}

function findConfigInParents(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.eventmodelers', 'config.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last resort: the walk above only passes through $HOME if the project happens
  // to live under it. A project outside $HOME (e.g. /tmp/foo) never sees it, so
  // check it explicitly — this is where `init-config --global` writes account-wide
  // defaults (organizationId/token) shared across every project.
  const globalCandidate = join(homedir(), '.eventmodelers', 'config.json');
  return existsSync(globalCandidate) ? globalCandidate : null;
}

function readJsonSafe(path) {
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

// The `x-agent-id` header every platform call carries when this process knows its own id.
// The heartbeat says an agent is alive; this says which of the calls arriving are its — the
// platform stamps it on the board_events a write produces (so the board can show "alice moved
// this" rather than one anonymous robot), and matches it when claiming a prompt the user
// addressed to one preferred agent. Optional everywhere: an id-less caller behaves exactly as
// callers did before it existed.
function agentHeaders(cfg) {
  const agentId = cfg?.agentId || process.env.EVENTMODELERS_AGENT_ID || '';
  return agentId ? { 'x-agent-id': agentId } : {};
}

// Distinguishes this agent process from any other agent pinging the same
// token/board — e.g. a build-kit and a modeling-kit install in the same project
// share one root config.json, and without a per-agent id both would upsert the
// same alive row and race each other. The platform already keys the alive-ping
// on the (agent_type, agent_id) pair, so one shared file works: agentIds is
// namespaced by agentType inside the project ROOT .eventmodelers/config.json —
// the same file credentials already live in — instead of each kit dir keeping
// its own separate config.json (mirrors shared/build-kit/lib/ralph.js's
// ensureAgentId, duplicated here since this file isn't copied into projects).
function ensureAgentId(kitDir, agentType) {
  const rootConfigPath = join(dirname(kitDir), '.eventmodelers', 'config.json');
  const rootCfg = readJsonSafe(rootConfigPath);
  rootCfg.agentIds = rootCfg.agentIds || {};
  if (rootCfg.agentIds[agentType]) return rootCfg.agentIds[agentType];

  const legacyAgentId = readJsonSafe(join(kitDir, '.eventmodelers', 'config.json')).agentId;

  const agentId = legacyAgentId || randomUUID();
  rootCfg.agentIds[agentType] = agentId;
  mkdirSync(dirname(rootConfigPath), { recursive: true });
  writeFileSync(rootConfigPath, JSON.stringify(rootCfg, null, 2));
  return agentId;
}

// Hierarchical resolution: a shared config higher up the directory tree (e.g. the
// project root's own .eventmodelers/config.json, or ~/.eventmodelers/config.json for
// defaults shared across every project) provides the base values — this is where
// `init` (with or without --modeling) writes by default, so a modeling-kit and a build-kit installed
// in the same project share one file. A legacy or deliberately separate config.json
// inside the kit dir itself still overrides any field it also sets, for cases where a
// single project needs distinct credentials per kit. An explicit --config path bypasses
// this entirely.
function loadEffectiveConfig(cwd, kitDir, explicitPath) {
  if (explicitPath) {
    const configPath = resolve(cwd, explicitPath);
    return { configPath, sources: [configPath], config: applyEnvOverrides(readJsonSafe(configPath)) };
  }

  const kitConfigPath = kitDir ? join(kitDir, '.eventmodelers', 'config.json') : null;
  const kitConfigExists = kitConfigPath && existsSync(kitConfigPath);
  const parentConfigPath = findConfigInParents(cwd);

  const merged = { ...readJsonSafe(parentConfigPath), ...(kitConfigExists ? readJsonSafe(kitConfigPath) : {}) };
  const sources = [parentConfigPath, kitConfigExists ? kitConfigPath : null].filter(Boolean);

  return {
    configPath: kitConfigExists ? kitConfigPath : parentConfigPath,
    sources,
    config: applyEnvOverrides(merged),
  };
}

function findInstalledKitDir(cwd) {
  for (const name of KIT_DIR_NAMES) {
    const p = join(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function findAllInstalledKitDirs(cwd) {
  return KIT_DIR_NAMES.map((name) => join(cwd, name)).filter((p) => existsSync(p));
}

// Appends any line from a previous install's .gitignore that the freshly-copied one
// doesn't already cover — unlike CLAUDE.md's freeform prose, .gitignore is just a line
// list, so a simple dedup-append is enough to keep both kits' ignore rules intact.
function mergeGitignoreLines(oldContent, newContent) {
  const newLines = new Set(newContent.split('\n').map((l) => l.trim()).filter(Boolean));
  const additions = oldContent.split('\n').filter((l) => l.trim() && !newLines.has(l.trim()));
  if (!additions.length) return newContent;
  const sep = newContent.endsWith('\n') ? '' : '\n';
  return `${newContent}${sep}${additions.join('\n')}\n`;
}

function copyDirContents(srcDir, destDir, { skip = [] } = {}) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  let count = 0;
  for (const item of readdirSync(srcDir)) {
    if (skip.includes(item)) continue;
    const src = join(srcDir, item);
    const dest = join(destDir, item);
    cpSync(src, dest, {
      recursive: true,
      filter: (s) => !relative(src, s).split(sep).includes('node_modules'),
    });
    count++;
  }
  if (count) console.log(`  ✓ Installed ${count} item${count === 1 ? '' : 's'} into ${relative(process.cwd(), destDir) || '.'}`);
}

// Community/custom build kits (`init --stack <name> --git <url>`) are cloned fresh on
// every run rather than pulled/updated in place — there's no local state worth
// preserving between installs, and re-cloning from scratch means a broken or partial
// previous clone can never linger and cause a confusing stale-file bug. Cached under
// ~/.eventmodelers (not inside the target project) so it's reusable across projects and
// definitely not something `uninstall` or the project's own .gitignore need to know about.
function cloneGitStack(url, branch) {
  const dest = join(homedir(), '.eventmodelers', 'git-stacks', `${url}${branch ? `#${branch}` : ''}`.replace(/[^a-zA-Z0-9._-]/g, '_'));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`📥 Cloning ${url}${branch ? ` (branch: ${branch})` : ''}...`);
  const cloneArgs = ['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), url, dest];
  try {
    execFileSync('git', cloneArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    console.error(`❌ Failed to clone "${url}"${branch ? ` (branch: ${branch})` : ''} — check the URL, the branch name, your git access, and that git is installed, then try again.`);
    process.exit(1);
  }
  return dest;
}

// stack.json's kitSubdir is attacker-controlled (it comes from whatever repo --git
// cloned) and feeds straight into join(templatesSource, kitSubdir) — installStack
// then copies everything under that path into the target project. Reject anything
// that isn't a plain relative subdirectory name so a malicious stack.json can't walk
// out of the clone (e.g. "../../../../etc") and have arbitrary host files copied in.
function isSafeRelativeSubpath(p) {
  if (typeof p !== 'string' || !p) return false;
  const normalized = normalize(p);
  return !isAbsolute(normalized) && normalized.split(sep).every((part) => part !== '..');
}

// A community stack repo must mirror the internal stacks/<key>/templates layout exactly
// (templates/.claude, templates/root, templates/<kitSubdir>) so installStack() can treat
// it identically to a built-in stack — see STACKS above for the shape. An optional
// stack.json at the repo root can declare label/kitSubdir/useShared/needsBoardId;
// kitDirName is always forced to .build-kit (the same runtime contract every built-in
// stack already uses), so run/status/uninstall recognize a git-installed stack with no
// changes of their own.
function resolveGitStackConfig(clonedDir, name) {
  const templatesSource = join(clonedDir, 'templates');
  if (!existsSync(templatesSource)) {
    console.error(`❌ ${relative(process.cwd(), clonedDir) || clonedDir} has no templates/ directory — a build kit repo needs templates/.claude, templates/root, and templates/<kitSubdir>, the same layout this CLI's own stacks/<name>/templates use.`);
    process.exit(1);
  }
  for (const required of ['.claude', 'root']) {
    if (!existsSync(join(templatesSource, required))) {
      console.error(`❌ ${relative(process.cwd(), templatesSource) || templatesSource} is missing "${required}/" — a build kit repo needs templates/.claude, templates/root, and templates/<kitSubdir>, the same layout this CLI's own stacks/<name>/templates use.`);
      process.exit(1);
    }
  }

  const manifestPath = join(clonedDir, 'stack.json');
  const manifestRaw = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : null;
  let manifest = {};
  if (manifestRaw !== null) {
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      console.error(`❌ ${relative(process.cwd(), manifestPath) || manifestPath} is not valid JSON.`);
      process.exit(1);
    }
  }

  if (manifest.label !== undefined && (typeof manifest.label !== 'string' || !manifest.label)) {
    console.error('❌ stack.json "label" must be a non-empty string.');
    process.exit(1);
  }
  if (manifest.kitSubdir !== undefined && !isSafeRelativeSubpath(manifest.kitSubdir)) {
    console.error(`❌ stack.json "kitSubdir" must be a plain relative subdirectory name (no "..", no absolute paths) — got ${JSON.stringify(manifest.kitSubdir)}.`);
    process.exit(1);
  }
  for (const boolField of ['useShared', 'needsBoardId']) {
    if (manifest[boolField] !== undefined && typeof manifest[boolField] !== 'boolean') {
      console.error(`❌ stack.json "${boolField}" must be a boolean.`);
      process.exit(1);
    }
  }

  const kitSubdir = manifest.kitSubdir || 'build-kit';
  if (!existsSync(join(templatesSource, kitSubdir))) {
    console.error(`❌ ${relative(process.cwd(), templatesSource) || templatesSource} is missing its kit subdirectory "${kitSubdir}/" (from stack.json, or the "build-kit" default) — nothing to install.`);
    process.exit(1);
  }
  return {
    label: manifest.label || name,
    kitSubdir,
    kitDirName: '.build-kit',
    useShared: manifest.useShared !== false,
    needsBoardId: manifest.needsBoardId !== false,
  };
}

async function resolveStack(cliStack) {
  if (cliStack) {
    if (!STACKS[cliStack]) {
      console.error(`❌ Unknown stack "${cliStack}". Available: ${Object.keys(STACKS).join(', ')}`);
      process.exit(1);
    }
    return cliStack;
  }
  return selectPrompt(
    'Which stack are you scaffolding?',
    Object.entries(STACKS).map(([key, cfg]) => ({ label: `${key} — ${cfg.label}`, value: key })),
    0,
  );
}

async function installStack(stackKey, stackCfg, options = {}) {
    console.log('🚀 Eventmodelers CLI\n');
    console.log(`Using: ${stackKey} (${stackCfg.label})\n`);

    // Almost always the cwd. The exception is the global modeling install, which is
    // scaffolded into ~/.eventmodelers/kit from wherever `run --standalone` was invoked
    // (see ensureGlobalKit) — the mirror image of options.templatesSource below: where we
    // install TO, versus where we install FROM.
    const targetDir = options.targetDir ? resolve(options.targetDir) : process.cwd();
    // `init --git <url>` passes a resolved clone dir's templates/ here instead — every
    // other input (STACKS, MODELING_KIT, BRIDGE_KIT) keeps using the built-in path.
    const templatesSource = options.templatesSource || join(__dirname, 'stacks', stackKey, 'templates');
    const sharedBuildKit = join(__dirname, 'shared', 'build-kit');
    // Skills with no stack-specific content (connect, learn-eventmodelers-api,
    // update-slice-status, ...) live once here instead of being copy-pasted into
    // every stack's templates — that copy-pasting is exactly how they drifted out
    // of sync with each other before (e.g. one stack's connect skill silently
    // missing a bugfix another stack's copy had).
    const sharedSkills = join(__dirname, 'shared', 'skills');
    // Adapter skills that translate board slices for another spec framework —
    // one subfolder per target (shared/bridge/spec-kitty/bridge-spec-kitty-*,
    // shared/bridge/kiro/..., etc.), so a bridge install only ever pulls in
    // the target it was actually configured for, not every framework's
    // skills. Only relevant to a bridge install — never copied into the four
    // backend stacks or modeling-kit.
    const isBridge = stackKey === BRIDGE_KIT.key;
    const isModelingKit = stackKey === MODELING_KIT.key;
    const sharedBridgeSkills = isBridge ? join(__dirname, 'shared', 'bridge', options.target) : null;

    if (!existsSync(templatesSource)) {
      console.error('❌ Templates directory not found at:', templatesSource);
      process.exit(1);
    }

    // --- 1. Install skills (project-local by default, or ~/.claude/skills/ with --global) ---
    // Recorded into the install manifest (step 8) so `uninstall` can remove exactly
    // these files later and nothing the user added independently.
    const claudeSkillsSrc = join(templatesSource, '.claude', 'skills');
    const installedSkills = [
      ...(existsSync(sharedSkills) ? readdirSync(sharedSkills) : []),
      ...(isBridge && existsSync(sharedBridgeSkills) ? readdirSync(sharedBridgeSkills) : []),
      ...(existsSync(claudeSkillsSrc) ? readdirSync(claudeSkillsSrc) : []),
    ];
    let claudeExtras = [];

    if (options.global) {
      const globalSkillsDir = join(homedir(), '.claude', 'skills');
      console.log('📦 Installing skills globally...');
      copyDirContents(sharedSkills, globalSkillsDir);
      if (isBridge) copyDirContents(sharedBridgeSkills, globalSkillsDir);
      copyDirContents(claudeSkillsSrc, globalSkillsDir);
    } else {
      console.log('📦 Installing skills...');
      copyDirContents(join(templatesSource, '.claude'), join(targetDir, '.claude'));
      copyDirContents(sharedSkills, join(targetDir, '.claude', 'skills'));
      if (isBridge) copyDirContents(sharedBridgeSkills, join(targetDir, '.claude', 'skills'));
      claudeExtras = existsSync(join(templatesSource, '.claude'))
        ? readdirSync(join(templatesSource, '.claude')).filter((f) => f !== 'skills')
        : [];
    }

    // --- 2. Spread stack scaffold files into the project root ---
    // Skipped entirely by `re-init` (options.skipRootScaffold) — that command only
    // refreshes an already-scaffolded project's kit dir + skills, and must never
    // re-touch root/ files the user has since built on top of, nor the root
    // CLAUDE.md router below.
    const rootSrc = join(templatesSource, 'root');
    // root/CLAUDE.md is never copied to the project root directly (see step 3 below) —
    // built-in stacks no longer ship one at all, and an outdated community/--git stack
    // that still does gets it relocated into its own kit dir instead, so this generic
    // copy must never let it slip through to root and clobber the shared router there.
    const stackRootClaudeSrc = join(rootSrc, 'CLAUDE.md');
    const stackShipsOwnRootClaude = existsSync(stackRootClaudeSrc);
    if (!options.skipRootScaffold && existsSync(rootSrc)) {
      console.log('📦 Installing project files...');
      // .gitignore is the one file every stack's root/ ships that can collide with
      // another already-installed kit's own .gitignore (e.g. modeling-kit + a build-kit
      // stack) — capture what's there before the copy below overwrites it wholesale,
      // then merge the two afterwards instead of silently losing whichever rules the
      // first-installed kit added (e.g. node_modules/.idea from a build-kit install).
      const gitignoreDest = join(targetDir, '.gitignore');
      const priorGitignore = existsSync(gitignoreDest) ? readFileSync(gitignoreDest, 'utf-8') : null;
      // .githooks/ (the slice commit-scope guard) is opt-in via `init --hooks` — skipped
      // here and handled explicitly below so a plain `init` never silently changes the
      // project's git hook wiring.
      copyDirContents(rootSrc, targetDir, { skip: ['CLAUDE.md', '.githooks'] });
      if (priorGitignore !== null && existsSync(gitignoreDest)) {
        const incoming = readFileSync(gitignoreDest, 'utf-8');
        const merged = mergeGitignoreLines(priorGitignore, incoming);
        if (merged !== incoming) {
          writeFileSync(gitignoreDest, merged);
          console.log('  ✓ Merged .gitignore with the rules from an already-installed kit');
        }
      }
    }

    // A modeling-kit + build-kit (or bridge) combo in the same project is supported
    // (they share one config.json — see ensureAgentId) but each kit's own instructions
    // now live in its own kit dir (.build-kit/CLAUDE.md, .agent-modeling-kit/CLAUDE.md)
    // instead of root/CLAUDE.md, precisely so a second kit's install can never clobber
    // the first kit's instructions the way it used to — including an outdated community
    // stack's own root/CLAUDE.md, already relocated above rather than left here to
    // compete for this slot. The root CLAUDE.md is instead a small, stack-agnostic router
    // pointing at whichever kit CLAUDE.md files exist — identical content regardless of
    // which stack installs it, so a fresh project or one that already has the up-to-date
    // router both just get it written/left alone silently. Only a pre-migration
    // single-stack CLAUDE.md (from before this fix shipped) or the user's own hand-edited
    // notes is there an actual decision to make, so that's the one case this asks about
    // instead of silently guessing either way.
    const rootClaudeDest = join(targetDir, 'CLAUDE.md');
    const sharedRootClaude = join(__dirname, 'shared', 'root-claude', 'CLAUDE.md');
    const routerContent = options.skipRootScaffold ? null : (existsSync(sharedRootClaude) ? readFileSync(sharedRootClaude, 'utf-8') : null);
    if (routerContent !== null) {
      if (!existsSync(rootClaudeDest)) {
        writeFileSync(rootClaudeDest, routerContent);
        console.log('  ✓ Installed root CLAUDE.md — a router pointing at .build-kit/CLAUDE.md and .agent-modeling-kit/CLAUDE.md, whichever are present');
      } else if (readFileSync(rootClaudeDest, 'utf-8') === routerContent) {
        console.log('  ✓ Root CLAUDE.md already present and up to date — left as-is');
      } else if (options.print) {
        console.log('  ℹ️  --print — a different root CLAUDE.md already exists, leaving it as-is (rerun without --print to choose)');
      } else {
        const choice = await selectPrompt(
          'A root CLAUDE.md already exists with different content (your own notes, another stack\'s, or a pre-upgrade file) — overwrite it with the router template pointing at each installed kit\'s own CLAUDE.md?',
          [
            { label: 'Keep the existing CLAUDE.md (recommended)', value: 'keep' },
            { label: 'Overwrite with the router template', value: 'overwrite' },
          ],
          0,
        );
        if (choice === 'overwrite') {
          writeFileSync(rootClaudeDest, routerContent);
          console.log('  ✓ Overwrote root CLAUDE.md with the router template');
        } else {
          console.log('  ✓ Kept the existing root CLAUDE.md');
        }
      }
    }

    // --- 3. Create the kit dir and install the agent runner ---
    const kitDir = join(targetDir, stackCfg.kitDirName);

    // A non-empty kit dir here almost always means a previous install someone has
    // since customized (e.g. filled in a `--build-kit` scaffold's TODOs, or hand-edited
    // CLAUDE.md/AGENT.md) — the copy below overwrites same-named files unconditionally,
    // so ask before silently clobbering that work. --print and --force both imply an
    // explicit, non-interactive "yes" (mirrors how --force already means "overwrite
    // without re-asking" for credentials).
    if (existsSync(kitDir) && readdirSync(kitDir).length > 0 && !options.print && !options.force) {
      const choice = await selectPrompt(
        `${stackCfg.kitDirName} is not empty. Should we continue?`,
        [
          { label: 'No — cancel', value: 'no' },
          { label: 'Yes — continue (files with matching names will be overwritten)', value: 'yes' },
        ],
        0,
      );
      if (choice === 'no') {
        console.log('\n❌ Cancelled — nothing was installed.');
        process.exit(1);
      }
    }

    mkdirSync(kitDir, { recursive: true });
    console.log(`📦 Installing agent kit into ${stackCfg.kitDirName}/...`);

    if (stackCfg.useShared) {
      copyDirContents(sharedBuildKit, kitDir);
    }
    copyDirContents(join(templatesSource, stackCfg.kitSubdir), kitDir, { skip: ['.eventmodelers'] });

    // An outdated community/--git stack that still ships root/CLAUDE.md (the pre-fix
    // layout every built-in stack used to follow too) gets it relocated here instead
    // of left in root/ — same destination a built-in stack's own templates/<kitSubdir>
    // now ships it at directly. No prompt needed: this is this stack's own file, moving
    // to where its counterpart already lives, not a conflict with anything else.
    if (stackShipsOwnRootClaude) {
      const kitClaudeDest = join(kitDir, 'CLAUDE.md');
      if (!existsSync(kitClaudeDest)) {
        copyFileSync(stackRootClaudeSrc, kitClaudeDest);
        console.log(`  ✓ Relocated this stack's CLAUDE.md into ${stackCfg.kitDirName}/ (root/CLAUDE.md is reserved for the shared router)`);
      }
    }

    // Static (no-LLM) bridge adapters live once in this package's own lib/
    // adapters/ — `fetch --spec-kitty` imports them directly, and a bridge
    // install gets its own copy here so ralph-static.js can run standalone
    // with no access back to the published package.
    if (isBridge) {
      copyDirContents(join(__dirname, 'lib', 'adapters'), join(kitDir, 'adapters'));
    }

    // Make scripts executable
    for (const script of ['ralph.sh', 'lib/agent.sh', 'ralph-claude.js', 'ralph-local-ai.js', 'ralph-exec.js']) {
      const p = join(kitDir, script);
      if (existsSync(p)) {
        try { execSync(`chmod +x "${p}"`); } catch {}
      }
    }

    // --- 3b. Opt-in slice commit-scope guard (`init --hooks`) ---
    // Skipped from the generic root copy above so a plain `init` never touches git's
    // hook wiring; installed explicitly here only when requested.
    if (options.hooks) {
      const hooksSrc = join(rootSrc, '.githooks');
      if (existsSync(hooksSrc)) {
        configureHooks({ hooksSrc, targetDir });
      } else {
        console.log('  ℹ️  --hooks was given but this stack ships no .githooks/ template — nothing to install');
      }
    }

    // --- 3c. Opt-in demo model (`init --demo`) ---
    // After the kit dir exists (the .slices/ tree nests inside it for every kit but
    // modeling-kit) and before npm install/credentials, so the "demo installed" line
    // lands with the rest of the file copying rather than after a credential prompt.
    if (options.demo) {
      installDemoSlices({ kitDir, targetDir, stackCfg });
    }

    // --- 4. Install kit dependencies ---
    // modeling-kit's package.json has no dependencies at all — it exists purely for its
    // `"type": "module"`, so lib/config.js can be ESM-imported. Running npm for that buys
    // a lockfile and nothing else, and it sits on the critical path of the global
    // install's first-use scaffold (ensureGlobalKit), so skip it.
    if (!isModelingKit && existsSync(join(kitDir, 'package.json'))) {
      console.log('📦 Installing kit dependencies...');
      try {
        execSync('npm install', { cwd: kitDir, stdio: ['ignore', 'inherit', 'inherit'] });
        console.log('  ✓ kit dependencies installed');
      } catch {
        console.error('  ⚠️  npm install failed in kit — run it manually');
      }
    }

    // --- 5. Credentials ---
    // Skipped by the global modeling install (ensureGlobalKit): that one dir is reused
    // across every board and account, so it deliberately keeps no credentials at rest.
    // Each run resolves its own and hands them to the agent in memory instead.
    if (!options.skipCredentials) {
      console.log('🔐 Configuring credentials...');

      // Written at the project root (not inside the kit dir) so a modeling-kit install
      // and a build-kit install in the same project share one config.json instead of
      // each prompting for and storing its own copy of the same credentials.
      const configPath = options.configPath
        ? resolve(targetDir, options.configPath)
        : join(targetDir, '.eventmodelers', 'config.json');

      const requiredFields = stackCfg.needsBoardId
        ? ['organizationId', 'boardId', 'token']
        : ['organizationId', 'token'];

      const effective = loadEffectiveConfig(targetDir, kitDir, options.configPath);
      if (effective.sources.length > 1) {
        console.log(`\n  ✓ Found shared defaults in ${effective.sources[0]}`);
      }

      const config = await configureCredentials({
        config: effective.config,
        configPath,
        targetDir,
        requiredFields,
        boardIdOptional: !stackCfg.needsBoardId,
        overrides: options.credentialOverrides,
        print: options.print,
        force: options.force,
      });

      // Register the MCP server up front so it's available from the very first
      // `claude` invocation (whether that's an interactive session opened right
      // after install, or the agent loop's first spawn) instead of only appearing
      // once `run`/`run --modeling` or `init-mcp` happens to run. Safe to write
      // even without a token yet — the file only ever holds the env-var
      // placeholder, never the literal secret (see connect/SKILL.md's Security notes).
      ensureMcpRegistered(targetDir, config.baseUrl || DEFAULT_BASE_URL);
      ensureEnvToken(targetDir, config.token);
    }

    // --- 6. Install manifest (drives precise `uninstall` later) ---
    // Only the footprint listed here is ever removed by `uninstall` — the root
    // scaffold (step 2) is real project source the user builds on, so it's
    // deliberately left out and never touched by uninstall.
    const manifestDir = join(kitDir, '.eventmodelers');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'install-manifest.json'),
      JSON.stringify({ stack: stackKey, version: CLI_VERSION, global: !!options.global, skills: installedSkills, claudeExtras, mcpRegistered: false }, null, 2),
    );

    // The global install scaffolds itself and then immediately starts the agent — printing
    // "Done! Start your agent:" and an init-mcp hint there would be telling the user to do
    // what this very command is already doing.
    if (options.skipEpilogue) return;

    console.log('\n✅ Done! Start your agent:\n');
    if (isBridge) {
      console.log('  npx @eventmodelers/cli bridge\n');
    } else if (isModelingKit) {
      console.log('  npx @eventmodelers/cli run --modeling\n');
    } else {
      console.log('  npx @eventmodelers/cli run          (--local-ai or --bash for other runners)\n');
    }
    console.log('Connect this project to an MCP client (Claude Code, VS Code, ...):\n');
    console.log(`  npx @eventmodelers/cli init-mcp\n`);
    console.log('Expose these skills to other AI agent hosts (Cursor, Windsurf, Gemini CLI, Copilot, Codex CLI, Kiro, ...):\n');
    console.log(`  npx @eventmodelers/cli init-agents\n`);
}

// Extracted from installStack so `init-config` can reuse the exact same
// paste/manual/instructions/skip flow without also scaffolding a stack.
// `overrides` are values passed directly on the command line (--token, --board-id,
// --organization-id, --base-url, plus --name as `agentName`) — the most explicit source
// available, so they win over both the config file and env vars before we even check
// what's missing. Any field is written through verbatim; only requiredFields gate the prompt.
async function configureCredentials({ config, configPath, targetDir, requiredFields, boardIdOptional, overrides = {}, print, skipGitignore = false, force = false }) {
  config = { ...config };
  for (const [field, value] of Object.entries(overrides)) {
    if (value) config[field] = value;
  }

  const configDir = dirname(configPath);
  mkdirSync(configDir, { recursive: true });

  if (!skipGitignore) {
    const gitignorePath = join(targetDir, '.gitignore');
    const relConfigDir = relative(targetDir, configDir);
    if (relConfigDir && !relConfigDir.startsWith('..')) {
      const gitignoreEntry = `${relConfigDir}/`;
      if (existsSync(gitignorePath)) {
        const content = readFileSync(gitignorePath, 'utf-8');
        if (!content.includes(gitignoreEntry)) {
          appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
        }
      } else {
        writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
      }
    }
  }

  const stillMissing = force || requiredFields.some((f) => !config[f]);
  // Sole gate on the persist step below — 'instructions'/'skip' and a paste that
  // couldn't be parsed all explicitly tell the user nothing was saved, so the
  // final write must not run for them (it used to run unconditionally, silently
  // writing out whatever `config` happened to be — `{}` on a first run — which
  // contradicted those messages and left behind a bogus config.json).
  let skipWrite = false;
  if (stillMissing && print) {
    console.log('\n  ℹ️  --print — skipping credential prompt, missing fields must be set via flags, EVENTMODELERS_* env vars, or config.json');
    skipWrite = true;
  } else if (stillMissing) {
    const choice = await selectPrompt('How do you want to configure credentials?', [
      { label: 'Paste values copied from app.eventmodelers.ai/account', value: 'paste' },
      { label: 'Enter values one by one', value: 'manual' },
      { label: 'Get instructions for configuring later', value: 'instructions' },
      { label: 'Skip for now', value: 'skip' },
    ], 0);

    if (choice === 'paste') {
      console.log('\n  Copy your credentials from https://app.eventmodelers.ai/account,');
      console.log('  then paste them below and press Enter:\n');
      const pasted = await promptPasteBlock();
      const parsed = parseCredentialsPaste(pasted, requiredFields);
      if (parsed) {
        config = { ...config, ...parsed };
      } else {
        console.log(`\n  ⚠️  Couldn't make sense of that paste — nothing was saved.`);
        console.log(`      Paste it into ${relative(targetDir, configPath)} yourself, or use /connect later.`);
        skipWrite = true;
      }
    } else if (choice === 'manual') {
      console.log('\n🔑 Enter your Eventmodelers credentials:\n');
      config.organizationId = await prompt('  Organization ID: ');
      // Always ask, even when this install doesn't strictly require it — it's still
      // used as a fallback default by the agent loop (see BOARD_ID resolution).
      const boardId = await prompt(`  Board ID${boardIdOptional ? ' (optional)' : ''}: `);
      if (boardId) config.boardId = boardId;
      config.token = await prompt('  Token:           ');
    } else if (choice === 'instructions') {
      console.log(`\n  Paste your credentials into:\n`);
      console.log(`    ${configPath}`);
      console.log(`\n  (or any ancestor directory's .eventmodelers/config.json, e.g. ~/.eventmodelers/config.json`);
      console.log(`  to share the same credentials across multiple projects)\n`);
      console.log(`  The file should look like:`);
      const sample = `  {\n    "token": "...",\n    "boardId": "...",\n    "organizationId": "...",\n    "baseUrl": "https://api.eventmodelers.ai"\n  }\n`;
      console.log(sample);
      console.log('  Then re-run this installer, or just run the agent afterwards.\n');
      skipWrite = true;
    } else {
      console.log('\n  ℹ️  Skipped — use /connect in Claude Code to add credentials later');
      skipWrite = true;
    }
  } else {
    console.log('\n  ✓ Config already present — skipping credential prompt');
  }

  // Backfill baseUrl for configs that already had real credentials but predate
  // this default (e.g. a config.json written by hand or by an older CLI version).
  if (config.token && config.organizationId && !config.baseUrl) {
    config.baseUrl = DEFAULT_BASE_URL;
  }

  if (!skipWrite) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`\n  ✓ Saved to ${relative(targetDir, configPath)}`);
  }
  return config;
}

// Configure the MCP server registration for a project — split out of `init` into
// its own command (`init-mcp`) since not every harness/workflow wants an
// automatic .claude/settings.json edit or an interactive "connect elsewhere?"
// prompt bundled into scaffolding.
async function configureMcp(options = {}) {
  const targetDir = process.cwd();
  const effective = loadEffectiveConfig(targetDir, null, options.configPath);
  const baseUrl = effective.config.baseUrl || DEFAULT_BASE_URL;

  console.log('🔌 Configuring MCP server...');
  const claudeSettingsDir = join(targetDir, '.claude');
  const settingsPath = join(claudeSettingsDir, 'settings.json');
  mkdirSync(claudeSettingsDir, { recursive: true });

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  settings.mcpServers = settings.mcpServers || {};
  settings.mcpServers.eventmodelers = {
    type: 'http',
    url: `${baseUrl}/mcp`,
  };

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('  ✓ MCP server configured in .claude/settings.json');

  // Record that MCP was registered so `uninstall` knows to clean up the
  // settings.json entry — checked against every kit dir's manifest.
  for (const dirName of KIT_DIR_NAMES) {
    const manifestPath = join(targetDir, dirName, '.eventmodelers', 'install-manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = readJsonSafe(manifestPath);
      manifest.mcpRegistered = true;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  const mcpUrl = `${baseUrl}/mcp`;
  if (options.print) {
    console.log('\nConnect the same MCP server in another harness:');
    for (const client of Object.values(MCP_CLIENTS)) {
      console.log(`  ${client.label.padEnd(12)} ${client.command(mcpUrl)}`);
    }
    for (const client of MCP_MANUAL_CLIENTS) {
      console.log(`  ${client.label.padEnd(12)} ${client.hint(mcpUrl)}`);
    }
  } else {
    const clientChoice = await selectPrompt('\nConnect the MCP globally to another harness?', [
      { label: 'Skip', value: 'skip' },
      ...Object.entries(MCP_CLIENTS).map(([key, c]) => ({ label: c.label, value: key })),
    ], 0);

    if (clientChoice !== 'skip') {
      const client = MCP_CLIENTS[clientChoice];
      const cmd = client.command(mcpUrl);
      try {
        execSync(cmd, { stdio: 'inherit' });
        console.log(`  ✓ ${client.label} connected via: ${cmd}`);
      } catch {
        console.error(`  ⚠️  Command failed — you can run it manually:`);
        console.error(`       ${cmd}`);
      }
    }

    if (MCP_MANUAL_CLIENTS.length) {
      console.log('\nOther harnesses without a scriptable installer:');
      MCP_MANUAL_CLIENTS.forEach((c) => console.log(`  ${c.label.padEnd(12)} ${c.hint(mcpUrl)}`));
    }
  }
}

// Installs/refreshes the slice commit-scope guard (.githooks/pre-commit, running
// .build-kit/lib/check-commit-scope.cjs) and wires it up via `git config
// core.hooksPath .githooks`. Shared by `init --hooks`, `re-init --hooks`, and the
// standalone `init-hooks` command so all three copy/chmod/git-config identically
// instead of drifting apart — callers are responsible for checking `hooksSrc`
// exists first, since what "no template for this stack" means differs per caller.
// `init --demo` — drop a ready-made .slices/ tree into the install so the build
// skills (and `activate-context`/`slice-status`/the agent loop) have something real
// to work on before the project is ever connected to a board. The tree under
// shared/demo-slices/ is a verbatim `fetch --format json` output for the
// "Understanding Eventsourcing" context (a 16-slice shopping-cart model, every slice
// type represented), so it is byte-identical in shape to what a real fetch writes —
// a later `fetch` just overwrites it, and nothing downstream needs a demo-only path.
//
// The destination mirrors `fetch`'s own resolution exactly (see the SLICES_DIR comment
// there): nested under the kit dir for every kit whose code-export.mjs hardcodes
// `.slices/` next to itself, and at the project root for modeling-kit, which has no
// code-export.mjs and no skill reading a nested copy.
function installDemoSlices({ kitDir, targetDir, stackCfg }) {
  const slicesDir = stackCfg.kitDirName === MODELING_KIT.kitDirName
    ? join(targetDir, '.slices')
    : join(kitDir, '.slices');
  const rel = relative(targetDir, slicesDir) || '.slices';

  // An existing .slices/ is fetched board state — the user's real model. The copy
  // below merges rather than replaces, so installing over it would leave a half-demo,
  // half-real tree with a current_context.json pointing at the wrong one. Refuse
  // instead. Deliberately not overridable by --force: that flag means "don't re-ask
  // about credentials", never "discard fetched work".
  if (existsSync(slicesDir) && readdirSync(slicesDir).length > 0) {
    console.log(`  ℹ️  --demo skipped — ${rel}/ already has slices in it (delete it first if you really want the demo model)`);
    return;
  }

  const demoSrc = join(__dirname, 'shared', 'demo-slices');
  if (!existsSync(demoSrc)) {
    console.log('  ℹ️  --demo was given but this CLI build ships no shared/demo-slices/ — nothing to install');
    return;
  }

  console.log('📦 Installing the demo model...');
  copyDirContents(demoSrc, slicesDir);
  console.log(`  ✓ Demo context "${DEMO_CONTEXT_NAME}" (${DEMO_SLICE_COUNT} slices) is active in ${rel}/`);
  console.log('  ℹ️  It is ordinary fetched slice data — `fetch --context <name>` replaces it with your own board whenever you are ready');
}

function configureHooks({ hooksSrc, targetDir }) {
  copyDirContents(hooksSrc, join(targetDir, '.githooks'));
  const preCommitHook = join(targetDir, '.githooks', 'pre-commit');
  if (existsSync(preCommitHook)) {
    // cpSync doesn't reliably carry over the executable bit across platforms,
    // and git silently skips a non-executable hook.
    try { execSync(`chmod +x "${preCommitHook}"`); } catch {}
  }
  try {
    execSync('git rev-parse --git-dir', { cwd: targetDir, stdio: 'ignore' });
    // core.hooksPath is resolved against the repo's actual top level, not `cwd` —
    // a relative `.githooks` breaks silently (no error, hooks just don't run) when
    // targetDir is a subfolder of a larger repo rather than the repo root itself.
    // Use an absolute path so it's correct regardless of where the git root is.
    execSync(`git config core.hooksPath "${join(targetDir, '.githooks')}"`, { cwd: targetDir });
    console.log('  ✓ Installed .githooks/ and set core.hooksPath — commits touching src/slices/ are now scope-guarded');
  } catch {
    console.log(`  ✓ Installed .githooks/ — run \`git config core.hooksPath ${join(targetDir, '.githooks')}\` once this directory is a git repo to activate it`);
  }
}

// Registers the eventmodelers MCP server in `.mcp.json` at the project root, the
// same file/shape the `connect` skill's Step 3.5 produces — kept here as a
// belt-and-suspenders guarantee, since an agent executing that skill can skip a
// step, but a `claude` process only ever discovers MCP servers at its own
// startup. Anything spawning a `claude` process for this project (cold-spawn
// per task, or a long-lived warm process) must call this first — a `.mcp.json`
// written mid-session by the process itself is too late for that same process.
// The token itself is never written to disk here — `${EVENTMODELERS_TOKEN}` is
// resolved by `claude` from its own process env, which the caller must set. Same for
// `${EVENTMODELERS_AGENT_ID}`: without it on the transport, every MCP write this agent makes
// reaches the platform unattributed (board_events.agent_id null), and the board shows one
// anonymous robot for it instead of this agent's name. It belongs here rather than only in the
// skill's Step 3.5 because this entry is rewritten on every run — it would otherwise overwrite
// the header the skill just added — and because a `.mcp.json` fixed mid-session comes too late
// for the `claude` process already running. An unset var arrives at the server as the literal
// `${EVENTMODELERS_AGENT_ID}` text, which it drops (it only accepts a uuid), so the entry is the
// same one for a human's session and an agent's.
function ensureMcpRegistered(projectDir, baseUrl) {
  const mcpConfigPath = join(projectDir, '.mcp.json');
  const mcpConfig = readJsonSafe(mcpConfigPath);
  mcpConfig.mcpServers = mcpConfig.mcpServers || {};
  mcpConfig.mcpServers.eventmodelers = {
    type: 'http',
    url: `${baseUrl}/mcp`,
    headers: { 'x-token': '${EVENTMODELERS_TOKEN}', 'x-agent-id': '${EVENTMODELERS_AGENT_ID}' },
  };
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
}

// Companion to ensureMcpRegistered: that function deliberately never writes the
// token itself, on the assumption the caller sets EVENTMODELERS_TOKEN in whatever
// process spawns `claude` (true for `run --modeling`'s own spawn). It is NOT true
// for an interactive session opened directly in the project right after
// `init`/`init-config` — that `claude` process inherits the user's shell env,
// which never had a reason to already have this var set.
//
// A plain `.env` file does NOT fix this — Claude Code never sources one; per its
// own docs, an unresolved `.mcp.json` placeholder is left as the literal
// `${EVENTMODELERS_TOKEN}` text, which fails auth and falls back to an OAuth
// flow the eventmodelers server can't actually satisfy for this client. The
// only things Claude Code itself resolves `.mcp.json` placeholders against are
// the inherited shell env and its own settings files' `env` block. `.claude/
// settings.local.json` is the documented per-user, gitignored-by-convention
// scope for exactly this — same idea as `.eventmodelers/config.json` already
// holding the raw token, just in the one file Claude Code's own process env
// actually consults before expanding `.mcp.json`.
function ensureEnvToken(targetDir, token) {
  if (!token) return;
  const claudeDir = join(targetDir, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, 'settings.local.json');

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  settings.env = settings.env || {};
  settings.env.EVENTMODELERS_TOKEN = token;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // settings.local.json is gitignored by Claude Code's own convention, but make
  // sure nothing here relies on that silently — it now holds a live secret.
  const gitignorePath = join(targetDir, '.gitignore');
  const entry = '.claude/settings.local.json';
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.split('\n').map((l) => l.trim()).includes(entry)) {
      appendFileSync(gitignorePath, `${content === '' || content.endsWith('\n') ? '' : '\n'}${entry}\n`);
    }
  } else {
    writeFileSync(gitignorePath, `${entry}\n`);
  }
  console.log('  ✓ Wrote EVENTMODELERS_TOKEN to .claude/settings.local.json (gitignored)');
}

// --- The global modeling install (`run --global`) ------------------------------
//
// A modeling agent never touches the filesystem it was launched from — it works against
// the board over MCP/REST. A project install exists only so that the `claude` process has
// a directory with the skills in it, which is a lot of ceremony to demand of someone who
// just wants to point an agent at a board. So there is ONE installation under
// ~/.eventmodelers/kit, initialized on first use, and `run --standalone` falls back to it
// whenever this directory has no kit of its own.
//
// One dir, not one per board: the kit is byte-for-byte identical whatever board it drives
// (skills, CLAUDE.md, a config.js), so there is nothing in it to key per board. What IS
// per board is the credentials, and those live in their own files beside it — see
// boardCredentialsPath. The kit itself holds no secret at all.
const GLOBAL_DIR = join(homedir(), '.eventmodelers');
const GLOBAL_KIT_DIR = join(GLOBAL_DIR, 'kit');

// One file per board: `{token, organizationId, boardId, baseUrl}`. Credentials
// ARE per board — a token is scoped to the org that owns it — so one machine can drive
// several boards across several accounts at once, each with its own. Written 0600 in a
// 0700 dir: unlike a project's .eventmodelers/config.json, there is no .gitignore standing
// between this file and the rest of the world.
function boardCredentialsPath(boardId) {
  return join(GLOBAL_DIR, 'boards', `${boardId}.json`);
}

// Three shapes, never mixed: the board's own credentials, a note that this board just uses
// the account-wide ones, or a pointer to another board's file. All three exist for the same
// reason — every possible answer to the where-from question has to be recordable against
// the board that was ASKED about (including "actually, those credentials were for a
// different board"), so that the next run can offer it back as the default rather than
// asking for the same paste again.
function writeBoardCredentials(config) {
  const path = boardCredentialsPath(config.boardId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // agentName is stored, the agent id is not: the name is a label for whoever runs here (and
  // this file is the only config a `run --standalone` from an arbitrary directory reads, so
  // dropping it would lose `init-config --name` on the very next run), while the id is minted
  // per run now — see resolveModelingCredentials for why.
  const agentName = config.agentName ? { agentName: config.agentName } : {};
  const body = config.useBoard
    ? { boardId: config.boardId, useBoard: config.useBoard }
    : config.useGlobal
    ? { boardId: config.boardId, useGlobal: true, ...agentName }
    : {
        token: config.token,
        organizationId: config.organizationId,
        boardId: config.boardId,
        baseUrl: config.baseUrl,
        ...agentName,
      };
  writeFileSync(path, JSON.stringify(body, null, 2), { mode: 0o600 });
}

// The account page hands credentials over as one comma-separated blob
// (token=...,boardId=...,organizationId=...,baseUrl=...), and an interactive prompt used to
// be the only place that shape was accepted. --credentials takes the same blob
// non-interactively — the JSON form works too, and '-' reads it from stdin so a token need
// never appear in shell history or a process list. parseCredentialsPaste does the actual
// parsing; this only turns "unparseable" into a useful error.
function parseCredentialsArg(value) {
  const text = value === '-' ? readFileSync(0, 'utf-8') : value;
  const parsed = parseCredentialsPaste(text, ['organizationId', 'token']);
  if (!parsed) {
    console.error('❌ Could not parse --credentials. Expected the blob from https://app.eventmodelers.ai/account:');
    console.error('   token=<uuid>,boardId=<uuid>,organizationId=<uuid>,baseUrl=https://api.eventmodelers.ai');
    console.error("   The JSON form works too, and '-' reads it from stdin.");
    process.exit(1);
  }
  return parsed;
}

// The account's default board, for when neither --board-id nor any config on the way up
// named one. Same endpoint the kit's own fetchPlatformConfig calls — inlined here because
// that module lives inside the kit we may not have initialized yet.
async function fetchDefaultBoardId(baseUrl, token) {
  try {
    const res = await fetch(`${baseUrl}/api/config`, { headers: { 'x-token': token } });
    if (!res.ok) return null;
    return (await res.json()).boardId ?? null;
  } catch {
    return null;
  }
}

// Per-run credentials for the global install. Precedence is this CLI's usual one, with the
// per-board file slotted in as the most specific *file*: explicit flags beat
// EVENTMODELERS_* env vars beat ~/.eventmodelers/boards/<board>.json beat the nearest
// .eventmodelers/config.json up the tree beat ~/.eventmodelers/config.json. So
// `run --standalone --board-id <uuid>` is enough for a board used before, and any run can
// be pointed somewhere else entirely with --token/--organization-id.
async function resolveModelingCredentials(cwd, flags, explicitConfigPath, print, nonInteractive = false) {
  const walked = loadEffectiveConfig(cwd, null, explicitConfigPath).config;
  const explicit = Object.fromEntries(Object.entries(flags ?? {}).filter(([, v]) => v));

  // Whether there is anyone to ask, decided once. A TTY was the only signal before, which is
  // right for a supervisor or CI (no stdin, so nothing to ask) but wrong for a loop started
  // from a terminal: stdin is a TTY nobody is watching, and the run stops on a question.
  // --non-interactive says so explicitly; --print never asks either.
  const interactive = !print && !nonInteractive && process.stdin.isTTY;

  // An EVENTMODELERS_TOKEN set for this run answers the credentials question below as
  // squarely as --token does — applyEnvOverrides makes it win over every file anyway, so
  // asking where this board's credentials come from could not change the outcome. The board
  // question has always treated its env var this way; this is the same rule for the token.
  const credentialsNamed = !!(explicit.token || process.env.EVENTMODELERS_TOKEN);

  // Which board comes first — everything else is stored per board, so there is nothing to
  // look up until we know which board this run is for.
  let boardId = explicit.boardId || process.env.EVENTMODELERS_BOARD_ID || walked.boardId || null;

  // Which board a run drives is the single most consequential thing about it, and a boardId
  // inherited from a config file can be arbitrarily stale — so when it wasn't named on the
  // command line, confirm it. Enter accepts whatever the config resolved to, keeping the
  // common case to one keystroke. Skipped when there is no one to ask (--print, or a
  // non-interactive stdin such as CI or a process supervisor), where the resolved value
  // stands on its own exactly as before.
  let boardChosen = !!(explicit.boardId || process.env.EVENTMODELERS_BOARD_ID);
  if (!boardChosen && interactive) {
    const answer = await prompt(boardId ? `\n  Board ID [${boardId}]: ` : '\n  Board ID: ');
    if (answer) {
      boardId = answer;
      boardChosen = true;
    }
  }

  let stored = boardId ? readJsonSafe(boardCredentialsPath(boardId)) : {};

  // Follow a pointer left by an earlier answer: this directory (or the account config) keeps
  // resolving to one board, but the credentials pasted for it named another. Without this the
  // question below would be re-asked on every single start, since the board that gets a file
  // is never the board the next run resolves. Not followed when the board was named
  // explicitly — that is a direct instruction, not an inherited default. One hop only: a
  // pointer always targets a board that then holds real credentials, so a chain would mean a
  // corrupted store rather than something to chase.
  if (stored.useBoard && !boardChosen) {
    boardId = stored.useBoard;
    stored = readJsonSafe(boardCredentialsPath(boardId));
  }

  // Where this board's credentials come from is the one thing that can't be guessed: its
  // own, or the account-wide ones. Asked on every interactive start rather than only the
  // first, so a board can be repointed without hand-editing files — but a board that has
  // been answered for already keeps that answer as the pre-selected entry, making the
  // repeat a single Enter rather than a paste. Skipped whenever the answer is already
  // implied — explicit credentials on the command line — or when there is no one to ask:
  // --print, or a non-interactive stdin such as CI or a supervisor that would otherwise
  // hang here forever (those keep using whatever is on file, silently).
  if (interactive && !credentialsNamed) {
    const hasAccountWide = !!(walked.token && walked.organizationId);

    // What "keep" would keep. A pointer entry is deliberately not offered: it says the
    // paste belonged to a different board, which is an answer about that board, not a set
    // of credentials this one can hold on to.
    const existing = stored.token
      ? { keep: stored, from: boardCredentialsPath(boardId).replace(homedir(), '~') }
      : stored.useGlobal
      ? { keep: { useGlobal: true }, from: 'the account-wide credentials' }
      : null;

    const choices = [
      { label: 'The account-wide credentials (~/.eventmodelers/config.json)', value: 'global' },
      { label: 'Credentials of its own — paste them now', value: 'board' },
    ];
    if (existing) choices.unshift({ label: `Keep the credentials already stored for this board (${existing.from})`, value: 'keep' });

    const configured = existing ? 'is already configured on this machine' : "hasn't been configured on this machine yet";
    const choice = await selectPrompt(
      boardId
        ? `Board ${boardId} ${configured}. Where should its credentials come from?`
        : `This board ${configured}. Where should its credentials come from?`,
      choices,
      // 'keep' when there is something to keep, else the pre-existing default: account-wide
      // when it actually holds credentials, otherwise the paste.
      existing || hasAccountWide ? 0 : 1,
    );

    if (choice === 'keep') {
      stored = existing.keep;
    } else if (choice === 'board') {
      console.log("\n  Copy this board's credentials from https://app.eventmodelers.ai/account,");
      console.log('  then paste them below and press Enter:\n');
      console.log('    token=<uuid>,boardId=<uuid>,organizationId=<uuid>,baseUrl=https://api.eventmodelers.ai\n');
      const parsed = parseCredentialsPaste(await promptPasteBlock(), ['organizationId', 'token']);
      if (!parsed) {
        console.error("\n❌ Couldn't make sense of that paste — nothing was saved.");
        process.exit(1);
      }
      // The paste is the more specific answer about which board this is: someone who copied
      // board B's credentials means board B, whatever the command line defaulted to. But the
      // question was asked ABOUT board A, so board A needs an answer on file too — otherwise
      // the next run resolves A again, finds nothing, and asks all over again.
      if (parsed.boardId && boardId && parsed.boardId !== boardId) {
        writeBoardCredentials({ boardId, useBoard: parsed.boardId });
        console.log(`\n  ℹ️  Those credentials are for board ${parsed.boardId}, not ${boardId} — noted, so this board isn't asked for a paste again.`);
        console.log(`      Pass --board-id to pick a different board, or drop the stale boardId from ~/.eventmodelers/config.json.`);
      }
      if (parsed.boardId) boardId = parsed.boardId;
      stored = parsed;
    } else {
      stored = { useGlobal: true };
    }
  }

  // applyEnvOverrides runs again here on purpose: loadEffectiveConfig already folded the
  // env layer into 'walked', and spreading the board file over that would otherwise let a
  // stored value outrank an env var the user set for this run. A useGlobal board keeps its
  // marker out of the merge — it names no credentials, it only says where to find them.
  let config = stored.useGlobal
    ? { ...applyEnvOverrides(walked), ...explicit }
    : { ...applyEnvOverrides({ ...walked, ...stored }), ...explicit };
  if (boardId) config.boardId = boardId;

  if ((!config.token || !config.organizationId) && interactive) {
    // Nothing anywhere — ask once, and save it account-wide rather than into this
    // directory, so every later run from anywhere is silent. Headless, there is nobody to
    // interview, so this is skipped and the check below fails the run with the reason.
    console.log('🔐 No Eventmodelers credentials found — configuring them once, account-wide.\n');
    config = await configureCredentials({
      config,
      configPath: join(GLOBAL_DIR, 'config.json'),
      targetDir: homedir(),
      requiredFields: ['organizationId', 'token'],
      boardIdOptional: true,
      print,
      skipGitignore: true,
    });
  }

  if (!config.baseUrl) config.baseUrl = DEFAULT_BASE_URL;

  if (!config.token || !config.organizationId) {
    console.error('❌ A modeling agent needs a token and an organizationId — pass --token/--organization-id, set EVENTMODELERS_TOKEN/EVENTMODELERS_ORGANIZATION_ID, or run init-config --global once.');
    process.exit(1);
  }

  // A modeling agent always runs for exactly one board (see runModeling) — fall back to
  // the account default before giving up, since that is the board the web app opens too.
  if (!config.boardId) config.boardId = await fetchDefaultBoardId(config.baseUrl, config.token);
  if (!config.boardId) {
    console.error('❌ No board id — a modeling agent always runs for exactly one board. Pass --board-id <uuid>.');
    process.exit(1);
  }

  // A fresh identity for every standalone run, deliberately not persisted. A standalone agent
  // is started ad hoc from wherever, and nothing stops two of them running for the same board —
  // with one id stored per board they upserted the same alive row (the heartbeat is keyed on
  // token + agent_id + agent_type), so the second agent replaced the first instead of joining
  // it: the board showed one agent however many were running, and their writes were
  // indistinguishable. A per-run uuid costs the identity its continuity across restarts (a
  // restarted agent is a new row, and the old one lingers until its 45s window lapses) — pass
  // `run --id <uuid>` when an agent needs to keep one identity, which is also what makes
  // "preferred agent" on the board stick to it.
  config.agentId = randomUUID();
  writeBoardCredentials(stored.useGlobal
    ? { boardId: config.boardId, useGlobal: true, agentName: config.agentName }
    : config);

  return config;
}

// Initializes the global install if it isn't there (or was written by an older CLI) and
// returns it, ready to be handed to runModeling as the project dir. Re-scaffolded only on
// a version change, so the copy happens once per upgrade rather than once per run.
async function ensureGlobalKit(baseUrl) {
  const manifestPath = join(GLOBAL_KIT_DIR, MODELING_KIT.kitDirName, '.eventmodelers', 'install-manifest.json');

  if (readJsonSafe(manifestPath).version !== CLI_VERSION) {
    console.log(`📦 Initializing the global modeling install in ${GLOBAL_KIT_DIR}\n`);
    await installStack(MODELING_KIT.key, MODELING_KIT, {
      targetDir: GLOBAL_KIT_DIR,
      // Nothing but the kit: no root CLAUDE.md router, no .gitignore merge, no credentials
      // at rest, and no "now run this" epilogue in front of a loop about to start anyway.
      skipRootScaffold: true,
      skipCredentials: true,
      skipEpilogue: true,
      // Stands in for "yes" at the non-empty-kit-dir prompt — a re-scaffold after an
      // upgrade is precisely what we are asking for, and there is no one here to ask.
      print: true,
    });
  }

  // Holds no secret — just the URL and a `${EVENTMODELERS_TOKEN}` placeholder, which
  // `claude` expands from the process env runModeling's spawn sets. Rewritten every run
  // because baseUrl is a per-run value here (prod vs beta), unlike in a project install.
  ensureMcpRegistered(GLOBAL_KIT_DIR, baseUrl);

  return GLOBAL_KIT_DIR;
}

// `run --modeling`: modeling-kit's one and only runtime mode — there is no
// cold-spawn/tasks.json loop for this kit (that's a build-kit concept; see the
// `run` command's build-kit-vs-modeling-kit gate above). It keeps ONE Claude
// process warm across turns via `--input-format stream-json`, subscribes to the
// org's realtime channel itself, and writes each prompt straight to that
// process's stdin as soon as it's fetched — no file round-trip, no polling delay,
// no re-discovery of a prompt this process already has in memory. Only pure,
// read-only config resolution (`loadLocalConfig`/`fetchPlatformConfig`) is reused
// from the kit's lib/config.js, to avoid duplicating the config-file-walk logic.
// See `.agent-modeling-kit/CLAUDE.md` for the per-turn instructions this mode's
// modeling session follows — and `.agent-modeling-kit/CLAUDE-STANDALONE.md` for the
// self-directed turns below, kept in their own file precisely so a non-standalone
// session (and a prompt turn in a standalone one) never loads them.
//
// `standalone` adds a second, self-directed lane on top of that: the loop also
// listens on the board's own change channel (`board:<id>` — the same one the web
// canvas subscribes to) and, when the board goes quiet after someone edits it,
// dispatches a turn nobody asked for, so the agent can do what a human
// collaborator would do unprompted — fill in example data on a fresh node, post a
// question, sketch a screen. Without the flag that channel is still subscribed on
// the same connection and every event on it is dropped, so the two modes differ by
// one filter rather than by a whole second realtime stack.
//
// `exclusive` narrows the prompt lane to this agent alone: only a prompt the user
// addressed to this agent id (the board's "preferred agent") is worked, and anything
// untargeted is handed straight back to the queue for another agent to take. It says
// nothing about the standalone lane — a self-directed turn is nobody's task, so an
// exclusive standalone agent still works the board on its own initiative.
async function runModeling(kitDir, projectDir, { verbose = false, standalone = false, exclusive = false, overrides = null, maxAgents = DEFAULT_MAX_AGENTS, identity = {}, localAi = null } = {}) {
  const configLibPath = join(kitDir, 'lib', 'config.js');
  if (!existsSync(configLibPath)) {
    console.error(`❌ ${relative(process.cwd(), configLibPath)} not found — --modeling needs a kit installed via \`init --modeling\`.`);
    process.exit(1);
  }
  const { loadLocalConfig, fetchPlatformConfig } = await import(pathToFileURL(configLibPath).href);

  // Overrides are applied twice, on purpose. Here, so the credential checks below and
  // fetchPlatformConfig's own request use the token this run was given rather than
  // whatever the config walk turned up; and again after that fetch, because it merges the
  // platform's answer OVER the local config — without which the account's default board
  // would quietly outrank an explicit --board-id.
  // The global install never inherits a config file: its credentials are resolved per
  // run (resolveModelingCredentials) and handed over whole. Walking the filesystem here
  // would also print loadLocalConfig's "no config found — platform sync disabled" note,
  // which is exactly backwards when a complete config was just passed in.
  const local = overrides ? { ...overrides } : loadLocalConfig(kitDir);
  // The global install's overrides carry their own agent id, kept per board in
  // ~/.eventmodelers/boards/<board>.json — one dir driving several boards must not have
  // them all upsert one shared alive row. A project install keeps its id in the project
  // root config, namespaced by agent type, as it always has.
  // `run --id` overrides that for this run only — ensureAgentId is skipped rather than
  // overwritten, so the project's own stable id stays on disk and the next run without the
  // flag is the same agent the platform saw before.
  if (!overrides) local.agentId = identity.agentId || ensureAgentId(kitDir, 'MODELING');
  if (!local.token || !local.organizationId) {
    console.error('❌ --modeling needs platform credentials in .eventmodelers/config.json (token + organizationId) — run `/connect` once or paste your config first.');
    process.exit(1);
  }
  // The identity flags go on last: the global install's `overrides` carry the agent id
  // resolveModelingCredentials just minted for this run, which would otherwise win back over
  // an explicit --id.
  const cfg = { ...(await fetchPlatformConfig(local)), ...(overrides ?? {}), ...(identity.agentId ? { agentId: identity.agentId } : {}), ...(identity.agentName ? { agentName: identity.agentName } : {}) }; // adds realtimeProvider + its provider-specific fields (supabaseUrl/supabaseAnonKey or pocketbaseUrl), + boardId if the config has a default one
  if (!cfg.boardId) {
    console.error('❌ --modeling needs a boardId — a modeling agent always runs for exactly one board. Run `/connect board=<uuid>` once, or add boardId to .eventmodelers/config.json.');
    process.exit(1);
  }
  // Nothing can be addressed to an agent with no id, so an exclusive run without one would
  // hand every prompt back and sit idle forever — a silent no-op worth failing on instead.
  if (exclusive && !cfg.agentId) {
    console.error('❌ --exclusive needs an agent id — that is what a prompt is addressed to. Pass `run --id <uuid>` (or let the kit mint one) and address the prompt to it on the board.');
    process.exit(1);
  }

  const subagentModel = cfg.subagentModel || DEFAULT_SUBAGENT_MODEL;

  const log = (line) => console.log(`[modeling] ${line}`);

  // A local model replaces the warm `claude` process, not the loop around it: the prompt queue,
  // the standalone board-change lane and the idle review never knew what sat behind a turn, so
  // they are untouched by this. What a local model cannot bring along is the skills
  // (/place-element, /timeline, the eventmodeling-* methodology) and the subagent fan-out —
  // those are Claude Code features, not wire-format ones, so the turn texts below drop the parts
  // that assume them and lib/modeling-local-ai.js states the board rules in its system prompt
  // instead. Same deal a build kit's --local-ai already makes.
  let localRunner = null;
  if (localAi) {
    try {
      localRunner = createModelingLocalAiRunner({ cfg, target: localAi, log, verbose, standalone });
    } catch (err) {
      console.error(`❌ --local-ai: ${err.message}`);
      process.exit(1);
    }
  }

  const QUESTIONING_RULE =
    'IMPORTANT: You are running autonomously — no human is available to answer questions. ' +
    'If you need clarification to proceed, do NOT pause or ask interactively. Instead, post your question ' +
    'as a QUESTION-type comment (via /handle-comment with action=place and type=QUESTION) on the most ' +
    'relevant slice or column node on the board, then continue with your best interpretation of the prompt.\n\n';

  // Sent once, on the first turn only — it's what tells the agent to follow
  // .agent-modeling-kit/CLAUDE.md's per-turn steps for this warm session (instead
  // of the root router's default of reading every installed kit's CLAUDE.md), and
  // gives the modeling session its one-time connect credentials. Every later turn
  // only carries the per-prompt fields that actually vary (board_id, comment_id, ...).
  let firstTurn = true;
  // The preamble belongs to the *session*, not to prompts: in --standalone a
  // board-change turn can just as well be the first turn a (re)spawned process
  // ever sees, so both turn builders go through this rather than buildTurn owning it.
  function withSessionHeader(body) {
    // Nothing to prepend for a local model: it has no CLAUDE.md to read and no /connect to run
    // (its tools are already authenticated), and handing it the raw token would put credentials
    // in a context that has no way to use them.
    if (localRunner) return body;
    if (!firstTurn) return body;
    firstTurn = false;
    return `MODE=modeling token=${cfg.token} org=${cfg.organizationId} baseUrl=${cfg.baseUrl} standalone=${standalone ? 'on' : 'off'}${standalone ? ` max_agents=${maxAgents}` : ''} subagent_model=${subagentModel}\n\n${QUESTIONING_RULE}Read .agent-modeling-kit/CLAUDE.md now and follow it for every prompt in this session — it's a one-time read; don't re-read it on later turns.\n\n${body}`;
  }

  function buildTurn(p) {
    const fields = [
      `prompt_id=${p.id}`,
      `board_id=${p.board_id ?? cfg.boardId ?? ''}`,
      `organization_id=${p.organization_id ?? cfg.organizationId}`,
      p.timeline_id ? `timeline_id=${p.timeline_id}` : null,
      p.comment_id ? `comment_id=${p.comment_id}` : null,
      p.node_id ? `node_id=${p.node_id}` : null,
    ].filter(Boolean).join(' ');
    // What the user had selected and on screen when they submitted (selectedCell,
    // selectedNodes, timelineId, focusArea). CLAUDE.md's step 3 resolves CELL_ID/NODE_ID/
    // TIMELINE_ID from it in preference to the flat fields above, and a canvas "poke" —
    // whose prompt text is the bare word `Focus` — is nothing BUT this context: drop it and
    // the turn says "Focus" and names nowhere to look. Sent as JSON on its own line because
    // it is structured, unlike the flat k=v fields.
    const context = p.context && typeof p.context === 'object' && Object.keys(p.context).length
      ? `\ncontext=${JSON.stringify(p.context)}`
      : '';
    return withSessionHeader(`${fields}${context}\n\n${p.prompt}`);
  }

  const claudeArgs = ['--dangerously-skip-permissions', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  if (cfg.model) claudeArgs.push('--model', cfg.model);
  const claudeEnv = {
    ...process.env,
    ...(cfg.anthropicBaseUrl ? { ANTHROPIC_BASE_URL: cfg.anthropicBaseUrl } : {}),
    EVENTMODELERS_TOKEN: cfg.token,
    // What the connect skill puts in `.mcp.json`'s x-agent-id header and every curl-fallback
    // call, so the board work this agent does on the platform is attributed to this agent.
    ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
  };

  let proc = null;
  let stdoutBuffer = '';
  let pending = null; // one in-flight turn at a time
  let lastTurnEndedAt = 0; // when the last turn finished — the standalone lane's echo window (see below)
  let warmUp = null; // this process's session warm-up turn (see warmUpSession) — null until one is started
  let warmingUp = false; // the in-flight turn is the warm-up: it only reads, so its writes can't echo

  // Collapses whitespace/newlines to a single line and truncates past `max` chars —
  // a long multi-line curl command or grep pattern wrapped across many terminal lines
  // is just as unreadable as no detail at all. Keeps one tool call to one log line.
  function oneLine(s, max) {
    const collapsed = String(s ?? '').replace(/\s+/g, ' ').trim();
    return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
  }

  // Bare tool names (`→ Bash`, `→ Skill`) tell you nothing happened worth
  // reading — this pulls out the one input field that actually says what the
  // tool did, so the trace is skimmable without the interactive TUI. Only used
  // in --verbose mode; the condensed default logs the bare name (or, for Skill,
  // just the skill name) instead — see handleLine.
  function describeToolUse(block) {
    const input = block.input ?? {};
    switch (block.name) {
      case 'Bash': return `Bash: ${oneLine(input.command, 100)}`;
      case 'Skill': return `Skill: ${input.skill}${input.args ? ` ${oneLine(input.args, 60)}` : ''}`;
      case 'Read': return `Read: ${input.file_path}`;
      case 'Edit': return `Edit: ${input.file_path}`;
      case 'Write': return `Write: ${input.file_path}`;
      case 'Grep': return `Grep: ${oneLine(input.pattern, 60)}`;
      case 'Glob': return `Glob: ${input.pattern}`;
      case 'WebFetch': return `WebFetch: ${input.url}`;
      case 'Agent': return `Agent: ${oneLine(input.description ?? input.subagent_type ?? '', 60)}`;
      default: return block.name;
    }
  }

  // stream-json output loses the normal interactive TUI (tool cards, live diffs) —
  // this is a plain-text approximation, good enough for a headless/voice runner.
  // --verbose logs full tool input and assistant reasoning text; the default
  // (condensed) mode logs only the high-level step — a skill name, or a bare tool
  // name — so a long session reads as a step list instead of a full trace.
  function handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text && verbose) log(block.text);
        if (block.type === 'tool_use') {
          if (verbose) log(`→ ${describeToolUse(block)}`);
          else if (block.name === 'Skill') log(`→ Skill: ${block.input?.skill ?? ''}`);
          else log(`→ ${block.name}`);
        }
      }
      return;
    }
    if (msg.type === 'result') {
      log(`done (${msg.duration_ms}ms${msg.total_cost_usd ? `, $${msg.total_cost_usd.toFixed(4)}` : ''})`);
      lastTurnEndedAt = Date.now();
      const turn = pending;
      pending = null;
      // The result text is what a standalone turn's NOOP/DONE answer rides in — the
      // self-directed lane reads it to decide whether to back off (dispatchStandaloneTurn).
      if (turn) (msg.is_error ? turn.reject(new Error(msg.result || 'Claude turn errored')) : turn.resolve(msg.result ?? ''));
    }
  }

  function spawnProcess() {
    proc = spawn('claude', claudeArgs, { cwd: projectDir, env: claudeEnv, stdio: ['pipe', 'pipe', 'inherit'] });
    stdoutBuffer = '';
    warmUp = null; // a fresh process has connected to nothing and read nothing
    proc.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const l of lines) handleLine(l);
    });
    proc.on('exit', (code) => {
      log(`process exited (${code}) — will respawn on next task`);
      lastTurnEndedAt = Date.now();
      proc = null;
      firstTurn = true; // a respawned process is a fresh session — needs MODE=modeling again
      warmUp = null; // …and a fresh warm-up before its first real turn
      warmingUp = false;
      if (pending) {
        const turn = pending;
        pending = null;
        turn.reject(new Error(`claude process exited (${code}) mid-turn`));
      }
    });
    log('modeling session started');
  }

  function sendTurn(text) {
    return new Promise((resolveTurn, rejectTurn) => {
      pending = { resolve: resolveTurn, reject: rejectTurn };
      proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    });
  }

  // A standalone session is long-lived and spends most of its life waiting, so the setup
  // every turn needs — read CLAUDE.md, run /connect, find out which chapters exist — is done
  // once at startup instead of being paid by whoever happens to send the first prompt. By the
  // time a real turn arrives the credentials are resolved and the turn is straight into the
  // work. It reads only: nothing is placed, no prompt status is touched (there is no prompt_id
  // here), no subagent is dispatched.
  //
  // What it deliberately does *not* do is read the board. Reading every chapter up front cost a
  // minute and a dollar before anyone had asked for anything, on a board where a turn typically
  // touches one chapter — and it front-loaded the context every later turn then carries. Chapters
  // are read lazily instead: the first turn with business in one fetches its outline and keeps it
  // for the rest of the session, so the cost is paid once and only for chapters that see work.
  const WARM_UP_TASK =
    'This is the session warm-up, before any prompt or board change — nobody has asked for anything yet, and ' +
    'there is nothing to sanitize, no prompt_id and no progress entry. Do exactly this and then stop: ' +
    '(1) read .agent-modeling-kit/CLAUDE.md now, and .agent-modeling-kit/AGENTS.md if it exists, as your ' +
    'one-time reads for this session — do NOT read .agent-modeling-kit/CLAUDE-STANDALONE.md, that one still ' +
    'waits for the first self-directed turn; (2) invoke /connect with the credentials above and ' +
    `board=${cfg.boardId} — this is the session's one-time connect, so no later turn runs it again; ` +
    '(3) learn which chapters exist, and nothing beyond that: one get_chapter_bounds call returns every ' +
    'chapter\'s id and title. Do NOT read any chapter\'s contents here — no get_board_outline, no ' +
    'per-chapter get_nodes, and skip the board read /connect Step 5 would otherwise have you do. A chapter ' +
    'is read on the first turn that actually has business in it, and kept for the rest of the session ' +
    'from then on. Change nothing: no nodes, no comments, no slice statuses, no subagents. Reply ' +
    '<promise>READY</promise> with the chapter list — titles and how many; say nothing about what is in ' +
    'them, you have not looked.';

  function buildWarmUpTurn() {
    const header = ['SESSION_START', `board_id=${cfg.boardId}`, `organization_id=${cfg.organizationId}`].join(' ');
    return withSessionHeader(`${header}\n\n${WARM_UP_TASK}`);
  }

  // Started eagerly at spawn, and awaited by every real turn — a prompt that lands mid
  // warm-up queues behind it rather than racing it for the one in-flight `pending` slot.
  function warmUpSession() {
    if (warmUp) return warmUp;
    if (!standalone) return (warmUp = Promise.resolve());
    log('warm-up: connecting and listing chapters before the first turn (chapters are read on first use)');
    warmingUp = true;
    warmUp = sendTurn(buildWarmUpTurn())
      .then((result) => log(`warm-up done — ${oneLine(result, 200) || 'session ready'}`))
      .catch((err) => {
        // Not fatal: put the session header back so the next real turn carries the
        // connect signal itself, exactly as it did before there was a warm-up.
        firstTurn = true;
        log(`warm-up failed (the first real turn will connect instead): ${err.message}`);
      })
      .finally(() => {
        warmingUp = false;
        lastTurnEndedAt = 0; // the warm-up wrote nothing, so there is no echo to wait out
      });
    return warmUp;
  }

  // The one thing that knew a `claude` process was behind a turn. Both lanes — the prompt
  // queue (drain) and the self-directed one (dispatchStandaloneTurn) — go through here.
  async function runTurn(text) {
    if (localRunner) return localRunner.runTurn(text);
    if (!proc) spawnProcess();
    await warmUpSession();
    return sendTurn(text);
  }

  if (!localRunner) spawnProcess();
  log(`agent: ${cfg.agentName ? `${cfg.agentName} (${cfg.agentId})` : cfg.agentId}`);
  if (localRunner) log(`runner: local model — ${localRunner.describe()} (board tools over MCP; no skills, no subagents)`);
  log(
    standalone
      ? `standalone: ON — reacting to direct prompts AND to board changes on its own initiative (${localRunner ? 'work is done inline — a local model has no subagents' : `max ${maxAgents} subagent(s) per self-directed turn`})`
      : 'standalone: off — reacting to direct prompts only (board changes are dropped)',
  );
  if (exclusive) {
    log(`exclusive: ON — only prompts addressed to ${cfg.agentId} are worked; every untargeted prompt is handed back to the queue`);
    // A global/standalone run mints its id per run (see resolveModelingCredentials), so an id
    // someone addressed a prompt to yesterday is not this agent — worth saying out loud here,
    // where the alternative is an agent that looks healthy and quietly works nothing.
    if (overrides && !identity.agentId) log('exclusive: this run minted a fresh agent id — star it on the board now, or restart with `--id <uuid>` to keep one addressable identity');
  }
  // Both warm-ups are the same bet — pay the session's fixed setup cost before a turn arrives
  // rather than making whoever sends the first prompt wait for it. For a local model that cost
  // is the MCP tool set; for Claude it is reading CLAUDE.md and running /connect.
  if (localRunner) localRunner.warmUp().catch((err) => log(`local-ai warm-up failed (the first turn will retry): ${err.message}`));
  else warmUpSession();

  async function getRealtimeToken() {
    const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/realtime-token`, {
      headers: { 'x-token': cfg.token, ...agentHeaders(cfg) },
    });
    if (!res.ok) throw new Error(`realtime-token: HTTP ${res.status}`);
    return (await res.json()).token;
  }

  async function fetchNextPrompt(jwtToken) {
    const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/next?board_id=${encodeURIComponent(cfg.boardId)}`, {
      headers: { 'x-token': cfg.token, Authorization: `Bearer ${jwtToken}`, ...agentHeaders(cfg) },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`prompts/next: HTTP ${res.status}`);
    return res.json();
  }

  // Puts a prompt this agent claimed but will not work back on the queue (CLAIMED -> ADDED),
  // so whichever agent it was actually open to can still take it. `x-token` only — the status
  // endpoint is meant to be called by the agent holding the prompt.
  async function releasePrompt(promptId) {
    const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/${promptId}/status`, {
      method: 'POST',
      headers: { 'x-token': cfg.token, 'Content-Type': 'application/json', ...agentHeaders(cfg) },
      body: JSON.stringify({ status: 'ADDED' }),
    });
    if (!res.ok) throw new Error(`prompts/${promptId}/status: HTTP ${res.status}`);
  }

  let realtimeToken = await getRealtimeToken();

  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    // --exclusive only: prompts claimed in this pass that weren't addressed to this agent,
    // handed back once the pass is over (see below).
    const handBack = [];
    try {
      let p;
      while ((p = await fetchNextPrompt(realtimeToken)) !== null) {
        // The queue can't filter by addressee for us: `prompts/next` hands an agent both the
        // prompts addressed to it and every untargeted one (`agent_id IS NULL`) — claiming is
        // what reveals which kind arrived — so an exclusive run claims as usual and gives back
        // what wasn't meant for it.
        //
        // The hand-back is deferred to the end of the pass on purpose: a prompt released
        // mid-loop goes straight back to the head of the very queue this loop is reading, so
        // the next fetch would return the prompt just released instead of the addressed one
        // queued behind it, and the agent would never reach its own work. Holding them CLAIMED
        // until the queue runs dry walks past them instead. The cost is a brief CLAIMED blip on
        // someone else's prompt, and — if no other agent happens to be draining when the
        // hand-back lands — that prompt waiting for the next `prompt:created` to be noticed.
        if (exclusive && (p.agent_id ?? null) !== cfg.agentId) {
          log(`prompt ${p.id} ${p.agent_id ? `is addressed to agent ${p.agent_id}` : 'is addressed to no agent'} — handing it back (--exclusive)`);
          handBack.push(p.id);
          continue;
        }
        log(`prompt received: "${p.prompt}" (board=${p.board_id ?? cfg.boardId ?? 'n/a'}, priority=${p.priority})`);
        try {
          await runTurn(buildTurn(p));
        } catch (err) {
          log(`turn failed: ${err.message}`);
        }
      }
    } finally {
      for (const id of handBack) {
        try {
          await releasePrompt(id);
        } catch (err) {
          // Left CLAIMED, which is worse for whoever sent it than a retry would be — but
          // retrying here risks wedging the loop, and the next pass claims nothing new
          // while this one is still unwinding. Say so and move on.
          log(`handing prompt ${id} back failed, it stays CLAIMED: ${err.message}`);
        }
      }
      draining = false;
      // A prompt turn counts as activity: the board isn't idle just because nobody edited
      // it while the agent was busy answering someone.
      armIdleReview();
    }
  }


  // ── Standalone lane: board changes, not just direct messages ───────────────
  //
  // `board:<id>` is the board's own change channel — the one the web canvas itself
  // subscribes to — carrying node:created/changed/deleted, edge:added/removed and
  // board:cleared with a minimal `{ type, id, node_id, user_id, seq, prev_seq }`
  // payload. It rides the realtime connection this loop already holds open for the
  // org prompt queue, so the non-standalone case joins it too and simply throws every
  // event away (see onBoardEvent). One code path either way — and whatever the backend
  // later adds to these payloads lands here without a client change.
  //
  // The edge events are deliberately *not* in this list. An edge is almost never a change
  // on its own: placing an element auto-connects it to its neighbours, so `edge:added`
  // arrives as the tail of a `node:created` this loop already woke up for — the same
  // gesture counted twice, and counted onto `(board)` rather than onto a node, since an
  // edge payload names no single node to go look at. Wiring an existing chain by hand says
  // nothing about the model's content either. Subscribing to them bought a second turn per
  // placement and nothing else, so board changes here mean node changes.
  const BOARD_CHANGE_EVENTS = ['node:created', 'node:changed', 'node:deleted', 'board:cleared'];

  // Four knobs. They govern *when* a self-directed turn fires — never whether an event is
  // remembered: everything that arrives is buffered (see onBoardEvent), so a burst that
  // straddles a turn boundary still reaches the next turn instead of being thrown away and
  // leaving the agent looking at whichever single event happened to land last.
  // Who wrote an event is *read off the event*, not inferred from these windows: the payload
  // carries `agent_id` (stamped from the writer's `x-agent-id` header) and `user_id` (a
  // browser session), so this agent's own echo is identified exactly and dropped without
  // costing a turn. The windows below only cover the one case attribution can't: a write that
  // carries neither id.
  //   DEBOUNCE     — one gesture (place a node, drag a column) fans out into several
  //                  events; wait for the board to fall quiet, then send a single turn.
  //   MAX_WAIT     — cap on that quiet period: a board someone keeps editing never falls
  //                  quiet, and the debounce alone would slide forever.
  //   ECHO_WINDOW  — how long after a turn its own writes are expected back; an
  //                  *unattributed* change in that window is labelled a possible echo, and
  //                  the next turn waits it out so a write and its echo don't each get one.
  //                  Off by default: it predates the `agent_id` above, which answers the same
  //                  question exactly and for free, and every turn paid its delay to cover a
  //                  residue of unattributed writes that a stamping backend never produces.
  //                  Set it (ms) on a backend where the logs below do show unattributed
  //                  changes.
  //   MIN_INTERVAL — a floor between self-directed turns, so a mistake upstream can't
  //                  become a self-feeding loop burning tokens unattended. Doubles per
  //                  consecutive NOOP up to BACKOFF_CAP, and resets as soon as a turn
  //                  actually does something. A person's edit is exempt (see
  //                  dispatchStandaloneTurn): a human cannot be the loop, and waiting a
  //                  minute before reacting to them is the whole latency complaint.
  //   IDLE         — with nothing at all happening on the board, how long before the agent
  //                  looks the model over anyway (a BOARD_REVIEW turn). 0 disables it, and
  //                  it answers to the same MIN_INTERVAL backoff, so a board with nothing
  //                  left to do goes quiet by itself rather than being swept every IDLE ms.
  const envMs = (name, fallback) => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  };
  const STANDALONE_DEBOUNCE_MS = envMs('EVENTMODELERS_STANDALONE_DEBOUNCE_MS', 2_500);
  const STANDALONE_MAX_WAIT_MS = envMs('EVENTMODELERS_STANDALONE_MAX_WAIT_MS', 90_000);
  const STANDALONE_ECHO_WINDOW_MS = envMs('EVENTMODELERS_STANDALONE_ECHO_WINDOW_MS', 0);
  const STANDALONE_MIN_INTERVAL_MS = envMs('EVENTMODELERS_STANDALONE_MIN_INTERVAL_MS', 60_000);
  const STANDALONE_BACKOFF_CAP_MS = envMs('EVENTMODELERS_STANDALONE_BACKOFF_CAP_MS', 15 * 60_000);
  const STANDALONE_IDLE_MS = envMs('EVENTMODELERS_STANDALONE_IDLE_MS', 15 * 60_000);

  // node_id (or '(board)') -> { types: Set<string>, count, own, other, maybe, person } for
  // everything seen since the last self-directed turn, each event counted into exactly one
  // origin bucket: `own` = attributed to this agent's own id, `other` = attributed to a human
  // or another agent, `maybe` = carries no attribution at all and landed inside the echo
  // window, so it *might* be this agent's. Only `maybe` is a guess.
  // `person` counts, alongside the bucket, the subset of `other` written from a browser
  // session rather than by another agent. It is what lets a human's edit skip the
  // MIN_INTERVAL floor: a person cannot be this agent's feedback loop, whereas two agents on
  // one board can ping-pong, so another agent's write keeps waiting its turn.
  const observed = new Map();
  let observedCount = 0;
  let seqLo = null;
  let seqHi = null;
  let standaloneTimer = null;
  let firstObservedAt = 0; // start of the current burst — MAX_WAIT is measured from here
  let lastStandaloneAt = 0;
  let noopStreak = 0;

  // The floor between self-directed turns, widened while the agent keeps finding nothing
  // to do. A quiet board therefore costs a turn every MIN_INTERVAL, then 2×, 4×, … up to
  // BACKOFF_CAP, instead of one per interval forever.
  function minIntervalMs() {
    return Math.min(STANDALONE_MIN_INTERVAL_MS * 2 ** noopStreak, STANDALONE_BACKOFF_CAP_MS);
  }

  // Empties the buffer — every field of it, which is why it is one function and not five
  // lines repeated at each place a burst stops being pending.
  function resetObserved() {
    observed.clear();
    observedCount = 0;
    seqLo = null;
    seqHi = null;
    firstObservedAt = 0;
  }

  function onBoardEvent(type, payload) {
    if (!standalone) {
      if (verbose) log(`board event ${type} dropped — not running with --standalone`);
      return;
    }
    const sinceTurn = Date.now() - lastTurnEndedAt;
    const inEchoWindow = !!lastTurnEndedAt && sinceTurn < STANDALONE_ECHO_WINDOW_MS;
    // The warm-up turn is read-only, so a change that lands while it runs is somebody
    // else's — labelling it "possibly your own write" would only teach the agent to
    // discount the very edits it just came up to work on.
    const guessOwn = (!!pending && !warmingUp) || draining || inEchoWindow;
    // Attribution beats the clock in both directions. `agent_id === ours` is this agent's own
    // write, certainly, whenever it comes back. Any *other* id — a person's user_id, another
    // agent's — is certainly not ours, which is the half the timer used to get wrong: a human
    // editing while this agent worked had their change written off as an echo of it.
    const writerAgent = payload?.agent_id || null;
    const writerUser = payload?.user_id || null;
    const origin =
      writerAgent && cfg.agentId && writerAgent === cfg.agentId
        ? 'own'
        : writerAgent || writerUser
          ? 'other'
          : guessOwn
            ? 'maybe'
            : 'other';
    const nodeId = payload?.node_id ?? '(board)';
    const entry = observed.get(nodeId) ?? { types: new Set(), count: 0, own: 0, other: 0, maybe: 0, person: 0 };
    entry.types.add(type);
    entry.count += 1;
    entry[origin] += 1;
    // A browser session id and no agent id: a human at the canvas.
    if (writerUser && !writerAgent) entry.person += 1;
    observed.set(nodeId, entry);
    observedCount += 1;
    if (!firstObservedAt) firstObservedAt = Date.now();
    const seq = Number(payload?.seq);
    if (Number.isFinite(seq)) {
      if (seqLo === null || seq < seqLo) seqLo = seq;
      if (seqHi === null || seq > seqHi) seqHi = seq;
    }
    const writtenBy =
      origin === 'own'
        ? ' — own write'
        : origin === 'maybe'
          ? ' — unattributed, maybe own write'
          : writerUser
            ? ' — by a person'
            : writerAgent
              ? ` — by agent ${writerAgent.slice(0, 8)}`
              : '';
    log(`board change: ${type} node=${nodeId}${Number.isFinite(seq) ? ` seq=${seq}` : ''}${writtenBy}`);
    armStandaloneTurn(nextDelayMs());
  }

  // Debounce, but never past MAX_WAIT from the first event of the burst, and never before
  // the echo window of the last turn has run out.
  function nextDelayMs() {
    const waitedSoFar = firstObservedAt ? Date.now() - firstObservedAt : 0;
    const debounce = Math.max(0, Math.min(STANDALONE_DEBOUNCE_MS, STANDALONE_MAX_WAIT_MS - waitedSoFar));
    const echoLeft = lastTurnEndedAt ? STANDALONE_ECHO_WINDOW_MS - (Date.now() - lastTurnEndedAt) : 0;
    return Math.max(debounce, echoLeft, 0);
  }

  function armStandaloneTurn(delayMs) {
    if (standaloneTimer) clearTimeout(standaloneTimer);
    standaloneTimer = setTimeout(() => {
      standaloneTimer = null;
      dispatchStandaloneTurn().catch((err) => log(`standalone dispatch error: ${err.message}`));
    }, delayMs);
  }

  // The changed-node list is a *pointer*, not the job: it says which corners of the board
  // someone just touched. The turn's actual task is for the agent to analyse all of them
  // against the model as a whole and then fan out — a subagent per piece of work that really
  // needs doing, running in parallel. Without that framing the agent treats the last event as
  // its work item and does one narrow thing (or nothing) even when the model needs something
  // else entirely, which is exactly what a burst of events on several nodes used to degrade
  // into.
  // The fan-out budget (`--max-agents`). A turn nobody asked for still costs money, so the
  // cap is stated in the turn itself — the `claude` process is what spawns the agents, and
  // the CLI has no way to count them from out here.
  const AGENT_BUDGET = localRunner
    ? 'You have no subagents and no skills here — the board tools are all you have. Do the single most ' +
      'valuable piece of work yourself, inline, in this turn, and leave the rest for a later turn.'
    : maxAgents > 1
      ? `Dispatch at most ${maxAgents} Agents in this turn (--max-agents=${maxAgents}). Merge pieces that share a slice or ` +
        'chain first — that is a correctness rule, not a way to fit the cap — and if more than that is still left, ' +
        'take the most valuable pieces up to the cap and leave the rest; a later turn will see them again. ' +
        `Dispatch each one with model: "${subagentModel}" (subagent_model), and with the credentials and the board ` +
        'state you already read handed over inline — an Agent told only which node to work on re-runs /connect and ' +
        're-fetches the whole board to learn what you already know, once per Agent.'
      : 'Do not dispatch any Agents in this turn (--max-agents=1) — that budget overrides the fan-out above: do ' +
        'the single most valuable piece of work yourself, inline, and leave the rest for a later turn.';

  // How a self-directed turn is meant to get the work done, which is the one genuinely
  // runner-shaped part of it: Claude fans out over subagents and reads the standalone playbook
  // from disk; a local model has neither, so it just works the board directly.
  const FAN_OUT = localRunner
    ? `get the most valuable piece of it done with the board tools in this turn. ${AGENT_BUDGET}`
    : 'work in parallel rather than serially — dispatch one Agent per piece of ' +
      'work that needs doing, all in a single message, merging pieces that share a slice or chain so no two ' +
      `agents write to the same area. ${AGENT_BUDGET} Read .agent-modeling-kit/CLAUDE-STANDALONE.md now (once ` +
      'per session — skip it if you already read it on an earlier self-directed turn) and follow it: it holds the ' +
      'steps for this kind of turn, and only this kind.';

  const STANDALONE_TASK =
    'Nobody asked you for this — you are working on this board in the background, on your own initiative. ' +
    'The change list above is a notification, not the task: it tells you where something just happened and ' +
    'which parts of the model to look at first. The task is to judge the model as a whole — each changed area ' +
    'in its context (its slice, its chain, the timeline around it), plus anything still obviously unfinished ' +
    'elsewhere — and then get the useful work done. Do not stop at the last event, and do not treat the ' +
    'nodeId list as the boundary of the work. Filling in detail behind a human who is still building is ' +
    'exactly what you are for: example data, specs (GWT/storyline), a missing attribute along a chain and ' +
    'empty screens are additive, cheap to undo and need no permission — a node placed a minute ago is the ' +
    'best target for them, not a reason to wait, and the board was already quiet before this turn was ' +
    'handed to you. Only board-wide sweeps and structural moves (renames, deletions, re-shaping, slice ' +
    'statuses) get a comment first instead of being done. An unanswered question you posted earlier parks ' +
    'that one sweep, never the fill-in work. Read what this turn needs and no more: every nodeId above in one ' +
    'get_nodes, plus one get_board_outline for each chapter they land in that you have not already read this ' +
    'session — a chapter you already hold is not fetched again, you carry it forward and apply this turn\'s ' +
    'changes to your copy. A full-meta read only on the nodes you conclude you will actually touch. ' +
    'You do the analysis: look at every entry above, decide what ' +
    `actually needs doing, and then ${FAN_OUT} If the model genuinely needs nothing right now, spawn ` +
    'nothing, change nothing and reply <promise>NOOP</promise>.';

  function buildStandaloneTurn() {
    const lines = [...observed.entries()].map(([nodeId, entry]) => {
      const origin =
        entry.own === entry.count
          ? ' — YOUR OWN earlier write, echoed back'
          : entry.own
            ? ` — ${entry.own} of ${entry.count} are YOUR OWN earlier writes, the rest are not`
            : entry.maybe === entry.count
              ? ' — unattributed, possibly your own earlier write'
              : '';
      return `- ${nodeId}: ${[...entry.types].join(', ')} (${entry.count}×)${origin}`;
    });
    const header = [
      'BOARD_CHANGE',
      `board_id=${cfg.boardId}`,
      `organization_id=${cfg.organizationId}`,
      seqLo !== null ? `seq=${seqLo}${seqHi !== seqLo ? `..${seqHi}` : ''}` : null,
      `events=${observedCount}`,
      `nodes=${observed.size}`,
    ].filter(Boolean).join(' ');
    return withSessionHeader(`${header}\nchanged:\n${lines.join('\n')}\n\n${STANDALONE_TASK}`);
  }

  // No events at all — the board has been sitting still. Same self-directed turn, with the
  // whole model as its subject instead of a changed corner of it.
  function buildIdleReviewTurn() {
    const header = [
      'BOARD_REVIEW',
      `board_id=${cfg.boardId}`,
      `organization_id=${cfg.organizationId}`,
      `idle_for=${Math.round(STANDALONE_IDLE_MS / 1000)}s`,
    ].join(' ');
    return withSessionHeader(
      `${header}\nchanged: nothing — the board has been quiet.\n\n` +
        'Nobody asked you for this and nothing changed: you are working on this board in the background, on ' +
        'your own initiative. Look over the model as a whole and decide what it still needs; then ' +
        `${FAN_OUT} ` +
        'If the model needs nothing, spawn nothing, change nothing and reply <promise>NOOP</promise>.',
    );
  }

  let idleTimer = null;
  function armIdleReview() {
    if (!standalone || !STANDALONE_IDLE_MS) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      // A buffer that filled meanwhile has its own timer — let that turn carry the work.
      if (observed.size || standaloneTimer || pending || draining) {
        armIdleReview();
        return;
      }
      dispatchStandaloneTurn({ idle: true }).catch((err) => log(`idle review dispatch error: ${err.message}`));
    }, STANDALONE_IDLE_MS);
  }

  async function dispatchStandaloneTurn({ idle = false } = {}) {
    if (!idle && !observed.size) return;
    // Every buffered event is provably this agent's own write coming back — attribution says
    // so, not a timer. There is nothing new on the board, so it costs no turn; if the board
    // then stays quiet the idle review still comes around.
    if (!idle && [...observed.values()].every((entry) => entry.own === entry.count)) {
      log(`standalone turn skipped: ${observedCount} board event(s) on ${observed.size} node(s), all own writes`);
      resetObserved();
      armIdleReview();
      return;
    }
    // A direct message always outranks the agent's own initiative — re-arm instead of
    // queueing behind the prompt lane, so the buffer just keeps collecting meanwhile.
    if (pending || draining) {
      if (idle) armIdleReview();
      else armStandaloneTurn(nextDelayMs());
      return;
    }
    // The floor is a runaway-loop guard, and a person is not a loop. Making a human wait out
    // MIN_INTERVAL before their edit is even looked at is most of the delay they feel, and it
    // guards nothing: the loop it exists to stop is this agent (or another one) reacting to a
    // write and writing again, which `person` excludes by construction.
    const byPerson = !idle && [...observed.values()].some((entry) => entry.person > 0);
    const waitLeft = minIntervalMs() - (Date.now() - lastStandaloneAt);
    if (lastStandaloneAt && waitLeft > 0 && !byPerson) {
      if (idle) armIdleReview();
      else armStandaloneTurn(waitLeft);
      return;
    }
    if (byPerson && lastStandaloneAt && waitLeft > 0) {
      log(`standalone floor skipped: a person edited the board (${Math.round(waitLeft / 1000)}s of min-interval left)`);
    }
    const text = idle ? buildIdleReviewTurn() : buildStandaloneTurn();
    if (idle) {
      log(`standalone review turn: board quiet for ${Math.round(STANDALONE_IDLE_MS / 1000)}s`);
    } else {
      const totals = [...observed.values()].reduce(
        (acc, entry) => ({ own: acc.own + entry.own, maybe: acc.maybe + entry.maybe }),
        { own: 0, maybe: 0 },
      );
      const breakdown = [
        totals.own ? `${totals.own} own` : null,
        totals.maybe ? `${totals.maybe} unattributed` : null,
      ].filter(Boolean);
      log(
        `standalone turn: ${observedCount} board event(s) on ${observed.size} node(s)` +
          `${breakdown.length ? ` (${breakdown.join(', ')})` : ''}`,
      );
    }
    resetObserved();
    lastStandaloneAt = Date.now();
    try {
      const result = await runTurn(text);
      // NOOP is the agent saying the board needs nothing — widen the floor so a finished
      // board isn't revisited at full rate. Any real contribution resets it.
      if (/NOOP/.test(String(result ?? ''))) {
        noopStreak += 1;
        log(`standalone turn: NOOP (${noopStreak} in a row — next no sooner than ${Math.round(minIntervalMs() / 1000)}s)`);
      } else {
        noopStreak = 0;
      }
    } catch (err) {
      log(`standalone turn failed: ${err.message}`);
    } finally {
      // Events that arrived while this turn ran are still in the buffer — give them a turn
      // of their own once the echo window has passed, instead of waiting for the next edit.
      if (observed.size) armStandaloneTurn(nextDelayMs());
      armIdleReview();
    }
  }

  armIdleReview();

  const channelName = `org:${cfg.organizationId}`;
  const realtime = await createRealtimeAdapter(cfg, realtimeToken);

  let lastTokenRefreshAt = 0;
  async function refreshRealtimeToken(reason) {
    // Guard against hammering the token endpoint: a rejected channel retries every
    // ~14s on its own, so without this a bad token would trigger a refresh call per retry.
    if (Date.now() - lastTokenRefreshAt < 5000) return;
    lastTokenRefreshAt = Date.now();
    try {
      realtimeToken = await getRealtimeToken();
      await realtime.setAuth(realtimeToken);
      log(`token refreshed (${reason})`);
    } catch (err) {
      log(`token refresh failed (${reason}): ${err.message}`);
    }
  }

  // A kill names exactly one agent: {type: 'kill', id: '<agentId>', instruction: 'exit'}. Anything
  // that doesn't name this agent is ignored — a broadcast reaches every agent on the board, and
  // the older signal (the bare string "Exit") took all of them down at once. That string form is
  // gone for good, not just unhandled: Supabase's broadcast API rejects a non-object payload with
  // 422, so it never actually arrived here.
  const exitIfAddressed = (payload) => {
    if (payload?.type !== 'kill' || payload?.id !== cfg.agentId) return;
    log(`received kill (instruction: ${payload.instruction ?? 'exit'}) — shutting down`);
    process.exit(0);
  };

  // The kill signal is broadcast on the BOARD channel (see the platform's agent-kill /
  // backoffice/killagent slices), not on the org channel this agent uses for prompts — without
  // this second subscription a modeling agent can only be stopped with a kill(1).
  realtime.subscribe(
    `board:${cfg.boardId}-slicechanged`,
    {message: exitIfAddressed},
    (status) => log(`channel "board:${cfg.boardId}-slicechanged": ${status}`),
  ).catch((err) => {
    log(`board channel subscribe failed, remote kill won't reach this agent: ${err.message}`);
  });

  realtime.subscribe(
    channelName,
    {
      message: exitIfAddressed,
      'prompt:created': () => {
        drain().catch((err) => log(`drain error: ${err.message}`));
      },
    },
    (status) => {
      log(`channel "${channelName}": ${status}`);
      if (status === 'SUBSCRIBED') drain().catch((err) => log(`initial drain error: ${err.message}`));
      // A bad/stale token otherwise sits in realtime-js's own rejoin-retry loop until the
      // next scheduled refresh below — up to 10 minutes of failed joins. Refresh immediately
      // instead of waiting on the clock.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        refreshRealtimeToken(status).catch(() => {});
      }
    },
  ).catch((err) => {
    log(`realtime subscribe failed, prompts won't be pushed live: ${err.message}`);
  });

  const boardChannelName = `board:${cfg.boardId}`;
  realtime.subscribe(
    boardChannelName,
    Object.fromEntries(BOARD_CHANGE_EVENTS.map((event) => [event, (payload) => onBoardEvent(event, payload)])),
    (status) => {
      log(`channel "${boardChannelName}": ${status}${standalone ? '' : ' (events dropped — no --standalone)'}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        refreshRealtimeToken(status).catch(() => {});
      }
    },
  ).catch((err) => {
    log(`board subscribe failed, board changes won't be seen live: ${err.message}`);
  });

  setInterval(() => {
    refreshRealtimeToken('scheduled').catch(() => {});
  }, 10 * 60 * 1000);

  const ping = async () => {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/agent-alive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${realtimeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cfg.token, board_id: cfg.boardId, agent_type: 'MODELING', agent_id: cfg.agentId, ...(cfg.agentName ? { agent_name: cfg.agentName } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log(`ping failed: ${res.status} ${await res.text().catch(() => '')}`);
    } catch (err) {
      log(`ping error: ${err.message}`);
    }
  };
  await ping();
  setInterval(ping, 15_000);
}

const program = new Command();

program
  .name('eventmodelers')
  .description('Eventmodelers CLI — real-time Claude agent + skills for Claude Code, for any stack')
  .version('1.0.0')
  .option('--config <path>', 'Path to an explicit config.json, overriding directory-based resolution (individual fields can also be set via EVENTMODELERS_* env vars, which always win)')
  .option('--print', 'Print follow-up commands (e.g. claude mcp add) instead of prompting to run them');

// Commands exempt from the "is a kit installed here?" gate below: init (with or
// without --modeling) is what installs one in the first place, init-config only
// ever touches credentials, stacks/status/config/uninstall are read-only or
// cleanup commands that are meant to work — and report something useful — whether
// or not a kit is present, and fetch only needs credentials plus somewhere to write
// .slices/ (cwd, absent a kit dir — see lib/fetch.js), no kit-specific files.
// activate-context/set-slice-status are the same story minus even the credentials — they
// only ever read/write an already-fetched .slices/, and report their own hint (run `fetch`
// first) when that's missing. set-slice-status only touches credentials at all for --remote,
// which prompts for them itself the same way fetch does. release-notes only reads the CLI's
// own bundled RELEASE_NOTES.md, no project state involved at all. run resolves its own kit
// dir: a modeling run falls back to the global install (see ensureGlobalKit) rather than
// requiring one here, and the build-kit branch reports a better-targeted error of its own
// than this generic gate can.
const NO_INIT_REQUIRED = new Set(['init', 'init-config', 'stacks', 'status', 'config', 'uninstall', 'fetch', 'activate-context', 'set-slice-status', 'release-notes', 'run']);

program.hook('preAction', (_thisCommand, actionCommand) => {
  if (NO_INIT_REQUIRED.has(actionCommand.name())) return;
  if (findInstalledKitDir(process.cwd())) return;

  console.error(`❌ No eventmodelers kit installed in this directory (checked: ${KIT_DIR_NAMES.join(', ')}).`);
  console.error('   Run one of these first:');
  console.error(`     npx @eventmodelers/cli init --stack <name>   (${Object.keys(STACKS).join(', ')})`);
  console.error('     npx @eventmodelers/cli init --modeling');
  console.error(`     npx @eventmodelers/cli init --bridge --target <name>   (${Object.keys(BRIDGE_TARGETS).join(', ')})`);
  process.exit(1);
});

// Shared by init/init-config: direct command-line credentials,
// Protractor-style (--base-url=..., not a generic --param key=value passthrough) —
// self-documenting in --help and typo-safe. These win over both the config file
// and EVENTMODELERS_* env vars, same as any explicitly-passed flag should.
function credentialFlags(cmd) {
  return cmd
    .option('--token <uuid>', 'API token (overrides config file / env var)')
    .option('--board-id <uuid>', 'Board ID (overrides config file / env var)')
    .option('--organization-id <uuid>', 'Organization ID (overrides config file / env var)')
    .option('--base-url <url>', 'Platform base URL (overrides config file / env var)');
}

function credentialOverridesFromOpts(opts) {
  return { token: opts.token, boardId: opts.boardId, organizationId: opts.organizationId, baseUrl: opts.baseUrl };
}

// `--name` is not a credential — it's the display name of the agent a kit runs, sent with
// every heartbeat (POST /api/agent-alive's agent_name) so the board can show which agent is
// live instead of a bare uuid. It belongs beside the credentials in config.json rather than
// on every command line, so `init`/`re-init`/`init-config` persist it as `agentName` and
// every later run of that kit's agent picks it up from the config walk (both runtimes merge
// unknown config fields through verbatim). `run --name` is the per-run override on top, and
// writes nothing.
const AGENT_NAME_OPTION = [
  '--name <name>',
  'Human-readable name for the agent this kit runs (e.g. "ci-builder", "martins-laptop"), saved to config.json as `agentName` and sent with every heartbeat so the board shows a name instead of a bare uuid. Also settable via EVENTMODELERS_AGENT_NAME, and overridable for a single run with `run --name`.',
];

function identityOverridesFromOpts(opts) {
  const agentName = typeof opts.name === 'string' ? opts.name.trim() : undefined;
  return agentName ? { agentName } : {};
}

credentialFlags(program
  .command('init')
  .alias('install')
  .description('Scaffold a stack + install the agent kit into the current directory (or --modeling for skills + agent loop only, no backend scaffold; or --bridge to translate board slices into another spec framework; or --build-kit for a blank build-kit scaffold to fill in for a stack not built into this CLI yet; or --git to install a community/custom build kit from a git repo)')
  .option('--stack <name>', `Stack to install (${Object.keys(STACKS).join(', ')}), or a name of your choosing when combined with --git`)
  .option('--git <url>', 'Install a build kit not built into this CLI by cloning this git repo (used with --stack <name> to name it) — the repo must mirror the templates/.claude, templates/root, templates/<kitSubdir> layout of this CLI\'s own stacks/<name>/templates, optionally with a stack.json declaring label/kitSubdir/useShared/needsBoardId')
  .option('--branch <name>', 'Branch to clone — only meaningful with --git (defaults to the repo\'s default branch)')
  .option('--modeling', 'Install skills + the agent loop only — no backend scaffold. Mutually exclusive with --stack/--bridge/--build-kit.')
  .option('--bridge', 'Install a bridge kit — translates board slices into another spec framework instead of building code. Mutually exclusive with --stack/--modeling/--build-kit. Requires --target.')
  .option('--target <name>', `Bridge target framework (${Object.keys(BRIDGE_TARGETS).join(', ')}) — only meaningful with --bridge`)
  .option('--hook <command>', 'Persist a default shell command hook for `bridge` to run per batch of slice changes instead of Claude/Ollama (e.g. commit + push .slices/ for a CI pipeline to pick up) — only meaningful with --bridge. Can also be set per-run with `bridge --hook`.')
  .option('--build-kit', 'Install a blank build-kit scaffold (.build-kit/ + .claude/skills/build-*/SKILL.md placeholders, all TODO-marked) for a stack not built into this CLI yet — no fixed backend. Mutually exclusive with --stack/--modeling/--bridge.')
  .option('--hooks', 'Install the slice commit-scope guard (.githooks/pre-commit, running .build-kit/lib/check-commit-scope.cjs) and wire it up via `git config core.hooksPath .githooks` — only meaningful with --stack (build-kit stacks). Off by default.')
  .option('--demo', 'Install a ready-made demo model into the kit\'s .slices/ — the "Understanding Eventsourcing" context (16 shopping-cart slices covering every slice type), in exactly the shape `fetch` writes, so the build skills and the agent loop have something real to work on before this project is connected to a board. Skipped if .slices/ already holds fetched slices. Off by default.')
  .option('--global', 'Install skills into ~/.claude/skills/ instead of the project — available in every project')
  .option('-f, --force', 'Re-prompt for credentials even if a config already has everything required — overwrites the existing config.json')
  .option(...AGENT_NAME_OPTION))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();

    if (opts.modeling || opts.bridge || opts.buildKit) {
      const modeCount = [opts.modeling, opts.bridge, opts.buildKit].filter(Boolean).length;
      if (opts.stack || opts.git || modeCount > 1) {
        console.error('❌ --stack/--git, --modeling, --bridge, and --build-kit are mutually exclusive — pick one.');
        process.exit(1);
      }
    }

    if (opts.modeling) {
      await installStack(MODELING_KIT.key, MODELING_KIT, {
        configPath: globalOpts.config,
        print: globalOpts.print,
        global: opts.global,
        force: opts.force,
        credentialOverrides: { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) },
        demo: opts.demo,
      });
      return;
    }

    if (opts.buildKit) {
      await installStack(BLANK_BUILD_KIT.key, BLANK_BUILD_KIT, {
        configPath: globalOpts.config,
        print: globalOpts.print,
        global: opts.global,
        force: opts.force,
        credentialOverrides: { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) },
        demo: opts.demo,
      });
      return;
    }

    if (opts.bridge) {
      if (!opts.target) {
        console.error(`❌ --bridge requires --target (${Object.keys(BRIDGE_TARGETS).join(', ')}).`);
        process.exit(1);
      }
      if (!BRIDGE_TARGETS[opts.target]) {
        console.error(`❌ Unknown bridge target "${opts.target}". Available: ${Object.keys(BRIDGE_TARGETS).join(', ')}`);
        process.exit(1);
      }
      await installStack(BRIDGE_KIT.key, BRIDGE_KIT, {
        configPath: globalOpts.config,
        print: globalOpts.print,
        global: opts.global,
        force: opts.force,
        credentialOverrides: { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) },
        demo: opts.demo,
        target: opts.target,
      });
      // Deliberately NOT under .bridge-kit/.eventmodelers/ — that whole name is
      // gitignored (a bare `.eventmodelers` pattern matches at any depth, since
      // it protects the root credentials file), so anything written there is
      // per-machine only. target/hookCommand are project policy — how this repo
      // reacts to board changes — meant to be committed and shared by every
      // teammate and CI runner, so they live in a plain sibling file instead.
      const bridgeConfigPath = join(process.cwd(), BRIDGE_KIT.kitDirName, 'bridge.json');
      const existingBridgeCfg = readJsonSafe(bridgeConfigPath);
      mkdirSync(dirname(bridgeConfigPath), { recursive: true });
      writeFileSync(bridgeConfigPath, JSON.stringify({ ...existingBridgeCfg, target: opts.target, ...(opts.hook ? { hookCommand: opts.hook } : {}) }, null, 2));
      console.log(`  ✓ Bridge target set to "${opts.target}"${opts.hook ? ` with hook: ${opts.hook}` : ''}`);
      return;
    }

    if (opts.branch && !opts.git) {
      console.error('❌ --branch only applies to --git — nothing to clone without it.');
      process.exit(1);
    }

    if (opts.git) {
      if (!opts.stack) {
        console.error('❌ --git requires --stack <name> to name the installed stack.');
        process.exit(1);
      }
      if (STACKS[opts.stack]) {
        console.error(`❌ "${opts.stack}" is already a built-in stack (${Object.keys(STACKS).join(', ')}) — --git is only for installing a stack that isn't built in.`);
        process.exit(1);
      }
      const clonedDir = cloneGitStack(opts.git, opts.branch);
      const stackCfg = resolveGitStackConfig(clonedDir, opts.stack);
      await installStack(opts.stack, stackCfg, {
        configPath: globalOpts.config,
        print: globalOpts.print,
        global: opts.global,
        force: opts.force,
        credentialOverrides: { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) },
        demo: opts.demo,
        templatesSource: join(clonedDir, 'templates'),
        hooks: opts.hooks,
      });
      return;
    }

    const stackKey = await resolveStack(opts.stack);
    await installStack(stackKey, STACKS[stackKey], {
      configPath: globalOpts.config,
      print: globalOpts.print,
      global: opts.global,
      force: opts.force,
      credentialOverrides: { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) },
        demo: opts.demo,
      hooks: opts.hooks,
    });
  });

// Every kit config `re-init` can refresh, keyed the same way install-manifest.json's
// `stack` field is — looked up after reading that manifest so re-init knows exactly
// which templates to re-copy without the user having to pass --stack again.
const REINITIABLE_STACKS = { ...STACKS, [MODELING_KIT.key]: MODELING_KIT, [BLANK_BUILD_KIT.key]: BLANK_BUILD_KIT };

credentialFlags(program
  .command('re-init')
  .description('Refresh an already-installed kit from the current CLI version — re-copies skills and the kit dir (.build-kit or .agent-modeling-kit) so you pick up script/skill updates after upgrading. Unlike `init`, never touches the project root scaffold or the root CLAUDE.md router, and leaves existing credentials alone unless --force is passed.')
  .option('--modeling', 'Refresh the modeling kit (.agent-modeling-kit) instead of a build kit')
  .option('--stack <name>', `Override which stack to refresh from (${Object.keys(REINITIABLE_STACKS).join(', ')}) instead of the one recorded in install-manifest.json — use this when the manifest is missing/stale, or to switch a .build-kit install to a different stack`)
  .option('--hooks', 'Install the slice commit-scope guard (.githooks/pre-commit) and wire it up via `git config core.hooksPath .githooks` — same as `init --hooks`, for turning it on after the fact without a full re-scaffold. Off by default.')
  .option('--global', 'Re-install skills into ~/.claude/skills/ instead of the project — defaults to however they were originally installed')
  .option('-f, --force', 'Re-prompt for credentials even if a config already has everything required — overwrites the existing config.json')
  .option(...AGENT_NAME_OPTION))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    const targetDir = process.cwd();

    if (opts.modeling && opts.stack) {
      console.error('❌ --modeling and --stack are mutually exclusive — pick one.');
      process.exit(1);
    }

    if (opts.stack && !REINITIABLE_STACKS[opts.stack]) {
      console.error(`❌ Unknown stack "${opts.stack}". Available: ${Object.keys(REINITIABLE_STACKS).join(', ')}`);
      process.exit(1);
    }

    const kitDirName = opts.modeling ? MODELING_KIT.kitDirName : STACKS.node.kitDirName;
    const kitDir = join(targetDir, kitDirName);

    if (!existsSync(kitDir)) {
      console.error(`❌ No ${kitDirName}/ found in ${targetDir} — run \`init${opts.modeling ? ' --modeling' : ''}\` first.`);
      process.exit(1);
    }

    const manifest = readJsonSafe(join(kitDir, '.eventmodelers', 'install-manifest.json'));
    const stackKey = opts.modeling ? MODELING_KIT.key : (opts.stack || manifest.stack);
    const stackCfg = stackKey ? REINITIABLE_STACKS[stackKey] : null;

    if (!stackCfg) {
      console.error(`❌ Can't tell which stack ${relative(targetDir, kitDir)} was installed from (${manifest.stack ? `"${manifest.stack}" isn't one re-init recognizes — likely a --git community stack` : 'its install manifest predates this tracking, or is missing'}).`);
      console.error('   Pass --stack <name> explicitly, or re-run the original `init --git <url> --stack <name>` command by hand instead.');
      process.exit(1);
    }

    await installStack(stackKey, stackCfg, {
      configPath: globalOpts.config,
      print: globalOpts.print,
      global: opts.global !== undefined ? opts.global : !!manifest.global,
      force: opts.force,
      credentialOverrides: { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) },
      skipRootScaffold: true,
      hooks: opts.hooks,
    });
  });

program
  .command('init-mcp')
  .description('Register the eventmodelers MCP server in .claude/settings.json (and optionally another harness)')
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    await configureMcp({ configPath: globalOpts.config, print: globalOpts.print });
  });

program
  .command('init-agents')
  .description(`Expose installed skills to other AI agent hosts (${Object.keys(AGENT_HOSTS).join(', ')}) as thin stub commands pointing at the canonical .claude/skills/ files — no skill content duplicated per host`)
  .option('--hosts <list>', `Comma-separated host keys (${Object.keys(AGENT_HOSTS).join(', ')}; aliases: ${Object.keys(AGENT_HOST_ALIASES).join(', ')})`)
  .option('--all', 'Expose to every known host')
  .option('--global', 'Read skills from ~/.claude/skills/ instead of the project')
  .action(async (opts) => {
    const hosts = opts.all
      ? Object.keys(AGENT_HOSTS)
      : opts.hosts
        ? opts.hosts.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
    await configureAgentHosts({ hosts, global: opts.global });
  });

program
  .command('init-hooks')
  .description('Install/refresh the slice commit-scope guard (.githooks/pre-commit) and set `git config core.hooksPath .githooks` — same as `init --hooks`/`re-init --hooks`, for installing the latest hooks or re-pointing git config at them without a full re-scaffold')
  .option('--stack <name>', `Which stack's .githooks/ template to install (${Object.keys(STACKS).join(', ')}) — defaults to whichever stack is recorded in install-manifest.json`)
  .action(async (opts) => {
    const targetDir = process.cwd();

    let stackKey = opts.stack;
    if (stackKey && !STACKS[stackKey]) {
      console.error(`❌ Unknown stack "${stackKey}". Available: ${Object.keys(STACKS).join(', ')}`);
      process.exit(1);
    }
    if (!stackKey) {
      for (const name of KIT_DIR_NAMES) {
        const manifest = readJsonSafe(join(targetDir, name, '.eventmodelers', 'install-manifest.json'));
        if (manifest.stack && STACKS[manifest.stack]) {
          stackKey = manifest.stack;
          break;
        }
      }
    }
    if (!stackKey) {
      console.error(`❌ Can't tell which stack's .githooks/ template to install — pass --stack <name> (${Object.keys(STACKS).join(', ')}), or run \`init\`/\`re-init\` for one of those stacks first.`);
      process.exit(1);
    }

    const hooksSrc = join(__dirname, 'stacks', stackKey, 'templates', 'root', '.githooks');
    if (!existsSync(hooksSrc)) {
      console.error(`❌ "${stackKey}" ships no .githooks/ template — nothing to install.`);
      process.exit(1);
    }

    console.log('🪝 Configuring git hooks...');
    configureHooks({ hooksSrc, targetDir });
  });

program
  .command('disable-hooks')
  .description('Turn off the slice commit-scope guard by unsetting `git config core.hooksPath` — leaves .githooks/ on disk untouched; run `init-hooks` again any time to re-enable')
  .action(() => {
    const targetDir = process.cwd();

    try {
      execSync('git rev-parse --git-dir', { cwd: targetDir, stdio: 'ignore' });
    } catch {
      console.error(`❌ ${targetDir} is not a git repository — nothing to unset.`);
      process.exit(1);
    }

    let currentHooksPath = null;
    try {
      currentHooksPath = execSync('git config --get core.hooksPath', { cwd: targetDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      // core.hooksPath isn't set — nothing to do
    }

    if (!currentHooksPath) {
      console.log('  ℹ️  core.hooksPath is not set — the guard is already off, nothing to do.');
      return;
    }

    execSync('git config --unset core.hooksPath', { cwd: targetDir });
    console.log(`  ✓ Unset core.hooksPath (was "${currentHooksPath}") — the commit-scope guard is now off. Run \`init-hooks\` again to turn it back on.`);
  });

program
  .command('run-checks')
  .alias('run:checks')
  .description("Run this project's commit-scope checks (.build-kit/lib/check-commit-scope.cjs, the same runner .githooks/pre-commit calls) against the currently staged changeset. Works for any build-kit stack — stacks/installs that ship no checks yet report that and exit 0, so this is safe to call unconditionally (e.g. from an agent loop) without checking the stack first.")
  .action(() => {
    const cwd = process.cwd();
    // Mirrors `run`'s buildKitDir resolution: modeling-kit/bridge-kit installs share
    // KIT_DIR_NAMES but never ship check-commit-scope.cjs, so prefer whichever
    // installed dir isn't one of those over blindly taking the first match.
    const installedKitDirs = findAllInstalledKitDirs(cwd);
    const modelingKitDir = installedKitDirs.find((d) => d.endsWith(MODELING_KIT.kitDirName)) ?? null;
    const bridgeKitDir = installedKitDirs.find((d) => d.endsWith(BRIDGE_KIT.kitDirName)) ?? null;
    const kitDir = installedKitDirs.find((d) => d !== modelingKitDir && d !== bridgeKitDir) ?? installedKitDirs[0];

    const checkScript = join(kitDir, 'lib', 'check-commit-scope.cjs');
    if (!existsSync(checkScript)) {
      console.log(`ℹ️  ${relative(cwd, kitDir)} ships no checks yet — nothing to run.`);
      return;
    }

    console.log(`🔎 Running checks from ${relative(cwd, checkScript)}...`);
    try {
      // cwd must be the project root (not kitDir/.build-kit) — the script's
      // `git diff --relative` scopes its output to cwd's subtree, so running
      // it from inside .build-kit/ makes every changed file outside .build-kit/
      // (i.e. everything under src/) invisible, and the check silently no-ops.
      execSync(`node "${checkScript}"`, { cwd, stdio: 'inherit' });
    } catch (err) {
      process.exit(err.status || 1);
    }
  });

credentialFlags(program
  .command('init-config')
  .description('Configure credentials only — writes .eventmodelers/config.json in the current directory, or ~/.eventmodelers/config.json with --global')
  .option('--global', 'Write account-wide defaults (organizationId + token only) to ~/.eventmodelers/config.json instead of the project')
  .option('--credentials <values>', 'Credentials as the comma-separated blob from app.eventmodelers.ai/account (token=...,boardId=...,organizationId=...,baseUrl=...), the equivalent JSON, or - to read either from stdin. When the blob names a board it configures THAT board (~/.eventmodelers/boards/<board>.json), which is all a later run --standalone --board-id <uuid> then needs.')
  .option(...AGENT_NAME_OPTION))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    const overrides = { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) };

    // A blob naming a board configures that board's own file rather than a project or
    // account-wide config: the per-board store is keyed by board id, and the blob is
    // carrying one. --global still means account-wide identity only, and without
    // --credentials nothing here changes, so no existing invocation behaves differently.
    if (opts.credentials && !opts.global) {
      const parsed = {
        ...parseCredentialsArg(opts.credentials),
        ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v)),
      };
      if (!parsed.boardId) {
        console.error('❌ --credentials names no board — add boardId=<uuid> to it, or pass --board-id, so we know which board this configures.');
        console.error('   (For account-wide identity with no board, use --global.)');
        process.exit(1);
      }
      if (!parsed.baseUrl) parsed.baseUrl = DEFAULT_BASE_URL;
      writeBoardCredentials(parsed);
      console.log('\n  ✓ Saved credentials for board ' + parsed.boardId + ' to ' + boardCredentialsPath(parsed.boardId));
      console.log('\n  Start the agent from anywhere with:\n');
      console.log('    npx @eventmodelers/cli run --standalone --board-id ' + parsed.boardId + '\n');
      return;
    }

    if (opts.global) {
      // Deliberately narrower than a project config: a board is specific to one
      // project, and baseUrl already has its own runtime default, so the only
      // things worth defaulting across every project are your identity (org)
      // and how you authenticate (token).
      const configPath = join(homedir(), '.eventmodelers', 'config.json');
      const requiredFields = ['organizationId', 'token'];
      const existing = readJsonSafe(configPath);
      const pasted = opts.credentials ? parseCredentialsArg(opts.credentials) : {};
      const base = { organizationId: existing.organizationId, token: existing.token };
      // Any boardId/baseUrl in the blob is dropped here, exactly as the interactive paste
      // flow's own result is below — --global persists identity and nothing else.
      if (pasted.organizationId) base.organizationId = pasted.organizationId;
      if (pasted.token) base.token = pasted.token;
      if (overrides.organizationId) base.organizationId = overrides.organizationId;
      if (overrides.token) base.token = overrides.token;
      // Carried through the same narrowing: this branch rebuilds the file from scratch, so
      // an already-configured agentName has to be read back in or a later `init-config
      // --global` (e.g. rotating the token) would silently drop it.
      if (existing.agentName) base.agentName = existing.agentName;
      if (overrides.agentName) base.agentName = overrides.agentName;

      const configured = await configureCredentials({
        config: base,
        configPath,
        targetDir: homedir(),
        requiredFields,
        boardIdOptional: true,
        overrides: {},
        print: globalOpts.print,
        skipGitignore: true,
        // A bare "init-config --global" means "re-ask me", so it forces the prompt even
        // when the config is already complete. Supplying --credentials (or --token /
        // --organization-id) is the opposite instruction: the answer is right there on the
        // command line, and prompting for it anyway would hang any non-interactive caller.
        force: !(base.organizationId && base.token),
      });

      // configureCredentials' generic paste/manual flow may have picked up
      // boardId/baseUrl too (e.g. from a pasted JSON blob) — strip them back out
      // before the final write, since --global only ever persists identity.
      // --name is the one non-credential that belongs here: it names the agent, not the
      // project, so an account-wide default is as portable as the org/token beside it.
      writeFileSync(configPath, JSON.stringify({ organizationId: configured.organizationId, token: configured.token, ...(configured.agentName ? { agentName: configured.agentName } : {}) }, null, 2));
      console.log(`\n  ✓ Saved account-wide defaults to ${configPath}`);
    } else {
      const targetDir = process.cwd();
      const configPath = globalOpts.config
        ? resolve(targetDir, globalOpts.config)
        : join(targetDir, '.eventmodelers', 'config.json');
      const effective = loadEffectiveConfig(targetDir, null, globalOpts.config);
      const cfg = await configureCredentials({
        config: effective.config,
        configPath,
        targetDir,
        requiredFields: ['organizationId', 'token'],
        boardIdOptional: true,
        overrides,
        print: globalOpts.print,
        // Same reasoning as the --global branch above: a bare `init-config` means "re-ask
        // me", but an invocation that already carries its answers on the command line —
        // credentials, or just a --name to record — must not stop to prompt, or every
        // non-interactive caller hangs (a closed stdin crashes outright).
        force: !Object.values(overrides).some(Boolean),
      });

      // Keep `.mcp.json` in sync — this command can change `baseUrl` (e.g.
      // switching a project from prod to beta) independently of `init`, and a
      // stale MCP registration pointing at the wrong host is worse than none
      // (see the beta-api protected-resource-metadata incident this fixed).
      ensureMcpRegistered(targetDir, cfg.baseUrl || DEFAULT_BASE_URL);
      ensureEnvToken(targetDir, cfg.token);
    }
  });

credentialFlags(program
  .command('run')
  .description('Start the agent loop from the installed kit dir — build-kit stacks: ralph-claude.js (default); modeling-kit: --modeling, or --standalone, which needs no install at all')
  .option('--local-ai [target]', `Drive the loop with a local (or self-hosted) model instead of the default Claude runner: a build kit runs it via ralph-local-ai.js, and --modeling/--standalone via lib/modeling-local-ai.js (board tools over MCP, but no skills and no subagent fan-out — those are Claude Code features). Optional target preset picks the URL and wire dialect: ${LOCAL_AI_TARGETS.join(', ')} — bare --local-ai means ollama. Anything OpenAI-compatible (vLLM, LM Studio, llama.cpp, TGI) works by pointing LOCAL_AI_URL at it; see LOCAL_AI_* in the docs. Claude remains the default when this flag is absent.`)
  .option('--exec [command]', 'Hand each prompt to an external agent command instead of the default Claude runner, via ralph-exec.js (build-kit stacks only) — for agentic harnesses that bring their own tool loop, e.g. "codex exec --full-auto" or "opencode run". The prompt is appended as a quoted argument and also written to the file named by RALPH_PROMPT_FILE. Bare --exec uses localAi.exec from .eventmodelers/config.json. Claude remains the default when this flag is absent.')
  .option('--bash', 'Use the bash-only ralph.sh loop (build-kit stacks only, no realtime)')
  .option('--modeling', 'Keep one Claude process warm across prompts instead of spawning a fresh one per task, for low-latency voice/live use. Runs from a modeling-kit install in this directory, or from the global install (~/.eventmodelers/kit) when there is none. Built into the CLI, not a per-project file.')
  .option('--non-interactive', 'Never ask anything: take the board and credentials that resolve from flags, EVENTMODELERS_* env vars and the config files, and fail with the reason if they are incomplete instead of interviewing for them. A TTY was previously the only signal — right for CI or a supervisor, wrong for a loop started from a terminal, where stdin is a TTY nobody is watching and the run stops on a question. Only affects the modeling loop (--modeling/--standalone/--global).')
  .option('--standalone', 'Let the modeling agent work the board in the background, on its own initiative: on top of direct prompts it subscribes to the board\'s change channel (like the build agents do) and, whenever the board goes quiet after an edit — or has simply been idle for a while — it takes a turn nobody asked for. Changed nodes are a notification, not the task: it judges the model as a whole and fans the work out over parallel subagents, one per changed area (examples on a new node, specs for a new command or read model, a missing attribute along a chain, a screen, a question comment). Filling that detail in while the human keeps modeling is the point — it does not wait for the board to be finished. Implies --modeling.')
  .option('--max-agents <n>', 'Cap how many subagents a self-directed --standalone turn may dispatch at once, to bound what an unattended agent can spend per turn. The agent merges work that shares a slice or chain first, then takes the most valuable pieces up to this many and leaves the rest for a later turn. 1 makes it do the single most valuable piece itself, without spawning anything. Default 5. Ignored without --standalone — prompt turns are one piece of work by definition.', '5')
  .option('--exclusive', 'Work only the prompts addressed to this agent\'s id — the board\'s "preferred agent" (the star in the prompts panel) — and hand every untargeted prompt straight back to the queue for another agent to take. Without it an agent also works everything nobody addressed to anyone, which is what you want for a single agent and exactly what you do not want for a dedicated one (a board with a general agent plus a specialist, or an agent a supervisor drives by id). Pair it with --id so the same agent is addressable across restarts — --global/--standalone otherwise mint a fresh id per run, and prompts addressed to the previous run\'s id are never claimed. Leaves --standalone alone: a self-directed turn is nobody\'s prompt, so an exclusive standalone agent still works the board on its own initiative.')
  .option('--global', 'Run the modeling agent from the global install (~/.eventmodelers/kit), initializing it on first use, and ignore any kit in this directory. This is also what --modeling/--standalone fall back to on their own when nothing is installed here — pass it explicitly to prefer the global install over a local one. Credentials come from the flags below, EVENTMODELERS_* env vars, or ~/.eventmodelers/boards/<board>.json, so nothing is written into the current directory.')
  .option('--local', 'Skip platform config/credential lookup entirely and run the local-only loop (no board sync, no realtime agent) — even if .eventmodelers/config.json has credentials (build-kit stacks only)')
  .option('--verbose', 'Log every tool call\'s full input (commands, skill args, file paths) and assistant reasoning text. Default is condensed, high-level per-step logging only.')
  .option('--id <id>', 'Pin the agent id this run identifies itself with on the platform. A project install otherwise mints one id per project and reuses it on every restart; --global/--standalone mints a fresh one per run, since two ad-hoc agents for one board must not share a row (the heartbeat is keyed on token + agent_id + agent_type, so the second would replace the first). Pass this when an agent has to keep ONE identity across restarts — a supervisor that already knows the id, or a board where it is the starred "preferred agent". Per-run only: nothing is written to disk.')
  .option('--name <name>', 'A human-readable name for this agent, sent with every heartbeat so the board shows which agent is live rather than a bare uuid (e.g. "ci-builder", "martins-laptop"). Per-run only, like --id: the persistent name is `agentName` in config.json (set via `init --name` / `init-config --name`), and this overrides it for one run without writing anything.')
  .option('--credentials <values>', 'Credentials as the comma-separated blob from app.eventmodelers.ai/account (token=...,boardId=...,organizationId=...,baseUrl=...), the equivalent JSON, or - to read either from stdin. Saved to ~/.eventmodelers/boards/<board>.json, so it is only needed once per board, and passing it skips the first-run question. The individual flags below override single fields of it.'))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    const cwd = process.cwd();
    // Validated up front, before any runner is selected: a cost guard given as garbage
    // should fail on the spot, not once the loop is already up — and a cap passed where
    // nothing will read it is worth saying out loud rather than ignoring silently.
    const maxAgents = parseMaxAgents(opts.maxAgents);
    if (command.getOptionValueSource('maxAgents') === 'cli' && !opts.standalone) {
      console.log('ℹ️  --max-agents only applies to --standalone turns; ignoring it here.');
    }
    // The build-kit runners claim their work from the same queue but have no addressee
    // filter, so the flag would silently do nothing there rather than half of what it says.
    if (opts.exclusive && !(opts.modeling || opts.standalone || opts.global)) {
      console.log('ℹ️  --exclusive only applies to the modeling loop (--modeling/--standalone/--global); ignoring it here.');
    }
    // --id/--name are what the platform will see for this run, so a blank one is a
    // mistake worth failing on rather than silently falling back to the stored identity.
    const identity = {
      agentId: opts.id === undefined ? null : String(opts.id).trim(),
      agentName: opts.name === undefined ? null : String(opts.name).trim(),
    };
    for (const [flag, value] of [['--id', identity.agentId], ['--name', identity.agentName]]) {
      if (value === '') {
        console.error(`❌ ${flag} needs a non-empty value.`);
        process.exit(1);
      }
    }
    // ralph.sh has no realtime agent and never pings /api/agent-alive, so there is no
    // identity for either flag to override there.
    if ((identity.agentId || identity.agentName) && opts.bash) {
      console.log('ℹ️  --id/--name only apply to agents that ping the platform; the --bash loop does not, so they are ignored here.');
    }
    // Both kit dirs can be installed side by side (e.g. running a build-kit and a
    // modeling-kit agent from the same project). findInstalledKitDir only ever
    // returns its first fixed-order match, which would silently prefer one stack
    // over the other regardless of which the caller actually asked for — so here
    // we resolve each stack's dir independently instead of relying on that order.
    const installedKitDirs = findAllInstalledKitDirs(cwd);
    const modelingKitDir = installedKitDirs.find((d) => d.endsWith(MODELING_KIT.kitDirName)) ?? null;
    const bridgeKitDir = installedKitDirs.find((d) => d.endsWith(BRIDGE_KIT.kitDirName)) ?? null;
    // A bridge kit is not a build-kit stand-in even though it also reuses
    // lib/ralph.js — it has its own `eventmodelers bridge` entrypoint (no
    // onPlannedSlice/--local-ai/--bash support), so it's excluded here rather
    // than falling through to the generic build-kit runner below.
    const buildKitDir = installedKitDirs.find((d) => d !== modelingKitDir && d !== bridgeKitDir) ?? null;

    // No overlap between the two stacks' runtimes: modeling-kit only ever runs the
    // warm, direct-dispatch loop (--modeling); build-kit only ever runs the
    // cold-spawn/tasks.json loop (default, or --local-ai/--bash). Neither falls back
    // to the other's mechanism, so each side is gated explicitly below rather than
    // just being left to fail on a missing file.
    // --standalone implies --modeling: it already refused every other runner, so there
    // was never a second thing it could have selected, and requiring both flags only made
    // the shorter, more obvious command fail. --global picks the modeling loop too — it has
    // no meaning for a build kit, which is scaffolded per project by definition.
    if (opts.modeling || opts.standalone || opts.global) {
      const picked = opts.modeling ? '--modeling' : opts.standalone ? '--standalone' : '--global';
      // --bash/--exec stay build-kit only: they drive the cold-spawn tasks.json loop, which the
      // modeling loop has no equivalent of. --local-ai is different — it names a *model*, not a
      // queue, and the modeling loop has its own runner for one (lib/modeling-local-ai.js).
      if (opts.bash || opts.exec) {
        console.error(`❌ ${picked} is mutually exclusive with --bash/--exec — those select a build-kit runner, which the modeling loop has no use for.`);
        process.exit(1);
      }
      const modelingLocalAi = resolveLocalAiTarget(opts);
      if (opts.local) {
        console.error(`❌ ${picked} has no local-only mode — it is always driven by the org-wide realtime prompt queue, so --local has no use for it.`);
        process.exit(1);
      }

      // A kit in this directory wins unless --global explicitly asks for the other one.
      // Otherwise: the global install, initialized on first use, driven by this run's own
      // credentials resolved from flags/env/~/.eventmodelers — so the current directory is
      // neither read nor written, and the command works from anywhere.
      let kitDir = opts.global ? null : modelingKitDir;
      let projectDir = kitDir ? resolve(kitDir, '..') : null;
      let overrides = null;
      if (!kitDir) {
        // The blob and the individual flags are both "explicit", so they share a
        // precedence tier — with a single --token/--board-id winning, since overriding one
        // field of a pasted blob is the only reason to pass both.
        const flags = {
          ...(opts.credentials ? parseCredentialsArg(opts.credentials) : {}),
          ...Object.fromEntries(Object.entries(credentialOverridesFromOpts(opts)).filter(([, v]) => v)),
        };
        const config = await resolveModelingCredentials(cwd, flags, globalOpts.config, globalOpts.print, !!opts.nonInteractive);
        projectDir = await ensureGlobalKit(config.baseUrl);
        kitDir = join(projectDir, MODELING_KIT.kitDirName);
        overrides = config;
      }

      // Writes to a stdout pipe are asynchronous on POSIX — without waiting for this
      // write's own flush callback, the heavier synchronous/async work runModeling() does
      // right after (dynamic imports, config reads) can eat the event-loop tick this write
      // needed to drain, so a piped watcher sees the ping arrive after runModeling's own
      // [modeling] log lines instead of before them.
      const shown = relative(cwd, kitDir);
      const runnerLabel = modelingLocalAi ? 'local model' : 'warm Claude process';
      await new Promise((res) => process.stdout.write(`▶ Starting modeling loop (${runnerLabel}) for ${shown && !shown.startsWith('..') ? shown : kitDir}...\n\n`, res));
      try {
        await runModeling(kitDir, projectDir, { verbose: !!opts.verbose, standalone: !!opts.standalone, exclusive: !!opts.exclusive, overrides, maxAgents, identity, localAi: modelingLocalAi });
      } catch (err) {
        console.error('[modeling] Fatal:', err);
        process.exit(1);
      }
      return;
    }

    if (!buildKitDir) {
      if (modelingKitDir) {
        console.error(`❌ A modeling-kit install (${MODELING_KIT.kitDirName}/) only runs via \`eventmodelers run --modeling\` — there is no cold-spawn/tasks.json loop for modeling-only projects.`);
      } else if (bridgeKitDir) {
        console.error(`❌ A bridge-kit install (${BRIDGE_KIT.kitDirName}/) only runs via \`eventmodelers bridge\` — it has no --modeling/--local-ai/--bash modes.`);
      } else {
        console.error(`❌ No kit installed in ${cwd} — run \`eventmodelers install\` first.`);
        console.error('   (A modeling agent needs no install at all: eventmodelers run --standalone --board-id <uuid>)');
      }
      process.exit(1);
    }
    const kitDir = buildKitDir;

    const localAiTarget = resolveLocalAiTarget(opts);
    const pickedCount = [opts.bash, localAiTarget !== null, !!opts.exec].filter(Boolean).length;
    if (pickedCount > 1) {
      console.error('❌ --bash, --local-ai and --exec are mutually exclusive — pick one runner.');
      process.exit(1);
    }

    // The actual agent loop lives in the scaffolded kit dir, not in this package — this
    // is just a thin dispatcher so users don't have to remember the kit-dir name or which
    // runner file to invoke. Users (and the agent itself, via AGENT.md) may customize these
    // files freely; `run` always executes whatever is currently on disk.
    const runner = opts.bash ? 'ralph.sh' : opts.exec ? 'ralph-exec.js' : localAiTarget !== null ? 'ralph-local-ai.js' : 'ralph-claude.js';
    const runnerPath = join(kitDir, runner);
    if (!existsSync(runnerPath)) {
      console.error(`❌ ${relative(cwd, runnerPath)} not found.`);
      process.exit(1);
    }

    console.log(`▶ Starting ${relative(cwd, runnerPath)}...\n`);
    const cmd = runner.endsWith('.sh') ? `"${runnerPath}"` : `node "${runnerPath}"`;
    try {
      // Only ralph-claude.js reads RALPH_VERBOSE — the bash loop and the local-AI executor have
      // their own separate output paths with no stream-json parsing to gate. RALPH_LOCAL is
      // read by all three runners (ralph.js's startRalph, and ralph.sh directly) to force the
      // local-only branch even when .eventmodelers/config.json has valid credentials.
      // RALPH_AGENT_ID/RALPH_AGENT_NAME (--id/--name) are read in ralph.js's startRalph, so
      // they reach both node runners but not ralph.sh, which has no heartbeat to identify.
      execSync(cmd, { cwd: kitDir, stdio: 'inherit', env: { ...process.env, RALPH_VERBOSE: opts.verbose ? '1' : '', RALPH_LOCAL: opts.local ? '1' : '', RALPH_AGENT_ID: identity.agentId ?? '', RALPH_AGENT_NAME: identity.agentName ?? '', ...(typeof localAiTarget === 'string' ? { LOCAL_AI_TARGET: localAiTarget } : {}), ...(typeof opts.exec === 'string' ? { RALPH_EXEC_CMD: opts.exec } : {}) } });
    } catch (err) {
      process.exit(err.status || 1);
    }
  });

program
  .command('bridge')
  .description('Start the bridge agent loop from the installed .bridge-kit/ — translates board slice changes into another spec framework instead of building code. A deterministic adapter runs with no LLM call if one exists for the configured target (e.g. spec-kitty); otherwise Claude is the default executor. --local-ai, --hook, or --claude override the pick.')
  .option('--local-ai [target]', `Use ralph-local-ai.js instead of the default runner — a local or self-hosted model. Optional target preset: ${LOCAL_AI_TARGETS.join(', ')} (bare flag means ollama).`)
  .option('--hook <command>', 'Run this shell command instead of an AI agent for each batch of slice changes (e.g. commit + push .slices/ for a CI pipeline to pick up) — overrides any hook persisted via `init --bridge --hook` for this run only')
  .option('--claude', 'Force the Claude runner even if a static adapter exists for this target')
  .action((opts) => {
    const cwd = process.cwd();
    const kitDir = findAllInstalledKitDirs(cwd).find((d) => d.endsWith(BRIDGE_KIT.kitDirName)) ?? null;
    if (!kitDir) {
      console.error(`❌ No bridge-kit installed in ${cwd} — run \`eventmodelers init --bridge --target <name>\` first.`);
      process.exit(1);
    }

    const localAiTarget = resolveLocalAiTarget(opts);
    if ([localAiTarget !== null, opts.hook, opts.claude].filter(Boolean).length > 1) {
      console.error('❌ --local-ai, --hook, and --claude are mutually exclusive — pick one executor.');
      process.exit(1);
    }

    // A persisted default (from `init --bridge --hook`) lives in bridge.json, a
    // plain sibling file — NOT under .eventmodelers/, which is gitignored (see
    // the comment in `init`'s --bridge branch) and would otherwise make this
    // per-machine instead of a shared, checked-in team/CI convention.
    const bridgeCfg = readJsonSafe(join(kitDir, 'bridge.json'));
    const persistedHook = bridgeCfg.hookCommand;
    const hookCmd = opts.hook || persistedHook;

    // A static adapter (adapters/<target>-adapter.js, e.g. spec-kitty-adapter.js)
    // is deterministic and costs no LLM call, so it wins over the Claude default
    // whenever one exists for the configured target — --claude opts back out.
    const staticAdapterPath = join(kitDir, 'adapters', `${bridgeCfg.target}-adapter.js`);
    const hasStaticAdapter = bridgeCfg.target && existsSync(staticAdapterPath);

    const runner = hookCmd
      ? 'ralph-hook.js'
      : localAiTarget !== null
        ? 'ralph-local-ai.js'
        : !opts.claude && hasStaticAdapter
          ? 'ralph-static.js'
          : 'ralph-claude.js';
    const runnerPath = join(kitDir, runner);
    if (!existsSync(runnerPath)) {
      console.error(`❌ ${relative(cwd, runnerPath)} not found.`);
      process.exit(1);
    }

    console.log(`▶ Starting ${relative(cwd, runnerPath)}${hookCmd ? ` (hook: ${hookCmd})` : ''}...\n`);
    try {
      execSync(`node "${runnerPath}"`, {
        cwd: kitDir,
        stdio: 'inherit',
        env: hookCmd ? { ...process.env, BRIDGE_HOOK_CMD: hookCmd } : process.env,
      });
    } catch (err) {
      process.exit(err.status || 1);
    }
  });

program
  .command('listen')
  .description('Start the code-export listener (code-export.mjs) from the installed kit dir — receives slice/screen data pushed from the eventmodelers board UI and writes it into .slices/')
  .option('--port <port>', 'Port to listen on (default 3001, or $PORT)')
  .action((opts) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);

    const serverPath = join(kitDir, 'code-export.mjs');
    if (!existsSync(serverPath)) {
      console.error(`❌ ${relative(cwd, serverPath)} not found.`);
      process.exit(1);
    }

    console.log(`▶ Starting ${relative(cwd, serverPath)}...\n`);
    const env = opts.port ? { ...process.env, PORT: opts.port } : process.env;
    try {
      execSync(`node "${serverPath}"`, { cwd: kitDir, stdio: 'inherit', env });
    } catch (err) {
      process.exit(err.status || 1);
    }
  });

program
  .command('fetch')
  .description('Pull full slice detail for one context on the board via the slicedata API and write it into .slices/ — the pull-based counterpart to `listen`, without screen images')
  .requiredOption('--context <name>', 'Name of the MODEL_CONTEXT to fetch')
  .option('--format <format>', 'Output format: json (default, builds the full .slices/ folder structure), yaml, textual, toon, emlang, or esdm (each of these five is dumped to a single .slices/<context>/slicedata.<ext> file instead)', 'json')
  .option('--slice-id <id>', 'After fetching, print just the slice with this id (requires --format json)')
  .option('--slice-title <title>', 'After fetching, print just the slice with this title, case-insensitive (requires --format json)')
  .option('--spec-kitty', "After fetching, also restate this context as a Spec Kitty mission brief (.kittify/mission-brief.md via `spec-kitty intake`) — deterministic, no LLM call, no mission/spec.md/tasks created. Run `/spec-kitty.specify` afterward to turn the brief into a mission. Requires `spec-kitty init` to already be set up in this project (see lib/adapters/spec-kitty-adapter.js) and --format json. One-shot: does not start a loop.")
  .action(async (opts, command) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);
    // modeling-kit has no code-export.mjs (useShared:false, no `listen`) and no
    // skill reads a nested .agent-modeling-kit/.slices/ — so nothing expects fetch's
    // output there either. Every other kit dir does have a code-export.mjs that
    // hardcodes its .slices/ next to itself, so those still nest to stay
    // interchangeable with what `listen` produces.
    const slicesKitDir = kitDir?.endsWith(MODELING_KIT.kitDirName) ? null : kitDir;
    const globalOpts = command.optsWithGlobals();
    const explicitConfig = globalOpts.config;
    const effective = loadEffectiveConfig(cwd, kitDir, explicitConfig);
    let cfg = effective.config;

    // Same default (project-root .eventmodelers/config.json, or --config) that
    // installStack uses — kept identical rather than deriving a path from
    // `effective`, which can point at a kit-dir-scoped config instead.
    const configPath = explicitConfig ? resolve(cwd, explicitConfig) : join(cwd, '.eventmodelers', 'config.json');
    const requiredFields = ['organizationId', 'boardId', 'token'];

    // Same prompt (paste/manual/instructions/skip) `install`/`init-config` use —
    // reusing it here means `fetch` also works as a first-run credential setup.
    // Also re-entered below if the API rejects whatever we already had.
    async function promptForCredentials() {
      cfg = await configureCredentials({
        config: cfg,
        configPath,
        targetDir: cwd,
        requiredFields,
        boardIdOptional: false,
        overrides: {},
        print: globalOpts.print,
      });
      if (requiredFields.some((f) => !cfg[f])) {
        console.error('❌ Still missing token/organizationId/boardId — re-run `eventmodelers fetch` once configured.');
        process.exit(1);
      }
    }

    if (requiredFields.some((f) => !cfg[f])) await promptForCredentials();

    try {
      await runFetch({ cwd, kitDir: slicesKitDir, cfg, opts });
    } catch (err) {
      if (!(err instanceof FetchAuthError)) throw err;
      // Present but wrong, not missing — the connect skill's Step 4 (Verify) treats
      // 401/403/404 the same way: clear the field that's implicated and re-prompt,
      // rather than leaving the caller stuck re-running with the same bad value.
      console.error(`❌ ${err.message}`);
      if (err.status === 404) delete cfg.boardId;
      else delete cfg.token;
      await promptForCredentials();
      await runFetch({ cwd, kitDir: slicesKitDir, cfg, opts });
    }

    if (opts.specKitty) {
      try {
        await runSpecKittyAdapter({ cfg, projectDir: cwd, contextName: opts.context });
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    }
  });

program
  .command('activate-context')
  .description('Choose which fetched context is active — writes .slices/current_context.json, which `run`/bridge/listen treat as sticky and never cross out of on their own')
  .action(async () => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);
    // Same modeling-kit exception `fetch` applies — see its action for why.
    const slicesKitDir = kitDir?.endsWith(MODELING_KIT.kitDirName) ? null : kitDir;
    const SLICES_DIR = join(slicesKitDir || cwd, '.slices');
    const hint = '   Run `eventmodelers fetch --context <name>` first to pull a context from the board.';

    // A context is any .slices/ subdirectory fetch/listen wrote an index.json into —
    // that's the file both of them use as proof a context's slices actually landed.
    const contextDirs = existsSync(SLICES_DIR)
      ? readdirSync(SLICES_DIR, { withFileTypes: true })
          .filter((e) => e.isDirectory() && existsSync(join(SLICES_DIR, e.name, 'index.json')))
          .map((e) => e.name)
      : [];

    if (!contextDirs.length) {
      console.error(`❌ No contexts found in ${relative(cwd, SLICES_DIR)}/.`);
      console.error(hint);
      process.exit(1);
    }

    const currentCtx = readJsonSafe(join(SLICES_DIR, 'current_context.json')).name;

    // context.json's `name` is the human-readable display name; the directory itself
    // (contextSlug) is what current_context.json must store, since readCurrentContext
    // (shared/build-kit/lib/ralph.js) joins it straight onto `.slices/<name>/index.json`.
    const choices = contextDirs.map((dirName) => ({
      label: readJsonSafe(join(SLICES_DIR, dirName, 'context.json')).name || dirName,
      value: dirName,
    }));
    const defaultIndex = Math.max(0, contextDirs.indexOf(currentCtx));

    const selected = await selectPrompt(
      `Which context should be active?${currentCtx ? ` (currently: ${choices[defaultIndex].label})` : ''}`,
      choices,
      defaultIndex,
    );

    writeFileSync(join(SLICES_DIR, 'current_context.json'), JSON.stringify({ name: selected }, null, 2));
    const selectedLabel = choices.find((c) => c.value === selected)?.label || selected;
    console.log(`✅ Active context set to "${selectedLabel}" → ${relative(cwd, join(SLICES_DIR, 'current_context.json'))}`);
  });

// Order/icons/default mirror the board UI's own slice-status picker.
const SLICE_STATUSES = [
  { label: '🌱 Created (default)', value: 'Created' },
  { label: '✅ Done', value: 'Done' },
  { label: '👤 Assigned', value: 'Assigned' },
  { label: '🔄 InProgress', value: 'InProgress' },
  { label: '🔍 Review', value: 'Review' },
  { label: '🚫 Blocked', value: 'Blocked' },
  { label: '📅 Planned', value: 'Planned' },
  { label: 'ℹ️ Informational', value: 'Informational' },
];

program
  .command('set-slice-status')
  .description('Pick a slice from the active context and change its status — updates .slices/ locally, and the board itself with --remote')
  .option('--remote', 'Also push the change to the board via the nodes/events API (same effect `update-slice-status` has, see shared/skills/update-slice-status)')
  .action(async (opts, command) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);
    // Same modeling-kit exception `fetch`/`activate-context` apply — see fetch's action for why.
    const slicesKitDir = kitDir?.endsWith(MODELING_KIT.kitDirName) ? null : kitDir;
    const SLICES_DIR = join(slicesKitDir || cwd, '.slices');
    const fetchHint = '   Run `eventmodelers fetch --context <name>` first to pull a context from the board.';

    const currentCtx = readJsonSafe(join(SLICES_DIR, 'current_context.json')).name;
    if (!currentCtx) {
      console.error('❌ No active context set.');
      console.error(existsSync(SLICES_DIR) ? '   Run `eventmodelers activate-context` to pick one.' : fetchHint);
      process.exit(1);
    }

    const contextDir = join(SLICES_DIR, currentCtx);
    const indexPath = join(contextDir, 'index.json');
    const indexData = readJsonSafe(indexPath);
    const slices = Array.isArray(indexData.slices) ? indexData.slices : [];
    if (!slices.length) {
      console.error(`❌ No slices found for context "${currentCtx}".`);
      console.error(fetchHint);
      process.exit(1);
    }

    const sliceChoices = slices.map((s) => ({ label: `${s.slice || s.id}  [${s.status || 'Created'}]`, value: s.id }));
    const sliceId = await selectPrompt(`Which slice in "${currentCtx}" should change status?`, sliceChoices, 0);
    const slice = slices.find((s) => s.id === sliceId);

    const statusDefault = Math.max(0, SLICE_STATUSES.findIndex((s) => s.value === (slice.status || 'Created')));
    const newStatus = await selectPrompt(`New status for "${slice.slice}"? (currently: ${slice.status || 'Created'})`, SLICE_STATUSES, statusDefault);

    if (newStatus === (slice.status || 'Created')) {
      console.log(`ℹ️  "${slice.slice}" is already ${newStatus} — nothing to change.`);
      return;
    }

    // index.json's `definition` is a full copy of the slice (see lib/fetch.js's entry
    // shape) — keep both copies of `status` in sync so anything reading either stays correct.
    const previousStatus = slice.status || 'Created';
    slice.status = newStatus;
    if (slice.definition) slice.definition.status = newStatus;
    writeFileSync(indexPath, JSON.stringify(indexData, null, 2));

    if (slice.folder) {
      const sliceJsonPath = join(contextDir, slice.folder, 'slice.json');
      if (existsSync(sliceJsonPath)) {
        const sliceData = readJsonSafe(sliceJsonPath);
        sliceData.status = newStatus;
        writeFileSync(sliceJsonPath, JSON.stringify(sliceData, null, 2));
      }
    }

    console.log(`✅ "${slice.slice}": ${previousStatus} → ${newStatus} (${relative(cwd, indexPath)})`);

    if (!opts.remote) return;

    // slice.id is the SLICE_BORDER node ID (see shared/skills/update-slice-status/SKILL.md
    // Step 2) — the same id the board's own nodes/events API expects as nodeId below.
    const globalOpts = command.optsWithGlobals();
    const explicitConfig = globalOpts.config;
    const configPath = explicitConfig ? resolve(cwd, explicitConfig) : join(cwd, '.eventmodelers', 'config.json');
    const requiredFields = ['organizationId', 'boardId', 'token'];
    let { config: cfg } = loadEffectiveConfig(cwd, kitDir, explicitConfig);

    async function promptForCredentials() {
      cfg = await configureCredentials({
        config: cfg,
        configPath,
        targetDir: cwd,
        requiredFields,
        boardIdOptional: false,
        overrides: {},
        print: globalOpts.print,
      });
      if (requiredFields.some((f) => !cfg[f])) {
        console.error('❌ Still missing token/organizationId/boardId — re-run with --remote once configured.');
        process.exit(1);
      }
    }
    if (requiredFields.some((f) => !cfg[f])) await promptForCredentials();

    const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
    async function pushRemote() {
      return fetch(`${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/nodes/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-token': cfg.token,
          'x-user-id': 'cli-set-slice-status',
          ...agentHeaders(cfg),
        },
        body: JSON.stringify([{
          // The event id is the caller's and required; boardId/timestamp are the server's —
          // it derives both from the request and ignores anything sent here.
          id: randomUUID(),
          eventType: 'node:changed',
          nodeId: slice.id,
          changedAttributes: ['sliceStatus'],
          meta: { sliceStatus: newStatus },
        }]),
      });
    }

    let res;
    try {
      res = await pushRemote();
    } catch (err) {
      console.error(`❌ Remote update failed: ${err.message}`);
      process.exit(1);
    }

    // Same 401/403 reconfigure-and-retry dance `fetch` does — present-but-wrong
    // credentials, not missing ones, so clear whichever field is implicated and retry once.
    if (res.status === 401 || res.status === 403) {
      console.error(`❌ Remote update: ${res.status === 401 ? 'invalid or expired token' : "token's organization does not match this board"}.`);
      if (res.status === 403) delete cfg.boardId; else delete cfg.token;
      await promptForCredentials();
      try {
        res = await pushRemote();
      } catch (err) {
        console.error(`❌ Remote update failed: ${err.message}`);
        process.exit(1);
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.error || `HTTP ${res.status}`;
      // The API refuses to move a slice into a status it's already in (a concurrency
      // guard so two agents/users can't both claim it) — not a real failure, just means
      // the board had already moved on since the last fetch.
      if (/already/i.test(msg)) {
        console.log(`ℹ️  Board already has "${slice.slice}" at ${newStatus} — no remote change needed.`);
        return;
      }
      console.error(`❌ Remote update failed: ${msg}`);
      process.exit(1);
    }

    console.log(`✅ Pushed status change to the board (node ${slice.id}).`);
  });

program
  .command('stacks')
  .description('List available stacks (for `init --stack`)')
  .action(() => {
    console.log('Available stacks:\n');
    for (const [key, cfg] of Object.entries(STACKS)) {
      console.log(`  ${key.padEnd(16)} ${cfg.label}`);
    }
    console.log('\nUse: npx @eventmodelers/cli init --stack <name>');
    console.log(`\nNot a stack — skills + agent loop only, no backend: npx @eventmodelers/cli init --modeling`);
  });

// Removes exactly what a given `init` (with or without --modeling) run put down — read back from
// the install manifest written at the end of installStack() — and nothing else: not
// unrelated skills the user added by hand, not the root project scaffold.
function uninstallKitDir(kitDir, cwd) {
  const manifestPath = join(kitDir, '.eventmodelers', 'install-manifest.json');
  const manifest = readJsonSafe(manifestPath);

  if (manifest.skills?.length) {
    const skillsDir = manifest.global ? join(homedir(), '.claude', 'skills') : join(cwd, '.claude', 'skills');
    for (const name of manifest.skills) {
      const p = join(skillsDir, name);
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        console.log(`  ✓ Removed ${relative(cwd, p) || p}`);
      }
    }
  }

  if (manifest.claudeExtras?.length && !manifest.global) {
    for (const name of manifest.claudeExtras) {
      const p = join(cwd, '.claude', name);
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        console.log(`  ✓ Removed ${relative(cwd, p)}`);
      }
    }
  }

  if (manifest.agentHostFiles?.length) {
    const touchedDirs = new Set();
    for (const relPath of manifest.agentHostFiles) {
      const p = join(cwd, relPath);
      if (existsSync(p)) {
        rmSync(p, { force: true });
        console.log(`  ✓ Removed ${relPath}`);
        touchedDirs.add(dirname(p));
      }
    }
    // Prune now-empty host/package directories (e.g. .cursor/commands/,
    // .agents/skills/eventmodelers.timeline/) so uninstall doesn't leave an
    // empty dotfile forest behind — but never walk above cwd.
    for (const dir of touchedDirs) {
      let d = dir;
      while (d.startsWith(cwd) && d !== cwd) {
        try {
          if (readdirSync(d).length > 0) break;
          rmSync(d, { recursive: true, force: true });
          d = dirname(d);
        } catch {
          break;
        }
      }
    }
  }

  if (manifest.mcpRegistered) {
    const settingsPath = join(cwd, '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        if (settings.mcpServers?.[MCP_SERVER_NAME]) {
          delete settings.mcpServers[MCP_SERVER_NAME];
          if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          console.log(`  ✓ Removed ${MCP_SERVER_NAME} MCP entry from ${relative(cwd, settingsPath)}`);
        }
      } catch {}
    }
  }

  if (!existsSync(manifestPath)) {
    console.log(`  ℹ️  ${relative(cwd, kitDir)} predates install tracking — only the kit dir itself was removed; any installed skills or MCP registration must be cleaned up by hand.`);
  }

  rmSync(kitDir, { recursive: true, force: true });
  console.log(`  ✓ Removed ${relative(cwd, kitDir) || kitDir}`);
}

program
  .command('uninstall')
  .description('Remove everything init (with or without --modeling) installed: the kit dir, the skills it copied (project-local or ~/.claude/skills with --global), its MCP entry in .claude/settings.json, and any files written by init-agents. Leaves the root project scaffold untouched.')
  .option('--build-kit', `Remove ${STACKS.node.kitDirName}/ (the backend-stack kit dir)`)
  .option('--modeling-kit', `Remove ${MODELING_KIT.kitDirName}/ (the modeling-only kit dir)`)
  .option('--bridge-kit', `Remove ${BRIDGE_KIT.kitDirName}/ (the bridge kit dir)`)
  .action((opts) => {
    const cwd = process.cwd();
    let targets;

    if (opts.buildKit || opts.modelingKit || opts.bridgeKit) {
      targets = [];
      if (opts.buildKit) targets.push(join(cwd, STACKS.node.kitDirName));
      if (opts.modelingKit) targets.push(join(cwd, MODELING_KIT.kitDirName));
      if (opts.bridgeKit) targets.push(join(cwd, BRIDGE_KIT.kitDirName));
      targets = targets.filter((p) => existsSync(p));
      if (!targets.length) {
        console.log('ℹ️  Nothing to remove for the requested option(s).');
        return;
      }
    } else {
      targets = findAllInstalledKitDirs(cwd);
      if (!targets.length) {
        console.log('ℹ️  No installed kit dir found (checked: ' + KIT_DIR_NAMES.join(', ') + ')');
        return;
      }
      if (targets.length > 1) {
        console.log('⚠️  Multiple kit dirs found — re-run with --build-kit, --modeling-kit, and/or --bridge-kit to pick which to remove.');
        targets.forEach((t) => console.log(`     ${t}`));
        return;
      }
    }

    for (const t of targets) {
      uninstallKitDir(t, cwd);
    }
    console.log('✅ Uninstalled');
  });

program
  .command('status')
  .description('Check installation status')
  .action((opts, command) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);
    const skillsDir = join(cwd, '.claude', 'skills');
    const explicitConfig = command.optsWithGlobals().config;
    // modeling-kit's only runtime is `run --modeling`, driven by lib/config.js (no
    // ralph-claude.js exists there — see MODELING_KIT's useShared:false); every
    // other kit dir is a build-kit stack, whose default runtime is ralph-claude.js.
    const isModelingKit = kitDir?.endsWith(MODELING_KIT.kitDirName);
    const runtimePath = kitDir ? join(kitDir, isModelingKit ? 'lib/config.js' : 'ralph-claude.js') : null;
    const { sources, config: cfg } = loadEffectiveConfig(cwd, kitDir, explicitConfig);

    console.log('Eventmodelers CLI Status\n');
    console.log(`Kit dir:        ${kitDir ? `✅ installed (${relative(cwd, kitDir)})` : '❌ not found'}`);
    console.log(`Skills:         ${existsSync(skillsDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Config:         ${sources.length ? `✅ present${sources.length > 1 ? ` (merged from ${sources.length} files)` : ''}` : '❌ missing'}`);
    console.log(`Agent runtime:  ${runtimePath && existsSync(runtimePath) ? '✅ present' : '❌ missing'}`);

    if (sources.length) {
      console.log(`\nConnected to:   ${cfg.baseUrl || DEFAULT_BASE_URL}`);
      console.log(`Organization:   ${cfg.organizationId}`);
      if (cfg.boardId) console.log(`Board:          ${cfg.boardId}`);
      console.log(`\nConfig source${sources.length > 1 ? 's (later overrides earlier)' : ''}:`);
      sources.forEach((s) => console.log(`  - ${s}`));
    }

    const activeEnvVars = Object.keys(ENV_CONFIG_MAP).filter((k) => process.env[k]);
    if (activeEnvVars.length) {
      console.log(`\nOverridden by env: ${activeEnvVars.join(', ')}`);
    }
  });

program
  .command('release-notes')
  .description('Show the CLI release notes (what changed across recent versions)')
  .action(() => {
    const notesPath = join(__dirname, 'RELEASE_NOTES.md');
    if (!existsSync(notesPath)) {
      console.log('ℹ️  No release notes found.');
      return;
    }
    console.log(readFileSync(notesPath, 'utf8').trimEnd());
  });

program
  .command('config')
  .description('Print the fully resolved config (merged across the directory hierarchy + EVENTMODELERS_* env vars), with the token masked')
  .action((opts, command) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);
    const explicitConfig = command.optsWithGlobals().config;
    const { sources, config } = loadEffectiveConfig(cwd, kitDir, explicitConfig);

    const resolved = { ...config };
    if (resolved.token) resolved.token = maskSecret(resolved.token);

    console.log(`Config source${sources.length > 1 ? 's (later overrides earlier)' : ''}:`);
    if (sources.length) sources.forEach((s) => console.log(`  - ${s}`));
    else console.log('  (none found)');
    console.log();
    console.log(JSON.stringify(resolved, null, 2));

    const activeEnvVars = Object.keys(ENV_CONFIG_MAP).filter((k) => process.env[k]);
    if (activeEnvVars.length) {
      console.log(`\nOverridden by env: ${activeEnvVars.join(', ')}`);
    }
  });

await program.parseAsync();
if (sharedRl) sharedRl.close();