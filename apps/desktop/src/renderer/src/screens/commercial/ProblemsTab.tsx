/**
 * Aba "Retornos com problema" da área Comercial (specs/005, FR-018): os retornos incompletos ou
 * ilegíveis e os casos que o servidor encontrou na planilha (linha sem envio, repetida ou
 * restaurada), com a mensagem em português e sem dado do hóspede.
 */
import { Alert, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime } from '../../presentation/format';
import { SHEET_PROBLEM_NAMES } from '../../presentation/labels';
import { useSheetStatus } from './SheetTab';

export function ProblemsTab() {
  const hunit = useHunit();
  const status = useSheetStatus();
  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const hotel = (code: string | null) =>
    code === null ? '—' : (hotels.data?.find((item) => item.code === code)?.name ?? code);

  if (status.isError) {
    return (
      <Alert color="red" role="alert">
        {messageOf(status.error)}
      </Alert>
    );
  }
  const problems = status.data?.problems ?? [];
  if (status.isSuccess && problems.length === 0) {
    return <Text c="dimmed">Nenhum retorno com problema.</Text>;
  }
  return (
    <Table striped verticalSpacing={6} aria-label="Retornos com problema">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Hotel</Table.Th>
          <Table.Th>Reserva</Table.Th>
          <Table.Th>Problema</Table.Th>
          <Table.Th>O que falta ou não foi entendido</Table.Th>
          <Table.Th>Quando</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {problems.map((problem, index) => (
          <Table.Tr key={`${problem.hotelCode ?? ''}/${problem.reservationNumber ?? ''}/${index}`}>
            <Table.Td>{hotel(problem.hotelCode)}</Table.Td>
            <Table.Td>{problem.reservationNumber ?? '—'}</Table.Td>
            <Table.Td>{SHEET_PROBLEM_NAMES[problem.kind]}</Table.Td>
            <Table.Td>{problem.message}</Table.Td>
            <Table.Td>{formatDateTime(problem.at)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
