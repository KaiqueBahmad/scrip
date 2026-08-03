import {
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
import { serializeDelivery } from '../../service/serialize.service';
import { WebhookDispatcher } from '../../service/webhooks.service';
import type { DeliveryQuery } from '../../dto';

@Controller('v1/panel/webhooks/deliveries')
@UseGuards(MerchantGuard)
export class PanelWebhooksController {
  constructor(private readonly webhooks: WebhookDispatcher) {}

  @Get()
  list(@MerchantId() merchantId: string, @Query() query: DeliveryQuery = {}) {
    return {
      object: 'list',
      data: this.webhooks
        .listForMerchant(merchantId, {
          ...(query.charge_id ? { chargeId: query.charge_id } : {}),
          ...(query.event ? { event: query.event } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.limit ? { limit: Number(query.limit) } : {}),
        })
        .map(serializeDelivery),
    };
  }

  @Get(':id')
  get(@MerchantId() merchantId: string, @Param('id') id: string) {
    return serializeDelivery(this.webhooks.get(id, { merchantId }));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@MerchantId() merchantId: string, @Param('id') id: string) {
    return serializeDelivery(this.webhooks.retry(id, { merchantId }));
  }
}
