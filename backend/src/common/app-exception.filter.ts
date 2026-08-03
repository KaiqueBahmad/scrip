import {
  Catch,
  HttpException,
  Inject,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../lib/errors';
import type { Logger } from '../lib/logger';
import { LOGGER } from './injection-tokens';

/**
 * The single place a failure becomes a response, so both surfaces (/v1/api and
 * /v1/panel) serialize identically:
 *
 *   { "error": { "code": "invalid_state_transition", "message": "...", "details": {...} } }
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly log: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (exception instanceof AppError) {
      this.log.debug({ err: exception, code: exception.code }, 'request rejected');
      void reply.status(exception.statusCode).send(exception.toJSON());
      return;
    }

    if (exception instanceof NotFoundException) {
      void reply.status(404).send({
        error: {
          code: 'not_found',
          message: `Route ${request.method} ${request.url} not found`,
        },
      });
      return;
    }

    const { status, code, message } = describe(exception);

    if (status >= 500) {
      this.log.error({ err: exception }, 'unhandled error');
      void reply.status(status).send({
        error: { code: 'internal_error', message: 'Something went wrong on the Scrip side' },
      });
      return;
    }

    void reply.status(status).send({ error: { code, message } });
  }

}

/**
 * Anything that is not an AppError: Nest's own HttpExceptions, and the errors Fastify
 * plugins raise directly (a multipart body over the hard size ceiling, for one).
 */
function describe(exception: unknown): { status: number; code: string; message: string } {
  if (exception instanceof HttpException) {
    return {
      status: exception.getStatus(),
      code: 'request_failed',
      message: exception.message,
    };
  }

  const error = exception as { statusCode?: number; code?: string; message?: string };

  return {
    status: typeof error.statusCode === 'number' ? error.statusCode : 500,
    code: error.code ?? 'request_failed',
    message: error.message ?? 'Request failed',
  };
}
