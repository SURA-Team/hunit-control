/**
 * Retornos do Comercial lidos a cada rodada (specs/005, US2; FR-014, FR-015, FR-018, FR-019;
 * research R-08): interpreta as colunas de retorno (`readReturn`, do domínio) e grava o que mudou.
 * Linhas sem novidade são puladas numa consulta só, sem uma transação por linha. Desde a 008
 * (research R-06), as colunas O e P e os relatos "Cobrada no Hunit" e "Cancelada" (era "Não
 * cobrada"; homologação, R-19).
 */
import {
  describeReturnReading,
  readReturn,
  reportChanged,
  returnChanged,
  returnSnapshot,
  type CommercialReturnReading,
} from '@hunit/domain';
import { sql } from 'drizzle-orm';
import { commercialKeyOf } from '../persistence/commercial-repo.js';
import {
  reportsByKeys,
  reportValuesOf,
  type ReportRow,
} from '../persistence/commercial-reports-repo.js';
import { recordReturnReading } from '../persistence/commercial-returns-repo.js';
import type { Database } from '../persistence/db.js';
import { commercialLines } from '../persistence/schema.js';
import type { ReturnsProcessor, ReturnsRoundSummary } from './sync.js';

/**
 * A leitura é a mesma já gravada? Retorno completo (ou de situação livre, specs/009) igual ao último
 * lido e sem relato; relato igual
 * ao guardado; vazio sem relato; com problema, o relato (se houver) fica como está.
 */
function sameAsStored(
  reading: CommercialReturnReading,
  lastRead: Parameters<typeof returnChanged>[0],
  report: ReportRow | null,
): boolean {
  switch (reading.kind) {
    case 'complete':
    case 'situation':
      return report === null && !returnChanged(lastRead, returnSnapshot(reading));
    case 'report':
      return report !== null && !reportChanged(reportValuesOf(report), reading.report);
    case 'empty':
      return report === null;
    case 'incomplete':
    case 'illegible':
      return true;
  }
}

export function createReturnsProcessor(db: Database): ReturnsProcessor {
  return async (rows, now) => {
    const summary: ReturnsRoundSummary = { received: 0, changed: 0, problems: 0 };
    if (rows.length === 0) return summary;

    const tuples = rows.map((row) => sql`(${row.key.hotelCode}, ${row.key.reservationNumber})`);
    const lines = await db
      .select({
        hotelCode: commercialLines.hotelCode,
        reservationNumber: commercialLines.reservationNumber,
        state: commercialLines.state,
        lastReadReturn: commercialLines.lastReadReturn,
        returnProblem: commercialLines.returnProblem,
      })
      .from(commercialLines)
      .where(
        sql`(${commercialLines.hotelCode}, ${commercialLines.reservationNumber}) in (${sql.join(tuples, sql`, `)})`,
      );
    const byKey = new Map(lines.map((line) => [commercialKeyOf(line), line]));
    const reports = new Map(
      (
        await reportsByKeys(
          db,
          rows.map((row) => row.key),
        )
      ).map((report) => [commercialKeyOf(report), report]),
    );

    for (const row of rows) {
      const mapKey = commercialKeyOf(row.key);
      const line = byKey.get(mapKey);
      if (!line || line.state !== 'open') continue;
      const reading = readReturn(row.cells);
      const problem = describeReturnReading(reading);
      if (problem !== null) summary.problems += 1;
      const unchanged =
        problem === line.returnProblem &&
        sameAsStored(reading, line.lastReadReturn ?? null, reports.get(mapKey) ?? null);
      if (unchanged) continue;

      const outcome = await recordReturnReading(db, { key: row.key, reading, now });
      if (outcome === 'received') summary.received += 1;
      if (outcome === 'changed') summary.changed += 1;
    }
    return summary;
  };
}
