# Build agent for the node stack, driven by Claude Code, OpenCode or Codex (AGENT): takes Planned slices from the board and builds them into /workspace.
#
#   docker build -f docker/build-node/Dockerfile -t nebulit/em-studio-buildkit-node .
#   docker run --rm -v "$PWD:/workspace" \
#     -e EVENTMODELERS_TOKEN=... -e EVENTMODELERS_ORGANIZATION_ID=... -e EVENTMODELERS_BOARD_ID=... \
#     nebulit/em-studio-buildkit-node --model claude-sonnet-5-5
#
# /workspace is the project — mount your git checkout there, the code is built into it. The stack's
# build kit is installed on first start when the checkout has none (STACK, default node).
# Builds the node-based stacks: STACK=node (default) or STACK=supabase (-e AGENT=claude -e STACK=supabase). The Java
# stacks (axon, opencqrs, umadb) have their own image, docker/build-java; cratis needs .NET.
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

COPY docker/entrypoint-build.sh /usr/local/bin/build-agent-entrypoint
RUN chmod +x /usr/local/bin/build-agent-entrypoint \
 && mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace

# The container is the sandbox: Codex runs without its own (see resolveAgentPreset in cli.js).
ENV EVENTMODELERS_CODEX_NO_SANDBOX=1 EVENTMODELERS_NO_UPDATE_CHECK=1 STACK=node

# No credential is baked in; they arrive through the environment (EVENTMODELERS_TOKEN,
# _ORGANIZATION_ID, _BOARD_ID, and _BASE_URL for a self-hosted platform), plus whatever key the
# chosen OpenCode model needs. Extra args are passed to `run`, e.g. `--model claude-sonnet-5-5`.
ENTRYPOINT ["build-agent-entrypoint"]
