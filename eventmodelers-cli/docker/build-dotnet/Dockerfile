# Build agent for the community .NET kit (cratis-csharp), driven by Claude Code, OpenCode or Codex (AGENT): takes Planned slices from the board and builds them into /workspace.
#
#   docker build -f docker/build-dotnet/Dockerfile -t nebulit/em-studio-buildkit-dotnet .
#   docker run --rm -v "$PWD:/workspace" -e AGENT=claude -e STACK=cratis-csharp -e KIT_GIT=https://github.com/Cratis/Eventmodelers-Build-Kit-CSharp \
#     -e EVENTMODELERS_TOKEN=... -e EVENTMODELERS_ORGANIZATION_ID=... -e EVENTMODELERS_BOARD_ID=... \
#     nebulit/em-studio-buildkit-dotnet --model claude-sonnet-5-5
#
# STACK names the community kit and KIT_GIT is its repo (cratis-csharp by default). /workspace is the project —
# mount your git checkout there, the code is built into it. The kit is installed on first start when the
# checkout has none. The SDK is .NET 10, which the kit targets.
#
# The kit's tests may use Testcontainers, which needs a Docker daemon: add
# `-v /var/run/docker.sock:/var/run/docker.sock` (and a matching group) to run them in this image.
#
# Build context is eventmodelers-cli/ — the image runs the CLI from this checkout, not from npm.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS dotnet

FROM node:22-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils libatomic1 libicu76 libssl3t64 zlib1g \
 && rm -rf /var/lib/apt/lists/*

# Same Debian release as the .NET 10 SDK image (trixie, hence node:22-trixie-slim), so the SDK copied from the Microsoft image runs as is.
COPY --from=dotnet /usr/share/dotnet /usr/share/dotnet
RUN ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet
ENV DOTNET_ROOT=/usr/share/dotnet DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1

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

# Same entrypoint as the node image: git identity, git init, kit install, then `run --agent $AGENT`.
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
ENV EVENTMODELERS_CODEX_NO_SANDBOX=1 EVENTMODELERS_NO_UPDATE_CHECK=1 STACK=cratis-csharp KIT_GIT=https://github.com/Cratis/Eventmodelers-Build-Kit-CSharp

# No credential is baked in; they arrive through the environment (EVENTMODELERS_TOKEN,
# _ORGANIZATION_ID, _BOARD_ID, and _BASE_URL for a self-hosted platform), plus whatever key the
# chosen OpenCode model needs. Extra args are passed to `run`, e.g. `--model claude-sonnet-5-5`.
ENTRYPOINT ["build-agent-entrypoint"]
