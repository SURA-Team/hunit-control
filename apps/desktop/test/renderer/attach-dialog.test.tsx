/**
 * Diálogo de anexar (specs/003, T025 e T047; US1 a US3, FR-006, FR-018): escolher →
 * pré-visualização → conferência do servidor → confirmação → resultado. Cancelar descarta o
 * arquivo sem enviar nada; com a conexão interrompida, "Tentar de novo" não pede o arquivo outra
 * vez.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachDialog } from '../../src/renderer/src/screens/reservations/AttachDialog';
import type { ReservationKey, TreatmentApplyResult } from '../../src/shared/ipc-types';
import { expectOnePrimaryPerBlock } from './hierarchy';
import { errorResult, fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';
import { check, document, outcome, pickedFile } from './treatment-fixtures';

const key = (reservationNumber: string): ReservationKey => ({
  hotelCode: '31',
  reservationNumber,
});

let hunit: FakeHunit;
let onClose: ReturnType<typeof vi.fn<(result: TreatmentApplyResult | null) => void>>;

beforeEach(() => {
  hunit = fakeHunit();
  onClose = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:teste');
  URL.revokeObjectURL = vi.fn();
  mocked(hunit.api.treatments.pickFile).mockImplementation(() => okResult(pickedFile()));
  mocked(hunit.api.treatments.check).mockImplementation((input) =>
    okResult(
      check(
        input.reservations.map((reservation) => outcome(reservation.reservationNumber)),
        '100.00',
      ),
    ),
  );
  mocked(hunit.api.treatments.apply).mockImplementation((input) =>
    okResult({
      items: input.reservations.map((reservation) => outcome(reservation.reservationNumber)),
      failedKeys: [],
      retryable: false,
    }),
  );
});

const click = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));

/** A reserva na caixa das que ficam de fora ("7003 (hotel 31)" e o motivo). */
function leftOutItem(list: HTMLElement, number: string) {
  return within(list)
    .getAllByRole('listitem')
    .find((item) => item.textContent?.startsWith(`${number} (hotel`));
}

describe('uma reserva', () => {
  it('abre a escolha do arquivo, mostra a pré-visualização e só registra depois de confirmar', async () => {
    renderWithApp(
      <AttachDialog kind="proof" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );

    expect(await screen.findByRole('dialog', { name: /anexar comprovante/i })).toBeVisible();
    expect(await screen.findByTestId('document-preview')).toHaveTextContent('comprovante.png');
    expect(hunit.api.treatments.pickFile).toHaveBeenCalledWith({ kind: 'proof' });
    expect(hunit.api.treatments.check).toHaveBeenCalledWith({
      kind: 'proof',
      reservations: [key('7001')],
    });
    expect(await screen.findByTestId('attach-summary')).toHaveTextContent(
      'será registrado como o comprovante desta reserva',
    );
    // Nada foi enviado ainda.
    expect(hunit.api.treatments.apply).not.toHaveBeenCalled();

    await click('Confirmar');

    expect(hunit.api.treatments.apply).toHaveBeenCalledWith({
      selectionId: pickedFile().selectionId,
      kind: 'proof',
      reservations: [key('7001')],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Comprovante registrado.');

    await click('Fechar');
    expect(onClose).toHaveBeenCalledWith({
      items: [outcome('7001')],
      failedKeys: [],
      retryable: false,
    });
  });

  it('numa substituição, mostra qual documento será substituído', async () => {
    mocked(hunit.api.treatments.check).mockImplementation(() =>
      okResult(check([outcome('7001', { outcome: 'replaced' })], '100.00')),
    );

    renderWithApp(
      <AttachDialog
        kind="proof"
        reservations={[key('7001')]}
        current={document({ fileName: 'antigo.pdf' })}
        onClose={onClose}
      />,
      hunit,
    );

    const summary = await screen.findByTestId('attach-summary');
    expect(summary).toHaveTextContent('Substitui o comprovante atual');
    expect(summary).toHaveTextContent(
      'antigo.pdf, anexado por desktop-financeiro em 13/11/2026 10:30',
    );
    expect(summary).toHaveTextContent('fica guardado por 30 dias e pode ser revertido');
  });

  it('cancelar descarta o arquivo e não envia nada (FR-018)', async () => {
    renderWithApp(
      <AttachDialog kind="request" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );
    await screen.findByTestId('attach-summary');

    await click('Cancelar');

    expect(hunit.api.treatments.discardFile).toHaveBeenCalledWith(pickedFile().selectionId);
    expect(hunit.api.treatments.apply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(null);
  });

  it('diálogo de arquivo cancelado fecha sem nada', async () => {
    mocked(hunit.api.treatments.pickFile).mockImplementation(() => okResult(null));

    renderWithApp(
      <AttachDialog kind="proof" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(null));
    expect(hunit.api.treatments.check).not.toHaveBeenCalled();
  });

  it('arquivo recusado na escolha mostra o motivo e deixa escolher outro', async () => {
    mocked(hunit.api.treatments.pickFile)
      .mockImplementationOnce(() => errorResult('file_too_large'))
      .mockImplementationOnce(() => okResult(pickedFile({ fileName: 'menor.png' })));

    renderWithApp(
      <AttachDialog kind="proof" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('O arquivo tem mais de 25 MB.');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();

    await click('Escolher outro arquivo');

    expect(await screen.findByTestId('document-preview')).toHaveTextContent('menor.png');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
  });

  it('reserva que não aceita: mostra o motivo do servidor e não deixa confirmar', async () => {
    mocked(hunit.api.treatments.check).mockImplementation(() =>
      okResult(check([outcome('7001', { outcome: 'ignored', reason: 'not_eligible' })])),
    );

    renderWithApp(
      <AttachDialog kind="proof" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta reserva não exige cobrança.');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });

  it('pré-visualização indisponível ainda deixa confirmar (FR-018a)', async () => {
    mocked(hunit.api.treatments.pickFile).mockImplementation(() =>
      okResult(
        pickedFile({
          fileName: 'pedido.msg',
          mediaType: 'application/vnd.ms-outlook',
          preview: { type: 'unavailable', reason: 'unreadable' },
        }),
      ),
    );

    renderWithApp(
      <AttachDialog kind="request" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );

    expect(await screen.findByText(/não foi possível pré-visualizar/i)).toBeInTheDocument();
    await screen.findByTestId('attach-summary');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
  });

  it('arquivo recusado pelo servidor no envio: mostra o erro e fecha sem registro', async () => {
    mocked(hunit.api.treatments.apply).mockImplementation(() =>
      errorResult('unsupported_file_type'),
    );
    renderWithApp(
      <AttachDialog kind="proof" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );
    await screen.findByTestId('attach-summary');

    await click('Confirmar');

    expect(await screen.findByRole('alert')).toHaveTextContent('Tipo não aceito.');
    await click('Fechar');
    expect(onClose).toHaveBeenCalledWith(null);
  });
});

describe('hierarquia das ações (specs/006, T039, FR-011; telas 4.6 e 4.8)', () => {
  it('diálogo largo; "Cancelar" só texto, "Escolher outro arquivo" em contorno e uma principal', async () => {
    renderWithApp(
      <AttachDialog kind="request" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Anexar tratativa' });
    await screen.findByTestId('attach-summary');

    expect(dialog).toHaveAttribute('data-size', 'lg');
    const actions = within(dialog);
    expect(actions.getByRole('button', { name: 'Cancelar' })).toHaveAttribute(
      'data-variant',
      'text',
    );
    expect(actions.getByRole('button', { name: 'Escolher outro arquivo' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    expect(actions.getByRole('button', { name: 'Confirmar' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expectOnePrimaryPerBlock();
  });

  it('no desfecho sem pendência, "Fechar" é a principal e não há "Cancelar"', async () => {
    renderWithApp(
      <AttachDialog kind="proof" reservations={[key('7001')]} onClose={onClose} />,
      hunit,
    );
    await screen.findByTestId('attach-summary');
    await click('Confirmar');
    await screen.findByTestId('attach-result');

    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });
});

describe('várias reservas (lote)', () => {
  const batch = [key('7001'), key('7002'), key('7003'), key('7004')];

  beforeEach(() => {
    mocked(hunit.api.treatments.check).mockImplementation(() =>
      okResult(
        check(
          [
            outcome('7001'),
            outcome('7002', { outcome: 'replaced' }),
            outcome('7003', { outcome: 'ignored', reason: 'not_eligible' }),
            outcome('7004', { outcome: 'ignored', reason: 'not_found' }),
          ],
          '1234.50',
        ),
      ),
    );
  });

  it('a confirmação mostra a pré-visualização, as aceitas, as ignoradas com o motivo e o total', async () => {
    renderWithApp(<AttachDialog kind="proof" reservations={batch} onClose={onClose} />, hunit);

    expect(
      await screen.findByRole('dialog', { name: /anexar comprovante a 4 reservas/i }),
    ).toBeVisible();
    expect(screen.getByTestId('document-preview')).toBeInTheDocument();
    const summary = await screen.findByTestId('attach-summary');
    expect(summary).toHaveTextContent('2 reservas aceitam o documento — total de R$ 1.234,50');
    expect(summary).toHaveTextContent('1 já tem um documento desse tipo, que será substituído');
    expect(summary).toHaveTextContent('2 serão ignoradas');

    const leftOut = screen.getByRole('list', { name: 'Reservas que ficam de fora' });
    expect(leftOutItem(leftOut, '7003')).toHaveTextContent('Esta reserva não exige cobrança.');
    expect(leftOutItem(leftOut, '7004')).toHaveTextContent('Reserva não encontrada.');
  });

  it('o resumo marca as aceitas com o ícone verde e as ignoradas com o âmbar (FR-024, tela 4.6)', async () => {
    renderWithApp(<AttachDialog kind="proof" reservations={batch} onClose={onClose} />, hunit);
    const summary = await screen.findByTestId('attach-summary');

    const tones = [...summary.querySelectorAll('[data-tone]')].map((line) => [
      line.getAttribute('data-tone'),
      line.textContent?.replace(/\s+/g, ' '),
    ]);
    expect(tones).toEqual([
      ['green', '2 reservas aceitam o documento — total de R$ 1.234,50'],
      ['amber', '1 já tem um documento desse tipo, que será substituído'],
      ['amber', '2 serão ignoradas'],
    ]);
    // Cada linha tem o ícone (oculto do leitor de tela: o texto já diz o grupo, FR-006).
    for (const line of summary.querySelectorAll('[data-tone]')) {
      expect(line.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('sem ignoradas, não mostra a linha das ignoradas', async () => {
    mocked(hunit.api.treatments.check).mockImplementation(() =>
      okResult(check([outcome('7001'), outcome('7002')], '200.00')),
    );
    renderWithApp(<AttachDialog kind="proof" reservations={batch} onClose={onClose} />, hunit);
    const summary = await screen.findByTestId('attach-summary');

    expect(summary).toHaveTextContent('2 reservas aceitam o documento — total de R$ 200,00');
    expect(summary).not.toHaveTextContent('ignorada');
    expect(screen.queryByRole('list', { name: 'Reservas que ficam de fora' })).toBeNull();
  });

  it('o resultado lista o que foi registrado e o que ficou de fora', async () => {
    mocked(hunit.api.treatments.apply).mockImplementation(() =>
      okResult({
        items: [
          outcome('7001'),
          outcome('7002', { outcome: 'replaced' }),
          outcome('7003', { outcome: 'ignored', reason: 'not_eligible' }),
          outcome('7004', { outcome: 'failed' }),
        ],
        failedKeys: [key('7004')],
        retryable: false,
      }),
    );
    renderWithApp(<AttachDialog kind="proof" reservations={batch} onClose={onClose} />, hunit);
    await screen.findByTestId('attach-summary');

    await click('Confirmar');

    const result = await screen.findByTestId('attach-result');
    expect(result).toHaveTextContent('Documento registrado em 2 reservas.');
    expect(result).toHaveTextContent('2 reservas ficaram de fora');
    // Com erro de registro no grupo, a linha fica vermelha.
    expect(
      within(result)
        .getByText(/ficaram de fora/)
        .closest('[data-tone]'),
    ).toHaveAttribute('data-tone', 'red');
    expect(
      leftOutItem(within(result).getByRole('list', { name: 'Reservas que ficam de fora' }), '7004'),
    ).toHaveTextContent('Erro ao registrar. A reserva ficou como estava.');

    await click('Fechar');
    // Só a que falhou por erro volta para a seleção (FR-006a).
    expect(onClose.mock.calls[0]?.[0]?.failedKeys).toEqual([key('7004')]);
  });

  it('conexão interrompida: "Tentar de novo" reenvia só as que faltaram, sem escolher o arquivo', async () => {
    mocked(hunit.api.treatments.apply)
      .mockImplementationOnce(() =>
        okResult({
          items: [outcome('7001')],
          failedKeys: [key('7002'), key('7003'), key('7004')],
          retryable: true,
          error: { code: 'offline' as const },
        }),
      )
      .mockImplementationOnce((input) =>
        okResult({
          items: input.reservations.map((reservation) => outcome(reservation.reservationNumber)),
          failedKeys: [],
          retryable: false,
        }),
      );
    renderWithApp(<AttachDialog kind="proof" reservations={batch} onClose={onClose} />, hunit);
    await screen.findByTestId('attach-summary');

    await click('Confirmar');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Servidor indisponível. 3 reservas ficaram sem o documento. O arquivo continua pronto para enviar.',
    );

    await click('Tentar de novo');

    await waitFor(() => expect(hunit.api.treatments.apply).toHaveBeenCalledTimes(2));
    expect(mocked(hunit.api.treatments.apply).mock.calls[1]?.[0]).toEqual({
      selectionId: pickedFile().selectionId,
      kind: 'proof',
      reservations: [key('7002'), key('7003'), key('7004')],
    });
    // O arquivo foi escolhido uma vez só.
    expect(hunit.api.treatments.pickFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Documento registrado em 4 reservas.',
    );
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('fechar com o envio interrompido descarta o arquivo e mantém as pendentes na seleção', async () => {
    mocked(hunit.api.treatments.apply).mockImplementation(() =>
      okResult({
        items: [outcome('7001')],
        failedKeys: [key('7002')],
        retryable: true,
        error: { code: 'offline' as const },
      }),
    );
    renderWithApp(<AttachDialog kind="proof" reservations={batch} onClose={onClose} />, hunit);
    await screen.findByTestId('attach-summary');
    await click('Confirmar');
    await screen.findByTestId('attach-result');

    await click('Fechar');

    expect(hunit.api.treatments.discardFile).toHaveBeenCalledWith(pickedFile().selectionId);
    expect(onClose.mock.calls[0]?.[0]?.failedKeys).toEqual([key('7002')]);
  });

  it('com o envio interrompido, "Tentar de novo" é a principal e "Fechar" fica em contorno', async () => {
    mocked(hunit.api.treatments.apply).mockImplementation(() =>
      okResult({
        items: [outcome('7001')],
        failedKeys: [key('7002')],
        retryable: true,
        error: { code: 'offline' as const },
      }),
    );
    renderWithApp(<AttachDialog kind="proof" reservations={batch} onClose={onClose} />, hunit);
    await screen.findByTestId('attach-summary');
    await click('Confirmar');
    await screen.findByTestId('attach-result');

    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    expectOnePrimaryPerBlock();
  });

  it('só a chave de cada reserva vai para a ponte', async () => {
    const withExtras = batch.map((item) => ({ ...item, guestName: 'Hóspede Fictício' }));

    renderWithApp(<AttachDialog kind="proof" reservations={withExtras} onClose={onClose} />, hunit);
    await screen.findByTestId('attach-summary');

    expect(mocked(hunit.api.treatments.check).mock.calls[0]?.[0].reservations).toEqual(batch);
  });
});
