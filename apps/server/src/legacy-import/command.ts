/**
 * Comando `legacy-import` (specs/004, contracts/cli.md): simula, associa hotéis, importa e mostra o
 * relatório da importação do histórico do sistema anterior. Comando administrativo de implantação
 * (constitution, princípio III): só no servidor, nunca acessa o Hunit (FR-001, FR-002).
 *
 *   legacy-import simulate --xlsx <arquivo> --files <pasta>
 *   legacy-import hotels [--set <código> --hotel <código do catálogo> | --set <código> --none | --accept-proposals]
 *   legacy-import run --simulation <id> --xlsx <arquivo> --files <pasta>
 *   legacy-import report --id <id>
 *
 * Saída só com contagens, linhas, chaves e motivos (FR-018, research R-11).
 */
import { parseArgs } from 'node:util';
import { proposeHotel } from '@hunit/domain';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { CliIo } from '../cli.js';
import type { DatabaseConnection } from '../persistence/db.js';
import { isConstraintViolation, PG_UNIQUE_VIOLATION } from '../persistence/errors.js';
import {
  ImportInProgressError,
  acceptHotelProposals,
  confirmedHotelMappings,
  countIncompleteImports,
  createImportRecord,
  ensureLegacyAuthor,
  findImportRecord,
  finishImportRecord,
  listHotelMappings,
  setHotelMapping,
  upsertHotelProposals,
  withImportLock,
} from '../persistence/legacy-import-repo.js';
import {
  hotels,
  legacyReservations,
  reservations,
  type LegacyImportDifference,
  type LegacyImportEntity,
} from '../persistence/schema.js';
import { applyEntry, loadReservationState } from './applier.js';
import { LegacyAttachments } from './attachments.js';
import { computeFingerprint } from './fingerprint.js';
import {
  Tally,
  entryKeys,
  finalCounts,
  planEntry,
  prepareImport,
  type PreparedImport,
} from './planner.js';
import { formatReport } from './report.js';
import { LegacyWorkbookError, readLegacyWorkbook, type LegacyWorkbook } from './workbook.js';

const USAGE = `Uso:
  legacy-import simulate --xlsx <arquivo> --files <pasta>
      Lê e confere a planilha e os anexos do sistema anterior, sem gravar reservas nem documentos.
  legacy-import hotels
      Lista os hotéis do sistema anterior e a associação de cada um.
  legacy-import hotels --set <código> --hotel <código do catálogo>
  legacy-import hotels --set <código> --none
  legacy-import hotels --accept-proposals
      Confirma, troca ou deixa sem associação; ou confirma todas as propostas.
  legacy-import run --simulation <id> --xlsx <arquivo> --files <pasta>
      Importa, se a planilha, a pasta e a associação forem as mesmas da simulação.
  legacy-import report --id <id>
      Mostra de novo o relatório de uma simulação ou importação.
`;

const PROGRESS_EVERY = 500;
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/** Erro esperado: a mensagem é segura para mostrar (sem conteúdo da planilha). */
class LegacyImportError extends Error {}

export interface LegacyImportOptions {
  /** Relógio (os testes fixam o momento). */
  now?: () => Date;
  /** Chamado entre reservas na importação; `true` = parar (sinal de encerramento). */
  shouldStop?: () => boolean;
}

function workbookMessage(error: LegacyWorkbookError): string {
  switch (error.code) {
    case 'workbook_not_found':
      return 'Planilha não encontrada: confira o caminho de --xlsx.';
    case 'unreadable_workbook':
      return 'Não foi possível ler a planilha: confira se é a cópia .xlsx baixada da planilha.';
    case 'missing_sheet':
      return `Aba ausente na planilha: ${error.detail ?? ''}.`;
    case 'missing_column':
      return `Coluna obrigatória ausente: ${error.detail ?? ''}.`;
  }
}

function requireOption(value: string | undefined, option: string): string {
  if (!value) throw new LegacyImportError(`Informe ${option}.\n\n${USAGE}`);
  return value;
}

function retentionYears(io: CliIo): number {
  const value = Number.parseInt(io.env.RESERVATION_RETENTION_YEARS ?? '5', 10);
  return Number.isInteger(value) && value >= 1 ? value : 5;
}

const businessDate = (date: Date): string =>
  date.toLocaleDateString('sv-SE', { timeZone: BUSINESS_TIME_ZONE });

interface Loaded {
  workbook: LegacyWorkbook;
  attachments: LegacyAttachments;
  prepared: PreparedImport;
  mappings: Map<string, string>;
  fingerprint: string;
}

async function readWorkbook(xlsx: string): Promise<LegacyWorkbook> {
  try {
    return await readLegacyWorkbook(xlsx);
  } catch (error) {
    if (error instanceof LegacyWorkbookError) throw new LegacyImportError(workbookMessage(error));
    throw error;
  }
}

async function load(
  connection: DatabaseConnection,
  io: CliIo,
  workbook: LegacyWorkbook,
  folder: string,
  now: Date,
): Promise<Loaded> {
  let attachments: LegacyAttachments;
  try {
    attachments = await LegacyAttachments.open(folder);
  } catch {
    throw new LegacyImportError('Pasta de anexos não encontrada: confira o caminho de --files.');
  }

  const mappings = await confirmedHotelMappings(connection.db);
  const prepared = await prepareImport(workbook, attachments, mappings, {
    today: businessDate(now),
    retentionYears: retentionYears(io),
  });
  const fingerprint = computeFingerprint({
    workbookSha256: workbook.sha256,
    files: prepared.referencedFiles,
    mappings,
  });
  return { workbook, attachments, prepared, mappings, fingerprint };
}

/** Atualiza as propostas dos hotéis vistos na planilha (research R-10). */
async function refreshHotelProposals(
  connection: DatabaseConnection,
  workbook: LegacyWorkbook,
): Promise<void> {
  const seen = new Map<string, string>();
  for (const { cells } of workbook.reservations) {
    const key = typeof cells['Codigo hotel'] === 'string' ? cells['Codigo hotel'].trim() : '';
    const name = typeof cells.Hotel === 'string' ? cells.Hotel.trim() : '';
    if (key && name && !seen.has(key)) seen.set(key, name);
  }
  const catalog = await connection.db.select({ code: hotels.code, name: hotels.name }).from(hotels);
  await upsertHotelProposals(
    connection.db,
    [...seen].map(([legacyKey, legacyName]) => ({
      legacyKey,
      legacyName,
      proposal: proposeHotel({ key: legacyKey, name: legacyName }, catalog),
    })),
  );
}

/** Reservas `not_virtual_card` gravadas sem origem no sistema anterior (research R-04). */
async function countObsoleteClassification(connection: DatabaseConnection): Promise<number> {
  const [row] = await connection.db
    .select({ value: count() })
    .from(reservations)
    .leftJoin(
      legacyReservations,
      and(
        eq(legacyReservations.hotelCode, reservations.hotelCode),
        eq(legacyReservations.reservationNumber, reservations.reservationNumber),
      ),
    )
    .where(
      and(
        eq(reservations.classification, 'not_virtual_card'),
        isNull(legacyReservations.hotelCode),
      ),
    );
  return row?.value ?? 0;
}

async function printReport(
  connection: DatabaseConnection,
  io: CliIo,
  id: string,
  nextStep?: string,
): Promise<void> {
  const record = await findImportRecord(connection.db, id);
  if (!record) throw new LegacyImportError(`Não existe simulação nem importação com o id ${id}.`);
  const mappings = await listHotelMappings(connection.db);
  const catalog = await connection.db.select({ code: hotels.code, name: hotels.name }).from(hotels);
  io.stdout(
    formatReport({
      record,
      pendingHotels: mappings.filter((mapping) => mapping.decision !== 'confirmed'),
      catalogNames: new Map(catalog.map((hotel) => [hotel.code, hotel.name])),
      ...(nextStep ? { nextStep } : {}),
    }),
  );
}

async function simulate(
  args: string[],
  io: CliIo,
  connection: DatabaseConnection,
  options: LegacyImportOptions,
): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { xlsx: { type: 'string' }, files: { type: 'string' } },
  });
  const xlsx = requireOption(values.xlsx, '--xlsx <arquivo>');
  const folder = requireOption(values.files, '--files <pasta>');
  const now = (options.now ?? (() => new Date()))();

  const id = await withImportLock(connection.pool, async () => {
    const workbook = await readWorkbook(xlsx);
    await refreshHotelProposals(connection, workbook);
    const loaded = await load(connection, io, workbook, folder, now);

    const tally = new Tally();
    tally.absorb(loaded.prepared.tally);
    for (const key of entryKeys(loaded.prepared)) {
      const reservation = loaded.prepared.reservations.get(key);
      const treatment = loaded.prepared.treatments.get(key);
      const hotelCode = reservation?.hotelCode ?? treatment!.hotelCode!;
      const number = reservation?.parsed.reservationNumber ?? treatment!.reservationNumber;
      const state = await loadReservationState(connection.db, hotelCode, number);
      planEntry({ key, reservation, treatment, files: loaded.prepared.files, state, now, tally });
    }
    tally.warn('obsolete_classification_in_use', await countObsoleteClassification(connection));
    tally.warn('previous_import_incomplete', await countIncompleteImports(connection.db));

    const recordId = await createImportRecord(connection.db, {
      kind: 'simulation',
      fingerprint: loaded.fingerprint,
    });
    await finishImportRecord(connection.db, recordId, {
      status: 'completed',
      counts: finalCounts(tally, loaded.prepared.unreferencedFiles),
      issues: tally.issues,
      warnings: tally.warningList(),
      outcomes: tally.outcomes,
    });
    return recordId;
  });

  await printReport(
    connection,
    io,
    id,
    `Para importar: legacy-import run --simulation ${id} --xlsx <arquivo> --files <pasta>`,
  );
}

/** Desfechos que mudaram desde a simulação (FR-005a). */
function differencesBetween(
  simulated: Readonly<Record<string, string>>,
  imported: Readonly<Record<string, string>>,
): LegacyImportDifference[] {
  const keys = new Set([...Object.keys(simulated), ...Object.keys(imported)]);
  const differences: LegacyImportDifference[] = [];
  for (const key of [...keys].sort()) {
    const before = simulated[key] ?? 'ausente';
    const after = imported[key] ?? 'ausente';
    if (before === after) continue;
    const [legacyHotel = '', reservationNumber = '', slot = ''] = key.split('|');
    const entity: LegacyImportEntity =
      slot === 'proof'
        ? 'proof'
        : slot === 'manual_amount'
          ? 'manual_amount'
          : slot === 'request' || slot === 'old' || slot.startsWith('treatment')
            ? 'request'
            : 'reservation';
    differences.push({
      legacyHotel,
      reservationNumber,
      entity,
      simulated: before,
      imported: after,
    });
  }
  return differences;
}

async function run(
  args: string[],
  io: CliIo,
  connection: DatabaseConnection,
  options: LegacyImportOptions,
): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      simulation: { type: 'string' },
      xlsx: { type: 'string' },
      files: { type: 'string' },
    },
  });
  const simulationId = requireOption(values.simulation, '--simulation <id>');
  const xlsx = requireOption(values.xlsx, '--xlsx <arquivo>');
  const folder = requireOption(values.files, '--files <pasta>');
  const clock = options.now ?? (() => new Date());

  const result = await withImportLock(connection.pool, async () => {
    const simulation = /^[0-9a-f-]{36}$/i.test(simulationId)
      ? await findImportRecord(connection.db, simulationId)
      : null;
    if (simulation?.kind !== 'simulation' || simulation.status !== 'completed') {
      throw new LegacyImportError(`Não existe simulação concluída com o id ${simulationId}.`);
    }

    const now = clock();
    const loaded = await load(connection, io, await readWorkbook(xlsx), folder, now);
    if (loaded.fingerprint !== simulation.fingerprint) {
      throw new LegacyImportError(
        'A planilha, a pasta ou a associação de hotéis mudou desde a simulação: simule de novo.',
      );
    }

    const authorId = await ensureLegacyAuthor(connection.db);
    const importId = await createImportRecord(connection.db, {
      kind: 'import',
      fingerprint: loaded.fingerprint,
      simulationId,
    });

    const tally = new Tally();
    tally.absorb(loaded.prepared.tally);
    const keys = entryKeys(loaded.prepared);
    let done = 0;
    let status: 'completed' | 'interrupted' | 'failed' = 'completed';
    let failure: string | null = null;

    for (const key of keys) {
      if (options.shouldStop?.()) {
        status = 'interrupted';
        break;
      }
      const reservation = loaded.prepared.reservations.get(key);
      const treatment = loaded.prepared.treatments.get(key);
      const hotelCode = reservation?.hotelCode ?? treatment!.hotelCode!;
      const number = reservation?.parsed.reservationNumber ?? treatment!.reservationNumber;
      const entryNow = clock();

      let applied = false;
      for (let attempt = 1; !applied; attempt += 1) {
        const entryTally = new Tally();
        try {
          await connection.db.transaction(async (tx) => {
            const state = await loadReservationState(tx, hotelCode, number, true);
            const plan = planEntry({
              key,
              reservation,
              treatment,
              files: loaded.prepared.files,
              state,
              now: entryNow,
              tally: entryTally,
            });
            if (plan) {
              await applyEntry(tx, plan, reservation, {
                importId,
                authorId,
                attachments: loaded.attachments,
                now: entryNow,
              });
            }
          });
          tally.absorb(entryTally);
          applied = true;
        } catch (error) {
          // A reserva foi gravada por uma execução no meio: na segunda vez ela já existe (R-06).
          if (attempt === 1 && isConstraintViolation(error, PG_UNIQUE_VIOLATION)) continue;
          const row = reservation?.parsed.row ?? treatment?.row ?? 0;
          const sheet = reservation ? 'Reservas' : 'Tratativas';
          failure = `Falha na linha ${row} da aba ${sheet}: a importação parou; o que foi gravado antes está completo. Rode uma nova simulação e importe de novo.`;
          status = 'failed';
          break;
        }
      }
      if (status === 'failed') break;

      done += 1;
      if (done % PROGRESS_EVERY === 0) io.stdout(`${done} de ${keys.length} reservas\n`);
    }

    await finishImportRecord(connection.db, importId, {
      status,
      counts: finalCounts(tally, loaded.prepared.unreferencedFiles),
      issues: tally.issues,
      warnings: tally.warningList(),
      outcomes: tally.outcomes,
      differences: differencesBetween(simulation.outcomes, tally.outcomes),
    });
    return { importId, status, failure };
  });

  if (result.failure) io.stderr(`${result.failure}\n`);
  if (result.status === 'interrupted') {
    io.stderr(
      'Importação interrompida: o que foi gravado está completo. Simule e importe de novo para terminar.\n',
    );
  }
  await printReport(connection, io, result.importId);
  return result.status === 'completed' ? 0 : 1;
}

async function hotelsCommand(
  args: string[],
  io: CliIo,
  connection: DatabaseConnection,
): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      set: { type: 'string' },
      hotel: { type: 'string' },
      none: { type: 'boolean' },
      'accept-proposals': { type: 'boolean' },
    },
  });

  if (values['accept-proposals']) {
    const accepted = await acceptHotelProposals(connection.db);
    io.stdout(`${accepted} associação(ões) confirmada(s).\n`);
  } else if (values.set !== undefined) {
    if (values.none === (values.hotel !== undefined)) {
      throw new LegacyImportError('Com --set, informe --hotel <código do catálogo> ou --none.');
    }
    if (values.hotel !== undefined) {
      const [exists] = await connection.db
        .select({ code: hotels.code })
        .from(hotels)
        .where(eq(hotels.code, values.hotel));
      if (!exists) throw new LegacyImportError(`Não existe hotel ${values.hotel} no catálogo.`);
    }
    const updated = await setHotelMapping(connection.db, values.set, values.hotel ?? null);
    if (!updated) {
      throw new LegacyImportError(
        `O hotel ${values.set} do sistema anterior ainda não apareceu numa simulação.`,
      );
    }
    io.stdout(
      values.hotel
        ? `${values.set} associado a ${values.hotel}.\n`
        : `${values.set} fica sem associação (as linhas dele são recusadas).\n`,
    );
  }

  const mappings = await listHotelMappings(connection.db);
  const catalog = await connection.db.select({ code: hotels.code, name: hotels.name }).from(hotels);
  const names = new Map(catalog.map((hotel) => [hotel.code, hotel.name]));
  const decisionText = {
    proposed: 'proposta',
    confirmed: 'confirmado',
    unmapped: 'sem associação',
  };
  io.stdout(mappings.length === 0 ? 'Nenhum hotel do sistema anterior: rode uma simulação.\n' : '');
  for (const mapping of mappings) {
    const hotel = mapping.hotelCode
      ? `${mapping.hotelCode} (${names.get(mapping.hotelCode) ?? '?'})`
      : 'sem hotel';
    io.stdout(
      `${mapping.legacyKey}   "${mapping.legacyName}"   ${decisionText[mapping.decision]}   ${hotel}\n`,
    );
  }
}

/** Executa `legacy-import`; devolve o código de saída. */
export async function legacyImportCommand(
  args: string[],
  io: CliIo,
  connection: DatabaseConnection,
  options: LegacyImportOptions = {},
): Promise<number> {
  const [subcommand, ...rest] = args;
  try {
    switch (subcommand) {
      case 'simulate':
        await simulate(rest, io, connection, options);
        return 0;
      case 'run':
        return await run(rest, io, connection, options);
      case 'hotels':
        await hotelsCommand(rest, io, connection);
        return 0;
      case 'report': {
        const { values } = parseArgs({ args: rest, options: { id: { type: 'string' } } });
        const id = requireOption(values.id, '--id <id>');
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          throw new LegacyImportError(`Não existe simulação nem importação com o id ${id}.`);
        }
        await printReport(connection, io, id);
        return 0;
      }
      default:
        io.stderr(
          subcommand && subcommand !== '--help'
            ? `Subcomando desconhecido: ${subcommand}\n\n${USAGE}`
            : USAGE,
        );
        return subcommand === '--help' ? 0 : 1;
    }
  } catch (error) {
    if (error instanceof LegacyImportError || error instanceof ImportInProgressError) {
      io.stderr(`${error.message}\n`);
    } else if (error instanceof TypeError && 'code' in error) {
      // Erro do parseArgs: opção desconhecida ou sem valor.
      io.stderr(`${error.message}\n\n${USAGE}`);
    } else {
      // Pode conter dados da planilha: só o tipo do erro (research R-11).
      io.stderr(
        `Falha inesperada na importação (${error instanceof Error ? error.name : 'erro'}).\n`,
      );
    }
    return 1;
  }
}

export { differencesBetween };
