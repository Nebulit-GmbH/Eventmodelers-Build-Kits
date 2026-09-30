# Build agent for the node stack, driven by Claude Code: takes Planned slices from the board and builds them into /workspace.
#
#   docker build -f docker/build-with-claude-node/Dockerfile -t nebulit/em-studio-buildkit-claude-node .
#   docker run --rm -v "$PWD:/workspace" \
#     -e EVENTMODELERS_TOKEN=... -e EVENTMODELERS_ORGANIZATION_ID=... -e EVENTMODELERS_BOARD_ID=... \
#     nebulit/em-studio-buildkit-claude-node --model claude-sonnet-5-5
#
# /workspace is the project — mount your git checkout there, the code is built into it. The stack's
# build kit is installed on first start when the checkout has none (STACK, default node).
# Builds the node-based stacks: STACK=node (default) or STACK=supabase (-e STACK=supabase). The Java
# stacks (axon, opencqrs, umadb) have their own image, docker/build-with-<agent>-java; cratis needs .NET.
#
# Build context is eventmodelers-cli/ — the image runs the CLI from this checkout, not from npm.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Claude Code from npm. The CLI spawns `claude` from PATH with --dangerously-skip-permissions, which
# Claude Code refuses as root — hence USER node below.
RUN npm install -g @anthropic-ai/claude-code && claude --version

WORKDIR /opt/eventmodelers-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY cli.js ./
COPY lib ./lib
COPY shared ./shared
COPY stacks ./stacks
RUN npm link

COPY docker/build-with-opencode-node/entrypoint.sh /usr/local/bin/build-agent-entrypoint
RUN chmod +x /usr/local/bin/build-agent-entrypoint \
 && mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace

ENV EVENTMODELERS_NO_UPDATE_CHECK=1 STACK=node AGENT=claude

# No credential is baked in; they arrive through the environment (EVENTMODELERS_TOKEN,
# _ORGANIZATION_ID, _BOARD_ID, and _BASE_URL for a self-hosted platform), plus ANTHROPIC_API_KEY
# or CLAUDE_CODE_OAUTH_TOKEN for Claude. Extra args are passed to `run`, e.g. `--model claude-sonnet-5-5`.
ENTRYPOINT ["build-agent-entrypoint"]
