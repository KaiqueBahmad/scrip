import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';

import { badRequest } from './lib/errors';

export interface UploadPayload {
  type: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

function fieldValue(file: MultipartFile, name: string): string | undefined {
  const field = file.fields?.[name];
  const entry = Array.isArray(field) ? field[0] : field;

  if (entry && 'value' in entry && typeof entry.value === 'string') return entry.value;
  return undefined;
}

/**
 * Accepts a KYC document either as multipart/form-data (what the panel sends) or as JSON
 * with base64 content (easier to drive from curl or a CI script):
 *
 *   { "type": "identity", "filename": "rg.png", "mime_type": "image/png", "content": "<base64>" }
 */
export async function readUpload(request: FastifyRequest): Promise<UploadPayload> {
  if (request.isMultipart()) {
    const file = await request.file();

    if (!file) throw badRequest('missing_file', 'No file part found in the multipart body');

    const content = await file.toBuffer();

    return {
      type: fieldValue(file, 'type') ?? 'other',
      filename: file.filename,
      mimeType: file.mimetype,
      content,
    };
  }

  const body = (request.body ?? {}) as {
    type?: string;
    filename?: string;
    mime_type?: string;
    content?: string;
  };

  if (typeof body.content !== 'string' || body.content.length === 0) {
    throw badRequest(
      'missing_file',
      'Send multipart/form-data, or JSON with a base64 "content" field',
    );
  }

  const content = Buffer.from(body.content, 'base64');

  if (content.length === 0) {
    throw badRequest('invalid_content', '"content" is not valid base64');
  }

  return {
    type: body.type ?? 'other',
    filename: body.filename ?? 'document',
    mimeType: body.mime_type ?? 'application/octet-stream',
    content,
  };
}
