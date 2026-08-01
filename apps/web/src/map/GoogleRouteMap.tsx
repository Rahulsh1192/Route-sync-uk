import { useEffect, useMemo, useRef, useState } from 'react';
import { GOOGLE_MAPS_API_KEY, MAP_STYLE } from './provider';
import { RouteMapProps } from './types';

/**
 * Google Maps implementation of `RouteMap` (Phase 24).
 *
 * Built against the Maps JavaScript API loaded from a script tag rather than a React
 * wrapper package, on purpose:
 *
 *  * no new npm dependency for a provider that isn't switched on yet, and
 *  * the loader is lazy, so a Leaflet build never fetches Google's script and never
 *    sends a request to Google — which also keeps the switch free of privacy
 *    surprises until it's deliberately flipped.
 *
 * Same imperative approach as the Leaflet map: create the overlays once, then move the
 * marker via `setPosition`, so the ~10 Hz marker updates never re-render React.
 */

declare global {
  interface Window {
    google?: any;
    __routifyMapsLoader__?: Promise<void>;
  }
}

/**
 * Load the Maps JS API at most once per page, no matter how many maps mount.
 * The promise is cached on `window` because React may mount two maps concurrently
 * (e.g. a route page and a modal) and two script tags would double-load the library.
 */
function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__routifyMapsLoader__) return window.__routifyMapsLoader__;

  window.__routifyMapsLoader__ = new Promise<void>((resolve, reject) => {
    if (!GOOGLE_MAPS_API_KEY) {
      reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set'));
      return;
    }
    const script = document.createElement('script');
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
      '&libraries=geometry&loading=async&v=weekly';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return window.__routifyMapsLoader__;
}

export function GoogleRouteMap({
  track,
  position,
  follow = true,
  travelledTo = null,
  className,
  height = 360,
  onMarkerClick,
}: RouteMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const travelledLineRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const userMovedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = useMemo(() => track.map((p) => ({ lat: p.lat, lng: p.lng })), [track]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => !cancelled && setReady(true))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  // --- create the map -----------------------------------------------------
  useEffect(() => {
    if (!ready || !hostRef.current || mapRef.current) return;
    const g = window.google.maps;

    mapRef.current = new g.Map(hostRef.current, {
      center: MAP_STYLE.fallbackCentre,
      zoom: MAP_STYLE.defaultZoom,
      // Match the Leaflet build's behaviour: inside a player, a scroll means "scroll
      // the page". Ctrl+scroll still zooms, which is Google's own convention.
      gestureHandling: 'cooperative',
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    });

    const stopFollowing = () => {
      userMovedRef.current = true;
    };
    mapRef.current.addListener('dragstart', stopFollowing);
    // `zoom_changed` also fires for programmatic zooms, so only a real gesture is
    // treated as the user taking over.
    hostRef.current.addEventListener('wheel', stopFollowing, { passive: true });
  }, [ready]);

  // --- route line ---------------------------------------------------------
  useEffect(() => {
    if (!ready || !mapRef.current || path.length < 2) return;
    const g = window.google.maps;

    routeLineRef.current?.setMap(null);
    routeLineRef.current = new g.Polyline({
      path,
      strokeColor: MAP_STYLE.routeColor,
      strokeWeight: MAP_STYLE.routeWidth,
      strokeOpacity: MAP_STYLE.routeOpacity,
      map: mapRef.current,
    });

    const bounds = new g.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    mapRef.current.fitBounds(bounds, 24);
    userMovedRef.current = false;
  }, [ready, path]);

  // --- marker -------------------------------------------------------------
  useEffect(() => {
    if (!ready || !mapRef.current || !position) return;
    const g = window.google.maps;

    const icon = {
      path: g.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 6,
      fillColor: MAP_STYLE.markerColor,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      rotation: position.bearingDeg ?? 0,
    };

    if (!markerRef.current) {
      markerRef.current = new g.Marker({
        position,
        map: mapRef.current,
        icon,
        zIndex: 1000,
      });
      if (onMarkerClick) markerRef.current.addListener('click', onMarkerClick);
    } else {
      markerRef.current.setPosition(position);
      markerRef.current.setIcon(icon);
    }

    if (follow && !userMovedRef.current) {
      const bounds = mapRef.current.getBounds();
      // Recentre only when the marker leaves the visible area, matching Leaflet.
      if (bounds && !bounds.contains(position)) mapRef.current.panTo(position);
    }
  }, [ready, position, follow, onMarkerClick]);

  // --- travelled portion --------------------------------------------------
  useEffect(() => {
    if (!ready || !mapRef.current || travelledTo == null || path.length < 2) return;
    const g = window.google.maps;
    const upto = path.slice(0, Math.max(2, travelledTo + 1));

    if (travelledLineRef.current) {
      travelledLineRef.current.setPath(upto);
    } else {
      travelledLineRef.current = new g.Polyline({
        path: upto,
        strokeColor: MAP_STYLE.travelledColor,
        strokeWeight: MAP_STYLE.routeWidth + 2,
        strokeOpacity: 0.95,
        map: mapRef.current,
      });
    }
  }, [ready, travelledTo, path]);

  if (error) {
    return (
      <div className="error" style={{ height }}>
        Map unavailable: {error}
      </div>
    );
  }
  return <div ref={hostRef} className={className} style={{ height, width: '100%' }} />;
}
