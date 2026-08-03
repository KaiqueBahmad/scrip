import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Merchant, MerchantId, Public } from '../../auth/context';
import { MerchantGuard } from '../../auth/merchant.guard';
import { MerchantService } from '../../service/merchants.service';
import { serializeMerchant } from '../../service/serialize.service';
import type { MerchantRow } from '../../repositories/types';
import { toMerchantUpdate, type CreateMerchantBody, type UpdateMerchantBody } from '../../dto';

/**
 * The store behind the panel session, and the two routes that necessarily come before one:
 * the merchant is the panel identity, so picking and creating a store cannot themselves
 * require a session.
 */
@Controller('v1/panel')
@UseGuards(MerchantGuard)
export class SessionController {
  constructor(private readonly merchants: MerchantService) {}

  /**
   * Public on purpose: this is the list the panel shows so you can pick which store to be,
   * because there is no login screen. The balance comes along so the picker can show it,
   * but the webhook secret does not — you are not that store yet.
   */
  @Get('session/merchants')
  @Public()
  list() {
    return {
      object: 'list',
      data: this.merchants
        .list()
        .map((merchant) =>
          serializeMerchant(merchant, false, this.merchants.balanceFor(merchant.id)),
        ),
    };
  }

  /**
   * Public on purpose: Basic auth resolves an existing merchant, so with an
   * empty database there would be no way to create the first one. No webhook_url here
   * either — wiring the webhook is a separate step through PATCH /merchants/me.
   */
  @Post('merchants')
  @Public()
  create(@Body() body: CreateMerchantBody = {}) {
    return this.merchants.present(this.merchants.create({ name: body.name as string }));
  }

  /** Everything the panel needs to render a session. */
  @Get('session/me')
  me(@Merchant() merchant: MerchantRow) {
    return { merchant: this.merchants.present(merchant) };
  }

  @Get('merchants/me')
  get(@Merchant() merchant: MerchantRow) {
    return this.merchants.present(merchant);
  }

  @Patch('merchants/me')
  update(@MerchantId() merchantId: string, @Body() body: UpdateMerchantBody = {}) {
    return this.merchants.present(this.merchants.update(merchantId, toMerchantUpdate(body)));
  }

  @Delete('merchants/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@MerchantId() merchantId: string): void {
    this.merchants.delete(merchantId);
  }

  @Get('balance')
  balance(@MerchantId() merchantId: string) {
    return { object: 'balance', ...this.merchants.balanceFor(merchantId) };
  }
}
