// The name an agent shows on the board when nobody gave it one: the repository it runs in and what it is
// ("cart-service (build)"). Derived on every start, so it is stable for as long as the repo is, and never
// written into the project's config — `agentName` there (init --name) and `run --name` still win.

import { execFileSync } from 'child_process';
import { basename } from 'path';

// `git@github.com:acme/cart-service.git`, `https://host/acme/cart-service/`, `ssh://git@host:2222/a/b.git` →
// the last path segment without `.git`.
function repoNameFromRemote(url) {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  return last.replace(/\.git$/, '');
}

export function defaultAgentName(projectDir, agentType = 'BUILD') {
  let repo = '';
  try {
    repo = repoNameFromRemote(execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: projectDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { /* no remote, or not a git repo */ }
  return `${repo || basename(projectDir)} (${agentType.toLowerCase()})`;
}
