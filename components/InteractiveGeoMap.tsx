import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Building2, Crosshair, ExternalLink, Globe, Layers, MapPin, Navigation } from 'lucide-react';
import { Language, ThemeOption, WorkSiteLocation } from '../types';
import { FALLBACK_DEFAULT_CENTER, formatDistanceLabel } from '../utils/attendanceCalculations';
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsEmbedUrl,
  buildGoogleMapsPinUrl,
} from '../utils/geolocation';

export type GeoMapMode = 'employee-verify' | 'admin-editor' | 'record-inspect';
export type MapBasemapStyle = 'streets' | 'satellite' | 'dark' | 'google';

export interface GeoPointInput {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  label?: string;
  source?: 'hardware-gps' | 'network-gps' | 'ip-fallback' | string;
}

interface InteractiveGeoMapProps {
  mode: GeoMapMode;
  theme?: ThemeOption;
  lang: Language;
  workSites: WorkSiteLocation[];
  selectedSiteName?: string;
  selectedSiteId?: string;
  userPosition?: GeoPointInput | null;
  secondaryPosition?: GeoPointInput | null;
  matchedSite?: WorkSiteLocation | null;
  distanceMeters?: number | null;
  isInsideGeofence?: boolean | null;
  heightClass?: string;
  minHeightPx?: number;
  focusTrigger?: number;
  onSelectSite?: (site: WorkSiteLocation) => void;
  onAdminPickCoordinates?: (lat: number, lng: number) => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getProxyTileConfig(style: Exclude<MapBasemapStyle, 'google'>): { url: string; attribution: string } {
  if (style === 'satellite') {
    return {
      url: '/api/map-tiles/satellite/{z}/{x}/{y}.png',
      attribution: '&copy; Esri &copy; OpenStreetMap',
    };
  }
  return {
    url: '/api/map-tiles/streets/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap &copy; Esri',
  };
}

function getDirectFallbackTileConfig(style: Exclude<MapBasemapStyle, 'google'>): { url: string; attribution: string } {
  if (style === 'satellite') {
    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri',
    };
  }
  return {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  };
}

function createOfficeDivIcon(isActive: boolean, isMatchedInside: boolean | null, label: string): L.DivIcon {
  const ringColor = isActive
    ? isMatchedInside === true
      ? '#22c55e'
      : isMatchedInside === false
      ? '#ef4444'
      : '#b58927'
    : '#9d9689';

  const bgColor = isActive ? '#b58927' : '#272a34';
  const textColor = isActive ? '#0d0e12' : '#f3efe6';

  return L.divIcon({
    className: '',
    iconSize: [34, 40],
    iconAnchor: [17, 36],
    popupAnchor: [0, -34],
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;pointer-events:auto;" title="${escapeHtml(label)}">
        ${
          isActive
            ? `<span class="geo-pulse-ring" style="position:absolute;top:-2px;width:34px;height:34px;border-radius:9999px;border:2px solid ${ringColor};"></span>`
            : ''
        }
        <div style="width:30px;height:30px;border-radius:9999px;background:${bgColor};border:2.5px solid ${ringColor};color:${textColor};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
            <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
            <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
            <path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
          </svg>
        </div>
        <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${ringColor};margin-top:-1px;"></div>
      </div>
    `,
  });
}

function createUserPinDivIcon(isInside: boolean | null, isSecondary = false): L.DivIcon {
  const color = isSecondary ? '#a855f7' : isInside === true ? '#22c55e' : isInside === false ? '#ef4444' : '#3b82f6';
  const pulseRgba = isSecondary
    ? 'rgba(168,85,247,0.45)'
    : isInside === true
    ? 'rgba(34,197,94,0.45)'
    : isInside === false
    ? 'rgba(239,68,68,0.45)'
    : 'rgba(59,130,246,0.45)';

  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
    html: `
      <div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
        <span class="geo-pulse-ring" style="position:absolute;inset:0;border-radius:9999px;background:${pulseRgba};"></span>
        <span style="position:relative;width:16px;height:16px;border-radius:9999px;background:${color};border:3px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.45);"></span>
      </div>
    `,
  });
}

const InteractiveGeoMap: React.FC<InteractiveGeoMapProps> = ({
  mode,
  theme = 'dark' as ThemeOption,
  lang,
  workSites,
  selectedSiteName,
  selectedSiteId,
  userPosition,
  secondaryPosition,
  matchedSite,
  distanceMeters,
  isInsideGeofence,
  heightClass = 'h-72',
  minHeightPx = 280,
  focusTrigger = 0,
  onSelectSite,
  onAdminPickCoordinates,
}) => {
  const [mapStyle, setMapStyle] = useState<MapBasemapStyle>('streets');
  const [tilesLoaded, setTilesLoaded] = useState<boolean>(false);
  const [googleFocusTarget, setGoogleFocusTarget] = useState<'user' | 'office'>('user');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);
  const usingDirectFallbackRef = useRef<boolean>(false);
  const onSelectSiteRef = useRef(onSelectSite);
  const onAdminPickRef = useRef(onAdminPickCoordinates);
  const modeRef = useRef(mode);
  const lastViewSignatureRef = useRef<string>('');

  onSelectSiteRef.current = onSelectSite;
  onAdminPickRef.current = onAdminPickCoordinates;
  modeRef.current = mode;

  const activeSite =
    workSites.find(
      (s) => s.id === selectedSiteId || (selectedSiteName && s.name === selectedSiteName)
    ) ||
    matchedSite ||
    workSites[0] ||
    null;

  // Target coordinate pair for Google Maps view & external verification links
  const googleAnchor = useMemo(() => {
    const targetSite = matchedSite || activeSite;
    if (mode === 'admin-editor' && targetSite) {
      return {
        lat: targetSite.lat,
        lng: targetSite.lng,
        label: targetSite.name,
      };
    }
    if (googleFocusTarget === 'office' && targetSite) {
      return {
        lat: targetSite.lat,
        lng: targetSite.lng,
        label: targetSite.name,
      };
    }
    if (userPosition) {
      return {
        lat: userPosition.lat,
        lng: userPosition.lng,
        label: userPosition.label || (lang === 'ar' ? 'نقطة موقعي' : 'My Location'),
      };
    }
    if (targetSite) {
      return {
        lat: targetSite.lat,
        lng: targetSite.lng,
        label: targetSite.name,
      };
    }
    return {
      lat: FALLBACK_DEFAULT_CENTER.lat,
      lng: FALLBACK_DEFAULT_CENTER.lng,
      label: lang === 'ar' ? 'ديوان المصلحة' : 'HQ',
    };
  }, [mode, matchedSite, activeSite, googleFocusTarget, userPosition, lang]);

  const googlePinHref = useMemo(
    () => buildGoogleMapsPinUrl(googleAnchor.lat, googleAnchor.lng),
    [googleAnchor]
  );

  const googleDirectionsHref = useMemo(() => {
    const destSite = matchedSite || activeSite;
    if (!userPosition || !destSite) return null;
    return buildGoogleMapsDirectionsUrl(userPosition.lat, userPosition.lng, destSite.lat, destSite.lng);
  }, [userPosition, matchedSite, activeSite]);

  // Initialize Leaflet map instance cleanly (StrictMode-safe)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const leafletContainer = el as HTMLDivElement & { _leaflet_id?: number };
    if (leafletContainer._leaflet_id) {
      delete leafletContainer._leaflet_id;
    }

    const initialCenter = matchedSite
      ? ([matchedSite.lat, matchedSite.lng] as [number, number])
      : workSites[0]
      ? ([workSites[0].lat, workSites[0].lng] as [number, number])
      : ([FALLBACK_DEFAULT_CENTER.lat, FALLBACK_DEFAULT_CENTER.lng] as [number, number]);

    const map = L.map(el, {
      center: initialCenter,
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    });

    const overlayGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    overlayGroupRef.current = overlayGroup;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (modeRef.current === 'admin-editor' && onAdminPickRef.current) {
        onAdminPickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
      }
    });

    const refreshSize = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize({ animate: false });
      }
    };

    map.whenReady(() => {
      refreshSize();
    });

    const resizeObserver = new ResizeObserver(() => {
      refreshSize();
    });
    resizeObserver.observe(el);

    const handleVisibility = () => {
      if (!document.hidden) {
        window.setTimeout(refreshSize, 80);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', refreshSize);

    const rafId = window.requestAnimationFrame(refreshSize);
    const t1 = window.setTimeout(refreshSize, 150);
    const t2 = window.setTimeout(refreshSize, 450);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', refreshSize);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      overlayGroupRef.current = null;
      usingDirectFallbackRef.current = false;
      lastViewSignatureRef.current = '';
    };
  }, []);

  // Load selected tile layer when using Leaflet views
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStyle === 'google') return;

    map.invalidateSize({ animate: false });

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    usingDirectFallbackRef.current = false;
    setTilesLoaded(false);

    const primaryCfg = getProxyTileConfig(mapStyle);
    const tileClassName = mapStyle === 'dark' ? 'geo-dark-tile' : '';
    const layer = L.tileLayer(primaryCfg.url, {
      attribution: primaryCfg.attribution,
      maxZoom: 19,
      updateWhenIdle: false,
      keepBuffer: 2,
      className: tileClassName,
    });

    layer.on('tileload', () => {
      setTilesLoaded(true);
    });

    layer.on('tileerror', () => {
      if (usingDirectFallbackRef.current || !mapRef.current) return;
      usingDirectFallbackRef.current = true;
      if (tileLayerRef.current) {
        mapRef.current.removeLayer(tileLayerRef.current);
      }
      const fallbackCfg = getDirectFallbackTileConfig(mapStyle);
      const fallbackLayer = L.tileLayer(fallbackCfg.url, {
        attribution: fallbackCfg.attribution,
        maxZoom: 19,
        className: tileClassName,
      });
      fallbackLayer.on('tileload', () => setTilesLoaded(true));
      fallbackLayer.addTo(mapRef.current);
      tileLayerRef.current = fallbackLayer;
    });

    layer.addTo(map);
    tileLayerRef.current = layer;
  }, [mapStyle, theme]);

  // Render office markers, geofence radii, live GPS pin & dashed distance line
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayGroupRef.current;
    if (!map || !overlay) return;

    overlay.clearLayers();

    const activeSiteId =
      selectedSiteId ||
      matchedSite?.id ||
      workSites.find((s) => s.name === selectedSiteName)?.id ||
      workSites[0]?.id;

    let activeSiteObj: WorkSiteLocation | undefined;
    const popupDir = lang === 'ar' ? 'rtl' : 'ltr';

    workSites.forEach((site) => {
      const isSelected = site.id === activeSiteId || (selectedSiteName && site.name === selectedSiteName);
      if (isSelected) activeSiteObj = site;

      const matchedStatusForCircle =
        mode === 'employee-verify' && matchedSite?.id === site.id ? isInsideGeofence ?? null : null;

      const circleStroke = isSelected
        ? matchedStatusForCircle === true
          ? '#22c55e'
          : matchedStatusForCircle === false
          ? '#ef4444'
          : '#b58927'
        : '#615b50';

      const circleFill = isSelected
        ? matchedStatusForCircle === true
          ? '#22c55e'
          : matchedStatusForCircle === false
          ? '#ef4444'
          : '#b58927'
        : '#615b50';

      L.circle([site.lat, site.lng], {
        radius: Math.max(25, site.radiusMeters || 250),
        color: circleStroke,
        weight: isSelected ? 2.5 : 1.2,
        dashArray: isSelected ? undefined : '4 4',
        fillColor: circleFill,
        fillOpacity: isSelected ? 0.16 : 0.06,
      }).addTo(overlay);

      const marker = L.marker([site.lat, site.lng], {
        icon: createOfficeDivIcon(Boolean(isSelected), matchedStatusForCircle, site.name),
        draggable: mode === 'admin-editor' && Boolean(isSelected),
        zIndexOffset: isSelected ? 500 : 100,
      }).addTo(overlay);

      const popupHtml = `
        <div dir="${popupDir}" style="font-size:12px;line-height:1.45;">
          <div style="font-weight:700;margin-bottom:2px;">${escapeHtml(site.name)}</div>
          <div style="font-size:11px;opacity:0.85;">${
            lang === 'ar' ? 'نطاق السياج:' : 'Geofence:'
          } ${site.radiusMeters}m</div>
          <div style="font-size:10px;font-family:monospace;opacity:0.75;margin-top:2px;">${site.lat.toFixed(
            5
          )}, ${site.lng.toFixed(5)}</div>
        </div>
      `;
      marker.bindPopup(popupHtml);

      marker.on('click', () => {
        if (onSelectSiteRef.current) {
          onSelectSiteRef.current(site);
        }
      });

      if (mode === 'admin-editor' && isSelected) {
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          if (onAdminPickRef.current) {
            onAdminPickRef.current(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
          }
        });
      }
    });

    if (userPosition) {
      if (userPosition.accuracyMeters && userPosition.accuracyMeters > 0) {
        const isIp = userPosition.source === 'ip-fallback';
        L.circle([userPosition.lat, userPosition.lng], {
          radius: Math.min(isIp ? 600 : 350, userPosition.accuracyMeters),
          color: isIp ? '#f59e0b' : '#3b82f6',
          weight: 1,
          dashArray: isIp ? '4 4' : undefined,
          fillColor: isIp ? '#f59e0b' : '#3b82f6',
          fillOpacity: isIp ? 0.08 : 0.1,
        }).addTo(overlay);
      }

      const userMarker = L.marker([userPosition.lat, userPosition.lng], {
        icon: createUserPinDivIcon(isInsideGeofence ?? null, false),
        draggable: false,
        zIndexOffset: 900,
      }).addTo(overlay);

      const userTitle =
        userPosition.label ||
        (userPosition.source === 'ip-fallback'
          ? lang === 'ar'
            ? 'موقعك التقريبي عبر الشبكة (IP)'
            : 'Approximate Network Location (IP)'
          : lang === 'ar'
          ? 'نقطة موقعك الحالية (GPS)'
          : 'Your Live GPS Pin');
      const sourceNote =
        userPosition.source === 'hardware-gps'
          ? lang === 'ar'
            ? 'GPS مباشر دقيق'
            : 'Hardware GPS'
          : userPosition.source === 'network-gps'
          ? lang === 'ar'
            ? 'موقع الشبكة / Wi-Fi'
            : 'Wi-Fi / Network'
          : userPosition.source === 'ip-fallback'
          ? lang === 'ar'
            ? 'نقطة IP تقريبية'
            : 'Approximate IP'
          : '';
      const distBadge =
        distanceMeters !== undefined && distanceMeters !== null && matchedSite
          ? `<div style="font-size:11px;margin-top:2px;">${
              lang === 'ar' ? 'المسافة عن' : 'Distance to'
            } ${escapeHtml(matchedSite.name)}: <b>${formatDistanceLabel(distanceMeters, lang)}</b></div>`
          : '';
      userMarker.bindPopup(
        `<div dir="${popupDir}" style="font-size:12px;line-height:1.45;">
          <div style="font-weight:700;">${escapeHtml(userTitle)}</div>
          ${sourceNote ? `<div style="font-size:10px;opacity:0.8;">${escapeHtml(sourceNote)}</div>` : ''}
          ${distBadge}
          <div style="font-size:10px;font-family:monospace;opacity:0.75;margin-top:2px;">${userPosition.lat.toFixed(
            5
          )}, ${userPosition.lng.toFixed(5)}</div>
        </div>`
      );

      const targetSite = matchedSite || activeSiteObj;
      if (targetSite) {
        L.polyline(
          [
            [userPosition.lat, userPosition.lng],
            [targetSite.lat, targetSite.lng],
          ],
          {
            color: isInsideGeofence === true ? '#22c55e' : isInsideGeofence === false ? '#ef4444' : '#b58927',
            weight: 2.2,
            dashArray: '6 6',
            opacity: 0.9,
          }
        ).addTo(overlay);
      }
    }

    if (secondaryPosition) {
      const secMarker = L.marker([secondaryPosition.lat, secondaryPosition.lng], {
        icon: createUserPinDivIcon(null, true),
        draggable: false,
        zIndexOffset: 850,
      }).addTo(overlay);
      secMarker.bindPopup(
        `<div dir="${popupDir}" style="font-size:12px;line-height:1.45;">
          <div style="font-weight:700;">${escapeHtml(
            secondaryPosition.label || (lang === 'ar' ? 'نقطة الانصراف (GPS)' : 'Check-Out GPS Pin')
          )}</div>
          <div style="font-size:10px;font-family:monospace;opacity:0.75;margin-top:2px;">${secondaryPosition.lat.toFixed(
            5
          )}, ${secondaryPosition.lng.toFixed(5)}</div>
        </div>`
      );
    }

    const targetForFit = matchedSite || activeSiteObj;
    const viewSig =
      mode === 'admin-editor'
        ? `admin:${activeSiteObj?.id || ''}:${focusTrigger}`
        : `emp:${targetForFit?.id || ''}:${
            userPosition ? `${userPosition.lat.toFixed(4)},${userPosition.lng.toFixed(4)}` : 'none'
          }:${secondaryPosition ? `${secondaryPosition.lat.toFixed(4)}` : ''}:${focusTrigger}`;

    if (viewSig !== lastViewSignatureRef.current) {
      lastViewSignatureRef.current = viewSig;

      const pointsToFit: Array<[number, number]> = [];
      if (userPosition) pointsToFit.push([userPosition.lat, userPosition.lng]);
      if (secondaryPosition) pointsToFit.push([secondaryPosition.lat, secondaryPosition.lng]);

      map.invalidateSize({ animate: false });

      if (mode !== 'admin-editor' && targetForFit && pointsToFit.length > 0) {
        pointsToFit.push([targetForFit.lat, targetForFit.lng]);
        const bounds = L.latLngBounds(pointsToFit);
        map.fitBounds(bounds, { padding: [42, 42], maxZoom: 16, animate: true });
      } else if (activeSiteObj) {
        map.flyTo([activeSiteObj.lat, activeSiteObj.lng], 15, { duration: 0.45 });
      } else if (targetForFit) {
        map.flyTo([targetForFit.lat, targetForFit.lng], 15, { duration: 0.45 });
      } else if (workSites.length > 0) {
        const bounds = L.latLngBounds(workSites.map((s) => [s.lat, s.lng] as [number, number]));
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
      }
    }
  }, [
    mode,
    lang,
    workSites,
    selectedSiteName,
    selectedSiteId,
    userPosition,
    secondaryPosition,
    matchedSite,
    distanceMeters,
    isInsideGeofence,
    focusTrigger,
  ]);

  const handleFocusOffice = useCallback(() => {
    setGoogleFocusTarget('office');
    const map = mapRef.current;
    const site = matchedSite || activeSite;
    if (!map || !site) return;
    map.invalidateSize({ animate: false });
    map.flyTo([site.lat, site.lng], 16, { duration: 0.45 });
  }, [matchedSite, activeSite]);

  const handleFocusUser = useCallback(() => {
    setGoogleFocusTarget('user');
    const map = mapRef.current;
    if (!map || !userPosition) return;
    map.invalidateSize({ animate: false });
    map.flyTo([userPosition.lat, userPosition.lng], 16, { duration: 0.45 });
  }, [userPosition]);

  const handleFitAllSites = useCallback(() => {
    const map = mapRef.current;
    if (!map || workSites.length === 0) return;
    map.invalidateSize({ animate: false });
    const bounds = L.latLngBounds(workSites.map((s) => [s.lat, s.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [38, 38], maxZoom: 15, animate: true });
  }, [workSites]);

  const isGoogleView = mapStyle === 'google';

  return (
    <div
      style={{ minHeight: `${minHeightPx}px` }}
      className={`relative z-0 isolate w-full ${heightClass} rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--app-bg)]`}
    >
      {/* Absolute-filled Leaflet canvas */}
      <div
        ref={containerRef}
        className={`absolute inset-0 w-full h-full ${isGoogleView ? 'invisible pointer-events-none' : 'visible'}`}
      />

      {/* Native Google Maps Interactive Embed View */}
      {isGoogleView && (
        <iframe
          key={`${googleAnchor.lat.toFixed(5)},${googleAnchor.lng.toFixed(5)},${lang}`}
          src={buildGoogleMapsEmbedUrl(googleAnchor.lat, googleAnchor.lng, 16, lang)}
          title={`Google Maps - ${googleAnchor.label}`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="absolute inset-0 w-full h-full border-0 bg-white"
        />
      )}

      {/* Top Overlay: Basemap Switcher (including Google Maps) & Mode Indicator */}
      <div
        className={`pointer-events-none absolute top-2.5 ${
          lang === 'ar' ? 'left-2.5' : 'right-2.5'
        } z-[500] flex flex-wrap items-center gap-1.5`}
      >
        <div className="pointer-events-auto inline-flex flex-wrap items-center p-0.5 rounded-lg bg-[var(--card-bg)]/95 border border-[var(--border)] shadow-sm text-[10px] font-semibold gap-0.5">
          {(
            [
              { id: 'streets', label: lang === 'ar' ? 'خريطة' : 'Map', icon: Layers },
              { id: 'satellite', label: lang === 'ar' ? 'قمر صناعي' : 'Satellite', icon: Globe },
              { id: 'google', label: lang === 'ar' ? 'خرائط Google' : 'Google Maps', icon: MapPin },
              { id: 'dark', label: lang === 'ar' ? 'داكن' : 'Dark', icon: Layers },
            ] as const
          ).map((item) => {
            const active = mapStyle === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMapStyle(item.id);
                  if (item.id !== 'google') {
                    window.setTimeout(() => mapRef.current?.invalidateSize({ animate: false }), 60);
                  }
                }}
                className={`px-2 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <span className="px-2 py-1 rounded-md bg-[var(--card-bg)]/90 border border-[var(--border)] text-[10px] font-semibold text-[var(--text-main)] shadow-xs flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isGoogleView || tilesLoaded ? 'bg-[var(--status-success-text)]' : 'bg-[var(--primary)] animate-pulse'
            }`}
          />
          <span>
            {isGoogleView
              ? mode === 'admin-editor'
                ? lang === 'ar'
                  ? `عرض Google: ${googleAnchor.label} (استخدم خريطة/قمر للسحب)`
                  : `Google View: ${googleAnchor.label}`
                : `${lang === 'ar' ? 'خرائط Google' : 'Google Maps'}: ${googleAnchor.label}`
              : mode === 'admin-editor'
              ? lang === 'ar'
                ? 'انقر أو اسحب الدبوس لتحديد المكتب'
                : 'Click or drag pin to place office'
              : mode === 'record-inspect'
              ? lang === 'ar'
                ? 'نقطة التوثيق الجغرافي'
                : 'Recorded GPS Pin'
              : lang === 'ar'
              ? 'خريطة التحقق الجغرافي'
              : 'Live GPS Map'}
          </span>
        </span>
      </div>

      {/* Bottom Overlay: Quick Camera Focus Controls + Open in Google Maps */}
      <div
        className={`pointer-events-none absolute bottom-2.5 ${
          lang === 'ar' ? 'right-2.5' : 'left-2.5'
        } z-[500] flex flex-wrap items-center gap-1.5`}
      >
        {(matchedSite || activeSite) && (
          <button
            type="button"
            onClick={handleFocusOffice}
            className="pointer-events-auto inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--card-bg)]/95 border border-[var(--border)] text-[10px] font-semibold text-[var(--text-main)] hover:border-[var(--primary)] shadow-xs cursor-pointer"
          >
            <Building2 size={11} className="text-[var(--primary-text)]" />
            <span>{lang === 'ar' ? 'المكتب' : 'Office'}</span>
          </button>
        )}

        {userPosition && (
          <button
            type="button"
            onClick={handleFocusUser}
            className="pointer-events-auto inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--card-bg)]/95 border border-[var(--border)] text-[10px] font-semibold text-[var(--text-main)] hover:border-[var(--primary)] shadow-xs cursor-pointer"
          >
            <Navigation size={11} className="text-[var(--status-success-text)]" />
            <span>{lang === 'ar' ? 'موقعي' : 'My Pin'}</span>
          </button>
        )}

        {workSites.length > 1 && !isGoogleView && (
          <button
            type="button"
            onClick={handleFitAllSites}
            className="pointer-events-auto inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--card-bg)]/95 border border-[var(--border)] text-[10px] font-semibold text-[var(--text-main)] hover:border-[var(--primary)] shadow-xs cursor-pointer"
          >
            <Crosshair size={11} className="text-[var(--primary-text)]" />
            <span>{lang === 'ar' ? 'كافة المواقع' : 'All Sites'}</span>
          </button>
        )}

        <a
          href={googlePinHref}
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--card-bg)]/95 border border-[var(--border)] text-[10px] font-semibold text-[var(--primary-text)] hover:border-[var(--primary)] shadow-xs"
          title={lang === 'ar' ? 'فتح الموقع في خرائط Google' : 'Open pin in Google Maps'}
        >
          <ExternalLink size={11} />
          <span>{lang === 'ar' ? 'خرائط Google' : 'Google Maps'}</span>
        </a>

        {googleDirectionsHref && mode !== 'admin-editor' && (
          <a
            href={googleDirectionsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--card-bg)]/95 border border-[var(--border)] text-[10px] font-semibold text-[var(--text-main)] hover:border-[var(--primary)] shadow-xs"
            title={lang === 'ar' ? 'عرض المسار إلى مقر العمل في خرائط Google' : 'View route to office in Google Maps'}
          >
            <Navigation size={11} className="text-[var(--primary-text)]" />
            <span>{lang === 'ar' ? 'المسار' : 'Directions'}</span>
          </a>
        )}
      </div>
    </div>
  );
};

export default InteractiveGeoMap;
