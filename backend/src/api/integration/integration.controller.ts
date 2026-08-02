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

import { Auth, type IntegrationAuth } from '../../auth/context';
import { IntegrationGuard } from '../../auth/integration.guard';
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
 * Integration API (specs.md:22), called by the merchant's own backend with a JWT. Kept in
 * its own controller from the panel API, because specs.md:21 asks for the surfaces to be
 * physically separated by route.
 */
@Controller('v1/integration')
@UseGuards(IntegrationGuard)
export class IntegrationController {
  constructor(
    private readonly charges: ChargeService,
    private readonly refunds: RefundService,
    private readonly merchants: MerchantService,
  ) {}

  // ------------------------------------------------------------------ charges

  /** Replays instead of charging twice when an Idempotency-Key repeats — see the interceptor. */
  @Post('pix/charges')
  @UseInterceptors(IdempotencyInterceptor)
  createCharge(@Auth() auth: IntegrationAuth, @Body() body: CreateChargeBody = {}) {
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
  listCharges(@Auth() auth: IntegrationAuth, @Query() query: ChargeQuery = {}) {
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
  getCharge(@Auth() auth: IntegrationAuth, @Param('id') id: string) {
    return serializeCharge(this.charges.get(id, { merchantId: auth.merchantId }));
  }

  @Get('pix/charges/:id/events')
  listChargeEvents(@Auth() auth: IntegrationAuth, @Param('id') id: string) {
    const charge = this.charges.get(id, { merchantId: auth.merchantId });

    return {
      object: 'list',
      data: this.charges.listEvents(charge.id).map(serializeChargeEvent),
    };
  }

  @Post('pix/charges/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelCharge(@Auth() auth: IntegrationAuth, @Param('id') id: string) {
    return serializeCharge(this.charges.cancel(id, { merchantId: auth.merchantId }));
  }

  // ------------------------------------------------------------------ refunds

  @Post('pix/charges/:id/refunds')
  createRefund(
    @Auth() auth: IntegrationAuth,
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
  listRefunds(@Auth() auth: IntegrationAuth, @Param('id') id: string) {
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
  getMerchant(@Auth() auth: IntegrationAuth) {
    return serializeMerchant(this.merchants.get(auth.merchantId), true);
  }

  @Patch('merchants/me')
  updateMerchant(@Auth() auth: IntegrationAuth, @Body() body: UpdateMerchantBody = {}) {
    return serializeMerchant(this.merchants.update(auth.merchantId, toMerchantUpdate(body)), true);
  }
}
