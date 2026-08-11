import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { RouteSummary, TestCentre } from '../api/types';
import { RouteCard } from '../components/RouteCard';
// Slot dates/times are wall-clock values, not instants — rendering them raw printed
// "1970-01-01T10:00:00.000Z" on every availability button. See lib/datetime.ts.
import { formatSlotDate, formatSlotTime } from '../lib/datetime';

interface Slot { id: string; slot_date: string; start_time: string; end_time: string; }
interface Profile {
  user_id: string; display_name?: string; bio?: string; lesson_price_minor: number;
  currency: string; years_experience?: number; routes_published: number; reputation: number;
}

export function InstructorProfilePage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [centres, setCentres] = useState<TestCentre[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.request<Profile>(`/instructors/${id}/profile`),
      api.request<Slot[]>(`/instructors/${id}/slots`),
    ])
      .then(([p, s]) => { setProfile(p); setSlots(s); })
      .catch((e) => setError((e as Error).message));
    // Routes created + associated test centres (Phase 20).
    api.instructorRoutes(id)
      .then(({ routes, testCentres }) => { setRoutes(routes); setCentres(testCentres); })
      .catch(() => {});
  }, [id]);

  async function book() {
    if (!selectedSlot) return;
    setBooking(true);
    try {
      await api.request('/bookings', {
        method: 'POST',
        body: JSON.stringify({ instructorId: id, slotId: selectedSlot, lessonNotes: notes }),
      });
      setBooked(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!profile) return <div className="center"><div className="spinner" /></div>;

  if (booked) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48 }}>🎉</div>
        <h2>Booking requested!</h2>
        <p className="muted">The instructor will confirm your lesson. Check My Bookings for updates.</p>
        <button className="btn" onClick={() => nav('/bookings')}>View my bookings</button>
      </div>
    );
  }

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 16 }}>← Back</button>

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 22 }}>
            {(profile.display_name ?? 'A')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{profile.display_name ?? 'Instructor'}</h2>
            <div className="muted">✅ Verified ADI · ⭐ {profile.reputation} reputation · {profile.routes_published} routes contributed</div>
            {profile.years_experience && <div className="muted">{profile.years_experience} years experience</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 24 }}>£{((profile.lesson_price_minor ?? 3500) / 100).toFixed(2)}</div>
            <div className="muted" style={{ fontSize: 12 }}>per lesson</div>
          </div>
        </div>
        {profile.bio && <p style={{ marginTop: 12 }}>{profile.bio}</p>}
      </div>

      {centres.length > 0 && (
        <div className="card">
          <strong>Test centres covered</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {centres.map((c) => (
              <Link key={c.id} to={`/test-centres/${c.id}`} className="pill accent">
                🏫 {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {routes.length > 0 && (
        <div className="card">
          <strong>Routes created ({routes.length})</strong>
          <div className="grid" style={{ marginTop: 12 }}>
            {routes.map((r) => (
              <RouteCard key={r.id} route={r} />
            ))}
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="card">
        <strong>Available slots</strong>
        {slots.length === 0 && <p className="muted">No availability right now — check back soon.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {slots.map((s) => (
            <button
              key={s.id}
              className={selectedSlot === s.id ? 'btn' : 'btn secondary'}
              style={{ fontSize: 13 }}
              onClick={() => setSelectedSlot(s.id)}
            >
              {formatSlotDate(s.slot_date)} · {formatSlotTime(s.start_time)}–
              {formatSlotTime(s.end_time)}
            </button>
          ))}
        </div>
      </div>

      {selectedSlot && (
        <div className="card">
          <label>Message for the instructor (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. I'm preparing for my test at Mill Hill..."
            rows={3}
            style={{ width: '100%', marginTop: 8 }}
          />
          <button className="btn" disabled={booking} onClick={book} style={{ marginTop: 12 }}>
            {booking ? 'Booking…' : `Request lesson — £${((profile.lesson_price_minor ?? 3500) / 100).toFixed(2)}`}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            A small platform service fee will be added at checkout. No charge until the instructor confirms.
          </p>
        </div>
      )}
    </>
  );
}
