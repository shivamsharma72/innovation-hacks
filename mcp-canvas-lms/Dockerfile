FROM node:20.19-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:20.19-alpine AS runtime

LABEL org.opencontainers.image.title="canvas-mcp-server"
LABEL org.opencontainers.image.description="Model Context Protocol server for Canvas LMS"
LABEL org.opencontainers.image.source="https://github.com/DMontgomery40/mcp-canvas-lms"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV NODE_ENV=production
ENV MCP_TRANSPORT=stdio
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3000
ENV MCP_HTTP_PATH=/mcp
ENV MCP_HTTP_STATEFUL=true
ENV MCP_HTTP_JSON_RESPONSE=true
ENV MCP_HTTP_ALLOWED_ORIGINS=

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/build ./build

USER node
EXPOSE 3000

CMD ["node", "build/index.js"]
