#!/usr/bin/env node
// PreToolUse hook for the modeling agent's Bash tool — see lib/bash-guard.js for the rules. The CLI registers it via
// --settings and hands the policy over in the environment (EVENTMODELERS_GUARD_BASE_URL, EVENTMODELERS_GUARD_ROOTS).
// It answers "allow" for a command on the list and "deny" (with the reason, which the agent sees) for anything else.
// It fails closed: an unreadable input, a missing policy or a crash is a deny — a hook that errors would otherwise let
// the call through to the permission rules.

import { checkBashCommand } from './bash-guard.js';

const decide = (permissionDecision, permissionDecisionReason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
  }));
  process.exit(0);
};

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const baseUrl = process.env.EVENTMODELERS_GUARD_BASE_URL;
    const roots = JSON.parse(process.env.EVENTMODELERS_GUARD_ROOTS ?? '[]');
    if (!baseUrl || !Array.isArray(roots) || !roots.length) return decide('deny', 'Bash guard has no policy — refusing every command');
    const result = checkBashCommand(event?.tool_input?.command, { baseUrl, roots, cwd: event?.cwd || process.cwd() });
    if (result.ok) return decide('allow', 'on the modeling agent\'s command allowlist');
    return decide('deny', `Refused by the agent's command allowlist: ${result.reason}. Use the eventmodelers MCP tools, or curl to ${baseUrl} only.`);
  } catch (err) {
    return decide('deny', `Bash guard failed (${err?.message ?? err}) — refusing the command`);
  }
});
