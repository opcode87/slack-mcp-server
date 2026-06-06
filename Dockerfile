FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --build-from-source
COPY . .
RUN npx tsc

FROM node:20-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --production --build-from-source
COPY --from=builder /app/build ./build
ENV NODE_ENV=production
CMD ["node", "build/index.js"]
