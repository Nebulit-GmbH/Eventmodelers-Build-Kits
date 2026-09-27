// `run --modeling --exec "<command>"`: the modeling loop's baseline runner — any agent
// harness with a headless mode, one process per turn.
//
// The warm Claude runner and --local-ai own the whole session; this one owns nothing. The loop
// around it already does everything that needs no model — the heartbeat, the realtime channel,
// claiming prompts and chat messages — so all a turn needs is an agent that takes one prompt,
// does the board work over MCP and exits. The MCP registration is written for it (registerMcp).
// That is what `codex exec`, `gemini -p`, `opencode run` and whatever comes next already are,
// so one generic spawn covers them, the same bet shared/build-kit/ralph-exec.js makes for a
// build kit. The price is a fresh process per turn: seconds of startup, and a session that
// remembers nothing — which the chat can afford, since a chat turn reads its conversation from
// the platform anyway rather than from the session's memory.
//
// The prompt is appended to the command as one quoted argument and also written to the file
// named by RALPH_PROMPT_FILE, for a command that would rather read it — as ralph-exec.js does.
// What the command prints on stdout is the turn's result: the standalone lane reads its
// NOOP/DONE answer from it, and a chat turn that forgot post_chat_message has it posted as the
// reply. So run the harness in its plain-text mode, not a JSON one.

import { spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { turnTimeoutMs, superviseTurn } from '../shared/build-kit/lib/turn.js';

// POSIX single-quote escaping: close, insert an escaped quote, reopen. A turn is multi-line
// text with backticks and $ in it, so it cannot go in unquoted.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Adds or refreshes one key in a project JSON config, leaving everything else in it alone. A file
// that isn't plain JSON (a JSONC one with comments) is not rewritten — returns false instead, and
// the caller says what to add by hand.
function mergeJsonConfig(path, apply) {
  let config = {};
  if (existsSync(path)) {
    try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { return false; }
  }
  apply(config);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

// How each known harness learns about the eventmodelers MCP server — the --exec counterpart of
// ensureMcpRegistered's `.mcp.json` for Claude, and like it rewritten every run, always into the
// harness's *project* config in the agent's working dir (never a user-wide one), and always with
// the token as an env reference the harness resolves from the env this runner hands it, never its
// value. Each entry returns the command to run, which is where a harness without a usable project
// config (Codex only loads one for a trusted project) takes the server as flags instead. Adding a
// harness is one entry here.
const MCP_REGISTRATIONS = {
  opencode: (command, projectDir, url) => {
    const entry = {
      type: 'remote',
      url,
      headers: { 'x-token': '{env:EVENTMODELERS_TOKEN}', 'x-agent-id': '{env:EVENTMODELERS_AGENT_ID}' },
    };
    const ok = mergeJsonConfig(join(projectDir, 'opencode.json'), (config) => {
      // OpenCode 2 nests servers under mcp.servers and still reads the older flat mcp.<name>;
      // follow whichever form the file already uses.
      config.mcp = config.mcp || {};
      if (config.mcp.servers) config.mcp.servers.eventmodelers = entry;
      else config.mcp.eventmodelers = entry;
    });
    return { command, file: ok ? 'opencode.json' : null, manual: ok ? null : `add mcp.eventmodelers = ${JSON.stringify(entry)} to opencode.json` };
  },
  gemini: (command, projectDir, url) => {
    const entry = { httpUrl: url, headers: { 'x-token': '$EVENTMODELERS_TOKEN', 'x-agent-id': '$EVENTMODELERS_AGENT_ID' } };
    const ok = mergeJsonConfig(join(projectDir, '.gemini', 'settings.json'), (config) => {
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.eventmodelers = entry;
    });
    return { command, file: ok ? '.gemini/settings.json' : null, manual: ok ? null : `add mcpServers.eventmodelers = ${JSON.stringify(entry)} to .gemini/settings.json` };
  },
  codex: (command, _projectDir, url) => ({
    // -c values are TOML; env_http_headers names the env var each header is read from.
    command: `${command} -c ${shellQuote(`mcp_servers.eventmodelers.url="${url}"`)} -c ${shellQuote('mcp_servers.eventmodelers.env_http_headers={x-token="EVENTMODELERS_TOKEN",x-agent-id="EVENTMODELERS_AGENT_ID"}')}`,
    file: null,
    manual: null,
  }),
};

// Which known harness a command runs — the first word naming one, so `npx @openai/codex exec`
// and `/opt/bin/opencode run` are recognised as well as the bare names.
export function harnessOf(command) {
  for (const word of String(command).trim().split(/\s+/).slice(0, 3)) {
    const name = word.split('/').pop().replace(/@.*$/, '');
    if (MCP_REGISTRATIONS[name]) return name;
  }
  return null;
}

// Registers the MCP server for the command's harness. Returns the command to run with it, and
// whether the server is now registered — false for an unknown command or a config it could not
// update, where the turn still has to connect the way the kit says to.
export function registerMcp(command, projectDir, baseUrl, log) {
  const url = `${baseUrl}/mcp`;
  const harness = harnessOf(command);
  if (!harness) {
    log(`MCP: unknown agent command — register the eventmodelers MCP server with it yourself: ${url}, header x-token from $EVENTMODELERS_TOKEN (and x-agent-id from $EVENTMODELERS_AGENT_ID)`);
    return { command, registered: false };
  }
  const reg = MCP_REGISTRATIONS[harness](command, projectDir, url);
  if (reg.manual) log(`MCP: could not update the ${harness} config (not plain JSON) — ${reg.manual}`);
  else log(`MCP: eventmodelers registered for ${harness}${reg.file ? ` in ${reg.file}` : ' via -c flags'}`);
  return { command: reg.command, registered: !reg.manual };
}

export function createModelingExecRunner({ cfg, command: rawCommand, projectDir, log }) {
  if (!rawCommand) {
    throw new Error('no agent command — pass one, e.g. --exec "codex exec --full-auto", or persist it as localAi.exec in .eventmodelers/config.json');
  }
  const { command, registered: mcpRegistered } = registerMcp(rawCommand, projectDir, cfg.baseUrl, log);
  const timeoutMs = turnTimeoutMs(cfg);
  const promptDir = mkdtempSync(join(tmpdir(), 'modeling-exec-'));
  const env = {
    ...process.env,
    // What the skills' curl fallback and an MCP registration reading ${EVENTMODELERS_TOKEN}
    // authenticate with, and what attributes the agent's board writes to this agent.
    EVENTMODELERS_TOKEN: cfg.token,
    ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
  };

  function runTurn(text) {
    return new Promise((resolveTurn, rejectTurn) => {
      const promptFile = join(promptDir, 'prompt.md');
      writeFileSync(promptFile, text);
      const startedAt = Date.now();
      // stdin ignored: some harnesses append a piped stdin to the prompt, and nobody is there to
      // type into it. stdout is echoed as it comes — the harness owns its output format, there is
      // no cross-harness stream to condense — and kept as the turn's result.
      const proc = spawn(`${command} ${shellQuote(text)}`, {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'inherit'],
        shell: true,
        env: { ...env, RALPH_PROMPT_FILE: promptFile },
      });
      const turn = superviseTurn(proc, { timeoutMs, label: 'exec turn', viaShell: true, log });
      let out = '';
      proc.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        out += chunk.toString();
      });
      proc.on('close', (code) => {
        const timeout = turn.timeoutError();
        if (timeout) return rejectTurn(timeout);
        if (code !== 0) return rejectTurn(new Error(`exec command exited ${code}`));
        log(`done (${Date.now() - startedAt}ms)`);
        resolveTurn(out.trim());
      });
      proc.on('error', rejectTurn);
    });
  }

  return {
    runTurn,
    // Nothing to warm: every turn is its own process.
    warmUp: async () => {},
    describe: () => rawCommand,
    mcpRegistered,
  };
}
