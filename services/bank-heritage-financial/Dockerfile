FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY shared/package.json ./shared/
COPY bank-heritage-financial/package.json ./bank-heritage-financial/

COPY shared/src/ ./shared/src/

RUN npm install -w bank-heritage-financial --omit=dev

COPY bank-heritage-financial/src/ ./bank-heritage-financial/src/

EXPOSE 3002
WORKDIR /app/bank-heritage-financial
CMD ["node", "src/index.js"]
