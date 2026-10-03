FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
RUN apt-get update && apt-get install --no-install-recommends -y ripgrep=13.0.0-4+b2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY prompts ./prompts
RUN npm run build
USER node
ENTRYPOINT ["node", "dist/src/cli.js"]
