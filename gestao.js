// Ficha de EPI — gestão: colaboradores, catálogo de EPIs, estoque, kits por função, trocas e painel.
// Carregado depois de app.js e usa as funções de lá (esc, hoje, lerFichas, toast...).
'use strict';

const CHAVE_COLAB = 'fichaEpi.colaboradores';
const CHAVE_EPIS = 'fichaEpi.epis';
const CHAVE_ESTOQUE = 'fichaEpi.estoque';
const CHAVE_RASCUNHO = 'fichaEpi.rascunho';
const DIAS_AVISO_TROCA = 15; // "troca próxima" quando faltam até 15 dias

function lerJson(chave) { try { return JSON.parse(localStorage.getItem(chave)) || []; } catch { return []; } }
function gravarJson(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); avisarAlteracao(); return true; }
  catch { toast('Espaço do navegador cheio. Faça um backup e esvazie a lixeira.'); return false; }
}
const lerColaboradores = () => lerJson(CHAVE_COLAB);
const gravarColaboradores = (l) => gravarJson(CHAVE_COLAB, l.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
const lerEpis = () => lerJson(CHAVE_EPIS);
const gravarEpis = (l) => gravarJson(CHAVE_EPIS, l.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
const lerEstoque = () => lerJson(CHAVE_ESTOQUE);
const gravarEstoque = (l) => gravarJson(CHAVE_ESTOQUE, l);

// ---------- datas ----------
function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + Number(dias));
  return d.toISOString().slice(0, 10);
}
const diasEntre = (de, ate) => Math.round((new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 864e5);
function textoPrazo(dias) {
  if (dias < 0) return `atrasada há ${-dias} dia${dias === -1 ? '' : 's'}`;
  if (dias === 0) return 'vence hoje';
  return `em ${dias} dia${dias === 1 ? '' : 's'}`;
}

// ---------- ligações entre fichas, colaboradores e catálogo ----------
function epiDoCatalogoPorCa(ca, epis = lerEpis()) {
  const n = soDigitos(ca).replace(/^0+/, '');
  return n ? epis.find((e) => soDigitos(e.ca).replace(/^0+/, '') === n) || null : null;
}
function epiDoItem(it, epis = lerEpis()) {
  if (it.epiId) { const e = epis.find((x) => x.id === it.epiId); if (e) return e; }
  return epiDoCatalogoPorCa(it.ca, epis) || epis.find((x) => mesmoNome(x.nome, it.epi || '')) || null;
}
function colaboradorDaFicha(f, colabs = lerColaboradores()) {
  if (f.colaboradorId) { const c = colabs.find((x) => x.id === f.colaboradorId); if (c) return c; }
  const cpf = soDigitos(f.cpf);
  if (cpf) { const c = colabs.find((x) => soDigitos(x.cpf) === cpf); if (c) return c; }
  return colabs.find((x) => mesmoNome(x.nome, f.colaborador || '')) || null;
}

/** Ao salvar a ficha: liga ao colaborador cadastrado ou cadastra um novo. */
function vincularColaborador(f) {
  if (!f.colaborador) return;
  const colabs = lerColaboradores();
  let c = colaboradorDaFicha(f, colabs);
  if (c && f.cpf && c.cpf && soDigitos(c.cpf) !== soDigitos(f.cpf) && c.id !== f.colaboradorId) c = null; // homônimo com outro CPF
  if (!c) {
    c = { id: novoId(), nome: f.colaborador, cpf: f.cpf || '', funcao: f.funcao || '', setor: '', matricula: '', admissao: '',
      ativo: true, criadoEm: new Date().toISOString() };
    colabs.push(c);
  } else {
    if (!c.cpf && f.cpf) c.cpf = f.cpf;
    if (!c.funcao && f.funcao) c.funcao = f.funcao;
  }
  f.colaboradorId = c.id;
  gravarColaboradores(colabs);
}

const itemDoCatalogo = (e, qtd) => ({ ...itemVazio(), epi: e.nome, ca: e.ca || '', descricao: e.descricao || '', qtd: qtd || 1,
  epiId: e.id, _autoEpi: e.nome, _autoDesc: e.descricao || '' });

/** Todas as entregas, o que está em uso, as trocas previstas e o kit pendente. */
function analisarEntregas() {
  const epis = lerEpis();
  const colabs = lerColaboradores();
  const funcoes = lerFuncoes();
  const hj = hoje();
  const entregas = [];
  const ultimas = new Map();
  for (const f of lerFichas()) {
    completarFicha(f);
    const colab = colaboradorDaFicha(f, colabs);
    for (const item of f.itens) {
      if (!item.epi || !item.epi.trim()) continue;
      const epi = epiDoItem(item, epis);
      const reg = { ficha: f, item, epi, colab, nome: colab ? colab.nome : f.colaborador, data: item.entrega || f.data };
      entregas.push(reg);
      const chave = `${colab ? colab.id : 'n:' + normalizar(f.colaborador)}|${epi ? epi.id : 'i:' + (soDigitos(item.ca) || normalizar(item.epi))}`;
      const ant = ultimas.get(chave);
      if (!ant || reg.data > ant.data || (reg.data === ant.data && (f.atualizadoEm || '') >= (ant.ficha.atualizadoEm || ''))) ultimas.set(chave, reg);
    }
  }
  const ativo = (r) => !r.colab || r.colab.ativo !== false;
  const emUso = [...ultimas.values()].filter((r) => !r.item.devolucao && ativo(r));
  const trocas = emUso.filter((r) => r.epi && Number(r.epi.vidaUtil) > 0).map((r) => {
    const vence = somarDias(r.data, r.epi.vidaUtil);
    const dias = diasEntre(hj, vence);
    return { ...r, vence, dias, status: dias < 0 ? 'atrasada' : dias <= DIAS_AVISO_TROCA ? 'proxima' : 'ok' };
  });
  const pendKit = [];
  for (const c of colabs.filter((x) => x.ativo !== false)) {
    const fn = funcoes.find((x) => mesmoNome(x.nome, c.funcao || ''));
    for (const k of (fn && fn.kit) || []) {
      const e = epis.find((x) => x.id === k.epiId);
      if (!e || emUso.some((r) => r.colab && r.colab.id === c.id && r.epi && r.epi.id === e.id)) continue;
      const jaTeve = entregas.some((r) => r.colab && r.colab.id === c.id && r.epi && r.epi.id === e.id);
      pendKit.push({ colab: c, epi: e, qtd: k.qtd || 1, motivo: jaTeve ? 'devolvido, sem reposição' : 'ainda não entregue' });
    }
  }
  return { epis, colabs, funcoes, entregas, emUso, trocas, pendKit };
}

/** Saldo = entradas e ajustes − EPIs entregues desde que o EPI foi cadastrado. */
function saldoEpi(e, entregas, estoque) {
  const entradas = estoque.filter((m) => m.epiId === e.id).reduce((s, m) => s + Number(m.qtd || 0), 0);
  const desde = (e.criadoEm || '').slice(0, 10);
  const saidas = entregas.filter((r) => r.epi && r.epi.id === e.id && r.data >= desde).reduce((s, r) => s + Number(r.item.qtd || 1), 0);
  const controla = entradas !== 0 || Number(e.estoqueMinimo) > 0 || estoque.some((m) => m.epiId === e.id);
  return { entradas, saidas, saldo: entradas - saidas, controla, baixo: controla && entradas - saidas <= Number(e.estoqueMinimo || 0) };
}

// ---------- editor da ficha: colaborador, kit, troca e devolução ----------
function ligarCampoColaborador() {
  const campo = $('#form').elements.colaborador;
  const colabs = lerColaboradores().filter((c) => c.ativo !== false);
  $('#listaColaboradores').innerHTML = colabs.map((c) =>
    `<option value="${esc(c.nome)}">${esc([c.funcao, c.cpf].filter(Boolean).join(' · '))}</option>`).join('');
  const status = (digitou) => {
    const v = campo.value.trim();
    const vinculado = atual.colaboradorId && lerColaboradores().find((x) => x.id === atual.colaboradorId);
    // Ao abrir a ficha mantém o vínculo salvo, mesmo que o nome do cadastro tenha mudado depois
    const c = (vinculado && (!digitou || mesmoNome(vinculado.nome, v)) && vinculado) || colabs.find((x) => mesmoNome(x.nome, v));
    if (c) {
      atual.colaboradorId = c.id;
      $('#statusColab').innerHTML = `✓ Colaborador cadastrado · <a href="#/colaborador/${encodeURIComponent(c.id)}">ver histórico</a>`;
    } else {
      if (digitou && !campo.readOnly) delete atual.colaboradorId;
      $('#statusColab').textContent = v ? 'Novo colaborador: será cadastrado ao salvar a ficha' : '';
    }
    return c;
  };
  campo.addEventListener('change', () => {
    const c = status(true);
    if (!c || campo.readOnly) return;
    const form = $('#form');
    if (!form.elements.cpf.value && c.cpf) form.elements.cpf.value = c.cpf;
    if (!form.elements.funcao.value && c.funcao) { form.elements.funcao.value = c.funcao; form.elements.funcao.dispatchEvent(new Event('input')); }
  });
  campo.addEventListener('input', () => status(true));
  status(false);
}

function adicionarKitDaFuncao() {
  const nomeFn = $('#form').elements.funcao.value.trim();
  if (!nomeFn) { toast('Escolha primeiro a função do colaborador.'); return; }
  const fn = lerFuncoes().find((x) => mesmoNome(x.nome, nomeFn));
  if (!fn || !(fn.kit || []).length) {
    toast(`A função “${nomeFn}” ainda não tem EPIs definidos. Defina em Funções › EPIs da função.`);
    return;
  }
  const epis = lerEpis();
  atual.itens = atual.itens.filter((i) => i.epi.trim() || i.ca.trim() || i.assinaturaId);
  let n = 0;
  for (const k of fn.kit) {
    const e = epis.find((x) => x.id === k.epiId);
    if (!e || atual.itens.some((i) => !i.assinaturaId && epiDoItem(i, epis)?.id === e.id)) continue;
    atual.itens.push(itemDoCatalogo(e, k.qtd));
    n++;
  }
  if (!atual.itens.length) atual.itens.push(itemVazio());
  desenharItens();
  toast(n ? `${n} EPI${n === 1 ? '' : 's'} da função adicionado${n === 1 ? '' : 's'} ✓` : 'Os EPIs da função já estão na ficha.');
}

/** Linha de informação do item: próxima troca e devolução. */
function infoGestao(it) {
  if (!it.epi || !it.epi.trim()) return '';
  const e = epiDoItem(it);
  const partes = [];
  let classe = '';
  if (it.devolucao) {
    partes.push(`↩ Devolvido em ${dataBR(it.devolucao)} <button type="button" class="link-acao" data-desfazer-dev="${esc(it.uid)}">desfazer</button>`);
  } else {
    if (e && Number(e.vidaUtil) > 0 && it.entrega) {
      const vence = somarDias(it.entrega, e.vidaUtil);
      const dias = diasEntre(hoje(), vence);
      classe = dias < 0 ? 'ruim' : dias <= DIAS_AVISO_TROCA ? 'atencao' : '';
      partes.push(`🔁 Troca prevista em ${dataBR(vence)} (${textoPrazo(dias)} · vida útil de ${e.vidaUtil} dias)`);
    }
    if (atual && atual.id && it.entrega && it.entrega <= hoje()) {
      partes.push(`<button type="button" class="link-acao" data-devolver="${esc(it.uid)}">Registrar devolução</button>`);
    }
  }
  return partes.length ? `<span class="ca-info ${classe}">${partes.join(' · ')}</span>` : '';
}

function pegarRascunho() {
  const r = sessionStorage.getItem(CHAVE_RASCUNHO);
  sessionStorage.removeItem(CHAVE_RASCUNHO);
  try { return r ? JSON.parse(r) : null; } catch { return null; }
}

/** Abre uma ficha nova já com o colaborador e os EPIs escolhidos. */
function novaEntrega(colabId, lista) {
  const c = lerColaboradores().find((x) => x.id === colabId);
  if (!c) return;
  const f = fichaNova();
  Object.assign(f, { colaborador: c.nome, cpf: c.cpf || '', funcao: c.funcao || '', colaboradorId: c.id });
  if (lista && lista.length) f.itens = lista.map(({ epi, qtd }) => itemDoCatalogo(epi, qtd));
  sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(f));
  if (location.hash === '#/nova') rotear(); else location.hash = '#/nova';
}

// ---------- tela: painel ----------
function telaPainel() {
  const a = analisarEntregas();
  const estoque = lerEstoque();
  const atrasadas = a.trocas.filter((t) => t.status === 'atrasada');
  const proximas = a.trocas.filter((t) => t.status === 'proxima');
  const pendAssin = lerFichas().map(completarFicha).filter((f) => itensSemAssinatura(f).length);
  const baixos = a.epis.map((e) => ({ e, ...saldoEpi(e, a.entregas, estoque) })).filter((s) => s.baixo);
  const ativos = a.colabs.filter((c) => c.ativo !== false).length;
  const vazio = !lerFichas().length && !a.epis.length && !a.colabs.length;

  // Pendências agrupadas por colaborador
  const grupos = new Map();
  const add = (colab, nome, linha) => {
    const k = colab ? colab.id : 'n:' + nome;
    if (!grupos.has(k)) grupos.set(k, { colab, nome, linhas: [] });
    grupos.get(k).linhas.push(linha);
  };
  for (const t of [...atrasadas, ...proximas].sort((x, y) => x.dias - y.dias)) add(t.colab, t.nome, { tipo: t.status, epi: t.epi, qtd: t.item.qtd, texto: `troca ${textoPrazo(t.dias)} (${dataBR(t.vence)})` });
  for (const p of a.pendKit) add(p.colab, p.colab.nome, { tipo: 'kit', epi: p.epi, qtd: p.qtd, texto: `kit da função: ${p.motivo}` });

  app.innerHTML = `
    <div class="saudacao">
      <div><h1>Painel</h1><p class="data">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="acoes">
        <button class="btn sec" id="btnInstalar" hidden>📲 Instalar app</button>
        <a class="btn amarelo" href="#/nova">＋ Nova ficha</a>
      </div>
    </div>
    ${vazio ? `<div class="campanha">
      <strong>Primeiros passos</strong>
      <span>1. Cadastre os <a href="#/epis">EPIs</a> com vida útil e estoque · 2. Monte o kit de cada <a href="#/funcoes">função</a> ·
      3. Cadastre os <a href="#/colaboradores">colaboradores</a> · 4. Faça as fichas. O painel avisa as trocas, o estoque baixo e as assinaturas pendentes.</span>
    </div>` : ''}
    <div class="numeros">
      <a class="numero" href="#/colaboradores"><b>${ativos}</b><span>colaboradores ativos</span></a>
      <a class="numero ${atrasadas.length ? 'alerta' : ''}" data-rolar="pendencias"><b>${atrasadas.length}</b><span>trocas atrasadas</span></a>
      <a class="numero ${proximas.length ? 'aviso' : ''}" data-rolar="pendencias"><b>${proximas.length}</b><span>trocas nos próximos ${DIAS_AVISO_TROCA} dias</span></a>
      <a class="numero ${a.pendKit.length ? 'aviso' : ''}" data-rolar="pendencias"><b>${a.pendKit.length}</b><span>EPIs do kit pendentes</span></a>
      <a class="numero ${pendAssin.length ? 'aviso' : ''}" data-rolar="assinaturas-pendentes"><b>${pendAssin.length}</b><span>fichas aguardando assinatura</span></a>
      <a class="numero ${baixos.length ? 'alerta' : ''}" data-rolar="estoque-baixo"><b>${baixos.length}</b><span>EPIs com estoque baixo</span></a>
    </div>

    <section class="cartao" id="pendencias">
      <h2>Trocas e entregas pendentes</h2>
      ${grupos.size ? [...grupos.values()].map((g) => {
        const doCatalogo = g.linhas.filter((l) => l.epi);
        return `<div class="pendencia">
          <div class="pendencia-topo">
            <div><b>${g.colab ? `<a href="#/colaborador/${encodeURIComponent(g.colab.id)}">${esc(g.nome)}</a>` : esc(g.nome)}</b>
              ${g.colab && g.colab.funcao ? `<span class="dica"> · ${esc(g.colab.funcao)}</span>` : ''}</div>
            ${g.colab && doCatalogo.length ? `<button class="btn amarelo peq" data-entregar="${esc(g.colab.id)}">Nova entrega com esses EPIs</button>` : ''}
          </div>
          ${g.linhas.map((l) => `<div class="pendencia-linha"><span class="selo ${l.tipo === 'atrasada' ? 'pendente' : l.tipo === 'proxima' ? 'nr' : ''}">${
            l.tipo === 'atrasada' ? 'atrasada' : l.tipo === 'proxima' ? 'próxima' : 'kit'}</span> ${esc(l.epi ? l.epi.nome : '')} — ${l.texto}</div>`).join('')}
        </div>`;
      }).join('') : `<p class="dica" style="margin:0">Nenhuma troca atrasada ou próxima. ${a.epis.some((e) => Number(e.vidaUtil) > 0) ? ''
        : 'Para o painel calcular as trocas, informe a <a href="#/epis">vida útil dos EPIs</a>.'}</p>`}
    </section>

    <section class="cartao" id="assinaturas-pendentes">
      <h2>Fichas aguardando assinatura</h2>
      ${pendAssin.length ? `<div class="lista-simples">${pendAssin.map((f) => {
        const n = itensSemAssinatura(f).length;
        return `<a href="#/ficha/${encodeURIComponent(f.id)}">${esc(f.colaborador)}</a> <span class="dica">· ${n} EPI${n === 1 ? '' : 's'} sem assinatura · ${dataBR(f.data)}</span>`;
      }).join('<br>')}</div>` : '<p class="dica" style="margin:0">Nenhuma ficha pendente de assinatura.</p>'}
    </section>

    <section class="cartao" id="estoque-baixo">
      <h2>Estoque baixo</h2>
      ${baixos.length ? `<div class="lista-simples">${baixos.map((s) =>
        `<a href="#/epis">${esc(s.e.nome)}</a> <span class="dica">· saldo ${s.saldo} · mínimo ${Number(s.e.estoqueMinimo || 0)}</span>`).join('<br>')}</div>`
        : `<p class="dica" style="margin:0">${a.epis.length ? 'Nenhum EPI abaixo do estoque mínimo.' : 'Cadastre os EPIs para acompanhar o estoque.'}</p>`}
    </section>

    <section class="cartao">
      <h2>CAs dos EPIs em uso</h2>
      <div id="casEmUso"><p class="dica" style="margin:0">Verificando na base do CAEPI…</p></div>
    </section>`;

  app.querySelectorAll('[data-entregar]').forEach((b) => b.addEventListener('click', () => {
    const g = grupos.get(b.dataset.entregar);
    novaEntrega(b.dataset.entregar, g.linhas.filter((l) => l.epi).map((l) => ({ epi: l.epi, qtd: l.qtd })));
  }));
  app.querySelectorAll('[data-rolar]').forEach((b) => b.addEventListener('click', () => $(`#${b.dataset.rolar}`).scrollIntoView({ behavior: 'smooth' })));
  mostrarBotaoInstalar();

  // Confere os CAs dos EPIs em uso (a base do CAEPI carrega sob demanda)
  const comCa = a.emUso.filter((r) => soDigitos(r.item.ca));
  carregarBaseCa().then((b) => {
    const box = $('#casEmUso');
    if (!box) return;
    if (!b) { box.innerHTML = '<p class="dica" style="margin:0">Base do CAEPI indisponível.</p>'; return; }
    const problemas = comCa.map((r) => ({ r, c: consultarCa(r.item.ca) }))
      .filter(({ c }) => !c.achou || c.validade < hoje());
    box.innerHTML = problemas.length
      ? `<div class="lista-simples">${problemas.map(({ r, c }) => `<span class="selo pendente">CA ${esc(c.ca)}</span>
          ${esc(r.item.epi)} — ${esc(r.nome)} <span class="dica">· ${c.achou ? `CA vencido em ${dataBR(c.validade)}` : 'não está entre os CAs válidos'}
          · <a href="#/ficha/${encodeURIComponent(r.ficha.id)}">ficha</a></span>`).join('<br>')}</div>
         <p class="dica">Base CAEPI de ${dataBR(b.dataBase)}. <a href="${LINK_CAEPI}" target="_blank" rel="noopener">Conferir no CAEPI</a></p>`
      : `<p class="dica" style="margin:0">${comCa.length ? `Os ${comCa.length} CAs dos EPIs em uso estão válidos` : 'Nenhum EPI em uso com CA informado'} (base CAEPI de ${dataBR(b.dataBase)}).</p>`;
  });
}

// ---------- tela: colaboradores ----------
let colabEditando = null;

function telaColaboradores() {
  const colabs = lerColaboradores();
  const a = analisarEntregas();
  const editando = colabEditando && colabs.find((c) => c.id === colabEditando);
  const semCadastro = [...new Map(lerFichas().filter((f) => f.colaborador && !colaboradorDaFicha(f, colabs))
    .map((f) => [normalizar(f.colaborador), f])).values()];

  app.innerHTML = `
    <div class="saudacao"><div><h1>Colaboradores</h1>
      <p class="data">${colabs.filter((c) => c.ativo !== false).length} ativo(s) · histórico de EPIs e trocas de cada um</p></div></div>

    <section class="cartao">
      <h2>${editando ? `Editando ${esc(editando.nome)}` : 'Novo colaborador'}</h2>
      <form id="formColab" novalidate>
        <div class="grade">
          <label>Nome <input type="text" name="nome" maxlength="120" autocomplete="off"></label>
          <label>CPF <input type="text" name="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"></label>
          <label>Função <input type="text" name="funcao" maxlength="120" list="listaFuncoesColab" autocomplete="off">
            <datalist id="listaFuncoesColab">${lerFuncoes().map((f) => `<option value="${esc(f.nome)}">`).join('')}</datalist></label>
          <label>Setor <input type="text" name="setor" maxlength="80"></label>
          <label>Matrícula <span class="dica">— opcional</span><input type="text" name="matricula" maxlength="40"></label>
          <label>Admissão <span class="dica">— opcional</span><input type="date" name="admissao"></label>
        </div>
        <p class="erro" id="erroColab" hidden></p>
        <div class="barra" style="margin-bottom:0">
          <button class="btn" type="submit">${editando ? 'Salvar alterações' : '＋ Cadastrar'}</button>
          ${editando ? '<button class="btn sec" type="button" id="btnCancelarColab">Cancelar</button>' : ''}
        </div>
      </form>
      ${semCadastro.length ? `<div class="campanha" style="margin:14px 0 0">
        <strong>${semCadastro.length} colaborador(es) das fichas ainda sem cadastro</strong>
        <span>${semCadastro.slice(0, 8).map((f) => esc(f.colaborador)).join(', ')}${semCadastro.length > 8 ? '…' : ''}</span><br>
        <button class="btn amarelo peq" id="btnImportarColabs" style="margin-top:8px">Cadastrar a partir das fichas</button></div>` : ''}
    </section>

    <div class="filtros">
      <input type="search" id="buscaColab" placeholder="Buscar por nome, CPF, função ou setor">
      <label class="concordo" style="align-self:center"><input type="checkbox" id="verInativos"> Mostrar inativos</label>
    </div>
    <div class="lista" id="listaColabs"></div>`;

  const form = $('#formColab');
  if (editando) for (const k of ['nome', 'cpf', 'funcao', 'setor', 'matricula', 'admissao']) form.elements[k].value = editando[k] || '';
  form.elements.cpf.addEventListener('input', (e) => { e.target.value = mascararCpf(e.target.value); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(['nome', 'cpf', 'funcao', 'setor', 'matricula', 'admissao'].map((k) => [k, form.elements[k].value.trim()]));
    const erro = !v.nome ? 'Informe o nome.' : v.cpf && !cpfValido(v.cpf) ? 'CPF inválido.'
      : v.cpf && colabs.some((c) => c.id !== colabEditando && soDigitos(c.cpf) === soDigitos(v.cpf)) ? 'Já existe um colaborador com esse CPF.' : '';
    if (erro) { $('#erroColab').textContent = erro; $('#erroColab').hidden = false; return; }
    if (editando) Object.assign(editando, v);
    else colabs.push({ id: novoId(), ...v, ativo: true, criadoEm: new Date().toISOString() });
    if (!gravarColaboradores(colabs)) return;
    toast(editando ? 'Colaborador atualizado ✓' : 'Colaborador cadastrado ✓');
    colabEditando = null;
    telaColaboradores();
  });
  $('#btnCancelarColab')?.addEventListener('click', () => { colabEditando = null; telaColaboradores(); });
  $('#btnImportarColabs')?.addEventListener('click', () => {
    for (const f of semCadastro) colabs.push({ id: novoId(), nome: f.colaborador, cpf: f.cpf || '', funcao: f.funcao || '', setor: '',
      matricula: '', admissao: '', ativo: true, criadoEm: new Date().toISOString() });
    if (gravarColaboradores(colabs)) { toast(`${semCadastro.length} colaborador(es) cadastrado(s) ✓`); telaColaboradores(); }
  });

  const desenhar = () => {
    const q = normalizar($('#buscaColab').value.trim());
    const inativos = $('#verInativos').checked;
    const lista = colabs.filter((c) => (inativos || c.ativo !== false)
      && (!q || normalizar([c.nome, c.cpf, c.funcao, c.setor].join(' ')).includes(q)));
    $('#listaColabs').innerHTML = lista.length ? lista.map((c) => {
      const uso = a.emUso.filter((r) => r.colab && r.colab.id === c.id).length;
      const atr = a.trocas.filter((t) => t.colab && t.colab.id === c.id && t.status === 'atrasada').length;
      const kit = a.pendKit.filter((p) => p.colab.id === c.id).length;
      return `<a class="item" href="#/colaborador/${encodeURIComponent(c.id)}">
        <h3>${esc(c.nome)}</h3>
        <div class="selos">
          ${c.funcao ? `<span class="selo">${esc(c.funcao)}</span>` : ''}
          ${c.setor ? `<span class="selo nr">${esc(c.setor)}</span>` : ''}
          ${c.ativo === false ? '<span class="selo">inativo</span>' : ''}
          <span class="selo">${uso} EPI${uso === 1 ? '' : 's'} em uso</span>
          ${atr ? `<span class="selo pendente">${atr} troca${atr === 1 ? '' : 's'} atrasada${atr === 1 ? '' : 's'}</span>` : ''}
          ${kit ? `<span class="selo nr">${kit} do kit pendente${kit === 1 ? '' : 's'}</span>` : ''}
        </div>
        ${c.cpf ? `<p>CPF ${esc(c.cpf)}</p>` : ''}
      </a>`;
    }).join('') : `<div class="cartao vazio">${colabs.length ? 'Nenhum colaborador encontrado.' : 'Nenhum colaborador cadastrado ainda.'}</div>`;
  };
  $('#buscaColab').addEventListener('input', desenhar);
  $('#verInativos').addEventListener('change', desenhar);
  desenhar();
}

function telaColaborador(id) {
  const colabs = lerColaboradores();
  const c = colabs.find((x) => x.id === id);
  if (!c) { location.hash = '#/colaboradores'; return; }
  const a = analisarEntregas();
  const minhas = a.entregas.filter((r) => r.colab && r.colab.id === c.id).sort((x, y) => y.data.localeCompare(x.data));
  const emUso = a.emUso.filter((r) => r.colab && r.colab.id === c.id);
  const trocaDe = (r) => a.trocas.find((t) => t.item === r.item);
  const kit = a.pendKit.filter((p) => p.colab.id === c.id);
  const fichas = [...new Set(minhas.map((r) => r.ficha))];
  const pendentes = [...a.trocas.filter((t) => t.colab && t.colab.id === c.id && t.status !== 'ok').map((t) => ({ epi: t.epi, qtd: t.item.qtd })),
    ...kit.map((p) => ({ epi: p.epi, qtd: p.qtd }))];

  app.innerHTML = `
    <a href="#/colaboradores" class="voltar">← Colaboradores</a>
    <div class="saudacao">
      <div><h1>${esc(c.nome)}</h1>
        <p class="data">${[c.funcao, c.setor, c.cpf && `CPF ${c.cpf}`, c.matricula && `Matrícula ${c.matricula}`,
          c.admissao && `Admissão ${dataBR(c.admissao)}`].filter(Boolean).map(esc).join(' · ') || 'Sem dados complementares'}
          ${c.ativo === false ? ' · <b>inativo</b>' : ''}</p></div>
    </div>
    <div class="barra">
      ${pendentes.length ? `<button class="btn amarelo" id="btnEntregarPend">Entregar ${pendentes.length} EPI${pendentes.length === 1 ? '' : 's'} pendente${pendentes.length === 1 ? '' : 's'}</button>` : ''}
      <button class="btn" id="btnNovaEntrega">＋ Nova entrega</button>
      <button class="btn sec" id="btnEditarColab">Editar</button>
      <button class="btn sec" id="btnAtivo">${c.ativo === false ? 'Reativar' : 'Desativar (desligado)'}</button>
      ${fichas.length ? '' : '<button class="btn perigo" id="btnExcluirColab">Excluir</button>'}
    </div>

    <section class="cartao">
      <h2>EPIs em uso</h2>
      ${emUso.length ? `<div class="rolagem"><table class="tabela">
        <thead><tr><th>EPI</th><th>CA</th><th>Entregue em</th><th>Próxima troca</th></tr></thead>
        <tbody>${emUso.map((r) => {
          const t = trocaDe(r);
          return `<tr><td>${esc(r.item.epi)}</td><td>${esc(r.item.ca)}</td><td>${dataBR(r.data)}</td>
            <td>${t ? `<span class="selo ${t.status === 'atrasada' ? 'pendente' : t.status === 'proxima' ? 'nr' : 'feito'}">${dataBR(t.vence)} · ${textoPrazo(t.dias)}</span>` : '<span class="dica">sem vida útil cadastrada</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="dica" style="margin:0">Nenhum EPI em uso.</p>'}
      ${kit.length ? `<div class="campanha" style="margin:14px 0 0"><strong>Kit da função pendente</strong>
        <span>${kit.map((p) => `${esc(p.epi.nome)} (${p.motivo})`).join(' · ')}</span></div>` : ''}
    </section>

    <section class="cartao">
      <h2>Histórico de entregas</h2>
      ${minhas.length ? `<div class="rolagem"><table class="tabela">
        <thead><tr><th>Entrega</th><th>EPI</th><th>Qtd.</th><th>CA</th><th>Assinado</th><th>Devolução</th><th></th></tr></thead>
        <tbody>${minhas.map((r) => `<tr><td>${dataBR(r.data)}</td><td>${esc(r.item.epi)}</td><td>${esc(r.item.qtd)}</td><td>${esc(r.item.ca)}</td>
          <td>${r.item.assinaturaId ? '✍️ sim' : '<span class="dica">não</span>'}</td><td>${r.item.devolucao ? dataBR(r.item.devolucao) : '—'}</td>
          <td><a href="#/ficha/${encodeURIComponent(r.ficha.id)}">ficha</a></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="dica" style="margin:0">Nenhuma entrega registrada.</p>'}
    </section>`;

  $('#btnEntregarPend')?.addEventListener('click', () => novaEntrega(c.id, pendentes));
  $('#btnNovaEntrega').addEventListener('click', () => novaEntrega(c.id, []));
  $('#btnEditarColab').addEventListener('click', () => { colabEditando = c.id; location.hash = '#/colaboradores'; });
  $('#btnAtivo').addEventListener('click', () => {
    if (c.ativo !== false && !confirm(`Desativar ${c.nome}? Ele deixa de aparecer nas trocas e pendências. O histórico é mantido.`)) return;
    c.ativo = c.ativo === false;
    if (gravarColaboradores(colabs)) { toast(c.ativo ? 'Colaborador reativado' : 'Colaborador desativado'); telaColaborador(id); }
  });
  $('#btnExcluirColab')?.addEventListener('click', () => {
    if (!confirm(`Excluir o cadastro de ${c.nome}?`)) return;
    if (gravarColaboradores(colabs.filter((x) => x.id !== c.id))) { toast('Colaborador excluído'); location.hash = '#/colaboradores'; }
  });
}

// ---------- tela: EPIs e estoque ----------
let epiEditando = null;

function telaEpis() {
  const epis = lerEpis();
  const estoque = lerEstoque();
  const a = analisarEntregas();
  const editando = epiEditando && epis.find((e) => e.id === epiEditando);
  const usados = [...new Map(a.entregas.filter((r) => !r.epi)
    .map((r) => [soDigitos(r.item.ca) || normalizar(r.item.epi), r.item])).values()];

  app.innerHTML = `
    <div class="saudacao"><div><h1>EPIs e estoque</h1>
      <p class="data">Catálogo da empresa: vida útil para calcular as trocas e estoque para não faltar EPI</p></div></div>

    <section class="cartao">
      <h2>${editando ? `Editando ${esc(editando.nome)}` : 'Novo EPI'}</h2>
      <form id="formEpi" novalidate>
        <div class="grade grade-3">
          <label>Nº do CA <input type="text" name="ca" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="Preenche o resto"></label>
          <label class="duplo">Nome do EPI <input type="text" name="nome" maxlength="120" placeholder="Ex.: Luva de vaqueta"></label>
          <label class="inteira">Descrição <span class="dica">— vai para a ficha</span><input type="text" name="descricao" maxlength="160"></label>
          <label>Vida útil (dias) <input type="number" name="vidaUtil" min="0" max="3650" placeholder="Ex.: 30"></label>
          <label>Estoque mínimo <input type="number" name="estoqueMinimo" min="0" placeholder="Ex.: 10"></label>
          <label>Saldo inicial <span class="dica">— só no cadastro</span><input type="number" name="saldoInicial" min="0" ${editando ? 'disabled' : ''}></label>
        </div>
        <p class="dica" id="infoCaEpi" style="margin:0 0 10px"></p>
        <p class="erro" id="erroEpi" hidden></p>
        <div class="barra" style="margin-bottom:0">
          <button class="btn" type="submit">${editando ? 'Salvar alterações' : '＋ Cadastrar EPI'}</button>
          ${editando ? '<button class="btn sec" type="button" id="btnCancelarEpi">Cancelar</button>' : ''}
        </div>
      </form>
      <p class="dica">Vida útil é o prazo de troca definido pela empresa (ex.: luva 30 dias, botina 180, capacete 730). Deixe vazio se não houver troca periódica.</p>
      ${usados.length ? `<div class="campanha" style="margin:14px 0 0">
        <strong>${usados.length} EPI(s) usados nas fichas ainda fora do catálogo</strong>
        <span>${usados.slice(0, 8).map((i) => esc(i.epi)).join(', ')}${usados.length > 8 ? '…' : ''}</span><br>
        <button class="btn amarelo peq" id="btnImportarEpis" style="margin-top:8px">Adicionar ao catálogo</button></div>` : ''}
    </section>

    <input type="search" id="buscaEpi" placeholder="Buscar EPI ou CA">
    <p class="contagem">${epis.length} EPI${epis.length === 1 ? '' : 's'} no catálogo</p>
    <div class="lista" id="listaEpis"></div>`;

  const form = $('#formEpi');
  if (editando) for (const k of ['ca', 'nome', 'descricao', 'vidaUtil', 'estoqueMinimo']) form.elements[k].value = editando[k] ?? '';
  const mostrarCa = () => {
    const ca = form.elements.ca.value.trim();
    if (!ca) { $('#infoCaEpi').textContent = ''; return; }
    carregarBaseCa().then(() => {
      const c = consultarCa(ca);
      if (!c) return;
      if (c.achou) {
        if (!form.elements.nome.value.trim()) form.elements.nome.value = c.equipamento;
        if (!form.elements.descricao.value.trim()) form.elements.descricao.value = descricaoCurta(c);
        $('#infoCaEpi').innerHTML = `<span class="selo feito">✓ CA válido até ${dataBR(c.validade)}</span> ${esc(c.equipamento)} · ${esc(c.fabricante)}`;
      } else $('#infoCaEpi').innerHTML = `<span class="selo pendente">CA ${esc(c.ca)} não está entre os válidos</span> <a href="${LINK_CAEPI}" target="_blank" rel="noopener">conferir no CAEPI</a>`;
    });
  };
  form.elements.ca.addEventListener('change', mostrarCa);
  if (editando) mostrarCa();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = { ca: soDigitos(form.elements.ca.value), nome: form.elements.nome.value.trim(), descricao: form.elements.descricao.value.trim(),
      vidaUtil: Math.max(0, Number(form.elements.vidaUtil.value) || 0), estoqueMinimo: Math.max(0, Number(form.elements.estoqueMinimo.value) || 0) };
    const erro = !v.nome ? 'Informe o nome do EPI.'
      : v.ca && epis.some((x) => x.id !== epiEditando && soDigitos(x.ca) === v.ca) ? 'Já existe um EPI com esse CA no catálogo.' : '';
    if (erro) { $('#erroEpi').textContent = erro; $('#erroEpi').hidden = false; return; }
    if (editando) Object.assign(editando, v);
    else {
      const novo = { id: novoId(), ...v, criadoEm: new Date().toISOString() };
      epis.push(novo);
      const ini = Number(form.elements.saldoInicial.value) || 0;
      if (ini > 0) { estoque.push({ id: novoId(), epiId: novo.id, data: hoje(), qtd: ini, obs: 'Saldo inicial' }); gravarEstoque(estoque); }
    }
    if (!gravarEpis(epis)) return;
    toast(editando ? 'EPI atualizado ✓' : 'EPI cadastrado ✓');
    epiEditando = null;
    telaEpis();
  });
  $('#btnCancelarEpi')?.addEventListener('click', () => { epiEditando = null; telaEpis(); });
  $('#btnImportarEpis')?.addEventListener('click', () => {
    for (const i of usados) epis.push({ id: novoId(), ca: soDigitos(i.ca), nome: i.epi, descricao: i.descricao || '', vidaUtil: 0, estoqueMinimo: 0,
      criadoEm: new Date().toISOString() });
    if (gravarEpis(epis)) { toast(`${usados.length} EPI(s) adicionados. Informe a vida útil de cada um.`); telaEpis(); }
  });

  const desenhar = () => {
    const q = normalizar($('#buscaEpi').value.trim());
    const lista = epis.filter((e) => !q || normalizar(`${e.nome} ${e.ca} ${e.descricao}`).includes(q));
    $('#listaEpis').innerHTML = lista.length ? lista.map((e) => {
      const s = saldoEpi(e, a.entregas, estoque);
      return `<div class="item item-bloco"><div class="item-funcao">
        <div><h3>${esc(e.nome)}</h3>
          <div class="selos">
            ${e.ca ? `<span class="selo">CA ${esc(e.ca)}</span>` : '<span class="selo">sem CA</span>'}
            ${Number(e.vidaUtil) > 0 ? `<span class="selo nr">🔁 troca a cada ${e.vidaUtil} dias</span>` : ''}
            ${s.controla ? `<span class="selo ${s.baixo ? 'pendente' : 'feito'}">estoque ${s.saldo}${Number(e.estoqueMinimo) ? ` · mín. ${e.estoqueMinimo}` : ''}</span>` : '<span class="selo">sem controle de estoque</span>'}
          </div>
          ${e.descricao ? `<p>${esc(e.descricao)}</p>` : ''}</div>
        <div class="acoes-lixo">
          <button class="btn amarelo peq" data-mov="${e.id}">Estoque</button>
          <button class="btn sec peq" data-editar="${e.id}">Editar</button>
          <button class="btn perigo peq" data-remover="${e.id}">Remover</button>
        </div></div><div class="kit" id="mov-${e.id}" hidden></div></div>`;
    }).join('') : `<div class="cartao vazio">${epis.length ? 'Nenhum EPI encontrado.' : 'Nenhum EPI cadastrado ainda. Comece pelo nº do CA acima.'}</div>`;

    app.querySelectorAll('#listaEpis [data-editar]').forEach((b) => b.addEventListener('click', () => { epiEditando = b.dataset.editar; telaEpis(); window.scrollTo(0, 0); }));
    app.querySelectorAll('#listaEpis [data-remover]').forEach((b) => b.addEventListener('click', () => {
      const e = epis.find((x) => x.id === b.dataset.remover);
      if (!confirm(`Remover “${e.nome}” do catálogo? As fichas não mudam, mas as trocas e o estoque deste EPI deixam de ser calculados.`)) return;
      gravarEstoque(estoque.filter((m) => m.epiId !== e.id));
      if (gravarEpis(epis.filter((x) => x.id !== e.id))) { toast('EPI removido do catálogo'); telaEpis(); }
    }));
    app.querySelectorAll('#listaEpis [data-mov]').forEach((b) => b.addEventListener('click', () => abrirEstoque(epis.find((x) => x.id === b.dataset.mov), a, $(`#mov-${b.dataset.mov}`))));
  };
  $('#buscaEpi').addEventListener('input', desenhar);
  desenhar();
}

/** Painel de estoque de um EPI: lançar entrada/ajuste e ver as movimentações. */
function abrirEstoque(e, a, box) {
  if (!box.hidden) { box.hidden = true; return; }
  const estoque = lerEstoque();
  const s = saldoEpi(e, a.entregas, estoque);
  const desde = (e.criadoEm || '').slice(0, 10);
  const movs = [
    ...estoque.filter((m) => m.epiId === e.id).map((m) => ({ data: m.data, qtd: Number(m.qtd), texto: m.obs || (m.qtd > 0 ? 'Entrada' : 'Ajuste'), id: m.id })),
    ...a.entregas.filter((r) => r.epi && r.epi.id === e.id && r.data >= desde).map((r) => ({ data: r.data, qtd: -Number(r.item.qtd || 1), texto: `Entregue a ${r.nome}` })),
  ].sort((x, y) => y.data.localeCompare(x.data));
  box.hidden = false;
  box.innerHTML = `
    <p><b>Saldo atual: ${s.saldo}</b> <span class="dica">· entradas ${s.entradas} · entregas ${s.saidas} (desde ${dataBR(desde)}, quando o EPI foi cadastrado)</span></p>
    <form class="grade-mov">
      <label>Tipo <select name="tipo"><option value="entrada">Entrada (compra)</option><option value="saida">Saída (perda, descarte, ajuste)</option></select></label>
      <label>Quantidade <input type="number" name="qtd" min="1" value="1"></label>
      <label>Data <input type="date" name="data" value="${hoje()}"></label>
      <label>Observação <input type="text" name="obs" maxlength="80" placeholder="Ex.: NF 1234"></label>
      <button class="btn peq" type="submit">Lançar</button>
    </form>
    ${movs.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Movimento</th><th>Qtd.</th><th></th></tr></thead>
      <tbody>${movs.slice(0, 30).map((m) => `<tr><td>${dataBR(m.data)}</td><td>${esc(m.texto)}</td>
        <td class="${m.qtd < 0 ? 'neg' : 'pos'}">${m.qtd > 0 ? '+' : ''}${m.qtd}</td>
        <td>${m.id ? `<button type="button" class="link-acao" data-apagar-mov="${m.id}">apagar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="dica">Nenhuma movimentação ainda.</p>'}`;
  box.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const qtd = Math.abs(Number(f.elements.qtd.value) || 0);
    if (!qtd) { toast('Informe a quantidade.'); return; }
    const lista = lerEstoque();
    lista.push({ id: novoId(), epiId: e.id, data: f.elements.data.value || hoje(), qtd: f.elements.tipo.value === 'saida' ? -qtd : qtd,
      obs: f.elements.obs.value.trim() || (f.elements.tipo.value === 'saida' ? 'Saída / ajuste' : 'Entrada') });
    if (gravarEstoque(lista)) { toast('Movimentação lançada ✓'); telaEpis(); }
  });
  box.querySelectorAll('[data-apagar-mov]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Apagar esta movimentação de estoque?')) return;
    if (gravarEstoque(lerEstoque().filter((m) => m.id !== b.dataset.apagarMov))) { toast('Movimentação apagada'); telaEpis(); }
  }));
}

// ---------- kit de EPIs por função ----------
function nomesDoKit(kit) {
  const epis = lerEpis();
  return kit.map((k) => { const e = epis.find((x) => x.id === k.epiId); return e ? `${esc(e.nome)}${k.qtd > 1 ? ` (${k.qtd})` : ''}` : ''; })
    .filter(Boolean).join(' · ');
}

function abrirEditorKit(funcoes, i, box) {
  if (!box.hidden) { box.hidden = true; return; }
  const fn = funcoes[i];
  const epis = lerEpis();
  box.hidden = false;
  if (!epis.length) {
    box.innerHTML = '<p class="dica">Cadastre primeiro os EPIs em <a href="#/epis">EPIs e estoque</a>; depois escolha aqui quais esta função recebe.</p>';
    return;
  }
  const kit = new Map((fn.kit || []).map((k) => [k.epiId, k.qtd || 1]));
  box.innerHTML = `
    <p class="dica">Marque os EPIs que a função <b>${esc(fn.nome)}</b> recebe. Na ficha, o botão “EPIs da função” adiciona todos de uma vez.</p>
    <div class="kit-lista">${epis.map((e) => `<label class="kit-item">
      <input type="checkbox" data-epi="${e.id}" ${kit.has(e.id) ? 'checked' : ''}>
      <span>${esc(e.nome)}${e.ca ? ` <small class="dica">CA ${esc(e.ca)}</small>` : ''}</span>
      <input type="number" min="1" value="${kit.get(e.id) || 1}" data-qtd="${e.id}" title="Quantidade"></label>`).join('')}</div>
    <div class="barra" style="margin-bottom:0"><button type="button" class="btn peq" data-salvar-kit>Salvar EPIs da função</button></div>`;
  box.querySelector('[data-salvar-kit]').addEventListener('click', () => {
    fn.kit = [...box.querySelectorAll('[data-epi]:checked')].map((c) => ({
      epiId: c.dataset.epi, qtd: Math.max(1, Number(box.querySelector(`[data-qtd="${c.dataset.epi}"]`).value) || 1) }));
    if (gravarFuncoes(funcoes)) { toast(`EPIs da função ${fn.nome} salvos ✓`); telaFuncoes(); }
  });
}

// ---------- backup ----------
function restaurarGestao(dados) {
  const juntar = (atuais, novos, valido) => {
    const ids = new Map(atuais.map((x, i) => [x.id, i]));
    for (const n of Array.isArray(novos) ? novos : []) {
      if (!n || !n.id || !valido(n)) continue;
      if (ids.has(n.id)) atuais[ids.get(n.id)] = n; else atuais.push(n);
    }
    return atuais;
  };
  gravarColaboradores(juntar(lerColaboradores(), dados.colaboradores, (c) => c.nome));
  gravarEpis(juntar(lerEpis(), dados.epis, (e) => e.nome));
  gravarEstoque(juntar(lerEstoque(), dados.estoque, (m) => m.epiId));
}

// ---------- app instalável (PWA) ----------
let pedidoInstalacao = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalacao = e; mostrarBotaoInstalar(); });
function mostrarBotaoInstalar() {
  const b = $('#btnInstalar');
  if (!b || !pedidoInstalacao) return;
  b.hidden = false;
  b.onclick = async () => { pedidoInstalacao.prompt(); await pedidoInstalacao.userChoice; pedidoInstalacao = null; b.hidden = true; };
}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem modo offline, o app funciona normalmente */ });
}

// A primeira tela é aberta por nuvem.js (depois de verificar o login).
