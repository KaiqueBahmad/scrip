import { ConsoleLogger, type LoggerService } from '@nestjs/common';

/**
 * Minimal structural logger so domain code does not depend on Nest or Fastify.
 */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Bridges the structured calls used by the domain to Nest's logger API. */
export class NestLoggerAdapter implements LoggerService, Logger {
  // ConsoleLogger writes directly. Nest's Logger facade delegates to the
  // globally configured logger, which would recurse once this adapter is
  // registered as that logger.
  private readonly logger = new ConsoleLogger('PseudoPay');

  log(message: unknown, context?: string): void {
    this.logger.log(this.format(message), context);
  }

  info(obj: unknown, msg?: string): void {
    this.logger.log(this.format(obj, msg));
  }

  warn(obj: unknown, msg?: string): void {
    this.logger.warn(this.format(obj, msg));
  }

  error(obj: unknown, msg?: string): void {
    this.logger.error(this.format(obj, msg));
  }

  debug(obj: unknown, msg?: string): void {
    this.logger.debug(this.format(obj, msg));
  }

  private format(value: unknown, message?: string): string {
    const details = typeof value === 'string' ? value : JSON.stringify(value, errorReplacer);
    return message && details ? `${message} ${details}` : (details ?? message ?? '');
  }
}

function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}
