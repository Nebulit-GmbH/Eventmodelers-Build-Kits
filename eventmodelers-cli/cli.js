#!/usr/bin/env node

import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve, sep } from 'path';
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
import { execSync } from 'child_process';
import { createInterface, emitKeypressEvents, moveCursor, clearScreenDown } from 'readline';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Each stack is a template set under stacks/<key>/templates/{.claude,root,<kitSubdir>}.
// Stacks with useShared:true also get shared/build-kit/* copied into their kit dir
// first (ralph.js, ralph-claude.js, ralph-ollama.js, ralph.sh, realtime-agent.js,
// code-export.mjs, lib/agent.sh, lib/ollama-agent.js, package.json, README.md) —
// those files have no per-stack content, so they live once instead of being
// copy-pasted into every stack (that copy-pasting is exactly how they drifted out
// of sync before: a bugfix or default landing in one stack's copy but not another's).
// Each stack's own templates/<kitSubdir>/* is then overlaid on top for genuine
// per-stack differences (ralph-claude.js's build tooling, lib/prompt.md, etc.) —
// see stacks/modeling-kit for an example of a kit with fully different entry-point
// logic that still reuses the shared runtime pieces.
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
  'cratis-csharp': {
    label: 'Cratis (.NET/C#)',
    kitSubdir: 'build-kit',
    kitDirName: '.build-kit',
    useShared: true,
    needsBoardId: true,
  },
};

// Not a stack — no backend scaffold, just skills + the agent loop. Gets its own
// command (`init-modeling`) instead of living in the `init --stack` picker.
const MODELING_KIT = {
  key: 'modeling-kit',
  label: 'Modeling only — skills + agent loop, no backend scaffold',
  kitSubdir: 'kit',
  kitDirName: '.agent-modeling-kit',
  useShared: true,
  needsBoardId: false,
};

const KIT_DIR_NAMES = [...new Set([...Object.values(STACKS), MODELING_KIT].map((s) => s.kitDirName))];

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
// format transform needed). Codex CLI, Mistral Vibe, Pi, and Letta Code share one
// convention that already matches our native SKILL.md format, so those get the
// real file copied as-is instead of a stub.
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
    label: 'Codex CLI / Mistral Vibe / Pi / Letta Code (shared .agents/skills/ convention)',
    dir: '.agents/skills',
    kind: 'skill-package',
  },
};

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
    console.error(`❌ No skills found at ${relative(targetDir, skillsDir) || skillsDir} — run \`eventmodelers init\` or \`init-modeling\` first.`);
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
    const answer = await prompt('\nWhich hosts? (comma-separated keys, or "all"): ');
    hostKeys = answer.trim() === 'all'
      ? Object.keys(AGENT_HOSTS)
      : answer.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const unknown = hostKeys.filter((k) => !AGENT_HOSTS[k]);
  if (unknown.length) {
    console.error(`❌ Unknown host(s): ${unknown.join(', ')}. Available: ${Object.keys(AGENT_HOSTS).join(', ')}`);
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
function getSharedRl() {
  if (!sharedRl) {
    sharedRl = createInterface({ input: process.stdin, output: process.stdout });
  }
  return sharedRl;
}

async function prompt(question) {
  return new Promise((resolve) => {
    getSharedRl().question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Reads a pasted block of credentials, which may span one line (minified JSON,
// or comma-separated values) or several (pretty-printed JSON). Stops as soon as
// the accumulated text parses, or on a blank line, so a single-line paste + Enter
// doesn't require a second Enter to finish.
async function promptPasteBlock() {
  const lines = [];
  while (lines.length < 20) {
    const line = await new Promise((resolve) => getSharedRl().question('', resolve));
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

// Hierarchical resolution: a shared config higher up the directory tree (e.g. the
// project root's own .eventmodelers/config.json, or ~/.eventmodelers/config.json for
// defaults shared across every project) provides the base values — this is where
// `init`/`init-modeling` write by default, so a modeling-kit and a build-kit installed
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

    const targetDir = process.cwd();
    const templatesSource = join(__dirname, 'stacks', stackKey, 'templates');
    const sharedBuildKit = join(__dirname, 'shared', 'build-kit');
    // Skills with no stack-specific content (connect, learn-eventmodelers-api,
    // update-slice-status, ...) live once here instead of being copy-pasted into
    // every stack's templates — that copy-pasting is exactly how they drifted out
    // of sync with each other before (e.g. one stack's connect skill silently
    // missing a bugfix another stack's copy had).
    const sharedSkills = join(__dirname, 'shared', 'skills');

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
      copyDirContents(join(templatesSource, '.claude'), join(targetDir, '.claude'));
      copyDirContents(sharedSkills, join(targetDir, '.claude', 'skills'));
      claudeExtras = existsSync(join(templatesSource, '.claude'))
        ? readdirSync(join(templatesSource, '.claude')).filter((f) => f !== 'skills')
        : [];
    }

    // --- 2. Spread stack scaffold files into the project root ---
    const rootSrc = join(templatesSource, 'root');
    if (existsSync(rootSrc)) {
      console.log('📦 Installing project files...');
      copyDirContents(rootSrc, targetDir);
    }

    // --- 3. Create the kit dir and install the agent runner ---
    const kitDir = join(targetDir, stackCfg.kitDirName);
    mkdirSync(kitDir, { recursive: true });
    console.log(`📦 Installing agent kit into ${stackCfg.kitDirName}/...`);

    if (stackCfg.useShared) {
      copyDirContents(sharedBuildKit, kitDir);
    }
    copyDirContents(join(templatesSource, stackCfg.kitSubdir), kitDir, { skip: ['.eventmodelers'] });

    // Make scripts executable
    for (const script of ['ralph.sh', 'lib/agent.sh', 'ralph-claude.js', 'ralph-ollama.js']) {
      const p = join(kitDir, script);
      if (existsSync(p)) {
        try { execSync(`chmod +x "${p}"`); } catch {}
      }
    }

    // --- 4. Install kit dependencies ---
    if (existsSync(join(kitDir, 'package.json'))) {
      console.log('📦 Installing kit dependencies...');
      try {
        execSync('npm install', { cwd: kitDir, stdio: ['ignore', 'inherit', 'inherit'] });
        console.log('  ✓ kit dependencies installed');
      } catch {
        console.error('  ⚠️  npm install failed in kit — run it manually');
      }
    }

    // --- 5. Credentials ---
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
    });

    // --- 6. Install manifest (drives precise `uninstall` later) ---
    // Only the footprint listed here is ever removed by `uninstall` — the root
    // scaffold (step 2) is real project source the user builds on, so it's
    // deliberately left out and never touched by uninstall.
    const manifestDir = join(kitDir, '.eventmodelers');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'install-manifest.json'),
      JSON.stringify({ stack: stackKey, global: !!options.global, skills: installedSkills, claudeExtras, mcpRegistered: false }, null, 2),
    );

    console.log('\n✅ Done! Start your agent:\n');
    console.log('  npx @eventmodelers/cli run          (--ollama or --bash for other runners)\n');
    console.log('Connect this project to an MCP client (Claude Code, VS Code, ...):\n');
    console.log(`  npx @eventmodelers/cli init-mcp\n`);
    console.log('Expose these skills to other AI agent hosts (Cursor, Windsurf, Gemini CLI, Copilot, Codex CLI, Kiro, ...):\n');
    console.log(`  npx @eventmodelers/cli init-agents\n`);
}

// Extracted from installStack so `init-config` can reuse the exact same
// paste/manual/instructions/skip flow without also scaffolding a stack.
// `overrides` are values passed directly on the command line (--token, --board-id,
// --organization-id, --base-url) — the most explicit source available, so they
// win over both the config file and env vars before we even check what's missing.
async function configureCredentials({ config, configPath, targetDir, requiredFields, boardIdOptional, overrides = {}, print, skipGitignore = false }) {
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

  const stillMissing = requiredFields.some((f) => !config[f]);
  if (stillMissing && print) {
    console.log('\n  ℹ️  --print — skipping credential prompt, missing fields must be set via flags, EVENTMODELERS_* env vars, or config.json');
  } else if (stillMissing) {
    const choice = await selectPrompt('How do you want to configure credentials?', [
      { label: 'Paste values copied from app.eventmodelers.ai/account', value: 'paste' },
      { label: 'Enter values one by one', value: 'manual' },
      { label: 'Get instructions for configuring later', value: 'instructions' },
      { label: 'Skip for now', value: 'skip' },
    ], 1);

    if (choice === 'paste') {
      console.log('\n  Copy your credentials from https://app.eventmodelers.ai/account,');
      console.log('  then paste them below and press Enter:\n');
      const pasted = await promptPasteBlock();
      const parsed = parseCredentialsPaste(pasted, requiredFields);
      if (parsed) {
        config = { ...config, ...parsed };
        if (!config.baseUrl) config.baseUrl = DEFAULT_BASE_URL;
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`\n  ✓ Saved to ${relative(targetDir, configPath)}`);
      } else {
        console.log(`\n  ⚠️  Couldn't make sense of that paste — nothing was saved.`);
        console.log(`      Paste it into ${relative(targetDir, configPath)} yourself, or use /connect later.`);
      }
    } else if (choice === 'manual') {
      console.log('\n🔑 Enter your Eventmodelers credentials:\n');
      config.organizationId = await prompt('  Organization ID: ');
      // Always ask, even when this install doesn't strictly require it — it's still
      // used as a fallback default by the agent loop (see BOARD_ID resolution).
      const boardId = await prompt(`  Board ID${boardIdOptional ? ' (optional)' : ''}: `);
      if (boardId) config.boardId = boardId;
      config.token = await prompt('  Token:           ');
      if (!config.baseUrl) config.baseUrl = DEFAULT_BASE_URL;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`\n  ✓ Credentials saved to ${relative(targetDir, configPath)}`);
    } else if (choice === 'instructions') {
      console.log(`\n  Paste your credentials into:\n`);
      console.log(`    ${configPath}`);
      console.log(`\n  (or any ancestor directory's .eventmodelers/config.json, e.g. ~/.eventmodelers/config.json`);
      console.log(`  to share the same credentials across multiple projects)\n`);
      console.log(`  The file should look like:`);
      const sample = `  {\n    "token": "...",\n    "boardId": "...",\n    "organizationId": "...",\n    "baseUrl": "https://api.eventmodelers.ai"\n  }\n`;
      console.log(sample);
      console.log('  Then re-run this installer, or just run the agent afterwards.\n');
    } else {
      console.log('\n  ℹ️  Skipped — use /connect in Claude Code to add credentials later');
    }
  } else {
    console.log('\n  ✓ Config already present — skipping credential prompt');
  }

  // Backfill baseUrl for configs that already had real credentials but predate
  // this default (e.g. a config.json written by hand or by an older CLI version).
  if (config.token && config.organizationId && !config.baseUrl) {
    config.baseUrl = DEFAULT_BASE_URL;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n  ✓ Saved to ${relative(targetDir, configPath)}`);
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

const program = new Command();

program
  .name('eventmodelers')
  .description('Eventmodelers CLI — real-time Claude agent + skills for Claude Code, for any stack')
  .version('1.0.0')
  .option('--config <path>', 'Path to an explicit config.json, overriding directory-based resolution (individual fields can also be set via EVENTMODELERS_* env vars, which always win)')
  .option('--print', 'Print follow-up commands (e.g. claude mcp add) instead of prompting to run them');

// Shared by init/init-modeling/init-config: direct command-line credentials,
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

credentialFlags(program
  .command('init')
  .alias('install')
  .description('Scaffold a stack + install the agent modeling kit into the current directory')
  .option('--stack <name>', `Stack to install (${Object.keys(STACKS).join(', ')})`)
  .option('--global', 'Install skills into ~/.claude/skills/ instead of the project — available in every project'))
  .action(async (opts, command) => {
    const stackKey = await resolveStack(opts.stack);
    const globalOpts = command.optsWithGlobals();
    await installStack(stackKey, STACKS[stackKey], {
      configPath: globalOpts.config,
      print: globalOpts.print,
      global: opts.global,
      credentialOverrides: credentialOverridesFromOpts(opts),
    });
  });

credentialFlags(program
  .command('init-modeling')
  .alias('modeling')
  .description('Install skills + the agent loop only — no backend scaffold')
  .option('--global', 'Install skills into ~/.claude/skills/ instead of the project — available in every project'))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    await installStack(MODELING_KIT.key, MODELING_KIT, {
      configPath: globalOpts.config,
      print: globalOpts.print,
      global: opts.global,
      credentialOverrides: credentialOverridesFromOpts(opts),
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
  .option('--hosts <list>', `Comma-separated host keys (${Object.keys(AGENT_HOSTS).join(', ')})`)
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

credentialFlags(program
  .command('init-config')
  .description('Configure credentials only — writes .eventmodelers/config.json in the current directory, or ~/.eventmodelers/config.json with --global')
  .option('--global', 'Write account-wide defaults (organizationId + token only) to ~/.eventmodelers/config.json instead of the project'))
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    const overrides = credentialOverridesFromOpts(opts);

    if (opts.global) {
      // Deliberately narrower than a project config: a board is specific to one
      // project, and baseUrl already has its own runtime default, so the only
      // things worth defaulting across every project are your identity (org)
      // and how you authenticate (token).
      const configPath = join(homedir(), '.eventmodelers', 'config.json');
      const requiredFields = ['organizationId', 'token'];
      const existing = readJsonSafe(configPath);
      const base = { organizationId: existing.organizationId, token: existing.token };
      if (overrides.organizationId) base.organizationId = overrides.organizationId;
      if (overrides.token) base.token = overrides.token;

      const configured = await configureCredentials({
        config: base,
        configPath,
        targetDir: homedir(),
        requiredFields,
        boardIdOptional: true,
        overrides: {},
        print: globalOpts.print,
        skipGitignore: true,
      });

      // configureCredentials' generic paste/manual flow may have picked up
      // boardId/baseUrl too (e.g. from a pasted JSON blob) — strip them back out
      // before the final write, since --global only ever persists identity.
      writeFileSync(configPath, JSON.stringify({ organizationId: configured.organizationId, token: configured.token }, null, 2));
      console.log(`\n  ✓ Saved account-wide defaults to ${configPath}`);
    } else {
      const targetDir = process.cwd();
      const configPath = globalOpts.config
        ? resolve(targetDir, globalOpts.config)
        : join(targetDir, '.eventmodelers', 'config.json');
      const effective = loadEffectiveConfig(targetDir, null, globalOpts.config);
      await configureCredentials({
        config: effective.config,
        configPath,
        targetDir,
        requiredFields: ['organizationId', 'token'],
        boardIdOptional: true,
        overrides,
        print: globalOpts.print,
      });
    }
  });

program
  .command('run')
  .description('Start the agent loop from the installed kit dir (default: ralph-claude.js)')
  .option('--ollama', 'Use ralph-ollama.js instead of the default Claude runner')
  .option('--bash', 'Use the bash-only ralph.sh loop (no realtime)')
  .action((opts) => {
    const cwd = process.cwd();
    const kitDir = findInstalledKitDir(cwd);
    if (!kitDir) {
      console.error(`❌ No installed kit dir found (checked: ${KIT_DIR_NAMES.join(', ')}) — run \`eventmodelers init\` first.`);
      process.exit(1);
    }

    // The actual agent loop lives in the scaffolded kit dir, not in this package — this
    // is just a thin dispatcher so users don't have to remember the kit-dir name or which
    // runner file to invoke. Users (and the agent itself, via AGENT.md) may customize these
    // files freely; `run` always executes whatever is currently on disk.
    const runner = opts.bash ? 'ralph.sh' : opts.ollama ? 'ralph-ollama.js' : 'ralph-claude.js';
    const runnerPath = join(kitDir, runner);
    if (!existsSync(runnerPath)) {
      console.error(`❌ ${relative(cwd, runnerPath)} not found.`);
      process.exit(1);
    }

    console.log(`▶ Starting ${relative(cwd, runnerPath)}...\n`);
    const cmd = runner.endsWith('.sh') ? `"${runnerPath}"` : `node "${runnerPath}"`;
    try {
      execSync(cmd, { cwd: kitDir, stdio: 'inherit' });
    } catch (err) {
      process.exit(err.status || 1);
    }
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
    console.log(`\nNot a stack — skills + agent loop only, no backend: npx @eventmodelers/cli init-modeling`);
  });

// Removes exactly what a given `init`/`init-modeling` run put down — read back from
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
  .description('Remove everything init/init-modeling installed: the kit dir, the skills it copied (project-local or ~/.claude/skills with --global), its MCP entry in .claude/settings.json, and any files written by init-agents. Leaves the root project scaffold untouched.')
  .option('--build-kit', `Remove ${STACKS.node.kitDirName}/ (the backend-stack kit dir)`)
  .option('--modeling-kit', `Remove ${MODELING_KIT.kitDirName}/ (the modeling-only kit dir)`)
  .action((opts) => {
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
        console.log('⚠️  Multiple kit dirs found — re-run with --build-kit or --modeling-kit to pick one, or both to remove everything.');
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
    const ralphPath = kitDir ? join(kitDir, 'ralph-claude.js') : null;
    const { sources, config: cfg } = loadEffectiveConfig(cwd, kitDir, explicitConfig);

    console.log('Eventmodelers CLI Status\n');
    console.log(`Kit dir:        ${kitDir ? `✅ installed (${relative(cwd, kitDir)})` : '❌ not found'}`);
    console.log(`Skills:         ${existsSync(skillsDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Config:         ${sources.length ? `✅ present${sources.length > 1 ? ` (merged from ${sources.length} files)` : ''}` : '❌ missing'}`);
    console.log(`Ralph agent:    ${ralphPath && existsSync(ralphPath) ? '✅ present' : '❌ missing'}`);

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