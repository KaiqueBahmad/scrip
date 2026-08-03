import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { Auth, type ApiAuth } from '../../auth/context';
import { ApiGuard } from '../../auth/api.guard';
import { ChargeService } from '../../service/charges.service';
import { MerchantService } from '../../service/merchants.service';
import { RefundService } from '../../service/refunds.service';
import {
  serializeCharge,
  serializeChargeEvent,
  serializeMerchant,
  serializeRefund,
} from '../../service/serialize.service';
import {
  chargeFilters,
  toMerchantUpdate,
  type ChargeQuery,
  type CreateChargeBody,
  type CreateRefundBody,
  type UpdateMerchantBody,
} from '../../dto';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * API surface, called by the merchant's own backend with a JWT.
 */
@Controller('v1/api')
@UseGuards(ApiGuard)
export class ApiController {
  constructor(
    private readonly charges: ChargeService,
    private readonly refunds: RefundService,
    private readonly merchants: MerchantService,
  ) {}

  // ------------------------------------------------------------------ charges

  /** Replays instead of charging twice when an Idempotency-Key repeats — see the interceptor. */
  @Post('pix/charges')
  @UseInterceptors(IdempotencyInterceptor)
  createCharge(@Auth() auth: ApiAuth, @Body() body: CreateChargeBody = {}) {
    return serializeCharge(
      this.charges.create({
        merchantId: auth.merchantId,
        amount: body.amount as number,
        payerDocument: body.payer_document ?? null,
        payerName: body.payer_name ?? null,
        description: body.description ?? null,
        metadata: body.metadata ?? null,
      }),
    );
  }

  @Get('pix/charges')
  listCharges(@Auth() auth: ApiAuth, @Query() query: ChargeQuery = {}) {
    return {
      object: 'list',
      data: this.charges.list(chargeFilters(auth.merchantId, query)).map(serializeCharge),
      total: this.charges.count({
        merchantId: auth.merchantId,
        ...(query.status ? { status: query.status } : {}),
      }),
    };
  }

  @Get('pix/charges/:id')
  getCharge(@Auth() auth: ApiAuth, @Param('id') id: string) {
    return serializeCharge(this.charges.get(id, { merchantId: auth.merchantId }));
  }

  @Get('pix/charges/:id/events')
  listChargeEvents(@Auth() auth: ApiAuth, @Param('id') id: string) {
    const charge = this.charges.get(id, { merchantId: auth.merchantId });

    return {
      object: 'list',
      data: this.charges.listEvents(charge.id).map(serializeChargeEvent),
    };
  }

  @Post('pix/charges/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelCharge(@Auth() auth: ApiAuth, @Param('id') id: string) {
    return serializeCharge(this.charges.cancel(id, { merchantId: auth.merchantId }));
  }

  // ------------------------------------------------------------------ refunds

  @Post('pix/charges/:id/refunds')
  createRefund(
    @Auth() auth: ApiAuth,
    @Param('id') id: string,
    @Body() body: CreateRefundBody = {},
  ) {
    return serializeRefund(
      this.refunds.create({
        chargeId: id,
        merchantId: auth.merchantId,
        amount: body.amount ?? null,
        reason: body.reason ?? null,
      }),
    );
  }

  @Get('pix/charges/:id/refunds')
  listRefunds(@Auth() auth: ApiAuth, @Param('id') id: string) {
    return {
      object: 'list',
      data: this.refunds.list(id, { merchantId: auth.merchantId }).map(serializeRefund),
    };
  }

  // ----------------------------------------------------------------- merchant

  /**
   * The secret is included here because the caller is the merchant's own backend and needs
   * it to verify webhook signatures.
   */
  @Get('merchants/me')
  getMerchant(@Auth() auth: ApiAuth) {
    return serializeMerchant(this.merchants.get(auth.merchantId), true);
  }

  @Patch('merchants/me')
  updateMerchant(@Auth() auth: ApiAuth, @Body() body: UpdateMerchantBody = {}) {
    return serializeMerchant(this.merchants.update(auth.merchantId, toMerchantUpdate(body)), true);
  }
}
