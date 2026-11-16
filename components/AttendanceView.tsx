import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Crosshair,
  DoorOpen,
  Download,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  X,
} from 'lucide-react';
import {
  AppUser,
  AttendanceRecord,
  DepartmentUnit,
  Employee,
  ExitPermission,
  GeofenceStatus,
  Language,
  ShiftMode,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
  generateId,
} from '../types';
import { t, translateVacationType } from '../i18n';
import { NotificationEmitPayload } from './RequestsHub';
import {
  computeAttendanceIntegrityDigest,
  computeAttendanceMetrics,
  evaluateAttendanceEntry,
  formatAttendanceDuration,
  formatDistanceLabel,
  getCurrentTimeHHMM,
  getEffectiveWorkSiteLocations,
  getShiftScheduleBounds,
  getViolationPermitWindow,
  parseTimeToMinutes,
  resolveNearestWorkSite,
  resolveSyncedRectification,
} from '../utils/attendanceCalculations';
import {
  MONTHLY_EXIT_LIMIT_MINUTES,
  calculateWorkDaysBreakdown,
  evaluateSubstituteLeavePolicy,
  formatMinutesLabel,
  formatReadableDate,
  getEmployeeLeaveSummary,
  getEmployeeMonthlyExitUsage,
  getTodayStr,
} from '../utils/leaveCalculations';
import { computeTimeDiffMinutes } from './QuickRequestModal';
import { AvatarWithFallback } from './UIPrimitives';
import InteractiveGeoMap from './InteractiveGeoMap';
import {
  acquireSmartLocation,
  GeoLocationSource,
  SmartLocationDiagnostic,
} from '../utils/geolocation';
import { getVividCardClass } from '../utils/cardColors';

interface AttendanceViewProps {
  attendanceRecords: AttendanceRecord[];
  setAttendanceRecords: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  employees: Employee[];
  orgUnits: DepartmentUnit[];
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  exitPermissions: ExitPermission[];
  setExitPermissions: React.Dispatch<React.SetStateAction<ExitPermission[]>>;
  substituteExceptions?: SubstituteExceptionRequest[];
  onSubmitSubstituteException?: (req: SubstituteExceptionRequest) => void;
  onMarkExceptionConsumed?: (exceptionId: string, vacationId: string) => void;
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  onLogAudit: (
    action: string,
    details: string,
    category: 'attendance' | 'vacation' | 'request',
    targetEmployeeId?: string
  ) => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: NotificationEmitPayload) => void;
  onNavigateToViolations?: () => void;
  embedded?: boolean;
  forcePersonalScope?: boolean;
  forcedEmployeeId?: string;
}

const EXIT_REASON_OPTIONS = [
  'تبرير دخول متأخر',
  'تبرير خروج مبكر',
  'مهمة عمل ميدانية',
  'مراجعة صحية طارئة',
  'ظرف شخصي طارئ',
  'تصحيح مخالفة دوام',
];

const AttendanceView: React.FC<AttendanceViewProps> = ({
  attendanceRecords,
  setAttendanceRecords,
  employees,
  orgUnits,
  vacations,
  setVacations,
  exitPermissions,
  setExitPermissions,
  substituteExceptions = [],
  onSubmitSubstituteException,
  onMarkExceptionConsumed,
  settings,
  lang,
  currentUser,
  onLogAudit,
  onToast,
  onNotify,
  onNavigateToViolations,
  embedded = false,
  forcePersonalScope = false,
  forcedEmployeeId,
}) => {
  const attCfg = settings.attendanceConfig;
  const stdBounds = getShiftScheduleBounds('standard', attCfg);
  const flexBounds = getShiftScheduleBounds('flexible', attCfg);
  const flexibleEnabled = attCfg ? attCfg.flexibleEnabled : true;
  const requireLocation = attCfg ? attCfg.requireLocationOnCheck : true;
  const allowPermitRect = attCfg ? attCfg.allowPermitRectification : true;
  const allowLeaveRect = attCfg ? attCfg.allowLeaveRectification : true;

  const canManageAttendance =
    !forcePersonalScope &&
    currentUser?.role !== 'Employee' &&
    Boolean(currentUser?.permissions.includes('manage_attendance'));
  const canManageViolations =
    !forcePersonalScope && Boolean(currentUser?.permissions.includes('manage_violations'));
  const canExportExcel =
    currentUser?.role === 'SuperAdmin' || Boolean(currentUser?.permissions.includes('export_excel'));

  // Resolve employee linked to the current user (required for Employee scope and helpful default for self check-in)
  const linkedEmployee = useMemo(() => {
    if (forcedEmployeeId) {
      const explicit = employees.find((e) => e.id === forcedEmployeeId);
      if (explicit) return explicit;
    }
    if (!currentUser) return undefined;
    if (currentUser.linkedEmployeeId) {
      const byId = employees.find((e) => e.id === currentUser.linkedEmployeeId);
      if (byId) return byId;
    }
    const cleanName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
    const byMatch = employees.find(
      (e) =>
        (e.email && e.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()) ||
        e.fullName.trim().toLowerCase() === cleanName
    );
    return byMatch || (currentUser.role === 'Employee' || forcePersonalScope ? employees[0] : undefined);
  }, [currentUser, employees, forcedEmployeeId, forcePersonalScope]);

  const initialEmp = linkedEmployee || employees[0];

  // Clock-In / Clock-Out Composer State
  const [selectedEmpId, setSelectedEmpId] = useState<string>(initialEmp?.id || '');
  const effectiveEmpId =
    forcePersonalScope || (!canManageAttendance && linkedEmployee)
      ? forcedEmployeeId || linkedEmployee?.id || initialEmp?.id || ''
      : selectedEmpId || initialEmp?.id || '';
  const selectedEmployee = employees.find((e) => e.id === effectiveEmpId) || initialEmp;

  const [entryDate, setEntryDate] = useState<string>(getTodayStr());
  const [shiftMode, setShiftMode] = useState<ShiftMode>(
    initialEmp?.defaultShiftMode === 'flexible' && flexibleEnabled ? 'flexible' : 'standard'
  );
  const [checkInTime, setCheckInTime] = useState<string>(getCurrentTimeHHMM());
  const [checkOutTime, setCheckOutTime] = useState<string>('');
  const [workSite, setWorkSite] = useState<string>(initialEmp?.location || 'ديوان المصلحة - طرابلس');
  const [entryNotes, setEntryNotes] = useState<string>('');
  const [formError, setFormError] = useState<string>('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'violations' | 'compliant' | 'unresolved' | 'open' | 'overtime'
  >('all');
  const ledgerSectionRef = useRef<HTMLDivElement | null>(null);

  // Open-shift Check-Out Modal
  const [checkoutTarget, setCheckoutTarget] = useState<AttendanceRecord | null>(null);
  const [checkoutTimeInput, setCheckoutTimeInput] = useState<string>(getCurrentTimeHHMM());
  const [checkoutNotesInput, setCheckoutNotesInput] = useState<string>('');
  const [checkoutError, setCheckoutError] = useState<string>('');

  // Violation Rectification Modal
  const [rectifyTarget, setRectifyTarget] = useState<AttendanceRecord | null>(null);
  const [rectifyTab, setRectifyTab] = useState<'exit_permit' | 'leave'>('exit_permit');
  const [rectifyError, setRectifyError] = useState<string>('');

  // Rectification -> Exit Permit fields
  const [permitExitTime, setPermitExitTime] = useState('07:00');
  const [permitReturnTime, setPermitReturnTime] = useState('07:45');
  const [permitReasonType, setPermitReasonType] = useState('تبرير دخول متأخر');
  const [permitNotes, setPermitNotes] = useState('');

  // Rectification -> Leave fields
  const [leaveStartDate, setLeaveStartDate] = useState(getTodayStr());
  const [leaveEndDate, setLeaveEndDate] = useState(getTodayStr());
  const [leaveType, setLeaveType] = useState('Annual');
  const [leaveSubstitute, setLeaveSubstitute] = useState('');
  const [leaveNotes, setLeaveNotes] = useState('');
  const [requestSubException, setRequestSubException] = useState(false);
  const [subExceptionReason, setSubExceptionReason] = useState('');

  const isSelectedEmployeeExempt = Boolean(selectedEmployee?.biometricExempt);

  // Protected Auto-Mode State (for Regular User / Employee scope)
  const enforceGeofence = attCfg ? attCfg.enforceGeofenceForEmployees ?? true : true;
  const effectiveWorkSites = useMemo(() => getEffectiveWorkSiteLocations(attCfg), [attCfg]);
  const [serverOffsetMs, setServerOffsetMs] = useState<number>(0);
  const [serverClockSynced, setServerClockSynced] = useState<boolean>(false);
  const [trustedNowMs, setTrustedNowMs] = useState<number>(() => Date.now());
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'detecting' | 'ready' | 'error'>('idle');
  const [gpsPosition, setGpsPosition] = useState<{
    lat: number;
    lng: number;
    accuracyMeters?: number;
    source?: GeoLocationSource;
    cityLabel?: string;
  } | null>(null);
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string>('');
  const [gpsDiagnostic, setGpsDiagnostic] = useState<SmartLocationDiagnostic | null>(null);
  const cancelGpsRef = useRef<(() => void) | null>(null);
  const [autoNotes, setAutoNotes] = useState<string>('');
  const [autoActionError, setAutoActionError] = useState<string>('');
  const [inspectMapRecord, setInspectMapRecord] = useState<AttendanceRecord | null>(null);

  // Sync trusted server clock for protected employee timestamps
  useEffect(() => {
    if (canManageAttendance) return;
    let active = true;
    const syncClock = async () => {
      try {
        const res = await fetch('/api/attendance/server-clock', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { epochMs?: number };
        if (active && typeof data.epochMs === 'number' && !isNaN(data.epochMs)) {
          const offset = data.epochMs - Date.now();
          setServerOffsetMs(offset);
          setTrustedNowMs(Date.now() + offset);
          setServerClockSynced(true);
        }
      } catch {
        // Fallback to local clock offset = 0
      }
    };
    syncClock();
    const resyncTimer = window.setInterval(syncClock, 60000);
    return () => {
      active = false;
      window.clearInterval(resyncTimer);
    };
  }, [canManageAttendance]);

  // 1-second live ticking clock driven by trusted server offset
  useEffect(() => {
    if (canManageAttendance) return;
    const tick = window.setInterval(() => {
      setTrustedNowMs(Date.now() + serverOffsetMs);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [canManageAttendance, serverOffsetMs]);

  const trustedDateObj = useMemo(() => new Date(trustedNowMs), [trustedNowMs]);
  const autoDateStr = useMemo(() => {
    const y = trustedDateObj.getFullYear();
    const m = String(trustedDateObj.getMonth() + 1).padStart(2, '0');
    const d = String(trustedDateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [trustedDateObj]);
  const autoTimeHHMM = useMemo(() => {
    const h = String(trustedDateObj.getHours()).padStart(2, '0');
    const m = String(trustedDateObj.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }, [trustedDateObj]);
  const autoTimeHHMMSS = useMemo(() => {
    const h = String(trustedDateObj.getHours()).padStart(2, '0');
    const m = String(trustedDateObj.getMinutes()).padStart(2, '0');
    const s = String(trustedDateObj.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }, [trustedDateObj]);

  const acquireGpsLocation = useCallback(() => {
    setAutoActionError('');
    setGpsDiagnostic(null);
    setGpsErrorMsg('');
    setGpsStatus('detecting');
    cancelGpsRef.current?.();

    let receivedPin = false;
    let receivedNative = false;

    cancelGpsRef.current = acquireSmartLocation({
      lang,
      onFix: (fix) => {
        receivedPin = true;
        if (fix.source !== 'ip-fallback') {
          receivedNative = true;
          setGpsDiagnostic(null);
          setGpsErrorMsg('');
        }
        setGpsPosition((prev) => {
          // Do not overwrite an already locked native GPS/Wi-Fi pin with coarse IP fallback
          if (
            fix.source === 'ip-fallback' &&
            prev &&
            prev.source &&
            prev.source !== 'ip-fallback'
          ) {
            return prev;
          }
          return {
            lat: fix.lat,
            lng: fix.lng,
            accuracyMeters: fix.accuracyMeters,
            source: fix.source,
            cityLabel: fix.cityLabel,
          };
        });
        setGpsStatus('ready');
      },
      onDiagnostic: (diag) => {
        if (receivedNative) return;
        setGpsDiagnostic(diag);
        setGpsErrorMsg(lang === 'ar' ? diag.messageAr : diag.messageEn);
        if (!receivedPin) {
          setGpsStatus('error');
        }
      },
      onComplete: () => {
        setGpsStatus((curr) => (curr === 'detecting' ? (receivedPin ? 'ready' : 'error') : curr));
      },
    });
  }, [lang]);

  // Automatically lock employee GPS on mount and auto-retry when browser Location permission is granted
  useEffect(() => {
    if (canManageAttendance) return;
    acquireGpsLocation();

    let mounted = true;
    let permStatusObj: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (mounted && permStatusObj?.state === 'granted') {
        acquireGpsLocation();
      }
    };

    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          if (!mounted) return;
          permStatusObj = status;
          status.addEventListener('change', handlePermChange);
        })
        .catch(() => {
          // Ignore browsers without Permissions API support
        });
    }

    return () => {
      mounted = false;
      cancelGpsRef.current?.();
      if (permStatusObj) {
        permStatusObj.removeEventListener('change', handlePermChange);
      }
    };
  }, [canManageAttendance, acquireGpsLocation]);

  const primaryAssignedSite = useMemo(() => {
    if (!selectedEmployee) return effectiveWorkSites[0] || null;
    if (selectedEmployee.assignedWorkSiteId) {
      const byId = effectiveWorkSites.find((s) => s.id === selectedEmployee.assignedWorkSiteId);
      if (byId) return byId;
    }
    const empLoc = selectedEmployee.location?.trim().toLowerCase();
    if (empLoc) {
      const byName = effectiveWorkSites.find((s) => s.name.trim().toLowerCase() === empLoc);
      if (byName) return byName;
    }
    return effectiveWorkSites[0] || null;
  }, [selectedEmployee, effectiveWorkSites]);

  const employeeAuthorizedSites = useMemo(() => {
    const applyOverride = (site: typeof effectiveWorkSites[number]) =>
      selectedEmployee?.geofenceRadiusOverrideMeters &&
      selectedEmployee.geofenceRadiusOverrideMeters >= 25
        ? { ...site, radiusMeters: selectedEmployee.geofenceRadiusOverrideMeters }
        : site;

    if (!selectedEmployee) {
      return effectiveWorkSites.map(applyOverride);
    }

    const chosen: typeof effectiveWorkSites = [];
    const seenIds = new Set<string>();

    if (selectedEmployee.assignedWorkSiteId) {
      const byId = effectiveWorkSites.find((s) => s.id === selectedEmployee.assignedWorkSiteId);
      if (byId && !seenIds.has(byId.id)) {
        seenIds.add(byId.id);
        chosen.push(applyOverride(byId));
      }
    }
    const empLoc = selectedEmployee.location?.trim().toLowerCase();
    if (empLoc) {
      const byName = effectiveWorkSites.find((s) => s.name.trim().toLowerCase() === empLoc);
      if (byName && !seenIds.has(byName.id)) {
        seenIds.add(byName.id);
        chosen.push(applyOverride(byName));
      }
    }
    (selectedEmployee.allowedWorkSites || []).forEach((siteName) => {
      const clean = siteName.trim().toLowerCase();
      const match = effectiveWorkSites.find((s) => s.name.trim().toLowerCase() === clean);
      if (match && !seenIds.has(match.id)) {
        seenIds.add(match.id);
        chosen.push(applyOverride(match));
      }
    });

    if (chosen.length > 0) return chosen;
    return effectiveWorkSites.map(applyOverride);
  }, [selectedEmployee, effectiveWorkSites]);

  // Keep shiftMode and default workSite synced when the employee or their attendance config changes
  useEffect(() => {
    if (!selectedEmployee) return;
    setShiftMode(
      selectedEmployee.defaultShiftMode === 'flexible' && flexibleEnabled ? 'flexible' : 'standard'
    );
    if (selectedEmployee.location) {
      setWorkSite(selectedEmployee.location);
    }
  }, [
    selectedEmployee?.id,
    selectedEmployee?.defaultShiftMode,
    selectedEmployee?.location,
    flexibleEnabled,
  ]);

  const nearestMatch = useMemo(() => {
    if (!gpsPosition) return null;
    return resolveNearestWorkSite(
      gpsPosition.lat,
      gpsPosition.lng,
      employeeAuthorizedSites,
      gpsPosition.accuracyMeters
    );
  }, [gpsPosition, employeeAuthorizedSites]);

  const fallbackEmployeeSite = useMemo(() => {
    if (primaryAssignedSite) {
      return selectedEmployee?.geofenceRadiusOverrideMeters &&
        selectedEmployee.geofenceRadiusOverrideMeters >= 25
        ? { ...primaryAssignedSite, radiusMeters: selectedEmployee.geofenceRadiusOverrideMeters }
        : primaryAssignedSite;
    }
    return employeeAuthorizedSites[0] || null;
  }, [primaryAssignedSite, selectedEmployee?.geofenceRadiusOverrideMeters, employeeAuthorizedSites]);

  const resolvedAutoSite = nearestMatch?.site || fallbackEmployeeSite;
  const resolvedAutoWorkSite =
    resolvedAutoSite?.name || selectedEmployee?.location || attCfg?.approvedWorkSites?.[0] || 'ديوان المصلحة - طرابلس';

  // Detect active or already-completed shift for the authenticated employee today
  const todaysEmployeeRecords = useMemo(() => {
    if (!selectedEmployee) return [];
    return attendanceRecords.filter((r) => r.employeeId === selectedEmployee.id && r.date === autoDateStr);
  }, [attendanceRecords, selectedEmployee, autoDateStr]);

  const openShiftToday = useMemo(
    () => todaysEmployeeRecords.find((r) => !r.checkOutTime) || null,
    [todaysEmployeeRecords]
  );

  const completedShiftToday = useMemo(
    () => todaysEmployeeRecords.find((r) => Boolean(r.checkOutTime)) || null,
    [todaysEmployeeRecords]
  );

  // Known work sites & gates datalists (settings + roster)
  const workSiteOptions = useMemo(() => {
    const sites = new Set<string>(attCfg?.approvedWorkSites || []);
    employees.forEach((e) => {
      if (e.location?.trim()) sites.add(e.location.trim());
    });
    orgUnits.forEach((u) => {
      if (u.location?.trim()) sites.add(u.location.trim());
    });
    return Array.from(sites);
  }, [attCfg?.approvedWorkSites, employees, orgUnits]);

  // Update suggested workSite & defaultShiftMode when switching employee in composer (Supervisor only)
  const handleSelectComposerEmployee = (nextId: string) => {
    setSelectedEmpId(nextId);
    const emp = employees.find((e) => e.id === nextId);
    if (emp) {
      setWorkSite(emp.location || '');
      setShiftMode(emp.defaultShiftMode === 'flexible' && flexibleEnabled ? 'flexible' : 'standard');
    }
  };

  // Live preview of entry evaluation (Supervisor uses manual fields, Employee uses locked system clock)
  const effectiveShiftMode: ShiftMode = openShiftToday
    ? openShiftToday.shiftMode
    : flexibleEnabled
    ? shiftMode
    : 'standard';

  const liveEval = useMemo(
    () =>
      evaluateAttendanceEntry(
        canManageAttendance ? checkInTime : openShiftToday ? openShiftToday.checkInTime : autoTimeHHMM,
        canManageAttendance ? checkOutTime.trim() || undefined : openShiftToday ? autoTimeHHMM : undefined,
        canManageAttendance ? (flexibleEnabled ? shiftMode : 'standard') : effectiveShiftMode,
        attCfg
      ),
    [
      canManageAttendance,
      checkInTime,
      checkOutTime,
      openShiftToday,
      autoTimeHHMM,
      flexibleEnabled,
      shiftMode,
      effectiveShiftMode,
      attCfg,
    ]
  );

  // Scoped visibility: regular Employee or personal My Requests tab sees only personal attendance records
  const visibleRecords = useMemo(() => {
    const base = canManageAttendance
      ? attendanceRecords
      : effectiveEmpId
      ? attendanceRecords.filter((r) => r.employeeId === effectiveEmpId)
      : [];
    return [...base].sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return b.checkInTime.localeCompare(a.checkInTime);
    });
  }, [attendanceRecords, canManageAttendance, effectiveEmpId]);

  // Enrich with live synced rectification status from ExitPermission / Vacation lists
  const enrichedRecords = useMemo(
    () =>
      visibleRecords.map((rec) => {
        const synced = resolveSyncedRectification(rec, exitPermissions, vacations);
        const evalRes = evaluateAttendanceEntry(rec.checkInTime, rec.checkOutTime, rec.shiftMode, attCfg);
        const effectiveOvertime = rec.overtimeMinutes !== undefined ? rec.overtimeMinutes : evalRes.overtimeMinutes;
        return {
          ...rec,
          effectiveRectification: synced,
          evalRes,
          effectiveOvertime,
        };
      }),
    [visibleRecords, exitPermissions, vacations, attCfg]
  );

  const metrics = useMemo(
    () => computeAttendanceMetrics(visibleRecords, exitPermissions, vacations, attCfg),
    [visibleRecords, exitPermissions, vacations, attCfg]
  );

  const alertRecords = useMemo(
    () =>
      enrichedRecords.filter(
        (r) =>
          r.evalRes.violationType !== 'None' &&
          (r.effectiveRectification.status === 'Unresolved' || r.effectiveRectification.status === 'Rejected')
      ),
    [enrichedRecords]
  );

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedRecords.filter((r) => {
      if (dateFilter && r.date !== dateFilter) return false;
      if (statusFilter === 'violations' && r.evalRes.violationType === 'None') return false;
      if (statusFilter === 'compliant' && r.evalRes.violationType !== 'None') return false;
      if (
        statusFilter === 'unresolved' &&
        (r.evalRes.violationType === 'None' ||
          (r.effectiveRectification.status !== 'Unresolved' && r.effectiveRectification.status !== 'Rejected'))
      ) {
        return false;
      }
      if (statusFilter === 'open' && Boolean(r.checkOutTime)) return false;
      if (statusFilter === 'overtime' && r.effectiveOvertime <= 0) return false;

      if (!q) return true;
      return (
        r.employeeName.toLowerCase().includes(q) ||
        r.workSite.toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    });
  }, [enrichedRecords, dateFilter, statusFilter, searchQuery]);

  const handleExportAttendance = () => {
    const exportRows = filteredRecords.map((rec) => {
      const emp = employees.find((e) => e.id === rec.employeeId);
      const statusText =
        rec.evalRes.violationType === 'None'
          ? rec.checkOutTime
            ? t(lang, 'compliantShiftTag')
            : t(lang, 'activeShiftBadge')
          : rec.effectiveRectification.status === 'Resolved'
          ? t(lang, 'rectificationStatusResolved')
          : rec.effectiveRectification.status === 'Pending'
          ? t(lang, 'rectificationStatusPending')
          : rec.effectiveRectification.status === 'Rejected'
          ? t(lang, 'rectificationStatusRejected')
          : t(lang, 'rectificationStatusUnresolved');

      return {
        [lang === 'ar' ? 'الموظف' : 'Employee']: rec.employeeName,
        [lang === 'ar' ? 'الرقم الإداري' : 'Admin ID']: emp?.adminId || '-',
        [lang === 'ar' ? 'الإدارة' : 'Department']: emp?.department || '-',
        [lang === 'ar' ? 'التاريخ' : 'Date']: rec.date,
        [lang === 'ar' ? 'نظام الدوام' : 'Shift Mode']:
          rec.shiftMode === 'flexible' ? t(lang, 'shiftFlexibleLabel') : t(lang, 'shiftStandardLabel'),
        [lang === 'ar' ? 'موقع العمل' : 'Work Site']: rec.workSite,
        [lang === 'ar' ? 'وقت الدخول' : 'Check-In']: rec.checkInTime,
        [lang === 'ar' ? 'بوابة/نقطة الدخول' : 'Entry Location']: rec.entryLocation,
        [lang === 'ar' ? 'وقت الخروج' : 'Check-Out']: rec.checkOutTime || '-',
        [lang === 'ar' ? 'بوابة/نقطة الخروج' : 'Exit Location']: rec.exitLocation || '-',
        [lang === 'ar' ? 'نسبة الالتزام' : 'Adherence %']: `${rec.evalRes.adherencePercent}%`,
        [lang === 'ar' ? 'دقائق التأخير' : 'Late Minutes']: rec.evalRes.lateMinutes,
        [lang === 'ar' ? 'دقائق الخروج المبكر' : 'Early Exit Minutes']: rec.evalRes.earlyExitMinutes,
        [lang === 'ar' ? 'الدقائق الإضافية' : 'Overtime Minutes']: rec.effectiveOvertime,
        [lang === 'ar' ? 'الحالة' : 'Status']: statusText,
        [lang === 'ar' ? 'ملاحظات' : 'Notes']: rec.notes || '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, `attendance_records_${getTodayStr()}.xlsx`);
    onToast(
      'success',
      lang === 'ar' ? 'تم تصدير كشف الحضور والانصراف إلى Excel بنجاح.' : 'Attendance sheet exported to Excel.'
    );
  };

  const emitAttendanceAlert = (rec: AttendanceRecord) => {
    if (!onNotify || rec.violationType === 'None') return;
    const isBoth = rec.lateMinutes > 0 && rec.earlyExitMinutes > 0;
    const isLate = rec.lateMinutes > 0;
    const titleAr = isBoth
      ? `تنبيه دخول متأخر وخروج مبكر: ${rec.employeeName}`
      : isLate
      ? `تنبيه دخول متأخر: ${rec.employeeName}`
      : `تنبيه خروج مبكر: ${rec.employeeName}`;
    const titleEn = isBoth
      ? `Late Entry & Early Exit Alert: ${rec.employeeName}`
      : isLate
      ? `Late Arrival Alert: ${rec.employeeName}`
      : `Early Departure Alert: ${rec.employeeName}`;

    const detailsArParts: string[] = [];
    const detailsEnParts: string[] = [];
    if (rec.lateMinutes > 0) {
      detailsArParts.push(`دخول الساعة ${rec.checkInTime} (تأخر ${formatAttendanceDuration(rec.lateMinutes, 'ar')})`);
      detailsEnParts.push(`Check-in ${rec.checkInTime} (${formatAttendanceDuration(rec.lateMinutes, 'en')} late)`);
    }
    if (rec.earlyExitMinutes > 0 && rec.checkOutTime) {
      detailsArParts.push(`خروج الساعة ${rec.checkOutTime} (انصراف مبكر ${formatAttendanceDuration(rec.earlyExitMinutes, 'ar')})`);
      detailsEnParts.push(`Check-out ${rec.checkOutTime} (${formatAttendanceDuration(rec.earlyExitMinutes, 'en')} early)`);
    }

    onNotify({
      type: 'status',
      titleAr,
      titleEn,
      messageAr: `${detailsArParts.join(' · ')} في ${rec.workSite}. يرجى التصحيح بطلب إذن أو إجازة.`,
      messageEn: `${detailsEnParts.join(' · ')} at ${rec.workSite}. Regularize with an exit permit or leave request.`,
      targetView: 'attendance',
    });
  };

  // Create Check-In (or full Check-In + Check-Out) record
  const handleRecordEntry = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedEmployee) {
      setFormError(lang === 'ar' ? 'يرجى تحديد الموظف.' : 'Please select an employee.');
      return;
    }
    if (!entryDate || !checkInTime) {
      setFormError(lang === 'ar' ? 'التاريخ ووقت الدخول مطلوبان.' : 'Date and check-in time are required.');
      return;
    }
    if (requireLocation && !workSite.trim()) {
      setFormError(
        lang === 'ar'
          ? 'يرجى تحديد موقع العمل.'
          : 'Work site is required.'
      );
      return;
    }

    const cleanOut = checkOutTime.trim() || undefined;
    if (cleanOut) {
      const inMin = parseTimeToMinutes(checkInTime);
      const outMin = parseTimeToMinutes(cleanOut);
      if (inMin !== null && outMin !== null && outMin < inMin) {
        setFormError(
          lang === 'ar'
            ? 'وقت الخروج لا يمكن أن يكون قبل وقت الدخول.'
            : 'Check-out time cannot be earlier than check-in time.'
        );
        return;
      }
    }

    const supShiftMode: ShiftMode = flexibleEnabled ? shiftMode : 'standard';
    const evaluation = evaluateAttendanceEntry(checkInTime, cleanOut, supShiftMode, attCfg);
    const hasViolation = evaluation.violationType !== 'None';
    const shouldWarn = hasViolation && (attCfg ? attCfg.autoWarnOnViolation : true);
    const integrityDigest = computeAttendanceIntegrityDigest({
      employeeId: selectedEmployee.id,
      userId: currentUser?.id,
      date: entryDate,
      checkInTime,
      checkOutTime: cleanOut,
    });

    const newRecord: AttendanceRecord = {
      id: generateId(),
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.fullName,
      date: entryDate,
      shiftMode: supShiftMode,
      checkInTime,
      checkOutTime: cleanOut,
      workSite: workSite.trim() || selectedEmployee.location || '-',
      entryLocation: workSite.trim() || selectedEmployee.location || '-',
      exitLocation: cleanOut ? (workSite.trim() || selectedEmployee.location || '-') : undefined,
      geofenceStatus: 'ManualAdmin',
      isAutoStamped: false,
      recordedByUserId: currentUser?.id,
      recordedByUserName: currentUser?.name,
      integrityDigest,
      lateMinutes: evaluation.lateMinutes,
      earlyExitMinutes: evaluation.earlyExitMinutes,
      overtimeMinutes: evaluation.overtimeMinutes,
      violationType: evaluation.violationType,
      regularizationStatus: hasViolation ? 'Unresolved' : 'None',
      warningIssued: shouldWarn,
      warningNote: shouldWarn
        ? lang === 'ar'
          ? `إنذار دوام تلقائي (${evaluation.lateMinutes > 0 ? `تأخير ${formatAttendanceDuration(evaluation.lateMinutes, 'ar')}` : ''}${
              evaluation.lateMinutes > 0 && evaluation.earlyExitMinutes > 0 ? ' · ' : ''
            }${evaluation.earlyExitMinutes > 0 ? `خروج مبكر ${formatAttendanceDuration(evaluation.earlyExitMinutes, 'ar')}` : ''})`
          : `Auto warning (${evaluation.lateMinutes}m late / ${evaluation.earlyExitMinutes}m early)`
        : undefined,
      notes: entryNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    setAttendanceRecords((prev) => [newRecord, ...prev]);

    onLogAudit(
      cleanOut
        ? lang === 'ar'
          ? 'تسجيل دخول وخروج'
          : 'Logged Check-In & Check-Out'
        : lang === 'ar'
        ? 'تسجيل دخول للدوام'
        : 'Logged Check-In',
      `${selectedEmployee.fullName} · ${newRecord.workSite} (${checkInTime}${
        cleanOut ? ` → ${cleanOut}` : ''
      })${evaluation.overtimeMinutes > 0 ? ` [+${evaluation.overtimeMinutes}m OT]` : ''}`,
      'attendance',
      selectedEmployee.id
    );

    if (hasViolation) {
      emitAttendanceAlert(newRecord);
      onToast(
        'warning',
        lang === 'ar'
          ? `تم تسجيل إنذار (${evaluation.lateMinutes > 0 ? 'دخول متأخر' : ''}${
              evaluation.lateMinutes > 0 && evaluation.earlyExitMinutes > 0 ? ' و' : ''
            }${evaluation.earlyExitMinutes > 0 ? 'خروج مبكر' : ''}). يمكن للموظف تصحيحه بطلب إذن أو إجازة.`
          : 'Violation warning issued (late arrival / early exit). Employee may rectify via permit or leave.'
      );
    } else {
      onToast(
        'success',
        evaluation.overtimeMinutes > 0
          ? lang === 'ar'
            ? `تم التوثيق بنجاح واحتساب ${formatAttendanceDuration(evaluation.overtimeMinutes, 'ar')} عملاً إضافياً.`
            : `Attendance saved with ${formatAttendanceDuration(evaluation.overtimeMinutes, 'en')} overtime.`
          : lang === 'ar'
          ? 'تم توثيق الحضور بنجاح والالتزام بجدول الدوام.'
          : 'Attendance recorded on schedule.'
      );
    }

    setEntryNotes('');
    setCheckOutTime('');
  };

  // Open Checkout Modal for an active open shift
  const openCheckoutModal = (record: AttendanceRecord) => {
    setCheckoutTarget(record);
    setCheckoutTimeInput(getCurrentTimeHHMM());
    setCheckoutNotesInput(record.notes || '');
    setCheckoutError('');
  };

  const handleConfirmCheckout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutTarget) return;
    setCheckoutError('');

    const inMin = parseTimeToMinutes(checkoutTarget.checkInTime);
    const outMin = parseTimeToMinutes(checkoutTimeInput);
    if (!checkoutTimeInput || outMin === null) {
      setCheckoutError(lang === 'ar' ? 'يرجى تحديد وقت خروج صحيح.' : 'Enter a valid check-out time.');
      return;
    }
    if (inMin !== null && outMin < inMin) {
      setCheckoutError(
        lang === 'ar'
          ? 'وقت الخروج لا يمكن أن يسبق وقت الدخول.'
          : 'Check-out time cannot be before check-in time.'
      );
      return;
    }

    const evaluation = evaluateAttendanceEntry(
      checkoutTarget.checkInTime,
      checkoutTimeInput,
      checkoutTarget.shiftMode,
      attCfg
    );
    const synced = resolveSyncedRectification(checkoutTarget, exitPermissions, vacations);
    const hasViolation = evaluation.violationType !== 'None';
    const shouldWarn = hasViolation && (attCfg ? attCfg.autoWarnOnViolation : true);
    const updatedDigest = computeAttendanceIntegrityDigest({
      employeeId: checkoutTarget.employeeId,
      userId: checkoutTarget.recordedByUserId || currentUser?.id,
      date: checkoutTarget.date,
      checkInTime: checkoutTarget.checkInTime,
      checkOutTime: checkoutTimeInput,
      lat: checkoutTarget.checkInLat,
      lng: checkoutTarget.checkInLng,
    });
    const updatedRecord: AttendanceRecord = {
      ...checkoutTarget,
      checkOutTime: checkoutTimeInput,
      exitLocation: checkoutTarget.workSite || checkoutTarget.entryLocation,
      integrityDigest: updatedDigest,
      lateMinutes: evaluation.lateMinutes,
      earlyExitMinutes: evaluation.earlyExitMinutes,
      overtimeMinutes: evaluation.overtimeMinutes,
      violationType: evaluation.violationType,
      regularizationStatus:
        !hasViolation
          ? 'None'
          : synced.status === 'Pending' || synced.status === 'Resolved'
          ? synced.status
          : 'Unresolved',
      warningIssued: shouldWarn || checkoutTarget.warningIssued,
      notes: checkoutNotesInput.trim() || undefined,
    };

    setAttendanceRecords((prev) => prev.map((r) => (r.id === checkoutTarget.id ? updatedRecord : r)));

    onLogAudit(
      lang === 'ar' ? 'تسجيل خروج من الدوام' : 'Recorded Check-Out',
      `${updatedRecord.employeeName} · ${updatedRecord.workSite} (${updatedRecord.checkOutTime})${
        evaluation.overtimeMinutes > 0 ? ` [+${evaluation.overtimeMinutes}m OT]` : ''
      }`,
      'attendance',
      updatedRecord.employeeId
    );

    if (evaluation.earlyExitMinutes > 0) {
      emitAttendanceAlert(updatedRecord);
      onToast(
        'warning',
        lang === 'ar'
          ? `تم تسجيل خروج مبكر قبل نهاية الدوام بـ ${formatAttendanceDuration(evaluation.earlyExitMinutes, 'ar')}.`
          : `Early departure logged (${formatAttendanceDuration(evaluation.earlyExitMinutes, 'en')} early).`
      );
    } else {
      onToast(
        'success',
        evaluation.overtimeMinutes > 0
          ? lang === 'ar'
            ? `تم تسجيل الخروج واحتساب ${formatAttendanceDuration(evaluation.overtimeMinutes, 'ar')} عملاً إضافياً.`
            : `Check-out logged with ${formatAttendanceDuration(evaluation.overtimeMinutes, 'en')} overtime.`
          : lang === 'ar'
          ? 'تم تسجيل الخروج بنجاح.'
          : 'Check-out recorded.'
      );
    }

    setCheckoutTarget(null);
  };

  // Protected Automatic Check-In / Check-Out handler (Employee / User self-service)
  const handleProtectedAutoAttendance = (explicitOpenTarget?: AttendanceRecord) => {
    setAutoActionError('');
    if (!selectedEmployee) {
      const msg =
        lang === 'ar' ? 'حسابك غير مرتبط بسجل موظف معتمد.' : 'Your account is not linked to an employee record.';
      setAutoActionError(msg);
      onToast('error', msg);
      return;
    }

    const activeShift = explicitOpenTarget || openShiftToday;
    if (!activeShift && completedShiftToday) {
      const msg = t(lang, 'duplicateShiftError');
      setAutoActionError(msg);
      onToast('error', msg);
      return;
    }

    // Validate live GPS location + geofence when protection is active (exempt employees bypass mandatory lock)
    if (enforceGeofence && !isSelectedEmployeeExempt) {
      if (!gpsPosition) {
        const msg = t(lang, 'gpsRequiredError');
        setAutoActionError(msg);
        onToast('error', msg);
        acquireGpsLocation();
        return;
      }
      if (gpsPosition.source === 'ip-fallback') {
        const msg =
          lang === 'ar'
            ? 'الحضور محمي: الموقع الظاهر حالياً تقريبي عبر الشبكة (IP). يرجى السماح بصلاحية الموقع الدقيق (GPS) في المتصفح ثم الضغط على «إعادة التقاط GPS».'
            : 'Protected Check-In blocked: only an approximate IP location is currently available. Allow Location permission in your browser and retry GPS.';
        setAutoActionError(msg);
        onToast('error', msg);
        return;
      }
      if (!nearestMatch || !nearestMatch.isInsideGeofence) {
        const distMsg = nearestMatch
          ? ` (${t(lang, 'distanceToOfficeLabel')}: ${formatDistanceLabel(
              nearestMatch.distanceMeters,
              lang
            )} / ${nearestMatch.site.radiusMeters}m)`
          : '';
        const msg = `${t(lang, 'geofenceBlockedError')}${distMsg}`;
        setAutoActionError(msg);
        onToast('error', msg);
        return;
      }
    }

    // Recompute trusted timestamp right at submission time
    const nowInstant = new Date(Date.now() + serverOffsetMs);
    const stampDate = `${nowInstant.getFullYear()}-${String(nowInstant.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(nowInstant.getDate()).padStart(2, '0')}`;
    const stampTimeHHMM = `${String(nowInstant.getHours()).padStart(2, '0')}:${String(
      nowInstant.getMinutes()
    ).padStart(2, '0')}`;

    const geoStatusForEvent: GeofenceStatus = isSelectedEmployeeExempt
      ? gpsPosition && gpsPosition.source !== 'ip-fallback' && nearestMatch?.isInsideGeofence
        ? 'VerifiedInside'
        : 'ManualAdmin'
      : !gpsPosition || gpsPosition.source === 'ip-fallback'
      ? 'LocationUnavailable'
      : nearestMatch?.isInsideGeofence
      ? 'VerifiedInside'
      : 'OutsideRange';

    if (activeShift) {
      // Automatic Check-Out on the open shift
      const inMin = parseTimeToMinutes(activeShift.checkInTime);
      const outMin = parseTimeToMinutes(stampTimeHHMM);
      if (activeShift.date === stampDate && inMin !== null && outMin !== null && outMin < inMin) {
        setAutoActionError(
          lang === 'ar' ? 'وقت الانصراف غير متزامن مع وقت الدخول.' : 'Clock synchronization error.'
        );
        return;
      }

      const evaluation = evaluateAttendanceEntry(
        activeShift.checkInTime,
        stampTimeHHMM,
        activeShift.shiftMode,
        attCfg
      );
      const synced = resolveSyncedRectification(activeShift, exitPermissions, vacations);
      const hasViolation = evaluation.violationType !== 'None';
      const shouldWarn = hasViolation && (attCfg ? attCfg.autoWarnOnViolation : true);

      const nextGeoStatus: GeofenceStatus = isSelectedEmployeeExempt
        ? geoStatusForEvent === 'VerifiedInside'
          ? 'VerifiedInside'
          : 'ManualAdmin'
        : activeShift.geofenceStatus === 'OutsideRange' || geoStatusForEvent === 'OutsideRange'
        ? 'OutsideRange'
        : geoStatusForEvent === 'VerifiedInside'
        ? 'VerifiedInside'
        : activeShift.geofenceStatus || 'LocationUnavailable';

      const digest = computeAttendanceIntegrityDigest({
        employeeId: selectedEmployee.id,
        userId: currentUser?.id,
        date: activeShift.date,
        checkInTime: activeShift.checkInTime,
        checkOutTime: stampTimeHHMM,
        lat: gpsPosition?.lat ?? activeShift.checkInLat,
        lng: gpsPosition?.lng ?? activeShift.checkInLng,
      });

      const updated: AttendanceRecord = {
        ...activeShift,
        checkOutTime: stampTimeHHMM,
        exitLocation: resolvedAutoWorkSite,
        checkOutLat: gpsPosition?.lat,
        checkOutLng: gpsPosition?.lng,
        checkOutAccuracyMeters: gpsPosition?.accuracyMeters,
        checkOutDistanceMeters: nearestMatch?.distanceMeters,
        geofenceStatus: nextGeoStatus,
        isAutoStamped: true,
        recordedByUserId: currentUser?.id,
        recordedByUserName: currentUser?.name,
        integrityDigest: digest,
        lateMinutes: evaluation.lateMinutes,
        earlyExitMinutes: evaluation.earlyExitMinutes,
        overtimeMinutes: evaluation.overtimeMinutes,
        violationType: evaluation.violationType,
        regularizationStatus: !hasViolation
          ? 'None'
          : synced.status === 'Pending' || synced.status === 'Resolved'
          ? synced.status
          : 'Unresolved',
        warningIssued: shouldWarn || activeShift.warningIssued,
        notes: autoNotes.trim() || activeShift.notes || undefined,
      };

      setAttendanceRecords((prev) => prev.map((r) => (r.id === activeShift.id ? updated : r)));

      onLogAudit(
        lang === 'ar' ? 'تسجيل انصراف آلي موثق (GPS)' : 'Protected Auto Check-Out (GPS)',
        `${selectedEmployee.fullName} · ${resolvedAutoWorkSite} (${stampTimeHHMM}) [${digest}]`,
        'attendance',
        selectedEmployee.id
      );

      if (evaluation.earlyExitMinutes > 0) {
        emitAttendanceAlert(updated);
        onToast(
          'warning',
          lang === 'ar'
            ? `تم تسجيل الانصراف الآلي الساعة ${stampTimeHHMM} (مبكر بـ ${formatAttendanceDuration(
                evaluation.earlyExitMinutes,
                'ar'
              )}).`
            : `Auto check-out logged at ${stampTimeHHMM} (${formatAttendanceDuration(
                evaluation.earlyExitMinutes,
                'en'
              )} early).`
        );
      } else {
        onToast(
          'success',
          lang === 'ar'
            ? `تم توثيق الانصراف الآلي بنجاح الساعة ${stampTimeHHMM} (${digest}).`
            : `Protected auto check-out stamped at ${stampTimeHHMM} (${digest}).`
        );
      }
      setAutoNotes('');
      return;
    }

    // Automatic Check-In for today
    const shiftToUse: ShiftMode = flexibleEnabled ? shiftMode : 'standard';
    const evaluation = evaluateAttendanceEntry(stampTimeHHMM, undefined, shiftToUse, attCfg);
    const hasViolation = evaluation.violationType !== 'None';
    const shouldWarn = hasViolation && (attCfg ? attCfg.autoWarnOnViolation : true);
    const digest = computeAttendanceIntegrityDigest({
      employeeId: selectedEmployee.id,
      userId: currentUser?.id,
      date: stampDate,
      checkInTime: stampTimeHHMM,
      lat: gpsPosition?.lat,
      lng: gpsPosition?.lng,
    });

    const newRecord: AttendanceRecord = {
      id: generateId(),
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.fullName,
      date: stampDate,
      shiftMode: shiftToUse,
      checkInTime: stampTimeHHMM,
      workSite: resolvedAutoWorkSite,
      entryLocation: resolvedAutoWorkSite,
      checkInLat: gpsPosition?.lat,
      checkInLng: gpsPosition?.lng,
      checkInAccuracyMeters: gpsPosition?.accuracyMeters,
      checkInDistanceMeters: nearestMatch?.distanceMeters,
      geofenceStatus: geoStatusForEvent,
      isAutoStamped: true,
      recordedByUserId: currentUser?.id,
      recordedByUserName: currentUser?.name,
      integrityDigest: digest,
      lateMinutes: evaluation.lateMinutes,
      earlyExitMinutes: 0,
      overtimeMinutes: 0,
      violationType: evaluation.violationType,
      regularizationStatus: hasViolation ? 'Unresolved' : 'None',
      warningIssued: shouldWarn,
      warningNote: shouldWarn
        ? lang === 'ar'
          ? `إنذار دخول متأخر تلقائي (${formatAttendanceDuration(evaluation.lateMinutes, 'ar')})`
          : `Auto late warning (${evaluation.lateMinutes}m late)`
        : undefined,
      notes: autoNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    setAttendanceRecords((prev) => [newRecord, ...prev]);
    onLogAudit(
      lang === 'ar' ? 'تسجيل حضور آلي موثق (GPS)' : 'Protected Auto Check-In (GPS)',
      `${selectedEmployee.fullName} · ${resolvedAutoWorkSite} (${stampTimeHHMM}) [${digest}]`,
      'attendance',
      selectedEmployee.id
    );

    if (hasViolation) {
      emitAttendanceAlert(newRecord);
      onToast(
        'warning',
        lang === 'ar'
          ? `تم تسجيل الدخول الآلي الساعة ${stampTimeHHMM} مع إنذار تأخير. يمكنك تصحيحه بطلب إذن أو إجازة.`
          : `Auto check-in logged at ${stampTimeHHMM} with late warning.`
      );
    } else {
      onToast(
        'success',
        lang === 'ar'
          ? `تم توثيق الحضور الآلي بنجاح الساعة ${stampTimeHHMM} في ${resolvedAutoWorkSite} (${digest}).`
          : `Protected check-in verified at ${stampTimeHHMM} in ${resolvedAutoWorkSite} (${digest}).`
      );
    }
    setAutoNotes('');
  };

  // Violation Rectification Logic (Employee Warning Self-Service)
  const openRectifyModal = (record: AttendanceRecord) => {
    const suggested = getViolationPermitWindow(record, attCfg);
    setRectifyTarget(record);
    setRectifyTab(allowPermitRect ? 'exit_permit' : 'leave');
    setRectifyError('');
    setPermitExitTime(suggested.exitTime);
    setPermitReturnTime(suggested.returnTime);
    setPermitReasonType(suggested.reasonType);
    setPermitNotes(
      lang === 'ar'
        ? `تصحيح مخالفة دوام بتاريخ ${record.date} في ${record.workSite}`
        : `Regularize attendance violation on ${record.date} at ${record.workSite}`
    );

    setLeaveStartDate(record.date);
    setLeaveEndDate(record.date);
    setLeaveType(settings.vacationTypes[0]?.name || 'Annual');
    setLeaveSubstitute('');
    setLeaveNotes(
      lang === 'ar'
        ? `طلب إجازة لتصحيح مخالفة ${record.lateMinutes > 0 ? 'دخول متأخر' : 'خروج مبكر'} بتاريخ ${record.date}`
        : `Leave request to regularize attendance entry on ${record.date}`
    );
    setRequestSubException(false);
    setSubExceptionReason('');
  };

  const rectifyEmployee = useMemo(
    () => (rectifyTarget ? employees.find((e) => e.id === rectifyTarget.employeeId) : undefined),
    [rectifyTarget, employees]
  );

  const rectifyPermitDuration = useMemo(
    () => computeTimeDiffMinutes(permitExitTime, permitReturnTime),
    [permitExitTime, permitReturnTime]
  );

  const rectifyMonthlyExitUsage = useMemo(() => {
    if (!rectifyTarget) return null;
    return getEmployeeMonthlyExitUsage(rectifyTarget.employeeId, rectifyTarget.date, exitPermissions);
  }, [rectifyTarget, exitPermissions]);

  const rectifyWorkDays = useMemo(
    () =>
      calculateWorkDaysBreakdown(leaveStartDate, leaveEndDate, settings.workWeekDays, settings.officialHolidays),
    [leaveStartDate, leaveEndDate, settings.workWeekDays, settings.officialHolidays]
  );

  const rectifyEffectiveLeaveDays = useMemo(() => {
    if (rectifyWorkDays.calendarDays > 0 && rectifyWorkDays.workDays === 0) {
      return rectifyWorkDays.calendarDays;
    }
    return rectifyWorkDays.workDays;
  }, [rectifyWorkDays]);

  const rectifyLeaveBalance = useMemo(() => {
    if (!rectifyEmployee) return null;
    const yr = Number(leaveStartDate.slice(0, 4)) || new Date().getFullYear();
    return getEmployeeLeaveSummary(rectifyEmployee, vacations, settings, yr);
  }, [rectifyEmployee, leaveStartDate, vacations, settings]);

  const rectifySubPolicy = useMemo(
    () =>
      evaluateSubstituteLeavePolicy(
        rectifyEmployee,
        leaveStartDate,
        leaveEndDate,
        rectifyEffectiveLeaveDays,
        vacations,
        settings,
        substituteExceptions
      ),
    [rectifyEmployee, leaveStartDate, leaveEndDate, rectifyEffectiveLeaveDays, vacations, settings, substituteExceptions]
  );

  const handleRectifySubmitPermit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rectifyTarget) return;
    setRectifyError('');

    if (rectifyPermitDuration <= 0) {
      setRectifyError(
        lang === 'ar'
          ? 'يجب أن يكون وقت العودة / نهاية المدة بعد وقت البداية.'
          : 'End time must be after start time.'
      );
      return;
    }
    if (
      rectifyMonthlyExitUsage &&
      rectifyMonthlyExitUsage.usedMinutes + rectifyPermitDuration > MONTHLY_EXIT_LIMIT_MINUTES
    ) {
      setRectifyError(t(lang, 'exitMonthlyExceededError'));
      return;
    }

    const newPermit: ExitPermission = {
      id: generateId(),
      employeeId: rectifyTarget.employeeId,
      employeeName: rectifyTarget.employeeName,
      date: rectifyTarget.date,
      exitTime: permitExitTime,
      returnTime: permitReturnTime,
      durationMinutes: rectifyPermitDuration,
      reasonType: permitReasonType,
      notes: permitNotes.trim() || rectifyTarget.workSite,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };

    setExitPermissions((prev) => [newPermit, ...prev]);
    setAttendanceRecords((prev) =>
      prev.map((r) =>
        r.id === rectifyTarget.id
          ? {
              ...r,
              rectificationType: 'exit_permit',
              rectificationId: newPermit.id,
              regularizationStatus: 'Pending',
            }
          : r
      )
    );

    onLogAudit(
      lang === 'ar' ? 'تصحيح مخالفة دوام بطلب إذن' : 'Rectified Violation via Exit Permit',
      `${rectifyTarget.employeeName} · ${rectifyTarget.date} (${permitExitTime} → ${permitReturnTime})`,
      'attendance',
      rectifyTarget.employeeId
    );

    onNotify?.({
      type: 'request',
      titleAr: 'طلب إذن لتصحيح مخالفة دوام',
      titleEn: 'Attendance Regularization Exit Permit',
      messageAr: `${rectifyTarget.employeeName} قدّم طلب إذن (${permitExitTime} – ${permitReturnTime}) لتصحيح مخالفة يوم ${rectifyTarget.date}.`,
      messageEn: `${rectifyTarget.employeeName} submitted an exit permit (${permitExitTime} – ${permitReturnTime}) to rectify ${rectifyTarget.date}.`,
      targetView: 'attendance_hub',
      targetSubTab: 'violations',
    });

    onToast(
      'success',
      lang === 'ar'
        ? 'تم إرسال طلب الإذن وربطه بسجل الحضور للمراجعة والاعتماد.'
        : 'Exit permit submitted and linked to this attendance record.'
    );
    setRectifyTarget(null);
  };

  const handleRectifySubmitLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rectifyTarget || !rectifyEmployee) return;
    setRectifyError('');

    if (!leaveStartDate || !leaveEndDate || leaveStartDate > leaveEndDate) {
      setRectifyError(lang === 'ar' ? 'تاريخ النهاية يجب أن يكون مساوياً أو بعد البداية.' : 'Invalid leave dates.');
      return;
    }

    if (rectifySubPolicy.exceedsTwoDayLimit && !rectifySubPolicy.approvedException) {
      if (requestSubException) {
        if (!subExceptionReason.trim()) {
          setRectifyError(t(lang, 'exceptionReasonPlaceholder'));
          return;
        }
        if (onSubmitSubstituteException && rectifySubPolicy.conflictingDuty && !rectifySubPolicy.pendingException) {
          const excReq: SubstituteExceptionRequest = {
            id: generateId(),
            employeeId: rectifyEmployee.id,
            employeeName: rectifyEmployee.fullName,
            substituteForVacationId: rectifySubPolicy.conflictingDuty.id,
            coveringForEmployeeName: rectifySubPolicy.conflictingDuty.employeeName,
            coverageStartDate: rectifySubPolicy.conflictingDuty.startDate,
            coverageEndDate: rectifySubPolicy.conflictingDuty.endDate,
            requestedStartDate: leaveStartDate,
            requestedEndDate: leaveEndDate,
            requestedDays: rectifyEffectiveLeaveDays,
            vacationType: leaveType,
            reason: subExceptionReason.trim(),
            status: 'Pending',
            createdAt: new Date().toISOString(),
          };
          onSubmitSubstituteException(excReq);
          setRectifyTarget(null);
          return;
        }
      }
      setRectifyError(t(lang, 'substituteTwoDayHint'));
      return;
    }

    const newLeave: Vacation = {
      id: generateId(),
      employeeId: rectifyTarget.employeeId,
      employeeName: rectifyTarget.employeeName,
      startDate: leaveStartDate,
      endDate: leaveEndDate,
      days: rectifyEffectiveLeaveDays,
      type: leaveType,
      substitute: leaveSubstitute,
      notes: leaveNotes.trim(),
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };

    setVacations((prev) => [newLeave, ...prev]);
    if (rectifySubPolicy.approvedException && onMarkExceptionConsumed) {
      onMarkExceptionConsumed(rectifySubPolicy.approvedException.id, newLeave.id);
    }

    setAttendanceRecords((prev) =>
      prev.map((r) =>
        r.id === rectifyTarget.id
          ? {
              ...r,
              rectificationType: 'leave',
              rectificationId: newLeave.id,
              regularizationStatus: 'Pending',
            }
          : r
      )
    );

    onLogAudit(
      lang === 'ar' ? 'تصحيح مخالفة دوام بطلب إجازة' : 'Rectified Violation via Leave',
      `${rectifyTarget.employeeName} · ${leaveStartDate} → ${leaveEndDate} (${rectifyEffectiveLeaveDays}d)`,
      'attendance',
      rectifyTarget.employeeId
    );

    onNotify?.({
      type: 'request',
      titleAr: 'طلب إجازة لتصحيح مخالفة دوام',
      titleEn: 'Attendance Regularization Leave Request',
      messageAr: `${rectifyTarget.employeeName} قدّم إجازة (${leaveStartDate} → ${leaveEndDate}) لتصحيح سجل يوم ${rectifyTarget.date}.`,
      messageEn: `${rectifyTarget.employeeName} submitted a leave (${leaveStartDate} → ${leaveEndDate}) to regularize ${rectifyTarget.date}.`,
      targetView: 'attendance_hub',
      targetSubTab: 'violations',
    });

    onToast(
      'success',
      lang === 'ar'
        ? 'تم إرسال طلب الإجازة وربطه بسجل الحضور للمراجعة والاعتماد.'
        : 'Leave request submitted and linked to this attendance record.'
    );
    setRectifyTarget(null);
  };

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Header & Work Hours Policy */}
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-4 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-2xl font-bold flex items-center gap-2">
              <Clock size={22} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'attendanceTitle')}</span>
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{t(lang, 'attendanceDesc')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border)] font-mono-tabular">
              <span className="text-[var(--text-muted)]">{lang === 'ar' ? 'القياسي:' : 'Standard:'}</span>{' '}
              <span className="font-bold text-[var(--primary-text)]">
                {stdBounds.start} – {stdBounds.end}
              </span>
            </div>
            {flexibleEnabled && (
              <div className="px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border)] font-mono-tabular">
                <span className="text-[var(--text-muted)]">{lang === 'ar' ? 'ساعة مرنة:' : 'Flexible:'}</span>{' '}
                <span className="font-bold text-[var(--primary-text)]">
                  {flexBounds.start} – {flexBounds.end}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--card-bg)] rounded-xl border border-[var(--border)] px-4 py-3 text-xs">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Clock size={16} className="text-[var(--primary-text)] shrink-0" />
            <span>
              {forcePersonalScope
                ? lang === 'ar'
                  ? `سجل الحضور والانصراف الشخصي لـ ${selectedEmployee?.fullName || '-'}`
                  : `Personal attendance log for ${selectedEmployee?.fullName || '-'}`
                : t(lang, 'attendanceDesc')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-2.5 py-1 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] font-mono-tabular">
              <span className="text-[var(--text-muted)]">{lang === 'ar' ? 'القياسي:' : 'Standard:'}</span>{' '}
              <span className="font-bold text-[var(--primary-text)]">
                {stdBounds.start} – {stdBounds.end}
              </span>
            </div>
            {flexibleEnabled && (
              <div className="px-2.5 py-1 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] font-mono-tabular">
                <span className="text-[var(--text-muted)]">{lang === 'ar' ? 'ساعة مرنة:' : 'Flexible:'}</span>{' '}
                <span className="font-bold text-[var(--primary-text)]">
                  {flexBounds.start} – {flexBounds.end}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4 Interactive Vivid KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setStatusFilter((prev) => (prev === 'compliant' ? 'all' : 'compliant'));
            ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setStatusFilter((prev) => (prev === 'compliant' ? 'all' : 'compliant'));
            }
          }}
          className={`${getVividCardClass(1, { isActive: statusFilter === 'compliant' })} rounded-xl p-4 flex items-center justify-between gap-3`}
        >
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {t(lang, 'attendanceComplianceRateLabel')}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-emerald-400 mt-1">
              {metrics.compliancePercent}%
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {metrics.compliantCount}/{metrics.total}{' '}
              {lang === 'ar' ? 'منضبط · متوسط الدوام' : 'on-time · avg'}{' '}
              <strong className="text-[var(--text-main)]">{metrics.averageAdherencePercent}%</strong>
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-500/15 text-emerald-400 shrink-0">
            <CheckCircle2 size={20} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setStatusFilter((prev) => (prev === 'violations' ? 'all' : 'violations'));
            ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setStatusFilter((prev) => (prev === 'violations' ? 'all' : 'violations'));
            }
          }}
          className={`${getVividCardClass(2, { isActive: statusFilter === 'violations' })} rounded-xl p-4 flex items-center justify-between gap-3`}
        >
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {t(lang, 'attendanceLateRateLabel')}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-amber-400 mt-1">
              {metrics.violationPercent}%
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {metrics.latePercent}% {t(lang, 'lateArrivalTag')} ({metrics.lateCount}) · {metrics.earlyExitPercent}%{' '}
              {t(lang, 'earlyDepartureTag')} ({metrics.earlyExitCount})
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-500/15 text-amber-400 shrink-0">
            <LogIn size={20} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setStatusFilter((prev) => (prev === 'overtime' ? 'all' : 'overtime'));
            ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setStatusFilter((prev) => (prev === 'overtime' ? 'all' : 'overtime'));
            }
          }}
          className={`${getVividCardClass(0, { isActive: statusFilter === 'overtime' })} rounded-xl p-4 flex items-center justify-between gap-3`}
        >
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">{t(lang, 'overtimeHoursLabel')}</p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-cyan-400 mt-1">
              {formatAttendanceDuration(metrics.totalOvertimeMinutes, lang)}
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {metrics.overtimePercentOfWorked}% {lang === 'ar' ? 'من ساعات العمل' : 'of worked'} · ×
              {attCfg?.overtimeMultiplier ?? 1.5}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-cyan-500/15 text-cyan-400 shrink-0">
            <TrendingUp size={20} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            const targetKey = metrics.openShifts > 0 ? 'open' : 'unresolved';
            setStatusFilter((prev) => (prev === targetKey ? 'all' : targetKey));
            ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const targetKey = metrics.openShifts > 0 ? 'open' : 'unresolved';
              setStatusFilter((prev) => (prev === targetKey ? 'all' : targetKey));
            }
          }}
          className={`${getVividCardClass(3, { isActive: statusFilter === 'open' || statusFilter === 'unresolved' })} rounded-xl p-4 flex items-center justify-between gap-3`}
        >
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {canManageViolations
                ? lang === 'ar'
                  ? 'المناوبات وطلبات التصحيح'
                  : 'Shifts & Pending Review'
                : lang === 'ar'
                ? 'المناوبات والإنذارات الخاصة بك'
                : 'Active Shifts & Warnings'}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-rose-400 mt-1">
              {metrics.openShifts} / {canManageViolations ? metrics.pendingRectificationCount : metrics.unrectifiedWarningsCount}
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {metrics.openShifts} {lang === 'ar' ? 'على رأس الدوام' : 'active'} ·{' '}
              {canManageViolations
                ? `${metrics.pendingRectificationCount} ${lang === 'ar' ? 'طلب تصحيح معلق' : 'pending'}`
                : `${metrics.unrectifiedWarningsCount} ${lang === 'ar' ? 'إنذار نشط' : 'warnings'}`}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
            <AlertTriangle size={20} />
          </div>
        </div>
      </div>

      {/* Employee Warnings Strip (Shown strictly to non-exempt Employees without manage_violations) */}
      {!canManageViolations && !isSelectedEmployeeExempt && alertRecords.length > 0 && (
        <div className="rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--status-warn-text)]">
              <AlertTriangle size={17} />
              <span>{t(lang, 'violationsAlertTitle')}</span>
              <span className="font-mono-tabular text-xs px-1.5 py-0.5 rounded bg-[var(--card-bg)] text-[var(--text-main)] border border-[var(--border)]">
                {alertRecords.length}
              </span>
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {lang === 'ar'
                ? 'تظهر المخالفات كإنذار للموظف فقط — يرجى تقديم طلب إذن أو إجازة لتصحيح الإنذار واعتماده من الإدارة'
                : 'Warnings appear on your record; submit an exit permit or leave request for manager review'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {alertRecords.map((rec) => {
              const bounds = getShiftScheduleBounds(rec.shiftMode, attCfg);
              return (
                <div
                  key={rec.id}
                  className="bg-[var(--card-bg)] border border-[var(--border)] rounded-lg p-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-[var(--status-danger-text)]">
                        {lang === 'ar' ? 'إنذار:' : 'Warning:'}
                      </span>
                      <span className="font-mono-tabular text-[var(--text-main)] font-semibold">{rec.date}</span>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="font-mono-tabular font-semibold text-[var(--status-danger-text)]">
                        {rec.lateMinutes > 0 &&
                          `${t(lang, 'lateArrivalTag')} (${formatAttendanceDuration(rec.lateMinutes, lang)})`}
                        {rec.lateMinutes > 0 && rec.earlyExitMinutes > 0 ? ' · ' : ''}
                        {rec.earlyExitMinutes > 0 &&
                          `${t(lang, 'earlyDepartureTag')} (${formatAttendanceDuration(rec.earlyExitMinutes, lang)})`}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {rec.warningNote || rec.workSite} ·{' '}
                      <span className="font-mono-tabular">
                        ({bounds.start}–{bounds.end})
                      </span>
                    </p>
                  </div>

                  {(allowPermitRect || allowLeaveRect) && (
                    <button
                      type="button"
                      onClick={() => openRectifyModal(rec)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ShieldCheck size={14} />
                      <span>{t(lang, 'rectifyViolationBtn')}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin/Manager Routing Banner -> directs rectification approvals to "مخالفات الموظفين" */}
      {canManageViolations &&
        (metrics.pendingRectificationCount > 0 || metrics.unrectifiedWarningsCount > 0) &&
        onNavigateToViolations && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <ShieldAlert size={18} className="text-[var(--primary-text)] shrink-0" />
              <span>
                {lang === 'ar' ? (
                  <>
                    توجد <strong className="font-mono-tabular text-[var(--primary-text)]">{metrics.pendingRectificationCount}</strong> طلبات تصحيح مخالفات بانتظار الاعتماد، و{' '}
                    <strong className="font-mono-tabular">{metrics.unrectifiedWarningsCount}</strong> إنذارات موجهة للموظفين. تتم مراجعة واعتماد التصحيحات حصراً من صفحة مخالفات الموظفين.
                  </>
                ) : (
                  <>
                    <strong className="font-mono-tabular text-[var(--primary-text)]">{metrics.pendingRectificationCount}</strong> rectification requests awaiting approval and{' '}
                    <strong className="font-mono-tabular">{metrics.unrectifiedWarningsCount}</strong> warnings issued. Review and approve in Employee Violations.
                  </>
                )}
              </span>
            </div>

            <button
              type="button"
              onClick={onNavigateToViolations}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShieldAlert size={14} />
              <span>{t(lang, 'openViolationsPageBtn')}</span>
            </button>
          </div>
        )}

      {/* Check-In / Out Interface: Supervisor keeps untouched Manual Logger; User/Employee gets Protected Auto Clock + GPS Map */}
      {canManageAttendance ? (
        <form
          onSubmit={handleRecordEntry}
          className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <LogIn size={18} className="text-[var(--primary-text)]" />
              <div>
                <h3 className="font-display text-base font-bold">
                  {lang === 'ar' ? 'تسجيل الدخول والخروج المباشر' : 'Clock-In & Check-Out Logger'}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {lang === 'ar'
                    ? `اختر نظام الدوام (${stdBounds.start}–${stdBounds.end} قياسي${
                        flexibleEnabled ? ` أو ${flexBounds.start}–${flexBounds.end} ساعة مرنة` : ''
                      }) مع تحديد موقع العمل`
                    : `Select Standard (${stdBounds.start}–${stdBounds.end})${
                        flexibleEnabled ? ` or Flexible (${flexBounds.start}–${flexBounds.end})` : ''
                      } with work site`}
                </p>
              </div>
            </div>

            {/* Shift Selector */}
            <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
              <button
                type="button"
                onClick={() => setShiftMode('standard')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveShiftMode === 'standard'
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {t(lang, 'shiftStandardLabel')} ({stdBounds.start}–{stdBounds.end})
              </button>
              {flexibleEnabled && (
                <button
                  type="button"
                  onClick={() => setShiftMode('flexible')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    effectiveShiftMode === 'flexible'
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {t(lang, 'shiftFlexibleLabel')} ({flexBounds.start}–{flexBounds.end})
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Employee */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                {t(lang, 'employeeCol')}
              </label>
              <select
                value={effectiveEmpId}
                onChange={(e) => handleSelectComposerEmployee(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} — {emp.department}
                    {emp.biometricExempt ? ` (${t(lang, 'biometricExemptBadge')})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                {t(lang, 'attendanceDateLabel')}
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
              />
            </div>

            {/* Work Site */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                {t(lang, 'workSiteLabel')} *
              </label>
              <div className="relative">
                <Building2
                  size={15}
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                />
                <input
                  type="text"
                  list="attendance-work-sites"
                  value={workSite}
                  onChange={(e) => setWorkSite(e.target.value)}
                  placeholder={lang === 'ar' ? 'أدخل موقع العمل (مثال: لبدة الكبرى / ديوان المصلحة)' : 'Enter work site'}
                  className="w-full ps-9 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  required
                />
                <datalist id="attendance-work-sites">
                  {workSiteOptions.map((site) => (
                    <option key={site} value={site} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Check-In Time + Now button */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                {t(lang, 'checkInTimeLabel')} *
              </label>
              <div className="flex gap-1.5">
                <input
                  type="time"
                  value={checkInTime}
                  onChange={(e) => setCheckInTime(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setCheckInTime(getCurrentTimeHHMM())}
                  className="px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap shrink-0"
                >
                  {t(lang, 'useCurrentTimeBtn')}
                </button>
              </div>
            </div>

            {/* Check-Out Time (optional) */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                {t(lang, 'checkOutTimeLabel')} {t(lang, 'optionalLabel')}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="time"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  onClick={() => setCheckOutTime(getCurrentTimeHHMM())}
                  className="px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap shrink-0"
                >
                  {t(lang, 'useCurrentTimeBtn')}
                </button>
              </div>
            </div>
          </div>

          {/* Notes & Live Shift Evaluation */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border)]">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
              <input
                type="text"
                value={entryNotes}
                onChange={(e) => setEntryNotes(e.target.value)}
                placeholder={lang === 'ar' ? 'ملاحظات اختيارية حول المناوبة أو الموقع...' : 'Optional shift notes...'}
                className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
              />
              <div className="text-xs flex flex-wrap items-center gap-2 font-mono-tabular">
                <span className="text-[var(--text-muted)]">
                  {liveEval.expectedStart} – {liveEval.expectedEnd}:
                </span>
                {liveEval.violationType === 'None' ? (
                  <span className="font-semibold text-[var(--status-success-text)]">
                    {t(lang, 'compliantShiftTag')}
                    {liveEval.workedMinutes !== null
                      ? ` · ${formatAttendanceDuration(liveEval.workedMinutes, lang)} (${liveEval.adherencePercent}%)`
                      : ''}
                    {liveEval.overtimeMinutes > 0
                      ? ` · +${formatAttendanceDuration(liveEval.overtimeMinutes, lang)} ${lang === 'ar' ? 'إضافي' : 'OT'}`
                      : ''}
                  </span>
                ) : (
                  <span className="font-semibold text-[var(--status-danger-text)]">
                    {liveEval.lateMinutes > 0 &&
                      `${t(lang, 'lateArrivalTag')} (${formatAttendanceDuration(liveEval.lateMinutes, lang)})`}
                    {liveEval.lateMinutes > 0 && liveEval.earlyExitMinutes > 0 ? ' · ' : ''}
                    {liveEval.earlyExitMinutes > 0 &&
                      `${t(lang, 'earlyDepartureTag')} (${formatAttendanceDuration(liveEval.earlyExitMinutes, lang)})`}
                    {liveEval.workedMinutes !== null ? ` · ${liveEval.adherencePercent}%` : ''}
                  </span>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn size={16} />
              <span>
                {checkOutTime.trim()
                  ? lang === 'ar'
                    ? 'حفظ الدخول والخروج'
                    : 'Save Check-In & Out'
                  : t(lang, 'recordCheckInBtn')}
              </span>
            </button>
          </div>

          {formError && (
            <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)] font-medium">
              {formError}
            </div>
          )}
        </form>
      ) : (
        /* Employee / Personal Protected Automatic Check-In & Check-Out + Interactive GPS Map */
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-5 space-y-5">
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)]">
                <ShieldCheck size={20} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-bold">{t(lang, 'autoProtectedClockTitle')}</h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-[10px] font-semibold text-[var(--status-success-text)]">
                    <Lock size={11} />
                    <span>{t(lang, 'trustedClockBadge')}</span>
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {lang === 'ar'
                    ? 'التاريخ، الساعة، اسم المستخدم، والموقع الجغرافي محددة آلياً ومحمية ضد التعديل اليدوي'
                    : 'System date, live clock, user identity, and GPS coordinates are locked and verified automatically'}
                </p>
              </div>
            </div>

            {/* Shift selector before check-in; locked once clocked in today */}
            <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
              <button
                type="button"
                disabled={Boolean(openShiftToday || completedShiftToday)}
                onClick={() => setShiftMode('standard')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  effectiveShiftMode === 'standard'
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                } disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer`}
              >
                {t(lang, 'shiftStandardLabel')} ({stdBounds.start}–{stdBounds.end})
              </button>
              {flexibleEnabled && (
                <button
                  type="button"
                  disabled={Boolean(openShiftToday || completedShiftToday)}
                  onClick={() => setShiftMode('flexible')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    effectiveShiftMode === 'flexible'
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  } disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer`}
                >
                  {t(lang, 'shiftFlexibleLabel')} ({flexBounds.start}–{flexBounds.end})
                </button>
              )}
            </div>
          </div>

          {isSelectedEmployeeExempt && (
            <div className="p-4 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/40 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <ShieldCheck size={18} className="text-[var(--primary-text)] shrink-0 mt-0.5" />
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-bold text-[var(--primary-text)]">
                    {t(lang, 'biometricExemptNoticeTitle')}
                  </p>
                  <p className="text-xs text-[var(--text-main)]">{t(lang, 'biometricExemptNoticeDesc')}</p>
                  {selectedEmployee?.biometricExemptReason && (
                    <p className="text-xs text-[var(--text-muted)]">
                      {t(lang, 'biometricExemptReasonLabel')}: <strong className="text-[var(--text-main)]">{selectedEmployee.biometricExemptReason}</strong>
                    </p>
                  )}
                </div>
              </div>
              {selectedEmployee?.biometricExemptUpdatedBy && (
                <div className="text-[11px] font-mono-tabular text-[var(--text-muted)] shrink-0">
                  {selectedEmployee.biometricExemptUpdatedBy}
                  {selectedEmployee.biometricExemptUpdatedAt
                    ? ` · ${selectedEmployee.biometricExemptUpdatedAt.slice(0, 10)}`
                    : ''}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
            {/* Left/Start Column: Locked Identity, Trusted Live Clock, Resolved GPS Site & Protected Action */}
            <div className="xl:col-span-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                {/* Direct Authenticated User Card */}
                <div className="p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <AvatarWithFallback
                      src={currentUser?.avatar}
                      name={selectedEmployee?.fullName || currentUser?.name || 'User'}
                      sizeClass="w-10 h-10"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                        <UserCheck size={12} className="text-[var(--primary-text)] shrink-0" />
                        <span>{t(lang, 'directUserAccountLabel')}</span>
                      </div>
                      <p className="text-sm font-bold text-[var(--text-main)] truncate">
                        {selectedEmployee?.fullName || currentUser?.name || '-'}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] truncate">
                        {selectedEmployee?.department || currentUser?.email}
                      </p>
                    </div>
                  </div>
                  <Lock size={15} className="text-[var(--text-muted)] shrink-0" />
                </div>

                {/* Locked Automatic Date & Live Clock Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                      <span>{t(lang, 'autoDateLabel')}</span>
                      <Lock size={11} />
                    </div>
                    <p className="font-mono-tabular text-sm font-bold text-[var(--text-main)]">
                      {formatReadableDate(autoDateStr, lang)}
                    </p>
                    <p className="font-mono-tabular text-[11px] text-[var(--text-muted)]">{autoDateStr}</p>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--primary)]/40 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-[var(--primary-text)]">
                      <span>{t(lang, 'autoLiveTimeLabel')}</span>
                      <span
                        className="w-2 h-2 rounded-full bg-[var(--status-success-text)]"
                        title={serverClockSynced ? 'Synced' : 'Local'}
                      />
                    </div>
                    <p className="font-mono-tabular text-xl font-bold text-[var(--primary-text)] tracking-tight">
                      {autoTimeHHMMSS}
                    </p>
                    <p className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                      {liveEval.expectedStart} – {liveEval.expectedEnd}
                    </p>
                  </div>
                </div>

                {/* Auto-Detected Location & Geofence Status */}
                <div className="p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <Navigation size={14} className="text-[var(--primary-text)] shrink-0" />
                      <span>{t(lang, 'workSiteLabel')}</span>
                    </div>
                    {isSelectedEmployeeExempt ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--primary-soft)] border border-[var(--primary)]/40 text-[11px] font-semibold text-[var(--primary-text)]">
                        <ShieldCheck size={12} />
                        <span>{t(lang, 'biometricExemptBadge')}</span>
                      </span>
                    ) : gpsStatus === 'ready' && gpsPosition?.source === 'ip-fallback' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] text-[11px] font-semibold text-[var(--status-warn-text)]">
                        <AlertTriangle size={12} />
                        <span>{t(lang, 'gpsSourceIpFallback')}</span>
                      </span>
                    ) : gpsStatus === 'ready' && nearestMatch ? (
                      nearestMatch.isInsideGeofence ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-[11px] font-semibold text-[var(--status-success-text)]">
                          <CheckCircle2 size={12} />
                          <span>{t(lang, 'insideGeofenceBadge')}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[11px] font-semibold text-[var(--status-danger-text)]">
                          <AlertTriangle size={12} />
                          <span>{t(lang, 'outsideGeofenceBadge')}</span>
                        </span>
                      )
                    ) : gpsStatus === 'detecting' ? (
                      <span className="text-[11px] font-medium text-[var(--primary-text)]">
                        {t(lang, 'autoGpsDetecting')}
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-[var(--status-danger-text)]">
                        {lang === 'ar' ? 'GPS غير متاح' : 'GPS unavailable'}
                      </span>
                    )}
                  </div>

                  <div className="text-xs space-y-2">
                    <div className="px-3 py-2 rounded-lg bg-[var(--card-bg)] border border-[var(--border)]">
                      <span className="block text-[10px] text-[var(--text-muted)]">{t(lang, 'assignedWorkSiteLabel')}</span>
                      <span className="font-semibold text-[var(--text-main)] truncate block">
                        {resolvedAutoWorkSite}
                      </span>
                      {selectedEmployee?.allowedWorkSites && selectedEmployee.allowedWorkSites.length > 0 && (
                        <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                          + {t(lang, 'allowedWorkSitesLabel')}: {selectedEmployee.allowedWorkSites.join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {gpsPosition && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
                      <div className="flex flex-wrap items-center gap-2">
                        {nearestMatch && (
                          <span>
                            {t(lang, 'distanceToOfficeLabel')}:{' '}
                            <strong
                              className={
                                isSelectedEmployeeExempt
                                  ? 'text-[var(--primary-text)]'
                                  : nearestMatch.isInsideGeofence
                                  ? 'text-[var(--status-success-text)]'
                                  : 'text-[var(--status-danger-text)]'
                              }
                            >
                              {formatDistanceLabel(nearestMatch.distanceMeters, lang)}
                            </strong>{' '}
                            / {nearestMatch.site.radiusMeters}m
                          </span>
                        )}
                        <span className="text-[10px] text-[var(--primary-text)] font-sans">
                          {gpsPosition.source === 'hardware-gps'
                            ? t(lang, 'gpsSourceHardware')
                            : gpsPosition.source === 'network-gps'
                            ? t(lang, 'gpsSourceNetwork')
                            : `${t(lang, 'gpsSourceIpFallback')}${
                                gpsPosition.cityLabel ? ` (${gpsPosition.cityLabel})` : ''
                              }`}
                        </span>
                      </div>
                      {gpsPosition.accuracyMeters !== undefined && (
                        <span>
                          {t(lang, 'gpsAccuracyLabel')}: ±{gpsPosition.accuracyMeters}m
                        </span>
                      )}
                    </div>
                  )}

                  {gpsDiagnostic &&
                    (!gpsPosition || gpsPosition.source === 'ip-fallback') && (
                      <div className="p-2.5 rounded-lg bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] text-[11px] text-[var(--status-warn-text)] space-y-1.5">
                        <div className="font-bold flex items-center justify-between gap-2">
                          <span>
                            {gpsDiagnostic.code === 'PERMISSION_DENIED'
                              ? t(lang, 'gpsPermissionDeniedTitle')
                              : lang === 'ar'
                              ? 'تعذر تثبيت إشارة GPS الدقيقة'
                              : 'Precise GPS Signal Unavailable'}
                          </span>
                          <button
                            type="button"
                            onClick={acquireGpsLocation}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--border)] text-[var(--text-main)] text-[10px] font-semibold hover:border-[var(--primary)] cursor-pointer shrink-0"
                          >
                            <RefreshCw size={10} />
                            <span>{t(lang, 'gpsRetryBtn')}</span>
                          </button>
                        </div>
                        <p className="text-[var(--text-main)] leading-relaxed">
                          {gpsDiagnostic.code === 'PERMISSION_DENIED'
                            ? t(lang, 'gpsPermissionDeniedSteps')
                            : lang === 'ar'
                            ? gpsDiagnostic.messageAr
                            : gpsDiagnostic.messageEn}
                        </p>
                      </div>
                    )}

                  {gpsStatus === 'error' && gpsErrorMsg && !gpsDiagnostic && (
                    <div className="p-2 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[11px] text-[var(--status-danger-text)]">
                      {gpsErrorMsg}
                    </div>
                  )}
                </div>

                {/* Optional note & live schedule tag */}
                <input
                  type="text"
                  value={autoNotes}
                  onChange={(e) => setAutoNotes(e.target.value)}
                  disabled={Boolean(completedShiftToday)}
                  placeholder={lang === 'ar' ? 'ملاحظة اختيارية حول الدوام...' : 'Optional shift note...'}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)] disabled:opacity-60"
                />
              </div>

              {/* Action Footer */}
              <div className="space-y-2.5 pt-2">
                {completedShiftToday ? (
                  <div className="p-3.5 rounded-xl bg-[var(--status-success-bg)] border border-[var(--status-success-border)] text-xs text-[var(--status-success-text)] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <CheckCircle2 size={16} />
                      <span>{t(lang, 'completedTodayBanner')}</span>
                    </div>
                    <span className="font-mono-tabular font-bold">
                      {completedShiftToday.checkInTime} → {completedShiftToday.checkOutTime}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleProtectedAutoAttendance()}
                      disabled={!isSelectedEmployeeExempt && gpsStatus === 'detecting'}
                      className={`flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        openShiftToday
                          ? 'bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] text-[var(--status-warn-text)] hover:opacity-90'
                          : 'bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]'
                      }`}
                    >
                      {openShiftToday ? <LogOut size={17} /> : <LogIn size={17} />}
                      <span>
                        {openShiftToday
                          ? `${t(lang, 'recordCheckOutBtn')} (${autoTimeHHMM})`
                          : `${t(lang, 'recordCheckInBtn')} (${autoTimeHHMM})`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={acquireGpsLocation}
                      disabled={gpsStatus === 'detecting'}
                      className="inline-flex items-center gap-1.5 px-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      <RefreshCw size={14} className={gpsStatus === 'detecting' ? 'animate-spin' : ''} />
                      <span>{t(lang, 'refreshGpsBtn')}</span>
                    </button>
                  </div>
                )}

                {openShiftToday && (
                  <div className="px-3 py-2 rounded-lg bg-[var(--primary-soft)] border border-[var(--primary)]/30 text-[11px] flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--primary-text)]">
                      {t(lang, 'activeShiftBadge')} · {lang === 'ar' ? 'تم الدخول الساعة' : 'Checked in at'}{' '}
                      <span className="font-mono-tabular font-bold">{openShiftToday.checkInTime}</span>
                    </span>
                    <span className="font-mono-tabular text-[var(--text-muted)]">
                      {openShiftToday.integrityDigest || 'SEC-AUTO'}
                    </span>
                  </div>
                )}

                {autoActionError && (
                  <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)] font-medium">
                    {autoActionError}
                  </div>
                )}
              </div>
            </div>

            {/* Right/End Column: Interactive Verification Map */}
            <div className="xl:col-span-7 flex flex-col space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--text-main)]">
                  <Crosshair size={15} className="text-[var(--primary-text)]" />
                  <span>
                    {lang === 'ar'
                      ? 'تحديد نقطة موقعك الجغرافي تلقائياً على الخريطة'
                      : 'Automatic Live GPS Pin & Approved Office Geofence'}
                  </span>
                </div>
                {gpsPosition && (
                  <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                    {gpsPosition.lat.toFixed(5)}, {gpsPosition.lng.toFixed(5)}
                  </span>
                )}
              </div>

              <InteractiveGeoMap
                mode="employee-verify"
                theme={settings.currentTheme}
                lang={lang}
                workSites={employeeAuthorizedSites}
                selectedSiteName={resolvedAutoWorkSite}
                userPosition={gpsPosition}
                matchedSite={nearestMatch?.site || fallbackEmployeeSite}
                distanceMeters={nearestMatch?.distanceMeters ?? null}
                isInsideGeofence={nearestMatch?.isInsideGeofence ?? null}
                heightClass="h-80 xl:flex-1"
                minHeightPx={340}
              />
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar & Attendance Records Ledger */}
      <div
        ref={ledgerSectionRef}
        className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden"
      >
        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--card-bg)] border border-[var(--border)] gap-1">
            {[
              { id: 'all', label: lang === 'ar' ? 'الكل' : 'All' },
              { id: 'violations', label: lang === 'ar' ? 'مخالفات الدخول/الخروج' : 'Violations' },
              { id: 'unresolved', label: lang === 'ar' ? 'بانتظار التصحيح' : 'Unresolved' },
              { id: 'open', label: t(lang, 'activeShiftBadge') },
              { id: 'overtime', label: t(lang, 'overtimeCol') },
              { id: 'compliant', label: t(lang, 'compliantShiftTag') },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
              />
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => setDateFilter('')}
                  className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                >
                  {lang === 'ar' ? 'كل التواريخ' : 'All Dates'}
                </button>
              )}
            </div>

            <div className="relative min-w-[210px]">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  lang === 'ar' ? 'بحث بالموظف أو موقع العمل...' : 'Search employee or work site...'
                }
                className="w-full ps-8 pe-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
              />
            </div>

            {canExportExcel && (
              <button
                type="button"
                onClick={handleExportAttendance}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download size={14} className="text-[var(--primary-text)]" />
                <span>{t(lang, 'exportExcel')}</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-start">{t(lang, 'employeeCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'attendanceDateLabel')} & {t(lang, 'shiftScheduleLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'workSiteLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'checkInTimeLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'checkOutTimeLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'overtimeCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'adherencePercentCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'statusCol')}</th>
                <th className="px-4 py-3 text-start">
                  {canManageViolations
                    ? lang === 'ar'
                      ? 'المخالفة والاعتماد'
                      : 'Rectification'
                    : lang === 'ar'
                    ? 'الإنذارات والتصحيح'
                    : 'Warnings / Action'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredRecords.map((rec) => {
                const bounds = getShiftScheduleBounds(rec.shiftMode, attCfg);
                const emp = employees.find((e) => e.id === rec.employeeId);
                const evalRes = rec.evalRes;
                const overtimeMins = rec.effectiveOvertime;
                const rect = rec.effectiveRectification;
                const needsRect =
                  evalRes.violationType !== 'None' && (rect.status === 'Unresolved' || rect.status === 'Rejected');

                return (
                  <tr key={rec.id} className="hover:bg-[var(--surface-subtle)]/40 align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 min-w-[160px]">
                        <AvatarWithFallback name={rec.employeeName} sizeClass="w-8 h-8" />
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--text-main)] truncate">{rec.employeeName}</p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            {emp?.department || '-'}
                          </p>
                          {emp?.biometricExempt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--primary-text)]">
                              <ShieldCheck size={10} className="shrink-0" />
                              <span>{t(lang, 'biometricExemptBadge')}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono-tabular font-semibold">{formatReadableDate(rec.date, lang)}</div>
                      <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular">
                        {rec.shiftMode === 'flexible'
                          ? lang === 'ar'
                            ? `مرن (${bounds.start}–${bounds.end})`
                            : `Flexible (${bounds.start}–${bounds.end})`
                          : lang === 'ar'
                          ? `قياسي (${bounds.start}–${bounds.end})`
                          : `Standard (${bounds.start}–${bounds.end})`}
                      </div>
                    </td>

                    <td className="px-4 py-3 font-medium max-w-[190px]">
                      <div className="truncate">{rec.workSite}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        {rec.geofenceStatus === 'VerifiedInside' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--status-success-text)]">
                            <ShieldCheck size={11} />
                            <span>{lang === 'ar' ? 'GPS موثق' : 'GPS Verified'}</span>
                          </span>
                        )}
                        {rec.geofenceStatus === 'OutsideRange' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--status-danger-text)]">
                            <AlertTriangle size={11} />
                            <span>{lang === 'ar' ? 'خارج النطاق' : 'Outside Range'}</span>
                          </span>
                        )}
                        {rec.checkInLat !== undefined && rec.checkInLng !== undefined && (
                          <button
                            type="button"
                            onClick={() => setInspectMapRecord(rec)}
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--primary-text)] hover:underline cursor-pointer"
                          >
                            <MapPin size={10} />
                            <span>{t(lang, 'mapPinAction')}</span>
                          </button>
                        )}
                      </div>
                      {rec.notes && <div className="text-[11px] text-[var(--text-muted)] truncate">{rec.notes}</div>}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-mono-tabular font-bold text-[var(--text-main)]">{rec.checkInTime}</div>
                      {rec.checkInDistanceMeters !== undefined && (
                        <div className="text-[10px] font-mono-tabular text-[var(--text-muted)]">
                          {formatDistanceLabel(rec.checkInDistanceMeters, lang)}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {rec.checkOutTime ? (
                        <div>
                          <div className="font-mono-tabular font-bold text-[var(--text-main)]">
                            {rec.checkOutTime}
                            {evalRes.workedMinutes !== null && (
                              <span className="ms-1.5 text-[11px] font-normal text-[var(--text-muted)]">
                                ({formatAttendanceDuration(evalRes.workedMinutes, lang)})
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (canManageAttendance) {
                              openCheckoutModal(rec);
                            } else {
                              handleProtectedAutoAttendance(rec);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold hover:bg-[var(--primary)] hover:text-[var(--primary-fg)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <LogOut size={13} />
                          <span>{t(lang, 'recordCheckOutBtn')}</span>
                        </button>
                      )}
                    </td>

                    <td className="px-4 py-3 font-mono-tabular whitespace-nowrap">
                      {overtimeMins > 0 ? (
                        <div>
                          <div className="font-bold text-[var(--primary-text)]">
                            +{formatAttendanceDuration(overtimeMins, lang)}
                          </div>
                          {attCfg?.overtimeMultiplier && attCfg.overtimeMultiplier > 1 && (
                            <div className="text-[11px] text-[var(--text-muted)]">
                              = {formatAttendanceDuration(Math.round(overtimeMins * attCfg.overtimeMultiplier), lang)} (×
                              {attCfg.overtimeMultiplier})
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="w-16 space-y-1">
                        <span
                          className={`font-mono-tabular font-bold ${
                            evalRes.adherencePercent >= 95
                              ? 'text-[var(--status-success-text)]'
                              : evalRes.adherencePercent >= 80
                              ? 'text-[var(--status-warn-text)]'
                              : 'text-[var(--status-danger-text)]'
                          }`}
                        >
                          {evalRes.adherencePercent}%
                        </span>
                        <div className="h-1.5 rounded-full bg-[var(--surface-subtle)] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              evalRes.adherencePercent >= 95
                                ? 'bg-[var(--status-success-text)]'
                                : evalRes.adherencePercent >= 80
                                ? 'bg-[var(--status-warn-text)]'
                                : 'bg-[var(--status-danger-text)]'
                            }`}
                            style={{ width: `${evalRes.adherencePercent}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {evalRes.violationType === 'None' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-success-text)] whitespace-nowrap">
                            <CheckCircle2 size={14} />
                            <span>
                              {rec.checkOutTime ? t(lang, 'compliantShiftTag') : t(lang, 'activeShiftBadge')}
                            </span>
                          </span>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-danger-text)] whitespace-nowrap">
                              <AlertTriangle size={14} />
                              <span>
                                {evalRes.violationType === 'Both'
                                  ? t(lang, 'bothViolationsTag')
                                  : evalRes.violationType === 'LateArrival'
                                  ? t(lang, 'lateArrivalTag')
                                  : t(lang, 'earlyDepartureTag')}
                              </span>
                            </span>
                            <div className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                              {evalRes.lateMinutes > 0 &&
                                `${lang === 'ar' ? 'تأخير' : 'Late'}: ${formatAttendanceDuration(
                                  evalRes.lateMinutes,
                                  lang
                                )}`}
                              {evalRes.lateMinutes > 0 && evalRes.earlyExitMinutes > 0 ? ' · ' : ''}
                              {evalRes.earlyExitMinutes > 0 &&
                                `${lang === 'ar' ? 'مبكر' : 'Early'}: ${formatAttendanceDuration(
                                  evalRes.earlyExitMinutes,
                                  lang
                                )}`}
                            </div>
                          </>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {evalRes.violationType === 'None' ? (
                        <span className="text-[var(--text-muted)]">-</span>
                      ) : (
                        <div className="space-y-1">
                          {rect.status === 'Resolved' && (
                            <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-success-text)] whitespace-nowrap">
                              <CheckCircle2 size={14} />
                              <span>{t(lang, 'rectificationStatusResolved')}</span>
                            </span>
                          )}
                          {rect.status === 'Pending' &&
                            (canManageViolations && onNavigateToViolations ? (
                              <button
                                type="button"
                                onClick={onNavigateToViolations}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] border border-[var(--status-warn-border)] text-xs font-semibold hover:opacity-90 whitespace-nowrap cursor-pointer"
                              >
                                <ShieldAlert size={13} />
                                <span>{t(lang, 'openViolationsPageBtn')}</span>
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-warn-text)] whitespace-nowrap">
                                <Clock size={14} />
                                <span>{t(lang, 'rectificationStatusPending')}</span>
                              </span>
                            ))}
                          {needsRect &&
                            (!canManageViolations ? (
                              (allowPermitRect || allowLeaveRect) && (
                                <button
                                  type="button"
                                  onClick={() => openRectifyModal(rec)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <ShieldCheck size={13} />
                                  <span>{t(lang, 'rectifyViolationBtn')}</span>
                                </button>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[var(--status-danger-text)] font-semibold whitespace-nowrap">
                                <AlertTriangle size={13} />
                                <span>{lang === 'ar' ? 'إنذار موجه للموظف' : 'Employee Warning Issued'}</span>
                              </span>
                            ))}
                          {rect.linkedLabel && (
                            <div className="text-[11px] text-[var(--text-muted)]">
                              {rec.rectificationType === 'leave'
                                ? translateVacationType(rect.linkedLabel, lang)
                                : rect.linkedLabel}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    {lang === 'ar'
                      ? 'لا توجد سجلات دخول وخروج مطابقة للبحث أو التصفية.'
                      : 'No attendance records match your current filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Complete Check-Out for Open Shift */}
      {checkoutTarget && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base">{t(lang, 'recordCheckOutBtn')}</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {checkoutTarget.employeeName} · {checkoutTarget.date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutTarget(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmCheckout} className="p-5 space-y-4 text-sm">
              <div className="p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">{t(lang, 'workSiteLabel')}:</span>
                  <span className="font-semibold">{checkoutTarget.workSite}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">{t(lang, 'checkInTimeLabel')}:</span>
                  <span className="font-mono-tabular font-semibold">{checkoutTarget.checkInTime}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">{t(lang, 'shiftScheduleLabel')}:</span>
                  <span className="font-mono-tabular font-semibold">
                    {getShiftScheduleBounds(checkoutTarget.shiftMode, attCfg).start} –{' '}
                    {getShiftScheduleBounds(checkoutTarget.shiftMode, attCfg).end}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'checkOutTimeLabel')} *
                </label>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={checkoutTimeInput}
                    onChange={(e) => setCheckoutTimeInput(e.target.value)}
                    className="flex-1 px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setCheckoutTimeInput(getCurrentTimeHHMM())}
                    className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
                  >
                    {t(lang, 'useCurrentTimeBtn')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'notes')}
                </label>
                <input
                  type="text"
                  value={checkoutNotesInput}
                  onChange={(e) => setCheckoutNotesInput(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              {checkoutError && (
                <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
                  {checkoutError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setCheckoutTarget(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
                >
                  {t(lang, 'recordCheckOutBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Rectify Violation via Exit Permit or Leave Request */}
      {rectifyTarget && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base flex items-center gap-2">
                  <ShieldCheck size={18} className="text-[var(--primary-text)]" />
                  <span>{t(lang, 'rectifyModalTitle')}</span>
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {rectifyTarget.employeeName} · {rectifyTarget.date} · {rectifyTarget.workSite}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRectifyTarget(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Violation Summary Strip */}
            <div className="px-5 py-3 bg-[var(--status-warn-bg)] border-b border-[var(--status-warn-border)] text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-[var(--status-warn-text)]">
                {rectifyTarget.lateMinutes > 0 &&
                  `${t(lang, 'lateArrivalTag')}: ${formatAttendanceDuration(rectifyTarget.lateMinutes, lang)}`}
                {rectifyTarget.lateMinutes > 0 && rectifyTarget.earlyExitMinutes > 0 ? ' · ' : ''}
                {rectifyTarget.earlyExitMinutes > 0 &&
                  `${t(lang, 'earlyDepartureTag')}: ${formatAttendanceDuration(rectifyTarget.earlyExitMinutes, lang)}`}
              </div>
              <span className="font-mono-tabular text-[var(--text-muted)]">
                {rectifyTarget.checkInTime} → {rectifyTarget.checkOutTime || '--:--'}
              </span>
            </div>

            {/* Switcher Tabs: Permit vs Leave */}
            <div className="px-5 pt-4">
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)]">
                {allowPermitRect && (
                  <button
                    type="button"
                    onClick={() => {
                      setRectifyTab('exit_permit');
                      setRectifyError('');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                      rectifyTab === 'exit_permit'
                        ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    <DoorOpen size={14} />
                    <span>{t(lang, 'rectifyWithPermit')}</span>
                  </button>
                )}
                {allowLeaveRect && (
                  <button
                    type="button"
                    onClick={() => {
                      setRectifyTab('leave');
                      setRectifyError('');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                      rectifyTab === 'leave'
                        ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    <Calendar size={14} />
                    <span>{t(lang, 'rectifyWithLeave')}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {rectifyTab === 'exit_permit' ? (
                <form onSubmit={handleRectifySubmitPermit} className="space-y-4">
                  {rectifyMonthlyExitUsage && (
                    <div className="p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[var(--text-muted)]">{t(lang, 'exitMonthlyQuotaLabel')}</span>
                      <span className="font-mono-tabular font-semibold">
                        {t(lang, 'exitMonthlyRemainingLabel')}:{' '}
                        <span className="text-[var(--primary-text)]">
                          {formatMinutesLabel(rectifyMonthlyExitUsage.remainingMinutes, lang)}
                        </span>
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                        {lang === 'ar' ? 'من الساعة' : 'From Time'} *
                      </label>
                      <input
                        type="time"
                        value={permitExitTime}
                        onChange={(e) => setPermitExitTime(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                        {lang === 'ar' ? 'إلى الساعة' : 'To Time'} *
                      </label>
                      <input
                        type="time"
                        value={permitReturnTime}
                        onChange={(e) => setPermitReturnTime(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'exitReasonType')}
                    </label>
                    <select
                      value={permitReasonType}
                      onChange={(e) => setPermitReasonType(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    >
                      {EXIT_REASON_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'notes')}
                    </label>
                    <textarea
                      rows={2}
                      value={permitNotes}
                      onChange={(e) => setPermitNotes(e.target.value)}
                      className="w-full p-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                    />
                  </div>

                  <div className="text-xs font-mono-tabular text-[var(--text-muted)]">
                    {t(lang, 'exitDuration')}:{' '}
                    <span className="font-bold text-[var(--primary-text)]">
                      {formatMinutesLabel(rectifyPermitDuration, lang)}
                    </span>
                  </div>

                  {rectifyError && (
                    <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
                      {rectifyError}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setRectifyTarget(null)}
                      className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer"
                    >
                      {t(lang, 'cancel')}
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
                    >
                      {t(lang, 'rectifySubmitPermitBtn')}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleRectifySubmitLeave} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'startDate')} *
                      </label>
                      <input
                        type="date"
                        value={leaveStartDate}
                        onChange={(e) => setLeaveStartDate(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'endDate')} *
                      </label>
                      <input
                        type="date"
                        value={leaveEndDate}
                        onChange={(e) => setLeaveEndDate(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'vacationType')}
                      </label>
                      <select
                        value={leaveType}
                        onChange={(e) => setLeaveType(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                      >
                        {settings.vacationTypes.map((vt) => (
                          <option key={vt.id} value={vt.name}>
                            {translateVacationType(vt.name, lang)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'substituteLabel')}
                      </label>
                      <select
                        value={leaveSubstitute}
                        onChange={(e) => setLeaveSubstitute(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                      >
                        <option value="">{lang === 'ar' ? '-- اختياري --' : '-- Optional --'}</option>
                        {employees
                          .filter((emp) => emp.id !== rectifyTarget.employeeId)
                          .map((emp) => (
                            <option key={emp.id} value={emp.fullName}>
                              {emp.fullName}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {rectifyLeaveBalance && (
                    <div className="p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular">
                      <span>
                        {t(lang, 'netWorkDaysLabel')}:{' '}
                        <strong className="text-[var(--primary-text)]">{rectifyEffectiveLeaveDays}</strong>
                      </span>
                      <span>
                        {t(lang, 'remainingDays')}:{' '}
                        <strong>
                          {rectifyLeaveBalance.remainingDays} / {rectifyLeaveBalance.annualLimit}
                        </strong>
                      </span>
                    </div>
                  )}

                  {rectifySubPolicy.conflictingDuty && rectifySubPolicy.exceedsTwoDayLimit && !rectifySubPolicy.approvedException && (
                    <div className="p-3 rounded-lg bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] space-y-2 text-xs">
                      <p className="font-semibold text-[var(--status-warn-text)]">{t(lang, 'substituteTwoDayHint')}</p>
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-[var(--text-main)]">
                        <input
                          type="checkbox"
                          checked={requestSubException}
                          onChange={(e) => setRequestSubException(e.target.checked)}
                          className="accent-[var(--primary)] rounded"
                        />
                        <span>{t(lang, 'exceptionCheckboxLabel')}</span>
                      </label>
                      {requestSubException && (
                        <input
                          type="text"
                          value={subExceptionReason}
                          onChange={(e) => setSubExceptionReason(e.target.value)}
                          placeholder={t(lang, 'exceptionReasonPlaceholder')}
                          className="w-full px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs"
                        />
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'notes')}
                    </label>
                    <textarea
                      rows={2}
                      value={leaveNotes}
                      onChange={(e) => setLeaveNotes(e.target.value)}
                      className="w-full p-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                    />
                  </div>

                  {rectifyError && (
                    <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
                      {rectifyError}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setRectifyTarget(null)}
                      className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer"
                    >
                      {t(lang, 'cancel')}
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
                    >
                      {t(lang, 'rectifySubmitLeaveBtn')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Modal 3: Recorded GPS Map Preview Modal */}
      {inspectMapRecord && inspectMapRecord.checkInLat !== undefined && inspectMapRecord.checkInLng !== undefined && (
        <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base flex items-center gap-2">
                  <MapPin size={17} className="text-[var(--primary-text)]" />
                  <span>{inspectMapRecord.employeeName}</span>
                </h3>
                <p className="text-xs text-[var(--text-muted)] font-mono-tabular">
                  {inspectMapRecord.date} · {inspectMapRecord.workSite} · {inspectMapRecord.checkInTime}
                  {inspectMapRecord.checkOutTime ? ` → ${inspectMapRecord.checkOutTime}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectMapRecord(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <InteractiveGeoMap
                mode="record-inspect"
                theme={settings.currentTheme}
                lang={lang}
                workSites={effectiveWorkSites}
                selectedSiteName={inspectMapRecord.workSite}
                matchedSite={
                  effectiveWorkSites.find((s) => s.name === inspectMapRecord.workSite) || effectiveWorkSites[0] || null
                }
                userPosition={{
                  lat: inspectMapRecord.checkInLat,
                  lng: inspectMapRecord.checkInLng,
                  accuracyMeters: inspectMapRecord.checkInAccuracyMeters,
                  label:
                    lang === 'ar'
                      ? `نقطة الدخول (${inspectMapRecord.checkInTime})`
                      : `Check-In Pin (${inspectMapRecord.checkInTime})`,
                }}
                secondaryPosition={
                  inspectMapRecord.checkOutLat !== undefined && inspectMapRecord.checkOutLng !== undefined
                    ? {
                        lat: inspectMapRecord.checkOutLat,
                        lng: inspectMapRecord.checkOutLng,
                        label:
                          lang === 'ar'
                            ? `نقطة الخروج (${inspectMapRecord.checkOutTime || ''})`
                            : `Check-Out Pin (${inspectMapRecord.checkOutTime || ''})`,
                      }
                    : null
                }
                distanceMeters={inspectMapRecord.checkInDistanceMeters ?? null}
                isInsideGeofence={inspectMapRecord.geofenceStatus === 'VerifiedInside'}
                heightClass="h-80"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular text-[var(--text-muted)]">
                <span>
                  GPS: {inspectMapRecord.checkInLat.toFixed(5)}, {inspectMapRecord.checkInLng.toFixed(5)}
                  {inspectMapRecord.checkInDistanceMeters !== undefined
                    ? ` · ${formatDistanceLabel(inspectMapRecord.checkInDistanceMeters, lang)}`
                    : ''}
                </span>
                {inspectMapRecord.integrityDigest && (
                  <span className="px-2 py-0.5 rounded bg-[var(--app-bg)] border border-[var(--border)] text-[var(--primary-text)] font-bold">
                    {inspectMapRecord.integrityDigest}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceView;
