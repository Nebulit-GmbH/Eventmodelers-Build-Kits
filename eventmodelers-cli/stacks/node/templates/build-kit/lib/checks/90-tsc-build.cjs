'use strict';

// The project must still typecheck after the slice change. Uses the project's
// own `typescript` devDependency via `npx tsc --noEmit` — no new dependency,
// but it does mean this check needs node_modules already installed (same
// prerequisite `npm run build` already has).

const { execSync } = require('child_process');

module.exports = {
  name: 'tsc-build',
  skipIfAlreadyFailing: true, // slow — don't bother once the commit is rejected already
  run(ctx) {
    try {
      execSync('npx tsc --noEmit', { cwd: ctx.repoRoot, stdio: 'pipe' });
      return [];
    } catch (err) {
      const output = String(err.stdout || err.message || '').trim().split('\n').slice(0, 20).join('\n');
      return [{ path: '(tsc --noEmit)', reason: `TypeScript build failed:\n${output}` }];
    }
  },
};
