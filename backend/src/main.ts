import 'reflect-metadata';

import { createApp } from './app';
import { LOGGER } from './common/injection-tokens';
import { loadConfig } from './config';
import type { Logger } from './lib/logger';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await createApp();
  const log = app.get<Logger>(LOGGER);

  // On SIGINT/SIGTERM closes the app, with its scheduler's, timers and database.
  app.enableShutdownHooks();

  try {
    await app.listen(config.port, config.host);

    log.info(
      {
        panel: `http://${config.host}:${config.port}`,
        api: `http://${config.host}:${config.port}/v1`,
        database: config.databasePath,
      },
      'pseudopay is up',
    );
  } catch (err) {
    log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

void bootstrap();
