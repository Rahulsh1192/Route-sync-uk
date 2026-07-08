import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import { RouteSummary } from '../api/types';
import { RouteCard } from '../components/RouteCard';

export function SearchPage() {
  const [q, setQ] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [results, setResults] = useState<RouteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const filters: Record<string, string> = {};
      if (q.trim()) filters.q = q.trim();
      if (difficulty) filters.difficulty = difficulty;
      setResults(await api.searchRoutes(filters));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page">Search routes</h1>
      <form onSubmit={run} className="card">
        <label>Test centre, town or postcode</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Mill Hill, NW7" />
        <label>Difficulty</label>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">Any</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
          <option value="test_standard">Test standard</option>
        </select>
        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10 }}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}
      {results && results.length === 0 && <div className="empty">No matches.</div>}
      {results && results.length > 0 && (
        <div className="grid">
          {results.map((r) => (
            <RouteCard key={r.id} route={r} />
          ))}
        </div>
      )}
    </>
  );
}
