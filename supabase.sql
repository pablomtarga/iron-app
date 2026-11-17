-- IRON · Configuração do banco (cole tudo no SQL Editor do Supabase e rode)
-- v30: pode rodar de novo sem erro; o que já existe é pulado ou recriado igual.

-- Tabela: uma linha por usuário com todos os dados do app
create table if not exists public.workout_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Segurança: cada usuário só enxerga e mexe nos próprios dados
alter table public.workout_data enable row level security;

drop policy if exists "ler proprios dados" on public.workout_data;
create policy "ler proprios dados" on public.workout_data
  for select using (auth.uid() = user_id);

drop policy if exists "criar proprios dados" on public.workout_data;
create policy "criar proprios dados" on public.workout_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "atualizar proprios dados" on public.workout_data;
create policy "atualizar proprios dados" on public.workout_data
  for update using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- v24: endurecimento da tabela
-- ------------------------------------------------------------
-- O dado de cada usuário precisa ser um objeto JSON e ter no máximo 5 MB.
do $$ begin
  alter table public.workout_data
    add constraint workout_data_payload_objeto check (jsonb_typeof(payload) = 'object');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.workout_data
    add constraint workout_data_payload_tamanho check (octet_length(payload::text) <= 5242880);
exception when duplicate_object then null; end $$;

-- O app só usa usuário logado: o papel anon não precisa de nenhuma permissão na tabela,
-- e o usuário logado só precisa de SELECT, INSERT e UPDATE (o app faz upsert).
revoke all on table public.workout_data from anon;
revoke delete, truncate, references, trigger on table public.workout_data from authenticated;

-- Para desfazer:
--   alter table public.workout_data drop constraint workout_data_payload_objeto, drop constraint workout_data_payload_tamanho;
--   grant all on table public.workout_data to anon;
--   grant delete, truncate, references, trigger on table public.workout_data to authenticated;

-- ------------------------------------------------------------
-- v30 (obrigatório para a App Store): o próprio usuário pode excluir a conta
-- ------------------------------------------------------------
-- O botão "Excluir conta" do app chama esta função. Ela apaga só o usuário logado
-- (auth.uid()); o ON DELETE CASCADE da tabela leva junto os treinos dele.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
-- Para desfazer: drop function public.delete_my_account();
