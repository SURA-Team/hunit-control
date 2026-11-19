/**
 * Leitura de PDF para a pré-visualização (specs/003, T020, FR-018a, research R-08): o pdf.js é
 * chamado sem acesso à rede, sem formulários XFA e sem anotações, com o worker do próprio app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve() }));
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 300 * scale,
      height: 200 * scale,
    })),
    render,
  };
  const document = { numPages: 2, getPage: vi.fn(() => Promise.resolve(page)) };
  const destroy = vi.fn(() => Promise.resolve());
  return {
    render,
    page,
    document,
    destroy,
    getDocument: vi.fn(() => ({ promise: Promise.resolve(document), destroy })),
    GlobalWorkerOptions: { workerSrc: '' },
    AnnotationMode: { DISABLE: 0, ENABLE: 1 },
  };
});

vi.mock('pdfjs-dist', () => ({
  getDocument: pdfjs.getDocument,
  GlobalWorkerOptions: pdfjs.GlobalWorkerOptions,
  AnnotationMode: pdfjs.AnnotationMode,
}));

const { loadPdf, PDF_LOAD_OPTIONS } = await import('../../src/renderer/src/components/pdf');

beforeEach(() => {
  pdfjs.getDocument.mockClear();
  pdfjs.render.mockClear();
});

describe('loadPdf', () => {
  it('abre o documento sem rede e sem conteúdo ativo', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);

    const pdf = await loadPdf(bytes);

    expect(PDF_LOAD_OPTIONS).toEqual({
      enableXfa: false,
      disableAutoFetch: true,
      disableStream: true,
      useWorkerFetch: false,
    });
    const [options] = pdfjs.getDocument.mock.calls[0] as unknown as [
      { data: Uint8Array } & typeof PDF_LOAD_OPTIONS,
    ];
    expect(options).toMatchObject(PDF_LOAD_OPTIONS);
    // Recebe uma cópia: o pdf.js transfere o buffer para o worker.
    expect(options.data).toEqual(bytes);
    expect(options.data).not.toBe(bytes);
    expect(pdf.pageCount).toBe(2);
  });

  it('usa o worker empacotado com o app, não um endereço externo', () => {
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toContain('pdf.worker');
    expect(pdfjs.GlobalWorkerOptions.workerSrc).not.toMatch(/^https?:/);
  });

  it('desenha a página no canvas, na largura pedida, sem anotações', async () => {
    const pdf = await loadPdf(new Uint8Array([1]));
    const canvas = document.createElement('canvas');

    await pdf.renderPage(2, canvas, 600);

    expect(pdfjs.document.getPage).toHaveBeenCalledWith(2);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(pdfjs.render).toHaveBeenCalledWith(
      expect.objectContaining({ canvas, annotationMode: pdfjs.AnnotationMode.DISABLE }),
    );
  });

  it('close libera o documento', async () => {
    const pdf = await loadPdf(new Uint8Array([1]));

    pdf.close();

    expect(pdfjs.destroy).toHaveBeenCalled();
  });
});
