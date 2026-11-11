// Atualiza a base de CAs válidos usada para preencher os EPIs automaticamente.
//
//   node atualizar-base-ca.js                 baixa a base oficial do CAEPI e gera data/cas.js
//   node atualizar-base-ca.js arquivo.txt     usa um tgg_export_caepi.txt já baixado
//
// Fonte: base pública de Certificados de Aprovação do Ministério do Trabalho (CAEPI).
// Usa apenas o curl e o tar que já vêm no Windows 10/11 — nenhuma instalação extra.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const URL_BASE = 'ftp://ftp.mtps.gov.br/portal/fiscalizacao/seguranca-e-saude-no-trabalho/caepi/tgg_export_caepi.zip';
const SAIDA = path.join(__dirname, 'data', 'cas.js');
const MAX_DESC = 400; // corta descrições muito longas para a base ficar leve

function baixar() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'caepi-'));
  const zip = path.join(pasta, 'base.zip');
  console.log('Baixando a base do CAEPI (cerca de 8 MB)...');
  execFileSync('curl', ['-sS', '-f', '-m', '300', '-o', zip, URL_BASE], { stdio: 'inherit' });
  // O tar do Windows (bsdtar) também abre arquivos .zip
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', zip, '-C', pasta], { stdio: 'inherit' });
  const txt = fs.readdirSync(pasta).find((f) => f.toLowerCase().endsWith('.txt'));
  if (!txt) throw new Error('O arquivo baixado não tem o .txt esperado.');
  return { arquivo: path.join(pasta, txt), pasta };
}

const limpar = (t) => (t || '').replace(/\s+/g, ' ').trim();
const iso = (br) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

function gerar(arquivo) {
  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/);
  const cab = linhas[0].split('|').map((c) => c.trim().toUpperCase());
  const col = (nome) => { const i = cab.indexOf(nome); if (i < 0) throw new Error(`Coluna "${nome}" não encontrada — o formato da base mudou.`); return i; };
  const C = { ca: col('NR REGISTRO CA'), val: col('DATA DE VALIDADE'), sit: col('SITUACAO'), fab: col('RAZAO SOCIAL'),
    eq: col('EQUIPAMENTO'), desc: col('DESCRICAO EQUIPAMENTO'), ref: col('REFERENCIA') };
  // Obs.: a coluna "MARCA CA" da base diz onde o CA está marcado no EPI, não a marca do produto — não é usada.
  const hoje = new Date().toISOString().slice(0, 10);
  const cas = new Map();

  // Algumas descrições têm quebra de linha: junta as linhas até completar todas as colunas
  let buf = '';
  for (const l of linhas.slice(1)) {
    buf = buf ? `${buf} ${l}` : l;
    const c = buf.split('|');
    if (c.length < cab.length) continue;
    buf = '';
    if (!/^V[AÁ]LIDO$/i.test(limpar(c[C.sit]))) continue;
    const validade = iso(limpar(c[C.val]));
    if (!validade || validade < hoje) continue; // só CAs dentro da validade
    const ca = limpar(c[C.ca]);
    if (!ca || cas.has(ca)) continue; // o mesmo CA se repete por laudo/norma
    let desc = limpar(c[C.desc]);
    if (desc.length > MAX_DESC) desc = desc.slice(0, MAX_DESC).replace(/\s\S*$/, '') + '…';
    cas.set(ca, [validade, limpar(c[C.eq]), desc, limpar(c[C.fab]), limpar(c[C.ref])]);
  }
  if (cas.size < 1000) throw new Error(`Só ${cas.size} CAs válidos encontrados — a base parece incompleta. Nada foi alterado.`);

  const dataBase = fs.statSync(arquivo).mtime.toISOString().slice(0, 10);
  const js = '// Gerado por atualizar-base-ca.js — não editar à mão.\n' +
    '// Campos: CA -> [validade, equipamento, descrição, fabricante, referência]\n' +
    `window.BASE_CA = ${JSON.stringify({ gerada: hoje, dataBase, total: cas.size, cas: Object.fromEntries(cas) })};\n`;
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, js);
  console.log(`Pronto: ${cas.size} CAs válidos salvos em data/cas.js (${(js.length / 1048576).toFixed(1)} MB). Base do CAEPI de ${dataBase.split('-').reverse().join('/')}.`);
}

try {
  if (process.argv[2]) gerar(process.argv[2]);
  else {
    const { arquivo, pasta } = baixar();
    try { gerar(arquivo); } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
  }
} catch (e) {
  console.error('Erro: ' + e.message);
  process.exit(1);
}
