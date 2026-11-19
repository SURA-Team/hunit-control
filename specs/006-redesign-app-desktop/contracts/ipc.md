# Ponte do app (`window.hunit`): acréscimos

**Feature**: [spec.md](../spec.md) | **Research**: [R-09](../research.md#r-09--filtros-rápidos-filtro-novo-e-contagens-na-api-contrato-180)

Regras de sempre (002): o renderer não tem Node nem rede; toda chamada passa pelo processo principal,
que valida a entrada com `ipc-schemas.ts` e fala com a API. Esta feature só acrescenta.

## `reservations`

```ts
reservations: {
  // existentes: list, get, channels, selectAll
  /** Contagem dos filtros rápidos com os mesmos filtros da lista (sem quickFilter). */
  quickFilterCounts: (filters: ReservationCountFilters) => Promise<Result<ReservationQuickFilterCounts>>;
};
```

## Tipos (`shared/ipc-types.ts`)

```ts
type ReservationQuickFilter = 'pending_charge' | 'to_review' | 'with_error' | 'done';
type ReservationOrder = 'hotel_number' | 'hotel_check_in';

interface ReservationListInput {
  // campos existentes…
  quickFilter?: ReservationQuickFilter | undefined; // novo
  order?: ReservationOrder | undefined;             // novo; o renderer sempre manda 'hotel_check_in'
}

/** Os filtros da lista, sem paginação, sem o filtro rápido e sem a ordem. */
type ReservationCountFilters = Omit<ReservationListInput, 'cursor' | 'limit' | 'quickFilter' | 'order'>;

interface ReservationQuickFilterCounts {
  all: number;
  pendingCharge: number;
  toReview: number;
  withError: number;
  done: number;
}
```

`ReservationFilters` (usado por `selectAll` e pela cópia para e-mail) passa a aceitar `quickFilter`
e `order`, por derivar de `ReservationListInput`.

## Canal novo (`shared/ipc-channels.ts`)

| Constante | Canal |
|---|---|
| `reservationsQuickFilterCounts` | `reservations:quickFilterCounts` |

Validação no principal: `reservationCountFiltersSchema` (o `reservationListInputSchema` sem
`cursor`, `limit`, `quickFilter` e `order`, com o mesmo `strictObject`). Entrada inválida → erro
`invalid_input`, como os outros canais.
