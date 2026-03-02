FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY shared/package.json ./shared/
COPY bank-frontier-business/package.json ./bank-frontier-business/

COPY shared/src/ ./shared/src/

RUN npm install -w bank-frontier-business --omit=dev

COPY bank-frontier-business/src/ ./bank-frontier-business/src/

EXPOSE 3003
WORKDIR /app/bank-frontier-business
CMD ["node", "src/index.js"]
