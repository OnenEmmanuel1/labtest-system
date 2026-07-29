# ── Build stage ───────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Production stage ──────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

# Don't run as root
RUN addgroup -g 1001 -S labtm && \
    adduser  -u 1001 -S labtm -G labtm && \
    chown -R labtm:labtm /app

USER labtm

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "app.js"]
