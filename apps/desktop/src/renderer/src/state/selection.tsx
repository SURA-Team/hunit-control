/**
 * Seleção de reservas para aplicar um documento em lote (specs/003, US3, FR-006a, research R-09).
 *
 * A seleção fica acima da tela de reservas e **não depende do resultado da pesquisa**: marcar uma
 * reserva, pesquisar outra, trocar filtros, mudar de página ou de área do app não desmarca nada.
 * (No sistema anterior a seleção ficava presa às linhas do resultado e se perdia a cada pesquisa.)
 *
 * Só em memória: fechar o app limpa a seleção, como tudo o que o app mostra de reservas.
 *
 * Envio ao Comercial (specs/005): "selecionar todas do filtro" soma à seleção as reservas que o
 * servidor devolve (`SelectionItem`), e cada item guarda o que a cópia para e-mail, o envio e as
 * confirmações em lote precisam mostrar.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  MAX_TREATMENT_RESERVATIONS,
  type CommercialReturnBrief,
  type Reservation,
  type ReservationKey,
  type SelectionItem,
} from '../../../shared/ipc-types';

/** O que a lista da seleção mostra de cada reserva marcada. */
export interface SelectedReservation extends ReservationKey {
  guestName: string | null;
  channel: string | null;
  checkIn: string | null;
  totalAmount: string | null;
  reservationStatus: Reservation['reservationStatus'];
  classification: Reservation['classification'];
  treatmentStatus: Reservation['treatment']['status'];
  /** Situação da reserva e alerta quando foi marcada (specs/003, FR-002, FR-002a). */
  situation: Reservation['treatment']['situation'];
  /** Situação com o detalhe do Comercial (specs/005): "Validar comprovante". */
  detailedSituation: Reservation['treatment']['detailedSituation'];
  needsReview: boolean;
  /** Retorno do Comercial quando foi marcada (lista de revisão da confirmação em lote, FR-016a). */
  currentReturn: CommercialReturnBrief | null;
}

/** Reserva da lista ou da seleção do filtro (specs/005, FR-030). */
export type Selectable = Reservation | SelectionItem;

export interface SelectionValue {
  /** Reservas marcadas, na ordem em que foram marcadas. */
  items: SelectedReservation[];
  has(key: ReservationKey): boolean;
  /**
   * Marca as reservas que ainda não estão marcadas, até o limite. Devolve quantas foram marcadas
   * agora e quantas ficaram de fora por causa do limite, para a tela avisar.
   */
  add(reservations: readonly Selectable[]): { added: number; skipped: number };
  remove(keys: readonly ReservationKey[]): void;
  /** Mantém marcadas só estas reservas (as que falharam num lote). */
  keepOnly(keys: readonly ReservationKey[]): void;
  clear(): void;
}

export const SELECTION_LIMIT = MAX_TREATMENT_RESERVATIONS;

export const selectionKey = (key: ReservationKey) =>
  `${key.hotelCode}\u0000${key.reservationNumber}`;

export function toSelected(item: Selectable): SelectedReservation {
  const base = {
    hotelCode: item.hotelCode,
    reservationNumber: item.reservationNumber,
    channel: item.channel ?? null,
    checkIn: item.checkIn ?? null,
    totalAmount: item.totalAmount ?? null,
    reservationStatus: item.reservationStatus,
    classification: item.classification,
  };
  if ('treatment' in item) {
    return {
      ...base,
      guestName: item.anonymized ? null : (item.guestName ?? null),
      treatmentStatus: item.treatment.status,
      situation: item.treatment.situation,
      detailedSituation: item.treatment.detailedSituation,
      needsReview: item.treatment.needsReview,
      currentReturn: item.commercial?.currentReturn ?? null,
    };
  }
  return {
    ...base,
    guestName: item.guestName,
    treatmentStatus: item.treatmentStatus,
    situation: item.situation,
    detailedSituation: item.detailedSituation,
    needsReview: item.needsReview,
    currentReturn: item.currentReturn,
  };
}

const EMPTY: SelectionValue = {
  items: [],
  has: () => false,
  add: () => ({ added: 0, skipped: 0 }),
  remove: () => undefined,
  keepOnly: () => undefined,
  clear: () => undefined,
};

const SelectionContext = createContext<SelectionValue>(EMPTY);

export function SelectionProvider({ children }: { children: ReactNode }) {
  // O Map guarda a ordem de inclusão, que é a ordem mostrada na lista da seleção.
  const [selected, setSelected] = useState<ReadonlyMap<string, SelectedReservation>>(new Map());

  const add = useCallback(
    (reservations: readonly Selectable[]) => {
      const next = new Map(selected);
      let added = 0;
      let skipped = 0;
      for (const reservation of reservations) {
        const key = selectionKey(reservation);
        if (next.has(key)) continue;
        if (next.size >= SELECTION_LIMIT) {
          skipped += 1;
          continue;
        }
        next.set(key, toSelected(reservation));
        added += 1;
      }
      setSelected(next);
      return { added, skipped };
    },
    [selected],
  );

  const remove = useCallback((keys: readonly ReservationKey[]) => {
    setSelected((current) => {
      const next = new Map(current);
      for (const key of keys) next.delete(selectionKey(key));
      return next;
    });
  }, []);

  const keepOnly = useCallback((keys: readonly ReservationKey[]) => {
    const keep = new Set(keys.map(selectionKey));
    setSelected((current) => new Map([...current].filter(([key]) => keep.has(key))));
  }, []);

  const clear = useCallback(() => setSelected(new Map()), []);

  const value = useMemo<SelectionValue>(
    () => ({
      items: [...selected.values()],
      has: (key) => selected.has(selectionKey(key)),
      add,
      remove,
      keepOnly,
      clear,
    }),
    [selected, add, remove, keepOnly, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  return useContext(SelectionContext);
}
