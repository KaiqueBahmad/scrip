import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { MerchantGuard } from '../../auth/merchant.guard';
import { SettingsService } from '../../settings';

@Controller('v1/panel/settings')
@UseGuards(MerchantGuard)
export class PanelSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  read() {
    return this.settings.read();
  }

  @Patch()
  update(@Body() body: Record<string, unknown> = {}) {
    return this.settings.save(body);
  }
}
