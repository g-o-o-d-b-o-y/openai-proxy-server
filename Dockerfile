# Minimal Alpine runtime for openai-proxy-server.
# The package has zero runtime dependencies, so a plain node:alpine + source is all it takes.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY bin ./bin
COPY src ./src
COPY .env.example README.md LICENSE ./

# Default STATS_FILE is ./.openai-proxy-server/stats.json - keep it writable for the
# non-root user (secrets never baked in; pass OPENAI_*/TTS_*/STT_*/LIMITS via -e or a mounted .env).
RUN mkdir -p .openai-proxy-server && chown -R node:node /app
USER node

ENV HOST=0.0.0.0
ENV PORT=56787

EXPOSE 56787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:56787/_proxy/ >/dev/null 2>&1 || exit 1

CMD ["node", "bin/openai-proxy-server.js"]