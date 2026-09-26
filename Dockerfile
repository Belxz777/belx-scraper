FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3200

EXPOSE 3200

CMD ["bun","run","start"]