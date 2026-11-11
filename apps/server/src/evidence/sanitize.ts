/**
 * Remove o atributo `value` de todos os campos `<input>` de um HTML (research R-12).
 *
 * Uma tela guardada como evidência não pode levar junto o que estava preenchido nos campos:
 * o usuário que a página de login repete depois de um erro, campos ocultos de sessão etc.
 * (O que o operador digita nem chega ao HTML; isto cobre o que o próprio site preencheu.)
 *
 * Não usa expressão regular para achar o fim da tag: lê atributo por atributo, respeitando
 * aspas, porque o valor de um atributo pode conter ">" ou parecer outro atributo.
 */
const TAG_OPEN = /<input(?=[\s/>])/gi;

const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

export function sanitizeHtml(html: string): string {
  let result = '';
  let copiedUpTo = 0;

  TAG_OPEN.lastIndex = 0;
  for (let match = TAG_OPEN.exec(html); match !== null; match = TAG_OPEN.exec(html)) {
    let position = match.index + match[0].length;

    // Percorre os atributos até o fim da tag (">") ou do texto.
    while (position < html.length && html[position] !== '>') {
      const attributeStart = position;
      while (isSpace(html[position]) || html[position] === '/') position += 1;
      if (position >= html.length || html[position] === '>') break;

      const nameStart = position;
      while (
        position < html.length &&
        !isSpace(html[position]) &&
        html[position] !== '=' &&
        html[position] !== '>' &&
        html[position] !== '/'
      ) {
        position += 1;
      }
      const name = html.slice(nameStart, position).toLowerCase();

      let afterName = position;
      while (isSpace(html[afterName])) afterName += 1;

      if (html[afterName] === '=') {
        position = afterName + 1;
        while (isSpace(html[position])) position += 1;

        const quote = html[position];
        if (quote === '"' || quote === "'") {
          const closing = html.indexOf(quote, position + 1);
          // Aspas sem fechamento: o valor vai até o fim do texto.
          position = closing === -1 ? html.length : closing + 1;
        } else {
          while (position < html.length && !isSpace(html[position]) && html[position] !== '>') {
            position += 1;
          }
        }
      }

      if (name === 'value') {
        result += html.slice(copiedUpTo, attributeStart);
        copiedUpTo = position;
      }
    }

    TAG_OPEN.lastIndex = position;
  }

  return result + html.slice(copiedUpTo);
}
