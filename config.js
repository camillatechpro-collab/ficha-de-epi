// Configuração da nuvem (Supabase) — Project Settings › API Keys no painel do Supabase.
//
//  url:   o "Project URL", ex.: https://abcdefghijkl.supabase.co
//  chave: a chave pública ("Publishable key", começa com sb_publishable_ — ou a antiga "anon").
//
// Essa chave é feita para ficar no site: a segurança vem das regras (RLS) do banco,
// que só deixam cada pessoa ver os dados da própria empresa.
// NUNCA coloque aqui a chave secreta (secret / service_role).
//
// Com os dois campos vazios, o app funciona como antes: só no aparelho, sem login.
window.CONFIG_NUVEM = {
  url: '',
  chave: '',
};
