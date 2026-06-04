# Stackd 🎵

Persönliche PWA (Web-App) zum Katalogisieren deiner Schallplatten-Sammlung.

## Funktionen
- **Barcode scannen** mit der Handy-Kamera → automatische Erkennung über MusicBrainz + Discogs
- **Manuell hinzufügen** für Platten ohne Barcode oder ohne Treffer
- **Eigene Notizen** pro Album (z. B. „rote Vinyl, limited edition")
- **Wishlist** mit alphabetischer Sortierung (und nach Titel/Jahr/Datum)
- **Suche & Sortierung** in Sammlung und Wishlist
- **Verschieben** zwischen Sammlung und Wishlist (z. B. wenn du eine Platte gekauft hast)
- **Backup**: Export/Import als JSON-Datei
- **Nur lokal**: Alle Daten bleiben im Browser deines Geräts. Nichts wird hochgeladen.

## Discogs-Token (empfohlen für Vinyl-Details)
Ohne Token nutzt die App nur MusicBrainz. Mit Token kommen genauere Vinyl-Infos
(Pressung, Format, Cover) dazu:
1. Bei [discogs.com](https://www.discogs.com) anmelden
2. Einstellungen → **Developers** → „Generate new token"
3. In der App unter **Mehr → Discogs API-Token** einfügen und speichern

## Am PC testen
Eine PWA mit Kamera braucht einen lokalen Webserver (Doppelklick auf `index.html`
reicht nicht). Im Projektordner z. B.:

```powershell
# Variante mit Python
python -m http.server 8080
# dann im Browser: http://localhost:8080
```

```powershell
# Variante mit Node
npx serve .
```

`localhost` gilt als sicher, daher funktioniert hier sogar die Webcam.

## Aufs Handy bringen (HTTPS nötig für die Kamera)
Die einfachste Variante ohne eigenen Server:
1. Gehe zu **app.netlify.com/drop** (oder Cloudflare Pages / Vercel)
2. Ziehe den **gesamten Ordner** `schallplatten-app` ins Browserfenster
3. Du bekommst eine HTTPS-Adresse (z. B. `https://xyz.netlify.app`)
4. Öffne diese Adresse auf dem Handy → Browser-Menü → **Zum Startbildschirm hinzufügen**

Fertig – die App liegt als Icon auf dem Homescreen und läuft wie eine echte App.
Deine Sammlung bleibt dabei lokal auf dem Handy gespeichert.

## Projektstruktur
```
schallplatten-app/
├─ index.html            App-Hülle & Oberfläche
├─ styles.css            Design (dark, mobile-first)
├─ manifest.webmanifest  PWA-Manifest
├─ service-worker.js     Offline-Cache der App-Dateien
├─ icons/icon.svg        App-Icon
└─ js/
   ├─ app.js             Navigation, Rendering, Abläufe
   ├─ store.js           Lokale Datenhaltung (localStorage)
   ├─ api.js             Barcode-Lookup (MusicBrainz + Discogs)
   └─ scanner.js         Kamera-Barcode-Scanner
```
