// ============================================================
// Organisation d'Events HDF — logique applicative
// Nécessite config.js (SUPABASE_URL / SUPABASE_ANON_KEY) chargé avant ce fichier.
// ============================================================

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let currentTab = "upcoming";
let collectifsCache = [];

// ---------- Utilitaires ----------
function el(id) { return document.getElementById(id); }
function show(id) { el(id).classList.remove("hidden"); }
function hide(id) { el(id).classList.add("hidden"); }
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function statusClass(statut) {
  return { "À faire": "afaire", "Programmé": "programme", "Terminé": "termine", "Annulé": "annule" }[statut] || "afaire";
}
function relativeDate(dateStr) {
  if (!dateStr) return "Date à définir";
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  const fmt = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  if (diffDays === 0) return `Aujourd'hui (${fmt})`;
  if (diffDays === 1) return `Demain (${fmt})`;
  if (diffDays === -1) return `Hier (${fmt})`;
  if (diffDays > 1 && diffDays <= 30) return `Dans ${diffDays} jours (${fmt})`;
  if (diffDays < -1 && diffDays >= -30) return `Il y a ${Math.abs(diffDays)} jours (${fmt})`;
  return fmt;
}
function canEdit() {
  return currentProfile && ["admin", "membre"].includes(currentProfile.role);
}
function isAdmin() {
  return currentProfile && currentProfile.role === "admin";
}

// ---------- Auth : formulaires ----------
el("switch-to-signup").addEventListener("click", (e) => {
  if (e.target.tagName !== "A") return;
  hide("login-form"); show("signup-form");
  hide("switch-to-signup"); show("switch-to-login");
  el("auth-sub").textContent = "Créez un compte : votre demande sera soumise à validation.";
  clearAuthStatus();
});
el("switch-to-login").addEventListener("click", (e) => {
  if (e.target.tagName !== "A") return;
  show("login-form"); hide("signup-form");
  show("switch-to-signup"); hide("switch-to-login");
  el("auth-sub").textContent = "Connectez-vous pour accéder à l'agenda du collectif.";
  clearAuthStatus();
});

function clearAuthStatus() { const s = el("auth-status"); s.className = "status-msg hidden"; s.textContent = ""; }
function authStatus(msg, type = "error") {
  const s = el("auth-status");
  s.className = "status-msg " + type;
  s.textContent = msg;
}

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthStatus();
  const email = el("login-email").value.trim();
  const password = el("login-password").value;
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) authStatus("Connexion impossible : " + error.message);
});

el("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthStatus();
  const nom = el("signup-nom").value.trim();
  const email = el("signup-email").value.trim();
  const password = el("signup-password").value;
  const { error } = await client.auth.signUp({ email, password, options: { data: { nom } } });
  if (error) authStatus("Inscription impossible : " + error.message);
  else authStatus("Compte créé. Votre demande va être examinée par l'administrateur.", "info");
});

el("pending-logout").addEventListener("click", () => client.auth.signOut());
el("refused-logout").addEventListener("click", () => client.auth.signOut());
el("logout-btn").addEventListener("click", () => client.auth.signOut());

// ---------- Cycle de vie session ----------
async function boot() {
  const { data: { session } } = await client.auth.getSession();
  if (session) await handleSession(session);
  else showAuthScreen();

  client.auth.onAuthStateChange(async (_event, session) => {
    if (session) await handleSession(session);
    else showAuthScreen();
  });
}

function hideAllScreens() {
  hide("auth-screen"); hide("pending-screen"); hide("refused-screen"); hide("app-shell");
}

function showAuthScreen() {
  hideAllScreens();
  show("auth-screen");
  currentUser = null; currentProfile = null;
}

async function handleSession(session) {
  currentUser = session.user;
  const { data: profile, error } = await client
    .from("profiles").select("*").eq("id", currentUser.id).single();

  if (error || !profile) {
    hideAllScreens(); show("pending-screen");
    return;
  }
  currentProfile = profile;

  if (profile.statut_demande === "en_attente") { hideAllScreens(); show("pending-screen"); return; }
  if (profile.statut_demande === "refuse") { hideAllScreens(); show("refused-screen"); return; }

  hideAllScreens();
  show("app-shell");
  el("header-name").textContent = profile.nom || profile.email;
  el("header-role").textContent = { admin: "Administrateur", membre: "Membre", invite: "Invité" }[profile.role];
  el("header-role").className = "role-pill " + profile.role;

  if (isAdmin()) { show("tab-admin-btn"); refreshAdminBadge(); }
  else hide("tab-admin-btn");

  await loadCollectifs();
  renderTab(currentTab);
}

// ---------- Navigation par onglets ----------
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    renderTab(currentTab);
  });
});

function renderTab(tab) {
  if (tab === "upcoming") renderUpcoming();
  else if (tab === "past") renderPast();
  else if (tab === "artistes") renderPeopleList("artistes");
  else if (tab === "photographes") renderPeopleList("photographes");
  else if (tab === "admin") renderAdmin();
}

// ---------- Collectifs ----------
async function loadCollectifs() {
  const { data } = await client.from("collectifs").select("*").order("nom");
  collectifsCache = data || [];
}
function collectifOptions(selectedId) {
  let out = `<option value="">— Collectif —</option>`;
  collectifsCache.forEach(c => {
    out += `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${esc(c.nom)}</option>`;
  });
  return out;
}
async function addCollectif() {
  const nom = prompt("Nom du nouveau collectif :");
  if (!nom || !nom.trim()) return;
  const { error } = await client.from("collectifs").insert({ nom: nom.trim() });
  if (error) { alert("Erreur : " + error.message); return; }
  await loadCollectifs();
  renderTab(currentTab);
}

// ---------- Événements : chargement ----------
async function fetchEvenements() {
  const { data, error } = await client
    .from("evenements")
    .select("*, collectifs(nom)")
    .order("date_evenement", { ascending: true });
  if (error) { console.error(error); return []; }
  return data || [];
}

function eventRowHTML(ev) {
  const readonly = !canEdit();
  return `
  <div class="event-row ${readonly ? "readonly" : ""}" data-id="${ev.id}">
    <div>
      <select class="ev-nom-collectif" ${readonly ? "disabled" : ""}>${collectifOptions(ev.collectif_id)}</select>
      <input class="ev-nom" type="text" value="${esc(ev.nom)}" placeholder="Nom de l'événement" ${readonly ? "disabled" : ""}>
    </div>
    <div>
      <select class="ev-statut" ${readonly ? "disabled" : ""}>
        ${["À faire", "Programmé", "Terminé", "Annulé"].map(s => `<option value="${s}" ${ev.statut === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <span class="status-pill ${statusClass(ev.statut)}">${ev.statut}</span>
    </div>
    <div>
      <input class="ev-date" type="date" value="${ev.date_evenement || ""}" ${readonly ? "disabled" : ""}>
      <div class="event-date-relative">${relativeDate(ev.date_evenement)}</div>
    </div>
    <div>
      <input class="ev-lieu" type="text" value="${esc(ev.lieu || "")}" placeholder="Lieu" ${readonly ? "disabled" : ""}>
    </div>
    <div>
      ${readonly ? "" : `<button class="btn btn-danger btn-sm ev-delete">Suppr.</button>`}
    </div>
  </div>`;
}

function bindEventRowEvents(container) {
  if (!canEdit()) return;
  container.querySelectorAll(".event-row").forEach(row => {
    const id = row.dataset.id;
    const save = async (field, value) => {
      const { error } = await client.from("evenements").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) alert("Erreur : " + error.message);
      if (field === "statut") renderTab(currentTab); // bascule éventuelle passés/à venir
    };
    row.querySelector(".ev-nom").addEventListener("change", e => save("nom", e.target.value));
    row.querySelector(".ev-nom-collectif").addEventListener("change", e => save("collectif_id", e.target.value || null));
    row.querySelector(".ev-statut").addEventListener("change", e => save("statut", e.target.value));
    row.querySelector(".ev-date").addEventListener("change", e => save("date_evenement", e.target.value || null));
    row.querySelector(".ev-lieu").addEventListener("change", e => save("lieu", e.target.value));
    const del = row.querySelector(".ev-delete");
    if (del) del.addEventListener("click", async () => {
      if (!confirm("Supprimer cet événement ?")) return;
      const { error } = await client.from("evenements").delete().eq("id", id);
      if (error) alert("Erreur : " + error.message);
      else renderTab(currentTab);
    });
  });
}

async function renderUpcoming() {
  const container = el("view-container");
  container.innerHTML = `
    <div class="section-head"><h2>Événements à venir</h2></div>
    ${canEdit() ? `<div class="add-inline">
        <button class="btn btn-primary btn-sm" id="add-event-btn">+ Ajouter un événement</button>
        <button class="btn btn-ghost btn-sm" id="add-collectif-btn">+ Nouveau collectif</button>
      </div>` : ""}
    <div class="card" id="events-list"></div>
  `;
  if (canEdit()) {
    el("add-event-btn").addEventListener("click", async () => {
      const { error } = await client.from("evenements").insert({ nom: "Nouvel événement", statut: "À faire" });
      if (error) alert("Erreur : " + error.message);
      else renderUpcoming();
    });
    el("add-collectif-btn").addEventListener("click", addCollectif);
  }
  const all = await fetchEvenements();
  const upcoming = all.filter(e => !["Terminé", "Annulé"].includes(e.statut));
  const list = el("events-list");
  if (upcoming.length === 0) {
    list.outerHTML = `<div class="empty-state" id="events-list">Aucun événement à venir pour le moment.</div>`;
    return;
  }
  list.innerHTML = upcoming.map(eventRowHTML).join("");
  bindEventRowEvents(list);
}

async function renderPast() {
  const container = el("view-container");
  container.innerHTML = `<div class="section-head"><h2>Événements passés</h2></div><div id="past-groups"></div>`;
  const all = await fetchEvenements();
  const past = all.filter(e => ["Terminé", "Annulé"].includes(e.statut));
  const groupsEl = el("past-groups");
  if (past.length === 0) {
    groupsEl.innerHTML = `<div class="empty-state">Aucun événement passé pour l'instant.</div>`;
    return;
  }
  const byYear = {};
  past.forEach(e => {
    const year = e.date_evenement ? e.date_evenement.slice(0, 4) : "Sans date";
    (byYear[year] = byYear[year] || []).push(e);
  });
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
  groupsEl.innerHTML = years.map(y => `
    <div class="year-group">
      <h3>${y}</h3>
      <div class="card past-year-card" data-year="${y}"></div>
    </div>
  `).join("");
  years.forEach(y => {
    const holder = groupsEl.querySelector(`.past-year-card[data-year="${y}"]`);
    holder.innerHTML = byYear[y].sort((a, b) => (b.date_evenement || "").localeCompare(a.date_evenement || "")).map(eventRowHTML).join("");
    bindEventRowEvents(holder);
  });
}

// ---------- Artistes / Photographes ----------
async function fetchPeople(table) {
  const { data, error } = await client.from(table).select("*").order("nom");
  if (error) { console.error(error); return []; }
  return data || [];
}

function personCardHTML(table, p) {
  const readonly = !canEdit();
  return `
  <div class="person-card" data-id="${p.id}">
    ${table === "artistes" && p.genre ? `<span class="tag">${esc(p.genre)}</span>` : ""}
    <h4>${esc(p.nom)}</h4>
    ${p.instagram_url ? `<a href="${esc(p.instagram_url)}" target="_blank" rel="noopener">Instagram ↗</a>` : ""}
    ${p.contact ? `<div class="contact">${esc(p.contact)}</div>` : ""}
    ${readonly ? "" : `<div class="card-actions">
        <button class="btn btn-ghost btn-sm p-edit">Modifier</button>
        <button class="btn btn-danger btn-sm p-delete">Suppr.</button>
      </div>`}
  </div>`;
}

async function renderPeopleList(table) {
  const container = el("view-container");
  const label = table === "artistes" ? "Artistes" : "Photographes";
  container.innerHTML = `
    <div class="section-head"><h2>${label}</h2></div>
    ${canEdit() ? `<div class="add-inline" id="add-person-form">
        <input type="text" id="p-nom" placeholder="Nom">
        ${table === "artistes" ? `<input type="text" id="p-genre" placeholder="Genre (dubstep, DnB, UK garage...)">` : ""}
        <input type="text" id="p-insta" placeholder="Lien Instagram">
        <input type="text" id="p-contact" placeholder="Contact (optionnel)">
        <button class="btn btn-primary btn-sm" id="add-person-btn">+ Ajouter</button>
      </div>` : ""}
    <div class="grid-cards" id="people-grid"></div>
  `;
  if (canEdit()) {
    el("add-person-btn").addEventListener("click", async () => {
      const nom = el("p-nom").value.trim();
      if (!nom) { alert("Le nom est obligatoire."); return; }
      const payload = {
        nom,
        instagram_url: el("p-insta").value.trim() || null,
        contact: el("p-contact").value.trim() || null,
      };
      if (table === "artistes") payload.genre = el("p-genre").value.trim() || null;
      const { error } = await client.from(table).insert(payload);
      if (error) alert("Erreur : " + error.message);
      else renderPeopleList(table);
    });
  }
  const people = await fetchPeople(table);
  const grid = el("people-grid");
  if (people.length === 0) {
    grid.outerHTML = `<div class="empty-state" id="people-grid">Aucune fiche pour le moment.</div>`;
    return;
  }
  grid.innerHTML = people.map(p => personCardHTML(table, p)).join("");
  if (canEdit()) {
    grid.querySelectorAll(".person-card").forEach(card => {
      const id = card.dataset.id;
      const person = people.find(p => p.id === id);
      card.querySelector(".p-edit").addEventListener("click", async () => {
        const nom = prompt("Nom :", person.nom); if (nom === null) return;
        const insta = prompt("Lien Instagram :", person.instagram_url || ""); if (insta === null) return;
        const contact = prompt("Contact :", person.contact || ""); if (contact === null) return;
        const payload = { nom, instagram_url: insta || null, contact: contact || null };
        if (table === "artistes") {
          const genre = prompt("Genre :", person.genre || ""); if (genre === null) return;
          payload.genre = genre || null;
        }
        const { error } = await client.from(table).update(payload).eq("id", id);
        if (error) alert("Erreur : " + error.message); else renderPeopleList(table);
      });
      card.querySelector(".p-delete").addEventListener("click", async () => {
        if (!confirm("Supprimer cette fiche ?")) return;
        const { error } = await client.from(table).delete().eq("id", id);
        if (error) alert("Erreur : " + error.message); else renderPeopleList(table);
      });
    });
  }
}

// ---------- Admin ----------
async function fetchPendingCount() {
  const { count } = await client.from("profiles").select("*", { count: "exact", head: true }).eq("statut_demande", "en_attente");
  return count || 0;
}
async function refreshAdminBadge() {
  if (!isAdmin()) return;
  const n = await fetchPendingCount();
  const badge = el("admin-badge");
  if (n > 0) { badge.textContent = n; show("admin-badge"); }
  else hide("admin-badge");
}

async function renderAdmin() {
  if (!isAdmin()) return;
  const container = el("view-container");
  container.innerHTML = `
    <div class="section-head"><h2>Demandes en attente</h2></div>
    <div class="card" id="pending-list"></div>
    <div class="section-head" style="margin-top:24px;"><h2>Tous les comptes</h2></div>
    <div class="card" id="all-users-list"></div>
  `;

  const { data: pending } = await client.from("profiles").select("*").eq("statut_demande", "en_attente").order("created_at");
  const pendingEl = el("pending-list");
  if (!pending || pending.length === 0) {
    pendingEl.innerHTML = `<div class="empty-state">Aucune demande en attente.</div>`;
  } else {
    pendingEl.innerHTML = pending.map(p => `
      <div class="admin-row" data-id="${p.id}">
        <div class="who"><strong>${esc(p.nom || "(sans nom)")}</strong><span class="email">${esc(p.email)}</span></div>
        <div>
          <button class="btn btn-primary btn-sm p-accept">Accepter</button>
          <button class="btn btn-danger btn-sm p-refuse">Refuser</button>
        </div>
      </div>`).join("");
    pendingEl.querySelectorAll(".admin-row").forEach(row => {
      const id = row.dataset.id;
      row.querySelector(".p-accept").addEventListener("click", async () => {
        const { error } = await client.from("profiles").update({ statut_demande: "accepte", role: "invite" }).eq("id", id);
        if (error) alert("Erreur : " + error.message); else { renderAdmin(); refreshAdminBadge(); }
      });
      row.querySelector(".p-refuse").addEventListener("click", async () => {
        const { error } = await client.from("profiles").update({ statut_demande: "refuse" }).eq("id", id);
        if (error) alert("Erreur : " + error.message); else { renderAdmin(); refreshAdminBadge(); }
      });
    });
  }

  const { data: all } = await client.from("profiles").select("*").eq("statut_demande", "accepte").order("nom");
  const allEl = el("all-users-list");
  if (!all || all.length === 0) {
    allEl.innerHTML = `<div class="empty-state">Aucun compte validé pour le moment.</div>`;
  } else {
    allEl.innerHTML = all.map(p => `
      <div class="admin-row" data-id="${p.id}">
        <div class="who"><strong>${esc(p.nom || "(sans nom)")}</strong><span class="email">${esc(p.email)}</span></div>
        <div>
          <select class="role-select" ${p.id === currentUser.id ? "disabled" : ""}>
            <option value="invite" ${p.role === "invite" ? "selected" : ""}>Invité (lecture seule)</option>
            <option value="membre" ${p.role === "membre" ? "selected" : ""}>Membre (édition)</option>
            <option value="admin" ${p.role === "admin" ? "selected" : ""}>Administrateur</option>
          </select>
          ${p.id === currentUser.id ? "" : `<button class="btn btn-danger btn-sm p-revoke">Révoquer</button>`}
        </div>
      </div>`).join("");
    allEl.querySelectorAll(".admin-row").forEach(row => {
      const id = row.dataset.id;
      const roleSelect = row.querySelector(".role-select");
      roleSelect.addEventListener("change", async (e) => {
        const { error } = await client.from("profiles").update({ role: e.target.value }).eq("id", id);
        if (error) alert("Erreur : " + error.message);
      });
      const revoke = row.querySelector(".p-revoke");
      if (revoke) revoke.addEventListener("click", async () => {
        if (!confirm("Révoquer l'accès de cette personne ?")) return;
        const { error } = await client.from("profiles").update({ statut_demande: "refuse" }).eq("id", id);
        if (error) alert("Erreur : " + error.message); else renderAdmin();
      });
    });
  }
}

// ---------- Démarrage ----------
boot();
