// The entry `mastra dev` loads for `eventmodelers studio`: the modeling agent from lib/modeling-mastra.js, registered on a
// Mastra instance so Studio (localhost:4111) can chat with it, show its tool calls and traces. Everything arrives in the
// environment `eventmodelers studio` sets up — this file is not meant to be run by hand.
import { Mastra } from '@mastra/core';
// @ts-ignore — plain JS, shared with the runners
import { createModelingMastraAgent } from '../modeling-mastra.js';

const env = process.env;
const { agent } = await createModelingMastraAgent({
  cfg: { baseUrl: env.EVENTMODELERS_BASE_URL, token: env.EVENTMODELERS_TOKEN, agentId: env.EVENTMODELERS_AGENT_ID, organizationId: env.EVENTMODELERS_ORG_ID, boardId: env.EVENTMODELERS_BOARD_ID },
  model: env.EVENTMODELERS_STUDIO_MODEL,
  projectDir: env.EVENTMODELERS_STUDIO_CWD || process.cwd(),
});

export const mastra = new Mastra({
  agents: { eventmodelers: agent },
  server: { port: Number(env.EVENTMODELERS_STUDIO_PORT) || 4111 },
});
