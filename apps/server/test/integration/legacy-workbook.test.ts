/**
 * Leitura da planilha do sistema anterior (specs/004, research R-02, R-03, FR-003) — tasks.md, T011.
 * Planilhas fictícias geradas no teste.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LegacyWorkbookError, readLegacyWorkbook } from '../../src/legacy-import/workbook.js';
import {
  legacyReservationRow,
  legacyTreatmentRow,
  writeLegacyWorkbook,
} from '../helpers/legacy-fixtures.js';

const dir = mkdtempSync(path.join(tmpdir(), 'legacy-workbook-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
const file = () => path.join(dir, `planilha-${++counter}.xlsx`);

async function failure(promise: Promise<unknown>): Promise<LegacyWorkbookError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LegacyWorkbookError);
  return error as LegacyWorkbookError;
}

describe('readLegacyWorkbook', () => {
  it('lê as duas abas pelo nome, com o número da linha da planilha', async () => {
    const workbook = await readLegacyWorkbook(
      await writeLegacyWorkbook(file(), {
        reservations: [legacyReservationRow({}, 1), legacyReservationRow({}, 2)],
        treatments: [legacyTreatmentRow('900001', { 'Valor manual': '12.50' })],
      }),
    );
    expect(workbook.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(workbook.reservations.map((item) => item.row)).toEqual([2, 3]);
    expect(workbook.reservations[1]?.cells.Reserva).toBe('900002');
    expect(workbook.treatments[0]?.cells['Valor manual']).toBe('12.50');
  });

  it('números chegam como texto exato e datas formatadas como Date', async () => {
    const workbook = await readLegacyWorkbook(
      await writeLegacyWorkbook(file(), {
        reservations: [
          legacyReservationRow({ 'Total da reserva': 1234.56, 'Cobrado em': { serial: 45778.5 } }),
        ],
      }),
    );
    const cells = workbook.reservations[0]!.cells;
    expect(cells['Total da reserva']).toBe('1234.56');
    expect(cells['Cobrado em']).toBe('45778.5');
    expect(cells.Entrada).toEqual(new Date('2026-05-10T00:00:00Z'));
  });

  it('ignora linhas totalmente vazias', async () => {
    const workbook = await readLegacyWorkbook(
      await writeLegacyWorkbook(file(), { reservations: [legacyReservationRow(), {}] }),
    );
    expect(workbook.reservations).toHaveLength(1);
  });

  it('coluna obrigatória ausente → missing_column com a aba e o nome', async () => {
    const error = await failure(
      readLegacyWorkbook(await writeLegacyWorkbook(file(), { omitReservationColumns: ['Saida'] })),
    );
    expect(error.code).toBe('missing_column');
    expect(error.detail).toBe('Reservas: Saida');
  });

  it('aba ausente → missing_sheet', async () => {
    const error = await failure(
      readLegacyWorkbook(await writeLegacyWorkbook(file(), { treatmentsSheet: 'Outra' })),
    );
    expect(error).toMatchObject({ code: 'missing_sheet', detail: 'Tratativas' });
  });

  it('arquivo inexistente e arquivo que não é planilha, sem repetir o conteúdo', async () => {
    expect((await failure(readLegacyWorkbook(path.join(dir, 'nao-existe.xlsx')))).code).toBe(
      'workbook_not_found',
    );
    const broken = file();
    writeFileSync(broken, 'MARCADOR-CONTEUDO não é um xlsx');
    const error = await failure(readLegacyWorkbook(broken));
    expect(error.code).toBe('unreadable_workbook');
    expect(error.message).not.toContain('MARCADOR');
  });
});
