// Simulador mínimo dos serviços do Google Apps Script, para testar apps-script/Code.gs no Node.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function criarAmbiente() {
  const abas = {};
  const enviados = [];
  let relogio = null; // permite "avançar o tempo" nos testes
  const agora = () => (relogio === null ? Date.now() : relogio);

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); o.push(row); } return o; }
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
    setValue(x) { this.sh.set(this.r, this.c, x); return this; }
    setFontWeight() { return this; }
  }
  class Sheet {
    constructor(nome) { this.nome = nome; this.linhas = []; }
    conv(x) { // a planilha transforma "aaaa-mm-dd" em data, como o Google Sheets
      if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) return new Date(x + 'T04:00:00Z');
      if (typeof x === 'string' && /^\d+$/.test(x) && x.length < 16) return Number(x);
      return x;
    }
    get(r, c) { const row = this.linhas[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
    set(r, c, x) { while (this.linhas.length < r) this.linhas.push([]); this.linhas[r - 1][c - 1] = this.conv(x); }
    appendRow(row) { this.linhas.push(row.map(x => this.conv(x))); }
    getLastRow() { return this.linhas.length; }
    getLastColumn() { return Math.max(0, ...this.linhas.map(r => r.length)); }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
    deleteRow(r) { this.linhas.splice(r - 1, 1); }
    setFrozenRows() {}
  }
  const ss = {
    getSheetByName: n => abas[n] || null,
    insertSheet: n => (abas[n] = new Sheet(n)),
    getSheets: () => Object.values(abas),
    deleteSheet: s => delete abas[s.nome]
  };
  const cacheMap = new Map();
  const props = {};
  const b64ws = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const toBytes = b => Buffer.from(b.map(x => (x + 256) % 256));
  const sign = buf => Array.from(buf).map(x => (x > 127 ? x - 256 : x));

  const contexto = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = cacheMap.get(k); return e && e.exp > agora() ? e.v : null; },
      put: (k, v, s) => { if (String(v).length > 100000) throw new Error('cache: valor grande demais'); cacheMap.set(k, { v: String(v), exp: agora() + (s || 600) * 1000 }); },
      remove: k => cacheMap.delete(k)
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (v, k) => sign(crypto.createHmac('sha256', k).update(v).digest()),
      computeDigest: (_a, v) => sign(crypto.createHash('sha256').update(v).digest()),
      base64EncodeWebSafe: b => b64ws(toBytes(b)),
      DigestAlgorithm: { SHA_256: 'sha256' },
      formatDate: (d, tz, f) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Campo_Grande', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
        const g = t => p.find(x => x.type === t).value;
        return f.replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day')).replace('HH', g('hour').replace('24', '00')).replace('mm', g('minute'));
      }
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'admin@teste.br' }) },
    MailApp: { sendEmail: m => enviados.push(m) },
    ContentService: { createTextOutput: t => ({ texto: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } }
  };
  // Date.now controlável
  const DateReal = Date;
  class DataSim extends DateReal { constructor(...a) { if (a.length === 0) super(agora()); else super(...a); } static now() { return agora(); } }
  contexto.Date = DataSim;
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), contexto);
  const post = corpo => JSON.parse(contexto.doPost({ postData: { contents: JSON.stringify(corpo) } }).texto);
  return { ctx: contexto, abas, enviados, post, setRelogio: t => { relogio = t; }, agora };
}
module.exports = { criarAmbiente };
