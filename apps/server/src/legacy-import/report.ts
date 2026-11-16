/**
 * Relatório de uma simulação ou importação, em texto (specs/004, contracts/cli.md, research R-08).
 *
 * Só contagens, aba, linha, código do hotel do sistema anterior, número da reserva, tipo e motivo
 * (FR-018): nunca nome de hóspede, valores, datas, nomes de arquivo nem conteúdo de célula.
 */
import type { HotelMapping, LegacyImportRow } from '../persistence/legacy-import-repo.js';
import type { LegacyImportEntity, LegacyOutcomeCounts } from '../persistence/schema.js';

/** Texto de cada motivo (data-model §4). `{column}` é trocado pelo nome da coluna. */
export const REASON_TEXT: Readonly<Record<string, string>> = {
  hotel_not_mapped: 'Hotel sem associação no catálogo',
  missing_value: 'Dado obrigatório vazio: {column}',
  unreadable_date: 'Data ilegível: {column}',
  unreadable_amount: 'Valor ilegível: {column}',
  unreadable_number: 'Número ilegível: {column}',
  inconsistent_dates:
    'Datas incoerentes (saída antes da entrada, ou primeira verificação depois da última)',
  duplicated_in_sheet: 'Linha repetida na planilha (vale a de última verificação mais recente)',
  unchanged: 'Já importada, sem mudança',
  reservation_rejected: 'A reserva desta tratativa foi recusada',
  reservation_not_in_sheet: 'Reserva sem linha na aba de reservas nem no HUNIT Control',
  file_not_found: 'Arquivo não encontrado na pasta',
  empty_file: 'Arquivo vazio',
  unsupported_file_type: 'Tipo não aceito',
  file_type_mismatch: 'Conteúdo diferente do tipo do arquivo',
  file_too_large: 'Arquivo acima de 25 MB',
  kept_hunit_control: 'Já registrado no HUNIT Control (prevalece)',
  already_imported: 'Já importado, sem mudança',
  superseded_in_legacy: 'Anexo antigo substituído por documento mais novo na mesma linha',
  manual_amount_without_proof: 'Valor manual sem comprovante',
};

const WARNING_TEXT: Readonly<Record<string, (count: number) => string>> = {
  anonymized_on_import: (count) =>
    `${count} reserva(s) com check-in há mais de 5 anos gravada(s) já anonimizada(s), sem os arquivos.`,
  unreferenced_files: (count) => `${count} arquivo(s) da pasta sem referência na planilha.`,
  original_date_missing: (count) =>
    `${count} registro(s) sem data original: usada a última verificação no sistema anterior.`,
  obsolete_classification_in_use: (count) =>
    `${count} reserva(s) gravada(s) antes com "Não é cartão virtual" passa(m) a aparecer como "A revisar (sistema anterior)".`,
  previous_import_incomplete: (count) =>
    `${count} importação(ões) anterior(es) não terminou(aram); a importação completa o que faltou.`,
};

const ENTITY_TEXT: Readonly<Record<LegacyImportEntity, string>> = {
  reservation: 'reserva',
  request: 'tratativa',
  proof: 'comprovante',
  manual_amount: 'valor manual',
};

const OUTCOME_TEXT = { ignored: 'ignorada', rejected: 'recusada' } as const;

export function reasonText(reason: string, column?: string): string {
  const text = REASON_TEXT[reason] ?? reason;
  return text.replace('{column}', column ?? '');
}

function countsRow(label: string, counts: LegacyOutcomeCounts): string {
  const cell = (value: number) => String(value).padStart(11);
  return `${label.padEnd(16)}${cell(counts.created)}${cell(counts.updated)}${cell(counts.ignored)}${cell(counts.rejected)}`;
}

export interface ReportInput {
  record: LegacyImportRow;
  /** Hotéis do sistema anterior ainda sem associação confirmada. */
  pendingHotels: readonly HotelMapping[];
  /** Nome de cada hotel do catálogo, para mostrar a proposta. */
  catalogNames: ReadonlyMap<string, string>;
  /** Para a última linha: como importar (só nas simulações). */
  nextStep?: string;
}

export function formatReport({
  record,
  pendingHotels,
  catalogNames,
  nextStep,
}: ReportInput): string {
  const lines: string[] = [];
  const title = record.kind === 'simulation' ? 'Simulação' : 'Importação';
  const status =
    record.status === 'completed'
      ? 'concluída'
      : record.status === 'interrupted'
        ? 'interrompida'
        : record.status === 'failed'
          ? 'com falha'
          : 'em andamento';
  lines.push(`${title} ${record.id} — ${status}`, '');

  const counts = record.counts;
  if (counts) {
    lines.push(
      `${''.padEnd(16)}${'criadas'.padStart(11)}${'atualizadas'.padStart(11)}${'ignoradas'.padStart(11)}${'recusadas'.padStart(11)}`,
      countsRow('Reservas', counts.reservations),
      countsRow('Tratativas', counts.requests),
      countsRow('Comprovantes', counts.proofs),
      countsRow('Valores manuais', counts.manualAmounts),
      `Arquivos da pasta sem referência: ${counts.unreferencedFiles}`,
      '',
    );
  }

  const unmappedRows = new Map<string, number>();
  for (const issue of record.issues) {
    if (issue.reason === 'hotel_not_mapped') {
      unmappedRows.set(issue.legacyHotel, (unmappedRows.get(issue.legacyHotel) ?? 0) + 1);
    }
  }
  const hotels = pendingHotels.filter((hotel) => unmappedRows.has(hotel.legacyKey));
  if (hotels.length > 0) {
    lines.push('Hotéis sem associação (linhas recusadas):');
    for (const hotel of hotels) {
      const proposal =
        hotel.decision === 'proposed' && hotel.hotelCode
          ? `proposta: ${hotel.hotelCode} (${catalogNames.get(hotel.hotelCode) ?? '?'})`
          : hotel.decision === 'unmapped'
            ? 'sem associação (decidido)'
            : 'sem proposta';
      lines.push(
        `  ${hotel.legacyKey}   "${hotel.legacyName}"   ${unmappedRows.get(hotel.legacyKey)} linha(s)   ${proposal}`,
      );
    }
    lines.push('');
  }

  if (record.issues.length > 0) {
    lines.push('Ignorados e recusados:');
    for (const issue of record.issues) {
      lines.push(
        [
          `  ${issue.sheet} linha ${issue.row}`,
          issue.legacyHotel || '-',
          issue.reservationNumber || '-',
          ENTITY_TEXT[issue.entity],
          OUTCOME_TEXT[issue.outcome],
          reasonText(issue.reason, issue.column),
        ].join('   '),
      );
    }
    lines.push('');
  }

  if (record.differences && record.differences.length > 0) {
    lines.push('Diferenças em relação à simulação:');
    for (const difference of record.differences) {
      lines.push(
        `  ${difference.legacyHotel}   ${difference.reservationNumber}   ${difference.entity}   simulação: ${difference.simulated}   importação: ${difference.imported}`,
      );
    }
    lines.push('');
  } else if (record.kind === 'import' && record.status === 'completed') {
    lines.push('Nenhuma diferença em relação à simulação.', '');
  }

  if (record.warnings.length > 0) {
    lines.push('Avisos:');
    for (const warning of record.warnings) {
      const text = WARNING_TEXT[warning.code];
      lines.push(`  ${text ? text(warning.count) : `${warning.code}: ${warning.count}`}`);
    }
    lines.push('');
  }

  if (nextStep) lines.push(nextStep, '');
  return `${lines.join('\n')}\n`;
}
