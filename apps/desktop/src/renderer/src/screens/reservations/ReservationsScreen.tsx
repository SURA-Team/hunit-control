/**
 * Tela Reservas (specs/002, US3; specs/003, US3 e US4; specs/005; desde a 006 no visual novo, telas
 * 4.1, 4.3, 4.4, 4.12 e 6.2):
 * - busca única, "Origem" e o painel "Filtros avançados" (`ReservationFilters`), valendo na hora; a
 *   busca, 400 ms depois da última tecla (research R-10, R-11);
 * - filtros rápidos Todas · Falta cobrar · A verificar · Com erro · Concluídas, com as contagens do
 *   servidor para a busca e os filtros em vigor (FR-016, FR-017, research R-09); o escolhido vale
 *   também para "Selecionar todas do filtro" e para a cópia para e-mail;
 * - a lista de cinco colunas, ordenada por hotel e check-in, com "Carregar mais" e o rodapé "Mostrando
 *   X de Y" (FR-014, research R-08, R-18), e o estado vazio (FR-021);
 * - a barra da seleção do lote (tela 4.4): "Ver seleção", "Anexar ▾", "Confirmar ▾", "Enviar ao
 *   Comercial" e "Desmarcar todas". A seleção fica fora desta tela (`state/selection`): pesquisar de
 *   novo, trocar filtros ou carregar mais não desmarca nada (specs/003).
 *
 * O detalhe abre numa gaveta. Nada é gravado: o que está na tela fica só em memória (FR-008a da 002).
 * O perfil consulta vê a lista sem as caixas de seleção (tela 6.2).
 */
import { Group, Stack, Text } from '@mantine/core';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type {
  Reservation,
  ReservationFilters,
  ReservationKey,
  ReservationListInput,
  ReservationQuickFilter,
  TreatmentDocumentKind,
} from '../../../../shared/ipc-types';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatMoney, sumMoney } from '../../presentation/format';
import type { OriginFilter } from '../../presentation/labels';
import {
  LEGACY_BADGE,
  QUICK_FILTER_COUNT_FIELD,
  QUICK_FILTER_LABELS,
  QUICK_FILTER_ORDER,
  parseSearch,
  reservationRowText,
  situationBadges,
} from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import { SELECTION_LIMIT, useSelection } from '../../state/selection';
import {
  Action,
  AppDrawer,
  EmptyState,
  FilterChip,
  ListCard,
  ListHeader,
  MenuButton,
  Notice,
  PageHeader,
  RESERVATION_COLUMNS,
  ReservationRow,
  SelectionBar,
  SelectionBox,
  SituationBadges,
  StatusBadge,
  type NoticeTone,
} from '../../ui';
import { DispatchDialog } from '../dispatch/DispatchDialog';
import { AttachDialog } from './AttachDialog';
import { ConfirmBatchDialog, type BatchKind } from './ConfirmBatchDialog';
import { CopyDialog } from './CopyDialog';
import { ReservationDetail } from './ReservationDetail';
import {
  AppliedFilterChips,
  EMPTY_PANEL,
  ReservationFilterBar,
  appliedChips,
  filtersOf,
  type PanelFilters,
} from './ReservationFilters';
import { SelectionDrawer } from './SelectionDrawer';

const PAGE_SIZE = 50;
/** A busca vale 400 ms depois da última tecla (research R-10). */
export const SEARCH_DELAY_MS = 400;

type SearchQuery = Pick<ReservationListInput, 'q' | 'amount'>;

export function ReservationsScreen({
  initialExecutionId = null,
}: {
  initialExecutionId?: string | null;
}) {
  const hunit = useHunit();
  const { state, isOperator } = useConnection();
  const selection = useSelection();
  const offline = state?.status === 'offline';

  // Busca: o texto digitado, a busca em vigor (a última válida) e o erro, se houver.
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState<SearchQuery>({});
  const [searchError, setSearchError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [panel, setPanel] = useState<PanelFilters>({
    ...EMPTY_PANEL,
    executionId: initialExecutionId,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<ReservationQuickFilter | null>(null);

  const [opened, setOpened] = useState<Reservation | null>(null);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  /** Lote em andamento: o tipo do documento e as reservas marcadas quando o diálogo abriu. */
  const [batch, setBatch] = useState<{
    kind: TreatmentDocumentKind;
    reservations: Array<{ hotelCode: string; reservationNumber: string }>;
  } | null>(null);
  /** Envio ao Comercial em andamento: as reservas marcadas quando o diálogo abriu (specs/005). */
  const [dispatching, setDispatching] = useState<ReservationKey[] | null>(null);
  const [confirming, setConfirming] = useState<BatchKind | null>(null);
  const [copying, setCopying] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllNotice, setSelectAllNotice] = useState<{
    tone: NoticeTone;
    text: string;
  } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const parsed = parseSearch(search);
      setSearchError(parsed.error ?? null);
      // Busca inválida: a lista continua com a última busca válida.
      if (!parsed.error) {
        setSearchQuery({
          ...(parsed.q !== undefined && { q: parsed.q }),
          ...(parsed.amount !== undefined && { amount: parsed.amount }),
        });
      }
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => unwrap(hunit.reservations.channels()),
  });
  const hotelNames = useMemo(
    () => new Map((hotels.data ?? []).map((hotel) => [hotel.code, hotel.name])),
    [hotels.data],
  );

  /** A busca e os filtros, sem o filtro rápido: a base das contagens. */
  const filters = useMemo<ReservationFilters>(
    () => ({ ...filtersOf(panel, origin), ...searchQuery }),
    [panel, origin, searchQuery],
  );
  /** O que a lista, "Selecionar todas do filtro" e a cópia usam (FR-014: a mesma ordem). */
  const listFilters = useMemo<ReservationFilters>(
    () => ({ ...filters, ...(quickFilter && { quickFilter }), order: 'hotel_check_in' }),
    [filters, quickFilter],
  );

  const list = useInfiniteQuery({
    queryKey: ['reservations', listFilters],
    queryFn: ({ pageParam }) =>
      unwrap(
        hunit.reservations.list({
          ...listFilters,
          limit: PAGE_SIZE,
          ...(pageParam !== null && { cursor: pageParam }),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  // A chave começa com "reservations": quem invalida a lista invalida as contagens (research R-09).
  const counts = useQuery({
    queryKey: ['reservations', 'quick-filter-counts', filters],
    queryFn: () => unwrap(hunit.reservations.quickFilterCounts(filters)),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  const searching = Object.keys(searchQuery).length > 0;
  const filtering =
    searching ||
    origin !== 'all' ||
    quickFilter !== null ||
    appliedChips(panel, hotels.data ?? []).length > 0;

  function clearAll() {
    setSearch('');
    setSearchQuery({});
    setSearchError(null);
    setOrigin('all');
    setPanel(EMPTY_PANEL);
    setQuickFilter(null);
  }

  function addToSelection(reservations: Reservation[]) {
    const { skipped } = selection.add(reservations);
    setLimitReached(skipped > 0);
  }

  /** "Selecionar todas do filtro" (FR-030 da 005): soma à seleção as 2 000 primeiras da lista. */
  async function selectAllFromFilter() {
    setSelectingAll(true);
    setSelectAllNotice(null);
    try {
      const found = await unwrap(hunit.reservations.selectAll(listFilters));
      const { added, skipped } = selection.add(found.items);
      const parts = [
        `${added.toLocaleString('pt-BR')} ${added === 1 ? 'reserva selecionada' : 'reservas selecionadas'} do filtro`,
      ];
      if (found.truncated) {
        parts.push(
          `o filtro tem ${found.total.toLocaleString('pt-BR')}: só as ${found.items.length.toLocaleString('pt-BR')} primeiras da lista entram (limite de ${SELECTION_LIMIT.toLocaleString('pt-BR')}); ${(found.total - found.items.length).toLocaleString('pt-BR')} ficaram de fora`,
        );
      }
      if (skipped > 0) {
        parts.push(
          `${skipped.toLocaleString('pt-BR')} não couberam na seleção, que já tinha outras reservas`,
        );
      }
      setSelectAllNotice({
        tone: found.truncated || skipped > 0 ? 'amber' : 'lime',
        text: `${parts.join('; ')}.`,
      });
    } catch (caught) {
      setSelectAllNotice({ tone: 'red', text: messageOf(caught) });
    } finally {
      setSelectingAll(false);
    }
  }

  function toggle(reservation: Reservation, checked: boolean) {
    if (checked) addToSelection([reservation]);
    else {
      selection.remove([reservation]);
      setLimitReached(false);
    }
  }

  const selectedOnPage = items.filter((reservation) => selection.has(reservation));
  const allOnPageSelected = items.length > 0 && selectedOnPage.length === items.length;
  const selectedCount = selection.items.length;
  const selectedKeys = selection.items.map(({ hotelCode, reservationNumber }) => ({
    hotelCode,
    reservationNumber,
  }));

  // Sem nenhuma reserva para a busca e os filtros, só "Todas" (tela 4.3) e o filtro em vigor.
  const nothingAtAll = counts.data?.all === 0 && list.isSuccess && items.length === 0;
  const chips = QUICK_FILTER_ORDER.filter((filter) => !nothingAtAll || filter === quickFilter);
  const total =
    counts.data === undefined
      ? null
      : quickFilter
        ? counts.data[QUICK_FILTER_COUNT_FIELD[quickFilter]]
        : counts.data.all;

  return (
    <Stack gap={16}>
      <PageHeader
        title="Reservas"
        action={
          <>
            <StaleDataNotice updatedAt={list.dataUpdatedAt} offline={offline} />
            <Action
              variant="secondary"
              disabled={items.length === 0 || offline}
              onClick={() => setCopying(true)}
            >
              Copiar para e-mail
            </Action>
          </>
        }
      />

      <ReservationFilterBar
        search={search}
        onSearch={setSearch}
        searchError={searchError}
        origin={origin}
        onOrigin={setOrigin}
        panel={panel}
        onPanel={setPanel}
        panelOpen={panelOpen}
        onPanelOpen={setPanelOpen}
        hotels={hotels.data ?? []}
        channels={channels.data ?? []}
      />
      <AppliedFilterChips
        panel={panel}
        hotels={hotels.data ?? []}
        onPanel={setPanel}
        onClearAll={clearAll}
      />

      <Group justify="space-between" gap={8} role="group" aria-label="Filtros rápidos">
        <Group gap={8}>
          <FilterChip
            label="Todas"
            count={counts.data?.all ?? null}
            active={quickFilter === null}
            onClick={() => setQuickFilter(null)}
          />
          {chips.map((filter) => (
            <FilterChip
              key={filter}
              label={QUICK_FILTER_LABELS[filter]}
              count={counts.data ? counts.data[QUICK_FILTER_COUNT_FIELD[filter]] : null}
              active={quickFilter === filter}
              onClick={() => setQuickFilter(quickFilter === filter ? null : filter)}
            />
          ))}
        </Group>
        {isOperator && items.length > 0 && (
          <Action
            variant="text"
            loading={selectingAll}
            disabled={offline}
            title={`Todas as páginas, até ${SELECTION_LIMIT.toLocaleString('pt-BR')} reservas, na ordem da lista.`}
            onClick={() => void selectAllFromFilter()}
          >
            Selecionar todas do filtro
          </Action>
        )}
      </Group>

      {limitReached && (
        <Notice
          tone="amber"
          action={
            <Action variant="text" size="xs" onClick={() => setLimitReached(false)}>
              Fechar
            </Action>
          }
        >
          Selecione no máximo {SELECTION_LIMIT.toLocaleString('pt-BR')} reservas. As que passaram do
          limite não foram marcadas.
        </Notice>
      )}
      {selectAllNotice && (
        <Notice
          tone={selectAllNotice.tone}
          role={selectAllNotice.tone === 'red' ? 'alert' : 'status'}
          action={
            <Action variant="text" size="xs" onClick={() => setSelectAllNotice(null)}>
              Fechar
            </Action>
          }
        >
          {selectAllNotice.text}
        </Notice>
      )}

      {isOperator && selectedCount > 0 && (
        <SelectionBar
          count={selectedCount}
          total={formatMoney(sumMoney(selection.items.map((item) => item.totalAmount)))}
          onClearAll={() => {
            selection.clear();
            setLimitReached(false);
          }}
          actions={
            <>
              <Action variant="secondary" onClick={() => setSelectionOpen(true)}>
                Ver seleção
              </Action>
              <MenuButton
                label="Anexar"
                disabled={offline}
                items={[
                  {
                    label: 'Anexar tratativa',
                    onClick: () => setBatch({ kind: 'request', reservations: selection.items }),
                  },
                  {
                    label: 'Anexar comprovante',
                    onClick: () => setBatch({ kind: 'proof', reservations: selection.items }),
                  },
                ]}
              />
              <MenuButton
                label="Confirmar"
                disabled={offline}
                items={[
                  { label: 'Confirmar retornos', onClick: () => setConfirming('returns') },
                  { label: 'Confirmar "Verificar"', onClick: () => setConfirming('reviews') },
                ]}
              />
              <Action
                variant="primary"
                disabled={offline}
                onClick={() => setDispatching(selectedKeys)}
              >
                Enviar ao Comercial
              </Action>
            </>
          }
        />
      )}

      {list.isError && items.length === 0 && <Notice tone="red">{messageOf(list.error)}</Notice>}
      {list.isSuccess && items.length === 0 && (
        <EmptyState
          title="Nenhuma reserva encontrada"
          description={
            searchQuery.q
              ? `Não há reservas para “${searchQuery.q}” com os filtros atuais. Confira o nome ou limpe os filtros.`
              : filtering
                ? 'Não há reservas com a busca e os filtros atuais.'
                : 'Ainda não há reservas gravadas. Elas aparecem depois de uma execução.'
          }
          {...(filtering && { onClear: clearAll })}
        />
      )}
      {items.length > 0 && (
        <ListCard
          label="Reservas"
          header={
            <ListHeader
              columns={RESERVATION_COLUMNS}
              {...(isOperator && {
                select: (
                  <SelectionBox
                    aria-label="Selecionar todas as reservas listadas"
                    checked={allOnPageSelected}
                    indeterminate={selectedOnPage.length > 0 && !allOnPageSelected}
                    onChange={(event) => {
                      if (event.currentTarget.checked) addToSelection(items);
                      else {
                        selection.remove(items);
                        setLimitReached(false);
                      }
                    }}
                  />
                ),
              })}
            />
          }
        >
          {items.map((reservation) => {
            const text = reservationRowText(
              reservation,
              hotelNames.get(reservation.hotelCode) ?? reservation.hotelCode,
            );
            return (
              <ReservationRow
                key={`${reservation.hotelCode}/${reservation.reservationNumber}`}
                reservationNumber={reservation.reservationNumber}
                {...text}
                situation={<SituationBadges items={situationBadges(reservation)} />}
                nameBadge={
                  reservation.legacy ? (
                    <StatusBadge tone={LEGACY_BADGE.tone} title={LEGACY_BADGE.title}>
                      {LEGACY_BADGE.label}
                    </StatusBadge>
                  ) : undefined
                }
                selectable={isOperator}
                selected={selection.has(reservation)}
                onSelectedChange={(checked) => toggle(reservation, checked)}
                opened={
                  opened?.hotelCode === reservation.hotelCode &&
                  opened.reservationNumber === reservation.reservationNumber
                }
                onOpen={() => setOpened(reservation)}
              />
            );
          })}
        </ListCard>
      )}
      {items.length > 0 && (
        <Group justify="space-between" gap={8}>
          <Text size="xs" c="dimmed">
            {footerText({
              shown: items.length,
              total,
              selected: isOperator ? selectedCount : 0,
              selectedHere: selectedOnPage.length,
              legacyOrigin: origin === 'legacy',
            })}
          </Text>
          {list.hasNextPage && (
            <Action
              variant="secondary"
              onClick={() => void list.fetchNextPage()}
              disabled={offline}
              loading={list.isFetchingNextPage}
            >
              Carregar mais
            </Action>
          )}
        </Group>
      )}

      <AppDrawer
        opened={opened !== null}
        onClose={() => setOpened(null)}
        title="Detalhe da reserva"
        closeLabel="Fechar detalhe"
      >
        {opened && <ReservationDetailLoader initial={opened} />}
      </AppDrawer>

      <SelectionDrawer
        opened={selectionOpen}
        onClose={() => setSelectionOpen(false)}
        hotelNames={hotelNames}
      />

      {batch && (
        <AttachDialog
          kind={batch.kind}
          reservations={batch.reservations}
          onClose={(result) => {
            setBatch(null);
            // Depois do lote, só as que falharam continuam marcadas, para repetir (FR-006a da 003).
            if (result) selection.keepOnly(result.failedKeys);
          }}
        />
      )}

      {dispatching && (
        <DispatchDialog
          reservations={dispatching}
          hotelNames={hotelNames}
          onClose={(result) => {
            setDispatching(null);
            // Depois do envio, só as não verificadas continuam marcadas, para tentar de novo.
            if (result) selection.keepOnly(result.notVerified);
          }}
        />
      )}

      {confirming && (
        <ConfirmBatchDialog
          kind={confirming}
          items={selection.items}
          hotelNames={hotelNames}
          onClose={(result) => {
            setConfirming(null);
            if (result) selection.keepOnly(result.failed);
          }}
        />
      )}

      {copying && (
        <CopyDialog
          filters={listFilters}
          hotels={hotels.data ?? []}
          hotelNames={hotelNames}
          selected={isOperator ? selection.items : []}
          onClose={() => setCopying(false)}
        />
      )}
    </Stack>
  );
}

/**
 * Rodapé da lista (research R-08; telas 4.1, 4.4 e 4.10): "Mostrando X de Y reservas" e, depois, as
 * selecionadas (com as que estão fora das linhas carregadas), a origem "sistema anterior" ou a ordem.
 */
export function footerText({
  shown,
  total,
  selected,
  selectedHere,
  legacyOrigin,
}: {
  shown: number;
  total: number | null;
  selected: number;
  selectedHere: number;
  legacyOrigin: boolean;
}): string {
  const noun = (count: number | null) => (count === 1 ? 'reserva' : 'reservas');
  const showing =
    total === null
      ? `Mostrando ${shown.toLocaleString('pt-BR')} ${noun(shown)}`
      : `Mostrando ${shown.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} ${noun(total)}`;
  if (selected > 0) {
    const outside = selected - selectedHere;
    const word = selected === 1 ? 'selecionada' : 'selecionadas';
    const away = outside > 0 ? ` (${outside.toLocaleString('pt-BR')} fora desta página)` : '';
    return `${showing} · ${selected.toLocaleString('pt-BR')} ${word}${away}`;
  }
  if (legacyOrigin) return `${showing} · origem: sistema anterior (importadas do sistema anterior)`;
  return `${showing} · ordenadas por hotel e check-in`;
}

/** O detalhe busca a reserva atualizada no servidor; enquanto isso, mostra a linha da lista. */
export function ReservationDetailLoader({ initial }: { initial: Reservation }) {
  const hunit = useHunit();
  const key = { hotelCode: initial.hotelCode, reservationNumber: initial.reservationNumber };
  const detail = useQuery({
    queryKey: ['reservation', key.hotelCode, key.reservationNumber],
    queryFn: () => unwrap(hunit.reservations.get(key)),
    initialData: initial,
  });
  return <ReservationDetail reservation={detail.data} />;
}
