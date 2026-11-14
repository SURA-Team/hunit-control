/**
 * Pré-visualização do documento escolhido, antes da confirmação (specs/003, FR-018, FR-018a,
 * research R-08). O conteúdo chega pronto do processo principal:
 * - PDF: desenhado em `canvas` pelo pdf.js, uma página por vez;
 * - imagem: por URL `blob:` criada aqui a partir dos bytes;
 * - e-mail: cabeçalhos, texto e a lista de anexos (os anexos não são abertos); mensagem só em
 *   HTML aparece num `iframe` isolado, sem scripts e sem nada da internet;
 * - arquivo que não pôde ser lido: aviso, com nome, tipo e tamanho.
 */
import { Alert, Button, Group, Paper, Stack, Table, Text } from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentPreview as Preview, PickedFile } from '../../../shared/ipc-types';
import { formatDateTime, formatFileSize } from '../presentation/format';
import { loadPdf, type LoadedPdf } from './pdf';

type EmailPreview = Extract<Preview, { type: 'email' }>;

const PDF_WIDTH = 640;

/**
 * Política da mensagem em HTML: nada de fora é carregado (nem imagens, que costumam ser
 * rastreadores) e nada é executado. O `sandbox` vazio do `iframe` reforça: sem scripts, sem
 * formulários, sem navegação.
 */
export const EMAIL_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export function emailSrcDoc(html: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${EMAIL_HTML_CSP}"><base target="_blank">${html}`;
}

function PdfPreview({ bytes, fileName }: { bytes: Uint8Array; fileName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let loaded: LoadedPdf | null = null;
    loadPdf(bytes).then(
      (document) => {
        loaded = document;
        if (active) setPdf(document);
        else document.close();
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      loaded?.close();
    };
  }, [bytes]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    pdf.renderPage(page, canvas.current, PDF_WIDTH).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [pdf, page]);

  if (failed) return <Unavailable />;
  return (
    <Stack gap="xs" align="center">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Pré-visualização de ${fileName}`}
        style={{ maxWidth: '100%', border: '1px solid var(--mantine-color-gray-3)' }}
      />
      {pdf && pdf.pageCount > 1 && (
        <Group gap="sm">
          <Button
            variant="default"
            size="xs"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            Página anterior
          </Button>
          <Text size="sm">
            Página {page} de {pdf.pageCount}
          </Text>
          <Button
            variant="default"
            size="xs"
            onClick={() => setPage(page + 1)}
            disabled={page >= pdf.pageCount}
          >
            Próxima página
          </Button>
        </Group>
      )}
      {!pdf && <Text c="dimmed">Abrindo o PDF…</Text>}
    </Stack>
  );
}

function ImagePreview({
  bytes,
  mediaType,
  fileName,
}: {
  bytes: Uint8Array;
  mediaType: string;
  fileName: string;
}) {
  // A URL blob: nasce quando o <img> entra na tela e é revogada quando ele sai (ou os bytes
  // mudam): nada fica guardado além da memória da própria página.
  const attach = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mediaType }));
      image.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [bytes, mediaType],
  );

  return (
    <img
      ref={attach}
      alt={`Pré-visualização de ${fileName}`}
      style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain' }}
    />
  );
}

function EmailField({ label, value }: { label: string; value: string | null }) {
  return (
    <Table.Tr>
      <Table.Th w={110} style={{ verticalAlign: 'top' }}>
        {label}
      </Table.Th>
      <Table.Td style={{ wordBreak: 'break-word' }}>{value ?? '—'}</Table.Td>
    </Table.Tr>
  );
}

function EmailPreviewView({ email }: { email: EmailPreview }) {
  return (
    <Stack gap="sm">
      <Table withRowBorders={false} verticalSpacing={2}>
        <Table.Tbody>
          <EmailField label="De" value={email.from} />
          <EmailField label="Para" value={email.to.length > 0 ? email.to.join('; ') : null} />
          {email.cc.length > 0 && <EmailField label="Cópia" value={email.cc.join('; ')} />}
          <EmailField label="Assunto" value={email.subject} />
          <EmailField label="Data" value={email.date ? formatDateTime(email.date) : null} />
        </Table.Tbody>
      </Table>

      {email.text !== null && (
        <Paper withBorder p="sm" radius="sm" mah={320} style={{ overflow: 'auto' }}>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {email.text}
          </Text>
        </Paper>
      )}
      {email.text === null && email.html !== null && (
        <iframe
          title="Mensagem do e-mail"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={emailSrcDoc(email.html)}
          style={{
            width: '100%',
            height: 320,
            border: '1px solid var(--mantine-color-gray-3)',
            background: 'white',
          }}
        />
      )}
      {email.text === null && email.html === null && (
        <Text size="sm" c="dimmed">
          A mensagem não tem texto.
        </Text>
      )}

      {email.attachments.length > 0 && (
        <div>
          <Text size="sm" fw={600}>
            Anexos do e-mail ({email.attachments.length})
          </Text>
          <Text size="xs" c="dimmed">
            Os anexos vão junto com o e-mail; eles não são abertos aqui.
          </Text>
          <ul aria-label="Anexos do e-mail" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {email.attachments.map((attachment, index) => (
              <li key={index}>
                <Text size="sm" span>
                  {attachment.name ?? 'sem nome'}
                  {attachment.sizeBytes !== null && ` — ${formatFileSize(attachment.sizeBytes)}`}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Stack>
  );
}

function Unavailable() {
  return (
    <Alert color="yellow" role="alert" title="Não foi possível pré-visualizar este arquivo">
      Confira pelo nome e pelo tamanho se é o arquivo certo. Você pode continuar mesmo assim: o
      servidor confere o arquivo ao receber.
    </Alert>
  );
}

export function DocumentPreview({
  file,
}: {
  file: Pick<PickedFile, 'fileName' | 'sizeBytes' | 'mediaType' | 'preview'>;
}) {
  const { preview } = file;
  return (
    <Stack gap="sm" data-testid="document-preview">
      <Group gap="xs" wrap="nowrap">
        <Text fw={600} style={{ wordBreak: 'break-word' }}>
          {file.fileName}
        </Text>
        <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {formatFileSize(file.sizeBytes)}
        </Text>
      </Group>
      {preview.type === 'pdf' && (
        <PdfPreview key={file.fileName} bytes={preview.bytes} fileName={file.fileName} />
      )}
      {preview.type === 'image' && (
        <ImagePreview
          bytes={preview.bytes}
          mediaType={preview.mediaType}
          fileName={file.fileName}
        />
      )}
      {preview.type === 'email' && <EmailPreviewView email={preview} />}
      {preview.type === 'unavailable' && (
        <>
          <Unavailable />
          <Text size="sm" c="dimmed">
            Tipo: {file.mediaType}
          </Text>
        </>
      )}
    </Stack>
  );
}
