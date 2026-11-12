import { CLASSIFICATIONS, RESERVATION_STATUSES } from '@hunit/domain';
import { describe, expect, it } from 'vitest';
import { OPERATOR_ONLY_OPERATIONS } from '../../src/http/auth.js';
import { PROBLEMS } from '../../src/http/problem.js';
import {
  classificationEnum,
  clientRoleEnum,
  evidenceKindEnum,
  executionEndReasonEnum,
  executionStatusEnum,
  hotelRunStatusEnum,
  reservationStatusEnum,
} from '../../src/persistence/schema.js';
import { contractDocument, contractOperations } from '../helpers/contract.js';

/**
 * As mesmas listas de valores aparecem em três lugares: domínio (TypeScript), banco (enums do
 * PostgreSQL) e contrato da API (OpenAPI). Estes testes garantem que ninguém altera uma sem
 * alterar as outras.
 */
function contractEnum(schemaName: string): string[] {
  const schemas = contractDocument.components?.['schemas'] as
    | Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }>
    | undefined;
  const values = schemas?.[schemaName]?.enum;
  if (!values) throw new Error(`O contrato não tem a enumeração "${schemaName}".`);
  return values;
}

describe('domínio × banco × contrato', () => {
  it('classificações (FR-013) são as mesmas, na mesma ordem', () => {
    expect(classificationEnum.enumValues).toEqual([...CLASSIFICATIONS]);
    expect(contractEnum('Classification')).toEqual([...CLASSIFICATIONS]);
  });

  it('o contrato conta reservas por todas as classificações', () => {
    const schemas = contractDocument.components?.['schemas'] as Record<
      string,
      { properties?: Record<string, unknown> }
    >;

    expect(Object.keys(schemas['ClassificationCounts']?.properties ?? {})).toEqual([
      ...CLASSIFICATIONS,
    ]);
  });

  it('situações da reserva (FR-014a) são as mesmas', () => {
    expect(reservationStatusEnum.enumValues).toEqual([...RESERVATION_STATUSES]);
    expect(contractEnum('ReservationStatus')).toEqual([...RESERVATION_STATUSES]);
  });

  it('estados da execução, motivos de encerramento e situações de hotel são os mesmos', () => {
    expect(contractEnum('ExecutionStatus')).toEqual(executionStatusEnum.enumValues);
    expect(contractEnum('ExecutionEndReason')).toEqual(executionEndReasonEnum.enumValues);
    expect(contractEnum('HotelRunStatus')).toEqual(hotelRunStatusEnum.enumValues);
  });

  it('perfis dos clientes e tipos de evidência são os mesmos (feature 002)', () => {
    const schemas = contractDocument.components?.['schemas'] as Record<
      string,
      { properties?: Record<string, { enum?: string[] }> }
    >;

    expect(contractEnum('ClientRole')).toEqual(clientRoleEnum.enumValues);
    expect(schemas['EvidenceSummary']?.properties?.['kind']?.enum).toEqual(
      evidenceKindEnum.enumValues,
    );
  });

  it('os códigos de erro do servidor são exatamente os do contrato', () => {
    const schemas = contractDocument.components?.['schemas'] as Record<
      string,
      { properties?: Record<string, { enum?: string[] }> }
    >;

    expect(Object.keys(PROBLEMS)).toEqual(schemas['Problem']?.properties?.['code']?.enum);
  });
});

describe('operações do contrato × níveis de acesso (FR-007)', () => {
  it('toda operação restrita a operador existe no contrato', () => {
    const operationIds = contractOperations.map((operation) => operation.operationId);

    for (const operationId of OPERATOR_ONLY_OPERATIONS) {
      expect(operationIds).toContain(operationId);
    }
  });

  it('toda operação que não é de leitura (GET) é restrita a operador', () => {
    const writeOperations = contractOperations
      .filter((operation) => operation.method !== 'GET')
      .map((operation) => operation.operationId)
      .sort();

    expect(writeOperations).toEqual([...OPERATOR_ONLY_OPERATIONS].sort());
  });

  it('só a verificação de saúde dispensa autenticação', () => {
    const publicOperations = contractOperations
      .filter((operation) => !operation.requiresAuth)
      .map((operation) => operation.operationId);

    expect(publicOperations).toEqual(['getHealth']);
  });

  it('toda operação com corpo aceita somente JSON', () => {
    for (const operation of contractOperations) {
      if (operation.requestBodyTypes) {
        expect(operation.requestBodyTypes, operation.operationId).toEqual(['application/json']);
      }
    }
  });
});
