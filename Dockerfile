# Minimal Alpine runtime for openai-proxy-server.
# The package has zero runtime dependencies, so a plain node:alpine + source is all it takes.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY bin ./bin
COPY src ./src
COPY .env.example README.md LICENSE ./

# Runtime only needs the node binary (no external deps, no npm scripts) -
# drop npm/npx/corepack/yarn and their docs to shrink the image.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /usr/local/bin/corepack \
      /opt/yarn-* \
  && mkdir -p .openai-proxy-server && chown -R node:node /app
USER node

ENV HOST=0.0.0.0
ENV PORT=56787

EXPOSE 56787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:56787/_proxy/ >/dev/null 2>&1 || exit 1

CMD ["node", "bin/openai-proxy-server.js"]