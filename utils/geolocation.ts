import { Language } from '../types';

export type GeoLocationSource = 'hardware-gps' | 'network-gps' | 'ip-fallback';
export type GeoPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported' | 'unknown';

export interface SmartLocationResult {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  source: GeoLocationSource;
  cityLabel?: string;
  timestamp: number;
}

export interface SmartLocationDiagnostic {
  code: 'PERMISSION_DENIED' | 'TIMEOUT' | 'POSITION_UNAVAILABLE' | 'UNSUPPORTED' | 'INSECURE_CONTEXT' | 'FAILED';
  permissionState: GeoPermissionState;
  messageAr: string;
  messageEn: string;
}

export interface SmartLocationCallbacks {
  lang: Language;
  onFix: (result: SmartLocationResult) => void;
  onDiagnostic?: (diag: SmartLocationDiagnostic) => void;
  onComplete?: () => void;
}

export function buildGoogleMapsPinUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function buildGoogleMapsDirectionsUrl(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${originLat.toFixed(6)},${originLng.toFixed(6)}&destination=${destLat.toFixed(6)},${destLng.toFixed(6)}&travelmode=driving`;
}

export function buildGoogleMapsEmbedUrl(lat: number, lng: number, zoom = 16, lang: Language = 'ar'): string {
  return `https://maps.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}&z=${zoom}&hl=${lang}&output=embed`;
}

export async function queryGeoPermissionState(): Promise<GeoPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'unsupported';
  }
  try {
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
        return status.state;
      }
    }
  } catch {
    // Safari / older browsers don't always allow querying geolocation permission
  }
  return 'unknown';
}

function isValidCoordinatePair(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

async function queryDirectIpWhoIs(): Promise<SmartLocationResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch('https://ipwho.is/', { signal: controller.signal });
    if (!res.ok) throw new Error('ipwho status');
    const data = (await res.json()) as {
      success?: boolean;
      latitude?: number;
      longitude?: number;
      city?: string;
      country?: string;
    };
    if (data.success !== false && isValidCoordinatePair(data.latitude, data.longitude)) {
      const labelParts = [data.city, data.country].filter(Boolean);
      return {
        lat: Number(data.latitude.toFixed(6)),
        lng: Number((data.longitude as number).toFixed(6)),
        accuracyMeters: 3500,
        source: 'ip-fallback',
        cityLabel: labelParts.length > 0 ? labelParts.join(', ') : undefined,
        timestamp: Date.now(),
      };
    }
    throw new Error('ipwho invalid');
  } finally {
    window.clearTimeout(timer);
  }
}

async function queryServerIpProxy(): Promise<SmartLocationResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch('/api/geo/ip-locate', {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('proxy status');
    const data = (await res.json()) as {
      ok?: boolean;
      lat?: number;
      lng?: number;
      cityLabel?: string;
    };
    if (data.ok && isValidCoordinatePair(data.lat, data.lng)) {
      return {
        lat: Number(data.lat.toFixed(6)),
        lng: Number((data.lng as number).toFixed(6)),
        accuracyMeters: 3500,
        source: 'ip-fallback',
        cityLabel: data.cityLabel,
        timestamp: Date.now(),
      };
    }
    throw new Error('proxy unresolved');
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchIpFallbackLocation(): Promise<SmartLocationResult | null> {
  try {
    // Race browser IP lookup and server X-Forwarded-For proxy so whichever resolves first provides anchor
    return await Promise.any([queryDirectIpWhoIs(), queryServerIpProxy()]);
  } catch {
    return null;
  }
}

function buildDiagnostic(
  code: SmartLocationDiagnostic['code'],
  permState: GeoPermissionState
): SmartLocationDiagnostic {
  if (code === 'INSECURE_CONTEXT') {
    return {
      code: 'INSECURE_CONTEXT',
      permissionState: permState,
      messageAr:
        'تحديد الموقع المباشر (GPS) يتطلب اتصال HTTPS آمن. يرجى فتح المنظومة عبر رابط آمن ثم المحاولة مجدداً.',
      messageEn:
        'Live browser GPS requires a secure HTTPS origin. Please open the portal over HTTPS and retry.',
    };
  }
  if (code === 'PERMISSION_DENIED' || permState === 'denied') {
    return {
      code: 'PERMISSION_DENIED',
      permissionState: permState,
      messageAr:
        'إذن الوصول للموقع (GPS) مرفوض في المتصفح أو الإطار المدمج — فعّل صلاحية الموقع من أيقونة القفل في شريط العنوان ثم أعد المحاولة.',
      messageEn:
        'GPS location permission is blocked in your browser or frame — allow Location access in your browser address bar and retry.',
    };
  }
  if (code === 'UNSUPPORTED') {
    return {
      code: 'UNSUPPORTED',
      permissionState: permState,
      messageAr: 'المتصفح الحالي لا يدعم مستشعر GPS المباشر.',
      messageEn: 'Geolocation sensor is not supported in this browser.',
    };
  }
  if (code === 'TIMEOUT') {
    return {
      code: 'TIMEOUT',
      permissionState: permState,
      messageAr:
        'استغرق مستشعر GPS وقتاً طويلاً للاستجابة — تأكد من تفعيل خدمة الموقع على الجهاز ثم اضغط تحديث.',
      messageEn:
        'GPS sensor timed out waiting for a fix — ensure device Location services are enabled and retry.',
    };
  }
  return {
    code,
    permissionState: permState,
    messageAr:
      'تعذر التقاط إشارة GPS حالياً — يرجى تفعيل خدمة الموقع في الجهاز أو المتصفح ثم إعادة المحاولة.',
    messageEn: 'Unable to acquire a GPS fix right now — check device location settings and retry.',
  };
}

/**
 * Multi-stage geolocation acquisition:
 * 1. Fast low-accuracy / cached OS location (enableHighAccuracy: false, maximumAge: 3m, 4.5s timeout)
 * 2. Live high-accuracy watchPosition refinement for up to 12.5s (hardware GPS vs Wi-Fi/network)
 * 3. Automatic IP-based fallback when browser geolocation is blocked/unavailable so maps always resolve a real anchor
 */
export function acquireSmartLocation({
  onFix,
  onDiagnostic,
  onComplete,
}: SmartLocationCallbacks): () => void {
  let cancelled = false;
  let watchId: number | null = null;
  let stage3Timer: number | null = null;
  let settleTimer: number | null = null;
  let bestAccuracy = Number.POSITIVE_INFINITY;
  let hasAnyNativeFix = false;
  let finished = false;

  const stopWatch = () => {
    if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (stage3Timer !== null) {
      window.clearTimeout(stage3Timer);
      stage3Timer = null;
    }
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const finalize = () => {
    if (finished) return;
    finished = true;
    stopWatch();
    if (!cancelled) onComplete?.();
  };

  const deliverNativePos = (pos: GeolocationPosition, highAccuracyHint: boolean) => {
    if (cancelled) return;
    if (!isValidCoordinatePair(pos.coords.latitude, pos.coords.longitude)) return;

    const rawAcc =
      typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy > 0
        ? Math.round(pos.coords.accuracy)
        : undefined;
    const effectiveAcc = rawAcc ?? 9999;

    // Emit first fix immediately; subsequently only emit if accuracy significantly improves
    if (hasAnyNativeFix && effectiveAcc > bestAccuracy * 1.15 && bestAccuracy <= 60) {
      return;
    }

    hasAnyNativeFix = true;
    if (effectiveAcc < bestAccuracy) {
      bestAccuracy = effectiveAcc;
    }

    const source: GeoLocationSource =
      highAccuracyHint || (rawAcc !== undefined && rawAcc <= 100) ? 'hardware-gps' : 'network-gps';

    onFix({
      lat: Number(pos.coords.latitude.toFixed(6)),
      lng: Number(pos.coords.longitude.toFixed(6)),
      accuracyMeters: rawAcc,
      source,
      timestamp: Date.now(),
    });

    if (rawAcc !== undefined && rawAcc <= 30) {
      finalize();
    }
  };

  const tryIpFallbackWithDiag = async (
    errCode: SmartLocationDiagnostic['code'],
    permState: GeoPermissionState
  ) => {
    if (cancelled || hasAnyNativeFix) {
      finalize();
      return;
    }
    const ipFix = await fetchIpFallbackLocation();
    if (cancelled) return;
    if (ipFix) {
      onFix(ipFix);
    }
    onDiagnostic?.(buildDiagnostic(errCode, permState));
    finalize();
  };

  (async () => {
    const permState = await queryGeoPermissionState();
    if (cancelled) return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      await tryIpFallbackWithDiag('UNSUPPORTED', 'unsupported');
      return;
    }

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      await tryIpFallbackWithDiag('INSECURE_CONTEXT', permState);
      return;
    }

    if (permState === 'denied') {
      await tryIpFallbackWithDiag('PERMISSION_DENIED', 'denied');
      return;
    }

    let pendingFast = true;
    let lastErrorCode: SmartLocationDiagnostic['code'] = 'POSITION_UNAVAILABLE';

    // Stage 1: Fast cached / Wi-Fi / OS fix
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pendingFast = false;
        deliverNativePos(pos, false);
      },
      (err) => {
        pendingFast = false;
        if (err.code === err.PERMISSION_DENIED) lastErrorCode = 'PERMISSION_DENIED';
        else if (err.code === err.TIMEOUT) lastErrorCode = 'TIMEOUT';
      },
      { enableHighAccuracy: false, timeout: 4500, maximumAge: 180000 }
    );

    // Stage 2: High-accuracy live watchPosition refinement
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        deliverNativePos(pos, true);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) lastErrorCode = 'PERMISSION_DENIED';
        else if (err.code === err.TIMEOUT) lastErrorCode = 'TIMEOUT';
        else lastErrorCode = 'POSITION_UNAVAILABLE';

        // If permission was explicitly denied and we didn't get a fast fix, fall back promptly
        if (err.code === err.PERMISSION_DENIED && !hasAnyNativeFix) {
          stopWatch();
          void tryIpFallbackWithDiag('PERMISSION_DENIED', 'denied');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );

    // Stage 3 timeout guard: if nothing arrived after 5.2s and fast call finished without a fix, fetch IP fallback while watch continues
    stage3Timer = window.setTimeout(() => {
      if (cancelled || hasAnyNativeFix || pendingFast) return;
      void fetchIpFallbackLocation().then((ipFix) => {
        if (cancelled || hasAnyNativeFix || !ipFix) return;
        onFix(ipFix);
        onDiagnostic?.(buildDiagnostic(lastErrorCode, permState));
      });
    }, 5200);

    // Final settle deadline at 13s
    settleTimer = window.setTimeout(() => {
      if (cancelled) return;
      if (!hasAnyNativeFix) {
        void tryIpFallbackWithDiag(lastErrorCode, permState);
      } else {
        finalize();
      }
    }, 13000);
  })();

  return () => {
    cancelled = true;
    stopWatch();
  };
}
