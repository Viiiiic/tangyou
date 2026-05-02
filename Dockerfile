FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY assets ./assets
COPY app.js index.html server.js styles.css ./

RUN mkdir -p /app/storage/tts && chown -R node:node /app/storage

USER node
EXPOSE 4173

CMD ["npm", "start"]
