import { useNavigate } from 'react-router-dom';
import { RouteSummary, distanceLabel, durationLabel } from '../api/types';

export function RouteCard({ route }: { route: RouteSummary }) {
  const nav = useNavigate();
  const q = route.qualityScore;
  const qClass = q == null ? '' : q >= 70 ? 'green' : q >= 50 ? 'amber' : '';
  return (
    <div className="card route-card" onClick={() => nav(`/route/${route.id}`)}>
      <div className="row">
        <h3 className="route-title">{route.title}</h3>
        <div className="spacer" />
        {route.isInstructor && <span className="pill accent">Instructor</span>}
        {route.isSample && <span className="pill free">Free</span>}
      </div>
      {(route.town || route.postcode) && (
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {[route.town, route.postcode].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="stat">📏 {distanceLabel(route.distanceM)}</span>
        <span className="stat">⏱ {durationLabel(route.durationS)}</span>
        {route.roundaboutCount != null && <span className="stat">🔄 {route.roundaboutCount}</span>}
        <div className="spacer" />
        {q != null && <span className={`pill ${qClass}`}>{q}</span>}
      </div>
    </div>
  );
}
