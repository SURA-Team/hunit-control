/**
 * Comando administrativo `commercial-sheet setup|check` (specs/005, FR-008a; contracts/cli.md) —
 * tasks.md, T023. Roda com a planilha em memória: sem banco, sem rede e sem Hunit.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { EXIT } from '../../src/commercial-sheet/command.js';
import { MemorySheetGateway } from '../../src/commercial-sheet/memory-sheet-gateway.js';

const SECRET = 'CHAVE-DA-PLANILHA-MARCADOR-SECRETO';
const ENV = {
  COMMERCIAL_SHEET_ID: `planilha_${SECRET}_0123456789`,
  COMMERCIAL_SHEET_KEY_FILE: '/run/secrets/commercial-sheet/commercial-sheet-key.json',
};

async function run(
  args: string[],
  env: Record<string, string | undefined>,
  sheet = new MemorySheetGateway(),
) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(
    ['commercial-sheet', ...args],
    { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text), env },
    { commercialSheet: { createGateway: () => Promise.resolve(sheet) } },
  );
  return { code, stdout, stderr };
}

describe('commercial-sheet (T023)', () => {
  it('setup prepara a planilha vazia e pode rodar de novo', async () => {
    const sheet = new MemorySheetGateway({ prepared: false });
    const first = await run(['setup'], ENV, sheet);
    expect(first.code).toBe(EXIT.ok);
    expect(first.stdout).toContain('Aba "A cobrar": criada');
    expect(first.stdout).toContain('Aba "Concluídas": criada');
    expect(first.stdout).toContain(
      'Aparência: cabeçalho preto e lima, listras, bordas tracejadas e cores da Validação do Financeiro',
    );
    expect(first.stdout).toContain('Compartilhe a planilha com o Comercial');

    const second = await run(['setup'], ENV, sheet);
    expect(second.code).toBe(EXIT.ok);
    expect(second.stdout).toContain('Aba "A cobrar": já existia');
  });

  it('check confere o formato sem mudar nada; cabeçalho mudado = código 4', async () => {
    const sheet = new MemorySheetGateway();
    expect((await run(['check'], ENV, sheet)).code).toBe(EXIT.ok);

    sheet.setCell('toCharge', 0, 4, 'Valor');
    const changed = await run(['check'], ENV, sheet);
    expect(changed.code).toBe(EXIT.layoutInvalid);
    expect(changed.stdout).toContain('o cabeçalho da aba "A cobrar" foi alterado');
    expect(sheet.header('toCharge')[4]).toBe('Valor');
  });

  it('planilha da 005, sem O e P: check aponta as colunas faltando; setup acrescenta (specs/008)', async () => {
    const sheet = new MemorySheetGateway();
    sheet.setCell('toCharge', 0, 14, '');
    sheet.setCell('toCharge', 0, 15, '');
    sheet.setCell('done', 0, 14, '');
    sheet.setCell('done', 0, 15, '');

    const before = await run(['check'], ENV, sheet);
    expect(before.code).toBe(EXIT.layoutInvalid);
    expect(before.stdout).toContain(
      'faltam na aba "A cobrar" as colunas O ("Situação da cobrança") e P ("Data da cobrança")',
    );

    const setup = await run(['setup'], ENV, sheet);
    expect(setup.code).toBe(EXIT.ok);
    expect(setup.stdout).toContain('Colunas do Comercial');
    expect(sheet.header('toCharge').slice(14)).toEqual([
      'Situação da cobrança',
      'Data da cobrança',
    ]);
    expect((await run(['check'], ENV, sheet)).code).toBe(EXIT.ok);
  });

  it('sem configuração: código 1, com a orientação', async () => {
    const result = await run(['setup'], {});
    expect(result.code).toBe(EXIT.notConfigured);
    expect(result.stderr).toContain('defina COMMERCIAL_SHEET_ID e COMMERCIAL_SHEET_KEY_FILE');
  });

  it('sem acesso: código 2; Google fora: código 3; mensagens genéricas', async () => {
    const forbidden = new MemorySheetGateway();
    forbidden.failNext('sheet_forbidden');
    expect((await run(['check'], ENV, forbidden)).code).toBe(EXIT.noAccess);

    const down = new MemorySheetGateway();
    down.failNext('sheet_unavailable');
    const result = await run(['setup'], ENV, down);
    expect(result.code).toBe(EXIT.googleFailure);
    expect(result.stderr).toContain('indisponível');
  });

  it('nunca mostra o identificador da planilha', async () => {
    const result = await run(['check'], ENV);
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });
});
