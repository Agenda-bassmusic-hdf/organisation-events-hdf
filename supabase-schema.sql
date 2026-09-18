-- ============================================================
-- Organisation d'Events HDF — schéma Supabase
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

-- Table des profils utilisateurs, liée aux comptes d'authentification Supabase
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nom text,
  role text not null check (role in ('admin', 'membre', 'invite')) default 'invite',
  statut_demande text not null check (statut_demande in ('en_attente', 'accepte', 'refuse')) default 'en_attente',
  created_at timestamptz default now()
);

-- Création automatique d'un profil (en attente) à chaque inscription
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, nom, role, statut_demande)
  values (new.id, new.email, new.raw_user_meta_data->>'nom', 'invite', 'en_attente');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Collectifs
create table collectifs (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  created_at timestamptz default now()
);

-- Événements
create table evenements (
  id uuid primary key default gen_random_uuid(),
  collectif_id uuid references collectifs(id) on delete set null,
  nom text not null,
  statut text not null check (statut in ('À faire', 'Programmé', 'Terminé', 'Annulé')) default 'À faire',
  date_evenement date,
  lieu text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Artistes
create table artistes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  genre text,
  instagram_url text,
  contact text,
  created_at timestamptz default now()
);

-- Photographes
create table photographes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  instagram_url text,
  contact text,
  created_at timestamptz default now()
);

-- Activation de la sécurité niveau ligne (RLS) sur toutes les tables
alter table profiles enable row level security;
alter table collectifs enable row level security;
alter table evenements enable row level security;
alter table artistes enable row level security;
alter table photographes enable row level security;

-- PROFILES : chacun voit son propre profil ; l'admin voit et modifie tous les profils
create policy "voir son propre profil" on profiles for select
  using (auth.uid() = id or exists (select 1 from profiles a where a.id = auth.uid() and a.role = 'admin'));

create policy "admin gere les profils" on profiles for update
  using (exists (select 1 from profiles a where a.id = auth.uid() and a.role = 'admin'));

-- LECTURE : autorisée à tout compte accepté (admin, membre, invité)
create policy "lecture si accepte" on evenements for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte'));
create policy "lecture si accepte" on artistes for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte'));
create policy "lecture si accepte" on photographes for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte'));
create policy "lecture si accepte" on collectifs for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte'));

-- ECRITURE (insert/update/delete) : réservée aux rôles admin et membre
create policy "ecriture membre/admin" on evenements for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')));
create policy "ecriture membre/admin" on artistes for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')));
create policy "ecriture membre/admin" on photographes for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')));
create policy "ecriture membre/admin" on collectifs for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.statut_demande = 'accepte' and p.role in ('admin','membre')));
