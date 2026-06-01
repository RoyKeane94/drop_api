FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

COPY tsconfig.json ./
COPY src ./src/
COPY scripts ./scripts/

RUN npm run prisma:generate && npm run build

ENV NODE_ENV=production

CMD ["sh", "-c", "npm run migrate:deploy && npm start"]
