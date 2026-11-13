// Testes do fluxo completo com dados fictícios. Rode: node tests/teste-fluxo.js
const assert = require('assert');
const { criarAmbiente } = require('./gas-mock');

function gerarCpf(n) {
  const d = String(100000000 + n * 7919).slice(-9).split('').map(Number);
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i); d.push(((s * 10) % 11) % 10); }
  return d.join('');
}
let falhas = 0;
function caso(nome, fn) { try { fn(); console.log('ok  ', nome); } catch (e) { falhas++; console.log('FALHOU', nome, '\n   ', e.message); } }

const A = criarAmbiente();
const { post, ctx, abas, enviados } = A;
A.setRelogio(Date.parse('2026-11-14T12:00:00Z'));
ctx.setup();

let token;
caso('login: e-mail fora da equipe recebe a mesma resposta e nenhum código', () => {
  const r = post({ acao: 'login_pedir', email: 'intruso@x.com' });
  assert(r.ok); assert.strictEqual(enviados.length, 0);
});
caso('login: e-mail da equipe recebe código e entra', () => {
  post({ acao: 'login_pedir', email: 'Admin@Teste.br ' });
  assert.strictEqual(enviados.length, 1);
  const codigo = enviados[0].subject.match(/(\d{6})$/)[1];
  assert(!post({ acao: 'login_validar', email: 'admin@teste.br', codigo: '000000' }).ok);
  const r = post({ acao: 'login_validar', email: 'admin@teste.br', codigo });
  assert(r.ok && r.token); token = r.token;
  assert(post({ acao: 'eu', token }).ok);
});
caso('ação da equipe sem token é recusada', () => {
  const r = post({ acao: 'pessoas' }); assert(!r.ok && r.sessao === false);
});

const cpfs = Array.from({ length: 123 }, (_, i) => gerarCpf(i + 1));
caso('importar 123 pessoas (CPF nunca gravado inteiro)', () => {
  const linhas = cpfs.map((c, i) => ({ cpf: c, codigo_ibge: i < 114 ? '5007901' : '5008008', tipo: i >= 114 ? 'tutor' : 'cursista' }));
  linhas.push({ cpf: '11111111111', codigo_ibge: '5007901' }); // inválido
  const r = post({ acao: 'importar_pessoas', token, linhas });
  assert.strictEqual(r.novas, 123); assert.strictEqual(r.invalidos, 1);
  const tudo = JSON.stringify(abas.Pessoas.linhas);
  cpfs.forEach(c => assert(!tudo.includes(c), 'CPF completo encontrado na planilha'));
  assert.strictEqual(post({ acao: 'importar_pessoas', token, linhas: [{ cpf: cpfs[0], codigo_ibge: '5007901' }] }).repetidos, 1);
  assert.strictEqual(abas.Pessoas.linhas[1][4], 'Sidrolândia');
});
caso('importar nomes depois, casando pelo CPF', () => {
  const r = post({ acao: 'importar_nomes', token, linhas: [{ cpf: cpfs[0], nome: 'Maria da Silva Souza' }, { cpf: gerarCpf(9999), nome: 'Fora da lista' }] });
  assert.strictEqual(r.atualizados, 1); assert.strictEqual(r.nao_encontrados, 1);
});

let enc;
caso('criar encontro e abrir chamada', () => {
  const r = post({ acao: 'encontro_salvar', token, encontro: { roca: 1, data: '2026-11-14', tipo: 'TU', carga_horaria: 8, descricao: 'Abertura' } });
  assert(r.ok); enc = r.id;
  assert(!post({ acao: 'qr', token, encontro: enc }).ok, 'QR não deve sair com chamada fechada');
  assert(post({ acao: 'encontro_status', token, encontro: enc, status: 'aberto' }).ok);
});

let codigo;
caso('QR dinâmico: código atual funciona, vencido não', () => {
  codigo = post({ acao: 'qr', token, encontro: enc }).codigo;
  assert(post({ acao: 'checkin_info', encontro: enc, codigo }).ok);
  assert(!post({ acao: 'checkin_info', encontro: enc, codigo: 'falso12345' }).ok);
  const t0 = A.agora();
  A.setRelogio(t0 + 120 * 1000); assert(post({ acao: 'checkin_info', encontro: enc, codigo }).ok, 'deveria valer por 2 min');
  A.setRelogio(t0 + 200 * 1000); assert(!post({ acao: 'checkin_info', encontro: enc, codigo }).ok, 'deveria ter vencido');
  A.setRelogio(t0);
});
caso('check-in em 2 passos, mostra nome curto e CPF mascarado', () => {
  const p1 = post({ acao: 'checkin', encontro: enc, codigo, cpf: cpfs[0].replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') });
  assert(p1.ok && !p1.registrada); assert.strictEqual(p1.pessoa.nome, 'Maria S.'); assert(p1.pessoa.cpf.startsWith('***.'));
  const p2 = post({ acao: 'checkin', encontro: enc, codigo, cpf: cpfs[0], confirmar: true });
  assert(p2.ok && p2.registrada && !p2.jaRegistrada);
  const p3 = post({ acao: 'checkin', encontro: enc, codigo, cpf: cpfs[0], confirmar: true });
  assert(p3.jaRegistrada, 'segunda tentativa deve avisar que já registrou');
});
caso('CPF fora da lista e CPF inválido', () => {
  assert(/não encontrado/.test(post({ acao: 'checkin', encontro: enc, codigo, cpf: gerarCpf(5555) }).erro));
  assert(/inválido/.test(post({ acao: 'checkin', encontro: enc, codigo, cpf: '12345678900' }).erro));
});
caso('presença manual exige motivo e lote ignora repetidos', () => {
  const pessoas = post({ acao: 'pessoas', token }).pessoas;
  assert(!post({ acao: 'presenca_manual', token, encontro: enc, pessoa_id: pessoas[1].id, motivo: '' }).ok);
  assert.strictEqual(post({ acao: 'presenca_manual', token, encontro: enc, pessoa_id: pessoas[1].id, motivo: 'sem bateria' }).registradas, 1);
  const r = post({ acao: 'presenca_lote', token, encontro: enc, forma: 'lista_fisica', pessoas: pessoas.slice(0, 50).map(p => p.id) });
  assert.strictEqual(r.registradas, 48); assert.strictEqual(r.ja_tinham, 2);
});
caso('pico: 120 check-ins seguidos sem duplicar', () => {
  const ini = Date.now();
  for (let i = 50; i < 123; i++) post({ acao: 'checkin', encontro: enc, codigo, cpf: cpfs[i], confirmar: true });
  for (let i = 50; i < 60; i++) post({ acao: 'checkin', encontro: enc, codigo, cpf: cpfs[i], confirmar: true });
  const n = post({ acao: 'presencas', token, encontro: enc }).presencas.length;
  assert.strictEqual(n, 123); console.log('      (', Date.now() - ini, 'ms no simulador )');
});
caso('frequência: 75%, risco e abaixo', () => {
  const tc = post({ acao: 'encontro_salvar', token, encontro: { roca: 1, data: '2026-11-14', tipo: 'TC', carga_horaria: 10 } }).id;
  const r2 = post({ acao: 'encontro_salvar', token, encontro: { roca: 2, data: '2026-12-10', tipo: 'TU', carga_horaria: 20 } }).id;
  const pessoas = post({ acao: 'pessoas', token }).pessoas;
  post({ acao: 'presenca_lote', token, encontro: tc, forma: 'tempo_comunidade', pessoas: pessoas.slice(0, 100).map(p => p.id) });
  const f = post({ acao: 'frequencia', token });
  assert.strictEqual(f.total_horas, 38); assert.strictEqual(f.horas_ate_agora, 18);
  const a = f.pessoas.find(p => p.id === pessoas[0].id); const b = f.pessoas.find(p => p.id === pessoas[110].id);
  assert.strictEqual(a.horas_presentes, 18); assert.strictEqual(a.situacao_freq, 'ok');
  assert.strictEqual(b.horas_presentes, 8); assert.strictEqual(b.situacao_freq, 'abaixo'); // faltou 10h de 9,5h permitidas
});
caso('remover presença exige motivo', () => {
  const p = post({ acao: 'presencas', token, encontro: enc }).presencas[0];
  assert(!post({ acao: 'presenca_remover', token, presenca: p.id }).ok);
  assert(post({ acao: 'presenca_remover', token, presenca: p.id, motivo: 'lançada por engano' }).ok);
  assert.strictEqual(post({ acao: 'presencas', token, encontro: enc }).presencas.length, 122);
});
caso('fechar chamada bloqueia check-in', () => {
  post({ acao: 'encontro_status', token, encontro: enc, status: 'fechado' });
  assert(/não está aberta/.test(post({ acao: 'checkin', encontro: enc, codigo, cpf: cpfs[3] }).erro));
});
caso('excluir encontro: pede motivo, confirmação se houver presenças e tira da frequência', () => {
  const vazio = post({ acao: 'encontro_salvar', token, encontro: { roca: 3, data: '2027-02-01', tipo: 'TU', carga_horaria: 4 } }).id;
  assert(!post({ acao: 'encontro_excluir', token, encontro: vazio }).ok, 'sem motivo deve recusar');
  assert(post({ acao: 'encontro_excluir', token, encontro: vazio, motivo: 'cadastrado errado' }).ok);
  const antes = post({ acao: 'frequencia', token }).total_horas;
  const r1 = post({ acao: 'encontro_excluir', token, encontro: enc, motivo: 'teste' });
  assert(!r1.ok && r1.precisa_confirmar && r1.presencas === 122);
  const r2 = post({ acao: 'encontro_excluir', token, encontro: enc, motivo: 'teste', forcar: true });
  assert(r2.ok && r2.presencas_removidas === 122);
  const f = post({ acao: 'frequencia', token });
  assert.strictEqual(f.total_horas, antes - 8);
  assert(!post({ acao: 'encontros', token }).encontros.some(e => e.id === enc));
});
caso('sair encerra a sessão', () => {
  post({ acao: 'sair', token }); assert(!post({ acao: 'eu', token }).ok);
});

console.log(falhas ? `\n${falhas} teste(s) falharam` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
