// The agent harnesses `run --exec` / `run --agent` can hand a turn to, one module each — everything
// a harness needs (its headless command, how to recognise it, how the eventmodelers MCP server gets
// registered with it, its model flag, any session of its own) lives in its file. Claude is not here:
// it has a dedicated runner. Adding a harness is one module and one line in HARNESSES.
//
// A module exports: name, matches(words), preset(loop?) -> {modeling, build}, registerMcp(command,
// projectDir, url) -> {command, file, manual, reason?}, and optionally modelFlag (default `-m`),
// withModel(command, flag) and session {start, resume}.

import opencode from './opencode.js';
import codex from './codex.js';
import gemini from './gemini.js';
import hermes from './hermes.js';
import cursor from './cursor.js';
import { shellQuote } from './util.js';

export { shellQuote };
export { opencodeSupportsStandalone, setOpencodeStandaloneSupport } from './opencode.js';

const HARNESSES = [opencode, codex, gemini, hermes, cursor];

// Every name `--agent` takes, claude (the default runner, no command) first.
export const AGENT_NAMES = ['claude', ...HARNESSES.map((h) => h.name)];

export function harnessByName(name) {
  return HARNESSES.find((h) => h.name === name) ?? null;
}

// Which known harness a command runs — the first words naming one, so `npx @openai/codex exec`
// and `/opt/bin/opencode run` are recognised as well as the bare names.
export function harnessFor(command) {
  const words = String(command).trim().split(/\s+/);
  return HARNESSES.find((h) => h.matches(words)) ?? null;
}

export function harnessOf(command) {
  return harnessFor(command)?.name ?? null;
}

// The headless command --agent <name> stands for, for the `modeling` or `build` loop.
export function presetCommand(name, loop) {
  return harnessByName(name)?.preset(loop)[loop] ?? null;
}

// `--model <id>` on a preset command, spelled the way that harness wants it.
export function withModel(command, id) {
  const h = harnessFor(command);
  const flag = `${h?.modelFlag ?? '-m'} ${shellQuote(id)}`;
  return h?.withModel ? h.withModel(command, flag) : `${command} ${flag}`;
}

// Registers the MCP server for the command's harness. Returns the command to run with it, and
// whether the server is now registered — false for an unknown command or a config it could not
// update, where the turn still has to connect the way the kit says to.
export function registerMcp(command, projectDir, baseUrl, log) {
  const url = `${baseUrl}/mcp`;
  const harness = harnessFor(command);
  if (!harness) {
    log(`MCP: unknown agent command — register the eventmodelers MCP server with it yourself: ${url}, header x-token from $EVENTMODELERS_TOKEN (and x-agent-id from $EVENTMODELERS_AGENT_ID)`);
    return { command, registered: false };
  }
  const reg = harness.registerMcp(command, projectDir, url);
  if (reg.manual) log(`MCP: could not update the ${harness.name} config${reg.reason ?? ' (not plain JSON)'} — ${reg.manual}`);
  else log(`MCP: eventmodelers registered for ${harness.name}${reg.file ? ` in ${reg.file}` : ' via -c flags'}`);
  return { command: reg.command, registered: !reg.manual };
}
