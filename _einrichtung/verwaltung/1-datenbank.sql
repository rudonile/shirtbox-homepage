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

-- ===== Bereich 3: Buchhaltung (vereinfachte Einnahmen-/Ausgabenrechnung) =====
-- Nur neue Tabellen. Beträge in Rappen (ganze Zahlen). Nichts wird gelöscht: storniert = Zeitpunkt der Stornierung.
CREATE TABLE IF NOT EXISTS bh_kategorien (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  art TEXT NOT NULL,                             -- ausgabe, einnahme
  name TEXT NOT NULL,
  aktiv INTEGER NOT NULL DEFAULT 1,
  UNIQUE(art, name)
);
INSERT OR IGNORE INTO bh_kategorien (art, name) VALUES ('ausgabe', 'Textilien'), ('ausgabe', 'DTF-Druckmaterial'), ('ausgabe', 'Druckfolien und Verbrauchsmaterial'),
  ('ausgabe', 'Verpackungsmaterial'), ('ausgabe', 'Versandkosten'), ('ausgabe', 'Software und Hosting'), ('ausgabe', 'Werbung und Marketing'),
  ('ausgabe', 'Maschinen und Geräte'), ('ausgabe', 'Büromaterial'), ('ausgabe', 'Sonstige Betriebsausgaben'),
  ('einnahme', 'Sonstige Verkäufe'), ('einnahme', 'Dienstleistungen'), ('einnahme', 'Sonstige Einnahmen');

CREATE TABLE IF NOT EXISTS bh_lieferanten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kontakt TEXT, email TEXT, telefon TEXT, adresse TEXT, website TEXT, notiz TEXT,
  erstellt TEXT NOT NULL,
  geaendert TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bh_belege (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Belegreferenz B-00001
  schluessel TEXT NOT NULL UNIQUE,               -- R2-Schlüssel belege/JJJJ/…
  dateiname TEXT NOT NULL,
  typ TEXT NOT NULL,
  groesse INTEGER NOT NULL,
  sha256 TEXT UNIQUE,                            -- gleiche Datei nur einmal
  notiz TEXT,
  hochgeladen TEXT NOT NULL,
  archiviert TEXT,                               -- nie endgültig gelöscht, nur archiviert
  archiv_grund TEXT
);

CREATE TABLE IF NOT EXISTS bh_ausgaben (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Belegreferenz A-00001
  datum TEXT NOT NULL,
  lieferant_id INTEGER REFERENCES bh_lieferanten(id),
  beschreibung TEXT NOT NULL,
  kategorie_id INTEGER NOT NULL REFERENCES bh_kategorien(id),
  netto_rappen INTEGER NOT NULL,
  mwst_satz REAL NOT NULL DEFAULT 0,
  mwst_rappen INTEGER NOT NULL DEFAULT 0,
  brutto_rappen INTEGER NOT NULL,
  zahlungsart TEXT,
  zahlung TEXT NOT NULL DEFAULT 'bezahlt',       -- offen, bezahlt
  bezahlt_am TEXT,
  beleg_id INTEGER REFERENCES bh_belege(id),
  wiederkehrend TEXT NOT NULL DEFAULT '',        -- '', monatlich, jaehrlich
  vorlage_id INTEGER,                            -- automatisch erzeugt aus dieser wiederkehrenden Ausgabe
  periode TEXT,                                  -- JJJJ-MM der automatischen Erfassung
  notiz TEXT,
  storniert TEXT,
  storno_grund TEXT,
  erstellt TEXT NOT NULL,
  geaendert TEXT NOT NULL,
  UNIQUE(vorlage_id, periode)
);
CREATE INDEX IF NOT EXISTS bh_ausgaben_datum ON bh_ausgaben(datum);
CREATE INDEX IF NOT EXISTS bh_ausgaben_lieferant ON bh_ausgaben(lieferant_id);

CREATE TABLE IF NOT EXISTS bh_einnahmen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- nur manuelle Einnahmen (Bestellungen laufen über bh_zahlungen), Referenz E-00001
  datum TEXT NOT NULL,
  beschreibung TEXT NOT NULL,
  kunde TEXT,
  kategorie_id INTEGER NOT NULL REFERENCES bh_kategorien(id),
  betrag_rappen INTEGER NOT NULL,
  mwst_satz REAL NOT NULL DEFAULT 0,
  mwst_rappen INTEGER NOT NULL DEFAULT 0,
  zahlungsart TEXT,
  beleg_id INTEGER REFERENCES bh_belege(id),
  bestellung_id INTEGER REFERENCES bestellungen(id),
  notiz TEXT,
  storniert TEXT,
  storno_grund TEXT,
  erstellt TEXT NOT NULL,
  geaendert TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bh_einnahmen_datum ON bh_einnahmen(datum);

CREATE TABLE IF NOT EXISTS bh_zahlungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Zahlungseingänge und Rückerstattungen zu Bestellungen, Referenz Z-00001
  bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id),
  datum TEXT NOT NULL,
  betrag_rappen INTEGER NOT NULL,                -- Rückerstattung negativ
  art TEXT NOT NULL,                             -- zahlung, rueckerstattung
  zahlungsart TEXT,
  quelle TEXT NOT NULL DEFAULT 'manuell',        -- manuell, status (aus Bestellansicht), uebernahme
  notiz TEXT,
  storniert TEXT,
  storno_grund TEXT,
  erstellt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bh_zahlungen_bestellung ON bh_zahlungen(bestellung_id);
CREATE INDEX IF NOT EXISTS bh_zahlungen_datum ON bh_zahlungen(datum);

CREATE TABLE IF NOT EXISTS bh_kosten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- direkte Kosten pro Bestellung (Kalkulation, nicht als Ausgabe gezählt)
  bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id),
  art TEXT NOT NULL,                             -- textilien, druck, verpackung, versand, gebuehren, sonstiges
  betrag_rappen INTEGER NOT NULL,
  notiz TEXT,
  geaendert TEXT NOT NULL,
  UNIQUE(bestellung_id, art)
);

CREATE TABLE IF NOT EXISTS bh_rechnungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nummer TEXT NOT NULL UNIQUE,                   -- RE-2026-0001 bzw. GS-2026-0001, fortlaufend, nie verändert
  art TEXT NOT NULL,                             -- rechnung, gutschrift
  bestellung_id INTEGER REFERENCES bestellungen(id),
  bezug_id INTEGER REFERENCES bh_rechnungen(id), -- Gutschrift: zugehörige Rechnung
  datum TEXT NOT NULL,
  faellig TEXT NOT NULL,
  betrag_rappen INTEGER NOT NULL,
  daten TEXT NOT NULL,                           -- festgehaltener Rechnungsinhalt (JSON)
  beleg_id INTEGER REFERENCES bh_belege(id),
  storniert TEXT,
  storno_grund TEXT,
  erstellt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bh_rechnung_je_bestellung ON bh_rechnungen(bestellung_id) WHERE art = 'rechnung' AND storniert IS NULL;
