# Backend API. Build context = repo root (needs ../data.js as the seed source).
#   docker build -f backend/Dockerfile -t liburan-jakarta-api .
FROM node:24-alpine
WORKDIR /app

# Install prod deps first for better layer caching.
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund

# Seed source (shared with the frontend) + server code.
COPY data.js ./data.js
COPY backend/src ./backend/src

WORKDIR /app/backend
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/backend/data/app.db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1
CMD ["node", "src/server.js"]
