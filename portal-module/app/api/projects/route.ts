/**
 * Projekt-CRUD: Liste (GET) + Anlegen (POST).
 */
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select()
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const projektNummer = String(body?.projektNummer ?? "").trim();
  const name = String(body?.name ?? "").trim();
  if (!projektNummer) {
    return NextResponse.json({ error: "Projektnummer fehlt." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Projektname fehlt." }, { status: 400 });
  }
  const [row] = await db
    .insert(schema.projects)
    .values({
      projektNummer,
      name,
      adresse: body?.adresse ? String(body.adresse) : null,
      ort: body?.ort ? String(body.ort) : null,
      notes: body?.notes ? String(body.notes) : null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
