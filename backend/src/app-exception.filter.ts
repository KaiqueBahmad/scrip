import {
  Catch,
  HttpException,
  Inject,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from './lib/errors';
import type { Logger } from './lib/logger';
import { NOT_BUILT_PAGE, readPanelShell } from './panel-ui';
import { LOGGER } from './tokens';

/**
 * The single place a failure becomes a response, so both surfaces (/v1/integration and
 * /v1/panel) serialize identically:
 *
 *   { "error": { "code": "invalid_state_transition", "message": "...", "details": {...} } }
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  /** Read once at startup: the panel build does not change while the process runs. */
  private readonly panelShell = readPanelShell();

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

    // The panel owns the root, so a client-side route like /transactions has to fall back to
    // its SPA shell. Only browser navigations get that: an API client asking for an unknown
    // path must see a JSON 404, not a 200 full of HTML it cannot parse.
    if (exception instanceof NotFoundException && this.wantsPanel(request)) {
      void (this.panelShell
        ? reply.type('text/html').send(this.panelShell)
        : reply.status(503).type('text/html').send(NOT_BUILT_PAGE));
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
        error: { code: 'internal_error', message: 'Something went wrong on the PseudoPay side' },
      });
      return;
    }

    void reply.status(status).send({ error: { code, message } });
  }

  private wantsPanel(request: FastifyRequest): boolean {
    return (
      request.method === 'GET' &&
      !request.url.startsWith('/v1/') &&
      (request.headers.accept?.includes('text/html') ?? false)
    );
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
