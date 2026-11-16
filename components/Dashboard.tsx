import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Users,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  Plane,
  Hourglass,
  X,
  Check,
  RotateCcw,
  ArrowUpRight,
  CalendarClock,
  Upload,
  Zap,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  TrendingUp,
  LogIn,
  ClipboardList,
  DoorOpen,
  UserX,
} from 'lucide-react';
import {
  AbsenceRecord,
  AppUser,
  AttendanceRecord,
  DepartmentUnit,
  Employee,
  EmployeeRequest,
  ExitPermission,
  Language,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
} from '../types';
import { t, translateRole, translateVacationType } from '../i18n';
import {
  addDaysToStr,
  formatMinutesLabel,
  formatReadableDate,
  getDaysRemaining,
  getElapsedProgress,
  getEmployeeLeaveSummary,
  getEmployeeMonthlyExitUsage,
  getTodayStr,
} from '../utils/leaveCalculations';
import { getVividCardClass } from '../utils/cardColors';
import {
  computeAttendanceMetrics,
  evaluateAttendanceEntry,
  formatAttendanceDuration,
  getShiftScheduleBounds,
  resolveSyncedRectification,
} from '../utils/attendanceCalculations';
import { AvatarWithFallback, StatusLabel } from './UIPrimitives';

interface DashboardProps {
  employees: Employee[];
  vacations: Vacation[];
  exitPermissions: ExitPermission[];
  employeeRequests: EmployeeRequest[];
  substituteExceptions?: SubstituteExceptionRequest[];
  attendanceRecords?: AttendanceRecord[];
  absenceRecords?: AbsenceRecord[];
  orgUnits: DepartmentUnit[];
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  onUpdateVacationStatus: (id: string, status: Vacation['status'], reasonNote?: string) => void;
  onResolveSubstituteException?: (id: string, status: 'Approved' | 'Rejected') => void;
  onOpenQuickRequest: () => void;
  onNavigate: (
    view:
      | 'my_requests'
      | 'attendance'
      | 'attendance_hub'
      | 'violations'
      | 'absences'
      | 'requests'
      | 'org'
      | 'archive'
      | 'ai'
      | 'audit'
      | 'settings',
    subTab?: string
  ) => void;
}

const CHART_COLORS_DARK = ['#C99E38', '#4ADE80', '#9D9689', '#FBBF24', '#8A6B20', '#60A5FA'];
const CHART_COLORS_LIGHT = ['#8C6A1B', '#15803D', '#615B50', '#B45309', '#5A4310', '#2563EB'];

const Dashboard: React.FC<DashboardProps> = ({
  employees,
  vacations,
  exitPermissions,
  employeeRequests,
  substituteExceptions = [],
  attendanceRecords = [],
  absenceRecords = [],
  orgUnits,
  settings,
  lang,
  currentUser,
  onUpdateVacationStatus,
  onResolveSubstituteException,
  onOpenQuickRequest,
  onNavigate,
}) => {
  const [actionModal, setActionModal] = useState<{ id: string; name: string; target: 'Rejected' | 'Returned' } | null>(
    null
  );
  const [actionReason, setActionReason] = useState('');

  const todayStr = getTodayStr();
  const next14Str = addDaysToStr(todayStr, 14);
  const perms = currentUser?.permissions || [];

  const canViewEmployees = perms.includes('view_employees');
  const canManageEmployees = perms.includes('manage_employees');
  const canViewVacations = perms.includes('view_vacations');
  const canManageVacations = perms.includes('manage_vacations');
  const canApproveExceptions =
    currentUser?.role === 'SuperAdmin' ||
    currentUser?.role === 'Admin' ||
    currentUser?.role === 'Manager' ||
    perms.includes('approve_exceptions');
  const canViewAttendance =
    perms.includes('view_attendance') ||
    perms.includes('view_attendance_sheet') ||
    perms.includes('manage_attendance');
  const canManageAttendance =
    currentUser?.role !== 'Employee' &&
    (perms.includes('manage_attendance') || perms.includes('view_attendance_sheet'));
  const canViewViolations = perms.includes('view_violations') || perms.includes('manage_violations');
  const canManageViolations = perms.includes('manage_violations');
  const canViewAbsences = perms.includes('view_absences') || perms.includes('manage_absences');
  const canViewOrg = perms.includes('view_org');
  const canViewMyRequests = perms.includes('view_my_requests');

  const chartColors = settings.currentTheme === 'dark' ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;

  // Linked employee profile for scoped / Employee views
  const linkedEmployee = useMemo(() => {
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
    return byMatch || (currentUser.role === 'Employee' ? employees[0] : undefined);
  }, [currentUser, employees]);

  const attCfg = settings.attendanceConfig;
  const stdBounds = getShiftScheduleBounds('standard', attCfg);
  const exemptEmployeesCount = useMemo(
    () => employees.filter((e) => Boolean(e.biometricExempt)).length,
    [employees]
  );

  const scopedAttendance = useMemo(() => {
    const list = canManageAttendance
      ? attendanceRecords
      : linkedEmployee
      ? attendanceRecords.filter((r) => r.employeeId === linkedEmployee.id)
      : [];
    return [...list].sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      return cmp !== 0 ? cmp : b.checkInTime.localeCompare(a.checkInTime);
    });
  }, [attendanceRecords, canManageAttendance, linkedEmployee]);

  const attMetrics = useMemo(
    () => computeAttendanceMetrics(scopedAttendance, exitPermissions, vacations, attCfg),
    [scopedAttendance, exitPermissions, vacations, attCfg]
  );

  const myLeaveSummary = useMemo(() => {
    if (!linkedEmployee) return null;
    return getEmployeeLeaveSummary(linkedEmployee, vacations, settings, new Date().getFullYear());
  }, [linkedEmployee, vacations, settings]);

  const myExitUsage = useMemo(() => {
    if (!linkedEmployee) return null;
    return getEmployeeMonthlyExitUsage(linkedEmployee.id, todayStr, exitPermissions);
  }, [linkedEmployee, todayStr, exitPermissions]);

  const myRecentRequests = useMemo(() => {
    if (!linkedEmployee) return [];
    const items: Array<{ id: string; kind: string; title: string; date: string; status: string }> = [];
    vacations
      .filter((v) => v.employeeId === linkedEmployee.id)
      .forEach((v) =>
        items.push({
          id: `v-${v.id}`,
          kind: lang === 'ar' ? 'إجازة' : 'Leave',
          title: `${translateVacationType(v.type, lang)} (${v.days} ${t(lang, 'workDays')})`,
          date: v.startDate,
          status: v.status,
        })
      );
    exitPermissions
      .filter((ex) => ex.employeeId === linkedEmployee.id)
      .forEach((ex) =>
        items.push({
          id: `ex-${ex.id}`,
          kind: lang === 'ar' ? 'إذن خروج' : 'Exit Permit',
          title: `${ex.exitTime} → ${ex.returnTime} (${ex.reasonType})`,
          date: ex.date,
          status: ex.status,
        })
      );
    employeeRequests
      .filter((req) => req.employeeId === linkedEmployee.id)
      .forEach((req) =>
        items.push({
          id: `req-${req.id}`,
          kind: lang === 'ar' ? 'طلب إداري' : 'HR Request',
          title: req.title,
          date: req.targetDate,
          status: req.status,
        })
      );
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  }, [linkedEmployee, vacations, exitPermissions, employeeRequests, lang]);

  const myPendingCount = useMemo(
    () => myRecentRequests.filter((x) => x.status === 'Pending').length,
    [myRecentRequests]
  );

  const myWarningsList = useMemo(
    () =>
      scopedAttendance
        .map((rec) => ({
          rec,
          evalRes: evaluateAttendanceEntry(rec.checkInTime, rec.checkOutTime, rec.shiftMode, attCfg),
          synced: resolveSyncedRectification(rec, exitPermissions, vacations),
        }))
        .filter((x) => x.evalRes.violationType !== 'None' && x.synced.status !== 'Resolved')
        .slice(0, 5),
    [scopedAttendance, exitPermissions, vacations, attCfg]
  );

  const activeLeaves = useMemo(
    () =>
      vacations
        .filter((v) => v.status === 'Approved' && v.startDate <= todayStr && v.endDate >= todayStr)
        .sort((a, b) => a.endDate.localeCompare(b.endDate)),
    [vacations, todayStr]
  );

  const activeLeaveEmployeeIds = useMemo(() => new Set(activeLeaves.map((v) => v.employeeId)), [activeLeaves]);

  const activeEmployeesCount = useMemo(
    () =>
      employees.filter((e) => {
        if (activeLeaveEmployeeIds.has(e.id)) return false;
        const s = String(e.status).toLowerCase();
        return !s.includes('terminated') && !s.includes('resigned');
      }).length,
    [employees, activeLeaveEmployeeIds]
  );

  const pendingVacations = useMemo(
    () =>
      vacations
        .filter((v) => v.status === 'Pending')
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [vacations]
  );

  const pendingExitsCount = useMemo(
    () => exitPermissions.filter((e) => e.status === 'Pending').length,
    [exitPermissions]
  );
  const pendingHrRequestsCount = useMemo(
    () => employeeRequests.filter((r) => r.status === 'Pending').length,
    [employeeRequests]
  );
  const pendingExceptions = useMemo(
    () => substituteExceptions.filter((e) => e.status === 'Pending'),
    [substituteExceptions]
  );
  const totalPendingRequests =
    pendingVacations.length + pendingExitsCount + pendingHrRequestsCount + pendingExceptions.length;

  const brandingOrgName =
    lang === 'ar'
      ? settings.branding?.orgNameAr || t(lang, 'brandTitle')
      : settings.branding?.orgNameEn || t(lang, 'brandTitle');

  const upcomingLeaves = useMemo(
    () =>
      vacations
        .filter((v) => v.status === 'Approved' && v.startDate > todayStr && v.startDate <= next14Str)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [vacations, todayStr, next14Str]
  );

  const departmentsSummary = useMemo(() => {
    const map = new Map<string, { name: string; total: number; away: number }>();
    employees.forEach((emp) => {
      const dept = emp.department || (lang === 'ar' ? 'غير مصنف' : 'Unassigned');
      if (!map.has(dept)) map.set(dept, { name: dept, total: 0, away: 0 });
      const entry = map.get(dept)!;
      entry.total++;
      if (activeLeaveEmployeeIds.has(emp.id)) entry.away++;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [employees, activeLeaveEmployeeIds, lang]);

  const contractChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach((curr) => {
      const type = curr.contractType || (lang === 'ar' ? 'غير محدد' : 'Unspecified');
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [employees, lang]);

  const leaveTypeChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    vacations
      .filter((v) => v.status !== 'Rejected')
      .forEach((v) => {
        const label = translateVacationType(v.type, lang);
        counts[label] = (counts[label] || 0) + (Number(v.days) || 1);
      });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [vacations, lang]);

  const handleConfirmAction = () => {
    if (!actionModal) return;
    onUpdateVacationStatus(actionModal.id, actionModal.target, actionReason.trim());
    setActionModal(null);
    setActionReason('');
  };

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Quick Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[var(--border)]">
        <div>
          <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">
            {t(lang, 'navDashboard')}
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            {brandingOrgName} · {formatReadableDate(todayStr, lang)}
            {currentUser ? ` · ${translateRole(currentUser.role, lang)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageEmployees && (
            <button
              type="button"
              onClick={() => onNavigate('org', 'employees')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-sm font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload size={16} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'importExcel')}</span>
            </button>
          )}
          {canViewAttendance && (
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-sm font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Clock size={16} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'openAttendancePageBtn')}</span>
            </button>
          )}
          {(canViewMyRequests || canManageVacations) && (
            <button
              type="button"
              onClick={onOpenQuickRequest}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Zap size={16} />
              <span>{t(lang, 'quickRequestBtn')}</span>
            </button>
          )}
        </div>
      </div>

      {/* 4-Column KPI Strip: Org KPIs when permitted, Personal KPIs for Employee role */}
      {canViewEmployees || canViewVacations ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {canViewEmployees ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('org', 'employees')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('org', 'employees');
                }
              }}
              className={`${getVividCardClass(0)} p-5 rounded-xl flex items-center justify-between`}
            >
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'totalEmployees')}</p>
                <p className="font-display text-3xl font-bold tabular-nums text-[var(--text-main)]">
                  {employees.length}
                </p>
                <p className="text-xs text-[var(--primary-text)] tabular-nums font-medium">
                  {orgUnits.length || departmentsSummary.length} {t(lang, 'departmentsCount')}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-cyan-500/15 text-cyan-400">
                <Users size={22} />
              </div>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('my_requests', 'leave')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('my_requests', 'leave');
                }
              }}
              className={`${getVividCardClass(0)} p-5 rounded-xl flex items-center justify-between`}
            >
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'remainingDays')}</p>
                <p className="font-display text-3xl font-bold tabular-nums text-[var(--text-main)]">
                  {myLeaveSummary?.remainingDays ?? 0}
                </p>
                <p className="text-xs text-[var(--text-muted)] tabular-nums">
                  / {myLeaveSummary?.annualLimit ?? 24} {t(lang, 'workDays')}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-cyan-500/15 text-cyan-400">
                <Calendar size={22} />
              </div>
            </div>
          )}

          {canViewEmployees ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('org', 'employees')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('org', 'employees');
                }
              }}
              className={`${getVividCardClass(1)} p-5 rounded-xl flex items-center justify-between`}
            >
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'activeStaff')}</p>
                <p className="font-display text-3xl font-bold tabular-nums text-[var(--text-main)]">
                  {activeEmployeesCount}
                </p>
                <p className="text-xs text-[var(--status-success-text)] tabular-nums">
                  {employees.length > 0 ? Math.round((activeEmployeesCount / employees.length) * 100) : 0}%{' '}
                  {lang === 'ar' ? 'نسبة التواجد' : 'availability'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-emerald-500/15 text-emerald-400">
                <CheckCircle2 size={22} />
              </div>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('my_requests', 'attendance')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('my_requests', 'attendance');
                }
              }}
              className={`${getVividCardClass(1)} p-5 rounded-xl flex items-center justify-between`}
            >
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--text-muted)]">
                  {t(lang, 'attendanceComplianceRateLabel')}
                </p>
                <p className="font-display text-3xl font-bold tabular-nums text-[var(--status-success-text)]">
                  {attMetrics.compliancePercent}%
                </p>
                <p className="text-xs text-[var(--text-muted)] tabular-nums">
                  +{formatAttendanceDuration(attMetrics.totalOvertimeMinutes, lang)} {t(lang, 'overtimeCol')}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-emerald-500/15 text-emerald-400">
                <CheckCircle2 size={22} />
              </div>
            </div>
          )}

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate(canViewVacations ? 'requests' : 'my_requests', canViewVacations ? 'leaves' : 'leave')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate(canViewVacations ? 'requests' : 'my_requests', canViewVacations ? 'leaves' : 'leave');
              }
            }}
            className={`${getVividCardClass(2)} p-5 rounded-xl flex items-center justify-between`}
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'onLeaveToday')}</p>
              <p className="font-display text-3xl font-bold tabular-nums text-[var(--text-main)]">
                {canViewVacations ? activeLeaves.length : 0}
              </p>
              <p className="text-xs text-[var(--text-muted)] tabular-nums">
                {canViewVacations
                  ? `${upcomingLeaves.length} ${lang === 'ar' ? 'إجازة قادمة' : 'upcoming'}`
                  : lang === 'ar'
                  ? 'حسب الصلاحية'
                  : 'Scoped view'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/15 text-amber-400">
              <Plane size={22} />
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate(canViewVacations ? 'requests' : 'my_requests', canViewVacations ? 'leaves' : 'exit')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate(canViewVacations ? 'requests' : 'my_requests', canViewVacations ? 'leaves' : 'exit');
              }
            }}
            className={`${getVividCardClass(3)} p-5 rounded-xl flex items-center justify-between`}
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'pendingRequests')}</p>
              <p className="font-display text-3xl font-bold tabular-nums text-[var(--text-main)]">
                {canViewVacations ? totalPendingRequests : myPendingCount}
              </p>
              <span className="text-xs font-medium text-rose-400 inline-flex items-center gap-1">
                <span>{canViewVacations ? t(lang, 'viewAllVacations') : t(lang, 'navMyRequests')}</span>
                <ArrowUpRight size={12} />
              </span>
            </div>
            <div className="p-3 rounded-lg bg-rose-500/15 text-rose-400">
              <Hourglass size={22} />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('my_requests', 'leave')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('my_requests', 'leave');
              }
            }}
            className={`${getVividCardClass(0)} p-5 rounded-xl flex items-center justify-between`}
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'remainingDays')}</p>
              <p className="font-display text-3xl font-bold tabular-nums text-[var(--text-main)]">
                {myLeaveSummary?.remainingDays ?? 0}
              </p>
              <p className="text-xs text-[var(--text-muted)] tabular-nums">
                / {myLeaveSummary?.annualLimit ?? 24} {t(lang, 'workDays')} ({myLeaveSummary?.usedDays ?? 0}{' '}
                {lang === 'ar' ? 'مستخدم' : 'used'})
              </p>
            </div>
            <div className="p-3 rounded-lg bg-cyan-500/15 text-cyan-400">
              <Calendar size={22} />
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('my_requests', 'exit')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('my_requests', 'exit');
              }
            }}
            className={`${getVividCardClass(1)} p-5 rounded-xl flex items-center justify-between`}
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'exitMonthlyRemainingLabel')}</p>
              <p className="font-display text-2xl font-bold tabular-nums text-[var(--text-main)]">
                {myExitUsage ? formatMinutesLabel(myExitUsage.remainingMinutes, lang) : '-'}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'exitMonthlyQuotaLabel')}</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/15 text-emerald-400">
              <DoorOpen size={22} />
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('my_requests', 'attendance')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('my_requests', 'attendance');
              }
            }}
            className={`${getVividCardClass(2)} p-5 rounded-xl flex items-center justify-between`}
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {t(lang, 'attendanceComplianceRateLabel')}
              </p>
              <p className="font-display text-3xl font-bold tabular-nums text-[var(--status-success-text)]">
                {attMetrics.compliancePercent}%
              </p>
              <p className="text-xs text-[var(--text-muted)] tabular-nums">
                {t(lang, 'overtimeCol')}: +{formatAttendanceDuration(attMetrics.totalOvertimeMinutes, lang)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/15 text-amber-400">
              <CheckCircle2 size={22} />
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('my_requests', 'attendance')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('my_requests', 'attendance');
              }
            }}
            className={`${getVividCardClass(3)} p-5 rounded-xl flex items-center justify-between`}
          >
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {lang === 'ar' ? 'الإنذارات والطلبات المعلقة' : 'Warnings & Pending Requests'}
              </p>
              <p className="font-display text-3xl font-bold tabular-nums text-[var(--status-warn-text)]">
                {attMetrics.unrectifiedWarningsCount + myPendingCount}
              </p>
              <span className="text-xs font-medium text-rose-400 inline-flex items-center gap-1">
                <span>{t(lang, 'navMyRequests')}</span>
                <ArrowUpRight size={12} />
              </span>
            </div>
            <div className="p-3 rounded-lg bg-rose-500/15 text-rose-400">
              <AlertTriangle size={22} />
            </div>
          </div>
        </div>
      )}

      {/* Clear Executive Attendance & Overtime Summary Section (Permission-Scoped for All Roles) */}
      {canViewAttendance && (
        <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-violet-500/15 text-violet-400">
                <Clock size={19} />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                  {t(lang, 'dashboardAttendanceSummaryTitle')}
                </h3>
                <p className="text-xs text-[var(--text-muted)] font-mono-tabular">
                  {canManageAttendance
                    ? lang === 'ar'
                      ? `نظرة شاملة لحضور الموظفين · الجدول القياسي ${stdBounds.start}–${stdBounds.end} · إجمالي السجلات: ${attMetrics.total}${
                          exemptEmployeesCount > 0 ? ` · ${t(lang, 'biometricExemptBadge')}: ${exemptEmployeesCount}` : ''
                        }`
                      : `Organization-wide shift overview · Standard ${stdBounds.start}–${stdBounds.end} · Records: ${attMetrics.total}${
                          exemptEmployeesCount > 0 ? ` · ${t(lang, 'biometricExemptBadge')}: ${exemptEmployeesCount}` : ''
                        }`
                    : lang === 'ar'
                    ? `ملخص دوامك الشخصي${linkedEmployee ? ` (${linkedEmployee.fullName})` : ''} · الجدول القياسي ${stdBounds.start}–${stdBounds.end}${
                        linkedEmployee?.biometricExempt ? ` · ${t(lang, 'biometricExemptBadge')}` : ''
                      }`
                    : `Your attendance summary${linkedEmployee ? ` (${linkedEmployee.fullName})` : ''} · Standard ${stdBounds.start}–${stdBounds.end}${
                        linkedEmployee?.biometricExempt ? ` · ${t(lang, 'biometricExemptBadge')}` : ''
                      }`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canViewAbsences && (
                <button
                  type="button"
                  onClick={() => onNavigate('attendance_hub', 'absences')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-main)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
                >
                  <UserX size={14} className="text-[var(--primary-text)]" />
                  <span>
                    {t(lang, 'openAbsencesPageBtn')} ({absenceRecords.filter((a) => a.status === 'Open').length})
                  </span>
                </button>
              )}
              {canViewViolations && (
                <button
                  type="button"
                  onClick={() => onNavigate('attendance_hub', 'violations')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                >
                  <ShieldAlert size={14} />
                  <span>
                    {t(lang, 'openViolationsPageBtn')} ({attMetrics.pendingRectificationCount})
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  canManageAttendance
                    ? onNavigate('attendance_hub', 'sheet')
                    : onNavigate('my_requests', 'attendance')
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
              >
                <span>{t(lang, 'openAttendancePageBtn')}</span>
                <ArrowUpRight size={13} />
              </button>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* 5 Clear Interactive Vivid Attendance Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  canManageAttendance
                    ? onNavigate('attendance_hub', 'sheet')
                    : onNavigate('my_requests', 'attendance')
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    canManageAttendance
                      ? onNavigate('attendance_hub', 'sheet')
                      : onNavigate('my_requests', 'attendance');
                  }
                }}
                className={`${getVividCardClass(5)} p-3.5 rounded-xl space-y-2`}
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>{t(lang, 'attendanceComplianceRateLabel')}</span>
                  <CheckCircle2 size={15} className="text-lime-400" />
                </div>
                <div className="font-display font-mono-tabular text-2xl font-bold text-[var(--status-success-text)]">
                  {attMetrics.compliancePercent}%
                </div>
                <div className="h-1.5 rounded-full bg-[var(--surface-subtle)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--status-success-text)] rounded-full"
                    style={{ width: `${attMetrics.compliancePercent}%` }}
                  />
                </div>
                <p className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                  {attMetrics.compliantCount}/{attMetrics.total}{' '}
                  {lang === 'ar' ? 'سجل منتظم' : 'compliant'}
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  canManageAttendance
                    ? onNavigate('attendance_hub', 'sheet')
                    : onNavigate('my_requests', 'attendance')
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    canManageAttendance
                      ? onNavigate('attendance_hub', 'sheet')
                      : onNavigate('my_requests', 'attendance');
                  }
                }}
                className={`${getVividCardClass(6)} p-3.5 rounded-xl space-y-1.5`}
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>{t(lang, 'overtimeHoursLabel')}</span>
                  <TrendingUp size={15} className="text-sky-400" />
                </div>
                <div className="font-display font-mono-tabular text-2xl font-bold text-sky-400">
                  {formatAttendanceDuration(attMetrics.totalOvertimeMinutes, lang)}
                </div>
                <p className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                  {attMetrics.overtimePercentOfWorked}% {lang === 'ar' ? 'من ساعات العمل' : 'of worked'} (×
                  {attCfg?.overtimeMultiplier ?? 1.5})
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  canViewViolations
                    ? onNavigate('attendance_hub', 'violations')
                    : onNavigate('my_requests', 'attendance')
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    canViewViolations
                      ? onNavigate('attendance_hub', 'violations')
                      : onNavigate('my_requests', 'attendance');
                  }
                }}
                className={`${getVividCardClass(7)} p-3.5 rounded-xl space-y-1.5`}
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>{t(lang, 'lateArrivalTag')}</span>
                  <LogIn size={15} className="text-orange-400" />
                </div>
                <div className="font-display font-mono-tabular text-2xl font-bold text-orange-400">
                  {attMetrics.latePercent}%
                </div>
                <p className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                  {attMetrics.lateCount} {lang === 'ar' ? 'حالة تأخير' : 'late entries'}
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  canViewViolations
                    ? onNavigate('attendance_hub', 'violations')
                    : onNavigate('my_requests', 'attendance')
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    canViewViolations
                      ? onNavigate('attendance_hub', 'violations')
                      : onNavigate('my_requests', 'attendance');
                  }
                }}
                className={`${getVividCardClass(8)} p-3.5 rounded-xl space-y-1.5`}
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>{t(lang, 'earlyDepartureTag')}</span>
                  <AlertTriangle size={15} className="text-pink-400" />
                </div>
                <div className="font-display font-mono-tabular text-2xl font-bold text-pink-400">
                  {attMetrics.earlyExitPercent}%
                </div>
                <p className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                  {attMetrics.earlyExitCount} {lang === 'ar' ? 'حالة خروج مبكر' : 'early exits'}
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  canManageViolations
                    ? onNavigate('attendance_hub', 'violations')
                    : onNavigate('my_requests', 'attendance')
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    canManageViolations
                      ? onNavigate('attendance_hub', 'violations')
                      : onNavigate('my_requests', 'attendance');
                  }
                }}
                className={`${getVividCardClass(9)} p-3.5 rounded-xl space-y-1.5`}
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>
                    {canManageViolations
                      ? lang === 'ar'
                        ? 'مناوبات وطلبات تصحيح'
                        : 'Active / Review'
                      : lang === 'ar'
                      ? 'الإنذارات والمناوبات'
                      : 'Active / Warnings'}
                  </span>
                  <ShieldAlert size={15} className="text-fuchsia-400" />
                </div>
                <div className="font-display font-mono-tabular text-2xl font-bold text-[var(--text-main)]">
                  {attMetrics.openShifts} /{' '}
                  <span className="text-fuchsia-400">
                    {canManageViolations
                      ? attMetrics.pendingRectificationCount
                      : attMetrics.unrectifiedWarningsCount}
                  </span>
                </div>
                <p className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                  {canManageViolations
                    ? `${attMetrics.pendingRectificationCount} ${lang === 'ar' ? 'بانتظار الاعتماد' : 'pending'}`
                    : `${attMetrics.unrectifiedWarningsCount} ${lang === 'ar' ? 'إنذار يحتاج تصحيح' : 'warnings'}`}
                </p>
              </div>
            </div>

            {/* Compact Recent Attendance Shifts Table inside Dashboard Summary */}
            <div className="border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-start">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                    <tr>
                      {canManageAttendance && <th className="px-4 py-2.5 text-start">{t(lang, 'employeeCol')}</th>}
                      <th className="px-4 py-2.5 text-start">{t(lang, 'attendanceDateLabel')}</th>
                      <th className="px-4 py-2.5 text-start">{t(lang, 'workSiteLabel')}</th>
                      <th className="px-4 py-2.5 text-start">
                        {lang === 'ar' ? 'الدخول / الخروج' : 'Check-In → Out'}
                      </th>
                      <th className="px-4 py-2.5 text-start">{t(lang, 'overtimeCol')}</th>
                      <th className="px-4 py-2.5 text-start">{t(lang, 'adherencePercentCol')}</th>
                      <th className="px-4 py-2.5 text-start">{t(lang, 'statusCol')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {scopedAttendance.slice(0, 5).map((rec) => {
                      const evalRes = evaluateAttendanceEntry(rec.checkInTime, rec.checkOutTime, rec.shiftMode, attCfg);
                      const otMins = rec.overtimeMinutes !== undefined ? rec.overtimeMinutes : evalRes.overtimeMinutes;
                      const synced = resolveSyncedRectification(rec, exitPermissions, vacations);
                      return (
                        <tr key={rec.id} className="hover:bg-[var(--surface-subtle)]/40">
                          {canManageAttendance && (
                            <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{rec.employeeName}</td>
                          )}
                          <td className="px-4 py-2.5 font-mono-tabular whitespace-nowrap">
                            {formatReadableDate(rec.date, lang)}
                          </td>
                          <td className="px-4 py-2.5 max-w-[180px] truncate">{rec.workSite}</td>
                          <td className="px-4 py-2.5 font-mono-tabular whitespace-nowrap">
                            {rec.checkInTime} → {rec.checkOutTime || '--:--'}
                          </td>
                          <td className="px-4 py-2.5 font-mono-tabular font-semibold text-[var(--primary-text)] whitespace-nowrap">
                            {otMins > 0 ? `+${formatAttendanceDuration(otMins, lang)}` : '-'}
                          </td>
                          <td className="px-4 py-2.5 font-mono-tabular font-bold">{evalRes.adherencePercent}%</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {evalRes.violationType === 'None' ? (
                              <span className="text-[var(--status-success-text)] font-semibold">
                                {rec.checkOutTime ? t(lang, 'compliantShiftTag') : t(lang, 'activeShiftBadge')}
                              </span>
                            ) : synced.status === 'Resolved' ? (
                              <span className="text-[var(--status-success-text)] font-semibold">
                                {t(lang, 'rectificationStatusResolved')}
                              </span>
                            ) : synced.status === 'Pending' ? (
                              <span className="text-[var(--status-warn-text)] font-semibold">
                                {t(lang, 'rectificationStatusPending')}
                              </span>
                            ) : (
                              <span className="text-[var(--status-danger-text)] font-semibold">
                                {canManageViolations
                                  ? evalRes.violationType === 'Both'
                                    ? t(lang, 'bothViolationsTag')
                                    : evalRes.violationType === 'LateArrival'
                                    ? t(lang, 'lateArrivalTag')
                                    : t(lang, 'earlyDepartureTag')
                                  : t(lang, 'rectificationStatusUnresolved')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {scopedAttendance.length === 0 && (
                      <tr>
                        <td
                          colSpan={canManageAttendance ? 7 : 6}
                          className="px-4 py-6 text-center text-[var(--text-muted)]"
                        >
                          {lang === 'ar'
                            ? 'لا توجد سجلات حضور وانصراف مسجلة حتى الآن.'
                            : 'No attendance records yet.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Pending Substitute Exception Requests (Manager Review — gated by permissions) */}
      {canViewVacations && canApproveExceptions && pendingExceptions.length > 0 && (
        <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('requests', 'exceptions')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('requests', 'exceptions');
              }
            }}
            className="px-6 py-4 border-b border-[var(--border)] bg-[var(--status-warn-bg)]/40 flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-[var(--status-warn-bg)]/55 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-teal-500/15 text-teal-400">
                <ShieldCheck size={18} />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                  {t(lang, 'exceptionsQueueTitle')}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {t(lang, 'exceptionsQueueDesc')} · <span className="tabular-nums">{pendingExceptions.length}</span>
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-[var(--primary-text)] hover:underline whitespace-nowrap shrink-0 inline-flex items-center gap-1">
              <span>{t(lang, 'subTabExceptions')}</span>
              <ArrowUpRight size={13} />
            </span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {pendingExceptions.map((ex) => (
              <div key={ex.id} className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <div className="font-semibold text-sm text-[var(--text-main)]">
                    {ex.employeeName}{' '}
                    <span className="text-xs font-normal text-[var(--text-muted)]">
                      ({lang === 'ar' ? `بديل عن ${ex.coveringForEmployeeName}` : `Covering ${ex.coveringForEmployeeName}`})
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono-tabular">
                    {ex.requestedDays} {t(lang, 'workDays')} ({ex.requestedStartDate} → {ex.requestedEndDate})
                    {ex.reason ? ` · ${ex.reason}` : ''}
                  </div>
                </div>
                {canApproveExceptions && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onResolveSubstituteException?.(ex.id, 'Approved')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                    >
                      <Check size={14} />
                      <span>{t(lang, 'approveExceptionBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolveSubstituteException?.(ex.id, 'Rejected')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                    >
                      <X size={14} />
                      <span>{t(lang, 'reject')}</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pending Requests Action Queue (HR / Manager / Admin / Viewer with view_vacations) */}
      {canViewVacations && pendingVacations.length > 0 && (
        <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('requests', 'leaves')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('requests', 'leaves');
              }
            }}
            className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-[var(--surface-subtle)]/80 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400">
                <Hourglass size={18} />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                  {t(lang, 'pendingQueueTitle')}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {t(lang, 'pendingQueueDesc')} · <span className="tabular-nums">{pendingVacations.length}</span>
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-[var(--primary-text)] hover:underline whitespace-nowrap shrink-0 inline-flex items-center gap-1">
              <span>{t(lang, 'viewAllVacations')}</span>
              <ArrowUpRight size={13} />
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-6 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                  <th className="px-6 py-3 text-start font-semibold">{t(lang, 'vacationType')}</th>
                  <th className="px-6 py-3 text-start font-semibold">{t(lang, 'startDate')} / {t(lang, 'endDate')}</th>
                  <th className="px-6 py-3 text-end font-semibold">{t(lang, 'workDays')}</th>
                  {canManageVacations && (
                    <th className="px-6 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pendingVacations.map((vac) => {
                  const emp = employees.find((e) => e.id === vac.employeeId);
                  return (
                    <tr key={vac.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <AvatarWithFallback name={vac.employeeName} sizeClass="w-8 h-8" />
                          <div>
                            <div className="font-semibold text-[var(--text-main)]">{vac.employeeName}</div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {emp?.department || '-'}
                              {vac.substitute ? ` · ${t(lang, 'substituteLabel')}: ${vac.substitute}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-[var(--text-main)] font-medium">
                        {translateVacationType(vac.type, lang)}
                      </td>
                      <td className="px-6 py-3.5 text-xs font-mono-tabular text-[var(--text-muted)]">
                        {vac.startDate} → {vac.endDate}
                      </td>
                      <td className="px-6 py-3.5 text-end font-mono-tabular font-semibold text-[var(--text-main)]">
                        {vac.days}
                      </td>
                      {canManageVacations && (
                        <td className="px-6 py-3.5 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onUpdateVacationStatus(vac.id, 'Approved')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
                              title={t(lang, 'approve')}
                            >
                              <Check size={14} />
                              <span>{t(lang, 'approve')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setActionModal({ id: vac.id, name: vac.employeeName, target: 'Returned' })}
                              className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--primary-text)] hover:bg-[var(--primary-soft)] transition-colors cursor-pointer"
                              title={t(lang, 'returnForEdit')}
                            >
                              <RotateCcw size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setActionModal({ id: vac.id, name: vac.employeeName, target: 'Rejected' })}
                              className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] transition-colors cursor-pointer"
                              title={t(lang, 'reject')}
                            >
                              <X size={15} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Personal Warnings & Recent Requests for Users without Company Leaves Queue (e.g. Employee) */}
      {!canViewVacations && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {canViewAttendance && (
            <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onNavigate('attendance')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate('attendance');
                  }
                }}
                className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--surface-subtle)]/80 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <AlertTriangle size={18} className="text-yellow-400" />
                  <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                    {t(lang, 'violationsAlertTitle')}
                  </h3>
                </div>
                <span className="text-xs font-semibold text-[var(--primary-text)] hover:underline inline-flex items-center gap-1">
                  <span>{t(lang, 'openAttendancePageBtn')}</span>
                  <ArrowUpRight size={13} />
                </span>
              </div>

              <div className="p-4 divide-y divide-[var(--border)]">
                {myWarningsList.length > 0 ? (
                  myWarningsList.map(({ rec, evalRes, synced }) => (
                    <div key={rec.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-bold text-[var(--status-danger-text)]">
                          {rec.date} ·{' '}
                          {evalRes.lateMinutes > 0
                            ? `${t(lang, 'lateArrivalTag')} (${formatAttendanceDuration(evalRes.lateMinutes, lang)})`
                            : ''}
                          {evalRes.lateMinutes > 0 && evalRes.earlyExitMinutes > 0 ? ' · ' : ''}
                          {evalRes.earlyExitMinutes > 0
                            ? `${t(lang, 'earlyDepartureTag')} (${formatAttendanceDuration(evalRes.earlyExitMinutes, lang)})`
                            : ''}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)] truncate">
                          {rec.warningNote || `${rec.workSite} · ${rec.entryLocation}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigate('attendance')}
                        className="px-2.5 py-1 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold hover:opacity-90 cursor-pointer shrink-0"
                      >
                        {synced.status === 'Pending'
                          ? t(lang, 'rectificationStatusPending')
                          : t(lang, 'rectifyViolationBtn')}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                    {lang === 'ar' ? 'لا توجد إنذارات حضور حالياً.' : 'No active attendance warnings.'}
                  </div>
                )}
              </div>
            </section>
          )}

          {canViewMyRequests && (
            <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onNavigate('my_requests')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate('my_requests');
                  }
                }}
                className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--surface-subtle)]/80 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <ClipboardList size={18} className="text-blue-400" />
                  <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                    {t(lang, 'navMyRequests')}
                  </h3>
                </div>
                <span className="text-xs font-semibold text-[var(--primary-text)] hover:underline inline-flex items-center gap-1">
                  <span>{t(lang, 'viewAllVacations')}</span>
                  <ArrowUpRight size={13} />
                </span>
              </div>
              <div className="p-4 divide-y divide-[var(--border)]">
                {myRecentRequests.length > 0 ? (
                  myRecentRequests.map((item) => (
                    <div key={item.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--text-main)] truncate">{item.title}</p>
                        <p className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                          {item.kind} · {item.date}
                        </p>
                      </div>
                      <StatusLabel status={item.status} lang={lang} />
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                    {lang === 'ar' ? 'لا توجد طلبات مسجلة حالياً.' : 'No requests submitted yet.'}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Active Leaves Tracker + Upcoming Leaves (Only with view_vacations permission) */}
      {canViewVacations && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="xl:col-span-2 bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden flex flex-col">
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('requests', 'leaves')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('requests', 'leaves');
                }
              }}
              className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-4 cursor-pointer hover:bg-[var(--surface-subtle)]/80 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/15 text-purple-400">
                  <Clock size={18} />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                    {t(lang, 'currentLeavesTitle')}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">{t(lang, 'currentLeavesDesc')}</p>
                </div>
              </div>
              <span className="text-xs font-mono-tabular font-semibold text-purple-400 inline-flex items-center gap-1">
                <span>{activeLeaves.length}</span>
                <ArrowUpRight size={13} />
              </span>
            </div>

            {activeLeaves.length > 0 ? (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm text-start">
                  <thead className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                    <tr>
                      <th className="px-6 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                      <th className="px-6 py-3 text-start font-semibold">{t(lang, 'vacationType')}</th>
                      <th className="px-6 py-3 text-start font-semibold">
                        {t(lang, 'startDate')} — {t(lang, 'endDate')}
                      </th>
                      <th className="px-6 py-3 text-start font-semibold">{t(lang, 'returnDate')}</th>
                      <th className="px-6 py-3 text-end font-semibold">{t(lang, 'daysRemaining')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {activeLeaves.map((leave) => {
                      const daysLeft = getDaysRemaining(leave.endDate);
                      const progress = getElapsedProgress(leave.startDate, leave.endDate);
                      const returnDateStr = addDaysToStr(leave.endDate, 1);
                      const emp = employees.find((e) => e.id === leave.employeeId);
                      return (
                        <tr key={leave.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-3">
                              <AvatarWithFallback name={leave.employeeName} sizeClass="w-8 h-8" />
                              <div>
                                <div className="font-semibold text-[var(--text-main)]">{leave.employeeName}</div>
                                <div className="text-xs text-[var(--text-muted)]">
                                  {emp?.department || '-'}
                                  {emp?.jobTitle ? ` · ${emp.jobTitle}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-3.5">
                            <div className="text-xs font-semibold text-[var(--text-main)]">
                              {translateVacationType(leave.type, lang)}
                            </div>
                            {leave.substitute && (
                              <div className="text-xs text-[var(--text-muted)]">
                                {t(lang, 'substituteLabel')}: {leave.substitute}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3.5">
                            <div className="text-xs font-mono-tabular text-[var(--text-main)] mb-1.5">
                              {leave.startDate} → {leave.endDate}
                            </div>
                            <div className="w-28 h-1.5 bg-[var(--surface-subtle)] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[var(--primary)] rounded-full"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-xs font-semibold text-[var(--status-success-text)] tabular-nums">
                            {formatReadableDate(returnDateStr, lang)}
                          </td>
                          <td className="px-6 py-3.5 text-end text-xs font-mono-tabular font-semibold">
                            {daysLeft === 0 ? (
                              <span className="text-[var(--status-warn-text)]">{t(lang, 'lastDayToday')}</span>
                            ) : (
                              <span className="text-[var(--text-muted)]">
                                {daysLeft} {t(lang, 'daysRemaining')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center flex-1 flex flex-col items-center justify-center">
                <div className="p-3 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] mb-3">
                  <CheckCircle2 size={28} />
                </div>
                <h4 className="font-display font-bold text-[var(--text-main)]">{t(lang, 'allHandsOnDeck')}</h4>
                <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">{t(lang, 'allHandsDesc')}</p>
              </div>
            )}
          </section>

          {/* Upcoming Leaves (Next 14 Days) */}
          <section
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('requests', 'leaves')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('requests', 'leaves');
              }
            }}
            className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden flex flex-col cursor-pointer hover:border-[var(--primary)]/50 transition-colors"
          >
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/15 text-red-400">
                <CalendarClock size={18} />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                  {t(lang, 'upcomingLeavesTitle')}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">{t(lang, 'upcomingLeavesDesc')}</p>
              </div>
            </div>

            <div className="p-4 flex-1 divide-y divide-[var(--border)]">
              {upcomingLeaves.length > 0 ? (
                upcomingLeaves.map((vac) => (
                  <div key={vac.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-sm text-[var(--text-main)] truncate">
                        {vac.employeeName}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {translateVacationType(vac.type, lang)}
                        {vac.substitute ? ` · ${t(lang, 'substituteLabel')}: ${vac.substitute}` : ''}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-xs font-mono-tabular font-semibold text-[var(--primary-text)]">
                        {vac.startDate}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] tabular-nums">
                        {vac.days} {t(lang, 'workDays')}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                  <Calendar size={24} className="mx-auto mb-2 opacity-50" />
                  <p>{t(lang, 'noUpcomingLeaves')}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Charts & Department Availability (Permission-Gated) */}
      {(canViewEmployees || canViewOrg || canViewVacations) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(canViewEmployees || canViewOrg) && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('org', 'departments')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('org', 'departments');
                }
              }}
              className="bg-[var(--card-bg)] p-6 rounded-xl border border-[var(--border)] cursor-pointer hover:border-[var(--primary)]/50 transition-colors"
            >
              <h3 className="font-display text-base font-bold text-[var(--text-main)] mb-4">
                {t(lang, 'deptDistributionChart')}
              </h3>
              <div className="h-72 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart
                    data={departmentsSummary.slice(0, 6)}
                    layout="vertical"
                    margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal vertical={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={130}
                      tick={{ fill: 'var(--text-main)', fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--card-bg)',
                        borderColor: 'var(--border)',
                        borderRadius: '8px',
                        color: 'var(--text-main)',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      dataKey="total"
                      fill="var(--primary)"
                      radius={[0, 4, 4, 0]}
                      name={t(lang, 'totalEmployees')}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {canViewVacations && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('requests', 'balances')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('requests', 'balances');
                }
              }}
              className="bg-[var(--card-bg)] p-6 rounded-xl border border-[var(--border)] cursor-pointer hover:border-[var(--primary)]/50 transition-colors"
            >
              <h3 className="font-display text-base font-bold text-[var(--text-main)] mb-4">
                {t(lang, 'leaveTypeChartTitle')}
              </h3>
              <div className="h-72 w-full" dir="ltr">
                {leaveTypeChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <PieChart>
                      <Pie
                        data={leaveTypeChartData}
                        cx="50%"
                        cy="48%"
                        innerRadius={52}
                        outerRadius={88}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {leaveTypeChartData.map((_, idx) => (
                          <Cell key={`cell-${idx}`} fill={chartColors[idx % chartColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card-bg)',
                          borderColor: 'var(--border)',
                          borderRadius: '8px',
                          color: 'var(--text-main)',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                    {t(lang, 'noVacationsFound')}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-xs text-[var(--text-muted)]">
                {leaveTypeChartData.map((entry, idx) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: chartColors[idx % chartColors.length] }}
                    />
                    <span>{entry.name}</span>
                    <span className="font-mono-tabular font-semibold text-[var(--text-main)]">({entry.value})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(canViewEmployees || canViewOrg) && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('org', 'employees')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate('org', 'employees');
                }
              }}
              className="bg-[var(--card-bg)] p-6 rounded-xl border border-[var(--border)] flex flex-col cursor-pointer hover:border-[var(--primary)]/50 transition-colors"
            >
              <h3 className="font-display text-base font-bold text-[var(--text-main)] mb-4">
                {t(lang, 'contractChartTitle')}
              </h3>
              <div className="space-y-3 flex-1">
                {contractChartData.map((item) => {
                  const pct = employees.length > 0 ? Math.round((item.value / employees.length) * 100) : 0;
                  return (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--text-main)]">{item.name}</span>
                        <span className="font-mono-tabular text-[var(--text-muted)]">
                          {item.value} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-[var(--surface-subtle)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--primary)] rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 mt-4 border-t border-[var(--border)]">
                <h4 className="text-xs font-semibold text-[var(--text-muted)] mb-2">
                  {t(lang, 'deptSummaryTitle')}
                </h4>
                <div className="space-y-2 max-h-36 overflow-y-auto">
                  {departmentsSummary.map((dept) => {
                    const avail = dept.total - dept.away;
                    return (
                      <div key={dept.name} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-main)] truncate max-w-[180px]">{dept.name}</span>
                        <span className="font-mono-tabular text-[var(--text-muted)]">
                          {avail}/{dept.total}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reject / Return Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="font-display font-bold text-[var(--text-main)]">{t(lang, 'resolveRequestTitle')}</h3>
                <p className="text-xs text-[var(--text-muted)]">{actionModal.name}</p>
              </div>
              <StatusLabel status={actionModal.target} lang={lang} />
            </div>

            <textarea
              className="w-full h-28 p-3 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)] resize-none"
              placeholder={t(lang, 'reasonPlaceholder')}
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setActionModal(null);
                  setActionReason('');
                }}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                {t(lang, 'confirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;