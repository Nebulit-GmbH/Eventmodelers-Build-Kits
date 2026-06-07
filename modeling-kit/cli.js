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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const program = new Command();

program
  .name('eventmodelers')
  .description('Eventmodelers Agent Modeling Kit — real-time Claude agent + skills for Claude Code')
  .version('0.1.0');

program
  .command('install')
  .description('Install agent modeling kit into the current directory')
  .action(async () => {
    console.log('🚀 Eventmodelers Agent Modeling Kit\n');

    const targetDir = process.cwd();
    const templatesSource = join(__dirname, 'templates');

    if (!existsSync(templatesSource)) {
      console.error('❌ Templates directory not found at:', templatesSource);
      process.exit(1);
    }

    // --- 1. Install skills and Claude settings into project root ---
    console.log('📦 Installing Claude skills...\n');

    const claudeSrc = join(templatesSource, '.claude');
    const claudeDest = join(targetDir, '.claude');
    if (existsSync(claudeSrc)) {
      cpSync(claudeSrc, claudeDest, { recursive: true });
      console.log('  ✓ Installed .claude/');
    }

    const rootSrc = join(templatesSource, 'root');
    if (existsSync(rootSrc)) {
      for (const item of readdirSync(rootSrc)) {
        const src = join(rootSrc, item);
        const dest = join(targetDir, item);
        cpSync(src, dest, { recursive: true });
        console.log(`  ✓ Installed ${item}`);
      }
    }

    // --- 2. Create .agent-modeling-kit/ and install all agent files ---
    const kitDir = join(targetDir, '.agent-modeling-kit');
    mkdirSync(kitDir, { recursive: true });
    console.log('\n📦 Installing agent kit into .agent-modeling-kit/...\n');

    const kitSrc = join(templatesSource, 'kit');
    if (existsSync(kitSrc)) {
      for (const item of readdirSync(kitSrc)) {
        if (item === '.eventmodelers') continue; // written separately below
        const src = join(kitSrc, item);
        const dest = join(kitDir, item);
        try {
          cpSync(src, dest, {
            recursive: true,
            filter: (s) => !relative(src, s).split(sep).includes('node_modules'),
          });
          console.log(`  ✓ Installed .agent-modeling-kit/${item}`);
        } catch (err) {
          console.error(`  ❌ Failed to copy ${item}:`, err?.message);
        }
      }
    }

    // Make scripts executable
    for (const script of ['ralph.sh', 'lib/agent.sh', 'ralph-claude.js', 'ralph-ollama.js']) {
      const p = join(kitDir, script);
      if (existsSync(p)) {
        try { execSync(`chmod +x "${p}"`); } catch {}
      }
    }

    // --- 3. Install kit dependencies ---
    if (existsSync(join(kitDir, 'package.json'))) {
      console.log('\n📦 Installing kit dependencies...');
      try {
        execSync('npm install', { cwd: kitDir, stdio: 'inherit' });
        console.log('  ✓ kit dependencies installed');
      } catch {
        console.error('  ⚠️  npm install failed in kit — run it manually');
      }
    }

    // --- 4. Credentials ---
    const gitignorePath = join(targetDir, '.gitignore');
    const gitignoreEntry = '.agent-modeling-kit/.eventmodelers/';
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8');
      if (!content.includes(gitignoreEntry)) {
        appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
      }
    } else {
      writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
    }

    const credDir = join(kitDir, '.eventmodelers');
    const configPath = join(credDir, 'config.json');
    mkdirSync(credDir, { recursive: true });

    let config = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        config = {};
      }
    }

    const hasConfig = config['organizationId'] && config['token'];
    if (!hasConfig) {
      const hasExisting = await prompt('\nDo you have an existing config from app.eventmodelers.ai/account? (y/n): ');
      if (hasExisting.toLowerCase() === 'y' || hasExisting.toLowerCase() === 'yes') {
        console.log(`\n  Paste your config into:\n\n    ${configPath}\n`);
      } else {
        console.log('\n🔑 Enter your Eventmodelers credentials:\n');
        config['organizationId'] = await prompt('  Organization ID: ');
        config['token']          = await prompt('  Token:           ');
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('\n  ✓ Credentials saved to .agent-modeling-kit/.eventmodelers/config.json');
      }
    } else {
      console.log('\n  ✓ Config already present — skipping credential prompt');
    }

    // --- 5. MCP server in .claude/settings.json ---
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

    const baseUrl = config['baseUrl'] || 'https://api.eventmodelers.ai';
    settings['mcpServers'] = settings['mcpServers'] || {};
    settings['mcpServers']['eventmodelers'] = {
      type: 'http',
      url: `${baseUrl}/mcp`,
    };

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('  ✓ MCP server configured in .claude/settings.json');

    const connectMcp = await prompt('\nShould the MCP also be connected globally? (y/n): ');
    if (connectMcp.toLowerCase() === 'y' || connectMcp.toLowerCase() === 'yes') {
      try {
        execSync(`claude mcp add eventmodelers --transport http ${baseUrl}/mcp`, { stdio: 'inherit' });
        console.log('  ✓ MCP connected globally via claude mcp add');
      } catch {
        console.error('  ⚠️  claude mcp add failed — you can run it manually:');
        console.error(`       claude mcp add eventmodelers --transport http ${baseUrl}/mcp`);
      }
    }

    console.log('\n✅ Done!\n');
    console.log('Start the agent (realtime + task loop in one process):');
    console.log('       cd .agent-modeling-kit && node ralph-claude.js\n');
    console.log('Or using Ollama (run `ollama serve` first):');
    console.log('       cd .agent-modeling-kit && node ralph-ollama.js\n');
    console.log('Or using the bash loop only (no realtime):');
    console.log('       cd .agent-modeling-kit && ./ralph.sh\n');
    console.log('Skills are ready in .claude/skills/ — use /connect to set a board ID.');
  });

program
  .command('uninstall')
  .description('Remove agent kit files from current directory')
  .action(() => {
    const targets = [
      join(process.cwd(), '.agent-modeling-kit'),
      join(process.cwd(), '.claude', 'skills'),
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
    const kitDir = join(process.cwd(), '.agent-modeling-kit');
    const skillsDir = join(process.cwd(), '.claude', 'skills');
    const configPath = join(kitDir, '.eventmodelers', 'config.json');
    const ralphPath = join(kitDir, 'ralph-claude.js');

    console.log('Eventmodelers Agent Modeling Kit Status\n');
    console.log(`Kit dir:        ${existsSync(kitDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Skills:         ${existsSync(skillsDir) ? '✅ installed' : '❌ not found'}`);
    console.log(`Config:         ${existsSync(configPath) ? '✅ present' : '❌ missing'}`);
    console.log(`Ralph agent:    ${existsSync(ralphPath) ? '✅ present' : '❌ missing'}`);

    if (existsSync(configPath)) {
      try {
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        console.log(`\nConnected to:   ${cfg.baseUrl || 'https://api.eventmodelers.ai'}`);
        console.log(`Organization:   ${cfg.organizationId}`);
      } catch {
        console.log('\n⚠️  Config file is invalid JSON');
      }
    }
  });

program.parse();
