/**
 * Leitura de PDF para a pré-visualização (specs/003, FR-018, FR-018a, research R-08).
 *
 * Usa o pdf.js só para **desenhar** as páginas num `canvas`, a partir dos bytes que o processo
 * principal entregou:
 * - nada é buscado na rede (`useWorkerFetch`, `disableStream` e `disableAutoFetch`; além disso a
 *   CSP da interface tem `connect-src 'none'`);
 * - nenhum script do PDF roda: o pdf.js só executa scripts pelo visualizador completo, que o app
 *   não usa; formulários XFA e anotações também ficam de fora;
 * - o worker é um arquivo do próprio app, empacotado pelo Vite (CSP `worker-src 'self'`).
 */
import { AnnotationMode, getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Opções fixas da leitura: sem rede e sem conteúdo ativo. */
export const PDF_LOAD_OPTIONS = {
  enableXfa: false,
  disableAutoFetch: true,
  disableStream: true,
  useWorkerFetch: false,
} as const;

export interface LoadedPdf {
  pageCount: number;
  /** Desenha a página (a primeira é 1) no `canvas`, com a largura pedida em pixels de CSS. */
  renderPage(pageNumber: number, canvas: HTMLCanvasElement, width: number): Promise<void>;
  /** Libera o documento e o worker. */
  close(): void;
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  // Cópia: o pdf.js transfere o buffer para o worker, o que esvaziaria o original.
  const task = getDocument({ data: bytes.slice(), ...PDF_LOAD_OPTIONS });
  const document = await task.promise;

  return {
    pageCount: document.numPages,
    async renderPage(pageNumber, canvas, width) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
      await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
    },
    close() {
      void task.destroy();
    },
  };
}
