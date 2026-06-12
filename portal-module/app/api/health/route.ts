/** Health-Endpoint (von Gateway-Status + Railway-Healthcheck genutzt, ohne Auth). */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", module: "hoehenvergleich" });
}
