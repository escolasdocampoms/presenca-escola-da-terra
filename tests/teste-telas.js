// Teste das telas no navegador (Playwright) com o backend simulado.
// Rode: node tests/teste-telas.js [pasta-para-capturas]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarAmbiente } = require('./gas-mock');

const RAIZ = path.join(__dirname, '..');
const SAIDA = process.argv[2] || path.join(require('os').tmpdir(), 'capturas-presenca');
fs.mkdirSync(SAIDA, { recursive: true });
const A = criarAmbiente();
A.ctx.setup();

function gerarCpf(n) {
  const d = String(100000000 + n * 7919).slice(-9).split('').map(Number);
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i); d.push(((s * 10) % 11) % 10); }
  return d.join('');
}
const cpfs = Array.from({ length: 30 }, (_, i) => gerarCpf(i + 1));
const csv = 'CPF_CURSISTA;EMAIL;UF;CODIGO_IBGE;CPF_COORDENADOR\n' + cpfs.map((c, i) => `${c};x${i}@ex.com;MS;${['5007901', '5008008', '5000708'][i % 3]};;`).join('\n');
const arqCsv = path.join(SAIDA, 'ficticio.csv'); fs.writeFileSync(arqCsv, csv);

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const out = A.ctx.doPost({ postData: { contents: b } }).texto;
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out);
    }); return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/assets/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end("window.API_URL='/api';"); }
  const f = path.join(RAIZ, p);
  if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => srv.listen(8765, r));
  const base = 'http://localhost:8765/';
  const b = await chromium.launch();
  const erros = [];
  const pc = await b.newPage({ viewport: { width: 1280, height: 860 } });
  pc.on('pageerror', e => erros.push('equipe: ' + e.message));
  pc.on('dialog', d => d.type() === 'prompt' ? d.accept('teste') : d.accept());

  // login
  await pc.goto(base + 'equipe.html');
  await pc.fill('#email', 'admin@teste.br'); await pc.click('#fEmail button');
  await pc.waitForSelector('#fCodigo:not(.oculto)');
  const codigo = A.enviados.at(-1).subject.match(/(\d{6})$/)[1];
  await pc.fill('#codigo', codigo); await pc.click('#fCodigo button[type=submit]');
  await pc.waitForSelector('#app:not(.oculto)');
  // importar
  await pc.click('[data-aba=importar]');
  await pc.setInputFiles('#arqPessoas', arqCsv); await pc.click('#btImpPessoas');
  await pc.waitForFunction(() => document.querySelector('#msg').textContent.includes('importada'));
  await pc.fill('#txtNomes', `${cpfs[0]};Maria da Silva Souza\n${cpfs[1]};João Pereira\n${cpfs[2]};Ana Lima`);
  await pc.click('#btImpNomes'); await pc.waitForFunction(() => document.querySelector('#msg').textContent.includes('nome(s)'));
  // encontro
  await pc.click('[data-aba=encontros]');
  const hoje = new Date().toISOString().slice(0, 10);
  await pc.selectOption('#encRoca', '1'); await pc.fill('#encData', hoje); await pc.fill('#encCH', '8'); await pc.fill('#encDesc', 'Abertura');
  await pc.click('#fEncontro button[type=submit]'); await pc.waitForFunction(() => document.querySelectorAll('#tbEncontros tr').length === 1);
  await pc.screenshot({ path: path.join(SAIDA, '1-encontros.png'), fullPage: true });
  // chamada
  await pc.click('[data-aba=chamada]'); await pc.click('#btAbrir');
  await pc.waitForSelector('#btFechar:not(.oculto)');
  await pc.click('#btTelao'); await pc.waitForSelector('#telaoQr svg');
  await pc.screenshot({ path: path.join(SAIDA, '2-telao.png') });
  const encId = await pc.$eval('#selEncontro', s => s.value);
  const qrCodigo = A.post({ acao: 'qr', token: await pc.evaluate(() => localStorage.getItem('et_token')), encontro: encId }).codigo;
  await pc.click('#btSairTelao');

  // celular
  const cel = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
  cel.on('pageerror', e => erros.push('cursista: ' + e.message));
  await cel.goto(base + `index.html?e=${encodeURIComponent(encId)}&c=${qrCodigo}`);
  await cel.waitForSelector('#passoCpf:not(.oculto)');
  await cel.screenshot({ path: path.join(SAIDA, '3-celular-cpf.png') });
  await cel.type('#cpf', cpfs[0]); await cel.click('#btContinuar');
  await cel.waitForSelector('#passoConfirmar:not(.oculto)');
  await cel.screenshot({ path: path.join(SAIDA, '4-celular-confirmar.png') });
  await cel.click('#btConfirmar'); await cel.waitForSelector('#passoOk:not(.oculto)');
  await cel.screenshot({ path: path.join(SAIDA, '5-celular-ok.png') });
  // QR inválido
  await cel.goto(base + `index.html?e=${encodeURIComponent(encId)}&c=velho`); await cel.waitForSelector('#erro:not(.oculto)');
  const msgVelho = await cel.textContent('#erro');

  // manual + lote
  await pc.click('#btRecarregar'); await pc.waitForTimeout(300);
  await pc.click('#tbChamada button.ok'); await pc.click('#dlgManual button[value=ok]');
  await pc.waitForFunction(() => document.querySelector('#msg').textContent.includes('Presença confirmada'));
  const marcas = await pc.$$('.marca'); for (const m of marcas.slice(0, 5)) await m.check();
  await pc.click('#btLote'); await pc.waitForFunction(() => document.querySelector('#msg').textContent.includes('registrada'));
  await pc.screenshot({ path: path.join(SAIDA, '6-chamada.png'), fullPage: true });
  // lista física
  const [lista] = await Promise.all([pc.waitForEvent('popup'), pc.click('#btImprimir')]);
  await lista.waitForLoadState(); await lista.screenshot({ path: path.join(SAIDA, '7-lista-fisica.png') });
  // frequência
  await pc.click('[data-aba=frequencia]'); await pc.waitForSelector('#tbFreq tr');
  await pc.screenshot({ path: path.join(SAIDA, '8-frequencia.png'), fullPage: true });
  const pres = A.post({ acao: 'presencas', token: await pc.evaluate(() => localStorage.getItem('et_token')), encontro: encId }).presencas;

  console.log('presenças registradas:', pres.length, '(esperado 7: 1 QR + 1 manual + 5 lote)');
  console.log('QR velho:', msgVelho.trim());
  console.log('erros de JavaScript:', erros.length ? erros : 'nenhum');
  console.log('capturas em', SAIDA);
  await b.close(); srv.close();
  process.exit(pres.length === 7 && !erros.length ? 0 : 1);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
