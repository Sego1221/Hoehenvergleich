/**
 * Baufortschritt-Status-Protokoll (PDF, pdf-lib, Birchmeier-Branding).
 * Pro Tages-Scan: Projektkopf, Datum, Zusammenfassung (gebaut/nicht/verdeckt/
 * nicht erfasst) + Bauteiltabelle (Status effektiv, Kote, „gebaut seit").
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

const BM = rgb(0.125, 0.408, 0.239);
const INK = rgb(0.06, 0.09, 0.16);
const MUT = rgb(0.42, 0.45, 0.5);
const COL: Record<string, ReturnType<typeof rgb>> = {
  gebaut: rgb(0.157, 0.706, 0.314), nicht_gebaut: rgb(0.59, 0.59, 0.59),
  verdeckt: rgb(0.94, 0.59, 0.16), nicht_erfasst: rgb(0.35, 0.35, 0.43),
};
const LABEL: Record<string, string> = {
  gebaut: "gebaut", nicht_gebaut: "nicht gebaut", verdeckt: "verdeckt", nicht_erfasst: "nicht erfasst",
};

export type BauteilPdfRow = {
  bauteil: string; betonage: string; koteOk: string; status: string; gebautSeit: string;
};

export async function makeBauteilPdf(ctx: {
  projektNummer: string | null; projektName: string | null; adresse: string | null; ort: string | null;
  scanName: string | null; scanDate: string | null;
  summary: { n_elements?: number; gebaut?: number; nicht_gebaut?: number; verdeckt?: number; nicht_erfasst?: number } | null;
  kumGebaut: number; total: number;
  rows: BauteilPdfRow[];
  generatedAt: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try { logo = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "birchmeier_logo.png"))); } catch { logo = null; }

  const A4: [number, number] = [595.28, 841.89];
  const M = 40; let page = doc.addPage(A4); let y = A4[1] - M;
  const W = A4[0] - 2 * M;
  const san = (s: string) => (s ?? "").replace(/[^\x20-\xFF]/g, "?");

  function header() {
    if (logo) { const w = 90; const h = (logo.height / logo.width) * w; page.drawImage(logo, { x: A4[0] - M - w, y: A4[1] - M - h + 6, width: w, height: h }); }
    page.drawText("Baufortschritt-Protokoll", { x: M, y: y - 4, size: 18, font: bold, color: BM });
    y -= 26;
    const pj = [ctx.projektNummer, ctx.projektName].filter(Boolean).join(" — ");
    page.drawText(san(pj || "Projekt"), { x: M, y, size: 11, font: bold, color: INK }); y -= 14;
    const adr = [ctx.adresse, ctx.ort].filter(Boolean).join(", ");
    if (adr) { page.drawText(san(adr), { x: M, y, size: 9, font, color: MUT }); y -= 12; }
    page.drawText(san(`Scan: ${ctx.scanName ?? "—"}   Datum: ${fmt(ctx.scanDate)}`), { x: M, y, size: 9, font, color: MUT }); y -= 16;
    const s = ctx.summary ?? {};
    const pct = ctx.total ? Math.round((100 * ctx.kumGebaut) / ctx.total) : 0;
    page.drawText(`Fortschritt: ${ctx.kumGebaut} / ${ctx.total} gebaut (${pct}%)`, { x: M, y, size: 11, font: bold, color: BM }); y -= 14;
    page.drawText(san(`Scan-Status — gebaut ${s.gebaut ?? 0} · nicht gebaut ${s.nicht_gebaut ?? 0} · verdeckt ${s.verdeckt ?? 0} · nicht erfasst ${s.nicht_erfasst ?? 0}`), { x: M, y, size: 9, font, color: MUT }); y -= 18;
  }
  function fmt(d: string | null) { if (!d) return "—"; const t = new Date(d); return isNaN(+t) ? "—" : t.toLocaleDateString("de-CH"); }

  const cols = [
    { x: M, w: 230, t: "Bauteil" }, { x: M + 232, w: 70, t: "Betonage" },
    { x: M + 304, w: 70, t: "Kote OK" }, { x: M + 376, w: 90, t: "Status" },
    { x: M + 468, w: W - 468 + M, t: "gebaut seit" },
  ];
  function tableHead() {
    page.drawRectangle({ x: M, y: y - 2, width: W, height: 16, color: rgb(0.9, 0.94, 0.91) });
    for (const c of cols) page.drawText(c.t, { x: c.x + 2, y: y + 2, size: 8, font: bold, color: BM });
    y -= 18;
  }
  header(); tableHead();

  for (const r of ctx.rows) {
    if (y < M + 24) { page = doc.addPage(A4); y = A4[1] - M; tableHead(); }
    page.drawCircle({ x: cols[3].x + 6, y: y + 5, size: 4, color: COL[r.status] ?? MUT });
    page.drawText(san(r.bauteil).slice(0, 48), { x: cols[0].x + 2, y: y + 2, size: 8, font, color: INK });
    page.drawText(san(r.betonage), { x: cols[1].x + 2, y: y + 2, size: 8, font, color: INK });
    page.drawText(san(r.koteOk), { x: cols[2].x + 2, y: y + 2, size: 8, font, color: INK });
    page.drawText(LABEL[r.status] ?? r.status, { x: cols[3].x + 14, y: y + 2, size: 8, font, color: INK });
    page.drawText(san(r.gebautSeit), { x: cols[4].x + 2, y: y + 2, size: 8, font, color: INK });
    y -= 14;
  }
  const foot = `erstellt ${fmt(ctx.generatedAt)} · Birchmeier Gruppe`;
  page.drawText(san(foot), { x: M, y: M - 14, size: 7, font, color: MUT });
  return doc.save();
}
