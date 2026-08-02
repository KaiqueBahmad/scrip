import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { MerchantId } from '../../auth/context';
import { MerchantGuard } from '../../auth/merchant.guard';
import { ChargeService } from '../../service/charges.service';
import { RefundService } from '../../service/refunds.service';
import {
  serializeCharge,
  serializeChargeEvent,
  serializeDelivery,
  serializeRefund,
} from '../../service/serialize.service';
import { WebhookDispatcher } from '../../service/webhooks.service';
import {
  chargeFilters,
  type ChargeQuery,
  type CreateRefundBody,
  type SimulateChargeBody,
} from '../../dto';
import { badRequest } from '../../lib/errors';

/**
 * Charges as the panel sees them: scoped to the session's own store, plus the simulation
 * controls the integration API deliberately does not expose.
 */
@Controller('v1/panel/charges')
@UseGuards(MerchantGuard)
export class PanelChargesController {
  constructor(
    private readonly charges: ChargeService,
    private readonly refunds: RefundService,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  @Get()
  list(@MerchantId() merchantId: string, @Query() query: ChargeQuery = {}) {
    const filters = chargeFilters(merchantId, query);

    return {
      object: 'list',
      data: this.charges.list(filters).map(serializeCharge),
      total: this.charges.count(filters),
    };
  }

  /** Everything the detail screen shows, in one round trip. */
  @Get(':id')
  get(@MerchantId() merchantId: string, @Param('id') id: string) {
    const charge = this.charges.get(id, { merchantId });

    return {
      charge: serializeCharge(charge),
      events: this.charges.listEvents(charge.id).map(serializeChargeEvent),
      refunds: this.refunds.list(charge.id, { merchantId }).map(serializeRefund),
      deliveries: this.webhooks
        .listForMerchant(merchantId, { chargeId: charge.id })
        .map(serializeDelivery),
    };
  }

  @Post(':id/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(
    @MerchantId() merchantId: string,
    @Param('id') id: string,
    @Body() body: SimulateChargeBody = {},
  ) {
    const { result } = body;

    if (result !== 'paid' && result !== 'expired') {
      throw badRequest('invalid_result', 'result must be "paid" or "expired"', {
        received: result ?? null,
      });
    }

    return serializeCharge(this.charges.simulate(id, result, { merchantId }));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@MerchantId() merchantId: string, @Param('id') id: string) {
    return serializeCharge(this.charges.cancel(id, { merchantId }));
  }

  @Post(':id/refunds')
  refund(
    @MerchantId() merchantId: string,
    @Param('id') id: string,
    @Body() body: CreateRefundBody = {},
  ) {
    return serializeRefund(
      this.refunds.create({
        chargeId: id,
        merchantId,
        amount: body.amount ?? null,
        reason: body.reason ?? null,
      }),
    );
  }
}
