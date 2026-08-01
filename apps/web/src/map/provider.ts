/**
 * Map provider selection (Phase 24).
 *
 * Decision: ship on Leaflet + OpenStreetMap now, move to Google Maps later. To make
 * that a config change rather than a rewrite, every map in the app goes through
 * `<RouteMap>`, and this module is the only place that knows which engine is active.
 *
 * Switching is an env change plus a rebuild:
 *
 *   VITE_MAP_PROVIDER=google
 *   VITE_GOOGLE_MAPS_API_KEY=AIza...
 *
 * Note it is a BUILD-time switch, not a runtime one — Vite inlines `import.meta.env`
 * as constants, so these must be set before `vite build` (on Vercel: set them, then
 * redeploy). The upside is that a Leaflet build has the Google branch dead-code
 * eliminated, so it ships no Google code and issues no request to Google at all.
 *
 * Google is only selected when a key is actually present. Without one the Maps JS API
 * renders a "for development purposes only" watermark over an unusable grey map, which
 * looks far worse to a learner than the OSM tiles we already know work — so a missing
 * key falls back to Leaflet and says why in the console.
 */

export type MapProvider = 'leaflet' | 'google';

const requested = (import.meta.env.VITE_MAP_PROVIDER as string | undefined)?.toLowerCase();

export const GOOGLE_MAPS_API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';

function resolve(): MapProvider {
  if (requested === 'google') {
    if (GOOGLE_MAPS_API_KEY) return 'google';
    console.warn(
      '[map] VITE_MAP_PROVIDER=google but VITE_GOOGLE_MAPS_API_KEY is empty — ' +
        'falling back to Leaflet/OpenStreetMap.',
    );
    return 'leaflet';
  }
  return 'leaflet';
}

export const MAP_PROVIDER: MapProvider = resolve();

/** Convenience boolean for the one-line checks the requirement asked for. */
export const USE_GOOGLE_MAPS = MAP_PROVIDER === 'google';

/**
 * Shared visual language, so the two engines produce the same-looking map rather than
 * "the Leaflet one" and "the Google one".
 */
export const MAP_STYLE = {
  routeColor: '#2563eb',
  routeWidth: 5,
  routeOpacity: 0.85,
  travelledColor: '#1d4ed8',
  markerColor: '#ef4444',
  defaultZoom: 15,
  /** Fallback centre (Birmingham) for a route with no track at all. */
  fallbackCentre: { lat: 52.4862, lng: -1.8904 },
} as const;
