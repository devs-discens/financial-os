const { createFdxServer } = require('@financial-os/shared');
const productCatalog = require('./product-catalog');

const PORT = process.env.PORT || 3003;

const { app, start } = createFdxServer({
  institutionId: 'frontier-business',
  institutionName: 'Frontier Business Banking',
  port: PORT,
  productCatalog,
});

if (require.main === module) {
  start();
}

module.exports = { app };
