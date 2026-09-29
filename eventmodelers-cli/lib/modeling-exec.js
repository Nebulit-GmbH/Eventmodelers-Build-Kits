// `run --modeling --exec "<command>"`: the modeling loop's baseline runner — any agent
// harness with a headless mode, one process per turn.
//
// The warm Claude runner and --local-ai own the whole session; this one owns nothing. The loop
// around it already does everything that needs no model — the heartbeat, the realtime channel,
// claiming prompts and chat messages — so all a turn needs is an agent that takes one prompt,
// does the board work over MCP and exits. The MCP registration is written for it (registerMcp).
// That is what `codex exec`, `gemini -p`, `opencode run` and whatever comes next already are,
// so one generic spawn covers them, the same bet shared/build-kit/ralph-exec.js makes for a
// build kit. The price is a fresh process per turn: seconds of startup, and a session that
// remembers nothing — which the chat can afford, since a chat turn reads its conversation from
// the platform anyway rather than from the session's memory.
//
// The prompt is appended to the command as one quoted argument and also written to the file
// named by RALPH_PROMPT_FILE, for a command that would rather read it — as ralph-exec.js does.
// What the command prints on stdout is the turn's result: the standalone lane reads its
// NOOP/DONE answer from it, and a chat turn that forgot post_chat_message has it posted as the
// reply. So run the harness in its plain-text mode, not a JSON one.

import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { turnTimeoutMs, superviseTurn } from '../shared/build-kit/lib/turn.js';
import { shellQuote, harnessOf, registerMcp } from '../shared/build-kit/lib/mcp-register.js';

export { harnessOf, registerMcp };

export function createModelingExecRunner({ cfg, command: rawCommand, projectDir, log }) {
  if (!rawCommand) {
    throw new Error('no agent command — pass one, e.g. --exec "codex exec --full-auto", or persist it as localAi.exec in .eventmodelers/config.json');
  }
  const { command, registered: mcpRegistered } = registerMcp(rawCommand, projectDir, cfg.baseUrl, log);
  const timeoutMs = turnTimeoutMs(cfg);
  const promptDir = mkdtempSync(join(tmpdir(), 'modeling-exec-'));
  const env = {
    ...process.env,
    // What the skills' curl fallback and an MCP registration reading ${EVENTMODELERS_TOKEN}
    // authenticate with, and what attributes the agent's board writes to this agent.
    EVENTMODELERS_TOKEN: cfg.token,
    ...(cfg.agentId ? { EVENTMODELERS_AGENT_ID: cfg.agentId } : {}),
  };

  function runTurn(text) {
    return new Promise((resolveTurn, rejectTurn) => {
      const promptFile = join(promptDir, 'prompt.md');
      writeFileSync(promptFile, text);
      const startedAt = Date.now();
      // stdin ignored: some harnesses append a piped stdin to the prompt, and nobody is there to
      // type into it. stdout is echoed as it comes — the harness owns its output format, there is
      // no cross-harness stream to condense — and kept as the turn's result.
      const proc = spawn(`${command} ${shellQuote(text)}`, {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'inherit'],
        shell: true,
        env: { ...env, RALPH_PROMPT_FILE: promptFile },
      });
      const turn = superviseTurn(proc, { timeoutMs, label: 'exec turn', viaShell: true, log });
      let out = '';
      proc.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        out += chunk.toString();
      });
      proc.on('close', (code) => {
        const timeout = turn.timeoutError();
        if (timeout) return rejectTurn(timeout);
        if (code !== 0) return rejectTurn(new Error(`exec command exited ${code}`));
        log(`done (${Date.now() - startedAt}ms)`);
        resolveTurn(out.trim());
      });
      proc.on('error', rejectTurn);
    });
  }

  return {
    runTurn,
    // Nothing to warm: every turn is its own process.
    warmUp: async () => {},
    describe: () => rawCommand,
    mcpRegistered,
  };
}
