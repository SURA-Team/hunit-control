// Telas 3.x — Execuções (apps/desktop/src/renderer/src/screens/executions/).
// Requer o figma-prelude.js antes deste arquivo.

const ME = { rich: [['Recepção — PC 1'], [' (esta máquina)', 'dimsm']] };
const LIST_COLS = [['Iniciada em', 168], ['Quem iniciou', 276], ['Período de check-in', 233], ['Estado', 163], ['Motivo de término', 300], ['Encerrada em', 'fill']];
const HISTORY = [
  ['12/11/2026 09:12', ME, '12/11/2026 a 18/11/2026', { badge: 'Vermelho', text: 'Falhou' }, 'O Hunit recusou o token.', '12/11/2026 09:13'],
  ['11/11/2026 08:40', ME, '11/11/2026 a 17/11/2026', { badge: 'Verde', text: 'Concluída' }, '', '11/11/2026 08:47'],
  ['10/11/2026 08:35', ME, '10/11/2026 a 16/11/2026', { badge: 'Cinza', text: 'Cancelada' }, 'Cancelada por um operador.', '10/11/2026 08:39'],
];
async function executionsList(main, running) {
  put(main, await T('Execuções', 'título página'));
  const first = running
    ? ['13/11/2026 15:46', ME, PERIOD, { badge: 'Azul', text: 'Em andamento' }, '', '']
    : ['13/11/2026 15:46', ME, PERIOD, { badge: 'Verde', text: 'Concluída' }, '', '13/11/2026 15:49'];
  await table(main, LIST_COLS, [first, ...HISTORY]);
}
async function evidence(parent, items) {
  const c = await card(parent, 'Evidências de falha', 'fill', 8);
  for (const [title, at] of items) {
    const e = AL('VERTICAL', { name: 'Evidência', itemSpacing: 4 }); put(c, e, 'fill');
    put(e, await T(title, 'corpo forte'), 'fill');
    put(e, await T('Reserva sem pré-pagamento e sem forma de pagamento informada pelo Hunit: não é possível saber se precisa ser cobrada.'), 'fill');
    put(e, await T(`Registrada em ${at}; disponível até ${at.replace('13/11', '13/12')}`, 'descrição', 'texto/apagado'), 'fill');
    await btn(e, 'Salvar resposta', 'Contorno xs');
  }
}
const DET_COLS = [['Hotel', 212], ['Situação', 137], ['Páginas', 78], ['Reservas', 84], ['Duração', 84], ['Motivo ou aviso', 'fill']];
const HOTEL_DONE = { badge: 'Verde', text: 'Concluído' };
async function executionDetail(root, running) {
  overlay(root);
  const d = drawer(root, 'Gaveta — detalhe da execução');
  await titleWithClose(d, 'Detalhe da execução');
  const s = row(d, 'Execução', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const l = AL('HORIZONTAL', { itemSpacing: 12, counterAxisAlignItems: 'CENTER', name: 'Título' }); s.appendChild(l);
  l.appendChild(await T('Execução', 'título seção')); await badge(l, running ? 'Azul' : 'Verde', running ? 'Em andamento' : 'Concluída');
  s.appendChild(await rich([['Recepção — PC 1 (esta máquina)', 'dim']]));
  put(d, await T(`Check-in de ${PERIOD} — iniciada em 13/11/2026 15:46` + (running ? '' : ', encerrada em 13/11/2026 15:49')), 'fill');
  if (running) {
    const box = AL('HORIZONTAL', { name: 'Hotel atual', paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12, cornerRadius: 8 });
    box.fills = [paint('fundo/padrão')]; box.strokes = [paint('borda/padrão')]; put(d, box, 'fill');
    box.appendChild(await rich([['Hotel atual: ', 'b'], ['Hotel Centro Histórico (103) — página 1 de 1']]));
    put(d, await rich([['Tempo estimado restante: '], ['1 min', 'b']]));
    await statGrid(d, [['Amarelo', 'Pendente de cobrança', 2], ['Amarelo', 'Cobrar na maquininha', 1], ['Amarelo', 'Cartão validado (não cobrado)', 1], ['Vermelho', 'Erro na cobrança', 2], ['Vermelho', 'Erro de análise', 1], ['Verde', 'Já cobrada', 2], ['Verde', 'Faturada', 1]]);
    await table(d, DET_COLS, [
      ['Hotel Praia Azul (101)', HOTEL_DONE, '1 de 1', '6', '42 s', ''],
      ['Pousada Serra Verde (102)', HOTEL_DONE, '1 de 1', '4', '31 s', ''],
      ['Hotel Centro Histórico (103)', { badge: 'Azul', text: 'Em andamento' }, '0 de 1', '0', '—', ''],
      ['Resort Lagoa Clara (104)', { badge: 'Cinza', text: 'Pendente' }, '—', '0', '—', ''],
    ]);
    await evidence(d, [['Falha ao classificar — hotel 102, reserva 102-1006', '13/11/2026 15:46']]);
    await btn(d, 'Ver as reservas desta execução', 'Contorno');
    await btn(d, 'Cancelar execução', 'Perigo leve');
  } else {
    await statGrid(d, [['Amarelo', 'Pendente de cobrança', 4], ['Amarelo', 'Cobrar na maquininha', 3], ['Amarelo', 'Cartão validado (não cobrado)', 3], ['Vermelho', 'Erro na cobrança', 3], ['Vermelho', 'Erro de análise', 3], ['Verde', 'Já cobrada', 3], ['Verde', 'Faturada', 3]]);
    await table(d, DET_COLS, [
      ['Hotel Praia Azul (101)', HOTEL_DONE, '1 de 1', '6', '42 s', ''],
      ['Pousada Serra Verde (102)', HOTEL_DONE, '1 de 1', '4', '31 s', ''],
      ['Hotel Centro Histórico (103)', HOTEL_DONE, '1 de 1', '5', '38 s', ''],
      ['Resort Lagoa Clara (104)', HOTEL_DONE, '1 de 1', '7', '51 s', ''],
    ]);
    await evidence(d, [['Falha ao classificar — hotel 104, reserva 104-1020', '13/11/2026 15:48'], ['Falha ao classificar — hotel 103, reserva 103-1013', '13/11/2026 15:47']]);
    await btn(d, 'Ver as reservas desta execução', 'Contorno');
  }
}

SCREENS['3.1'] = { name: 'Execuções — lista (uma em andamento)', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Execuções',
  async build({ main }) { await executionsList(main, true); } };

SCREENS['3.2'] = { name: 'Execuções — detalhe em andamento', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Execuções',
  async build({ root, main }) { await executionsList(main, true); await executionDetail(root, true); } };

SCREENS['3.3'] = { name: 'Execuções — confirmar cancelamento', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Execuções',
  async build({ root, main }) {
    await executionsList(main, true); await executionDetail(root, true);
    overlay(root);
    const m = modal(root, 440, 'Diálogo — cancelar a execução?');
    await titleWithClose(m, 'Cancelar a execução?', 'corpo grande');
    put(m, await T('Os hotéis já concluídos ficam gravados; os que faltam podem ser retomados depois.'), 'fill');
    const a = row(m, 'Ações', { primaryAxisAlignItems: 'MAX', itemSpacing: 16 }); await btn(a, 'Não', 'Contorno'); await btn(a, 'Sim, cancelar', 'Perigo');
    center(root, m);
  } };

SCREENS['3.4'] = { name: 'Execuções — detalhe concluída', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Execuções',
  async build({ root, main }) { await executionsList(main, false); await executionDetail(root, false); } };
