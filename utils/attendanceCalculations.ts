import {
  AbsenceRecord,
  AttendanceRecord,
  AttendanceSettings,
  AttendanceViolationType,
  Employee,
  ExitPermission,
  Language,
  RectificationStatus,
  ShiftMode,
  SystemSettings,
  Vacation,
  WorkSiteLocation,
} from '../types';
import { addDaysToStr, getTodayStr, isOfficialHoliday, parseLocalDate } from './leaveCalculations';

export const STANDARD_SHIFT = {
  start: '07:00',
  end: '15:00',
  startMinutes: 7 * 60,
  endMinutes: 15 * 60,
} as const;

export const FLEXIBLE_SHIFT = {
  start: '08:00',
  end: '16:00',
  startMinutes: 8 * 60,
  endMinutes: 16 * 60,
} as const;

export function parseTimeToMinutes(hhmm?: string): number | null {
  if (!hhmm || !hhmm.includes(':')) return null;
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getCurrentTimeHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function getShiftScheduleBounds(shiftMode: ShiftMode, config?: AttendanceSettings) {
  const useFlex = shiftMode === 'flexible' && (config ? config.flexibleEnabled : true);
  const fallback = useFlex ? FLEXIBLE_SHIFT : STANDARD_SHIFT;
  const start = useFlex ? config?.flexibleStart || fallback.start : config?.standardStart || fallback.start;
  const end = useFlex ? config?.flexibleEnd || fallback.end : config?.standardEnd || fallback.end;
  const startMinutes = parseTimeToMinutes(start) ?? fallback.startMinutes;
  const rawEndMinutes = parseTimeToMinutes(end) ?? fallback.endMinutes;
  const endMinutes = rawEndMinutes > startMinutes ? rawEndMinutes : fallback.endMinutes;
  const scheduledDurationMinutes = Math.max(60, endMinutes - startMinutes);

  return {
    start,
    end,
    startMinutes,
    endMinutes,
    scheduledDurationMinutes,
  };
}

export function evaluateAttendanceEntry(
  checkInTime: string,
  checkOutTime: string | undefined,
  shiftMode: ShiftMode,
  config?: AttendanceSettings
): {
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  violationType: AttendanceViolationType;
  expectedStart: string;
  expectedEnd: string;
  scheduledDurationMinutes: number;
  workedMinutes: number | null;
  adherencePercent: number;
} {
  const bounds = getShiftScheduleBounds(shiftMode, config);
  const graceMinutes = Math.max(0, config?.graceMinutes ?? 0);
  const overtimeEnabled = config ? config.overtimeEnabled : true;
  const overtimeThreshold = Math.max(0, config?.overtimeThresholdMinutes ?? 15);

  const inMin = parseTimeToMinutes(checkInTime);
  const outMin = parseTimeToMinutes(checkOutTime);

  const rawLate = inMin !== null ? Math.max(0, inMin - bounds.startMinutes) : 0;
  const lateMinutes = rawLate > graceMinutes ? rawLate : 0;
  const earlyExitMinutes = outMin !== null ? Math.max(0, bounds.endMinutes - outMin) : 0;

  let violationType: AttendanceViolationType = 'None';
  if (lateMinutes > 0 && earlyExitMinutes > 0) violationType = 'Both';
  else if (lateMinutes > 0) violationType = 'LateArrival';
  else if (earlyExitMinutes > 0) violationType = 'EarlyDeparture';

  const workedMinutes = inMin !== null && outMin !== null && outMin >= inMin ? outMin - inMin : null;

  let overtimeMinutes = 0;
  if (overtimeEnabled && outMin !== null && workedMinutes !== null && outMin > bounds.endMinutes) {
    const postShiftMinutes = outMin - bounds.endMinutes;
    const netExcessMinutes = Math.max(0, workedMinutes - bounds.scheduledDurationMinutes);
    const qualified = Math.min(postShiftMinutes, netExcessMinutes);
    if (qualified >= overtimeThreshold) {
      overtimeMinutes = qualified;
    }
  }

  let adherencePercent = 100;
  if (workedMinutes !== null) {
    adherencePercent = Math.min(
      100,
      Math.max(0, Math.round((workedMinutes / bounds.scheduledDurationMinutes) * 100))
    );
  } else if (lateMinutes > 0) {
    adherencePercent = Math.max(
      0,
      Math.round(((bounds.scheduledDurationMinutes - lateMinutes) / bounds.scheduledDurationMinutes) * 100)
    );
  }

  return {
    lateMinutes,
    earlyExitMinutes,
    overtimeMinutes,
    violationType,
    expectedStart: bounds.start,
    expectedEnd: bounds.end,
    scheduledDurationMinutes: bounds.scheduledDurationMinutes,
    workedMinutes,
    adherencePercent,
  };
}

export function getViolationPermitWindow(
  record: AttendanceRecord,
  config?: AttendanceSettings
): {
  exitTime: string;
  returnTime: string;
  reasonType: string;
} {
  const bounds = getShiftScheduleBounds(record.shiftMode, config);
  if (record.lateMinutes > 0 && record.earlyExitMinutes === 0) {
    return {
      exitTime: bounds.start,
      returnTime: record.checkInTime,
      reasonType: 'تبرير دخول متأخر',
    };
  }
  if (record.earlyExitMinutes > 0 && record.checkOutTime) {
    return {
      exitTime: record.checkOutTime,
      returnTime: bounds.end,
      reasonType: 'تبرير خروج مبكر',
    };
  }
  return {
    exitTime: bounds.start,
    returnTime: record.checkInTime || minutesToHHMM(bounds.startMinutes + 60),
    reasonType: 'تصحيح مخالفة دوام',
  };
}

export function resolveSyncedRectification(
  record: AttendanceRecord,
  exitPermissions: ExitPermission[],
  vacations: Vacation[]
): {
  status: RectificationStatus;
  linkedLabel?: string;
  linkedExitPermit?: ExitPermission;
  linkedLeave?: Vacation;
} {
  if (record.violationType === 'None') {
    return { status: 'None' };
  }

  if (record.rectificationId && record.rectificationType === 'exit_permit') {
    const linkedPermit = exitPermissions.find((p) => p.id === record.rectificationId);
    if (linkedPermit) {
      if (linkedPermit.status === 'Approved') {
        return { status: 'Resolved', linkedLabel: linkedPermit.reasonType, linkedExitPermit: linkedPermit };
      }
      if (linkedPermit.status === 'Rejected') {
        return { status: 'Rejected', linkedLabel: linkedPermit.reasonType, linkedExitPermit: linkedPermit };
      }
      return { status: 'Pending', linkedLabel: linkedPermit.reasonType, linkedExitPermit: linkedPermit };
    }
  }

  if (record.rectificationId && record.rectificationType === 'leave') {
    const linkedLeave = vacations.find((v) => v.id === record.rectificationId);
    if (linkedLeave) {
      if (linkedLeave.status === 'Approved') {
        return { status: 'Resolved', linkedLabel: linkedLeave.type, linkedLeave };
      }
      if (linkedLeave.status === 'Rejected') {
        return { status: 'Rejected', linkedLabel: linkedLeave.type, linkedLeave };
      }
      return { status: 'Pending', linkedLabel: linkedLeave.type, linkedLeave };
    }
  }

  return {
    status: record.regularizationStatus === 'None' ? 'Unresolved' : record.regularizationStatus,
  };
}

export interface AttendanceAggregateMetrics {
  total: number;
  openShifts: number;
  completedShifts: number;
  compliantCount: number;
  lateCount: number;
  earlyExitCount: number;
  violationsCount: number;
  overtimeShiftsCount: number;
  unrectifiedWarningsCount: number;
  pendingRectificationCount: number;
  resolvedRectificationCount: number;
  rejectedRectificationCount: number;
  compliancePercent: number;
  latePercent: number;
  earlyExitPercent: number;
  violationPercent: number;
  overtimePercentOfWorked: number;
  averageAdherencePercent: number;
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;
}

export function computeAttendanceMetrics(
  records: AttendanceRecord[],
  exitPermissions: ExitPermission[],
  vacations: Vacation[],
  config?: AttendanceSettings
): AttendanceAggregateMetrics {
  const total = records.length;
  let openShifts = 0;
  let completedShifts = 0;
  let compliantCount = 0;
  let lateCount = 0;
  let earlyExitCount = 0;
  let violationsCount = 0;
  let overtimeShiftsCount = 0;
  let unrectifiedWarningsCount = 0;
  let pendingRectificationCount = 0;
  let resolvedRectificationCount = 0;
  let rejectedRectificationCount = 0;
  let totalWorkedMinutes = 0;
  let totalOvertimeMinutes = 0;
  let adherenceSum = 0;

  records.forEach((rec) => {
    const evalRes = evaluateAttendanceEntry(rec.checkInTime, rec.checkOutTime, rec.shiftMode, config);
    const effectiveLate = evalRes.lateMinutes;
    const effectiveEarly = evalRes.earlyExitMinutes;
    const effectiveViolation = evalRes.violationType;
    const effectiveOvertime = rec.overtimeMinutes !== undefined ? rec.overtimeMinutes : evalRes.overtimeMinutes;

    if (!rec.checkOutTime) openShifts++;
    else completedShifts++;

    if (effectiveViolation === 'None') {
      compliantCount++;
    } else {
      violationsCount++;
      const synced = resolveSyncedRectification(rec, exitPermissions, vacations);
      if (synced.status === 'Pending') pendingRectificationCount++;
      else if (synced.status === 'Resolved') resolvedRectificationCount++;
      else if (synced.status === 'Rejected') {
        rejectedRectificationCount++;
        unrectifiedWarningsCount++;
      } else {
        unrectifiedWarningsCount++;
      }
    }

    if (effectiveLate > 0) lateCount++;
    if (effectiveEarly > 0) earlyExitCount++;
    if (effectiveOvertime > 0) {
      overtimeShiftsCount++;
      totalOvertimeMinutes += effectiveOvertime;
    }
    if (evalRes.workedMinutes !== null) {
      totalWorkedMinutes += evalRes.workedMinutes;
    }
    adherenceSum += evalRes.adherencePercent;
  });

  const compliancePercent = total > 0 ? Math.round((compliantCount / total) * 100) : 0;
  const latePercent = total > 0 ? Math.round((lateCount / total) * 100) : 0;
  const earlyExitPercent = total > 0 ? Math.round((earlyExitCount / total) * 100) : 0;
  const violationPercent = total > 0 ? Math.round((violationsCount / total) * 100) : 0;
  const overtimePercentOfWorked =
    totalWorkedMinutes > 0 ? Math.round((totalOvertimeMinutes / totalWorkedMinutes) * 100) : 0;
  const averageAdherencePercent = total > 0 ? Math.round(adherenceSum / total) : 0;

  return {
    total,
    openShifts,
    completedShifts,
    compliantCount,
    lateCount,
    earlyExitCount,
    violationsCount,
    overtimeShiftsCount,
    unrectifiedWarningsCount,
    pendingRectificationCount,
    resolvedRectificationCount,
    rejectedRectificationCount,
    compliancePercent,
    latePercent,
    earlyExitPercent,
    violationPercent,
    overtimePercentOfWorked,
    averageAdherencePercent,
    totalWorkedMinutes,
    totalOvertimeMinutes,
  };
}

export function formatAttendanceDuration(minutes: number, lang: Language): string {
  const safe = Math.max(0, Math.round(minutes));
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  if (lang === 'ar') {
    if (hrs > 0 && mins > 0) return `${hrs} س ${mins} د`;
    if (hrs > 0) return `${hrs} ساعة`;
    return `${mins} دقيقة`;
  }
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

export interface DetectedAbsenceCandidate {
  employee: Employee;
  date: string;
}

export function detectMissingAttendanceCandidates(
  employees: Employee[],
  attendanceRecords: AttendanceRecord[],
  vacations: Vacation[],
  absenceRecords: AbsenceRecord[],
  settings: SystemSettings,
  lookbackDays: number = 10
): DetectedAbsenceCandidate[] {
  const today = getTodayStr();
  const workWeekDays = settings.workWeekDays || [1, 2, 3, 4];
  const holidays = settings.officialHolidays || [];

  const checkDates: string[] = [];
  for (let offset = 1; offset <= lookbackDays; offset++) {
    const candidateDate = addDaysToStr(today, -offset);
    if (candidateDate >= today) continue;
    const parsed = parseLocalDate(candidateDate);
    if (!parsed) continue;
    if (!workWeekDays.includes(parsed.getDay())) continue;
    if (isOfficialHoliday(candidateDate, holidays)) continue;
    checkDates.push(candidateDate);
  }

  const eligibleEmployees = employees.filter(
    (emp) => (emp.status === 'Active' || emp.status === 'On Leave') && !emp.biometricExempt
  );

  const candidates: DetectedAbsenceCandidate[] = [];

  for (const dateStr of checkDates) {
    for (const emp of eligibleEmployees) {
      if (emp.hireDate && dateStr < emp.hireDate) continue;

      const hasAttendance = attendanceRecords.some(
        (r) => r.employeeId === emp.id && r.date === dateStr
      );
      if (hasAttendance) continue;

      const hasLeave = vacations.some(
        (v) =>
          v.employeeId === emp.id &&
          v.status !== 'Rejected' &&
          dateStr >= v.startDate &&
          dateStr <= v.endDate
      );
      if (hasLeave) continue;

      const hasAbsence = absenceRecords.some(
        (a) => a.employeeId === emp.id && a.date === dateStr
      );
      if (hasAbsence) continue;

      candidates.push({ employee: emp, date: dateStr });
    }
  }

  return candidates;
}

export interface AbsenceAggregateMetrics {
  total: number;
  openCount: number;
  excusedCount: number;
  deductedCount: number;
  convertedCount: number;
  unexcusedCount: number;
}

export function computeAbsenceMetrics(absences: AbsenceRecord[]): AbsenceAggregateMetrics {
  let openCount = 0;
  let excusedCount = 0;
  let deductedCount = 0;
  let convertedCount = 0;
  let unexcusedCount = 0;

  absences.forEach((a) => {
    if (a.status === 'Open') openCount++;
    else if (a.status === 'Excused') excusedCount++;
    else if (a.status === 'Deducted') deductedCount++;
    else if (a.status === 'ConvertedToLeave') convertedCount++;

    if (a.absenceType === 'Unexcused' || a.absenceType === 'NoCheckIn') {
      unexcusedCount++;
    }
  });

  return {
    total: absences.length,
    openCount,
    excusedCount,
    deductedCount,
    convertedCount,
    unexcusedCount,
  };
}

export const FALLBACK_DEFAULT_CENTER = { lat: 32.895, lng: 13.18 };

export function calculateHaversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatDistanceLabel(meters: number, lang: Language): string {
  const safe = Math.max(0, Math.round(meters));
  if (safe >= 1000) {
    const km = (safe / 1000).toFixed(safe >= 10000 ? 1 : 2);
    return lang === 'ar' ? `${km} كم` : `${km} km`;
  }
  return lang === 'ar' ? `${safe} م` : `${safe} m`;
}

const KNOWN_SITE_PRESET_COORDS: Array<{ keywords: string[]; lat: number; lng: number; radiusMeters: number; defaultGate?: string }> = [
  { keywords: ['لبدة', 'leptis'], lat: 32.6392, lng: 14.2906, radiusMeters: 400, defaultGate: 'بوابة موقع لبدة الأثري' },
  { keywords: ['ديوان', 'طرابلس', 'tripoli', 'hq'], lat: 32.895, lng: 13.18, radiusMeters: 250, defaultGate: 'البوابة الرئيسية - طرابلس' },
  { keywords: ['صبراتة', 'sabratha'], lat: 32.8054, lng: 12.4852, radiusMeters: 350, defaultGate: 'بوابة متحف صبراتة' },
  { keywords: ['السرايا', 'saraya'], lat: 32.8957, lng: 13.1806, radiusMeters: 200, defaultGate: 'البوابة الرئيسية - طرابلس' },
  { keywords: ['شحات', 'قورينا', 'cyrene'], lat: 32.818, lng: 21.8555, radiusMeters: 400, defaultGate: 'بوابة موقع قورينا الأثري' },
  { keywords: ['بني وليد', 'bani walid'], lat: 31.7615, lng: 13.9942, radiusMeters: 300, defaultGate: 'جهاز البصمة - ديوان المصلحة' },
];

export function getEffectiveWorkSiteLocations(config?: AttendanceSettings): WorkSiteLocation[] {
  const configuredMap = new Map<string, WorkSiteLocation>();
  (config?.workSiteLocations || []).forEach((loc) => {
    configuredMap.set(loc.name.trim(), loc);
  });

  const defaultRadius = Math.max(50, config?.defaultGeofenceRadiusMeters ?? 250);
  const siteNames = config?.approvedWorkSites || [];
  const merged: WorkSiteLocation[] = [];

  siteNames.forEach((rawName, idx) => {
    const clean = rawName.trim();
    if (!clean) return;
    const existing = configuredMap.get(clean);
    if (existing) {
      merged.push(existing);
      configuredMap.delete(clean);
      return;
    }
    const lower = clean.toLowerCase();
    const preset = KNOWN_SITE_PRESET_COORDS.find((p) => p.keywords.some((kw) => lower.includes(kw)));
    merged.push({
      id: `ws-auto-${idx}-${clean.slice(0, 8)}`,
      name: clean,
      lat: preset ? preset.lat : FALLBACK_DEFAULT_CENTER.lat + idx * 0.002,
      lng: preset ? preset.lng : FALLBACK_DEFAULT_CENTER.lng + idx * 0.002,
      radiusMeters: preset ? preset.radiusMeters : defaultRadius,
      defaultGate: preset?.defaultGate || config?.approvedGates?.[0] || 'البوابة الرئيسية',
    });
  });

  // Also include any orphaned custom site entries if present
  configuredMap.forEach((loc) => merged.push(loc));
  return merged;
}

export interface NearestWorkSiteMatch {
  site: WorkSiteLocation;
  distanceMeters: number;
  isInsideGeofence: boolean;
}

export function resolveNearestWorkSite(
  lat: number,
  lng: number,
  sites: WorkSiteLocation[],
  accuracyMeters?: number
): NearestWorkSiteMatch | null {
  if (!sites.length) return null;
  const jitterAllowance =
    accuracyMeters !== undefined && accuracyMeters > 0 && accuracyMeters <= 250
      ? Math.min(60, Math.round(accuracyMeters * 0.4))
      : 0;

  let best: NearestWorkSiteMatch | null = null;
  for (const site of sites) {
    const dist = calculateHaversineDistanceMeters(lat, lng, site.lat, site.lng);
    const inside = dist <= Math.max(25, site.radiusMeters) + jitterAllowance;
    if (!best) {
      best = { site, distanceMeters: dist, isInsideGeofence: inside };
    } else if (inside && !best.isInsideGeofence) {
      best = { site, distanceMeters: dist, isInsideGeofence: true };
    } else if (inside === best.isInsideGeofence && dist < best.distanceMeters) {
      best = { site, distanceMeters: dist, isInsideGeofence: inside };
    }
  }
  return best;
}

export function computeAttendanceIntegrityDigest(payload: {
  employeeId: string;
  userId?: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  lat?: number;
  lng?: number;
}): string {
  const canonical = [
    payload.employeeId,
    payload.userId || 'anon',
    payload.date,
    payload.checkInTime,
    payload.checkOutTime || '',
    payload.lat !== undefined ? payload.lat.toFixed(5) : 'no-lat',
    payload.lng !== undefined ? payload.lng.toFixed(5) : 'no-lng',
  ].join('|');

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((i + 1) << 3);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).toUpperCase().padStart(4, '0').slice(-4);
  const part2 = (h2 >>> 0).toString(16).toUpperCase().padStart(4, '0').slice(-4);
  return `SEC-${part1}${part2}`;
}


