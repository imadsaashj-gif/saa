import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  DoorOpen,
  Edit,
  FileText,
  Plus,
  Printer,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  AppUser,
  Employee,
  EmployeeRequest,
  ExitPermission,
  Language,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
  generateId,
} from '../types';
import { t } from '../i18n';
import {
  MONTHLY_EXIT_LIMIT_MINUTES,
  formatMinutesLabel,
  formatReadableDate,
  getEmployeeMonthlyExitUsage,
  getTodayStr,
} from '../utils/leaveCalculations';
import { emblemImg } from '../assets';
import { computeTimeDiffMinutes } from './QuickRequestModal';
import VacationManager from './VacationManager';
import LeaveBalancesView from './LeaveBalancesView';
import SubstitutesView from './SubstitutesView';
import SubstituteExceptionsView from './SubstituteExceptionsView';
import { AvatarWithFallback, ConfirmDialog, StatusLabel } from './UIPrimitives';

export type RequestsSubTab =
  | 'leaves'
  | 'exit_permits'
  | 'hr_requests'
  | 'calendar'
  | 'balances'
  | 'substitutes'
  | 'exceptions';

export interface NotificationEmitPayload {
  type: 'request' | 'status' | 'substitute' | 'system';
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  targetView?:
    | 'dashboard'
    | 'my_requests'
    | 'attendance'
    | 'attendance_hub'
    | 'violations'
    | 'absences'
    | 'requests'
    | 'org'
    | 'archive'
    | 'settings'
    | 'audit'
    | 'ai';
  targetSubTab?: string;
}

interface RequestsHubProps {
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  exitPermissions: ExitPermission[];
  setExitPermissions: React.Dispatch<React.SetStateAction<ExitPermission[]>>;
  employeeRequests: EmployeeRequest[];
  setEmployeeRequests: React.Dispatch<React.SetStateAction<EmployeeRequest[]>>;
  substituteExceptions?: SubstituteExceptionRequest[];
  setSubstituteExceptions?: React.Dispatch<React.SetStateAction<SubstituteExceptionRequest[]>>;
  onSubmitSubstituteException?: (req: SubstituteExceptionRequest) => void;
  onResolveSubstituteException?: (id: string, status: 'Approved' | 'Rejected') => void;
  onMarkExceptionConsumed?: (exceptionId: string, vacationId: string) => void;
  employees: Employee[];
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  preselectedEmployeeId?: string | null;
  onClearPreselectedEmployee?: () => void;
  activeSubTab?: RequestsSubTab;
  onChangeSubTab?: (tab: RequestsSubTab) => void;
  initialSubTab?: RequestsSubTab | null;
  onClearInitialSubTab?: () => void;
  onLogAudit: (action: string, details: string, category: 'vacation' | 'request') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: NotificationEmitPayload) => void;
}

const RequestsHub: React.FC<RequestsHubProps> = ({
  vacations,
  setVacations,
  exitPermissions,
  setExitPermissions,
  employeeRequests,
  setEmployeeRequests,
  substituteExceptions = [],
  setSubstituteExceptions,
  onSubmitSubstituteException,
  onResolveSubstituteException,
  onMarkExceptionConsumed,
  employees,
  settings,
  lang,
  currentUser,
  preselectedEmployeeId,
  onClearPreselectedEmployee,
  activeSubTab,
  onChangeSubTab,
  initialSubTab,
  onClearInitialSubTab,
  onLogAudit,
  onToast,
  onNotify,
}) => {
  const [internalSubTab, setInternalSubTab] = useState<RequestsSubTab>('leaves');
  const subTab = activeSubTab ?? internalSubTab;
  const setSubTab = (next: RequestsSubTab) => {
    setInternalSubTab(next);
    onChangeSubTab?.(next);
  };

  useEffect(() => {
    if (preselectedEmployeeId) {
      setInternalSubTab('leaves');
      onChangeSubTab?.('leaves');
    }
  }, [preselectedEmployeeId, onChangeSubTab]);

  useEffect(() => {
    if (initialSubTab) {
      setInternalSubTab(initialSubTab);
      onChangeSubTab?.(initialSubTab);
      onClearInitialSubTab?.();
    }
  }, [initialSubTab, onClearInitialSubTab, onChangeSubTab]);

  const canManage = currentUser?.permissions.includes('manage_vacations') ?? false;
  const brandingOrgName =
    lang === 'ar'
      ? settings.branding?.orgNameAr || t(lang, 'brandTitle')
      : settings.branding?.orgNameEn || t(lang, 'brandTitle');
  const brandingLogo = settings.branding?.logoDataUrl || emblemImg;

  const pendingLeavesCount = vacations.filter((v) => v.status === 'Pending').length;
  const pendingHrCount = employeeRequests.filter((r) => r.status === 'Pending').length;
  const pendingExitsCount = exitPermissions.filter((e) => e.status === 'Pending').length;
  const pendingExceptionsCount = substituteExceptions.filter((e) => e.status === 'Pending').length;

  // ==========================
  // HR Administrative Requests State
  // ==========================
  const [reqFilter, setReqFilter] = useState<'all' | EmployeeRequest['status']>('all');
  const [reqSearch, setReqSearch] = useState('');
  const [editingHrReq, setEditingHrReq] = useState<Partial<EmployeeRequest> | null>(null);
  const [printHrReq, setPrintHrReq] = useState<EmployeeRequest | null>(null);
  const [confirmDeleteHrReq, setConfirmDeleteHrReq] = useState<EmployeeRequest | null>(null);

  // ==========================
  // Exit Permissions State
  // ==========================
  const [exitFilter, setExitFilter] = useState<'all' | ExitPermission['status']>('all');
  const [exitSearch, setExitSearch] = useState('');
  const [editingExit, setEditingExit] = useState<Partial<ExitPermission> | null>(null);
  const [exitModalError, setExitModalError] = useState('');
  const [printExit, setPrintExit] = useState<ExitPermission | null>(null);
  const [confirmDeleteExit, setConfirmDeleteExit] = useState<ExitPermission | null>(null);

  // Shared Reject / Return reason modal for HR Requests & Exit Permits
  const [resolveModal, setResolveModal] = useState<{
    kind: 'hr' | 'exit';
    id: string;
    name: string;
  } | null>(null);
  const [resolveReason, setResolveReason] = useState('');

  const filteredHrRequests = useMemo(() => {
    const q = reqSearch.trim().toLowerCase();
    return employeeRequests
      .filter((r) => {
        const matchStatus = reqFilter === 'all' || r.status === reqFilter;
        const matchQuery =
          !q ||
          r.employeeName.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.requestType.toLowerCase().includes(q);
        return matchStatus && matchQuery;
      })
      .sort((a, b) => (b.createdAt || b.targetDate).localeCompare(a.createdAt || a.targetDate));
  }, [employeeRequests, reqFilter, reqSearch]);

  const filteredExits = useMemo(() => {
    const q = exitSearch.trim().toLowerCase();
    return exitPermissions
      .filter((ex) => {
        const matchStatus = exitFilter === 'all' || ex.status === exitFilter;
        const matchQuery =
          !q ||
          ex.employeeName.toLowerCase().includes(q) ||
          ex.reasonType.toLowerCase().includes(q) ||
          (ex.notes || '').toLowerCase().includes(q);
        return matchStatus && matchQuery;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [exitPermissions, exitFilter, exitSearch]);

  const handleSaveHrRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHrReq?.employeeId || !editingHrReq.title?.trim()) {
      onToast('error', lang === 'ar' ? 'يرجى اختيار الموظف وكتابة عنوان الطلب.' : 'Employee and subject are required.');
      return;
    }
    const emp = employees.find((x) => x.id === editingHrReq.employeeId);
    if (!emp) return;

    if (editingHrReq.id) {
      setEmployeeRequests((prev) =>
        prev.map((r) =>
          r.id === editingHrReq.id
            ? ({
                ...r,
                ...editingHrReq,
                employeeName: emp.fullName,
                title: editingHrReq.title!.trim(),
                details: editingHrReq.details?.trim() || '',
              } as EmployeeRequest)
            : r
        )
      );
      onLogAudit(lang === 'ar' ? 'تعديل طلب إداري' : 'Updated HR Request', `${emp.fullName} · ${editingHrReq.title}`, 'request');
      onToast('success', lang === 'ar' ? 'تم تحديث الطلب الإداري.' : 'HR request updated.');
    } else {
      const created: EmployeeRequest = {
        id: generateId(),
        employeeId: emp.id,
        employeeName: emp.fullName,
        requestType: editingHrReq.requestType || 'شهادة تعريف بالعمل والراتب',
        priority: (editingHrReq.priority as 'Normal' | 'Urgent') || 'Normal',
        title: editingHrReq.title.trim(),
        details: editingHrReq.details?.trim() || '',
        targetDate: editingHrReq.targetDate || getTodayStr(),
        status: 'Pending',
        createdAt: new Date().toISOString(),
      };
      setEmployeeRequests((prev) => [created, ...prev]);
      onLogAudit(lang === 'ar' ? 'إضافة طلب إداري' : 'Created HR Request', `${emp.fullName} · ${created.title}`, 'request');
      onToast('success', lang === 'ar' ? 'تم تسجيل الطلب الإداري.' : 'HR request created.');
      onNotify?.({
        type: 'request',
        titleAr: 'طلب إداري جديد',
        titleEn: 'New HR Request',
        messageAr: `${emp.fullName}: ${created.title}`,
        messageEn: `${emp.fullName}: ${created.title}`,
        targetView: 'requests',
        targetSubTab: 'hr_requests',
      });
    }
    setEditingHrReq(null);
  };

  const handleSaveExitPermit = (e: React.FormEvent) => {
    e.preventDefault();
    setExitModalError('');
    if (!editingExit?.employeeId || !editingExit.date || !editingExit.exitTime || !editingExit.returnTime) {
      const msg = lang === 'ar' ? 'يرجى تعبئة جميع الحقول المطلوبة.' : 'All required fields must be filled.';
      setExitModalError(msg);
      onToast('error', msg);
      return;
    }
    const mins = computeTimeDiffMinutes(editingExit.exitTime, editingExit.returnTime);
    if (mins <= 0) {
      const msg = lang === 'ar' ? 'وقت العودة يجب أن يكون بعد وقت الخروج.' : 'Return time must be after exit time.';
      setExitModalError(msg);
      onToast('error', msg);
      return;
    }
    const emp = employees.find((x) => x.id === editingExit.employeeId);
    if (!emp) return;

    const usage = getEmployeeMonthlyExitUsage(emp.id, editingExit.date, exitPermissions, editingExit.id);
    if (usage.usedMinutes + mins > MONTHLY_EXIT_LIMIT_MINUTES) {
      const msg =
        lang === 'ar'
          ? `تجاوز الحد الشهري لإذن الخروج (${usage.yearMonth}): يُسمح بـ 6 ساعات فقط لكل موظف شهرياً. المستهلك: ${formatMinutesLabel(
              usage.usedMinutes,
              'ar'
            )} · المتبقي: ${formatMinutesLabel(usage.remainingMinutes, 'ar')} · المطلوب: ${formatMinutesLabel(mins, 'ar')}.`
          : `Monthly exit limit exceeded (${usage.yearMonth}): max 6h per employee/month. Used: ${formatMinutesLabel(
              usage.usedMinutes,
              'en'
            )}, Remaining: ${formatMinutesLabel(usage.remainingMinutes, 'en')}, Requested: ${formatMinutesLabel(
              mins,
              'en'
            )}.`;
      setExitModalError(msg);
      onToast('error', msg);
      return;
    }

    if (editingExit.id) {
      setExitPermissions((prev) =>
        prev.map((ex) =>
          ex.id === editingExit.id
            ? ({
                ...ex,
                ...editingExit,
                employeeName: emp.fullName,
                durationMinutes: mins,
              } as ExitPermission)
            : ex
        )
      );
      onLogAudit(lang === 'ar' ? 'تعديل إذن خروج' : 'Updated Exit Permit', `${emp.fullName} (${editingExit.date})`, 'request');
      onToast('success', lang === 'ar' ? 'تم تحديث إذن الخروج.' : 'Exit permit updated.');
    } else {
      const created: ExitPermission = {
        id: generateId(),
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: editingExit.date,
        exitTime: editingExit.exitTime,
        returnTime: editingExit.returnTime,
        durationMinutes: mins,
        reasonType: editingExit.reasonType || 'مهمة عمل ميدانية',
        notes: editingExit.notes?.trim() || '',
        status: 'Pending',
        createdAt: new Date().toISOString(),
      };
      setExitPermissions((prev) => [created, ...prev]);
      onLogAudit(lang === 'ar' ? 'تسجيل إذن خروج' : 'Created Exit Permit', `${emp.fullName} (${created.date})`, 'request');
      onToast('success', lang === 'ar' ? 'تم تسجيل إذن الخروج.' : 'Exit permit submitted.');
      onNotify?.({
        type: 'request',
        titleAr: 'طلب إذن خروج جديد',
        titleEn: 'New Gate Exit Permit',
        messageAr: `${emp.fullName} (${created.exitTime} → ${created.returnTime})`,
        messageEn: `${emp.fullName} (${created.exitTime} → ${created.returnTime})`,
        targetView: 'requests',
        targetSubTab: 'exit_permits',
      });
    }
    setExitModalError('');
    setEditingExit(null);
  };

  const handleConfirmResolve = (target: 'Returned' | 'Rejected') => {
    if (!resolveModal) return;
    const reasonText = resolveReason.trim();
    if (resolveModal.kind === 'hr') {
      setEmployeeRequests((prev) =>
        prev.map((r) =>
          r.id === resolveModal.id
            ? {
                ...r,
                status: target,
                adminNotes: reasonText ? `[${target}]: ${reasonText}` : r.adminNotes,
              }
            : r
        )
      );
    } else {
      setExitPermissions((prev) =>
        prev.map((ex) =>
          ex.id === resolveModal.id
            ? {
                ...ex,
                status: target,
                notes: reasonText ? `${ex.notes ? ex.notes + '\n' : ''}[${target}]: ${reasonText}` : ex.notes,
              }
            : ex
        )
      );
    }
    onLogAudit(
      target === 'Returned'
        ? lang === 'ar'
          ? 'إعادة طلب للتعديل'
          : 'Returned Request'
        : lang === 'ar'
        ? 'رفض طلب موظف'
        : 'Rejected Request',
      resolveModal.name,
      'request'
    );
    onToast(
      'info',
      target === 'Returned'
        ? lang === 'ar'
          ? 'تمت إعادة الطلب للتعديل.'
          : 'Returned for revision.'
        : lang === 'ar'
        ? 'تم رفض الطلب.'
        : 'Request rejected.'
    );
    onNotify?.({
      type: 'status',
      titleAr:
        target === 'Returned'
          ? lang === 'ar'
            ? 'إعادة طلب للتعديل'
            : 'Request Returned'
          : 'رفض طلب موظف',
      titleEn: target === 'Returned' ? 'Request Returned' : 'Request Rejected',
      messageAr: `${resolveModal.name}${reasonText ? ` — ${reasonText}` : ''}`,
      messageEn: `${resolveModal.name}${reasonText ? ` — ${reasonText}` : ''}`,
      targetView: 'requests',
      targetSubTab: resolveModal.kind === 'hr' ? 'hr_requests' : 'exit_permits',
    });
    setResolveModal(null);
    setResolveReason('');
  };

  const statusFilterLabels: Record<string, string> = {
    all: lang === 'ar' ? 'الكل' : 'All',
    Pending: lang === 'ar' ? 'قيد الانتظار' : 'Pending',
    Approved: lang === 'ar' ? 'معتمد' : 'Approved',
    Returned: lang === 'ar' ? 'مُعاد' : 'Returned',
    Rejected: lang === 'ar' ? 'مرفوض' : 'Rejected',
  };

  return (
    <div className="space-y-5 text-[var(--text-main)]">
      {/* Main Hub Header + 6 Ordered Sub-Pages Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">
            {t(lang, 'requestsHubTitle')}
          </h2>
          <p className="text-sm text-[var(--text-muted)]">{t(lang, 'requestsHubDesc')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
            {([
              { id: 'leaves', label: t(lang, 'subTabLeaves'), icon: Calendar, badge: pendingLeavesCount },
              { id: 'exit_permits', label: t(lang, 'subTabExitPermissions'), icon: DoorOpen, badge: pendingExitsCount },
              { id: 'calendar', label: t(lang, 'subTabCalendar'), icon: CalendarDays, badge: 0 },
              {
                id: 'substitutes',
                label: t(lang, 'subTabSubstitutes'),
                icon: UserCheck,
                badge: 0,
              },
              {
                id: 'exceptions',
                label: t(lang, 'subTabExceptions'),
                icon: ShieldCheck,
                badge: pendingExceptionsCount,
              },
              { id: 'balances', label: t(lang, 'subTabBalances'), icon: Scale, badge: 0 },
            ] as const).map((tab) => {
              const Icon = tab.icon;
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <Icon size={15} />
                  <span>{tab.label}</span>
                  {tab.badge > 0 && (
                    <span className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded bg-[var(--primary-soft)] text-[var(--primary-text)]">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setSubTab('hr_requests')}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'hr_requests'
                ? 'bg-[var(--primary-soft)] text-[var(--primary-text)] border-[var(--primary)]/40'
                : 'bg-[var(--card-bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-main)]'
            }`}
          >
            <FileText size={15} />
            <span>{t(lang, 'subTabEmployeeRequests')}</span>
            {pendingHrCount > 0 && (
              <span className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded bg-[var(--primary-soft)] text-[var(--primary-text)]">
                {pendingHrCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* الإجازات */}
      {subTab === 'leaves' && (
        <VacationManager
          embedded
          forcedViewMode="list"
          vacations={vacations}
          employees={employees}
          setVacations={setVacations}
          exitPermissions={exitPermissions}
          substituteExceptions={substituteExceptions}
          onSubmitSubstituteException={onSubmitSubstituteException}
          onResolveSubstituteException={onResolveSubstituteException}
          onMarkExceptionConsumed={onMarkExceptionConsumed}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          preselectedEmployeeId={preselectedEmployeeId}
          onClearPreselectedEmployee={onClearPreselectedEmployee}
          onLogAudit={(action, details) => onLogAudit(action, details, 'vacation')}
          onToast={onToast}
          onNotify={onNotify}
        />
      )}

      {/* Sub-page 2: طلبات الموظفين الإدارية */}
      {subTab === 'hr_requests' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold">{t(lang, 'hrRequestsTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'hrRequestsDesc')}</p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() =>
                  setEditingHrReq({
                    employeeId: '',
                    requestType: 'شهادة تعريف بالعمل والراتب',
                    priority: 'Normal',
                    title: '',
                    details: '',
                    targetDate: getTodayStr(),
                  })
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={15} />
                <span>{t(lang, 'newHrRequest')}</span>
              </button>
            )}
          </div>

          <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] gap-1">
              {(['all', 'Pending', 'Approved', 'Returned', 'Rejected'] as const).map((st) => {
                const count =
                  st === 'all' ? employeeRequests.length : employeeRequests.filter((r) => r.status === st).length;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setReqFilter(st)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      reqFilter === st
                        ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    {statusFilterLabels[st]} <span className="font-mono-tabular opacity-75">({count})</span>
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
                value={reqSearch}
                onChange={(e) => setReqSearch(e.target.value)}
                placeholder={t(lang, 'searchVacationsPlaceholder')}
                className="w-full ps-9 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-start">
                <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'requestTypeLabel')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'requestTitleLabel')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'priorityLabel')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'targetDateLabel')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                    <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredHrRequests.map((req) => {
                    const emp = employees.find((e) => e.id === req.employeeId);
                    return (
                      <tr key={req.id} className="hover:bg-[var(--surface-subtle)]/50">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <AvatarWithFallback name={req.employeeName} sizeClass="w-8 h-8" />
                            <div>
                              <div className="font-semibold">{req.employeeName}</div>
                              <div className="text-xs text-[var(--text-muted)]">{emp?.department || '-'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs font-medium">{req.requestType}</td>
                        <td className="px-4 py-3.5">
                          <div className="text-xs font-semibold">{req.title}</div>
                          {req.details && (
                            <div className="text-[11px] text-[var(--text-muted)] truncate max-w-xs">{req.details}</div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-xs">
                          <span
                            className={`font-semibold ${
                              req.priority === 'Urgent' ? 'text-[var(--status-danger-text)]' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {req.priority === 'Urgent' ? t(lang, 'priorityUrgent') : t(lang, 'priorityNormal')}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono-tabular text-xs text-[var(--text-muted)]">
                          {req.targetDate}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusLabel status={req.status} lang={lang} />
                        </td>
                        <td className="px-4 py-3.5 text-end">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setPrintHrReq(req)}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                              title={t(lang, 'printHrRequest')}
                            >
                              <Printer size={15} />
                            </button>
                            {canManage && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditingHrReq({ ...req })}
                                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                                >
                                  <Edit size={15} />
                                </button>
                                {req.status === 'Pending' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEmployeeRequests((prev) =>
                                          prev.map((x) => (x.id === req.id ? { ...x, status: 'Approved' } : x))
                                        );
                                        onLogAudit(lang === 'ar' ? 'اعتماد طلب إداري' : 'Approved HR Request', req.employeeName, 'request');
                                        onToast('success', lang === 'ar' ? 'تم اعتماد الطلب.' : 'Request approved.');
                                        onNotify?.({
                                          type: 'status',
                                          titleAr: 'اعتماد طلب إداري',
                                          titleEn: 'HR Request Approved',
                                          messageAr: `${req.employeeName} · ${req.title}`,
                                          messageEn: `${req.employeeName} · ${req.title}`,
                                          targetView: 'requests',
                                          targetSubTab: 'hr_requests',
                                        });
                                      }}
                                      className="p-1.5 rounded-lg text-[var(--status-success-text)] hover:bg-[var(--status-success-bg)] cursor-pointer"
                                      title={t(lang, 'approve')}
                                    >
                                      <CheckCircle2 size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setResolveModal({ kind: 'hr', id: req.id, name: req.employeeName })}
                                      className="p-1.5 rounded-lg text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                                      title={t(lang, 'resolveRequestTitle')}
                                    >
                                      <XCircle size={16} />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteHrReq(req)}
                                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredHrRequests.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                        {t(lang, 'noHrRequests')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Sub-page 3: إذن الخروج */}
      {subTab === 'exit_permits' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold">{t(lang, 'exitPermitsTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'exitPermitsDesc')}</p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setExitModalError('');
                  setEditingExit({
                    employeeId: '',
                    date: getTodayStr(),
                    exitTime: '10:00',
                    returnTime: '12:00',
                    reasonType: 'مهمة عمل ميدانية',
                    notes: '',
                  });
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={15} />
                <span>{t(lang, 'newExitPermit')}</span>
              </button>
            )}
          </div>

          <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] gap-1">
              {(['all', 'Pending', 'Approved', 'Returned', 'Rejected'] as const).map((st) => {
                const count =
                  st === 'all' ? exitPermissions.length : exitPermissions.filter((x) => x.status === st).length;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setExitFilter(st)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      exitFilter === st
                        ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    {statusFilterLabels[st]} <span className="font-mono-tabular opacity-75">({count})</span>
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
                value={exitSearch}
                onChange={(e) => setExitSearch(e.target.value)}
                placeholder={t(lang, 'searchVacationsPlaceholder')}
                className="w-full ps-9 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-start">
                <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'exitReasonType')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'exitDate')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'exitTime')} → {t(lang, 'returnTime')}</th>
                    <th className="px-4 py-3 text-end font-semibold">{t(lang, 'exitDuration')}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                    <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredExits.map((ex) => {
                    const emp = employees.find((e) => e.id === ex.employeeId);
                    const hrs = Math.floor(ex.durationMinutes / 60);
                    const mins = ex.durationMinutes % 60;
                    const monthUsage = getEmployeeMonthlyExitUsage(ex.employeeId, ex.date, exitPermissions);
                    return (
                      <tr key={ex.id} className="hover:bg-[var(--surface-subtle)]/50">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <AvatarWithFallback name={ex.employeeName} sizeClass="w-8 h-8" />
                            <div>
                              <div className="font-semibold">{ex.employeeName}</div>
                              <div className="text-xs text-[var(--text-muted)]">{emp?.department || '-'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs">
                          <div className="font-medium">{ex.reasonType}</div>
                          {ex.notes && (
                            <div className="text-[11px] text-[var(--text-muted)] truncate max-w-xs">{ex.notes}</div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono-tabular text-xs text-[var(--text-muted)]">{ex.date}</td>
                        <td className="px-4 py-3.5 font-mono-tabular text-xs">
                          {ex.exitTime} → {ex.returnTime}
                        </td>
                        <td className="px-4 py-3.5 text-end font-mono-tabular">
                          <div className="font-semibold text-xs text-[var(--primary-text)]">
                            {hrs > 0 ? `${hrs}h ` : ''}{mins}m
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {lang === 'ar'
                              ? `الشهر: ${formatMinutesLabel(monthUsage.usedMinutes, 'ar')} / ٦ ساعات`
                              : `Month: ${formatMinutesLabel(monthUsage.usedMinutes, 'en')} / 6h`}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusLabel status={ex.status} lang={lang} />
                        </td>
                        <td className="px-4 py-3.5 text-end">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setPrintExit(ex)}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                              title={t(lang, 'printExitPass')}
                            >
                              <Printer size={15} />
                            </button>
                            {canManage && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExitModalError('');
                                    setEditingExit({ ...ex });
                                  }}
                                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                                >
                                  <Edit size={15} />
                                </button>
                                {ex.status === 'Pending' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const usedExcluding = getEmployeeMonthlyExitUsage(
                                          ex.employeeId,
                                          ex.date,
                                          exitPermissions,
                                          ex.id
                                        );
                                        if (usedExcluding.usedMinutes + ex.durationMinutes > MONTHLY_EXIT_LIMIT_MINUTES) {
                                          onToast('error', t(lang, 'exitMonthlyExceededError'));
                                          return;
                                        }
                                        setExitPermissions((prev) =>
                                          prev.map((item) => (item.id === ex.id ? { ...item, status: 'Approved' } : item))
                                        );
                                        onLogAudit(lang === 'ar' ? 'اعتماد إذن خروج' : 'Approved Exit Permit', ex.employeeName, 'request');
                                        onToast('success', lang === 'ar' ? 'تم اعتماد إذن الخروج.' : 'Exit permit approved.');
                                        onNotify?.({
                                          type: 'status',
                                          titleAr: 'اعتماد إذن خروج',
                                          titleEn: 'Exit Permit Approved',
                                          messageAr: `${ex.employeeName} (${ex.date})`,
                                          messageEn: `${ex.employeeName} (${ex.date})`,
                                          targetView: 'requests',
                                          targetSubTab: 'exit_permits',
                                        });
                                      }}
                                      className="p-1.5 rounded-lg text-[var(--status-success-text)] hover:bg-[var(--status-success-bg)] cursor-pointer"
                                      title={t(lang, 'approve')}
                                    >
                                      <CheckCircle2 size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setResolveModal({ kind: 'exit', id: ex.id, name: ex.employeeName })}
                                      className="p-1.5 rounded-lg text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                                      title={t(lang, 'resolveRequestTitle')}
                                    >
                                      <XCircle size={16} />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteExit(ex)}
                                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredExits.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                        {t(lang, 'noExitPermits')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* التقويم */}
      {subTab === 'calendar' && (
        <VacationManager
          embedded
          forcedViewMode="calendar"
          vacations={vacations}
          employees={employees}
          setVacations={setVacations}
          exitPermissions={exitPermissions}
          substituteExceptions={substituteExceptions}
          onSubmitSubstituteException={onSubmitSubstituteException}
          onResolveSubstituteException={onResolveSubstituteException}
          onMarkExceptionConsumed={onMarkExceptionConsumed}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details) => onLogAudit(action, details, 'vacation')}
          onToast={onToast}
          onNotify={onNotify}
        />
      )}

      {/* أرصدة الإجازات */}
      {subTab === 'balances' && (
        <LeaveBalancesView
          embedded
          employees={employees}
          vacations={vacations}
          settings={settings}
          lang={lang}
          onToast={onToast}
        />
      )}

      {/* الموظفين البدلاء */}
      {subTab === 'substitutes' && (
        <SubstitutesView
          employees={employees}
          vacations={vacations}
          setVacations={setVacations}
          substituteExceptions={substituteExceptions}
          onResolveSubstituteException={onResolveSubstituteException}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details) => onLogAudit(action, details, 'vacation')}
          onToast={onToast}
          onNotify={onNotify}
        />
      )}

      {/* طلبات استثناء إجازة البديل */}
      {subTab === 'exceptions' && setSubstituteExceptions && (
        <SubstituteExceptionsView
          substituteExceptions={substituteExceptions}
          setSubstituteExceptions={setSubstituteExceptions}
          vacations={vacations}
          employees={employees}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onResolveSubstituteException={onResolveSubstituteException}
          onLogAudit={onLogAudit}
          onToast={onToast}
          onNotify={onNotify}
        />
      )}

      {/* Add/Edit HR Request Modal */}
      {editingHrReq && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold">{t(lang, 'newHrRequest')}</h3>
              <button
                type="button"
                onClick={() => setEditingHrReq(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveHrRequest} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'employeeCol')} *
                </label>
                <select
                  required
                  value={editingHrReq.employeeId || ''}
                  onChange={(e) => setEditingHrReq({ ...editingHrReq, employeeId: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                >
                  <option value="">{t(lang, 'selectEmployee')}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.adminId})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'requestTypeLabel')}
                  </label>
                  <select
                    value={editingHrReq.requestType || ''}
                    onChange={(e) => setEditingHrReq({ ...editingHrReq, requestType: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                  >
                    <option value="شهادة تعريف بالعمل والراتب">{lang === 'ar' ? 'شهادة تعريف بالعمل والراتب' : 'Employment Certificate'}</option>
                    <option value="صرف عهدة ومعدات ميدانية">{lang === 'ar' ? 'صرف عهدة ومعدات ميدانية' : 'Equipment Custody'}</option>
                    <option value="طلب نقل / تكليف إداري">{lang === 'ar' ? 'طلب نقل / تكليف إداري' : 'Transfer / Assignment'}</option>
                    <option value="شهادة خبرة">{lang === 'ar' ? 'شهادة خبرة' : 'Experience Letter'}</option>
                    <option value="طلب إداري عام">{lang === 'ar' ? 'طلب إداري عام' : 'General Request'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'priorityLabel')}
                  </label>
                  <select
                    value={editingHrReq.priority || 'Normal'}
                    onChange={(e) => setEditingHrReq({ ...editingHrReq, priority: e.target.value as 'Normal' | 'Urgent' })}
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
                  required
                  value={editingHrReq.title || ''}
                  onChange={(e) => setEditingHrReq({ ...editingHrReq, title: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'targetDateLabel')}
                </label>
                <input
                  type="date"
                  value={editingHrReq.targetDate || getTodayStr()}
                  onChange={(e) => setEditingHrReq({ ...editingHrReq, targetDate: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'requestDetailsLabel')}
                </label>
                <textarea
                  rows={3}
                  value={editingHrReq.details || ''}
                  onChange={(e) => setEditingHrReq({ ...editingHrReq, details: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingHrReq(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  {t(lang, 'save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Exit Permit Modal */}
      {editingExit && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold">{t(lang, 'newExitPermit')}</h3>
              <button
                type="button"
                onClick={() => setEditingExit(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveExitPermit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'employeeCol')} *
                </label>
                <select
                  required
                  value={editingExit.employeeId || ''}
                  onChange={(e) => setEditingExit({ ...editingExit, employeeId: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                >
                  <option value="">{t(lang, 'selectEmployee')}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.adminId})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'exitDate')}
                  </label>
                  <input
                    type="date"
                    required
                    value={editingExit.date || getTodayStr()}
                    onChange={(e) => setEditingExit({ ...editingExit, date: e.target.value })}
                    className="w-full px-2.5 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'exitTime')}
                  </label>
                  <input
                    type="time"
                    required
                    value={editingExit.exitTime || '10:00'}
                    onChange={(e) => setEditingExit({ ...editingExit, exitTime: e.target.value })}
                    className="w-full px-2.5 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'returnTime')}
                  </label>
                  <input
                    type="time"
                    required
                    value={editingExit.returnTime || '12:00'}
                    onChange={(e) => setEditingExit({ ...editingExit, returnTime: e.target.value })}
                    className="w-full px-2.5 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none"
                  />
                </div>
              </div>
              <div className="text-xs font-mono-tabular text-[var(--primary-text)]">
                {t(lang, 'exitDuration')}:{' '}
                <strong>
                  {Math.floor(computeTimeDiffMinutes(editingExit.exitTime || '', editingExit.returnTime || '') / 60)}h{' '}
                  {computeTimeDiffMinutes(editingExit.exitTime || '', editingExit.returnTime || '') % 60}m
                </strong>
              </div>
              {editingExit.employeeId && (() => {
                const reqMins = computeTimeDiffMinutes(editingExit.exitTime || '', editingExit.returnTime || '');
                const usage = getEmployeeMonthlyExitUsage(
                  editingExit.employeeId,
                  editingExit.date || getTodayStr(),
                  exitPermissions,
                  editingExit.id
                );
                const overLimit = usage.usedMinutes + reqMins > MONTHLY_EXIT_LIMIT_MINUTES;
                return (
                  <div
                    className={`p-3 rounded-lg border space-y-1.5 text-xs ${
                      overLimit
                        ? 'bg-[var(--status-danger-bg)]/50 border-[var(--status-danger-border)]'
                        : 'bg-[var(--surface-subtle)] border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span>
                        {t(lang, 'exitMonthlyQuotaLabel')} ·{' '}
                        <span className="font-mono-tabular">{usage.yearMonth}</span>
                      </span>
                      <span className="font-mono-tabular text-[var(--primary-text)]">
                        {t(lang, 'exitMonthlyUsedLabel')}: {formatMinutesLabel(usage.usedMinutes, lang)} ·{' '}
                        {t(lang, 'exitMonthlyRemainingLabel')}: {formatMinutesLabel(usage.remainingMinutes, lang)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-[var(--app-bg)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          overLimit ? 'bg-[var(--status-danger-text)]' : 'bg-[var(--primary)]'
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((usage.usedMinutes + reqMins) / MONTHLY_EXIT_LIMIT_MINUTES) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'exitReasonType')}
                </label>
                <select
                  value={editingExit.reasonType || 'مهمة عمل ميدانية'}
                  onChange={(e) => setEditingExit({ ...editingExit, reasonType: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none"
                >
                  <option value="مهمة عمل ميدانية">{lang === 'ar' ? 'مهمة عمل ميدانية' : 'Field Assignment'}</option>
                  <option value="مراجعة مصرفية / رسمية">{lang === 'ar' ? 'مراجعة مصرفية / رسمية' : 'Official Errand'}</option>
                  <option value="مراجعة طبية">{lang === 'ar' ? 'مراجعة طبية' : 'Medical Appointment'}</option>
                  <option value="ظرف شخصي">{lang === 'ar' ? 'ظرف شخصي' : 'Personal Errand'}</option>
                  <option value="استئذان مبكر">{lang === 'ar' ? 'استئذان مبكر' : 'Early Departure'}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">{t(lang, 'notes')}</label>
                <textarea
                  rows={2}
                  value={editingExit.notes || ''}
                  onChange={(e) => setEditingExit({ ...editingExit, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none resize-none"
                />
              </div>
              {exitModalError && (
                <div className="p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
                  {exitModalError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingExit(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  {t(lang, 'save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Modal (Return / Reject) */}
      {resolveModal && (
        <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="border-b border-[var(--border)] pb-3">
              <h3 className="font-display font-bold">{t(lang, 'resolveRequestTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)]">{resolveModal.name}</p>
            </div>
            <textarea
              className="w-full h-24 p-3 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
              placeholder={t(lang, 'reasonPlaceholder')}
              value={resolveReason}
              onChange={(e) => setResolveReason(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleConfirmResolve('Returned')}
                className="w-full py-2 rounded-lg border border-[var(--border)] bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw size={14} />
                <span>{t(lang, 'returnForEdit')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleConfirmResolve('Rejected')}
                className="w-full py-2 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <XCircle size={14} />
                <span>{t(lang, 'reject')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setResolveModal(null);
                  setResolveReason('');
                }}
                className="w-full py-2 text-xs text-[var(--text-muted)] cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable HR Request Slip */}
      {printHrReq && (
        <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="print-only-slip bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
            <div className="no-print px-6 py-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-800">{t(lang, 'printHrRequest')}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8C6A1B] text-white text-xs font-semibold cursor-pointer"
                >
                  <Printer size={14} />
                  <span>{lang === 'ar' ? 'طباعة' : 'Print'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintHrReq(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="p-8 space-y-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <div className="flex items-center justify-between border-b-2 border-[#8C6A1B] pb-4">
                <div className="flex items-center gap-4">
                  <img src={brandingLogo} alt={brandingOrgName} className="w-14 h-14 rounded-lg object-cover border border-slate-300" />
                  <div>
                    <h2 className="font-display text-lg font-bold">{brandingOrgName}</h2>
                    <p className="text-xs text-slate-600">{lang === 'ar' ? 'نموذج طلب إداري رسمي' : 'Official HR Request Form'}</p>
                  </div>
                </div>
                <div className="text-end text-xs font-mono-tabular text-slate-600">
                  <div>REF: {printHrReq.id.slice(0, 8).toUpperCase()}</div>
                  <div>{formatReadableDate(getTodayStr(), lang)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm border border-slate-200 rounded-lg p-4 bg-slate-50">
                <div><span className="text-xs text-slate-500 block">{t(lang, 'fullName')}</span><span className="font-bold">{printHrReq.employeeName}</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'requestTypeLabel')}</span><span>{printHrReq.requestType}</span></div>
                <div className="col-span-2"><span className="text-xs text-slate-500 block">{t(lang, 'requestTitleLabel')}</span><span className="font-bold">{printHrReq.title}</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'targetDateLabel')}</span><span className="font-mono-tabular">{printHrReq.targetDate}</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'statusCol')}</span><span className="font-bold">{printHrReq.status}</span></div>
              </div>
              {printHrReq.details && (
                <div className="text-xs text-slate-700 border border-slate-200 rounded-lg p-3">
                  <span className="font-bold block mb-1">{t(lang, 'requestDetailsLabel')}:</span>
                  <p>{printHrReq.details}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-8 pt-8 text-center text-xs text-slate-700">
                <div className="border-t border-slate-300 pt-2">{lang === 'ar' ? 'توقيع الموظف' : 'Employee Signature'}</div>
                <div className="border-t border-slate-300 pt-2">{lang === 'ar' ? 'اعتماد الشؤون الإدارية' : 'HR Approval'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Printable Exit Pass Modal */}
      {printExit && (
        <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="print-only-slip bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
            <div className="no-print px-6 py-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-800">{t(lang, 'printExitPass')}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8C6A1B] text-white text-xs font-semibold cursor-pointer"
                >
                  <Printer size={14} />
                  <span>{lang === 'ar' ? 'طباعة' : 'Print'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintExit(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="p-8 space-y-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <div className="flex items-center justify-between border-b-2 border-[#8C6A1B] pb-4">
                <div className="flex items-center gap-4">
                  <img src={brandingLogo} alt={brandingOrgName} className="w-14 h-14 rounded-lg object-cover border border-slate-300" />
                  <div>
                    <h2 className="font-display text-lg font-bold">{brandingOrgName}</h2>
                    <p className="text-xs text-slate-600">{lang === 'ar' ? 'تصريح وإذن خروج مؤقت' : 'Official Gate Exit Permit'}</p>
                  </div>
                </div>
                <div className="text-end text-xs font-mono-tabular text-slate-600">
                  <div>REF: {printExit.id.slice(0, 8).toUpperCase()}</div>
                  <div>{printExit.date}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm border border-slate-200 rounded-lg p-4 bg-slate-50">
                <div><span className="text-xs text-slate-500 block">{t(lang, 'fullName')}</span><span className="font-bold">{printExit.employeeName}</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'exitReasonType')}</span><span>{printExit.reasonType}</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'exitTime')}</span><span className="font-mono-tabular">{printExit.exitTime}</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'returnTime')}</span><span className="font-mono-tabular">{printExit.returnTime}</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'exitDuration')}</span><span className="font-mono-tabular font-bold">{printExit.durationMinutes} min</span></div>
                <div><span className="text-xs text-slate-500 block">{t(lang, 'statusCol')}</span><span className="font-bold">{printExit.status}</span></div>
              </div>
              {printExit.notes && (
                <div className="text-xs text-slate-700 border border-slate-200 rounded-lg p-3">
                  <span className="font-bold block mb-1">{t(lang, 'notes')}:</span>
                  <p>{printExit.notes}</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-6 pt-8 text-center text-xs text-slate-700">
                <div className="border-t border-slate-300 pt-2">{lang === 'ar' ? 'توقيع الموظف' : 'Employee'}</div>
                <div className="border-t border-slate-300 pt-2">{lang === 'ar' ? 'المدير المباشر' : 'Manager'}</div>
                <div className="border-t border-slate-300 pt-2">{lang === 'ar' ? 'بوابة الأمن / الخروج' : 'Gate Security'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeleteHrReq)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? `هل تريد حذف الطلب الإداري للموظف "${confirmDeleteHrReq?.employeeName}"؟`
            : `Delete HR request for "${confirmDeleteHrReq?.employeeName}"?`
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => {
          if (confirmDeleteHrReq) {
            setEmployeeRequests((prev) => prev.filter((r) => r.id !== confirmDeleteHrReq.id));
            onLogAudit(lang === 'ar' ? 'حذف طلب إداري' : 'Deleted HR Request', confirmDeleteHrReq.employeeName, 'request');
            onToast('success', lang === 'ar' ? 'تم حذف الطلب الإداري.' : 'HR request deleted.');
          }
          setConfirmDeleteHrReq(null);
        }}
        onCancel={() => setConfirmDeleteHrReq(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteExit)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? `هل تريد حذف إذن الخروج للموظف "${confirmDeleteExit?.employeeName}"؟`
            : `Delete exit permit for "${confirmDeleteExit?.employeeName}"?`
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => {
          if (confirmDeleteExit) {
            setExitPermissions((prev) => prev.filter((x) => x.id !== confirmDeleteExit.id));
            onLogAudit(lang === 'ar' ? 'حذف إذن خروج' : 'Deleted Exit Permit', confirmDeleteExit.employeeName, 'request');
            onToast('success', lang === 'ar' ? 'تم حذف إذن الخروج.' : 'Exit permit deleted.');
          }
          setConfirmDeleteExit(null);
        }}
        onCancel={() => setConfirmDeleteExit(null)}
      />
    </div>
  );
};

export default RequestsHub;
