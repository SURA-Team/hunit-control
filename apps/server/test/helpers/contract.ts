/**
 * Confere respostas HTTP contra o contrato OpenAPI (constitution, princípio VII:
 * "endpoints MUST ter testes de contrato validados contra o OpenAPI").
 */
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadContract } from '../../src/http/contract.js';

const SCHEMA_KEY = 'contract';

const contract = loadContract();
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(contract.document, SCHEMA_KEY);

interface ResponseObject {
  $ref?: string;
  content?: Record<string, { schema?: unknown }>;
}

export interface HttpResponseLike {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
}

/** Escapa um trecho de JSON Pointer (RFC 6901). */
function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function pointer(...segments: string[]): string {
  return `#/${segments.map(pointerSegment).join('/')}`;
}

function lookup(jsonPointer: string): unknown {
  let current: unknown = contract.document;
  for (const raw of jsonPointer.slice(2).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function mediaTypeOf(response: HttpResponseLike): string {
  const header = response.headers['content-type'];
  return typeof header === 'string' ? (header.split(';', 1)[0] ?? '').trim().toLowerCase() : '';
}

/**
 * Falha (lançando um erro descritivo) se a resposta não estiver de acordo com o contrato:
 * status não declarado para a operação, tipo de conteúdo não declarado ou corpo fora do schema.
 */
export function expectMatchesContract(operationId: string, response: HttpResponseLike): void {
  const operation = contract.operations.get(operationId);
  if (!operation) throw new Error(`O contrato não tem a operação "${operationId}".`);

  const where = `${operationId} → ${response.statusCode}`;
  const status = String(response.statusCode);
  let responsePointer = pointer(
    'paths',
    operation.path,
    operation.method.toLowerCase(),
    'responses',
    status,
  );
  let declared = lookup(responsePointer) as ResponseObject | undefined;
  if (!declared) {
    throw new Error(`${where}: o contrato não declara este status para a operação.`);
  }
  if (declared.$ref) {
    responsePointer = declared.$ref;
    declared = lookup(responsePointer) as ResponseObject | undefined;
    if (!declared)
      throw new Error(`${where}: referência inválida no contrato (${responsePointer}).`);
  }

  if (!declared.content) {
    if (response.body !== '') {
      throw new Error(`${where}: o contrato não prevê corpo, mas a resposta tem corpo.`);
    }
    return;
  }

  const mediaType = mediaTypeOf(response);
  const media = declared.content[mediaType];
  if (!media) {
    throw new Error(
      `${where}: tipo de conteúdo "${mediaType}" não declarado ` +
        `(esperado: ${Object.keys(declared.content).join(', ')}).`,
    );
  }
  if (!media.schema) return;

  const schemaRef = `${SCHEMA_KEY}${responsePointer}/content/${pointerSegment(mediaType)}/schema`;
  const validate = ajv.getSchema(schemaRef) as ValidateFunction | undefined;
  if (!validate) throw new Error(`${where}: schema não encontrado no contrato (${schemaRef}).`);

  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new Error(`${where}: o corpo não é um JSON válido.`);
  }

  if (!validate(body)) {
    const problems = (validate.errors ?? [])
      .map((error) => `  ${error.instancePath || '(raiz)'} ${error.message ?? ''}`)
      .join('\n');
    throw new Error(`${where}: o corpo não segue o contrato:\n${problems}`);
  }
}

/** Operações do contrato, para testes que percorrem todas elas. */
export const contractOperations = [...contract.operations.values()];

export const contractDocument = contract.document;
