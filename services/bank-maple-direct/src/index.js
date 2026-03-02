const { createFdxServer } = require('@financial-os/shared');
const productCatalog = require('./product-catalog');

const PORT = process.env.PORT || 3001;

const { app, start } = createFdxServer({
  institutionId: 'maple-direct',
  institutionName: 'Maple Direct',
  port: PORT,
  productCatalog,
});

if (require.main === module) {
  start();
}

module.exports = { app };
