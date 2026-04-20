FROM node:22-slim

# Install AI provider CLIs
RUN npm install -g @google/gemini-cli @anthropic-ai/claude-code

WORKDIR /app

# Only the pre-built bundle is needed — no node_modules at runtime
COPY dist/linter.mjs ./dist/linter.mjs

EXPOSE 3000

ENV AGENT_PORT=3000
ENV AGENT_PROVIDER=gemini
# ENV AGENT_API_KEY=   (required — set at deploy time)
# ENV AGENT_MODEL=     (optional — e.g. gemini-2.0-flash)
# ENV AGENT_HOST=      (optional — default 127.0.0.1; set 0.0.0.0 to bind all interfaces)

CMD ["node", "dist/linter.mjs", "--server"]
