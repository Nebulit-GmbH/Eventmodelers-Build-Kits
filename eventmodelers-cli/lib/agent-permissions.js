// How the modeling agent's Claude process is locked down. It takes chat messages and snippet clicks from any
// collaborator on the board, so it does not run with --dangerously-skip-permissions (which approves every tool call,
// rm and curl-to-anywhere included). Instead:
//
// - --permission-mode dontAsk: a tool call that is not explicitly allowed is refused on the spot — nobody is asked
//   (with stream-json a permission prompt would go to this CLI, which never answers, and the turn would hang).
// - --strict-mcp-config + --mcp-config: the eventmodelers server is the only MCP server, whatever else the machine's
//   user or project settings configure; mcp__eventmodelers allows all of its tools. With `browser`, the Playwright
//   server (@playwright/mcp) joins it for discover-storyboard — opt-in, since a browser reaches any site.
// - Bash goes through lib/bash-guard-hook.js (a PreToolUse hook): it allows only the commands on lib/bash-guard.js's
//   list — curl only to the platform — and denies the rest. There is no Bash allow rule, so a command the hook does
//   not explicitly allow is refused by dontAsk.
// - Files: reading and editing in the kit directory (the working directory) and the temp directories; reading the
//   code directory (--add-dir). Never the files holding the token (.eventmodelers/*.json — the rest of .eventmodelers/,
//   e.g. the interview trail in .eventmodelers/interviews/, stays usable), never .claude/ or .mcp.json (an agent rewriting
//   its own permissions or hooks would outlive the turn), never .env files. No WebFetch / WebSearch.

import { realpathSync } from 'fs';

const realOrSame = (path) => { try { return realpathSync(path); } catch { return path; } };
// Claude Code permission rules write an absolute path with a leading // (a single / is relative to the settings file).
const abs = (path) => `/${path}`;

/**
 * The claude arguments and environment for a locked-down modeling agent.
 * { baseUrl, projectDir, codeDir?, tmpDir, hookCommand } → { args: string[], env: Record<string, string> }
 */
export function modelingPermissions({ baseUrl, projectDir, codeDir, tmpDir, hookCommand, browser = false }) {
  const tempDirs = [...new Set(['/tmp', '/private/tmp', tmpDir, realOrSame(tmpDir)].filter(Boolean))];
  const roots = [...new Set([projectDir, realOrSame(projectDir), codeDir, codeDir && realOrSame(codeDir), ...tempDirs].filter(Boolean))];

  const allowed = [
    'mcp__eventmodelers',
    ...(browser ? ['mcp__playwright'] : []),
    'Skill', 'Agent', 'Task', 'TodoWrite', 'ToolSearch',
    // Edit rules cover every file-editing tool (Write included) — Claude ignores Write(path) rules.
    'Edit(./**)',
    ...tempDirs.flatMap((dir) => [`Read(${abs(dir)}/**)`, `Edit(${abs(dir)}/**)`]),
  ];
  const secretReads = ['./.claude/settings.local.json', './.claude/settings.json', './.eventmodelers/*.json', './**/.eventmodelers/*.json', './**/.env', './**/.env.*'];
  const disallowed = [
    'WebFetch', 'WebSearch',
    ...secretReads.map((p) => `Read(${p})`),
    ...(codeDir ? [`Read(${abs(codeDir)}/**/.env)`, `Read(${abs(codeDir)}/**/.env.*)`] : []),
    'Edit(./.claude/**)', 'Edit(./.mcp.json)', 'Edit(./.eventmodelers/*.json)', 'Edit(./**/.eventmodelers/*.json)',
  ];

  const mcpConfig = {
    mcpServers: {
      eventmodelers: {
        type: 'http',
        url: `${baseUrl}/mcp`,
        // Resolved by claude from its own environment — the token never sits in an argument.
        headers: { 'x-token': '${EVENTMODELERS_TOKEN}', 'x-agent-id': '${EVENTMODELERS_AGENT_ID}' },
      },
      ...(browser ? { playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] } } : {}),
    },
  };
  const settings = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand }] }] },
  };

  return {
    args: [
      '--permission-mode', 'dontAsk',
      '--allowedTools', allowed.join(','),
      '--disallowedTools', disallowed.join(','),
      '--strict-mcp-config', '--mcp-config', JSON.stringify(mcpConfig),
      '--settings', JSON.stringify(settings),
    ],
    env: {
      EVENTMODELERS_GUARD_BASE_URL: baseUrl,
      EVENTMODELERS_GUARD_ROOTS: JSON.stringify(roots),
    },
  };
}
