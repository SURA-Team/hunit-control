/**
 * Registro, somente em memória, dos segredos em uso por execuções em andamento: usuário, senha
 * e token 2FA do Hunit (FR-005, SC-004).
 *
 * É a última linha de defesa contra vazamentos: tudo o que o servidor escreve em texto — logs,
 * evidências, mensagens de eventos — passa por `scrub`, que troca qualquer ocorrência de um
 * segredo registrado por "[REDACTED]". Assim, mesmo que uma biblioteca inclua a senha numa
 * mensagem de erro (o Playwright, por exemplo, pode citar o valor digitado num campo), ela não
 * chega a ser gravada.
 *
 * Os segredos nunca são persistidos: ficam aqui só enquanto a execução precisa deles e são
 * removidos pela função devolvida por `register`.
 */
export const REDACTED = '[REDACTED]';

/** Valores menores que isto são ignorados: apagariam trechos demais de textos comuns. */
const MIN_SECRET_LENGTH = 4;

function htmlEscapedForms(value: string): string[] {
  const text = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const attribute = text.replaceAll('"', '&quot;');
  return [
    text,
    attribute,
    attribute.replaceAll("'", '&#39;'),
    attribute.replaceAll("'", '&#x27;'),
    attribute.replaceAll("'", '&apos;'),
    // Navegadores mais antigos não escapam "<" e ">" dentro de atributos.
    value.replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
  ];
}

function urlEncodedForms(value: string): string[] {
  try {
    const encoded = encodeURIComponent(value);
    return [encoded, encoded.replaceAll('%20', '+')];
  } catch {
    return []; // texto com caracteres inválidos para URL
  }
}

/** Formas em que um mesmo segredo pode aparecer num texto: puro, em JSON, em HTML e em URL. */
function writtenForms(secret: string): string[] {
  const forms = new Set<string>();
  // O Hunit pode devolver o usuário sem espaços nas pontas, em minúsculas ou das duas formas.
  const trimmed = secret.trim();
  const bases = new Set([secret, trimmed, secret.toLowerCase(), trimmed.toLowerCase()]);
  for (const base of bases) {
    forms.add(base);
    forms.add(JSON.stringify(base).slice(1, -1));
    for (const form of htmlEscapedForms(base)) forms.add(form);
    for (const form of urlEncodedForms(base)) forms.add(form);
  }
  return [...forms].filter((form) => form.length >= MIN_SECRET_LENGTH);
}

export class SecretRegistry {
  private readonly registrations = new Map<symbol, string[]>();
  /** Todas as formas de todos os segredos, das mais longas para as mais curtas. */
  private forms: string[] = [];

  /**
   * Registra segredos e devolve a função que os remove. Valores vazios, nulos ou muito curtos
   * são ignorados.
   */
  register(...values: Array<string | null | undefined>): () => void {
    const key = Symbol('secrets');
    const forms = values
      .filter((value): value is string => typeof value === 'string')
      .flatMap((value) => writtenForms(value));

    if (forms.length > 0) {
      this.registrations.set(key, forms);
      this.rebuild();
    }

    return () => {
      if (this.registrations.delete(key)) this.rebuild();
    };
  }

  /** Troca por "[REDACTED]" toda ocorrência de um segredo registrado. */
  scrub(text: string): string {
    let result = text;
    for (const form of this.forms) {
      if (result.includes(form)) result = result.replaceAll(form, REDACTED);
    }
    return result;
  }

  /** Quantidade de registros ativos (para diagnóstico e testes). */
  get size(): number {
    return this.registrations.size;
  }

  private rebuild(): void {
    // As formas mais longas vêm primeiro: se um segredo contém outro (ex.: a senha começa com
    // o usuário), o maior é apagado inteiro antes de o menor ser procurado.
    this.forms = [...new Set([...this.registrations.values()].flat())].sort(
      (a, b) => b.length - a.length,
    );
  }
}
