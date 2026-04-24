'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function DashboardMetricToggle() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get('metric') === 'revenue' ? 'revenue' : 'units';

  function choose(next: 'units' | 'revenue') {
    if (next === current) return;
    const qp = new URLSearchParams(sp.toString());
    qp.set('metric', next);
    router.push(`?${qp.toString()}`);
  }

  return (
    <div className="wl-adm-top-metric">
      <span
        className={current === 'units' ? 'on' : ''}
        onClick={() => choose('units')}
      >
        units
      </span>
      <span
        className={current === 'revenue' ? 'on' : ''}
        onClick={() => choose('revenue')}
      >
        $
      </span>
    </div>
  );
}
