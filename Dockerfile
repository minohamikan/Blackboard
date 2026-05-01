FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY tools ./tools
RUN mkdir -p /app/document

ENV PORT=4173
ENV BLACKBOARD_PATH=/app/document/Blackboard.json

EXPOSE 4173

CMD ["node", "server.js"]
