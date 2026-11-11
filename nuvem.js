// Ficha de EPI — login, conta da empresa, equipe e sincronização com a nuvem (Supabase).
//
// Como funciona:
//  * O app continua salvando tudo no aparelho (funciona sem internet).
//  * Depois de cada alteração, envia para a nuvem o que mudou e recebe o que a equipe mudou.
//  * No servidor, toda versão anterior fica no histórico: dá para restaurar o que foi alterado ou excluído.
//  * Sem config.js preenchido, nada disso é ativado e o app funciona só no aparelho.
'use strict';

const CFG = window.CONFIG_NUVEM || {};
const nuvemAtiva = Boolean(CFG.url && CFG.chave && window.supabase);
let recuperandoSenha = false;
let sessao = null;
const sb = nuvemAtiva ? window.supabase.createClient(CFG.url, CFG.chave, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
if (sb) {
  sb.auth.onAuthStateChange((evento, s) => {
    sessao = s;
    if (evento === 'PASSWORD_RECOVERY') recuperandoSenha = true;
  });
}

// Dados do app que vão para a nuvem (tipo na nuvem → chave no aparelho)
const TIPOS_SYNC = { fichas: CHAVE, lixeira: CHAVE_LIXEIRA, funcoes: CHAVE_FUNCOES,
  colaboradores: CHAVE_COLAB, epis: CHAVE_EPIS, estoque: CHAVE_ESTOQUE };
const NOMES_TIPO = { fichas: 'Ficha', lixeira: 'Ficha na lixeira', funcoes: 'Função', colaboradores: 'Colaborador', epis: 'EPI', estoque: 'Estoque' };
const CHAVE_NUVEM = 'fichaEpi.nuvem';

let estadoNuvem = lerEstadoNuvem();
let contasDoUsuario = [];
let modoLogin = 'entrar';
let sincronizando = false;
let deNovo = false;
let esperaSync = null;

function lerEstadoNuvem() {
  try { return JSON.parse(localStorage.getItem(CHAVE_NUVEM)) || { espelho: {} }; } catch { return { espelho: {} }; }
}
function salvarEstado() { localStorage.setItem(CHAVE_NUVEM, JSON.stringify(estadoNuvem)); }

/** Usado pelo roteador: com a nuvem ligada, sem login (ou sem conta escolhida) só a tela de login abre. */
// Sem internet, quem já entrou neste aparelho continua usando a conta (sincroniza quando a conexão voltar).
function precisaLogin() {
  return nuvemAtiva && (recuperandoSenha || !estadoNuvem.contaId || (!sessao && (navigator.onLine || !estadoNuvem.userId)));
}

const urlApp = () => location.origin + location.pathname;
const lerLista = (chave) => { try { return JSON.parse(localStorage.getItem(chave)) || []; } catch { return []; } };

/** Resumo curto (hash) de um item, para saber o que mudou desde a última sincronização. */
function resumo(obj) {
  const s = JSON.stringify(obj);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function traduzirErro(e) {
  const m = (e && (e.message || e.error_description)) || String(e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/User already registered/i.test(m)) return 'Este e-mail já tem cadastro. Use "Entrar" ou "Esqueci minha senha".';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sem conexão com a internet.';
  if (/duplicate key|unique/i.test(m)) return 'Esse registro já existe.';
  return m || 'Erro desconhecido.';
}

// ---------- início ----------
async function iniciarApp() {
  if (!nuvemAtiva) { rotear(); return; }
  desenharStatus('carregando');
  try {
    const { data } = await sb.auth.getSession(); // também conclui o login vindo de link do e-mail
    sessao = data.session;
  } catch { /* sem internet: segue com o que estiver salvo */ }
  mostrarErroDoLink();
  if (sessao && !recuperandoSenha) await prepararConta();
  rotear();
  if (!precisaLogin()) sincronizar();
}

/** Links do e-mail (confirmação, nova senha) voltam com ?code=...; limpa a barra de endereço. */
function mostrarErroDoLink() {
  const q = new URLSearchParams(location.search);
  const erro = q.get('error_description');
  if (q.has('code') || q.has('error') || erro) history.replaceState(null, '', location.pathname + location.hash);
  if (erro) setTimeout(() => toast(`Link inválido ou expirado: ${erro}`), 300);
}

/** Depois do login: entra nas contas para as quais foi convidado e escolhe a conta. */
async function prepararConta() {
  if (estadoNuvem.userId && estadoNuvem.userId !== sessao.user.id) {
    // Outra pessoa usou este aparelho antes: não mistura os dados
    limparDadosLocais();
    estadoNuvem = { espelho: {} };
  }
  estadoNuvem.userId = sessao.user.id;
  salvarEstado();
  try {
    await sb.rpc('aceitar_convites');
    const { data, error } = await sb.from('membros').select('conta_id, papel, contas(nome)').eq('user_id', sessao.user.id);
    if (error) throw error;
    contasDoUsuario = data.map((m) => ({ id: m.conta_id, papel: m.papel, nome: m.contas ? m.contas.nome : 'Conta' }));
  } catch {
    return; // sem internet: se já tinha conta escolhida, continua offline
  }
  if (estadoNuvem.contaId && !contasDoUsuario.some((c) => c.id === estadoNuvem.contaId)) {
    toast('Você não faz mais parte da conta anterior.');
    limparDadosLocais();
    estadoNuvem = { espelho: {}, userId: sessao.user.id };
    salvarEstado();
  }
  const atualConta = contasDoUsuario.find((c) => c.id === estadoNuvem.contaId);
  if (atualConta) { estadoNuvem.contaNome = atualConta.nome; estadoNuvem.papel = atualConta.papel; salvarEstado(); }
  if (!estadoNuvem.contaId && contasDoUsuario.length === 1) await entrarNaConta(contasDoUsuario[0]);
}

const haDadosLocais = () => Object.values(TIPOS_SYNC).some((k) => lerLista(k).length);

function limparDadosLocais() {
  for (const k of Object.values(TIPOS_SYNC)) localStorage.removeItem(k);
}

async function entrarNaConta(conta) {
  if (haDadosLocais() && !estadoNuvem.contaId) {
    const enviar = confirm(`Este aparelho tem dados salvos antes do login.\n\nOK: enviar esses dados para a conta “${conta.nome}”.\nCancelar: baixar um backup deles e começar só com os dados da conta.`);
    if (!enviar) { fazerBackup(); limparDadosLocais(); }
  }
  Object.assign(estadoNuvem, { contaId: conta.id, contaNome: conta.nome, papel: conta.papel, cursor: null, espelho: {} });
  salvarEstado();
}

// ---------- sincronização ----------
/** O que mudou no aparelho desde a última sincronização. */
function mudancasLocais() {
  const out = [];
  for (const [tipo, chave] of Object.entries(TIPOS_SYNC)) {
    const esp = estadoNuvem.espelho[tipo] || {};
    const atuais = new Map(lerLista(chave).filter((x) => x && x.id).map((x) => [String(x.id), x]));
    const mudou = [...atuais].filter(([id, x]) => esp[id] !== resumo(x));
    const sumiu = Object.keys(esp).filter((id) => !atuais.has(id));
    if (mudou.length || sumiu.length) out.push({ tipo, mudou, sumiu });
  }
  return out;
}
const totalPendente = () => mudancasLocais().reduce((s, m) => s + m.mudou.length + m.sumiu.length, 0);

async function enviar() {
  const conta = estadoNuvem.contaId;
  for (const { tipo, mudou, sumiu } of mudancasLocais()) {
    const esp = (estadoNuvem.espelho[tipo] = estadoNuvem.espelho[tipo] || {});
    for (let i = 0; i < mudou.length; i += 40) {
      const lote = mudou.slice(i, i + 40);
      const { error } = await sb.from('registros').upsert(
        lote.map(([id, dados]) => ({ conta_id: conta, tipo, id, dados, excluido: false })), { onConflict: 'conta_id,tipo,id' });
      if (error) throw error;
      for (const [id, dados] of lote) esp[id] = resumo(dados);
      salvarEstado();
    }
    for (let i = 0; i < sumiu.length; i += 100) {
      const lote = sumiu.slice(i, i + 100);
      const { error } = await sb.from('registros').update({ excluido: true }).eq('conta_id', conta).eq('tipo', tipo).in('id', lote);
      if (error) throw error;
      for (const id of lote) delete esp[id];
      salvarEstado();
    }
  }
}

async function receber() {
  const conta = estadoNuvem.contaId;
  // Volta 2 minutos para não perder gravações que terminaram fora de ordem
  const desde = estadoNuvem.cursor ? new Date(new Date(estadoNuvem.cursor).getTime() - 120000).toISOString() : '1970-01-01T00:00:00Z';
  const linhas = [];
  for (let pag = 0; ; pag++) {
    const { data, error } = await sb.from('registros').select('tipo, id, dados, excluido, atualizado_em')
      .eq('conta_id', conta).gt('atualizado_em', desde).order('atualizado_em').range(pag * 500, pag * 500 + 499);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < 500) break;
  }
  if (!linhas.length) return 0;

  const listas = {};
  let mudou = 0;
  let cursor = estadoNuvem.cursor;
  for (const r of linhas) {
    if (!cursor || r.atualizado_em > cursor) cursor = r.atualizado_em;
    const chave = TIPOS_SYNC[r.tipo];
    if (!chave) continue;
    const lista = (listas[r.tipo] = listas[r.tipo] || lerLista(chave));
    const esp = (estadoNuvem.espelho[r.tipo] = estadoNuvem.espelho[r.tipo] || {});
    const i = lista.findIndex((x) => String(x.id) === r.id);
    const local = i >= 0 ? lista[i] : null;
    if (local && esp[r.id] !== undefined && resumo(local) !== esp[r.id]) continue; // alterado aqui e ainda não enviado: vale o daqui
    if (r.excluido) {
      if (i >= 0) { lista.splice(i, 1); mudou++; }
      delete esp[r.id];
    } else {
      if (!local || resumo(local) !== resumo(r.dados)) mudou++;
      if (i >= 0) lista[i] = r.dados; else lista.push(r.dados);
      esp[r.id] = resumo(r.dados);
    }
  }
  for (const [tipo, lista] of Object.entries(listas)) {
    if (['funcoes', 'colaboradores', 'epis'].includes(tipo)) lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    localStorage.setItem(TIPOS_SYNC[tipo], JSON.stringify(lista)); // direto, sem avisar alteração (não é mudança local)
  }
  estadoNuvem.cursor = cursor;
  salvarEstado();
  return mudou;
}

async function sincronizar(manual) {
  if (!nuvemAtiva || precisaLogin()) return;
  if (sincronizando) { deNovo = true; return; }
  if (!navigator.onLine) { desenharStatus('offline'); return; }
  if (!sessao) {
    // Abriu sem internet: renova a sessão agora que voltou a conexão
    try { sessao = (await sb.auth.getSession()).data.session; } catch { /* ignora */ }
    if (!sessao) { toast('Sua sessão expirou. Entre de novo para enviar as alterações.'); rotear(); return; }
  }
  sincronizando = true;
  desenharStatus('sincronizando');
  try {
    await enviar();
    const recebidos = await receber();
    estadoNuvem.ultimaSync = new Date().toISOString();
    salvarEstado();
    desenharStatus('ok');
    if (recebidos) aoReceber(recebidos);
    if (manual) toast('Tudo salvo na nuvem ✓');
  } catch (e) {
    console.error('Sincronização:', e);
    desenharStatus(navigator.onLine ? 'erro' : 'offline', traduzirErro(e));
    if (manual) toast(`Não foi possível sincronizar: ${traduzirErro(e)}`);
  } finally {
    sincronizando = false;
    if (deNovo) { deNovo = false; setTimeout(sincronizar, 400); }
  }
}

/** Chegaram dados da equipe: atualiza a tela, menos quando alguém está editando ou assinando. */
function aoReceber(n) {
  const rota = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (['ficha', 'nova', 'assinar'].includes(rota)) { toast(`${n} atualização(ões) recebida(s) da equipe`); return; }
  const y = window.scrollY;
  rotear();
  window.scrollTo(0, y);
}

if (nuvemAtiva) {
  window.addEventListener('dados-alterados', () => {
    if (precisaLogin()) return;
    desenharStatus('pendente');
    clearTimeout(esperaSync);
    esperaSync = setTimeout(sincronizar, 1500);
  });
  window.addEventListener('online', () => sincronizar());
  window.addEventListener('offline', () => desenharStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
  setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 60000);
}

function desenharStatus(estado, detalhe) {
  const el = $('#statusNuvem');
  if (!el) return;
  el.hidden = !nuvemAtiva || precisaLogin();
  const textos = {
    carregando: '⏳ Conectando…', sincronizando: '⏳ Salvando…', pendente: '⏳ Alterações a enviar',
    ok: '☁️ Salvo na nuvem', offline: '📴 Sem internet: salvo no aparelho', erro: '⚠️ Erro ao salvar',
  };
  el.textContent = textos[estado] || '';
  el.className = `status-nuvem ${estado}`;
  el.title = detalhe || (estado === 'ok' && estadoNuvem.ultimaSync ? `Última sincronização: ${dataHoraBR(estadoNuvem.ultimaSync)}` : '');
}

// ---------- tela de login ----------
function telaLogin() {
  document.body.classList.add('sem-login');
  desenharStatus('');
  if (recuperandoSenha) modoLogin = 'nova-senha';
  else if (sessao) { telaEscolherConta(); return; }

  const titulos = { entrar: 'Entrar', criar: 'Criar acesso', esqueci: 'Recuperar senha', 'nova-senha': 'Definir nova senha' };
  app.innerHTML = `
    <div class="login">
      <div class="login-marca"><img src="icons/icon.svg" alt="" width="56" height="56"><div>Ficha de <b>EPI</b><small>Controle de entrega de EPI — NR-06</small></div></div>
      <section class="cartao">
        <h2>${titulos[modoLogin]}</h2>
        <form id="formLogin" novalidate>
          ${modoLogin !== 'nova-senha' ? '<label>E-mail <input type="text" name="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"></label>' : ''}
          ${modoLogin !== 'esqueci' ? `<label>${modoLogin === 'nova-senha' ? 'Nova senha' : 'Senha'}
            <input type="password" name="senha" autocomplete="${modoLogin === 'entrar' ? 'current-password' : 'new-password'}"></label>` : ''}
          ${modoLogin === 'criar' || modoLogin === 'nova-senha' ? '<label>Repita a senha <input type="password" name="senha2" autocomplete="new-password"></label><p class="dica" style="margin-top:-6px">Mínimo de 8 caracteres.</p>' : ''}
          <p id="msgLogin" class="erro" hidden></p>
          <button class="btn" type="submit" style="width:100%;justify-content:center">${{ entrar: 'Entrar', criar: 'Criar acesso', esqueci: 'Enviar link por e-mail', 'nova-senha': 'Salvar nova senha' }[modoLogin]}</button>
        </form>
        <div class="login-links">
          ${modoLogin === 'entrar' ? '<a href="#" data-modo="criar">Criar acesso</a><a href="#" data-modo="esqueci">Esqueci minha senha</a>'
            : modoLogin === 'nova-senha' ? '' : '<a href="#" data-modo="entrar">Já tenho acesso: entrar</a>'}
        </div>
      </section>
      <p class="dica" style="text-align:center">Seus dados ficam guardados na nuvem com cópia de segurança e histórico de alterações.</p>
    </div>`;

  app.querySelectorAll('[data-modo]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); modoLogin = a.dataset.modo; telaLogin(); }));
  const form = $('#formLogin');
  form.querySelector('input')?.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = (t, ok) => { const m = $('#msgLogin'); m.textContent = t; m.className = ok ? 'ok-msg' : 'erro'; m.hidden = false; };
    const email = (form.elements.email?.value || '').trim().toLowerCase();
    const senha = form.elements.senha?.value || '';
    if (modoLogin !== 'nova-senha' && !/^\S+@\S+\.\S+$/.test(email)) return msg('Informe um e-mail válido.');
    if ((modoLogin === 'criar' || modoLogin === 'nova-senha') && senha.length < 8) return msg('A senha precisa ter pelo menos 8 caracteres.');
    if ((modoLogin === 'criar' || modoLogin === 'nova-senha') && senha !== form.elements.senha2.value) return msg('As senhas não são iguais.');
    if (modoLogin === 'entrar' && !senha) return msg('Informe a senha.');
    const botao = form.querySelector('button');
    botao.disabled = true;
    try {
      if (modoLogin === 'entrar') {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        sessao = data.session;
        await prepararConta();
        rotear();
        sincronizar();
      } else if (modoLogin === 'criar') {
        const { data, error } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: urlApp() } });
        if (error) throw error;
        if (data.session) { sessao = data.session; await prepararConta(); rotear(); return; }
        msg(`Enviamos um link de confirmação para ${email}. Abra o e-mail, clique no link e depois entre com sua senha.`, true);
      } else if (modoLogin === 'esqueci') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: urlApp() });
        if (error) throw error;
        msg(`Se ${email} tiver cadastro, você vai receber um link para criar uma nova senha.`, true);
      } else {
        const { error } = await sb.auth.updateUser({ password: senha });
        if (error) throw error;
        recuperandoSenha = false;
        modoLogin = 'entrar';
        toast('Senha alterada ✓');
        await prepararConta();
        rotear();
        sincronizar();
      }
    } catch (err) {
      msg(traduzirErro(err));
    } finally {
      botao.disabled = false;
    }
  });
}

/** Logado, mas ainda sem conta da empresa escolhida. */
function telaEscolherConta() {
  app.innerHTML = `
    <div class="login">
      <div class="login-marca"><img src="icons/icon.svg" alt="" width="56" height="56"><div>Ficha de <b>EPI</b><small>${esc(sessao.user.email)}</small></div></div>
      ${contasDoUsuario.length ? `<section class="cartao"><h2>Escolha a conta</h2>
        ${contasDoUsuario.map((c, i) => `<button class="btn sec conta-opcao" data-conta="${i}">${esc(c.nome)} <small>${c.papel === 'dono' ? 'dono' : 'membro'}</small></button>`).join('')}
      </section>` : ''}
      <section class="cartao">
        <h2>${contasDoUsuario.length ? 'Ou crie outra conta' : 'Crie a conta da sua empresa'}</h2>
        <form id="formConta" novalidate>
          <label>Nome da empresa <input type="text" name="nome" maxlength="120" placeholder="Ex.: Construtora Exemplo Ltda"></label>
          <p id="msgConta" class="erro" hidden></p>
          <button class="btn" type="submit" style="width:100%;justify-content:center">Criar conta</button>
        </form>
        <p class="dica">Foi convidado por alguém? Peça para convidar <b>${esc(sessao.user.email)}</b> e entre de novo:
          você vai direto para a conta da empresa.</p>
      </section>
      <div class="barra" style="justify-content:center"><button class="btn sec peq" id="btnSairLogin">Sair</button></div>
    </div>`;
  app.querySelectorAll('[data-conta]').forEach((b) => b.addEventListener('click', async () => {
    await entrarNaConta(contasDoUsuario[b.dataset.conta]);
    rotear();
    sincronizar();
  }));
  $('#formConta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = e.target.elements.nome.value.trim();
    const m = $('#msgConta');
    if (!nome) { m.textContent = 'Informe o nome da empresa.'; m.hidden = false; return; }
    e.target.querySelector('button').disabled = true;
    const { data, error } = await sb.rpc('criar_conta', { p_nome: nome });
    if (error) { m.textContent = traduzirErro(error); m.hidden = false; e.target.querySelector('button').disabled = false; return; }
    const conta = { id: data, nome, papel: 'dono' };
    contasDoUsuario.push(conta);
    await entrarNaConta(conta);
    toast('Conta criada ✓');
    rotear();
    sincronizar();
  });
  $('#btnSairLogin').addEventListener('click', sair);
}

async function sair() {
  if (estadoNuvem.contaId) {
    if (navigator.onLine) await sincronizar();
    const pend = totalPendente();
    if (pend && !confirm(`${pend} alteração(ões) ainda não foram enviadas para a nuvem (sem internet).\n\nSe sair agora, vou baixar um backup delas antes. Sair mesmo assim?`)) return;
    if (pend) fazerBackup();
  }
  try { await sb.auth.signOut(); } catch { /* sem internet: encerra só aqui */ }
  sessao = null;
  limparDadosLocais(); // dados da empresa não ficam no aparelho depois de sair
  estadoNuvem = { espelho: {} };
  salvarEstado();
  contasDoUsuario = [];
  modoLogin = 'entrar';
  location.hash = '#/';
  rotear();
}

// ---------- tela: conta e equipe ----------
async function telaConta() {
  if (!nuvemAtiva) { location.hash = '#/backup'; return; }
  if (!sessao) {
    app.innerHTML = '<div class="cartao vazio">Sem internet. A conta e a equipe aparecem quando a conexão voltar; enquanto isso, tudo continua salvo no aparelho.</div>';
    return;
  }
  const dono = estadoNuvem.papel === 'dono';
  const pend = totalPendente();
  app.innerHTML = `
    <a href="#/backup" class="voltar">← Dados</a>
    <div class="saudacao"><div><h1>Conta e equipe</h1><p class="data">${esc(estadoNuvem.contaNome || '')}</p></div></div>

    <section class="cartao">
      <h2>Sua conta</h2>
      <p style="margin-top:0"><b>${esc(sessao.user.email)}</b> · ${dono ? 'dono da conta' : 'membro da equipe'}</p>
      <p class="dica">${pend ? `⏳ ${pend} alteração(ões) aguardando envio.` : '☁️ Tudo salvo na nuvem.'}
        ${estadoNuvem.ultimaSync ? `Última sincronização: ${dataHoraBR(estadoNuvem.ultimaSync)}.` : ''}</p>
      <div class="barra" style="margin-bottom:0">
        <button class="btn" id="btnSync">🔄 Sincronizar agora</button>
        ${contasDoUsuario.length > 1 ? '<button class="btn sec" id="btnTrocarConta">Trocar de conta</button>' : ''}
        <button class="btn perigo" id="btnSair">Sair</button>
      </div>
      ${dono ? `<form id="formNomeConta" class="grade-funcao" style="margin-top:14px">
        <label>Nome da empresa <input type="text" name="nome" maxlength="120" value="${esc(estadoNuvem.contaNome || '')}"></label>
        <span></span><button class="btn sec" type="submit">Salvar nome</button></form>` : ''}
    </section>

    <section class="cartao">
      <h2>Equipe</h2>
      <div id="equipe"><p class="dica">Carregando…</p></div>
      ${dono ? `<form id="formConvite" class="grade-funcao" style="margin-top:12px">
        <label>Convidar pelo e-mail <input type="text" name="email" inputmode="email" autocapitalize="off" placeholder="pessoa@empresa.com.br"></label>
        <label>Papel <select name="papel"><option value="membro">Membro</option><option value="dono">Dono (pode convidar)</option></select></label>
        <button class="btn" type="submit">Convidar</button></form>
        <p class="dica">A pessoa cria o acesso com esse e-mail em <b>${esc(urlApp())}</b> e entra direto na conta da empresa.</p>` : ''}
    </section>

    <section class="cartao">
      <h2>Histórico e cópia de segurança</h2>
      <p class="dica" style="margin-top:0">Tudo fica guardado na nuvem. Cada alteração ou exclusão guarda a versão anterior aqui, e você pode restaurá-la.
        Também dá para <a href="#/backup">baixar um backup completo</a> a qualquer momento.</p>
      <div id="historico"><p class="dica">Carregando…</p></div>
    </section>`;

  $('#btnSync').addEventListener('click', async () => { await sincronizar(true); telaConta(); });
  $('#btnSair').addEventListener('click', sair);
  $('#btnTrocarConta')?.addEventListener('click', async () => {
    if (navigator.onLine) await sincronizar();
    if (totalPendente()) { toast('Ainda há alterações sem enviar. Conecte-se à internet antes de trocar de conta.'); return; }
    limparDadosLocais();
    estadoNuvem = { espelho: {}, userId: sessao.user.id };
    salvarEstado();
    location.hash = '#/';
    rotear();
  });
  $('#formNomeConta')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = e.target.elements.nome.value.trim();
    if (!nome) return;
    const { error } = await sb.from('contas').update({ nome }).eq('id', estadoNuvem.contaId);
    if (error) { toast(traduzirErro(error)); return; }
    estadoNuvem.contaNome = nome;
    salvarEstado();
    toast('Nome da conta atualizado ✓');
  });
  $('#formConvite')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target.elements.email.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Informe um e-mail válido.'); return; }
    const { error } = await sb.from('convites').insert({ conta_id: estadoNuvem.contaId, email, papel: e.target.elements.papel.value });
    if (error) { toast(/duplicate|unique/i.test(error.message) ? 'Esse e-mail já foi convidado.' : traduzirErro(error)); return; }
    toast(`Convite registrado para ${email} ✓`);
    telaConta();
  });

  // Equipe e histórico vêm da nuvem
  if (!navigator.onLine) {
    $('#equipe').innerHTML = $('#historico').innerHTML = '<p class="dica">Sem internet. Conecte-se para ver a equipe e o histórico.</p>';
    return;
  }
  const conta = estadoNuvem.contaId;
  const [{ data: membros }, { data: convites }, { data: hist }] = await Promise.all([
    sb.from('membros').select('user_id, email, papel, criado_em').eq('conta_id', conta).order('criado_em'),
    sb.from('convites').select('id, email, papel, criado_em').eq('conta_id', conta).is('aceito_em', null).order('criado_em'),
    sb.from('historico').select('hist_id, tipo, id, dados, excluido, alterado_em, alterado_por, substituido_em, substituido_por')
      .eq('conta_id', conta).order('substituido_em', { ascending: false }).limit(40),
  ]);
  if (!$('#equipe')) return; // saiu da tela enquanto carregava
  const emailDe = (uid) => (membros || []).find((m) => m.user_id === uid)?.email || 'alguém';
  $('#equipe').innerHTML = `
    ${(membros || []).map((m) => `<div class="pendencia-linha"><span class="selo ${m.papel === 'dono' ? 'nr' : ''}">${m.papel}</span>
      ${esc(m.email || '')}${m.user_id === sessao.user.id ? ' <span class="dica">(você)</span>' : ''}
      ${dono && m.user_id !== sessao.user.id ? `<button class="link-acao" data-remover-membro="${m.user_id}">remover</button>` : ''}</div>`).join('')}
    ${(convites || []).map((c) => `<div class="pendencia-linha"><span class="selo">convite pendente</span> ${esc(c.email)}
      ${dono ? `<button class="link-acao" data-cancelar-convite="${c.id}">cancelar</button>` : ''}</div>`).join('')}`;
  $('#equipe').querySelectorAll('[data-remover-membro]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover esta pessoa da conta? Ela perde o acesso aos dados da empresa.')) return;
    const { error } = await sb.from('membros').delete().eq('conta_id', conta).eq('user_id', b.dataset.removerMembro);
    if (error) toast(traduzirErro(error)); else { toast('Pessoa removida da conta'); telaConta(); }
  }));
  $('#equipe').querySelectorAll('[data-cancelar-convite]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await sb.from('convites').delete().eq('id', b.dataset.cancelarConvite);
    if (error) toast(traduzirErro(error)); else { toast('Convite cancelado'); telaConta(); }
  }));

  const descrever = (h) => {
    const d = h.dados || {};
    return esc(d.colaborador || d.nome || d.obs || h.id);
  };
  $('#historico').innerHTML = hist && hist.length ? `<div class="rolagem"><table class="tabela">
      <thead><tr><th>Quando</th><th>O quê</th><th>Versão anterior de</th><th></th></tr></thead>
      <tbody>${hist.map((h, i) => `<tr>
        <td>${dataHoraBR(h.substituido_em)}<br><small class="dica">por ${esc(emailDe(h.substituido_por))}</small></td>
        <td>${NOMES_TIPO[h.tipo] || h.tipo}: <b>${descrever(h)}</b></td>
        <td>${dataHoraBR(h.alterado_em)}<br><small class="dica">por ${esc(emailDe(h.alterado_por))}</small></td>
        <td>${h.excluido ? '' : `<button class="btn sec peq" data-restaurar-hist="${i}">Restaurar</button>`}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="dica">Nenhuma alteração registrada ainda.</p>';
  $('#historico').querySelectorAll('[data-restaurar-hist]').forEach((b) => b.addEventListener('click', async () => {
    const h = hist[b.dataset.restaurarHist];
    if (!confirm(`Restaurar esta versão de “${(h.dados && (h.dados.colaborador || h.dados.nome)) || h.id}”? A versão atual também fica guardada no histórico.`)) return;
    if (h.tipo === 'fichas') {
      // Se a ficha está na lixeira, tira de lá para não ficar duplicada
      await sb.from('registros').update({ excluido: true }).eq('conta_id', conta).eq('tipo', 'lixeira').eq('id', h.id);
    }
    const { error } = await sb.from('registros').upsert({ conta_id: conta, tipo: h.tipo, id: h.id, dados: h.dados, excluido: false }, { onConflict: 'conta_id,tipo,id' });
    if (error) { toast(traduzirErro(error)); return; }
    await sincronizar();
    toast('Versão restaurada ✓');
    telaConta();
  }));
}

/** Cartão exibido na tela de Dados. */
function cartaoNuvem() {
  if (!nuvemAtiva || !estadoNuvem.contaId) return '';
  if (!sessao) return '<section class="cartao"><h2>Nuvem</h2><p class="dica" style="margin:0">📴 Sem internet: as alterações estão salvas no aparelho e serão enviadas quando a conexão voltar.</p></section>';
  return `<section class="cartao">
      <h2>Nuvem</h2>
      <p class="dica" style="margin-top:0">Conectado como <b>${esc(sessao.user.email)}</b> na conta <b>${esc(estadoNuvem.contaNome || '')}</b>.
        Os dados são salvos na nuvem automaticamente, com histórico de alterações.</p>
      <a class="btn" href="#/conta">👤 Conta, equipe e histórico</a>
    </section>`;
}

iniciarApp();
