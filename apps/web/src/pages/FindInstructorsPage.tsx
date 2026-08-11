import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import {
  InstructorListing,
  InstructorSearchResult,
  distanceKmLabel,
  priceLabel,
} from '../api/types';

/**
 * Find a driving instructor near a postcode (Phase 27).
 *
 * This page did not exist: the API had instructor search, the booking flow worked from an
 * instructor's profile, and the Account page advertised "find and book a verified ADI near
 * you" — but `/instructors` redirected to the home page, so the only way to reach an
 * instructor was to already know their profile URL. A learner could not discover anyone.
 *
 * The postcode is optional. Without one this is a national list; with one, results are
 * ordered by distance and split into instructors who cover that postcode and — only when
 * there are none — the nearest who cover other areas.
 */
export function FindInstructorsPage() {
  const nav = useNavigate();
  // The postcode lives in the URL so a search survives a refresh and can be shared or
  // linked to from elsewhere in the app.
  const [params, setParams] = useSearchParams();
  const [postcode, setPostcode] = useState(params.get('postcode') ?? '');
  const [maxPrice, setMaxPrice] = useState(params.get('maxPrice') ?? '');
  const [result, setResult] = useState<InstructorSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchedPostcode = params.get('postcode') ?? '';
  const searchedMaxPrice = params.get('maxPrice') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .searchInstructors({
        postcode: searchedPostcode || undefined,
        maxPriceMinor: searchedMaxPrice ? Math.round(Number(searchedMaxPrice) * 100) : undefined,
      })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setResult(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchedPostcode, searchedMaxPrice]);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    if (postcode.trim()) next.set('postcode', postcode.trim());
    if (maxPrice.trim()) next.set('maxPrice', maxPrice.trim());
    setParams(next);
  }

  const nearby = result?.nearby ?? [];
  const elsewhere = result?.elsewhere ?? [];

  return (
    <>
      <h1 className="page">Book a driving instructor</h1>

      <form className="card" onSubmit={runSearch}>
        <label htmlFor="pc">Your postcode</label>
        <input
          id="pc"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          placeholder="e.g. B25 8JS"
          autoComplete="postal-code"
          // A postcode district on its own works too, so no pattern restriction here — the
          // API resolves both and says so plainly if it can't.
        />
        <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          We'll show instructors who cover your area, nearest first. Leave blank to browse
          everyone.
        </div>

        <label htmlFor="mp" style={{ marginTop: 10 }}>
          Maximum price per lesson (optional)
        </label>
        <input
          id="mp"
          type="number"
          min="0"
          step="1"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="e.g. 40"
        />

        <button className="btn" type="submit" disabled={loading} style={{ marginTop: 12 }}>
          {loading ? 'Searching…' : '🔍 Find instructors'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {loading && (
        <div className="center">
          <div className="spinner" />
        </div>
      )}

      {!loading && result && (
        <>
          {result.origin && (
            <div className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
              Searching around <strong>{result.origin.postcode}</strong>
              {result.origin.town ? `, ${result.origin.town}` : ''}
              {/* Worth saying: a district-only search is measured from the middle of the
                  district, so distances are approximate rather than door-to-door. */}
              {result.origin.approximate && ' (district centre — distances are approximate)'}
            </div>
          )}

          {nearby.length > 0 && (
            <>
              <h2 style={{ fontSize: 18, margin: '8px 0' }}>
                {result.origin ? 'Instructors covering your area' : 'Verified instructors'}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {nearby.map((i) => (
                  <InstructorCard key={i.id} instructor={i} onBook={() => nav(`/instructors/${i.id}`)} />
                ))}
              </div>
            </>
          )}

          {/* The fallback the requirements asked for: an area with no coverage gets the
              nearest instructors rather than a dead end. Kept in its own section so nobody
              90 km away is presented as a local option. */}
          {nearby.length === 0 && elsewhere.length > 0 && (
            <>
              <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
                <strong>No instructors cover {result.origin?.postcode ?? 'that area'} yet</strong>
                <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
                  These instructors work in other areas. Some will travel further than their
                  usual radius — it's worth asking.
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {elsewhere.map((i) => (
                  <InstructorCard key={i.id} instructor={i} onBook={() => nav(`/instructors/${i.id}`)} />
                ))}
              </div>
            </>
          )}

          {nearby.length === 0 && elsewhere.length === 0 && (
            <div className="empty">
              <div style={{ fontSize: 40 }}>🚗</div>
              <p>No verified instructors are taking bookings yet.</p>
              <p className="muted">
                Instructors appear here once they've been verified and set their availability.
              </p>
              <Link className="btn secondary auto" to="/discover" style={{ marginTop: 8 }}>
                Browse practice routes instead
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}

function InstructorCard({
  instructor,
  onBook,
}: {
  instructor: InstructorListing;
  onBook: () => void;
}) {
  const initial = (instructor.display_name ?? 'A')[0]?.toUpperCase() ?? 'A';
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        {instructor.avatar_url ? (
          <img
            src={instructor.avatar_url}
            alt=""
            style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700,
            }}
          >
            {initial}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{instructor.display_name}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            ✅ Verified ADI
            {instructor.years_experience ? ` · ${instructor.years_experience} yrs experience` : ''}
            {instructor.reputation ? ` · ⭐ ${instructor.reputation}` : ''}
          </div>
          {instructor.distanceKm != null && (
            <div className="muted" style={{ fontSize: 13 }}>
              📍 {distanceKmLabel(instructor.distanceKm)} away
              {instructor.base_postcode ? ` · based in ${instructor.base_postcode}` : ''}
            </div>
          )}
          {instructor.bio && (
            <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
              {instructor.bio}
            </p>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>
            {priceLabel(instructor.lesson_price_minor)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>per lesson</div>
        </div>
      </div>

      <button className="btn" onClick={onBook} style={{ marginTop: 12 }}>
        View availability &amp; book
      </button>
    </div>
  );
}
