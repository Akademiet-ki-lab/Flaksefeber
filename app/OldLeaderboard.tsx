import type { LegacyRow } from "../lib/server/db";

// The all-time leaderboard: results from the old server and from competition
// mode together. Read-only. Shown to the left of the game on wide screens.
export default function OldLeaderboard({ rows, fetchedAt }: { rows: LegacyRow[]; fetchedAt: string }) {
  return (
    <aside className="oldlb" aria-labelledby="oldlbTitle">
      <div className="oldlb-head">
        <h2 id="oldlbTitle">All time leaderboard</h2>
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
