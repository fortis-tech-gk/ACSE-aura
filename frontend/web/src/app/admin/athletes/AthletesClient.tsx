'use client';

import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { normalizePaymentStatus } from '@/lib/payment-status';
import { buildExportRows, exportFileStamp, type ExportRow } from '@/lib/athlete-export';
import type { AthleteFilters } from '@/lib/admin-athletes';
import { exportAthletesAction } from '@/app/actions/admin-operations';
import { useUrlFilters } from '../useUrlFilters';
import AthletesPdfReport from './AthletesPdfReport';

const PAGE_SIZE = 50;

interface Props {
  /** one page of athletes matching the filters (filtered on the server) */
  athletes: any[];
  filteredTotal: number;
  totalAthletes: number;
  page: number;
  filters: AthleteFilters;
  colleges: { code: string; name: string }[];
  events: { id: string; name: string; code: string }[];
}

export default function AthletesClient({ athletes, filteredTotal, totalAthletes, page, filters, colleges, events }: Props) {
  const { set, pending } = useUrlFilters();
  const selectedCollege = filters.college || 'ALL';
  const selectedGender = filters.gender || 'ALL';
  const selectedStatus = filters.status || 'ALL';
  const selectedEvent = filters.event || 'ALL';
  const [pdfReport, setPdfReport] = useState<{ title: string; filters: string; rows: ExportRow[] } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  // Search box: typed locally, sent to the server after a short pause
  const [searchQuery, setSearchQuery] = useState(filters.q || '');
  const lastSent = useRef(filters.q || '');
  useEffect(() => {
    const q = searchQuery.trim();
    if (q === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = q;
      set({ q });
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const eventName = events.find((e) => e.id === selectedEvent)?.name || selectedEvent;

  // Downloads are sorted by college, then gender, then name (easier to read than newest-first)
  function sortForExport(list: any[]) {
    return [...list].sort((a, b) => {
      const ca = a.squads?.colleges?.code || a.squads?.squad_code || '';
      const cb = b.squads?.colleges?.code || b.squads?.squad_code || '';
      if (ca !== cb) return ca.localeCompare(cb);
      const ga = a.squads?.gender || '', gb = b.squads?.gender || '';
      if (ga !== gb) return ga.localeCompare(gb);
      return String(a.sslc_name || '').localeCompare(String(b.sslc_name || ''));
    });
  }

  // Human-readable summary of the active filters (shown in the Excel/PDF header)
  function filterSummary(useFilters: boolean): string {
    if (!useFilters) return 'None (entire roster)';
    const parts: string[] = [];
    if (filters.q) parts.push(`Search "${filters.q}"`);
    if (selectedCollege !== 'ALL') parts.push(`College ${selectedCollege}`);
    if (selectedGender !== 'ALL') parts.push(selectedGender === 'men' ? 'Men' : 'Women');
    if (selectedStatus !== 'ALL') parts.push(`Payment ${selectedStatus}`);
    if (selectedEvent !== 'ALL') parts.push(`Event ${eventName}`);
    return parts.length ? parts.join(' • ') : 'None (all athletes)';
  }

  // Every matching athlete is read only when a download is clicked
  async function loadForExport(useFilters: boolean, key: string): Promise<any[] | null> {
    setExporting(key);
    try {
      return await exportAthletesAction(useFilters ? filters : null);
    } catch (err) {
      alert(`Could not load the athletes for the download: ${err instanceof Error ? err.message : err}`);
      return null;
    } finally {
      setExporting(null);
    }
  }

  // Excel (.xlsx): "Athletes" sheet with a filter arrow on every column + a "Report Info" sheet
  async function handleExport(filename: string, useFilters: boolean, key: string) {
    const dataset = await loadForExport(useFilters, key);
    if (!dataset) return;
    if (dataset.length === 0) {
      alert('No athlete records available to export.');
      return;
    }
    const rows = buildExportRows(sortForExport(dataset));
    const ws = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0]);
    ws['!cols'] = headers.map((key) => ({
      wch: Math.min(48, Math.max(key.length + 2, ...rows.map((r) => String((r as any)[key] ?? '').length + 1))),
    }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };

    const info = XLSX.utils.aoa_to_sheet([
      ['Dr. ACS-AURA 2026 — VTU’s 28th Inter-Collegiate State Level Athletic Meet 2026'],
      ['Athletes list exported from the Admin portal'],
      [],
      ['Generated', new Date().toLocaleString('en-IN')],
      ['Filters', filterSummary(useFilters)],
      ['Athletes', rows.length],
      ['Men', rows.filter((r) => r.Gender === 'Men').length],
      ['Women', rows.filter((r) => r.Gender === 'Women').length],
      ['Colleges', new Set(rows.map((r) => r['College Code'])).size],
      [],
      ['Note', 'Aadhaar numbers show only the last 4 digits.'],
    ]);
    info['!cols'] = [{ wch: 14 }, { wch: 80 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Athletes');
    XLSX.utils.book_append_sheet(wb, info, 'Report Info');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  // PDF: opens a printable A4-landscape report ("Save as PDF" in the print dialog)
  async function handlePdf(title: string, useFilters: boolean, key: string) {
    const dataset = await loadForExport(useFilters, key);
    if (!dataset) return;
    if (dataset.length === 0) {
      alert('No athlete records available to export.');
      return;
    }
    setPdfReport({ title, filters: filterSummary(useFilters), rows: buildExportRows(sortForExport(dataset)) });
  }

  const exportBtn = (key: string, label: string, icon: string, primary: boolean, onClick: () => void, id: string) => (
    <button
      type="button"
      onClick={onClick}
      disabled={exporting !== null}
      className={`btn-admin ${primary ? 'btn-admin-primary' : 'btn-admin-secondary'}`}
      id={id}
    >
      <span>{exporting === key ? '⏳' : icon}</span>
      <span>{exporting === key ? 'Preparing…' : label}</span>
    </button>
  );

  const anyFilter = Boolean(filters.q || selectedCollege !== 'ALL' || selectedGender !== 'ALL' || selectedStatus !== 'ALL' || selectedEvent !== 'ALL');

  return (
    <div>
      {/* Page Header */}
      <div className="admin-page-header">
        <div className="admin-title-group">
          <h2>Athletes Delegation Management</h2>
          <p>Complete athlete directory with filters &bull; download as Excel (.xlsx) or PDF</p>
        </div>

        {/* Downloads: entire roster or the current filtered view, as Excel or PDF */}
        <div className="admin-actions-group" style={{ flexWrap: 'wrap' }}>
          <div className="athlete-export-group">
            <span className="athlete-export-label">Entire roster ({totalAthletes})</span>
            {exportBtn('all-xlsx', 'Excel', '📥', false, () => handleExport(`ACS-AURA_Athletes_All_${exportFileStamp()}`, false, 'all-xlsx'), 'btn-export-entire')}
            {exportBtn('all-pdf', 'PDF', '📄', false, () => handlePdf('Athletes List — Entire Roster', false, 'all-pdf'), 'btn-export-entire-pdf')}
          </div>

          <div className="athlete-export-group">
            <span className="athlete-export-label">Filtered view ({filteredTotal})</span>
            {exportBtn('f-xlsx', 'Excel', '📊', true, () => handleExport(`ACS-AURA_Athletes_Filtered_${exportFileStamp()}`, true, 'f-xlsx'), 'btn-export-filtered')}
            {exportBtn('f-pdf', 'PDF', '📄', true, () => handlePdf('Athletes List — Filtered View', true, 'f-pdf'), 'btn-export-filtered-pdf')}
          </div>
        </div>
      </div>

      {/* Filter Control Bar */}
      <div className="filter-bar">
        <div className="filter-inputs">
          {/* Search Input */}
          <input
            type="text"
            placeholder="🔍 Search name, USN, bib #, college..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="filter-control"
            style={{ minWidth: '220px' }}
            id="filter-search"
          />

          {/* College Filter */}
          <select
            value={selectedCollege}
            onChange={(e) => set({ college: e.target.value })}
            className="filter-control"
            id="filter-college"
          >
            <option value="ALL">All Colleges ({colleges.length})</option>
            {colleges.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} - {c.name}
              </option>
            ))}
          </select>

          {/* Gender Filter */}
          <select
            value={selectedGender}
            onChange={(e) => set({ gender: e.target.value })}
            className="filter-control"
            id="filter-gender"
          >
            <option value="ALL">All Genders</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => set({ status: e.target.value })}
            className="filter-control"
            id="filter-status"
          >
            <option value="ALL">All Payment Statuses</option>
            <option value="VERIFIED">Verified (Approved)</option>
            <option value="SUBMITTED">Pending Verification</option>
            <option value="REJECTED">Rejected</option>
            <option value="DRAFT">Draft</option>
          </select>

          {/* Event Filter */}
          <select
            value={selectedEvent}
            onChange={(e) => set({ event: e.target.value })}
            className="filter-control"
            id="filter-event"
          >
            <option value="ALL">All Events ({events.length})</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </div>

        {/* Clear Filters Button */}
        {anyFilter && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              lastSent.current = '';
              set({ q: null, college: null, gender: null, status: null, event: null });
            }}
            className="btn-admin btn-admin-secondary"
            style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Roster Counter Summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.825rem', color: '#64748b' }}>
        <span>
          {pending ? (
            <strong style={{ color: '#2563eb' }}>Loading…</strong>
          ) : (
            <>
              Showing <strong style={{ color: '#0f172a' }}>{athletes.length === 0 ? 0 : `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + athletes.length}`}</strong> of{' '}
              <strong style={{ color: '#0f172a' }}>{filteredTotal}</strong> matching
              {anyFilter && <> ({totalAthletes} athletes in total)</>}
            </>
          )}
        </span>
        {selectedCollege !== 'ALL' && (
          <span>
            Filtered by College: <strong>{selectedCollege}</strong>
          </span>
        )}
      </div>

      {/* Athletes Data Table */}
      <div className="admin-table-container" style={{ opacity: pending ? 0.55 : 1, transition: 'opacity 0.15s' }}>
        <table className="admin-table stack-mobile">
          <thead>
            <tr>
              <th style={{ width: '80px' }}>Bib #</th>
              <th>Athlete Name & USN</th>
              <th>College</th>
              <th style={{ width: '90px' }}>Gender</th>
              <th style={{ width: '70px' }}>Blood</th>
              <th>Registered Events</th>
              <th style={{ width: '130px' }}>Payment Status</th>
            </tr>
          </thead>
          <tbody>
            {athletes.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
                  <div style={{ fontWeight: 600, color: '#475569' }}>No athletes found</div>
                  <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    Try adjusting your search criteria or resetting filters.
                  </div>
                </td>
              </tr>
            ) : (
              athletes.map((athlete) => {
                const status = normalizePaymentStatus(athlete.squads?.payment_status);
                return (
                  <tr key={athlete.id}>
                    {/* Bib Number */}
                    <td>
                      {athlete.bid_number ? (
                        <span
                          style={{
                            background: '#0f172a',
                            color: '#ffffff',
                            fontWeight: 800,
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            fontSize: '0.85rem',
                            letterSpacing: '0.03em',
                            display: 'inline-block',
                          }}
                        >
                          #{athlete.bid_number}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontStyle: 'italic' }}>
                          Unassigned
                        </span>
                      )}
                    </td>

                    {/* Athlete Name & USN */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: '#e2e8f0',
                            overflow: 'hidden',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1rem',
                          }}
                        >
                          {athlete.photo_url ? (
                            <img loading="lazy"
                              src={athlete.photo_url}
                              alt={athlete.sslc_name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            '🏃'
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{athlete.sslc_name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 600 }}>
                            {athlete.usn} {athlete.semester ? `• Sem ${athlete.semester}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* College */}
                    <td>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>
                        {athlete.squads?.colleges?.code || athlete.squads?.squad_code}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {athlete.squads?.colleges?.name}
                      </div>
                    </td>

                    {/* Gender */}
                    <td>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          background: athlete.squads?.gender === 'men' ? '#eff6ff' : '#fdf2f8',
                          color: athlete.squads?.gender === 'men' ? '#1d4ed8' : '#be185d',
                        }}
                      >
                        {athlete.squads?.gender === 'men' ? 'Men' : 'Women'}
                      </span>
                    </td>

                    {/* Blood Group */}
                    <td>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                        {athlete.blood_group || '—'}
                      </span>
                    </td>

                    {/* Registered Events */}
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxWidth: '340px' }}>
                        {athlete.registrations?.length > 0 ? (
                          athlete.registrations.map((r: any) => (
                            <span
                              key={r.id}
                              style={{
                                background: r.kind === 'reserve' ? '#f1f5f9' : '#f8fafc',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '0.15rem 0.45rem',
                                fontSize: '0.725rem',
                                color: r.kind === 'reserve' ? '#64748b' : '#0f172a',
                                fontWeight: 500,
                              }}
                            >
                              {r.events?.name || 'Event'} {r.kind === 'reserve' ? '(Res)' : ''}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No events registered</span>
                        )}
                      </div>
                    </td>

                    {/* Payment Status */}
                    <td>
                      <span
                        className={`badge-status ${status === 'VERIFIED'
                            ? 'badge-verified'
                            : status === 'SUBMITTED'
                              ? 'badge-pending'
                              : status === 'REJECTED'
                                ? 'badge-rejected'
                                : 'badge-draft'
                          }`}
                      >
                        {status === 'VERIFIED'
                          ? '✓ Verified'
                          : status === 'SUBMITTED'
                            ? '⏳ Pending'
                            : status === 'REJECTED'
                              ? '✕ Rejected'
                              : 'Draft'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {/* Pages */}
      {pageCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', margin: '1rem 0' }}>
          <button type="button" className="btn-admin btn-admin-secondary" disabled={page <= 1 || pending} onClick={() => set({ page: page - 1 })} id="athletes-prev">
            ← Previous
          </button>
          <span style={{ fontSize: '0.85rem', color: '#475569' }}>
            Page <strong>{page}</strong> of <strong>{pageCount}</strong>
          </span>
          <button type="button" className="btn-admin btn-admin-secondary" disabled={page >= pageCount || pending} onClick={() => set({ page: page + 1 })} id="athletes-next">
            Next →
          </button>
        </div>
      )}
      {pdfReport && (
        <AthletesPdfReport
          title={pdfReport.title}
          filterSummary={pdfReport.filters}
          rows={pdfReport.rows}
          onClose={() => setPdfReport(null)}
        />
      )}
    </div>
  );
}
