FROM node:22-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# Copy source and migrations
COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Build TypeScript
RUN npm run build

# Expose the service port
EXPOSE 3000

# Run migrations then start the server
CMD ["sh", "-c", "node --import tsx src/migrate.ts && node dist/server.js"]
