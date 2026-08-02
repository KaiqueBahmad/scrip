/**
 * Request bodies and query strings as they arrive on the wire, one file per resource.
 *
 * Field names stay snake_case because that is the published API contract; the mapping to
 * the domain layer's camelCase inputs happens here, once, instead of in every controller.
 * That is why the direction of these imports is dto -> domain and never the reverse: the
 * domain does not know the wire exists.
 *
 * Values are not validated on the way in. The domain services already reject a bad amount
 * or a malformed webhook_url with a specific error code, and duplicating those rules here
 * would only give the same input two different answers.
 */

export * from './charges.dto';
export * from './kyc.dto';
export * from './merchants.dto';
export * from './refunds.dto';
export * from './tokens.dto';
export * from './webhooks.dto';
