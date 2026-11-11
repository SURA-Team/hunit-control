/**
 * Verificação manual da leitura das reservas no Hunit REAL (tasks.md, T020 e T022).
 *
 * Quem roda é o operador, no próprio terminal: e-mail, senha e token são digitados aqui (senha e
 * token sem aparecer na tela), ficam só na memória deste processo e nunca são gravados. O
 * programa usa o mesmo gateway do servidor (com a proteção de somente leitura: só GET nas rotas
 * de leitura) e, para um hotel e um período curto:
 * - lê todas as páginas da listagem com os filtros fixos da FR-010 e confere que o Hunit os
 *   respeitou (todas Canal Collect, check-in no período) — é a prova dos códigos de
 *   `DateTypeId` e `CollectTypeId` (T022);
 * - mostra o tamanho de página pedido e o devolvido pelo Hunit (T022, `PageSize` máximo);
 * - abre algumas reservas e mostra a classificação de cada uma (número, situação e
 *   classificação; nunca o nome do hóspede), para conferir com a tela do Hunit (SC-002);
 * - com `--parallel-hotel`, lê a primeira página de dois hotéis ao mesmo tempo e compara com a
 *   leitura um por vez (R-08, paralelismo).
 *
 * Nada é gravado no banco. Com `--save-dir <pasta>`, guarda as respostas JSON recebidas nessa
 * pasta (material da T020). Elas têm dados de hóspedes: use `test/fixtures/hunit/raw/`, ignorada
 * pelo Git, e anonimize antes de virar fixture (T021).
 *
 *   pnpm --filter @hunit/server build
 *   pnpm --filter @hunit/server hunit:reservations-check --hotel 101 --from 2026-11-01 --to 2026-11-03 --save-dir test/fixtures/hunit/raw
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  classifyReservation,
  isHotelbeds258,
  validatePeriod,
  type Classification,
  type Period,
} from '@hunit/domain';
import { ask, askHidden, commandArgs } from './cli-prompt.js';
import { CLASSIFICATION_LABELS } from './executions/hotel-collection.js';
import { HunitError } from './hunit/errors.js';
import type { HunitHotel, ReservationListItem } from './hunit/gateway.js';
import { HUNIT_API_ROUTES, type HunitApiRoute } from './hunit/network/api-client.js';
import { BOOKINGS_PAGE_SIZE } from './hunit/network/bookings.js';
import { PlaywrightHunitGateway } from './hunit/playwright-gateway.js';
import { createLogger } from './logging.js';
import { SecretRegistry } from './secrets.js';

const DEFAULT_WEB_URL = 'https://hunit.hsystem.com.br';
const DEFAULT_API_URL = 'https://hunit-api.hsystem.com.br';
const DEFAULT_MAX_DETAILS = 20;
/** Limite de segurança: a verificação é para um período curto, não uma consulta completa. */
const MAX_PAGES = 20;

const STATUS_LABELS = { active: 'ativa', cancelled: 'cancelada', unknown: 'não identificada' };

const ROUTE_NAMES: Readonly<Record<HunitApiRoute, string>> = {
  [HUNIT_API_ROUTES.currentUser]: 'GetCurrentUser',
  [HUNIT_API_ROUTES.bookings]: 'GetBookings',
  [HUNIT_API_ROUTES.bookingDetail]: 'BookingDetail',
};

function out(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function today(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function usage(): string {
  return [
    'Uso: hunit:reservations-check [--hotel <código>] [--from AAAA-MM-DD] [--to AAAA-MM-DD]',
    '       [--max-details <n>] [--parallel-hotel <código>] [--save-dir <pasta>]',
    `Padrões: período de hoje a 2 dias à frente; até ${DEFAULT_MAX_DETAILS} reservas abertas.`,
  ].join('\n');
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: commandArgs(),
    options: {
      hotel: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'max-details': { type: 'string' },
      'parallel-hotel': { type: 'string' },
      'save-dir': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    out(usage());
    return 0;
  }

  const period: Period = { from: values.from ?? today(), to: values.to ?? today(2) };
  try {
    validatePeriod(period);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${usage()}\n`);
    return 1;
  }
  const maxDetails = Number(values['max-details'] ?? DEFAULT_MAX_DETAILS);
  if (!Number.isInteger(maxDetails) || maxDetails < 0) {
    process.stderr.write(`--max-details deve ser um número inteiro a partir de 0.\n${usage()}\n`);
    return 1;
  }
  const saveDir = values['save-dir'] ? path.resolve(values['save-dir']) : null;

  if (!process.stdin.isTTY) {
    process.stderr.write('Rode este comando num terminal interativo (ele pede senha e token).\n');
    return 1;
  }

  const webUrl = process.env['HUNIT_WEB_URL'] || DEFAULT_WEB_URL;
  const apiUrl = process.env['HUNIT_API_URL'] || DEFAULT_API_URL;
  const secrets = new SecretRegistry();
  const logger = createLogger({ level: 'warn', secrets, destination: process.stderr });
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);

  let saved = 0;
  /** `pageSize` da última resposta de GetBookings (T022). */
  let lastPageSize: unknown = null;
  const onApiResponse = async (route: HunitApiRoute, body: unknown) => {
    if (route === HUNIT_API_ROUTES.bookings) {
      lastPageSize = (body as { items?: { pageSize?: unknown } } | null)?.items?.pageSize ?? null;
    }
    if (!saveDir) return;
    saved += 1;
    await mkdir(saveDir, { recursive: true });
    const name = `${stamp}-${String(saved).padStart(3, '0')}-${ROUTE_NAMES[route]}.json`;
    await writeFile(path.join(saveDir, name), secrets.scrub(JSON.stringify(body, null, 2)));
  };

  out(`Verificação da leitura das reservas no Hunit (${webUrl}).`);
  out(
    `Período de check-in: ${period.from} a ${period.to}. Somente leitura; nada é gravado no banco.`,
  );
  out('Nada do que você digitar é gravado. Ctrl+C cancela.');
  out();
  const username = await ask('E-mail do Hunit: ');
  const password = await askHidden('Senha (não aparece): ');
  secrets.register(username, password);

  const gateway = await PlaywrightHunitGateway.open(
    { webUrl, apiUrl, logger, onApiResponse },
    logger,
  );

  let exitCode = 0;
  try {
    out('Abrindo o Hunit e enviando usuário e senha...');
    if ((await gateway.login({ username, password })) === 'two_factor_required') {
      const token = await askHidden('Token do autenticador (não aparece): ');
      secrets.register(token);
      out('Enviando o token...');
      await gateway.submitToken(token);
    }
    const hotels = await gateway.listHotels();
    out(`OK: acesso concluído. Hotéis ativos na conta: ${hotels.length}.`);

    const hotel = await chooseHotel(hotels, values.hotel);
    if (!hotel) return 1;

    // Listagem completa do hotel (FR-010, FR-011).
    out();
    out(`${hotel.name} (${hotel.code}): lendo a listagem...`);
    const items: ReservationListItem[] = [];
    let totalPages = 1;
    let totalItems = 0;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
      const result = await gateway.searchReservations(hotel.code, period, page);
      totalPages = result.totalPages;
      totalItems = result.totalItems;
      items.push(...result.items);
      out(
        `  página ${page} de ${Math.max(totalPages, 1)}: ${result.items.length} reservas` +
          ` (pedidas ${BOOKINGS_PAGE_SIZE} por página; o Hunit usou ${String(lastPageSize)}).`,
      );
    }
    if (totalPages > MAX_PAGES) {
      out(`  (parei em ${MAX_PAGES} páginas; use um período menor para ler todas)`);
    }
    const unique = new Set(items.map((item) => item.reservationNumber)).size;
    out(
      `  Total informado pelo Hunit: ${totalItems} reservas; lidas: ${items.length} (${unique} números diferentes).`,
    );
    out('  Filtros conferidos: todas Canal Collect e com check-in dentro do período.');
    out('  → Confira na tela de reservas do Hunit, com os mesmos filtros, se o total bate.');

    // Detalhe e classificação de algumas reservas (SC-002).
    const toOpen = items
      .filter((item) => !isHotelbeds258(item.reservationNumber))
      .slice(0, maxDetails);
    const counts = new Map<Classification, number>();
    if (toOpen.length > 0) {
      out();
      out(`Abrindo ${toOpen.length} reservas (número — situação — classificação):`);
    }
    for (const item of items) {
      let classification: Classification;
      let status = item.reservationStatus;
      if (isHotelbeds258(item.reservationNumber)) {
        classification = classifyReservation(item.reservationNumber, null, status).classification;
      } else if (toOpen.includes(item)) {
        try {
          const { snapshot } = await gateway.readReservation(hotel.code, item);
          const result = classifyReservation(item.reservationNumber, snapshot, status);
          classification = result.classification;
          status = result.reservationStatus;
          out(
            `  ${item.reservationNumber} — ${STATUS_LABELS[status]} — ${CLASSIFICATION_LABELS[classification]}`,
          );
        } catch (error) {
          if (!(error instanceof HunitError) || error.code !== 'screen_not_recognized') throw error;
          classification = 'analysis_error';
          out(
            `  ${item.reservationNumber} — detalhe não reconhecido: ${secrets.scrub(error.message)}`,
          );
        }
      } else {
        continue;
      }
      counts.set(classification, (counts.get(classification) ?? 0) + 1);
    }
    if (counts.size > 0) {
      out();
      out('Resumo (reservas abertas e "258-"):');
      for (const [classification, count] of counts) {
        out(`  ${CLASSIFICATION_LABELS[classification]}: ${count}`);
      }
    }

    if (values['parallel-hotel']) {
      await checkParallel(gateway, hotels, hotel, values['parallel-hotel'], period);
    }
  } catch (error) {
    exitCode = 1;
    if (error instanceof HunitError) {
      out(`\nFALHOU (${error.code}): ${secrets.scrub(error.message)}`);
      if (error.evidence?.response && saveDir) {
        await mkdir(saveDir, { recursive: true });
        await writeFile(
          path.join(saveDir, `${stamp}-erro-${error.code}.json`),
          secrets.scrub(error.evidence.response),
        );
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      out(`\nFALHOU (erro inesperado): ${secrets.scrub(message)}`);
    }
  } finally {
    await gateway.close().catch(() => undefined);
  }

  if (saveDir) out(`\nRespostas salvas em: ${saveDir} (têm dados de hóspedes; não versionar).`);
  return exitCode;
}

async function chooseHotel(hotels: readonly HunitHotel[], code: string | undefined) {
  if (code === undefined) {
    out();
    for (const hotel of hotels) out(`  ${hotel.code}  ${hotel.name}`);
    code = await ask('Código do hotel a consultar: ');
  }
  const hotel = hotels.find((candidate) => candidate.code === code);
  if (!hotel) out(`O hotel "${code}" não está entre os hotéis ativos da conta.`);
  return hotel ?? null;
}

/**
 * R-08: lê a primeira página de dois hotéis ao mesmo tempo e compara com a leitura um por vez.
 * Se o hotel fosse estado da sessão, as leituras simultâneas trocariam os resultados.
 */
async function checkParallel(
  gateway: PlaywrightHunitGateway,
  hotels: readonly HunitHotel[],
  first: HunitHotel,
  secondCode: string,
  period: Period,
): Promise<void> {
  const second = hotels.find((hotel) => hotel.code === secondCode);
  out();
  if (!second || second.code === first.code) {
    out(
      `Paralelismo: o hotel "${secondCode}" não é outro hotel ativo da conta; verificação pulada.`,
    );
    return;
  }
  const ids = (items: readonly ReservationListItem[]) =>
    items.map((item) => item.bookingId).join(',');

  out(`Paralelismo (R-08): ${first.code} e ${second.code}, primeira página...`);
  const sequentialFirst = await gateway.searchReservations(first.code, period, 1);
  const sequentialSecond = await gateway.searchReservations(second.code, period, 1);
  const [parallelFirst, parallelSecond] = await Promise.all([
    gateway.searchReservations(first.code, period, 1),
    gateway.searchReservations(second.code, period, 1),
  ]);

  const same =
    ids(sequentialFirst.items) === ids(parallelFirst.items) &&
    ids(sequentialSecond.items) === ids(parallelSecond.items);
  const distinct = ids(sequentialFirst.items) !== ids(sequentialSecond.items);
  out(
    same
      ? '  Leitura simultânea igual à leitura um por vez: o hotel vai em cada requisição, não na sessão.'
      : '  ATENÇÃO: a leitura simultânea devolveu reservas diferentes. Manter HOTEL_CONCURRENCY=1.',
  );
  if (!distinct) {
    out(
      '  (os dois hotéis devolveram a mesma página; escolha hotéis com reservas diferentes no período)',
    );
  }
}

process.exitCode = await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
});
