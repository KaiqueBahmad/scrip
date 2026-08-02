import 'reflect-metadata';

import { createApp } from './app';
import { loadConfig } from './config';
import type { Logger } from './lib/logger';
import { LOGGER } from './tokens';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await createApp();
  const log = app.get<Logger>(LOGGER);

  // Closes the app — and with it the scheduler's timers and the database — on SIGINT/SIGTERM.
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
