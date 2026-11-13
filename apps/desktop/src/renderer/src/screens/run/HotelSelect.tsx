/**
 * Hotéis da execução (specs/002, FR-009): todos ou uma seleção do catálogo conhecido, com busca
 * pelo nome ou pelo código. Sem catálogo (primeira execução), só "todos": o catálogo será lido
 * nessa execução.
 */
import { MultiSelect, Radio, Stack, Text } from '@mantine/core';
import type { Hotel } from '../../../../shared/ipc-types';

export type HotelMode = 'all' | 'some';

interface Props {
  hotels: Hotel[];
  mode: HotelMode;
  selected: string[];
  onMode: (mode: HotelMode) => void;
  onSelected: (codes: string[]) => void;
  error: string | null;
}

export function HotelSelect({ hotels, mode, selected, onMode, onSelected, error }: Props) {
  const empty = hotels.length === 0;
  const data = hotels.map((hotel) => ({
    value: hotel.code,
    label: `${hotel.name} (${hotel.code})`,
  }));

  return (
    <Stack gap="xs">
      <Radio.Group
        label="Hotéis"
        value={empty ? 'all' : mode}
        onChange={(value) => onMode(value === 'some' ? 'some' : 'all')}
      >
        <Stack gap={6} mt={4}>
          <Radio value="all" label="Todos os hotéis do catálogo" />
          <Radio value="some" label="Escolher hotéis" disabled={empty} />
        </Stack>
      </Radio.Group>
      {empty && (
        <Text size="sm" c="dimmed">
          O catálogo de hotéis ainda não foi lido: ele será obtido nesta execução, com todos os
          hotéis.
        </Text>
      )}
      {!empty && mode === 'some' && (
        <MultiSelect
          label="Hotéis escolhidos"
          placeholder="Busque pelo nome ou pelo código"
          data={data}
          value={selected}
          onChange={onSelected}
          searchable
          clearable
          hidePickedOptions
          nothingFoundMessage="Nenhum hotel encontrado"
          error={error}
          maxDropdownHeight={280}
        />
      )}
    </Stack>
  );
}
