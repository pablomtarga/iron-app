-- IRON · Configuração do banco (rode isso 1 vez no SQL Editor do Supabase)

-- Tabela: uma linha por usuário com todos os dados do app
create table if not exists public.workout_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Segurança: cada usuário só enxerga e mexe nos próprios dados
alter table public.workout_data enable row level security;

create policy "ler proprios dados" on public.workout_data
  for select using (auth.uid() = user_id);

create policy "criar proprios dados" on public.workout_data
  for insert with check (auth.uid() = user_id);

create policy "atualizar proprios dados" on public.workout_data
  for update using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- v24 (recomendado, rode uma vez): endurecimento da tabela
-- ------------------------------------------------------------
-- O dado de cada usuário precisa ser um objeto JSON e ter no máximo 5 MB.
alter table public.workout_data
  add constraint workout_data_payload_objeto check (jsonb_typeof(payload) = 'object'),
  add constraint workout_data_payload_tamanho check (octet_length(payload::text) <= 5242880);

-- O app só usa usuário logado: o papel anon não precisa de nenhuma permissão na tabela,
-- e o usuário logado só precisa de SELECT, INSERT e UPDATE (o app faz upsert).
revoke all on table public.workout_data from anon;
revoke delete, truncate, references, trigger on table public.workout_data from authenticated;

-- Para desfazer:
--   alter table public.workout_data drop constraint workout_data_payload_objeto, drop constraint workout_data_payload_tamanho;
--   grant all on table public.workout_data to anon;
--   grant delete, truncate, references, trigger on table public.workout_data to authenticated;
