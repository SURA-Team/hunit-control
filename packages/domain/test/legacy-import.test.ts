/**
 * Regras da importação do histórico (specs/004; research R-04, R-06, R-07, R-10; data-model §3 a
 * §5) — tasks.md, T006. Dados fictícios.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_REQUIRED_RESERVATION_COLUMNS,
  LEGACY_RESERVATION_COLUMNS,
  anonymizationCutoff,
  convertLegacyClassification,
  decideLegacyDocument,
  decideLegacyManualAmount,
  decideLegacyReservation,
  legacyAttachmentKind,
  legacyOriginalDate,
  mergeVerification,
  missingColumns,
  normalizeHotelName,
  parseLegacyReservationRow,
  parseLegacyTreatmentRow,
  proposeHotel,
  selectLegacyDuplicates,
  type ExistingReservation,
  type LegacyRow,
  type ParsedLegacyReservation,
  type ReservationData,
} from '../src/index.js';

const wall = (iso: string): Date => new Date(`${iso}Z`);
const NOW = new Date('2026-11-16T12:00:00Z');
const CUTOFF = anonymizationCutoff('2026-11-16', 5);

function row(overrides: Record<string, unknown> = {}): LegacyRow {
  return {
    'Codigo hotel': 'legacy_hml_um',
    Hotel: 'Hotel Homologação Um',
    Reserva: '900001',
    Hospede: 'Hóspede Fictício',
    Canal: 'Canal Fictício',
    Entrada: wall('2026-05-10T00:00:00'),
    Saida: wall('2026-05-12T00:00:00'),
    'Periodo da hospedagem': '10/05/2026 - 12/05/2026',
    'Total da reserva': '1234.56',
    'Codigo status': 'virtual_card_pending_charge',
    Motivo: 'pré-pagamento sem registro de cobrança',
    'Pre-pagamento encontrado': true,
    'Acao de cobranca visivel': true,
    'Primeira verificacao': wall('2026-05-01T10:00:00'),
    'Ultima verificacao': wall('2026-05-08T10:00:00'),
    'Quantidade de verificacoes': '3',
    ...overrides,
  };
}

function parsed(overrides: Record<string, unknown> = {}): ParsedLegacyReservation {
  const result = parseLegacyReservationRow(row(overrides), 2, CUTOFF);
  if (!result.ok) throw new Error(`linha recusada: ${result.rejection.reason}`);
  return result.value;
}

describe('colunas (FR-003)', () => {
  it('aponta as obrigatórias que faltam, em qualquer ordem', () => {
    expect(
      missingColumns(
        [...LEGACY_RESERVATION_COLUMNS].reverse(),
        LEGACY_REQUIRED_RESERVATION_COLUMNS,
      ),
    ).toEqual([]);
    const headers = LEGACY_RESERVATION_COLUMNS.filter((name) => name !== 'Saida');
    expect(missingColumns(headers, LEGACY_REQUIRED_RESERVATION_COLUMNS)).toEqual(['Saida']);
  });

  it('opcional ausente vale como vazia e coluna desconhecida é ignorada', () => {
    const withoutGuest = Object.fromEntries(
      Object.entries(row({ 'Coluna nova': 'x' })).filter(([column]) => column !== 'Hospede'),
    );
    const result = parseLegacyReservationRow(withoutGuest, 2, CUTOFF);
    expect(result.ok && result.value.data.guestName).toBeNull();
  });
});

describe('conversão da classificação (FR-007, R-04)', () => {
  it.each([
    ['ignored_hotelbeds_258', 'ignored_hotelbeds_258'],
    ['virtual_card_already_charged', 'virtual_card_already_charged'],
    ['virtual_card_pending_charge', 'virtual_card_pending_charge'],
    ['virtual_card_charge_error', 'virtual_card_charge_error'],
    ['analysis_error', 'analysis_error'],
    ['not_virtual_card', 'not_virtual_card'],
    ['codigo_desconhecido', 'not_virtual_card'],
  ] as const)('%s → %s', (code, expected) => {
    expect(convertLegacyClassification(code).classification).toBe(expected);
  });

  it('só "Sem cartão virtual" e códigos desconhecidos ficam sem correspondência', () => {
    expect(convertLegacyClassification('not_virtual_card').known).toBe(false);
    expect(convertLegacyClassification('outro').known).toBe(false);
    expect(convertLegacyClassification('analysis_error').known).toBe(true);
  });

  it('aceita o rótulo da coluna "Status", sem diferenciar maiúsculas e acentos', () => {
    expect(convertLegacyClassification('PRÉ-PAGAMENTO PENDENTE').classification).toBe(
      'virtual_card_pending_charge',
    );
    expect(convertLegacyClassification('Erro na cobrança').classification).toBe(
      'virtual_card_charge_error',
    );
  });

  it('código desconhecido fica guardado como estava e vira "A revisar"', () => {
    const value = parsed({ 'Codigo status': 'codigo_desconhecido' });
    expect(value.data.classification).toBe('not_virtual_card');
    expect(value.origin.originalClassification).toBe('codigo_desconhecido');
    expect(value.data.reason).toMatch(/sem correspondência/);
    expect(value.data.reason).toContain('"codigo_desconhecido"');
  });

  it('"Sem cartão virtual": motivo com o nome do sistema anterior, sem o código técnico', () => {
    const value = parsed({ 'Codigo status': 'not_virtual_card' });
    expect(value.data.reason).toContain('"Sem cartão virtual" sem correspondência');
    expect(value.data.reason).not.toContain('not_virtual_card');
  });

  it('código vazio recusa a linha (missing_value)', () => {
    expect(parseLegacyReservationRow(row({ 'Codigo status': '' }), 2, CUTOFF)).toEqual({
      ok: false,
      rejection: { reason: 'missing_value', column: 'Codigo status' },
    });
  });

  it('"Status anterior" por código ou rótulo', () => {
    expect(parsed({ 'Status anterior': 'Pre-pagamento pendente' }).previousClassification).toBe(
      'virtual_card_pending_charge',
    );
    expect(parsed({ 'Status anterior': 'analysis_error' }).previousClassification).toBe(
      'analysis_error',
    );
  });
});

describe('linha → reserva (FR-008, data-model §3.1)', () => {
  it('campos fixos da importação', () => {
    const value = parsed();
    expect(value.data).toMatchObject({
      reservationNumber: '900001',
      reservationStatus: 'unknown',
      paymentForm: null,
      totalAmount: '1234.56',
      checkIn: '2026-05-10',
      reason: 'Sistema anterior: pré-pagamento sem registro de cobrança',
    });
    expect(value.origin).toMatchObject({
      legacyHotelKey: 'legacy_hml_um',
      verificationCount: 3,
      firstVerifiedAt: new Date('2026-05-01T13:00:00Z'),
    });
    expect(value.anonymize).toBe(false);
  });

  it.each([
    [{ Saida: wall('2026-05-09T00:00:00') }, 'inconsistent_dates'],
    [{ 'Primeira verificacao': wall('2026-05-09T10:00:00') }, 'inconsistent_dates'],
    [{ 'Quantidade de verificacoes': 0 }, 'unreadable_number'],
    [{ 'Quantidade de verificacoes': 'x' }, 'unreadable_number'],
    [{ Entrada: 'ontem' }, 'unreadable_date'],
    [{ 'Total da reserva': 'abc' }, 'unreadable_amount'],
    [{ 'Total da reserva': '' }, 'missing_value'],
    [{ Reserva: '' }, 'missing_value'],
  ])('%o → %s', (overrides, reason) => {
    const result = parseLegacyReservationRow(row(overrides), 2, CUTOFF);
    expect(result.ok ? null : result.rejection.reason).toBe(reason);
  });

  it('a recusa nunca traz o valor da célula', () => {
    const result = parseLegacyReservationRow(row({ Entrada: 'MARCADOR-DATA' }), 2, CUTOFF);
    expect(JSON.stringify(result)).not.toContain('MARCADOR');
  });

  it('check-in antes do prazo de retenção → anonimizada, sem o nome (FR-022)', () => {
    expect(CUTOFF).toBe('2021-11-16');
    const old = parsed({
      Entrada: wall('2021-11-15T00:00:00'),
      Saida: wall('2021-11-16T00:00:00'),
    });
    expect(old.anonymize).toBe(true);
    expect(old.data.guestName).toBeNull();
    expect(
      parsed({ Entrada: wall('2021-11-16T00:00:00'), Saida: wall('2021-11-17T00:00:00') })
        .anonymize,
    ).toBe(false);
  });

  it('29/02 vira 28/02 no corte, como no PostgreSQL', () => {
    expect(anonymizationCutoff('2028-02-29', 5)).toBe('2023-02-28');
  });

  it('o resumo muda quando um valor muda, e não muda quando nada muda', () => {
    expect(parsed().canonical).toBe(parsed().canonical);
    expect(parsed({ Canal: 'Outro' }).canonical).not.toBe(parsed().canonical);
  });
});

describe('linhas repetidas na planilha', () => {
  it('vale a de última verificação mais recente', () => {
    const older = { ...parsed(), row: 2 };
    const newer = { ...parsed({ 'Ultima verificacao': wall('2026-05-09T10:00:00') }), row: 3 };
    const other = { ...parsed({ Reserva: '900002' }), row: 4 };
    const { kept, duplicates } = selectLegacyDuplicates([older, newer, other]);
    expect(kept.map((item) => item.row)).toEqual([3, 4]);
    expect(duplicates.map((item) => item.row)).toEqual([2]);
  });
});

/** Reserva gravada pelo HUNIT Control. */
function existing(overrides: Partial<ExistingReservation> = {}): ExistingReservation {
  const data: ReservationData = {
    ...parsed().data,
    hotelCode: 'HML1',
    reservationStatus: 'active',
    reason: 'pré-pagamento sem registro de cobrança',
  };
  return {
    ...data,
    firstVerifiedAt: new Date('2026-11-10T12:00:00Z'),
    lastVerifiedAt: new Date('2026-11-10T12:00:00Z'),
    verificationCount: 1,
    changedFields: [],
    statusChanged: false,
    previousClassification: null,
    previousReservationStatus: null,
    statusChangedAt: null,
    notFoundSince: null,
    anonymizedAt: null,
    verifiedByHunitControl: true,
    ...overrides,
  };
}

describe('precedência e reimportação (FR-010, FR-010a, R-06)', () => {
  const base = { hotelCode: 'HML1', rowHash: 'h1', now: NOW };

  it('reserva nova → dados da planilha com as verificações do sistema anterior', () => {
    const decision = decideLegacyReservation({
      ...base,
      parsed: parsed(),
      existing: null,
      origin: null,
    });
    expect(decision).toMatchObject({ action: 'create', appliedCount: 3, merged: false });
    if (decision.action !== 'create') throw new Error();
    expect(decision.record).toMatchObject({
      hotelCode: 'HML1',
      verificationCount: 3,
      firstVerifiedAt: new Date('2026-05-01T13:00:00Z'),
      changedFields: [],
      anonymizedAt: null,
    });
  });

  it('já verificada pelo HUNIT Control → só primeira verificação (mínimo) e contagem somada', () => {
    expect(
      decideLegacyReservation({ ...base, parsed: parsed(), existing: existing(), origin: null }),
    ).toEqual({
      action: 'merge',
      firstVerifiedAt: new Date('2026-05-01T13:00:00Z'),
      verificationCount: 4,
      appliedCount: 3,
      merged: true,
    });
  });

  it('já importada com o mesmo resumo → sem mudança', () => {
    expect(
      decideLegacyReservation({
        ...base,
        parsed: parsed(),
        existing: existing({ verifiedByHunitControl: false }),
        origin: { rowHash: 'h1', appliedCount: 3 },
      }),
    ).toEqual({ action: 'unchanged' });
  });

  it('importada, não verificada e com a linha mudada → atualiza', () => {
    const decision = decideLegacyReservation({
      ...base,
      rowHash: 'h2',
      parsed: parsed(),
      existing: existing({ verifiedByHunitControl: false }),
      origin: { rowHash: 'h1', appliedCount: 3 },
    });
    expect(decision.action).toBe('update');
  });

  it('importada e depois verificada, com a contagem mudada → ajusta pela diferença', () => {
    const decision = decideLegacyReservation({
      ...base,
      rowHash: 'h2',
      parsed: parsed({ 'Quantidade de verificacoes': 5 }),
      existing: existing({
        verificationCount: 4,
        firstVerifiedAt: new Date('2026-05-01T13:00:00Z'),
      }),
      origin: { rowHash: 'h1', appliedCount: 3 },
    });
    expect(decision).toMatchObject({ action: 'merge', verificationCount: 6, appliedCount: 5 });
  });

  it('a ordem entre importação e verificação não muda contagem nem primeira verificação', () => {
    const observed: ReservationData = {
      ...existing(),
      classification: 'virtual_card_pending_charge',
    };
    const at = new Date('2026-11-10T12:00:00Z');

    // Importar e depois verificar.
    const created = decideLegacyReservation({
      ...base,
      parsed: parsed(),
      existing: null,
      origin: null,
    });
    if (created.action !== 'create') throw new Error();
    const importThenVerify = mergeVerification(created.record, observed, at);

    // Verificar e depois importar.
    const verified = mergeVerification(null, observed, at);
    const merged = decideLegacyReservation({
      ...base,
      parsed: parsed(),
      existing: { ...verified, verifiedByHunitControl: true },
      origin: null,
    });
    if (merged.action !== 'merge') throw new Error();

    expect(merged.verificationCount).toBe(importThenVerify.verificationCount);
    expect(merged.firstVerifiedAt).toEqual(importThenVerify.firstVerifiedAt);
  });
});

describe('tratativas (data-model §3.3, R-07)', () => {
  const fallback = new Date('2026-05-08T13:00:00Z');
  const treatment = (overrides: Record<string, unknown>, code = 'virtual_card_pending_charge') => {
    const result = parseLegacyTreatmentRow(
      { 'Codigo hotel': 'legacy_hml_um', Reserva: '900001', ...overrides },
      2,
      code,
      fallback,
    );
    if (!result.ok) throw new Error(result.rejection.reason);
    return result.value;
  };

  it('anexo antigo: comprovante na pendente, tratativa nas demais', () => {
    expect(legacyAttachmentKind('virtual_card_pending_charge')).toBe('proof');
    expect(legacyAttachmentKind('Pre-pagamento pendente')).toBe('proof');
    expect(legacyAttachmentKind('virtual_card_charge_error')).toBe('request');
    expect(legacyAttachmentKind(null)).toBe('request');
  });

  it('anexo antigo com documento novo do mesmo tipo na linha → superseded_in_legacy', () => {
    const value = treatment({
      'Comprovante - arquivo no Dropbox': 'a/comprovante.pdf',
      'Anexo antigo - arquivo no Dropbox': 'a/antigo.pdf',
    });
    expect(value.documents).toEqual([
      expect.objectContaining({ ok: true }),
      { ok: false, kind: 'proof', source: 'old', reason: 'superseded_in_legacy' },
    ]);
  });

  it('data original: própria → "Atualizado em" → última verificação com aviso', () => {
    expect(legacyOriginalDate('2026-05-02T09:00:00', '2026-05-03T09:00:00', fallback)).toEqual({
      ok: true,
      date: new Date('2026-05-02T12:00:00Z'),
      missing: false,
    });
    expect(legacyOriginalDate(null, '2026-05-03T09:00:00', fallback)).toEqual({
      ok: true,
      date: new Date('2026-05-03T12:00:00Z'),
      missing: false,
    });
    expect(legacyOriginalDate(null, '', fallback)).toEqual({
      ok: true,
      date: fallback,
      missing: true,
    });
  });

  it('data própria preenchida e ilegível → recusa, sem passar para a seguinte', () => {
    expect(legacyOriginalDate('ontem', '2026-05-03T09:00:00', fallback)).toEqual({
      ok: false,
      reason: 'unreadable_date',
    });
    const value = treatment({
      'Tratativa - arquivo no Dropbox': 'a/t.pdf',
      'Tratativa anexada em': 'ontem',
      'Atualizado em': '2026-05-03T09:00:00',
    });
    expect(value.documents[0]).toMatchObject({ ok: false, reason: 'unreadable_date' });
  });

  it('valor manual com data, ilegível e sem valor', () => {
    expect(treatment({ 'Valor manual': '12.50' }).manualAmount).toEqual({
      ok: true,
      amount: '12.50',
      setAt: fallback,
      dateMissing: true,
    });
    expect(treatment({ 'Valor manual': 'abc' }).manualAmount).toMatchObject({
      ok: false,
      reason: 'unreadable_amount',
    });
    expect(treatment({}).manualAmount).toBeNull();
  });
});

describe('precedência dos documentos e do valor manual (FR-014, FR-015)', () => {
  it('documento', () => {
    expect(decideLegacyDocument(null, 'a')).toBe('create');
    expect(decideLegacyDocument({ fromLegacy: false, sha256: 'a' }, 'a')).toEqual({
      ignore: 'kept_hunit_control',
    });
    expect(decideLegacyDocument({ fromLegacy: true, sha256: 'a' }, 'a')).toEqual({
      ignore: 'already_imported',
    });
    expect(decideLegacyDocument({ fromLegacy: true, sha256: 'a' }, 'b')).toBe('replace');
    // Importado antes e desfeito pelo operador: não volta na reimportação.
    expect(decideLegacyDocument(null, 'a', true)).toEqual({ ignore: 'already_imported' });
  });

  it('valor manual', () => {
    expect(decideLegacyManualAmount({ hasProof: false, current: null, amount: '1.00' })).toEqual({
      reject: 'manual_amount_without_proof',
    });
    expect(decideLegacyManualAmount({ hasProof: true, current: null, amount: '1.00' })).toBe(
      'create',
    );
    expect(
      decideLegacyManualAmount({
        hasProof: true,
        current: { fromLegacy: false, amount: '1.00' },
        amount: '2.00',
      }),
    ).toEqual({ ignore: 'kept_hunit_control' });
    expect(
      decideLegacyManualAmount({
        hasProof: true,
        current: { fromLegacy: true, amount: '1.00' },
        amount: '1.00',
      }),
    ).toEqual({ ignore: 'already_imported' });
    expect(
      decideLegacyManualAmount({
        hasProof: true,
        current: { fromLegacy: true, amount: '1.00' },
        amount: '2.00',
      }),
    ).toBe('update');
  });
});

describe('hotéis (FR-006a, R-10)', () => {
  it('normaliza acentos, maiúsculas, "_" e pontuação', () => {
    expect(normalizeHotelName('Hotel  São_José!')).toBe('hotel sao jose');
    expect(normalizeHotelName('legacy_hml_um')).toBe('legacy hml um');
  });

  const catalog = [
    { code: 'HML1', name: 'Hotel Homologação Um' },
    { code: 'HML2', name: 'Hotel Homologação Dois' },
    { code: 'D1', name: 'Repetido' },
    { code: 'D2', name: 'repetido' },
  ];

  it('propõe o único hotel de nome igual (pelo nome ou pelo código)', () => {
    expect(proposeHotel({ key: 'x', name: 'HOTEL HOMOLOGACAO UM' }, catalog)).toBe('HML1');
    expect(proposeHotel({ key: 'hotel_homologacao_dois', name: 'Outro nome' }, catalog)).toBe(
      'HML2',
    );
  });

  it('sem proposta com nenhum ou mais de um candidato', () => {
    expect(proposeHotel({ key: 'x', name: 'Inexistente' }, catalog)).toBeNull();
    expect(proposeHotel({ key: 'x', name: 'Repetido' }, catalog)).toBeNull();
  });
});
