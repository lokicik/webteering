# --- Build stage: compile server (tsc) and client (tsc + vite -> server/dist/public) ---
FROM node:20-alpine AS build
WORKDIR /app

COPY server/package*.json server/
COPY client/package*.json client/
COPY client/.npmrc client/
RUN npm ci --prefix server && npm ci --prefix client

COPY server server
COPY client client
RUN npm run build --prefix server
RUN npm run build --prefix client

# --- Runtime stage: production deps + compiled output only ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/server/dist ./dist

EXPOSE 3001
CMD ["node", "dist/server.js"]
