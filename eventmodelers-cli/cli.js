#!/usr/bin/env node

import { Command, Option } from 'commander';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path';
import {
  existsSync,
  mkdirSync,
  cpSync,
  copyFileSync,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from 'fs';
import { execSync, execFileSync, spawn, spawnSync } from 'child_process';
import { createInterface, emitKeypressEvents, moveCursor, clearScreenDown } from 'readline';
import { homedir, tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { runFetch, FetchAuthError } from './lib/fetch.js';
import { registerPrototype, initPrototype } from './extensions/prototype/index.js';
import { registerVibe, initVibe, uninstallVibe } from './extensions/vibe/index.js';
import { SCAFFOLD_TYPES, invocation, scaffoldTypeNames, missingPrerequisites, runScaffold, reinitKits, builtInTemplates, initTemplates } from './lib/scaffold.js';
import { supervise } from './lib/supervise.js';
import { findBuildKitDirs } from './lib/build-kits.js';
import { buildModel } from './lib/scaffold-model.js';
import { createModelingLocalAiRunner } from './lib/modeling-local-ai.js';
import { ACP_AGENTS, resolveAcpAgent } from './lib/modeling-acp.js';
import { run as runSpecKittyAdapter } from './lib/adapters/spec-kitty-adapter.js';
import { latestPublishedVersion, updateHints } from './lib/update-check.js';
import { guardSnippetReply } from './lib/snippet-guard.js';
import { modelingPermissions } from './lib/agent-permissions.js';
import { createTurnUsage } from './lib/turn-usage.js';
// Not a root-level adapter like spec-kitty-adapter.js above: this is the one canonical
// copy that every useShared:true stack also gets copied into its installed kit (see
// copyDirContents in installStack) for ralph.js to import standalone — see
// shared/build-kit/lib/adapters/realtime-adapter.js for why it lives there instead.
import { createRealtimeAdapter, keepSubscribed } from './shared/build-kit/lib/adapters/realtime-adapter.js';
import { recordAgentStatus } from './shared/build-kit/lib/slice-run.js';
import { findSliceDir, fingerprint, readBaseline, writeBaseline, compare } from './lib/ui-baseline.js';
import { defaultAgentName, withInstanceSuffix } from './shared/build-kit/lib/agent-name.js';
import { acquireAgentId } from './shared/build-kit/lib/agent-lock.js';
import { readEvents } from './shared/build-kit/lib/slice-events.js';
import { findPromptEvent, replayRequest } from './shared/build-kit/lib/prompt-replay.js';
import { prunableEvents, pruneLog, rememberPruneAnswer, shouldOfferPrune } from './shared/build-kit/lib/event-prune.js';
import { fold } from './shared/build-kit/lib/slice-state.js';
import { filterEvents, baselineIds, formatEvent, formatPayload, sliceTitles, summarize } from './shared/build-kit/lib/events-view.js';
import { stableGlobalAgentId } from './lib/global-agent-id.js';
import { AGENT_NAMES, presetCommand, withModel } from './shared/build-kit/lib/harnesses/index.js';
import { ensureLearningsGitRules } from './shared/build-kit/lib/ralph.js';
import { createCallTracker, heldPromptsRequest, journalPromptAction, shouldJournalCall, journalPromptFinished, journalPromptReceived, recoverOwnPrompts } from './shared/build-kit/lib/prompt-journal.js';
import { cancelLiveTurns } from './shared/build-kit/lib/turn.js';
import { INFO_KINDS, infoComment, recordInfo, recordTurnInfos } from './shared/build-kit/lib/slice-info.js';
import { listLearnings, mergeLearnings, recordLearning, recordTurnLearnings, retractLearning, syncLearnings } from './shared/build-kit/lib/slice-learnings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Each stack is a template set under stacks/<key>/templates/{.claude,root,<kitSubdir>}.
// Stacks with useShared:true also get shared/build-kit/* copied into their kit dir
// (ralph.js, ralph-claude.js, ralph-local-ai.js, ralph-exec.js,
// code-export.mjs, lib/local-ai-agent.js, package.json, README.md) —
// those files have no per-stack content, so they live once instead of being
// copy-pasted into every stack (that copy-pasting is exactly how they drifted out
// of sync before: a bugfix or default landing in one stack's copy but not another's).
// Each stack's own templates/<kitSubdir>/* supplies the genuine per-stack files
// (lib/prompt.md, lib/backend-prompt.md, lib/AGENT.md, checks, etc.); shared/build-kit/*
// is copied after it, so the shared runtime always wins over any copy a stack still ships.
// modeling-kit (below) is the one kit that opts out of all of this (useShared:false)
// — it has no cold-spawn/task-queue runtime at all, so none of shared/build-kit/*
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

// --- --agent: named shortcuts for --exec ---------------------------------------
// `run --agent opencode` is exactly `run --exec "<preset>"` — the harness command spelled out
// once here, so nobody has to remember its headless flags. The two loops want different output
// from the same harness: the modeling loop reads a turn's answer from plain-text stdout, while a
// build kit wants the JSON mode, the only one that reports the usage agent tracing records.
// claude has no command — it is the default runner, named so it can be picked explicitly. Neither has mastra:
// it runs in-process, one warm session, so the cockpit gets the same tool-call and cost events a Claude run gives it.
// --exec stays the fallback for any harness or flag set not listed here.
// The commands live with their harness, in shared/build-kit/lib/harnesses/<name>.js.

function printAgentPresets() {
  console.log('Supported agents for run --agent <name>:\n');
  for (const name of AGENT_NAMES) {
    const modeling = presetCommand(name, 'modeling');
    const own = name === 'mastra' ? 'a warm Mastra agent in this process (lib/modeling-mastra.js / ralph-mastra.js) — needs --model <provider/model>' : 'the default runner (warm Claude process / ralph-claude.js)';
    console.log(`  ${name.padEnd(9)}${modeling ? `modeling: ${modeling}\n  ${''.padEnd(9)}build:    ${presetCommand(name, 'build')}` : own}`);
  }
  console.log('\nAny other harness: run --exec "<command>".');
  console.log(`A local or self-hosted model: run --local-ai [${LOCAL_AI_TARGETS.join('|')}].`);
}

// Resolves --agent into the --exec command it stands for, or null for the default Claude runner.
// Bare --agent lists the presets and stops.
function resolveAgentPreset(opts, loop) {
  if (opts.agent === undefined) {
    if (opts.acp && !opts.acpCmd) {
      console.error(`❌ --acp needs --agent <${Object.keys(ACP_AGENTS).join('|')}>, or use --acp-cmd "<command>" for any other ACP agent.`);
      process.exit(1);
    }
    return null;
  }
  if (opts.agent === true) {
    printAgentPresets();
    process.exit(0);
  }
  const name = String(opts.agent).toLowerCase();
  if (!AGENT_NAMES.includes(name) && !(opts.acp && ACP_AGENTS[name])) {
    console.error(`❌ Unknown --agent "${opts.agent}" — one of: ${AGENT_NAMES.join(', ')}.`);
    console.error('   Any other harness works via --exec "<command>".');
    console.error(`   A local or self-hosted model works via --local-ai [${LOCAL_AI_TARGETS.join('|')}].`);
    process.exit(1);
  }
  if (opts.exec) {
    console.error('❌ --agent and --exec are mutually exclusive — --agent is a shortcut for --exec.');
    process.exit(1);
  }
  if (resolveLocalAiTarget(opts) !== null) {
    console.error('❌ --agent is mutually exclusive with --local-ai — pick one runner.');
    process.exit(1);
  }
  // Mastra is a runner of its own, not a command: a warm in-process agent session (see lib/modeling-mastra.js).
  if (name === 'mastra') {
    if (opts.acp) {
      console.error('❌ --acp does not apply to --agent mastra — Mastra runs in-process and speaks no protocol.');
      process.exit(1);
    }
    opts.mastra = true;
    return null;
  }
  // --acp: the same harness, driven over the Agent Client Protocol as one warm session (lib/modeling-acp.js)
  // rather than as one exec process per turn.
  if (opts.acp) {
    if (!ACP_AGENTS[name]) {
      console.error(`❌ --acp has no ACP agent for --agent ${name} — one of: ${Object.keys(ACP_AGENTS).join(', ')}, or --acp-cmd "<command>".`);
      process.exit(1);
    }
    opts.acpAgent = name;
    return null;
  }
  return presetCommand(name, loop);
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
  // Installs into an existing codebase instead of scaffolding one — it ships no
  // templates/root, so nothing is spread into the project root. Its learn-architecture
  // skill analyzes the code once into .build-kit/ARCHITECTURE.md, and the build-* skills
  // implement each slice the way that codebase already works (typically CRUD).
  classic: {
    label: 'Classic — existing codebase (any language, typically CRUD), slices built to match its architecture',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
};

// Not a stack — no backend scaffold, just skills + the agent loop. Installed via
// `init --modeling` instead of the `init --stack <name>` picker.
// useShared:false — unlike build-kit, modeling-kit has no cold-spawn/task-queue
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

// Also not a stack — installed via `init --build-kit` instead of `init --stack <name>`.
// useShared:true, same as any real backend stack: it reuses build-kit's cold-spawn/
// task-queue engine as-is (lib/ralph.js). Its templates/build-kit/CLAUDE.md,
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

const KIT_DIR_NAMES = [...new Set([...Object.values(STACKS), MODELING_KIT, BLANK_BUILD_KIT].map((s) => s.kitDirName))];

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
  EVENTMODELERS_POCKETBASE_URL: 'pocketbaseUrl',
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
    // On a TTY readline puts stdin in raw mode, so Ctrl-C arrives as a keypress and the kernel
    // never raises SIGINT — with no 'SIGINT' listener on the interface readline just pauses
    // input and swallows it. The interface lives for the whole process (the loop included), so
    // forward it as the real signal to whatever shutdown handlers are installed.
    sharedRl.on('SIGINT', () => {
      if (process.listenerCount('SIGINT') === 0) process.exit(130);
      process.emit('SIGINT', 'SIGINT');
    });
  }
  return sharedRl;
}

// --force on a build kit: the credentials step of `init-config` against the project-root config the
// runner reads. Interactive, so under `run --all` the parent runs it for each kit one after the other —
// the supervised children have no stdin to ask on. `shared` (another kit's answer) is applied
// instead of asking, so every kit of one run ends up on the same credentials.
async function forceBuildKitCredentials(kitDir, cwd, opts, globalOpts, shared = null) {
  const projectDir = dirname(kitDir);
  const configPath = globalOpts.config
    ? resolve(projectDir, globalOpts.config)
    : join(projectDir, '.eventmodelers', 'config.json');
  const cfg = await configureCredentials({
    config: loadEffectiveConfig(cwd, kitDir, globalOpts.config).config,
    configPath,
    targetDir: projectDir,
    requiredFields: ['organizationId', 'boardId', 'token'],
    overrides: shared ?? credentialOverridesFromOpts(opts),
    print: false,
    force: !shared,
  });
  ensureMcpRegistered(projectDir, cfg.baseUrl || DEFAULT_BASE_URL);
  ensureEnvToken(projectDir, cfg.token);
  ensureMcpEnabled(projectDir);
  return cfg;
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

// Arrow-key multi-select: space toggles, `a` toggles all, enter confirms. Long lists scroll in a window.
// Falls back to a comma-separated numbered prompt on non-TTY stdin. Returns the values of the checked choices.
async function checkboxPrompt(question, choices) {
  if (!process.stdin.isTTY) {
    console.log(`\n${question}`);
    choices.forEach((c, i) => console.log(`  ${i + 1}) [${c.checked ? 'x' : ' '}] ${c.label}`));
    const answer = (await prompt('  Select (comma-separated numbers, "all", "none"; empty keeps the [x] ones): ')).trim().toLowerCase();
    if (!answer) return choices.filter((c) => c.checked).map((c) => c.value);
    if (answer === 'all') return choices.map((c) => c.value);
    if (answer === 'none') return [];
    const picked = new Set(answer.split(',').map((n) => parseInt(n, 10) - 1));
    return choices.filter((_, i) => picked.has(i)).map((c) => c.value);
  }

  return new Promise((resolve) => {
    const checked = choices.map((c) => Boolean(c.checked));
    const pageSize = Math.max(5, Math.min(choices.length, (process.stdout.rows || 24) - 6));
    let index = 0;
    let top = 0;
    const stdin = process.stdin;
    const render = () => {
      if (index < top) top = index;
      if (index >= top + pageSize) top = index - pageSize + 1;
      const rows = choices.slice(top, top + pageSize).map((c, j) => {
        const i = top + j;
        return `${i === index ? '❯' : ' '} ${checked[i] ? '◉' : '○'} ${c.label}`;
      });
      rows.push(`  (${checked.filter(Boolean).length}/${choices.length} selected — space toggles, a all/none, enter confirms)`);
      return rows;
    };

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
      if (key.name === 'up' || key.name === 'k') index = (index - 1 + choices.length) % choices.length;
      else if (key.name === 'down' || key.name === 'j') index = (index + 1) % choices.length;
      else if (key.name === 'space') checked[index] = !checked[index];
      else if (key.name === 'a') {
        const all = checked.every(Boolean);
        checked.fill(!all);
      } else if (key.name === 'return') {
        cleanup();
        resolve(choices.filter((_, i) => checked[i]).map((c) => c.value));
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

// Where a project-level setting (`config --handover`, `--agent-tracing`) is written: the explicit
// --config, else the installed kit's project, else the nearest project config up the tree — so it
// lands in the file `run` merges in, even from a subdirectory — else this directory. The
// account-wide ~/.eventmodelers/config.json is never a target: these are per-project policies.
function projectConfigPath(cwd, kitDir, explicitConfig) {
  if (explicitConfig) return resolve(explicitConfig);
  if (kitDir) return join(dirname(kitDir), '.eventmodelers', 'config.json');
  const found = findConfigInParents(cwd);
  const globalPath = join(homedir(), '.eventmodelers', 'config.json');
  return found && found !== globalPath ? found : join(cwd, '.eventmodelers', 'config.json');
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
    // other input (STACKS, MODELING_KIT) keeps using the built-in path.
    const templatesSource = options.templatesSource || join(__dirname, 'stacks', stackKey, 'templates');
    const sharedBuildKit = join(__dirname, 'shared', 'build-kit');
    // Skills with no stack-specific content (connect, learn-eventmodelers-api,
    // update-slice-status, ...) live once here instead of being copy-pasted into
    // every stack's templates — that copy-pasting is exactly how they drifted out
    // of sync with each other before (e.g. one stack's connect skill silently
    // missing a bugfix another stack's copy had).
    const sharedSkills = join(__dirname, 'shared', 'skills');
    const isModelingKit = stackKey === MODELING_KIT.key;

    if (isPrototypeFolder(targetDir)) {
      console.error(`❌ ${targetDir} is a prototype folder (\`init --prototype\`). A prototype lives in a folder of its own — install the kit in another directory.`);
      process.exit(1);
    }

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
      ...(existsSync(claudeSkillsSrc) ? readdirSync(claudeSkillsSrc) : []),
    ];
    let claudeExtras = [];

    if (options.global) {
      const globalSkillsDir = join(homedir(), '.claude', 'skills');
      console.log('📦 Installing skills globally...');
      copyDirContents(sharedSkills, globalSkillsDir);
      copyDirContents(claudeSkillsSrc, globalSkillsDir);
    } else {
      console.log('📦 Installing skills...');
      // Shared skills first, the stack's own templates last — so a build kit can override
      // a shared skill (e.g. `ui-contract`) just by shipping a skill of the same name.
      copyDirContents(sharedSkills, join(targetDir, '.claude', 'skills'));
      copyDirContents(join(templatesSource, '.claude'), join(targetDir, '.claude'));
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

    // A modeling-kit + build-kit combo in the same project is supported
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

    copyDirContents(join(templatesSource, stackCfg.kitSubdir), kitDir, { skip: ['.eventmodelers'] });
    // Shared runtime goes on LAST so it always wins: a stack (built-in or --git) that still
    // ships its own ralph.js / ralph-claude.js / ... is shipping a stale copy, and letting it
    // overlay the shared one silently drops runtime fixes (e.g. agent_id on the heartbeat).
    if (stackCfg.useShared) {
      copyDirContents(sharedBuildKit, kitDir);
    }

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

    // Make scripts executable
    for (const script of ['ralph-claude.js', 'ralph-local-ai.js', 'ralph-exec.js', 'ralph-mastra.js', 'ralph-acp.js']) {
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
      ensureMcpEnabled(targetDir);
      // Only build stacks trace (slice build cost); they are the ones running the shared runtime.
      if (stackCfg.useShared) await configureAgentTracing(configPath, options.print);
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

    // The kit's runtime event log would otherwise show up as untracked files (init and re-init both land here).
    ensureLearningsGitRules(kitDir);

    // The global install scaffolds itself and then immediately starts the agent — printing
    // "Done! Start your agent:" and an init-mcp hint there would be telling the user to do
    // what this very command is already doing.
    if (options.skipEpilogue) return;

    console.log('\n✅ Done! Start your agent:\n');
    if (isModelingKit) {
      console.log('  npx @eventmodelers/cli run --modeling\n');
    } else {
      console.log('  npx @eventmodelers/cli run          (--local-ai or --exec for other runners)\n');
    }
    console.log('Connect this project to an MCP client (Claude Code, VS Code, ...):\n');
    console.log(`  npx @eventmodelers/cli init-mcp\n`);
    console.log('Expose these skills to other AI agent hosts (Cursor, Windsurf, Gemini CLI, Copilot, Codex CLI, Kiro, ...):\n');
    console.log(`  npx @eventmodelers/cli init-agents\n`);
}

// `agentTracing` in config.json: whether a build agent reports what each slice build cost to the
// platform (see agent-tracking.md). Asked once per project; off unless the user opts in — unset
// (e.g. --print installs) is off, and off means the runner sends nothing.
// `reask` (a bare `init-config`) asks again even when it is already set, defaulting to the
// current answer.
async function configureAgentTracing(configPath, print, reask = false) {
  const current = readJsonSafe(configPath);
  if (print || (typeof current.agentTracing === 'boolean' && !reask)) return;
  const agentTracing = await selectPrompt('Should EM-Studio track the agent cost of each slice?', [
    { label: 'Yes — track the cost per slice', value: true },
    { label: 'No — send nothing', value: false },
  ], current.agentTracing === true ? 0 : 1);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ ...current, agentTracing }, null, 2));
  console.log(`  ✓ Agent tracing ${agentTracing ? 'on' : 'off'} — change it with \`eventmodelers config --agent-tracing on|off\``);
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
  } else if (overrides.handover) {
    // A policy flag, not a credential — it must stick even when credentials were skipped.
    writeFileSync(configPath, JSON.stringify({ ...readJsonSafe(configPath), handover: true }, null, 2));
    console.log(`  ✓ Handover on — saved to ${relative(targetDir, configPath)}`);
  }
  return config;
}

// `re-init` for a build kit: re-copy shared/build-kit (ralph.js, the runners, tracing, adapters)
// over the installed kit, then re-run the config steps. Stack templates and skills are untouched.
async function refreshSharedRuntime({ targetDir, kitDir, globalOpts, opts }) {
  console.log(`📦 Refreshing the shared runtime in ${relative(targetDir, kitDir)}/ (stack files untouched)...`);
  copyDirContents(join(__dirname, 'shared', 'build-kit'), kitDir);
  // The kit is now this CLI's runtime — record that, so the startup "kit is outdated" hint stops.
  const manifestPath = join(kitDir, '.eventmodelers', 'install-manifest.json');
  if (existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ ...readJsonSafe(manifestPath), version: CLI_VERSION }, null, 2));
  }
  for (const script of ['ralph-claude.js', 'ralph-local-ai.js', 'ralph-exec.js', 'ralph-mastra.js', 'ralph-acp.js']) {
    const p = join(kitDir, script);
    if (existsSync(p)) {
      try { execSync(`chmod +x "${p}"`); } catch {}
    }
  }
  ensureLearningsGitRules(kitDir);
  console.log('📦 Installing kit dependencies...');
  try {
    execSync('npm install', { cwd: kitDir, stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    console.error('  ⚠️  npm install failed in kit — run it manually');
  }

  console.log('🔐 Configuring...');
  const configPath = globalOpts.config
    ? resolve(targetDir, globalOpts.config)
    : join(targetDir, '.eventmodelers', 'config.json');
  const overrides = { ...credentialOverridesFromOpts(opts), ...identityOverridesFromOpts(opts) };
  const cfg = await configureCredentials({
    config: loadEffectiveConfig(targetDir, kitDir, globalOpts.config).config,
    configPath,
    targetDir,
    requiredFields: ['organizationId', 'boardId', 'token'],
    overrides,
    print: globalOpts.print,
    force: opts.force,
  });
  ensureMcpRegistered(targetDir, cfg.baseUrl || DEFAULT_BASE_URL);
  ensureEnvToken(targetDir, cfg.token);
  ensureMcpEnabled(targetDir);
  await configureAgentTracing(configPath, globalOpts.print, true);
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

// `.mcp.json` alone does not make Claude Code use a server: a project server also has to be
// approved, and declining that prompt (or dismissing `/mcp`) in an interactive session writes
// `disabledMcpjsonServers` into `.claude/settings.local.json`, after which every later `claude` in
// the project — the runner's included — silently runs without the eventmodelers tools and the
// agent falls back to curl. Whoever starts the runner wants the server on, so this clears that
// entry and approves it explicitly. Only this project-local file is touched.
function ensureMcpEnabled(projectDir) {
  const settingsPath = join(projectDir, '.claude', 'settings.local.json');
  const settings = readJsonSafe(settingsPath);
  const disabled = settings.disabledMcpjsonServers ?? [];
  const enabled = settings.enabledMcpjsonServers ?? [];
  if (!disabled.includes('eventmodelers') && enabled.includes('eventmodelers')) return;
  settings.disabledMcpjsonServers = disabled.filter((n) => n !== 'eventmodelers');
  if (!settings.disabledMcpjsonServers.length) delete settings.disabledMcpjsonServers;
  settings.enabledMcpjsonServers = [...enabled, 'eventmodelers'].filter((n, i, a) => a.indexOf(n) === i);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
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

// The board whose credentials were written most recently — the best guess for "the board I
// was just driving" when nothing in this directory names one. Only offered as the default
// of the interactive question, never applied silently.
function lastUsedBoardId() {
  try {
    const dir = join(GLOBAL_DIR, 'boards');
    return readdirSync(dir)
      .filter((f) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(f))
      .map((f) => ({ id: f.slice(0, -5), mtime: statSync(join(dir, f)).mtimeMs, creds: readJsonSafe(join(dir, f)) }))
      .filter((b) => b.creds.token)
      .sort((a, b) => b.mtime - a.mtime)[0]?.id ?? null;
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
async function resolveModelingCredentials(cwd, flags, explicitConfigPath, print, nonInteractive = false, force = false) {
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
  //
  // The answer may also be the whole credentials blob from the account page — it names the
  // board too, so it answers this question and the "where do its credentials come from" one
  // below in a single paste.
  let boardChosen = !!(explicit.boardId || process.env.EVENTMODELERS_BOARD_ID);
  let pasted = null;
  if (!boardChosen && interactive) {
    boardId = boardId || lastUsedBoardId();
    const answer = await prompt(boardId ? `\n  Board ID [${boardId}]: ` : '\n  Board ID: ');
    if (answer) {
      pasted = parseCredentialsPaste(answer, ['organizationId', 'token', 'boardId']);
      boardId = pasted ? pasted.boardId : answer;
      boardChosen = true;
    }
  }

  let stored = pasted ?? (boardId ? readJsonSafe(boardCredentialsPath(boardId)) : {});

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
  if (!pasted && interactive && !credentialsNamed) {
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
    // --force: the stored answer is exactly what the user wants to replace, so don't offer it.
    if (existing && !force) choices.unshift({ label: `Keep the credentials already stored for this board (${existing.from})`, value: 'keep' });

    const configured = existing ? 'is already configured on this machine' : "hasn't been configured on this machine yet";
    const choice = await selectPrompt(
      boardId
        ? `Board ${boardId} ${configured}. Where should its credentials come from?`
        : `This board ${configured}. Where should its credentials come from?`,
      choices,
      // 'keep' when there is something to keep, else the pre-existing default: account-wide
      // when it actually holds credentials, otherwise the paste.
      (existing && !force) || hasAccountWide ? 0 : 1,
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

  // One identity per board and repo — the directory the run is started in — kept in ~/.eventmodelers/agent-ids.json, so a
  // standalone agent is the same agent on every start: its chat sessions, its star on the board and the prompts it holds
  // stay addressed to it. This is the id it keeps; whether this process may use it (another live run may already be
  // under it) is decided in the run action, which also lets `run --id` pin a different one. Not written into the
  // per-board credentials file below — the id is not a credential.
  config.agentId = stableGlobalAgentId({ file: join(GLOBAL_DIR, 'agent-ids.json'), boardId: config.boardId, dir: cwd });
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
// cold-spawn/task-queue loop for this kit (that's a build-kit concept; see the
// `run` command's build-kit-vs-modeling-kit gate above). It keeps ONE Claude
// process warm across turns via `--input-format stream-json`, subscribes to the
// org's realtime channel itself, and writes each prompt straight to that
// process's stdin as soon as it's fetched — no file round-trip, no polling delay,
// no re-discovery of a prompt this process already has in memory. Only pure,
// read-only config resolution (`loadLocalConfig`/`fetchPlatformConfig`) is reused
// from the kit's lib/config.js, to avoid duplicating the config-file-walk logic.
// See `.agent-modeling-kit/CLAUDE.md` for the core instructions this mode's modeling
// session follows. Each kind of turn has its steps in a file of its own — CLAUDE-PROMPTS.md,
// CLAUDE-CHAT.md and, for the self-directed turns below, CLAUDE-STANDALONE.md — read the first
// time that kind arrives, so a session never loads the kinds it does not get.
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
// A new instance of a loop starts by checking how big its event log has grown: at every multiple of 1000 events it
// asks whether to prune it (`events --prune` does the same on demand). Only asked where someone can answer.
async function offerPrune(kitDir, { interactive }) {
  let count;
  try { count = readEvents(kitDir).length; } catch { return; }
  if (!shouldOfferPrune(kitDir, count)) return;
  const prunable = prunableEvents(readEvents(kitDir)).length;
  if (!interactive) {
    console.error(`ℹ️  The event log has ${count} events (${prunable} of them prunable) — \`eventmodelers events --prune\` removes them.`);
    return;
  }
  const answer = (await prompt(`The event log has ${count} events. Should we prune the log? Removes the journal of finished prompts (${prunable} events); slice state and learnings stay. [y/N] `)).toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    const { removed, kept } = pruneLog(kitDir);
    rememberPruneAnswer(kitDir, kept);
    console.log(`Pruned ${removed} events, ${kept} left.\n`);
  } else {
    rememberPruneAnswer(kitDir, count);
  }
}

async function runModeling(kitDir, projectDir, { codeDir = null, verbose = false, standalone = false, exclusive = false, worker = false, overrides = null, maxAgents = DEFAULT_MAX_AGENTS, identity = {}, localAi = null, exec = null, mastra = false, acp = null, resetSession = false, model = null, skipPermissions = false, browser = false } = {}) {
  // --worker: only prompts — no chat, and no board-change turns (it has nowhere to propose).
  const chat = !worker;
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
  const local = overrides ? { ...overrides } : applyEnvOverrides(loadLocalConfig(kitDir));
  // The global install's overrides carry their own agent id, kept per board in
  // ~/.eventmodelers/boards/<board>.json — one dir driving several boards must not have
  // them all upsert one shared alive row. A project install keeps its id in the project
  // root config, namespaced by agent type, as it always has.
  // `run --id` overrides that for this run only — ensureAgentId is skipped rather than
  // overwritten, so the project's own stable id stays on disk and the next run without the
  // flag is the same agent the platform saw before.
  if (!overrides) {
    if (identity.agentId) {
      local.agentId = identity.agentId;
    } else {
      // The project's stable id — unless a live process already runs under it (two `run --modeling` in one
      // project), in which case this one gets a fresh id (agent-lock.js).
      const { agentId, fellBack } = acquireAgentId({ lockDir: join(projectDir, '.eventmodelers', 'locks'), stableId: ensureAgentId(kitDir, 'MODELING') });
      local.agentId = agentId;
      local.agentIdFellBack = fellBack;
    }
  }
  if (!local.token || !local.organizationId) {
    console.error('❌ --modeling needs platform credentials in .eventmodelers/config.json (token + organizationId) — run `/connect` once or paste your config first.');
    process.exit(1);
  }
  // The identity flags go on last: the global install's `overrides` carry the agent id
  // resolveModelingCredentials just minted for this run, which would otherwise win back over
  // an explicit --id.
  const cfg = { ...applyEnvOverrides(await fetchPlatformConfig(local)), ...(overrides ?? {}), ...(identity.agentId ? { agentId: identity.agentId } : {}), ...(identity.agentName ? { agentName: identity.agentName } : {}), ...(model ? { model } : {}) }; // adds realtimeProvider + its provider-specific fields (supabaseUrl/supabaseAnonKey or pocketbaseUrl), + boardId if the config has a default one
  // No name given (--name, agentName in the config): the repository's, so the board shows which agent is live.
  // (On the global install projectDir is ~/.eventmodelers/kit; the repo is the directory the run was started in.)
  if (!cfg.agentName) {
    const base = defaultAgentName(codeDir ?? projectDir, 'MODELING');
    cfg.agentName = cfg.agentIdFellBack ? withInstanceSuffix(base, cfg.agentId) : base;
  }
  // Learnings are kept only on a project install: the global install's kit dir (~/.eventmodelers/kit) is shared by every
  // board and account, so what one board taught the agent would end up in another's AGENTS.md. The prompt journal has no
  // such problem — every entry is stamped with its board (`events --board`) — so every run keeps it, standalone included.
  const keepsRecord = !standalone && !overrides;
  // The prompt journal is written by every run, standalone included, so the ignore rules are too.
  ensureLearningsGitRules(kitDir);
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
      localRunner = createModelingLocalAiRunner({ cfg, target: localAi, log, verbose, standalone, onToolUse: (name, input) => { const id = `local-${++localCallSeq}`; noteToolStart(id, name, input); return (outcome) => noteToolEnd(id, outcome); } });
    } catch (err) {
      console.error(`❌ --local-ai: ${err.message}`);
      process.exit(1);
    }
  }
  // --exec: any agent harness, one process per turn (lib/modeling-exec.js). Unlike a local model
  // it brings its own tool loop and reads the kit — CLAUDE.md and whatever skills `init-agents`
  // installed for it — so its turns keep the session header; what it lacks is the Agent tool, so
  // they drop the fan-out like a local model's do. Imported only here: its turn supervisor
  // installs signal handlers on import, which no other command should get.
  let execRunner = null;
  if (exec) {
    const { createModelingExecRunner } = await import('./lib/modeling-exec.js');
    try {
      execRunner = createModelingExecRunner({ cfg, command: exec === true ? cfg.localAi?.exec : exec, projectDir, log });
    } catch (err) {
      console.error(`❌ --exec: ${err.message}`);
      process.exit(1);
    }
  }
  // --agent mastra: a warm Mastra agent in this process (lib/modeling-mastra.js). It has the exec runner's shape — it
  // takes a turn's text, works the board over MCP and answers — so it takes that runner's place everywhere below.
  // What it changes is that the session stays up: the header goes in once and the standalone warm-up turn pays off.
  if (mastra) {
    const { createModelingMastraRunner } = await import('./lib/modeling-mastra.js');
    try {
      execRunner = await createModelingMastraRunner({
        cfg, model: model ?? cfg.mastra?.model, projectDir, codeDir, log,
        onToolUse: (name, input) => { const id = `mastra-${++localCallSeq}`; noteToolStart(id, name, input); return (outcome) => noteToolEnd(id, outcome); },
      });
    } catch (err) {
      console.error(`❌ --agent mastra: ${err.message}`);
      process.exit(1);
    }
  }
  // --agent <name> --acp / --acp-cmd: one warm agent process speaking the Agent Client Protocol (lib/modeling-acp.js).
  // Same slot and same shape as mastra's runner: the session stays up, so the header goes in once.
  if (acp) {
    const { createModelingAcpRunner } = await import('./lib/modeling-acp.js');
    execRunner = createModelingAcpRunner({
      cfg, agent: acp, projectDir, log, verbose,
      onToolUse: (name, input) => { const id = `acp-${++localCallSeq}`; noteToolStart(id, name, input); return (outcome) => noteToolEnd(id, outcome); },
    });
  }
  // The runner that is not the warm `claude` process, if any — for the few places that only care
  // whether one is.
  const otherRunner = localRunner ?? execRunner;

  const QUESTIONING_RULE =
    'IMPORTANT: You are running autonomously — no human is available to answer questions. ' +
    'If you need clarification to proceed, do NOT pause or ask interactively. Instead, post your question ' +
    'as a QUESTION-type comment (via /handle-comment with action=place and type=QUESTION) on the most ' +
    'relevant slice or column node on the board, then continue with your best interpretation of the prompt. ' +
    'The one exception is a CHAT turn: there a person is waiting in the chat, so you ask back with post_chat_message ' +
    '(see .agent-modeling-kit/CLAUDE-CHAT.md), and never by pausing the session. ' +
    'A chat message is at most 1000 characters.\n\n';

  // CLAUDE.md is the core; each kind of turn has its steps in a file of its own that the agent reads the first time that
  // kind arrives (CLAUDE-STANDALONE.md works the same way). The pointer rides on every such turn, so it needs no state
  // to survive a respawn or an exec runner's fresh process — and says where the rules are in a kit from before the split.
  const turnSteps = (file) => `Steps for this turn: .agent-modeling-kit/${file} — read it now if you have not this session (an older kit keeps them in CLAUDE.md).`;

  // An exec turn is a fresh process on every turn, so the kit's connect step would run — and
  // re-verify the same credentials — once per message. It has nothing left to do: registerMcp
  // (lib/modeling-exec.js) put the eventmodelers server into the harness's config before the
  // first turn, authenticated from the env this process hands it. The credentials in the header
  // stay, for the skills' REST fallback.
  const EXEC_CONNECTED =
    'The eventmodelers MCP server is already registered and authenticated for you, so you are connected: ' +
    'do NOT run /connect and do not check any MCP config file — wherever the kit or a skill says to connect ' +
    'first, that is already done. Use the eventmodelers tools directly, with the board_id of this turn. The ' +
    'credentials above are only for a REST fallback, should a tool you need be missing.\n\n';

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
    // token= names the env var, never its value: claudeEnv already carries EVENTMODELERS_TOKEN,
    // and a literal token here would sit in every session transcript (the connect skill treats
    // the reference as an inline token — see its Step 0).
    // Nothing to prepend for a local model: it has no CLAUDE.md to read and no /connect to run
    // (its tools are already authenticated), and handing it the raw token would put credentials
    // in a context that has no way to use them.
    if (localRunner) return body;
    // Every exec turn is a fresh process — a new session that has read nothing, so each one gets
    // the header its first turn would.
    if (!firstTurn && !(execRunner && !execRunner.keepsSession)) return body;
    firstTurn = false;
    return `MODE=modeling token=$EVENTMODELERS_TOKEN org=${cfg.organizationId} baseUrl=${cfg.baseUrl} standalone=${standalone ? 'on' : 'off'}${standalone ? ` max_agents=${maxAgents}` : ''} subagent_model=${subagentModel}\n\n${QUESTIONING_RULE}${execRunner?.mcpRegistered ? EXEC_CONNECTED : ''}Read .agent-modeling-kit/CLAUDE.md now and follow it for every prompt in this session — it's a one-time read; don't re-read it on later turns. It names the file with the steps for each kind of turn (prompt, chat, board change); read each the first time that kind arrives.\n\n${body}`;
  }

  function buildTurn(p) {
    const fields = [
      `prompt_id=${p.id}`,
      `board_id=${p.board_id ?? cfg.boardId ?? ''}`,
      `organization_id=${p.organization_id ?? cfg.organizationId}`,
      p.timeline_id ? `timeline_id=${p.timeline_id}` : null,
      p.comment_id ? `comment_id=${p.comment_id}` : null,
      p.node_id ? `node_id=${p.node_id}` : null,
      // Work the agent created out of a chat message: where to report back when it's done.
      p.origin_session_id ? `origin_session_id=${p.origin_session_id}` : null,
      p.origin_message_id ? `origin_message_id=${p.origin_message_id}` : null,
    ].filter(Boolean).join(' ');
    // What the user had selected and on screen when they submitted (selectedCell,
    // selectedNodes, timelineId, focusArea). references/resolving-target.md resolves CELL_ID/NODE_ID/
    // TIMELINE_ID from it in preference to the flat fields above, and it is what "this" or
    // "here" in the prompt refers to. Sent as JSON on its own line because it is structured,
    // unlike the flat k=v fields.
    const context = p.context && typeof p.context === 'object' && Object.keys(p.context).length
      ? `\ncontext=${JSON.stringify(p.context)}`
      : '';
    return withSessionHeader(`${fields}${context}\n${turnSteps('CLAUDE-PROMPTS.md')}\n\n${p.prompt}`);
  }

  // Locked down, not --dangerously-skip-permissions: this agent takes chat messages and snippet clicks from any
  // collaborator on the board. Anything not explicitly allowed is refused without asking; the only MCP server is the
  // platform's; Bash runs only the allowlisted commands, curl only to cfg.baseUrl (lib/agent-permissions.js,
  // lib/bash-guard.js). The operator's own --dangerously-skip-permissions restores the old approve-everything mode.
  const permissions = skipPermissions
    ? { args: ['--dangerously-skip-permissions'] }
    : modelingPermissions({
      baseUrl: cfg.baseUrl,
      projectDir,
      codeDir,
      tmpDir: tmpdir(),
      hookCommand: `"${process.execPath}" "${fileURLToPath(new URL('./lib/bash-guard-hook.js', import.meta.url))}"`,
      browser,
    });
  if (skipPermissions) {
    console.warn('⚠️  --dangerously-skip-permissions: every tool call this agent makes is approved — any shell command, curl to anywhere, any file you can read or write. Anyone who can chat with it on this board can make it do that.\n');
  }
  const claudeArgs = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...permissions.args];
  if (cfg.model) claudeArgs.push('--model', cfg.model);
  // The global install runs in ~/.eventmodelers/kit, away from the code base the person started
  // the agent in — hand that directory over so code-reading skills (detect-model-drift)
  // can still see it.
  if (codeDir) claudeArgs.push('--add-dir', codeDir);
  const claudeEnv = {
    ...process.env,
    // What the skills' curl fallback writes as $BASE_URL / $ORG_ID / $BOARD_ID. Set here, not inherited: the Bash guard
    // treats $BASE_URL as the platform, so a BASE_URL from the operator's own shell must never reach the agent. The
    // guard's own env is left out entirely with --dangerously-skip-permissions, which runs with the environment as before.
    ...(skipPermissions ? {} : {
      ...permissions.env,
      BASE_URL: cfg.baseUrl,
      ORG_ID: cfg.organizationId,
      BOARD_ID: cfg.boardId,
      // The skills' curl headers say "x-token: $TOKEN"; the guard lets the token expand only inside a curl -H value.
      TOKEN: cfg.token,
    }),
    ...(codeDir ? { EVENTMODELERS_CODE_DIR: codeDir } : {}),
    ...(cfg.anthropicBaseUrl ? { ANTHROPIC_BASE_URL: cfg.anthropicBaseUrl } : {}),
    EVENTMODELERS_TOKEN: cfg.token,
    // What the connect skill puts in `.mcp.json`'s x-agent-id header and every curl-fallback
    // call, so the board work this agent does on the platform is attributed to this agent.
    ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
  };

  let proc = null;
  let stdoutBuffer = '';
  let pending = null; // one in-flight turn at a time
  let turnPromptId = null; // the prompt the current turn works, so the board writes it makes are journaled against it
  // A call is journaled when it ends, so its entry carries how long it took (see journalPromptAction). Only the calls the
  // journal will keep are tracked at all.
  const calls = createCallTracker();
  let localCallSeq = 0;
  const journalCall = (call) => journal(() => journalPromptAction({ kitDir, id: turnPromptId, toolName: call.name, input: call.input, verbose, detail: verbose ? describeToolUse(call) : undefined, secrets: [cfg.token], startedAt: call.startedAt, durationMs: call.durationMs, error: call.error, meta: journalMeta }));
  const noteToolStart = (id, name, input) => {
    if (turnPromptId && shouldJournalCall(name, input, verbose)) calls.begin(id, { name, input });
  };
  const noteToolEnd = (id, outcome) => {
    const call = calls.end(id, outcome);
    if (call) journalCall(call);
  };
  // The last message of each session this process has handed to Claude. A session the process has
  // never seen is read whole; after that only what came since — each message enters the warm
  // session's context once. Cleared whenever the process is (re)spawned: a fresh process has read
  // nothing.
  const chatCursor = new Map();
  // --modeling: the people this agent has taken a chat message from — the only ones whose board
  // edits it proposes on. Everyone else's edits cost no turn: an agent one person started must not
  // spend their money reacting to the whole board, nor write to people who never talked to it. Kept
  // across respawns (it is about people, not the Claude process), lost when the CLI restarts.
  const chatPartners = new Set();
  // When each partner was last sent a proposal. The backend lets an unanswered proposal stand for
  // UNPROMPTED_COOLDOWN_MS before another; waiting here keeps a turn from being spent on one it
  // would refuse. Cleared when the person writes in the chat.
  const lastProposalAt = new Map();

  let lastTurnEndedAt = 0; // when the last turn finished — the standalone lane's echo window (see below)
  const turnUsage = createTurnUsage(); // what each turn cost and where its tokens went (--verbose prints it)
  let compactRequested = false; // a chat was cleared: the next turn starts with a /compact of the warm conversation
  let compacting = false; // the in-flight turn is the /compact, not work: its figures are nobody's to record
  let chatSessionId = null; // the chat session the in-flight turn answers, if it is a chat turn — what its cost is filed under
  let postedSessionId = null; // ...or the session a message the agent started itself (post_chat_message) landed in during a board-change/standalone turn
  const postToolIds = new Set(); // tool_use ids of post_chat_message calls in flight

  // The cost popup on an agent's chat message reads the turn that wrote it from the platform. Best effort: a turn that
  // cannot be recorded is not worth failing for, and only chat turns have a session to file it under.
  function recordChatTurn(turn) {
    const sessionId = chatSessionId ?? postedSessionId;
    postedSessionId = null;
    postToolIds.clear();
    if (!turn || !sessionId) return;
    void fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/agent-turns`, {
      method: 'POST',
      headers: { 'x-token': cfg.token, 'Content-Type': 'application/json', ...agentHeaders(cfg) },
      body: JSON.stringify({ ...turn, sessionId, ...(cfg.agentId ? { agentId: cfg.agentId } : {}), occurredAt: new Date().toISOString() }),
    }).catch((err) => log(`agent-turns: could not record the turn (${err.message})`));
  }
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
  // The message the agent just wrote tells which session it went into — the turn's cost is filed there.
  function notePostedSession(block) {
    if (!postToolIds.has(block.tool_use_id) || block.is_error) return;
    const raw = typeof block.content === 'string' ? block.content : (Array.isArray(block.content) ? block.content.map((c) => c?.text ?? '').join('') : '');
    try { const m = JSON.parse(raw); postedSessionId = m?.sessionId ?? m?.session_id ?? postedSessionId; } catch { /* not a message: nothing to file under */ }
  }

  function handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) if (block.type === 'tool_result') { notePostedSession(block); noteToolEnd(block.tool_use_id, { isError: block.is_error }); turnUsage.toolResult(block.tool_use_id, block.content); }
      return;
    }

    if (msg.type === 'assistant') {
      turnUsage.assistantUsage(msg.message?.usage);
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text && verbose) log(block.text);
        if (block.type === 'tool_use') {
          noteToolStart(block.id, block.name, block.input);
          if (/post_chat_message$/.test(block.name ?? '')) postToolIds.add(block.id);
          turnUsage.toolUse(block.id, block.name);
          if (verbose) log(`→ ${describeToolUse(block)}`);
          else if (block.name === 'Skill') log(`→ Skill: ${block.input?.skill ?? ''}`);
          else log(`→ ${block.name}`);
        }
      }
      return;
    }
    if (msg.type === 'result') {
      log(`done (${msg.duration_ms}ms${msg.total_cost_usd ? `, $${msg.total_cost_usd.toFixed(4)}` : ''})`);
      const usageLine = turnUsage.finish(msg);
      if (verbose) log(usageLine);
      if (!compacting) recordChatTurn(turnUsage.lastTurn());
      lastTurnEndedAt = Date.now();
      const turn = pending;
      pending = null;
      // The result text is what a standalone turn's NOOP/DONE answer rides in — the
      // self-directed lane reads it to decide whether to back off (dispatchStandaloneTurn).
      if (turn) (msg.is_error ? turn.reject(new Error(msg.result || 'Claude turn errored')) : turn.resolve(msg.result ?? ''));
    }
  }

  function spawnProcess() {
    const child = spawn('claude', claudeArgs, { cwd: projectDir, env: claudeEnv, stdio: ['pipe', 'pipe', 'inherit'] });
    proc = child;
    stdoutBuffer = '';
    warmUp = null; // a fresh process has connected to nothing and read nothing
    chatCursor.clear(); // …and has read no chat session either
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const l of lines) handleLine(l);
    });
    child.on('exit', (code) => {
      if (child.resetByCli) return; // --reset-session already detached it; whatever runs now is not this process
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

  // --reset-session on the default runner: the next turn gets a fresh `claude` — a new conversation — instead of the
  // one that has carried every turn so far. The old process is detached at once, not when its exit arrives: a turn
  // that starts in between must find no process and spawn its own, and the old one's output and exit must not touch it.
  function resetClaudeSession() {
    if (!proc || pending) return; // nothing running, or a turn still in flight — never cut one off
    const old = proc;
    old.resetByCli = true;
    old.stdout.removeAllListeners('data');
    proc = null;
    stdoutBuffer = '';
    firstTurn = true; // a respawned process is a fresh session — needs MODE=modeling again
    warmUp = null; // …and a fresh warm-up before its first real turn
    warmingUp = false;
    chatCursor.clear();
    old.kill();
    log('session reset — the next turn starts a fresh conversation');
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
    // An exec runner with a session of its own (Cursor's chat) is warmed through that session.
    warmUp = (execRunner ? execRunner.runTurn(buildWarmUpTurn()) : sendTurn(buildWarmUpTurn()))
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
  // Turns in flight, what the heartbeat's `status` says: modeling while there is one, idle otherwise. A change is
  // reported at once (`reportStatus`, set once the heartbeat exists) instead of waiting for the next 15s ping.
  let turnsInFlight = 0;
  let reportStatus = () => {};
  async function runTurn(text) {
    turnsInFlight++;
    reportStatus();
    try {
      if (otherRunner) return await otherRunner.runTurn(text);
      if (!proc) spawnProcess();
      await warmUpSession();
      // The person cleared a chat: the history the warm conversation carries is shrunk to a summary first, so it stops being re-read on every call.
      if (compactRequested) {
        compactRequested = false;
        log('compacting the conversation before this turn (a chat was cleared)');
        compacting = true;
        try { await sendTurn('/compact'); } catch (err) { log(`compaction failed (the turn goes on without it): ${err.message}`); } finally { compacting = false; }
      }
      return await sendTurn(text);
    } finally {
      turnsInFlight--;
      reportStatus();
    }
  }

  if (!otherRunner) spawnProcess();
  log(`agent: ${cfg.agentName ? `${cfg.agentName} (${cfg.agentId})` : cfg.agentId} — eventmodelers-cli v${CLI_VERSION}`);
  if (localRunner) log(`runner: local model — ${localRunner.describe()} (board tools over MCP; no skills, no subagents)`);
  if (execRunner) log(`runner: ${execRunner.describe()} — ${mastra || acp ? 'one warm session' : 'one process per turn'} (skills from the kit; no subagents)`);
  log(
    standalone
      ? `standalone: ON — reacting to direct prompts AND to board changes on its own initiative (${localRunner ? 'work is done inline — a local model has no subagents' : execRunner ? 'work is done inline — an exec agent has no subagents' : `max ${maxAgents} subagent(s) per self-directed turn`})`
      : worker
        ? 'worker: ON — working prompts only (no chat, board changes are dropped)'
        : 'standalone: off — board changes get a proposal in the chat, nothing is changed without a yes',
  );
  log(chat ? 'chat: ON — answering chat messages addressed to this agent' : 'chat: off (--worker)');
  if (exclusive) {
    log(`exclusive: ON — only prompts addressed to ${cfg.agentId} are worked; every untargeted prompt is handed back to the queue`);
    // A run keeps its stable id unless another live process is already running under it (agent-lock.js), in which
    // case it got a fresh one — and an id someone addressed a prompt to is not this agent. Worth saying out loud here,
    // where the alternative is an agent that looks healthy and quietly works nothing.
    if (cfg.agentIdFellBack) log('exclusive: another process is already running under this agent\'s usual id, so this run got a fresh one — star it on the board now, or stop the other process and restart');
  }
  // Both warm-ups are the same bet — pay the session's fixed setup cost before a turn arrives
  // rather than making whoever sends the first prompt wait for it. For a local model that cost
  // is the MCP tool set; for Claude it is reading CLAUDE.md and running /connect.
  // An exec runner without a session has nothing to warm: every turn is its own process, so a warm-up
  // would connect one that exits right after. One with a session (Cursor's chat) does — the chat outlives the process.
  if (localRunner) localRunner.warmUp().catch((err) => log(`local-ai warm-up failed (the first turn will retry): ${err.message}`));
  else if (!execRunner || execRunner.hasSession) warmUpSession();

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
    if (!res.ok) throw Object.assign(new Error(`prompts/${promptId}/status: HTTP ${res.status}`), { status: res.status });
  }

  // The prompts the platform shows as held (CLAIMED / IN_PROGRESS) under this agent's id — GET /prompts?claimed_by=,
  // which reads and claims nothing. At start an agent holds none, so these are what an earlier run left behind.
  async function fetchHeldPrompts(agentId) {
    const { url, headers } = heldPromptsRequest({ baseUrl: cfg.baseUrl, organizationId: cfg.organizationId, boardId: cfg.boardId, token: cfg.token, jwt: realtimeToken, agentId });
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`prompts list: HTTP ${res.status}`);
    return ((await res.json()).prompts ?? []).map((p) => ({ id: p.id, status: p.status }));
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  //
  // Chat messages are conversation, not work: a person talks to this agent in the board's chat
  // panel, and each message addressed to it is claimed here (`chat/next` flips it to picked_up)
  // and handed to Claude as a CHAT turn. Claude decides — answer, ask back, or create prompts for
  // the work — and replies with post_chat_message; any prompts it creates are addressed to this
  // agent and worked by the same drain pass right after. Off with --worker.
  async function fetchNextChatMessage(jwtToken) {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/chat/next?board_id=${encodeURIComponent(cfg.boardId)}`, {
        headers: { 'x-token': cfg.token, Authorization: `Bearer ${jwtToken}`, ...agentHeaders(cfg) },
      });
      // 404 is "nothing waiting" — and also what a backend without chat answers, which is fine.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (err) {
      // Never let chat take the prompt queue down with it: log, skip chat for this pass.
      log(`chat/next failed, skipping chat this pass: ${err.message}`);
      return null;
    }
  }

  // The files of a chat message, fetched once into the OS temp dir and handed to the turn as paths:
  // the agent reads a local file as often as it likes, where get_chat_attachment would pull the bytes
  // over the wire (and into its context) on every call. Keyed by session and attachment id, so a
  // restart, a retry or a later turn of the same chat finds the file already there. Never fatal — a
  // failed download just leaves the path out, and the agent falls back to get_chat_attachment.
  async function cacheChatAttachments(m) {
    const files = [];
    for (const a of Array.isArray(m.attachments) ? m.attachments : []) {
      if (a?.summary) continue; // already read once — the turn works from the summary, nothing to fetch
      if (!/^[0-9a-f-]{36}$/i.test(a?.id ?? '') || !/^[a-z0-9]{1,8}$/i.test(a?.ending ?? '')) continue;
      const dir = join(tmpdir(), 'eventmodelers-chat-attachments', m.sessionId);
      const path = join(dir, `${a.id}.${a.ending}`);
      try {
        if (!existsSync(path)) {
          const res = await fetch(
            `${cfg.baseUrl}/api/org/${cfg.organizationId}/chat/sessions/${encodeURIComponent(m.sessionId)}/attachments/${a.id}?board_id=${encodeURIComponent(cfg.boardId)}`,
            { headers: { 'x-token': cfg.token, ...agentHeaders(cfg) } },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          mkdirSync(dir, { recursive: true });
          writeFileSync(path, Buffer.from(await res.arrayBuffer()));
        }
        files.push({ id: a.id, path });
      } catch (err) {
        log(`chat attachment ${a.id} not cached: ${err.message}`);
      }
    }
    return files;
  }

  function buildChatTurn(m, cachedFiles = []) {
    const after = chatCursor.get(m.sessionId);
    const fields = [
      `CHAT message_id=${m.id}`,
      `session_id=${m.sessionId}`,
      `board_id=${cfg.boardId}`,
      `organization_id=${cfg.organizationId}`,
      after ? `after_message_id=${after}` : 'first_read=true',
      m.nodeId ? `node_id=${m.nodeId}` : null,
      m.commentId ? `comment_id=${m.commentId}` : null,
      // The file(s) the person attached — read with get_chat_attachment (see CLAUDE-CHAT.md).
      Array.isArray(m.attachments) && m.attachments.length ? `attachments=${JSON.stringify(m.attachments)}` : null,
      cachedFiles.length ? `attachment_files=${JSON.stringify(cachedFiles)}` : null,
    ].filter(Boolean).join(' ');
    // A custom snippet type's `then` is a collaborator's text, not the person's or ours: it leaves the context JSON
    // and follows the message in a fenced block with the rule for it (lib/snippet-guard.js).
    const guarded = guardSnippetReply(m.context, randomUUID().slice(0, 8));
    const context = guarded.context && typeof guarded.context === 'object' && Object.keys(guarded.context).length
      ? `\ncontext=${JSON.stringify(guarded.context)}`
      : '';
    return withSessionHeader(`${fields}${context}\n${turnSteps('CLAUDE-CHAT.md')}\n\n${m.text}${guarded.block ? `\n\n${guarded.block}` : ''}`);
  }

  // The backend rejects a chat message over this many characters (CHAT_TEXT_TOO_LONG).
  const CHAT_TEXT_MAX_LENGTH = 1000;

  // Posted only if the turn didn't answer — the backend checks (only_if_unanswered), so a reply
  // the agent did post is never doubled. What makes "every message gets an answer" hold even for a
  // turn that errored or forgot its post_chat_message.
  async function replyIfUnanswered(m, text) {
    try {
      const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${encodeURIComponent(cfg.boardId)}/chat/agent-messages`, {
        method: 'POST',
        headers: { 'x-token': cfg.token, 'Content-Type': 'application/json', ...agentHeaders(cfg) },
        // A turn's final text can run long; cut it rather than lose the reply to a 400.
        body: JSON.stringify({
          text: text.length > CHAT_TEXT_MAX_LENGTH ? `${text.slice(0, CHAT_TEXT_MAX_LENGTH - 1)}…` : text,
          reply_to: m.id,
          only_if_unanswered: true,
        }),
      });
      if (!res.ok) log(`chat fallback reply failed: HTTP ${res.status}`);
      else if (res.status === 201) log(`chat turn left message ${m.id} unanswered — posted its final text as the reply`);
    } catch (err) {
      log(`chat fallback reply failed: ${err.message}`);
    }
  }

  // Every CLEAR_OFFER_EVERY messages of a conversation the agent offers, in the chat, to clear it. The answer is the person's: nothing is
  // cleared on a "no", or without a click. The counts are this process's (a restart starts counting again), two per exchange — the message and its reply.
  const CLEAR_OFFER_EVERY = 25;
  const CLEAR_HEADLINE = 'Your chat history is growing — should we clear it? The messages are deleted and I start fresh.';
  const CLEAR_YES = 'Clear history';
  const CLEAR_NO = 'Keep it';
  const chatCounts = new Map(); // sessionId -> messages seen
  const clearOffered = new Set(); // sessions with an offer waiting for an answer

  async function agentPost(body) {
    const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${encodeURIComponent(cfg.boardId)}/chat/agent-messages`, {
      method: 'POST',
      headers: { 'x-token': cfg.token, 'Content-Type': 'application/json', ...agentHeaders(cfg) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // The answer to the offer is a chat message whose text is the clicked label and the quoted headline (the confirm snippet's own wording).
  function clearAnswer(m) {
    const text = String(m.text ?? '');
    if (text.startsWith(`${CLEAR_YES} – `) && text.includes(CLEAR_HEADLINE.slice(0, 40))) return 'yes';
    if (text.startsWith(`${CLEAR_NO} – `) && text.includes(CLEAR_HEADLINE.slice(0, 40))) return 'no';
    return null;
  }

  // Handled here, without a model turn. Returns true when the message was the answer to the offer.
  async function handleClearAnswer(m) {
    const answer = clearAnswer(m);
    if (!answer) return false;
    clearOffered.delete(m.sessionId);
    if (answer === 'no') {
      chatCounts.set(m.sessionId, 0); // asked again after another stretch, not at once
      await agentPost({ text: 'Okay, we keep it.', reply_to: m.id }).catch((err) => log(`chat reply failed: ${err.message}`));
      return true;
    }
    try {
      const res = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/boards/${encodeURIComponent(cfg.boardId)}/chat/agent-sessions/${encodeURIComponent(m.sessionId)}`, {
        method: 'DELETE',
        headers: { 'x-token': cfg.token, ...agentHeaders(cfg) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      chatCounts.delete(m.sessionId);
      chatCursor.delete(m.sessionId);
      compactRequested = true; // the history this process carries goes too — not by killing it, by compacting it before its next turn
      log(`chat session ${m.sessionId} cleared at the person's request — compacting the conversation before the next turn`);
    } catch (err) {
      log(`clearing the chat failed: ${err.message}`);
    }
    return true;
  }

  async function offerClear(m) {
    const n = (chatCounts.get(m.sessionId) ?? 0) + 2;
    chatCounts.set(m.sessionId, n);
    if (n < CLEAR_OFFER_EVERY || clearOffered.has(m.sessionId)) return;
    clearOffered.add(m.sessionId);
    try {
      await agentPost({
        text: `${CLEAR_HEADLINE} (${CLEAR_YES} / ${CLEAR_NO})`,
        session_id: m.sessionId,
        snippet: { kind: 'confirm', headline: CLEAR_HEADLINE, yesLabel: CLEAR_YES, noLabel: CLEAR_NO },
      });
      chatCounts.set(m.sessionId, 0);
      log(`offered to clear the long chat session ${m.sessionId}`);
    } catch (err) {
      clearOffered.delete(m.sessionId);
      log(`clear offer failed: ${err.message}`);
    }
  }

  async function runChatTurn(m) {
    log(`chat message received: "${oneLine(m.text, 80)}" (session=${m.sessionId})`);
    if (await handleClearAnswer(m)) return;
    if (m.userId) {
      chatPartners.add(m.userId);
      lastProposalAt.delete(m.userId);
    }
    let result = '';
    let failed = false;
    try {
      const turn = buildChatTurn(m, await cacheChatAttachments(m));
      chatSessionId = m.sessionId;
      result = await runTurn(turn);
    } catch (err) {
      failed = true;
      log(`chat turn failed: ${err.message}`);
    } finally {
      chatSessionId = null;
    }
    chatCursor.set(m.sessionId, m.id);
    const text = String(result ?? '').replace(/<promise>[^<]*<\/promise>/g, '').trim();
    await replyIfUnanswered(m, text && !failed ? text : 'Sorry — I could not finish that just now. Please try again.');
    await offerClear(m);
    // Edits they made while their last proposal waited for this answer get their turn now.
    if (m.userId && proposalBuffer.has(m.userId)) armProposalTurn(STANDALONE_DEBOUNCE_MS);
  }

  let realtimeToken = await getRealtimeToken();

  // What this agent writes into its own record: events in the kit, stamped with who and where (learnings: see keepsRecord).
  const journalMeta = { agent_id: cfg.agentId, agent_type: 'MODELING', organization_id: cfg.organizationId, board_id: cfg.boardId };
  const journal = (write) => {
    try { write(); } catch (err) { log(`could not write the prompt journal: ${err.message}`); }
  };

  // Prompts an earlier run of this agent was holding are still CLAIMED / IN_PROGRESS — the platform never re-queues
  // them by itself. This run holds none yet, so whatever the platform shows as held under this agent's id goes back.
  {
    const recovered = await recoverOwnPrompts({ kitDir, meta: journalMeta, agentId: cfg.agentId, fetchHeld: fetchHeldPrompts, release: releasePrompt });
    if (recovered.released || recovered.settled || recovered.left) {
      log(`prompts from an earlier run: ${recovered.released} handed back, ${recovered.settled} already settled${recovered.left ? `, ${recovered.left} left for the next start` : ''}`);
    }
  }

  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    // --exclusive only: prompts claimed in this pass that weren't addressed to this agent,
    // handed back once the pass is over (see below).
    const handBack = [];
    try {
      for (;;) {
        // A person waiting in the chat goes first; a prompt the chat turn created is picked up
        // by the fetch below on this same pass.
        const m = chat ? await fetchNextChatMessage(realtimeToken) : null;
        if (m) {
          await runChatTurn(m);
          continue;
        }
        const p = await fetchNextPrompt(realtimeToken);
        if (p === null) break;
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
        journal(() => journalPromptReceived({ kitDir, prompt: p, meta: journalMeta }));
        try {
          turnPromptId = p.id;
          const reply = await runTurn(buildTurn(p));
          // The agent cannot run `learn` or `info` (locked-down Bash), so it states them in its reply and they are recorded here.
          // Best effort: a failed write never takes the prompt queue down. Infos are events stamped with their board, so every
          // run records them — standalone included; learnings are kept only where `keepsRecord` (they feed AGENTS.md).
          try {
            if (keepsRecord) {
              const n = recordTurnLearnings({ kitDir, reply, meta: journalMeta });
              if (n) log(`recorded ${n} learning${n === 1 ? '' : 's'} from the turn`);
            }
            const infos = recordTurnInfos({ kitDir, reply, meta: journalMeta });
            if (infos) log(`recorded ${infos} info event${infos === 1 ? '' : 's'} from the turn`);
          } catch (err) {
            log(`could not record the turn's learnings or infos: ${err.message}`);
          }
          journal(() => journalPromptFinished({ kitDir, id: p.id, outcome: 'worked', meta: journalMeta }));
        } catch (err) {
          // Not finished: the entry stays open, so the next start asks the platform about it and hands it back
          // (or closes it if the agent had set DONE before the turn failed).
          log(`turn failed: ${err.message}`);
        } finally {
          for (const call of calls.drain()) journalCall(call); // never ended: the turn died mid-call, so no duration
          turnPromptId = null;
          // --reset-session: a prompt is self-contained work, so the next turn starts a fresh conversation rather than
          // carrying this one's reads and renders along.
          if (resetSession) { if (otherRunner) otherRunner.resetSession?.(); else resetClaudeSession(); }
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
  // Whether board changes get a turn at all, and what that turn may do. --standalone acts on its
  // own initiative, on everyone's edits. A plain --modeling agent only proposes, and only to the
  // people talking to it in the chat — about their own edits (the propose lane below). A --worker
  // takes neither: it only works prompts.
  const boardLane = standalone || chat;
  const proposeOnly = !standalone;

  const observed = new Map();
  let observedCount = 0;
  // --standalone: the person behind the latest human edit in the buffer — who a blocking question
  // may be put to in the chat.
  let lastChangedBy = null;
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
    lastChangedBy = null;
  }

  function onBoardEvent(type, payload) {
    if (!boardLane) {
      if (verbose) log(`board event ${type} dropped — a --worker only works prompts`);
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
    if (proposeOnly) {
      onProposableEvent(type, payload, writerUser, writerAgent);
      return;
    }
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
    if (writerUser && !writerAgent) {
      entry.person += 1;
      lastChangedBy = writerUser;
    }
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
    : execRunner
      ? 'You have no subagents here — wherever the kit says to dispatch an Agent, do that work yourself instead. ' +
        'Do the single most valuable piece of work yourself, inline, in this turn, and leave the rest for a later turn.'
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
    : execRunner
      ? `get the most valuable piece of it done in this turn. ${AGENT_BUDGET} Read ` +
        '.agent-modeling-kit/CLAUDE-STANDALONE.md now and follow it: it holds the steps for this kind of turn, and only this kind.'
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

  // --modeling: the same judgement as a standalone turn, but it changes nothing — it puts what it
  // would do to the person in the chat and waits. A "yes" comes back as a CHAT turn, which is where
  // the work is actually created (as prompts).
  const PROPOSE_TASK =
    'Nobody asked you for this — the board just changed, and you are a modeling agent that proposes rather ' +
    'than acts: you may NOT change the board in this turn, and you dispatch no Agents. The change list above ' +
    'is a notification, not the task. Judge the changed areas in their context (slice, chain, timeline) the ' +
    'way .agent-modeling-kit/CLAUDE-STANDALONE.md describes — read it now if you have not this session, and ' +
    'follow its "Propose mode" section. Read what this needs and no more: every nodeId above in one get_nodes, ' +
    'plus one get_board_outline per chapter you have not read this session. Every change above is by one person, ' +
    'changed_by, who is talking to you in the chat. First check the change is one: if the changed nodes ' +
    'read the same as before — same names, fields, types and connections, only moved or resized — nothing ' +
    'changed, so say nothing and reply <promise>NOOP</promise>. Otherwise post ONE short chat message to them with ' +
    'post_chat_message (no sessionId, no replyTo, preferUserId = changed_by; at most 1000 characters). A fresh, half-finished element (placeholder name, no ' +
    'fields, names still changing) is the reason to speak, not to wait. Something worth doing → say concretely ' +
    'what you would do (element names) and ask whether to go ahead. Nothing concrete → say what you saw and ' +
    'that you are not sure what to do with it, and ask ("You renamed Orders to take — not sure what to do with ' +
    'it yet. Want fields on it?"). Fold anything your earlier unanswered message proposed into this one instead ' +
    'of repeating it. One to three sentences. Besides a change that changed nothing, only CHAT_NO_ACTIVE_SESSION (they cleared the conversation or ' +
    'switched to another agent) or CHAT_AWAITING_REPLY (you wrote to them less than 3 minutes ago) keep you ' +
    'silent: then change nothing and reply <promise>NOOP</promise>.';

  // ── Propose lane (--modeling) ─────────────────────────────────────────────
  //
  // Per person: what each chat partner changed since their last proposal. Each gets their own turn
  // and their own proposal, about their own edits only — nobody hears about someone else's work.
  const PROPOSAL_COOLDOWN_MS = 3 * 60_000; // the backend's UNPROMPTED_COOLDOWN_MS
  const proposalBuffer = new Map(); // userId -> Map(nodeId -> { types: Set<string>, count })
  let proposalFirstAt = 0; // start of the current burst — MAX_WAIT is measured from here
  let proposalTimer = null;

  function onProposableEvent(type, payload, writerUser, writerAgent) {
    const nodeId = payload?.node_id ?? '(board)';
    // Only a person at the canvas who is talking to this agent. Agents' writes (this one's
    // included) and unattributed ones name nobody to propose to.
    if (!writerUser || writerAgent || !chatPartners.has(writerUser)) {
      if (verbose) log(`board change: ${type} node=${nodeId} — ignored, not by a person chatting with this agent`);
      return;
    }
    const nodes = proposalBuffer.get(writerUser) ?? new Map();
    const entry = nodes.get(nodeId) ?? { types: new Set(), count: 0 };
    entry.types.add(type);
    entry.count += 1;
    nodes.set(nodeId, entry);
    proposalBuffer.set(writerUser, nodes);
    if (!proposalFirstAt) proposalFirstAt = Date.now();
    log(`board change: ${type} node=${nodeId} — by a chat partner`);
    armProposalTurn(Math.max(0, Math.min(STANDALONE_DEBOUNCE_MS, STANDALONE_MAX_WAIT_MS - (Date.now() - proposalFirstAt))));
  }

  function armProposalTurn(delayMs) {
    if (proposalTimer) clearTimeout(proposalTimer);
    proposalTimer = setTimeout(() => {
      proposalTimer = null;
      dispatchProposals().catch((err) => log(`proposal dispatch error: ${err.message}`));
    }, delayMs);
  }

  function buildProposalTurn(userId, nodes) {
    const lines = [...nodes.entries()].map(([nodeId, entry]) => `- ${nodeId}: ${[...entry.types].join(', ')} (${entry.count}×)`);
    const events = [...nodes.values()].reduce((sum, entry) => sum + entry.count, 0);
    const header = [
      'BOARD_CHANGE',
      'mode=propose',
      `changed_by=${userId}`,
      `board_id=${cfg.boardId}`,
      `organization_id=${cfg.organizationId}`,
      `events=${events}`,
      `nodes=${nodes.size}`,
    ].join(' ');
    return withSessionHeader(`${header}\nchanged:\n${lines.join('\n')}\n\n${PROPOSE_TASK}`);
  }

  async function dispatchProposals() {
    // A direct message always outranks the agent's own initiative.
    if (pending || draining) {
      armProposalTurn(STANDALONE_DEBOUNCE_MS);
      return;
    }
    const now = Date.now();
    const due = [];
    let waitMs = Infinity;
    for (const [userId, nodes] of proposalBuffer) {
      // Their last proposal is still unanswered: keep collecting, fold it all into the next one.
      const left = (lastProposalAt.get(userId) ?? 0) + PROPOSAL_COOLDOWN_MS - now;
      if (left > 0) {
        waitMs = Math.min(waitMs, left);
        continue;
      }
      due.push([userId, nodes]);
      proposalBuffer.delete(userId);
    }
    if (!proposalBuffer.size) proposalFirstAt = 0;
    for (const [userId, nodes] of due) {
      log(`propose turn: ${nodes.size} node(s) changed by ${userId.slice(0, 8)}`);
      lastProposalAt.set(userId, Date.now());
      try {
        await runTurn(buildProposalTurn(userId, nodes));
      } catch (err) {
        log(`propose turn failed: ${err.message}`);
      }
    }
    // Still waiting out a cooldown, or edits that arrived while these turns ran.
    if (proposalBuffer.size) armProposalTurn(Number.isFinite(waitMs) && !due.length ? waitMs : STANDALONE_DEBOUNCE_MS);
  }

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
      'mode=act',
      lastChangedBy ? `changed_by=${lastChangedBy}` : null,
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
    // Guard against hammering the token endpoint: the three channels below usually fail
    // together, and each asks for a refresh before rejoining.
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
    // {type: 'cancel', id, instruction: 'cancel-run'}: stop what the agent is doing now and stay connected.
    // The long-lived claude process is ended (its exit handler fails the turn in flight and the next task
    // respawns it); a harness run through modeling-exec is a live turn and is stopped the same way.
    if (payload?.type === 'cancel' && payload?.id === cfg.agentId) {
      log('received cancel — stopping the current run');
      cancelLiveTurns();
      if (proc) proc.kill('SIGTERM');
      return;
    }
    if (payload?.type !== 'kill' || payload?.id !== cfg.agentId) return;
    log(`received kill (instruction: ${payload.instruction ?? 'exit'}) — shutting down`);
    // Say so on the board first (the kill route has marked it already; this covers a kill sent some other way).
    Promise.race([ping('shutting_down'), new Promise((r) => setTimeout(r, 2000))]).finally(() => process.exit(0));
  };

  // Each channel is rejoined after a failure with exponential backoff and a fresh token
  // (see keepSubscribed) — never left to realtime-js's own fixed-interval rejoin loop.
  const keep = (topic, handlers, onSubscribed) => keepSubscribed(realtime, topic, handlers, {
    log,
    refreshToken: refreshRealtimeToken,
    onSubscribed,
  });

  // The first heartbeat goes out BEFORE any channel is joined: joining runs a catch-up drain, and the platform only hands
  // prompts to an agent with a live heartbeat (403 AGENT_NOT_CONNECTED otherwise). Pinging after subscribing made that first
  // drain fail and left the backlog waiting for the next prompt:created.
  // `status`: 'shutting_down' is the last ping before an exit the board asked for; every other ping says what the agent is
  // doing right now — modeling while a turn runs (a prompt, a chat reply, a board change), idle otherwise.
  const ping = async (status) => {
    const agentStatus = status === 'shutting_down' ? status : turnsInFlight > 0 ? 'modeling' : 'idle';
    try {
      const res = await fetch(`${cfg.baseUrl}/api/agent-alive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${realtimeToken}`, 'Content-Type': 'application/json' },
        // chat_enabled tells the board this agent answers chat messages (the panel only offers chat
        // with one that does); a --worker reports false, and older CLIs send nothing, which the
        // backend reads as false too.
        body: JSON.stringify({ token: cfg.token, board_id: cfg.boardId, agent_type: 'MODELING', agent_id: cfg.agentId, chat_enabled: chat, status: agentStatus, ...(cfg.agentName ? { agent_name: cfg.agentName } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log(`ping failed: ${res.status} ${await res.text().catch(() => '')}`);
    } catch (err) {
      log(`ping error: ${err.message}`);
    }
  };
  await ping();

  // The kill signal is broadcast on the BOARD channel (see the platform's agent-kill /
  // backoffice/killagent slices), not on the org channel this agent uses for prompts — without
  // this second subscription a modeling agent can only be stopped with a kill(1).
  keep(`board:${cfg.boardId}-slicechanged`, {message: exitIfAddressed});

  keep(
    channelName,
    {
      message: exitIfAddressed,
      'prompt:created': () => {
        drain().catch((err) => log(`drain error: ${err.message}`));
      },
      // Sent for every chat message on the org; only one addressed to this agent on this board
      // is worth a drain pass.
      'chat:created': (payload) => {
        if (!chat || payload?.agent_id !== cfg.agentId || payload?.board_id !== cfg.boardId) return;
        drain().catch((err) => log(`drain error: ${err.message}`));
      },
    },
    // Also after a reconnect: prompts created while the channel was down were never pushed.
    () => drain().catch((err) => log(`initial drain error: ${err.message}`)),
  );

  if (!boardLane) log(`channel "board:${cfg.boardId}": events dropped — --worker`);
  keep(
    `board:${cfg.boardId}`,
    Object.fromEntries(BOARD_CHANGE_EVENTS.map((event) => [event, (payload) => onBoardEvent(event, payload)])),
  );

  setInterval(() => {
    refreshRealtimeToken('scheduled').catch(() => {});
  }, 10 * 60 * 1000);

  setInterval(ping, 15_000);
  reportStatus = () => { ping(); };
}

const program = new Command();

program
  .name('eventmodelers')
  .description('Eventmodelers CLI — real-time Claude agent + skills for Claude Code, for any stack')
  .version(CLI_VERSION)
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
const NO_INIT_REQUIRED = new Set(['init', 'scaffold', 'init-templates', 'init-config', 'stacks', 'status', 'config', 'uninstall', 'fetch', 'export', 'activate-context', 'set-slice-status', 'release-notes', 'run', 'listen', 'events', 'replay', 'bridge']);

// Commands that install or refresh the kit themselves — a "your kit is outdated" hint in
// front of them would only be noise.
const NO_KIT_UPDATE_HINT = new Set(['init', 'scaffold', 'init-templates', 're-init', 'uninstall']);

// Retired: still recognised, so an old script or muscle memory gets an explanation instead of "unknown option".
// The hidden options and the `bridge` command exist only to say so; they do nothing else.
const RETIRED_BASH = [
  '❌ `run --bash` (the bash-only loop, ralph.sh) has been retired.',
  '   Its task queue (tasks.json) is now an event log inside the kit, which the bash scripts cannot read or write.',
  '   Use the default loop instead:  npx @eventmodelers/cli run',
  '   (add --exec "<command>" to drive another agent harness, or --local-ai for a local model).',
];
const RETIRED_BRIDGE = [
  '❌ The bridge kit (`init --bridge`, `bridge`) has been retired — it ran on the same tasks.json queue, which is now an event log.',
  '   To hand slices to Spec Kitty, `fetch --spec-kitty` still works on its own, without a standing loop.',
];
function retire(lines) {
  console.error(lines.join('\n'));
  process.exit(1);
}

program
  .command('bridge', { hidden: true })
  .allowUnknownOption()
  .allowExcessArguments()
  .action(() => retire(RETIRED_BRIDGE));

program.hook('preAction', (_thisCommand, actionCommand) => {
  const o = actionCommand.opts();
  if (actionCommand.name() === 'run' && o.bash) retire(RETIRED_BASH);
  if (actionCommand.name() === 'init' && (o.bridge || o.target || o.hook)) retire(RETIRED_BRIDGE);
});

// Startup hint when this CLI is behind npm, or an installed kit here is behind this CLI.
// Best effort and on stderr, so it never breaks piped output; EVENTMODELERS_NO_UPDATE_CHECK
// (or CI) turns it off.
program.hook('preAction', async (_thisCommand, actionCommand) => {
  if (process.env.EVENTMODELERS_NO_UPDATE_CHECK || process.env.CI) return;
  const latestVersion = await latestPublishedVersion({ cachePath: join(GLOBAL_DIR, 'update-check.json') });
  const kitDirs = NO_KIT_UPDATE_HINT.has(actionCommand.name()) ? [] : findAllInstalledKitDirs(process.cwd());
  const hints = updateHints({ currentVersion: CLI_VERSION, latestVersion, kitDirs });
  if (hints.length) console.error(`${hints.join('\n')}\n`);
});

// A prototype folder (`init --prototype`) has no kit: `re-init` there refreshes the prototype's skills and rules instead.
const isPrototypeFolder = (dir) => existsSync(join(dir, '.prototype', 'state.json'));

// `vibe …` runs from anywhere under the project's one .vibe/ — often a nested module with no kit of its own (it finds .vibe/ itself).
const underVibe = (command) => { for (let c = command; c; c = c.parent) if (c.name() === 'vibe') return true; return false; };

program.hook('preAction', (_thisCommand, actionCommand) => {
  if (NO_INIT_REQUIRED.has(actionCommand.name()) || underVibe(actionCommand)) return;
  if (actionCommand.name() === 're-init' && isPrototypeFolder(process.cwd())) return;
  if (findInstalledKitDir(process.cwd())) return;

  console.error(`❌ No eventmodelers kit installed in this directory (checked: ${KIT_DIR_NAMES.join(', ')}).`);
  console.error('   Run one of these first:');
  console.error(`     npx @eventmodelers/cli init --stack <name>   (${Object.keys(STACKS).join(', ')})`);
  console.error('     npx @eventmodelers/cli init --modeling');
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

// `--handover` is the project policy for how a backend build kit finishes a slice with a UI:
// set, it ends STATE_VIEW / STATE_CHANGE slices at `Waiting` (the UI kit builds the rest and sets
// `Done`); unset, it ends at `Done`, exactly as before. Persisted as `handover: true` in the project's
// config.json — the `ui-contract` skill (Step 4) reads it there. Switch it later with
// `eventmodelers config --handover on|off`.
const HANDOVER_OPTION = [
  '--handover',
  'Backend build kit: finish slices that have a UI at status `Waiting` (UI build kit takes over, then sets `Done`) instead of `Done`. Saved as `handover: true` in .eventmodelers/config.json; without it slices end at `Done`. Turn it off later with `eventmodelers config --handover off`.',
];

function identityOverridesFromOpts(opts) {
  const agentName = typeof opts.name === 'string' ? opts.name.trim() : undefined;
  return { ...(agentName ? { agentName } : {}), ...(opts.handover ? { handover: true } : {}) };
}

credentialFlags(program
  .command('init')
  .alias('install')
  .description('Scaffold a stack + install the agent kit into the current directory (or --modeling for skills + agent loop only, no backend scaffold; or --build-kit for a blank build-kit scaffold to fill in for a stack not built into this CLI yet; or --git to install a community/custom build kit from a git repo)')
  .option('--stack <name>', `Stack to install (${Object.keys(STACKS).join(', ')}), or a name of your choosing when combined with --git`)
  .option('--git <url>', 'Install a build kit not built into this CLI by cloning this git repo (used with --stack <name> to name it) — the repo must mirror the templates/.claude, templates/root, templates/<kitSubdir> layout of this CLI\'s own stacks/<name>/templates, optionally with a stack.json declaring label/kitSubdir/useShared/needsBoardId')
  .option('--branch <name>', 'Branch to clone — only meaningful with --git (defaults to the repo\'s default branch)')
  .option('--modeling', 'Install skills + the agent loop only — no backend scaffold. Mutually exclusive with --stack/--build-kit.')
  .addOption(new Option('--bridge').hideHelp())
  .addOption(new Option('--target <name>').hideHelp())
  .addOption(new Option('--hook <command>').hideHelp())
  .option('--build-kit', 'Install a blank build-kit scaffold (.build-kit/ + .claude/skills/build-*/SKILL.md placeholders, all TODO-marked) for a stack not built into this CLI yet — no fixed backend. Mutually exclusive with --stack/--modeling.')
  .option('--hooks', 'Install the slice commit-scope guard (.githooks/pre-commit, running .build-kit/lib/check-commit-scope.cjs) and wire it up via `git config core.hooksPath .githooks` — only meaningful with --stack (build-kit stacks). Off by default.')
  .option('--demo', 'Install a ready-made demo model into the kit\'s .slices/ — the "Understanding Eventsourcing" context (16 shopping-cart slices covering every slice type), in exactly the shape `fetch` writes, so the build skills and the agent loop have something real to work on before this project is connected to a board. Skipped if .slices/ already holds fetched slices. Off by default.')
  .option('--global', 'Install skills into ~/.claude/skills/ instead of the project — available in every project')
  .option('--prototype', 'Install the local prototype skills (local-prototype, local-prototype-model, local-prototype-build, local-prototype-control, connect) and ask for the board credentials — then run `claude` and /local-prototype. See extensions/prototype/README.md')
  .option('--empty', 'With --prototype: create an empty prototype — one "Hello World" slice with its page — instead of fetching a model from the board. No credentials and no board needed; connect one later. An existing local model is left alone.')
  .option('--vibe-coding', 'Set up vibe coding: model first, code second — changes go onto the event model on the board before the code follows, and drift detection catches code changed outside that flow. No build kit needed. Installs .vibe/, the vibe skills and the modeling skills they use; run `claude`, then /analyze-code-base for the module to start with and /start-vibe-session at the start of a session. See extensions/vibe/README.md')
  .option('-f, --force', 'Re-prompt for credentials even if a config already has everything required — overwrites the existing config.json')
  .option(...AGENT_NAME_OPTION)
  .option(...HANDOVER_OPTION))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    if (opts.empty && !opts.prototype) { console.error('❌ --empty goes with --prototype: `eventmodelers init --prototype --empty`.'); process.exit(1); }
    if (opts.vibeCoding) return initVibe();
    if (opts.prototype) return initPrototype({ loadEffectiveConfig, findInstalledKitDir, configureCredentials, prompt, registerMcp: (dir, cfg) => { ensureMcpRegistered(dir, cfg.baseUrl || DEFAULT_BASE_URL); ensureEnvToken(dir, cfg.token); ensureMcpEnabled(dir); } }, { config: globalOpts.config, print: globalOpts.print, force: opts.force, empty: opts.empty });

    if (opts.modeling || opts.buildKit) {
      const modeCount = [opts.modeling, opts.buildKit].filter(Boolean).length;
      if (opts.stack || opts.git || modeCount > 1) {
        console.error('❌ --stack/--git, --modeling and --build-kit are mutually exclusive — pick one.');
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
  .description("Refresh an installed kit from the current CLI version. In a prototype folder (`init --prototype`): re-installs the local-* skills, the CLAUDE.md rules and the page libraries, leaving the model alone. For a build kit: re-copies this CLI's shared runtime (ralph.js, ralph-claude.js, tracing, adapters) into .build-kit and re-runs the config (credentials unless complete, agent tracing) — the stack's own files and skills are left alone, so this works for --git stacks too. --stack <name> instead refreshes everything from that built-in stack; --modeling refreshes .agent-modeling-kit. Never touches the project root scaffold or the root CLAUDE.md router.")
  .option('--modeling', 'Refresh the modeling kit (.agent-modeling-kit) instead of a build kit')
  .option('--stack <name>', `Also refresh the stack's own files and skills from this built-in stack (${Object.keys(REINITIABLE_STACKS).join(', ')}) — or switch a .build-kit install to a different stack. Without it, only the shared runtime and the config are refreshed`)
  .option('--hooks', 'Install the slice commit-scope guard (.githooks/pre-commit) and wire it up via `git config core.hooksPath .githooks` — same as `init --hooks`, for turning it on after the fact without a full re-scaffold. Off by default.')
  .option('--global', 'Re-install skills into ~/.claude/skills/ instead of the project — defaults to however they were originally installed')
  .option('-f, --force', 'Re-prompt for credentials even if a config already has everything required — overwrites the existing config.json')
  .option(...AGENT_NAME_OPTION)
  .option(...HANDOVER_OPTION))
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

    // A prototype folder: refresh its skills, CLAUDE.md rules and page libraries; the model and .prototype/ stay as they are.
    if (!opts.modeling && !opts.stack && !opts.hooks && !opts.global && !existsSync(kitDir) && isPrototypeFolder(targetDir)) {
      return initPrototype({ loadEffectiveConfig, findInstalledKitDir, configureCredentials, prompt, registerMcp: (dir, cfg) => { ensureMcpRegistered(dir, cfg.baseUrl || DEFAULT_BASE_URL); ensureEnvToken(dir, cfg.token); ensureMcpEnabled(dir); } }, { config: globalOpts.config, print: globalOpts.print, force: opts.force, refresh: true });
    }

    if (!existsSync(kitDir)) {
      console.error(`❌ No ${kitDirName}/ found in ${targetDir} — run \`init${opts.modeling ? ' --modeling' : ''}\` first.`);
      process.exit(1);
    }

    const manifest = readJsonSafe(join(kitDir, '.eventmodelers', 'install-manifest.json'));

    // A build kit without --stack: refresh only what this CLI owns — the shared runtime and the
    // config — and never the stack's own files. Works for any stack, --git ones included.
    if (!opts.modeling && !opts.stack) {
      await refreshSharedRuntime({ targetDir, kitDir, globalOpts, opts });
      return;
    }

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
    // Mirrors `run`'s buildKitDir resolution: a modeling-kit install shares KIT_DIR_NAMES but never ships
    // check-commit-scope.cjs, so prefer whichever installed dir isn't the modeling kit.
    const installedKitDirs = findAllInstalledKitDirs(cwd);
    const modelingKitDir = installedKitDirs.find((d) => d.endsWith(MODELING_KIT.kitDirName)) ?? null;
    const kitDir = installedKitDirs.find((d) => d !== modelingKitDir) ?? installedKitDirs[0];

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
      ensureMcpEnabled(targetDir);
      if (existsSync(join(targetDir, STACKS.node.kitDirName))) {
        await configureAgentTracing(configPath, globalOpts.print, !Object.values(overrides).some(Boolean));
      }
    }
  });

credentialFlags(program
  .command('run')
  .description('Start the agent loop from the installed kit dir — build-kit stacks: ralph-claude.js (default); modeling-kit: --modeling, or --standalone, which needs no install at all')
  .option('--local-ai [target]', `Drive the loop with a local (or self-hosted) model instead of the default Claude runner: a build kit runs it via ralph-local-ai.js, and --modeling/--standalone via lib/modeling-local-ai.js (board tools over MCP, but no skills and no subagent fan-out — those are Claude Code features). Optional target preset picks the URL and wire dialect: ${LOCAL_AI_TARGETS.join(', ')} — bare --local-ai means ollama. Anything OpenAI-compatible (vLLM, LM Studio, llama.cpp, TGI) works by pointing LOCAL_AI_URL at it; see LOCAL_AI_* in the docs. Board work only: --local-ai never builds a Planned slice (no file, shell or git tools). To build code with a local model, use --exec with a coding harness pointed at it, e.g. "codex exec --oss --full-auto". Claude remains the default when this flag is absent.`)
  .addOption(new Option('--bash').hideHelp())
  .option('--agent [name]', `Pick the agent that does the work by name: ${AGENT_NAMES.join(', ')}. claude is the default runner; mastra is a warm in-process Mastra agent (needs --model <provider/model>); any other is a shortcut for --exec with that harness's headless command filled in — plain-text output for --modeling/--standalone/--worker, JSON output (for agent tracing) for a build kit. Bare --agent lists the agents and the exact command each runs, then stops. Mutually exclusive with --exec and --local-ai.`)
  .option('--acp', 'With --agent claude|opencode|gemini|codex|cursor|github: drive that agent over the Agent Client Protocol (ACP) as one warm session instead of one exec process per turn. For a build kit it runs ralph-acp.js (a fresh conversation per slice, in one warm process); for --modeling/--standalone/--worker/--global it is the low-latency modeling runner (lib/modeling-acp.js). The eventmodelers MCP server is handed to the agent in the session, so no MCP config file is written. Permission requests are auto-approved (like --dangerously-skip-permissions), so only use it on a board whose collaborators you trust with your shell. No subagents: self-directed work is done inline.')
  .option('--reset-session', 'Modeling loop only: start a fresh agent conversation after every prompt turn, instead of carrying one conversation for the whole run. Works with the default Claude runner (a new `claude` process), --acp, --agent mastra and Cursor\'s chat; a local model and the other --exec agents start every turn fresh anyway. Bounds how far the context grows and keeps each prompt independent of the last; the cost is that the next turn re-reads the kit and the board it needs, and loses what the warm session remembered (which screen was just rendered, which chapter it already read). Off by default. A build kit already starts a fresh conversation per slice.')
  .option('--acp-cmd <command>', 'Drive any ACP agent that is not covered by --agent, e.g. --acp-cmd "my-agent --acp". Implies --acp; the command must speak ACP over stdio and support HTTP MCP servers.')
  .option('--endpoint <url>', 'With --agent mastra: an OpenAI-compatible endpoint to use instead of a built-in provider (e.g. https://api.franconia.ai/v1). --model is then the endpoint\'s own model name, and the key is read from $MASTRA_API_KEY (never from a file). Also settable as mastra.baseUrl in .eventmodelers/config.json.')
  .option('--model <id>', 'The model the agent runs on, for this run only: `-m <id>` on the --agent opencode/codex/gemini command (`--model <id>` for cursor and pi) (e.g. opencode/big-pickle, gpt-5-codex, gemini-2.5-pro), `--model <id>` for Claude (overriding `model` from config), `<provider>/<model>` for --agent mastra (e.g. anthropic/claude-sonnet-5-5), LOCAL_AI_MODEL for --local-ai. Not with --exec — put the harness\'s own model flag in the command there.')
  .option('--exec [command]', 'Fallback for any harness --agent does not cover, or other flags than its preset. Hand each prompt to an external agent command instead of the default Claude runner — for agentic harnesses that bring their own tool loop, e.g. "codex exec --full-auto", "gemini --yolo -p" or "opencode run". One process per prompt; the prompt is appended as a quoted argument and also written to the file named by RALPH_PROMPT_FILE. Bare --exec uses localAi.exec from .eventmodelers/config.json. Claude remains the default when this flag is absent. A build kit runs it via ralph-exec.js; there, with agent tracing on, include the harness\'s JSON output flag (codex exec --json, opencode run --format json, gemini --output-format stream-json) — without it no slice cost is recorded. With --modeling/--standalone/--worker it is how any agent takes board prompts and chats: the loop claims each prompt or chat message and runs the command once for it. Keep the harness in its plain-text output mode there — stdout is the turn\'s answer — the eventmodelers MCP server is registered for it on every run (opencode.json, .gemini/settings.json, or -c flags for codex; any other command logs what to register by hand), authenticating with $EVENTMODELERS_TOKEN from the env the command inherits, and `init-agents --hosts <harness>` installs the skills for a harness that does not read .claude/skills. No subagents: self-directed work is done inline.')
  .option('--all', 'Run every build kit in this project at once — the one in this directory and any up to two levels below it (a scaffolded app has `.build-kit` at the root and in `web/`, so this works from the app or from the folder holding it) — each from its own directory, output prefixed with the directory, Ctrl+c stops them all. Every other flag is passed on to each run. Not interactive: the kits\' credentials must already be configured (except with --force, which asks once per kit up front, here, before the runs start). With --modeling, the modeling agent runs alongside the build kits. Not with --standalone, --worker, --global, --local or --id (one id cannot belong to several agents).')
  .option('--modeling', 'Connect a modeling agent to the board: it takes prompts and chat messages and hands each to an AI — by default one Claude process kept warm across prompts, for low-latency voice/live use; --agent (or --local-ai, or --exec as the manual fallback) picks another. Runs from a modeling-kit install in this directory, or from the global install (~/.eventmodelers/kit) when there is none. Built into the CLI, not a per-project file.')
  .option('-f, --force', 'Ask for credentials again before the modeling loop starts, even when a config already has everything required. With a modeling kit in this directory it re-runs the same prompt as `init --modeling`, overwriting the project\'s .eventmodelers/config.json; with the global install it drops the "keep the stored credentials" choice, so a board\'s credentials have to be answered afresh. Applies to build-kit runs too, where it re-asks against the project\'s .eventmodelers/config.json. Cannot be combined with --non-interactive, --print or --local.')
  .option('--non-interactive', 'Never ask anything: take the board and credentials that resolve from flags, EVENTMODELERS_* env vars and the config files, and fail with the reason if they are incomplete instead of interviewing for them. A TTY was previously the only signal — right for CI or a supervisor, wrong for a loop started from a terminal, where stdin is a TTY nobody is watching and the run stops on a question. Only affects the modeling loop (--modeling/--standalone/--worker/--global).')
  .option('--standalone', 'Let the modeling agent act on board changes on its own initiative, without asking: it subscribes to the board\'s change channel and, whenever the board goes quiet after an edit — or has simply been idle for a while — it takes a turn nobody asked for, judges the model as a whole and fans the work out over parallel subagents, one per changed area (examples on a new node, specs for a new command or read model, a missing attribute along a chain, a screen, a question). Filling that detail in while the human keeps modeling is the point. A plain --modeling agent only proposes, and only to the people chatting with it: after their edits it says in the chat what it would do and waits for a yes; everyone else\'s edits are ignored. Implies --modeling.')
  .option('--max-agents <n>', 'Cap how many subagents a self-directed --standalone turn may dispatch at once, to bound what an unattended agent can spend per turn. The agent merges work that shares a slice or chain first, then takes the most valuable pieces up to this many and leaves the rest for a later turn. 1 makes it do the single most valuable piece itself, without spawning anything. Default 5. Ignored without --standalone — prompt turns are one piece of work by definition.', '5')
  .option('--worker', 'A modeling agent that only works prompts: it neither takes part in the board\'s chat (the heartbeat reports chat_enabled=false, so the chat panel does not offer it) nor reacts to board changes — it waits for prompts and does them. For a dedicated agent a supervisor or another agent feeds, often paired with --exclusive and --id. Implies --modeling; cannot be combined with --standalone.')
  .option('--exclusive', 'Work only the prompts addressed to this agent\'s id — the board\'s "preferred agent" (the star in the prompts panel) — and hand every untargeted prompt straight back to the queue for another agent to take. Without it an agent also works everything nobody addressed to anyone, which is what you want for a single agent and exactly what you do not want for a dedicated one (a board with a general agent plus a specialist, or an agent a supervisor drives by id). Pair it with --id so the same agent is addressable across restarts — --global/--standalone otherwise mint a fresh id per run, and prompts addressed to the previous run\'s id are never claimed. Leaves --standalone alone: a self-directed turn is nobody\'s prompt, so an exclusive standalone agent still works the board on its own initiative.')
  .option('--global', 'Run the modeling agent from the global install (~/.eventmodelers/kit), initializing it on first use, and ignore any kit in this directory. This is also what --modeling/--standalone fall back to on their own when nothing is installed here — pass it explicitly to prefer the global install over a local one. Credentials come from the flags below, EVENTMODELERS_* env vars, or ~/.eventmodelers/boards/<board>.json, so nothing is written into the current directory.')
  .option('--local', 'Skip platform config/credential lookup entirely and run the local-only loop (no board sync, no realtime agent) — even if .eventmodelers/config.json has credentials (build-kit stacks only)')
  .option('--dangerously-skip-permissions', 'Run the modeling agent\'s Claude process with --dangerously-skip-permissions, as before the lockdown: every tool call is approved — any shell command, curl to anywhere, any file the user can read or write, every MCP server the machine configures. Off by default because the agent takes chat messages and snippet clicks from any collaborator on the board; pass it only for a board whose collaborators you trust with your shell. Default Claude runner of --modeling/--standalone/--worker/--global only — not with --agent, --exec or --local-ai, which bring their own permission flags.')
  .option('--browser', 'Give the locked-down modeling agent a browser: the Playwright MCP server (npx @playwright/mcp) next to the eventmodelers one, for discover-storyboard. Off by default because a browser can reach any site, which the lockdown otherwise rules out. Default Claude runner only; --dangerously-skip-permissions already loads every MCP server the machine configures.')
  .option('--handover', 'Backend build kit: for this run only, finish slices that have a UI at `Waiting` instead of `Done` (same as the project setting `handover: true`, which `init --handover` / `config --handover on` save — this flag writes nothing). Without it the project setting applies; without both, slices end at `Done`.')
  .option('--status-trigger <status>', 'Build kit: the slice status the agent picks work up from, for this run only (e.g. Ready, Planned, Waiting). Defaults to the kit\'s own pickup status — `Planned` for backend kits, `Handover` for the UI kits. Nothing is written to disk.')
  .option('--feature <name>', 'Build kit: only pick up slices that belong to this feature (the free-text names set per slice on the board, matched case-insensitively), for this run only. Other slices wait for a run without it or with their own feature. Nothing is written to disk.')
  .option('--prototype', 'Run the local prototype of this folder (set up with `init --prototype`): serves the page in the board\'s player and runs the agent loop — each iteration it reads what Sync, Rebuild and a saved feedback recorded in the control log (.prototype/events/) and works through the requests nobody processed yet: Sync and Rebuild right away (the CLI for a sync, Claude Code for a rebuild), feedback only with --sync, which applies it automatically and writes every model change back to the board, retrying until it lands. Without --sync, feedback waits for /local-prototype-control. The agent runs in a warm Agent Client Protocol session (claude by default; --agent <name> or --acp-cmd pick another), not one process per request. `prototype [--sync]` is the player alone.')
  .option('--port <port>', 'With --prototype: the port to serve on (the next free one is used when it is taken)', (v) => parseInt(v, 10), 4173)
  .option('--sync', 'With --prototype: apply feedback automatically and write model changes back to the board (retried every 30s). Build kit: share this agent\'s event log with the board — events that name a slice are uploaded constantly (POST …/buildlog) for a live dashboard. The platform keeps one iteration per slice, 1000 entries at most. A no-op for --modeling/--standalone, and with --local.')
  .option('--verbose', 'Log every tool call\'s full input (commands, skill args, file paths) and assistant reasoning text. Default is condensed, high-level per-step logging only.')
  .option('--id <id>', 'Pin the agent id this run identifies itself with on the platform. Without it an agent keeps one id: a project install per project, a --global/--standalone run per board and repo (the directory it is started in) — the same agent on every restart, with its chat, its star on the board and the prompts it holds. If another live process already runs under that id, this one gets a fresh id instead (two agents must not share a heartbeat row). Pass --id when a supervisor already knows the id you want, or for a second agent on purpose; it is used as given, with no such check. Per-run only: nothing is written to disk.')
  .option('--name <name>', 'A human-readable name for this agent, sent with every heartbeat so the board shows which agent is live rather than a bare uuid (e.g. "ci-builder", "martins-laptop"). Per-run only, like --id: the persistent name is `agentName` in config.json (set via `init --name` / `init-config --name`), and this overrides it for one run without writing anything.')
  .option('--credentials <values>', 'Credentials as the comma-separated blob from app.eventmodelers.ai/account (token=...,boardId=...,organizationId=...,baseUrl=...), the equivalent JSON, or - to read either from stdin. Saved to ~/.eventmodelers/boards/<board>.json, so it is only needed once per board, and passing it skips the first-run question. The individual flags below override single fields of it.'))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    const cwd = process.cwd();
    if (opts.prototype) return prototypeApi.runPrototype({ port: opts.port, sync: opts.sync, loop: true, acpAgent: { name: typeof opts.agent === 'string' ? opts.agent : undefined, cmd: opts.acpCmd } }, command);
    if (opts.all) {
      const clashing = [['--standalone', opts.standalone], ['--worker', opts.worker], ['--global', opts.global], ['--local', opts.local], ['--id', opts.id !== undefined]]
        .filter(([, set]) => set).map(([flag]) => flag);
      if (clashing.length) {
        console.error(`❌ --all runs build kits and cannot be combined with ${clashing.join(', ')}.`);
        process.exit(1);
      }
      const kitDirNames = [...new Set(Object.values(STACKS).map((st) => st.kitDirName))];
      const dirs = findBuildKitDirs(cwd, kitDirNames);
      if (!dirs.length && !opts.modeling) {
        console.error(`❌ No build kit found in this directory or up to two levels below it (looked for ${kitDirNames.join(', ')}).`);
        process.exit(1);
      }
      // Each kit runs as its own `run` with whatever else was typed; only --all is dropped, and
      // --modeling too — that one is its own run, below, not something a build kit takes.
      // --force is the one flag that asks questions, and the children have no terminal to ask on
      // (the supervisor pipes their stdin, so the first prompt dies with ERR_USE_AFTER_CLOSE). The
      // credentials step runs here once per kit instead, then --force is not forwarded.
      if (opts.force) {
        if (opts.nonInteractive || globalOpts.print) {
          console.error('❌ --force asks for credentials again, which --non-interactive/--print rule out — pick one.');
          process.exit(1);
        }
        // Asked once, for the kit in this directory (the first one found when there is none), and
        // handed to the others — the modeling agent reads this directory's config.
        // With no build kit (--modeling alone), the credentials belong to this directory itself:
        // a kit dir that need not exist, since only its parent is used.
        const rootDir = dirs.find((dir) => dirname(dir) === cwd) ?? dirs[0] ?? join(cwd, '.agent-modeling-kit');
        console.log(`\n🔑 Credentials for ${dirs.length ? relative(cwd, rootDir) || '.' : 'the modeling agent'}, shared by all`);
        const { organizationId, boardId, token, baseUrl } = await forceBuildKitCredentials(rootDir, cwd, opts, globalOpts);
        for (const dir of dirs.filter((d) => d !== rootDir)) {
          await forceBuildKitCredentials(dir, cwd, opts, globalOpts, { organizationId, boardId, token, baseUrl });
        }
        if (sharedRl) sharedRl.close();
        console.log('');
      }
      const forwarded = process.argv.slice(2).filter((a) => a !== '--all' && a !== '--modeling' && !(opts.force && a === '--force'));
      const cliJs = join(__dirname, 'cli.js');
      const specs = dirs.map((dir) => ({ name: relative(cwd, dir) || '.', file: process.execPath, args: [cliJs, ...forwarded], cwd: dir }));
      // --modeling adds the modeling agent next to the build kits: one process, from this directory
      // (its modeling kit, or the global install when there is none), like a plain `run --modeling`.
      if (opts.modeling) specs.push({ name: 'modeling', file: process.execPath, args: [cliJs, ...forwarded, '--modeling'], cwd });
      console.log(`▶ Running ${dirs.length} build kit(s)${opts.modeling ? ' + the modeling agent' : ''}: ${specs.map((sp) => sp.name).join(', ')} (Ctrl+c stops all)\n`);
      process.exit(await supervise(specs));
    }
    // Validated up front, before any runner is selected: a cost guard given as garbage
    // should fail on the spot, not once the loop is already up — and a cap passed where
    // nothing will read it is worth saying out loud rather than ignoring silently.
    const maxAgents = parseMaxAgents(opts.maxAgents);
    // --agent is --exec with the command filled in for the loop this run picks.
    const agentExec = resolveAgentPreset(opts, (opts.modeling || opts.standalone || opts.worker || opts.global) ? 'modeling' : 'build');
    if (agentExec) opts.exec = agentExec;
    // ACP: a runner of its own (lib/modeling-acp.js), picked by --agent <name> --acp or --acp-cmd.
    let acpAgent = null;
    if (opts.acp || opts.acpCmd) {
      if (opts.exec || opts.mastra || resolveLocalAiTarget(opts) !== null) {
        console.error('❌ --acp/--acp-cmd are mutually exclusive with --exec, --local-ai and --agent mastra — pick one runner.');
        process.exit(1);
      }
      if (opts.model !== undefined) {
        console.error('❌ --model does not apply to --acp/--acp-cmd — the ACP agent picks its model from its own configuration.');
        process.exit(1);
      }
      try {
        acpAgent = resolveAcpAgent({ name: opts.acpAgent ?? null, cmd: opts.acpCmd ?? null });
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    }
    if (opts.resetSession && !(opts.modeling || opts.standalone || opts.worker || opts.global)) {
      console.error('❌ --reset-session is for the modeling loop — a build kit already starts a fresh conversation for every slice.');
      process.exit(1);
    }
    if (opts.endpoint !== undefined) {
      if (!opts.mastra) {
        console.error('❌ --endpoint only applies to --agent mastra — the other agents take their endpoint from their own configuration (or --local-ai for a local server).');
        process.exit(1);
      }
      try { new URL(String(opts.endpoint)); } catch {
        console.error(`❌ --endpoint "${opts.endpoint}" is not a URL — e.g. https://api.franconia.ai/v1.`);
        process.exit(1);
      }
      process.env.MASTRA_BASE_URL = String(opts.endpoint).trim();
    }
    // --model: one flag, spelled the way each runner takes it. A hand-written --exec command is
    // the one place it can't go — where the model flag goes in an unknown command is the author's.
    const model = opts.model === undefined ? null : String(opts.model).trim();
    if (model === '') {
      console.error('❌ --model needs a non-empty value.');
      process.exit(1);
    }
    if (model && opts.exec && !agentExec) {
      console.error('❌ --model does not apply to --exec — put the harness\'s own model flag in the command (e.g. --exec "opencode run --standalone -m <id>"), or use --agent.');
      process.exit(1);
    }
    if (model && agentExec) {
      opts.exec = withModel(agentExec, model);
    }
    else if (model && resolveLocalAiTarget(opts) !== null) process.env.LOCAL_AI_MODEL = model;
    // The default Claude runner: the build kit's ralph-claude.js reads RALPH_MODEL from the env it
    // inherits; the modeling loop takes it as runModeling's `model`.
    else if (model) process.env.RALPH_MODEL = model;
    if (command.getOptionValueSource('maxAgents') === 'cli' && !opts.standalone) {
      console.log('ℹ️  --max-agents only applies to --standalone turns; ignoring it here.');
    }
    // --exclusive is the one flag the build-kit runners can't honor: they claim their work from the
    // same queue but have no addressee filter, so it would silently do nothing there.
    if (opts.exclusive && !(opts.modeling || opts.standalone || opts.worker || opts.global)) {
      console.log('ℹ️  --exclusive only applies to the modeling loop (--modeling/--standalone/--worker/--global); ignoring it here.');
    }
    // A worker is defined by what it doesn't do on its own — --standalone is exactly that, so the
    // two contradict each other rather than one quietly winning.
    if (opts.worker && opts.standalone) {
      console.error('❌ --worker and --standalone are mutually exclusive — a worker never acts on board changes.');
      process.exit(1);
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
    // Both kit dirs can be installed side by side (e.g. running a build-kit and a
    // modeling-kit agent from the same project). findInstalledKitDir only ever
    // returns its first fixed-order match, which would silently prefer one stack
    // over the other regardless of which the caller actually asked for — so here
    // we resolve each stack's dir independently instead of relying on that order.
    const installedKitDirs = findAllInstalledKitDirs(cwd);
    const modelingKitDir = installedKitDirs.find((d) => d.endsWith(MODELING_KIT.kitDirName)) ?? null;
    const buildKitDir = installedKitDirs.find((d) => d !== modelingKitDir) ?? null;

    // No overlap between the two stacks' runtimes: modeling-kit only ever runs the
    // warm, direct-dispatch loop (--modeling); build-kit only ever runs the
    // cold-spawn/task-queue loop (default, or --local-ai/--exec). Neither falls back
    // to the other's mechanism, so each side is gated explicitly below rather than
    // just being left to fail on a missing file.
    // --standalone implies --modeling: it already refused every other runner, so there
    // was never a second thing it could have selected, and requiring both flags only made
    // the shorter, more obvious command fail. --global picks the modeling loop too — it has
    // no meaning for a build kit, which is scaffolded per project by definition.
    if (opts.modeling || opts.standalone || opts.worker || opts.global) {
      const picked = opts.modeling ? '--modeling' : opts.standalone ? '--standalone' : opts.worker ? '--worker' : '--global';
      if (opts.sync) console.log(`ℹ️  --sync shares a build agent's log — it does nothing with ${picked}.`);
      // --local-ai and --exec name what does a turn, not a queue, and the modeling loop has its own
      // runner for each (lib/modeling-local-ai.js, lib/modeling-exec.js).
      const modelingLocalAi = resolveLocalAiTarget(opts);
      if (modelingLocalAi !== null && opts.exec) {
        console.error('❌ --local-ai and --exec are mutually exclusive — pick one runner.');
        process.exit(1);
      }
      // --force means "ask me", --non-interactive/--print mean "never ask" — one has to lose,
      // and silently dropping either would surprise whoever passed it.
      if (opts.force && (opts.nonInteractive || globalOpts.print)) {
        console.error(`❌ --force asks for credentials again, which --non-interactive/--print rule out — pick one.`);
        process.exit(1);
      }
      if (opts.browser && (opts.exec || opts.mastra || acpAgent || modelingLocalAi !== null || opts.dangerouslySkipPermissions)) {
        console.error('❌ --browser only applies to the locked-down default Claude runner — --agent/--exec and --dangerously-skip-permissions use the MCP servers the machine configures, and --local-ai has no tools.');
        process.exit(1);
      }
      if (opts.dangerouslySkipPermissions && (opts.exec || opts.mastra || acpAgent || modelingLocalAi !== null)) {
        console.error('❌ --dangerously-skip-permissions only applies to the default Claude runner — --agent/--exec bring their own permission flags (put them in the command), and --local-ai has no shell or file tools to approve.');
        process.exit(1);
      }
      if (opts.local) {
        console.error(`❌ ${picked} has no local-only mode — it is always driven by the org-wide realtime prompt queue, so --local has no use for it.`);
        process.exit(1);
      }

      // A kit in this directory wins unless --global explicitly asks for the other one.
      // Otherwise: the global install, initialized on first use, driven by this run's own
      // credentials resolved from flags/env/~/.eventmodelers — so the current directory is
      // neither read nor written, and the command works from anywhere.
      let kitDir = opts.global ? null : modelingKitDir;
      // A pre-config.js install (the old ralph-based kit) shares the dir name but can't
      // drive this loop — fall through to the global install rather than refusing to run.
      if (kitDir && !existsSync(join(kitDir, 'lib', 'config.js'))) {
        console.log(`ℹ️  Ignoring ${relative(cwd, kitDir)} — an outdated kit without lib/config.js (run \`init --modeling\` here to replace it). Using the global install.\n`);
        kitDir = null;
      }
      let projectDir = kitDir ? resolve(kitDir, '..') : null;
      let overrides = null;
      let codeDir = null;
      if (!kitDir) {
        codeDir = cwd;
        // The blob and the individual flags are both "explicit", so they share a
        // precedence tier — with a single --token/--board-id winning, since overriding one
        // field of a pasted blob is the only reason to pass both.
        const flags = {
          ...(opts.credentials ? parseCredentialsArg(opts.credentials) : {}),
          ...Object.fromEntries(Object.entries(credentialOverridesFromOpts(opts)).filter(([, v]) => v)),
        };
        const config = await resolveModelingCredentials(cwd, flags, globalOpts.config, globalOpts.print, !!opts.nonInteractive, !!opts.force);
        // The stable id of this board and repo — unless `--id` pins another, or a live process already runs under it,
        // in which case this run gets a fresh one (agent-lock.js).
        if (!identity.agentId) {
          const { agentId, fellBack } = acquireAgentId({ lockDir: join(GLOBAL_DIR, 'locks'), stableId: config.agentId });
          config.agentId = agentId;
          config.agentIdFellBack = fellBack;
        }
        projectDir = await ensureGlobalKit(config.baseUrl);
        kitDir = join(projectDir, MODELING_KIT.kitDirName);
        overrides = config;
      } else if (opts.force) {
        // A project install never asks on its own — runModeling just walks the config files.
        // --force re-runs init's own credentials step against the same project-root config,
        // so the loop below picks up the fresh answer through that very walk.
        const configPath = globalOpts.config
          ? resolve(projectDir, globalOpts.config)
          : join(projectDir, '.eventmodelers', 'config.json');
        const effective = loadEffectiveConfig(projectDir, kitDir, globalOpts.config);
        const cfg = await configureCredentials({
          config: effective.config,
          configPath,
          targetDir: projectDir,
          requiredFields: ['organizationId', 'token'],
          boardIdOptional: true,
          overrides: credentialOverridesFromOpts(opts),
          print: false,
          force: true,
        });
        ensureMcpRegistered(projectDir, cfg.baseUrl || DEFAULT_BASE_URL);
        ensureEnvToken(projectDir, cfg.token);
        ensureMcpEnabled(projectDir);
      }

      // Writes to a stdout pipe are asynchronous on POSIX — without waiting for this
      // write's own flush callback, the heavier synchronous/async work runModeling() does
      // right after (dynamic imports, config reads) can eat the event-loop tick this write
      // needed to drain, so a piped watcher sees the ping arrive after runModeling's own
      // [modeling] log lines instead of before them.
      await offerPrune(kitDir, { interactive: !globalOpts.print && !opts.nonInteractive && !!process.stdin.isTTY });
      const shown = relative(cwd, kitDir);
      const runnerLabel = modelingLocalAi ? 'local model' : opts.exec ? 'one agent process per turn' : opts.mastra ? 'warm Mastra agent' : acpAgent ? `warm ${acpAgent.label} over ACP` : 'warm Claude process';
      await new Promise((res) => process.stdout.write(`▶ Starting modeling loop (${runnerLabel}) for ${shown && !shown.startsWith('..') ? shown : kitDir}...\n\n`, res));
      try {
        await runModeling(kitDir, projectDir, { codeDir, verbose: !!opts.verbose, standalone: !!opts.standalone, exclusive: !!opts.exclusive, worker: !!opts.worker, overrides, maxAgents, identity, localAi: modelingLocalAi, exec: opts.exec ?? null, mastra: !!opts.mastra, acp: acpAgent, resetSession: !!opts.resetSession, model: !opts.exec && modelingLocalAi === null && !acpAgent ? model : null, skipPermissions: !!opts.dangerouslySkipPermissions, browser: !!opts.browser });
      } catch (err) {
        console.error('[modeling] Fatal:', err);
        process.exit(1);
      }
      return;
    }

    if (!buildKitDir) {
      if (modelingKitDir) {
        console.error(`❌ A modeling-kit install (${MODELING_KIT.kitDirName}/) only runs via \`eventmodelers run --modeling\` — there is no cold-spawn/task-queue loop for modeling-only projects.`);
      } else {
        console.error(`❌ No kit installed in ${cwd} — run \`eventmodelers install\` first.`);
        console.error('   (A modeling agent needs no install at all: eventmodelers run --standalone --board-id <uuid>)');
      }
      process.exit(1);
    }
    const kitDir = buildKitDir;

    const localAiTarget = resolveLocalAiTarget(opts);
    const pickedCount = [localAiTarget !== null, !!opts.exec].filter(Boolean).length;
    if (pickedCount > 1) {
      console.error('❌ --local-ai and --exec are mutually exclusive — pick one runner.');
      process.exit(1);
    }

    await offerPrune(kitDir, { interactive: !globalOpts.print && !opts.nonInteractive && !!process.stdin.isTTY });

    // The actual agent loop lives in the scaffolded kit dir, not in this package — this
    // is just a thin dispatcher so users don't have to remember the kit-dir name or which
    // runner file to invoke. Users (and the agent itself, via AGENT.md) may customize these
    // files freely; `run` always executes whatever is currently on disk.
    const runner = opts.exec ? 'ralph-exec.js' : localAiTarget !== null ? 'ralph-local-ai.js' : opts.mastra ? 'ralph-mastra.js' : acpAgent ? 'ralph-acp.js' : 'ralph-claude.js';
    const runnerPath = join(kitDir, runner);
    if (!existsSync(runnerPath)) {
      console.error(`❌ ${relative(cwd, runnerPath)} not found.`);
      process.exit(1);
    }

    // --force on a build kit: same credentials step as `init-config`, against the project-root
    // config the runner reads, so the loop below picks up the fresh answer.
    if (opts.force) {
      if (opts.nonInteractive || globalOpts.print) {
        console.error('❌ --force asks for credentials again, which --non-interactive/--print rule out — pick one.');
        process.exit(1);
      }
      if (opts.local) {
        console.error('❌ --force asks for credentials, which --local (no platform config) never uses — pick one.');
        process.exit(1);
      }
      await forceBuildKitCredentials(kitDir, cwd, opts, globalOpts);
    }

    // ralph-claude.js hands every turn to a `claude` that only discovers MCP servers from
    // `.mcp.json` at its own startup, so it is rewritten on every run (see ensureMcpRegistered) —
    // a file deleted, or written for another baseUrl, since `init` would otherwise leave the agent
    // without its MCP tools. The token needs no file here: the runner puts it in claude's env.
    if (runner === 'ralph-claude.js' && !opts.local) {
      const runCfg = loadEffectiveConfig(cwd, kitDir, globalOpts.config).config;
      if (runCfg.token) {
        ensureMcpRegistered(dirname(kitDir), runCfg.baseUrl || DEFAULT_BASE_URL);
        ensureMcpEnabled(dirname(kitDir));
      }
    }

    console.log(`▶ Starting ${relative(cwd, runnerPath)}...\n`);
    const cmd = runner.endsWith('.sh') ? `"${runnerPath}"` : `node "${runnerPath}"`;
    try {
      // Only ralph-claude.js reads RALPH_VERBOSE — the local-AI executor has its own separate output
      // path with no stream-json parsing to gate. RALPH_LOCAL is read by ralph.js's startRalph to force
      // the local-only branch even when .eventmodelers/config.json has valid credentials.
      // RALPH_AGENT_ID/RALPH_AGENT_NAME (--id/--name) are read there too.
      execSync(cmd, { cwd: kitDir, stdio: 'inherit', env: { ...process.env, RALPH_VERBOSE: opts.verbose ? '1' : '', RALPH_SYNC: opts.sync ? '1' : '', RALPH_LOCAL: opts.local ? '1' : '', RALPH_HANDOVER: opts.handover ? '1' : '', RALPH_STATUS_TRIGGER: opts.statusTrigger ? String(opts.statusTrigger).trim() : '', RALPH_FEATURE: opts.feature ? String(opts.feature).trim() : '', RALPH_AGENT_ID: identity.agentId ?? '', RALPH_AGENT_NAME: identity.agentName ?? '', ...(typeof localAiTarget === 'string' ? { LOCAL_AI_TARGET: localAiTarget } : {}), ...(typeof opts.exec === 'string' ? { RALPH_EXEC_CMD: opts.exec } : {}), ...(acpAgent ? { RALPH_ACP_AGENT: opts.acpAgent ?? '', RALPH_ACP_CMD: opts.acpCmd ?? '' } : {}) } });
    } catch (err) {
      process.exit(err.status || 1);
    }
  });

program
  .command('listen')
  .description('Start the code-export listener (code-export.mjs) from the installed kit dir, or the bundled copy when no kit is installed — receives slice/screen data pushed from the eventmodelers board UI and writes it into .slices/')
  .option('--port <port>', 'Port to listen on (default 3001, or $PORT)')
  .action((opts) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);

    // With a kit installed, run its own code-export.mjs. Without one, run the copy bundled
    // in this CLI, rooted at the current directory so .slices/ lands here, not in the npx cache.
    const serverPath = kitDir ? join(kitDir, 'code-export.mjs') : join(__dirname, 'shared', 'build-kit', 'code-export.mjs');
    if (!existsSync(serverPath)) {
      console.error(`❌ ${relative(cwd, serverPath)} not found.`);
      process.exit(1);
    }

    console.log(`▶ Starting ${relative(cwd, serverPath)}...\n`);
    const env = { ...process.env, ...(opts.port && { PORT: opts.port }), ...(!kitDir && { SLICES_ROOT: cwd, WORKSPACE_PATH: cwd }) };
    try {
      execSync(`node "${serverPath}"`, { cwd: kitDir ?? cwd, stdio: 'inherit', env });
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

const prototypeApi = registerPrototype(program, { loadEffectiveConfig, findInstalledKitDir, configureCredentials, noInitRequired: NO_INIT_REQUIRED });
registerVibe(program);

const EXPORT_TYPES = ['eventcatalog', 'json'];

program
  .command('export')
  .description('Export the event model into another tool\'s format. --type eventcatalog writes an EventCatalog project (domain, flow, events, commands, queries); --type json writes .slices/ exactly as `listen` does, but pulled from the board (same as `fetch`). Reads the board by default; --local reads .slices/ or config.json instead')
  .requiredOption('--type <type>', `Export target: ${EXPORT_TYPES.join(', ')}`)
  .option('--context <name>', 'Name or id of the context to export. Omitted (or not found) on the board: pick from the board\'s contexts. Filters --local')
  .option('--all', 'Export every context, one after the other (not with --context)')
  .option('--local [path]', 'Read local files instead of the board — what `listen`/`fetch` wrote: ./.slices/, then ./config.json, or the given path')
  .option('--out <dir>', 'Directory to write into (the catalog root)', '.')
  .option('--owner <id>', 'Owner (team or user id from the catalog) set on every exported resource; repeat for several', (v, all) => [...all, v], [])
  .option('--check', 'Compare the model with what the last export wrote and exit 1 if they differ — writes nothing (for CI)')
  .option('-i, --interactive', 'List the new/changed elements (events, commands, queries, flows, domain) as a pre-checked list — in-sync ones are not shown — and export only the ones you leave ticked. Ticked resources that already exist are overwritten')
  .option('--flows', 'Also export the flows (one per chapter, linked from the domain). Without it only the domain, events, commands and queries are exported')
  .option('-f, --force', 'Overwrite resources that already exist in the catalog, and re-prompt for credentials when reading the board')
  .action(async (opts, command) => {
    if (!EXPORT_TYPES.includes(opts.type)) {
      console.error(`❌ Unknown export type "${opts.type}". Supported: ${EXPORT_TYPES.join(', ')}`);
      process.exit(1);
    }
    const cwd = process.cwd();
    const ext = await import('./extensions/eventcatalog/index.js');
    if (opts.interactive && (opts.type !== 'eventcatalog' || opts.check)) {
      console.error('❌ --interactive only applies to --type eventcatalog, and not together with --check.');
      process.exit(1);
    }
    if (opts.type === 'json') {
      // The pull-based `listen`: same .slices/<context>/<slice>/slice.json output, via runFetch.
      if (opts.local || opts.check) {
        console.error('❌ --type json reads the board and writes .slices/ — --local and --check do not apply.');
        process.exit(1);
      }
      if (opts.all && opts.context) {
        console.error('❌ --all and --context are mutually exclusive.');
        process.exit(1);
      }
      const kitDir = findInstalledKitDir(cwd);
      const slicesKitDir = kitDir?.endsWith(MODELING_KIT.kitDirName) ? null : kitDir;
      const globalOpts = command.optsWithGlobals();
      const explicitConfig = globalOpts.config;
      let cfg = loadEffectiveConfig(cwd, kitDir, explicitConfig).config;
      const configPath = explicitConfig ? resolve(cwd, explicitConfig) : join(cwd, '.eventmodelers', 'config.json');
      const requiredFields = ['organizationId', 'boardId', 'token'];
      const promptForCredentials = async (force = false) => {
        cfg = await configureCredentials({ config: cfg, configPath, targetDir: cwd, requiredFields, boardIdOptional: false, overrides: {}, print: globalOpts.print, force });
        if (requiredFields.some((f) => !cfg[f])) {
          console.error('❌ Still missing token/organizationId/boardId — re-run `eventmodelers export` once configured.');
          process.exit(1);
        }
      };
      if (opts.force || requiredFields.some((f) => !cfg[f])) await promptForCredentials(opts.force);
      const withAuthRetry = async (fn) => {
        try {
          return await fn();
        } catch (err) {
          if (!(err instanceof FetchAuthError) && err.status !== 404) throw err;
          console.error(`❌ ${err.message}`);
          if (err.status === 404) delete cfg.boardId;
          else delete cfg.token;
          await promptForCredentials();
          return fn();
        }
      };
      try {
        const contexts = await withAuthRetry(() => ext.listContexts({ cfg }));
        if (!contexts.length) throw new Error(`Board ${cfg.boardId} has no contexts with slices.`);
        let names;
        if (opts.all) names = contexts.map((c) => c.name);
        else if (opts.context) names = [opts.context];
        else if (contexts.length === 1) names = [contexts[0].name];
        else names = [await selectPrompt('Which context do you want to export?', contexts.map((c) => ({ label: `${c.name} (${c.slices} slice${c.slices === 1 ? '' : 's'})`, value: c.name })))];
        for (const name of names) {
          await withAuthRetry(() => runFetch({ cwd, kitDir: slicesKitDir, cfg, opts: { context: name, format: 'json' } }));
        }
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      return;
    }
    // Checked first, before any credentials or board access: the export only makes sense inside a catalog.
    if (!ext.isCatalog(resolve(cwd, opts.out))) {
      console.error(`❌ ${resolve(cwd, opts.out)} is not an EventCatalog project (no eventcatalog.config.* and no @eventcatalog/core dependency).`);
      console.error('   Run this inside your catalog, or point --out at it. Create one with: npx @eventcatalog/create-eventcatalog@latest my-catalog --empty');
      process.exit(1);
    }
    // `loadSlices(name)` reads one context; `contextNames` is what to export, one after the other.
    let loadSlices;
    let contextNames;
    try {
      if (opts.all && opts.context) throw new Error('--all and --context are mutually exclusive.');
      if (opts.local) {
        // Reads what `listen`/`fetch` wrote into .slices/<context>/<slice>/slice.json (or a config.json / given path).
        const localSlices = ext.loadFromLocal({ cwd, local: opts.local });
        const contexts = ext.listLocalContexts(localSlices);
        if (!contexts.length) throw new Error('No local slices found.');
        const bySlice = (name) => localSlices.filter((sl) => (sl.context || 'default').toLowerCase() === name.toLowerCase());
        loadSlices = async (name) => bySlice(name);
        if (opts.all) contextNames = contexts.map((c) => c.name);
        else if (opts.context) contextNames = [opts.context];
        else if (contexts.length === 1) contextNames = [contexts[0].name];
        else contextNames = [await selectPrompt('Which context do you want to export?', contexts.map((c) => ({ label: `${c.name} (${c.slices} slice${c.slices === 1 ? '' : 's'})`, value: c.name })))];
      } else {
        const kitDir = findInstalledKitDir(cwd);
        const globalOpts = command.optsWithGlobals();
        const explicitConfig = globalOpts.config;
        let cfg = loadEffectiveConfig(cwd, kitDir, explicitConfig).config;
        const configPath = explicitConfig ? resolve(cwd, explicitConfig) : join(cwd, '.eventmodelers', 'config.json');
        const requiredFields = ['organizationId', 'boardId', 'token'];
        const promptForCredentials = async (force = false) => {
          cfg = await configureCredentials({ config: cfg, configPath, targetDir: cwd, requiredFields, boardIdOptional: false, overrides: {}, print: globalOpts.print, force });
          if (requiredFields.some((f) => !cfg[f])) {
            console.error('❌ Still missing token/organizationId/boardId — re-run `eventmodelers export` once configured.');
            process.exit(1);
          }
        };
        // --force re-asks for credentials, like `init --force` / `init-config --force`.
        if (opts.force || requiredFields.some((f) => !cfg[f])) await promptForCredentials(opts.force);
        // A 401/403 re-asks for the token, like `fetch`; any other failure goes to the caller.
        const withAuthRetry = async (fn) => {
          try {
            return await fn();
          } catch (err) {
            if (err.status !== 401 && err.status !== 403 && err.status !== 404) throw err;
            console.error(`❌ ${err.message}`);
            if (err.status === 404) delete cfg.boardId;
            else delete cfg.token;
            await promptForCredentials();
            return fn();
          }
        };
        const pickContext = async (question) => {
          const contexts = await withAuthRetry(() => ext.listContexts({ cfg }));
          if (!contexts.length) throw new Error(`Board ${cfg.boardId} has no contexts with slices.`);
          return selectPrompt(question, contexts.map((c) => ({ label: `${c.name} (${c.slices} slice${c.slices === 1 ? '' : 's'})`, value: c.name })));
        };
        loadSlices = async (name) => {
          console.log(`▶ Reading context "${name}" from the board...`);
          return withAuthRetry(() => ext.loadFromBoard({ cfg, context: name }));
        };
        if (opts.all) {
          contextNames = (await withAuthRetry(() => ext.listContexts({ cfg }))).map((c) => c.name);
          if (!contextNames.length) throw new Error(`Board ${cfg.boardId} has no contexts with slices.`);
        } else {
          let context = opts.context || (await pickContext('Which context do you want to export?'));
          try {
            await loadSlices(context);
          } catch (err) {
            if (!(err instanceof ext.ContextNotFoundError)) throw err;
            console.error(`❌ ${err.message}`);
            context = await pickContext(`No context named "${context}" — pick one of the contexts on this board:`);
          }
          contextNames = [context];
        }
      }
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
    const outDir = resolve(cwd, opts.out);
    if (opts.check) {
      let outOfSync = false;
      for (const name of contextNames) {
      const slices = await loadSlices(name);
      const result = ext.check({ slices, outDir, context: name, flows: Boolean(opts.flows) });
      if (!result) {
        console.log(`ℹ️  No slices found in "${name}" — nothing to check.`);
        continue;
      }
      if (result.new.length) console.log(`new (${result.new.length}):\n${result.new.map((l) => `   ${l}`).join('\n')}`);
      if (result.changed.length) {
        console.log(`changed (${result.changed.length}):`);
        for (const { label, changes, renamedFrom } of result.changed) console.log(`   ${label}${renamedFrom ? ` (renamed from ${renamedFrom})` : ''}\n${changes.map((c) => `      ${c}`).join('\n')}`);
      }
      if (result.removed.length) console.log(`removed from the model (${result.removed.length}):\n${result.removed.map((l) => `   ${l}`).join('\n')}`);
      if (result.inSync) {
        console.log(`✅ "${result.context}" is in sync with the catalog (${result.unchanged.length} resources).`);
        continue;
      }
      console.log(`❌ "${result.context}" is out of sync. Run \`eventmodelers export --type eventcatalog --context "${result.context}"\` (add --force to update resources already in the catalog).`);
      outOfSync = true;
      }
      if (outOfSync) process.exit(1);
      return;
    }
    // The SDK comes from the catalog, never from this CLI. Missing → offer to install it there.
    let sdk = await ext.loadSdk(outDir);
    if (!sdk) {
      console.log(`@eventcatalog/sdk is not installed in ${outDir}.`);
      const install = await selectPrompt('Install @eventcatalog/sdk into this catalog now (npm install)?', [
        { label: 'Yes, run `npm install @eventcatalog/sdk` there', value: true },
        { label: 'No, cancel the export', value: false },
      ]);
      if (!install) {
        console.error('❌ The export needs @eventcatalog/sdk in the catalog. Install it (npm install @eventcatalog/sdk) and re-run.');
        process.exit(1);
      }
      try {
        ext.installSdk(outDir);
        sdk = await ext.loadSdk(outDir);
      } catch (err) {
        console.error(`❌ Could not install @eventcatalog/sdk: ${err.message}`);
        process.exit(1);
      }
      if (!sdk) {
        console.error('❌ @eventcatalog/sdk still cannot be resolved from the catalog after installing.');
        process.exit(1);
      }
    }
    // One context after the other.
    for (const name of contextNames) {
      const slices = await loadSlices(name);
      let only;
      if (opts.interactive) {
        const plan = ext.plan({ slices, outDir, context: name, flows: Boolean(opts.flows) });
        if (!plan) {
          console.log(`ℹ️  No slices found in "${name}" — nothing exported.`);
          continue;
        }
        // Only what differs from the catalog is worth a choice; in-sync elements are left alone.
        const pending = plan.items.filter((i) => i.status !== 'unchanged');
        if (!pending.length) {
          console.log(`✅ "${plan.context}" is in sync with the catalog — nothing to export.`);
          continue;
        }
        const tag = { new: 'new', changed: 'changed' };
        only = await checkboxPrompt(
          `"${plan.context}": which elements do you want to export?`,
          pending.map(({ label, status, changes }) => ({
            label: `${label}  [${tag[status]}]${changes?.length ? ` ${changes[0]}${changes.length > 1 ? ` (+${changes.length - 1})` : ''}` : ''}`,
            value: label,
            checked: true,
          })),
        );
        if (!only.length) {
          console.log(`ℹ️  Nothing selected for "${plan.context}" — nothing exported.`);
          continue;
        }
      }
      const { written, skipped, model } = await ext.run({ slices, outDir, context: name, force: opts.force || Boolean(only), owners: opts.owner, sdk, only, flows: Boolean(opts.flows) });
      if (!model) {
        console.log(`ℹ️  No slices found in "${name}" — nothing exported.`);
        continue;
      }
      console.log(`✅ Exported "${model.domain.name}" to ${outDir}: ${written.length} files written${skipped.length ? `, ${skipped.length} skipped (already in the catalog; use --force to overwrite)` : ''}.`);
      for (const f of skipped) console.log(`   skipped ${f}`);
    }
  });

program
  .command('scaffold <target> [args...]')
  .description('`scaffold up [dir] [--user <email:password>]` starts a scaffolded app (database, API and web, one command, Ctrl+c stops it; run in its folder or pass dir) and provisions the sign-in user if --user is given. `scaffold add-user <email> <password> [dir]` adds a sign-in user to a scaffolded app (run in its folder, or pass dir). `scaffold re-init [dir]` refreshes every kit the app has (root and web/) from this CLI version — `re-init --stack` for each, the skeleton itself untouched. Otherwise: generate a runnable app skeleton from the board — sign-in, navigation with one entry per timeline, a page shell per screen, 501 for every unbuilt endpoint, hot reload — and install the build kits of the chosen --type into it, ready for `run` to add slices. <target> is an empty or new directory, or a skeleton made earlier (which is refreshed from the current model).')
  .option('--type <name>', `Kind of app to scaffold (${scaffoldTypeNames().join(', ')})`, 'supabase')
  .option('--user <email:password>', '`scaffold up` only: create this sign-in user (or reset its password) once the database is up, e.g. --user test@test.de:secret')
  .option('--no-install', 'Stop after generating the skeleton: no npm install, checks or commit')
  .option('--no-check', 'Install dependencies but skip the type-check, tests and web build/lint')
  .option('--templates <dir>', 'Folder of *.tmpl files that replace the built-in skeleton template of the same path (or add files). Default: the target\'s own templates/ folder when it exists, so customisations survive a refresh')
  .option('--port <name=value>', "Pin one of the type's ports instead of picking a free one, e.g. --port api=3200 (repeatable; the names are listed in the error when one is unknown). A refresh keeps its ports unless pinned here", (v, all) => [...all, v], [])
  .action(async (target, args, opts, command) => {
    if (target === 'add-user') {
      const [email, password, dir] = args;
      if (!email || !password) {
        console.error('❌ usage: eventmodelers scaffold add-user <email> <password> [dir]');
        process.exit(1);
      }
      const addUser = SCAFFOLD_TYPES[opts.type]?.addUser;
      if (!addUser) {
        console.log(`ℹ️  The "${opts.type}" scaffold has no users — nothing to do.`);
        return;
      }
      const appDir = resolve(process.cwd(), dir ?? '.');
      if (!existsSync(join(appDir, addUser.requires))) {
        console.error(`❌ ${appDir} is not a scaffolded "${opts.type}" app (no ${addUser.requires}) — run this in its folder or pass the folder as the last argument.`);
        process.exit(1);
      }
      const [file, ...fileArgs] = addUser.command(email, password);
      try {
        execFileSync(file, fileArgs, { cwd: appDir, stdio: 'inherit' });
      } catch {
        process.exit(1);
      }
      return;
    }
    if (target === 'up') {
      if (args.length > 1) {
        console.error('❌ usage: eventmodelers scaffold up [dir]');
        process.exit(1);
      }
      const up = SCAFFOLD_TYPES[opts.type]?.up;
      if (!up) {
        console.error(`❌ Unknown --type "${opts.type}". Available: ${scaffoldTypeNames().join(', ')}`);
        process.exit(1);
      }
      const appDir = resolve(process.cwd(), args[0] ?? '.');
      if (!existsSync(join(appDir, up.requires))) {
        console.error(`❌ ${appDir} is not a scaffolded "${opts.type}" app (no ${up.requires}) — run this in its folder or pass the folder as the last argument.`);
        process.exit(1);
      }
      const [file, ...fileArgs] = up.command;
      if (opts.user) {
        const split = opts.user.indexOf(':');
        if (split < 1 || split === opts.user.length - 1) {
          console.error('❌ --user expects <email:password>, e.g. --user test@test.de:secret');
          process.exit(1);
        }
        fileArgs.push('--', '--user', opts.user);
      }
      const inv = invocation(file, fileArgs);
      try {
        execFileSync(inv.file, inv.args, { cwd: appDir, stdio: 'inherit', shell: inv.shell });
      } catch (err) {
        process.exit(err.status ?? 1);
      }
      return;
    }
    if (target === 're-init') {
      if (args.length > 1) {
        console.error('❌ usage: eventmodelers scaffold re-init [dir]');
        process.exit(1);
      }
      if (!SCAFFOLD_TYPES[opts.type]) {
        console.error(`❌ Unknown --type "${opts.type}". Available: ${scaffoldTypeNames().join(', ')}`);
        process.exit(1);
      }
      try {
        const refreshed = reinitKits({ typeName: opts.type, target: resolve(process.cwd(), args[0] ?? '.'), cliPath: join(__dirname, 'cli.js') });
        console.log(`\n✅ ${refreshed.length} kit(s) refreshed to ${CLI_VERSION}${refreshed.length ? `: ${refreshed.join(', ')}` : ''}`);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      return;
    }
    if (args.length) {
      console.error(`❌ Unexpected argument(s): ${args.join(' ')}`);
      process.exit(1);
    }
    const type = SCAFFOLD_TYPES[opts.type];
    if (!type) {
      console.error(`❌ Unknown --type "${opts.type}". Available: ${scaffoldTypeNames().join(', ')}`);
      process.exit(1);
    }
    const missing = missingPrerequisites(type);
    if (missing.length) {
      console.error(`❌ Missing on this machine:\n${missing.map((m) => `   - ${m}`).join('\n')}`);
      process.exit(1);
    }

    const cwd = process.cwd();
    const globalOpts = command.optsWithGlobals();
    let cfg = loadEffectiveConfig(cwd, findInstalledKitDir(cwd), globalOpts.config).config;
    const explicit = Object.fromEntries(Object.entries(credentialOverridesFromOpts(opts)).filter(([, v]) => v));
    cfg = { ...cfg, ...explicit };
    const configPath = globalOpts.config ? resolve(cwd, globalOpts.config) : join(cwd, '.eventmodelers', 'config.json');
    const requiredFields = ['organizationId', 'boardId', 'token'];
    const promptForCredentials = async () => {
      cfg = await configureCredentials({ config: cfg, configPath, targetDir: cwd, requiredFields, boardIdOptional: false, overrides: {}, print: globalOpts.print });
      if (requiredFields.some((f) => !cfg[f])) {
        console.error('❌ Still missing token/organizationId/boardId — re-run `eventmodelers scaffold` once configured.');
        process.exit(1);
      }
    };
    if (requiredFields.some((f) => !cfg[f])) await promptForCredentials();

    const readModel = async () => {
      const baseUrl = cfg.baseUrl || 'https://api.eventmodelers.ai';
      const headers = { 'x-token': cfg.token, 'x-user-id': 'cli-scaffold', 'content-type': 'application/json' };
      const call = async (url, what, init) => {
        const res = await fetch(url, { headers, ...init }).catch((err) => {
          console.error(`❌ Request failed (${what}): ${err.message}`);
          process.exit(1);
        });
        if (res.status === 401 || res.status === 403) throw new FetchAuthError(res.status, `${what}: ${res.status === 401 ? 'invalid or expired token' : "token's organization does not match this board"}`);
        if (!res.ok) {
          console.error(`❌ ${what}: HTTP ${res.status}`);
          process.exit(1);
        }
        return res.json();
      };
      const boardBase = `${baseUrl}/api/org/${cfg.organizationId}/boards/${cfg.boardId}`;
      const boards = await call(`${baseUrl}/api/boards`, 'boards').catch((err) => { if (err instanceof FetchAuthError) throw err; return []; });
      const board = (Array.isArray(boards) ? boards : boards.boards ?? []).find((b) => b.id === cfg.boardId);
      return buildModel({
        appTitle: board?.name ?? board?.title,
        api: {
          get: (path) => call(`${boardBase}${path}`, path.split('?')[0]),
          post: (path, body) => call(`${boardBase}${path}`, path, { method: 'POST', body: JSON.stringify(body) }),
        },
      });
    };

    console.log(`▶ Reading the model of board ${cfg.boardId}...`);
    let model;
    try {
      model = await readModel();
    } catch (err) {
      if (!(err instanceof FetchAuthError)) throw err;
      console.error(`❌ ${err.message}`);
      if (err.status === 404) delete cfg.boardId;
      else delete cfg.token;
      await promptForCredentials();
      model = await readModel();
    }
    console.log(`  ${model.timelines.length} timeline(s), ${model.slices.length} slice(s), ${model.screens.length} screen(s), css: ${model.css}`);

    try {
      const { root, ports } = await runScaffold({
        typeName: opts.type,
        target,
        cfg,
        model,
        cliPath: join(__dirname, 'cli.js'),
        install: opts.install,
        check: opts.check,
        templates: opts.templates ? resolve(cwd, opts.templates) : undefined,
        ports: Object.fromEntries(opts.port.map((kv) => kv.split(/=(.*)/s).slice(0, 2))),
      });
      console.log(`\n✅ Skeleton ready in ${root}`);
      console.log(`   cd ${relative(cwd, root) || '.'} && npm run up        # ${Object.entries(ports).map(([n, v]) => `${n} :${v}`).join(', ')}`);
      console.log('   npx @eventmodelers/cli scaffold add-user <email> <password>   # a user to sign in with (no sign-up screen)');
      console.log('   npx @eventmodelers/cli run --all   # then build: every kit in the project, in this terminal');
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('init-templates [paths...]')
  .description('Copy the built-in scaffold templates into ./templates/ (or --dir) so you can edit them: `scaffold` uses a template found there and falls back to the built-in one for everything else. Name paths (a file like web/src/app/Layout.tsx, or a folder like web/src/app) to copy only those — a copied template no longer follows the CLI\'s own updates, so take only what you mean to change. Existing files are kept unless --force.')
  .option('--type <name>', `Scaffold type whose templates to copy (${scaffoldTypeNames().join(', ')})`, 'supabase')
  .option('--dir <dir>', 'Where to copy them', 'templates')
  .option('--list', 'Only list the built-in template paths')
  .option('-f, --force', 'Overwrite templates already in the folder')
  .action((paths, opts) => {
    const type = SCAFFOLD_TYPES[opts.type];
    if (!type) {
      console.error(`❌ Unknown --type "${opts.type}". Available: ${scaffoldTypeNames().join(', ')}`);
      process.exit(1);
    }
    if (opts.list) {
      for (const rel of builtInTemplates(type).keys()) console.log(rel);
      return;
    }
    try {
      const dest = resolve(process.cwd(), opts.dir);
      const { copied, kept } = initTemplates(type, dest, { only: paths, force: opts.force });
      for (const rel of copied) console.log(`  ✓ ${relative(process.cwd(), join(dest, `${rel}.tmpl`))}`);
      if (kept.length) console.log(`  ${kept.length} already there, kept (use --force to overwrite)`);
      console.log(`\n✅ ${copied.length} template(s) copied. Edit them, then run \`eventmodelers scaffold <dir>\` — it uses ${relative(process.cwd(), dest) || '.'}/ when that is the target's templates/ folder, or pass --templates.`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('activate-context')
  .description('Choose which fetched context is active — writes .slices/current_context.json, which `run` works through first; once it has no planned slices left, `run` moves on to the next context that does')
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
  { label: '🧭 Ready', value: 'Ready' },
  { label: '📅 Planned', value: 'Planned' },
  { label: '🤝 Waiting', value: 'Waiting' },
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
          meta: { type: 'SLICE_BORDER', sliceStatus: newStatus },
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

// The kit a command that records events works against: a build kit if one is installed, else the modeling
// kit. The build kit wins when both are installed — the modeling agent never runs these commands itself
// (its Bash is an allowlist); it states its learnings in its reply and `runModeling` records them.
function requireBuildKitDir(cwd) {
  const installed = findAllInstalledKitDirs(cwd);
  const kitDir = installed.find((d) => !d.endsWith(MODELING_KIT.kitDirName)) ?? installed.find((d) => d.endsWith(MODELING_KIT.kitDirName));
  if (!kitDir) {
    console.error('❌ This command needs a build or modeling kit (npx @eventmodelers/cli init --stack <name> or init --modeling).');
    process.exit(1);
  }
  return kitDir;
}

// What the build agent's events are stamped with: the loop exports the agent id into its environment.
function agentEventMeta(cwd, kitDir, command) {
  const { config: cfg } = loadEffectiveConfig(cwd, kitDir, command.optsWithGlobals().config);
  return {
    agent_id: process.env.RALPH_AGENT_ID || process.env.EVENTMODELERS_AGENT_ID,
    agent_type: 'BUILD', // `learn` and `slice-status` are the build agent's commands
    organization_id: cfg.organizationId,
    board_id: cfg.boardId,
  };
}

program
  .command('slice-status <status>')
  .description("For a build agent: record the outcome of the slice the run loop is building (Done, Waiting, Blocked, ...). The loop owns the slice's status on the board and pushes it when the build ends — never edit index.json or call update-slice-status for a loop build.")
  .option('--slice <idOrTitle>', 'The slice, when the loop has claimed more than one (default: the one it is building)')
  .action((status, opts, command) => {
    const cwd = process.cwd();
    // `Handover` is the old name of `Waiting`; older skills and prompts still say it
    const wanted = status.toLowerCase() === 'handover' ? 'waiting' : status.toLowerCase();
    const canonical = SLICE_STATUSES.find((s) => s.value.toLowerCase() === wanted)?.value;
    if (!canonical) {
      console.error(`❌ "${status}" is not a slice status. Valid: ${SLICE_STATUSES.map((s) => s.value).join(', ')}`);
      process.exit(1);
    }
    const kitDir = requireBuildKitDir(cwd);
    const meta = agentEventMeta(cwd, kitDir, command);
    try {
      const result = recordAgentStatus({ kitDir, status: canonical, sliceId: opts.slice, meta });
      console.log(`✅ "${result.title}": recorded ${result.status} — the run loop pushes it to the board when the build ends.`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('ui-baseline <action>')
  .alias('build-baseline')
  .description("For a build agent: decide whether a slice's UI needs work. `check` compares the board's hashes of the slice's screen and of every element of the slice and its codeGen.uiPrompts with what was recorded after the last UI build and prints NO_BASELINE, UNCHANGED or CHANGED (UNCHANGED = skip all UI work). `record` stores the current state once the UI is built — commit the resulting ui-baseline.json with the slice.")
  .option('--slice <idOrTitle>', 'The slice (default: the one the run loop has claimed)')
  .option('--scope <scope>', 'ui (default): screen, elements and UI prompts · backend: elements only, for a kit that builds no UI', 'ui')
  .action(async (action, opts, command) => {
    if (!['ui', 'backend'].includes(opts.scope)) {
      console.error('❌ --scope must be `ui` or `backend`.');
      process.exit(1);
    }
    if (!['check', 'record'].includes(action)) {
      console.error('❌ Action must be `check` or `record`.');
      process.exit(1);
    }
    const cwd = process.cwd();
    const kitDir = requireBuildKitDir(cwd);
    let wanted = opts.slice;
    if (!wanted) {
      const claimed = Object.entries(fold(readEvents(kitDir)).slices).filter(([, s]) => s.claim);
      if (claimed.length !== 1) {
        console.error(`❌ ${claimed.length ? `${claimed.length} slices are claimed` : 'No slice is claimed by the run loop'} — name the slice with --slice.`);
        process.exit(1);
      }
      wanted = claimed[0][0];
    }
    const found = findSliceDir(kitDir, wanted);
    if (!found) {
      console.error(`❌ Slice "${wanted}" not found under ${relative(cwd, join(kitDir, '.slices'))}.`);
      process.exit(1);
    }
    const globalOpts = command.optsWithGlobals();
    const cfg = loadEffectiveConfig(cwd, kitDir, globalOpts.config).config;
    const fetchNodes = async (ids) => {
      if (['organizationId', 'boardId', 'token'].some((f) => !cfg[f])) throw new Error('token/organizationId/boardId are not configured (.eventmodelers/config.json)');
      const res = await fetch(`${cfg.baseUrl || DEFAULT_BASE_URL}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/nodes/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-user-id': 'cli-ui-baseline', ...agentHeaders(cfg) },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`board returned HTTP ${res.status}`);
      return res.json();
    };
    let fp;
    try {
      fp = await fingerprint({ slice: found.slice, fetchNodes, scope: opts.scope });
    } catch (err) {
      // Cannot tell — the safe answer is the full check, never a skip.
      console.log('UNKNOWN');
      console.log(`Could not read the screen from the board (${err.message}) — do the full screen diff.`);
      return;
    }
    if (action === 'record') {
      writeBaseline(found.path, fp, opts.scope);
      console.log(`✅ Recorded the ${opts.scope === 'backend' ? 'build' : 'UI'} baseline for "${found.slice.title}" (${relative(cwd, join(found.path, 'ui-baseline.json'))}) — commit it with the slice.`);
      return;
    }
    const result = compare(readBaseline(found.path), fp, opts.scope);
    console.log(result.verdict);
    if (result.verdict === 'UNCHANGED') {
      console.log('Screen, elements and UI prompts are as of the last UI build — skip all UI work.');
      return;
    }
    if (result.verdict === 'NO_BASELINE') console.log('No UI build recorded for this slice yet — do one full screen diff, apply every UI prompt, then `ui-baseline record`.');
    const nodeLine = (label, list) => (list.length ? `\n  ${label}: ${list.map((n) => `${n.title} (${n.kind === 'screen' ? 'screen' : n.kind.replace(/s$/, '')})`).join(', ')}` : '');
    const nodeDetail = nodeLine('changed', result.changedNodes) + nodeLine('added', result.addedNodes) + nodeLine('removed', result.removedNodes);
    if (nodeDetail) console.log(`Since the last recorded build:${nodeDetail}\nWork on exactly these; leave what matches alone.`);
    if (result.screenChanged && result.verdict === 'CHANGED') console.log('SCREEN_CHANGED: re-fetch the screen node, diff the components against it and adjust the UI.');
    if (result.elementsChanged && result.verdict === 'CHANGED') console.log('ELEMENTS_CHANGED: an element of the slice (command, event, read model, processor, table, actor, aggregate, specification, ...) changed on the board — diff slice.json against the code field by field.');
    if (result.promptsChanged) console.log(`PROMPTS_CHANGED: apply ${result.newPrompts.length ? 'these new/changed UI prompts' : 'the UI prompts (they were edited or removed — re-read them)'}:${result.newPrompts.map((p) => `\n  - ${p.trim()}`).join('')}`);
    console.log('When the UI is done, run `ui-baseline record`.');
  });

program
  .command('learn [text]')
  .description("For a build agent: record one reusable learning (a codebase pattern, a gotcha, a command that works or doesn't, what a failed approach tried and why it failed). .build-kit/AGENTS.md is generated from the recorded learnings — never edit it by hand. --retract withdraws a wrong or obsolete one (ids: `learnings --ids`).")
  .option('--topic <topic>', 'Group the learning under this heading in AGENTS.md')
  .option('--tag <tag>', 'Label the learning (repeatable)', (tag, tags) => [...tags, tag], [])
  .option('--scope <scope>', 'system: true of the modeled domain · repo: about the codebase and its tooling (default repo)')
  .option('--slice <slice>', 'The slice it was learned on')
  .option('--retract <id>', 'Withdraw the learning with this id (or a unique prefix of it) instead of recording one')
  .option('--merge <ids>', 'Replace these learnings (comma-separated ids) by one with the given text — the curator\'s tool')
  .option('--reason <reason>', 'Why — recorded with a retraction or a merge')
  .action((text, opts, command) => {
    const cwd = process.cwd();
    const kitDir = requireBuildKitDir(cwd);
    const meta = agentEventMeta(cwd, kitDir, command);
    try {
      if (opts.retract !== undefined) {
        const gone = retractLearning({ kitDir, id: opts.retract, reason: opts.reason, meta });
        console.log(`✅ Retracted: ${gone.text}`);
        return;
      }
      if (opts.merge !== undefined) {
        const ids = opts.merge.split(',').map((id) => id.trim()).filter(Boolean);
        const merged = mergeLearnings({ kitDir, ids, text, topic: opts.topic, scope: opts.scope, tags: opts.tag, reason: opts.reason, meta });
        console.log(`✅ Merged ${ids.length} learnings into one (${merged.id.slice(0, 8)}).`);
        return;
      }
      if (text === undefined) throw new Error('give the learning as text, or --retract <id>, or --merge <ids> <text>');
      // The curator may only merge and retract — an LLM asked to tidy must not add facts of its own.
      if (process.env.EVENTMODELERS_CURATING === '1') throw new Error('a curation turn only merges and retracts — new learnings are not recorded during it');
      const result = recordLearning({ kitDir, text, topic: opts.topic, tags: opts.tag, scope: opts.scope ?? 'repo', slice: opts.slice, meta });
      console.log(result.duplicate ? `ℹ️  Already recorded (${result.id.slice(0, 8)}) — nothing to add.` : `✅ Recorded (${result.id.slice(0, 8)}) — .build-kit/AGENTS.md is updated.`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('info <text>')
  .description("For a build agent: record something that is not a reusable learning — what you cannot change and why (limitation), a decision you took, a note. It is an event in the log and a comment on the slice. Reusable knowledge about the codebase or model is a `learn`, not an info.")
  .option('--kind <kind>', `${INFO_KINDS.join(' · ')} (default note)`, 'note')
  .option('--slice <idOrTitle>', 'The slice it is about (default: the one the run loop has claimed)')
  .option('--tag <tag>', 'Label the info (repeatable)', (tag, tags) => [...tags, tag], [])
  .action(async (text, opts, command) => {
    const cwd = process.cwd();
    const kitDir = requireBuildKitDir(cwd);
    const meta = agentEventMeta(cwd, kitDir, command);
    try {
      let sliceId;
      if (opts.slice) sliceId = findSliceDir(kitDir, opts.slice)?.slice.id ?? opts.slice;
      else {
        const claimed = Object.entries(fold(readEvents(kitDir)).slices).filter(([, s]) => s.claim);
        if (claimed.length === 1) sliceId = claimed[0][0];
      }
      const info = recordInfo({ kitDir, text, kind: opts.kind, slice: sliceId, tags: opts.tag, meta });
      console.log(`✅ Recorded ${info.kind} (${info.id.slice(0, 8)}).`);
      if (!sliceId) return console.log('ℹ️  No slice named or claimed — not posted to the board.');
      // Best effort: the event is the record, the comment is how the board shows it.
      const cfg = loadEffectiveConfig(cwd, kitDir, command.optsWithGlobals().config).config;
      if (['organizationId', 'boardId', 'token'].some((f) => !cfg[f])) return console.log('ℹ️  No board credentials — not posted to the board.');
      const res = await fetch(`${cfg.baseUrl || DEFAULT_BASE_URL}/api/org/${cfg.organizationId}/boards/${cfg.boardId}/nodes/${sliceId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': cfg.token, 'x-user-id': 'cli-info', ...agentHeaders(cfg) },
        body: JSON.stringify({ text: infoComment(info), type: 'COMMENT', author: 'build-agent' }),
        signal: AbortSignal.timeout(15_000),
      });
      console.log(res.ok ? '✅ Posted as a comment on the slice.' : `⚠️  Board returned HTTP ${res.status} — the info is only in the event log.`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('events')
  .description("Decode a kit's event log in the terminal: one line per event (claims, settles, learnings, tasks, prompts …) with the slice's title and the agent that wrote it. Filter it, print the raw events, or print the state the log folds to.")
  .option('--kit <dir>', "Read this kit directory's log (default: the build kit of the current project, else its modeling kit; in a prototype folder, its control log in .prototype/)")
  .option('--global', 'Read the log of the global install (~/.eventmodelers/kit) — what runs started without a project install wrote')
  .option('--board <id>', "Only events stamped with this board (an id prefix) — the global install's log mixes every board")
  .option('--type <types>', 'Only these event types, comma-separated (e.g. claimed,settled)')
  .option('--slice <slice>', 'Only events of the slice with this id (prefix) or a title containing this text')
  .option('--tag <tag>', 'Only events carrying this tag')
  .option('--last <n>', 'Only the last n events (after the other filters)')
  .option('--json', 'Print the raw events, one JSON object per line')
  .option('--verbose', 'Print each event\'s payload under its line — for a tool call, the input it was sent (recorded by runs started with --verbose). Also shows the baseline events: the kit\'s first look at each slice (a fresh kit records every slice already on the board), which are hidden by default. `--type board-observed` and `--json` show them too.')
  .option('--state', 'Print the state the log folds to (slices, queue, open prompts, learnings) instead of the events')
  .option('--prune', 'Delete the events nothing reads any more — the journal of finished prompts — and stop. Slice state, learnings and open prompts are kept; the same prune a run offers at every 1000 events.')
  .option('--follow', 'Keep running and print events as they are appended')
  .option('--watch', 'Same as --follow')
  .action(async (opts) => {
    const cwd = process.cwd();
    if (opts.global && opts.kit) {
      console.error('❌ --global and --kit are alternatives — pick one.');
      process.exit(1);
    }
    const globalLog = join(GLOBAL_KIT_DIR, MODELING_KIT.kitDirName);
    // A prototype folder has no kit, but its control log (what the player's saved-feedback / Sync / Rebuild recorded) is the same store.
    const prototypeLog = join(cwd, '.prototype');
    const inPrototype = !opts.global && !opts.kit && !findInstalledKitDir(cwd) && existsSync(join(prototypeLog, 'events.log'));
    const kitDir = opts.global ? globalLog : opts.kit ? resolve(cwd, opts.kit) : inPrototype ? prototypeLog : requireBuildKitDir(cwd);
    if (opts.prune) {
      try {
        const { removed, kept } = pruneLog(kitDir);
        rememberPruneAnswer(kitDir, kept);
        console.log(removed ? `Pruned ${removed} events, ${kept} left.` : `Nothing to prune — ${kept} events, all of them carry state.`);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      return;
    }
    let last;
    if (opts.last !== undefined) {
      last = Number(opts.last);
      if (!Number.isInteger(last) || last < 1) {
        console.error('❌ --last needs a positive number.');
        process.exit(1);
      }
    }
    const filter = { types: opts.type?.split(',').map((t) => t.trim()).filter(Boolean), slice: opts.slice, tag: opts.tag, board: opts.board };
    const color = process.stdout.isTTY && !process.env.NO_COLOR;
    const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
    const family = (type) => (/^(claim|settled|agent-recorded|task-done|prompt-finished)/.test(type) ? '32' : /^(attempt-failed|blocked|released)/.test(type) ? '31' : /^(learning|learnings)/.test(type) ? '36' : /^(prompt|task)/.test(type) ? '35' : '33');
    const print = (events, titles) => {
      for (const e of events) {
        if (opts.json) { console.log(JSON.stringify(e)); continue; }
        const [time, ...rest] = formatEvent(e, { titles }).split('  ');
        const type = rest.shift();
        console.log([paint('2', time), paint(family(e.type), type), ...rest].join('  '));
        if (opts.verbose) { const payload = formatPayload(e); if (payload) console.log(paint('2', payload)); }
      }
    };

    const follow = opts.follow || opts.watch;
    const events = readEvents(kitDir);
    // The baseline (each slice's first board-observed) is noise unless asked for: --verbose, the raw --json, or the type itself.
    const hideBaseline = !opts.verbose && !opts.json && !filter.types?.includes('board-observed');
    const titles = sliceTitles(events);
    if (opts.state) {
      if (follow) console.error('ℹ️  --follow/--watch does not apply to --state.');
      console.log(events.length ? summarize(fold(events), titles) : 'No events yet in this kit.');
      return;
    }
    if (!events.length && !follow) {
      console.log(`No events yet in ${opts.global ? '~/.eventmodelers/kit' : relative(cwd, kitDir) || kitDir}.`);
      // Runs started without a project install keep their log in the global kit — say so when it has one.
      if (!opts.global && !opts.kit && readEvents(globalLog).length) console.log('The global install has a log of its own: `eventmodelers events --global`.');
      return;
    }
    print(filterEvents(events, { ...filter, last, omit: hideBaseline ? baselineIds(events) : undefined }, titles), titles);
    if (!follow) return;

    // Follow: what has been printed is remembered by event id, and the log is read again twice a second.
    const seen = new Set(events.map((e) => e.id));
    setInterval(() => {
      const all = readEvents(kitDir);
      const fresh = all.filter((e) => !seen.has(e.id));
      for (const e of fresh) seen.add(e.id);
      if (fresh.length) print(filterEvents(fresh, { ...filter, omit: hideBaseline ? baselineIds(all) : undefined }, sliceTitles(all)), sliceTitles(all));
    }, 500);
  });

program
  .command('replay <id>')
  .description("Submit a prompt from the event log again: puts it back on its board's queue as a new prompt, with the same text, node, comment, priority and canvas context, for an agent to work. <id> is a prompt id from `events` (a unique prefix will do). Writes to the platform.")
  .option('--kit <dir>', "Read this kit directory's log (default: the build kit of the current project, else its modeling kit)")
  .option('--global', 'Read the log of the global install (~/.eventmodelers/kit)')
  .option('--dry-run', 'Show the request that would be sent and stop — nothing is submitted')
  .option('--token <uuid>', 'API token (overrides config file / env var)')
  .option('--organization-id <uuid>', 'Organization ID (overrides config file / env var)')
  .option('--base-url <url>', 'Platform base URL (overrides config file / env var)')
  .action(async (id, opts) => {
    const cwd = process.cwd();
    if (opts.global && opts.kit) {
      console.error('❌ --global and --kit are alternatives — pick one.');
      process.exit(1);
    }
    const kitDir = opts.global ? join(GLOBAL_KIT_DIR, MODELING_KIT.kitDirName) : opts.kit ? resolve(cwd, opts.kit) : requireBuildKitDir(cwd);
    try {
      const event = findPromptEvent(readEvents(kitDir), id);
      const boardId = event.prompt.board_id ?? event.meta?.board_id;
      // The credentials of the board the prompt was for: flags and env vars over the board's own file over the account's.
      const stored = boardId ? readJsonSafe(boardCredentialsPath(boardId)) : {};
      const explicit = Object.fromEntries(Object.entries(credentialOverridesFromOpts(opts)).filter(([, v]) => v));
      const cfg = applyEnvOverrides({ ...loadEffectiveConfig(cwd, null, null).config, ...(stored.useGlobal || stored.useBoard ? {} : stored), ...explicit });
      cfg.baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
      if (!cfg.token || !cfg.organizationId) throw new Error('no credentials for this board — pass --token/--organization-id, or run the agent once for it');

      const tokenRes = await fetch(`${cfg.baseUrl}/api/org/${cfg.organizationId}/prompts/realtime-token`, { headers: { 'x-token': cfg.token } });
      if (!tokenRes.ok) throw new Error(`realtime-token: HTTP ${tokenRes.status}`);
      const { url, headers, body } = replayRequest({ baseUrl: cfg.baseUrl, organizationId: cfg.organizationId, token: cfg.token, jwt: (await tokenRes.json()).token, event: { ...event, prompt: { ...event.prompt, board_id: boardId } } });
      if (opts.dryRun) {
        console.log(`POST ${url}\n${JSON.stringify(body, null, 2)}`);
        return;
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`prompts: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const created = await res.json();
      console.log(`Re-submitted prompt ${String(event.prompt.id).slice(0, 8)} as ${String(created.id ?? '').slice(0, 8)}: "${event.prompt.text.length > 80 ? `${event.prompt.text.slice(0, 79)}…` : event.prompt.text}"`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('learnings')
  .description('Print the recorded learnings — what .build-kit/AGENTS.md says. With --ids, one line each with the id to retract it by.')
  .option('--ids', 'One line per learning: id, topic, text')
  .action((opts, command) => {
    const cwd = process.cwd();
    const kitDir = requireBuildKitDir(cwd);
    syncLearnings({ kitDir, meta: agentEventMeta(cwd, kitDir, command) });
    const all = listLearnings(kitDir);
    if (!all.length) {
      console.log('No learnings recorded yet.');
      return;
    }
    if (!opts.ids) {
      console.log(readFileSync(join(kitDir, 'AGENTS.md'), 'utf-8').trimEnd());
      return;
    }
    for (const l of all) console.log(`  ${l.id.slice(0, 8)}  [${l.topic ?? 'General'}]  ${l.text}`);
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
  .option('--vibe-coding', 'Remove vibe coding: .vibe/, the vibe skills and the CLAUDE.md block (same as `vibe remove`). The build kit, the modeling skills and the board are left alone.')
  .action((opts) => {
    if (opts.vibeCoding) return uninstallVibe();
    const cwd = process.cwd();
    let targets;

    if (opts.buildKit || opts.modelingKit) {
      targets = [];
      if (opts.buildKit) targets.push(join(cwd, STACKS.node.kitDirName));
      if (opts.modelingKit) targets.push(join(cwd, MODELING_KIT.kitDirName));
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
        console.log('⚠️  Multiple kit dirs found — re-run with --build-kit and/or --modeling-kit to pick which to remove.');
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
  .option('--handover <on|off>', "Turn the backend→UI handover on or off for this project (saved as `handover` in the project's .eventmodelers/config.json). On: a backend build kit ends slices that have a UI at `Handover`; off: at `Done`.")
  .option('--agent-tracing <on|off>', "Turn agent tracing on or off for this project (saved as `agentTracing` in the project's .eventmodelers/config.json). Off: the build agent sends no slice cost data to the platform at all. A non-Claude agent via run --exec is only traced when its command includes the harness's JSON output flag, e.g. \"codex exec --json --full-auto\".")
  .action((opts, command) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);
    const explicitConfig = command.optsWithGlobals().config;

    if (opts.handover !== undefined) {
      const value = String(opts.handover).toLowerCase();
      if (!['on', 'off'].includes(value)) {
        console.error('❌ --handover takes "on" or "off"');
        process.exit(1);
      }
      const configPath = projectConfigPath(cwd, kitDir, explicitConfig);
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify({ ...readJsonSafe(configPath), handover: value === 'on' }, null, 2));
      console.log(`✓ Handover ${value} — saved to ${relative(cwd, configPath) || configPath}\n`);
    }
    if (opts.agentTracing !== undefined) {
      const value = String(opts.agentTracing).toLowerCase();
      if (!['on', 'off'].includes(value)) {
        console.error('❌ --agent-tracing takes "on" or "off"');
        process.exit(1);
      }
      const configPath = projectConfigPath(cwd, kitDir, explicitConfig);
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify({ ...readJsonSafe(configPath), agentTracing: value === 'on' }, null, 2));
      console.log(`✓ Agent tracing ${value} — saved to ${relative(cwd, configPath) || configPath}\n`);
    }
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

try {
  await program.parseAsync();
} catch (err) {
  // A bug or bad input must end as one readable line, not a Node stack trace.
  console.error(`❌ ${err?.message ?? err}`);
  if (process.env.EVENTMODELERS_DEBUG && err?.stack) console.error(err.stack);
  process.exitCode = 1;
}
if (sharedRl) sharedRl.close();