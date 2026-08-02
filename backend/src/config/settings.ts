import { Injectable } from '@nestjs/common';

import { ConfigStore, CONFIG_FILE } from './config';

@Injectable()
export class SettingsService {
  constructor(private readonly config: ConfigStore) {}

  /**
   * Settings are instance-wide, not per store: they control how the simulation behaves.
   * Read-only — every value comes from pseudopay.config.json (or a PSEUDOPAY_* env var) and
   * changing one means editing the file and restarting.
   *
   * The signing secret is redacted — this project is lax about access control
   * (specs.md:112-118), but handing out the key that mints tokens is a different order of
   * leak from showing the tokens themselves.
   */
  read() {
    const { jwtSigningSecret, ...rest } = this.config.current();

    return {
      object: 'settings' as const,
      source: CONFIG_FILE,
      values: { ...rest, jwtSigningSecret: jwtSigningSecret ? '[redacted]' : '' },
    };
  }
}
