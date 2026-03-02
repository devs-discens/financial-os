FROM node:20-alpine
WORKDIR /app

# Copy all package.jsons first for layer caching
COPY package.json ./
COPY shared/package.json ./shared/
COPY bank-maple-direct/package.json ./bank-maple-direct/
COPY bank-heritage-financial/package.json ./bank-heritage-financial/
COPY bank-frontier-business/package.json ./bank-frontier-business/
COPY registry/package.json ./registry/

# Install all workspace dependencies
RUN npm install --omit=dev

# Copy all source
COPY shared/src/ ./shared/src/
COPY bank-maple-direct/src/ ./bank-maple-direct/src/
COPY bank-heritage-financial/src/ ./bank-heritage-financial/src/
COPY bank-frontier-business/src/ ./bank-frontier-business/src/
COPY registry/src/ ./registry/src/
