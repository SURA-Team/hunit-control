/**
 * Comando administrativo `commercial-sheet` (specs/005, FR-008a; contracts/cli.md; research
 * R-05): prepara e confere a planilha do Comercial. Rodado por quem administra, no PC do servidor:
 *
 *   node dist/cli.js commercial-sheet setup
 *   node dist/cli.js commercial-sheet check
 *
 * Constitution III (exceção de comandos de implantação): não é usado pelos clientes, não acessa o
 * Hunit e o estado da planilha fica visível pela API (`GET /commercial-sheet`). Não precisa do
 * banco. Nunca mostra a chave, o identificador da planilha nem o e-mail completo da conta.
 */
import { COMMERCIAL_SHEET_TABS } from '@hunit/domain';
import { ConfigError, loadCommercialSheetAccess, type CommercialSheetAccess } from '../config.js';
import { SecretRegistry } from '../secrets.js';
import {
  SHEET_TABS,
  SheetError,
  type CommercialSheetGateway,
  type SheetErrorCode,
} from './gateway.js';
import { GoogleSheetGateway } from './google-sheet-gateway.js';
import { loadServiceAccountKey, ServiceAccountKeyError } from './key.js';
import { tabLayoutProblems } from './layout.js';

export interface CommercialSheetCommandIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
}

export interface CommercialSheetCommandOptions {
  /** Testes: planilha pronta (sem chave nem rede). */
  createGateway?: (
    access: CommercialSheetAccess,
    secrets: SecretRegistry,
  ) => Promise<CommercialSheetGateway>;
}

/** Códigos de saída (contracts/cli.md). */
export const EXIT = {
  ok: 0,
  notConfigured: 1,
  noAccess: 2,
  googleFailure: 3,
  layoutInvalid: 4,
} as const;

const USAGE = `Uso:
  commercial-sheet setup   Prepara a planilha do Comercial (abas, cabeçalhos, formatos e proteções)
  commercial-sheet check   Só confere o acesso e o formato, sem mudar nada

Usa COMMERCIAL_SHEET_ID e COMMERCIAL_SHEET_KEY_FILE do ambiente do servidor.
`;

const TAB_NAMES = { toCharge: COMMERCIAL_SHEET_TABS.toCharge, done: COMMERCIAL_SHEET_TABS.done };

async function realGateway(
  access: CommercialSheetAccess,
  secrets: SecretRegistry,
): Promise<CommercialSheetGateway> {
  const key = await loadServiceAccountKey(access.keyFile, secrets, access.spreadsheetId);
  return new GoogleSheetGateway({ spreadsheetId: access.spreadsheetId, key });
}

function exitCodeOf(code: SheetErrorCode): number {
  if (code === 'sheet_forbidden' || code === 'sheet_not_found') return EXIT.noAccess;
  if (code === 'sheet_layout_invalid') return EXIT.layoutInvalid;
  return EXIT.googleFailure;
}

export async function commercialSheetCommand(
  args: readonly string[],
  io: CommercialSheetCommandIo,
  options: CommercialSheetCommandOptions = {},
): Promise<number> {
  const [subcommand] = args;
  if (subcommand !== 'setup' && subcommand !== 'check') {
    io.stderr(
      subcommand === undefined || subcommand === '--help'
        ? USAGE
        : `Subcomando desconhecido: ${subcommand}\n\n${USAGE}`,
    );
    return subcommand === '--help' ? EXIT.ok : EXIT.notConfigured;
  }

  // Defesa extra: toda saída passa pelo registro de segredos (a chave e o ID ficam registrados).
  const secrets = new SecretRegistry();
  const out = (text: string) => io.stdout(secrets.scrub(text));
  const err = (text: string) => io.stderr(secrets.scrub(text));

  let access: CommercialSheetAccess | null;
  try {
    access = loadCommercialSheetAccess(io.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(`${error.message}\n`);
      return EXIT.notConfigured;
    }
    throw error;
  }
  if (access === null) {
    err(
      'Planilha do Comercial não configurada: defina COMMERCIAL_SHEET_ID e COMMERCIAL_SHEET_KEY_FILE ' +
        '(passo a passo no README, "Planilha do Comercial").\n',
    );
    return EXIT.notConfigured;
  }

  try {
    const gateway = await (options.createGateway ?? realGateway)(access, secrets);
    return subcommand === 'setup' ? await setup(gateway, out) : await check(gateway, out, err);
  } catch (error) {
    if (error instanceof ServiceAccountKeyError) {
      err(`${error.message}\n`);
      return EXIT.notConfigured;
    }
    if (error instanceof SheetError) {
      err(`${error.message}\n`);
      return exitCodeOf(error.code);
    }
    // Erro inesperado: só o tipo, nunca a mensagem (pode trazer o endereço da planilha).
    err(
      `Falha inesperada ao acessar a planilha do Comercial (${error instanceof Error ? error.name : 'erro'}).\n`,
    );
    return EXIT.googleFailure;
  }
}

async function setup(
  gateway: CommercialSheetGateway,
  out: (text: string) => void,
): Promise<number> {
  const report = await gateway.setupLayout();
  const lines = [
    `Planilha do Comercial: acesso OK (conta de serviço ${report.serviceAccountHint})`,
  ];
  for (const tab of SHEET_TABS) {
    lines.push(
      `Aba "${TAB_NAMES[tab]}": ${report.tabsCreated.includes(tab) ? 'criada' : 'já existia'}`,
    );
  }
  lines.push(
    `Cabeçalhos: ${report.headersWritten.length > 0 ? 'gravados' : 'já estavam certos'}`,
    'Aparência: cabeçalho preto e lima, listras, bordas tracejadas e cores da Validação do Financeiro',
    'Colunas do Comercial: lista de "Situação da cobrança" (aceita outro texto) e "Data da cobrança" só com data',
    `Proteções: colunas A:J de "${TAB_NAMES.toCharge}" (K:P ficam para o Comercial) e "${TAB_NAMES.done}" inteira (só a conta de serviço edita)` +
      (report.protectionsAdded > 0 ? '' : ' — já existiam'),
    'Pronto. Compartilhe a planilha com o Comercial como editor, no Google.',
    '',
  );
  out(lines.join('\n'));
  return EXIT.ok;
}

async function check(
  gateway: CommercialSheetGateway,
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  const inspection = await gateway.inspect();
  const lines = [
    `Planilha do Comercial: acesso OK (conta de serviço ${inspection.serviceAccountHint})`,
  ];
  const problems: string[] = [];
  for (const tab of SHEET_TABS) {
    const found = inspection.tabs[tab];
    const tabProblems = tabLayoutProblems(tab, found.exists ? found.headers : null);
    if (!inspection.protectedTabs.includes(tab) && found.exists) {
      tabProblems.push(`a aba "${TAB_NAMES[tab]}" está sem as proteções`);
    }
    problems.push(...tabProblems);
    lines.push(
      `Aba "${TAB_NAMES[tab]}": ${tabProblems.length === 0 ? `OK, ${found.dataRows} linhas` : tabProblems.join('; ')}`,
    );
  }
  lines.push('');
  out(lines.join('\n'));
  if (problems.length > 0) {
    err('O formato da planilha não é o esperado: rode "commercial-sheet setup".\n');
    return EXIT.layoutInvalid;
  }
  return EXIT.ok;
}
