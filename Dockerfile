FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY assets ./assets
RUN mkdir data && chown node:node data
USER node
ENV CALENDAR_DB=/app/data/calendar.sqlite
VOLUME ["/app/data"]
CMD ["node", "src/bot.js"]
