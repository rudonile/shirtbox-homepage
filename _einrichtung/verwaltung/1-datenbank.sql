-- ShirtBOX Verwaltung – Datenbank (Cloudflare D1, Name: shirtbox-verwaltung)
-- Einmal komplett in der D1-Konsole ausführen. Mehrfaches Ausführen schadet nicht.
-- Bereich 1: Kunden und Bestellungen. Bereich 2: Newsletter (getrennte Tabellen, nur per E-Mail verknüpfbar).

-- ===== Bereich 1: Kunden und Bestellungen =====
CREATE TABLE IF NOT EXISTS kunden (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Kundennummer = K-(10000 + id)
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  vorname TEXT NOT NULL,
  nachname TEXT NOT NULL,
  telefon TEXT,
  strasse TEXT,
  plz TEXT,
  ort TEXT,
  land TEXT,
  erste_bestellung TEXT NOT NULL,                -- ISO-Zeitpunkt (UTC)
  aktualisiert TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bestellungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bestellnummer TEXT NOT NULL UNIQUE,
  client_id TEXT UNIQUE,                         -- Schutz gegen doppelte Speicherung
  kunde_id INTEGER NOT NULL REFERENCES kunden(id),
  erstellt TEXT NOT NULL,                        -- ISO-Zeitpunkt (UTC)
  datum TEXT NOT NULL,                           -- Kalendertag in Zürich (JJJJ-MM-TT) für Auswertungen
  anzahl INTEGER NOT NULL,
  total_rappen INTEGER NOT NULL,
  versand_rappen INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'neu',            -- neu, bearbeitung, produziert, versendet, abgeschlossen, storniert
  zahlung TEXT NOT NULL DEFAULT 'offen',         -- offen, bezahlt, rueckerstattet
  bezahlt_am TEXT,
  lieferadresse TEXT NOT NULL,                   -- Adresse zum Zeitpunkt der Bestellung (JSON)
  notiz TEXT,
  agb TEXT
);
CREATE INDEX IF NOT EXISTS bestellungen_kunde ON bestellungen(kunde_id);
CREATE INDEX IF NOT EXISTS bestellungen_datum ON bestellungen(datum);

CREATE TABLE IF NOT EXISTS bestell_designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id) ON DELETE CASCADE,
  design_nr INTEGER NOT NULL,
  anzahl INTEGER NOT NULL,
  einzelpreis_rappen INTEGER NOT NULL,           -- Preis des ersten Shirts dieses Designs
  summe_rappen INTEGER NOT NULL,
  farbe TEXT,
  details TEXT,                                  -- Platzierung / Gestaltungseinstellungen
  bild_vorschau TEXT,                            -- R2-Schlüssel (Vorder- und Rückseite in einem Bild)
  bild_druck TEXT,                               -- R2-Schlüssel der Druckdatei
  bilder_original TEXT,                          -- JSON-Liste von R2-Schlüsseln
  rechte INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bestell_designs_bestellung ON bestell_designs(bestellung_id);

CREATE TABLE IF NOT EXISTS bestell_groessen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id INTEGER NOT NULL REFERENCES bestell_designs(id) ON DELETE CASCADE,
  groesse TEXT NOT NULL,                         -- vom Kunden gewählt
  bestellgroesse TEXT NOT NULL,                  -- beim Lieferanten (asiatisch, +2)
  anzahl INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bestell_groessen_design ON bestell_groessen(design_id);

-- ===== Bereich 2: Newsletter =====
CREATE TABLE IF NOT EXISTS abonnenten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,     -- jede Adresse nur einmal
  vorname TEXT,
  nachname TEXT,
  status TEXT NOT NULL DEFAULT 'ausstehend',     -- ausstehend, aktiv, abgemeldet, unzustellbar, beschwerde
  angemeldet TEXT NOT NULL,                      -- Zeitpunkt der Anmeldung
  einwilligung_zeit TEXT,                        -- Zeitpunkt der bestätigten Einwilligung (Double-Opt-in)
  einwilligung_quelle TEXT,                      -- z. B. Startseite, Bestellung SB-…
  einwilligung_text TEXT,                        -- exakter Wortlaut, dem zugestimmt wurde
  bestaetigung_gesendet TEXT,
  abgemeldet TEXT,
  token TEXT NOT NULL UNIQUE                     -- geheimer Schlüssel für Bestätigungs- und Abmeldelink
);
CREATE INDEX IF NOT EXISTS abonnenten_status ON abonnenten(status);

CREATE TABLE IF NOT EXISTS newsletter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  betreff TEXT NOT NULL,
  inhalt TEXT NOT NULL,                          -- JSON: Vorschautext und Blöcke
  status TEXT NOT NULL DEFAULT 'entwurf',        -- entwurf, versand, versendet
  erstellt TEXT NOT NULL,
  geaendert TEXT NOT NULL,
  versand_start TEXT,
  versand_ende TEXT,
  empfaenger INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS newsletter_empfaenger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  newsletter_id INTEGER NOT NULL REFERENCES newsletter(id) ON DELETE CASCADE,
  abonnent_id INTEGER NOT NULL REFERENCES abonnenten(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'wartend',        -- wartend, gesendet, zugestellt, fehler, unzustellbar, beschwerde, uebersprungen
  resend_id TEXT,
  gesendet TEXT,
  fehler TEXT,
  UNIQUE(newsletter_id, abonnent_id)
);
CREATE INDEX IF NOT EXISTS newsletter_empfaenger_status ON newsletter_empfaenger(status);
CREATE INDEX IF NOT EXISTS newsletter_empfaenger_resend ON newsletter_empfaenger(resend_id);

-- ===== Verwaltung =====
CREATE TABLE IF NOT EXISTS einstellungen (
  schluessel TEXT PRIMARY KEY,
  wert TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anmeldeversuche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zeit TEXT NOT NULL,
  erfolg INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS protokoll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zeit TEXT NOT NULL,
  aktion TEXT NOT NULL                           -- nur Aktionen, keine Kundendaten
);
