'use client';

import { useEffect } from 'react';

/**
 * Copies each column header's text onto the cells below it (data-label) for tables marked
 * `.stack-mobile`, so admin.css can render them as labelled cards on phones.
 */
export default function StackTableLabels() {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>('table.stack-mobile').forEach((table) => {
        const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
        table.querySelectorAll('tbody tr').forEach((tr) => {
          Array.from(tr.children).forEach((cell, i) => {
            const td = cell as HTMLTableCellElement;
            if (td.colSpan > 1) td.classList.add('cell-empty');
            else if (!td.dataset.label && heads[i]) td.dataset.label = heads[i];
          });
        });
      });
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
