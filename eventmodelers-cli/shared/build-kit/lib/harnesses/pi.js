// Pi (`pi -p`) — pi.dev, npm @earendil-works/pi-coding-agent. MCP support is built in from 1.x;
// the old @mariozechner/pi-coding-agent name stops at 0.73 and has none.

import { join } from 'path';
import { mergeJsonConfig } from './util.js';

export default {
  name: 'pi',
  matches: (words) => words.slice(0, 3).some((w) => w.split('/').pop().replace(/@.*$/, '') === 'pi'),
  // --approve: print/json mode cannot ask whether to trust the project, and an untrusted project's
  // .pi/mcp.json and .pi/skills are skipped without a word — so the eventmodelers tools would be missing.
  // The prompt goes last, as the positional argument -p takes.
  preset: () => ({ modeling: 'pi --approve -p', build: 'pi --approve --mode json -p' }),
  modelFlag: '--model',

  registerMcp(command, projectDir, url) {
    const entry = {
      url,
      headers: { 'x-token': '${EVENTMODELERS_TOKEN}', 'x-agent-id': '${EVENTMODELERS_AGENT_ID}' },
      // The default, codemode, reaches MCP tools through a code wrapper; the skills call them by name.
      exposure: 'direct',
    };
    const ok = mergeJsonConfig(join(projectDir, '.pi', 'mcp.json'), (config) => {
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.eventmodelers = entry;
    });
    // A command that did not come from the preset (--exec "pi -p") still needs the trust flag, or
    // the file just written is ignored.
    const approved = /\s(--approve|-a|--no-approve)\b/.test(` ${command}`) ? command : command.replace(/^(\S*\bpi)\b/, '$1 --approve');
    return { command: approved, file: ok ? '.pi/mcp.json' : null, manual: ok ? null : `add mcpServers.eventmodelers = ${JSON.stringify(entry)} to .pi/mcp.json` };
  },
};
