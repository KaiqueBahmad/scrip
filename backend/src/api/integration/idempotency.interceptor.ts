import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { of, tap, type Observable } from 'rxjs';

import { IdempotencyStore, type IdempotencyLookup } from '../../service/idempotency.service';

/**
 * Idempotency-Key handling for the routes it is applied to. A repeated key
 * with the same body replays the stored response instead of reaching the handler; a
 * repeated key with a different body is rejected inside IdempotencyStore.find.
 *
 * A request with no key passes straight through, which is why this can sit on the route
 * rather than being branched on inside it.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly store: IdempotencyStore,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const lookup = this.lookupFor(request);

    if (!lookup) return next.handle();

    const replayed = this.store.find(lookup);

    if (replayed) {
      // No status is forced here: a replay answers the same route as the original, so the
      // status Nest applies is already the stored one.
      void http.getResponse<FastifyReply>().header('idempotent-replay', 'true');
      return of(replayed.body);
    }

    const status = this.statusOf(context);

    return next.handle().pipe(tap((body) => this.store.store(lookup, { status, body })));
  }

  private lookupFor(request: FastifyRequest): IdempotencyLookup | undefined {
    const header = request.headers['idempotency-key'];
    const key = typeof header === 'string' ? header.trim() : '';

    // The credential is what scopes a key, so an unauthenticated request has nothing to
    // replay against.
    if (!key || !request.integration) return undefined;

    return {
      key,
      merchantId: request.integration.merchantId,
      endpoint: `${request.method} ${request.routeOptions.url}`,
      requestBody: request.body ?? {},
    };
  }

  /** What Nest will answer with: an explicit @HttpCode, or the verb's default. */
  private statusOf(context: ExecutionContext): number {
    const explicit = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );

    if (explicit) return explicit;

    return context.switchToHttp().getRequest<FastifyRequest>().method === 'POST' ? 201 : 200;
  }
}
