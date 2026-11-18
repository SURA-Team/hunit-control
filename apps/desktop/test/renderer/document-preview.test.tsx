/**
 * Pré-visualização do documento na interface (specs/003, T020, FR-018, FR-018a, research R-08):
 * PDF pelo pdf.js sem rede nem conteúdo ativo, imagem por URL `blob:`, e-mail com cabeçalhos,
 * texto e lista de anexos, HTML isolado e aviso quando o arquivo não pôde ser lido.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentPreview,
  EMAIL_HTML_CSP,
  emailSrcDoc,
} from '../../src/renderer/src/components/DocumentPreview';
import type { DocumentPreview as Preview } from '../../src/shared/ipc-types';
import { renderWithApp } from './render';
import { pickedFile } from './treatment-fixtures';

const pdf = vi.hoisted(() => ({
  loadPdf: vi.fn(),
  renderPage: vi.fn<(page: number, canvas: HTMLCanvasElement, width: number) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  close: vi.fn(),
}));

vi.mock('../../src/renderer/src/components/pdf', () => ({ loadPdf: pdf.loadPdf }));

const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:teste-1');
const revokeObjectURL = vi.fn();

const email = (overrides: Partial<Extract<Preview, { type: 'email' }>> = {}): Preview => ({
  type: 'email',
  from: 'Financeiro Teste <financeiro@exemplo.test>',
  to: ['comercial@exemplo.test', 'outro@exemplo.test'],
  cc: [],
  subject: 'Pedido de cobrança de teste',
  date: new Date(2026, 10, 13, 10, 0).toISOString(),
  text: 'Favor cobrar a reserva de teste.',
  html: null,
  attachments: [],
  ...overrides,
});

beforeEach(() => {
  pdf.loadPdf.mockReset();
  pdf.renderPage.mockClear();
  pdf.close.mockClear();
  pdf.loadPdf.mockImplementation(() =>
    Promise.resolve({ pageCount: 3, renderPage: pdf.renderPage, close: pdf.close }),
  );
  // O jsdom não cria URLs de blob.
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cabeçalho', () => {
  it('mostra o nome e o tamanho do arquivo', () => {
    renderWithApp(<DocumentPreview file={pickedFile({ sizeBytes: 2048 })} />);

    expect(screen.getByText('comprovante.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });
});

describe('PDF', () => {
  const file = pickedFile({
    fileName: 'comprovante.pdf',
    mediaType: 'application/pdf',
    preview: { type: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]) },
  });

  it('desenha a primeira página e deixa navegar pelas outras', async () => {
    renderWithApp(<DocumentPreview file={file} />);

    await waitFor(() => expect(pdf.renderPage).toHaveBeenCalledTimes(1));
    expect(pdf.loadPdf).toHaveBeenCalledWith(new Uint8Array([37, 80, 68, 70]));
    expect(pdf.renderPage.mock.calls[0]?.[0]).toBe(1);
    expect(screen.getByRole('img', { name: 'Pré-visualização de comprovante.pdf' })).toBeVisible();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }));

    await waitFor(() => expect(pdf.renderPage.mock.calls.at(-1)?.[0]).toBe(2));
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
  });

  it('libera o documento ao sair da tela', async () => {
    const { unmount } = renderWithApp(<DocumentPreview file={file} />);
    await waitFor(() => expect(pdf.renderPage).toHaveBeenCalled());

    unmount();

    expect(pdf.close).toHaveBeenCalledTimes(1);
  });

  it('PDF que não abre vira o aviso de pré-visualização indisponível', async () => {
    pdf.loadPdf.mockImplementation(() => Promise.reject(new Error('PDF inválido')));

    renderWithApp(<DocumentPreview file={file} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível pré-visualizar este arquivo',
    );
  });
});

describe('imagem', () => {
  it('é mostrada por URL blob:, criada a partir dos bytes recebidos', () => {
    const { unmount } = renderWithApp(<DocumentPreview file={pickedFile()} />);

    const image = screen.getByRole('img', { name: 'Pré-visualização de comprovante.png' });
    expect(image).toHaveAttribute('src', 'blob:teste-1');
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:teste-1');
  });
});

describe('e-mail', () => {
  const emailFile = (preview: Preview) =>
    pickedFile({ fileName: 'pedido.eml', mediaType: 'message/rfc822', preview });

  it('mostra remetente, destinatários, assunto, data e o texto', () => {
    renderWithApp(<DocumentPreview file={emailFile(email({ cc: ['copia@exemplo.test'] }))} />);

    expect(screen.getByText('Financeiro Teste <financeiro@exemplo.test>')).toBeInTheDocument();
    expect(screen.getByText('comercial@exemplo.test; outro@exemplo.test')).toBeInTheDocument();
    expect(screen.getByText('copia@exemplo.test')).toBeInTheDocument();
    expect(screen.getByText('Pedido de cobrança de teste')).toBeInTheDocument();
    expect(screen.getByText('13/11/2026 10:00')).toBeInTheDocument();
    expect(screen.getByText('Favor cobrar a reserva de teste.')).toBeInTheDocument();
    expect(screen.queryByTitle('Mensagem do e-mail')).not.toBeInTheDocument();
  });

  it('lista os anexos, sem oferecer nenhuma forma de abri-los', () => {
    renderWithApp(
      <DocumentPreview
        file={emailFile(
          email({
            attachments: [
              { name: 'boleto.pdf', mediaType: 'application/pdf', sizeBytes: 5120 },
              { name: null, mediaType: null, sizeBytes: null },
            ],
          }),
        )}
      />,
    );

    const list = screen.getByRole('list', { name: 'Anexos do e-mail' });
    expect(list).toHaveTextContent('boleto.pdf — 5 KB');
    expect(list).toHaveTextContent('sem nome');
    expect(list.querySelectorAll('a, button')).toHaveLength(0);
  });

  it('mensagem só em HTML fica num iframe isolado: sem scripts e sem nada da internet', () => {
    const html =
      '<p>Favor cobrar.</p><img src="https://rastreador.exemplo.test/pixel.gif">' +
      '<script>window.parent.hunit.treatments.remove("x")</script>';
    renderWithApp(<DocumentPreview file={emailFile(email({ text: null, html }))} />);

    const frame = screen.getByTitle('Mensagem do e-mail');
    // `sandbox` vazio: sem scripts, formulários, navegação ou acesso à página do app.
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toBe(emailSrcDoc(html));
    expect(frame).not.toHaveAttribute('src');
    // A política vem antes do conteúdo e não libera rede, scripts nem imagens de fora.
    expect(emailSrcDoc(html).startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(EMAIL_HTML_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  });

  it('mensagem sem texto nem HTML diz isso', () => {
    renderWithApp(<DocumentPreview file={emailFile(email({ text: null, html: null }))} />);

    expect(screen.getByText('A mensagem não tem texto.')).toBeInTheDocument();
  });
});

describe('arquivo que não pôde ser lido', () => {
  it('avisa e mostra nome, tipo e tamanho (FR-018a)', () => {
    renderWithApp(
      <DocumentPreview
        file={pickedFile({
          fileName: 'pedido.msg',
          sizeBytes: 3 * 1024 * 1024,
          mediaType: 'application/vnd.ms-outlook',
          preview: { type: 'unavailable', reason: 'unreadable' },
        })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível pré-visualizar este arquivo',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Você pode continuar mesmo assim');
    expect(screen.getByText('pedido.msg')).toBeInTheDocument();
    expect(screen.getByText('3 MB')).toBeInTheDocument();
    expect(screen.getByText('Tipo: application/vnd.ms-outlook')).toBeInTheDocument();
  });
});
