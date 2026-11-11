/**
 * Anonimização das fixtures do Hunit (specs/001, tasks.md T021, research R-13/R-13a).
 *
 * Transforma o material bruto guardado pelos comandos `hunit:login-check` e
 * `hunit:reservations-check` (pasta `test/fixtures/hunit/raw/`, ignorada pelo Git) em fixtures
 * que podem ser versionadas: `html/real/` (telas de login e token) e `json/real/` (respostas da
 * API), mais um `real/manifest.json` com o que cada uma deve produzir nos testes.
 *
 * Princípios:
 * - **lista de permissão**: no JSON, só ficam os textos de campos conhecidos e inofensivos
 *   (situações, nomes de canal, datas) e os números de campos conhecidos (ids, valores, páginas).
 *   Todo o resto é trocado por um valor fictício do mesmo tipo; os caminhos trocados de forma
 *   genérica aparecem no relatório (sem os valores), para revisão;
 * - o mesmo valor original vira sempre o mesmo valor fictício (a reserva da listagem continua
 *   ligada ao detalhe), e o prefixo "258-" do número da reserva é mantido (regra 1 da FR-013);
 * - no HTML: sem valores de campos, sem scripts nem recursos externos (os testes não podem
 *   acessar o Hunit), sem e-mails nem parâmetros de sessão; o destino dos formulários vira
 *   `{{action}}` e o usuário já apagado vira `{{username}}`;
 * - **conferência final**: todo texto original trocado é procurado no resultado; se aparecer,
 *   nada é gravado (`FixtureLeakError`, que cita só o caminho, nunca o valor).
 */
import { classifyReservation, type Classification, type ReservationStatus } from '@hunit/domain';
import { sanitizeHtml } from './evidence/sanitize.js';
import { snapshotOf } from './hunit/network/booking-detail.js';
import { listItemsOf } from './hunit/network/bookings.js';
import { REDACTED } from './secrets.js';

export interface RawFile {
  /** Nome do arquivo na pasta bruta (ex.: `2026-11-11T20-44-33-two_factor.html`). */
  name: string;
  content: string;
}

export interface FixtureFile {
  /** Caminho relativo a `test/fixtures/hunit/`, com "/". */
  path: string;
  content: string;
}

/** Telas reconhecidas pela camada do Hunit (Page Objects). */
export type RealScreen =
  'hunit_entry' | 'login' | 'login_error' | 'two_factor' | 'two_factor_error' | 'token_expired';

export interface RealFixturesManifest {
  generatedAt: string;
  html: Array<{ file: string; screen: RealScreen }>;
  currentUser: string | null;
  bookings: string[];
  details: Array<{
    file: string;
    bookingId: string;
    /** Página da listagem em que a reserva aparece. */
    bookingsFile: string;
    expected: { classification: Classification; reservationStatus: ReservationStatus };
  }>;
}

export interface AnonymizeReport {
  /** Caminhos de campo (sem valores) trocados por um valor genérico: revisar e, se forem
   * inofensivos e úteis, acrescentar à lista de permissão. */
  genericFields: string[];
  /** Arquivos brutos não usados e o motivo. */
  skipped: Array<{ name: string; reason: string }>;
}

export interface AnonymizeResult {
  files: FixtureFile[];
  manifest: RealFixturesManifest;
  report: AnonymizeReport;
}

/** Algum valor original sobrou no resultado. Cita só onde, nunca o valor. */
export class FixtureLeakError extends Error {
  constructor(readonly locations: string[]) {
    super(
      `Anonimização incompleta: valores originais encontrados em ${locations.join(', ')}. ` +
        'Nada foi gravado.',
    );
    this.name = 'FixtureLeakError';
  }
}

export const MANIFEST_PATH = 'real/manifest.json';

const RAW_NAME = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.(html|json|png)$/;

/** Tela de cada arquivo bruto de HTML (pelo nome que os comandos de verificação dão). */
const SCREEN_OF: Readonly<Record<string, RealScreen>> = {
  hunit_entry: 'hunit_entry',
  login: 'login',
  two_factor: 'two_factor',
  'erro-invalid_credentials': 'login_error',
  'erro-invalid_token': 'two_factor_error',
  'erro-two_factor_timeout': 'token_expired',
};

const FILE_OF_SCREEN: Readonly<Record<RealScreen, string>> = {
  hunit_entry: 'hunit-entry.html',
  login: 'login.html',
  login_error: 'login-error.html',
  two_factor: 'two-factor.html',
  two_factor_error: 'two-factor-error.html',
  token_expired: 'token-expired.html',
};

// ---------------------------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------------------------

/** Textos mantidos como vieram: situações, rótulos e canais, sem dado pessoal. */
const KEEP_TEXT_FIELDS = new Set([
  'prePaymentStatus',
  'status',
  'statusName',
  'statusLabel',
  'collectTypeLabel',
  'collectTypeName',
  'channelName',
  'currency',
  'currencyCode',
  'paymentTypeLabel',
  'language',
]);

/** Números mantidos: ids internos, situações, valores, contagens e paginação. */
const KEEP_NUMBER_FIELD = new RegExp(
  '^(' +
    [
      'id|.*Id|page|pageSize',
      'total|total[A-Z]\\w*|\\w*Total|totals',
      'valueCharged|installmentValue|numberOfInstallments|comission|commission',
      '\\w*[aA]mount|value|\\w*Value|\\w*Price|price',
      // Totais da reserva e contagens (hóspedes, unidades, reservas da página)
      'diarias|extras|interests|taxes|taxesIncluded|prePaidToChannel|valueToCharge',
      '\\w*Count|numberOfUnits|actives|bookingsQuantity|cancelledes',
    ].join('|') +
    ')$',
);

/** Ramos com dados de pessoas ou de cartão: tudo é trocado, inclusive números. */
const PERSONAL_BRANCH =
  /^(guest|guests|customer|holder|contact|contacts|address|phone|phones|document|documents|card|creditCard|payer|billing)$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const DIGITS = /^\d+$/;
const SINGLE_WORD = /^[A-Za-z]{1,20}$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Gera valores fictícios estáveis: o mesmo original vira sempre o mesmo fictício. */
class FakeValues {
  private readonly byKind = new Map<string, Map<string, string>>();

  get(kind: string, original: string, make: (n: number) => string): string {
    let values = this.byKind.get(kind);
    if (!values) {
      values = new Map();
      this.byKind.set(kind, values);
    }
    let fake = values.get(original);
    if (fake === undefined) {
      fake = make(values.size + 1);
      values.set(original, fake);
    }
    return fake;
  }
}

const pad = (n: number, size = 4) => String(n).padStart(size, '0');

interface JsonContext {
  fakes: FakeValues;
  /** Textos originais trocados, para a conferência final. */
  replaced: Set<string>;
  /** Textos originais mantidos (não acusam vazamento). */
  kept: Set<string>;
  genericFields: Set<string>;
}

function fakeText(key: string, path: string, original: string, context: JsonContext): string {
  const { fakes } = context;
  switch (key) {
    case 'channelIdentifier': {
      const prefix = original.startsWith('258-') ? '258-' : 'RES-';
      return fakes.get('reservation', original, (n) => `${prefix}${pad(n)}`);
    }
    case 'guestFullName':
    case 'guestName':
    case 'fullName':
      return fakes.get('guest', original, (n) => `Hóspede Fictício ${n}`);
    case 'displayName':
      return fakes.get('user', original, (n) => `Usuário Fictício ${n}`);
    case 'email':
      return fakes.get('email', original, (n) => `usuario${n}@exemplo.test`);
    case 'user':
      return fakes.get('operator', original, (n) => `Operador Fictício ${n}`);
    case 'authorizationCode':
      return fakes.get('authorization', original, (n) => `AUT-${pad(n)}`);
    case 'transactionId':
      return fakes.get('transaction', original, (n) => `TRX-${pad(n)}`);
    case 'processorReferenceNumber':
      return fakes.get('reference', original, (n) => `REF-${pad(n)}`);
    case 'pmsIdentifier':
      return fakes.get('pms', original, (n) => `PMS-${pad(n)}`);
    case 'description':
    case 'comments':
    case 'comment':
    case 'notes':
    case 'observation':
      return fakes.get('text', original, (n) => `Texto fictício ${n}`);
    case 'roomStayDescription':
      return fakes.get('room', original, (n) => `Acomodação ${n}`);
    case 'id':
      // Id em texto: os números (códigos de hotel) ficam; GUIDs e outros viram fictícios.
      return fakes.get('id', original, (n) => `00000000-0000-0000-0000-${pad(n, 12)}`);
    default:
      if (path.startsWith('companies[].') && key === 'name') {
        return fakes.get('hotel', original, (n) => `Hotel Fictício ${n}`);
      }
      if (/^(companyName|hotelName)$/.test(key)) {
        return fakes.get('hotel', original, (n) => `Hotel Fictício ${n}`);
      }
      context.genericFields.add(path);
      return fakes.get('generic', original, (n) => `anonimizado-${n}`);
  }
}

function anonymizeJson(
  value: Json,
  key: string,
  path: string,
  personal: boolean,
  context: JsonContext,
): Json {
  if (value === null || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (!personal && KEEP_NUMBER_FIELD.test(key)) return value;
    context.genericFields.add(path);
    return 0;
  }

  if (typeof value === 'string') {
    const keep =
      !personal &&
      (KEEP_TEXT_FIELDS.has(key) ||
        ISO_DATE.test(value) ||
        value.trim() === '' ||
        (key === 'id' && DIGITS.test(value)));
    if (keep) {
      context.kept.add(value);
      return value;
    }
    context.replaced.add(value);
    return fakeText(key, path, value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => anonymizeJson(item, key, `${path}[]`, personal, context));
  }

  const result: { [key: string]: Json } = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === '_fixture') continue;
    const childPath = path === '' ? childKey : `${path}.${childKey}`;
    result[childKey] = anonymizeJson(
      child,
      childKey,
      childPath,
      personal || PERSONAL_BRANCH.test(childKey),
      context,
    );
  }
  return result;
}

function withFixtureNote(value: Json, note: string): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return { _fixture: note, ...value };
}

// ---------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Parâmetros de sessão do login (Keycloak) e do OpenID Connect. */
const SESSION_PARAMS =
  /([?&;](?:session_code|execution|tab_id|client_data|state|nonce|code|code_challenge|auth_session_id|kc_[a-z_]+)=)[^&"'\s<>]*/gi;

interface HtmlContext {
  /** Textos originais retirados, para a conferência final. */
  replaced: Set<string>;
}

export function anonymizeHtml(
  html: string,
  context: HtmlContext = { replaced: new Set() },
): string {
  let result = sanitizeHtml(html);

  // Nada que faça o navegador buscar algo ou rodar código: os testes não acessam o Hunit.
  result = result
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<(link|base)\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/url\(\s*(["']?)https?:[^)]*\1\s*\)/gi, 'url()')
    .replace(/(\ssrc(?:set)?\s*=\s*)("https?:[^"]*"|'https?:[^']*')/gi, '$1"data:,"');

  // Destino dos formulários: vira o marcador que os testes preenchem.
  result = result.replace(/(<form\b[^>]*?\saction\s*=\s*)("[^"]*"|'[^']*')/gi, '$1"{{action}}"');

  for (const match of result.matchAll(SESSION_PARAMS)) {
    const value = match[0].slice(match[1]?.length ?? 0);
    if (value.length >= 4) context.replaced.add(value);
  }
  result = result.replace(SESSION_PARAMS, '$1anon');

  for (const email of result.match(EMAIL) ?? []) context.replaced.add(email);
  result = result.replace(EMAIL, 'usuario@exemplo.test');

  return result.replaceAll(REDACTED, '{{username}}');
}

function withHtmlNote(html: string, note: string): string {
  const comment = `<!-- ${note} -->`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype
    ? `${doctype[0]}\n${comment}${html.slice(doctype[0].length)}`
    : `${comment}\n${html}`;
}

// ---------------------------------------------------------------------------------------------
// Conjunto
// ---------------------------------------------------------------------------------------------

interface ParsedName {
  stamp: string;
  kind: string;
  extension: string;
}

function parseName(name: string): ParsedName | null {
  const match = RAW_NAME.exec(name);
  if (!match) return null;
  return { stamp: match[1] as string, kind: match[2] as string, extension: match[3] as string };
}

/** Rota da API de um JSON bruto do `hunit:reservations-check` (`<stamp>-NNN-<rota>.json`). */
function apiRouteOf(kind: string): 'GetCurrentUser' | 'GetBookings' | 'BookingDetail' | null {
  const match = /^\d{3}-(GetCurrentUser|GetBookings|BookingDetail)$/.exec(kind);
  return (match?.[1] as 'GetCurrentUser' | 'GetBookings' | 'BookingDetail' | undefined) ?? null;
}

function idOf(value: Json): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = value['id'];
  return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
}

function bookingIdsOf(page: Json): string[] {
  const items = (page as { items?: { items?: Json[] } } | null)?.items?.items;
  return Array.isArray(items) ? items.map(idOf).filter((id): id is string => id !== null) : [];
}

export interface AnonymizeOptions {
  /** Data e hora da geração, registrada nas fixtures. */
  generatedAt: string;
}

/**
 * Gera as fixtures anonimizadas a partir do material bruto. Não grava nada: devolve os arquivos
 * para quem chamou gravar.
 *
 * @throws FixtureLeakError se algum valor original trocado aparecer no resultado.
 */
export function anonymizeFixtures(
  raw: readonly RawFile[],
  options: AnonymizeOptions,
): AnonymizeResult {
  const note = `REAL, anonimizada em ${options.generatedAt} (tasks.md, T021). Não editar à mão: gerar de novo com hunit:anonymize-fixtures.`;
  const report: AnonymizeReport = { genericFields: [], skipped: [] };
  const files: FixtureFile[] = [];
  const manifest: RealFixturesManifest = {
    generatedAt: options.generatedAt,
    html: [],
    currentUser: null,
    bookings: [],
    details: [],
  };

  const parsed = raw
    .map((file) => ({ file, name: parseName(file.name) }))
    .sort((a, b) => a.file.name.localeCompare(b.file.name));
  const htmlContext: HtmlContext = { replaced: new Set() };
  const jsonContext: JsonContext = {
    fakes: new FakeValues(),
    replaced: new Set(),
    kept: new Set(),
    genericFields: new Set(),
  };

  // HTML: a captura mais recente de cada tela.
  const latestScreen = new Map<RealScreen, RawFile>();
  // JSON: o catálogo mais recente; todas as páginas e detalhes (o mais recente de cada reserva).
  let currentUser: RawFile | null = null;
  const bookingPages: Array<{ file: RawFile; body: Json }> = [];
  const details = new Map<string, { file: RawFile; body: Json }>();

  for (const { file, name } of parsed) {
    if (!name) {
      report.skipped.push({
        name: file.name,
        reason: 'nome fora do padrão dos comandos de verificação',
      });
      continue;
    }
    if (name.extension === 'png') continue; // capturas não viram fixture
    if (name.extension === 'html') {
      const screen = SCREEN_OF[name.kind];
      if (screen) latestScreen.set(screen, file);
      else report.skipped.push({ name: file.name, reason: 'tela sem fixture correspondente' });
      continue;
    }

    const route = apiRouteOf(name.kind);
    if (!route) {
      report.skipped.push({ name: file.name, reason: 'resposta sem fixture correspondente' });
      continue;
    }
    let body: Json;
    try {
      body = JSON.parse(file.content) as Json;
    } catch {
      report.skipped.push({ name: file.name, reason: 'JSON inválido' });
      continue;
    }
    if (route === 'GetCurrentUser') currentUser = file;
    else if (route === 'GetBookings') bookingPages.push({ file, body });
    else {
      const id = idOf(body);
      if (id === null) report.skipped.push({ name: file.name, reason: 'detalhe sem id' });
      else details.set(id, { file, body });
    }
  }

  for (const [screen, file] of latestScreen) {
    const path = `html/real/${FILE_OF_SCREEN[screen]}`;
    files.push({ path, content: withHtmlNote(anonymizeHtml(file.content, htmlContext), note) });
    manifest.html.push({ file: path, screen });
  }

  const jsonFile = (path: string, body: Json) => {
    const anonymized = anonymizeJson(body, '', '', false, jsonContext);
    files.push({
      path,
      content: `${JSON.stringify(withFixtureNote(anonymized, note), null, 2)}\n`,
    });
    return anonymized;
  };

  if (currentUser) {
    manifest.currentUser = 'json/real/current-user.json';
    const body = JSON.parse(currentUser.content) as Json;
    // O id do usuário identifica a conta no Hunit e os leitores não o usam.
    if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'id' in body) {
      body['id'] = 1;
    }
    jsonFile(manifest.currentUser, body);
  }

  /** Página anonimizada em que cada reserva aparece (a mais recente). */
  const pageOfBooking = new Map<string, { path: string; body: Json }>();
  for (const [index, page] of bookingPages.entries()) {
    const path = `json/real/bookings-${pad(index + 1, 2)}.json`;
    const anonymized = jsonFile(path, page.body);
    manifest.bookings.push(path);
    for (const id of bookingIdsOf(anonymized)) pageOfBooking.set(id, { path, body: anonymized });
  }

  let detailIndex = 0;
  for (const [id, detail] of details) {
    const page = pageOfBooking.get(id);
    const item = page
      ? listItemsOf(page.body)?.find((candidate) => candidate.bookingId === id)
      : undefined;
    if (!page || !item) {
      report.skipped.push({
        name: detail.file.name,
        reason: 'reserva sem página da listagem correspondente',
      });
      continue;
    }
    detailIndex += 1;
    const path = `json/real/booking-detail-${pad(detailIndex, 2)}.json`;
    const anonymized = jsonFile(path, detail.body);
    let expected: RealFixturesManifest['details'][number]['expected'];
    try {
      const result = classifyReservation(
        item.reservationNumber,
        snapshotOf(anonymized, item),
        item.reservationStatus,
      );
      expected = {
        classification: result.classification,
        reservationStatus: result.reservationStatus,
      };
    } catch {
      expected = { classification: 'analysis_error', reservationStatus: item.reservationStatus };
    }
    manifest.details.push({ file: path, bookingId: id, bookingsFile: page.path, expected });
  }

  files.push({ path: MANIFEST_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` });

  // Conferência final: nenhum texto original trocado pode aparecer no resultado. Só fica isento
  // o que também foi mantido num campo permitido e tem cara de situação ou data ("Success"
  // trocado numa descrição e mantido em `prePaymentStatus`); um nome nunca tem essa cara.
  const harmless = (value: string) =>
    jsonContext.kept.has(value) && (SINGLE_WORD.test(value) || ISO_DATE.test(value));
  const suspicious = [
    ...[...jsonContext.replaced].filter((value) => !harmless(value)),
    ...htmlContext.replaced,
  ].filter((value) => value.length >= 4);
  const leaks = files
    .filter((file) => suspicious.some((value) => file.content.includes(value)))
    .map((file) => file.path);
  if (leaks.length > 0) throw new FixtureLeakError(leaks);

  report.genericFields = [...jsonContext.genericFields].sort();
  return { files, manifest, report };
}
