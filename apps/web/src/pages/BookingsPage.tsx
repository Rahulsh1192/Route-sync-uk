import { useEffect, useState } from 'react';
import { api } from '../api/client';
// A lesson's date/time are wall-clock values from Postgres `date`/`time` columns, which
// serialise as UTC-pinned Dates — shown raw they read "1970-01-01T10:00:00.000Z".
import { formatSlotDate, formatSlotTime } from '../lib/datetime';

interface Booking {
  id: string; status: string;
  slot_date: string; start_time: string; end_time: string;
  instructor_name?: string; learner_name?: string;
  amount_minor?: number; payment_status?: string;
  lesson_notes?: string; cancel_reason?: string;
}

export function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.request<Booking[]>('/bookings/mine')
      .then(setBookings)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function cancel(id: string) {
    if (!window.confirm('Cancel this booking?')) return;
    try {
      await api.request(`/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled', cancelReason: 'Cancelled by learner' }),
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const statusColor: Record<string, string> = {
    pending: '#f59e0b', confirmed: '#22c55e', cancelled: '#ef4444', completed: '#6366f1', no_show: '#9ca3af',
  };

  return (
    <>
      <h1 className="page">My Bookings</h1>
      {error && <div className="error">{error}</div>}
      {loading && <div className="center"><div className="spinner" /></div>}
      {!loading && bookings.length === 0 && (
        <div className="empty">
          <div style={{ fontSize: 40 }}>📅</div>
          <p>No bookings yet.</p>
          <p className="muted">Find a verified instructor and book your first lesson.</p>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {bookings.map((b) => (
          <div key={b.id} className="card">
            <div className="row">
              <div>
                <div style={{ fontWeight: 700 }}>
                  {b.instructor_name ?? b.learner_name ?? 'Lesson'}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatSlotDate(b.slot_date)} · {formatSlotTime(b.start_time)}–
                  {formatSlotTime(b.end_time)}
                </div>
                {b.lesson_notes && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>"{b.lesson_notes}"</div>}
                {b.cancel_reason && <div style={{ color: '#ef4444', fontSize: 12 }}>Reason: {b.cancel_reason}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, color: statusColor[b.status] ?? '#666' }}>
                  {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                </div>
                {b.amount_minor && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    £{(b.amount_minor / 100).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
            {['pending', 'confirmed'].includes(b.status) && (
              <div style={{ marginTop: 12 }}>
                <button className="btn secondary" style={{ fontSize: 13 }} onClick={() => cancel(b.id)}>
                  Cancel booking
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
