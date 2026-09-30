# Modeling agent driven by Claude Code, OpenCode or Codex (AGENT, default claude).
#
#   docker build -f docker/agent/Dockerfile -t eventmodelers-agent .
#   docker run --rm \
#     -e EVENTMODELERS_TOKEN=... -e EVENTMODELERS_ORGANIZATION_ID=... -e EVENTMODELERS_BOARD_ID=... \
#     -e AGENT=claude -e ANTHROPIC_API_KEY=... \
#     eventmodelers-agent
#
# Build context is eventmodelers-cli/ — the image runs the CLI from this checkout, not from npm.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# All three agent CLIs; AGENT (claude, opencode or codex) picks the one that runs.
# Claude Code refuses --dangerously-skip-permissions as root, hence USER node below.
RUN npm install -g @anthropic-ai/claude-code @openai/codex && claude --version && codex --version
# OpenCode 2.x from its v2 installer, not npm or the v1 installer: `run --standalone` (which the CLI's
# opencode preset passes) doesn't exist in the 1.x line that both of those still ship.
RUN curl -fsSL https://opencode.ai/v2/install | bash -s -- --no-modify-path \
 && cp /root/.opencode/bin/opencode /usr/local/bin/opencode \
 && opencode run --help | grep -q -- --standalone

WORKDIR /opt/eventmodelers-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY cli.js ./
COPY lib ./lib
COPY shared ./shared
COPY stacks ./stacks
RUN npm link

# The agent works against the board over MCP/REST; /workspace only holds the modeling kit and
# the skills exposed to OpenCode and Codex.
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
# init asks where credentials come from; 4 = skip, they arrive through the environment at run time.
RUN printf '4\n' | eventmodelers init --modeling && eventmodelers init-agents --hosts opencode && eventmodelers init-agents --hosts codex

# The container is the sandbox: Codex runs without its own (see resolveAgentPreset in cli.js).
ENV EVENTMODELERS_CODEX_NO_SANDBOX=1 EVENTMODELERS_NO_UPDATE_CHECK=1 AGENT=claude

# No credential is ever baked in: init skips it, and nothing in the build context carries one
# (.dockerignore, plus COPY of named paths only). Pass them with `docker run --env-file`.
# Board access: EVENTMODELERS_TOKEN, _ORGANIZATION_ID, _BOARD_ID (and _BASE_URL for a self-hosted platform).
# Agent auth: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (claude), OPENAI_API_KEY (codex), or the key the
# chosen OpenCode model needs (opencode). Extra args are passed to `run`, e.g. `--model gpt-5-codex` or `--worker`.
COPY docker/entrypoint-agent.sh /usr/local/bin/agent-entrypoint
USER root
RUN chmod +x /usr/local/bin/agent-entrypoint
USER node
ENTRYPOINT ["agent-entrypoint"]
