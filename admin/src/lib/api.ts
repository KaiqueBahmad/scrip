/** Typed client for /admin/api. Basic auth credentials come from the selected user. */

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  merchant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiMerchant {
  id: string;
  name: string;
  document: string | null;
  webhook_url: string | null;
  webhook_secret?: string;
  kyc_status: 'pending' | 'approved' | 'rejected';
  kyc_reason: string | null;
  kyc_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ChargeStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'canceled'
  | 'partially_refunded'
  | 'refunded';

export interface ApiCharge {
  id: string;
  merchant_id: string;
  status: ChargeStatus;
  amount: number;
  amount_refunded: number;
  payer_document: string | null;
  payer_name: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  qr_code: string;
  qr_code_txid: string;
  qr_code_expires_at: string;
  public_token: string;
  e2e_id: string | null;
  paid_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiChargeEvent {
  id: string;
  charge_id: string;
  from_status: ChargeStatus | null;
  to_status: ChargeStatus;
  reason: string | null;
  created_at: string;
}

export interface ApiRefund {
  id: string;
  charge_id: string;
  amount: number;
  status: 'succeeded' | 'failed';
  reason: string | null;
  e2e_id: string | null;
  created_at: string;
}

export interface ApiDelivery {
  id: string;
  merchant_id: string;
  charge_id: string | null;
  event: string;
  url: string;
  payload: Record<string, unknown>;
  signature: string | null;
  attempt: number;
  max_attempts: number;
  status: 'pending' | 'delivered' | 'failed';
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  scheduled_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiToken {
  id: string;
  user_id: string;
  merchant_id: string;
  name: string | null;
  permissions: string[];
  token: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked: boolean;
  created_at: string;
}

export interface ApiKycDocument {
  id: string;
  merchant_id: string;
  type: string;
  filename: string;
  mime_type: string;
  size: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ApiSettings {
  object: 'settings';
  editable: string[];
  values: Record<string, string | number | boolean>;
}

export interface ChargeDetail {
  charge: ApiCharge;
  events: ApiChargeEvent[];
  refunds: ApiRefund[];
  deliveries: ApiDelivery[];
}

/** Mirrors the AppError envelope every surface returns. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE = '/admin/api';

let authHeader: string | null = null;

/** Basic auth with an empty password, per specs.md:35. */
export function setActingUser(userIdOrEmail: string | null): void {
  authHeader = userIdOrEmail ? `Basic ${btoa(`${userIdOrEmail}:`)}` : null;
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; raw?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body: keep the text */
  }

  if (!response.ok) {
    const envelope = parsed as { error?: { code?: string; message?: string; details?: unknown } };
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? 'request_failed',
      envelope?.error?.message ?? `${method} ${path} falhou (${response.status})`,
      envelope?.error?.details,
    );
  }

  return parsed as T;
}

interface ListResponse<T> {
  data: T[];
  total?: number;
}

export const api = {
  // session
  sessionUsers: () => request<ListResponse<ApiUser>>('GET', '/session/users'),
  permissions: () => request<ListResponse<string>>('GET', '/session/permissions'),
  me: () => request<{ user: ApiUser; merchant: ApiMerchant | null }>('GET', '/session/me'),

  // users
  users: () => request<ListResponse<ApiUser>>('GET', '/users'),
  createUser: (body: {
    name: string;
    email: string;
    permissions: string[];
    merchant_id: string | null;
  }) => request<ApiUser>('POST', '/users', { body }),
  updateUser: (id: string, body: Partial<{ name: string; email: string; permissions: string[]; merchant_id: string | null }>) =>
    request<ApiUser>('PATCH', `/users/${id}`, { body }),
  deleteUser: (id: string) => request<void>('DELETE', `/users/${id}`),

  // merchants
  merchants: () => request<ListResponse<ApiMerchant>>('GET', '/merchants'),
  createMerchant: (body: { name: string; document: string | null; webhook_url: string | null }) =>
    request<ApiMerchant>('POST', '/merchants', { body }),
  updateMerchant: (
    id: string,
    body: Partial<{
      name: string;
      document: string | null;
      webhook_url: string | null;
      rotate_webhook_secret: boolean;
    }>,
  ) => request<ApiMerchant>('PATCH', `/merchants/${id}`, { body }),
  deleteMerchant: (id: string) => request<void>('DELETE', `/merchants/${id}`),

  // charges
  charges: (query: Record<string, string> = {}) => {
    const search = new URLSearchParams(query).toString();
    return request<ListResponse<ApiCharge>>('GET', `/charges${search ? `?${search}` : ''}`);
  },
  charge: (id: string) => request<ChargeDetail>('GET', `/charges/${id}`),
  simulate: (id: string, result: 'paid' | 'expired') =>
    request<ApiCharge>('POST', `/charges/${id}/simulate`, { body: { result } }),
  cancelCharge: (id: string) => request<ApiCharge>('POST', `/charges/${id}/cancel`),
  refundCharge: (id: string, body: { amount?: number | null; reason?: string | null }) =>
    request<ApiRefund>('POST', `/charges/${id}/refunds`, { body }),

  // tokens
  tokens: () => request<ListResponse<ApiToken>>('GET', '/tokens'),
  createToken: (body: {
    merchant_id: string | null;
    name: string | null;
    permissions: string[];
    expires_in?: string | null;
  }) => request<ApiToken>('POST', '/tokens', { body }),
  revokeToken: (id: string) => request<ApiToken>('POST', `/tokens/${id}/revoke`),
  deleteToken: (id: string) => request<void>('DELETE', `/tokens/${id}`),

  // kyc
  kycDocuments: (merchantId?: string) =>
    request<ListResponse<ApiKycDocument> & { document_types: string[] }>(
      'GET',
      `/kyc/documents${merchantId ? `?merchant_id=${merchantId}` : ''}`,
    ),
  kycPending: () => request<ListResponse<ApiMerchant>>('GET', '/kyc/pending'),
  approveKyc: (merchantId: string, reason: string | null) =>
    request<ApiMerchant>('POST', `/merchants/${merchantId}/kyc/approve`, { body: { reason } }),
  rejectKyc: (merchantId: string, reason: string | null) =>
    request<ApiMerchant>('POST', `/merchants/${merchantId}/kyc/reject`, { body: { reason } }),
  deleteKycDocument: (id: string) => request<void>('DELETE', `/kyc/documents/${id}`),
  kycDocumentUrl: (id: string) => `${BASE}/kyc/documents/${id}/content`,

  /** Multipart upload, so the browser sets the boundary itself. */
  uploadKycDocument: async (merchantId: string, file: File, type: string) => {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file);

    const response = await fetch(`${BASE}/merchants/${merchantId}/kyc/documents`, {
      method: 'POST',
      headers: authHeader ? { authorization: authHeader } : {},
      body: form,
    });

    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const envelope = parsed as { error?: { code?: string; message?: string } };
      throw new ApiError(
        response.status,
        envelope?.error?.code ?? 'upload_failed',
        envelope?.error?.message ?? 'Falha no envio do documento',
      );
    }

    return parsed as ApiKycDocument;
  },

  // webhooks
  deliveries: (query: Record<string, string> = {}) => {
    const search = new URLSearchParams(query).toString();
    return request<ListResponse<ApiDelivery>>('GET', `/webhooks/deliveries${search ? `?${search}` : ''}`);
  },
  retryDelivery: (id: string) => request<ApiDelivery>('POST', `/webhooks/deliveries/${id}/retry`),

  // settings
  settings: () => request<ApiSettings>('GET', '/settings'),
  updateSettings: (body: Record<string, unknown>) =>
    request<ApiSettings>('PATCH', '/settings', { body }),
};
