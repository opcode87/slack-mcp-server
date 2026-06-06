FROM node:20-slim AS builder

# Install build dependencies including Python
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package*.json ./

EXPOSE 3000
CMD ["npm", "start"]
