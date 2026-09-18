# Organisation d'Events HDF

Application de gestion collaborative des événements, artistes et photographes du collectif — avec accès sur demande validée par un administrateur.

## 1. Créer le projet Supabase

1. Aller sur [supabase.com](https://supabase.com) → créer un projet gratuit.
2. Dans **SQL Editor**, coller et exécuter le contenu de `supabase-schema.sql`.
3. Dans **Authentication → Providers → Email**, **désactiver "Confirm email"** (la validation manuelle par l'admin remplace cette étape — la laisser activée créerait une double barrière et de la confusion).
4. Dans **Project Settings → API**, récupérer :
   - l'**URL du projet**
   - la clé **anon / public**

## 2. Configurer l'application

Ouvrir `config.js` et remplacer les deux valeurs :

```js
const SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
const SUPABASE_ANON_KEY = "VOTRE_CLE_ANON_PUBLIQUE";
```

Cette clé "anon" est faite pour être publique côté client — la sécurité réelle est assurée par les policies RLS définies dans le script SQL, pas par le secret de cette clé.

## 3. Déployer sur GitHub Pages

1. Créer un repo GitHub et y pousser tout le contenu de ce dossier.
2. Dans **Settings → Pages** du repo, choisir la branche `main` (dossier racine `/`) comme source.
3. GitHub fournit une URL du type `https://votre-compte.github.io/nom-du-repo/` — c'est le lien à partager avec le collectif.

## 4. Devenir administrateur

1. Ouvrir l'URL déployée, cliquer sur "Demander l'accès" et créer votre propre compte.
2. Dans Supabase → **Table Editor → profiles**, trouver la ligne correspondant à votre email.
3. Modifier manuellement : `role = admin` et `statut_demande = accepte`.
4. Rafraîchir l'application : vous avez maintenant accès au panneau Admin.

C'est la **seule manipulation manuelle** nécessaire. Toutes les demandes suivantes se valident depuis l'onglet Admin de l'application.

## 5. Empêcher la mise en pause automatique de Supabase

Le plan gratuit Supabase met un projet en pause après 7 jours sans requête API. Un robot est déjà inclus (`.github/workflows/keep-alive.yml`) pour éviter ça, en appelant l'API une fois par semaine.

Pour l'activer :

1. Dans le repo GitHub → **Settings → Secrets and variables → Actions**, ajouter deux secrets :
   - `SUPABASE_URL` (même valeur que dans `config.js`)
   - `SUPABASE_ANON_KEY` (même valeur que dans `config.js`)
2. C'est tout : le robot se déclenche automatiquement chaque lundi. Vous pouvez aussi le lancer manuellement depuis l'onglet **Actions** du repo (bouton "Run workflow").

## 6. Fonctionnement des rôles

| Rôle | Droits |
|---|---|
| Administrateur | Tout faire + valider/refuser les demandes + gérer les rôles des autres comptes |
| Membre | Ajouter/modifier/supprimer événements, artistes, photographes |
| Invité | Consultation uniquement (aucun bouton d'édition visible) |

Un nouveau compte reste **"en attente"** — invisible dans le reste de l'application — tant qu'un administrateur ne l'a pas accepté depuis l'onglet **Admin**. Une fois accepté, il devient automatiquement **Invité** (lecture seule) ; l'administrateur peut ensuite le promouvoir **Membre** si besoin.

## 7. Notes

- Aucun coût à prévoir pour l'échelle actuelle (jusqu'à ~50 comptes, usage occasionnel) : très en dessous des limites gratuites de Supabase et GitHub Pages.
- Conservez les identifiants Supabase et GitHub Pages en lieu sûr, accessibles à plus d'une personne du collectif en cas d'imprévu.
