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
import { createInterface } from 'readline';

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

    const targetDir = join(process.cwd(), '.build-kit-axon');
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

      // templates/root/ contents are spread directly into the project root
      if (item === 'root' && statSync(sourcePath).isDirectory()) {
        const rootItems = readdirSync(sourcePath);
        for (const rootItem of rootItems) {
          const rootSourcePath = join(sourcePath, rootItem);
          const rootTargetPath = join(targetDir, rootItem);
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
        console.log(`  ✓ Installed ${item}`);
      } catch (err) {
        console.error(`  ❌ Failed to copy ${item}:`, err?.message);
      }
    }

    // Install realtime-agent dependencies
    const agentDir = join(targetDir, 'realtime-agent');
    if (existsSync(agentDir)) {
      console.log('\n📦 Installing realtime-agent dependencies...');
      try {
        execSync('npm install', { cwd: agentDir, stdio: 'inherit' });
        console.log('  ✓ realtime-agent dependencies installed');
      } catch {
        console.error('  ⚠️  npm install failed in realtime-agent — run it manually');
      }
    }

    // Add .build-kit-axon/ to project root .gitignore
    const gitignorePath = join(process.cwd(), '.gitignore');
    const gitignoreEntry = '.build-kit-axon/';
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

    const hasExisting = await prompt('\nDo you have an existing config from app.eventmodelers.de/account? (y/n): ');
    if (hasExisting.toLowerCase() === 'y' || hasExisting.toLowerCase() === 'yes') {
      console.log(`\n  Paste your config into:\n\n    ${configPath}\n\n  Then re-run this installer.\n`);
      process.exit(0);
    }

    let config = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        config = {};
      }
    }

    const hasConfig = config.organizationId && config.boardId && config.token;
    if (!hasConfig) {
      console.log('\n🔑 Enter your Eventmodelers credentials:\n');
      config.organizationId = config.organizationId || await prompt('  Organization ID: ');
      config.boardId        = config.boardId        || await prompt('  Board ID:        ');
      config.token          = config.token          || await prompt('  Token:           ');
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('\n  ✓ Credentials saved to .build-kit-axon/.eventmodelers/config.json');
    } else {
      console.log('\n  ✓ Config already present — skipping credential prompt');
    }

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

    const baseUrl = config.baseUrl || 'https://api.eventmodelers.de';
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers.eventmodelers = {
      type: 'http',
      url: `${baseUrl}/mcp`,
    };

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('  ✓ MCP server configured in .claude/settings.json');

    console.log('\n✅ Done!\n');
    console.log('Next steps:\n');
    console.log('  Terminal 1 — realtime agent (optional — only needed for automatic board notifications):');
    console.log('       cd .build-kit-axon/realtime-agent && npm run dev\n');
    console.log('  Terminal 2 — ralph loop (reads tasks.json → executes via Claude):');
    console.log('       cd .build-kit-axon && ./ralph.sh\n');
    console.log('The loop waits when tasks.json is empty. Pass a path to target a different project:');
    console.log('       ./ralph.sh 0 /path/to/project\n');
    console.log('Skills are ready in .build-kit-axon/.claude/skills/ — use /connect to set a board ID.');
  });

program
  .command('uninstall')
  .description('Remove ralph-li files from current directory')
  .action(() => {
    const targets = [
      join(process.cwd(), '.build-kit-axon'),
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
    const kitDir = join(process.cwd(), '.build-kit-axon');
    const skillsDir = join(kitDir, '.claude', 'skills');
    const configPath = join(kitDir, '.eventmodelers', 'config.json');
    const agentDir = join(kitDir, 'realtime-agent');

    console.log('build-kit-node Status\n');
    console.log(`Kit dir:        ${existsSync(kitDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Skills:         ${existsSync(skillsDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Config:         ${existsSync(configPath) ? '✅ present' : '❌ missing'}`);
    console.log(`Realtime agent: ${existsSync(agentDir) ? '✅ present' : '❌ missing'}`);

    if (existsSync(configPath)) {
      try {
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        console.log(`\nConnected to: ${cfg.baseUrl}`);
        console.log(`Organization: ${cfg.organizationId}`);
        console.log(`Board:        ${cfg.boardId}`);
      } catch {
        console.log('\n⚠️  Config file is invalid JSON');
      }
    }
  });

program.parse();
