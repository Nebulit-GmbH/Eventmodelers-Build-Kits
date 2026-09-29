# Build agent for the node stack, driven by OpenCode: takes Planned slices from the board and builds them into /workspace.
#
#   docker build -f docker/build-with-node/Dockerfile -t nebulit/em-studio-buildkit-node .
#   docker run --rm -v "$PWD:/workspace" \
#     -e EVENTMODELERS_TOKEN=... -e EVENTMODELERS_ORGANIZATION_ID=... -e EVENTMODELERS_BOARD_ID=... \
#     nebulit/em-studio-buildkit-node --model opencode/big-pickle
#
# /workspace is the project — mount your git checkout there, the code is built into it. The stack's
# build kit is installed on first start when the checkout has none (STACK, default node).
# Only the node-based stacks build in this image; axon/cratis need their JDK/.NET toolchain added.
#
# Build context is eventmodelers-cli/ — the image runs the CLI from this checkout, not from npm.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai

WORKDIR /opt/eventmodelers-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY cli.js ./
COPY lib ./lib
COPY shared ./shared
COPY stacks ./stacks
RUN npm link

COPY docker/build-with-node/entrypoint.sh /usr/local/bin/build-agent-entrypoint
RUN chmod +x /usr/local/bin/build-agent-entrypoint \
 && mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace

ENV EVENTMODELERS_NO_UPDATE_CHECK=1 STACK=node

# No credential is baked in; they arrive through the environment (EVENTMODELERS_TOKEN,
# _ORGANIZATION_ID, _BOARD_ID, and _BASE_URL for a self-hosted platform), plus whatever key the
# chosen OpenCode model needs. Extra args are passed to `run`, e.g. `--model opencode/big-pickle`.
ENTRYPOINT ["build-agent-entrypoint"]
