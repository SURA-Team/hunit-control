/**
 * Camada do Hunit contra as fixtures REAIS anonimizadas (T020/T021): as telas capturadas no
 * Hunit real passam pelos Page Objects, e as respostas reais passam pelos leitores da API, pelo
 * mesmo caminho HTTP da coleta.
 *
 * O que cada fixture deve produzir está em `test/fixtures/hunit/real/manifest.json`, gerado por
 * `hunit:anonymize-fixtures` junto com as fixtures. As classificações foram conferidas com a tela
 * do Hunit na captura (`hunit:reservations-check`); aqui elas ficam como teste de regressão.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { classifyReservation, type Period } from '@hunit/domain';
import { request, type APIRequestContext, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RealFixturesManifest, RealScreen } from '../../src/fixture-anonymizer.js';
import type { ReservationListItem } from '../../src/hunit/gateway.js';
import {
  HunitEntryPage,
  isLoginExpiredPage,
  LoginPage,
  TwoFactorPage,
} from '../../src/hunit/login-pages.js';
import { HunitApiClient } from '../../src/hunit/network/api-client.js';
import { readBookingDetail } from '../../src/hunit/network/booking-detail.js';
import { searchBookings } from '../../src/hunit/network/bookings.js';
import { readCatalog } from '../../src/hunit/network/catalog.js';
import { launchTestBrowser } from '../helpers/browser.js';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'hunit');
const manifest = JSON.parse(
  readFileSync(path.join(FIXTURES, 'real', 'manifest.json'), 'utf8'),
) as RealFixturesManifest;

const readFixture = (file: string) => readFileSync(path.join(FIXTURES, file), 'utf8');
const readJson = (file: string) => JSON.parse(readFixture(file)) as unknown;

describe('telas reais nos Page Objects (T027)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await launchTestBrowser();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  async function show(file: string) {
    await page.setContent(
      readFixture(file)
        .replaceAll('{{action}}', '#')
        .replaceAll('{{username}}', 'operador@exemplo.test'),
    );
    return { login: new LoginPage(page), twoFactor: new TwoFactorPage(page) };
  }

  const checks: Record<RealScreen, (file: string) => Promise<void>> = {
    async hunit_entry(file) {
      const { login } = await show(file);
      expect(await new HunitEntryPage(page).isShown()).toBe(true);
      expect(await login.isShown()).toBe(false);
    },
    async login(file) {
      const { login, twoFactor } = await show(file);
      expect(await login.isShown()).toBe(true);
      expect(await login.isShowingError()).toBe(false);
      expect(await twoFactor.isShown()).toBe(false);
    },
    async login_error(file) {
      const { login } = await show(file);
      expect(await login.isShown()).toBe(true);
      expect(await login.isShowingError()).toBe(true);
    },
    async two_factor(file) {
      const { login, twoFactor } = await show(file);
      expect(await twoFactor.isShown()).toBe(true);
      expect(await twoFactor.isShowingError()).toBe(false);
      expect(await login.isShown()).toBe(false);
    },
    async two_factor_error(file) {
      const { twoFactor } = await show(file);
      expect(await twoFactor.isShown()).toBe(true);
      expect(await twoFactor.isShowingError()).toBe(true);
    },
    async token_expired(file) {
      // Mesmo critério do gateway: volta ao login ou mostra a página de login expirado.
      const { login } = await show(file);
      expect((await login.isShown()) || (await isLoginExpiredPage(page))).toBe(true);
    },
  };

  it('há pelo menos as telas de login e do token', () => {
    expect(manifest.html.map((entry) => entry.screen)).toEqual(
      expect.arrayContaining(['login', 'two_factor']),
    );
  });

  it.each(manifest.html)('$screen ($file) é reconhecida', async ({ file, screen }) => {
    await checks[screen](file);
  });

  it.each(manifest.html)('$file não tem scripts nem endereços externos', ({ file }) => {
    const html = readFixture(file);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\s(src|href)\s*=\s*["']?https?:/i);
  });
});

describe('respostas reais nos leitores da API (T041)', () => {
  let body: unknown = null;
  let server: Server;
  let context: APIRequestContext;
  let api: HunitApiClient;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    context = await request.newContext();
    api = new HunitApiClient(context, {
      apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      webUrl: 'https://hunit.test',
      timeoutMs: 5_000,
    });
  });

  afterAll(async () => {
    await context.dispose();
    await new Promise((resolve) => server.close(resolve));
  });

  interface RawPage {
    items: { page: number; items: Array<{ arrivalDate: string }> };
  }

  /** Lê a página como a coleta lê, com um período que cobre os check-ins dela. */
  async function readPage(file: string): Promise<ReservationListItem[]> {
    const raw = readJson(file) as RawPage;
    const dates = raw.items.items.map((item) => item.arrivalDate.slice(0, 10)).sort();
    const period: Period = { from: dates[0] ?? '2026-01-01', to: dates.at(-1) ?? '2026-01-01' };
    body = raw;
    return (await searchBookings(api, '1', period, raw.items.page)).items;
  }

  it('o catálogo real vira a lista de hotéis', async () => {
    if (!manifest.currentUser) return;
    body = readJson(manifest.currentUser);

    const hotels = await readCatalog(api);

    expect(hotels.length).toBeGreaterThan(0);
    for (const hotel of hotels) expect(hotel.name).toMatch(/^Hotel Fictício \d+$/);
  });

  it.each(manifest.bookings)(
    '%s passa pela leitura da listagem com os filtros conferidos',
    async (file) => {
      const items = await readPage(file);
      const raw = readJson(file) as RawPage;

      expect(items).toHaveLength(raw.items.items.length);
    },
  );

  it.each(manifest.details)(
    '$file → $expected.classification ($expected.reservationStatus)',
    async ({ file, bookingId, bookingsFile, expected }) => {
      const item = (await readPage(bookingsFile)).find(
        (candidate) => candidate.bookingId === bookingId,
      );
      if (!item) throw new Error(`a reserva ${bookingId} não está em ${bookingsFile}`);
      body = readJson(file);

      const { snapshot } = await readBookingDetail(api, '1', item);
      const result = classifyReservation(item.reservationNumber, snapshot, item.reservationStatus);

      expect({
        classification: result.classification,
        reservationStatus: result.reservationStatus,
      }).toEqual(expected);
    },
  );
});
