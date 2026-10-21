// Hermes (`hermes chat`).

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export default {
  name: 'hermes',
  matches: (words) => words.slice(0, 3).some((w) => w.split('/').pop().replace(/@.*$/, '') === 'hermes'),
  // -q takes the prompt, so the preset ends with it (the --model flag is inserted before it, see withModel).
  // -Q is the plain-text mode a modeling turn reads its answer from; --format stream-json is the build kit's.
  preset: () => ({ modeling: 'hermes chat --yolo -Q -q', build: 'hermes chat --yolo --format stream-json -q' }),
  withModel: (command, flag) => (command.endsWith(' -q') ? `${command.slice(0, -3)} ${flag} -q` : `${command} ${flag}`),

  // Hermes reads MCP servers from ~/.hermes/config.yaml only (there is no project-level file), so
  // this never writes it — a user-wide file is not ours to rewrite. It reports the server as
  // registered when the file already names it (the docker images ship it), and says what to add otherwise.
  registerMcp(command, _projectDir, url) {
    const file = join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'config.yaml');
    const has = existsSync(file) && /^\s+eventmodelers:/m.test(readFileSync(file, 'utf8'));
    return {
      command,
      file: null,
      reason: '', // not a JSON file — there is nothing to say about its format
      manual: has ? null : `add to ${file}:\nmcp_servers:\n  eventmodelers:\n    url: "${url}"\n    headers:\n      x-token: "\${EVENTMODELERS_TOKEN}"`,
    };
  },
};
