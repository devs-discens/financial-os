FROM node:20-alpine
WORKDIR /app

# Copy workspace root package.json and all workspace package.jsons
COPY package.json ./
COPY shared/package.json ./shared/
COPY bank-maple-direct/package.json ./bank-maple-direct/

# Copy shared source
COPY shared/src/ ./shared/src/

# Install from workspace root
RUN npm install -w bank-maple-direct --omit=dev

# Copy bank source
COPY bank-maple-direct/src/ ./bank-maple-direct/src/

EXPOSE 3001
WORKDIR /app/bank-maple-direct
CMD ["node", "src/index.js"]
