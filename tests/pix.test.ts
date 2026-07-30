import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBrCode,
  crc16,
  formatAmount,
  generateE2eId,
  generateTxid,
  isValidBrCode,
  parseTlv,
  tlv,
} from '../src/lib/pix.js';

describe('crc16 (CRC-16/CCITT-FALSE)', () => {
  it('matches the standard check vector', () => {
    // The canonical CRC-16/CCITT-FALSE check value for "123456789" is 0x29B1.
    assert.equal(crc16('123456789'), '29B1');
  });

  it('is stable and always four uppercase hex digits', () => {
    assert.equal(crc16(''), 'FFFF');
    assert.match(crc16('pseudopay'), /^[0-9A-F]{4}$/);
    assert.equal(crc16('pseudopay'), crc16('pseudopay'));
  });
});

describe('tlv', () => {
  it('prefixes a zero-padded two-digit length', () => {
    assert.equal(tlv('00', '01'), '000201');
    assert.equal(tlv('26', 'br.gov.bcb.pix'), '2614br.gov.bcb.pix');
  });

  it('round-trips through parseTlv', () => {
    const payload = tlv('00', '01') + tlv('53', '986') + tlv('58', 'BR');
    assert.deepEqual(parseTlv(payload), { '00': '01', '53': '986', '58': 'BR' });
  });
});

describe('formatAmount', () => {
  it('renders centavos as a decimal string', () => {
    assert.equal(formatAmount(15000), '150.00');
    assert.equal(formatAmount(1), '0.01');
    assert.equal(formatAmount(100), '1.00');
  });

  it('rejects fractional centavos', () => {
    assert.throws(() => formatAmount(10.5), /integer number of centavos/);
  });
});

describe('buildBrCode', () => {
  const input = {
    pixKey: 'pseudopay@localhost',
    receiverName: 'PSEUDOPAY',
    receiverCity: 'SAO PAULO',
    amount: 15000,
    txid: 'ABC123',
  };

  it('produces a payload with a valid trailing checksum', () => {
    const brCode = buildBrCode(input);

    assert.ok(brCode.startsWith('000201'), 'starts with the payload format indicator');
    assert.ok(isValidBrCode(brCode), 'self-verifies');
  });

  it('carries the expected EMV fields', () => {
    const fields = parseTlv(buildBrCode(input));

    assert.equal(fields['00'], '01');
    assert.equal(fields['01'], '12', 'dynamic, single-use');
    assert.equal(fields['53'], '986', 'BRL');
    assert.equal(fields['54'], '150.00');
    assert.equal(fields['58'], 'BR');
    assert.equal(fields['59'], 'PSEUDOPAY');
    assert.equal(fields['60'], 'SAO PAULO');

    assert.deepEqual(parseTlv(fields['26'] ?? ''), {
      '00': 'br.gov.bcb.pix',
      '01': 'pseudopay@localhost',
    });
    assert.deepEqual(parseTlv(fields['62'] ?? ''), { '05': 'ABC123' });
  });

  it('strips accents and truncates the receiver name', () => {
    const fields = parseTlv(
      buildBrCode({ ...input, receiverName: 'Café Comércio Ltda. Nome Muito Longo' }),
    );

    assert.equal(fields['59'], 'CAFE COMERCIO LTDA NOME M');
    assert.equal((fields['59'] ?? '').length, 25);
  });

  it('detects a tampered payload', () => {
    const brCode = buildBrCode(input);
    // Change the amount without recomputing the checksum.
    const tampered = brCode.replace('150.00', '900.00');

    assert.equal(isValidBrCode(tampered), false);
  });

  it('rejects a non-positive amount', () => {
    assert.throws(() => buildBrCode({ ...input, amount: 0 }), /must be positive/);
  });
});

describe('identifiers', () => {
  it('generates a 25-character alphanumeric txid', () => {
    assert.match(generateTxid(), /^[A-Z0-9]{25}$/);
  });

  it('generates an e2e id in the Bacen shape with the fake ISPB', () => {
    const e2eId = generateE2eId(new Date('2026-03-04T05:06:07.000Z'));

    assert.equal(e2eId.length, 32);
    assert.match(e2eId, /^E99999999\d{12}[A-Z0-9]{11}$/);
    assert.ok(e2eId.startsWith('E99999999202603040506'), 'embeds the UTC timestamp');
  });
});
