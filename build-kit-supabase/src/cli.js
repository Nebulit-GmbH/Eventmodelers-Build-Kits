#!/usr/bin/env node

import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join, relative, sep } from 'path';
import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from 'fs';
import { execSync } from 'child_process';
import { createInterface, emitKeypressEvents, moveCursor, clearScreenDown } from 'readline';

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('ralph-li')
  .description('ralph-li — real-time Claude agent that reacts to slice:changed events on an Eventmodelers board')
  .version('0.1.25');

program
  .command('install')
  .description('Install ralph-li into the current directory')
  .action(async () => {
    console.log('🚀 ralph-li\n');

    const rootDir = process.cwd();
    const targetDir = join(rootDir, '.build-kit');
    mkdirSync(targetDir, { recursive: true });

    const templatesSource = join(__dirname, '..', 'templates');

    if (!existsSync(templatesSource)) {
      console.error('❌ Templates directory not found at:', templatesSource);
      process.exit(1);
    }

    // Copy template files first — credentials not required for this
    console.log('📦 Installing files...\n');
    const items = readdirSync(templatesSource);
    for (const item of items) {
      const sourcePath = join(templatesSource, item);

      // templates/root/ contents spread into the project root
      if (item === 'root' && statSync(sourcePath).isDirectory()) {
        const rootItems = readdirSync(sourcePath);
        for (const rootItem of rootItems) {
          const rootSourcePath = join(sourcePath, rootItem);
          const rootTargetPath = join(rootDir, rootItem);
          try {
            if (statSync(rootSourcePath).isDirectory()) {
              cpSync(rootSourcePath, rootTargetPath, {
                recursive: true,
                filter: (s) => !relative(rootSourcePath, s).split(sep).includes('node_modules'),
              });
            } else {
              cpSync(rootSourcePath, rootTargetPath);
            }
            console.log(`  ✓ Installed ${rootItem}`);
          } catch (err) {
            console.error(`  ❌ Failed to copy ${rootItem}:`, err?.message);
          }
        }
        continue;
      }

      // templates/build-kit/ contents spread into .build-kit/
      if (item === 'build-kit' && statSync(sourcePath).isDirectory()) {
        const kitItems = readdirSync(sourcePath);
        for (const kitItem of kitItems) {
          const kitSourcePath = join(sourcePath, kitItem);
          const kitTargetPath = join(targetDir, kitItem);
          try {
            if (statSync(kitSourcePath).isDirectory()) {
              cpSync(kitSourcePath, kitTargetPath, {
                recursive: true,
                filter: (s) => !relative(kitSourcePath, s).split(sep).includes('node_modules'),
              });
            } else {
              cpSync(kitSourcePath, kitTargetPath);
            }
            console.log(`  ✓ Installed .build-kit/${kitItem}`);
          } catch (err) {
            console.error(`  ❌ Failed to copy ${kitItem}:`, err?.message);
          }
        }
        continue;
      }

      const targetPath = join(targetDir, item);
      try {
        if (statSync(sourcePath).isDirectory()) {
          cpSync(sourcePath, targetPath, {
            recursive: true,
            filter: (s) => !relative(sourcePath, s).split(sep).includes('node_modules'),
          });
        } else {
          cpSync(sourcePath, targetPath);
        }
        console.log(`  ✓ Installed .build-kit/${item}`);
      } catch (err) {
        console.error(`  ❌ Failed to copy ${item}:`, err?.message);
      }
    }

    // Install .build-kit dependencies (supabase etc. for ralph.js)
    console.log('\n📦 Installing .build-kit dependencies...');
    try {
      execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
      console.log('  ✓ .build-kit dependencies installed');
    } catch {
      console.error('  ⚠️  npm install failed in .build-kit — run it manually');
    }

    // Add .build-kit/ to project root .gitignore
    const gitignorePath = join(rootDir, '.gitignore');
    const gitignoreEntry = '.build-kit/';
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8');
      if (!content.includes(gitignoreEntry)) {
        appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
      }
    } else {
      writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
    }

    // Create or populate config file
    const configDir = join(targetDir, '.eventmodelers');
    const configPath = join(configDir, 'config.json');
    mkdirSync(configDir, { recursive: true });

    let config = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        config = {};
      }
    }

    if (!config.organizationId && !config.boardId && !config.token) {
      const parentConfigPath = findConfigInParents(rootDir);
      if (parentConfigPath) {
        try {
          config = { ...JSON.parse(readFileSync(parentConfigPath, 'utf-8')) };
          console.log(`\n  ✓ Found credentials in ${parentConfigPath}`);
        } catch {}
      }
    }

    const wantCredentials = await prompt('\nDo you want to configure credentials now? (y/n): ');
    if (wantCredentials.toLowerCase() !== 'y' && wantCredentials.toLowerCase() !== 'yes') {
      console.log('\n  ℹ️  Skipped — use /connect in Claude Code to add credentials later');
    } else {
      const copyFromPlatform = await prompt('\nDo you have platform credentials? Copy directly from app.eventmodelers.ai/account? (y/n): ');
      if (copyFromPlatform.toLowerCase() === 'y' || copyFromPlatform.toLowerCase() === 'yes') {
        console.log('\n  1. Open: https://app.eventmodelers.ai/account');
        console.log(`  2. Paste your credentials JSON into one of these locations:\n`);
        console.log(`     (a) ${configPath}`);
        console.log(`     (b) .eventmodelers/config.json  in this directory or any parent directory\n`);
        console.log(`  The file should look like:`);
        console.log(`  {\n    "token": "...",\n    "boardId": "...",\n    "organizationId": "...",\n    "baseUrl": "https://api.eventmodelers.ai"\n  }\n`);
        console.log('  3. Re-run this installer.\n');
        process.exit(0);
      }

      console.log('\n🔑 Enter your Eventmodelers credentials (press Enter to skip any field):\n');
      const orgId   = await prompt(`  Organization ID ${config.organizationId ? `[${config.organizationId}]` : ''}: `);
      const boardId = await prompt(`  Board ID        ${config.boardId        ? `[${config.boardId}]`        : ''}: `);
      const token   = await prompt(`  Token           ${config.token          ? '[set]'                       : ''}: `);

      if (orgId)   config.organizationId = orgId;
      if (boardId) config.boardId        = boardId;
      if (token)   config.token          = token;

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      if (config.organizationId && config.boardId && config.token) {
        console.log('\n  ✓ Credentials saved to .build-kit/.eventmodelers/config.json');
      } else {
        console.log('\n  ℹ️  Config saved — use /connect in Claude Code to add credentials later');
      }
    }

    // Claude execution (optional)
    console.log('\n🧠 Configuring Claude execution (optional)...');
    console.log('   Point the agent at a local vLLM/Ollama endpoint and/or pin a specific model, instead of the default Claude Code setup.');

    const presetUrls = ['', 'http://localhost:8000', 'http://localhost:11434'];
    let defaultUrlIndex = presetUrls.indexOf(config.anthropicBaseUrl || '');
    if (defaultUrlIndex === -1) defaultUrlIndex = 3;

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

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('\n  ✓ Saved to .build-kit/.eventmodelers/config.json');

    // Configure MCP server in .claude/settings.json
    const claudeDir = join(targetDir, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    mkdirSync(claudeDir, { recursive: true });

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

    console.log('\n✅ Done!\n');
    console.log('Next steps:\n');
    console.log('  Claude (default):');
    console.log('       node .build-kit/ralph-claude.js\n');
    console.log('  Local Ollama model (run `ollama serve` first):');
    console.log('       OLLAMA_MODEL=qwen3:8b node .build-kit/ralph-ollama.js\n');
    console.log('  Pass a custom project directory as the first argument:');
    console.log('       node .build-kit/ralph-claude.js /path/to/project\n');
    console.log('Skills are ready in .build-kit/.claude/skills/ — use /connect to set a board ID.');
  });

program
  .command('uninstall')
  .description('Remove ralph-li files from current directory')
  .action(() => {
    const targets = [
      join(process.cwd(), '.build-kit'),
    ];

    for (const t of targets) {
      if (existsSync(t)) {
        rmSync(t, { recursive: true, force: true });
        console.log(`  ✓ Removed ${t}`);
      }
    }

    console.log('✅ Uninstalled');
  });

program
  .command('status')
  .description('Check installation status')
  .action(() => {
    const kitDir = join(process.cwd(), '.build-kit');
    const skillsDir = join(kitDir, '.claude', 'skills');
    const configPath = join(kitDir, '.eventmodelers', 'config.json');
    const agentDir = join(kitDir, 'realtime-agent');
    const effectiveConfigPath = existsSync(configPath) ? configPath : findConfigInParents(process.cwd());

    console.log('.build-kit Status\n');
    console.log(`Kit dir:        ${existsSync(kitDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Skills:         ${existsSync(skillsDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Config:         ${effectiveConfigPath ? `✅ present${effectiveConfigPath !== configPath ? ` (inherited: ${effectiveConfigPath})` : ''}` : '❌ missing'}`);
    console.log(`Realtime agent: ${existsSync(agentDir) ? '✅ present' : '❌ missing'}`);

    if (effectiveConfigPath) {
      try {
        const cfg = JSON.parse(readFileSync(effectiveConfigPath, 'utf-8'));
        console.log(`\nConnected to: ${cfg.baseUrl}`);
        console.log(`Organization: ${cfg.organizationId}`);
        console.log(`Board:        ${cfg.boardId}`);
      } catch {
        console.log('\n⚠️  Config file is invalid JSON');
      }
    }
  });

program.parse(process.argv);
