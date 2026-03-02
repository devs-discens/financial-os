const { createFdxServer } = require('@financial-os/shared');
const productCatalog = require('./product-catalog');

const PORT = process.env.PORT || 3002;

const { app, start } = createFdxServer({
  institutionId: 'heritage-financial',
  institutionName: 'Heritage Financial',
  port: PORT,
  mfaRequired: true,
  productCatalog,
  setupMiddleware(app) {
    // Slow response middleware (500-2000ms delay) for all FDX routes
    app.use('/fdx', (req, res, next) => {
      const delay = 500 + Math.random() * 1500;
      setTimeout(next, delay);
    });
  },
});

if (require.main === module) {
  start();
}

module.exports = { app };
