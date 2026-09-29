# Modeling agent driven by OpenCode.
#
#   docker build -f docker/opencode/Dockerfile -t eventmodelers-agent-opencode .
#   docker run --rm \
#     -e EVENTMODELERS_TOKEN=... -e EVENTMODELERS_ORGANIZATION_ID=... -e EVENTMODELERS_BOARD_ID=... \
#     -e OPENCODE_API_KEY=... \
#     eventmodelers-agent-opencode
#
# Build context is eventmodelers-cli/ — the image runs the CLI from this checkout, not from npm.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

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
# the skills exposed to OpenCode.
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
# init asks where credentials come from; 4 = skip, they arrive through the environment at run time.
RUN printf '4\n' | eventmodelers init --modeling && eventmodelers init-agents --hosts opencode

ENV EVENTMODELERS_NO_UPDATE_CHECK=1

# No credential is ever baked in: init skips it, and nothing in the build context carries one
# (.dockerignore, plus COPY of named paths only). Pass them with `docker run --env-file`.
# Credentials come from the environment (EVENTMODELERS_TOKEN, _ORGANIZATION_ID, _BOARD_ID, and
# _BASE_URL for a self-hosted platform); OpenCode's model provider key is whatever the chosen
# model needs. Extra args are passed to `run`, e.g. `--model opencode/big-pickle` or `--worker`.
ENTRYPOINT ["eventmodelers", "run", "--standalone", "--agent", "opencode", "--non-interactive"]
