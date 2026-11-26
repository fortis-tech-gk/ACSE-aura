'use client';

import { DIVISION_FILTER_OPTIONS } from '@/lib/college-regions';

/** VTU division filter (Bengaluru, Belagavi, Kalaburagi, Mysuru, Unassigned) for admin pages */
export default function DivisionSelect({
  value,
  onChange,
  id,
  className = 'filter-control',
  style,
}: {
  value: string;
  onChange: (division: string) => void;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <select value={value || 'ALL'} onChange={(e) => onChange(e.target.value)} className={className} style={style} id={id} aria-label="Division">
      <option value="ALL">All Divisions</option>
      {DIVISION_FILTER_OPTIONS.map((d) => (
        <option key={d} value={d}>
          {d === 'Unassigned' ? 'Unassigned division' : `${d} Division`}
        </option>
      ))}
    </select>
  );
}
