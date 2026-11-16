// Kiro CLI (`kiro-cli chat --no-interactive`).

import { join } from 'path';
import { mergeJsonConfig } from './util.js';

const binName = (word) => word.split('/').pop().replace(/@.*$/, '');

export default {
  name: 'kiro',
  matches: (words) => words.slice(0, 3).some((w) => ['kiro-cli', 'kiro'].includes(binName(w))),
  // --trust-workspace: without it a headless run does not load the project .kiro/settings/mcp.json (nobody to answer the trust prompt).
  // --trust-all-tools: a headless turn has nobody to approve tool calls (like --yolo / --force elsewhere).
  preset: () => ({ modeling: 'kiro-cli chat --no-interactive --trust-all-tools --trust-workspace', build: 'kiro-cli chat --no-interactive --trust-all-tools --trust-workspace' }),
  modelFlag: '--model',

  // The project-level .kiro/settings/mcp.json; ${NAME} is resolved from the env the runner hands it.
  registerMcp(command, projectDir, url) {
    const entry = { url, headers: { 'x-token': '${EVENTMODELERS_TOKEN}', 'x-agent-id': '${EVENTMODELERS_AGENT_ID}' } };
    const ok = mergeJsonConfig(join(projectDir, '.kiro', 'settings', 'mcp.json'), (config) => {
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.eventmodelers = entry;
    });
    return { command, file: ok ? '.kiro/settings/mcp.json' : null, manual: ok ? null : `add mcpServers.eventmodelers = ${JSON.stringify(entry)} to .kiro/settings/mcp.json` };
  },
};
