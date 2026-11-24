import type { LegacyRow } from "../lib/server/db";

// The leaderboard from before the switch to the new server. Read-only, for
// looking back at who led. Shown to the left of the game on wide screens.
export default function OldLeaderboard({ rows, fetchedAt }: { rows: LegacyRow[]; fetchedAt: string }) {
  const date = new Date(fetchedAt).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Oslo",
  });
  return (
    <aside className="oldlb" aria-labelledby="oldlbTitle">
      <div className="oldlb-head">
        <h2 id="oldlbTitle">Toppliste før {date}</h2>
        <p className="oldlb-note">Fra den gamle versjonen av spillet. Den endres aldri.</p>
      </div>
      {rows.length === 0 ? (
        <p className="oldlb-note">Ingen resultater.</p>
      ) : (
        <ol className="oldlb-list">
          {rows.map((r) => (
            <li key={r.rank} className={"oldlb-row" + (r.rank <= 3 ? " oldlb-top" + r.rank : "")}>
              <span className="oldlb-rank">{r.rank}</span>
              <span className="oldlb-name" title={r.name}>{r.name}</span>
              <span className="oldlb-klass">{r.klass}</span>
              <span className="oldlb-score">{r.score}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
