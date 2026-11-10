import Link from "next/link";

/**
 * Built from the same `.sv-h` heading and `.btn-primary` button the settings
 * screens use. A 404 that looked like a different product would read as a
 * broken deployment rather than a wrong address.
 */
export default function NotFound() {
  return (
    <main style={{ height: "100%", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "min(460px, 100%)" }}>
        <h1 className="sv-h" style={{ paddingRight: 0 }}>
          Taka strona nie istnieje
          <span>Adres mógł się zmienić albo ten odnośnik nigdy tu nie działał.</span>
        </h1>
        <Link className="btn-primary lg" href="/">
          Wróć do rozmowy
        </Link>
      </div>
    </main>
  );
}
