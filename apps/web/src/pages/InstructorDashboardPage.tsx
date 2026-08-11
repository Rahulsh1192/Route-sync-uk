import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {
  AvailabilitySlot,
  InstructorBooking,
  InstructorBookingProfile,
  priceLabel,
} from '../api/types';
// Postgres `date`/`time` columns arrive as JS Dates pinned to UTC midnight / 1970-01-01, so
// rendering them raw shows "1970-01-01T14:00:00.000Z" for a 2pm lesson. These format the
// wall-clock parts without timezone conversion — see lib/datetime.ts.
import { formatSlotDate, formatSlotTime } from '../lib/datetime';
import { useAuth } from '../auth/AuthContext';

/**
 * An instructor's own lesson settings (Phase 27).
 *
 * The API has supported all of this since bookings were built — `PUT /instructors/me/profile`
 * and the `/instructors/me/slots` endpoints — but nothing in the web app called any of it.
 * The practical effect was that every instructor was stuck on the £35 default price and had
 * no way to publish availability, so even a learner who found them had nothing to book.
 *
 * Three things, in the order they matter: what you charge and where you work (without which
 * you cannot be found), when you are free (without which you cannot be booked), and the
 * requests that have come in.
 */
export function InstructorDashboardPage() {
  const nav = useNavigate();
  const { user, isStaff } = useAuth();

  const [profile, setProfile] = useState<InstructorBookingProfile | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [bookings, setBookings] = useState<InstructorBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- profile form
  const [price, setPrice] = useState('');
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [basePostcode, setBasePostcode] = useState('');
  const [radiusKm, setRadiusKm] = useState('16');
  const [accepting, setAccepting] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // --- new slot form
  const [slotDate, setSlotDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [addingSlot, setAddingSlot] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // Availability and bookings are instructor-only endpoints; the profile read is the
      // public one, which is also what a learner sees — worth using the same source so the
      // instructor is editing exactly what gets shown.
      const [p, s, b] = await Promise.all([
        api.myInstructorProfile(user.id).catch(() => null),
        api.myAvailability().catch(() => []),
        api.myInstructorBookings().catch(() => []),
      ]);
      if (p) {
        setProfile(p);
        setPrice(p.lesson_price_minor != null ? String(p.lesson_price_minor / 100) : '35');
        setBio(p.bio ?? '');
        setYears(p.years_experience != null ? String(p.years_experience) : '');
        setBasePostcode(p.base_postcode ?? '');
        setRadiusKm(p.travel_radius_km != null ? String(Number(p.travel_radius_km)) : '16');
        setAccepting(p.is_accepting_bookings !== false);
      }
      setSlots(s);
      setBookings(b);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile() {
    setSavingProfile(true);
    setError(null);
    setProfileSaved(false);
    try {
      const updated = await api.updateMyInstructorProfile({
        // Pounds in the form, pence over the wire — the API stores minor units throughout.
        lessonPriceMinor: price.trim() ? Math.round(Number(price) * 100) : undefined,
        bio: bio.trim() || undefined,
        yearsExperience: years.trim() ? Number(years) : undefined,
        basePostcode: basePostcode.trim() || undefined,
        travelRadiusKm: radiusKm.trim() ? Number(radiusKm) : undefined,
        isAcceptingBookings: accepting,
      });
      setProfile(updated);
      setProfileSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function addSlot() {
    setAddingSlot(true);
    setError(null);
    try {
      await api.addAvailability(slotDate, startTime, endTime);
      setSlotDate('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingSlot(false);
    }
  }

  async function removeSlot(id: string) {
    setError(null);
    try {
      await api.deleteAvailability(id);
      setSlots((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Learners have no lessons to manage; sending them to the search instead of showing an
  // empty dashboard they cannot use.
  if (!isStaff) {
    return (
      <>
        <h1 className="page">My lessons</h1>
        <div className="card">
          <p>Managing lessons is for verified instructors.</p>
          <button className="btn" onClick={() => nav('/instructors/find')}>
            🚗 Book a driving instructor instead
          </button>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <div className="center">
        <div className="spinner" />
      </div>
    );
  }

  const slotIsValid =
    slotDate !== '' && startTime !== '' && endTime !== '' && startTime < endTime;

  return (
    <>
      <h1 className="page">My lessons</h1>
      {error && <div className="error">{error}</div>}

      {!profile && (
        <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
          <strong>Your instructor profile isn't set up yet</strong>
          <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
            Only verified ADIs can take bookings. If you've just been approved, set your
            price and postcode below to start appearing in learners' searches.
          </p>
        </div>
      )}

      {/* --- price, location, availability toggle --- */}
      <div className="card">
        <strong>Your lesson settings</strong>

        <label htmlFor="price" style={{ marginTop: 10 }}>Price per lesson (£) *</label>
        <input
          id="price"
          type="number"
          min="0"
          step="0.50"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          You set your own price. A platform service fee is added on top at checkout, so
          this is what the lesson itself costs.
        </div>

        <label htmlFor="postcode" style={{ marginTop: 12 }}>Postcode you work from *</label>
        <input
          id="postcode"
          value={basePostcode}
          onChange={(e) => setBasePostcode(e.target.value)}
          placeholder="e.g. B25 8JS"
          autoComplete="postal-code"
        />
        <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          {/* Said plainly because it is the difference between being findable and not. */}
          Learners search by postcode. Without this you won't appear in local results — only
          in the "covers other areas" fallback.
        </div>

        <label htmlFor="radius" style={{ marginTop: 12 }}>How far will you travel? (km)</label>
        <input
          id="radius"
          type="number"
          min="1"
          max="100"
          value={radiusKm}
          onChange={(e) => setRadiusKm(e.target.value)}
        />

        <label htmlFor="years" style={{ marginTop: 12 }}>Years of experience</label>
        <input
          id="years"
          type="number"
          min="0"
          value={years}
          onChange={(e) => setYears(e.target.value)}
        />

        <label htmlFor="bio" style={{ marginTop: 12 }}>About you</label>
        <textarea
          id="bio"
          rows={3}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell learners how you teach, which test centres you know best…"
          style={{ width: '100%' }}
        />

        <label
          style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', marginTop: 12 }}
        >
          <input
            type="checkbox"
            checked={accepting}
            onChange={(e) => setAccepting(e.target.checked)}
            style={{ width: 'auto', margin: 0 }}
          />
          <span style={{ fontSize: 14 }}>
            I'm accepting new bookings
            <span className="muted" style={{ display: 'block', fontSize: 12 }}>
              Turn this off to stay listed but hide yourself from search while you're full.
            </span>
          </span>
        </label>

        {profileSaved && (
          <div style={{ color: 'var(--green)', fontSize: 13, marginTop: 8 }}>
            Saved. Learners searching near {profile?.base_postcode ?? basePostcode} will see
            you at {priceLabel(profile?.lesson_price_minor)}.
          </div>
        )}
        <button className="btn" disabled={savingProfile} onClick={saveProfile} style={{ marginTop: 12 }}>
          {savingProfile ? 'Saving…' : 'Save lesson settings'}
        </button>
      </div>

      {/* --- availability --- */}
      <div className="card">
        <strong>Your availability</strong>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
          Learners can only book a slot you've published here.
        </p>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="sd">Date</label>
            <input
              id="sd"
              type="date"
              value={slotDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setSlotDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="st">From</label>
            <input id="st" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label htmlFor="et">To</label>
            <input id="et" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <button className="btn auto" disabled={!slotIsValid || addingSlot} onClick={addSlot}>
            {addingSlot ? 'Adding…' : '+ Add slot'}
          </button>
        </div>
        {slotDate !== '' && startTime >= endTime && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
            The end time needs to be after the start time.
          </div>
        )}

        {slots.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            No slots published yet.
          </p>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {slots.map((s) => (
              <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14 }}>
                  {formatSlotDate(s.slot_date)} · {formatSlotTime(s.start_time)}–
                  {formatSlotTime(s.end_time)}
                  {s.is_booked && (
                    <span className="pill green" style={{ marginLeft: 8 }}>booked</span>
                  )}
                </span>
                {/* A booked slot has a learner depending on it; the API refuses to delete it,
                    so the button isn't offered. */}
                {!s.is_booked && (
                  <button className="btn ghost auto" onClick={() => removeSlot(s.id)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- incoming requests --- */}
      <div className="card">
        <strong>Lesson requests</strong>
        {bookings.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
            No lesson requests yet.
          </p>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bookings.map((b) => (
              <div key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{b.learner_name ?? 'Learner'}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {formatSlotDate(b.slot_date)} · {formatSlotTime(b.start_time)}–
                    {formatSlotTime(b.end_time)}
                  </div>
                  {b.lesson_notes && (
                    <div className="muted" style={{ fontSize: 12 }}>&ldquo;{b.lesson_notes}&rdquo;</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`pill ${b.status === 'confirmed' ? 'green' : 'amber'}`}>
                    {b.status}
                  </span>
                  {b.lesson_fee_minor != null && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {priceLabel(b.lesson_fee_minor)} to you
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
