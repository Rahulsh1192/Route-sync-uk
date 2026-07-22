import { useNavigate } from 'react-router-dom';
import { RouteSummary, distanceLabel } from '../api/types';
import { InstructorByline } from './InstructorByline';

export function RouteCard({ route }: { route: RouteSummary }) {
  const nav = useNavigate();
  const q = route.qualityScore;
  const qClass = q == null ? '' : q >= 70 ? 'green' : q >= 50 ? 'amber' : '';
  return (
    <div className="card route-card" onClick={() => nav(`/route/${route.id}`)}>
      <div className="row">
        <h3 className="route-title">{route.title}</h3>
        <div className="spacer" />
        {route.isSample && <span className="pill free">Free</span>}
      </div>
      {(route.town || route.postcode) && (
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {[route.town, route.postcode].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Instructor byline — clicking opens their profile (not the route). */}
      {route.instructorName && (
        <div style={{ marginTop: 10 }}>
          <InstructorByline
            id={route.instructorId}
            name={route.instructorName}
            avatar={route.instructorAvatar}
            verified={route.instructorVerified}
          />
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        {/* Distance in miles; time + roundabout stats removed (Phase 20). */}
        <span className="stat">📏 {distanceLabel(route.distanceM)}</span>
        <div className="spacer" />
        {q != null && <span className={`pill ${qClass}`}>{q}</span>}
      </div>
    </div>
  );
}
