// auth.js – Login / Registrierung / Passwort-Reset + Gast-Modus.
// Steuert das #auth-page-Overlay und hält den aktuellen Nutzer-Status.
import { getSupabase, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { t as tr } from './i18n.js';

const $ = (s) => document.querySelector(s);

let sb = null;
let currentUser = null;
let currentProfile = null;
let onChangeCb = null;
let mode = 'login'; // 'login' | 'register' | 'forgot' | 'update'

// Reset-Link FRÜH erkennen – bevor der Supabase-Client die URL verarbeitet und leert.
const RECOVERY_LINK = typeof location !== 'undefined'
  && (/pwreset=1/.test(location.search || '')
      || /type=recovery/.test((location.hash || '') + '&' + (location.search || '')));

export function getUser() { return currentUser; }
export function getProfile() { return currentProfile; }

// Profil ändern: sofort lokal (optimistisch), Schreiben in die DB im Hintergrund.
export function updateProfile(patch) {
  currentProfile = { ...(currentProfile || {}), ...patch };
  if (currentUser && sb) {
    sb.from('profiles').update(patch).eq('id', currentUser.id)
      .then(({ error }) => { if (error) console.warn('profile update:', error.message); });
  }
  return currentProfile;
}
// Wie updateProfile, aber wartet auf die DB und meldet Fehler zurück (für kritische
// Speichervorgänge wie das Profilbild, damit ein Fehlschlag nicht als „gespeichert" gilt).
export async function updateProfileAwait(patch) {
  currentProfile = { ...(currentProfile || {}), ...patch };
  if (!currentUser || !sb) return { error: { message: 'nicht angemeldet' } };
  const { error } = await sb.from('profiles').update(patch).eq('id', currentUser.id);
  if (error) console.warn('profile update:', error.message);
  return { error: error || null };
}

// Blob -> data:-URI (base64). Selbstenthaltend, wird direkt im Profil gespeichert.
function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });
}

// Profilbild speichern. Bevorzugt der Storage-Bucket (kurze URL); klappt der Upload
// nicht (z. B. Storage-Regeln), wird das Bild als base64-data:-URI zurückgegeben und
// direkt im Profil gespeichert – so wird es überall zuverlässig angezeigt.
export async function uploadProfileImage(kind, blob) {
  if (!sb || !currentUser || !blob) return null;
  const path = `${currentUser.id}/${kind}.jpg`;
  try {
    const { error } = await sb.storage.from('profile-images')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (!error) {
      const { data } = sb.storage.from('profile-images').getPublicUrl(path);
      if (data && data.publicUrl) return data.publicUrl + '?v=' + Date.now();
    } else {
      console.warn('avatar storage upload:', error.message, '– nutze base64-Fallback');
    }
  } catch (e) { console.warn('avatar storage upload:', e); }
  // Fallback: Bild direkt im Profil ablegen (base64)
  return await blobToDataUrl(blob);
}

// Von app.js beim Start aufgerufen.
export async function initAuth({ onChange } = {}) {
  onChangeCb = onChange || null;
  wireUI();
  try {
    sb = await getSupabase();
  } catch (e) {
    console.warn('Supabase nicht geladen – nur Gast-Modus:', e);
    document.body.classList.add('guest');
    if (onChangeCb) onChangeCb(null, null);
    return;
  }
  const { data } = await sb.auth.getSession();
  await setSession(data.session);
  // Reset-Link: zuverlässig „Neues Passwort"-Fenster öffnen (Event kann zu früh feuern).
  if (RECOVERY_LINK && currentUser) openAuth('update');
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') openAuth('update');
    await setSession(session);
  });
}

async function setSession(session) {
  currentUser = (session && session.user) || null;
  document.body.classList.toggle('logged-in', !!currentUser);
  document.body.classList.toggle('guest', !currentUser);
  currentProfile = null;
  if (currentUser && sb) {
    try {
      const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
      currentProfile = data || null;
    } catch { /* ignorieren */ }
  }
  if (onChangeCb) onChangeCb(currentUser, currentProfile);
}

// true = eingeloggt; sonst Login-Overlay öffnen und false.
export function requireAuth() {
  if (currentUser) return true;
  openAuth('login');
  return false;
}

export async function signOut() {
  try { if (sb) await sb.auth.signOut(); } catch { /* ignorieren */ }
}

// Passwort ändern (eingeloggt). Gibt null bei Erfolg, sonst Fehlertext.
export async function changePassword(password) {
  if (!sb) return 'Backend nicht erreichbar.';
  if ((password || '').length < 6) return 'Passwort: mindestens 6 Zeichen.';
  const { error } = await sb.auth.updateUser({ password });
  return error ? error.message : null;
}
// E-Mail-Adresse ändern (eingeloggt). Supabase schickt einen Bestätigungslink an
// die NEUE Adresse; erst nach Klick wird sie aktiv. null = Erfolg, sonst Fehlertext.
export async function changeEmail(email) {
  if (!sb || !currentUser) return tr('auth.err.notSignedIn');
  const e = (email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return tr('auth.err.emailInvalid');
  if (e.toLowerCase() === (currentUser.email || '').toLowerCase()) return tr('auth.err.emailSame');
  const { error } = await sb.auth.updateUser(
    { email: e },
    { emailRedirectTo: location.origin + '/' }
  );
  return error ? error.message : null;
}
// Konto endgültig löschen (über Edge-Function mit Service-Role). null = Erfolg.
export async function deleteAccount() {
  if (!sb || !currentUser) return tr('auth.err.notSignedIn');
  const { data } = await sb.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) return 'Keine Sitzung.';
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    });
    if (!res.ok) { const t = await res.text(); return tr('auth.err.deleteFailed', { msg: t.slice(0, 120) }); }
  } catch (e) { return tr('auth.err.generic', { msg: (e.message || e) }); }
  await signOut();
  return null;
}
// Reset-Link an die eigene E-Mail senden.
export async function sendPasswordReset() {
  if (!sb || !currentUser) return tr('auth.err.notSignedIn');
  const { error } = await sb.auth.resetPasswordForEmail(currentUser.email, { redirectTo: location.origin + '/?pwreset=1' });
  return error ? error.message : null;
}

// ---------- Overlay-UI ----------
export function openAuth(m) {
  mode = m || 'login';
  applyMode();
  setMsg('');
  $('#auth-page').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeAuth() {
  $('#auth-page').classList.add('hidden');
  document.body.style.overflow = '';
}
function setMsg(t, type) {
  const e = $('#auth-msg');
  if (!e) return;
  e.textContent = t || '';
  e.className = 'auth-msg' + (type ? ' ' + type : '');
}

function applyMode() {
  const titles = { login: 'auth.title.login', register: 'auth.title.register', forgot: 'auth.title.forgot', update: 'auth.title.update' };
  if ($('#auth-title')) $('#auth-title').textContent = tr(titles[mode]);
  const tabs = $('#auth-tabs');
  if (tabs) tabs.style.display = (mode === 'login' || mode === 'register') ? '' : 'none';
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  const show = (sel, on) => { const el = $(sel); if (el) el.style.display = on ? '' : 'none'; };
  show('#auth-username-field', mode === 'register');
  show('#auth-email-field', mode !== 'update');
  show('#auth-password-field', mode === 'login' || mode === 'register' || mode === 'update');
  show('#auth-consent-field', mode === 'register');
  if (mode === 'register') { const c = $('#auth-consent'); if (c) c.checked = false; }
  show('#auth-forgot', mode === 'login');
  const labels = { login: 'auth.login', register: 'auth.title.register', forgot: 'auth.label.forgot', update: 'set.savePassword' };
  $('#auth-submit').textContent = tr(labels[mode]);
  const pw = $('#auth-password');
  if (pw) pw.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
}

function wireUI() {
  document.querySelectorAll('.auth-tab').forEach((t) =>
    t.addEventListener('click', () => { mode = t.dataset.mode; applyMode(); setMsg(''); }));
  if ($('#auth-forgot')) $('#auth-forgot').addEventListener('click', () => { mode = 'forgot'; applyMode(); setMsg(''); });
  if ($('#auth-guest')) $('#auth-guest').addEventListener('click', closeAuth);
  if ($('#auth-close')) $('#auth-close').addEventListener('click', closeAuth);
  if ($('#auth-form')) $('#auth-form').addEventListener('submit', onSubmit);
  // AGB/Datenschutz aus dem Registrieren-Formular öffnen (Dialoge liegen im DOM).
  const openDlg = (id) => { const d = document.getElementById(id); if (d && d.showModal) d.showModal(); };
  if ($('#auth-terms-link')) $('#auth-terms-link').addEventListener('click', () => openDlg('agb-dialog'));
  if ($('#auth-privacy-link')) $('#auth-privacy-link').addEventListener('click', () => openDlg('datenschutz-dialog'));
}

async function onSubmit(e) {
  e.preventDefault();
  if (!sb) { setMsg(tr('auth.err.backend'), 'error'); return; }
  const email = ($('#auth-email').value || '').trim();
  const password = $('#auth-password').value || '';
  const username = ($('#auth-username').value || '').trim();
  setMsg(tr('msg.pleaseWait'));
  try {
    if (mode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed|confirm/i.test(error.message)) return setMsg(tr('auth.err.notConfirmed'), 'error');
        return setMsg(/invalid login/i.test(error.message) ? tr('auth.err.invalidLogin') : error.message, 'error');
      }
      closeAuth();
    } else if (mode === 'register') {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return setMsg(tr('auth.err.usernameRule'), 'error');
      if (password.length < 6) return setMsg(tr('auth.err.pwMin'), 'error');
      if (!$('#auth-consent') || !$('#auth-consent').checked) return setMsg(tr('auth.err.consent'), 'error');
      if (await usernameTaken(username)) return setMsg(tr('auth.err.usernameTaken'), 'error');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, display_name: username }, emailRedirectTo: location.origin + '/' } });
      if (error) return setMsg(/already|registered|exists/i.test(error.message) ? tr('auth.err.emailRegistered') : error.message, 'error');
      if (data.session) { closeAuth(); }
      else { setMsg(tr('auth.msg.almostDone'), 'ok'); mode = 'login'; applyMode(); }
    } else if (mode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?pwreset=1' });
      if (error) return setMsg(tr('auth.err.mailFailed', { msg: error.message }), 'error');
      setMsg(tr('auth.msg.resetMaybe'), 'ok');
    } else if (mode === 'update') {
      if (password.length < 6) return setMsg(tr('auth.err.pwMin'), 'error');
      const { error } = await sb.auth.updateUser({ password });
      if (error) return setMsg(tr('auth.err.generic', { msg: error.message }), 'error');
      setMsg(tr('auth.msg.passwordChanged'), 'ok');
      setTimeout(closeAuth, 1200);
    }
  } catch (err) {
    setMsg('Unerwarteter Fehler: ' + (err.message || err), 'error');
  }
}

async function usernameTaken(username) {
  if (!sb) return false;
  const esc = username.replace(/[%_\\]/g, (m) => '\\' + m);
  const { data } = await sb.from('profiles').select('id').ilike('username', esc).limit(1);
  return !!(data && data.length);
}
