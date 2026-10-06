# API para o docker compose (ambiente local). A imagem de produção da AWS vem na Fase 5.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY api/prisma api/prisma
RUN npm ci -w api && npm cache clean --force
COPY api api
# Roda sem ser root
USER node
WORKDIR /app/api
ENV API_HOST=0.0.0.0
EXPOSE 3000
CMD ["npx", "tsx", "src/servidor.ts"]
