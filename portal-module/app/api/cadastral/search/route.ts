/**
 * Orts-/Adresssuche (amtlich, schweizweit) ueber geo.admin.ch SearchServer.
 * Serverseitig (kein CORS). GET /api/cadastral/search?q=...
 *  -> { results: [{ label, e, n }] }  (E,N in LV95)
 *
 * Hinweis: SearchServer liefert sr=2056 -> attrs.y = E (Ost), attrs.x = N (Nord).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH = "https://api3.geo.admin.ch/rest/services/api/SearchServer";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const url = `${SEARCH}?${new URLSearchParams({
    searchText: q, type: "locations", sr: "2056", limit: "8",
  })}`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: `Suchdienst ${r.status}.` }, { status: 502 });
    const data = await r.json();
    const results = (data.results ?? [])
      .map((it: { attrs?: Record<string, unknown> }) => {
        const a = it.attrs ?? {};
        const e = Number(a.y), n = Number(a.x); // y=E, x=N
        if (!Number.isFinite(e) || !Number.isFinite(n)) return null;
        const label = String(a.label ?? "").replace(/<[^>]+>/g, "").trim();
        return { label, e, n };
      })
      .filter(Boolean);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: "Suchdienst nicht erreichbar.", detail: String((err as Error)?.message || err) },
      { status: 502 },
    );
  }
}
