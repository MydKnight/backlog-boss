# Stage 1: Build React app
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src/ ./src/
COPY vite.config.js ./
COPY index.html ./

RUN npm run build

# Stage 2: Production server (lean — no dev deps, no build tools)
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/server/ ./src/server/
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "src/server/index.js"]
