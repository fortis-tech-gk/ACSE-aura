/**
 * Instant placeholder for every squad portal page. The banner and navigation (layout) stay on
 * screen; this skeleton shows the moment a tab is clicked while the server renders the page.
 */
export default function SquadLoading() {
  return (
    <div className="squad-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="squad-skeleton-sr">Loading…</span>
      <div className="squad-skeleton-bar squad-skeleton-title" />
      <div className="squad-skeleton-bar squad-skeleton-subtitle" />
      <div className="squad-skeleton-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="squad-skeleton-card" />
        ))}
      </div>
      <div className="squad-skeleton-panel">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="squad-skeleton-bar squad-skeleton-row" />
        ))}
      </div>
    </div>
  );
}
