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
 && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils libatomic1 \
 && rm -rf /var/lib/apt/lists/*

# All agent CLIs; AGENT (claude, opencode, codex, gemini or hermes) picks the one that runs.
# Claude Code refuses --dangerously-skip-permissions as root, hence USER node below.
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli && claude --version && codex --version && gemini --version
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

# Hermes Agent (Nous Research) installs per user into ~/.hermes, so it runs as node. The installer also
# fetches Chromium and ffmpeg (~0.9 GB) for browser and media tools; headless board work needs neither.
# Its MCP servers live in ~/.hermes/config.yaml (there is no project-level file), so the eventmodelers
# server is written there with env references only: nothing secret is baked in.
RUN curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash \
 && rm -rf /home/node/.hermes/tools/chromium-* /home/node/.hermes/tools/ffmpeg-* \
 && printf 'mcp_servers:\n  eventmodelers:\n    url: "${EVENTMODELERS_BASE_URL}/mcp"\n    headers:\n      x-token: "${EVENTMODELERS_TOKEN}"\n' >> /home/node/.hermes/config.yaml \
 && /home/node/.local/bin/hermes --version
ENV PATH=/home/node/.local/bin:$PATH

# The container is the sandbox: Codex runs without its own (see resolveAgentPreset in cli.js).
ENV EVENTMODELERS_CODEX_NO_SANDBOX=1 EVENTMODELERS_NO_UPDATE_CHECK=1 STACK=node

# No credential is baked in; they arrive through the environment (EVENTMODELERS_TOKEN,
# _ORGANIZATION_ID, _BOARD_ID, and _BASE_URL for a self-hosted platform), plus whatever key the
# chosen OpenCode model needs. Extra args are passed to `run`, e.g. `--model claude-sonnet-5-5`.
ENTRYPOINT ["build-agent-entrypoint"]
