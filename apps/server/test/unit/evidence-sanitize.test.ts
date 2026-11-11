import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/evidence/sanitize.js';

describe('sanitizeHtml (T023, research R-12)', () => {
  it('remove o atributo value de um input', () => {
    expect(sanitizeHtml('<input type="text" name="username" value="operador@hotel.test">')).toBe(
      '<input type="text" name="username">',
    );
  });

  it.each([
    ['aspas duplas', '<input value="segredo" id="a">', '<input id="a">'],
    ['aspas simples', '<input value=\'segredo\' id="a">', '<input id="a">'],
    ['sem aspas', '<input value=segredo id="a">', '<input id="a">'],
    ['sem aspas no fim da tag', '<input id="a" value=segredo>', '<input id="a">'],
    ['maiúsculas', '<INPUT VALUE="segredo" ID="a">', '<INPUT ID="a">'],
    ['espaços em volta do igual', '<input value = "segredo" id="a">', '<input id="a">'],
    ['valor vazio', '<input value="" id="a">', '<input id="a">'],
    ['atributo sem valor', '<input value id="a">', '<input id="a">'],
    ['tag fechada com barra', '<input id="a" value="segredo"/>', '<input id="a"/>'],
    ['tag fechada com espaço e barra', '<input id="a" value="segredo" />', '<input id="a" />'],
    ['quebras de linha', '<input\n  id="a"\n  value="segredo"\n>', '<input\n  id="a"\n>'],
    ['value repetido', '<input value="um" id="a" value="dois">', '<input id="a">'],
  ])('trata %s', (_caso, html, expected) => {
    expect(sanitizeHtml(html)).toBe(expected);
  });

  it('não se confunde com ">" ou com outro "atributo" dentro do valor', () => {
    expect(sanitizeHtml('<input value="a > b" id="x"><p>depois</p>')).toBe(
      '<input id="x"><p>depois</p>',
    );
    expect(sanitizeHtml(`<input title='value="fica"' value="sai" id="x">`)).toBe(
      `<input title='value="fica"' id="x">`,
    );
    expect(sanitizeHtml('<input placeholder="value=1" value="sai">')).toBe(
      '<input placeholder="value=1">',
    );
  });

  it('mantém atributos parecidos, que não são o value', () => {
    const html = '<input data-value="1" valuex="2" aria-valuenow="3" defaultvalue="4">';

    expect(sanitizeHtml(html)).toBe(html);
  });

  it('trata todos os inputs do documento, inclusive os ocultos', () => {
    const html = [
      '<form id="kc-form-login" action="/login" method="post">',
      '<label for="username">Endereço de e-mail</label>',
      '<input id="username" name="username" type="text" value="operador@hotel.test" autocomplete="off">',
      '<input id="password" name="password" type="password" value="S3nh@">',
      '<input type="hidden" name="credentialId" value="abc123">',
      '<input type="submit" name="login" id="kc-login" value="Entrar">',
      '</form>',
    ].join('\n');

    const sanitized = sanitizeHtml(html);

    expect(sanitized).not.toContain('value=');
    for (const secret of ['operador@hotel.test', 'S3nh@', 'abc123']) {
      expect(sanitized).not.toContain(secret);
    }
    expect(sanitized).toContain('<label for="username">Endereço de e-mail</label>');
    expect(sanitized).toContain('<input id="password" name="password" type="password">');
  });

  it('não altera outras tags, nem o que só parece um input', () => {
    const html =
      '<option value="1">Um</option><button value="x">Ok</button>' +
      '<inputmask value="fica"></inputmask><textarea>texto</textarea>';

    expect(sanitizeHtml(html)).toBe(html);
  });

  it('não altera HTML sem inputs nem texto vazio', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml('<h1>Entrar na sua conta</h1>')).toBe('<h1>Entrar na sua conta</h1>');
  });

  it('remove o valor mesmo em HTML cortado no meio da tag', () => {
    expect(sanitizeHtml('<p>antes</p><input id="a" value="segredo')).toBe(
      '<p>antes</p><input id="a"',
    );
    expect(sanitizeHtml('<input value=')).toBe('<input');
    expect(sanitizeHtml('<input')).toBe('<input');
  });

  it('aplicar duas vezes dá o mesmo resultado', () => {
    const once = sanitizeHtml('<input value="a" id="x"><input id="y" value=b>');

    expect(sanitizeHtml(once)).toBe(once);
  });
});
