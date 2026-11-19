/**
 * Retornos do Comercial lidos a cada rodada (specs/005, US2; FR-014, FR-015, FR-018, FR-019;
 * research R-08): interpreta as colunas de retorno (`readReturn`, do domínio) e grava o que mudou.
 * Linhas sem novidade são puladas numa consulta só, sem uma transação por linha.
 */
import { describeReturnReading, readReturn, returnChanged } from '@hunit/domain';
import { sql } from 'drizzle-orm';
import { commercialKeyOf } from '../persistence/commercial-repo.js';
import { recordReturnReading } from '../persistence/commercial-returns-repo.js';
import type { Database } from '../persistence/db.js';
import { commercialLines } from '../persistence/schema.js';
import type { ReturnsProcessor, ReturnsRoundSummary } from './sync.js';

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

    for (const row of rows) {
      const line = byKey.get(commercialKeyOf(row.key));
      if (!line || line.state !== 'open') continue;
      const reading = readReturn(row.cells);
      const problem = describeReturnReading(reading);
      if (problem !== null) summary.problems += 1;
      const unchanged =
        problem === line.returnProblem &&
        (reading.kind !== 'complete' ||
          !returnChanged(line.lastReadReturn ?? null, reading.values));
      if (unchanged) continue;

      const outcome = await recordReturnReading(db, { key: row.key, reading, now });
      if (outcome === 'received') summary.received += 1;
      if (outcome === 'changed') summary.changed += 1;
    }
    return summary;
  };
}
