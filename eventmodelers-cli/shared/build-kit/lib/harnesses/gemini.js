// Gemini CLI (`gemini -p`).

import { join } from 'path';
import { mergeJsonConfig } from './util.js';

export default {
  name: 'gemini',
  matches: (words) => words.slice(0, 3).some((w) => w.split('/').pop().replace(/@.*$/, '') === 'gemini'),
  preset: () => ({ modeling: 'gemini --yolo -p', build: 'gemini --yolo --output-format stream-json -p' }),

  registerMcp(command, projectDir, url) {
    const entry = { httpUrl: url, headers: { 'x-token': '$EVENTMODELERS_TOKEN', 'x-agent-id': '$EVENTMODELERS_AGENT_ID' } };
    const ok = mergeJsonConfig(join(projectDir, '.gemini', 'settings.json'), (config) => {
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.eventmodelers = entry;
    });
    return { command, file: ok ? '.gemini/settings.json' : null, manual: ok ? null : `add mcpServers.eventmodelers = ${JSON.stringify(entry)} to .gemini/settings.json` };
  },
};
