// Telas 1.x — Configuração (apps/desktop/src/renderer/src/screens/setup/).
// Requer o figma-prelude.js antes deste arquivo.

const ADDR_DESC = 'Como recebido do responsável, com https:// (ex.: https://192.168.0.50)';
const SETUP_ALERT = ['Configure a conexão com o servidor', 'Informe o endereço do servidor, o certificado raiz e a chave de acesso desta máquina.'];

async function certRow(parent) {
  const r = row(parent, 'Certificado', { itemSpacing: 12, fill: false });
  await btn(r, 'Escolher certificado raiz…', 'Contorno');
  r.appendChild(await T('Arquivo hunit-raiz.crt exportado do servidor', 'corpo', 'texto/apagado'));
}
async function certBox(parent) {
  const box = AL('VERTICAL', { name: 'Certificado escolhido', itemSpacing: 4, paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12, cornerRadius: 8 });
  box.fills = [paint('fundo/sutil')]; put(parent, box, 'fill');
  put(box, await T('Autoridade: CN=Caddy Local Authority - 2026 ECC Root'));
  put(box, await T('Impressão digital (SHA-256):'));
  put(box, await T('5D:E7:B1:FE:48:47:4D:C6:D4:AE:43:2E:76:EE:45:23:93:C5:01:16:34:DA:0F:6D:14:7C:46:3E:7A:E3:96:ED', 'mono'));
  put(box, await T('Válido até 10/11/2036'));
  put(box, await T('Confira a impressão digital com o responsável pelo servidor.', 'descrição', 'texto/apagado'));
}
async function connectionActions(parent, test, save) {
  const b = row(parent, 'Ações', { itemSpacing: 16, fill: false }); await btn(b, 'Testar conexão', test); await btn(b, 'Salvar conexão', save);
}
async function tokenNoticeCard(main) {
  const c = await card(main, 'Aviso do pedido de token', 760);
  put(c, await T('Quando o Hunit pedir o token, o app mostra uma notificação do Windows, vem para a frente e toca um som. Teste para conferir se a notificação aparece nesta máquina.'), 'fill');
  divider(c); await btn(c, 'Testar aviso', 'Contorno');
}
const versionFooter = async (main) => put(main, await T('HUNIT Control — versão 0.1.0', 'corpo', 'texto/apagado'));

SCREENS['1.1'] = {
  name: 'Configuração — primeiro uso', h: 900, profile: 'Sem conexão', nav: ['Configuração'], active: 'Configuração',
  async build({ main }) {
    await alert(main, 'Azul', ...SETUP_ALERT);
    put(main, await T('Configuração', 'título página'));
    const c = await card(main, 'Conexão com o servidor', 760);
    await field(c, { label: 'Endereço do servidor', desc: ADDR_DESC, variant: 'Placeholder' });
    await certRow(c);
    await field(c, { label: 'Chave de acesso', desc: 'Chave desta máquina, recebida do responsável pelo servidor', variant: 'Placeholder/Olho' });
    await connectionActions(c, 'Desabilitado', 'Desabilitado');
    await tokenNoticeCard(main);
    await versionFooter(main);
  },
};

SCREENS['1.2'] = {
  name: 'Configuração — conexão confirmada', h: 1000, profile: 'Sem conexão', nav: ['Configuração'], active: 'Configuração',
  async build({ main }) {
    await alert(main, 'Azul', ...SETUP_ALERT);
    put(main, await T('Configuração', 'título página'));
    const c = await card(main, 'Conexão com o servidor', 760);
    await field(c, { label: 'Endereço do servidor', desc: ADDR_DESC, value: 'https://192.168.0.50' });
    await certRow(c);
    await certBox(c);
    await field(c, { label: 'Chave de acesso', desc: 'Chave desta máquina, recebida do responsável pelo servidor', value: '••••••••••••••••••••••••••••••••••••••••••••', variant: 'Preenchido/Olho' });
    await connectionActions(c, 'Leve', 'Preenchido');
    const a = await alert(c, 'Verde', 'Conexão confirmada', 'Cliente Recepção — PC 1, perfil Operador. Salve para usar esta conexão.');
    a.findOne((n) => n.type === 'TEXT' && n.name === 'mensagem').setRangeFontName(8, 23, { family: 'Noto Sans', style: 'Bold' });
    await tokenNoticeCard(main);
  },
};

SCREENS['1.3'] = {
  name: 'Configuração — conectado (operador)', h: 1340, profile: 'Operador', nav: NAV_OP, active: 'Configuração',
  async build({ main }) {
    put(main, await T('Configuração', 'título página'));
    const c = await card(main, 'Conexão com o servidor', 760);
    await field(c, { label: 'Endereço do servidor', desc: ADDR_DESC, value: 'https://192.168.0.50' });
    await certRow(c);
    await certBox(c);
    await field(c, { label: 'Chave de acesso', desc: 'Chave guardada protegida nesta máquina. Deixe em branco para manter.', variant: 'Placeholder/Olho' });
    await connectionActions(c, 'Leve', 'Desabilitado');
    const p = await card(main, 'Preferências', 760);
    await field(p, { label: 'Prazo de inatividade (horas)', desc: 'Depois desse tempo sem uso, usuário e senha do Hunit são apagados da memória', value: '8', variant: 'Preenchido/Seletor', width: 260 });
    p.appendChild(await I(K.switch, { [P.switch]: 'Som do aviso dentro do app' }));
    await btn(p, 'Salvar preferências', 'Leve');
    await tokenNoticeCard(main);
    const r = await card(main, 'Remover a configuração', 760);
    put(r, await T('Apaga desta máquina o endereço do servidor, o certificado e a chave de acesso guardada. Para usar o app de novo, será preciso configurar outra vez.'), 'fill');
    await btn(r, 'Remover a configuração desta máquina', 'Perigo leve');
    await versionFooter(main);
  },
};
