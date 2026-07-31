import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
const app = await buildServer();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });

  app.log.info(
    {
      panel: `http://${config.host}:${config.port}`,
      api: `http://${config.host}:${config.port}/v1`,
      database: config.databasePath,
    },
    'pseudopay is up',
  );
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
