// store.js – Datenhaltung. Cloud-fähig:
//  - Synchroner Lese-Cache (localStorage, PRO NUTZER) für schnelles, unverändertes UI.
//  - Schreibvorgänge gehen in den Cache (sofort) UND asynchron zu Supabase.
//  - Beim Login: Pull aus Supabase in den Cache (+ einmalige Migration der
//    alten, rein-lokalen Daten ins Konto).
// Einstellungen (Discogs-Token etc.) bleiben vorerst global lokal.

import { getSupabase } from './supabase.js';
import { getUser } from './auth.js';

const KEYS = {
  settings: 'vinyl.settings',
  // Legacy (rein-lokale Ära, vor dem Online-Umbau):
  legacyCollection: 'vinyl.collection',
  legacyWishlist: 'vinyl.wishlist',
  legacyPlaylists: 'vinyl.playlists',
};

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function uid() { const u = getUser(); return u ? u.id : null; }
function userKey(list) { const u = uid(); return u ? `vinyl.u.${u}.${list}` : null; }

async function cloud() { try { return await getSupabase(); } catch { return null; } }

// ---------- Mapping Cache <-> Cloud ----------
function toRow(item, list, u) {
  return {
    id: item.id,
    user_id: u,
    list,
    artist: item.artist || null,
    title: item.title || null,
    year: item.year ? String(item.year) : null,
    label: item.label || null,
    format: item.format || null,
    genre: item.genre || null,
    barcode: item.barcode || null,
    cover_url: item.coverUrl || null,
    note: item.note || null,
    review: item.review || null,
    rating: Number(item.rating) || 0,
    liked: !!item.liked,
    price: Number(item.price) || 0,
    media_cond: item.mediaCond || null,
    sleeve_cond: item.sleeveCond || null,
    source: item.source || null,
    source_id: item.sourceId || null,
    master_id: item.masterId || null,
    added_at: new Date(item.addedAt || Date.now()).toISOString(),
  };
}
function fromRow(r) {
  return {
    id: r.id,
    addedAt: r.added_at ? new Date(r.added_at).getTime() : Date.now(),
    artist: r.artist || '', title: r.title || '', year: r.year || '',
    label: r.label || '', format: r.format || '', genre: r.genre || '', barcode: r.barcode || '',
    coverUrl: r.cover_url || '', note: r.note || '', review: r.review || '',
    rating: Number(r.rating) || 0, liked: !!r.liked, price: Number(r.price) || 0,
    mediaCond: r.media_cond || '', sleeveCond: r.sleeve_cond || '',
    source: r.source || '', sourceId: r.source_id || '', masterId: r.master_id || 0,
  };
}

// ---------- Listen (Collection/Wishlist) ----------
export function getList(list) {
  const k = userKey(list);
  return k ? read(k) : [];
}
export function saveList(list, items) {
  const k = userKey(list);
  if (k) write(k, items);
}

export function addItem(list, item) {
  const record = {
    id: crypto.randomUUID(), addedAt: Date.now(),
    artist: '', title: '', year: '', label: '', format: '', genre: '', barcode: '',
    coverUrl: '', note: '', review: '', rating: 0, liked: false, price: 0,
    mediaCond: '', sleeveCond: '',
    source: 'manual', sourceId: '',
    ...item,
  };
  const u = uid();
  if (!u) return record; // Gäste können nicht sammeln (UI gesperrt)
  const items = getList(list); items.push(record); saveList(list, items);
  (async () => {
    const sb = await cloud(); if (!sb) return;
    const { error } = await sb.from('items').insert(toRow(record, list, u));
    if (error) console.warn('items insert:', error.message);
  })();
  return record;
}

export function updateItem(list, id, patch) {
  const items = getList(list);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch };
  saveList(list, items);
  const u = uid();
  if (u) (async () => {
    const sb = await cloud(); if (!sb) return;
    const { error } = await sb.from('items').update(toRow(items[idx], list, u)).eq('id', id).eq('user_id', u);
    if (error) console.warn('items update:', error.message);
  })();
  return items[idx];
}

export function deleteItem(list, id) {
  saveList(list, getList(list).filter((i) => i.id !== id));
  const u = uid();
  if (u) (async () => {
    const sb = await cloud(); if (!sb) return;
    const { error } = await sb.from('items').delete().eq('id', id).eq('user_id', u);
    if (error) console.warn('items delete:', error.message);
  })();
}

export function moveItem(fromList, toList, id) {
  const items = getList(fromList);
  const item = items.find((i) => i.id === id);
  if (!item) return;
  saveList(fromList, items.filter((i) => i.id !== id));
  item.addedAt = Date.now();
  const target = getList(toList); target.push(item); saveList(toList, target);
  const u = uid();
  if (u) (async () => {
    const sb = await cloud(); if (!sb) return;
    const { error } = await sb.from('items')
      .update({ list: toList, added_at: new Date(item.addedAt).toISOString() })
      .eq('id', id).eq('user_id', u);
    if (error) console.warn('items move:', error.message);
  })();
}

// ---------- Playlists ----------
export function getPlaylists() {
  const k = userKey('playlists');
  return k ? read(k) : [];
}
export function savePlaylists(pls) {
  const k = userKey('playlists');
  if (k) write(k, pls);
}
export function createPlaylist(name, description) {
  const p = { id: crypto.randomUUID(), name: (name || '').trim() || 'Neue Liste', description: (description || '').trim(), itemIds: [], createdAt: Date.now() };
  const u = uid();
  if (!u) return p;
  const pls = getPlaylists(); pls.push(p); savePlaylists(pls);
  (async () => {
    const sb = await cloud(); if (!sb) return;
    const { error } = await sb.from('playlists').insert({ id: p.id, user_id: u, name: p.name, description: p.description || null, created_at: new Date(p.createdAt).toISOString() });
    if (error) console.warn('playlist insert:', error.message);
  })();
  return p;
}
export function deletePlaylist(id) {
  savePlaylists(getPlaylists().filter((p) => p.id !== id));
  const u = uid();
  if (u) (async () => {
    const sb = await cloud(); if (!sb) return;
    const { error } = await sb.from('playlists').delete().eq('id', id).eq('user_id', u);
    if (error) console.warn('playlist delete:', error.message);
  })();
}
export function renamePlaylist(id, name) {
  const pls = getPlaylists();
  const p = pls.find((x) => x.id === id);
  if (!p) return;
  p.name = (name || '').trim() || p.name; savePlaylists(pls);
  const u = uid();
  if (u) (async () => {
    const sb = await cloud(); if (!sb) return;
    const { error } = await sb.from('playlists').update({ name: p.name }).eq('id', id).eq('user_id', u);
    if (error) console.warn('playlist rename:', error.message);
  })();
}
export function togglePlaylistItem(playlistId, itemId) {
  const pls = getPlaylists();
  const p = pls.find((x) => x.id === playlistId);
  if (!p) return;
  const idx = p.itemIds.indexOf(itemId);
  const nowAdded = idx < 0;
  if (idx >= 0) p.itemIds.splice(idx, 1); else p.itemIds.push(itemId);
  savePlaylists(pls);
  if (uid()) (async () => {
    const sb = await cloud(); if (!sb) return;
    let error;
    if (nowAdded) ({ error } = await sb.from('playlist_items').insert({ playlist_id: playlistId, item_id: itemId, position: p.itemIds.length - 1 }));
    else ({ error } = await sb.from('playlist_items').delete().eq('playlist_id', playlistId).eq('item_id', itemId));
    if (error) console.warn('playlist item:', error.message);
  })();
}

// Reihenfolge in einer Liste ändern (dir = -1 hoch, +1 runter) und persistieren.
export function movePlaylistItem(playlistId, itemId, dir) {
  const pls = getPlaylists();
  const p = pls.find((x) => x.id === playlistId);
  if (!p) return;
  const i = p.itemIds.indexOf(itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.itemIds.length) return;
  [p.itemIds[i], p.itemIds[j]] = [p.itemIds[j], p.itemIds[i]];
  savePlaylists(pls);
  persistPlaylistOrder(p);
}
function persistPlaylistOrder(p) {
  if (!uid()) return;
  (async () => {
    const sb = await cloud(); if (!sb) return;
    const rows = p.itemIds.map((it, idx) => ({ playlist_id: p.id, item_id: it, position: idx }));
    if (!rows.length) return;
    const { error } = await sb.from('playlist_items').upsert(rows);
    if (error) console.warn('playlist reorder:', error.message);
  })();
}

// ---------- Sync: Login (Pull + einmalige Migration) / Logout ----------
function assemblePlaylists(pls, plItems) {
  return (pls || []).map((p) => ({
    id: p.id, name: p.name, description: p.description || '',
    createdAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
    itemIds: (plItems || []).filter((pi) => pi.playlist_id === p.id).sort((a, b) => (a.position || 0) - (b.position || 0)).map((pi) => pi.item_id),
  }));
}

async function uploadItems(sb, items, list, u) {
  if (!items || !items.length) return;
  const rows = items.map((i) => toRow(i, list, u));
  const { error } = await sb.from('items').upsert(rows);
  if (error) console.warn('migrate items:', error.message);
}
async function uploadPlaylists(sb, pls, u) {
  for (const p of (pls || [])) {
    await sb.from('playlists').upsert({ id: p.id, user_id: u, name: p.name, description: p.description || null, created_at: new Date(p.createdAt || Date.now()).toISOString() });
    if (p.itemIds && p.itemIds.length) {
      await sb.from('playlist_items').upsert(p.itemIds.map((it, idx) => ({ playlist_id: p.id, item_id: it, position: idx })));
    }
  }
}

// Beim Login aufrufen: zieht Cloud-Daten in den Cache; migriert beim 1. Mal
// die alten rein-lokalen Daten ins (leere) Konto.
export async function syncAll() {
  const u = uid(); if (!u) return;
  const sb = await cloud(); if (!sb) return;

  fetchBlocked().catch(() => {}); // Blockier-Liste im Hintergrund laden

  const [{ data: rows }, { data: pls }, { data: plItems }] = await Promise.all([
    sb.from('items').select('*').eq('user_id', u),
    sb.from('playlists').select('*').eq('user_id', u),
    sb.from('playlist_items').select('*'),
  ]);
  const cloudEmpty = !(rows && rows.length) && !(pls && pls.length);

  const legacyColl = read(KEYS.legacyCollection);
  const legacyWish = read(KEYS.legacyWishlist);
  const legacyPls = read(KEYS.legacyPlaylists);
  const legacyConsumed = localStorage.getItem('vinyl.legacyConsumed') === '1';
  const haveLegacy = legacyColl.length || legacyWish.length || legacyPls.length;

  if (cloudEmpty && haveLegacy && !legacyConsumed) {
    // Migration: lokale Daten ins Konto hochladen
    await uploadItems(sb, legacyColl, 'collection', u);
    await uploadItems(sb, legacyWish, 'wishlist', u);
    await uploadPlaylists(sb, legacyPls, u);
    saveList('collection', legacyColl);
    saveList('wishlist', legacyWish);
    savePlaylists(legacyPls);
    localStorage.setItem('vinyl.legacyConsumed', '1'); // nur einmal, egal welches Konto
  } else {
    // Cloud ist die Wahrheit -> in den Cache spiegeln
    saveList('collection', (rows || []).filter((r) => r.list === 'collection').map(fromRow));
    saveList('wishlist', (rows || []).filter((r) => r.list === 'wishlist').map(fromRow));
    savePlaylists(assemblePlaylists(pls, plItems));
  }
}

// Beim Logout: alle nutzerbezogenen Caches entfernen.
export function clearUserCache() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('vinyl.u.'))
    .forEach((k) => localStorage.removeItem(k));
}

// ---------- Freunde / Follows ----------
function ilikeEsc(s) { return String(s).replace(/[%_\\]/g, (m) => '\\' + m); }

export async function searchUsers(query) {
  const sb = await cloud(); const u = uid();
  const q = (query || '').trim();
  if (!sb || !q) return [];
  const { data } = await sb.from('profiles')
    .select('id,username,display_name,avatar_url')
    .ilike('username', '%' + ilikeEsc(q) + '%').limit(20);
  return (data || []).filter((p) => p.id !== u && !blockedSet.has(p.id)); // sich selbst + blockierte ausblenden
}

export async function getFollowing() {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return [];
  const { data } = await sb.from('follows').select('followee_id').eq('follower_id', u);
  return (data || []).map((r) => r.followee_id);
}

export async function follow(userId) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return;
  const { error } = await sb.from('follows').insert({ follower_id: u, followee_id: userId });
  if (error) console.warn('follow:', error.message);
}

export async function unfollow(userId) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return;
  const { error } = await sb.from('follows').delete().eq('follower_id', u).eq('followee_id', userId);
  if (error) console.warn('unfollow:', error.message);
}

// ---------- Blockieren / Melden (Moderation) ----------
let blockedSet = new Set();
export function getBlocked() { return blockedSet; }
export async function fetchBlocked() {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) { blockedSet = new Set(); return blockedSet; }
  const { data } = await sb.from('blocks').select('blocked_id').eq('blocker_id', u);
  blockedSet = new Set((data || []).map((r) => r.blocked_id));
  return blockedSet;
}
export async function blockUser(userId) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return;
  const { error } = await sb.from('blocks').insert({ blocker_id: u, blocked_id: userId });
  if (error) { console.warn('block:', error.message); return; }
  blockedSet.add(userId);
  await unfollow(userId); // beim Blockieren auch entfolgen
}
export async function unblockUser(userId) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return;
  const { error } = await sb.from('blocks').delete().eq('blocker_id', u).eq('blocked_id', userId);
  if (error) { console.warn('unblock:', error.message); return; }
  blockedSet.delete(userId);
}
export async function reportTarget(targetType, targetId, reason) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return false;
  const { error } = await sb.from('reports').insert({ reporter_id: u, target_type: targetType, target_id: String(targetId), reason: reason || null });
  if (error) { console.warn('report:', error.message); return false; }
  return true;
}
// Entfernt Einträge blockierter Autoren. getId(x) -> Autor-User-ID des Eintrags.
function dropBlocked(arr, getId) {
  if (!blockedSet.size) return arr;
  return (arr || []).filter((x) => { const id = getId(x); return !id || !blockedSet.has(id); });
}

// ---------- Likes & Kommentare auf Aktivitäten (Sammlungseinträge) ----------
export async function toggleActivityLike(itemId) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return null;
  const { data: ex } = await sb.from('activity_likes').select('item_id').eq('item_id', itemId).eq('user_id', u).maybeSingle();
  if (ex) { await sb.from('activity_likes').delete().eq('item_id', itemId).eq('user_id', u); return false; }
  await sb.from('activity_likes').insert({ item_id: itemId, user_id: u });
  return true;
}
export async function fetchLikeInfo(itemId) {
  const sb = await cloud(); const u = uid();
  if (!sb) return { count: 0, liked: false };
  const { data } = await sb.from('activity_likes').select('user_id').eq('item_id', itemId);
  const arr = data || [];
  return { count: arr.length, liked: u ? arr.some((r) => r.user_id === u) : false };
}
export async function fetchComments(itemId) {
  const sb = await cloud(); if (!sb) return [];
  const { data } = await sb.from('comments').select('*').eq('item_id', itemId).order('created_at', { ascending: true });
  const rows = data || [];
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: profs } = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', ids);
  const pm = {}; (profs || []).forEach((p) => { pm[p.id] = p; });
  return rows.map((r) => ({ id: r.id, userId: r.user_id, text: r.text, createdAt: r.created_at, by: pm[r.user_id] || null }));
}
export async function addComment(itemId, text) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u || !text.trim()) return null;
  const { data, error } = await sb.from('comments').insert({ item_id: itemId, user_id: u, text: text.trim() }).select().maybeSingle();
  if (error) { console.warn('comment:', error.message); return null; }
  return data;
}
export async function deleteComment(id) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return;
  await sb.from('comments').delete().eq('id', id).eq('user_id', u);
}

// ---------- Tagebuch / Hör-Log ----------
export async function addPlay(itemId, playedOn, note) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return null;
  const { data, error } = await sb.from('plays').insert({
    user_id: u, item_id: itemId,
    played_on: playedOn || new Date().toISOString().slice(0, 10),
    note: (note || '').trim() || null,
  }).select().maybeSingle();
  if (error) { console.warn('play:', error.message); return null; }
  return data;
}
export async function fetchPlays(itemId) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return [];
  const { data } = await sb.from('plays').select('*').eq('item_id', itemId).eq('user_id', u).order('played_on', { ascending: false });
  return data || [];
}
export async function deletePlay(id) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return;
  await sb.from('plays').delete().eq('id', id).eq('user_id', u);
}
export async function fetchUserPlays(userId) {
  const sb = await cloud(); if (!sb || !userId) return [];
  const { data } = await sb.from('plays').select('*').eq('user_id', userId).order('played_on', { ascending: false });
  return data || [];
}

// Vollständiges Profil eines anderen Nutzers (öffentlich lesbar).
export async function fetchUserProfile(userId) {
  const sb = await cloud(); if (!sb || !userId) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data || null;
}

// Listen (Playlists) eines anderen Nutzers inkl. der enthaltenen Alben (Cover).
export async function fetchUserPlaylists(userId) {
  const sb = await cloud(); if (!sb || !userId) return [];
  const { data: pls } = await sb.from('playlists').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (!pls || !pls.length) return [];
  const plIds = pls.map((p) => p.id);
  const [{ data: plItems }, { data: items }] = await Promise.all([
    sb.from('playlist_items').select('*').in('playlist_id', plIds),
    sb.from('public_items').select('*').eq('user_id', userId),
  ]);
  const map = {}; (items || []).forEach((it) => { map[it.id] = fromRow(it); });
  return pls.map((p) => ({
    id: p.id, name: p.name, description: p.description || '',
    items: (plItems || []).filter((pi) => pi.playlist_id === p.id).sort((a, b) => (a.position || 0) - (b.position || 0)).map((pi) => map[pi.item_id]).filter(Boolean),
  }));
}

// Sammlung/Wishlist eines anderen Nutzers.
export async function fetchUserItems(userId, list = 'collection') {
  const sb = await cloud(); if (!sb || !userId) return [];
  const { data } = await sb.from('public_items').select('*')
    .eq('user_id', userId).eq('list', list).order('added_at', { ascending: false });
  return (data || []).map(fromRow);
}

// Neuzugänge von gefolgten Nutzern (für „New from friends").
export async function fetchFriendsFeed(limit = 20) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return [];
  const { data: f } = await sb.from('follows').select('followee_id').eq('follower_id', u);
  const ids = (f || []).map((r) => r.followee_id);
  if (!ids.length) return [];
  // Neuzugänge UND Hör-Einträge (Tagebuch) der Gefolgten parallel laden
  const [{ data: items }, { data: plays }] = await Promise.all([
    sb.from('public_items').select('*').in('user_id', ids).order('added_at', { ascending: false }).limit(limit),
    sb.from('plays').select('*').in('user_id', ids).order('created_at', { ascending: false }).limit(limit),
  ]);
  const itemRows = items || [];
  const playRows = plays || [];
  // Album-Daten für Plays nachladen (Item-Referenzen)
  const playItemIds = [...new Set(playRows.map((p) => p.item_id))];
  const playItems = {};
  if (playItemIds.length) {
    const { data: pit } = await sb.from('public_items').select('*').in('id', playItemIds);
    (pit || []).forEach((it) => { playItems[it.id] = it; });
  }
  // Profile aller Beteiligten
  const userIds = [...new Set([...itemRows.map((i) => i.user_id), ...playRows.map((p) => p.user_id)])];
  const pmap = {};
  if (userIds.length) {
    const { data: profs } = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', userIds);
    (profs || []).forEach((p) => { pmap[p.id] = p; });
  }
  const adds = itemRows.map((it) => ({ ...fromRow(it), by: pmap[it.user_id] || null, kind: 'add', ts: it.added_at ? new Date(it.added_at).getTime() : 0 }));
  const plys = playRows.map((p) => {
    const it = playItems[p.item_id]; if (!it) return null;
    return { ...fromRow(it), by: pmap[p.user_id] || null, kind: 'play', playNote: p.note || '', playedOn: p.played_on, ts: p.created_at ? new Date(p.created_at).getTime() : 0 };
  }).filter(Boolean);
  return dropBlocked([...adds, ...plys], (x) => x.by && x.by.id).sort((a, b) => b.ts - a.ts).slice(0, limit);
}

// Reviews-Feed: zuerst Reviews von Gefolgten, danach allgemein neueste Reviews.
export async function fetchReviewsFeed(limit = 30) {
  const sb = await cloud(); const u = uid();
  if (!sb) return [];
  let followeeIds = [];
  if (u) {
    const { data: f } = await sb.from('follows').select('followee_id').eq('follower_id', u);
    followeeIds = (f || []).map((r) => r.followee_id);
  }
  const out = []; const seen = new Set();
  const addRows = async (rows) => {
    const withRev = (rows || []).filter((it) => (it.review || '').trim() && !seen.has(it.id));
    if (!withRev.length) return;
    const userIds = [...new Set(withRev.map((i) => i.user_id))];
    const { data: profs } = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', userIds);
    const pmap = {}; (profs || []).forEach((p) => { pmap[p.id] = p; });
    for (const it of withRev) {
      seen.add(it.id);
      out.push({ ...fromRow(it), by: pmap[it.user_id] || null, ts: it.added_at ? new Date(it.added_at).getTime() : 0 });
    }
  };
  // 1) Reviews von Gefolgten zuerst
  if (followeeIds.length) {
    const { data } = await sb.from('public_items').select('*').in('user_id', followeeIds)
      .not('review', 'is', null).order('added_at', { ascending: false }).limit(limit);
    await addRows(data);
  }
  // 2) Allgemein neueste Reviews auffüllen (eigene ausgenommen)
  if (out.length < limit) {
    const { data } = await sb.from('public_items').select('*')
      .not('review', 'is', null).order('added_at', { ascending: false }).limit(limit * 2);
    await addRows((data || []).filter((it) => !u || it.user_id !== u));
  }
  return dropBlocked(out, (x) => x.by && x.by.id).slice(0, limit);
}

// Listen (Playlists) von Gefolgten – für den „Lists"-Home-Tab.
export async function fetchFriendsLists(limit = 20) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return [];
  const { data: f } = await sb.from('follows').select('followee_id').eq('follower_id', u);
  const ids = (f || []).map((r) => r.followee_id);
  if (!ids.length) return [];
  const { data: pls } = await sb.from('playlists').select('*').in('user_id', ids)
    .order('created_at', { ascending: false }).limit(limit);
  if (!pls || !pls.length) return [];
  const plIds = pls.map((p) => p.id);
  const ownerIds = [...new Set(pls.map((p) => p.user_id))];
  const [{ data: plItems }, { data: items }, { data: profs }] = await Promise.all([
    sb.from('playlist_items').select('*').in('playlist_id', plIds),
    sb.from('public_items').select('*').in('user_id', ownerIds),
    sb.from('profiles').select('id,username,display_name,avatar_url').in('id', ownerIds),
  ]);
  const map = {}; (items || []).forEach((it) => { map[it.id] = fromRow(it); });
  const pmap = {}; (profs || []).forEach((p) => { pmap[p.id] = p; });
  return dropBlocked(pls, (p) => p.user_id).map((p) => ({
    id: p.id, name: p.name, description: p.description || '', by: pmap[p.user_id] || null,
    items: (plItems || []).filter((pi) => pi.playlist_id === p.id).sort((a, b) => (a.position || 0) - (b.position || 0)).map((pi) => map[pi.item_id]).filter(Boolean),
  }));
}

// Reviews suchen (nach Album-Titel oder Künstler/in), öffentlich.
export async function searchReviews(q, limit = 30) {
  const sb = await cloud(); if (!sb || !q.trim()) return [];
  const safe = q.trim().replace(/[%_,()\\]/g, ' ').trim();
  if (!safe) return [];
  const { data } = await sb.from('public_items').select('*').not('review', 'is', null)
    .or(`title.ilike.%${safe}%,artist.ilike.%${safe}%`)
    .order('added_at', { ascending: false }).limit(limit * 2);
  const rows = dropBlocked((data || []).filter((it) => (it.review || '').trim()), (it) => it.user_id);
  if (!rows.length) return [];
  const userIds = [...new Set(rows.map((i) => i.user_id))];
  const { data: profs } = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', userIds);
  const pmap = {}; (profs || []).forEach((p) => { pmap[p.id] = p; });
  return rows.slice(0, limit).map((it) => ({ ...fromRow(it), by: pmap[it.user_id] || null }));
}

// Playlists suchen (nach Name), öffentlich – mit Cover-Vorschau + Ersteller.
export async function searchPlaylists(q, limit = 30) {
  const sb = await cloud(); if (!sb || !q.trim()) return [];
  const safe = q.trim().replace(/[%_,()\\]/g, ' ').trim();
  if (!safe) return [];
  const { data: pls } = await sb.from('playlists').select('*').ilike('name', `%${safe}%`)
    .order('created_at', { ascending: false }).limit(limit);
  if (!pls || !pls.length) return [];
  const plIds = pls.map((p) => p.id);
  const ownerIds = [...new Set(pls.map((p) => p.user_id))];
  const [{ data: plItems }, { data: items }, { data: profs }] = await Promise.all([
    sb.from('playlist_items').select('*').in('playlist_id', plIds),
    sb.from('public_items').select('*').in('user_id', ownerIds),
    sb.from('profiles').select('id,username,display_name,avatar_url').in('id', ownerIds),
  ]);
  const map = {}; (items || []).forEach((it) => { map[it.id] = fromRow(it); });
  const pmap = {}; (profs || []).forEach((p) => { pmap[p.id] = p; });
  return dropBlocked(pls, (p) => p.user_id).map((p) => ({
    id: p.id, name: p.name, description: p.description || '', by: pmap[p.user_id] || null,
    items: (plItems || []).filter((pi) => pi.playlist_id === p.id).sort((a, b) => (a.position || 0) - (b.position || 0)).map((pi) => map[pi.item_id]).filter(Boolean),
  }));
}

// ---------- Lieblingssongs (einzelne Tracks liken) ----------
export async function fetchSongLikes(albumId) {
  const u = uid(); if (!u || !albumId) return new Set();
  const sb = await cloud(); if (!sb) return new Set();
  const { data } = await sb.from('song_likes').select('position').eq('user_id', u).eq('album_id', String(albumId));
  return new Set((data || []).map((r) => String(r.position)));
}
export async function fetchMyLikedSongs(limit = 4) {
  const u = uid(); if (!u) return [];
  const sb = await cloud(); if (!sb) return [];
  const { data } = await sb.from('song_likes')
    .select('album_id,position,title,artist,album,created_at')
    .eq('user_id', u).order('created_at', { ascending: false }).limit(limit);
  return (data || []).map((r) => ({ albumId: r.album_id, position: r.position, title: r.title || '', artist: r.artist || '', album: r.album || '' }));
}
export async function toggleSongLike(album, track) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u) return null;
  const albumId = String(album.sourceId || album.masterId || '');
  const pos = String(track.position || '');
  if (!albumId) return null;
  const { data: ex } = await sb.from('song_likes').select('position')
    .eq('user_id', u).eq('album_id', albumId).eq('position', pos).maybeSingle();
  if (ex) {
    await sb.from('song_likes').delete().eq('user_id', u).eq('album_id', albumId).eq('position', pos);
    return false;
  }
  await sb.from('song_likes').insert({
    user_id: u, album_id: albumId, position: pos,
    title: track.title || null, artist: album.artist || null, album: album.title || null,
  });
  return true;
}

// ---------- Community-Bewertung eines Albums (alle Profile) ----------
// Aggregiert die Bewertungen ALLER Nutzer für dasselbe Album (per Master-Release,
// sonst Pressung/Source, sonst Künstler+Titel). Eine Bewertung pro Nutzer.
export async function fetchAlbumRatings(item) {
  const sb = await cloud(); if (!sb || !item) return [];
  let q = sb.from('public_items').select('rating,user_id').gt('rating', 0);
  if (item.masterId && Number(item.masterId) > 0) q = q.eq('master_id', Number(item.masterId));
  else if (item.sourceId) q = q.eq('source_id', String(item.sourceId));
  else if (item.title) {
    const esc = (s) => String(s || '').replace(/[%_\\]/g, (m) => '\\' + m);
    q = q.ilike('title', esc(item.title)).ilike('artist', esc(item.artist || ''));
  } else return [];
  const { data } = await q;
  const seen = new Set(); const out = [];
  for (const r of (data || [])) {
    if (seen.has(r.user_id) || blockedSet.has(r.user_id)) continue; // eine Bewertung pro Nutzer, blockierte raus
    seen.add(r.user_id); out.push(Number(r.rating));
  }
  return out.filter((n) => n > 0);
}

// Öffentliche Reviews ALLER Nutzer zu einem Album (eine pro Nutzer, neueste zuerst).
export async function fetchAlbumReviews(item, limit = 30) {
  const sb = await cloud(); if (!sb || !item) return [];
  let q = sb.from('public_items').select('user_id,rating,review,added_at').not('review', 'is', null);
  if (item.masterId && Number(item.masterId) > 0) q = q.eq('master_id', Number(item.masterId));
  else if (item.sourceId) q = q.eq('source_id', String(item.sourceId));
  else if (item.title) {
    const esc = (s) => String(s || '').replace(/[%_\\]/g, (m) => '\\' + m);
    q = q.ilike('title', esc(item.title)).ilike('artist', esc(item.artist || ''));
  } else return [];
  const { data } = await q.order('added_at', { ascending: false }).limit(limit * 2);
  const rows = (data || []).filter((r) => (r.review || '').trim());
  const seen = new Set(); let uniq = [];
  for (const r of rows) { if (seen.has(r.user_id)) continue; seen.add(r.user_id); uniq.push(r); }
  uniq = dropBlocked(uniq, (r) => r.user_id);
  if (!uniq.length) return [];
  const ids = [...new Set(uniq.map((r) => r.user_id))];
  const { data: profs } = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', ids);
  const pmap = {}; (profs || []).forEach((p) => { pmap[p.id] = p; });
  return uniq.slice(0, limit).map((r) => ({ by: pmap[r.user_id] || null, rating: Number(r.rating) || 0, review: r.review }));
}

// ---------- Sammlungswert-Verlauf (1 Schnappschuss pro Tag) ----------
export async function recordValueSnapshot(value) {
  const sb = await cloud(); const u = uid();
  if (!sb || !u || !(value > 0)) return;
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await sb.from('value_history')
    .upsert({ user_id: u, snap_date: today, value: Math.round(value) }, { onConflict: 'user_id,snap_date' });
  if (error) console.warn('value snapshot:', error.message);
}
export async function fetchValueHistory(userId, limit = 90) {
  const sb = await cloud(); const id = userId || uid();
  if (!sb || !id) return [];
  const { data } = await sb.from('value_history').select('snap_date,value')
    .eq('user_id', id).order('snap_date', { ascending: true }).limit(limit);
  return (data || []).map((r) => ({ date: r.snap_date, value: Number(r.value) }));
}

// ---------- Einstellungen (vorerst global lokal) ----------
export function getSettings() {
  try { return JSON.parse(localStorage.getItem(KEYS.settings)) || {}; } catch { return {}; }
}
export function saveSettings(settings) { write(KEYS.settings, settings); }

// ---------- Backup ----------
export function exportAll() {
  return {
    exportedAt: new Date().toISOString(), version: 2,
    collection: getList('collection'),
    wishlist: getList('wishlist'),
    playlists: getPlaylists(),
    settings: getSettings(),
  };
}
export function importAll(data) {
  if (!data || typeof data !== 'object') throw new Error('Ungültige Datei');
  const coll = Array.isArray(data.collection) ? data.collection : null;
  const wish = Array.isArray(data.wishlist) ? data.wishlist : null;
  const pls = Array.isArray(data.playlists) ? data.playlists : null;
  if (coll) saveList('collection', coll);
  if (wish) saveList('wishlist', wish);
  if (pls) savePlaylists(pls);
  if (data.settings && typeof data.settings === 'object') saveSettings(data.settings);
  // in die Cloud spiegeln, falls eingeloggt
  const u = uid();
  if (u) (async () => {
    const sb = await cloud(); if (!sb) return;
    if (coll) await uploadItems(sb, coll, 'collection', u);
    if (wish) await uploadItems(sb, wish, 'wishlist', u);
    if (pls) await uploadPlaylists(sb, pls, u);
  })();
}

// ---------- Helfer ----------
// Künstlernamen in Wörter zerlegen; führende Artikel (The/Die/…) für die Sortierung ignorieren.
function artistTokens(artist) {
  const a = String(artist || '').trim().replace(/^(the|die|der|das|los|las|les)\s+/i, '');
  return a.split(/\s+/).filter(Boolean);
}
function firstName(artist) { const p = artistTokens(artist); return p[0] || ''; }
function lastName(artist) { const p = artistTokens(artist); return p.length ? p[p.length - 1] : ''; }

export function sortItems(items, mode) {
  const cmp = (x, y) => String(x || '').localeCompare(String(y || ''), 'de', { sensitivity: 'base' });
  const by = (sel) => (a, b) => cmp(sel(a), sel(b));
  const copy = [...items];
  switch (mode) {
    case 'title': return copy.sort(by((i) => i.title));
    case 'rating': return copy.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    case 'year': return copy.sort((a, b) => String(a.year || '').localeCompare(String(b.year || '')));
    case 'added': return copy.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    case 'firstname': // nach Vorname (erstes Wort des Künstlers)
      return copy.sort((a, b) => cmp(firstName(a.artist), firstName(b.artist)) || cmp(a.artist, b.artist) || cmp(a.title, b.title));
    case 'lastname': // nach Nachname (letztes Wort) – gruppiert z. B. alle „… Collins"
      return copy.sort((a, b) => cmp(lastName(a.artist), lastName(b.artist)) || cmp(firstName(a.artist), firstName(b.artist)) || cmp(a.title, b.title));
    case 'artist':
    default: return copy.sort(by((i) => i.artist));
  }
}

export function filterItems(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    [i.artist, i.title, i.note, i.label, i.year, i.barcode]
      .some((f) => String(f || '').toLowerCase().includes(q)));
}
