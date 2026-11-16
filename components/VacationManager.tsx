import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Download,
  Edit,
  FileText,
  List,
  Paperclip,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  AppUser,
  Employee,
  ExitPermission,
  Language,
  REVERSE_HEADERS_MAP,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
  generateId,
} from '../types';
import { MONTH_NAMES, WEEKDAY_LABELS, t, translateVacationType } from '../i18n';
import {
  calculateWorkDaysBreakdown,
  evaluateSubstituteLeavePolicy,
  formatReadableDate,
  getEmployeeLeaveSummary,
  getTodayStr,
} from '../utils/leaveCalculations';
import { getVividCardClass } from '../utils/cardColors';
import { AvatarWithFallback, ConfirmDialog, StatusLabel } from './UIPrimitives';
import { emblemImg } from '../assets';

interface VacationManagerProps {
  vacations: Vacation[];
  employees: Employee[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  preselectedEmployeeId?: string | null;
  onClearPreselectedEmployee?: () => void;
  embedded?: boolean;
  forcedViewMode?: 'list' | 'calendar';
  employeeScopeId?: string;
  allowSelfServiceActions?: boolean;
  exitPermissions?: ExitPermission[];
  substituteExceptions?: SubstituteExceptionRequest[];
  onSubmitSubstituteException?: (req: SubstituteExceptionRequest) => void;
  onResolveSubstituteException?: (id: string, status: 'Approved' | 'Rejected') => void;
  onMarkExceptionConsumed?: (exceptionId: string, vacationId: string) => void;
  onEditReturnedException?: (ex: SubstituteExceptionRequest) => void;
  onLogAudit: (action: string, details: string, category: 'vacation') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: {
    type: 'request' | 'status' | 'substitute' | 'system';
    titleAr: string;
    titleEn: string;
    messageAr: string;
    messageEn: string;
    targetView: 'requests';
    targetSubTab: 'leaves';
  }) => void;
}

const FilePreviewer: React.FC<{ dataUrl: string; name: string; lang: Language }> = ({
  dataUrl,
  name,
  lang,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!dataUrl) return;
    try {
      if (dataUrl.startsWith('data:')) {
        const arr = dataUrl.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        const blob = new Blob([u8arr], { type: mime });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        return () => URL.revokeObjectURL(url);
      } else {
        setBlobUrl(dataUrl);
      }
    } catch {
      setBlobUrl(null);
    }
  }, [dataUrl]);

  if (!blobUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
        <FileText size={40} className="mb-2 opacity-50" />
        <p className="text-sm">{lang === 'ar' ? 'تعذر معاينة الملف.' : 'Unable to preview file.'}</p>
      </div>
    );
  }

  return <iframe src={blobUrl} className="w-full h-full bg-white rounded-lg border-none" title={name} />;
};

const CalendarView: React.FC<{
  vacations: Vacation[];
  exitPermissions: ExitPermission[];
  date: Date;
  setDate: (d: Date) => void;
  settings: SystemSettings;
  lang: Language;
}> = ({ vacations, exitPermissions, date, setDate, settings, lang }) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const todayStr = getTodayStr();

  const monthNames = MONTH_NAMES[lang];
  const weekdays = WEEKDAY_LABELS[lang];

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(
      <div key={`empty-${i}`} className="min-h-[118px] bg-[var(--app-bg)]/70 p-2" />
    );
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dayStr === todayStr;
    const holidayObj = settings.officialHolidays.find(
      (h) => dayStr >= h.startDate && dayStr <= (h.endDate || h.startDate)
    );
    const isWorkDay = settings.workWeekDays.includes(new Date(year, month, d).getDay());
    const dayVacations = vacations.filter(
      (v) => v.status !== 'Rejected' && v.startDate <= dayStr && v.endDate >= dayStr
    );
    const dayExits = exitPermissions.filter(
      (ex) => ex.status !== 'Rejected' && ex.date === dayStr
    );
    const totalEvents = dayVacations.length + dayExits.length;

    cells.push(
      <div
        key={d}
        className={`min-h-[118px] p-2 flex flex-col gap-1 transition-colors ${
          isToday
            ? 'bg-[var(--primary-soft)]'
            : !isWorkDay
            ? 'bg-[var(--surface-subtle)]/50'
            : 'bg-[var(--card-bg)]'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <span
            className={`text-xs font-mono-tabular font-semibold w-6 h-6 flex items-center justify-center rounded-md ${
              isToday
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'text-[var(--text-main)]'
            }`}
          >
            {d}
          </span>
          {totalEvents > 0 && (
            <span className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
              {totalEvents}
            </span>
          )}
        </div>

        {holidayObj && (
          <div className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--primary-soft)] text-[var(--primary-text)] truncate">
            {holidayObj.name}
          </div>
        )}

        <div className="space-y-1 overflow-y-auto max-h-[78px]">
          {dayVacations.map((v) => {
            const isPending = v.status === 'Pending' || v.status === 'Returned';
            return (
              <div
                key={v.id}
                title={`${v.employeeName} · ${translateVacationType(v.type, lang)} (${v.startDate} → ${v.endDate})`}
                className={`text-[11px] px-1.5 py-0.5 rounded border truncate ${
                  isPending
                    ? 'bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] border-[var(--status-warn-border)] border-dashed'
                    : 'bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]'
                }`}
              >
                {v.employeeName.split(' ')[0]} · {translateVacationType(v.type, lang)}
              </div>
            );
          })}
          {dayExits.map((ex) => (
            <div
              key={ex.id}
              title={`${ex.employeeName} · ${ex.exitTime}→${ex.returnTime} (${ex.reasonType})`}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--primary)]/35 bg-[var(--primary-soft)] text-[var(--primary-text)] truncate font-mono-tabular"
            >
              {lang === 'ar' ? 'خروج:' : 'Exit:'} {ex.employeeName.split(' ')[0]} ({ex.exitTime})
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-lg font-bold text-[var(--text-main)] min-w-[140px]">
            {monthNames[month]} {year}
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDate(new Date(year, month - 1, 1))}
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-main)] hover:bg-[var(--app-bg)] cursor-pointer"
            >
              {lang === 'ar' ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setDate(new Date(year, month + 1, 1))}
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-main)] hover:bg-[var(--app-bg)] cursor-pointer"
            >
              {lang === 'ar' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setDate(new Date())}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--app-bg)] cursor-pointer"
            >
              {t(lang, 'todayBtn')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)]" />
            {lang === 'ar' ? 'إجازة معلقة' : 'Pending Leave'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--status-success-bg)] border border-[var(--status-success-border)]" />
            {lang === 'ar' ? 'إجازة معتمدة' : 'Approved Leave'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--primary-soft)] border border-[var(--primary)]/50" />
            {lang === 'ar' ? 'إذن خروج / عطلة' : 'Exit / Holiday'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface-subtle)]">
        {weekdays.map((day) => (
          <div key={day} className="py-2 text-center text-xs font-semibold text-[var(--text-muted)]">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-[var(--border)]">{cells}</div>
    </div>
  );
};

const VacationManager: React.FC<VacationManagerProps> = ({
  vacations,
  employees,
  setVacations,
  settings,
  lang,
  currentUser,
  preselectedEmployeeId,
  onClearPreselectedEmployee,
  embedded = false,
  forcedViewMode,
  employeeScopeId,
  allowSelfServiceActions = false,
  exitPermissions = [],
  substituteExceptions = [],
  onSubmitSubstituteException,
  onResolveSubstituteException,
  onMarkExceptionConsumed,
  onEditReturnedException,
  onLogAudit,
  onToast,
  onNotify,
}) => {
  const [internalViewMode, setInternalViewMode] = useState<'list' | 'calendar'>('list');
  const viewMode = forcedViewMode ?? internalViewMode;
  const [statusFilter, setStatusFilter] = useState<'all' | Vacation['status']>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [calendarDate, setCalendarDate] = useState(new Date());

  const [showAddModal, setShowAddModal] = useState(false);
  const [newVacation, setNewVacation] = useState<Partial<Vacation>>({ type: '' });
  const [employeeSearchId, setEmployeeSearchId] = useState('');
  const [substituteSearchId, setSubstituteSearchId] = useState('');
  const [requestException, setRequestException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [previewFile, setPreviewFile] = useState<{ name: string; url: string } | null>(null);
  const [actionModal, setActionModal] = useState<{ id: string; name: string } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [printSlipVacation, setPrintSlipVacation] = useState<Vacation | null>(null);
  const [confirmDeleteVac, setConfirmDeleteVac] = useState<Vacation | null>(null);

  const canManage = currentUser?.permissions.includes('manage_vacations') ?? false;
  const canExportExcel =
    currentUser?.role === 'SuperAdmin' || Boolean(currentUser?.permissions.includes('export_excel'));
  const tableRef = useRef<HTMLDivElement | null>(null);
  const canApproveExceptions =
    currentUser?.role === 'SuperAdmin' ||
    currentUser?.role === 'Admin' ||
    currentUser?.role === 'Manager' ||
    Boolean(currentUser?.permissions.includes('approve_exceptions'));

  useEffect(() => {
    if (preselectedEmployeeId) {
      const emp = employees.find((e) => e.id === preselectedEmployeeId);
      setNewVacation({ type: '', employeeId: preselectedEmployeeId, startDate: getTodayStr() });
      setEmployeeSearchId(emp?.adminId || '');
      setSubstituteSearchId('');
      setRequestException(false);
      setExceptionReason('');
      setSelectedFile(null);
      setErrorMessage('');
      setShowAddModal(true);
      onClearPreselectedEmployee?.();
    }
  }, [preselectedEmployeeId, employees, onClearPreselectedEmployee]);

  const scopedVacations = useMemo(
    () => (employeeScopeId ? vacations.filter((v) => v.employeeId === employeeScopeId) : vacations),
    [vacations, employeeScopeId]
  );

  const filteredVacations = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return scopedVacations
      .filter((v) => {
        const matchesStatus = statusFilter === 'all' || v.status === statusFilter;
        const matchesSearch =
          !q ||
          v.employeeName.toLowerCase().includes(q) ||
          (v.substitute || '').toLowerCase().includes(q) ||
          v.type.toLowerCase().includes(q) ||
          translateVacationType(v.type, lang).toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [scopedVacations, statusFilter, searchTerm, lang]);

  const statusCounts = useMemo(
    () => ({
      all: scopedVacations.length,
      Pending: scopedVacations.filter((v) => v.status === 'Pending').length,
      Approved: scopedVacations.filter((v) => v.status === 'Approved').length,
      Returned: scopedVacations.filter((v) => v.status === 'Returned').length,
      Rejected: scopedVacations.filter((v) => v.status === 'Rejected').length,
    }),
    [scopedVacations]
  );

  const daysBreakdown = useMemo(() => {
    if (!newVacation.startDate || !newVacation.endDate) {
      return { calendarDays: 0, excludedOffDays: 0, excludedHolidayDays: 0, workDays: 0 };
    }
    return calculateWorkDaysBreakdown(
      newVacation.startDate,
      newVacation.endDate,
      settings.workWeekDays,
      settings.officialHolidays
    );
  }, [newVacation.startDate, newVacation.endDate, settings.workWeekDays, settings.officialHolidays]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === newVacation.employeeId),
    [employees, newVacation.employeeId]
  );

  const selectedEmployeeBalance = useMemo(() => {
    if (!selectedEmployee) return null;
    const yr = newVacation.startDate ? Number(newVacation.startDate.slice(0, 4)) : new Date().getFullYear();
    return getEmployeeLeaveSummary(selectedEmployee, vacations, settings, yr || new Date().getFullYear());
  }, [selectedEmployee, vacations, settings, newVacation.startDate]);

  const departmentOverlapColleagues = useMemo(() => {
    if (!selectedEmployee || !newVacation.startDate || !newVacation.endDate) return [];
    const start = newVacation.startDate;
    const end = newVacation.endDate;
    return vacations
      .filter((v) => {
        if (v.id === newVacation.id || v.status === 'Rejected' || v.employeeId === selectedEmployee.id) {
          return false;
        }
        const other = employees.find((e) => e.id === v.employeeId);
        if (!other || other.department !== selectedEmployee.department) return false;
        return start <= v.endDate && end >= v.startDate;
      })
      .map((v) => v.employeeName);
  }, [selectedEmployee, employees, vacations, newVacation.startDate, newVacation.endDate, newVacation.id]);

  const availableTypes = useMemo(() => {
    if (!selectedEmployee) return settings.vacationTypes;
    const contractConfig = settings.contractTypes.find(
      (c) => c.name.trim().toLowerCase() === selectedEmployee.contractType.trim().toLowerCase()
    );
    if (contractConfig && contractConfig.allowedVacationTypes.length > 0) {
      return settings.vacationTypes.filter((v) => contractConfig.allowedVacationTypes.includes(v.id));
    }
    return settings.vacationTypes;
  }, [selectedEmployee, settings]);

  const substitutePolicy = useMemo(
    () =>
      evaluateSubstituteLeavePolicy(
        selectedEmployee,
        newVacation.startDate || '',
        newVacation.endDate || '',
        daysBreakdown.workDays,
        vacations,
        settings,
        substituteExceptions,
        newVacation.id
      ),
    [
      selectedEmployee,
      newVacation.startDate,
      newVacation.endDate,
      newVacation.id,
      daysBreakdown.workDays,
      vacations,
      settings,
      substituteExceptions,
    ]
  );

  const visibleExceptionAlerts = useMemo(
    () =>
      substituteExceptions.filter((ex) => {
        if (employeeScopeId && ex.employeeId !== employeeScopeId) return false;
        return (
          ex.status === 'Pending' ||
          ex.status === 'Returned' ||
          (ex.status === 'Approved' && !ex.consumedVacationId)
        );
      }),
    [substituteExceptions, employeeScopeId]
  );

  const handleExport = () => {
    const exportData = filteredVacations.map((vac) => {
      const emp = employees.find((e) => e.id === vac.employeeId);
      const row: Record<string, unknown> = {};
      if (emp) {
        row[REVERSE_HEADERS_MAP['serialNo']] = emp.serialNo || '';
        row[REVERSE_HEADERS_MAP['fullName']] = emp.fullName;
        row[REVERSE_HEADERS_MAP['adminId']] = emp.adminId;
        row[REVERSE_HEADERS_MAP['jobTitle']] = emp.jobTitle;
        row[REVERSE_HEADERS_MAP['department']] = emp.department;
        row[REVERSE_HEADERS_MAP['contractType']] = emp.contractType;
      } else {
        row[REVERSE_HEADERS_MAP['fullName']] = vac.employeeName;
      }
      row[REVERSE_HEADERS_MAP['vacationStart']] = vac.startDate;
      row[REVERSE_HEADERS_MAP['vacationEnd']] = vac.endDate;
      row[REVERSE_HEADERS_MAP['vacationDays']] = vac.days;
      row[REVERSE_HEADERS_MAP['vacationType']] = vac.type;
      row[REVERSE_HEADERS_MAP['substitute']] = vac.substitute;
      row[REVERSE_HEADERS_MAP['notes']] = vac.notes;
      row[REVERSE_HEADERS_MAP['vacationStatus']] = vac.status;
      row[REVERSE_HEADERS_MAP['attachment']] = vac.attachment || '';
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vacations');
    XLSX.writeFile(wb, `archaeology_vacations_${getTodayStr()}.xlsx`);
    onToast('success', lang === 'ar' ? 'تم تصدير سجل الإجازات بنجاح.' : 'Vacations exported.');
  };

  const convertFileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
    });

  const handleEmployeeLookup = () => {
    const q = employeeSearchId.trim().toLowerCase();
    if (!q) return;
    const found = employees.find((e) => e.adminId.trim().toLowerCase() === q);
    if (found) {
      setNewVacation((prev) => ({ ...prev, employeeId: found.id, type: '' }));
      setErrorMessage('');
    } else {
      onToast('error', lang === 'ar' ? 'لم يتم العثور على موظف بهذا الرقم الإداري.' : 'Employee ID not found.');
    }
  };

  const handleSubstituteLookup = () => {
    const q = substituteSearchId.trim().toLowerCase();
    if (!q) return;
    const found = employees.find((e) => e.adminId.trim().toLowerCase() === q);
    if (found) {
      setNewVacation((prev) => ({ ...prev, substitute: found.fullName }));
    } else {
      onToast('error', lang === 'ar' ? 'لم يتم العثور على الموظف البديل.' : 'Substitute ID not found.');
    }
  };

  const handleSaveVacation = async () => {
    setErrorMessage('');
    const emp = employees.find((e) => e.id === newVacation.employeeId);
    const fallbackType = availableTypes[0]?.name || settings.vacationTypes[0]?.name || 'Annual';
    const effectiveType = newVacation.type || (requestException ? fallbackType : '');

    if (!emp || !newVacation.startDate || !newVacation.endDate || !effectiveType) {
      setErrorMessage(
        lang === 'ar' ? 'يرجى تعبئة جميع الحقول المطلوبة (الموظف، التواريخ، نوع الإجازة).' : 'Please fill all required fields.'
      );
      return;
    }

    if (newVacation.startDate > newVacation.endDate) {
      setErrorMessage(
        lang === 'ar' ? 'تاريخ النهاية يجب أن يكون مساوياً أو بعد تاريخ البداية.' : 'End date must be after start date.'
      );
      return;
    }

    const start = newVacation.startDate;
    const end = newVacation.endDate;

    // 1. Self-overlap validation
    const selfOverlap = vacations.find(
      (v) =>
        v.id !== newVacation.id &&
        v.employeeId === emp.id &&
        v.status !== 'Rejected' &&
        start <= v.endDate &&
        end >= v.startDate
    );
    if (selfOverlap) {
      setErrorMessage(
        lang === 'ar'
          ? `تعارض تواريخ: لدى الموظف إجازة مسجلة مسبقاً من ${selfOverlap.startDate} إلى ${selfOverlap.endDate}.`
          : `Date conflict: Employee already has leave from ${selfOverlap.startDate} to ${selfOverlap.endDate}.`
      );
      return;
    }

    const workDays = daysBreakdown.workDays;
    if (workDays <= 0) {
      setErrorMessage(
        lang === 'ar'
          ? 'الفترة المحددة تقع بالكامل ضمن أيام العطلة الأسبوعية أو الأعياد الرسمية (0 يوم عمل).'
          : 'Selected range falls entirely on weekends/holidays (0 work days).'
      );
      return;
    }

    // 2. Substitute rule: max 2 days overlapping substitute coverage unless Manager approved an Exception Request
    const policy = evaluateSubstituteLeavePolicy(
      emp,
      start,
      end,
      workDays,
      vacations,
      settings,
      substituteExceptions,
      newVacation.id
    );

    if (policy.conflictingDuty && policy.exceedsTwoDayLimit) {
      if (policy.pendingException && !policy.approvedException) {
        setErrorMessage(t(lang, 'exceptionPendingBanner'));
        return;
      }

      if (!policy.approvedException) {
        if (requestException && !newVacation.id) {
          const excReq: SubstituteExceptionRequest = {
            id: generateId(),
            employeeId: emp.id,
            employeeName: emp.fullName,
            substituteForVacationId: policy.conflictingDuty.id,
            coveringForEmployeeName: policy.conflictingDuty.employeeName,
            coverageStartDate: policy.conflictingDuty.startDate,
            coverageEndDate: policy.conflictingDuty.endDate,
            requestedStartDate: start,
            requestedEndDate: end,
            requestedDays: workDays,
            vacationType: effectiveType,
            reason:
              exceptionReason.trim() ||
              newVacation.notes?.trim() ||
              (lang === 'ar' ? 'طلب استثناء لتجاوز حد اليومين خلال فترة البديل' : 'Substitute exception request'),
            status: 'Pending',
            createdAt: new Date().toISOString(),
          };
          onSubmitSubstituteException?.(excReq);
          setShowAddModal(false);
          setNewVacation({ type: '' });
          setSelectedFile(null);
          setEmployeeSearchId('');
          setSubstituteSearchId('');
          setRequestException(false);
          setExceptionReason('');
          setErrorMessage('');
          return;
        }

        setErrorMessage(
          lang === 'ar'
            ? `لا يُسمح للموظف البديل (${emp.fullName}) بإدخال إجازة تتجاوز يومين عن فترة البديل للموظف ${policy.conflictingDuty.employeeName} (${policy.conflictingDuty.startDate} → ${policy.conflictingDuty.endDate}). حدد مربع "طلب استثناء" أسفل النموذج لاعتماده من المدير.`
            : `Substitute ${emp.fullName} covers ${policy.conflictingDuty.employeeName} (${policy.conflictingDuty.startDate} → ${policy.conflictingDuty.endDate}) and is limited to 2 days unless you check "Exception Request" for Manager approval.`
        );
        return;
      }
    }

    if (settings.requireAttachment && !newVacation.id && !selectedFile) {
      setErrorMessage(
        lang === 'ar' ? 'إرفاق نموذج الإجازة إلزامي حسب إعدادات النظام.' : 'Attaching the leave form is required.'
      );
      return;
    }

    // 3. Check if chosen substitute is also away
    if (newVacation.substitute) {
      const subAway = vacations.find(
        (v) =>
          v.status !== 'Rejected' &&
          v.employeeName === newVacation.substitute &&
          start <= v.endDate &&
          end >= v.startDate
      );
      if (subAway) {
        setErrorMessage(
          lang === 'ar'
            ? `البديل المختار (${newVacation.substitute}) لديه إجازة متداخلة خلال نفس الفترة.`
            : `Selected substitute (${newVacation.substitute}) has overlapping leave during these dates.`
        );
        return;
      }
    }

    // 4. Annual Leave Limit Check
    const contractConfig = settings.contractTypes.find(
      (c) => c.name.trim().toLowerCase() === emp.contractType.trim().toLowerCase()
    );
    if (contractConfig?.annualLeaveLimit && contractConfig.annualLeaveLimit > 0) {
      const targetYear = Number(start.slice(0, 4));
      const existingDays = vacations
        .filter(
          (v) =>
            v.employeeId === emp.id &&
            v.status !== 'Rejected' &&
            v.id !== newVacation.id &&
            Number(v.startDate.slice(0, 4)) === targetYear
        )
        .reduce((sum, v) => sum + v.days, 0);

      if (existingDays + workDays > contractConfig.annualLeaveLimit) {
        setErrorMessage(
          lang === 'ar'
            ? `تجاوز الحد السنوي: عقد (${emp.contractType}) يسمح بـ ${contractConfig.annualLeaveLimit} يوم عمل. المستنفد: ${existingDays}، المطلوب: ${workDays}.`
            : `Exceeds Annual Limit: ${emp.contractType} allows ${contractConfig.annualLeaveLimit} days/year. Used: ${existingDays}, Requested: ${workDays}.`
        );
        return;
      }
    }

    let attachmentData = newVacation.attachmentData;
    let attachmentName = newVacation.attachment;
    if (selectedFile) {
      try {
        attachmentData = await convertFileToBase64(selectedFile);
        attachmentName = selectedFile.name;
      } catch {
        setErrorMessage(lang === 'ar' ? 'فشل قراءة الملف المرفق.' : 'Failed to process attachment.');
        return;
      }
    }

    if (newVacation.id) {
      const original = vacations.find((v) => v.id === newVacation.id);
      const isResubmitFromReturned = original?.status === 'Returned';
      setVacations((prev) =>
        prev.map((v) =>
          v.id === newVacation.id
            ? ({
                ...v,
                ...newVacation,
                type: effectiveType,
                days: workDays,
                employeeName: emp.fullName,
                attachment: attachmentName,
                attachmentData,
                status: isResubmitFromReturned ? 'Pending' : v.status,
              } as Vacation)
            : v
        )
      );
      onLogAudit(
        lang === 'ar'
          ? isResubmitFromReturned
            ? 'إعادة إرسال طلب إجازة بعد التعديل'
            : 'تعديل طلب إجازة'
          : isResubmitFromReturned
          ? 'Resubmitted Leave Request'
          : 'Updated Leave Request',
        `${emp.fullName} (${start} → ${end})`,
        'vacation'
      );
      onToast(
        'success',
        lang === 'ar'
          ? isResubmitFromReturned
            ? 'تم تعديل طلب الإجازة وإعادة إرساله للمراجعة.'
            : 'تم تحديث طلب الإجازة.'
          : isResubmitFromReturned
          ? 'Leave request revised and resubmitted.'
          : 'Leave request updated.'
      );
      if (isResubmitFromReturned) {
        onNotify?.({
          type: 'request',
          titleAr: 'إعادة إرسال طلب إجازة بعد التعديل',
          titleEn: 'Revised Leave Request Resubmitted',
          messageAr: `${emp.fullName} · ${workDays} ${t(lang, 'workDays')} (${start} → ${end})`,
          messageEn: `${emp.fullName} · ${workDays} days (${start} → ${end})`,
          targetView: 'requests',
          targetSubTab: 'leaves',
        });
      }
    } else {
      const createdId = generateId();
      const created: Vacation = {
        id: createdId,
        employeeId: emp.id,
        employeeName: emp.fullName,
        startDate: start,
        endDate: end,
        days: workDays,
        type: effectiveType,
        substitute: newVacation.substitute || '',
        notes: newVacation.notes || '',
        status: 'Pending',
        attachment: attachmentName,
        attachmentData,
        createdAt: new Date().toISOString(),
      };
      setVacations((prev) => [...prev, created]);
      if (policy.approvedException && !policy.approvedException.consumedVacationId) {
        onMarkExceptionConsumed?.(policy.approvedException.id, createdId);
      }
      onLogAudit(
        lang === 'ar' ? 'تسجيل طلب إجازة جديد' : 'Created Leave Request',
        `${emp.fullName} · ${workDays} ${lang === 'ar' ? 'أيام' : 'days'}`,
        'vacation'
      );
      onToast('success', lang === 'ar' ? 'تم تسجيل طلب الإجازة.' : 'Leave request submitted.');
      onNotify?.({
        type: 'request',
        titleAr: 'طلب إجازة جديد',
        titleEn: 'New Leave Request',
        messageAr: `سجل ${emp.fullName} طلب ${translateVacationType(created.type, lang)} لمدة ${workDays} أيام (${start} → ${end}).`,
        messageEn: `${emp.fullName} submitted a ${workDays}-day ${created.type} leave (${start} → ${end}).`,
        targetView: 'requests',
        targetSubTab: 'leaves',
      });
    }

    setShowAddModal(false);
    setNewVacation({ type: '' });
    setSelectedFile(null);
    setEmployeeSearchId('');
    setSubstituteSearchId('');
    setRequestException(false);
    setExceptionReason('');
    setErrorMessage('');
  };

  const handleResolveAction = (type: 'Rejected' | 'Returned') => {
    if (!actionModal) return;
    setVacations((prev) =>
      prev.map((v) => {
        if (v.id !== actionModal.id) return v;
        const prefix = type === 'Returned' ? 'RETURNED' : 'REJECTED';
        const noteSuffix = actionReason.trim()
          ? `${v.notes ? '\n' : ''}[${prefix} - ${getTodayStr()}]: ${actionReason.trim()}`
          : '';
        return { ...v, status: type, notes: (v.notes || '') + noteSuffix };
      })
    );
    onLogAudit(
      type === 'Returned'
        ? lang === 'ar'
          ? 'إعادة طلب للتعديل'
          : 'Returned Leave Request'
        : lang === 'ar'
        ? 'رفض طلب إجازة'
        : 'Rejected Leave Request',
      actionModal.name,
      'vacation'
    );
    onToast(
      'info',
      type === 'Returned'
        ? lang === 'ar'
          ? 'تمت إعادة الطلب للتعديل.'
          : 'Request returned for modification.'
        : lang === 'ar'
        ? 'تم رفض الطلب.'
        : 'Request rejected.'
    );
    onNotify?.({
      type: 'status',
      titleAr: type === 'Returned' ? 'إعادة طلب إجازة للتعديل' : 'رفض طلب إجازة',
      titleEn: type === 'Returned' ? 'Leave Request Returned' : 'Leave Request Rejected',
      messageAr: `${actionModal.name}${actionReason.trim() ? ` — ${actionReason.trim()}` : ''}`,
      messageEn: `${actionModal.name}${actionReason.trim() ? ` — ${actionReason.trim()}` : ''}`,
      targetView: 'requests',
      targetSubTab: 'leaves',
    });
    setActionModal(null);
    setActionReason('');
  };

  const handleQuickApprove = (vac: Vacation) => {
    setVacations((prev) => prev.map((v) => (v.id === vac.id ? { ...v, status: 'Approved' } : v)));
    onLogAudit(
      lang === 'ar' ? 'اعتماد طلب إجازة' : 'Approved Leave Request',
      `${vac.employeeName} (${vac.startDate} → ${vac.endDate})`,
      'vacation'
    );
    onToast('success', lang === 'ar' ? `تم اعتماد إجازة ${vac.employeeName}.` : `Approved ${vac.employeeName}.`);
    onNotify?.({
      type: 'status',
      titleAr: 'اعتماد طلب إجازة',
      titleEn: 'Leave Request Approved',
      messageAr: `تم اعتماد إجازة ${vac.employeeName} (${vac.startDate} → ${vac.endDate}).`,
      messageEn: `Leave approved for ${vac.employeeName} (${vac.startDate} → ${vac.endDate}).`,
      targetView: 'requests',
      targetSubTab: 'leaves',
    });
  };

  const handleEdit = (vac: Vacation) => {
    const emp = employees.find((e) => e.id === vac.employeeId);
    setNewVacation({ ...vac });
    setEmployeeSearchId(emp?.adminId || '');
    setSubstituteSearchId('');
    setRequestException(false);
    setExceptionReason('');
    setSelectedFile(null);
    setErrorMessage('');
    setShowAddModal(true);
  };

  const openNewRequest = () => {
    const scopedEmp = employeeScopeId ? employees.find((e) => e.id === employeeScopeId) : undefined;
    setNewVacation({
      type: '',
      employeeId: employeeScopeId || '',
      startDate: getTodayStr(),
    });
    setEmployeeSearchId(scopedEmp?.adminId || '');
    setSubstituteSearchId('');
    setRequestException(false);
    setExceptionReason('');
    setSelectedFile(null);
    setErrorMessage('');
    setShowAddModal(true);
  };

  const brandingOrgName =
    lang === 'ar'
      ? settings.branding?.orgNameAr || t(lang, 'brandTitle')
      : settings.branding?.orgNameEn || t(lang, 'brandTitle');
  const brandingLogo = settings.branding?.logoDataUrl || emblemImg;

  return (
    <div className="space-y-4 text-[var(--text-main)]">
      {/* Header */}
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">{t(lang, 'vacationsTitle')}</h2>
            <p className="text-sm text-[var(--text-muted)]">{t(lang, 'vacationsDesc')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setInternalViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <List size={14} />
                <span>{t(lang, 'listView')}</span>
              </button>
              <button
                type="button"
                onClick={() => setInternalViewMode('calendar')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'calendar'
                    ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <CalendarIcon size={14} />
                <span>{t(lang, 'calendarView')}</span>
              </button>
            </div>

            {canExportExcel && (
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download size={15} />
                <span>{t(lang, 'exportExcel')}</span>
              </button>
            )}

            {(canManage || allowSelfServiceActions) && (
              <button
                type="button"
                onClick={openNewRequest}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={15} />
                <span>{t(lang, 'addRequest')}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        viewMode === 'list' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-[var(--text-main)]">{t(lang, 'vacationsTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'vacationsDesc')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canExportExcel && (
                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download size={14} />
                  <span>{t(lang, 'exportExcel')}</span>
                </button>
              )}
              {(canManage || allowSelfServiceActions) && (
                <button
                  type="button"
                  onClick={openNewRequest}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus size={15} />
                  <span>{t(lang, 'addRequest')}</span>
                </button>
              )}
            </div>
          </div>
        )
      )}

      {/* Interactive Status KPI Cards */}
      {viewMode === 'list' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { id: 'all' as const, label: lang === 'ar' ? 'إجمالي الطلبات' : 'All Requests', count: statusCounts.all, paletteIdx: 0, textCls: 'text-cyan-400', badgeCls: 'bg-cyan-500/15 text-cyan-400', Icon: FileText },
            { id: 'Pending' as const, label: lang === 'ar' ? 'قيد الانتظار' : 'Pending', count: statusCounts.Pending, paletteIdx: 2, textCls: 'text-amber-400', badgeCls: 'bg-amber-500/15 text-amber-400', Icon: Clock },
            { id: 'Approved' as const, label: lang === 'ar' ? 'معتمدة' : 'Approved', count: statusCounts.Approved, paletteIdx: 1, textCls: 'text-emerald-400', badgeCls: 'bg-emerald-500/15 text-emerald-400', Icon: CheckCircle2 },
            { id: 'Returned' as const, label: lang === 'ar' ? 'مُعادة للتعديل' : 'Returned', count: statusCounts.Returned, paletteIdx: 9, textCls: 'text-fuchsia-400', badgeCls: 'bg-fuchsia-500/15 text-fuchsia-400', Icon: RotateCcw },
          ].map((kpi) => (
            <div
              key={kpi.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setStatusFilter(kpi.id === 'all' ? 'all' : statusFilter === kpi.id ? 'all' : kpi.id);
                tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setStatusFilter(kpi.id === 'all' ? 'all' : statusFilter === kpi.id ? 'all' : kpi.id);
                  tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
              }}
              className={`${getVividCardClass(kpi.paletteIdx, { isActive: statusFilter === kpi.id })} p-4 rounded-xl flex items-center justify-between gap-2`}
            >
              <div>
                <div className="text-xs text-[var(--text-muted)]">{kpi.label}</div>
                <div className={`font-display text-2xl font-bold font-mono-tabular mt-0.5 ${kpi.textCls}`}>
                  {kpi.count}
                </div>
              </div>
              <div className={`p-2 rounded-lg ${kpi.badgeCls}`}>
                <kpi.Icon size={18} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter & Search Bar */}
      {viewMode === 'list' && (
        <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] gap-1">
            {(['all', 'Pending', 'Approved', 'Returned', 'Rejected'] as const).map((statusKey) => {
              const labels: Record<string, string> = {
                all: lang === 'ar' ? 'الكل' : 'All',
                Pending: lang === 'ar' ? 'قيد الانتظار' : 'Pending',
                Approved: lang === 'ar' ? 'معتمدة' : 'Approved',
                Returned: lang === 'ar' ? 'مُعادة' : 'Returned',
                Rejected: lang === 'ar' ? 'مرفوضة' : 'Rejected',
              };
              const isActive = statusFilter === statusKey;
              return (
                <button
                  key={statusKey}
                  type="button"
                  onClick={() => setStatusFilter(statusKey)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {labels[statusKey]} <span className="font-mono-tabular opacity-75">({statusCounts[statusKey]})</span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <Search
              size={15}
              className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
            />
            <input
              type="text"
              placeholder={t(lang, 'searchVacationsPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full ps-9 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>
      )}

      {/* Substitute Exception Requests Review Strip */}
      {viewMode === 'list' && visibleExceptionAlerts.length > 0 && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="px-4 py-3 bg-[var(--status-warn-bg)]/40 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-main)]">
              <ShieldCheck size={16} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'exceptionsQueueTitle')}</span>
              <span className="font-mono-tabular text-[var(--text-muted)]">({visibleExceptionAlerts.length})</span>
            </div>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {visibleExceptionAlerts.map((ex) => (
              <div key={ex.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5 min-w-0">
                  <div className="font-semibold text-[var(--text-main)]">
                    {ex.employeeName}{' '}
                    <span className="font-normal text-[var(--text-muted)]">
                      ({lang === 'ar' ? `بديل عن ${ex.coveringForEmployeeName}` : `Covering ${ex.coveringForEmployeeName}`})
                    </span>
                  </div>
                  <div className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                    {ex.requestedDays} {t(lang, 'workDays')} ({ex.requestedStartDate} → {ex.requestedEndDate})
                    {ex.reason ? ` · ${ex.reason}` : ''}
                  </div>
                  {ex.status === 'Returned' && ex.adminNotes && (
                    <div className="text-[11px] font-semibold text-[var(--status-warn-text)]">
                      {t(lang, 'exceptionReturnedBanner')}: {ex.adminNotes}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusLabel status={ex.status} lang={lang} />
                  {ex.status === 'Returned' && onEditReturnedException && (
                    <button
                      type="button"
                      onClick={() => onEditReturnedException(ex)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                    >
                      <Edit size={13} />
                      <span>{t(lang, 'editAndResubmitBtn')}</span>
                    </button>
                  )}
                  {ex.status === 'Pending' && canApproveExceptions && !employeeScopeId && (
                    <>
                      <button
                        type="button"
                        onClick={() => onResolveSubstituteException?.(ex.id, 'Approved')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                      >
                        <CheckCircle2 size={14} />
                        <span>{t(lang, 'approveExceptionBtn')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onResolveSubstituteException?.(ex.id, 'Rejected')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                      >
                        <XCircle size={14} />
                        <span>{t(lang, 'reject')}</span>
                      </button>
                    </>
                  )}
                  {ex.status === 'Approved' && !ex.consumedVacationId && (canManage || allowSelfServiceActions) && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetEmp = employees.find((e) => e.id === ex.employeeId);
                        setNewVacation({
                          employeeId: ex.employeeId,
                          startDate: ex.requestedStartDate,
                          endDate: ex.requestedEndDate,
                          type: ex.vacationType,
                          notes: ex.reason,
                        });
                        setEmployeeSearchId(targetEmp?.adminId || '');
                        setSubstituteSearchId('');
                        setRequestException(false);
                        setExceptionReason('');
                        setSelectedFile(null);
                        setErrorMessage('');
                        setShowAddModal(true);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                    >
                      <Plus size={14} />
                      <span>{lang === 'ar' ? 'إدخال الإجازة الآن' : 'Enter Approved Leave'}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      {viewMode === 'calendar' ? (
        <CalendarView
          vacations={vacations}
          exitPermissions={exitPermissions}
          date={calendarDate}
          setDate={setCalendarDate}
          settings={settings}
          lang={lang}
        />
      ) : (
        <div ref={tableRef} className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'vacationType')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'startDate')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'endDate')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'workDays')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'substituteLabel')}</th>
                  <th className="px-4 py-3 text-center font-semibold">{t(lang, 'attachment')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredVacations.map((vac) => {
                  const emp = employees.find((e) => e.id === vac.employeeId);
                  return (
                    <tr key={vac.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <AvatarWithFallback name={vac.employeeName} sizeClass="w-8 h-8" />
                          <div>
                            <div className="font-semibold text-[var(--text-main)]">{vac.employeeName}</div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {emp?.contractType || '-'} · {emp?.department || '-'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs font-medium text-[var(--text-main)]">
                        {translateVacationType(vac.type, lang)}
                      </td>
                      <td className="px-4 py-3.5 font-mono-tabular text-xs text-[var(--text-muted)]">
                        {vac.startDate}
                      </td>
                      <td className="px-4 py-3.5 font-mono-tabular text-xs text-[var(--text-muted)]">
                        {vac.endDate}
                      </td>
                      <td className="px-4 py-3.5 text-end font-mono-tabular font-semibold text-[var(--text-main)]">
                        {vac.days}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-[var(--text-muted)]">{vac.substitute || '-'}</td>
                      <td className="px-4 py-3.5 text-center">
                        {vac.attachment && vac.attachmentData ? (
                          <button
                            type="button"
                            onClick={() => setPreviewFile({ name: vac.attachment || 'Attachment', url: vac.attachmentData! })}
                            className="p-1.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] hover:opacity-85 inline-flex items-center cursor-pointer"
                            title={vac.attachment}
                          >
                            <FileText size={15} />
                          </button>
                        ) : vac.attachment ? (
                          <span title={vac.attachment} className="text-[var(--text-muted)] inline-flex">
                            <Paperclip size={15} />
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)] opacity-40">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusLabel status={vac.status} lang={lang} />
                      </td>
                      <td className="px-4 py-3.5 text-end">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPrintSlipVacation(vac)}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                            title={t(lang, 'printSlip')}
                          >
                            <Printer size={15} />
                          </button>
                          {(canManage
                            ? currentUser?.role === 'SuperAdmin' ||
                              currentUser?.role === 'Admin' ||
                              vac.status === 'Pending' ||
                              vac.status === 'Returned'
                            : allowSelfServiceActions &&
                              (vac.status === 'Pending' || vac.status === 'Returned')) && (
                            <button
                              type="button"
                              onClick={() => handleEdit(vac)}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                              title={t(lang, 'editEmployee')}
                            >
                              <Edit size={15} />
                            </button>
                          )}
                          {canManage && !employeeScopeId && vac.status === 'Pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleQuickApprove(vac)}
                                className="p-1.5 rounded-lg text-[var(--status-success-text)] hover:bg-[var(--status-success-bg)] cursor-pointer"
                                title={t(lang, 'approve')}
                              >
                                <CheckCircle2 size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setActionModal({ id: vac.id, name: vac.employeeName })}
                                className="p-1.5 rounded-lg text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                                title={t(lang, 'resolveRequestTitle')}
                              >
                                <XCircle size={16} />
                              </button>
                            </>
                          )}
                          {(canManage ||
                            (allowSelfServiceActions &&
                              (vac.status === 'Pending' || vac.status === 'Returned'))) && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteVac(vac)}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                              title={t(lang, 'deleteLabel')}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredVacations.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                      {t(lang, 'noVacationsFound')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Leave Request Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[75] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold text-[var(--text-main)]">
                {newVacation.id ? t(lang, 'updateRequest') : t(lang, 'addRequest')}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* Employee Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  {t(lang, 'employeeCol')} *
                </label>
                {employeeScopeId && selectedEmployee ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)]">
                    <AvatarWithFallback name={selectedEmployee.fullName} sizeClass="w-9 h-9" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[var(--text-main)] truncate">
                        {selectedEmployee.fullName}
                      </div>
                      <div className="text-xs font-mono-tabular text-[var(--text-muted)] truncate">
                        {selectedEmployee.adminId} · {selectedEmployee.department}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search
                          size={14}
                          className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                        />
                        <input
                          type="text"
                          placeholder={t(lang, 'searchByAdminId')}
                          value={employeeSearchId}
                          onChange={(e) => setEmployeeSearchId(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleEmployeeLookup())}
                          className="w-full ps-8 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleEmployeeLookup}
                        className="px-3.5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer shrink-0"
                      >
                        {t(lang, 'lookupBtn')}
                      </button>
                    </div>

                    <select
                      value={newVacation.employeeId || ''}
                      onChange={(e) => {
                        setNewVacation({ ...newVacation, employeeId: e.target.value, type: '' });
                        setErrorMessage('');
                      }}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    >
                      <option value="">{t(lang, 'selectEmployee')}</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName} ({e.adminId})
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {/* Employee Live Balance Snapshot */}
              {selectedEmployee && selectedEmployeeBalance && (
                <div className="p-3.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--text-main)]">
                      {t(lang, 'balanceSnapshot')} · {selectedEmployee.contractType}
                    </span>
                    <span className="font-mono-tabular font-bold text-[var(--primary-text)]">
                      {t(lang, 'remainingDays')}: {selectedEmployeeBalance.remainingDays} /{' '}
                      {selectedEmployeeBalance.annualLimit}
                    </span>
                  </div>
                  <div className="h-1.5 bg-[var(--app-bg)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--primary)] rounded-full"
                      style={{ width: `${selectedEmployeeBalance.utilizationPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Dates & Workday Breakdown */}
              <div className="p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-[var(--text-muted)]">
                        {t(lang, 'startDate')} *
                      </label>
                      <button
                        type="button"
                        onClick={() => setNewVacation((prev) => ({ ...prev, startDate: getTodayStr() }))}
                        className="text-[11px] font-semibold text-[var(--primary-text)] hover:underline cursor-pointer"
                      >
                        {t(lang, 'todayBtn')}
                      </button>
                    </div>
                    <input
                      type="date"
                      value={newVacation.startDate || ''}
                      onChange={(e) => setNewVacation({ ...newVacation, startDate: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'endDate')} *
                    </label>
                    <input
                      type="date"
                      value={newVacation.endDate || ''}
                      onChange={(e) => setNewVacation({ ...newVacation, endDate: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                </div>

                {daysBreakdown.calendarDays > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border)] text-center text-xs">
                    <div>
                      <div className="text-[var(--text-muted)]">{t(lang, 'calendarDaysLabel')}</div>
                      <div className="font-mono-tabular font-bold text-[var(--text-main)]">
                        {daysBreakdown.calendarDays}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">{t(lang, 'excludedOffDaysLabel')}</div>
                      <div className="font-mono-tabular font-bold text-[var(--text-muted)]">
                        {daysBreakdown.excludedOffDays + daysBreakdown.excludedHolidayDays}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--primary-text)]">{t(lang, 'netWorkDaysLabel')}</div>
                      <div className="font-mono-tabular font-bold text-[var(--primary-text)]">
                        {daysBreakdown.workDays}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Department Overlap Non-Blocking Alert */}
              {departmentOverlapColleagues.length > 0 && (
                <div className="p-3 rounded-lg bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] text-xs text-[var(--status-warn-text)] flex items-start gap-2">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{t(lang, 'deptOverlapWarning')}</p>
                    <p>{departmentOverlapColleagues.join(' · ')}</p>
                  </div>
                </div>
              )}

              {/* Substitute 2-Day Rule & Exception Request Box */}
              {selectedEmployee && substitutePolicy.assignedDuties.length > 0 && (() => {
                const displayDuty =
                  substitutePolicy.conflictingDuty ||
                  substitutePolicy.assignedDuties.find((d) => d.endDate >= getTodayStr()) ||
                  substitutePolicy.assignedDuties[0];
                const isBlockedWithoutException =
                  Boolean(substitutePolicy.conflictingDuty) &&
                  substitutePolicy.exceedsTwoDayLimit &&
                  !substitutePolicy.approvedException;

                return (
                  <div
                    className={`p-3.5 rounded-lg border space-y-2.5 text-xs ${
                      substitutePolicy.approvedException
                        ? 'bg-[var(--status-success-bg)]/45 border-[var(--status-success-border)]'
                        : isBlockedWithoutException
                        ? 'bg-[var(--status-warn-bg)]/60 border-[var(--status-warn-border)]'
                        : 'bg-[var(--surface-subtle)] border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {substitutePolicy.approvedException ? (
                        <ShieldCheck size={16} className="shrink-0 mt-0.5 text-[var(--status-success-text)]" />
                      ) : (
                        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--primary-text)]" />
                      )}
                      <div className="space-y-1 flex-1">
                        <p className="font-bold text-[var(--text-main)]">
                          {lang === 'ar'
                            ? `تنبيه البديل: ${selectedEmployee.fullName} بديل للموظف (${displayDuty.employeeName})`
                            : `Substitute Duty: Covers ${displayDuty.employeeName}`}
                          {' · '}
                          <span className="font-mono-tabular">
                            {displayDuty.startDate} → {displayDuty.endDate}
                          </span>
                        </p>
                        {substitutePolicy.approvedException ? (
                          <p className="text-[var(--status-success-text)] font-semibold">
                            {t(lang, 'exceptionApprovedBanner')} (
                            {substitutePolicy.approvedException.requestedDays} {t(lang, 'workDays')})
                          </p>
                        ) : substitutePolicy.pendingException ? (
                          <p className="text-[var(--status-warn-text)] font-semibold">
                            {t(lang, 'exceptionPendingBanner')}
                          </p>
                        ) : substitutePolicy.conflictingDuty && !substitutePolicy.exceedsTwoDayLimit ? (
                          <p className="text-[var(--status-success-text)]">
                            {lang === 'ar'
                              ? `المدة المحددة (${daysBreakdown.workDays} يوم عمل) ضمن المسموح به للبديل (حد أقصى يومان عن فترة البديل).`
                              : `Within the 2-day substitute limit (${daysBreakdown.workDays}/2 days).`}
                          </p>
                        ) : (
                          <p className="text-[var(--text-muted)]">{t(lang, 'substituteTwoDayHint')}</p>
                        )}
                      </div>
                    </div>

                    {/* Checkbox: طلب استثناء */}
                    {!newVacation.id &&
                      !substitutePolicy.approvedException &&
                      !substitutePolicy.pendingException && (
                        <div className="pt-2.5 border-t border-[var(--border)] space-y-2">
                          <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={requestException}
                              onChange={(e) => {
                                setRequestException(e.target.checked);
                                setErrorMessage('');
                              }}
                              className="mt-0.5 w-4 h-4 rounded accent-[var(--primary)] cursor-pointer shrink-0"
                            />
                            <div className="space-y-0.5">
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
                              className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-main)] outline-none focus:border-[var(--primary)] resize-none"
                            />
                          )}
                        </div>
                      )}
                  </div>
                );
              })()}

              {/* Vacation Type */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'vacationType')} *
                </label>
                <select
                  value={newVacation.type || ''}
                  onChange={(e) => setNewVacation({ ...newVacation, type: e.target.value })}
                  disabled={!newVacation.employeeId}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)] disabled:opacity-50"
                >
                  <option value="">{t(lang, 'selectType')}</option>
                  {availableTypes.map((vt) => (
                    <option key={vt.id} value={vt.name}>
                      {translateVacationType(vt.name, lang)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Substitute */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  {t(lang, 'substituteLabel')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t(lang, 'searchByAdminId')}
                    value={substituteSearchId}
                    onChange={(e) => setSubstituteSearchId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSubstituteLookup())}
                    className="flex-1 px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                  />
                  <button
                    type="button"
                    onClick={handleSubstituteLookup}
                    className="px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--app-bg)] cursor-pointer shrink-0"
                  >
                    {t(lang, 'lookupBtn')}
                  </button>
                </div>
                <select
                  value={newVacation.substitute || ''}
                  onChange={(e) => setNewVacation({ ...newVacation, substitute: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                >
                  <option value="">{t(lang, 'selectSubstitute')}</option>
                  {employees
                    .filter((e) => e.id !== newVacation.employeeId)
                    .map((e) => (
                      <option key={e.id} value={e.fullName}>
                        {e.fullName} ({e.department || e.adminId})
                      </option>
                    ))}
                </select>
              </div>

              {/* Attachment */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'attachFormLabel')}{' '}
                  <span className="text-[var(--primary-text)]">
                    {settings.requireAttachment ? t(lang, 'requiredLabel') : t(lang, 'optionalLabel')}
                  </span>
                </label>
                <label
                  htmlFor="vacationAttachmentInput"
                  className={`flex flex-col items-center justify-center gap-1.5 p-4 border border-dashed rounded-lg cursor-pointer transition-colors text-xs ${
                    selectedFile
                      ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-text)]'
                      : 'border-[var(--border)] bg-[var(--app-bg)] text-[var(--text-muted)] hover:border-[var(--primary)]'
                  }`}
                >
                  <input
                    id="vacationAttachmentInput"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                  <Paperclip size={18} />
                  <span>{selectedFile ? selectedFile.name : newVacation.attachment || t(lang, 'attachFormLabel')}</span>
                </label>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'notes')}
                </label>
                <textarea
                  rows={2}
                  value={newVacation.notes || ''}
                  onChange={(e) => setNewVacation({ ...newVacation, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)] resize-none"
                />
              </div>

              {errorMessage && (
                <div className="p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)] flex items-start gap-2">
                  <XCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-subtle)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-main)] hover:bg-[var(--card-bg)] cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveVacation}
                className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                {newVacation.id
                  ? t(lang, 'updateRequest')
                  : requestException &&
                    substitutePolicy.conflictingDuty &&
                    substitutePolicy.exceedsTwoDayLimit &&
                    !substitutePolicy.approvedException &&
                    !substitutePolicy.pendingException
                  ? t(lang, 'submitExceptionBtn')
                  : t(lang, 'submitRequest')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Resolution Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="border-b border-[var(--border)] pb-3">
              <h3 className="font-display font-bold text-[var(--text-main)]">{t(lang, 'resolveRequestTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)]">{actionModal.name}</p>
            </div>
            <textarea
              className="w-full h-28 p-3 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)] resize-none"
              placeholder={t(lang, 'reasonPlaceholder')}
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleResolveAction('Returned')}
                className="w-full py-2 rounded-lg border border-[var(--border)] bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold hover:opacity-90 flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw size={14} />
                <span>{t(lang, 'returnForEdit')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleResolveAction('Rejected')}
                className="w-full py-2 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold hover:opacity-90 flex items-center justify-center gap-2 cursor-pointer"
              >
                <XCircle size={14} />
                <span>{t(lang, 'reject')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionModal(null);
                  setActionReason('');
                }}
                className="w-full py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attachment Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-[85] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <span className="font-semibold text-sm text-[var(--text-main)] flex items-center gap-2">
                <FileText size={18} className="text-[var(--primary-text)]" />
                {previewFile.name}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={previewFile.url}
                  download={previewFile.name}
                  className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-main)] hover:bg-[var(--card-bg)]"
                  title={t(lang, 'downloadFile')}
                >
                  <Download size={16} />
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewFile(null)}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 p-2 bg-[var(--app-bg)]">
              <FilePreviewer dataUrl={previewFile.url} name={previewFile.name} lang={lang} />
            </div>
          </div>
        </div>
      )}

      {/* Printable Official Leave Form Modal */}
      {printSlipVacation && (
        <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="print-only-slip bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
            <div className="no-print px-6 py-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-800">{t(lang, 'printSlip')}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8C6A1B] text-white text-xs font-semibold cursor-pointer"
                >
                  <Printer size={14} />
                  <span>{lang === 'ar' ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintSlipVacation(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-8 space-y-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <div className="flex items-center justify-between border-b-2 border-[#8C6A1B] pb-4">
                <div className="flex items-center gap-4">
                  <img
                    src={brandingLogo}
                    alt={brandingOrgName}
                    className="w-14 h-14 rounded-lg object-cover border border-slate-300"
                  />
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      {brandingOrgName}
                    </h2>
                    <p className="text-xs text-slate-600">
                      {lang === 'ar' ? 'نموذج طلب واعتماد إجازة رسمية' : 'Official Leave Request & Authorization Form'}
                    </p>
                  </div>
                </div>
                <div className="text-end text-xs font-mono-tabular text-slate-600">
                  <div>REF: {printSlipVacation.id.slice(0, 8).toUpperCase()}</div>
                  <div>{formatReadableDate(getTodayStr(), lang)}</div>
                </div>
              </div>

              {(() => {
                const emp = employees.find((e) => e.id === printSlipVacation.employeeId);
                return (
                  <div className="grid grid-cols-2 gap-4 text-sm border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'fullName')}</span>
                      <span className="font-bold">{printSlipVacation.employeeName}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'adminIdCol')}</span>
                      <span className="font-mono-tabular font-semibold">{emp?.adminId || '-'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'departmentCol')}</span>
                      <span>{emp?.department || '-'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'contractCol')}</span>
                      <span>{emp?.contractType || '-'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'vacationType')}</span>
                      <span className="font-semibold">{translateVacationType(printSlipVacation.type, lang)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'netWorkDaysLabel')}</span>
                      <span className="font-mono-tabular font-bold">{printSlipVacation.days}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'startDate')}</span>
                      <span className="font-mono-tabular">{printSlipVacation.startDate}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'endDate')}</span>
                      <span className="font-mono-tabular">{printSlipVacation.endDate}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'substituteLabel')}</span>
                      <span>{printSlipVacation.substitute || '-'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">{t(lang, 'statusCol')}</span>
                      <span className="font-bold">{printSlipVacation.status}</span>
                    </div>
                  </div>
                );
              })()}

              {printSlipVacation.notes && (
                <div className="text-xs text-slate-700 border border-slate-200 rounded-lg p-3">
                  <span className="font-bold block mb-1">{t(lang, 'notes')}:</span>
                  <p className="whitespace-pre-wrap">{printSlipVacation.notes}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-6 pt-8 text-center text-xs text-slate-700">
                <div className="border-t border-slate-300 pt-2">
                  {lang === 'ar' ? 'توقيع الموظف' : 'Employee Signature'}
                </div>
                <div className="border-t border-slate-300 pt-2">
                  {lang === 'ar' ? 'اعتماد الموظف البديل' : 'Substitute Confirmation'}
                </div>
                <div className="border-t border-slate-300 pt-2">
                  {lang === 'ar' ? 'اعتماد مدير الإدارة / الموارد البشرية' : 'HR / Directorate Approval'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeleteVac)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? `هل أنت متأكد من حذف سجل إجازة "${confirmDeleteVac?.employeeName}"؟`
            : `Delete leave record for "${confirmDeleteVac?.employeeName}"?`
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => {
          if (confirmDeleteVac) {
            setVacations((prev) => prev.filter((v) => v.id !== confirmDeleteVac.id));
            onLogAudit(
              lang === 'ar' ? 'حذف طلب إجازة' : 'Deleted Leave Record',
              confirmDeleteVac.employeeName,
              'vacation'
            );
            onToast('success', lang === 'ar' ? 'تم حذف سجل الإجازة.' : 'Leave record deleted.');
          }
          setConfirmDeleteVac(null);
        }}
        onCancel={() => setConfirmDeleteVac(null)}
      />
    </div>
  );
};

export default VacationManager;