FROM node:24.12.0-bookworm-slim

ARG CODEX_VERSION=0.154.0-alpha.6.2
ARG CLAUDE_VERSION=2.1.263
ARG TRACE_VERSION=3.25.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_VERSION} @anthropic-ai/claude-code@${CLAUDE_VERSION} trace-mcp@${TRACE_VERSION} \
    && npm cache clean --force

USER 1000:1000
WORKDIR /runtime
