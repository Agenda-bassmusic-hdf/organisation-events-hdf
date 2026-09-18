# Cahier des charges — "Organisation d'Events HDF"

## 1. Contexte et objectif

Application web collaborative destinée à remplacer un usage de Notion devenu limité (quota d'invités dépassé). Elle est utilisée par un collectif d'organisateurs d'événements Bassmusic (dubstep, drum & bass, UK Garage) dans les Hauts-de-France pour :

- planifier et suivre les événements du collectif et de ses partenaires ;
- archiver les événements passés par année ;
- centraliser une liste de photographes disponibles ;
- centraliser une liste d'artistes disponibles (avec lien Instagram) pour faciliter la prise de contact et varier les line-up.

L'application doit être accessible depuis un simple lien, sans installation, sur PC, tablette et smartphone.

## 2. Utilisateurs et rôles

Trois rôles :

| Rôle | Qui | Droits |
|---|---|---|
| **Administrateur** | Le gérant du collectif (vous) | Tout faire : CRUD sur événements/artistes/photographes, valider ou refuser les demandes d'accès, promouvoir/rétrograder des utilisateurs entre Membre et Invité |
| **Membre** | Organisateurs actifs | CRUD complet sur événements, artistes, photographes (ajout, modification, suppression) |
| **Invité** | Consultation seule | Lecture seule sur les 4 sections (événements à venir, événements passés, artistes, photographes). Aucune modification possible |

### Processus d'accès (sur invitation avec validation manuelle)

1. Un visiteur arrive sur le site : **tant qu'il n'est pas connecté et validé, il ne voit aucun tableau** — seulement un écran de connexion / demande d'accès.
2. Il crée un compte (email + mot de passe + nom). Le compte est créé côté authentification mais reste en statut **"en attente"**.
3. Vous (admin) recevez la demande dans un panneau dédié ("Demandes en attente") avec un bouton **Accepter** / **Refuser**.
4. Si acceptée → le compte passe automatiquement au rôle **Invité** (lecture seule) et peut désormais se connecter et voir les données.
5. Vous pouvez ensuite, à tout moment, **promouvoir** un compte Invité en Membre (ou l'inverse) depuis le même panneau d'administration.
6. Si refusée → le compte reste bloqué, un message l'informe que sa demande n'a pas été acceptée.

Le tout premier compte (le vôtre) devra être promu manuellement au rôle **Administrateur** directement dans la base Supabase après inscription (voir section 8).

## 3. Stack technique recommandée

| Composant | Choix | Pourquoi |
|---|---|---|
| Frontend | HTML/CSS/JS (ou React) en une page, sans étape de build complexe | Facile à héberger sur GitHub Pages, facile à maintenir par Claude Code |
| Hébergement du frontend | **GitHub Pages** (gratuit, HTTPS automatique, déployé directement depuis le repo) | Choix confirmé par vous |
| Backend / données + authentification | **Supabase** (PostgreSQL + Auth email/mot de passe intégrée) | Gratuit à cette échelle, gère nativement les comptes utilisateurs, les mots de passe (hashés en sécurité), et se connecte depuis le JS via `@supabase/supabase-js` (CDN) — aucun serveur à héberger séparément |
| Mobile | Responsive design + option PWA ("Ajouter à l'écran d'accueil") | Confort d'usage identique à une app native |

⚠️ Note technique : GitHub Pages ne sert que du contenu statique (HTML/CSS/JS), il ne peut pas héberger de backend. C'est Supabase qui joue ce rôle (base de données + authentification), appelé directement depuis le JavaScript de la page. C'est une architecture 100% gratuite et courante, tout à fait adaptée à ce projet.

### 3.1 Échelle prévue et coûts

Usage attendu : jusqu'à 50 comptes, 15 utilisateurs actifs en pratique, environ 1 connexion par jour et par personne. À titre de comparaison, le plan gratuit Supabase autorise jusqu'à 50 000 utilisateurs actifs par mois et 500 Mo de base de données — l'usage prévu ici représente une fraction infime de ces limites. **Aucun coût n'est à prévoir**, même en cas de croissance modérée du collectif (doublement ou triplement du nombre de membres). Le seul scénario qui justifierait de reconsidérer l'offre payante serait une croissance à plusieurs centaines d'utilisateurs actifs quotidiens, très éloignée du contexte actuel.

## 4. Modèle de données (schéma SQL Supabase)

```sql
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
```

## 5. Fonctionnalités détaillées

### 5.1 Authentification et gestion des accès
- Écran de connexion / inscription par défaut si aucune session active.
- Formulaire d'inscription : email, mot de passe, nom.
- Après inscription : écran "Votre demande a été envoyée, en attente de validation par l'administrateur" (pas d'accès aux données).
- Après connexion d'un compte "en attente" : même écran d'attente.
- Après connexion d'un compte "refusé" : message clair d'accès refusé.
- Après connexion d'un compte "accepté" : accès à l'application selon son rôle.
- **Panneau Administrateur** (visible seulement par le rôle admin) : liste des demandes en attente (boutons Accepter/Refuser) + liste de tous les comptes existants avec possibilité de changer leur rôle (Membre ↔ Invité) ou de les révoquer.
- **Badge de notification** : un compteur visible en permanence (icône avec pastille chiffrée, ex. sur l'onglet ou le bouton menant au panneau Admin) indique le nombre de demandes en attente non traitées. Pas de notification par mail : l'admin consulte le badge à chaque ouverture de l'application. Ce choix évite d'avoir à maintenir un service d'envoi de mails supplémentaire.

### 5.2 Tableau 1 — "Événements à venir"
- Colonnes : Collectif (menu déroulant + ajout/suppression d'un collectif à la volée), Nom de l'événement (texte éditable), État (À faire / Programmé / Terminé / Annulé), Date (sélecteur, affichée en format relatif — "dans 12 jours", "demain", "le 14 oct."), Lieu (texte éditable).
- Actions (Admin/Membre uniquement) : ajout, suppression, édition inline, tri par date croissante.
- Les Invités voient ce tableau en lecture seule (pas de boutons d'édition affichés).
- Dès qu'un événement passe au statut "Terminé" ou "Annulé", il **bascule automatiquement** vers le tableau "Événements passés" (même enregistrement, changement de vue selon le statut).

### 5.3 Tableau 2 — "Événements passés"
- Regroupement par année (à partir de la date de l'événement).
- Lecture seule pour les Invités ; modifiable par Admin/Membre en cas de correction a posteriori.

### 5.4 Liste des photographes
- Cartes ou liste : nom, lien Instagram cliquable, contact optionnel.
- Ajout/suppression/édition réservés à Admin/Membre ; lecture seule pour Invités.

### 5.5 Liste des artistes
- Cartes ou liste : nom, genre musical (tag), lien Instagram cliquable, contact optionnel.
- Filtre/tri par genre musical.
- Ajout/suppression/édition réservés à Admin/Membre ; lecture seule pour Invités.

## 6. Interface / UX

- Design responsive mobile-first.
- Navigation entre 4 sections (+ panneau Admin si applicable) : onglets sur PC, menu bas sur mobile.
- Sauvegarde automatique à chaque modification (pas de bouton "Enregistrer").
- Statuts d'événements avec code couleur (À faire = gris, Programmé = bleu, Terminé = vert, Annulé = rouge).
- Interface d'édition masquée pour les Invités (les boutons ajouter/modifier/supprimer n'apparaissent pas).

## 7. Déploiement

1. Créer un projet Supabase gratuit, activer l'authentification par email/mot de passe (activée par défaut), exécuter le script SQL de la section 4 dans l'éditeur SQL.
2. Dans Supabase → Authentication → Providers → Email, **désactiver l'option "Confirm email"**. La validation manuelle par l'admin (section 2) remplace déjà cette étape ; la laisser activée créerait une double barrière inutile (confirmation par mail + validation admin) et une confusion possible ("pourquoi je ne peux pas me connecter alors que l'admin a accepté ma demande ?").
3. Récupérer l'URL du projet et la clé publique "anon" (utilisables côté client sans risque, la sécurité est assurée par les policies RLS).
4. Développer le frontend en local avec ces deux valeurs en configuration.
5. Pousser le code sur un repo GitHub public ou privé.
6. Activer **GitHub Pages** dans les paramètres du repo (branche de déploiement `main` ou `gh-pages`, dossier racine ou `/docs`).
7. **Créer votre propre compte** via le formulaire d'inscription de l'app une fois déployée.
8. Dans Supabase (Table Editor → `profiles`), modifier manuellement votre ligne : `role = 'admin'` et `statut_demande = 'accepte'`. C'est la seule étape manuelle nécessaire pour démarrer.
9. Mettre en place le robot de "réveil" automatique (voir section 7.1) pour que le projet Supabase gratuit ne se mette jamais en pause.
10. Partager l'URL GitHub Pages au groupe Messenger — chacun pourra alors faire une demande d'accès depuis le formulaire d'inscription, que vous validerez depuis le panneau Admin.

### 7.1 Robot de réveil (éviter la mise en pause Supabase)

Le plan gratuit Supabase met un projet en pause après 7 jours sans requête API. Pour éviter tout risque de coupure silencieuse, mettre en place une **GitHub Action planifiée** qui appelle l'API Supabase une fois par semaine, dans le même repo que le frontend :

```yaml
# .github/workflows/keep-alive.yml
name: Keep Supabase Alive
on:
  schedule:
    - cron: '0 8 * * 1'   # tous les lundis à 8h
  workflow_dispatch:        # permet aussi un déclenchement manuel
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase
        run: |
          curl -s -o /dev/null -w "%{http_code}" \
            "${{ secrets.SUPABASE_URL }}/rest/v1/collectifs?select=id&limit=1" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}"
```

L'URL et la clé "anon" sont stockées en tant que **secrets du repo GitHub** (Settings → Secrets and variables → Actions), pas en clair dans le fichier. Cette requête légère suffit à maintenir le projet actif indéfiniment, sans aucune intervention manuelle de votre part.

## 8. Instructions à donner telles quelles à Claude Code

> Crée une application web responsive (HTML/CSS/JS, sans framework lourd) nommée "Organisation d'Events HDF", hébergeable sur GitHub Pages et connectée à une base Supabase (PostgreSQL + Auth email/mot de passe classique). Implémente un système de rôles à trois niveaux (admin, membre, invité) avec un flux de demande d'accès : à l'inscription, un compte reste "en attente" tant que l'administrateur ne l'a pas validé depuis un panneau dédié ; un compte validé devient "invité" (lecture seule) par défaut, et l'admin peut ensuite le promouvoir "membre" (droits d'édition complets). Tant qu'un utilisateur n'est pas connecté et validé, aucune donnée ne doit être visible. Le panneau Admin affiche un badge/compteur du nombre de demandes en attente (pas de notification par mail). Implémente 4 sections de données : Événements à venir, Événements passés (regroupés par année), Photographes, Artistes — avec édition en ligne et sauvegarde automatique pour les rôles admin/membre, et affichage lecture seule pour le rôle invité. Les événements passant au statut "Terminé" ou "Annulé" doivent automatiquement apparaître dans la section "Événements passés". Utilise le schéma SQL et les policies RLS fournis dans ce cahier des charges. Design mobile-first. Ajoute aussi le fichier `.github/workflows/keep-alive.yml` fourni dans ce cahier des charges pour empêcher la mise en pause du projet Supabase gratuit. Fournis un fichier README expliquant le déploiement sur GitHub Pages, la configuration Supabase (dont la désactivation de la confirmation email), la mise en place des secrets GitHub pour le robot de réveil, et l'étape manuelle de promotion du premier compte administrateur.

## 9. Évolutions futures possibles (non prioritaires)

- Notification par mail des demandes en attente, si le badge dans l'appli s'avère insuffisant à l'usage (nécessiterait Supabase Edge Functions + un service d'envoi de mail comme Resend).
- Connexion par lien magique (sans mot de passe), si la gestion des mots de passe devient une friction pour les membres.
- Export PDF/calendrier (.ics) des événements à venir.
- Rappel automatique avant un événement.
- Statistiques (nombre d'événements par collectif, par genre musical, etc.).
- Passage à l'offre Supabase payante si le collectif grandit fortement ou si une disponibilité garantie devient nécessaire (le robot de réveil suffit largement à l'échelle actuelle).
