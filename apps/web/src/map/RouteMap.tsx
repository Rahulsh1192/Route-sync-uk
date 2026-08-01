import { lazy, Suspense } from 'react';
import { LeafletRouteMap } from './LeafletRouteMap';
import { USE_GOOGLE_MAPS } from './provider';
import { RouteMapProps } from './types';

/**
 * The single map component the rest of the app uses (Phase 24).
 *
 * Which engine renders is decided by `VITE_MAP_PROVIDER` — see `provider.ts`. No caller
 * should import `LeafletRouteMap` or `GoogleRouteMap` directly; going through here is
 * what keeps the eventual Google switch a config change instead of a diff across every
 * page that shows a map.
 *
 * The Google implementation is lazy-loaded so a Leaflet build doesn't ship it.
 */
const GoogleRouteMap = lazy(() =>
  import('./GoogleRouteMap').then((m) => ({ default: m.GoogleRouteMap })),
);

export function RouteMap(props: RouteMapProps) {
  if (USE_GOOGLE_MAPS) {
    return (
      <Suspense
        fallback={<div className="center" style={{ height: props.height ?? 360 }}>
          <div className="spinner" />
        </div>}
      >
        <GoogleRouteMap {...props} />
      </Suspense>
    );
  }
  return <LeafletRouteMap {...props} />;
}

export type { RouteMapProps } from './types';
export { MAP_PROVIDER, USE_GOOGLE_MAPS } from './provider';
