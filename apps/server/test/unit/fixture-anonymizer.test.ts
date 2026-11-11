/**
 * Anonimização das fixtures do Hunit (T021), com material bruto fictício no formato que os
 * comandos `hunit:login-check` e `hunit:reservations-check` gravam.
 */
import { describe, expect, it } from 'vitest';
import {
  anonymizeFixtures,
  anonymizeHtml,
  FixtureLeakError,
  MANIFEST_PATH,
  type RawFile,
} from '../../src/fixture-anonymizer.js';
import { REDACTED } from '../../src/secrets.js';

const STAMP = '2026-11-11T21-24-31';
const GUEST = 'Fulana de Tal Verdadeira';
const OPERATOR = 'Beltrano Operador Real';
const HOTEL = 'Pousada Nome Real';

function booking(id: number, number: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    channelIdentifier: number,
    guestFullName: GUEST,
    channelName: 'Booking.com',
    roomStayDescription: 'Suíte Vista Mar Real',
    arrivalDate: '2026-11-03T00:00:00',
    departureDate: '2026-11-05T00:00:00',
    statusId: 1,
    collectTypeId: 2,
    total: 812.4,
    pmsIdentifier: 'PMS-REAL-77',
    misteryField: 'segredo-desconhecido',
    misteryNumber: 31998887766,
    ...extra,
  };
}

const bookingsPage = {
  items: {
    items: [booking(501, 'BK-REAL-9911'), booking(502, '258-REAL-8822')],
    page: 1,
    pageSize: 50,
    total: 2,
  },
};

const chargedDetail = {
  id: 501,
  channelIdentifier: 'BK-REAL-9911',
  statusId: 1,
  hasCreditCardInfo: true,
  prePaymentStatus: 'Success',
  canCharge: false,
  guest: { fullName: GUEST, document: '123.456.789-00', phone: 5511999990000 },
  lastPaymentEvent: {
    user: OPERATOR,
    dateTime: '2026-11-02T11:30:00',
    valueCharged: 812.4,
    justValidate: false,
    authorizationCode: 'AUTREAL123',
    transactionId: 'TRXREAL456',
    processorReferenceNumber: 'REFREAL789',
    isParceled: false,
    numberOfInstallments: 1,
    installmentValue: 812.4,
    description: 'Transação aprovada para Fulana',
  },
};

const currentUser = {
  id: '7c1f0b8e-1111-2222-3333-444455556666',
  displayName: 'Nome Real do Usuário',
  email: REDACTED,
  companies: [{ id: 3544, name: HOTEL, isActive: true }],
};

const twoFactorHtml = `<!DOCTYPE html><html><head>
<script src="https://login.hsystem.com.br/resources/app.js"></script>
<script>window.kc = { user: "pessoa@empresa.com.br" };</script>
<link rel="stylesheet" href="https://login.hsystem.com.br/resources/app.css">
<style>body { background: url("https://login.hsystem.com.br/bg.png"); }</style>
</head><body onload="init()">
<div id="kc-username"><label id="kc-attempted-username">${REDACTED}</label></div>
<form id="kc-otp-login-form" action="https://login.hsystem.com.br/realms/h/login-actions/authenticate?session_code=SESSAOREAL123456&amp;execution=EXEC-REAL-999&amp;client_id=hunit&amp;tab_id=TABREAL42" method="post">
<label for="otp">Código do Autenticador</label>
<input id="otp" name="otp" type="text" value="123456">
<input type="hidden" name="credentialId" value="CRED-REAL-1">
<img src="https://login.hsystem.com.br/logo.png" alt="logo">
<a href="https://login.hsystem.com.br/realms/h/login-actions/restart?client_id=hunit&amp;tab_id=TABREAL42">Reiniciar</a>
<p>Contato: suporte.real@hsystem.com.br</p>
</form></body></html>`;

function raw(): RawFile[] {
  return [
    { name: `${STAMP}-001-GetCurrentUser.json`, content: JSON.stringify(currentUser) },
    { name: `${STAMP}-002-GetBookings.json`, content: JSON.stringify(bookingsPage) },
    { name: `${STAMP}-003-BookingDetail.json`, content: JSON.stringify(chargedDetail) },
    { name: '2026-11-11T20-44-33-two_factor.html', content: twoFactorHtml },
    { name: '2026-11-11T20-44-33-two_factor.png', content: 'png' },
    { name: '2026-11-11T20-40-51-erro-screen_not_recognized.html', content: '<p>x</p>' },
    { name: 'anotacoes.txt', content: 'qualquer' },
  ];
}

function generate(files: RawFile[] = raw()) {
  return anonymizeFixtures(files, { generatedAt: '2026-11-11' });
}

function fileOf(result: ReturnType<typeof generate>, path: string): string {
  const found = result.files.find((file) => file.path === path);
  if (!found) throw new Error(`arquivo não gerado: ${path}`);
  return found.content;
}

const everything = (result: ReturnType<typeof generate>) =>
  result.files.map((file) => file.content).join('\n');

describe('anonymizeFixtures — JSON (T021)', () => {
  it('não deixa nenhum dado pessoal, de operador, de transação ou de hotel', () => {
    const text = everything(generate());

    for (const value of [
      GUEST,
      OPERATOR,
      HOTEL,
      'BK-REAL-9911',
      'REAL-8822',
      'AUTREAL123',
      'TRXREAL456',
      'REFREAL789',
      'Transação aprovada',
      '123.456.789-00',
      '5511999990000',
      '31998887766',
      'Nome Real do Usuário',
      '7c1f0b8e',
      'PMS-REAL-77',
      'segredo-desconhecido',
      'Suíte Vista Mar Real',
      REDACTED,
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it('mantém o que os leitores e as regras usam: ids, situações, datas, valores e canal', () => {
    const detail = JSON.parse(
      fileOf(generate(), 'json/real/booking-detail-01.json'),
    ) as typeof chargedDetail;

    expect(detail).toMatchObject({
      id: 501,
      statusId: 1,
      hasCreditCardInfo: true,
      prePaymentStatus: 'Success',
      canCharge: false,
      lastPaymentEvent: {
        dateTime: '2026-11-02T11:30:00',
        valueCharged: 812.4,
        justValidate: false,
        numberOfInstallments: 1,
      },
    });
    const page = JSON.parse(
      fileOf(generate(), 'json/real/bookings-01.json'),
    ) as typeof bookingsPage;
    expect(page.items).toMatchObject({ page: 1, pageSize: 50, total: 2 });
    expect(page.items.items[0]).toMatchObject({
      channelName: 'Booking.com',
      collectTypeId: 2,
      total: 812.4,
    });
  });

  it('o mesmo número de reserva vira o mesmo número fictício na listagem e no detalhe, mantendo o "258-"', () => {
    const result = generate();
    const page = JSON.parse(fileOf(result, 'json/real/bookings-01.json')) as typeof bookingsPage;
    const detail = JSON.parse(
      fileOf(result, 'json/real/booking-detail-01.json'),
    ) as typeof chargedDetail;

    expect(page.items.items[0]?.channelIdentifier).toBe(detail.channelIdentifier);
    expect(page.items.items[0]?.channelIdentifier).toMatch(/^RES-\d{4}$/);
    expect(page.items.items[1]?.channelIdentifier).toMatch(/^258-\d{4}$/);
  });

  it('troca o id da conta no catálogo e mantém os códigos dos hotéis', () => {
    const user = JSON.parse(fileOf(generate(), 'json/real/current-user.json')) as {
      id: unknown;
      companies: Array<{ id: unknown; name: string }>;
    };

    expect(user.id).toBe(1);
    expect(user.companies[0]).toMatchObject({ id: 3544, name: 'Hotel Fictício 1' });
  });

  it('troca tudo nos ramos pessoais, inclusive números', () => {
    const detail = JSON.parse(fileOf(generate(), 'json/real/booking-detail-01.json')) as {
      guest: { phone: number; document: string };
    };

    expect(detail.guest.phone).toBe(0);
    expect(detail.guest.document).not.toContain('123');
  });

  it('o manifesto registra a classificação de cada detalhe e a página em que a reserva aparece', () => {
    const { manifest } = generate();

    expect(manifest.currentUser).toBe('json/real/current-user.json');
    expect(manifest.bookings).toEqual(['json/real/bookings-01.json']);
    expect(manifest.details).toEqual([
      {
        file: 'json/real/booking-detail-01.json',
        bookingId: '501',
        bookingsFile: 'json/real/bookings-01.json',
        expected: { classification: 'virtual_card_already_charged', reservationStatus: 'active' },
      },
    ]);
    expect(generate().files.map((file) => file.path)).toContain(MANIFEST_PATH);
  });

  it('relata os campos trocados de forma genérica (sem valores) e os arquivos não usados', () => {
    const { report } = generate();

    expect(report.genericFields).toEqual(
      expect.arrayContaining(['items.items[].misteryField', 'items.items[].misteryNumber']),
    );
    expect(report.genericFields.join(' ')).not.toContain('segredo');
    expect(report.skipped.map((skipped) => skipped.name)).toEqual(
      expect.arrayContaining([
        '2026-11-11T20-40-51-erro-screen_not_recognized.html',
        'anotacoes.txt',
      ]),
    );
  });

  it('detalhe sem a reserva na listagem fica de fora', () => {
    const files = raw().filter((file) => !file.name.endsWith('GetBookings.json'));
    const result = generate(files);

    expect(result.manifest.details).toEqual([]);
    expect(result.report.skipped.map((skipped) => skipped.name)).toContain(
      `${STAMP}-003-BookingDetail.json`,
    );
  });

  it('usa o detalhe mais recente de cada reserva', () => {
    const newer = {
      ...chargedDetail,
      prePaymentStatus: 'Unprocessed',
      canCharge: true,
      lastPaymentEvent: null,
    };
    const result = generate([
      ...raw(),
      { name: '2026-11-12T08-00-00-004-BookingDetail.json', content: JSON.stringify(newer) },
    ]);

    expect(result.manifest.details).toHaveLength(1);
    expect(result.manifest.details[0]?.expected.classification).toBe('virtual_card_pending_charge');
  });
});

describe('anonymizeFixtures — HTML (T021)', () => {
  const html = () => fileOf(generate(), 'html/real/two-factor.html');

  it('gera a tela pelo nome do arquivo bruto e registra no manifesto', () => {
    expect(generate().manifest.html).toEqual([
      { file: 'html/real/two-factor.html', screen: 'two_factor' },
    ]);
  });

  it('tira scripts, folhas de estilo externas, imagens remotas e eventos', () => {
    const content = html();

    expect(content).not.toMatch(/<script/i);
    expect(content).not.toMatch(/<link/i);
    expect(content).not.toContain('onload');
    expect(content).not.toMatch(/src="https?:/);
    expect(content).not.toMatch(/url\(\s*["']?https?:/);
  });

  it('troca o destino do formulário por {{action}} e o usuário apagado por {{username}}', () => {
    const content = html();

    expect(content).toContain('action="{{action}}"');
    expect(content).toContain('{{username}}');
    expect(content).not.toContain(REDACTED);
  });

  it('não deixa valores de campos, parâmetros de sessão nem e-mails', () => {
    const content = html();

    for (const value of [
      '123456',
      'CRED-REAL-1',
      'SESSAOREAL123456',
      'EXEC-REAL-999',
      'TABREAL42',
      'suporte.real@hsystem.com.br',
      'pessoa@empresa.com.br',
    ]) {
      expect(content).not.toContain(value);
    }
  });

  it('mantém o que os Page Objects usam: rótulos, ids e textos', () => {
    const content = html();

    expect(content).toContain('<label for="otp">Código do Autenticador</label>');
    expect(content).toContain('id="kc-otp-login-form"');
    expect(content).toMatch(/^<!DOCTYPE html>\n<!-- REAL, anonimizada/);
  });

  it('anonymizeHtml é idempotente nos marcadores', () => {
    const once = anonymizeHtml(twoFactorHtml);
    expect(anonymizeHtml(once)).toBe(once);
  });
});

describe('conferência final', () => {
  it('recusa o resultado quando um valor trocado reaparece em outro arquivo', () => {
    const leaky = raw().concat({
      // Um campo mantido (situação) com o nome do hóspede: a lista de permissão o deixaria passar.
      name: '2026-11-11T21-24-31-004-BookingDetail.json',
      content: JSON.stringify({
        ...chargedDetail,
        id: 502,
        channelIdentifier: '258-REAL-8822',
        prePaymentStatus: GUEST,
      }),
    });

    expect(() => generate(leaky)).toThrow(FixtureLeakError);
    try {
      generate(leaky);
    } catch (error) {
      expect((error as Error).message).not.toContain(GUEST);
    }
  });
});
