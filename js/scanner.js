// scanner.js – Barcode-Scanner per Kamera (html5-qrcode, UMD global).

let html5qr = null;
let running = false;
let starting = false; // verhindert Doppelstart (Quelle des "under transition"-Fehlers)

// Nur die für Tonträger relevanten Barcode-Typen -> weniger Rechenarbeit.
const FORMATS = window.Html5QrcodeSupportedFormats
  ? [
      window.Html5QrcodeSupportedFormats.EAN_13,
      window.Html5QrcodeSupportedFormats.EAN_8,
      window.Html5QrcodeSupportedFormats.UPC_A,
      window.Html5QrcodeSupportedFormats.UPC_E,
    ]
  : undefined;

export function isSupported() {
  return typeof window.Html5Qrcode !== 'undefined';
}

function makeInstance(elementId) {
  return new window.Html5Qrcode(elementId, {
    formatsToSupport: FORMATS,
    // Schnelle, native Barcode-Erkennung des Browsers nutzen, wenn vorhanden.
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });
}

async function cleanup() {
  if (!html5qr) return;
  try { await html5qr.stop(); } catch { /* war evtl. nie gestartet */ }
  try { await html5qr.clear(); } catch { /* ignorieren */ }
  html5qr = null;
}

export async function startScanner(elementId, onDetected, onError) {
  if (!isSupported()) {
    onError?.('Scanner-Bibliothek nicht geladen (offline?). Bitte Barcode unten eintippen.');
    return false;
  }
  if (running || starting) return true; // bereits aktiv / gerade am Starten
  starting = true;

  const config = {
    fps: 10,
    // Breiter, flacher Scan-Rahmen in Barcode-Form. Begrenzte Breite =
    // weniger Pixel zu analysieren = schneller.
    qrbox: (viewW, viewH) => {
      const w = Math.min(Math.floor(viewW * 0.92), 460);
      return { width: w, height: Math.floor(w * 0.45) };
    },
    aspectRatio: 1.7778,
    // Nicht zusätzlich das gespiegelte Bild scannen -> halbiert die Arbeit.
    disableFlip: true,
    rememberLastUsedCamera: true,
  };

  // Reihenfolge der Kamera-Versuche – jeweils mit FRISCHER Instanz, damit
  // niemals zweimal start() auf derselben (noch transitionierenden) Instanz
  // läuft. 720p zuerst (schnellere Verarbeitung als die volle iPhone-Auflösung).
  const attempts = [
    { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: { ideal: 'environment' } },
    { facingMode: 'environment' },
  ];

  let lastError = null;
  const tryStart = async (cameraIdOrConfig) => {
    html5qr = makeInstance(elementId);
    await html5qr.start(
      cameraIdOrConfig,
      config,
      (decodedText) => onDetected?.(decodedText),
      () => {} // pro-Frame-Fehler ignorieren
    );
  };

  for (const constraints of attempts) {
    try {
      await tryStart(constraints);
      running = true;
      starting = false;
      return true;
    } catch (err) {
      lastError = err;
      await cleanup(); // sauber aufräumen, bevor der nächste Versuch startet
    }
  }

  // Letzter Ausweg: Kameras auflisten und die (meist hintere) per ID starten.
  try {
    const cameras = await window.Html5Qrcode.getCameras();
    if (cameras && cameras.length) {
      const back = cameras.find((c) => /back|rear|environment/i.test(c.label)) || cameras[cameras.length - 1];
      await tryStart(back.id);
      running = true;
      starting = false;
      return true;
    }
  } catch (err) {
    lastError = err;
    await cleanup();
  }

  starting = false;
  const msg = lastError?.message || String(lastError || 'Unbekannter Fehler');
  if (/NotAllowed|Permission|denied/i.test(msg)) {
    onError?.('Kamera-Zugriff wurde nicht erlaubt. Bitte in den Safari-/Browser-Einstellungen die Kamera für diese Seite zulassen.');
  } else if (/NotFound|Requested device/i.test(msg)) {
    onError?.('Keine Kamera gefunden.');
  } else {
    onError?.('Kamera konnte nicht gestartet werden: ' + msg);
  }
  return false;
}

export async function stopScanner() {
  if (!html5qr) { running = false; return; }
  await cleanup();
  running = false;
}

export function isRunning() {
  return running;
}
