import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  DoorOpen,
  Edit,
  FileText,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
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
  generateId,
} from '../types';
import { t, translateVacationType } from '../i18n';
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
import { NotificationEmitPayload } from './RequestsHub';
import AttendanceView from './AttendanceView';
import VacationManager from './VacationManager';
import { AvatarWithFallback, ConfirmDialog, StatusLabel } from './UIPrimitives';

export type MyRequestsSubTab = 'leave' | 'exit' | 'attendance';

interface MyRequestsViewProps {
  currentUser: AppUser | null;
  employees: Employee[];
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  exitPermissions: ExitPermission[];
  setExitPermissions: React.Dispatch<React.SetStateAction<ExitPermission[]>>;
  employeeRequests: EmployeeRequest[];
  setEmployeeRequests: React.Dispatch<React.SetStateAction<EmployeeRequest[]>>;
  substituteExceptions: SubstituteExceptionRequest[];
  setSubstituteExceptions: React.Dispatch<React.SetStateAction<SubstituteExceptionRequest[]>>;
  onSubmitSubstituteException: (req: SubstituteExceptionRequest) => void;
  onMarkExceptionConsumed: (exceptionId: string, vacationId: string) => void;
  attendanceRecords?: AttendanceRecord[];
  setAttendanceRecords?: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  orgUnits?: DepartmentUnit[];
  settings: SystemSettings;
  lang: Language;
  activeSubTab?: MyRequestsSubTab;
  onChangeSubTab?: (tab: MyRequestsSubTab) => void;
  onLogAudit: (action: string, details: string, category: 'vacation' | 'request') => void;
  onLogAttendanceAudit?: (
    action: string,
    details: string,
    category: 'attendance' | 'vacation' | 'request',
    targetEmployeeId?: string
  ) => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: NotificationEmitPayload) => void;
}

type UnifiedCategory = 'all' | 'leave' | 'exit' | 'admin' | 'exception';
type ComposerTab = 'leave' | 'exit' | 'admin';

interface UnifiedRequestItem {
  id: string;
  category: Exclude<UnifiedCategory, 'all'>;
  categoryLabel: string;
  title: string;
  periodLabel: string;
  metricLabel: string;
  secondaryNote: string;
  status: string;
  sortKey: string;
  rawException?: SubstituteExceptionRequest;
}

const MyRequestsView: React.FC<MyRequestsViewProps> = ({
  currentUser,
  employees,
  vacations,
  setVacations,
  exitPermissions,
  setExitPermissions,
  employeeRequests,
  setEmployeeRequests,
  substituteExceptions,
  setSubstituteExceptions,
  onSubmitSubstituteException,
  onMarkExceptionConsumed,
  attendanceRecords = [],
  setAttendanceRecords,
  orgUnits = [],
  settings,
  lang,
  activeSubTab: controlledSubTab,
  onChangeSubTab,
  onLogAudit,
  onLogAttendanceAudit,
  onToast,
  onNotify,
}) => {
  const [internalSubTab, setInternalSubTab] = useState<MyRequestsSubTab>('leave');
  const activeSubTab: MyRequestsSubTab = controlledSubTab ?? internalSubTab;
  const setSubTab = (tab: MyRequestsSubTab) => {
    if (onChangeSubTab) {
      onChangeSubTab(tab);
    } else {
      setInternalSubTab(tab);
    }
    if (tab === 'leave') {
      setComposerTab('leave');
      setCategoryFilter('all');
    } else if (tab === 'exit') {
      setComposerTab('exit');
      setCategoryFilter('exit');
    }
    setFormError('');
  };

  const canSwitchEmployee =
    currentUser?.role !== 'Employee' &&
    Boolean(
      currentUser?.role === 'SuperAdmin' ||
        currentUser?.role === 'Admin' ||
        currentUser?.role === 'Manager' ||
        currentUser?.role === 'HR' ||
        currentUser?.permissions.includes('view_employees')
    );

  // Resolve employee linked to the signed-in account
  const defaultLinkedEmp = useMemo(() => {
    if (employees.length === 0) return undefined;
    if (currentUser?.linkedEmployeeId) {
      const byId = employees.find((e) => e.id === currentUser.linkedEmployeeId);
      if (byId) return byId;
    }
    if (currentUser?.email) {
      const byEmail = employees.find(
        (e) => e.email && e.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()
      );
      if (byEmail) return byEmail;
    }
    if (currentUser?.name) {
      const cleanUserName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
      const byName = employees.find((e) => e.fullName.trim().toLowerCase() === cleanUserName);
      if (byName) return byName;
    }
    return employees[0];
  }, [employees, currentUser]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const activeEmployee = useMemo(() => {
    if (!canSwitchEmployee) return defaultLinkedEmp;
    if (selectedEmployeeId) {
      const found = employees.find((e) => e.id === selectedEmployeeId);
      if (found) return found;
    }
    return defaultLinkedEmp;
  }, [canSwitchEmployee, selectedEmployeeId, employees, defaultLinkedEmp]);

  // Unified composer state
  const [isComposerOpen, setIsComposerOpen] = useState(true);
  const [composerTab, setComposerTab] = useState<ComposerTab>('leave');
  const [formError, setFormError] = useState('');

  React.useEffect(() => {
    if (activeSubTab === 'leave') {
      setComposerTab('leave');
      setCategoryFilter('all');
      setFormError('');
    } else if (activeSubTab === 'exit') {
      setComposerTab('exit');
      setCategoryFilter('exit');
      setFormError('');
    }
  }, [activeSubTab]);

  // Leave form fields
  const [leaveStart, setLeaveStart] = useState(getTodayStr());
  const [leaveEnd, setLeaveEnd] = useState(getTodayStr());
  const [leaveType, setLeaveType] = useState('');
  const [leaveSubstitute, setLeaveSubstitute] = useState('');
  const [leaveNotes, setLeaveNotes] = useState('');
  const [leaveFile, setLeaveFile] = useState<File | null>(null);
  const [requestException, setRequestException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');

  // Exit form fields
  const [exitDate, setExitDate] = useState(getTodayStr());
  const [exitTime, setExitTime] = useState('10:00');
  const [returnTime, setReturnTime] = useState('12:00');
  const [exitReasonType, setExitReasonType] = useState('مهمة عمل ميدانية');
  const [exitNotes, setExitNotes] = useState('');

  // Admin request form fields
  const [adminReqType, setAdminReqType] = useState('شهادة تعريف بالعمل والراتب');
  const [adminPriority, setAdminPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [adminTitle, setAdminTitle] = useState('');
  const [adminTargetDate, setAdminTargetDate] = useState(getTodayStr());
  const [adminDetails, setAdminDetails] = useState('');

  // Filters for unified ledger
  const [categoryFilter, setCategoryFilter] = useState<UnifiedCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Pending' | 'Approved' | 'Returned' | 'Rejected'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Withdraw confirmation modal
  const [withdrawTarget, setWithdrawTarget] = useState<UnifiedRequestItem | null>(null);

  // Edit & resubmit a Returned Substitute Exception request
  const [editingReturnedException, setEditingReturnedException] =
    useState<SubstituteExceptionRequest | null>(null);
  const [returnedExceptionError, setReturnedExceptionError] = useState('');

  const todayStr = getTodayStr();
  const currentYear = Number(todayStr.slice(0, 4)) || new Date().getFullYear();

  const leaveBalance = useMemo(() => {
    if (!activeEmployee) return null;
    return getEmployeeLeaveSummary(activeEmployee, vacations, settings, currentYear);
  }, [activeEmployee, vacations, settings, currentYear]);

  const currentMonthExitUsage = useMemo(() => {
    if (!activeEmployee) return null;
    return getEmployeeMonthlyExitUsage(activeEmployee.id, todayStr, exitPermissions);
  }, [activeEmployee, todayStr, exitPermissions]);

  const formExitDuration = useMemo(() => computeTimeDiffMinutes(exitTime, returnTime), [exitTime, returnTime]);
  const formExitUsage = useMemo(() => {
    if (!activeEmployee) return null;
    return getEmployeeMonthlyExitUsage(activeEmployee.id, exitDate, exitPermissions);
  }, [activeEmployee, exitDate, exitPermissions]);

  const leaveDaysBreakdown = useMemo(
    () => calculateWorkDaysBreakdown(leaveStart, leaveEnd, settings.workWeekDays, settings.officialHolidays),
    [leaveStart, leaveEnd, settings.workWeekDays, settings.officialHolidays]
  );

  const returnedExceptionBreakdown = useMemo(() => {
    if (!editingReturnedException?.requestedStartDate || !editingReturnedException?.requestedEndDate) {
      return { workDays: editingReturnedException?.requestedDays || 0 };
    }
    return calculateWorkDaysBreakdown(
      editingReturnedException.requestedStartDate,
      editingReturnedException.requestedEndDate,
      settings.workWeekDays,
      settings.officialHolidays
    );
  }, [
    editingReturnedException?.requestedStartDate,
    editingReturnedException?.requestedEndDate,
    editingReturnedException?.requestedDays,
    settings.workWeekDays,
    settings.officialHolidays,
  ]);

  const availableLeaveTypes = useMemo(() => {
    if (!activeEmployee) return settings.vacationTypes;
    const contractConfig = settings.contractTypes.find(
      (c) => c.name.trim().toLowerCase() === activeEmployee.contractType.trim().toLowerCase()
    );
    if (contractConfig && contractConfig.allowedVacationTypes.length > 0) {
      return settings.vacationTypes.filter((vt) => contractConfig.allowedVacationTypes.includes(vt.id));
    }
    return settings.vacationTypes;
  }, [activeEmployee, settings]);

  const substitutePolicy = useMemo(
    () =>
      evaluateSubstituteLeavePolicy(
        activeEmployee,
        leaveStart,
        leaveEnd,
        leaveDaysBreakdown.workDays,
        vacations,
        settings,
        substituteExceptions
      ),
    [activeEmployee, leaveStart, leaveEnd, leaveDaysBreakdown.workDays, vacations, settings, substituteExceptions]
  );

  // Employee personal records
  const myVacations = useMemo(
    () => (activeEmployee ? vacations.filter((v) => v.employeeId === activeEmployee.id) : []),
    [vacations, activeEmployee]
  );
  const myExits = useMemo(
    () => (activeEmployee ? exitPermissions.filter((e) => e.employeeId === activeEmployee.id) : []),
    [exitPermissions, activeEmployee]
  );
  const myHrRequests = useMemo(
    () => (activeEmployee ? employeeRequests.filter((r) => r.employeeId === activeEmployee.id) : []),
    [employeeRequests, activeEmployee]
  );
  const myExceptions = useMemo(
    () => (activeEmployee ? substituteExceptions.filter((e) => e.employeeId === activeEmployee.id) : []),
    [substituteExceptions, activeEmployee]
  );

  // Substitute duties assigned TO this employee
  const myCoverages = useMemo(() => {
    if (!activeEmployee) return [];
    const normalized = activeEmployee.fullName.trim().toLowerCase();
    return vacations
      .filter(
        (v) =>
          v.status !== 'Rejected' &&
          v.employeeId !== activeEmployee.id &&
          (v.substitute || '').trim().toLowerCase() === normalized
      )
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [vacations, activeEmployee]);

  // Unified items combining all 4 request types
  const unifiedItems = useMemo<UnifiedRequestItem[]>(() => {
    const items: UnifiedRequestItem[] = [];

    myVacations.forEach((v) => {
      items.push({
        id: v.id,
        category: 'leave',
        categoryLabel: lang === 'ar' ? 'إجازة' : 'Leave',
        title: translateVacationType(v.type, lang),
        periodLabel: `${v.startDate} → ${v.endDate}`,
        metricLabel: `${v.days} ${t(lang, 'workDays')}`,
        secondaryNote: [
          v.substitute ? `${t(lang, 'substituteLabel')}: ${v.substitute}` : '',
          v.notes || '',
        ]
          .filter(Boolean)
          .join(' · '),
        status: v.status,
        sortKey: v.createdAt || v.startDate,
      });
    });

    myExits.forEach((ex) => {
      items.push({
        id: ex.id,
        category: 'exit',
        categoryLabel: lang === 'ar' ? 'إذن خروج' : 'Exit Permit',
        title: ex.reasonType,
        periodLabel: `${ex.date} · ${ex.exitTime} → ${ex.returnTime}`,
        metricLabel: formatMinutesLabel(ex.durationMinutes, lang),
        secondaryNote: ex.notes || '',
        status: ex.status,
        sortKey: ex.createdAt || ex.date,
      });
    });

    myHrRequests.forEach((r) => {
      items.push({
        id: r.id,
        category: 'admin',
        categoryLabel: lang === 'ar' ? 'طلب إداري' : 'HR Request',
        title: r.title,
        periodLabel: `${r.requestType} · ${r.targetDate}`,
        metricLabel: r.priority === 'Urgent' ? t(lang, 'priorityUrgent') : t(lang, 'priorityNormal'),
        secondaryNote: [r.details, r.adminNotes].filter(Boolean).join(' · '),
        status: r.status,
        sortKey: r.createdAt || r.targetDate,
      });
    });

    myExceptions.forEach((ex) => {
      items.push({
        id: ex.id,
        category: 'exception',
        categoryLabel: lang === 'ar' ? 'استثناء بديل' : 'Substitute Exception',
        title:
          lang === 'ar'
            ? `طلب استثناء عن فترة البديل (${ex.coveringForEmployeeName})`
            : `Substitute Exception (${ex.coveringForEmployeeName})`,
        periodLabel: `${ex.requestedStartDate} → ${ex.requestedEndDate}`,
        metricLabel: `${ex.requestedDays} ${t(lang, 'workDays')}`,
        secondaryNote: [
          ex.reason,
          ex.approvedBy ? `${lang === 'ar' ? 'بواسطة' : 'By'}: ${ex.approvedBy}` : '',
          ex.consumedVacationId ? (lang === 'ar' ? 'تم إدخال الإجازة' : 'Leave entered') : '',
        ]
          .filter(Boolean)
          .join(' · '),
        status: ex.status,
        sortKey: ex.createdAt,
        rawException: ex,
      });
    });

    return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [myVacations, myExits, myHrRequests, myExceptions, lang]);

  const counts = useMemo(
    () => ({
      all: unifiedItems.length,
      leave: myVacations.length,
      exit: myExits.length,
      admin: myHrRequests.length,
      exception: myExceptions.length,
      pending: unifiedItems.filter((i) => i.status === 'Pending').length,
      approved: unifiedItems.filter((i) => i.status === 'Approved').length,
    }),
    [unifiedItems, myVacations.length, myExits.length, myHrRequests.length, myExceptions.length]
  );

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return unifiedItems.filter((item) => {
      const matchCat = categoryFilter === 'all' || item.category === categoryFilter;
      const matchStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        item.periodLabel.toLowerCase().includes(q) ||
        item.secondaryNote.toLowerCase().includes(q);
      return matchCat && matchStatus && matchQuery;
    });
  }, [unifiedItems, categoryFilter, statusFilter, searchTerm]);

  const convertFileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
    });

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!activeEmployee) return;

    if (composerTab === 'leave') {
      const effectiveType = leaveType || availableLeaveTypes[0]?.name || settings.vacationTypes[0]?.name || 'Annual';
      if (!leaveStart || !leaveEnd || leaveStart > leaveEnd) {
        setFormError(lang === 'ar' ? 'يرجى تحديد نطاق تاريخ صحيح.' : 'Please select a valid date range.');
        return;
      }
      if (leaveDaysBreakdown.workDays <= 0) {
        setFormError(
          lang === 'ar'
            ? 'الأيام المختارة تقع ضمن العطلات الرسمية أو الإجازة الأسبوعية فقط.'
            : 'Selected dates include 0 work days.'
        );
        return;
      }

      const selfOverlap = vacations.find(
        (v) =>
          v.employeeId === activeEmployee.id &&
          v.status !== 'Rejected' &&
          leaveStart <= v.endDate &&
          leaveEnd >= v.startDate
      );
      if (selfOverlap) {
        setFormError(
          lang === 'ar'
            ? `تعارض تواريخ: لديك إجازة مسجلة من ${selfOverlap.startDate} إلى ${selfOverlap.endDate}.`
            : `Overlap with your leave from ${selfOverlap.startDate} to ${selfOverlap.endDate}.`
        );
        return;
      }

      // Substitute 2-day rule check + exception checkbox
      if (substitutePolicy.conflictingDuty && substitutePolicy.exceedsTwoDayLimit) {
        if (substitutePolicy.pendingException && !substitutePolicy.approvedException) {
          setFormError(t(lang, 'exceptionPendingBanner'));
          return;
        }
        if (!substitutePolicy.approvedException) {
          if (requestException) {
            onSubmitSubstituteException({
              id: generateId(),
              employeeId: activeEmployee.id,
              employeeName: activeEmployee.fullName,
              substituteForVacationId: substitutePolicy.conflictingDuty.id,
              coveringForEmployeeName: substitutePolicy.conflictingDuty.employeeName,
              coverageStartDate: substitutePolicy.conflictingDuty.startDate,
              coverageEndDate: substitutePolicy.conflictingDuty.endDate,
              requestedStartDate: leaveStart,
              requestedEndDate: leaveEnd,
              requestedDays: leaveDaysBreakdown.workDays,
              vacationType: effectiveType,
              reason:
                exceptionReason.trim() ||
                leaveNotes.trim() ||
                (lang === 'ar' ? 'طلب استثناء لتجاوز حد اليومين خلال فترة البديل' : 'Substitute exception request'),
              status: 'Pending',
              createdAt: new Date().toISOString(),
            });
            setRequestException(false);
            setExceptionReason('');
            setLeaveNotes('');
            setLeaveFile(null);
            setFormError('');
            setIsComposerOpen(false);
            return;
          }

          setFormError(
            lang === 'ar'
              ? `أنت مكلف بديلاً عن (${substitutePolicy.conflictingDuty.employeeName})، ويُسمح لك بيومين فقط كحد أقصى خلال فترة البديل. حدد مربع "طلب استثناء" أسفل النموذج لإرساله للمدير.`
              : `You are covering for ${substitutePolicy.conflictingDuty.employeeName} (max 2 days). Check "Exception Request" below to request Manager approval.`
          );
          return;
        }
      }

      if (settings.requireAttachment && !leaveFile) {
        setFormError(lang === 'ar' ? 'إرفاق نموذج الإجازة إلزامي حسب إعدادات النظام.' : 'File attachment is required.');
        return;
      }

      if (leaveSubstitute) {
        const subBusy = vacations.find(
          (v) =>
            v.status !== 'Rejected' &&
            v.employeeName === leaveSubstitute &&
            leaveStart <= v.endDate &&
            leaveEnd >= v.startDate
        );
        if (subBusy) {
          setFormError(
            lang === 'ar'
              ? `البديل المختار (${leaveSubstitute}) لديه إجازة متداخلة في نفس الفترة.`
              : `Selected substitute (${leaveSubstitute}) has overlapping leave.`
          );
          return;
        }
      }

      // Annual limit check
      const contractConfig = settings.contractTypes.find(
        (c) => c.name.trim().toLowerCase() === activeEmployee.contractType.trim().toLowerCase()
      );
      if (contractConfig?.annualLeaveLimit && contractConfig.annualLeaveLimit > 0) {
        const targetYear = Number(leaveStart.slice(0, 4));
        const usedYear = vacations
          .filter(
            (v) =>
              v.employeeId === activeEmployee.id &&
              v.status !== 'Rejected' &&
              Number(v.startDate.slice(0, 4)) === targetYear
          )
          .reduce((sum, v) => sum + v.days, 0);
        if (usedYear + leaveDaysBreakdown.workDays > contractConfig.annualLeaveLimit) {
          setFormError(
            lang === 'ar'
              ? `تجاوز الرصيد السنوي (${contractConfig.annualLeaveLimit} يوم عمل). المستهلك/المعلق: ${usedYear}، المطلوب: ${leaveDaysBreakdown.workDays}.`
              : `Exceeds annual limit (${contractConfig.annualLeaveLimit} days). Used: ${usedYear}, Requested: ${leaveDaysBreakdown.workDays}.`
          );
          return;
        }
      }

      let attachmentData: string | undefined;
      let attachmentName: string | undefined;
      if (leaveFile) {
        try {
          attachmentData = await convertFileToBase64(leaveFile);
          attachmentName = leaveFile.name;
        } catch {
          setFormError(lang === 'ar' ? 'تعذر قراءة الملف المرفق.' : 'Failed to process attachment.');
          return;
        }
      }

      const vacId = generateId();
      const created: Vacation = {
        id: vacId,
        employeeId: activeEmployee.id,
        employeeName: activeEmployee.fullName,
        startDate: leaveStart,
        endDate: leaveEnd,
        days: leaveDaysBreakdown.workDays,
        type: effectiveType,
        substitute: leaveSubstitute,
        notes: leaveNotes,
        status: 'Pending',
        attachment: attachmentName,
        attachmentData,
        createdAt: new Date().toISOString(),
      };
      setVacations((prev) => [...prev, created]);
      if (substitutePolicy.approvedException && !substitutePolicy.approvedException.consumedVacationId) {
        onMarkExceptionConsumed(substitutePolicy.approvedException.id, vacId);
      }
      onLogAudit(
        lang === 'ar' ? 'طلب إجازة من صفحة طلباتي' : 'Submitted Personal Leave',
        `${activeEmployee.fullName} · ${created.days}d`,
        'vacation'
      );
      onToast('success', lang === 'ar' ? 'تم إرسال طلب الإجازة بنجاح.' : 'Leave request submitted.');
      onNotify?.({
        type: 'request',
        titleAr: 'طلب إجازة جديد من الموظف',
        titleEn: 'New Employee Leave Request',
        messageAr: `${activeEmployee.fullName} · ${created.days} أيام (${leaveStart} → ${leaveEnd})`,
        messageEn: `${activeEmployee.fullName} · ${created.days} days (${leaveStart} → ${leaveEnd})`,
        targetView: 'requests',
        targetSubTab: 'leaves',
      });
      setLeaveNotes('');
      setLeaveFile(null);
      setRequestException(false);
      setExceptionReason('');
      setIsComposerOpen(false);
      return;
    }

    if (composerTab === 'exit') {
      if (formExitDuration <= 0) {
        setFormError(lang === 'ar' ? 'وقت العودة يجب أن يكون بعد وقت الخروج.' : 'Return time must be after exit time.');
        return;
      }
      const usage = getEmployeeMonthlyExitUsage(activeEmployee.id, exitDate, exitPermissions);
      if (usage.usedMinutes + formExitDuration > MONTHLY_EXIT_LIMIT_MINUTES) {
        setFormError(
          lang === 'ar'
            ? `تجاوز الحد الشهري لإذن الخروج (${usage.yearMonth}): يُسمح بـ ٦ ساعات شهرياً فقط. المستهلك: ${formatMinutesLabel(
                usage.usedMinutes,
                'ar'
              )} · المتبقي: ${formatMinutesLabel(usage.remainingMinutes, 'ar')} · المطلوب: ${formatMinutesLabel(
                formExitDuration,
                'ar'
              )}.`
            : `Monthly exit limit exceeded (${usage.yearMonth}): max 6h/month. Used ${formatMinutesLabel(
                usage.usedMinutes,
                'en'
              )}, Remaining ${formatMinutesLabel(usage.remainingMinutes, 'en')}, Requested ${formatMinutesLabel(
                formExitDuration,
                'en'
              )}.`
        );
        return;
      }
      const created: ExitPermission = {
        id: generateId(),
        employeeId: activeEmployee.id,
        employeeName: activeEmployee.fullName,
        date: exitDate,
        exitTime,
        returnTime,
        durationMinutes: formExitDuration,
        reasonType: exitReasonType,
        notes: exitNotes.trim(),
        status: 'Pending',
        createdAt: new Date().toISOString(),
      };
      setExitPermissions((prev) => [created, ...prev]);
      onLogAudit(
        lang === 'ar' ? 'إذن خروج من صفحة طلباتي' : 'Submitted Gate Exit Permit',
        `${activeEmployee.fullName} (${exitDate})`,
        'request'
      );
      onToast('success', lang === 'ar' ? 'تم إرسال طلب إذن الخروج.' : 'Exit permit submitted.');
      onNotify?.({
        type: 'request',
        titleAr: 'إذن خروج جديد من الموظف',
        titleEn: 'New Employee Exit Permit',
        messageAr: `${activeEmployee.fullName} (${exitTime} → ${returnTime})`,
        messageEn: `${activeEmployee.fullName} (${exitTime} → ${returnTime})`,
        targetView: 'requests',
        targetSubTab: 'exit_permits',
      });
      setExitNotes('');
      setIsComposerOpen(false);
      return;
    }

    // HR administrative request
    if (!adminTitle.trim()) {
      setFormError(lang === 'ar' ? 'يرجى كتابة عنوان الطلب الإداري.' : 'Request subject is required.');
      return;
    }
    const createdReq: EmployeeRequest = {
      id: generateId(),
      employeeId: activeEmployee.id,
      employeeName: activeEmployee.fullName,
      requestType: adminReqType,
      priority: adminPriority,
      title: adminTitle.trim(),
      details: adminDetails.trim(),
      targetDate: adminTargetDate,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };
    setEmployeeRequests((prev) => [createdReq, ...prev]);
    onLogAudit(
      lang === 'ar' ? 'طلب إداري من صفحة طلباتي' : 'Submitted HR Request',
      `${activeEmployee.fullName} · ${createdReq.title}`,
      'request'
    );
    onToast('success', lang === 'ar' ? 'تم إرسال الطلب الإداري بنجاح.' : 'HR request submitted.');
    onNotify?.({
      type: 'request',
      titleAr: 'طلب إداري جديد من الموظف',
      titleEn: 'New Employee HR Request',
      messageAr: `${activeEmployee.fullName} · ${createdReq.title}`,
      messageEn: `${activeEmployee.fullName} · ${createdReq.title}`,
      targetView: 'requests',
      targetSubTab: 'hr_requests',
    });
    setAdminTitle('');
    setAdminDetails('');
    setIsComposerOpen(false);
  };

  const executeWithdraw = () => {
    if (!withdrawTarget) return;
    if (withdrawTarget.category === 'leave') {
      setVacations((prev) => prev.filter((v) => v.id !== withdrawTarget.id));
    } else if (withdrawTarget.category === 'exit') {
      setExitPermissions((prev) => prev.filter((e) => e.id !== withdrawTarget.id));
    } else if (withdrawTarget.category === 'admin') {
      setEmployeeRequests((prev) => prev.filter((r) => r.id !== withdrawTarget.id));
    } else if (withdrawTarget.category === 'exception') {
      setSubstituteExceptions((prev) => prev.filter((ex) => ex.id !== withdrawTarget.id));
    }
    onLogAudit(
      lang === 'ar' ? 'إلغاء طلب شخصي' : 'Withdrew Request',
      `${activeEmployee?.fullName || ''} · ${withdrawTarget.title}`,
      'request'
    );
    onToast('info', lang === 'ar' ? 'تم إلغاء وسحب الطلب.' : 'Request withdrawn.');
    setWithdrawTarget(null);
  };

  if (!activeEmployee) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-12 text-center space-y-2 text-[var(--text-muted)]">
        <ClipboardList size={36} className="mx-auto opacity-45" />
        <p className="text-sm font-medium text-[var(--text-main)]">{t(lang, 'myRequestsNoEmployeeLinked')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Header Strip with Single-Line Identity & 3 Self-Service Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3.5 min-w-0">
          <AvatarWithFallback name={activeEmployee.fullName} sizeClass="w-11 h-11" />
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">
              {t(lang, 'myRequestsTitle')}
            </h2>
            <p className="text-xs text-[var(--text-muted)] truncate">
              <span className="font-semibold text-[var(--text-main)]">{activeEmployee.fullName}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono-tabular">{activeEmployee.adminId}</span>
              <span aria-hidden="true"> · </span>
              <span>{activeEmployee.department}</span>
              <span aria-hidden="true"> · </span>
              <span>{activeEmployee.contractType}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canSwitchEmployee && (
            <select
              aria-label={t(lang, 'myRequestsSelectEmployee')}
              value={activeEmployee.id}
              onChange={(e) => {
                setSelectedEmployeeId(e.target.value);
                setFormError('');
              }}
              className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--primary)] max-w-[230px]"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.adminId})
                </option>
              ))}
            </select>
          )}
          {activeSubTab === 'exit' && (
            <button
              type="button"
              onClick={() => {
                setIsComposerOpen((open) => !open);
                setFormError('');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isComposerOpen ? <X size={15} /> : <Plus size={15} />}
              <span>{isComposerOpen ? t(lang, 'myRequestsCloseFormBtn') : t(lang, 'myRequestsNewBtn')}</span>
            </button>
          )}
        </div>
      </div>

      {/* 3 Sub-Tabs Navigation Bar: طلب إجازة | طلب إذن خروج | الحضور والانصراف */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
          {([
            { id: 'leave' as MyRequestsSubTab, label: t(lang, 'myRequestsSubLeave'), icon: Calendar },
            { id: 'exit' as MyRequestsSubTab, label: t(lang, 'myRequestsSubExit'), icon: DoorOpen },
            { id: 'attendance' as MyRequestsSubTab, label: t(lang, 'myRequestsSubAttendance'), icon: Clock },
          ]).map((tab) => {
            const Icon = tab.icon;
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Personal Attendance Tab */}
      {activeSubTab === 'attendance' && setAttendanceRecords && (
        <AttendanceView
          embedded
          forcePersonalScope
          forcedEmployeeId={activeEmployee.id}
          attendanceRecords={attendanceRecords}
          setAttendanceRecords={setAttendanceRecords}
          employees={employees}
          orgUnits={orgUnits}
          vacations={vacations}
          setVacations={setVacations}
          exitPermissions={exitPermissions}
          setExitPermissions={setExitPermissions}
          substituteExceptions={substituteExceptions}
          onSubmitSubstituteException={onSubmitSubstituteException}
          onMarkExceptionConsumed={onMarkExceptionConsumed}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details, cat, targetEmpId) =>
            onLogAttendanceAudit
              ? onLogAttendanceAudit(action, details, cat, targetEmpId)
              : onLogAudit(action, details, cat === 'attendance' ? 'request' : cat)
          }
          onToast={onToast}
          onNotify={onNotify}
        />
      )}

      {activeSubTab !== 'attendance' && (
        <>

      {/* Band 1: 4-Card Personal Allowances & Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[var(--card-bg)] p-5 rounded-xl border border-[var(--border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'myRequestsAnnualBalance')}</span>
            <Calendar size={17} className="text-[var(--primary-text)]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold font-mono-tabular">
              {leaveBalance?.remainingDays ?? 0}
            </span>
            <span className="text-xs text-[var(--text-muted)] font-mono-tabular">
              / {leaveBalance?.annualLimit ?? 0} {t(lang, 'workDays')}
            </span>
          </div>
          <div className="h-1.5 bg-[var(--app-bg)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--primary)] rounded-full"
              style={{ width: `${leaveBalance?.utilizationPercent ?? 0}%` }}
            />
          </div>
          <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular">
            {t(lang, 'usedDays')}: {leaveBalance?.approvedDays ?? 0} · {t(lang, 'pendingDaysCol')}: {leaveBalance?.pendingDays ?? 0}
          </div>
        </div>

        <div className="bg-[var(--card-bg)] p-5 rounded-xl border border-[var(--border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'myRequestsExitQuota')}</span>
            <DoorOpen size={17} className="text-[var(--primary-text)]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold font-mono-tabular">
              {formatMinutesLabel(currentMonthExitUsage?.remainingMinutes ?? MONTHLY_EXIT_LIMIT_MINUTES, lang)}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {t(lang, 'exitMonthlyRemainingLabel')}
            </span>
          </div>
          <div className="h-1.5 bg-[var(--app-bg)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--primary)] rounded-full"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(((currentMonthExitUsage?.usedMinutes ?? 0) / MONTHLY_EXIT_LIMIT_MINUTES) * 100)
                )}%`,
              }}
            />
          </div>
          <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular">
            {t(lang, 'exitMonthlyUsedLabel')}: {formatMinutesLabel(currentMonthExitUsage?.usedMinutes ?? 0, lang)} ·{' '}
            {currentMonthExitUsage?.yearMonth}
          </div>
        </div>

        <div className="bg-[var(--card-bg)] p-5 rounded-xl border border-[var(--border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'myRequestsTotalCount')}</span>
            <ClipboardList size={17} className="text-[var(--primary-text)]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold font-mono-tabular">{counts.all}</span>
            <span className="text-xs text-[var(--text-muted)]">{lang === 'ar' ? 'إجمالي الطلبات' : 'Total Submitted'}</span>
          </div>
          <div className="text-[11px] font-mono-tabular flex items-center gap-2 pt-1 text-[var(--text-muted)]">
            <span className="text-[var(--status-warn-text)] font-semibold">
              {counts.pending} {lang === 'ar' ? 'قيد الانتظار' : 'Pending'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-[var(--status-success-text)] font-semibold">
              {counts.approved} {lang === 'ar' ? 'معتمد' : 'Approved'}
            </span>
          </div>
        </div>

        <div className="bg-[var(--card-bg)] p-5 rounded-xl border border-[var(--border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">{t(lang, 'myRequestsSubDuty')}</span>
            <UserCheck size={17} className="text-[var(--primary-text)]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold font-mono-tabular">{myCoverages.length}</span>
            <span className="text-xs text-[var(--text-muted)]">
              {lang === 'ar' ? 'تكليف إنابة مسجل' : 'Assigned Duties'}
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-snug">
            {myCoverages.length > 0
              ? lang === 'ar'
                ? 'حد الإجازة خلال فترة الإنابة يومان ما لم يعتمد المدير استثناءً.'
                : '2-day leave limit applies during coverage unless approved.'
              : lang === 'ar'
              ? 'لا توجد عليك تكليفات بديل نشطة حالياً.'
              : 'No active substitute assignments.'}
          </p>
        </div>
      </div>

      {/* Band 2 (Leave Sub-Tab): Full VacationManager System scoped to active employee */}
      {activeSubTab === 'leave' && (
        <VacationManager
          embedded
          forcedViewMode="list"
          employeeScopeId={activeEmployee.id}
          allowSelfServiceActions
          vacations={vacations}
          employees={employees}
          setVacations={setVacations}
          exitPermissions={exitPermissions}
          substituteExceptions={substituteExceptions}
          onSubmitSubstituteException={onSubmitSubstituteException}
          onMarkExceptionConsumed={onMarkExceptionConsumed}
          onEditReturnedException={(ex) => {
            setReturnedExceptionError('');
            setEditingReturnedException({ ...ex });
          }}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details) => onLogAudit(action, details, 'vacation')}
          onToast={onToast}
          onNotify={
            onNotify
              ? (payload) =>
                  onNotify({
                    ...payload,
                  })
              : undefined
          }
        />
      )}

      {/* Band 2 (Exit & Admin Sub-Tab): Inline Exit / Admin Request Composer */}
      {activeSubTab === 'exit' && isComposerOpen && (
        <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                {t(lang, 'myRequestsNewBtn')}
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                {activeEmployee.fullName} · {activeEmployee.department}
              </p>
            </div>

            <div className="inline-flex p-1 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] gap-1">
              {([
                { id: 'exit' as const, label: t(lang, 'quickTabExit'), icon: DoorOpen },
                { id: 'admin' as const, label: t(lang, 'quickTabAdmin'), icon: FileText },
              ]).map((tab) => {
                const Icon = tab.icon;
                const active = composerTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setComposerTab(tab.id);
                      setFormError('');
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    <Icon size={14} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleSubmitForm} className="p-6 space-y-4">
            {composerTab === 'leave' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'startDate')} *
                    </label>
                    <input
                      type="date"
                      value={leaveStart}
                      onChange={(e) => setLeaveStart(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'endDate')} *
                    </label>
                    <input
                      type="date"
                      value={leaveEnd}
                      onChange={(e) => setLeaveEnd(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'vacationType')} *
                    </label>
                    <select
                      value={leaveType || availableLeaveTypes[0]?.name || 'Annual'}
                      onChange={(e) => setLeaveType(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    >
                      {availableLeaveTypes.map((vt) => (
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
                      <option value="">-</option>
                      {employees
                        .filter((e) => e.id !== activeEmployee.id)
                        .map((e) => (
                          <option key={e.id} value={e.fullName}>
                            {e.fullName}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
                  <span>
                    {t(lang, 'calendarDaysLabel')}: <strong className="font-mono-tabular text-[var(--text-main)]">{leaveDaysBreakdown.calendarDays}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t(lang, 'excludedOffDaysLabel')}: <strong className="font-mono-tabular text-[var(--text-main)]">{leaveDaysBreakdown.excludedOffDays + leaveDaysBreakdown.excludedHolidayDays}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-[var(--primary-text)] font-semibold">
                    {t(lang, 'netWorkDaysLabel')}: <strong className="font-mono-tabular">{leaveDaysBreakdown.workDays}</strong>
                  </span>
                </div>

                {/* Substitute 2-Day Rule + Exception Request Checkbox */}
                {substitutePolicy.assignedDuties.length > 0 && (() => {
                  const displayDuty =
                    substitutePolicy.conflictingDuty ||
                    substitutePolicy.assignedDuties.find((d) => d.endDate >= todayStr) ||
                    substitutePolicy.assignedDuties[0];
                  const isBlocked =
                    Boolean(substitutePolicy.conflictingDuty) &&
                    substitutePolicy.exceedsTwoDayLimit &&
                    !substitutePolicy.approvedException;

                  return (
                    <div
                      className={`p-3.5 rounded-lg border space-y-2.5 text-xs ${
                        substitutePolicy.approvedException
                          ? 'bg-[var(--status-success-bg)]/45 border-[var(--status-success-border)]'
                          : isBlocked
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
                        <div className="space-y-0.5 flex-1">
                          <div className="font-bold text-[var(--text-main)]">
                            {lang === 'ar'
                              ? `تنبيه البديل: أنت بديل للموظف (${displayDuty.employeeName}) · ${displayDuty.startDate} → ${displayDuty.endDate}`
                              : `Substitute Duty: Covering ${displayDuty.employeeName} · ${displayDuty.startDate} → ${displayDuty.endDate}`}
                          </div>
                          {substitutePolicy.approvedException ? (
                            <p className="text-[var(--status-success-text)] font-semibold">
                              {t(lang, 'exceptionApprovedBanner')} ({substitutePolicy.approvedException.requestedDays} {t(lang, 'workDays')})
                            </p>
                          ) : substitutePolicy.pendingException ? (
                            <p className="text-[var(--status-warn-text)] font-semibold">
                              {t(lang, 'exceptionPendingBanner')}
                            </p>
                          ) : substitutePolicy.conflictingDuty && !substitutePolicy.exceedsTwoDayLimit ? (
                            <p className="text-[var(--status-success-text)]">
                              {lang === 'ar'
                                ? `المدة (${leaveDaysBreakdown.workDays} يوم عمل) ضمن حد اليومين المسموح به خلال فترة البديل.`
                                : `Within the 2-day substitute allowance (${leaveDaysBreakdown.workDays}/2 days).`}
                            </p>
                          ) : (
                            <p className="text-[var(--text-muted)]">{t(lang, 'substituteTwoDayHint')}</p>
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
                                setFormError('');
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'notes')}
                    </label>
                    <input
                      type="text"
                      value={leaveNotes}
                      onChange={(e) => setLeaveNotes(e.target.value)}
                      placeholder={lang === 'ar' ? 'ملاحظات أو تفاصيل إضافية...' : 'Optional notes...'}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'attachFormLabel')}{' '}
                      <span className="text-[var(--primary-text)]">
                        {settings.requireAttachment ? t(lang, 'requiredLabel') : t(lang, 'optionalLabel')}
                      </span>
                    </label>
                    <label
                      htmlFor="myRequestsFileUpload"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--app-bg)] text-xs text-[var(--text-muted)] hover:border-[var(--primary)] cursor-pointer truncate"
                    >
                      <Paperclip size={14} />
                      <span className="truncate">{leaveFile ? leaveFile.name : t(lang, 'attachFormLabel')}</span>
                      <input
                        id="myRequestsFileUpload"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) => setLeaveFile(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {composerTab === 'exit' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'exitDate')} *
                    </label>
                    <input
                      type="date"
                      value={exitDate}
                      onChange={(e) => setExitDate(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'exitTime')} *
                    </label>
                    <input
                      type="time"
                      value={exitTime}
                      onChange={(e) => setExitTime(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'returnTime')} *
                    </label>
                    <input
                      type="time"
                      value={returnTime}
                      onChange={(e) => setReturnTime(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'exitReasonType')}
                    </label>
                    <select
                      value={exitReasonType}
                      onChange={(e) => setExitReasonType(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    >
                      <option value="مهمة عمل ميدانية">{lang === 'ar' ? 'مهمة عمل ميدانية' : 'Field Assignment'}</option>
                      <option value="مراجعة مصرفية / رسمية">{lang === 'ar' ? 'مراجعة مصرفية / رسمية' : 'Official Errand'}</option>
                      <option value="مراجعة طبية">{lang === 'ar' ? 'مراجعة طبية' : 'Medical Appointment'}</option>
                      <option value="ظرف شخصي">{lang === 'ar' ? 'ظرف شخصي' : 'Personal Errand'}</option>
                      <option value="استئذان مبكر">{lang === 'ar' ? 'استئذان مبكر' : 'Early Departure'}</option>
                    </select>
                  </div>
                </div>

                {formExitUsage && (
                  <div
                    className={`p-3 rounded-lg border space-y-1.5 text-xs ${
                      formExitUsage.usedMinutes + formExitDuration > MONTHLY_EXIT_LIMIT_MINUTES
                        ? 'bg-[var(--status-danger-bg)]/50 border-[var(--status-danger-border)]'
                        : 'bg-[var(--surface-subtle)] border-[var(--border)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                      <span>
                        {t(lang, 'exitMonthlyQuotaLabel')} ·{' '}
                        <span className="font-mono-tabular">{formExitUsage.yearMonth}</span>
                      </span>
                      <span className="font-mono-tabular text-[var(--primary-text)]">
                        {t(lang, 'exitDuration')}: {formatMinutesLabel(formExitDuration, lang)} ·{' '}
                        {t(lang, 'exitMonthlyRemainingLabel')}: {formatMinutesLabel(formExitUsage.remainingMinutes, lang)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-[var(--app-bg)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          formExitUsage.usedMinutes + formExitDuration > MONTHLY_EXIT_LIMIT_MINUTES
                            ? 'bg-[var(--status-danger-text)]'
                            : 'bg-[var(--primary)]'
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((formExitUsage.usedMinutes + formExitDuration) / MONTHLY_EXIT_LIMIT_MINUTES) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <input
                  type="text"
                  value={exitNotes}
                  onChange={(e) => setExitNotes(e.target.value)}
                  placeholder={t(lang, 'notes')}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
            )}

            {composerTab === 'admin' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'requestTypeLabel')}
                    </label>
                    <select
                      value={adminReqType}
                      onChange={(e) => setAdminReqType(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
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
                        {lang === 'ar' ? 'طلب إداري عام' : 'General Request'}
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'priorityLabel')}
                    </label>
                    <select
                      value={adminPriority}
                      onChange={(e) => setAdminPriority(e.target.value as 'Normal' | 'Urgent')}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    >
                      <option value="Normal">{t(lang, 'priorityNormal')}</option>
                      <option value="Urgent">{t(lang, 'priorityUrgent')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'targetDateLabel')}
                    </label>
                    <input
                      type="date"
                      value={adminTargetDate}
                      onChange={(e) => setAdminTargetDate(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                </div>
                <input
                  type="text"
                  value={adminTitle}
                  onChange={(e) => setAdminTitle(e.target.value)}
                  placeholder={`${t(lang, 'requestTitleLabel')} *`}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
                <textarea
                  rows={2}
                  value={adminDetails}
                  onChange={(e) => setAdminDetails(e.target.value)}
                  placeholder={t(lang, 'requestDetailsLabel')}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                />
              </div>
            )}

            {formError && (
              <div className="p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)] flex items-start gap-2">
                <XCircle size={15} className="shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => {
                  setIsComposerOpen(false);
                  setFormError('');
                }}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                {composerTab === 'leave' &&
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
        </section>
      )}

      {/* Band 3 (Exit & Admin Sub-Tab): Unified Requests Ledger */}
      {activeSubTab === 'exit' && (
      <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--text-main)]">
              {t(lang, 'myRequestsUnifiedLedger')}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] gap-1">
              {([
                { id: 'all' as const, label: t(lang, 'myRequestsAllTypes'), count: counts.all },
                { id: 'leave' as const, label: t(lang, 'myRequestsTypeLeave'), count: counts.leave },
                { id: 'exit' as const, label: t(lang, 'myRequestsTypeExit'), count: counts.exit },
                { id: 'admin' as const, label: t(lang, 'myRequestsTypeAdmin'), count: counts.admin },
                { id: 'exception' as const, label: t(lang, 'myRequestsTypeException'), count: counts.exception },
              ]).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCategoryFilter(f.id)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    categoryFilter === f.id
                      ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {f.label} <span className="font-mono-tabular opacity-75">({f.count})</span>
                </button>
              ))}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-1.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--text-main)] outline-none"
            >
              <option value="all">{t(lang, 'allStatuses')}</option>
              <option value="Pending">{lang === 'ar' ? 'قيد الانتظار' : 'Pending'}</option>
              <option value="Approved">{lang === 'ar' ? 'معتمد' : 'Approved'}</option>
              <option value="Returned">{lang === 'ar' ? 'مُعاد للتعديل' : 'Returned'}</option>
              <option value="Rejected">{lang === 'ar' ? 'مرفوض' : 'Rejected'}</option>
            </select>

            <div className="relative min-w-[200px]">
              <Search
                size={14}
                className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t(lang, 'searchVacationsPlaceholder')}
                className="w-full ps-8 pe-3 py-1.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'myRequestsCategoryCol')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'myRequestsSummaryCol')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'myRequestsMetaCol')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredItems.map((item) => (
                <tr key={`${item.category}-${item.id}`} className="hover:bg-[var(--surface-subtle)]/50">
                  <td className="px-4 py-3.5 text-xs font-semibold text-[var(--primary-text)] whitespace-nowrap">
                    {item.categoryLabel}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-xs text-[var(--text-main)]">{item.title}</div>
                    <div className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                      {item.periodLabel} · {item.metricLabel}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] max-w-md">
                    <p className="truncate">{item.secondaryNote || '-'}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusLabel status={item.status} lang={lang} />
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <div className="inline-flex items-center gap-2 justify-end">
                      {item.category === 'exception' &&
                        item.rawException &&
                        item.rawException.status === 'Approved' &&
                        !item.rawException.consumedVacationId && (
                          <button
                            type="button"
                            onClick={() => {
                              setSubTab('leave');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
                          >
                            <CheckCircle2 size={13} />
                            <span>{lang === 'ar' ? 'إدخال الإجازة الآن' : 'Enter Leave Now'}</span>
                          </button>
                        )}
                      {item.category === 'exception' &&
                        item.rawException &&
                        item.rawException.status === 'Returned' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReturnedExceptionError('');
                              setEditingReturnedException({ ...item.rawException! });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
                          >
                            <Edit size={13} />
                            <span>{t(lang, 'editAndResubmitBtn')}</span>
                          </button>
                        )}
                      {(item.status === 'Pending' || item.status === 'Returned') && (
                        <button
                          type="button"
                          onClick={() => setWithdrawTarget(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:border-[var(--status-danger-border)] cursor-pointer whitespace-nowrap"
                          title={t(lang, 'myRequestsWithdrawBtn')}
                        >
                          <Trash2 size={13} />
                          <span>{t(lang, 'myRequestsWithdrawBtn')}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--text-muted)]">
                    {t(lang, 'myRequestsNoRequests')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {/* Band 4: My Assigned Substitute Coverages */}
      <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-[var(--primary-text)]" />
            <h3 className="font-display text-base font-bold">{t(lang, 'myRequestsCoveragesSection')}</h3>
          </div>
          <span className="text-xs font-mono-tabular text-[var(--text-muted)]">{myCoverages.length}</span>
        </div>

        {myCoverages.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {myCoverages.map((cov) => {
              const isOngoing = cov.startDate <= todayStr && cov.endDate >= todayStr && cov.status === 'Approved';
              const isPast = cov.endDate < todayStr;
              return (
                <div
                  key={cov.id}
                  className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-[var(--text-main)]">
                      {lang === 'ar' ? `بديل عن: ${cov.employeeName}` : `Covering: ${cov.employeeName}`} ·{' '}
                      <span className="text-[var(--text-muted)] font-normal">{translateVacationType(cov.type, lang)}</span>
                    </div>
                    <div className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                      {formatReadableDate(cov.startDate, lang)} → {formatReadableDate(cov.endDate, lang)} ({cov.days}{' '}
                      {t(lang, 'workDays')})
                    </div>
                  </div>
                  <div className="text-xs font-semibold">
                    {isPast ? (
                      <span className="text-[var(--text-muted)]">{t(lang, 'coverageStatusCompleted')}</span>
                    ) : isOngoing ? (
                      <span className="text-[var(--status-warn-text)]">{t(lang, 'coverageStatusActive')}</span>
                    ) : (
                      <span className="text-[var(--primary-text)]">{t(lang, 'coverageStatusScheduled')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-xs text-[var(--text-muted)]">
            {lang === 'ar'
              ? 'لا توجد تكليفات إنابة مسجلة لك حالياً.'
              : 'You have no assigned substitute coverages at the moment.'}
          </div>
        )}
      </section>

        <ConfirmDialog
          open={Boolean(withdrawTarget)}
          title={t(lang, 'confirmActionTitle')}
          message={
            lang === 'ar'
              ? `هل تريد إلغاء وسحب "${withdrawTarget?.title}"؟`
              : `Are you sure you want to withdraw "${withdrawTarget?.title}"?`
          }
          confirmText={t(lang, 'myRequestsWithdrawBtn')}
          cancelText={t(lang, 'cancel')}
          onConfirm={executeWithdraw}
          onCancel={() => setWithdrawTarget(null)}
        />

        {/* Employee Edit & Resubmit Returned Substitute Exception Modal */}
        {editingReturnedException && (
          <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RotateCcw size={17} className="text-[var(--primary-text)]" />
                  <h3 className="font-display font-bold text-base">{t(lang, 'editAndResubmitBtn')}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingReturnedException(null)}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  setReturnedExceptionError('');
                  if (
                    !editingReturnedException.requestedStartDate ||
                    !editingReturnedException.requestedEndDate ||
                    editingReturnedException.requestedStartDate > editingReturnedException.requestedEndDate
                  ) {
                    setReturnedExceptionError(
                      lang === 'ar' ? 'يرجى تحديد نطاق تاريخ صحيح.' : 'Please select a valid date range.'
                    );
                    return;
                  }
                  if (returnedExceptionBreakdown.workDays <= 0) {
                    setReturnedExceptionError(
                      lang === 'ar' ? 'الفترة المختارة تحتوي على 0 يوم عمل فعلي.' : 'Selected dates contain 0 work days.'
                    );
                    return;
                  }
                  const updatedDays = returnedExceptionBreakdown.workDays;
                  setSubstituteExceptions((prev) =>
                    prev.map((item) =>
                      item.id === editingReturnedException.id
                        ? {
                            ...item,
                            requestedStartDate: editingReturnedException.requestedStartDate,
                            requestedEndDate: editingReturnedException.requestedEndDate,
                            requestedDays: updatedDays,
                            vacationType: editingReturnedException.vacationType,
                            reason: editingReturnedException.reason.trim() || item.reason,
                            status: 'Pending',
                            updatedAt: new Date().toISOString(),
                          }
                        : item
                    )
                  );
                  onLogAudit(
                    lang === 'ar' ? 'تعديل وإعادة إرسال طلب استثناء' : 'Resubmitted Substitute Exception',
                    `${editingReturnedException.employeeName} · ${updatedDays} ${t(lang, 'workDays')}`,
                    'vacation'
                  );
                  onToast(
                    'success',
                    lang === 'ar'
                      ? 'تم تعديل طلب الاستثناء وإعادة إرساله للمراجعة.'
                      : 'Exception request updated and resubmitted.'
                  );
                  onNotify?.({
                    type: 'substitute',
                    titleAr: 'إعادة إرسال طلب استثناء بديل',
                    titleEn: 'Substitute Exception Resubmitted',
                    messageAr: `${editingReturnedException.employeeName} عدّل طلب الاستثناء (${updatedDays} ${t(
                      lang,
                      'workDays'
                    )}).`,
                    messageEn: `${editingReturnedException.employeeName} revised the substitute exception (${updatedDays} days).`,
                    targetView: 'requests',
                    targetSubTab: 'exceptions',
                  });
                  setEditingReturnedException(null);
                }}
                className="p-6 space-y-4 text-sm"
              >
                {editingReturnedException.adminNotes && (
                  <div className="p-3 rounded-lg bg-[var(--status-warn-bg)] border border-[var(--status-warn-border)] text-xs text-[var(--status-warn-text)]">
                    <span className="font-bold block mb-0.5">{t(lang, 'exceptionReturnedBanner')}:</span>
                    <span>{editingReturnedException.adminNotes}</span>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] text-xs flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">
                    {lang === 'ar' ? 'تكليف الإنابة عن:' : 'Covering for:'}
                  </span>
                  <span className="font-bold">{editingReturnedException.coveringForEmployeeName}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'startDate')} *
                    </label>
                    <input
                      type="date"
                      value={editingReturnedException.requestedStartDate}
                      onChange={(e) =>
                        setEditingReturnedException({
                          ...editingReturnedException,
                          requestedStartDate: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'endDate')} *
                    </label>
                    <input
                      type="date"
                      value={editingReturnedException.requestedEndDate}
                      onChange={(e) =>
                        setEditingReturnedException({
                          ...editingReturnedException,
                          requestedEndDate: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'vacationType')}
                    </label>
                    <select
                      value={editingReturnedException.vacationType}
                      onChange={(e) =>
                        setEditingReturnedException({
                          ...editingReturnedException,
                          vacationType: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    >
                      {availableLeaveTypes.map((vt) => (
                        <option key={vt.id} value={vt.name}>
                          {translateVacationType(vt.name, lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] text-xs flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">{t(lang, 'netWorkDaysLabel')}:</span>
                    <strong className="font-mono-tabular text-[var(--primary-text)]">
                      {returnedExceptionBreakdown.workDays} {t(lang, 'workDays')}
                    </strong>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'notes')}
                  </label>
                  <textarea
                    rows={3}
                    value={editingReturnedException.reason}
                    onChange={(e) =>
                      setEditingReturnedException({
                        ...editingReturnedException,
                        reason: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                  />
                </div>

                {returnedExceptionError && (
                  <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
                    {returnedExceptionError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setEditingReturnedException(null)}
                    className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
                  >
                    {t(lang, 'cancel')}
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                  >
                    <RotateCcw size={14} />
                    <span>{t(lang, 'editAndResubmitBtn')}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </>
      )}
    </div>
  );
};

export default MyRequestsView;
