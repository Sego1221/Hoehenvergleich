/** Schweizer Zahlenformatierung (Apostroph als Tausendertrennzeichen). */
export function m3(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " m³";
}
export function m2(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " m²";
}
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " %";
}
export function cm(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return (v * 100).toLocaleString("de-CH", { maximumFractionDigits: 1 }) + " cm";
}
export function dateCH(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-CH");
}
