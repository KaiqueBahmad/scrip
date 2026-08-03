import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { Auth, type ApiAuth } from '../../auth/context';
import { ApiGuard } from '../../auth/api.guard';
import { WithdrawalService } from '../../service/withdrawals.service';
import { serializeWithdrawal } from '../../service/serialize.service';
import { withdrawalFilters, type CreateWithdrawalBody, type WithdrawalQuery } from '../../dto';

/**
 * Withdrawal API, called by the merchant's own backend with a JWT. Confirming or denying a
 * withdrawal is a panel-only action — see PanelWithdrawalsController.
 */
@Controller('v1/api/withdrawals')
@UseGuards(ApiGuard)
export class ApiWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Post()
  create(@Auth() auth: ApiAuth, @Body() body: CreateWithdrawalBody = {}) {
    return serializeWithdrawal(
      this.withdrawals.create({ merchantId: auth.merchantId, amount: body.amount as number }),
    );
  }

  @Get()
  list(@Auth() auth: ApiAuth, @Query() query: WithdrawalQuery = {}) {
    const filters = withdrawalFilters(auth.merchantId, query);

    return {
      object: 'list',
      data: this.withdrawals.list(filters).map(serializeWithdrawal),
      total: this.withdrawals.count(filters),
    };
  }

  @Get(':id')
  get(@Auth() auth: ApiAuth, @Param('id') id: string) {
    return serializeWithdrawal(this.withdrawals.get(id, { merchantId: auth.merchantId }));
  }
}
