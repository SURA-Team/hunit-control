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
    expect(section().getAllByText('Nenhum')).toHaveLength(2);
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
    const proofRow = section().getByRole('row', { name: /comprovante\.pdf/ });
    expect(proofRow).toHaveTextContent('12,1 KB');
    expect(proofRow).toHaveTextContent('13/11/2026 10:30');
    expect(proofRow).toHaveTextContent('por desktop-financeiro');
    expect(proofRow).toHaveTextContent('Atual');
    expect(section().getByRole('row', { name: /pedido\.eml/ })).toBeInTheDocument();
    // Com documento atual, o botão passa a "Substituir".
    expect(section().getByRole('button', { name: 'Substituir comprovante' })).toBeInTheDocument();
    expect(section().getByRole('button', { name: 'Substituir tratativa' })).toBeInTheDocument();
  });

  it('mostra os documentos anteriores, com o prazo de reversão e o arquivo já apagado', async () => {
    await show(treatment({ status: 'charged', proof: PROOF }), {
      documents: [PROOF, OLD_PROOF, PURGED],
    });

    const old = await section().findByRole('row', { name: /antigo\.pdf/ });
    expect(old).toHaveTextContent('Comprovante anterior');
    expect(old).toHaveTextContent('Substituído');
    expect(old).toHaveTextContent('pode ser revertido até 13/12/2026');
    expect(within(old).getByRole('button', { name: 'Reverter' })).toBeEnabled();

    const purged = section().getByRole('row', { name: /arquivo apagado/ });
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
    const field = section().getByLabelText('Valor que foi cobrado (R$)');

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

    expect(section().getByText(/R\$\s500,00 \(informado à mão\)/)).toBeInTheDocument();

    await userEvent.click(section().getByRole('button', { name: 'Remover valor' }));

    await waitFor(() => expect(hunit.api.treatments.clearManualAmount).toHaveBeenCalledWith(KEY));
  });

  it('sem comprovante, não oferece informar o valor (FR-005)', async () => {
    await show(treatment({ status: 'sent', request: REQUEST }));

    expect(section().queryByLabelText('Valor que foi cobrado (R$)')).not.toBeInTheDocument();
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

    expect(await section().findByRole('row', { name: /antigo\.pdf/ })).toBeInTheDocument();
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
    expect(section().queryByLabelText('Valor que foi cobrado (R$)')).not.toBeInTheDocument();
    // Também não aparece a explicação voltada ao operador.
    expect(section().queryByText(/não aceita novos documentos/i)).not.toBeInTheDocument();
  });
});
