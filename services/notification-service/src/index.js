const config = require('./config');
const log = require('./logger');
const db = require('./db');
const consumer = require('./consumer');
const { createApp } = require('./app');

async function main() {
  await db.waitForDatabase();
  await db.migrate();
  consumer.connect(); // not awaited: HTTP must work even if the broker is down
  const server = createApp().listen(config.port, () => log.info('service started', { port: config.port }));

  const shutdown = (signal) => {
    log.info('shutting down', { signal });
    server.close(async () => {
      await consumer.close();
      await db.pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('startup failed', { error: err.message });
  process.exit(1);
});
