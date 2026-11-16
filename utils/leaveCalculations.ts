import {
  Employee,
  ExitPermission,
  Language,
  OfficialHoliday,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
} from '../types';

/** Parse YYYY-MM-DD strictly in local calendar time to avoid UTC timezone off-by-one shifts */
export function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]) - 1;
    const d = Number(match[3]);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function formatLocalYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayStr(): string {
  return formatLocalYYYYMMDD(new Date());
}

export function addDaysToStr(dateStr: string, daysToAdd: number): string {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  d.setDate(d.getDate() + daysToAdd);
  return formatLocalYYYYMMDD(d);
}

export function formatReadableDate(dateStr: string, lang: 'ar' | 'en'): string {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString(lang === 'ar' ? 'ar-LY' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getDaysRemaining(endDateStr: string): number {
  const end = parseLocalDate(endDateStr);
  if (!end) return 0;
  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = end.getTime() - todayLocal.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return days < 0 ? 0 : days;
}

export function getElapsedProgress(startDateStr: string, endDateStr: string): number {
  const start = parseLocalDate(startDateStr);
  const end = parseLocalDate(endDateStr);
  if (!start || !end) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const total = end.getTime() - start.getTime() + 86400000;
  if (total <= 0) return 100;
  const elapsed = today.getTime() - start.getTime() + 86400000;
  return Math.max(5, Math.min(100, Math.round((elapsed / total) * 100)));
}

export function calculateTenure(hireDateStr: string, lang: 'ar' | 'en'): string {
  const hire = parseLocalDate(hireDateStr);
  if (!hire) return '-';
  const now = new Date();
  let years = now.getFullYear() - hire.getFullYear();
  let months = now.getMonth() - hire.getMonth();
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years < 0) return '-';
  if (lang === 'ar') {
    if (years === 0) return `${months} شهر`;
    return months > 0 ? `${years} سنة و ${months} شهر` : `${years} سنة`;
  }
  if (years === 0) return `${months} mo`;
  return months > 0 ? `${years}y ${months}m` : `${years}y`;
}

export interface WorkDaysBreakdown {
  calendarDays: number;
  excludedOffDays: number;
  excludedHolidayDays: number;
  workDays: number;
}

export function isOfficialHoliday(dateStr: string, holidays: OfficialHoliday[]): boolean {
  return holidays.some((h) => dateStr >= h.startDate && dateStr <= (h.endDate || h.startDate));
}

export function calculateWorkDaysBreakdown(
  startStr: string,
  endStr: string,
  workWeekDays: number[] = [1, 2, 3, 4],
  officialHolidays: OfficialHoliday[] = []
): WorkDaysBreakdown {
  const start = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  if (!start || !end || start > end) {
    return { calendarDays: 0, excludedOffDays: 0, excludedHolidayDays: 0, workDays: 0 };
  }

  let calendarDays = 0;
  let excludedOffDays = 0;
  let excludedHolidayDays = 0;
  let workDays = 0;

  const cursor = new Date(start);
  while (cursor <= end) {
    calendarDays++;
    const dayOfWeek = cursor.getDay();
    const str = formatLocalYYYYMMDD(cursor);
    if (!workWeekDays.includes(dayOfWeek)) {
      excludedOffDays++;
    } else if (isOfficialHoliday(str, officialHolidays)) {
      excludedHolidayDays++;
    } else {
      workDays++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return { calendarDays, excludedOffDays, excludedHolidayDays, workDays };
}

export interface EmployeeLeaveSummary {
  employee: Employee;
  annualLimit: number;
  approvedDays: number;
  pendingDays: number;
  remainingDays: number;
  utilizationPercent: number;
  status: 'nominal' | 'near' | 'exceeded';
}

export function getEmployeeLeaveSummary(
  employee: Employee,
  vacations: Vacation[],
  settings: SystemSettings,
  targetYear: number
): EmployeeLeaveSummary {
  const contractConfig = settings.contractTypes.find(
    (c) => c.name.trim().toLowerCase() === employee.contractType.trim().toLowerCase()
  );
  const annualLimit = contractConfig?.annualLeaveLimit ?? 24;

  const yearVacations = vacations.filter((v) => {
    if (v.employeeId !== employee.id) return false;
    const d = parseLocalDate(v.startDate);
    return d ? d.getFullYear() === targetYear : false;
  });

  const approvedDays = yearVacations
    .filter((v) => v.status === 'Approved')
    .reduce((sum, v) => sum + (Number(v.days) || 0), 0);

  const pendingDays = yearVacations
    .filter((v) => v.status === 'Pending' || v.status === 'Returned')
    .reduce((sum, v) => sum + (Number(v.days) || 0), 0);

  const remainingDays = Math.max(0, annualLimit - approvedDays);
  const utilizationPercent =
    annualLimit > 0 ? Math.min(100, Math.round((approvedDays / annualLimit) * 100)) : 0;

  let status: 'nominal' | 'near' | 'exceeded' = 'nominal';
  if (annualLimit > 0) {
    if (approvedDays > annualLimit) status = 'exceeded';
    else if (approvedDays / annualLimit >= 0.8) status = 'near';
  }

  return {
    employee,
    annualLimit,
    approvedDays,
    pendingDays,
    remainingDays,
    utilizationPercent,
    status,
  };
}

export const MONTHLY_EXIT_LIMIT_MINUTES = 360; // 6 hours per employee per month
export const SUBSTITUTE_MAX_LEAVE_DAYS = 2; // Max 2 work days without manager exception

export interface MonthlyExitUsage {
  yearMonth: string;
  usedMinutes: number;
  remainingMinutes: number;
  limitMinutes: number;
  count: number;
}

export function getEmployeeMonthlyExitUsage(
  employeeId: string,
  dateStr: string,
  exitPermissions: ExitPermission[],
  excludePermitId?: string
): MonthlyExitUsage {
  const yearMonth = (dateStr || getTodayStr()).slice(0, 7);
  const matching = exitPermissions.filter(
    (ex) =>
      ex.employeeId === employeeId &&
      ex.id !== excludePermitId &&
      ex.status !== 'Rejected' &&
      (ex.date || '').slice(0, 7) === yearMonth
  );
  const usedMinutes = matching.reduce((sum, ex) => sum + (Number(ex.durationMinutes) || 0), 0);
  return {
    yearMonth,
    usedMinutes,
    remainingMinutes: Math.max(0, MONTHLY_EXIT_LIMIT_MINUTES - usedMinutes),
    limitMinutes: MONTHLY_EXIT_LIMIT_MINUTES,
    count: matching.length,
  };
}

export function formatMinutesLabel(minutes: number, lang: Language): string {
  const safe = Math.max(0, Math.round(minutes));
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  if (lang === 'ar') {
    if (hrs > 0 && mins > 0) return `${hrs} ساعة و ${mins} دقيقة`;
    if (hrs > 0) return hrs === 1 ? 'ساعة واحدة' : hrs === 2 ? 'ساعتان' : `${hrs} ساعات`;
    return `${mins} دقيقة`;
  }
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

export interface SubstitutePolicyResult {
  /** Any active/upcoming leave where this employee is assigned as substitute */
  assignedDuties: Vacation[];
  /** Duty that overlaps the requested [startDate, endDate] range */
  conflictingDuty: Vacation | null;
  /** Work days already taken by this employee overlapping conflictingDuty window */
  alreadyUsedInWindow: number;
  /** Total work days of the requested leave */
  requestedDays: number;
  /** Combined days overlapping conflictingDuty or overall request length during substitute window */
  effectiveDaysInDuty: number;
  /** True when employee is acting as substitute in range AND leave exceeds the 2-day allowance */
  exceedsTwoDayLimit: boolean;
  /** Matching manager-approved unconsumed exception (or consumed by excludeVacationId) */
  approvedException: SubstituteExceptionRequest | null;
  /** Matching pending exception waiting for manager approval */
  pendingException: SubstituteExceptionRequest | null;
  /** Whether saving the leave directly is allowed right now */
  canProceed: boolean;
}

export function evaluateSubstituteLeavePolicy(
  employee: Employee | undefined,
  startDate: string,
  endDate: string,
  requestedWorkDays: number,
  vacations: Vacation[],
  settings: SystemSettings,
  substituteExceptions: SubstituteExceptionRequest[],
  excludeVacationId?: string
): SubstitutePolicyResult {
  if (!employee) {
    return {
      assignedDuties: [],
      conflictingDuty: null,
      alreadyUsedInWindow: 0,
      requestedDays: requestedWorkDays,
      effectiveDaysInDuty: requestedWorkDays,
      exceedsTwoDayLimit: false,
      approvedException: null,
      pendingException: null,
      canProceed: true,
    };
  }

  const normalizedName = employee.fullName.trim().toLowerCase();
  const assignedDuties = vacations
    .filter(
      (v) =>
        v.id !== excludeVacationId &&
        v.employeeId !== employee.id &&
        v.status !== 'Rejected' &&
        (v.substitute || '').trim().toLowerCase() === normalizedName
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const conflictingDuty =
    startDate && endDate
      ? assignedDuties.find((v) => startDate <= v.endDate && endDate >= v.startDate) || null
      : null;

  if (!conflictingDuty) {
    return {
      assignedDuties,
      conflictingDuty: null,
      alreadyUsedInWindow: 0,
      requestedDays: requestedWorkDays,
      effectiveDaysInDuty: requestedWorkDays,
      exceedsTwoDayLimit: false,
      approvedException: null,
      pendingException: null,
      canProceed: true,
    };
  }

  // Sum existing non-rejected leave workdays taken by this employee inside conflictingDuty's dates
  const otherLeavesInWindow = vacations.filter(
    (v) =>
      v.id !== excludeVacationId &&
      v.employeeId === employee.id &&
      v.status !== 'Rejected' &&
      v.startDate <= conflictingDuty.endDate &&
      v.endDate >= conflictingDuty.startDate
  );

  const alreadyUsedInWindow = otherLeavesInWindow.reduce((sum, v) => {
    const ovStart = v.startDate > conflictingDuty.startDate ? v.startDate : conflictingDuty.startDate;
    const ovEnd = v.endDate < conflictingDuty.endDate ? v.endDate : conflictingDuty.endDate;
    if (ovStart > ovEnd) return sum;
    return (
      sum +
      calculateWorkDaysBreakdown(ovStart, ovEnd, settings.workWeekDays, settings.officialHolidays).workDays
    );
  }, 0);

  const reqOvStart = startDate > conflictingDuty.startDate ? startDate : conflictingDuty.startDate;
  const reqOvEnd = endDate < conflictingDuty.endDate ? endDate : conflictingDuty.endDate;
  const reqOverlapDays =
    reqOvStart <= reqOvEnd
      ? calculateWorkDaysBreakdown(reqOvStart, reqOvEnd, settings.workWeekDays, settings.officialHolidays).workDays
      : 0;

  const effectiveDaysInDuty = alreadyUsedInWindow + reqOverlapDays;
  const exceedsTwoDayLimit =
    requestedWorkDays > SUBSTITUTE_MAX_LEAVE_DAYS || effectiveDaysInDuty > SUBSTITUTE_MAX_LEAVE_DAYS;

  const approvedException =
    substituteExceptions.find(
      (ex) =>
        ex.employeeId === employee.id &&
        ex.substituteForVacationId === conflictingDuty.id &&
        ex.status === 'Approved' &&
        (!ex.consumedVacationId || ex.consumedVacationId === excludeVacationId) &&
        requestedWorkDays <= ex.requestedDays
    ) || null;

  const pendingException =
    substituteExceptions.find(
      (ex) =>
        ex.employeeId === employee.id &&
        ex.substituteForVacationId === conflictingDuty.id &&
        ex.status === 'Pending'
    ) || null;

  const canProceed = !exceedsTwoDayLimit || Boolean(approvedException);

  return {
    assignedDuties,
    conflictingDuty,
    alreadyUsedInWindow,
    requestedDays: requestedWorkDays,
    effectiveDaysInDuty,
    exceedsTwoDayLimit,
    approvedException,
    pendingException,
    canProceed,
  };
}

