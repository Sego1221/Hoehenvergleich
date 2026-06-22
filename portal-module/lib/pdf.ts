import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";

// -----------------------------------------------------------------------------
// PDF-Protokoll Höhenvergleich (Soll-Ist-Aushubkontrolle).
//
// Layout/Branding übernommen aus dem PIX4D-Messprotokoll
// (messprotokoll/lib/mess-protokoll/pdf.ts): gleiches Birchmeier-Logo, gleiche
// Markenfarben (#20683D-Grün, Graustufen), gleiche Schriftgrössen/Geometrie für
// Deckblatt, Projekt-Infoblock, Tabellen-/Kachel-Stil und Fusszeile.
//
// Reines pdf-lib (kein Chromium / keine nativen Abhängigkeiten -> Railway-tauglich).
// Vektor-Primitive für die Höhenprofile, Bild-Einbettung für Logo + dZ-Karte.
// -----------------------------------------------------------------------------

// ---- Markenfarben (1:1 aus der Vorlage) ----
const BM = rgb(0x20 / 255, 0x68 / 255, 0x3d / 255); // Birchmeier-Grün #20683D
const BM_LIGHT = rgb(0xe7 / 255, 0xf0 / 255, 0xea / 255);
const INK = rgb(0x0f / 255, 0x17 / 255, 0x2a / 255);
const MUTED = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
const LINE = rgb(0.78, 0.82, 0.8);
const GRID = rgb(0.85, 0.88, 0.86);
// Profil-Linienfarben: Soll grau-blau, Ist BM-Grün, dZ kräftiges Rot/Magenta.
const SOLL_LINIE = rgb(0x33 / 255, 0x44 / 255, 0x66 / 255);
const IST_LINIE = BM;
const DZ_LINIE = rgb(0xc2 / 255, 0x41 / 255, 0x0c / 255);
const CUT_FARBE = rgb(0xb9 / 255, 0x1c / 255, 0x1c / 255); // Abtrag (rot)
const FILL_FARBE = rgb(0x1d / 255, 0x4e / 255, 0xd8 / 255); // Auffüllung (blau)

// A4 HOCHFORMAT / Portrait (Punkt = 1/72 Zoll). Identisch zur Vorlage.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;

// ---------------------------------------------------------------------------
// Eingabe-Datenstruktur (wird von der Route aus DB + Compute zusammengestellt).
// ---------------------------------------------------------------------------

export interface ProfilDaten {
  name: string;
  kind?: string | null; // "laengs" | "quer" | frei
  dist: number[];
  soll: (number | null)[];
  ist: (number | null)[];
  dz: (number | null)[];
  lengthM?: number | null;
}

export interface BereichDaten {
  name: string;
  areaM2?: number | null;
  cutM3?: number | null;
  fillM3?: number | null;
  netM3?: number | null;
}

export interface ProtokollStats {
  areaM2?: number | null;
  cutM3?: number | null;
  fillM3?: number | null;
  netM3?: number | null;
  onTargetPct?: number | null;
  medianM?: number | null;
  meanM?: number | null;
  stdM?: number | null;
  minM?: number | null;
  maxM?: number | null;
}

export interface ProtokollDaten {
  // Projekt-Grundfelder (Birchmeier-Standard).
  projektNummer?: string | null;
  projektName?: string | null;
  adresse?: string | null;
  ort?: string | null;
  // Vergleich.
  vergleichName: string;
  surveyDate?: string | null; // ISO oder leer -> heute
  sollName?: string | null;
  istName?: string | null;
  koordinatensystem?: string | null; // Default LV95 (EPSG:2056) / LN02
  tol: number; // Toleranz in m (für "auf Soll %" + dZ-Karte)
  mode?: "aushub" | "clouds"; // clouds = Wolke-gegen-Wolke (ΔZ = B − A)
  stats: ProtokollStats;
  // dZ-Übersichtskarte als PNG-Bytes (vom Compute-Service /dz.png).
  dzPng?: Uint8Array | null;
  profile?: ProfilDaten[];
  bereiche?: BereichDaten[];
  generatedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen (Formatierung im Schweizer Stil, Text-Kürzung).
// ---------------------------------------------------------------------------

function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function m3(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return num(v, digits) + " m³";
}
function m2(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return num(v, digits) + " m²";
}
function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return num(v, digits) + " %";
}
function cm(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return (v * 100).toLocaleString("de-CH", { maximumFractionDigits: 1 }) + " cm";
}
function dateCH(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-CH");
}

// Text auf eine Breite kürzen (mit Ellipse) — Vorlage-Konvention.
function fitOn(str: string, f: PDFFont, size: number, max: number): string {
  let out = str;
  if (f.widthOfTextAtSize(out, size) <= max) return out;
  while (out.length > 1 && f.widthOfTextAtSize(out + "…", size) > max) out = out.slice(0, -1);
  return out + "…";
}

// Text an Wortgrenzen in Zeilen umbrechen, die in `max` (Punkte) passen.
function wrapPdfText(str: string, f: PDFFont, size: number, max: number): string[] {
  const woerter = str.split(/\s+/).filter((w) => w.length > 0);
  const zeilen: string[] = [];
  let aktuell = "";
  const passt = (s: string) => f.widthOfTextAtSize(s, size) <= max;
  for (const wort of woerter) {
    const kandidat = aktuell ? `${aktuell} ${wort}` : wort;
    if (passt(kandidat)) {
      aktuell = kandidat;
      continue;
    }
    if (aktuell) zeilen.push(aktuell);
    let rest = wort;
    while (!passt(rest) && rest.length > 1) {
      let teil = rest;
      while (teil.length > 1 && !passt(teil)) teil = teil.slice(0, -1);
      zeilen.push(teil);
      rest = rest.slice(teil.length);
    }
    aktuell = rest;
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen.length > 0 ? zeilen : [""];
}

// ---------------------------------------------------------------------------
// Hauptfunktion.
// ---------------------------------------------------------------------------

export async function makeProtocolPdf(data: ProtokollDaten): Promise<Uint8Array> {
  // Wolke-gegen-Wolke: ΔZ = B − A; Abtrag/Auftrag gegenüber dem Aushub
  // vertauscht. Werte einmalig umsortieren, damit der Rest generisch bleibt.
  const isClouds = data.mode === "clouds";
  const SUBTITLE = isClouds ? "Wolke-gegen-Wolke (Höhendifferenz)" : "Soll-Ist-Aushubkontrolle";
  const QUELLE = isClouds ? "Höhenvergleich (zwei Punktwolken)" : "Höhenvergleich (PIX4D-Wolke vs. Soll-Modell)";
  const swap = <T extends { cutM3?: number | null; fillM3?: number | null }>(o: T): T =>
    isClouds ? { ...o, cutM3: o.fillM3 ?? null, fillM3: o.cutM3 ?? null } : o;

  const doc = await PDFDocument.create();
  doc.setTitle(`Höhenvergleich-Protokoll ${data.vergleichName}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Logo (gleiches Asset wie messprotokoll, liegt in public/).
  let logo: { embed: PDFImage; w: number; h: number } | null = null;
  try {
    const logoBytes = await readFile(path.join(process.cwd(), "public", "birchmeier_logo.png"));
    const embed = await doc.embedPng(logoBytes);
    logo = { embed, w: embed.width, h: embed.height };
  } catch {
    logo = null;
  }

  // dZ-Karte einbetten (PNG).
  let dzImg: { embed: PDFImage; w: number; h: number } | null = null;
  if (data.dzPng && data.dzPng.length > 0) {
    try {
      const embed = await doc.embedPng(data.dzPng);
      dzImg = { embed, w: embed.width, h: embed.height };
    } catch {
      dzImg = null;
    }
  }

  const pages: PDFPage[] = [];
  const newPage = (): PDFPage => {
    const pg = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(pg);
    return pg;
  };

  // pdf-lib-Standardschrift kann nur WinAnsi. Sonderzeichen säubern, damit
  // dynamische Texte (Projektname, Dateinamen) nie einen Encoding-Crash auslösen.
  const san = (s: string): string =>
    (s ?? "")
      .replace(/[Δ]/g, "d")              // Δ -> d (dZ)
      .replace(/[−–—]/g, "-")   // −, –, — -> -
      .replace(/[‘’]/g, "'")         // ' ' -> '
      .replace(/[“”]/g, '"')         // " " -> "
      .replace(/[^ -ÿ]/g, "?");      // alles ausserhalb Latin-1 -> ?

  const text = (
    pg: PDFPage,
    str: string,
    x: number,
    y: number,
    size: number,
    f: PDFFont = font,
    color: RGB = INK,
  ) => {
    pg.drawText(san(str), { x, y, size, font: f, color });
  };

  const koord =
    data.koordinatensystem && data.koordinatensystem.trim().length > 0
      ? data.koordinatensystem
      : "LV95 (EPSG:2056) / LN02";

  // ======================================================================= //
  // DECKBLATT — gleiche Geometrie/Typografie wie die Vorlage.
  // ======================================================================= //
  const cover = newPage();
  {
    const coverAvail = PAGE_W - 2 * MARGIN;

    // Birchmeier-Logo oben RECHTS (Breite 170, wie Vorlage).
    if (logo) {
      const lw = 170;
      const lh = (lw * logo.h) / logo.w;
      const lx = PAGE_W - MARGIN - lw;
      const ly = PAGE_H - MARGIN;
      cover.drawImage(logo.embed, { x: lx, y: ly - lh, width: lw, height: lh });
    }

    // Titel auf ~2/3 der Seitenhöhe, linksbündig (wie "Messprotokoll").
    let y = PAGE_H / 3;
    text(cover, "Höhenvergleich", MARGIN, y, 28, fontBold, BM);
    y -= 22;
    text(cover, SUBTITLE, MARGIN, y, 14, fontBold, MUTED);
    y -= 30;
    text(
      cover,
      fitOn(data.vergleichName, fontBold, 15, coverAvail),
      MARGIN,
      y,
      15,
      fontBold,
      INK,
    );
    y -= 28;

    // Projekt-Infoblock — gleiche Felder/Stil/Geometrie wie PIX4D (labelW 150,
    // lineH 18, Label fett MUTED, Wert normal INK).
    const infoRows: [string, string][] = [
      ["Projektnummer", data.projektNummer ?? ""],
      ["Projektname", data.projektName ?? ""],
      ["Adresse", data.adresse ?? ""],
      ["Ort", data.ort ?? ""],
      ["Datum", dateCH(data.surveyDate ?? new Date())],
      ["Koordinatensystem", koord],
      ["Soll-Datei", data.sollName ?? ""],
      ["Ist-Datei", data.istName ?? ""],
      ["Toleranz", `± ${cm(data.tol)}`],
      ["Quelle", QUELLE],
    ];
    const labelW = 150;
    const lineH = 18;
    for (const [label, val] of infoRows) {
      text(cover, label, MARGIN, y, 10, fontBold, MUTED);
      text(cover, fitOn(val, font, 10, coverAvail - labelW), MARGIN + labelW, y, 10, font, INK);
      y -= lineH;
    }
  }

  // ======================================================================= //
  // dZ-ÜBERSICHTSKARTE (eigene Seite, gross) — wie "Übersicht – Messungen".
  // ======================================================================= //
  if (dzImg) {
    const ovPage = newPage();
    let oy = PAGE_H - MARGIN;
    text(ovPage, "dZ-Übersichtskarte", MARGIN, oy - 14, 18, fontBold, BM);
    oy -= 30;
    text(
      ovPage,
      isClouds
        ? `Höhendifferenz B − A. Innerhalb ± ${cm(data.tol)} = unverändert (grün), darüber Auftrag/Abtrag.`
        : `Höhenabweichung Ist − Soll. Innerhalb ± ${cm(data.tol)} = auf Soll (grün), darüber Abtrag/Auffüllung.`,
      MARGIN,
      oy - 10,
      9.5,
      font,
      MUTED,
    );
    oy -= 24;
    const maxW = PAGE_W - 2 * MARGIN;
    const maxH = oy - MARGIN;
    let w = maxW;
    let h = (w * dzImg.h) / dzImg.w;
    if (h > maxH) {
      h = maxH;
      w = (h * dzImg.w) / dzImg.h;
    }
    const ix = MARGIN + (maxW - w) / 2;
    ovPage.drawImage(dzImg.embed, { x: ix, y: oy - h, width: w, height: h });
    ovPage.drawRectangle({
      x: ix,
      y: oy - h,
      width: w,
      height: h,
      borderColor: LINE,
      borderWidth: 0.6,
    });
  }

  // ======================================================================= //
  // KENNZAHL-BLOCK (Kachel-Stil wie PIX4D-Ausmass).
  // ======================================================================= //
  {
    // Eigene Seite für die Kennzahlen -> sauberer Umbruch.
    const pg = newPage();
    let y = PAGE_H - MARGIN;
    text(pg, "Kennzahlen", MARGIN, y - 4, 16, fontBold, BM);
    y -= 22;
    text(
      pg,
      isClouds ? "Volumen- und Höhenkennzahlen der Wolke-gegen-Wolke-Differenz." : "Volumen- und Höhenkennzahlen der Soll-Ist-Aushubkontrolle.",
      MARGIN,
      y - 2,
      9,
      font,
      MUTED,
    );
    y -= 22;

    const s = swap(data.stats);
    // Kachel-Raster: 3 Spalten. Jede Kachel mit Label oben + Wert gross darunter.
    const kacheln: { label: string; value: string; color?: RGB }[] = [
      { label: "Abtrag", value: m3(s.cutM3), color: CUT_FARBE },
      { label: "Auffüllung", value: m3(s.fillM3), color: FILL_FARBE },
      { label: "Netto-Volumen", value: m3(s.netM3) },
      { label: "Fläche", value: m2(s.areaM2) },
      { label: `${isClouds ? "Unverändert" : "Auf Soll"} (± ${cm(data.tol)})`, value: pct(s.onTargetPct), color: BM },
      { label: "Median dZ", value: cm(s.medianM) },
    ];
    const cols = 3;
    const gap = 10;
    const tileW = (PAGE_W - 2 * MARGIN - (cols - 1) * gap) / cols;
    const tileH = 56;
    for (let i = 0; i < kacheln.length; i++) {
      const k = kacheln[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      const tx = MARGIN + c * (tileW + gap);
      const tyTop = y - r * (tileH + gap);
      pg.drawRectangle({
        x: tx,
        y: tyTop - tileH,
        width: tileW,
        height: tileH,
        color: BM_LIGHT,
        borderColor: LINE,
        borderWidth: 0.6,
      });
      text(pg, fitOn(k.label, fontBold, 8.5, tileW - 16), tx + 8, tyTop - 16, 8.5, fontBold, MUTED);
      text(pg, fitOn(k.value, fontBold, 17, tileW - 16), tx + 8, tyTop - 40, 17, fontBold, k.color ?? INK);
    }
    const rows = Math.ceil(kacheln.length / cols);
    y -= rows * (tileH + gap) + 8;

    // Ergänzende Statistik-Zeilen (Mittelwert, Std, Min/Max) als kompakte Liste.
    const zusatz: [string, string][] = [
      ["Mittelwert dZ", cm(s.meanM)],
      ["Standardabweichung", cm(s.stdM)],
      ["Min dZ", cm(s.minM)],
      ["Max dZ", cm(s.maxM)],
    ];
    if (zusatz.some(([, v]) => v !== "—")) {
      pg.drawRectangle({ x: MARGIN, y: y - 18, width: PAGE_W - 2 * MARGIN, height: 18, color: BM_LIGHT });
      text(pg, "Weitere Höhenstatistik", MARGIN + 4, y - 13, 10, fontBold, BM);
      y -= 24;
      const labelW = 170;
      for (const [label, val] of zusatz) {
        text(pg, label, MARGIN + 4, y - 11, 9.5, fontBold, INK);
        text(pg, val, MARGIN + 4 + labelW, y - 11, 9.5, font, INK);
        y -= 15;
      }
      y -= 8;
    }

    // ---- Bereichs-Volumen-Tabelle (optional) ----
    const bereiche = (data.bereiche ?? []).filter((b) => b && b.name).map(swap);
    if (bereiche.length > 0) {
      y = renderBereiche(pg, newPage, y, bereiche, { text, font, fontBold });
    }
  }

  // ======================================================================= //
  // HÖHENPROFILE (optional, je gespeichertem Schnitt ein Profil).
  // ======================================================================= //
  const profile = (data.profile ?? []).filter(
    (p) => p && p.dist && p.dist.length >= 2,
  );
  if (profile.length > 0) {
    // Zwei Profile pro Seite (untereinander), sauber umbrechen.
    const perPage = 2;
    for (let start = 0; start < profile.length; start += perPage) {
      const pg = newPage();
      let y = PAGE_H - MARGIN;
      if (start === 0) {
        text(pg, "Höhenprofile (Schnitte)", MARGIN, y - 4, 16, fontBold, BM);
      } else {
        text(pg, "Höhenprofile (Fortsetzung)", MARGIN, y - 4, 14, fontBold, BM);
      }
      y -= 24;
      const slice = profile.slice(start, start + perPage);
      const blockH = (y - MARGIN) / slice.length;
      for (let i = 0; i < slice.length; i++) {
        const blockTop = y - i * blockH;
        const rect = { x: MARGIN, y: blockTop - blockH + 10, w: PAGE_W - 2 * MARGIN, h: blockH - 24 };
        drawProfil(pg, rect, slice[i], { text, font, fontBold });
      }
    }
  }

  // ======================================================================= //
  // FUSSZEILE "Seite X von Y" auf allen Seiten — wie Vorlage.
  // ======================================================================= //
  const total = pages.length;
  const erstellt = dateCH(data.generatedAt ?? new Date());
  pages.forEach((pg, i) => {
    const label = `Seite ${i + 1} von ${total}`;
    const size = 8;
    const tw = font.widthOfTextAtSize(label, size);
    pg.drawText(label, { x: PAGE_W - MARGIN - tw, y: 18, size, font, color: MUTED });
    pg.drawText(`Höhenvergleich · ${SUBTITLE} · Birchmeier Gruppe · ${erstellt}`, {
      x: MARGIN,
      y: 18,
      size,
      font,
      color: MUTED,
    });
  });

  return doc.save();
}

// ---------------------------------------------------------------------------
// Bereichs-Volumen-Tabelle (regions mit Cut/Fill/Netto/Fläche).
// ---------------------------------------------------------------------------

function renderBereiche(
  pg0: PDFPage,
  newPage: () => PDFPage,
  y0: number,
  bereiche: BereichDaten[],
  io: {
    text: (pg: PDFPage, str: string, x: number, y: number, size: number, f?: PDFFont, color?: RGB) => void;
    font: PDFFont;
    fontBold: PDFFont;
  },
): number {
  const { text, font, fontBold } = io;
  const tableW = PAGE_W - 2 * MARGIN;
  let pg = pg0;
  let y = y0;

  const ensure = (need: number) => {
    if (y - need < MARGIN + 24) {
      pg = newPage();
      y = PAGE_H - MARGIN;
    }
  };

  ensure(24 + 20 + 16);
  pg.drawRectangle({ x: MARGIN, y: y - 18, width: tableW, height: 18, color: BM_LIGHT });
  text(pg, "Bereichs-Volumen", MARGIN + 4, y - 13, 10, fontBold, BM);
  y -= 22;

  const cols: { label: string; w: number; align: "left" | "right" | "center" }[] = [
    { label: "Bereich", w: 0, align: "left" },
    { label: "Fläche", w: 90, align: "right" },
    { label: "Abtrag [m³]", w: 90, align: "right" },
    { label: "Auffüllung [m³]", w: 100, align: "right" },
    { label: "Netto [m³]", w: 90, align: "right" },
  ];
  const fixedW = cols.reduce((a, c) => a + c.w, 0);
  cols[0].w = Math.max(90, tableW - fixedW);

  const drawCell = (
    str: string,
    x: number,
    yTop: number,
    w: number,
    align: "left" | "right" | "center",
    f: PDFFont,
    size: number,
    color: RGB,
  ) => {
    const pad = 4;
    let out = str;
    const maxW = w - 2 * pad;
    if (f.widthOfTextAtSize(out, size) > maxW && out.length > 1) {
      while (out.length > 1 && f.widthOfTextAtSize(out + "…", size) > maxW) out = out.slice(0, -1);
      out = out + "…";
    }
    const tw = f.widthOfTextAtSize(out, size);
    let tx = x + pad;
    if (align === "right") tx = x + w - pad - tw;
    else if (align === "center") tx = x + (w - tw) / 2;
    pg.drawText(out, { x: tx, y: yTop, size, font: f, color });
  };

  const headerH = 20;
  const drawHeader = () => {
    pg.drawRectangle({ x: MARGIN, y: y - headerH, width: tableW, height: headerH, color: BM });
    let cx = MARGIN;
    for (const c of cols) {
      drawCell(c.label, cx, y - 13, c.w, c.align, fontBold, 8, rgb(1, 1, 1));
      cx += c.w;
    }
    y -= headerH;
  };

  drawHeader();
  const rowH = 16;
  let parity = 0;
  // Summen mitführen.
  let sumArea = 0, sumCut = 0, sumFill = 0, sumNet = 0;
  for (const b of bereiche) {
    if (y - rowH < MARGIN + 24) {
      pg = newPage();
      y = PAGE_H - MARGIN;
      drawHeader();
    }
    if (parity % 2 === 1) {
      pg.drawRectangle({ x: MARGIN, y: y - rowH, width: tableW, height: rowH, color: BM_LIGHT });
    }
    parity++;
    sumArea += b.areaM2 ?? 0;
    sumCut += b.cutM3 ?? 0;
    sumFill += b.fillM3 ?? 0;
    sumNet += b.netM3 ?? 0;
    const vals = [
      b.name,
      b.areaM2 != null ? num(b.areaM2, 0) : "—",
      b.cutM3 != null ? num(b.cutM3, 1) : "—",
      b.fillM3 != null ? num(b.fillM3, 1) : "—",
      b.netM3 != null ? num(b.netM3, 1) : "—",
    ];
    let cx = MARGIN;
    cols.forEach((c, ci) => {
      drawCell(vals[ci], cx, y - 12, c.w, c.align, ci === 0 ? fontBold : font, 8.5, INK);
      cx += c.w;
    });
    pg.drawLine({
      start: { x: MARGIN, y: y - rowH },
      end: { x: MARGIN + tableW, y: y - rowH },
      thickness: 0.4,
      color: LINE,
    });
    y -= rowH;
  }
  // Summenzeile.
  if (bereiche.length > 1) {
    if (y - rowH < MARGIN + 24) {
      pg = newPage();
      y = PAGE_H - MARGIN;
    }
    const vals = ["Total", num(sumArea, 0), num(sumCut, 1), num(sumFill, 1), num(sumNet, 1)];
    let cx = MARGIN;
    cols.forEach((c, ci) => {
      drawCell(vals[ci], cx, y - 12, c.w, c.align, fontBold, 8.5, BM);
      cx += c.w;
    });
    y -= rowH;
  }
  return y - 8;
}

// ---------------------------------------------------------------------------
// Höhenprofil vektoriell zeichnen (Soll/Ist/dZ über Distanz).
// ---------------------------------------------------------------------------

function drawProfil(
  pg: PDFPage,
  rect: { x: number; y: number; w: number; h: number },
  prof: ProfilDaten,
  io: {
    text: (pg: PDFPage, str: string, x: number, y: number, size: number, f?: PDFFont, color?: RGB) => void;
    font: PDFFont;
    fontBold: PDFFont;
  },
): void {
  const { text, font, fontBold } = io;

  // Titel + Kurz-Info.
  const kindLabel = prof.kind === "laengs" ? "Längsschnitt" : prof.kind === "quer" ? "Querschnitt" : "Schnitt";
  text(
    pg,
    fitOn(`${kindLabel}: ${prof.name}`, fontBold, 11, rect.w),
    rect.x,
    rect.y + rect.h + 6,
    11,
    fontBold,
    BM,
  );

  // Plot-Bereich (Platz für Achsen links/unten).
  const padL = 46;
  const padB = 24;
  const padT = 8;
  const padR = 12;
  const plot = {
    x: rect.x + padL,
    y: rect.y + padB,
    w: rect.w - padL - padR,
    h: rect.h - padB - padT,
  };

  const dist = prof.dist;
  const dMin = Math.min(...dist);
  const dMax = Math.max(...dist);
  const dSpan = dMax - dMin || 1;

  // Höhen-Wertebereich aus Soll + Ist (gültige Werte).
  const zVals: number[] = [];
  for (const arr of [prof.soll, prof.ist]) {
    for (const v of arr) if (v != null && Number.isFinite(v)) zVals.push(v);
  }
  if (zVals.length < 2) {
    pg.drawRectangle({
      x: plot.x, y: plot.y, width: plot.w, height: plot.h,
      borderColor: LINE, borderWidth: 0.6,
    });
    text(pg, "Keine Höhenwerte im Schnitt.", plot.x + 10, plot.y + plot.h / 2, 9, font, MUTED);
    return;
  }
  let zMin = Math.min(...zVals);
  let zMax = Math.max(...zVals);
  const zPad = (zMax - zMin) * 0.12 + 0.05;
  zMin -= zPad;
  zMax += zPad;
  const zSpan = zMax - zMin || 1;

  const px = (d: number) => plot.x + ((d - dMin) / dSpan) * plot.w;
  const py = (z: number) => plot.y + ((z - zMin) / zSpan) * plot.h;

  // Rahmen.
  pg.drawRectangle({
    x: plot.x, y: plot.y, width: plot.w, height: plot.h,
    borderColor: LINE, borderWidth: 0.6,
  });

  // Gitter + Achsenbeschriftung (Höhe links, Distanz unten).
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const z = zMin + (zSpan * i) / ticks;
    const yy = py(z);
    pg.drawLine({ start: { x: plot.x, y: yy }, end: { x: plot.x + plot.w, y: yy }, thickness: 0.3, color: GRID });
    const lbl = z.toFixed(2);
    const lw = font.widthOfTextAtSize(lbl, 6.5);
    pg.drawText(lbl, { x: plot.x - 4 - lw, y: yy - 3, size: 6.5, font, color: MUTED });

    const d = dMin + (dSpan * i) / ticks;
    const xx = px(d);
    pg.drawLine({ start: { x: xx, y: plot.y }, end: { x: xx, y: plot.y + plot.h }, thickness: 0.3, color: GRID });
    const dlbl = d.toFixed(1);
    const dw = font.widthOfTextAtSize(dlbl, 6.5);
    pg.drawText(dlbl, { x: xx - dw / 2, y: plot.y - 12, size: 6.5, font, color: MUTED });
  }
  text(pg, "Distanz [m]", plot.x + plot.w / 2 - 24, plot.y - 22, 7.5, font, MUTED);
  pg.drawText("Höhe [m ü.M.]", {
    x: rect.x + 4,
    y: plot.y + plot.h / 2 - 30,
    size: 7.5,
    font,
    color: MUTED,
    rotate: { type: "degrees", angle: 90 } as never,
  });

  // Linienzug zeichnen (Lücken bei null überspringen).
  const drawSerie = (vals: (number | null)[], color: RGB, thickness: number) => {
    let prev: [number, number] | null = null;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null || !Number.isFinite(v)) {
        prev = null;
        continue;
      }
      const cur: [number, number] = [px(dist[i]), py(v)];
      if (prev) {
        pg.drawLine({ start: { x: prev[0], y: prev[1] }, end: { x: cur[0], y: cur[1] }, thickness, color });
      }
      prev = cur;
    }
  };
  drawSerie(prof.soll, SOLL_LINIE, 1.4);
  drawSerie(prof.ist, IST_LINIE, 1.8);

  // Legende oben rechts im Plot.
  const legends: [string, RGB][] = [
    ["Soll", SOLL_LINIE],
    ["Ist", IST_LINIE],
  ];
  let lx = plot.x + plot.w - 4;
  for (let i = legends.length - 1; i >= 0; i--) {
    const [lbl, col] = legends[i];
    const lw = font.widthOfTextAtSize(lbl, 7);
    lx -= lw;
    pg.drawText(lbl, { x: lx, y: plot.y + plot.h - 10, size: 7, font, color: col });
    lx -= 6;
    pg.drawLine({
      start: { x: lx, y: plot.y + plot.h - 7 },
      end: { x: lx + 4, y: plot.y + plot.h - 7 },
      thickness: 2,
      color: col,
    });
    lx -= 10;
  }

  // dZ-Kennwert (max Betrag) als Text.
  const dzVals = prof.dz.filter((v): v is number => v != null && Number.isFinite(v));
  if (dzVals.length > 0) {
    const maxAbs = dzVals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    text(
      pg,
      `Länge ${num(prof.lengthM ?? dSpan, 1)} m · max |dZ| ${cm(maxAbs)}`,
      plot.x + 2,
      plot.y - 22,
      7.5,
      font,
      DZ_LINIE,
    );
  }
}
