// Ficha de EPI — app local (dados no localStorage do navegador)
'use strict';

const CHAVE = 'fichaEpi.fichas';
const CHAVE_EMPRESA = 'fichaEpi.ultimaEmpresa';
const LINHAS_MINIMAS = 8; // linhas na tabela impressa (sobram em branco para entregas futuras)

const TERMO_PADRAO = `TERMO DE RESPONSABILIDADE — NR-06 (Equipamento de Proteção Individual)

Declaro ter recebido gratuitamente da empresa os Equipamentos de Proteção Individual (EPI) relacionados nesta ficha, em perfeito estado de conservação e funcionamento, adequados aos riscos da minha atividade, bem como orientação e treinamento sobre o seu uso adequado, guarda e conservação.

Conforme a NR-06, cabe ao empregado, quanto ao EPI:
a) usar o EPI apenas para a finalidade a que se destina;
b) responsabilizar-se pela limpeza, guarda e conservação;
c) comunicar à organização quando extraviado, danificado ou qualquer alteração que o torne impróprio para uso; e
d) cumprir as determinações da organização sobre o uso adequado.

Cabe à organização, entre outras obrigações: fornecer o EPI adequado ao risco e com Certificado de Aprovação (CA), orientar e treinar o empregado, exigir o seu uso, substituí-lo imediatamente quando danificado ou extraviado e registrar o seu fornecimento.

Comprometo-me a utilizar os EPI durante toda a jornada de trabalho, sempre que exigido, e a devolvê-los quando solicitado ou em caso de desligamento. Estou ciente de que a recusa injustificada ao uso do EPI fornecido constitui ato faltoso, nos termos do art. 158, parágrafo único, alínea "b", da CLT, sujeito às penalidades previstas em lei.`;

// ---------- utilitários ----------
const $ = (s, el = document) => el.querySelector(s);
const app = document.getElementById('app');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function hoje() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
function dataHoraBR(isoCompleto) {
  const d = new Date(isoCompleto);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
function mascararCnpj(v) {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
function cnpjValido(v) {
  const n = v.replace(/\D/g, '');
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const dv = (base) => {
    let soma = 0, peso = base.length - 7;
    for (const c of base) { soma += Number(c) * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(n.slice(0, 12));
  return n.endsWith(`${d1}${dv(n.slice(0, 12) + d1)}`);
}
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('mostrar');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('mostrar'), 2400);
}

/** Reduz a imagem para no máximo 400 px e devolve como data URL. */
function lerLogo(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 400 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      ok(cv.toDataURL('image/png'));
    };
    img.onerror = () => falha(new Error('Imagem inválida'));
    img.src = URL.createObjectURL(arquivo);
  });
}

// ---------- armazenamento ----------
const lerFichas = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { return []; } };
function gravarFichas(lista) {
  try { localStorage.setItem(CHAVE, JSON.stringify(lista)); return true; }
  catch { toast('Espaço do navegador cheio. Faça um backup e remova fichas antigas.'); return false; }
}

const itemVazio = () => ({ uid: novoId(), epi: '', descricao: '', ca: '', qtd: 1, entrega: hoje(), recebimento: '' });

function mascararCpf(v) {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
function cpfValido(v) {
  const n = v.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  const dv = (t) => {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(n[i]) * (t + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(n[9]) && dv(10) === Number(n[10]);
}
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/** Fichas antigas: garante os campos novos (uid dos itens, lista de assinaturas). */
function completarFicha(f) {
  f.cpf = f.cpf || '';
  f.assinaturas = f.assinaturas || [];
  f.itens.forEach((i) => { if (!i.uid) i.uid = novoId(); });
  return f;
}
const assinaturaDoItem = (f, it) => it.assinaturaId && f.assinaturas.find((a) => a.id === it.assinaturaId);
const itensSemAssinatura = (f) => f.itens.filter((i) => !i.assinaturaId && i.epi.trim());
function fichaNova() {
  let emp = {};
  try { emp = JSON.parse(localStorage.getItem(CHAVE_EMPRESA)) || {}; } catch { /* ignora */ }
  return { id: null, colaborador: '', funcao: '', data: hoje(), empresaNome: emp.nome || '', empresaCnpj: emp.cnpj || '',
    empresaLogo: emp.logo || '', itens: [itemVazio()], termo: TERMO_PADRAO, obs: '', cpf: '', assinaturas: [] };
}

// ---------- rotas ----------
function rotear() {
  const h = location.hash.replace(/^#\/?/, '');
  const [rota, id] = h.split('/');
  let ativo = 'lista';
  if (rota === 'nova') { ativo = 'nova'; telaEditor(fichaNova()); }
  else if (rota === 'ficha' || rota === 'assinar') {
    const f = lerFichas().find((x) => x.id === decodeURIComponent(id || ''));
    if (!f) { location.hash = '#/'; return; }
    completarFicha(f);
    if (rota === 'ficha') telaEditor(f); else telaAssinar(f);
  }
  else if (rota === 'backup') { ativo = 'backup'; telaBackup(); }
  else telaLista();
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === ativo));
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', rotear);

// ---------- tela: lista ----------
function telaLista() {
  app.innerHTML = `
    <div class="saudacao">
      <div><h1>Fichas de EPI</h1><p class="data">Controle de entrega de EPI aos colaboradores</p></div>
      <a class="btn amarelo" href="#/nova">＋ Nova ficha</a>
    </div>
    <input type="search" id="busca" placeholder="Buscar por colaborador, função, empresa ou EPI">
    <p class="contagem" id="contagem"></p>
    <div class="lista" id="lista"></div>`;
  const busca = $('#busca');
  busca.addEventListener('input', () => desenharLista(busca.value));
  desenharLista('');
}

function desenharLista(termo) {
  const q = termo.trim().toLowerCase();
  const todas = lerFichas();
  const fichas = todas
    .filter((f) => !q || [f.colaborador, f.funcao, f.empresaNome, ...f.itens.map((i) => i.epi)]
      .some((t) => (t || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.atualizadoEm || '').localeCompare(a.atualizadoEm || ''));

  $('#contagem').textContent = todas.length
    ? `${fichas.length} de ${todas.length} ficha${todas.length === 1 ? '' : 's'}` : '';
  $('#lista').innerHTML = fichas.length
    ? fichas.map((f) => {
        completarFicha(f);
        const pend = f.itens.filter((i) => !i.recebimento && !i.assinaturaId).length;
        const assinada = f.assinaturas.length > 0 && f.itens.every((i) => i.assinaturaId);
        return `<a class="item" href="#/ficha/${encodeURIComponent(f.id)}">
          <h3>${esc(f.colaborador)}</h3>
          <div class="selos">
            ${f.funcao ? `<span class="selo">${esc(f.funcao)}</span>` : ''}
            ${f.empresaNome ? `<span class="selo nr">${esc(f.empresaNome)}</span>` : ''}
            <span class="selo">${dataBR(f.data)}</span>
            ${pend ? `<span class="selo pendente">${pend} aguardando assinatura</span>`
              : assinada ? '<span class="selo feito">✍️ assinada</span>' : '<span class="selo feito">✓ recebido</span>'}
          </div>
          <p>${f.itens.map((i) => esc(i.epi)).join(' · ')}</p>
        </a>`;
      }).join('')
    : `<div class="cartao vazio">${q ? 'Nenhuma ficha encontrada.' : 'Nenhuma ficha cadastrada.<br><br><a class="btn amarelo" href="#/nova">＋ Criar a primeira ficha</a>'}</div>`;
}

// ---------- tela: editor ----------
let atual = null; // ficha em edição

function telaEditor(ficha) {
  atual = structuredClone(ficha);
  app.innerHTML = `
    <a href="#/" class="voltar">← Fichas</a>
    <div class="saudacao">
      <div><h1 id="titulo">${atual.id ? esc(atual.colaborador) : 'Nova ficha'}</h1>
      <p class="data">Ficha de controle de entrega de EPI — NR-06</p></div>
    </div>

    <form id="form" novalidate>
      <section class="cartao">
        <h2>Colaborador</h2>
        <div class="grade">
          <label>Nome do colaborador <input type="text" name="colaborador" maxlength="120" autocomplete="off"></label>
          <label>Data da ficha <input type="date" name="data"></label>
          <label>Função <input type="text" name="funcao" maxlength="120"></label>
          <label>CPF <input type="text" name="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"></label>
        </div>
      </section>

      <section class="cartao">
        <h2>Empresa <span class="dica">— opcional, aparece no cabeçalho da ficha</span></h2>
        <div class="grade">
          <label>Empresa <input type="text" name="empresaNome" maxlength="120" placeholder="Razão social ou nome da empresa"></label>
          <label>CNPJ <input type="text" name="empresaCnpj" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00"></label>
          <div class="inteira">
            <label style="margin-bottom:0">Logo</label>
            <div class="logo-linha">
              <div id="logoPrevia" class="logo-previa"></div>
              <label class="btn sec peq" style="margin:0"><span id="txtLogo"></span>
                <input type="file" id="arqLogo" accept="image/png,image/jpeg,image/webp" hidden></label>
              <button type="button" class="btn perigo peq" id="btnRemoverLogo">Remover</button>
            </div>
          </div>
        </div>
      </section>

      <section class="cartao">
        <div class="cartao-topo">
          <h2>EPIs entregues</h2>
          <button type="button" class="btn sec peq" id="btnAddItem">＋ Adicionar EPI</button>
        </div>
        <div class="rolagem">
          <table class="tabela itens">
            <thead><tr>
              <th class="c-qtd">Qtd.</th><th class="c-ca">Nº do CA</th><th>EPI</th><th>Descrição</th>
              <th class="c-dt">Entrega</th><th class="c-dt">Recebimento</th><th class="c-x"></th>
            </tr></thead>
            <tbody id="itens"></tbody>
          </table>
        </div>
      </section>

      <section class="cartao">
        <div class="cartao-topo">
          <h2>Assinatura do colaborador</h2>
          <button type="button" class="btn amarelo peq" id="btnAssinar">✍️ Coletar assinatura</button>
        </div>
        <div id="assinaturas"></div>
      </section>

      <section class="cartao">
        <div class="cartao-topo">
          <h2>Termo de responsabilidade — NR-06</h2>
          <button type="button" class="btn sec peq" id="btnTermoPadrao">Restaurar padrão</button>
        </div>
        <div class="campanha">
          <strong>Revise antes de usar</strong>
          <span>Texto de apoio com base na NR-06 e no art. 158 da CLT. Confira com a redação vigente da norma.</span>
        </div>
        <label><textarea class="termo" name="termo" rows="14"></textarea></label>
        <label>Observações <textarea name="obs" rows="2" maxlength="500"></textarea></label>
      </section>

      <p id="erro" class="erro" hidden></p>
      <div class="barra">
        <button class="btn" type="submit">Salvar ficha</button>
        <button class="btn amarelo" type="button" id="btnImprimir">🖨️ Imprimir</button>
        ${atual.id ? '<button class="btn perigo" type="button" id="btnExcluir">Excluir</button>' : ''}
      </div>
    </form>`;

  const form = $('#form');
  for (const k of CAMPOS) form.elements[k].value = atual[k] || '';
  desenharLogo();
  desenharItens();
  desenharAssinaturas();
  form.elements.cpf.addEventListener('input', (e) => { e.target.value = mascararCpf(e.target.value); });
  $('#btnAssinar').addEventListener('click', () => {
    if (!salvar()) return;
    if (!itensSemAssinatura(atual).length) { toast('Todos os EPIs desta ficha já estão assinados.'); return; }
    location.hash = `#/assinar/${encodeURIComponent(atual.id)}`;
  });
  if (!baseCa) carregarBaseCa().then((b) => { if (b) atualizarInfosCa(); });

  form.addEventListener('submit', (e) => { e.preventDefault(); if (salvar()) toast('Ficha salva ✓'); });
  form.elements.empresaCnpj.addEventListener('input', (e) => { e.target.value = mascararCnpj(e.target.value); });
  $('#btnAddItem').addEventListener('click', () => { atual.itens.push(itemVazio()); desenharItens(); });
  $('#btnTermoPadrao').addEventListener('click', () => { form.elements.termo.value = TERMO_PADRAO; toast('Texto padrão restaurado'); });
  $('#btnImprimir').addEventListener('click', () => { if (salvar()) imprimir(atual); });
  $('#btnExcluir')?.addEventListener('click', () => {
    if (!confirm(`Excluir a ficha de ${atual.colaborador}? Essa ação não pode ser desfeita.`)) return;
    gravarFichas(lerFichas().filter((f) => f.id !== atual.id));
    toast('Ficha excluída');
    location.hash = '#/';
  });
  $('#arqLogo').addEventListener('change', async (e) => {
    const arq = e.target.files[0];
    e.target.value = '';
    if (!arq) return;
    try { atual.empresaLogo = await lerLogo(arq); desenharLogo(); }
    catch { toast('Não foi possível ler a imagem. Use PNG ou JPG.'); }
  });
  $('#btnRemoverLogo').addEventListener('click', () => { atual.empresaLogo = ''; desenharLogo(); });
}

function desenharLogo() {
  const tem = Boolean(atual.empresaLogo);
  $('#logoPrevia').innerHTML = tem ? `<img src="${atual.empresaLogo}" alt="Logo">` : 'sem logo';
  $('#logoPrevia').classList.toggle('com-logo', tem);
  $('#txtLogo').textContent = tem ? 'Trocar imagem' : 'Escolher imagem';
  $('#btnRemoverLogo').hidden = !tem;
}

// ---------- assinaturas ----------
const formatarCodigo = (hex) => hex.slice(0, 16).toUpperCase().match(/.{4}/g).join('-');

/** Código de verificação: resumo (SHA-256) do que foi assinado. Se algo mudar, o código não confere mais. */
async function codigoAssinatura(f, itens, em, cpf, imagem) {
  const conteudo = JSON.stringify({
    colaborador: f.colaborador, cpf: soDigitos(cpf), empresaCnpj: soDigitos(f.empresaCnpj), termo: f.termo, em,
    itens: itens.map((i) => [i.qtd, i.ca, i.epi, i.descricao, i.entrega, i.recebimento]), imagem,
  });
  const dados = new TextEncoder().encode(conteudo);
  if (crypto.subtle) {
    const h = await crypto.subtle.digest('SHA-256', dados);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5; // sem crypto.subtle (navegador antigo): resumo simples
  for (const b of dados) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0').repeat(2);
}

function desenharAssinaturas() {
  const box = $('#assinaturas');
  if (!box) return;
  const pend = itensSemAssinatura(atual).length;
  box.innerHTML = (atual.assinaturas.length
    ? atual.assinaturas.map((a) => {
        const n = atual.itens.filter((i) => i.assinaturaId === a.id).length;
        return `<div class="assinatura">
          <img src="${a.imagem}" alt="Assinatura">
          <div>
            <b>${esc(a.nome)}</b> · CPF ${esc(a.cpf)}<br>
            Assinado em ${dataHoraBR(a.em)} · ${n} EPI${n === 1 ? '' : 's'}<br>
            <small>Código de verificação: ${formatarCodigo(a.codigo)}</small>
          </div>
          <button type="button" class="btn perigo peq" data-remover="${a.id}">Remover</button>
        </div>`;
      }).join('')
    : '<p class="dica" style="margin:0 0 4px">Nenhuma assinatura ainda. Entregue o celular ou tablet ao colaborador e clique em “Coletar assinatura”.</p>')
    + (atual.assinaturas.length && pend ? `<p class="dica">${pend} EPI${pend === 1 ? '' : 's'} ainda sem assinatura.</p>` : '');
  $('#btnAssinar').hidden = atual.assinaturas.length > 0 && !pend;

  box.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remover esta assinatura? Os EPIs dela voltam a ficar editáveis e precisarão ser assinados de novo.')) return;
    atual.assinaturas = atual.assinaturas.filter((a) => a.id !== b.dataset.remover);
    atual.itens.forEach((i) => { if (i.assinaturaId === b.dataset.remover) delete i.assinaturaId; });
    if (salvar()) toast('Assinatura removida');
  }));

  // Depois de assinada, nome, CPF e termo ficam fixos (fazem parte do que foi assinado)
  const travar = atual.assinaturas.length > 0;
  for (const k of ['colaborador', 'cpf', 'termo']) $('#form').elements[k].readOnly = travar;
  $('#btnTermoPadrao').hidden = travar;
}

let assinando = null; // ficha na tela de assinatura

function telaAssinar(f) {
  const itens = itensSemAssinatura(f);
  if (!itens.length) { location.hash = `#/ficha/${encodeURIComponent(f.id)}`; return; }
  assinando = f;
  app.innerHTML = `
    <a href="#/ficha/${encodeURIComponent(f.id)}" class="voltar">← Voltar para a ficha</a>
    <div class="saudacao"><div><h1>Assinatura do recebimento de EPI</h1>
      <p class="data">${esc(f.colaborador)}${f.funcao ? ` · ${esc(f.funcao)}` : ''}${f.empresaNome ? ` · ${esc(f.empresaNome)}` : ''}</p></div></div>

    <section class="cartao">
      <h2>EPIs que você está recebendo</h2>
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Qtd.</th><th>EPI</th><th>CA</th><th>Entrega</th></tr></thead>
        <tbody>${itens.map((i) => `<tr><td>${esc(i.qtd)}</td><td>${esc(i.epi)}${i.descricao ? `<br><small class="dica">${esc(i.descricao)}</small>` : ''}</td>
          <td>${esc(i.ca)}</td><td>${dataBR(i.entrega)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section class="cartao">
      <h2>Termo de responsabilidade</h2>
      <div class="termo-leitura">${esc(f.termo)}</div>
      <label class="concordo"><input type="checkbox" id="concordo"> Li o termo acima, recebi os EPIs listados e me comprometo a usá-los e conservá-los.</label>
    </section>

    <section class="cartao">
      <h2>Sua assinatura</h2>
      <label>Seu CPF <input type="text" id="cpfAssinante" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"></label>
      <span class="rotulo-pad">Assine no quadro abaixo com o dedo ou a caneta</span>
      <div class="pad"><canvas id="pad"></canvas><span class="pad-linha"></span><span class="pad-dica" id="padDica">Assine aqui</span></div>
      <div class="barra" style="margin-bottom:0"><button type="button" class="btn sec peq" id="btnLimpar">Limpar</button></div>
      <p id="erro" class="erro" hidden></p>
    </section>

    <div class="barra">
      <button type="button" class="btn verde" id="btnConfirmar">✓ Confirmar assinatura</button>
      <a class="btn sec" href="#/ficha/${encodeURIComponent(f.id)}">Cancelar</a>
    </div>`;

  $('#cpfAssinante').addEventListener('input', (e) => { e.target.value = mascararCpf(e.target.value); });
  const pad = criarPad($('#pad'), () => { $('#padDica').hidden = true; });
  $('#btnLimpar').addEventListener('click', () => { pad.limpar(); $('#padDica').hidden = false; });
  $('#btnConfirmar').addEventListener('click', () => confirmarAssinatura(pad, itens));
}

/** Quadro de assinatura: funciona com mouse, dedo e caneta (pointer events). */
function criarPad(canvas, aoDesenhar) {
  const ctx = canvas.getContext('2d');
  let tracos = 0, desenhando = false, ultimo = null;
  function ajustar() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4d';
    tracos = 0;
  }
  ajustar();
  const ponto = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || 0.5 }; };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    desenhando = true; ultimo = ponto(e);
    ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = '#0b1f4d'; ctx.fill();
    tracos++; aoDesenhar();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!desenhando) return;
    const p = ponto(e);
    ctx.lineWidth = e.pointerType === 'pen' ? 1.2 + p.p * 2.4 : 2.4;
    ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ultimo = p;
  });
  const parar = () => { desenhando = false; };
  canvas.addEventListener('pointerup', parar);
  canvas.addEventListener('pointercancel', parar);
  return {
    vazio: () => tracos === 0,
    limpar: ajustar,
    /** Imagem PNG recortada só na área assinada, com fundo transparente. */
    imagem() {
      const { width: w, height: h } = canvas;
      const px = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const m = 8, cw = x1 - x0 + m * 2, ch = y1 - y0 + m * 2;
      const escala = Math.min(1, 500 / cw, 180 / ch);
      const out = document.createElement('canvas');
      out.width = Math.round(cw * escala); out.height = Math.round(ch * escala);
      out.getContext('2d').drawImage(canvas, x0 - m, y0 - m, cw, ch, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}

async function confirmarAssinatura(pad, itens) {
  const f = assinando;
  const cpf = $('#cpfAssinante').value.trim();
  const erro = (msg) => { $('#erro').textContent = msg; $('#erro').hidden = false; };
  if (!$('#concordo').checked) return erro('Marque que você leu o termo e recebeu os EPIs.');
  if (!cpfValido(cpf)) return erro('CPF inválido. Confira os números.');
  if (f.cpf && soDigitos(f.cpf) !== soDigitos(cpf)) return erro('O CPF não confere com o cadastrado na ficha.');
  if (pad.vazio()) return erro('Faça sua assinatura no quadro.');
  $('#erro').hidden = true;
  $('#btnConfirmar').disabled = true;

  const em = new Date().toISOString();
  const dia = hoje();
  // A assinatura confirma o recebimento: preenche a data de recebimento que estiver vazia
  for (const i of itens) if (!i.recebimento) i.recebimento = dia;
  const imagem = pad.imagem();
  const a = { id: novoId(), em, nome: f.colaborador, cpf: mascararCpf(cpf), imagem,
    codigo: await codigoAssinatura(f, itens, em, cpf, imagem) };
  f.assinaturas.push(a);
  for (const i of itens) i.assinaturaId = a.id;
  if (!f.cpf) f.cpf = mascararCpf(cpf);
  f.atualizadoEm = em;

  const lista = lerFichas();
  lista.splice(lista.findIndex((x) => x.id === f.id), 1, f);
  if (!gravarFichas(lista)) { $('#btnConfirmar').disabled = false; return; }
  toast('Assinatura registrada ✓');
  location.hash = `#/ficha/${encodeURIComponent(f.id)}`;
}

// ---------- base de CAs (CAEPI) ----------
// data/cas.js é gerado por atualizar-base-ca.js e só é carregado quando a ficha é aberta.
let baseCa = window.BASE_CA || null;
let carregandoBase = null;
function carregarBaseCa() {
  if (baseCa) return Promise.resolve(baseCa);
  if (!carregandoBase) {
    carregandoBase = new Promise((ok) => {
      const s = document.createElement('script');
      s.src = 'data/cas.js';
      s.onload = () => { baseCa = window.BASE_CA || null; ok(baseCa); };
      s.onerror = () => ok(null); // sem base: o preenchimento automático só não funciona
      document.head.appendChild(s);
    });
  }
  return carregandoBase;
}
const LINK_CAEPI = 'https://caepi.trabalho.gov.br/internet/ConsultaCAInternet.aspx';

/** Procura o CA na base. Retorna null se a base não carregou ainda. */
function consultarCa(numero) {
  if (!baseCa) return null;
  const ca = String(numero || '').replace(/\D/g, '').replace(/^0+/, '');
  const r = baseCa.cas[ca];
  if (!r) return { ca, achou: false };
  const [validade, equipamento, descricao, fabricante, referencia] = r;
  return { ca, achou: true, validade, equipamento, descricao, fabricante, referencia };
}

/** Texto curto para a coluna "Descrição" da ficha: referência + início da descrição oficial. */
function descricaoCurta(c) {
  const ref = c.referencia ? `Ref. ${c.referencia}` : '';
  const max = 110 - ref.length;
  let d = c.descricao.split(/(?<=\.)\s/)[0]; // primeira frase
  if (d.length > max) d = d.slice(0, max).replace(/\s\S*$/, '') + '…';
  return [ref, d].filter(Boolean).join(' — ');
}

function infoCa(it) {
  if (!String(it.ca || '').trim()) return '';
  if (!baseCa) return carregandoBase ? '<span class="ca-info">Carregando base de CAs…</span>' : '';
  const c = consultarCa(it.ca);
  const dataBase = dataBR(baseCa.dataBase);
  if (!c.achou) {
    return `<span class="ca-info ruim">⚠ CA ${esc(c.ca)} não está entre os CAs válidos da base (CAEPI de ${dataBase}).
      <a href="${LINK_CAEPI}" target="_blank" rel="noopener">Conferir no CAEPI</a></span>`;
  }
  const ref = it.entrega || hoje();
  const vencido = c.validade < ref;
  return `<span class="ca-info ${vencido ? 'ruim' : 'bom'}" title="${esc(c.descricao)}">
    ${vencido ? `⚠ CA vence em ${dataBR(c.validade)}, antes da data de entrega` : `✓ CA válido até ${dataBR(c.validade)}`} · ${esc(c.equipamento)} · ${esc(c.fabricante)}
    <small>(base CAEPI de ${dataBase})</small></span>`;
}

/** Preenche EPI e descrição a partir do CA, sem apagar o que a pessoa digitou. */
function aplicarCa(it) {
  const c = consultarCa(it.ca);
  if (!c || !c.achou) return false;
  let mudou = false;
  if (!it.epi.trim() || it.epi === it._autoEpi) { it.epi = c.equipamento; it._autoEpi = c.equipamento; mudou = true; }
  const d = descricaoCurta(c);
  if (!it.descricao.trim() || it.descricao === it._autoDesc) { it.descricao = d; it._autoDesc = d; mudou = true; }
  return mudou;
}

function desenharItens() {
  const corpo = $('#itens');
  corpo.innerHTML = '';
  atual.itens.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="number" min="1" data-k="qtd"></td>
      <td><input type="text" data-k="ca" inputmode="numeric" placeholder="Ex.: 12345" autocomplete="off"></td>
      <td><input type="text" data-k="epi" placeholder="Nome do EPI (busca o CA)" autocomplete="off"></td>
      <td><input type="text" data-k="descricao" placeholder="Modelo, tamanho..."></td>
      <td><input type="date" data-k="entrega"></td>
      <td><input type="date" data-k="recebimento"></td>
      <td class="c-x"><button type="button" class="remover" title="Remover EPI">×</button></td>`;
    const info = document.createElement('tr');
    info.className = 'linha-ca';
    info.innerHTML = '<td></td><td colspan="6"></td>';
    const assin = assinaturaDoItem(atual, it);
    const mostrarInfo = () => {
      info.lastElementChild.innerHTML = (assin
        ? `<span class="ca-info assinado">✍️ Recebimento assinado pelo colaborador em ${dataHoraBR(assin.em)} — item travado</span>` : '') + infoCa(it);
      info.hidden = !info.lastElementChild.innerHTML;
    };
    if (assin) {
      // Item assinado não pode mudar, senão a assinatura deixa de valer para o que está escrito
      tr.classList.add('travado');
      tr.innerHTML = tr.innerHTML.replace(/<input /g, '<input disabled ');
      tr.querySelector('.remover').remove();
      tr.querySelectorAll('[data-k]').forEach((inp) => { inp.value = it[inp.dataset.k] ?? ''; });
      tr._atualizar = mostrarInfo;
      mostrarInfo();
      corpo.append(tr, info);
      return;
    }

    tr.querySelectorAll('[data-k]').forEach((inp) => {
      inp.value = it[inp.dataset.k] ?? '';
      inp.addEventListener('input', () => {
        it[inp.dataset.k] = inp.dataset.k === 'qtd' ? Math.max(1, Number(inp.value) || 1) : inp.value;
        if (inp.dataset.k === 'ca') {
          if (aplicarCa(it)) {
            tr.querySelector('[data-k=epi]').value = it.epi;
            tr.querySelector('[data-k=descricao]').value = it.descricao;
          }
          mostrarInfo();
        }
        if (inp.dataset.k === 'entrega') mostrarInfo();
      });
    });
    const rem = tr.querySelector('.remover');
    rem.style.visibility = atual.itens.length === 1 ? 'hidden' : '';
    rem.addEventListener('click', () => { atual.itens.splice(i, 1); desenharItens(); });
    // Busca pelo nome: digitar no campo EPI sugere CAs válidos
    const campoEpi = tr.querySelector('[data-k=epi]');
    const escolher = (ca) => {
      it.ca = ca;
      it._autoEpi = it.epi; // o texto digitado era só a busca: pode ser trocado pelo nome oficial
      aplicarCa(it);
      tr.querySelector('[data-k=ca]').value = it.ca;
      campoEpi.value = it.epi;
      tr.querySelector('[data-k=descricao]').value = it.descricao;
      mostrarInfo();
    };
    let espera;
    campoEpi.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => abrirBusca(campoEpi, escolher), 250); });
    campoEpi.addEventListener('keydown', (e) => teclaBusca(e, escolher));
    campoEpi.addEventListener('blur', () => { clearTimeout(espera); setTimeout(fecharBusca, 150); });

    tr._atualizar = () => {
      if (aplicarCa(it)) {
        tr.querySelector('[data-k=epi]').value = it.epi;
        tr.querySelector('[data-k=descricao]').value = it.descricao;
      }
      mostrarInfo();
    };
    mostrarInfo();
    corpo.append(tr, info);
  });
}

// ---------- busca de CA pelo nome do EPI ----------
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let indiceBusca = null; // [{ ca, titulo, tudo }] montado na primeira busca
function buscarCas(texto, limite = 30) {
  if (!baseCa) return [];
  if (!indiceBusca) {
    indiceBusca = Object.entries(baseCa.cas).map(([ca, [, eq, desc, fab, ref]]) => ({
      ca, titulo: normalizar(`${eq} ${ref}`), tudo: normalizar(`${eq} ${ref} ${fab} ${desc}`),
    }));
  }
  const palavras = normalizar(texto).split(/\s+/).filter((p) => p.length >= 2);
  if (!palavras.length) return [];
  const achados = [];
  for (const e of indiceBusca) {
    if (!palavras.every((p) => e.tudo.includes(p))) continue;
    // quem tem as palavras no nome/referência aparece antes de quem só tem na descrição
    achados.push({ ca: e.ca, pontos: palavras.filter((p) => e.titulo.includes(p)).length });
  }
  achados.sort((a, b) => b.pontos - a.pontos || Number(a.ca) - Number(b.ca));
  return achados.slice(0, limite).map((a) => consultarCa(a.ca));
}

let painelBusca = null;
function fecharBusca() { painelBusca?.remove(); painelBusca = null; }
window.addEventListener('scroll', (e) => { if (painelBusca && !painelBusca.contains(e.target)) fecharBusca(); }, true);
window.addEventListener('resize', fecharBusca);

/** Mostra sugestões de CA abaixo do campo EPI; escolher uma preenche CA, EPI e descrição. */
function abrirBusca(inp, aoEscolher) {
  fecharBusca();
  const texto = inp.value.trim();
  if (texto.length < 3) return;
  if (!baseCa) { carregarBaseCa(); return; }
  const lista = buscarCas(texto);
  const r = inp.getBoundingClientRect();
  painelBusca = document.createElement('div');
  painelBusca.className = 'sugestoes';
  painelBusca.style.left = `${r.left}px`;
  painelBusca.style.top = `${r.bottom + 4}px`;
  painelBusca.style.width = `${Math.max(r.width, 460)}px`;
  painelBusca.innerHTML = lista.length
    ? `<div class="sug-topo">CAs válidos para “${esc(texto)}”${lista.length === 30 ? ' — mostrando os 30 primeiros, refine a busca' : ''}</div>` +
      lista.map((c, i) => `<button type="button" class="sug${i === 0 ? ' ativa' : ''}" data-ca="${esc(c.ca)}">
        <b>CA ${esc(c.ca)}</b> — ${esc(c.equipamento)}${c.referencia ? ` · Ref. ${esc(c.referencia)}` : ''}
        <small>${esc(c.fabricante)} · válido até ${dataBR(c.validade)}</small></button>`).join('')
    : `<div class="sug-topo">Nenhum CA válido encontrado para “${esc(texto)}”. Você pode digitar o nome à mão.</div>`;
  painelBusca.addEventListener('mousedown', (e) => {
    const b = e.target.closest('.sug');
    if (!b) return;
    e.preventDefault(); // não tira o foco antes de escolher
    aoEscolher(b.dataset.ca);
    fecharBusca();
  });
  document.body.appendChild(painelBusca);
}

function teclaBusca(e, aoEscolher) {
  if (!painelBusca) return;
  const itens = [...painelBusca.querySelectorAll('.sug')];
  let i = itens.findIndex((b) => b.classList.contains('ativa'));
  if (e.key === 'Escape') { fecharBusca(); return; }
  if (!itens.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    itens[i]?.classList.remove('ativa');
    i = (i + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
    itens[i].classList.add('ativa');
    itens[i].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    aoEscolher(itens[Math.max(i, 0)].dataset.ca);
    fecharBusca();
  }
}

/** Quando a base termina de carregar, completa as linhas sem redesenhar (não tira o foco de quem está digitando). */
function atualizarInfosCa() {
  document.querySelectorAll('#itens tr:not(.linha-ca)').forEach((tr) => tr._atualizar?.());
}

const CAMPOS = ['colaborador', 'cpf', 'funcao', 'data', 'empresaNome', 'empresaCnpj', 'termo', 'obs'];

function validar(f) {
  if (!f.colaborador) return 'Informe o nome do colaborador.';
  if (f.cpf && !cpfValido(f.cpf)) return 'CPF inválido. Confira os números.';
  if (f.empresaCnpj && !cnpjValido(f.empresaCnpj)) return 'CNPJ inválido. Confira os números.';
  if (!f.termo) return 'O termo de responsabilidade não pode ficar vazio.';
  const itens = f.itens.filter((i) => i.epi.trim());
  if (!itens.length) return 'Adicione pelo menos um EPI com o nome preenchido.';
  const errado = itens.find((i) => i.entrega && i.recebimento && i.recebimento < i.entrega);
  if (errado) return `“${errado.epi}”: a data de recebimento não pode ser anterior à de entrega.`;
  return '';
}

function salvar() {
  const form = $('#form');
  for (const k of CAMPOS) atual[k] = form.elements[k].value.trim();
  const erro = validar(atual);
  $('#erro').textContent = erro;
  $('#erro').hidden = !erro;
  if (erro) return false;

  atual.itens = atual.itens.filter((i) => i.epi.trim());
  atual.atualizadoEm = new Date().toISOString();
  const lista = lerFichas();
  const novo = !atual.id;
  if (novo) { atual.id = novoId(); atual.criadoEm = atual.atualizadoEm; lista.push(atual); }
  else lista.splice(lista.findIndex((f) => f.id === atual.id), 1, atual);
  if (!gravarFichas(lista)) return false;

  try {
    localStorage.setItem(CHAVE_EMPRESA, JSON.stringify({ nome: atual.empresaNome, cnpj: atual.empresaCnpj, logo: atual.empresaLogo }));
  } catch { /* logo grande demais: só não lembra a empresa */ }
  $('#titulo').textContent = atual.colaborador;
  desenharItens();
  desenharAssinaturas();
  if (novo) {
    history.replaceState(null, '', `#/ficha/${encodeURIComponent(atual.id)}`);
    document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === 'lista'));
  }
  if (novo && !$('#btnExcluir')) {
    const b = document.createElement('button');
    b.className = 'btn perigo'; b.type = 'button'; b.id = 'btnExcluir'; b.textContent = 'Excluir';
    b.addEventListener('click', () => {
      if (!confirm(`Excluir a ficha de ${atual.colaborador}? Essa ação não pode ser desfeita.`)) return;
      gravarFichas(lerFichas().filter((f) => f.id !== atual.id));
      toast('Ficha excluída');
      location.hash = '#/';
    });
    $('.barra').appendChild(b);
  }
  return true;
}

// ---------- tela: backup ----------
function telaBackup() {
  const n = lerFichas().length;
  app.innerHTML = `
    <div class="saudacao"><div><h1>Backup</h1><p class="data">${n} ficha${n === 1 ? '' : 's'} salva${n === 1 ? '' : 's'} neste navegador</p></div></div>
    <div class="campanha">
      <strong>Os dados ficam só neste navegador</strong>
      <span>Faça backup com frequência. Limpar os dados do navegador apaga as fichas que não tiverem backup.</span>
    </div>
    <section class="cartao">
      <h2>Fazer backup</h2>
      <p class="dica">Baixa um arquivo com todas as fichas. Guarde em um local seguro.</p>
      <button class="btn" id="btnBaixar">💾 Baixar backup</button>
    </section>
    <section class="cartao">
      <h2>Restaurar backup</h2>
      <p class="dica">Carrega as fichas de um arquivo de backup. Fichas que já existem são atualizadas.</p>
      <label class="btn sec" style="display:inline-flex;margin:0">📂 Escolher arquivo
        <input type="file" id="arqBackup" accept="application/json,.json" hidden></label>
    </section>`;
  $('#btnBaixar').addEventListener('click', fazerBackup);
  $('#arqBackup').addEventListener('change', (e) => { if (e.target.files[0]) restaurarBackup(e.target.files[0]); e.target.value = ''; });
}

function fazerBackup() {
  const blob = new Blob([JSON.stringify({ app: 'ficha-epi', versao: 1, fichas: lerFichas() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fichas-epi-backup-${hoje()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup baixado ✓');
}

async function restaurarBackup(arq) {
  try {
    const dados = JSON.parse(await arq.text());
    const novas = Array.isArray(dados) ? dados : dados.fichas;
    if (!Array.isArray(novas)) throw new Error();
    const lista = lerFichas();
    const ids = new Map(lista.map((f, i) => [f.id, i]));
    let add = 0, upd = 0;
    for (const f of novas) {
      if (!f || !f.id || !Array.isArray(f.itens)) continue;
      if (ids.has(f.id)) { lista[ids.get(f.id)] = f; upd++; } else { lista.push(f); add++; }
    }
    if (gravarFichas(lista)) toast(`Backup restaurado ✓ ${add} nova(s), ${upd} atualizada(s)`);
    telaBackup();
  } catch {
    toast('Não foi possível ler esse arquivo de backup.');
  }
}

// ---------- impressão ----------
function imprimir(f) {
  completarFicha(f);
  const linhas = f.itens.map((i) => {
    const a = assinaturaDoItem(f, i);
    return `<tr><td class="c">${esc(i.qtd)}</td><td>${esc(i.epi)}</td><td>${esc(i.descricao)}</td>
      <td>${esc(i.ca)}</td><td>${dataBR(i.entrega)}</td><td>${dataBR(i.recebimento)}</td>
      <td class="imp-ass-cel">${a ? `<img src="${a.imagem}" alt="">` : ''}</td></tr>`;
  });
  const ultima = f.assinaturas[f.assinaturas.length - 1];
  const registros = f.assinaturas.length ? `
    <div class="imp-registro">
      <b>Registro de assinatura eletrônica</b> — assinatura feita pelo colaborador na tela do dispositivo, com confirmação do CPF.
      A NR-06 admite o registro do fornecimento de EPI em sistema eletrônico.
      ${f.assinaturas.map((a) => {
        const n = f.itens.filter((i) => i.assinaturaId === a.id).length;
        return `<br>• ${esc(a.nome)} · CPF ${esc(a.cpf)} · ${dataHoraBR(a.em)} · ${n} EPI${n === 1 ? '' : 's'} · código de verificação <b>${formatarCodigo(a.codigo)}</b>`;
      }).join('')}
    </div>` : '';
  for (let n = f.itens.length; n < LINHAS_MINIMAS; n++) linhas.push('<tr class="branca"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  const colsCab = f.empresaLogo ? 2 : 3;

  $('#impressao').innerHTML = `
    <table class="imp-cab">
      <tr>
        ${f.empresaLogo ? `<td class="imp-logo" rowspan="4"><img src="${f.empresaLogo}" alt=""></td>` : ''}
        <td class="imp-titulo" colspan="${colsCab}">Ficha de controle de entrega de EPI — NR-06</td>
      </tr>
      <tr><td colspan="${colsCab - 1}"><b>Empresa:</b> ${esc(f.empresaNome)}</td><td><b>CNPJ:</b> ${esc(f.empresaCnpj)}</td></tr>
      <tr><td colspan="${colsCab - 1}"><b>Colaborador:</b> ${esc(f.colaborador)}</td><td><b>Data:</b> ${dataBR(f.data)}</td></tr>
      <tr><td colspan="${colsCab - 1}"><b>Função:</b> ${esc(f.funcao)}</td><td><b>CPF:</b> ${esc(f.cpf)}</td></tr>
    </table>
    <table class="imp-itens">
      <thead><tr><th class="w-qtd">Qtd.</th><th class="w-epi">EPI</th><th class="w-desc">Descrição</th><th class="w-ca">CA</th>
        <th class="w-dt">Data de entrega</th><th class="w-dt">Data de recebimento</th><th class="w-ass">Assinatura do colaborador</th></tr></thead>
      <tbody>${linhas.join('')}</tbody>
    </table>
    <div class="imp-final">
      <div class="imp-termo">${esc(f.termo)}</div>
      ${f.obs ? `<p class="imp-obs"><b>Observações:</b> ${esc(f.obs)}</p>` : ''}
      <div class="imp-assin">
        <div>${ultima ? `<img class="imp-ass-img" src="${ultima.imagem}" alt="">` : ''}<span>${esc(f.colaborador)}</span><small>Assinatura do colaborador</small></div>
        <div><span>&nbsp;</span><small>Responsável pela entrega</small></div>
      </div>
      ${ultima ? '' : '<p class="imp-local">Local e data: ______________________________, ____/____/________</p>'}
      ${registros}
    </div>`;
  window.print();
}

rotear();
