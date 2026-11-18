// Telas 7.7 a 7.14 — área "Comercial" (envios, retornos a validar, retornos com problema, planilha)
// e as ações da lista de reservas da 005 (selecionar todas do filtro, confirmar retornos e
// "Verificar" em lote, copiar para e-mail). Requer o figma-prelude.js e o
// 4-6-reservas-estados-consulta.js antes deste arquivo. Dados fictícios, os do roteiro de captura.

const COMMERCIAL_TABS = ['Envios', 'Retornos a validar', 'Retornos com problema', 'Planilha'];
/** Título e abas da área Comercial (screens/commercial/CommercialScreen.tsx). */
async function commercialPage(main, active) {
  put(main, await T('Comercial', 'título página'));
  const bar = AL('HORIZONTAL', { name: 'Abas' }); put(main, bar, 'fill');
  bar.strokes = [paint('borda/padrão')]; bar.strokeTopWeight = 0; bar.strokeLeftWeight = 0; bar.strokeRightWeight = 0; bar.strokeBottomWeight = 2;
  for (const tab of COMMERCIAL_TABS) {
    const t = AL('HORIZONTAL', { name: 'Aba — ' + tab, paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10 }); bar.appendChild(t);
    t.appendChild(await T(tab));
    if (tab === active) { t.strokes = [paint('azul/6')]; t.strokeTopWeight = 0; t.strokeLeftWeight = 0; t.strokeRightWeight = 0; t.strokeBottomWeight = 2; }
  }
}

// Retornos aguardando validação do roteiro: [reserva, código, hotel da cobrança, difere, cobrado, a cobrar, diferença].
const RETURNS = [
  ['101-1002', 'AUT-55210', 'Maquininha Centro de Convenções', true, 'R$ 1.280,00', 'R$ 655,00', 'R$ 625,00'],
  ['101-1003', 'AUT-55211', 'Hotel Praia Azul', false, 'R$ 515,00', 'R$ 792,50', '-R$ 277,50'],
];
const chargeHotelCell = (name, differs) => ({ build: async (cell) => {
  cell.layoutMode = 'VERTICAL'; cell.primaryAxisAlignItems = 'CENTER'; cell.counterAxisAlignItems = 'MIN'; cell.itemSpacing = 2;
  await chargeHotelBlock(cell, name, differs);
} });
const differenceCell = (value) => ({ build: async (cell) => { cell.appendChild(await T(value, 'corpo forte', 'laranja/8')); } });

SCREENS['7.7'] = { name: 'Comercial — Envios', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Comercial',
  async build({ main }) {
    await commercialPage(main, 'Envios');
    await table(main, [['Quando', 216], ['Quem enviou', 218], ['Estado', 150], ['Reservas', 130], ['Enviadas', 130], ['Retiradas', 138], ['Não verificadas', 'fill']],
      [['17/11/2026 16:34', 'Recepção — PC 1', { badge: 'Verde', text: 'Concluído' }, '15', '14', '0', '1']]);
  } };

SCREENS['7.8'] = { name: 'Comercial — Retornos a validar', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Comercial',
  async build({ main }) {
    await commercialPage(main, 'Retornos a validar');
    const a = row(main, 'Ações', { itemSpacing: 12 }); await btn(a, 'Confirmar marcados (0)', 'Desabilitado xs');
    a.appendChild(await T('A recusa é uma a uma, com o motivo.', 'descrição', 'texto/apagado'));
    const t = await table(main, [[' ', 36], ['Reserva', 90], ['Código de autorização', 125], ['Hotel da cobrança', 245], ['Valor cobrado', 100], ['Valor a cobrar', 100], ['Diferença', 92], ['Responsável', 112], ['Lido em', 110], [' ', 'fill']],
      RETURNS.map(([number, code, hotel, differs, charged, due, diff]) => [
        { check: false }, { build: async (cell) => { cell.appendChild(await T(number, 'corpo', 'azul/6')); } }, code, chargeHotelCell(hotel, differs), charged, due, differenceCell(diff),
        'Paula (Comercial)', '17/11/2026 16:34', { build: async (cell) => { cell.itemSpacing = 6; await btn(cell, 'Confirmar', 'Preenchido xs'); await btn(cell, 'Recusar', 'Contorno xs'); } },
      ]));
    const head = t.children[0].children[0]; head.children.forEach((n) => n.remove()); head.appendChild(tick(false));
    autoRows(t);
  } };

SCREENS['7.9'] = { name: 'Comercial — Retornos com problema', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Comercial',
  async build({ main }) {
    await commercialPage(main, 'Retornos com problema');
    await table(main, [['Hotel', 130], ['Reserva', 87], ['Problema', 158], ['O que falta ou não foi entendido', 'fill'], ['Quando', 132]],
      [['Hotel Praia Azul', '101-1005', 'Retorno incompleto', 'Retorno incompleto: faltam o hotel da cobrança, o valor cobrado e o responsável pela cobrança', '17/11/2026 16:34']]);
  } };

SCREENS['7.10'] = { name: 'Comercial — Planilha', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Comercial',
  async build({ main }) {
    await commercialPage(main, 'Planilha');
    const c = await card(main, null, 'fill', 16); c.name = 'Card — Planilha';
    const h = row(c, 'Situação', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
    const hl = AL('HORIZONTAL', { name: 'Título', itemSpacing: 10, counterAxisAlignItems: 'CENTER' }); h.appendChild(hl);
    hl.appendChild(await T('Situação', 'título seção')); await badge(hl, 'Verde', 'Funcionando');
    await btn(h, 'Ler retornos agora', 'Preenchido xs');
    await kvGrid(c, [['Atualizações pendentes', '0'], ['Retornos aguardando validação', '2'], ['Retornos com problema', '1'], ['Última rodada completa', '17/11/2026 16:34'], ['Última leitura dos retornos', '17/11/2026 16:34']], 'Estado da planilha');
  } };

/** Lista com as 24 reservas do filtro selecionadas (FR-030) e o aviso da seleção. */
async function selectAllBase(main) {
  await reservationsPage(main, {
    treatments: { '101-1000': ['Verde', 'Comprovante enviado'], '101-1002': ['Amarelo', 'Validar comprovante'], '101-1003': ['Amarelo', 'Validar comprovante'] },
    charged: TREATED_CHARGED, checked: RESERVATIONS.map((r) => r[1]), selection: [24, 'R$ 42.591,62'], notice: '24 reservas selecionadas do filtro.', count: 8,
  });
}
async function dialogActions(m, confirm) {
  const b = row(m, 'Botões', { itemSpacing: 12, primaryAxisAlignItems: 'MAX' }); await btn(b, 'Cancelar', 'Contorno'); await btn(b, confirm);
}

SCREENS['7.11'] = { name: 'Reservas — selecionar todas do filtro', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ main }) { await selectAllBase(main); } };

SCREENS['7.12'] = { name: 'Reservas — confirmar retornos em lote', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await selectAllBase(main);
    overlay(root);
    const m = modal(root, 780, 'Diálogo — confirmar retornos');
    await titleWithClose(m, 'Confirmar retornos do Comercial');
    put(m, await rich([['2', 'b'], [' retornos aguardando validação — 22 ficam de fora (sem retorno aguardando validação).']]), 'fill');
    autoRows(await table(m, [['Reserva', 80], ['Código de autorização', 125], ['Hotel da cobrança', 240], ['Valor cobrado', 100], ['Valor a cobrar', 100], ['Diferença', 'fill']],
      RETURNS.map(([number, code, hotel, differs, charged, due, diff]) => [number, code, chargeHotelCell(hotel, differs), charged, due, differenceCell(diff)])));
    put(m, await T('Cada retorno confirmado vale como comprovante, e o valor cobrado informado pelo Comercial passa a ser o valor cobrado da reserva. Para recusar, abra a reserva.', 'corpo', 'texto/apagado'), 'fill');
    await dialogActions(m, 'Confirmar 2');
    topOf(root, m);
  } };

SCREENS['7.13'] = { name: 'Reservas — confirmar "Verificar" em lote', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await selectAllBase(main);
    overlay(root);
    const m = modal(root, 620, 'Diálogo — confirmar "Verificar"');
    await titleWithClose(m, 'Confirmar "Verificar"');
    put(m, await rich([['1', 'b'], [' reserva com o alerta "Verificar" — 23 ficam de fora (sem o alerta).']]), 'fill');
    await table(m, [['Status do Hunit', 360], ['Reservas', 'fill']], [['Já cobrada', '1']]);
    put(m, await T('Confirmar só tira o alerta: a tratativa continua registrada, e cada reserva ganha o registro no histórico.', 'corpo', 'texto/apagado'), 'fill');
    await dialogActions(m, 'Confirmar 1');
    topOf(root, m);
  } };

SCREENS['7.14'] = { name: 'Reservas — copiar para e-mail', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Reservas',
  async build({ root, main }) {
    await selectAllBase(main);
    overlay(root);
    const m = modal(root, 440, 'Diálogo — copiar para e-mail');
    await titleWithClose(m, 'Copiar para e-mail');
    put(m, await T('Copia uma tabela com hotel, reserva, check-in, canal, valor a cobrar, motivo, ativa ou cancelada e situação, como na planilha do Comercial, com o total. O nome do hóspede não vai na cópia.'), 'fill');
    const g = AL('VERTICAL', { name: 'O que copiar', itemSpacing: 10 }); put(m, g, 'fill');
    g.appendChild(await T('O que copiar', 'rótulo'));
    g.appendChild(await I(K.radio['Marcado'], { [P.radio]: 'As reservas selecionadas (24)' }));
    g.appendChild(await I(K.radio['Desmarcado'], { [P.radio]: 'O resultado da pesquisa (todas as páginas)' }));
    await dialogActions(m, 'Copiar');
    topOf(root, m);
  } };
