import React, { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, DoorOpen, FileText, ShieldCheck, X, Zap } from 'lucide-react';
import {
  Employee,
  EmployeeRequest,
  ExitPermission,
  Language,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
  generateId,
} from '../types';
import { t, translateVacationType } from '../i18n';
import {
  MONTHLY_EXIT_LIMIT_MINUTES,
  calculateWorkDaysBreakdown,
  evaluateSubstituteLeavePolicy,
  formatMinutesLabel,
  getEmployeeMonthlyExitUsage,
  getTodayStr,
} from '../utils/leaveCalculations';

interface QuickRequestModalProps {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  vacations: Vacation[];
  exitPermissions?: ExitPermission[];
  substituteExceptions?: SubstituteExceptionRequest[];
  lockedEmployeeId?: string;
  settings: SystemSettings;
  lang: Language;
  onSubmitLeave: (vac: Vacation) => void;
  onSubmitSubstituteException?: (req: SubstituteExceptionRequest) => void;
  onMarkExceptionConsumed?: (exceptionId: string, vacationId: string) => void;
  onSubmitExitPermission: (permit: ExitPermission) => void;
  onSubmitEmployeeRequest: (req: EmployeeRequest) => void;
}

type QuickTab = 'leave' | 'exit' | 'admin';

export function computeTimeDiffMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => isNaN(n))) return 0;
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

const QuickRequestModal: React.FC<QuickRequestModalProps> = ({
  open,
  onClose,
  employees,
  vacations,
  exitPermissions = [],
  substituteExceptions = [],
  lockedEmployeeId,
  settings,
  lang,
  onSubmitLeave,
  onSubmitSubstituteException,
  onMarkExceptionConsumed,
  onSubmitExitPermission,
  onSubmitEmployeeRequest,
}) => {
  const [tab, setTab] = useState<QuickTab>('leave');
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState('');
  const effectiveEmployeeId = lockedEmployeeId || employeeId;

  // Leave fields
  const [startDate, setStartDate] = useState(getTodayStr());
  const [endDate, setEndDate] = useState(getTodayStr());
  const [leaveType, setLeaveType] = useState('Annual');
  const [substitute, setSubstitute] = useState('');
  const [leaveNotes, setLeaveNotes] = useState('');
  const [requestException, setRequestException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');

  // Exit Permit fields
  const [exitDate, setExitDate] = useState(getTodayStr());
  const [exitTime, setExitTime] = useState('10:00');
  const [returnTime, setReturnTime] = useState('12:00');
  const [exitReasonType, setExitReasonType] = useState('مهمة عمل ميدانية');
  const [exitNotes, setExitNotes] = useState('');

  // Admin Request fields
  const [requestType, setRequestType] = useState('شهادة تعريف بالعمل والراتب');
  const [priority, setPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [reqTitle, setReqTitle] = useState('');
  const [reqDetails, setReqDetails] = useState('');
  const [targetDate, setTargetDate] = useState(getTodayStr());

  const workDaysBreakdown = useMemo(
    () => calculateWorkDaysBreakdown(startDate, endDate, settings.workWeekDays, settings.officialHolidays),
    [startDate, endDate, settings.workWeekDays, settings.officialHolidays]
  );

  const exitDuration = useMemo(
    () => computeTimeDiffMinutes(exitTime, returnTime),
    [exitTime, returnTime]
  );

  const selectedEmp = employees.find((e) => e.id === effectiveEmployeeId);

  const substitutePolicy = useMemo(
    () =>
      evaluateSubstituteLeavePolicy(
        selectedEmp,
        startDate,
        endDate,
        workDaysBreakdown.workDays,
        vacations,
        settings,
        substituteExceptions
      ),
    [selectedEmp, startDate, endDate, workDaysBreakdown.workDays, vacations, settings, substituteExceptions]
  );

  const exitMonthlyUsage = useMemo(
    () => (selectedEmp ? getEmployeeMonthlyExitUsage(selectedEmp.id, exitDate, exitPermissions) : null),
    [selectedEmp, exitDate, exitPermissions]
  );

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedEmp) {
      setError(lang === 'ar' ? 'يرجى اختيار الموظف أولاً.' : 'Please select an employee.');
      return;
    }

    if (tab === 'leave') {
      if (!startDate || !endDate || startDate > endDate) {
        setError(lang === 'ar' ? 'يرجى تحديد نطاق تاريخ صحيح.' : 'Please select a valid date range.');
        return;
      }
      if (workDaysBreakdown.workDays <= 0) {
        setError(lang === 'ar' ? 'الأيام المختارة تقع ضمن العطلات الرسمية فقط.' : 'Range has 0 work days.');
        return;
      }
      const overlap = vacations.find(
        (v) =>
          v.employeeId === selectedEmp.id &&
          v.status !== 'Rejected' &&
          startDate <= v.endDate &&
          endDate >= v.startDate
      );
      if (overlap) {
        setError(
          lang === 'ar'
            ? `تعارض تواريخ: لدى الموظف إجازة من ${overlap.startDate} إلى ${overlap.endDate}.`
            : `Overlap with existing leave (${overlap.startDate} to ${overlap.endDate}).`
        );
        return;
      }

      if (substitutePolicy.conflictingDuty && substitutePolicy.exceedsTwoDayLimit) {
        if (substitutePolicy.pendingException && !substitutePolicy.approvedException) {
          setError(t(lang, 'exceptionPendingBanner'));
          return;
        }
        if (!substitutePolicy.approvedException) {
          if (requestException) {
            onSubmitSubstituteException?.({
              id: generateId(),
              employeeId: selectedEmp.id,
              employeeName: selectedEmp.fullName,
              substituteForVacationId: substitutePolicy.conflictingDuty.id,
              coveringForEmployeeName: substitutePolicy.conflictingDuty.employeeName,
              coverageStartDate: substitutePolicy.conflictingDuty.startDate,
              coverageEndDate: substitutePolicy.conflictingDuty.endDate,
              requestedStartDate: startDate,
              requestedEndDate: endDate,
              requestedDays: workDaysBreakdown.workDays,
              vacationType: leaveType || 'Annual',
              reason:
                exceptionReason.trim() ||
                leaveNotes.trim() ||
                (lang === 'ar' ? 'طلب استثناء لتجاوز حد اليومين خلال فترة البديل' : 'Substitute exception request'),
              status: 'Pending',
              createdAt: new Date().toISOString(),
            });
            setError('');
            setRequestException(false);
            setExceptionReason('');
            setLeaveNotes('');
            onClose();
            return;
          }

          setError(
            lang === 'ar'
              ? `الموظف (${selectedEmp.fullName}) بديل عن ${substitutePolicy.conflictingDuty.employeeName} ويُسمح له بيومين فقط. حدد مربع "طلب استثناء" أسفل النموذج لاعتماده من المدير.`
              : `Substitute is limited to 2 days. Check "Exception Request" below for Manager approval.`
          );
          return;
        }
      }

      const vacId = generateId();
      onSubmitLeave({
        id: vacId,
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.fullName,
        startDate,
        endDate,
        days: workDaysBreakdown.workDays,
        type: leaveType || 'Annual',
        substitute,
        notes: leaveNotes,
        status: 'Pending',
        createdAt: new Date().toISOString(),
      });
      if (substitutePolicy.approvedException && !substitutePolicy.approvedException.consumedVacationId) {
        onMarkExceptionConsumed?.(substitutePolicy.approvedException.id, vacId);
      }
    } else if (tab === 'exit') {
      if (exitDuration <= 0) {
        setError(lang === 'ar' ? 'وقت العودة يجب أن يكون بعد وقت الخروج.' : 'Return time must be after exit time.');
        return;
      }
      const usage = getEmployeeMonthlyExitUsage(selectedEmp.id, exitDate, exitPermissions);
      if (usage.usedMinutes + exitDuration > MONTHLY_EXIT_LIMIT_MINUTES) {
        setError(
          lang === 'ar'
            ? `تجاوز الحد الشهري لإذن الخروج (${usage.yearMonth}): الحد ٦ ساعات. المستهلك: ${formatMinutesLabel(
                usage.usedMinutes,
                'ar'
              )} · المتبقي: ${formatMinutesLabel(usage.remainingMinutes, 'ar')} · المطلوب: ${formatMinutesLabel(
                exitDuration,
                'ar'
              )}.`
            : `Monthly exit quota exceeded (${usage.yearMonth}): max 6h. Used ${formatMinutesLabel(
                usage.usedMinutes,
                'en'
              )}, Remaining ${formatMinutesLabel(usage.remainingMinutes, 'en')}, Requested ${formatMinutesLabel(
                exitDuration,
                'en'
              )}.`
        );
        return;
      }

      onSubmitExitPermission({
        id: generateId(),
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.fullName,
        date: exitDate,
        exitTime,
        returnTime,
        durationMinutes: exitDuration,
        reasonType: exitReasonType,
        notes: exitNotes,
        status: 'Pending',
        createdAt: new Date().toISOString(),
      });
    } else {
      if (!reqTitle.trim()) {
        setError(lang === 'ar' ? 'يرجى كتابة عنوان الطلب.' : 'Request subject is required.');
        return;
      }
      onSubmitEmployeeRequest({
        id: generateId(),
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.fullName,
        requestType,
        priority,
        title: reqTitle.trim(),
        details: reqDetails.trim(),
        targetDate,
        status: 'Pending',
        createdAt: new Date().toISOString(),
      });
    }

    setError('');
    setReqTitle('');
    setReqDetails('');
    setLeaveNotes('');
    setExitNotes('');
    setRequestException(false);
    setExceptionReason('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)]">
              <Zap size={18} />
            </div>
            <div>
              <h3 className="font-display font-bold text-base">{t(lang, 'quickRequestTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'quickRequestSubtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Quick Type Tabs */}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => {
                setTab('leave');
                setError('');
              }}
              className={`py-2 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                tab === 'leave'
                  ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <Calendar size={14} />
              <span>{t(lang, 'quickTabLeave')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('exit');
                setError('');
              }}
              className={`py-2 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                tab === 'exit'
                  ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <DoorOpen size={14} />
              <span>{t(lang, 'quickTabExit')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('admin');
                setError('');
              }}
              className={`py-2 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                tab === 'admin'
                  ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <FileText size={14} />
              <span>{t(lang, 'quickTabAdmin')}</span>
            </button>
          </div>

          {/* Employee Picker */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              {t(lang, 'employeeCol')} *
            </label>
            <select
              required
              disabled={Boolean(lockedEmployeeId)}
              value={effectiveEmployeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] disabled:opacity-75"
            >
              <option value="">{t(lang, 'selectEmployee')}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.adminId}) — {emp.department}
                </option>
              ))}
            </select>
          </div>

          {/* Tab Specific Fields */}
          {tab === 'leave' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'startDate')}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'endDate')}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
              <div className="text-xs font-mono-tabular text-[var(--primary-text)]">
                {t(lang, 'netWorkDaysLabel')}: <strong>{workDaysBreakdown.workDays}</strong>
              </div>

              {/* Substitute 2-Day Rule & Exception Request Checkbox */}
              {selectedEmp && substitutePolicy.assignedDuties.length > 0 && (() => {
                const displayDuty =
                  substitutePolicy.conflictingDuty ||
                  substitutePolicy.assignedDuties.find((d) => d.endDate >= getTodayStr()) ||
                  substitutePolicy.assignedDuties[0];
                const isBlocked =
                  Boolean(substitutePolicy.conflictingDuty) &&
                  substitutePolicy.exceedsTwoDayLimit &&
                  !substitutePolicy.approvedException;

                return (
                  <div
                    className={`p-3 rounded-lg border space-y-2 text-xs ${
                      substitutePolicy.approvedException
                        ? 'bg-[var(--status-success-bg)]/45 border-[var(--status-success-border)]'
                        : isBlocked
                        ? 'bg-[var(--status-warn-bg)]/60 border-[var(--status-warn-border)]'
                        : 'bg-[var(--surface-subtle)] border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {substitutePolicy.approvedException ? (
                        <ShieldCheck size={15} className="shrink-0 mt-0.5 text-[var(--status-success-text)]" />
                      ) : (
                        <AlertTriangle size={15} className="shrink-0 mt-0.5 text-[var(--primary-text)]" />
                      )}
                      <div className="space-y-0.5 flex-1">
                        <div className="font-bold text-[var(--text-main)]">
                          {lang === 'ar'
                            ? `بديل عن ${displayDuty.employeeName} (${displayDuty.startDate} → ${displayDuty.endDate})`
                            : `Substitute for ${displayDuty.employeeName} (${displayDuty.startDate} → ${displayDuty.endDate})`}
                        </div>
                        {substitutePolicy.approvedException ? (
                          <div className="text-[var(--status-success-text)] font-semibold">
                            {t(lang, 'exceptionApprovedBanner')}
                          </div>
                        ) : substitutePolicy.pendingException ? (
                          <div className="text-[var(--status-warn-text)] font-semibold">
                            {t(lang, 'exceptionPendingBanner')}
                          </div>
                        ) : (
                          <div className="text-[var(--text-muted)]">{t(lang, 'substituteTwoDayHint')}</div>
                        )}
                      </div>
                    </div>

                    {!substitutePolicy.approvedException && !substitutePolicy.pendingException && (
                      <div className="pt-2 border-t border-[var(--border)] space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={requestException}
                            onChange={(e) => {
                              setRequestException(e.target.checked);
                              setError('');
                            }}
                            className="mt-0.5 w-4 h-4 rounded accent-[var(--primary)] cursor-pointer shrink-0"
                          />
                          <div>
                            <span className="font-bold text-[var(--text-main)] block">
                              {t(lang, 'exceptionCheckboxLabel')}
                            </span>
                            <span className="text-[11px] text-[var(--text-muted)] block">
                              {t(lang, 'exceptionCheckboxHint')}
                            </span>
                          </div>
                        </label>
                        {requestException && (
                          <textarea
                            rows={2}
                            value={exceptionReason}
                            onChange={(e) => setExceptionReason(e.target.value)}
                            placeholder={t(lang, 'exceptionReasonPlaceholder')}
                            className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)] resize-none"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'vacationType')}
                  </label>
                  <select
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
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
                    value={substitute}
                    onChange={(e) => setSubstitute(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                  >
                    <option value="">-</option>
                    {employees
                      .filter((e) => e.id !== effectiveEmployeeId)
                      .map((e) => (
                        <option key={e.id} value={e.fullName}>
                          {e.fullName}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <textarea
                rows={2}
                placeholder={t(lang, 'notes')}
                value={leaveNotes}
                onChange={(e) => setLeaveNotes(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none resize-none"
              />
            </div>
          )}

          {tab === 'exit' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'exitDate')}
                  </label>
                  <input
                    type="date"
                    value={exitDate}
                    onChange={(e) => setExitDate(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'exitTime')}
                  </label>
                  <input
                    type="time"
                    value={exitTime}
                    onChange={(e) => setExitTime(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'returnTime')}
                  </label>
                  <input
                    type="time"
                    value={returnTime}
                    onChange={(e) => setReturnTime(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none"
                  />
                </div>
              </div>
              <div className="text-xs font-mono-tabular text-[var(--primary-text)]">
                {t(lang, 'exitDuration')}:{' '}
                <strong>
                  {Math.floor(exitDuration / 60)}h {exitDuration % 60}m
                </strong>
              </div>
              {exitMonthlyUsage && (
                <div
                  className={`p-3 rounded-lg border space-y-1.5 text-xs ${
                    exitMonthlyUsage.usedMinutes + exitDuration > MONTHLY_EXIT_LIMIT_MINUTES
                      ? 'bg-[var(--status-danger-bg)]/50 border-[var(--status-danger-border)]'
                      : 'bg-[var(--surface-subtle)] border-[var(--border)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span>
                      {t(lang, 'exitMonthlyQuotaLabel')} ·{' '}
                      <span className="font-mono-tabular">{exitMonthlyUsage.yearMonth}</span>
                    </span>
                    <span className="font-mono-tabular text-[var(--primary-text)]">
                      {t(lang, 'exitMonthlyRemainingLabel')}: {formatMinutesLabel(exitMonthlyUsage.remainingMinutes, lang)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-[var(--app-bg)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        exitMonthlyUsage.usedMinutes + exitDuration > MONTHLY_EXIT_LIMIT_MINUTES
                          ? 'bg-[var(--status-danger-text)]'
                          : 'bg-[var(--primary)]'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(((exitMonthlyUsage.usedMinutes + exitDuration) / MONTHLY_EXIT_LIMIT_MINUTES) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'exitReasonType')}
                </label>
                <select
                  value={exitReasonType}
                  onChange={(e) => setExitReasonType(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                >
                  <option value="مهمة عمل ميدانية">{lang === 'ar' ? 'مهمة عمل ميدانية' : 'Field Assignment'}</option>
                  <option value="مراجعة مصرفية / رسمية">{lang === 'ar' ? 'مراجعة مصرفية / رسمية' : 'Official Errand'}</option>
                  <option value="مراجعة طبية">{lang === 'ar' ? 'مراجعة طبية' : 'Medical Appointment'}</option>
                  <option value="ظرف شخصي">{lang === 'ar' ? 'ظرف شخصي' : 'Personal Errand'}</option>
                  <option value="استئذان مبكر">{lang === 'ar' ? 'استئذان مبكر' : 'Early Departure'}</option>
                </select>
              </div>
              <textarea
                rows={2}
                placeholder={t(lang, 'notes')}
                value={exitNotes}
                onChange={(e) => setExitNotes(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none resize-none"
              />
            </div>
          )}

          {tab === 'admin' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'requestTypeLabel')}
                  </label>
                  <select
                    value={requestType}
                    onChange={(e) => setRequestType(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                  >
                    <option value="شهادة تعريف بالعمل والراتب">
                      {lang === 'ar' ? 'شهادة تعريف بالعمل والراتب' : 'Employment Certificate'}
                    </option>
                    <option value="صرف عهدة ومعدات ميدانية">
                      {lang === 'ar' ? 'صرف عهدة ومعدات ميدانية' : 'Equipment / Custody'}
                    </option>
                    <option value="طلب نقل / تكليف إداري">
                      {lang === 'ar' ? 'طلب نقل / تكليف إداري' : 'Transfer / Assignment'}
                    </option>
                    <option value="شهادة خبرة">
                      {lang === 'ar' ? 'شهادة خبرة' : 'Experience Letter'}
                    </option>
                    <option value="طلب إداري عام">
                      {lang === 'ar' ? 'طلب إداري عام' : 'General HR Request'}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'priorityLabel')}
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'Normal' | 'Urgent')}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                  >
                    <option value="Normal">{t(lang, 'priorityNormal')}</option>
                    <option value="Urgent">{t(lang, 'priorityUrgent')}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'requestTitleLabel')} *
                </label>
                <input
                  type="text"
                  value={reqTitle}
                  onChange={(e) => setReqTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'targetDateLabel')}
                </label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none"
                />
              </div>
              <textarea
                rows={2}
                placeholder={t(lang, 'requestDetailsLabel')}
                value={reqDetails}
                onChange={(e) => setReqDetails(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none resize-none"
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-main)] cursor-pointer"
            >
              {t(lang, 'cancel')}
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
            >
              {tab === 'leave' &&
              requestException &&
              substitutePolicy.conflictingDuty &&
              substitutePolicy.exceedsTwoDayLimit &&
              !substitutePolicy.approvedException &&
              !substitutePolicy.pendingException
                ? t(lang, 'submitExceptionBtn')
                : t(lang, 'submitRequest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default QuickRequestModal;
