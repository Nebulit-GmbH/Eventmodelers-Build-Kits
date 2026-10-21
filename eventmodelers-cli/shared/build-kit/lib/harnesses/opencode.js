// OpenCode (`opencode run`).

import { spawnSync } from 'child_process';
import { join } from 'path';
import { mergeJsonConfig } from './util.js';

// Older OpenCode releases have no `run --standalone`; passing it makes `opencode run` print its
// usage and exit 1, so every turn fails. Ask the installed binary once. Overridable for tests.
let standaloneSupported = null;
export function opencodeSupportsStandalone() {
  if (standaloneSupported === null) {
    const r = spawnSync('opencode', ['run', '--help'], { encoding: 'utf8' });
    standaloneSupported = /--standalone\b/.test(`${r.stdout || ''}${r.stderr || ''}`);
  }
  return standaloneSupported;
}
export function setOpencodeStandaloneSupport(value) { standaloneSupported = value; }

export default {
  name: 'opencode',
  matches: (words) => words.slice(0, 3).some((w) => binName(w) === 'opencode'),
  // --standalone: a plain `opencode run` hands the turn to opencode's shared background service,
  // started with some other env — so the MCP header's {env:EVENTMODELERS_TOKEN} resolves to nothing
  // there and every eventmodelers tool fails to authenticate. A private server inherits ours.
  preset: () => ({ modeling: 'opencode run --standalone --auto', build: 'opencode run --standalone --auto --format json' }),

  registerMcp(command, projectDir, url) {
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
    // A binary without the flag runs the turn in-process already, so the flag is dropped, not added.
    const supported = opencodeSupportsStandalone();
    const standalone = !supported ? command.replace(/\s--standalone\b/, '')
      : /\s--(standalone|server)\b/.test(` ${command}`) ? command : `${command} --standalone`;
    return { command: standalone, file: ok ? 'opencode.json' : null, manual: ok ? null : `add mcp.eventmodelers = ${JSON.stringify(entry)} to opencode.json` };
  },
};

function binName(word) { return word.split('/').pop().replace(/@.*$/, ''); }
