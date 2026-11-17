'use client';

import { useState, useMemo } from 'react';
import AthleteIdCard from '@/app/components/idcard/AthleteIdCard';
import { idFontVars } from '@/app/components/idcard/fonts';

interface Props {
  athletes: any[];
}

export default function IdCardsClient({ athletes }: Props) {
  const [selectedCollege, setSelectedCollege] = useState('ALL');
  const [selectedGender, setSelectedGender] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyAssignedBibs, setOnlyAssignedBibs] = useState(false);

  // Derive college list
  const collegesList = useMemo(() => {
    const map = new Map<string, string>();
    athletes.forEach((a) => {
      const code = a.squads?.colleges?.code || a.squads?.squad_code;
      const name = a.squads?.colleges?.name || code;
      if (code && !map.has(code)) {
        map.set(code, `${code} - ${name}`);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [athletes]);

  // Filtered list
  const filteredAthletes = useMemo(() => {
    return athletes.filter((a) => {
      if (onlyAssignedBibs && !a.bid_number) return false;

      if (selectedCollege !== 'ALL') {
        const colCode = a.squads?.colleges?.code || a.squads?.squad_code;
        if (colCode !== selectedCollege) return false;
      }

      if (selectedGender !== 'ALL') {
        if (a.squads?.gender !== selectedGender) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const name = (a.sslc_name || '').toLowerCase();
        const usn = (a.usn || '').toLowerCase();
        const bib = String(a.bid_number || '');
        if (!name.includes(q) && !usn.includes(q) && !bib.includes(q)) return false;
      }

      return true;
    });
  }, [athletes, selectedCollege, selectedGender, searchQuery, onlyAssignedBibs]);

  return (
    <div>
      {/* Page Header (Hidden on Print) */}
      <div className="admin-page-header no-print">
        <div className="admin-title-group">
          <h2>Accreditation ID Cards — 4×6″ Portrait</h2>
          <p>
            Dr. ACS AURA 2026 athlete cards, one per 4×6″ page. In the print dialog choose <strong>Save as PDF</strong> for a print-ready file (Margins: None, Background graphics: on).
          </p>
        </div>

        <div className="admin-actions-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-admin btn-admin-primary"
            id="btn-print-id-cards"
          >
            <span>📄</span>
            <span>Print / Save PDF · {filteredAthletes.length} cards (4×6″)</span>
          </button>
        </div>
      </div>

      {/* Filter Bar (Hidden on Print) */}
      <div className="filter-bar no-print">
        <div className="filter-inputs">
          <input
            type="text"
            placeholder="🔍 Search name, USN, bib #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="filter-control"
            style={{ minWidth: '220px' }}
          />

          <select
            value={selectedCollege}
            onChange={(e) => setSelectedCollege(e.target.value)}
            className="filter-control"
          >
            <option value="ALL">All Colleges ({collegesList.length})</option>
            {collegesList.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={selectedGender}
            onChange={(e) => setSelectedGender(e.target.value)}
            className="filter-control"
          >
            <option value="ALL">All Genders</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#334155', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyAssignedBibs}
              onChange={(e) => setOnlyAssignedBibs(e.target.checked)}
            />
            <span>Only Athletes with Bib #</span>
          </label>
        </div>

        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          Format: <strong>4″ × 6″ portrait</strong> • Ready: <strong>{filteredAthletes.length}</strong> cards
        </div>
      </div>

      {/* ID Cards — one 4×6″ portrait card per printed page */}
      {filteredAthletes.length === 0 ? (
        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🪪</div>
          <div style={{ fontWeight: 600, color: '#475569' }}>No athletes match selection</div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
            Adjust filters or generate bib numbers from the administrative dashboard.
          </div>
        </div>
      ) : (
        <div className={`idc-sheet ${idFontVars}`}>
          {filteredAthletes.map((athlete) => (
            <AthleteIdCard key={athlete.id} athlete={athlete} />
          ))}
        </div>
      )}
    </div>
  );
}
