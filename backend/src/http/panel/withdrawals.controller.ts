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
import { WithdrawalService } from '../../service/withdrawals.service';
import { serializeWithdrawal } from '../../service/serialize.service';
import {
  withdrawalFilters,
  type CreateWithdrawalBody,
  type DenyWithdrawalBody,
  type WithdrawalQuery,
} from '../../dto';

/**
 * Withdrawals as the panel sees them: scoped to the session's own store, plus the
 * confirm/deny simulation controls the API deliberately does not expose — there is no real
 * bank on the other end, so the store simulates its own outcome, the same way it simulates
 * a charge or a KYC decision.
 */
@Controller('v1/panel/withdrawals')
@UseGuards(MerchantGuard)
export class PanelWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get()
  list(@MerchantId() merchantId: string, @Query() query: WithdrawalQuery = {}) {
    const filters = withdrawalFilters(merchantId, query);

    return {
      object: 'list',
      data: this.withdrawals.list(filters).map(serializeWithdrawal),
      total: this.withdrawals.count(filters),
    };
  }

  @Get(':id')
  get(@MerchantId() merchantId: string, @Param('id') id: string) {
    return serializeWithdrawal(this.withdrawals.get(id, { merchantId }));
  }

  @Post()
  create(@MerchantId() merchantId: string, @Body() body: CreateWithdrawalBody = {}) {
    return serializeWithdrawal(
      this.withdrawals.create({ merchantId, amount: body.amount as number }),
    );
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@MerchantId() merchantId: string, @Param('id') id: string) {
    return serializeWithdrawal(this.withdrawals.confirm(id, { merchantId }));
  }

  @Post(':id/deny')
  @HttpCode(HttpStatus.OK)
  deny(
    @MerchantId() merchantId: string,
    @Param('id') id: string,
    @Body() body: DenyWithdrawalBody = {},
  ) {
    return serializeWithdrawal(this.withdrawals.deny(id, { reason: body.reason ?? null }, { merchantId }));
  }
}
