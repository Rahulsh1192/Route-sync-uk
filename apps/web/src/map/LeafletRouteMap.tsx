import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MAP_STYLE } from './provider';
import { RouteMapProps } from './types';

/**
 * Leaflet implementation of `RouteMap` (Phase 24).
 *
 * Written against the Leaflet API directly rather than through react-leaflet's
 * declarative components, for one reason: the marker moves ~10 times a second during
 * playback. Rendering that as React state churns a component tree 10× a second and
 * makes scrubbing feel sticky. Creating the layers once and calling `setLatLng` on a
 * ref keeps the map buttery and keeps React out of the animation path entirely.
 */
export function LeafletRouteMap({
  track,
  position,
  follow = true,
  travelledTo = null,
  className,
  height = 360,
  onMarkerClick,
}: RouteMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const travelledLineRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // Set once the user pans/zooms by hand, which suspends auto-follow for this session.
  const userMovedRef = useRef(false);

  const latlngs = useMemo<L.LatLngExpression[]>(
    () => track.map((p) => [p.lat, p.lng] as L.LatLngExpression),
    [track],
  );

  // --- create the map once -------------------------------------------------
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    const map = L.map(hostRef.current, {
      zoomControl: true,
      // The map lives inside a video player, where a scroll gesture almost always
      // means "scroll the page", not "zoom the map".
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    map.setView(
      [MAP_STYLE.fallbackCentre.lat, MAP_STYLE.fallbackCentre.lng],
      MAP_STYLE.defaultZoom,
    );

    // Any manual interaction wins over following.
    const stopFollowing = () => {
      userMovedRef.current = true;
    };
    map.on('dragstart', stopFollowing);
    map.on('zoomstart', stopFollowing);

    mapRef.current = map;
    return () => {
      map.off('dragstart', stopFollowing);
      map.off('zoomstart', stopFollowing);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- draw the route line when the track arrives --------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    routeLineRef.current?.remove();
    routeLineRef.current = null;
    travelledLineRef.current?.remove();
    travelledLineRef.current = null;

    if (latlngs.length < 2) return;

    routeLineRef.current = L.polyline(latlngs, {
      color: MAP_STYLE.routeColor,
      weight: MAP_STYLE.routeWidth,
      opacity: MAP_STYLE.routeOpacity,
    }).addTo(map);

    // Frame the whole route on load: the learner's first question is "where does this
    // route go", not "where is the car right now".
    map.fitBounds(routeLineRef.current.getBounds(), { padding: [24, 24] });
    userMovedRef.current = false;
  }, [latlngs]);

  // --- move the marker ----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;

    const latlng = L.latLng(position.lat, position.lng);

    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, {
        icon: buildCarIcon(position.bearingDeg ?? 0),
        // Above the polyline, and above Leaflet's default marker pane.
        zIndexOffset: 1000,
        keyboard: false,
      }).addTo(map);
      if (onMarkerClick) markerRef.current.on('click', onMarkerClick);
    } else {
      markerRef.current.setLatLng(latlng);
      // Rotate the existing element instead of rebuilding the icon — replacing the
      // icon on every tick would remove and re-add a DOM node 10× a second.
      const el = markerRef.current.getElement();
      const arrow = el?.querySelector<HTMLElement>('.route-marker-arrow');
      if (arrow) arrow.style.transform = `rotate(${position.bearingDeg ?? 0}deg)`;
    }

    if (follow && !userMovedRef.current && !map.getBounds().pad(-0.25).contains(latlng)) {
      // Recentre only once the marker leaves the middle half of the viewport, so the
      // map isn't nudging on every frame while the car crosses the screen.
      map.panTo(latlng, { animate: true, duration: 0.5 });
    }
  }, [position, follow, onMarkerClick]);

  // --- shade the part already watched -------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || travelledTo == null || latlngs.length < 2) return;

    const upto = latlngs.slice(0, Math.max(2, travelledTo + 1));
    if (travelledLineRef.current) {
      travelledLineRef.current.setLatLngs(upto);
    } else {
      travelledLineRef.current = L.polyline(upto, {
        color: MAP_STYLE.travelledColor,
        weight: MAP_STYLE.routeWidth + 2,
        opacity: 0.95,
      }).addTo(map);
    }
  }, [travelledTo, latlngs]);

  return <div ref={hostRef} className={className} style={{ height, width: '100%' }} />;
}

/**
 * A rotatable marker. Leaflet has no built-in heading support, so the arrow lives in a
 * `divIcon` whose inner element we rotate with a CSS transform — cheap, GPU-composited,
 * and it survives being moved without a re-render.
 */
function buildCarIcon(bearingDeg: number): L.DivIcon {
  return L.divIcon({
    className: 'route-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html:
      `<div class="route-marker-arrow" style="transform: rotate(${bearingDeg}deg)">` +
      `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
      `<circle cx="12" cy="12" r="11" fill="#fff" fill-opacity="0.9"/>` +
      `<path d="M12 3 L18 20 L12 16 L6 20 Z" fill="${MAP_STYLE.markerColor}"/>` +
      `</svg></div>`,
  });
}
