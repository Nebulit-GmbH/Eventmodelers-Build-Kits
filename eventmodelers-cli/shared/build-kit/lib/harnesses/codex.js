// OpenAI Codex CLI (`codex exec`).

import { shellQuote } from './util.js';

export default {
  name: 'codex',
  matches: (words) => words.slice(0, 3).some((w) => w.split('/').pop().replace(/@.*$/, '') === 'codex'),
  preset(loop, env = process.env) {
    const p = { modeling: 'codex exec --full-auto', build: 'codex exec --json --full-auto' };
    // The docker images set this: Codex's own sandbox (landlock) can't start inside a container, and the
    // container already is the sandbox — the flag Codex documents for externally sandboxed environments.
    if (env.EVENTMODELERS_CODEX_NO_SANDBOX === '1') {
      return { modeling: p.modeling.replace('--full-auto', '--dangerously-bypass-approvals-and-sandbox'), build: p.build.replace('--full-auto', '--dangerously-bypass-approvals-and-sandbox') };
    }
    return p;
  },

  // Codex only loads a project config for a trusted project, so the server rides on the command as flags.
  registerMcp: (command, _projectDir, url) => ({
    // -c values are TOML; env_http_headers names the env var each header is read from.
    command: `${command} -c ${shellQuote(`mcp_servers.eventmodelers.url="${url}"`)} -c ${shellQuote('mcp_servers.eventmodelers.env_http_headers={x-token="EVENTMODELERS_TOKEN",x-agent-id="EVENTMODELERS_AGENT_ID"}')}`,
    file: null,
    manual: null,
  }),
};
