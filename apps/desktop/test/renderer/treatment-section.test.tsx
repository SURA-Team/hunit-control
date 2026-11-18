/**
 * Tratativa no detalhe da reserva (specs/003, T025 e T032; US1, US2, US4, FR-017): documentos
 * atuais e anteriores, anexar, substituir, desfazer com confirmação, reverter dentro do prazo,
 * valor informado à mão, histórico e download. O perfil consulta só vê e baixa.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import type { ReservationTreatment, TreatmentDetail } from '../../src/shared/ipc-types';
import { expectOnePrimaryPerBlock } from './hierarchy';
import {
  errorResult,
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { detail, document, pendingReservation, treatment } from './treatment-fixtures';

const KEY = { hotelCode: '31', reservationNumber: '7001' };
const REQUEST = document({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'request',
  fileName: 'pedido.eml',
  mediaType: 'message/rfc822',
});
const PROOF = document({ fileName: 'comprovante.pdf' });
const OLD_PROOF = document({
  id: '44444444-4444-4444-8444-444444444444',
  state: 'replaced',
  fileName: 'antigo.pdf',
  endedAt: new Date(2026, 10, 13, 11, 0).toISOString(),
  endedBy: 'desktop-financeiro',
  revertibleUntil: new Date(2026, 11, 13, 11, 0).toISOString(),
});
const PURGED = document({
  id: '55555555-5555-4555-8555-555555555555',
  state: 'purged',
  fileName: null,
  endedAt: new Date(2026, 8, 1, 9, 0).toISOString(),
  endedBy: 'desktop-financeiro',
});

let hunit: FakeHunit;

/** Mostra o detalhe e espera o perfil da conexão chegar (as ações dependem dele). */
async function show(current: ReservationTreatment, more: Partial<TreatmentDetail> = {}) {
  mocked(hunit.api.treatments.get).mockImplementation(() =>
    okResult(detail({ treatment: current, ...more })),
  );
  renderWithApp(
    <ReservationDetail reservation={pendingReservation('7001', { treatment: current })} />,
    hunit,
  );
  await waitFor(() => expect(hunit.api.connection.getState).toHaveBeenCalled());
  await act(() => Promise.resolve());
}

const section = () => within(screen.getByTestId('treatment-section'));

/** A linha do documento (tela 4.7) cujo texto contém `text` (nome do arquivo ou "arquivo apagado"). */
async function documentRow(text: RegExp): Promise<HTMLElement> {
  const list = await section().findByRole('list', { name: 'Documentos da tratativa' });
  return waitFor(() => {
    const row = within(list)
      .getAllByRole('listitem')
      .find((item) => text.test(item.textContent ?? ''));
    if (!row) throw new Error(`documento ${String(text)} não encontrado`);
    return row;
  });
}

/** Reserva com tratativa que o Hunit passou a mostrar como "Já cobrada" (FR-002a). */
const REVIEW = treatment({
  status: 'sent',
  situation: 'virtual_card_already_charged',
  needsReview: true,
  acceptsDocuments: false,
  request: REQUEST,
});

async function showReview(current = REVIEW) {
  mocked(hunit.api.treatments.get).mockImplementation(() =>
    okResult(detail({ treatment: current, documents: [REQUEST] })),
  );
  renderWithApp(
    <ReservationDetail
      reservation={pendingReservation('7001', {
        classification: 'virtual_card_already_charged',
        treatment: current,
      })}
    />,
    hunit,
  );
  await waitFor(() => expect(hunit.api.connection.getState).toHaveBeenCalled());
  await act(() => Promise.resolve());
}

function events(count: number): TreatmentDetail['events'] {
  return Array.from({ length: count }, (_, index) => ({
    id: count - index,
    type: 'amount_set' as const,
    kind: null,
    documentId: null,
    previousDocumentId: null,
    amount: `${100 + index}.00`,
    classification: null,
    batchId: null,
    client: 'desktop-financeiro',
    at: new Date(2026, 10, 13, 10, index).toISOString(),
  }));
}

beforeEach(() => {
  hunit = fakeHunit();
});

describe('alerta "Verificar" (FR-002a)', () => {
  it('o operador vê o motivo e confirma; a confirmação vai para o servidor', async () => {
    mocked(hunit.api.treatments.confirmReview).mockImplementation(() =>
      okResult({ ...REVIEW, needsReview: false }),
    );
    await showReview();
    const user = userEvent.setup();

    const alert = section().getByTestId('review-alert');
    expect(alert).toHaveTextContent('o Hunit passou a mostrar esta reserva como Já cobrada');
    expect(alert).toHaveTextContent('A tratativa continua registrada');
    await user.click(within(alert).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(hunit.api.treatments.confirmReview).toHaveBeenCalledWith(KEY));
    expect(await section().findByText('Verificação confirmada.')).toBeInTheDocument();
  });

  it('o perfil consulta vê o alerta, mas não confirma', async () => {
    hunit = fakeHunit(ONLINE_READER);
    await showReview();

    const alert = section().getByTestId('review-alert');
    expect(alert).toHaveTextContent('Já cobrada');
    expect(within(alert).queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
  });

  it('sem alerta, não mostra nada', async () => {
    await show(treatment({ status: 'sent', request: REQUEST }));
    expect(section().queryByTestId('review-alert')).not.toBeInTheDocument();
  });

  it('a confirmação aparece no histórico com o status do Hunit', async () => {
    const [first] = events(1);
    await show(treatment({ status: 'sent', request: REQUEST }), {
      events: [
        {
          ...(first as TreatmentDetail['events'][number]),
          type: 'review_confirmed',
          amount: null,
          classification: 'virtual_card_already_charged',
        },
      ],
    });

    expect(
      await section().findByText(/Confirmou a verificação: Já cobrada — desktop-financeiro/),
    ).toBeInTheDocument();
  });
});

describe('histórico (FR-017a)', () => {
  const items = () =>
    within(section().getByRole('list', { name: 'Histórico da tratativa' })).getAllByRole(
      'listitem',
    );

  it('mostra os 5 mais recentes e "Mostrar mais" traz mais 10 a cada clique', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), { events: events(18) });
    const user = userEvent.setup();

    await waitFor(() => expect(items()).toHaveLength(5));
    await user.click(section().getByRole('button', { name: 'Mostrar mais' }));
    expect(items()).toHaveLength(15);
    await user.click(section().getByRole('button', { name: 'Mostrar mais' }));
    expect(items()).toHaveLength(18);
    expect(section().queryByRole('button', { name: 'Mostrar mais' })).not.toBeInTheDocument();
  });

  it('com até 5 itens, não mostra o botão', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), { events: events(5) });

    await waitFor(() => expect(items()).toHaveLength(5));
    expect(section().queryByRole('button', { name: 'Mostrar mais' })).not.toBeInTheDocument();
  });
});

describe('situação e documentos', () => {
  it('sem tratativa: oferece anexar a tratativa e o comprovante', async () => {
    await show(treatment());

    expect(section().getByText('Sem tratativa')).toBeInTheDocument();
    expect(section().getByRole('button', { name: 'Anexar tratativa' })).toBeEnabled();
    expect(section().getByRole('button', { name: 'Anexar comprovante' })).toBeEnabled();
    await waitFor(() => expect(hunit.api.treatments.get).toHaveBeenCalledWith(KEY));
    expect(section().getAllByText('Nenhum arquivo anexado')).toHaveLength(2);
  });

  it('só com tratativa mostra "Tratativa enviada"; com comprovante, "Comprovante enviado"', async () => {
    await show(treatment({ status: 'sent', request: REQUEST }));
    expect(section().getByText('Tratativa enviada')).toBeInTheDocument();
  });

  it('mostra arquivo, tamanho, quem anexou e quando de cada documento atual', async () => {
    await show(treatment({ status: 'charged', request: REQUEST, proof: PROOF }), {
      documents: [PROOF, REQUEST],
    });

    expect(section().getByText('Comprovante enviado')).toBeInTheDocument();
    const proofRow = await documentRow(/comprovante\.pdf/);
    expect(proofRow).toHaveTextContent('Comprovante');
    expect(proofRow).toHaveTextContent('12,1 KB');
    expect(proofRow).toHaveTextContent('Anexado em 13/11/2026 10:30 por desktop-financeiro');
    expect(proofRow).toHaveTextContent('Atual');
    expect(await documentRow(/pedido\.eml/)).toHaveTextContent('Tratativa');
    // Com documento atual, o botão passa a "Substituir".
    expect(section().getByRole('button', { name: 'Substituir comprovante' })).toBeInTheDocument();
    expect(section().getByRole('button', { name: 'Substituir tratativa' })).toBeInTheDocument();
  });

  it('mostra os documentos anteriores, com o prazo de reversão e o arquivo já apagado', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), {
      documents: [PROOF, OLD_PROOF, PURGED],
    });

    const old = await documentRow(/antigo\.pdf/);
    expect(old).toHaveTextContent('Comprovante anterior');
    expect(old).toHaveTextContent('Substituído em 13/11/2026 11:00 por desktop-financeiro');
    expect(old).toHaveTextContent('pode ser revertido até 13/12/2026');
    expect(within(old).getByRole('button', { name: 'Reverter' })).toBeEnabled();

    const purged = await documentRow(/arquivo apagado/);
    expect(purged).toHaveTextContent('Arquivo apagado pelo prazo de retenção');
    expect(within(purged).queryByRole('button', { name: 'Baixar' })).not.toBeInTheDocument();
    expect(within(purged).queryByRole('button', { name: 'Reverter' })).not.toBeInTheDocument();
  });

  it('reserva que não aceita documentos: explica e desabilita anexar', async () => {
    await show(treatment({ acceptsDocuments: false }));

    expect(section().getByText(/não exige cobrança, por isso ela não aceita/i)).toBeInTheDocument();
    expect(section().getByRole('button', { name: 'Anexar comprovante' })).toBeDisabled();
    expect(section().getByRole('button', { name: 'Anexar tratativa' })).toBeDisabled();
  });
});

describe('ações do operador', () => {
  it('"Anexar comprovante" abre o diálogo para esta reserva', async () => {
    await show(treatment());

    await userEvent.click(section().getByRole('button', { name: 'Anexar comprovante' }));

    await waitFor(() =>
      expect(hunit.api.treatments.pickFile).toHaveBeenCalledWith({ kind: 'proof' }),
    );
  });

  it('desfazer pede confirmação antes de chamar o servidor', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), { documents: [PROOF] });
    const user = userEvent.setup();

    await user.click(await section().findByRole('button', { name: 'Desfazer' }));

    const confirm = await screen.findByRole('dialog', { name: 'Desfazer o comprovante?' });
    expect(confirm).toHaveTextContent('fica guardado por 30 dias e pode ser revertido');
    expect(hunit.api.treatments.remove).not.toHaveBeenCalled();

    // "Manter" não desfaz nada.
    await user.click(within(confirm).getByRole('button', { name: 'Manter' }));
    expect(hunit.api.treatments.remove).not.toHaveBeenCalled();

    await user.click(section().getByRole('button', { name: 'Desfazer' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Desfazer o comprovante?' })).getByRole(
        'button',
        { name: 'Desfazer' },
      ),
    );

    await waitFor(() => expect(hunit.api.treatments.remove).toHaveBeenCalledWith(PROOF.id));
    expect(await section().findByRole('status')).toHaveTextContent('Comprovante desfeito.');
  });

  it('reverter chama o servidor e mostra o erro dele quando o prazo venceu', async () => {
    mocked(hunit.api.treatments.revert)
      .mockImplementationOnce(() => errorResult('document_not_revertible'))
      .mockImplementationOnce(() => okResult(treatment({ status: 'charged', proof: OLD_PROOF })));
    await show(treatment({ status: 'charged', proof: PROOF }), { documents: [PROOF, OLD_PROOF] });
    const user = userEvent.setup();

    await user.click(await section().findByRole('button', { name: 'Reverter' }));
    expect(await section().findByRole('alert')).toHaveTextContent(
      'Este documento não pode mais ser revertido.',
    );

    await user.click(section().getByRole('button', { name: 'Reverter' }));
    expect(await section().findByRole('status')).toHaveTextContent('Documento revertido.');
    expect(hunit.api.treatments.revert).toHaveBeenLastCalledWith(OLD_PROOF.id);
  });

  it('informa o valor cobrado no formato brasileiro e o remove', async () => {
    mocked(hunit.api.treatments.setManualAmount).mockImplementation(() =>
      okResult(treatment({ status: 'charged', proof: PROOF, manualChargedAmount: '1234.56' })),
    );
    await show(treatment({ status: 'charged', proof: PROOF }), { documents: [PROOF] });
    const user = userEvent.setup();
    const field = section().getByLabelText('Corrigir o valor cobrado (R$)');

    await user.type(field, 'doze');
    await user.click(section().getByRole('button', { name: 'Informar valor' }));
    expect(await section().findByRole('alert')).toHaveTextContent('Valor inválido.');
    expect(hunit.api.treatments.setManualAmount).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, '1.234,56');
    await user.click(section().getByRole('button', { name: 'Informar valor' }));

    await waitFor(() =>
      expect(hunit.api.treatments.setManualAmount).toHaveBeenCalledWith({
        ...KEY,
        amount: '1234.56',
      }),
    );
  });

  it('mostra o valor informado à mão com o rótulo e deixa remover', async () => {
    mocked(hunit.api.treatments.clearManualAmount).mockImplementation(() =>
      okResult(treatment({ status: 'charged', proof: PROOF })),
    );
    await show(treatment({ status: 'charged', proof: PROOF, manualChargedAmount: '500.00' }), {
      documents: [PROOF],
    });

    // O valor salvo numa caixa à parte, com "Remover valor" (FR-026, tela 4.7).
    const saved = section().getByTestId('manual-amount');
    expect(saved).toHaveTextContent('Valor informado à mão');
    expect(saved.textContent?.replace(/\s+/g, ' ')).toContain('R$ 500,00');
    expect(within(saved).getByRole('button', { name: 'Remover valor' })).toBeInTheDocument();

    await userEvent.click(section().getByRole('button', { name: 'Remover valor' }));

    await waitFor(() => expect(hunit.api.treatments.clearManualAmount).toHaveBeenCalledWith(KEY));
  });

  it('sem comprovante, não oferece informar o valor (FR-005)', async () => {
    await show(treatment({ status: 'sent', request: REQUEST }));

    expect(section().queryByLabelText('Corrigir o valor cobrado (R$)')).not.toBeInTheDocument();
  });

  it('baixar chama o processo principal, que abre "Salvar como"', async () => {
    mocked(hunit.api.treatments.saveDocument).mockImplementation(() =>
      okResult({ savedTo: 'C:\\Downloads\\comprovante.pdf' }),
    );
    await show(treatment({ status: 'charged', proof: PROOF }), { documents: [PROOF] });

    await userEvent.click(await section().findByRole('button', { name: 'Baixar' }));

    expect(hunit.api.treatments.saveDocument).toHaveBeenCalledWith(PROOF.id);
    expect(await section().findByRole('status')).toHaveTextContent(
      'Salvo em C:\\Downloads\\comprovante.pdf',
    );
  });
});

describe('histórico (FR-012)', () => {
  it('lista cada ação com quem fez e quando', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), {
      documents: [PROOF],
      events: [
        {
          id: 3,
          type: 'amount_set',
          kind: null,
          documentId: null,
          previousDocumentId: null,
          amount: '500.00',
          batchId: null,
          client: 'desktop-financeiro',
          at: new Date(2026, 10, 13, 12, 0).toISOString(),
        },
        {
          id: 2,
          type: 'replaced',
          kind: 'proof',
          documentId: PROOF.id,
          previousDocumentId: OLD_PROOF.id,
          amount: null,
          batchId: null,
          client: 'desktop-financeiro',
          at: new Date(2026, 10, 13, 11, 0).toISOString(),
        },
        {
          id: 1,
          type: 'attached',
          kind: 'request',
          documentId: REQUEST.id,
          previousDocumentId: null,
          amount: null,
          batchId: null,
          client: 'outra-maquina',
          at: new Date(2026, 10, 12, 9, 0).toISOString(),
        },
      ],
    });

    const history = within(await screen.findByRole('list', { name: 'Histórico da tratativa' }));
    const items = history.getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toMatch(
      /13\/11\/2026 12:00 — Informou valor: R\$\s500,00 — desktop-financeiro/,
    );
    expect(items[1]).toBe('13/11/2026 11:00 — Substituiu comprovante — desktop-financeiro');
    expect(items[2]).toBe('12/11/2026 09:00 — Anexou tratativa — outra-maquina');
  });
});

describe('perfil consulta (FR-014, FR-017)', () => {
  it('vê documentos e histórico e baixa, sem nenhuma ação de registro', async () => {
    hunit = fakeHunit(ONLINE_READER);
    await show(treatment({ status: 'charged', proof: PROOF, manualChargedAmount: '500.00' }), {
      documents: [PROOF, OLD_PROOF],
    });

    expect(await documentRow(/antigo\.pdf/)).toBeInTheDocument();
    expect(section().getAllByRole('button', { name: 'Baixar' })).toHaveLength(2);
    for (const name of [
      /anexar/i,
      /substituir/i,
      'Desfazer',
      'Reverter',
      'Remover valor',
      'Informar valor',
    ]) {
      expect(section().queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(section().queryByLabelText('Corrigir o valor cobrado (R$)')).not.toBeInTheDocument();
    // Também não aparece a explicação voltada ao operador.
    expect(section().queryByText(/não aceita novos documentos/i)).not.toBeInTheDocument();
  });
});

describe('card "Tratativa" no visual novo (specs/006, T045; telas 4.7 e 4.9)', () => {
  it('com "Verificar", anexar fica desabilitado com o motivo ao lado; confirmado, libera (FR-029)', async () => {
    // A reserva ainda aceita documentos: o bloqueio é só do alerta (research R-12).
    let current = treatment({
      status: 'sent',
      situation: 'virtual_card_charge_error',
      needsReview: true,
      request: REQUEST,
    });
    mocked(hunit.api.treatments.get).mockImplementation(() =>
      okResult(detail({ treatment: current, documents: [REQUEST] })),
    );
    mocked(hunit.api.treatments.confirmReview).mockImplementation(() => {
      current = { ...current, needsReview: false };
      return okResult(current);
    });
    renderWithApp(
      <ReservationDetail
        reservation={pendingReservation('7001', {
          classification: 'virtual_card_charge_error',
          treatment: current,
        })}
      />,
      hunit,
    );
    await waitFor(() => expect(hunit.api.connection.getState).toHaveBeenCalled());
    const user = userEvent.setup();

    const attachRequest = await section().findByRole('button', { name: 'Substituir tratativa' });
    const attachProof = section().getByRole('button', { name: 'Anexar comprovante' });
    await waitFor(() => expect(attachRequest).toBeDisabled());
    expect(attachProof).toBeDisabled();
    expect(section().getByTestId('attach-blocked')).toHaveTextContent(
      'Confirme o alerta “Verificar” antes de anexar novos documentos.',
    );
    // Os documentos continuam com "Baixar".
    expect(
      within(await documentRow(/pedido\.eml/)).getByRole('button', { name: 'Baixar' }),
    ).toBeEnabled();

    await user.click(
      within(section().getByTestId('review-alert')).getByRole('button', { name: 'Confirmar' }),
    );

    await waitFor(() => expect(attachRequest).toBeEnabled());
    expect(attachProof).toBeEnabled();
    expect(section().queryByTestId('attach-blocked')).not.toBeInTheDocument();
    expect(section().queryByTestId('review-alert')).not.toBeInTheDocument();
  });

  it('o valor digitado não substitui o salvo antes de "Informar valor" (FR-026)', async () => {
    await show(treatment({ status: 'charged', proof: PROOF, manualChargedAmount: '500.00' }), {
      documents: [PROOF],
    });
    const user = userEvent.setup();

    await user.type(section().getByLabelText('Corrigir o valor cobrado (R$)'), '700,00');

    const saved = section().getByTestId('manual-amount');
    expect(saved.textContent?.replace(/\s+/g, ' ')).toContain('R$ 500,00');
    expect(saved.textContent?.replace(/\s+/g, ' ')).not.toContain('700');
    expect(hunit.api.treatments.setManualAmount).not.toHaveBeenCalled();
  });

  it('sem valor salvo, "Valor informado à mão" mostra "—" e não oferece remover', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), { documents: [PROOF] });
    expect(section().queryByTestId('manual-amount')).not.toBeInTheDocument();
    expect(section().getByText('Valor informado à mão').nextSibling).toHaveTextContent('—');
    expect(section().queryByRole('button', { name: 'Remover valor' })).not.toBeInTheDocument();
  });

  it('cada documento numa linha com o ícone, o arquivo e a situação (FR-020)', async () => {
    await show(treatment({ status: 'charged', request: REQUEST, proof: PROOF }), {
      documents: [PROOF, REQUEST],
    });
    const rows = within(
      await section().findByRole('list', { name: 'Documentos da tratativa' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toMatch(/^Tratativapedido\.eml/);
    expect(rows[1]?.textContent).toMatch(/^Comprovantecomprovante\.pdf/);
    for (const row of rows) {
      expect(row.querySelector('svg')).not.toBeNull();
      expect(row).toHaveTextContent('Atual');
    }
  });
});

describe('hierarquia das ações (specs/006, T038; tela 4.7)', () => {
  const button = (name: string) => section().getByRole('button', { name });

  it('"Baixar", "Reverter", "Desfazer" e "Remover valor" são ações de documento distintas (FR-009, FR-010)', async () => {
    await show(treatment({ status: 'charged', proof: PROOF, manualChargedAmount: '500.00' }), {
      documents: [PROOF, OLD_PROOF],
    });

    const old = await documentRow(/antigo\.pdf/);
    const current = await documentRow(/comprovante\.pdf/);
    expect(within(current).getByRole('button', { name: 'Baixar' })).toHaveAttribute(
      'data-kind',
      'download',
    );
    expect(within(current).getByRole('button', { name: 'Desfazer' })).toHaveAttribute(
      'data-kind',
      'undo',
    );
    expect(within(old).getByRole('button', { name: 'Reverter' })).toHaveAttribute(
      'data-kind',
      'revert',
    );
    expect(button('Remover valor')).toHaveAttribute('data-kind', 'remove');
  });

  it('"Anexar" e "Substituir" têm o mesmo peso para a tratativa e o comprovante (FR-012)', async () => {
    await show(treatment({ status: 'charged', request: REQUEST, proof: PROOF }), {
      documents: [PROOF, REQUEST],
    });
    expect(button('Substituir tratativa')).toHaveAttribute('data-variant', 'secondary');
    expect(button('Substituir comprovante')).toHaveAttribute('data-variant', 'secondary');
  });

  it('sem tratativa, "Anexar tratativa" e "Anexar comprovante" também são iguais (FR-012)', async () => {
    await show(treatment());
    expect(button('Anexar tratativa')).toHaveAttribute('data-variant', 'secondary');
    expect(button('Anexar comprovante')).toHaveAttribute('data-variant', 'secondary');
  });

  it('"Informar valor" é a principal do card; "Confirmar" é a do alerta "Verificar" (FR-007)', async () => {
    const current = treatment({ ...REVIEW, status: 'charged', proof: PROOF });
    await showReview(current);

    expect(button('Informar valor')).toHaveAttribute('data-variant', 'primary');
    expect(
      within(section().getByTestId('review-alert')).getByRole('button', { name: 'Confirmar' }),
    ).toHaveAttribute('data-variant', 'primary');
    expectOnePrimaryPerBlock();
  });

  it('o desfazer confirmado é vermelho cheio e "Manter" é só texto (FR-009, FR-011)', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), { documents: [PROOF] });
    const user = userEvent.setup();

    await user.click(await section().findByRole('button', { name: 'Desfazer' }));

    const confirm = await screen.findByRole('dialog', { name: 'Desfazer o comprovante?' });
    expect(within(confirm).getByRole('button', { name: 'Desfazer' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
    expect(within(confirm).getByRole('button', { name: 'Manter' })).toHaveAttribute(
      'data-variant',
      'text',
    );
    expectOnePrimaryPerBlock();
  });

  it('"Mostrar mais" é só texto', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), { events: events(8) });
    expect(await section().findByRole('button', { name: 'Mostrar mais' })).toHaveAttribute(
      'data-variant',
      'text',
    );
  });
});
