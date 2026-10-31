const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const config = require('./config');
const db = require('./db');
const consumer = require('./consumer');
const routes = require('./routes');
const { correlationId, requestLogger, notFound, errorHandler } = require('./middleware');

const openapiText = fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8');

// DOWN (503) only when the database is down. Broker down is DEGRADED (200): messages wait in the queue.
async function health(req, res) {
  const database = (await db.isHealthy()) ? 'UP' : 'DOWN';
  const broker = consumer.isConnected() ? 'UP' : 'DOWN';
  const status = database === 'DOWN' ? 'DOWN' : broker === 'DOWN' ? 'DEGRADED' : 'UP';
  res.status(status === 'DOWN' ? 503 : 200).json({ status, service: config.serviceName, checks: { database, broker } });
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', health);
  app.get('/openapi.yaml', (req, res) => res.type('text/yaml').send(openapiText));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(YAML.parse(openapiText)));
  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
