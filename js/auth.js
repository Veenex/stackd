// auth.js – Login / Registrierung / Passwort-Reset + Gast-Modus.
// Steuert das #auth-page-Overlay und hält den aktuellen Nutzer-Status.
import { getSupabase } from './supabase.js';

const $ = (s) => document.querySelector(s);

let sb = null;
let currentUser = null;
let currentProfile = null;
let onChangeCb = null;
let mode = 'login'; // 'login' | 'register' | 'forgot' | 'update'

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
  const titles = { login: 'Willkommen zurück', register: 'Konto erstellen', forgot: 'Passwort zurücksetzen', update: 'Neues Passwort' };
  if ($('#auth-title')) $('#auth-title').textContent = titles[mode];
  const tabs = $('#auth-tabs');
  if (tabs) tabs.style.display = (mode === 'login' || mode === 'register') ? '' : 'none';
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  const show = (sel, on) => { const el = $(sel); if (el) el.style.display = on ? '' : 'none'; };
  show('#auth-username-field', mode === 'register');
  show('#auth-email-field', mode !== 'update');
  show('#auth-password-field', mode === 'login' || mode === 'register' || mode === 'update');
  show('#auth-forgot', mode === 'login');
  const labels = { login: 'Anmelden', register: 'Konto erstellen', forgot: 'Reset-Link senden', update: 'Passwort speichern' };
  $('#auth-submit').textContent = labels[mode];
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
}

async function onSubmit(e) {
  e.preventDefault();
  if (!sb) { setMsg('Backend nicht erreichbar. Bitte später erneut versuchen.', 'error'); return; }
  const email = ($('#auth-email').value || '').trim();
  const password = $('#auth-password').value || '';
  const username = ($('#auth-username').value || '').trim();
  setMsg('Bitte warten…');
  try {
    if (mode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed|confirm/i.test(error.message)) return setMsg('Bitte bestätige zuerst den Link in deiner Bestätigungs-E-Mail.', 'error');
        return setMsg(/invalid login/i.test(error.message) ? 'E-Mail oder Passwort falsch.' : error.message, 'error');
      }
      closeAuth();
    } else if (mode === 'register') {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return setMsg('Username: 3–20 Zeichen, nur Buchstaben, Zahlen, _', 'error');
      if (password.length < 6) return setMsg('Passwort: mindestens 6 Zeichen.', 'error');
      if (await usernameTaken(username)) return setMsg('Dieser Username ist schon vergeben.', 'error');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, display_name: username } } });
      if (error) return setMsg(/already|registered|exists/i.test(error.message) ? 'Diese E-Mail ist schon registriert.' : error.message, 'error');
      if (data.session) { closeAuth(); }
      else { setMsg('Fast geschafft! Bestätige den Link in deiner E-Mail, dann anmelden.', 'ok'); mode = 'login'; applyMode(); }
    } else if (mode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) return setMsg('Konnte Mail nicht senden: ' + error.message, 'error');
      setMsg('Falls die E-Mail existiert, kommt ein Reset-Link. Schau in dein Postfach.', 'ok');
    } else if (mode === 'update') {
      if (password.length < 6) return setMsg('Passwort: mindestens 6 Zeichen.', 'error');
      const { error } = await sb.auth.updateUser({ password });
      if (error) return setMsg('Fehler: ' + error.message, 'error');
      setMsg('Passwort geändert – du bist angemeldet.', 'ok');
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
