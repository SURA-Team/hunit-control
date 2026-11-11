import { describe, expect, it } from 'vitest';
import { REDACTED, SecretRegistry } from '../../src/secrets.js';

describe('SecretRegistry (FR-005, SC-004)', () => {
  it('não altera o texto quando não há segredos registrados', () => {
    const secrets = new SecretRegistry();

    expect(secrets.scrub('nada para esconder')).toBe('nada para esconder');
    expect(secrets.size).toBe(0);
  });

  it('apaga todas as ocorrências de um segredo registrado', () => {
    const secrets = new SecretRegistry();
    secrets.register('S3nhaForte!');

    expect(secrets.scrub('fill("S3nhaForte!") falhou; tentativa com S3nhaForte! de novo')).toBe(
      `fill("${REDACTED}") falhou; tentativa com ${REDACTED} de novo`,
    );
  });

  it('registra vários segredos de uma vez (usuário, senha e token)', () => {
    const secrets = new SecretRegistry();
    secrets.register('operador@hotel.test', 'S3nhaForte!', '482913');

    const scrubbed = secrets.scrub('operador@hotel.test entrou com S3nhaForte! e token 482913');

    expect(scrubbed).toBe(`${REDACTED} entrou com ${REDACTED} e token ${REDACTED}`);
  });

  it('para de apagar depois que o registro é removido', () => {
    const secrets = new SecretRegistry();
    const unregister = secrets.register('S3nhaForte!');

    unregister();
    unregister(); // remover duas vezes não causa erro

    expect(secrets.scrub('S3nhaForte!')).toBe('S3nhaForte!');
    expect(secrets.size).toBe(0);
  });

  it('mantém a proteção de um segredo usado por duas execuções até a última removê-lo', () => {
    const secrets = new SecretRegistry();
    const first = secrets.register('SenhaCompartilhada');
    const second = secrets.register('SenhaCompartilhada');

    first();
    expect(secrets.scrub('SenhaCompartilhada')).toBe(REDACTED);

    second();
    expect(secrets.scrub('SenhaCompartilhada')).toBe('SenhaCompartilhada');
  });

  it('reconhece o segredo escrito como JSON, HTML e URL', () => {
    const secrets = new SecretRegistry();
    const password = 'a"b\\c<d>&e f\'g';
    secrets.register(password);

    const asJson = JSON.stringify({ value: password });
    const asHtmlAttribute = '<input value="a&quot;b\\c&lt;d&gt;&amp;e f\'g">';
    const asHtmlText = '<p>a"b\\c&lt;d&gt;&amp;e f\'g</p>';
    const asHtmlWithNumericQuote = 'a&quot;b\\c&lt;d&gt;&amp;e f&#39;g';
    const asUrl = `https://exemplo.test/?p=${encodeURIComponent(password)}`;
    const asForm = `password=${encodeURIComponent(password).replaceAll('%20', '+')}`;

    expect(secrets.scrub(asJson)).toBe(`{"value":"${REDACTED}"}`);
    expect(secrets.scrub(asHtmlAttribute)).toBe(`<input value="${REDACTED}">`);
    expect(secrets.scrub(asHtmlText)).toBe(`<p>${REDACTED}</p>`);
    expect(secrets.scrub(asHtmlWithNumericQuote)).toBe(REDACTED);
    expect(secrets.scrub(asUrl)).toBe(`https://exemplo.test/?p=${REDACTED}`);
    expect(secrets.scrub(asForm)).toBe(`password=${REDACTED}`);
  });

  it('reconhece o usuário devolvido em minúsculas ou sem espaços nas pontas', () => {
    const secrets = new SecretRegistry();
    secrets.register(' Operador@Hotel.Test ');

    expect(secrets.scrub('tentativa de operador@hotel.test')).toBe(`tentativa de ${REDACTED}`);
    expect(secrets.scrub('tentativa de Operador@Hotel.Test')).toBe(`tentativa de ${REDACTED}`);
  });

  it('apaga primeiro o segredo mais longo quando um contém o outro', () => {
    const secrets = new SecretRegistry();
    secrets.register('maria', 'maria2026!');

    // Se "maria" fosse apagado antes, sobraria "2026!" — um pedaço da senha.
    expect(secrets.scrub('usuário maria, senha maria2026!')).toBe(
      `usuário ${REDACTED}, senha ${REDACTED}`,
    );
  });

  it('ignora valores vazios, nulos ou curtos demais', () => {
    const secrets = new SecretRegistry();
    secrets.register('', null, undefined, 'abc');

    expect(secrets.size).toBe(0);
    expect(secrets.scrub('abc e nada mais')).toBe('abc e nada mais');
  });

  it('aceita token de 4 dígitos (o menor permitido pelo contrato)', () => {
    const secrets = new SecretRegistry();
    secrets.register('4821');

    expect(secrets.scrub('token 4821 recusado')).toBe(`token ${REDACTED} recusado`);
  });
});
