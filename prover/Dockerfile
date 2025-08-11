FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --project tsconfig.json

FROM node:20-alpine
WORKDIR /app

COPY cache/ ./cache/

ENV NODE_ENV=development

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENTRYPOINT ["sh", "-c", "node dist/src/worker/$WORKER.js"]
