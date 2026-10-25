# IRON · servidor próprio. Contexto de build = raiz do repositório (veja o docker-compose.yml)
FROM node:22-alpine
WORKDIR /app
COPY selfhost/package.json selfhost/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY selfhost/server.js ./
# o próprio app (PWA) é servido pelo mesmo servidor, assim a passkey funciona no mesmo endereço
COPY index.html sw.js manifest.json icon-192.png icon-512.png ./public/
COPY img ./public/img
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data PUBLIC_DIR=/app/public
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
USER node
CMD ["node", "server.js"]
