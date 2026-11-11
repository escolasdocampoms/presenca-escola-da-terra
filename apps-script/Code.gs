/**
 * Sistema de presença – Programa Escola da Terra MS
 * Backend em Google Apps Script. O site (GitHub Pages) chama este script por POST.
 *
 * Instalação: veja apps-script/INSTALACAO.md
 *
 * Proteção de dados (LGPD):
 *  - O CPF completo NUNCA é gravado. A planilha guarda só o CPF mascarado
 *    (***.456.789-**) e uma "impressão digital" (HMAC-SHA256 com chave secreta).
 *  - As chaves secretas ficam nas Propriedades do Script, nunca na planilha nem no GitHub.
 */

// ===================== CONFIGURAÇÕES =====================
var CFG = {
  QR_JANELA_SEG: 30,          // o QR muda a cada 30 segundos
  QR_JANELAS_ACEITAS: 5,      // aceita o código atual e os 4 anteriores (~2,5 min)
  CODIGO_LOGIN_MIN: 10,       // validade do código enviado por e-mail
  SESSAO_DIAS: 30,            // tempo que a equipe fica conectada
  FREQ_MINIMA: 0.75,          // 75% de presença
  RISCO_HORAS: 8,             // "em risco" quando restam até 8h de faltas permitidas
  NOME_PROGRAMA: 'Programa Escola da Terra – MS'
};

var ABAS = {
  Pessoas:   ['id', 'cpf_mascarado', 'cpf_hash', 'nome', 'municipio', 'codigo_ibge', 'tipo', 'situacao', 'criado_em'],
  Encontros: ['id', 'roca', 'data', 'tipo', 'carga_horaria', 'descricao', 'status', 'aberto_em', 'fechado_em'],
  Presencas: ['id', 'pessoa_id', 'encontro_id', 'forma', 'registrado_por', 'motivo', 'data_hora', 'ativo'],
  Equipe:    ['email', 'nome', 'ativo', 'observacao'],
  Sessoes:   ['token_hash', 'email', 'expira_em', 'criado_em'],
  Log:       ['data_hora', 'email', 'acao', 'detalhe']
};

var MUNICIPIOS_MS = {
  '5000708': 'Anastácio', '5002704': 'Campo Grande', '5003488': 'Dois Irmãos do Buriti',
  '5004908': 'Jaraguari', '5005806': 'Nioaque', '5006002': 'Nova Alvorada do Sul',
  '5007109': 'Ribas do Rio Pardo', '5007901': 'Sidrolândia', '5008008': 'Terenos'
};

// ===================== INSTALAÇÃO =====================
/** Rode UMA vez pelo editor (menu Executar → setup). Cria as abas e as chaves secretas. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(ABAS).forEach(function (nome) {
    var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
    if (sh.getLastRow() === 0) {
      sh.appendRow(ABAS[nome]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, ABAS[nome].length).setFontWeight('bold');
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CPF_PEPPER')) props.setProperty('CPF_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('QR_SECRET')) props.setProperty('QR_SECRET', Utilities.getUuid() + Utilities.getUuid());
  var eu = Session.getEffectiveUser().getEmail();
  if (eu && !buscarEquipe_(eu)) aba_('Equipe').appendRow([eu.toLowerCase(), 'Administrador', 'sim', 'criado pelo setup']);
  var padrao = ss.getSheetByName('Sheet1') || ss.getSheetByName('Página1') || ss.getSheetByName('Planilha1');
  if (padrao && ss.getSheets().length > 1 && padrao.getLastRow() === 0) ss.deleteSheet(padrao);
  return 'Pronto. Abas criadas e chaves geradas. Agora implante como App da Web.';
}

// ===================== ENTRADA HTTP =====================
function doGet() {
  return json_({ ok: true, servico: 'presenca-escola-da-terra', hora: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, erro: 'Requisição inválida.' }); }
  try {
    var acao = String(req.acao || '');
    var publicas = { checkin_info: checkinInfo_, checkin: checkin_, login_pedir: loginPedir_, login_validar: loginValidar_ };
    if (publicas[acao]) return json_(publicas[acao](req));
    var usuario = sessao_(req.token);
    if (!usuario) return json_({ ok: false, erro: 'Sessão expirada. Entre novamente.', sessao: false });
    var privadas = {
      eu: function () { return { ok: true, email: usuario.email, nome: usuario.nome }; },
      sair: sair_,
      encontros: listarEncontros_, encontro_salvar: salvarEncontro_, encontro_status: statusEncontro_,
      qr: qrAtual_, pessoas: listarPessoas_, pessoa_atualizar: atualizarPessoa_,
      presencas: presencasEncontro_, presenca_manual: presencaManual_, presenca_lote: presencaLote_,
      presenca_remover: presencaRemover_, frequencia: frequencia_, buscar_cpf: buscarCpf_,
      importar_pessoas: importarPessoas_, importar_nomes: importarNomes_,
      equipe: listarEquipe_
    };
    if (!privadas[acao]) return json_({ ok: false, erro: 'Ação desconhecida.' });
    return json_(privadas[acao](req, usuario));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, erro: 'Erro no servidor: ' + (err && err.message ? err.message : err) });
  }
}

// ===================== CHECK-IN DO CURSISTA =====================
function checkinInfo_(req) {
  var enc = encontroValidoParaQr_(req.encontro, req.codigo);
  if (enc.erro) return { ok: false, erro: enc.erro };
  return { ok: true, encontro: resumoEncontro_(enc) };
}

/** Passo 1 (confirmar=false): mostra quem é. Passo 2 (confirmar=true): grava. */
function checkin_(req) {
  var enc = encontroValidoParaQr_(req.encontro, req.codigo);
  if (enc.erro) return { ok: false, erro: enc.erro };
  var cpf = limparCpf_(req.cpf);
  if (!cpfValido_(cpf)) return { ok: false, erro: 'CPF inválido. Confira os números.' };
  var pessoa = pessoaPorHash_(hashCpf_(cpf));
  if (!pessoa) return { ok: false, erro: 'CPF não encontrado na lista do curso. Procure a equipe.' };
  if (pessoa.situacao && pessoa.situacao !== 'ativo') return { ok: false, erro: 'Cadastro inativo. Procure a equipe.' };
  var quem = { nome: exibirNome_(pessoa.nome), cpf: pessoa.cpf_mascarado, municipio: pessoa.municipio, tipo: pessoa.tipo };
  var ja = presencaExistente_(pessoa.id, enc.id);
  if (ja) return { ok: true, registrada: true, jaRegistrada: true, hora: horaBR_(ja.data_hora), pessoa: quem, encontro: resumoEncontro_(enc) };
  if (!req.confirmar) return { ok: true, registrada: false, pessoa: quem, encontro: resumoEncontro_(enc) };
  // Dentro da trava fica só o mínimo (checagem rápida no cache + gravação), para a fila andar rápido no pico.
  var cache = CacheService.getScriptCache();
  var chave = 'pres_' + enc.id + '_' + pessoa.id;
  var lock = LockService.getScriptLock();
  lock.waitLock(28000);
  try {
    var recente = cache.get(chave);
    if (recente) return { ok: true, registrada: true, jaRegistrada: true, hora: recente, pessoa: quem, encontro: resumoEncontro_(enc) };
    var agora = new Date();
    aba_('Presencas').appendRow([Utilities.getUuid(), pessoa.id, enc.id, 'qr', 'proprio', '', agora, 'sim']);
    cache.put(chave, horaBR_(agora), 21600);
    return { ok: true, registrada: true, jaRegistrada: false, hora: horaBR_(agora), pessoa: quem, encontro: resumoEncontro_(enc) };
  } finally { lock.releaseLock(); }
}

function encontroValidoParaQr_(encontroId, codigo) {
  var enc = encontroPorId_(encontroId);
  if (!enc) return { erro: 'QR code inválido.' };
  if (enc.status !== 'aberto') return { erro: 'A chamada deste encontro não está aberta.' };
  if (!codigoQrValido_(enc.id, codigo)) return { erro: 'Este QR code expirou. Leia novamente o QR que está no telão.' };
  return enc;
}

function codigoQr_(encontroId, janela) {
  var sig = Utilities.computeHmacSha256Signature(encontroId + ':' + janela, segredo_('QR_SECRET'));
  return Utilities.base64EncodeWebSafe(sig).replace(/[^A-Za-z0-9]/g, '').substring(0, 10);
}
function janelaAtual_() { return Math.floor(Date.now() / 1000 / CFG.QR_JANELA_SEG); }
function codigoQrValido_(encontroId, codigo) {
  if (!codigo) return false;
  var j = janelaAtual_();
  for (var i = 0; i < CFG.QR_JANELAS_ACEITAS; i++) if (codigoQr_(encontroId, j - i) === String(codigo)) return true;
  return false;
}

// ===================== LOGIN DA EQUIPE =====================
function loginPedir_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  var membro = buscarEquipe_(email);
  // resposta igual para e-mail autorizado ou não (não revela quem está na equipe)
  var resposta = { ok: true, mensagem: 'Se este e-mail estiver autorizado, você receberá um código em instantes.' };
  if (!membro) { log_(email, 'login_negado', 'e-mail não autorizado'); return resposta; }
  var cache = CacheService.getScriptCache();
  var tentativas = Number(cache.get('envios_' + email) || 0);
  if (tentativas >= 5) return { ok: false, erro: 'Muitos pedidos de código. Aguarde alguns minutos.' };
  cache.put('envios_' + email, String(tentativas + 1), 900);
  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('login_' + email, JSON.stringify({ codigo: codigo, erros: 0 }), CFG.CODIGO_LOGIN_MIN * 60);
  MailApp.sendEmail({
    to: email,
    subject: 'Código de acesso – Presença Escola da Terra: ' + codigo,
    htmlBody: '<p>Olá' + (membro.nome ? ', ' + membro.nome : '') + '.</p><p>Seu código de acesso ao painel de presença do ' + CFG.NOME_PROGRAMA +
      ' é:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">' + codigo + '</p><p>Ele vale por ' + CFG.CODIGO_LOGIN_MIN +
      ' minutos. Se você não pediu este código, ignore esta mensagem.</p>'
  });
  log_(email, 'login_codigo_enviado', '');
  return resposta;
}

function loginValidar_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var raw = cache.get('login_' + email);
  if (!raw) return { ok: false, erro: 'Código expirado ou não solicitado. Peça um novo código.' };
  var dado = JSON.parse(raw);
  if (String(req.codigo || '').trim() !== dado.codigo) {
    dado.erros++;
    if (dado.erros >= 5) { cache.remove('login_' + email); return { ok: false, erro: 'Código incorreto várias vezes. Peça um novo código.' }; }
    cache.put('login_' + email, JSON.stringify(dado), CFG.CODIGO_LOGIN_MIN * 60);
    return { ok: false, erro: 'Código incorreto.' };
  }
  cache.remove('login_' + email);
  var membro = buscarEquipe_(email);
  if (!membro) return { ok: false, erro: 'E-mail não autorizado.' };
  var token = Utilities.getUuid() + '-' + Utilities.getUuid();
  var expira = new Date(Date.now() + CFG.SESSAO_DIAS * 86400000);
  aba_('Sessoes').appendRow([sha256_(token), email, expira, new Date()]);
  log_(email, 'login', '');
  return { ok: true, token: token, email: email, nome: membro.nome, expira: expira.toISOString() };
}

function sessao_(token) {
  if (!token) return null;
  var h = sha256_(token);
  var cache = CacheService.getScriptCache();
  var c = cache.get('sess_' + h);
  if (c) { var s = JSON.parse(c); var m = buscarEquipe_(s.email); return m ? { email: s.email, nome: m.nome } : null; }
  var linhas = dados_('Sessoes');
  for (var i = 0; i < linhas.length; i++) {
    if (linhas[i].token_hash === h && new Date(linhas[i].expira_em) > new Date()) {
      var membro = buscarEquipe_(linhas[i].email);
      if (!membro) return null;
      cache.put('sess_' + h, JSON.stringify({ email: linhas[i].email }), 600);
      return { email: linhas[i].email, nome: membro.nome };
    }
  }
  return null;
}

function sair_(req, u) {
  var sh = aba_('Sessoes'); var h = sha256_(req.token); var v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (v[i][0] === h) sh.deleteRow(i + 1);
  CacheService.getScriptCache().remove('sess_' + h);
  return { ok: true };
}

function buscarEquipe_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  var eq = dados_('Equipe');
  for (var i = 0; i < eq.length; i++) {
    if (String(eq[i].email).trim().toLowerCase() === email && /^(sim|s|ativo|true|x)$/i.test(String(eq[i].ativo).trim())) return eq[i];
  }
  return null;
}
function listarEquipe_() {
  return { ok: true, equipe: dados_('Equipe').map(function (m) { return { email: m.email, nome: m.nome, ativo: m.ativo }; }) };
}

// ===================== ENCONTROS =====================
function listarEncontros_() {
  var pres = dados_('Presencas').filter(function (p) { return p.ativo !== 'nao'; });
  var cont = {};
  pres.forEach(function (p) { cont[p.encontro_id] = (cont[p.encontro_id] || 0) + 1; });
  var lista = dados_('Encontros').map(function (e) { var r = resumoEncontro_(e); r.presentes = cont[e.id] || 0; return r; });
  lista.sort(function (a, b) { return String(a.data).localeCompare(String(b.data)) || Number(a.roca) - Number(b.roca); });
  return { ok: true, encontros: lista };
}

function salvarEncontro_(req, u) {
  var e = req.encontro || {};
  var roca = Number(e.roca), ch = Number(String(e.carga_horaria).replace(',', '.'));
  if (!(roca >= 1 && roca <= 6)) return { ok: false, erro: 'Informe a Roça (1 a 6).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.data || ''))) return { ok: false, erro: 'Informe a data.' };
  if (['TU', 'TC'].indexOf(e.tipo) < 0) return { ok: false, erro: 'Tipo deve ser TU ou TC.' };
  if (!(ch > 0 && ch <= 60)) return { ok: false, erro: 'Informe a carga horária em horas.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = aba_('Encontros');
    if (e.id) {
      var r = linhaPorId_('Encontros', e.id);
      if (!r) return { ok: false, erro: 'Encontro não encontrado.' };
      sh.getRange(r, 2, 1, 5).setValues([[roca, e.data, e.tipo, ch, e.descricao || '']]);
      log_(u.email, 'encontro_editar', e.id);
      return { ok: true, id: e.id };
    }
    var id = 'R' + roca + '-' + e.data + '-' + e.tipo + '-' + Utilities.getUuid().substring(0, 4);
    sh.appendRow([id, roca, e.data, e.tipo, ch, e.descricao || '', 'fechado', '', '']);
    log_(u.email, 'encontro_criar', id);
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}

function statusEncontro_(req, u) {
  var r = linhaPorId_('Encontros', req.encontro);
  if (!r) return { ok: false, erro: 'Encontro não encontrado.' };
  var novo = req.status === 'aberto' ? 'aberto' : 'fechado';
  var sh = aba_('Encontros');
  sh.getRange(r, 7).setValue(novo);
  sh.getRange(r, novo === 'aberto' ? 8 : 9).setValue(new Date());
  log_(u.email, 'chamada_' + novo, req.encontro);
  return { ok: true, status: novo };
}

function qrAtual_(req) {
  var enc = encontroPorId_(req.encontro);
  if (!enc) return { ok: false, erro: 'Encontro não encontrado.' };
  if (enc.status !== 'aberto') return { ok: false, erro: 'Abra a chamada para exibir o QR code.' };
  var j = janelaAtual_();
  var proxima = (j + 1) * CFG.QR_JANELA_SEG * 1000;
  var n = dados_('Presencas').filter(function (p) { return p.encontro_id === enc.id && p.ativo !== 'nao'; }).length;
  return { ok: true, codigo: codigoQr_(enc.id, j), muda_em_ms: proxima - Date.now(), encontro: resumoEncontro_(enc), presentes: n };
}

// ===================== PESSOAS =====================
function listarPessoas_() {
  return { ok: true, pessoas: dados_('Pessoas').map(publicaPessoa_) };
}

function atualizarPessoa_(req, u) {
  var r = linhaPorId_('Pessoas', req.id);
  if (!r) return { ok: false, erro: 'Pessoa não encontrada.' };
  var sh = aba_('Pessoas');
  if (req.nome !== undefined) sh.getRange(r, 4).setValue(String(req.nome).trim());
  if (req.tipo !== undefined) { if (['cursista', 'tutor'].indexOf(req.tipo) < 0) return { ok: false, erro: 'Tipo inválido.' }; sh.getRange(r, 7).setValue(req.tipo); }
  if (req.situacao !== undefined) sh.getRange(r, 8).setValue(req.situacao === 'inativo' ? 'inativo' : 'ativo');
  if (req.municipio !== undefined) sh.getRange(r, 5).setValue(String(req.municipio).trim());
  log_(u.email, 'pessoa_atualizar', req.id);
  return { ok: true };
}

function buscarCpf_(req) {
  var cpf = limparCpf_(req.cpf);
  if (!cpfValido_(cpf)) return { ok: false, erro: 'CPF inválido.' };
  var p = pessoaPorHash_(hashCpf_(cpf));
  return p ? { ok: true, pessoa: publicaPessoa_(p) } : { ok: false, erro: 'CPF não encontrado na lista.' };
}

/** linhas: [{cpf, codigo_ibge|municipio, tipo?, nome?}] — o CPF chega, é transformado e descartado. */
function importarPessoas_(req, u) {
  var linhas = req.linhas || [];
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var existentes = {};
    dados_('Pessoas').forEach(function (p) { existentes[p.cpf_hash] = true; });
    var novas = [], invalidos = 0, repetidos = 0;
    linhas.forEach(function (l) {
      var cpf = limparCpf_(l.cpf);
      if (!cpfValido_(cpf)) { invalidos++; return; }
      var h = hashCpf_(cpf);
      if (existentes[h]) { repetidos++; return; }
      existentes[h] = true;
      var ibge = String(l.codigo_ibge || '').trim();
      var mun = String(l.municipio || '').trim() || MUNICIPIOS_MS[ibge] || ibge;
      var tipo = l.tipo === 'tutor' ? 'tutor' : 'cursista';
      novas.push(['P' + Utilities.getUuid().substring(0, 8), mascararCpf_(cpf), h, String(l.nome || '').trim(), mun, ibge, tipo, 'ativo', new Date()]);
    });
    if (novas.length) aba_('Pessoas').getRange(aba_('Pessoas').getLastRow() + 1, 1, novas.length, novas[0].length).setValues(novas);
    CacheService.getScriptCache().remove('mapa_pessoas');
    log_(u.email, 'importar_pessoas', novas.length + ' novas; ' + repetidos + ' já existiam; ' + invalidos + ' CPFs inválidos');
    return { ok: true, novas: novas.length, repetidos: repetidos, invalidos: invalidos };
  } finally { lock.releaseLock(); }
}

/** linhas: [{cpf, nome}] — completa os nomes casando pelo CPF. */
function importarNomes_(req, u) {
  var linhas = req.linhas || [];
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = aba_('Pessoas'); var v = sh.getDataRange().getValues();
    var idx = {}; for (var i = 1; i < v.length; i++) idx[v[i][2]] = i;
    var ok = 0, nao = 0;
    linhas.forEach(function (l) {
      var cpf = limparCpf_(l.cpf); var nome = String(l.nome || '').trim();
      if (!cpfValido_(cpf) || !nome) { nao++; return; }
      var i = idx[hashCpf_(cpf)];
      if (i === undefined) { nao++; return; }
      v[i][3] = nome; ok++;
    });
    if (v.length > 1) sh.getRange(2, 4, v.length - 1, 1).setValues(v.slice(1).map(function (r) { return [r[3]]; }));
    CacheService.getScriptCache().remove('mapa_pessoas');
    log_(u.email, 'importar_nomes', ok + ' nomes; ' + nao + ' não encontrados');
    return { ok: true, atualizados: ok, nao_encontrados: nao };
  } finally { lock.releaseLock(); }
}

// ===================== PRESENÇAS (EQUIPE) =====================
function presencasEncontro_(req) {
  var pres = dados_('Presencas').filter(function (p) { return p.encontro_id === req.encontro && p.ativo !== 'nao'; });
  return { ok: true, presencas: pres.map(function (p) { return { id: p.id, pessoa_id: p.pessoa_id, forma: p.forma, registrado_por: p.registrado_por, motivo: p.motivo, hora: horaBR_(p.data_hora) }; }) };
}

function presencaManual_(req, u) {
  if (!String(req.motivo || '').trim()) return { ok: false, erro: 'Informe o motivo.' };
  req.pessoas = [req.pessoa_id]; req.forma = 'manual';
  return presencaLote_(req, u);
}

function presencaLote_(req, u) {
  var enc = encontroPorId_(req.encontro);
  if (!enc) return { ok: false, erro: 'Encontro não encontrado.' };
  var forma = ['manual', 'lista_fisica', 'tempo_comunidade', 'lote'].indexOf(req.forma) >= 0 ? req.forma : 'lote';
  var ids = req.pessoas || [];
  var validas = {}; dados_('Pessoas').forEach(function (p) { validas[p.id] = true; });
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var ja = {};
    dados_('Presencas').forEach(function (p) { if (p.encontro_id === enc.id && p.ativo !== 'nao') ja[p.pessoa_id] = true; });
    var agora = new Date(), novas = [], repetidas = 0;
    ids.forEach(function (id) {
      if (!validas[id]) return;
      if (ja[id]) { repetidas++; return; }
      ja[id] = true;
      novas.push([Utilities.getUuid(), id, enc.id, forma, u.email, String(req.motivo || '').trim(), agora, 'sim']);
    });
    if (novas.length) aba_('Presencas').getRange(aba_('Presencas').getLastRow() + 1, 1, novas.length, novas[0].length).setValues(novas);
    log_(u.email, 'presenca_' + forma, enc.id + ': ' + novas.length + ' registradas');
    return { ok: true, registradas: novas.length, ja_tinham: repetidas };
  } finally { lock.releaseLock(); }
}

function presencaRemover_(req, u) {
  if (!String(req.motivo || '').trim()) return { ok: false, erro: 'Informe o motivo da remoção.' };
  var r = linhaPorId_('Presencas', req.presenca);
  if (!r) return { ok: false, erro: 'Registro não encontrado.' };
  var sh = aba_('Presencas');
  sh.getRange(r, 8).setValue('nao');
  var linha = sh.getRange(r, 1, 1, 3).getValues()[0];
  CacheService.getScriptCache().remove('pres_' + linha[2] + '_' + linha[1]);
  log_(u.email, 'presenca_remover', req.presenca + ' – ' + req.motivo);
  return { ok: true };
}

// ===================== FREQUÊNCIA =====================
function frequencia_() {
  var encontros = dados_('Encontros');
  var hoje = Utilities.formatDate(new Date(), 'America/Campo_Grande', 'yyyy-MM-dd');
  var total = 0, ateAgora = 0, ch = {};
  encontros.forEach(function (e) {
    var h = Number(e.carga_horaria) || 0; ch[e.id] = h; total += h;
    if (dataIso_(e.data) <= hoje || e.status === 'fechado' && e.fechado_em) ateAgora += h;
  });
  var porPessoa = {};
  dados_('Presencas').forEach(function (p) {
    if (p.ativo === 'nao') return;
    porPessoa[p.pessoa_id] = porPessoa[p.pessoa_id] || {};
    porPessoa[p.pessoa_id][p.encontro_id] = true;
  });
  var permitidas = total * (1 - CFG.FREQ_MINIMA);
  var lista = dados_('Pessoas').map(function (p) {
    var pres = 0, enc = porPessoa[p.id] || {};
    Object.keys(enc).forEach(function (id) { pres += ch[id] || 0; });
    var faltas = Math.max(0, ateAgora - pres);
    var restante = permitidas - faltas;
    var sit = restante < 0 ? 'abaixo' : (restante <= CFG.RISCO_HORAS ? 'risco' : 'ok');
    var r = publicaPessoa_(p);
    r.horas_presentes = pres; r.horas_ate_agora = ateAgora; r.horas_total = total;
    r.pct_ate_agora = ateAgora ? Math.round(1000 * pres / ateAgora) / 10 : null;
    r.pct_curso = total ? Math.round(1000 * pres / total) / 10 : null;
    r.faltas_restantes_h = Math.round(restante * 10) / 10;
    r.situacao_freq = sit;
    r.encontros = Object.keys(enc);
    return r;
  });
  return { ok: true, total_horas: total, horas_ate_agora: ateAgora, minimo: CFG.FREQ_MINIMA, pessoas: lista, encontros: encontros.map(resumoEncontro_) };
}

// ===================== UTILITÁRIOS =====================
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function aba_(nome) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome); }
function dados_(nome) {
  var sh = aba_(nome); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(); var cab = v[0];
  return v.slice(1).filter(function (r) { return r[0] !== '' && r[0] !== null; }).map(function (r) {
    var o = {}; cab.forEach(function (c, i) { o[c] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return o;
  });
}
function linhaPorId_(nome, id) {
  if (!id) return 0;
  var v = aba_(nome).getRange(1, 1, Math.max(1, aba_(nome).getLastRow()), 1).getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return i + 1;
  return 0;
}
function encontroPorId_(id) {
  if (!id) return null;
  var l = dados_('Encontros'); for (var i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i];
  return null;
}
function resumoEncontro_(e) {
  return { id: e.id, roca: e.roca, data: dataIso_(e.data), tipo: e.tipo, carga_horaria: Number(e.carga_horaria) || 0, descricao: e.descricao, status: e.status };
}
function dataIso_(d) {
  if (!d) return '';
  var s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return Utilities.formatDate(new Date(d), 'America/Campo_Grande', 'yyyy-MM-dd');
}
function horaBR_(d) { return Utilities.formatDate(new Date(d), 'America/Campo_Grande', 'dd/MM/yyyy HH:mm'); }
function presencaExistente_(pessoaId, encontroId) {
  var l = dados_('Presencas');
  for (var i = 0; i < l.length; i++) if (l[i].pessoa_id === pessoaId && l[i].encontro_id === encontroId && l[i].ativo !== 'nao') return l[i];
  return null;
}
function pessoaPorHash_(h) {
  var cache = CacheService.getScriptCache();
  var mapa = cache.get('mapa_pessoas');
  var idx = mapa ? JSON.parse(mapa) : null;
  if (!idx) {
    idx = {}; dados_('Pessoas').forEach(function (p) { idx[p.cpf_hash] = p.id; });
    try { cache.put('mapa_pessoas', JSON.stringify(idx), 1800); } catch (e) {}
  }
  if (!idx[h]) return null;
  var l = dados_('Pessoas'); for (var i = 0; i < l.length; i++) if (l[i].id === idx[h]) return l[i];
  return null;
}
function publicaPessoa_(p) {
  return { id: p.id, nome: p.nome, cpf: p.cpf_mascarado, municipio: p.municipio, tipo: p.tipo, situacao: p.situacao };
}
function exibirNome_(nome) {
  nome = String(nome || '').trim(); if (!nome) return '';
  var partes = nome.split(/\s+/);
  return partes.length > 1 ? partes[0] + ' ' + partes[partes.length - 1].charAt(0) + '.' : partes[0];
}
function limparCpf_(c) { return String(c || '').replace(/\D/g, '').padStart(11, '0').slice(-11); }
function cpfValido_(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (var t = 9; t < 11; t++) {
    var s = 0; for (var i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
function mascararCpf_(c) { return '***.' + c.substr(3, 3) + '.' + c.substr(6, 3) + '-**'; }
function hashCpf_(cpf) {
  var sig = Utilities.computeHmacSha256Signature(cpf, segredo_('CPF_PEPPER'));
  return 'h:' + Utilities.base64EncodeWebSafe(sig);
}
function sha256_(s) { return 's:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s))); }
function segredo_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Sistema não instalado: rode a função setup() no editor.');
  return v;
}
function log_(email, acao, detalhe) {
  try { aba_('Log').appendRow([new Date(), email || '', acao, detalhe || '']); } catch (e) {}
}
