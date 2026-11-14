/**
 * Seleção de reservas para aplicar um documento em lote (specs/003, US3, FR-006a, research R-09).
 *
 * A seleção fica acima da tela de reservas e **não depende do resultado da pesquisa**: marcar uma
 * reserva, pesquisar outra, trocar filtros, mudar de página ou de área do app não desmarca nada.
 * (No sistema anterior a seleção ficava presa às linhas do resultado e se perdia a cada pesquisa.)
 *
 * Só em memória: fechar o app limpa a seleção, como tudo o que o app mostra de reservas.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  MAX_TREATMENT_RESERVATIONS,
  type Reservation,
  type ReservationKey,
} from '../../../shared/ipc-types';

/** O que a lista da seleção mostra de cada reserva marcada. */
export interface SelectedReservation extends ReservationKey {
  guestName: string | null;
  totalAmount: string | null;
  classification: Reservation['classification'];
  treatmentStatus: Reservation['treatment']['status'];
}

export interface SelectionValue {
  /** Reservas marcadas, na ordem em que foram marcadas. */
  items: SelectedReservation[];
  has(key: ReservationKey): boolean;
  /**
   * Marca as reservas que ainda não estão marcadas, até o limite. Devolve quantas ficaram de fora
   * por causa do limite, para a tela avisar.
   */
  add(reservations: readonly Reservation[]): { skipped: number };
  remove(keys: readonly ReservationKey[]): void;
  /** Mantém marcadas só estas reservas (as que falharam num lote). */
  keepOnly(keys: readonly ReservationKey[]): void;
  clear(): void;
}

export const SELECTION_LIMIT = MAX_TREATMENT_RESERVATIONS;

export const selectionKey = (key: ReservationKey) =>
  `${key.hotelCode}\u0000${key.reservationNumber}`;

function toSelected(reservation: Reservation): SelectedReservation {
  return {
    hotelCode: reservation.hotelCode,
    reservationNumber: reservation.reservationNumber,
    guestName: reservation.anonymized ? null : (reservation.guestName ?? null),
    totalAmount: reservation.totalAmount ?? null,
    classification: reservation.classification,
    treatmentStatus: reservation.treatment.status,
  };
}

const EMPTY: SelectionValue = {
  items: [],
  has: () => false,
  add: () => ({ skipped: 0 }),
  remove: () => undefined,
  keepOnly: () => undefined,
  clear: () => undefined,
};

const SelectionContext = createContext<SelectionValue>(EMPTY);

export function SelectionProvider({ children }: { children: ReactNode }) {
  // O Map guarda a ordem de inclusão, que é a ordem mostrada na lista da seleção.
  const [selected, setSelected] = useState<ReadonlyMap<string, SelectedReservation>>(new Map());

  const add = useCallback(
    (reservations: readonly Reservation[]) => {
      const next = new Map(selected);
      let skipped = 0;
      for (const reservation of reservations) {
        const key = selectionKey(reservation);
        if (next.has(key)) continue;
        if (next.size >= SELECTION_LIMIT) {
          skipped += 1;
          continue;
        }
        next.set(key, toSelected(reservation));
      }
      setSelected(next);
      return { skipped };
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
