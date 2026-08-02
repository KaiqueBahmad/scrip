import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { MerchantId } from '../../auth/context';
import { MerchantGuard } from '../../auth/merchant.guard';
import { readUpload } from '../../common/upload';
import { KYC_DOCUMENT_TYPES, KycService } from '../../domain/kyc';
import { MerchantService } from '../../domain/merchants';
import { serializeKycDocument } from '../../domain/serialize';
import type { SimulateKycBody } from '../../dto';
import { badRequest } from '../../lib/errors';

@Controller('v1/panel/kyc')
@UseGuards(MerchantGuard)
export class PanelKycController {
  constructor(
    private readonly kyc: KycService,
    private readonly merchants: MerchantService,
  ) {}

  @Get('documents')
  listDocuments(@MerchantId() merchantId: string) {
    const merchant = this.merchants.get(merchantId);

    return {
      object: 'list',
      kyc_status: merchant.kyc_status,
      kyc_reason: merchant.kyc_reason,
      document_types: KYC_DOCUMENT_TYPES,
      data: this.kyc.listDocuments(merchantId).map(serializeKycDocument),
    };
  }

  @Post('documents')
  async upload(@MerchantId() merchantId: string, @Req() request: FastifyRequest) {
    const upload = await readUpload(request);

    return serializeKycDocument(
      this.kyc.upload({
        merchantId,
        type: upload.type,
        filename: upload.filename,
        mimeType: upload.mimeType,
        content: upload.content,
      }),
    );
  }

  /** Streams the stored BLOB back, so the panel can preview what was uploaded. */
  @Get('documents/:id/content')
  content(
    @MerchantId() merchantId: string,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): void {
    const { row, content } = this.kyc.getDocumentContent(id, { merchantId });

    void reply
      .header('content-type', row.mime_type)
      .header('content-length', String(content.length))
      .header('content-disposition', `inline; filename="${encodeURIComponent(row.filename)}"`)
      .send(content);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDocument(@MerchantId() merchantId: string, @Param('id') id: string): void {
    this.kyc.deleteDocument(id, { merchantId });
  }

  /**
   * With the merchant as the only identity there is no reviewer above it, so approving and
   * rejecting are simulation controls over your own KYC — the same idea as forcing a
   * payment. They still emit the real kyc.approved / kyc.rejected webhooks.
   */
  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@MerchantId() merchantId: string, @Body() body: SimulateKycBody = {}) {
    const { decision, reason = null } = body;

    if (decision !== 'approved' && decision !== 'rejected') {
      throw badRequest('invalid_decision', 'decision must be "approved" or "rejected"', {
        received: decision ?? null,
      });
    }

    const input = { merchantId, reason };

    return this.merchants.present(
      decision === 'approved' ? this.kyc.approve(input) : this.kyc.reject(input),
    );
  }
}
