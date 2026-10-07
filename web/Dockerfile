# Site para o docker compose: build do Vite servido pelo nginx (sem root), que repassa /api para a API
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w web --ignore-scripts
COPY assets assets
COPY web web
RUN npm -w web run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/cabecalhos.inc /etc/nginx/conf.d/cabecalhos.inc
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
