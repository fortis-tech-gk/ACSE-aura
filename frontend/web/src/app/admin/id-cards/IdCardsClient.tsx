'use client';

import { useState, useEffect, useRef } from 'react';
import AthleteIdCard from '@/app/components/idcard/AthleteIdCard';
import { idFontVars } from '@/app/components/idcard/fonts';
import type { AthleteFilters } from '@/lib/admin-athletes';
import { useUrlFilters } from '../useUrlFilters';
import DivisionSelect from '../DivisionSelect';

interface Props {
  /** athletes matching the filters (filtered on the server), or null until a college / search is chosen */
  athletes: any[] | null;
  filters: AthleteFilters;
  loadAll: boolean;
  colleges: { code: string; name: string; division: string }[];
  totalAthletes: number;
}

export default function IdCardsClient({ athletes, filters, loadAll, colleges, totalAthletes }: Props) {
  const { set, pending } = useUrlFilters();
  const selectedCollege = loadAll ? 'all' : filters.college || '';
  const selectedGender = filters.gender || 'ALL';
  const selectedDivision = filters.division || 'ALL';
  const collegeChoices = selectedDivision === 'ALL' ? colleges : colleges.filter((c) => c.division === selectedDivision);
  const onlyAssignedBibs = Boolean(filters.bibOnly);
  const filteredAthletes = athletes || [];

  // Search box: typed locally, sent to the server after a short pause
  const [searchQuery, setSearchQuery] = useState(filters.q || '');
  const lastSent = useRef(filters.q || '');
  useEffect(() => {
    const q = searchQuery.trim();
    if (q === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = q;
      set({ q });
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

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

          <DivisionSelect
            value={selectedDivision}
            onChange={(d) => set({ division: d, college: colleges.find((c) => c.code === filters.college)?.division === d ? filters.college : null })}
            id="idc-division"
          />

          <select
            value={selectedCollege}
            onChange={(e) => set({ college: e.target.value })}
            className="filter-control"
            id="idc-college"
          >
            <option value="">{selectedDivision === 'ALL' ? '— Choose a college —' : `All colleges in ${selectedDivision}`}</option>
            {selectedDivision === 'ALL' && <option value="all">All colleges ({totalAthletes} athletes, slow to build)</option>}
            {collegeChoices.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>

          <select
            value={selectedGender}
            onChange={(e) => set({ gender: e.target.value })}
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
              onChange={(e) => set({ bib: e.target.checked ? '1' : null })}
            />
            <span>Only Athletes with Bib #</span>
          </label>
        </div>

        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          Format: <strong>4″ × 6″ portrait</strong> • Ready: <strong>{filteredAthletes.length}</strong> cards
        </div>
      </div>

      {/* ID Cards — one 4×6″ portrait card per printed page */}
      {pending ? (
        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '3rem 1rem', textAlign: 'center', color: '#2563eb', border: '1px solid var(--border-color)', fontWeight: 600 }}>
          Building ID cards…
        </div>
      ) : athletes === null ? (
        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🪪</div>
          <div style={{ fontWeight: 600, color: '#475569' }}>Choose a college or search for an athlete</div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
            Cards are built only for the athletes you pick. Choose &quot;All colleges&quot; to print the whole meet.
          </div>
        </div>
      ) : filteredAthletes.length === 0 ? (
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
