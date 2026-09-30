# Modeling agent driven by Claude Code.
#
#   docker build -f docker/claude/Dockerfile -t eventmodelers-agent-claude .
#   docker run --rm \
#     -e EVENTMODELERS_TOKEN=... -e EVENTMODELERS_ORGANIZATION_ID=... -e EVENTMODELERS_BOARD_ID=... \
#     -e ANTHROPIC_API_KEY=... \
#     eventmodelers-agent-claude
#
# Build context is eventmodelers-cli/ — the image runs the CLI from this checkout, not from npm.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The CLI spawns `claude` from PATH (--dangerously-skip-permissions, which Claude Code refuses as root — hence USER node below).
RUN npm install -g @anthropic-ai/claude-code && claude --version

WORKDIR /opt/eventmodelers-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY cli.js ./
COPY lib ./lib
COPY shared ./shared
COPY stacks ./stacks
RUN npm link

# The agent works against the board over MCP/REST; /workspace only holds the modeling kit and its skills.
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
# init asks where credentials come from; 4 = skip, they arrive through the environment at run time.
# It also installs the skills into .claude/skills, which Claude Code reads directly.
RUN printf '4\n' | eventmodelers init --modeling

ENV EVENTMODELERS_NO_UPDATE_CHECK=1

# No credential is ever baked in: init skips it, and nothing in the build context carries one
# (.dockerignore, plus COPY of named paths only). Pass them with `docker run --env-file`.
# Board access: EVENTMODELERS_TOKEN, _ORGANIZATION_ID, _BOARD_ID (and _BASE_URL for a self-hosted platform).
# Claude auth: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN. Extra args are passed to `run`, e.g. `--worker`.
ENTRYPOINT ["eventmodelers", "run", "--standalone", "--agent", "claude", "--non-interactive"]
