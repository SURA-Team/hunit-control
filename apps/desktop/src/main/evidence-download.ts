/**
 * Download de evidências de falha (specs/002, FR-024, US3 cenário 6). O processo principal baixa o
 * arquivo com a chave, abre "Salvar como" e grava onde o operador escolher. A interface recebe só o
 * caminho gravado; o conteúdo (tela ou resposta do Hunit) nunca passa por ela. É a única gravação
 * de dados do Hunit que o app faz, e só por escolha do operador (FR-008a).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvidenceFile, Result } from '../shared/ipc-types.js';
import type { ApiClient } from './api-client.js';

export type SaveDialog = (options: {
  title: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}) => Promise<{ canceled: boolean; filePath?: string | undefined }>;

const FILES: Record<EvidenceFile, { extension: string; name: string }> = {
  screenshot: { extension: 'png', name: 'Captura de tela' },
  html: { extension: 'html', name: 'Página HTML' },
  response: { extension: 'json', name: 'Resposta do Hunit (JSON)' },
};

export interface SaveEvidenceOptions {
  api: Pick<ApiClient, 'downloadEvidence'>;
  evidenceId: string;
  file: EvidenceFile;
  /** Hotel ou início do id da execução, para o nome padrão (validado na ponte). */
  label?: string | undefined;
  showSaveDialog: SaveDialog;
  /** Pasta sugerida no "Salvar como" (a de Downloads do usuário). */
  defaultDirectory: string;
}

export async function saveEvidence(
  options: SaveEvidenceOptions,
): Promise<Result<{ savedTo: string } | null>> {
  // Baixa antes de perguntar onde salvar: evidência vencida é avisada sem abrir o diálogo.
  const downloaded = await options.api.downloadEvidence(options.evidenceId, options.file);
  if (!downloaded.ok) return downloaded;

  const { extension, name } = FILES[options.file];
  const fileName = `evidencia-${options.label ?? 'execucao'}-${options.evidenceId}.${extension}`;
  const chosen = await options.showSaveDialog({
    title: 'Salvar evidência',
    defaultPath: path.join(options.defaultDirectory, fileName),
    filters: [{ name, extensions: [extension] }],
  });
  if (chosen.canceled || !chosen.filePath) return { ok: true, data: null };

  await writeFile(chosen.filePath, downloaded.data.content);
  return { ok: true, data: { savedTo: chosen.filePath } };
}
