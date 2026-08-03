/**
 * Configuration in two halves: `config` is how a value is resolved at boot (defaults, then
 * scrip.config.json, then SCRIP_* env vars), and `settings` is how the panel reads
 * the result back. Nothing writes config — the file is the only place it is edited.
 */
export * from './config';
export * from './settings';
