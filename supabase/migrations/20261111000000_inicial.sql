-- =====================================================================
-- Ficha de EPI — estrutura na nuvem (Supabase)
--
--  * contas: uma por empresa. membros: quem acessa cada conta (dono/membro).
--  * convites: o dono convida pelo e-mail; ao entrar, a pessoa entra na conta.
--  * registros: os dados do app (fichas, colaboradores, EPIs, estoque,
--    funções, lixeira) guardados como documentos JSON, um por item.
--  * historico: TODA versão anterior de um registro é guardada aqui
--    (alterações e exclusões), para que nada se perca e possa ser restaurado.
--  * Ninguém apaga registros de verdade pelo app: excluir = marcar excluido.
--  * RLS: cada pessoa só enxerga as contas das quais é membro.
-- =====================================================================

create extension if not exists pgcrypto;

create table public.contas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) > 0),
  criado_por  uuid references auth.users default auth.uid(),
  criado_em   timestamptz not null default now()
);

create table public.membros (
  conta_id   uuid not null references public.contas on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  email      text,
  papel      text not null default 'membro' check (papel in ('dono', 'membro')),
  criado_em  timestamptz not null default now(),
  primary key (conta_id, user_id)
);
create index on public.membros (user_id);

create table public.convites (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references public.contas on delete cascade,
  email       text not null check (email = lower(trim(email)) and email like '%@%'),
  papel       text not null default 'membro' check (papel in ('dono', 'membro')),
  criado_por  uuid references auth.users default auth.uid(),
  criado_em   timestamptz not null default now(),
  aceito_em   timestamptz,
  unique (conta_id, email)
);

create table public.registros (
  conta_id        uuid not null references public.contas on delete cascade,
  tipo            text not null check (tipo in ('fichas', 'lixeira', 'funcoes', 'colaboradores', 'epis', 'estoque')),
  id              text not null,
  dados           jsonb not null,
  excluido        boolean not null default false,
  versao          integer not null default 1,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid default auth.uid(),
  primary key (conta_id, tipo, id)
);
create index on public.registros (conta_id, atualizado_em);

create table public.historico (
  hist_id          bigint generated always as identity primary key,
  conta_id         uuid not null references public.contas on delete cascade,
  tipo             text not null,
  id               text not null,
  dados            jsonb not null,
  excluido         boolean not null,
  versao           integer not null,
  alterado_em      timestamptz not null,   -- quando essa versão foi gravada
  alterado_por     uuid,
  substituido_em   timestamptz not null default now(),
  substituido_por  uuid default auth.uid()
);
create index on public.historico (conta_id, substituido_em desc);
create index on public.historico (conta_id, tipo, id);

-- ---------------------------------------------------------------------
-- Funções de acesso (security definer: evitam recursão nas políticas)
-- ---------------------------------------------------------------------
create or replace function public.e_membro(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where conta_id = c and user_id = auth.uid())
$$;

create or replace function public.e_dono(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where conta_id = c and user_id = auth.uid() and papel = 'dono')
$$;

-- Cria a conta da empresa e coloca quem criou como dono
create or replace function public.criar_conta(p_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'Faça login para criar a conta.'; end if;
  insert into contas (nome) values (trim(p_nome)) returning id into c;
  insert into membros (conta_id, user_id, email, papel)
  values (c, auth.uid(), lower(auth.jwt() ->> 'email'), 'dono');
  return c;
end $$;

-- Entra nas contas para as quais o e-mail da pessoa foi convidado
create or replace function public.aceitar_convites() returns integer
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(auth.jwt() ->> 'email'); n integer := 0; r record;
begin
  if auth.uid() is null or v_email is null then return 0; end if;
  for r in select * from convites where email = v_email and aceito_em is null loop
    insert into membros (conta_id, user_id, email, papel)
    values (r.conta_id, auth.uid(), v_email, r.papel)
    on conflict (conta_id, user_id) do nothing;
    update convites set aceito_em = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Data/hora, autor e versão definidos pelo servidor (base da sincronização)
create or replace function public.registros_antes() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := clock_timestamp();
  new.atualizado_por := auth.uid();
  if tg_op = 'UPDATE' then new.versao := old.versao + 1; end if;
  return new;
end $$;
create trigger registros_antes before insert or update on public.registros
  for each row execute function public.registros_antes();

-- Guarda a versão anterior sempre que algo muda ou é excluído
create or replace function public.registros_historico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.dados is distinct from new.dados or old.excluido is distinct from new.excluido then
    insert into historico (conta_id, tipo, id, dados, excluido, versao, alterado_em, alterado_por)
    values (old.conta_id, old.tipo, old.id, old.dados, old.excluido, old.versao, old.atualizado_em, old.atualizado_por);
  end if;
  return new;
end $$;
create trigger registros_historico after update on public.registros
  for each row execute function public.registros_historico();

-- ---------------------------------------------------------------------
-- Segurança (RLS)
-- ---------------------------------------------------------------------
alter table public.contas    enable row level security;
alter table public.membros   enable row level security;
alter table public.convites  enable row level security;
alter table public.registros enable row level security;
alter table public.historico enable row level security;

create policy contas_ver     on public.contas for select using (public.e_membro(id));
create policy contas_editar  on public.contas for update using (public.e_dono(id)) with check (public.e_dono(id));

create policy membros_ver     on public.membros for select using (public.e_membro(conta_id));
create policy membros_remover on public.membros for delete using (public.e_dono(conta_id) and user_id <> auth.uid());

create policy convites_ver     on public.convites for select using (public.e_membro(conta_id));
create policy convites_criar   on public.convites for insert with check (public.e_dono(conta_id));
create policy convites_remover on public.convites for delete using (public.e_dono(conta_id));

create policy registros_ver     on public.registros for select using (public.e_membro(conta_id));
create policy registros_criar   on public.registros for insert with check (public.e_membro(conta_id));
create policy registros_editar  on public.registros for update using (public.e_membro(conta_id)) with check (public.e_membro(conta_id));
-- sem política de DELETE: registros não são apagados, só marcados como excluídos

create policy historico_ver on public.historico for select using (public.e_membro(conta_id));

-- Só usuários logados acessam; visitantes anônimos não veem nada
revoke all on public.contas, public.membros, public.convites, public.registros, public.historico from anon;
grant select, update on public.contas to authenticated;
grant select, delete on public.membros to authenticated;
grant select, insert, delete on public.convites to authenticated;
grant select, insert, update on public.registros to authenticated;
grant select on public.historico to authenticated;
revoke execute on function public.criar_conta(text), public.aceitar_convites() from public, anon;
grant execute on function public.criar_conta(text), public.aceitar_convites(), public.e_membro(uuid), public.e_dono(uuid) to authenticated;
