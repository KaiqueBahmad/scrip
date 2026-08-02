import { Controller, Get, UseGuards } from '@nestjs/common';

import { MerchantGuard } from '../../auth/merchant.guard';
import { SettingsService } from '../../config';

@Controller('v1/panel/settings')
@UseGuards(MerchantGuard)
export class PanelSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  read() {
    return this.settings.read();
  }
}
