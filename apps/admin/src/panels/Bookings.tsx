import { useEffect, useState } from 'react';
import { api } from '../api';

interface Booking {
  id: string; status: string;
  slot_date: string; start_time: string;
  learner_name: string; instructor_name: string;
  amount_minor?: number; platform_fee_minor?: number; payment_status?: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'warn', confirmed: 'good', cancelled: 'bad', completed: 'good', no_show: '',
};

export function Bookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminBookings()
      .then(setBookings)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty"><span className="empty-icon">⏳</span>Loading bookings…</div>;
  if (error) return <div className="error" role="alert"><span>⚠</span>{error}</div>;
  if (bookings.length === 0) return <div className="empty"><span className="empty-icon">📅</span>No bookings yet.</div>;

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Learner</th>
            <th scope="col">Instructor</th>
            <th scope="col">Status</th>
            <th scope="col">Amount</th>
            <th scope="col">Platform fee</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                {b.slot_date} {b.start_time}
              </td>
              <td style={{ fontWeight: 'var(--weight-medium)' }}>{b.learner_name}</td>
              <td>{b.instructor_name}</td>
              <td><span className={`pill ${STATUS_COLOR[b.status] ?? ''}`}>{b.status}</span></td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                {b.amount_minor != null ? `£${(b.amount_minor / 100).toFixed(2)}` : '—'}
              </td>
              <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-green)' }}>
                {b.platform_fee_minor != null ? `£${(b.platform_fee_minor / 100).toFixed(2)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
