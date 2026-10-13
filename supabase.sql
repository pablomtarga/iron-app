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
