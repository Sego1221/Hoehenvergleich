import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel" style={{ maxWidth: 480 }}>
      <h2 style={{ marginTop: 0 }}>Nicht gefunden</h2>
      <p className="muted">Der gesuchte Eintrag existiert nicht (mehr).</p>
      <Link href="/">← Zur Projektliste</Link>
    </div>
  );
}
