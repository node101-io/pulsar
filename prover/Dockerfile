  FROM node:20-alpine AS build
  WORKDIR /app
  
  COPY package*.json ./
  RUN npm ci --include=dev
  
  COPY tsconfig.json ./
  COPY src ./src
  RUN npx tsc
  
  
  FROM node:20-alpine
  WORKDIR /app
  
  COPY package*.json ./
  RUN npm ci --omit=dev
  
  COPY --from=build /app/dist ./dist
  
  ENV NODE_ENV=production

  CMD ["node", "dist/src/nodeManager.js"]
  