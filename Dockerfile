# Static frontend served by nginx. No build step — the app is plain ES modules.
FROM nginx:1.27-alpine

# Custom server config (gzip, caching, /api reverse-proxy to the backend).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Only the runtime static assets (keeps the image small; backend stays out).
COPY index.html app.js logic.js data.js config.js styles.css pola.svg /usr/share/nginx/html/
COPY admin.html admin.js admin.css /usr/share/nginx/html/
COPY vendor /usr/share/nginx/html/vendor

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
