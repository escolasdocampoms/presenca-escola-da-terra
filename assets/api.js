// Chamada ao Apps Script. Usa text/plain para o navegador não bloquear a requisição (CORS)
// e tenta de novo quando o Google está ocupado (pico de acessos).
async function api(acao, dados = {}, tentativas = 4) {
  if (!window.API_URL || window.API_URL.startsWith('COLE_AQUI')) {
    throw new Error('Sistema ainda não configurado (endereço do Apps Script ausente).');
  }
  const corpo = JSON.stringify({ acao, ...dados });
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(window.API_URL, { method: 'POST', body: corpo, redirect: 'follow' });
      const texto = await resp.text();
      let json;
      try { json = JSON.parse(texto); } catch (e) { throw new Error('Resposta inesperada do servidor.'); }
      if (!json.ok && /Erro no servidor|simultaneous|Service invoked too many|Lock/i.test(json.erro || '')) {
        throw new Error(json.erro);
      }
      return json;
    } catch (e) {
      ultimoErro = e;
      if (i < tentativas - 1) await new Promise(r => setTimeout(r, 1200 * (i + 1) + Math.random() * 800));
    }
  }
  throw new Error('Não foi possível falar com o servidor. Verifique a internet e tente de novo. (' + (ultimoErro && ultimoErro.message) + ')');
}

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) n.append(f.nodeType ? f : String(f));
  return n;
}

const TIPOS_ENCONTRO = { TU: 'Tempo Universidade', TC: 'Tempo Escola-Comunidade' };
function dataBR(iso) { if (!iso) return ''; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; }
function tituloEncontro(e) { return `Roça ${e.roca} · ${dataBR(e.data)} · ${TIPOS_ENCONTRO[e.tipo] || e.tipo}`; }
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function mascaraCpfDigitando(v) {
  const d = soDigitos(v).slice(0, 11);
  let s = d.slice(0, 3);
  if (d.length > 3) s += '.' + d.slice(3, 6);
  if (d.length > 6) s += '.' + d.slice(6, 9);
  if (d.length > 9) s += '-' + d.slice(9, 11);
  return s;
}
