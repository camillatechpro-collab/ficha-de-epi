// Service worker: deixa o app funcionando sem internet depois do primeiro acesso.
// Ao publicar uma versão nova, troque o número em VERSAO.
const VERSAO = 'ficha-epi-v6';
const ARQUIVOS = ['./', 'index.html', 'style.css', 'app.js', 'gestao.js', 'config.js', 'nuvem.js', 'vendor/supabase.js', 'manifest.webmanifest', 'icons/icon.svg'];
const BASE_CA = 'data/cas.js';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Base de CAs (grande): usa a cópia guardada e atualiza em segundo plano
  if (url.pathname.endsWith(BASE_CA)) {
    e.respondWith(caches.open(VERSAO).then(async (c) => {
      const guardado = await c.match(e.request);
      const rede = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => guardado);
      return guardado || rede;
    }));
    return;
  }

  // Demais arquivos: tenta a internet primeiro (versão mais nova) e usa a cópia quando estiver sem conexão
  e.respondWith(fetch(e.request)
    .then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
