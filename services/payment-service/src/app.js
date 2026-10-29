const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const config = require('./config');
const db = require('./db');
const routes = require('./routes');
const { correlationId, requestLogger, notFound, errorHandler } = require('./middleware');

const openapiText = fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (req, res) => {
    const database = (await db.isHealthy()) ? 'UP' : 'DOWN';
    const status = database === 'UP' ? 'UP' : 'DOWN';
    res.status(status === 'UP' ? 200 : 503).json({ status, service: config.serviceName, checks: { database } });
  });

  app.get('/openapi.yaml', (req, res) => res.type('text/yaml').send(openapiText));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(YAML.parse(openapiText)));
  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
