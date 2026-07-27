#!/usr/bin/env node

import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve, sep } from 'path';
import {
  existsSync,
  mkdirSync,
  cpSync,
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

// Each backend stack is a template set under stacks/<key>/templates/{.claude,root,build-kit}.
// They also get shared/build-kit/* copied into their kit dir first — those files
// (ralph-ollama.js, realtime-agent.js, code-export.mjs, lib/ollama-agent.js, package.json)
// are identical across all of them.
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
  useShared: false,
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
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJsonSafe(path) {
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

// Hierarchical resolution: a shared config higher up the directory tree (e.g.
// ~/.eventmodelers/config.json with org/token/baseUrl) provides defaults, and the
// kit dir's own config.json (project-specific — typically just boardId) overrides
// any field it also sets. An explicit --config path bypasses this entirely.
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
  for (const item of readdirSync(srcDir)) {
    if (skip.includes(item)) continue;
    const src = join(srcDir, item);
    const dest = join(destDir, item);
    cpSync(src, dest, {
      recursive: true,
      filter: (s) => !relative(src, s).split(sep).includes('node_modules'),
    });
    console.log(`  ✓ Installed ${relative(process.cwd(), dest)}`);
  }
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

    if (!existsSync(templatesSource)) {
      console.error('❌ Templates directory not found at:', templatesSource);
      process.exit(1);
    }

    // --- 1. Install skills (project-local by default, or ~/.claude/skills/ with --global) ---
    if (options.global) {
      const globalSkillsDir = join(homedir(), '.claude', 'skills');
      console.log('📦 Installing Claude skills globally...');
      console.log(`   Copies skills into ${globalSkillsDir} so they're available in every project, not just this one.\n`);
      copyDirContents(join(templatesSource, '.claude', 'skills'), globalSkillsDir);
    } else {
      console.log('📦 Installing Claude skills...');
      console.log('   Copies skills and settings into .claude/ so Claude Code picks them up automatically.\n');
      copyDirContents(join(templatesSource, '.claude'), join(targetDir, '.claude'));
    }

    // --- 2. Spread stack scaffold files into the project root ---
    const rootSrc = join(templatesSource, 'root');
    if (existsSync(rootSrc)) {
      console.log('\n📦 Installing project files...\n');
      copyDirContents(rootSrc, targetDir);
    }

    // --- 3. Create the kit dir and install the agent runner ---
    const kitDir = join(targetDir, stackCfg.kitDirName);
    mkdirSync(kitDir, { recursive: true });
    console.log(`\n📦 Installing agent kit into ${stackCfg.kitDirName}/...`);
    console.log('   Sets up the Ralph agent loop, scripts, and configuration that drive realtime modeling.\n');

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
      console.log('\n📦 Installing kit dependencies...');
      console.log('   Installs npm packages required by the agent scripts (e.g. websocket client, utilities).');
      try {
        execSync('npm install', { cwd: kitDir, stdio: ['ignore', 'inherit', 'inherit'] });
        console.log('  ✓ kit dependencies installed');
      } catch {
        console.error('  ⚠️  npm install failed in kit — run it manually');
      }
    }

    // --- 5. Credentials ---
    console.log('\n🔐 Configuring credentials...');
    console.log('   Stores your Organization ID (and Board ID, if this stack needs one) and token');
    console.log('   so the agent can connect to app.eventmodelers.ai.\n');

    const configPath = options.configPath
      ? resolve(targetDir, options.configPath)
      : join(kitDir, '.eventmodelers', 'config.json');
    const configDir = dirname(configPath);
    mkdirSync(configDir, { recursive: true });

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

    const requiredFields = stackCfg.needsBoardId
      ? ['organizationId', 'boardId', 'token']
      : ['organizationId', 'token'];

    const effective = loadEffectiveConfig(targetDir, kitDir, options.configPath);
    let config = effective.config;
    if (effective.sources.length > 1) {
      console.log(`\n  ✓ Found shared defaults in ${effective.sources[0]}`);
    }
    const hasConfig = requiredFields.every((f) => config[f]);

    const stillMissing = requiredFields.some((f) => !config[f]);
    if (stillMissing && options.print) {
      console.log('\n  ℹ️  --print — skipping credential prompt, missing fields must be set via EVENTMODELERS_* env vars or config.json');
    } else if (stillMissing) {
      const choice = await selectPrompt('How do you want to configure credentials?', [
        { label: 'Paste JSON copied from app.eventmodelers.ai/account', value: 'paste' },
        { label: 'Enter values manually now', value: 'manual' },
        { label: 'Skip — configure later with /connect', value: 'skip' },
      ], 1);

      if (choice === 'paste') {
        console.log(`\n  Paste your credentials JSON into one of these locations:\n`);
        console.log(`    (a) ${configPath}`);
        console.log(`    (b) .eventmodelers/config.json  in this directory or any parent directory\n`);
        console.log(`  The file should look like:`);
        const sample = stackCfg.needsBoardId
          ? `  {\n    "token": "...",\n    "boardId": "...",\n    "organizationId": "...",\n    "baseUrl": "https://api.eventmodelers.ai"\n  }\n`
          : `  {\n    "token": "...",\n    "organizationId": "...",\n    "baseUrl": "https://api.eventmodelers.ai"\n  }\n`;
        console.log(sample);
        console.log('  Then re-run this installer, or just run the agent afterwards.\n');
      } else if (choice === 'manual') {
        console.log('\n🔑 Enter your Eventmodelers credentials:\n');
        config.organizationId = await prompt('  Organization ID: ');
        if (stackCfg.needsBoardId) {
          config.boardId = await prompt('  Board ID:        ');
        }
        config.token = await prompt('  Token:           ');
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`\n  ✓ Credentials saved to ${relative(targetDir, configPath)}`);
      } else {
        console.log('\n  ℹ️  Skipped — use /connect in Claude Code to add credentials later');
      }
    } else {
      console.log('\n  ✓ Config already present — skipping credential prompt');
    }

    // --- 6. Claude execution (optional) ---
    console.log('\n🧠 Configuring Claude execution (optional)...');
    console.log('   Point the agent at a local vLLM/Ollama endpoint and/or pin a specific model, instead of the default Claude Code setup.');

    if (process.env.EVENTMODELERS_ANTHROPIC_BASE_URL || process.env.EVENTMODELERS_MODEL) {
      console.log('  ✓ Using EVENTMODELERS_ANTHROPIC_BASE_URL / EVENTMODELERS_MODEL from environment — skipping prompt');
    } else if (options.print) {
      console.log('  ✓ --print — skipping prompt, keeping existing Claude execution settings');
    } else {
      const presetUrls = ['', 'http://localhost:8000', 'http://localhost:11434'];
      let defaultUrlIndex = presetUrls.indexOf(config.anthropicBaseUrl || '');
      if (defaultUrlIndex === -1) defaultUrlIndex = 0;

      let anthropicBaseUrl = await selectPrompt('Anthropic Base URL:', [
        { label: 'None — use the default Claude Code endpoint', value: '' },
        { label: 'Local vLLM   (http://localhost:8000)', value: 'http://localhost:8000' },
        { label: 'Local Ollama (http://localhost:11434)', value: 'http://localhost:11434' },
        { label: 'Custom…', value: '__custom__' },
      ], defaultUrlIndex);

      if (anthropicBaseUrl === '__custom__') {
        anthropicBaseUrl = await prompt('  Custom Anthropic Base URL: ');
      }

      const claudeModel = await prompt(`  Model ${config.model ? `[${config.model}]` : '(optional, press Enter to skip)'}: `);

      if (anthropicBaseUrl) config.anthropicBaseUrl = anthropicBaseUrl;
      else delete config.anthropicBaseUrl;
      if (claudeModel) config.model = claudeModel;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`\n  ✓ Saved to ${relative(targetDir, configPath)}`);

    // --- 7. MCP server in .claude/settings.json ---
    console.log('\n🔌 Configuring MCP server...');
    console.log('   Registers the Eventmodelers MCP server in .claude/settings.json so Claude Code can call modeling tools directly.\n');
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

    const baseUrl = config.baseUrl || 'https://api.eventmodelers.ai';
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers.eventmodelers = {
      type: 'http',
      url: `${baseUrl}/mcp`,
    };

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('  ✓ MCP server configured in .claude/settings.json');

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

    console.log('\n✅ Done!\n');
    console.log('Start the agent (realtime + task loop in one process):');
    console.log('       npx @eventmodelers/cli run\n');
    console.log('Or using Ollama (run `ollama serve` first):');
    console.log('       npx @eventmodelers/cli run --ollama\n');
    console.log('Or using the bash loop only (no realtime):');
    console.log('       npx @eventmodelers/cli run --bash\n');
    console.log(`Skills are ready in ${options.global ? join(homedir(), '.claude', 'skills') : '.claude/skills/'} — use /connect to set a board ID.\n`);
    console.log('💡 Recommended: add Chrome DevTools MCP for browser inspection:');
    console.log('       claude mcp add chrome-devtools --scope user -- npx chrome-devtools-mcp@latest\n');
}

const program = new Command();

program
  .name('eventmodelers')
  .description('Eventmodelers CLI — real-time Claude agent + skills for Claude Code, for any stack')
  .version('1.0.0')
  .option('--config <path>', 'Path to an explicit config.json, overriding directory-based resolution (individual fields can also be set via EVENTMODELERS_* env vars, which always win)')
  .option('--print', 'Print follow-up commands (e.g. claude mcp add) instead of prompting to run them');

program
  .command('init')
  .alias('install')
  .description('Scaffold a stack + install the agent modeling kit into the current directory')
  .option('--stack <name>', `Stack to install (${Object.keys(STACKS).join(', ')})`)
  .option('--global', 'Install skills into ~/.claude/skills/ instead of the project — available in every project')
  .action(async (opts, command) => {
    const stackKey = await resolveStack(opts.stack);
    const globalOpts = command.optsWithGlobals();
    await installStack(stackKey, STACKS[stackKey], { configPath: globalOpts.config, print: globalOpts.print, global: opts.global });
  });

program
  .command('init-modeling')
  .alias('modeling')
  .description('Install skills + the agent loop only — no backend scaffold')
  .option('--global', 'Install skills into ~/.claude/skills/ instead of the project — available in every project')
  .action(async (opts, command) => {
    const globalOpts = command.optsWithGlobals();
    await installStack(MODELING_KIT.key, MODELING_KIT, { configPath: globalOpts.config, print: globalOpts.print, global: opts.global });
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

program
  .command('uninstall')
  .description('Remove the installed kit dir from the current directory')
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
      rmSync(t, { recursive: true, force: true });
      console.log(`  ✓ Removed ${t}`);
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
      console.log(`\nConnected to:   ${cfg.baseUrl || 'https://api.eventmodelers.ai'}`);
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