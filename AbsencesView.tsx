import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Edit,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import {
  AbsenceRecord,
  AbsenceStatus,
  AbsenceType,
  AppUser,
  AttendanceRecord,
  Employee,
  Language,
  SystemSettings,
  Vacation,
  generateId,
} from '../types';
import { t, translateVacationType } from '../i18n';
import { NotificationEmitPayload } from './RequestsHub';
import {
  computeAbsenceMetrics,
  detectMissingAttendanceCandidates,
  DetectedAbsenceCandidate,
} from '../utils/attendanceCalculations';
import {
  calculateWorkDaysBreakdown,
  formatReadableDate,
  getTodayStr,
} from '../utils/leaveCalculations';
import { AvatarWithFallback, ConfirmDialog } from './UIPrimitives';

interface AbsencesViewProps {
  absenceRecords: AbsenceRecord[];
  setAbsenceRecords: React.Dispatch<React.SetStateAction<AbsenceRecord[]>>;
  employees: Employee[];
  attendanceRecords: AttendanceRecord[];
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  onLogAudit: (
    action: string,
    details: string,
    category: 'absence' | 'vacation' | 'attendance',
    targetEmployeeId?: string
  ) => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: NotificationEmitPayload) => void;
  embedded?: boolean;
}

const AbsencesView: React.FC<AbsencesViewProps> = ({
  absenceRecords,
  setAbsenceRecords,
  employees,
  attendanceRecords,
  vacations,
  setVacations,
  settings,
  lang,
  currentUser,
  onLogAudit,
  onToast,
  onNotify,
  embedded = false,
}) => {
  const perms = currentUser?.permissions || [];
  const canManage =
    currentUser?.role === 'SuperAdmin' ||
    currentUser?.role === 'Admin' ||
    perms.includes('manage_absences');

  const [statusFilter, setStatusFilter] = useState<'all' | AbsenceStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | AbsenceType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Absence Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<AbsenceRecord | null>(null);
  const [formEmpId, setFormEmpId] = useState(employees[0]?.id || '');
  const [formDate, setFormDate] = useState(getTodayStr());
  const [formType, setFormType] = useState<AbsenceType>('Unexcused');
  const [formStatus, setFormStatus] = useState<AbsenceStatus>('Open');
  const [formReason, setFormReason] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState('');

  // Convert-to-Leave Modal State
  const [convertTarget, setConvertTarget] = useState<AbsenceRecord | null>(null);
  const [convertLeaveType, setConvertLeaveType] = useState<string>(
    settings.vacationTypes[0]?.name || 'Annual'
  );
  const [convertSubstitute, setConvertSubstitute] = useState<string>('');
  const [convertNotes, setConvertNotes] = useState<string>('');

  // Delete Confirmation State
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const metrics = useMemo(() => computeAbsenceMetrics(absenceRecords), [absenceRecords]);

  const autoDetected = useMemo(
    () =>
      detectMissingAttendanceCandidates(
        employees,
        attendanceRecords,
        vacations,
        absenceRecords,
        settings,
        10
      ),
    [employees, attendanceRecords, vacations, absenceRecords, settings]
  );

  const exemptEmployeesCount = useMemo(
    () => employees.filter((e) => Boolean(e.biometricExempt)).length,
    [employees]
  );

  const typeLabel = (tp: AbsenceType): string => {
    switch (tp) {
      case 'Unexcused':
        return t(lang, 'absenceTypeUnexcused');
      case 'Excused':
        return t(lang, 'absenceTypeExcused');
      case 'NoCheckIn':
        return t(lang, 'absenceTypeNoCheckIn');
      case 'HalfDay':
        return t(lang, 'absenceTypeHalfDay');
    }
  };

  const statusMeta = (st: AbsenceStatus) => {
    switch (st) {
      case 'Open':
        return {
          label: t(lang, 'absenceStatusOpen'),
          cls: 'bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] border-[var(--status-warn-border)]',
        };
      case 'Excused':
        return {
          label: t(lang, 'absenceStatusExcused'),
          cls: 'bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]',
        };
      case 'Deducted':
        return {
          label: t(lang, 'absenceStatusDeducted'),
          cls: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border-[var(--status-danger-border)]',
        };
      case 'ConvertedToLeave':
        return {
          label: t(lang, 'absenceStatusConverted'),
          cls: 'bg-[var(--primary-soft)] text-[var(--primary-text)] border-[var(--primary)]/30',
        };
    }
  };

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...absenceRecords]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((r) => {
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        if (typeFilter !== 'all' && r.absenceType !== typeFilter) return false;
        if (!q) return true;
        return (
          r.employeeName.toLowerCase().includes(q) ||
          (r.department || '').toLowerCase().includes(q) ||
          (r.reason || '').toLowerCase().includes(q) ||
          (r.notes || '').toLowerCase().includes(q) ||
          r.date.includes(q)
        );
      });
  }, [absenceRecords, statusFilter, typeFilter, searchQuery]);

  const openCreateModal = (prefill?: { empId?: string; date?: string; type?: AbsenceType }) => {
    setEditingAbsence(null);
    setFormEmpId(prefill?.empId || employees[0]?.id || '');
    setFormDate(prefill?.date || getTodayStr());
    setFormType(prefill?.type || 'Unexcused');
    setFormStatus(prefill?.type === 'Excused' ? 'Excused' : 'Open');
    setFormReason('');
    setFormNotes('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (rec: AbsenceRecord) => {
    setEditingAbsence(rec);
    setFormEmpId(rec.employeeId);
    setFormDate(rec.date);
    setFormType(rec.absenceType);
    setFormStatus(rec.status);
    setFormReason(rec.reason || '');
    setFormNotes(rec.notes || '');
    setFormError('');
    setModalOpen(true);
  };

  const handleSaveAbsence = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const emp = employees.find((x) => x.id === formEmpId);
    if (!emp) {
      setFormError(lang === 'ar' ? 'يرجى تحديد الموظف.' : 'Please select an employee.');
      return;
    }
    if (!formDate) {
      setFormError(lang === 'ar' ? 'تاريخ الغياب مطلوب.' : 'Absence date is required.');
      return;
    }

    const duplicate = absenceRecords.find(
      (r) => r.id !== editingAbsence?.id && r.employeeId === emp.id && r.date === formDate
    );
    if (duplicate) {
      setFormError(
        lang === 'ar'
          ? 'يوجد سجل غياب مسجل مسبقاً لهذا الموظف في نفس التاريخ.'
          : 'An absence record already exists for this employee on that date.'
      );
      return;
    }

    if (editingAbsence) {
      const updated: AbsenceRecord = {
        ...editingAbsence,
        employeeId: emp.id,
        employeeName: emp.fullName,
        department: emp.department,
        date: formDate,
        absenceType: formType,
        status: formStatus,
        reason: formReason.trim() || undefined,
        notes: formNotes.trim() || undefined,
      };
      setAbsenceRecords((prev) => prev.map((r) => (r.id === editingAbsence.id ? updated : r)));
      onLogAudit(
        lang === 'ar' ? 'تعديل سجل غياب موظف' : 'Updated Employee Absence Record',
        `${emp.fullName} · ${formDate} (${typeLabel(formType)})`,
        'absence',
        emp.id
      );
      onToast(
        'success',
        lang === 'ar' ? `تم تحديث سجل غياب ${emp.fullName}.` : `Updated absence for ${emp.fullName}.`
      );
    } else {
      const created: AbsenceRecord = {
        id: generateId(),
        employeeId: emp.id,
        employeeName: emp.fullName,
        department: emp.department,
        date: formDate,
        absenceType: formType,
        status: formStatus,
        reason: formReason.trim() || undefined,
        notes: formNotes.trim() || undefined,
        recordedBy: currentUser?.name || 'HR',
        createdAt: new Date().toISOString(),
      };
      setAbsenceRecords((prev) => [created, ...prev]);
      onLogAudit(
        lang === 'ar' ? 'تسجيل غياب موظف' : 'Recorded Employee Absence',
        `${emp.fullName} · ${formDate} (${typeLabel(formType)})`,
        'absence',
        emp.id
      );
      onNotify?.({
        type: 'status',
        titleAr: `تسجيل غياب: ${emp.fullName}`,
        titleEn: `Absence Logged: ${emp.fullName}`,
        messageAr: `تم تسجيل حالة (${typeLabel(formType)}) للموظف ${emp.fullName} بتاريخ ${formDate}.`,
        messageEn: `${typeLabel(formType)} recorded for ${emp.fullName} on ${formDate}.`,
        targetView: 'attendance_hub',
        targetSubTab: 'absences',
      });
      onToast(
        'success',
        lang === 'ar' ? `تم تسجيل الغياب لـ ${emp.fullName}.` : `Absence recorded for ${emp.fullName}.`
      );
    }

    setModalOpen(false);
    setEditingAbsence(null);
  };

  const handleRecordDetectedCandidate = (
    candidate: DetectedAbsenceCandidate,
    initialStatus: AbsenceStatus,
    initialType: AbsenceType
  ) => {
    const exists = absenceRecords.some(
      (a) => a.employeeId === candidate.employee.id && a.date === candidate.date
    );
    if (exists) return;

    const created: AbsenceRecord = {
      id: generateId(),
      employeeId: candidate.employee.id,
      employeeName: candidate.employee.fullName,
      department: candidate.employee.department,
      date: candidate.date,
      absenceType: initialType,
      status: initialStatus,
      reason:
        initialStatus === 'Excused'
          ? lang === 'ar'
            ? 'اعتماد تبرير غياب ليوم عمل بدون تسجيل حضور'
            : 'Excused missing attendance workday'
          : lang === 'ar'
          ? 'رصد تلقائي: عدم تسجيل حضور بدون إجازة مسجلة'
          : 'Auto-detected: missing check-in with no approved leave',
      recordedBy: currentUser?.name || 'HR',
      createdAt: new Date().toISOString(),
    };
    setAbsenceRecords((prev) => [created, ...prev]);
    onLogAudit(
      lang === 'ar' ? 'رصد غياب من التنبيه التلقائي' : 'Logged Absence from Auto-Detection',
      `${candidate.employee.fullName} · ${candidate.date} (${typeLabel(initialType)})`,
      'absence',
      candidate.employee.id
    );
    onToast(
      'info',
      lang === 'ar'
        ? `تم تسجيل حالة الغياب لـ ${candidate.employee.fullName} (${candidate.date}).`
        : `Logged absence for ${candidate.employee.fullName} (${candidate.date}).`
    );
  };

  const handleQuickStatusUpdate = (rec: AbsenceRecord, nextStatus: AbsenceStatus) => {
    setAbsenceRecords((prev) =>
      prev.map((a) =>
        a.id === rec.id
          ? {
              ...a,
              status: nextStatus,
              absenceType: nextStatus === 'Excused' ? 'Excused' : a.absenceType,
            }
          : a
      )
    );
    onLogAudit(
      nextStatus === 'Excused'
        ? lang === 'ar'
          ? 'تبرير حالة غياب موظف'
          : 'Excused Employee Absence'
        : lang === 'ar'
        ? 'احتساب غياب للخصم'
        : 'Marked Absence for Deduction',
      `${rec.employeeName} · ${rec.date}`,
      'absence',
      rec.employeeId
    );
    onToast(
      'success',
      nextStatus === 'Excused'
        ? lang === 'ar'
          ? `تم تبرير غياب ${rec.employeeName}.`
          : `Marked ${rec.employeeName}'s absence as excused.`
        : lang === 'ar'
        ? `تم تثبيت احتساب الخصم على غياب ${rec.employeeName}.`
        : `Marked ${rec.employeeName}'s absence for deduction.`
    );
  };

  const openConvertToLeaveModal = (rec: AbsenceRecord) => {
    setConvertTarget(rec);
    setConvertLeaveType(settings.vacationTypes[0]?.name || 'Annual');
    const col = employees.find((e) => e.id !== rec.employeeId && e.status === 'Active');
    setConvertSubstitute(col?.fullName || '');
    setConvertNotes(rec.reason || (lang === 'ar' ? `محول من غياب بتاريخ ${rec.date}` : `Converted from absence on ${rec.date}`));
  };

  const handleConfirmConvertToLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertTarget) return;

    const breakdown = calculateWorkDaysBreakdown(
      convertTarget.date,
      convertTarget.date,
      settings.workWeekDays,
      settings.officialHolidays
    );
    const daysCount = breakdown.workDays > 0 ? breakdown.workDays : 1;

    const createdLeave: Vacation = {
      id: generateId(),
      employeeId: convertTarget.employeeId,
      employeeName: convertTarget.employeeName,
      startDate: convertTarget.date,
      endDate: convertTarget.date,
      days: daysCount,
      type: convertLeaveType,
      substitute: convertSubstitute,
      notes: convertNotes.trim(),
      status: 'Approved',
      createdAt: new Date().toISOString(),
    };

    setVacations((prev) => [createdLeave, ...prev]);
    setAbsenceRecords((prev) =>
      prev.map((a) =>
        a.id === convertTarget.id
          ? {
              ...a,
              status: 'ConvertedToLeave',
              linkedVacationId: createdLeave.id,
              notes: `${a.notes ? `${a.notes} | ` : ''}${
                lang === 'ar'
                  ? `تم التحويل إلى ${translateVacationType(convertLeaveType, lang)}`
                  : `Converted to ${convertLeaveType} leave`
              }`,
            }
          : a
      )
    );

    onLogAudit(
      lang === 'ar' ? 'تحويل غياب موظف إلى إجازة معتمدة' : 'Converted Absence to Approved Leave',
      `${convertTarget.employeeName} · ${convertTarget.date} (${translateVacationType(convertLeaveType, lang)})`,
      'absence',
      convertTarget.employeeId
    );

    onNotify?.({
      type: 'status',
      titleAr: `تحويل غياب لإجازة: ${convertTarget.employeeName}`,
      titleEn: `Absence Converted to Leave: ${convertTarget.employeeName}`,
      messageAr: `تم تحويل غياب يوم ${convertTarget.date} للموظف ${convertTarget.employeeName} إلى ${translateVacationType(convertLeaveType, lang)}.`,
      messageEn: `Absence on ${convertTarget.date} for ${convertTarget.employeeName} was converted to ${convertLeaveType} leave.`,
      targetView: 'requests',
      targetSubTab: 'leaves',
    });

    onToast(
      'success',
      lang === 'ar'
        ? `تم تحويل غياب ${convertTarget.employeeName} إلى إجازة معتمدة.`
        : `Absence converted to leave for ${convertTarget.employeeName}.`
    );
    setConvertTarget(null);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    const target = absenceRecords.find((a) => a.id === confirmDeleteId);
    setAbsenceRecords((prev) => prev.filter((a) => a.id !== confirmDeleteId));
    if (target) {
      onLogAudit(
        lang === 'ar' ? 'حذف سجل غياب' : 'Deleted Absence Record',
        `${target.employeeName} · ${target.date}`,
        'absence',
        target.employeeId
      );
      onToast('info', lang === 'ar' ? 'تم حذف سجل الغياب.' : 'Absence record deleted.');
    }
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Header */}
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-2xl font-bold flex items-center gap-2">
              <UserX size={22} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'absencesTitle')}</span>
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{t(lang, 'absencesDesc')}</p>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus size={15} />
              <span>{t(lang, 'recordAbsenceBtn')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--card-bg)] rounded-xl border border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <UserX size={16} className="text-[var(--primary-text)] shrink-0" />
            <span>{t(lang, 'absencesDesc')}</span>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus size={14} />
              <span>{t(lang, 'recordAbsenceBtn')}</span>
            </button>
          )}
        </div>
      )}

      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">{t(lang, 'totalAbsencesLabel')}</p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--text-main)] mt-1">
              {metrics.total}
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {metrics.deductedCount} {lang === 'ar' ? 'محتسب للخصم' : 'deducted'}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)] text-[var(--primary-text)] shrink-0">
            <ClipboardList size={20} />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">{t(lang, 'unexcusedAbsencesLabel')}</p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--status-danger-text)] mt-1">
              {metrics.openCount}
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {metrics.unexcusedCount} {lang === 'ar' ? 'بدون عذر / غياب بصمة' : 'unexcused / no check-in'}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] shrink-0">
            <AlertTriangle size={20} />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">{t(lang, 'excusedAbsencesLabel')}</p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--status-success-text)] mt-1">
              {metrics.excusedCount + metrics.convertedCount}
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {metrics.excusedCount} {lang === 'ar' ? 'مبرر' : 'excused'} · {metrics.convertedCount}{' '}
              {lang === 'ar' ? 'محول لإجازة' : 'converted'}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] shrink-0">
            <CheckCircle2 size={20} />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {lang === 'ar' ? 'أيام غير مسجلة (مكتشفة)' : 'Auto-Detected Unlogged'}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--status-warn-text)] mt-1">
              {autoDetected.length}
            </p>
            <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] mt-0.5 truncate">
              {lang === 'ar' ? 'آخر ١٠ أيام عمل رسمية' : 'Last 10 scheduled workdays'}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] shrink-0">
            <Sparkles size={20} />
          </div>
        </div>
      </div>

      {/* Auto-Detected Unlogged Workdays Panel */}
      {canManage && autoDetected.length > 0 && (
        <div className="rounded-xl border border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--status-warn-text)]">
              <Sparkles size={16} />
              <span>{t(lang, 'detectedAbsencesTitle')}</span>
              <span className="font-mono-tabular text-xs px-1.5 py-0.5 rounded bg-[var(--card-bg)] text-[var(--text-main)] border border-[var(--border)]">
                {autoDetected.length}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>{t(lang, 'detectedAbsencesDesc')}</span>
              {exemptEmployeesCount > 0 && (
                <span className="font-semibold text-[var(--primary-text)]">
                  · {t(lang, 'biometricExemptExcludedNote')}: {exemptEmployeesCount}{' '}
                  {t(lang, 'biometricExemptBadge')}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto">
            {autoDetected.slice(0, 12).map((cand) => (
              <div
                key={`${cand.employee.id}_${cand.date}`}
                className="bg-[var(--card-bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--text-main)] truncate">{cand.employee.fullName}</p>
                  <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] truncate">
                    {cand.date} · {cand.employee.department}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRecordDetectedCandidate(cand, 'Open', 'NoCheckIn')}
                    className="px-2 py-1 rounded bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-[11px] font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                  >
                    {lang === 'ar' ? 'تسجيل غياب' : 'Log Absence'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRecordDetectedCandidate(cand, 'Excused', 'Excused')}
                    className="px-2 py-1 rounded bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] text-[11px] font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                  >
                    {lang === 'ar' ? 'تبرير' : 'Excuse'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Bar & Ledger Table */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--card-bg)] border border-[var(--border)] gap-1">
            {[
              { id: 'all' as const, label: `${lang === 'ar' ? 'الكل' : 'All'} (${absenceRecords.length})` },
              { id: 'Open' as const, label: `${t(lang, 'absenceStatusOpen')} (${metrics.openCount})` },
              { id: 'Excused' as const, label: `${t(lang, 'absenceStatusExcused')} (${metrics.excusedCount})` },
              { id: 'Deducted' as const, label: `${t(lang, 'absenceStatusDeducted')} (${metrics.deductedCount})` },
              {
                id: 'ConvertedToLeave' as const,
                label: `${t(lang, 'absenceStatusConverted')} (${metrics.convertedCount})`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | AbsenceType)}
              className="px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
            >
              <option value="all">{lang === 'ar' ? 'جميع التصنيفات' : 'All Types'}</option>
              <option value="Unexcused">{t(lang, 'absenceTypeUnexcused')}</option>
              <option value="Excused">{t(lang, 'absenceTypeExcused')}</option>
              <option value="NoCheckIn">{t(lang, 'absenceTypeNoCheckIn')}</option>
              <option value="HalfDay">{t(lang, 'absenceTypeHalfDay')}</option>
            </select>

            <div className="relative min-w-[210px]">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'بحث بالاسم أو القسم أو التاريخ...' : 'Search staff, dept, date...'}
                className="w-full ps-8 pe-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-subtle)]/50">
              <tr>
                <th className="px-4 py-3 text-start">{t(lang, 'employeeCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'absenceDateCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'absenceTypeCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'absenceReasonLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'statusCol')}</th>
                {canManage && <th className="px-4 py-3 text-end">{t(lang, 'actionsCol')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredRecords.map((rec) => {
                const emp = employees.find((e) => e.id === rec.employeeId);
                const meta = statusMeta(rec.status);
                return (
                  <tr key={rec.id} className="hover:bg-[var(--surface-subtle)]/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <AvatarWithFallback src={emp?.photoUrl} name={rec.employeeName} sizeClass="w-8 h-8" />
                        <div>
                          <div className="font-semibold text-[var(--text-main)]">{rec.employeeName}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {rec.department || emp?.department || '-'}
                          </div>
                          {emp?.biometricExempt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--primary-text)]">
                              <ShieldCheck size={10} className="shrink-0" />
                              <span>{t(lang, 'biometricExemptBadge')}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular whitespace-nowrap">
                      <div className="font-semibold text-[var(--text-main)]">
                        {formatReadableDate(rec.date, lang)}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">{rec.date}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-[var(--text-main)]">{typeLabel(rec.absenceType)}</span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="text-[var(--text-main)] truncate" title={rec.reason || ''}>
                        {rec.reason || '-'}
                      </div>
                      {rec.notes && (
                        <div className="text-[11px] text-[var(--text-muted)] truncate" title={rec.notes}>
                          {rec.notes}
                        </div>
                      )}
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        {lang === 'ar' ? 'سُجّل بواسطة:' : 'By:'} {rec.recordedBy}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {rec.status !== 'ConvertedToLeave' && rec.status !== 'Excused' && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatusUpdate(rec, 'Excused')}
                              title={t(lang, 'markExcusedBtn')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-text)] text-[11px] font-semibold hover:opacity-90 cursor-pointer"
                            >
                              <CheckCircle2 size={12} />
                              <span>{t(lang, 'markExcusedBtn')}</span>
                            </button>
                          )}
                          {rec.status === 'Open' && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatusUpdate(rec, 'Deducted')}
                              title={t(lang, 'markDeductedBtn')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] text-[11px] font-semibold hover:opacity-90 cursor-pointer"
                            >
                              <XCircle size={12} />
                              <span>{t(lang, 'markDeductedBtn')}</span>
                            </button>
                          )}
                          {rec.status !== 'ConvertedToLeave' && (
                            <button
                              type="button"
                              onClick={() => openConvertToLeaveModal(rec)}
                              title={t(lang, 'convertToLeaveBtn')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--primary)]/40 bg-[var(--primary-soft)] text-[var(--primary-text)] text-[11px] font-semibold hover:opacity-90 cursor-pointer"
                            >
                              <CalendarPlus size={12} />
                              <span>{t(lang, 'convertToLeaveBtn')}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditModal(rec)}
                            title={lang === 'ar' ? 'تعديل' : 'Edit'}
                            className="p-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:border-[var(--primary)] cursor-pointer"
                          >
                            <Edit size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(rec.id)}
                            title={t(lang, 'deleteLabel')}
                            className="p-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}

              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                    {t(lang, 'noAbsencesFound')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Absence Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)]">
              <h3 className="font-display text-base font-bold flex items-center gap-2">
                <UserX size={18} className="text-[var(--primary-text)]" />
                <span>
                  {editingAbsence
                    ? lang === 'ar'
                      ? 'تعديل بيانات الغياب'
                      : 'Edit Absence Record'
                    : t(lang, 'recordAbsenceBtn')}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAbsence} className="p-5 space-y-4">
              {formError && (
                <div className="px-3 py-2 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[var(--status-danger-text)] text-xs font-medium">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'employeeCol')} *
                  </label>
                  <select
                    value={formEmpId}
                    onChange={(e) => setFormEmpId(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    required
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} — {emp.department}
                        {emp.biometricExempt ? ` (${t(lang, 'biometricExemptBadge')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {employees.find((e) => e.id === formEmpId)?.biometricExempt && (
                  <div className="sm:col-span-2 p-2.5 rounded-lg bg-[var(--primary-soft)] border border-[var(--primary)]/40 text-xs text-[var(--primary-text)] flex items-center gap-2 font-medium">
                    <ShieldCheck size={15} className="shrink-0" />
                    <span>
                      {lang === 'ar'
                        ? 'تنبيه: هذا الموظف معفى من البصمة اليومية ويُستثنى تلقائياً من رصد الغياب التلقائي.'
                        : 'Notice: This employee is exempted from daily biometric check-in and auto-absence detection.'}
                    </span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'absenceDateCol')} *
                  </label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'absenceTypeCol')}
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as AbsenceType)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    <option value="Unexcused">{t(lang, 'absenceTypeUnexcused')}</option>
                    <option value="Excused">{t(lang, 'absenceTypeExcused')}</option>
                    <option value="NoCheckIn">{t(lang, 'absenceTypeNoCheckIn')}</option>
                    <option value="HalfDay">{t(lang, 'absenceTypeHalfDay')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'statusCol')}
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as AbsenceStatus)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    <option value="Open">{t(lang, 'absenceStatusOpen')}</option>
                    <option value="Excused">{t(lang, 'absenceStatusExcused')}</option>
                    <option value="Deducted">{t(lang, 'absenceStatusDeducted')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'absenceReasonLabel')}
                </label>
                <input
                  type="text"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  placeholder={lang === 'ar' ? 'مثال: تغيب دون إذن / عذر صحي...' : 'Reason for absence...'}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'notes')}
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium hover:bg-[var(--surface-subtle)] cursor-pointer"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  {t(lang, 'save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Convert Absence to Leave Modal */}
      {convertTarget && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)]">
              <h3 className="font-display text-base font-bold flex items-center gap-2">
                <CalendarPlus size={18} className="text-[var(--primary-text)]" />
                <span>{t(lang, 'convertToLeaveBtn')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmConvertToLeave} className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] text-xs space-y-1">
                <div className="font-bold text-[var(--text-main)]">{convertTarget.employeeName}</div>
                <div className="font-mono-tabular text-[var(--text-muted)]">
                  <Calendar size={12} className="inline me-1" />
                  {convertTarget.date} · {typeLabel(convertTarget.absenceType)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'vacationType')}
                </label>
                <select
                  value={convertLeaveType}
                  onChange={(e) => setConvertLeaveType(e.target.value)}
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
                  value={convertSubstitute}
                  onChange={(e) => setConvertSubstitute(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                >
                  <option value="">{lang === 'ar' ? 'بدون بديل محدد' : 'No specific substitute'}</option>
                  {employees
                    .filter((e) => e.id !== convertTarget.employeeId)
                    .map((e) => (
                      <option key={e.id} value={e.fullName}>
                        {e.fullName}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'notes')}
                </label>
                <input
                  type="text"
                  value={convertNotes}
                  onChange={(e) => setConvertNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setConvertTarget(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium hover:bg-[var(--surface-subtle)] cursor-pointer"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  {t(lang, 'convertToLeaveBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? 'هل أنت متأكد من حذف سجل الغياب المحدد؟ لا يمكن التراجع عن هذا الإجراء.'
            : 'Are you sure you want to delete this absence record?'
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};

export default AbsencesView;
