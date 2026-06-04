// store.js – lokale Datenhaltung (localStorage). Nichts verlässt das Gerät.

const KEYS = {
  collection: 'vinyl.collection',
  wishlist: 'vinyl.wishlist',
  settings: 'vinyl.settings',
  playlists: 'vinyl.playlists',
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getList(list) {
  return read(KEYS[list]);
}

export function saveList(list, items) {
  write(KEYS[list], items);
}

export function addItem(list, item) {
  const items = getList(list);
  const record = {
    id: crypto.randomUUID(),
    addedAt: Date.now(),
    artist: '',
    title: '',
    year: '',
    label: '',
    format: '',
    barcode: '',
    coverUrl: '',
    note: '',
    rating: 0,
    liked: false,
    price: 0,
    source: 'manual',
    sourceId: '',
    ...item,
  };
  items.push(record);
  saveList(list, items);
  return record;
}

export function updateItem(list, id, patch) {
  const items = getList(list);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch };
  saveList(list, items);
  return items[idx];
}

export function deleteItem(list, id) {
  saveList(list, getList(list).filter((i) => i.id !== id));
}

export function moveItem(fromList, toList, id) {
  const items = getList(fromList);
  const item = items.find((i) => i.id === id);
  if (!item) return;
  saveList(fromList, items.filter((i) => i.id !== id));
  const target = getList(toList);
  item.addedAt = Date.now();
  target.push(item);
  saveList(toList, target);
}

// ---------- Playlists ----------
export function getPlaylists() {
  return read(KEYS.playlists);
}
export function savePlaylists(pls) {
  write(KEYS.playlists, pls);
}
export function createPlaylist(name) {
  const pls = getPlaylists();
  const p = { id: crypto.randomUUID(), name: name.trim() || 'Neue Playlist', itemIds: [], createdAt: Date.now() };
  pls.push(p);
  savePlaylists(pls);
  return p;
}
export function deletePlaylist(id) {
  savePlaylists(getPlaylists().filter((p) => p.id !== id));
}
export function renamePlaylist(id, name) {
  const pls = getPlaylists();
  const p = pls.find((x) => x.id === id);
  if (p) { p.name = name.trim() || p.name; savePlaylists(pls); }
}
export function togglePlaylistItem(playlistId, itemId) {
  const pls = getPlaylists();
  const p = pls.find((x) => x.id === playlistId);
  if (!p) return;
  const idx = p.itemIds.indexOf(itemId);
  if (idx >= 0) p.itemIds.splice(idx, 1);
  else p.itemIds.push(itemId);
  savePlaylists(pls);
}

// Einstellungen (Discogs-Token o. Ä.)
export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.settings)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  write(KEYS.settings, settings);
}

// Backup
export function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    collection: getList('collection'),
    wishlist: getList('wishlist'),
    playlists: getPlaylists(),
    settings: getSettings(),
  };
}

export function importAll(data) {
  if (!data || typeof data !== 'object') throw new Error('Ungültige Datei');
  if (Array.isArray(data.collection)) saveList('collection', data.collection);
  if (Array.isArray(data.wishlist)) saveList('wishlist', data.wishlist);
  if (Array.isArray(data.playlists)) savePlaylists(data.playlists);
  if (data.settings && typeof data.settings === 'object') saveSettings(data.settings);
}

// Sortierung
export function sortItems(items, mode) {
  const by = (sel) => (a, b) =>
    String(sel(a) || '').localeCompare(String(sel(b) || ''), 'de', { sensitivity: 'base' });
  const copy = [...items];
  switch (mode) {
    case 'title':
      return copy.sort(by((i) => i.title));
    case 'rating':
      return copy.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    case 'year':
      return copy.sort((a, b) => String(a.year || '').localeCompare(String(b.year || '')));
    case 'added':
      return copy.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    case 'artist':
    default:
      return copy.sort(by((i) => i.artist));
  }
}

export function filterItems(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    [i.artist, i.title, i.note, i.label, i.year, i.barcode]
      .some((f) => String(f || '').toLowerCase().includes(q))
  );
}
