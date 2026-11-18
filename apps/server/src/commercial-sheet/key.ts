/**
 * Chave da conta de serviço da planilha do Comercial (specs/005, research R-04). O arquivo vem da
 * pasta só de leitura montada no container; os valores sensíveis são registrados no
 * `SecretRegistry` assim que lidos, para que nenhum log, evento ou evidência os grave.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { SecretRegistry } from '../secrets.js';

/** O que o servidor usa da chave JSON de uma conta de serviço do Google. */
export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
}

const keySchema = z.object({
  type: z.literal('service_account'),
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
  private_key_id: z.string().optional(),
});

/** Erro ao ler a chave. A mensagem nunca cita o conteúdo nem o caminho completo do arquivo. */
export class ServiceAccountKeyError extends Error {
  constructor(reason: 'unreadable' | 'invalid') {
    super(
      reason === 'unreadable'
        ? 'Não foi possível ler o arquivo da chave da planilha do Comercial (COMMERCIAL_SHEET_KEY_FILE).'
        : 'O arquivo da chave da planilha do Comercial não é uma chave de conta de serviço do Google.',
    );
    this.name = 'ServiceAccountKeyError';
  }
}

/**
 * Interpreta o conteúdo da chave e registra os valores sensíveis (e o identificador da planilha)
 * no `SecretRegistry`.
 *
 * @throws ServiceAccountKeyError
 */
export function parseServiceAccountKey(
  content: string,
  secrets: SecretRegistry,
  spreadsheetId: string,
): ServiceAccountKey {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new ServiceAccountKeyError('invalid');
  }
  const parsed = keySchema.safeParse(json);
  if (!parsed.success) throw new ServiceAccountKeyError('invalid');
  const key = parsed.data;
  // Ficam registrados enquanto o servidor estiver de pé: a chave é usada o tempo todo.
  secrets.register(key.private_key, key.private_key_id, key.client_email, spreadsheetId);
  return { clientEmail: key.client_email, privateKey: key.private_key };
}

/**
 * Lê o arquivo da chave.
 *
 * @throws ServiceAccountKeyError
 */
export async function loadServiceAccountKey(
  keyFile: string,
  secrets: SecretRegistry,
  spreadsheetId: string,
): Promise<ServiceAccountKey> {
  let content: string;
  try {
    content = await readFile(keyFile, 'utf8');
  } catch {
    throw new ServiceAccountKeyError('unreadable');
  }
  return parseServiceAccountKey(content, secrets, spreadsheetId);
}
