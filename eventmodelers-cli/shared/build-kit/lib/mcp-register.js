// Registers the eventmodelers MCP server with an external agent harness (OpenCode, Gemini, Codex),
// for both loops that hand turns to one: the modeling loop (lib/modeling-exec.js) and the build
// loop (ralph-exec.js).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

// POSIX single-quote escaping: close, insert an escaped quote, reopen. A turn is multi-line
// text with backticks and $ in it, so it cannot go in unquoted.
export function shellQuote(s) {
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
    // A plain `opencode run` hands the turn to opencode's shared background service, which was
    // started with some other env: {env:EVENTMODELERS_TOKEN} resolves to nothing there and the
    // server refuses every call. --standalone runs a private server that inherits this one's env.
    const standalone = /\s--(standalone|server)\b/.test(` ${command}`) ? command : `${command} --standalone`;
    return { command: standalone, file: ok ? 'opencode.json' : null, manual: ok ? null : `add mcp.eventmodelers = ${JSON.stringify(entry)} to opencode.json` };
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

