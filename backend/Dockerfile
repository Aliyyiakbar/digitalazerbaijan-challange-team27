FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx işləmə zamanı lazımdır (TypeScript birbaşa işə salınır), ona görə dev asılılıqları da quraşdırılır
RUN npm ci --include=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=12 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--import", "tsx", "src/server.ts"]
