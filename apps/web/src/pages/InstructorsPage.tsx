import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Instructor {
  id: string;
  display_name: string;
  avatar_url?: string;
  reputation: number;
  routes_published: number;
  bio?: string;
  lesson_price_minor: number;
  currency: string;
  years_experience?: number;
  is_accepting_bookings: boolean;
}

export function InstructorsPage() {
  const nav = useNavigate();
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [postcode, setPostcode] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const load = async (pc?: string, mp?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (pc) params.set('postcode', pc);
      if (mp) params.set('maxPrice', String(Math.round(parseFloat(mp) * 100)));
      const data = await api.request<Instructor[]>(`/instructors?${params}`);
      setInstructors(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  function search(e: FormEvent) {
    e.preventDefault();
    load(postcode, maxPrice);
  }

  return (
    <>
      <h1 className="page">Find an Instructor</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Book a verified ADI near you. No Premium subscription required.
      </p>

      <form onSubmit={search} className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label>Postcode / area</label>
          <input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="e.g. NW7, London" />
        </div>
        <div style={{ flex: '0 0 140px' }}>
          <label>Max price (£/hr)</label>
          <input type="number" min="0" step="0.01" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="e.g. 40" />
        </div>
        <button className="btn" type="submit">Search</button>
      </form>

      {error && <div className="error">{error}</div>}

      {loading && <div className="center"><div className="spinner" /></div>}

      {!loading && instructors.length === 0 && (
        <div className="empty">
          <div style={{ fontSize: 40 }}>🎓</div>
          <p>No instructors found matching your criteria.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
        {instructors.map((i) => (
          <div
            key={i.id}
            className="card"
            style={{ cursor: 'pointer' }}
            onClick={() => nav(`/instructors/${i.id}`)}
          >
            <div className="row">
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
                {i.display_name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{i.display_name}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  ✅ Verified ADI · {i.routes_published} routes · ⭐ {i.reputation} rep
                  {i.years_experience ? ` · ${i.years_experience} yrs experience` : ''}
                </div>
                {i.bio && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{i.bio}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 20 }}>
                  £{((i.lesson_price_minor ?? 3500) / 100).toFixed(2)}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>per lesson</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
