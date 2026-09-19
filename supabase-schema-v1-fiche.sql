-- ============================================================
-- V1 — Fiche de contact obligatoire + collectifs personnalisés
-- À exécuter dans Supabase → SQL Editor
-- Écrit pour être rejouable sans risque (idempotent) sur la base existante.
-- ============================================================

-- 1. Nouvelles colonnes sur profiles (fiche de contact personnelle)
alter table profiles add column if not exists prenom text;
alter table profiles add column if not exists telephone text;
alter table profiles add column if not exists collectif_id uuid references collectifs(id) on delete set null;

-- 2. Couleur personnalisée par collectif (pastille), en plus du nom
alter table collectifs add column if not exists couleur text;

-- 3. Fonctions "security definer" : contournent le RLS pour une vérification
--    interne, sans jamais interroger "profiles" depuis une policy sur "profiles"
--    elle-même (c'est cette récursion qui avait causé le bug déjà rencontré).
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_edit()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and statut_demande = 'accepte' and role in ('admin', 'membre')
  );
$$;

create or replace function public.is_fiche_complete()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and nullif(trim(nom), '') is not null
      and nullif(trim(prenom), '') is not null
      and nullif(trim(telephone), '') is not null
      and collectif_id is not null
  );
$$;

-- 4. RPC : chaque utilisateur renseigne SA PROPRE fiche.
--    Passe par une fonction plutôt qu'une policy UPDATE générale, pour qu'il
--    ne puisse toucher que ces 4 colonnes — jamais son "role" ou son "statut_demande".
create or replace function public.update_my_fiche(
  p_nom text, p_prenom text, p_telephone text, p_collectif_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and statut_demande = 'accepte') then
    raise exception 'Compte non validé.';
  end if;
  update profiles
    set nom = p_nom, prenom = p_prenom, telephone = p_telephone, collectif_id = p_collectif_id
    where id = auth.uid();
end;
$$;

-- 5. RPC : créer un nouveau collectif depuis la fiche. Ouvert à tout compte
--    accepté (même "invité"), car il s'agit de déclarer SA PROPRE identité,
--    contrairement à la gestion des collectifs depuis le tableau des events
--    qui reste réservée aux rôles membre/admin (policy plus bas, inchangée).
create or replace function public.create_collectif_if_needed(p_nom text, p_couleur text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and statut_demande = 'accepte') then
    raise exception 'Compte non validé.';
  end if;
  insert into collectifs (nom, couleur) values (trim(p_nom), p_couleur)
    on conflict (nom) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from collectifs where nom = trim(p_nom);
  end if;
  return v_id;
end;
$$;

-- 6. Ajout d'un événement : exige désormais une fiche complète, en plus du
--    rôle membre/admin déjà requis. La modification et la suppression restent
--    inchangées (un profil devenu incomplet ne doit pas bloquer la gestion
--    des events déjà créés).
drop policy if exists "ecriture membre/admin" on evenements;

create policy "modification membre/admin" on evenements for update
  using (can_edit()) with check (can_edit());
create policy "suppression membre/admin" on evenements for delete
  using (can_edit());
create policy "ajout membre/admin fiche complete" on evenements for insert
  with check (can_edit() and is_fiche_complete());

-- 7. Reprise des policies sur "profiles" avec is_admin(), pour figer dans le
--    code la correction anti-récursion déjà appliquée en base.
drop policy if exists "voir son propre profil" on profiles;
drop policy if exists "admin gere les profils" on profiles;

create policy "voir son propre profil" on profiles for select
  using (auth.uid() = id or is_admin());
create policy "admin gere les profils" on profiles for update
  using (is_admin());
