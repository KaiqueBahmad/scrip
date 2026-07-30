import { useRef, useState } from 'react';

import { PageHeader } from '../components/Layout';
import { KycBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/utils';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

/** KYC review queue. Documents live as BLOBs in SQLite (specs.md:25). */
export function Kyc() {
  const merchants = useAsync(() => api.merchants(), []);
  const [merchantId, setMerchantId] = useState('');
  const documents = useAsync(
    () => api.kycDocuments(merchantId || undefined),
    [merchantId],
  );

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState('identity');

  const rows = documents.data?.data ?? [];
  const types = documents.data?.document_types ?? ['identity', 'other'];
  const allMerchants = merchants.data?.data ?? [];
  const pending = allMerchants.filter((merchant) => merchant.kyc_status === 'pending');

  const review = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);

    try {
      if (decision === 'approve') await api.approveKyc(id, reason.trim() || null);
      else await api.rejectKyc(id, reason.trim() || null);

      setReason('');
      await Promise.all([merchants.reload(), documents.reload()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar a decisão');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!merchantId) {
      setError('Escolha um comerciante antes de enviar um documento.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await api.uploadKycDocument(merchantId, file, uploadType);
      await documents.reload();
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha no envio');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="verificação de comerciante"
        title="KYC"
        description="Aprove ou recuse comerciantes manualmente. A decisão dispara kyc.approved ou kyc.rejected."
        actions={<span className="eyebrow">{pending.length} aguardando análise</span>}
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHeader
              title="Fila de análise"
              hint="Comerciantes com KYC ainda pendente."
            />

            {pending.length === 0 ? (
              <EmptyState title="Nada na fila">
                Todos os comerciantes já foram analisados.
              </EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Comerciante</Th>
                    <Th>Documentos</Th>
                    <Th>Criado</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((merchant) => {
                    const count = rows.filter((doc) => doc.merchant_id === merchant.id).length;

                    return (
                      <tr key={merchant.id} className="hover:bg-[var(--hairline-soft)]">
                        <Td>
                          <span className="font-medium">{merchant.name}</span>
                          <span className="tnum block text-[11px] text-[var(--text-muted)]">
                            {merchant.id}
                          </span>
                        </Td>
                        <Td className="tnum text-xs">
                          {merchantId === merchant.id || merchantId === ''
                            ? count
                            : '—'}
                        </Td>
                        <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                          {formatDateTime(merchant.created_at)}
                        </Td>
                        <Td>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="settle"
                              disabled={busy}
                              onClick={() => void review(merchant.id, 'approve')}
                            >
                              aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => void review(merchant.id, 'reject')}
                            >
                              recusar
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}

            <div className="border-t p-4">
              <Field
                label="Motivo da decisão"
                htmlFor="kyc-reason"
                hint="Vai no payload do webhook e fica salvo no comerciante."
              >
                <Input
                  id="kyc-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="documentos conferem"
                />
              </Field>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Documentos"
              hint={`${rows.length} arquivo(s) guardado(s) como BLOB no SQLite`}
              actions={
                <Select
                  aria-label="Filtrar por comerciante"
                  className="h-7 text-xs"
                  value={merchantId}
                  onChange={(event) => setMerchantId(event.target.value)}
                >
                  <option value="">Todos os comerciantes</option>
                  {allMerchants.map((merchant) => (
                    <option key={merchant.id} value={merchant.id}>
                      {merchant.name}
                    </option>
                  ))}
                </Select>
              }
            />

            {rows.length === 0 ? (
              <EmptyState title="Nenhum documento enviado">
                Envie um arquivo pelo formulário ao lado ou por{' '}
                <span className="font-mono">POST /v1/integration/kyc/documents</span>.
              </EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Arquivo</Th>
                    <Th>Tipo</Th>
                    <Th>Tamanho</Th>
                    <Th>Status</Th>
                    <Th>Enviado</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((document) => (
                    <tr key={document.id} className="hover:bg-[var(--hairline-soft)]">
                      <Td className="max-w-[220px] truncate font-medium">{document.filename}</Td>
                      <Td className="font-mono text-[11px]">{document.type}</Td>
                      <Td className="tnum text-xs">{formatBytes(document.size)}</Td>
                      <Td>
                        <KycBadge status={document.status} />
                      </Td>
                      <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                        {formatDateTime(document.created_at)}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <a
                            href={api.kycDocumentUrl(document.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="eyebrow px-2 py-1 hover:text-trace"
                          >
                            abrir
                          </a>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-halt"
                            disabled={busy}
                            onClick={async () => {
                              await api.deleteKycDocument(document.id);
                              await documents.reload();
                            }}
                          >
                            excluir
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <Panel>
          <PanelHeader title="Enviar documento" />
          <div className="grid gap-3 p-4">
            <Field label="Comerciante" htmlFor="upload-merchant">
              <Select
                id="upload-merchant"
                value={merchantId}
                onChange={(event) => setMerchantId(event.target.value)}
              >
                <option value="">Escolha um comerciante</option>
                {allMerchants.map((merchant) => (
                  <option key={merchant.id} value={merchant.id}>
                    {merchant.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Tipo" htmlFor="upload-type">
              <Select
                id="upload-type"
                value={uploadType}
                onChange={(event) => setUploadType(event.target.value)}
              >
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Arquivo" htmlFor="upload-file">
              <input
                id="upload-file"
                ref={fileInput}
                type="file"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
                className="w-full text-xs file:mr-2 file:rounded-[var(--radius-panel)] file:border file:border-[var(--hairline)] file:bg-[var(--surface)] file:px-2 file:py-1 file:text-xs"
              />
            </Field>

            <p className="text-[11px] text-[var(--text-muted)]">
              O arquivo é guardado direto no banco, sem storage externo. O limite vem de{' '}
              <span className="font-mono">kycMaxFileSizeMb</span>.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
