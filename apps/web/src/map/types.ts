import { TrackPoint } from '../api/types';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * The contract both map engines implement (Phase 24).
 *
 * Deliberately narrow: a route line, a marker, and a follow behaviour. Keeping the
 * surface this small is what makes the Leaflet→Google switch a config change — a
 * richer shared API would inevitably leak one engine's concepts into the other.
 */
export interface RouteMapProps {
  /** The full route geometry, drawn once. */
  track: TrackPoint[];
  /** Where the marker is right now (interpolated by `useRouteTrack`). */
  position: (LatLng & { bearingDeg?: number | null }) | null;
  /**
   * Recentre when the marker approaches the edge of the viewport. Off means the map
   * stays where the user put it — panning away from a followed marker only to be
   * yanked back is worse than having to pan again.
   */
  follow?: boolean;
  /** Draw the portion already watched in a darker shade. */
  travelledTo?: number | null;
  className?: string;
  height?: number | string;
  onMarkerClick?: () => void;
}
