/**
 * Injection tokens for the dependencies that are not classes: the SQLite handle, the clock,
 * the logger, and the two seams the test suite replaces (webhook transport and the RNG).
 * Everything else — ConfigStore and the domain services — is injected by its class.
 */
export const DB = 'DB';
export const SCHEDULER = 'SCHEDULER';
export const LOGGER = 'LOGGER';
export const FETCH = 'FETCH';
export const RANDOM = 'RANDOM';
