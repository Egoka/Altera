FROM node:24.12.0-bookworm-slim

ARG CODEX_VERSION=0.154.0-alpha.6.2
ARG CLAUDE_VERSION=2.1.263
ARG TRACE_VERSION=3.25.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_VERSION} @anthropic-ai/claude-code@${CLAUDE_VERSION} trace-mcp@${TRACE_VERSION} \
    && npm cache clean --force

COPY playwright-mcp/package.json playwright-mcp/package-lock.json /opt/playwright-mcp/
RUN cd /opt/playwright-mcp \
    && npm ci --omit=dev --ignore-scripts \
    && /usr/local/bin/node /opt/playwright-mcp/node_modules/playwright-core/cli.js install-deps chromium \
    && PLAYWRIGHT_BROWSERS_PATH=/ms-playwright /usr/local/bin/node /opt/playwright-mcp/node_modules/playwright-core/cli.js install chromium --only-shell \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

RUN chmod -R a+rX /ms-playwright

USER 1000:1000
WORKDIR /runtime
