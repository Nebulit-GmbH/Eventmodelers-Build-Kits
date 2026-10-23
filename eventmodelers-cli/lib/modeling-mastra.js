// `run --modeling --agent mastra`: the modeling loop's Mastra runner — one warm agent session for the life of the
// loop (shared/build-kit/lib/mastra-session.js), the counterpart of the warm `claude` process.
//
// It is shaped like lib/modeling-exec.js's runner so the loop treats it the same way: the loop owns the
// heartbeat, the realtime channel, claiming prompts and chat messages; all a turn needs is something that takes
// the turn's text, does the board work over MCP and answers. What differs from an exec harness is that the
// process, its MCP connection and the conversation stay up between turns, so only the first turn carries the
// session header and a standalone warm-up turn pays off.
//
// Locked down the way the default Claude runner is: the agent's shell goes through the same command allowlist
// (lib/bash-guard.js), and its file tools reach no further than the project directory.

import { tmpdir } from 'os';
import { turnTimeoutMs } from '../shared/build-kit/lib/turn.js';
import { createMastraSession, mastraModelConfig } from '../shared/build-kit/lib/mastra-session.js';
import { checkBashCommand } from './bash-guard.js';

const INSTRUCTIONS =
  'You are an Eventmodelers modeling agent working on a board with the people who use it. Each turn tells you what ' +
  'to do and which board it is about; the first one tells you to read .agent-modeling-kit/CLAUDE.md, which you then ' +
  'follow for every turn. The kit\'s skills are available through the skill tools. The eventmodelers MCP server is ' +
  'connected and authenticated: use its tools directly. You have no subagents, so do all the work yourself.';

// What the modeling agent is built from.
function modelingAgentOptions({ cfg, model, projectDir, codeDir }) {
  const baseUrl = process.env.MASTRA_BASE_URL || cfg.mastra?.baseUrl;
  mastraModelConfig(model, { baseUrl }); // throws a message that says what to pass
  const policy = { baseUrl: cfg.baseUrl, cwd: projectDir, roots: [projectDir, tmpdir(), ...(codeDir ? [codeDir] : [])] };
  return {
    model,
    baseUrl,
    instructions: INSTRUCTIONS,
    mcpUrl: `${cfg.baseUrl}/mcp`,
    token: cfg.token,
    agentId: cfg.agentId,
    cwd: projectDir,
    workspace: true,
    skillsDirs: ['.claude/skills'],
    env: {
      ...process.env,
      // What the skills' curl fallback writes as $BASE_URL / $ORG_ID / $BOARD_ID / $TOKEN. Set here, not
      // inherited: the guard treats $BASE_URL as the platform, so one from the operator's shell must never reach it.
      BASE_URL: cfg.baseUrl,
      ORG_ID: cfg.organizationId,
      BOARD_ID: cfg.boardId,
      TOKEN: cfg.token,
      EVENTMODELERS_TOKEN: cfg.token,
      ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
      ...(codeDir ? { EVENTMODELERS_CODE_DIR: codeDir } : {}),
    },
    checkCommand: (command) => checkBashCommand(command, policy),
  };
}

export async function createModelingMastraRunner({ cfg, model, projectDir, codeDir = null, log, onToolUse }) {
  const session = await createMastraSession({ ...modelingAgentOptions({ cfg, model, projectDir, codeDir }), log });

  const timeoutMs = turnTimeoutMs(cfg);
  let primed = false; // a turn has succeeded: the session has read the kit, so later turns skip the preamble
  let queue = Promise.resolve();

  async function runTurnNow(text) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const ends = new Map(); // tool call id -> the journal's end callback
    try {
      const result = await session.runTurn(text, {
        signal: controller.signal,
        onToolCall: (name, args, id) => { const end = onToolUse?.(name, args); if (end && id) ends.set(id, end); },
        onToolResult: (id, outcome) => { ends.get(id)?.(outcome); ends.delete(id); },
      });
      if (result.isError) throw new Error(result.text || 'Mastra turn errored');
      primed = true;
      log(`done (${Date.now() - startedAt}ms)`);
      return result.text.trim();
    } catch (err) {
      if (controller.signal.aborted) {
        const timeout = new Error(`Mastra turn timed out after ${Math.round(timeoutMs / 60_000)}min`);
        timeout.timedOut = true;
        throw timeout;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      for (const end of ends.values()) end({ isError: true }); // a call that never reported back
    }
  }

  return {
    // Turns share one conversation, so they take their turns one at a time.
    runTurn(text) {
      const result = queue.then(() => runTurnNow(text));
      queue = result.catch(() => {});
      return result;
    },
    hasSession: true,
    describe: () => `Mastra (${model})`,
    mcpRegistered: true,
    get keepsSession() { return primed; },
    close: () => session.close(),
  };
}
