/**
 * BR Code ("PIX copia e cola") generation.
 *
 * The payload follows the EMV®QRCPS TLV structure the real Bacen spec is based on, so it
 * looks and parses like the real thing — but per specs.md:140 it is not meant to be
 * scannable by an actual bank app, and the e2e_id (specs.md:141) mimics the Bacen shape
 * without implementing the official algorithm.
 */

const GUI_PIX = 'br.gov.bcb.pix';
const CURRENCY_BRL = '986';
const COUNTRY_BR = 'BR';
const MERCHANT_CATEGORY_CODE = '0000';

/** Deliberately-invalid ISPB so a simulated e2e_id can never collide with a real one. */
const PSEUDO_ISPB = '99999999';

const ALNUM_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the checksum EMV field 63 requires. */
export function crc16(payload: string): string {
  let crc = 0xffff;

  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** One TLV element: two-digit id, two-digit length, value. */
export function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Splits a TLV string back into a map. Used by the test suite to assert structure. */
export function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cursor = 0;

  while (cursor + 4 <= payload.length) {
    const id = payload.slice(cursor, cursor + 2);
    const length = Number(payload.slice(cursor + 2, cursor + 4));
    if (!Number.isFinite(length)) break;
    out[id] = payload.slice(cursor + 4, cursor + 4 + length);
    cursor += 4 + length;
  }

  return out;
}

/** Strips accents and anything EMV disallows, then uppercases and truncates. */
function sanitizeText(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .slice(0, maxLength);
}

function randomAlnumUpper(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALNUM_UPPER[Math.floor(Math.random() * ALNUM_UPPER.length)];
  }
  return out;
}

/** Amounts travel as integer centavos (specs.md:72) but EMV field 54 wants "150.00". */
export function formatAmount(centavos: number): string {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Amount must be an integer number of centavos, got ${centavos}`);
  }
  return (centavos / 100).toFixed(2);
}

/** Bacen allows up to 25 alphanumeric characters in the txid (EMV field 62.05). */
export function generateTxid(): string {
  return randomAlnumUpper(25);
}

/**
 * End-to-end id: E + ISPB(8) + yyyyMMddHHmm(12) + 11 alphanumerics = 32 chars, matching
 * the real shape. Only produced once a charge actually settles.
 */
export function generateE2eId(at: Date = new Date()): string {
  const stamp = [
    at.getUTCFullYear(),
    String(at.getUTCMonth() + 1).padStart(2, '0'),
    String(at.getUTCDate()).padStart(2, '0'),
    String(at.getUTCHours()).padStart(2, '0'),
    String(at.getUTCMinutes()).padStart(2, '0'),
  ].join('');

  return `E${PSEUDO_ISPB}${stamp}${randomAlnumUpper(11)}`;
}

export interface BrCodeInput {
  pixKey: string;
  receiverName: string;
  receiverCity: string;
  /** Integer centavos. */
  amount: number;
  txid: string;
}

/**
 * Builds a dynamic (single-use) BR Code. Field order matters: the CRC in field 63 is
 * computed over the whole payload including the "6304" header of the CRC field itself.
 */
export function buildBrCode(input: BrCodeInput): string {
  if (input.amount <= 0) {
    throw new Error(`BR Code amount must be positive, got ${input.amount}`);
  }

  const merchantAccount = tlv('00', GUI_PIX) + tlv('01', input.pixKey);
  const additionalData = tlv('05', input.txid);

  const payload = [
    tlv('00', '01'), // payload format indicator
    tlv('01', '12'), // point of initiation: dynamic, single use
    tlv('26', merchantAccount),
    tlv('52', MERCHANT_CATEGORY_CODE),
    tlv('53', CURRENCY_BRL),
    tlv('54', formatAmount(input.amount)),
    tlv('58', COUNTRY_BR),
    tlv('59', sanitizeText(input.receiverName, 25)),
    tlv('60', sanitizeText(input.receiverCity, 15)),
    tlv('62', additionalData),
  ].join('');

  const withCrcHeader = `${payload}6304`;
  return `${withCrcHeader}${crc16(withCrcHeader)}`;
}

/** Verifies the trailing CRC of a BR Code. */
export function isValidBrCode(brCode: string): boolean {
  if (brCode.length < 8) return false;
  const body = brCode.slice(0, -4);
  const checksum = brCode.slice(-4);
  return body.endsWith('6304') && crc16(body) === checksum.toUpperCase();
}
