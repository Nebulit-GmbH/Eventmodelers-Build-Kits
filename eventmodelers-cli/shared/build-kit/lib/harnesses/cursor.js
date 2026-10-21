// Cursor's CLI (`cursor-agent`, or plain `agent` on current installs).
//
// The one harness with a session of its own. The CLI takes one prompt per process, but it can keep
// a chat across runs: `create-chat` once, `--resume <id>` on every turn. The process is still new
// each turn; what carries over is the conversation — the kit's CLAUDE.md and the MCP tool set it
// has already read — so only the first turn pays for them.

import { execFileSync, spawnSync } from 'child_process';
import { join } from 'path';
import { mergeJsonConfig } from './util.js';

const binName = (word) => word.split('/').pop().replace(/@.*$/, '');

// Whichever Cursor binary is on PATH; with neither, `cursor-agent` so the failure names a real binary.
export function cursorBinary() {
  for (const bin of ['cursor-agent', 'agent']) {
    try { execFileSync('which', [bin], { stdio: 'ignore' }); return bin; } catch {}
  }
  return 'cursor-agent';
}

export default {
  name: 'cursor',
  // `agent` is far too generic a word to match anywhere but first.
  matches: (words) => binName(words[0]) === 'agent' || words.slice(0, 3).some((w) => ['cursor-agent', 'cursor'].includes(binName(w))),
  preset() {
    const bin = cursorBinary();
    return {
      modeling: `${bin} -p --output-format text --approve-mcps --force --trust`,
      build: `${bin} -p --output-format stream-json --approve-mcps --force --trust`,
    };
  },
  modelFlag: '--model', // `-m` is an unknown option to this CLI

  // The same project .cursor/mcp.json the editor reads; ${env:NAME} is resolved from the env the
  // runner hands it. --approve-mcps in the command is what lets a headless run load it unprompted.
  registerMcp(command, projectDir, url) {
    const entry = { url, headers: { 'x-token': '${env:EVENTMODELERS_TOKEN}', 'x-agent-id': '${env:EVENTMODELERS_AGENT_ID}' } };
    const ok = mergeJsonConfig(join(projectDir, '.cursor', 'mcp.json'), (config) => {
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.eventmodelers = entry;
    });
    return { command, file: ok ? '.cursor/mcp.json' : null, manual: ok ? null : `add mcpServers.eventmodelers = ${JSON.stringify(entry)} to .cursor/mcp.json` };
  },

  // Turns share one chat. start() makes it (returns its id, or '' when it could not); resume() puts
  // it on a command — right after the binary, ahead of the flags and the prompt.
  session: {
    start(command, { cwd, env, log }) {
      const bin = command.trim().split(/\s+/)[0];
      const r = spawnSync(bin, ['create-chat'], { cwd, encoding: 'utf8', env });
      const id = String(r.stdout || '').trim().split(/\s+/).pop();
      if (r.status !== 0 || !id) {
        log(`cursor: could not create a chat (${String(r.stderr || '').trim() || `exit ${r.status}`}) — running without resume, every turn starts cold`);
        return '';
      }
      log(`cursor: resuming chat ${id} on every turn`);
      return id;
    },
    resume: (command, id) => command.replace(/^(\s*\S+)/, `$1 --resume ${id}`),
  },
};
