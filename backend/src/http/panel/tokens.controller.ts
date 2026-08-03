import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { MerchantId } from '../../auth/context';
import { MerchantGuard } from '../../auth/merchant.guard';
import { serializeToken } from '../../service/serialize.service';
import { TokenService } from '../../service/tokens.service';
import type { IssueTokenBody } from '../../dto';

/**
 * Only a merchant session can mint an API JWT, always scoped to itself. The token
 * then reaches every /v1/api route within that scope.
 */
@Controller('v1/panel/tokens')
@UseGuards(MerchantGuard)
export class PanelTokensController {
  constructor(private readonly tokens: TokenService) {}

  @Get()
  list(@MerchantId() merchantId: string) {
    return {
      object: 'list',
      data: this.tokens.listForMerchant(merchantId).map(serializeToken),
    };
  }

  @Post()
  issue(@MerchantId() merchantId: string, @Body() body: IssueTokenBody = {}) {
    return serializeToken(
      this.tokens.issue({
        // Taken from the session, never from the body: a store cannot mint for another.
        merchantId,
        name: body.name ?? null,
        ...(body.expires_in === undefined ? {} : { expiresIn: body.expires_in }),
      }),
    );
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@MerchantId() merchantId: string, @Param('id') id: string) {
    return serializeToken(this.tokens.revoke(id, { merchantId }));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@MerchantId() merchantId: string, @Param('id') id: string): void {
    this.tokens.delete(id, { merchantId });
  }
}
