FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY shared/package.json ./shared/
COPY registry/package.json ./registry/

COPY shared/src/ ./shared/src/

RUN npm install -w registry --omit=dev

COPY registry/src/ ./registry/src/

EXPOSE 3010
WORKDIR /app/registry
CMD ["node", "src/index.js"]
