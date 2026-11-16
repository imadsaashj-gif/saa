import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit,
  Eye,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  AppUser,
  Employee,
  Language,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
  generateId,
} from '../types';
import { t, translateVacationType } from '../i18n';
import { calculateWorkDaysBreakdown, getTodayStr } from '../utils/leaveCalculations';
import { NotificationEmitPayload } from './RequestsHub';
import { AvatarWithFallback, ConfirmDialog, StatusLabel } from './UIPrimitives';

interface SubstituteExceptionsViewProps {
  substituteExceptions: SubstituteExceptionRequest[];
  setSubstituteExceptions: React.Dispatch<React.SetStateAction<SubstituteExceptionRequest[]>>;
  vacations: Vacation[];
  employees: Employee[];
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  onResolveSubstituteException?: (id: string, status: 'Approved' | 'Rejected') => void;
  onLogAudit: (action: string, details: string, category: 'vacation' | 'request') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: NotificationEmitPayload) => void;
}

const SubstituteExceptionsView: React.FC<SubstituteExceptionsViewProps> = ({
  substituteExceptions,
  setSubstituteExceptions,
  vacations,
  employees,
  settings,
  lang,
  currentUser,
  onResolveSubstituteException,
  onLogAudit,
  onToast,
  onNotify,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | SubstituteExceptionRequest['status']>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [viewTarget, setViewTarget] = useState<SubstituteExceptionRequest | null>(null);
  const [editTarget, setEditTarget] = useState<Partial<SubstituteExceptionRequest> | null>(null);
  const [editError, setEditError] = useState('');
  const [returnTarget, setReturnTarget] = useState<SubstituteExceptionRequest | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SubstituteExceptionRequest | null>(null);

  const canManage =
    currentUser?.role === 'SuperAdmin' ||
    currentUser?.role === 'Admin' ||
    currentUser?.role === 'Manager' ||
    Boolean(currentUser?.permissions.includes('approve_exceptions')) ||
    Boolean(currentUser?.permissions.includes('manage_vacations'));

  const canApproveExceptions =
    currentUser?.role === 'SuperAdmin' ||
    currentUser?.role === 'Admin' ||
    currentUser?.role === 'Manager' ||
    Boolean(currentUser?.permissions.includes('approve_exceptions'));

  const counts = useMemo(
    () => ({
      all: substituteExceptions.length,
      Pending: substituteExceptions.filter((e) => e.status === 'Pending').length,
      Approved: substituteExceptions.filter((e) => e.status === 'Approved').length,
      Returned: substituteExceptions.filter((e) => e.status === 'Returned').length,
      Rejected: substituteExceptions.filter((e) => e.status === 'Rejected').length,
    }),
    [substituteExceptions]
  );

  const filteredExceptions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return substituteExceptions
      .filter((ex) => {
        const matchStatus = statusFilter === 'all' || ex.status === statusFilter;
        const matchQuery =
          !q ||
          ex.employeeName.toLowerCase().includes(q) ||
          ex.coveringForEmployeeName.toLowerCase().includes(q) ||
          ex.reason.toLowerCase().includes(q) ||
          translateVacationType(ex.vacationType, lang).toLowerCase().includes(q) ||
          (ex.adminNotes || '').toLowerCase().includes(q);
        return matchStatus && matchQuery;
      })
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }, [substituteExceptions, statusFilter, searchTerm, lang]);

  const statusLabels: Record<'all' | SubstituteExceptionRequest['status'], string> = {
    all: lang === 'ar' ? 'الكل' : 'All',
    Pending: lang === 'ar' ? 'قيد الانتظار' : 'Pending',
    Approved: lang === 'ar' ? 'معتمد' : 'Approved',
    Returned: lang === 'ar' ? 'مُعاد للتعديل' : 'Returned',
    Rejected: lang === 'ar' ? 'مرفوض' : 'Rejected',
  };

  // Compute net work days live inside Add/Edit Exception modal
  const editDaysBreakdown = useMemo(() => {
    if (!editTarget?.requestedStartDate || !editTarget?.requestedEndDate) {
      return { workDays: editTarget?.requestedDays || 0, calendarDays: 0 };
    }
    return calculateWorkDaysBreakdown(
      editTarget.requestedStartDate,
      editTarget.requestedEndDate,
      settings.workWeekDays,
      settings.officialHolidays
    );
  }, [editTarget?.requestedStartDate, editTarget?.requestedEndDate, editTarget?.requestedDays, settings]);

  const editEmployeeDuties = useMemo(() => {
    if (!editTarget?.employeeId) return [];
    const emp = employees.find((e) => e.id === editTarget.employeeId);
    if (!emp) return [];
    const norm = emp.fullName.trim().toLowerCase();
    return vacations
      .filter((v) => v.status !== 'Rejected' && (v.substitute || '').trim().toLowerCase() === norm)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [editTarget?.employeeId, employees, vacations]);

  const openNewExceptionModal = () => {
    setEditError('');
    setEditTarget({
      employeeId: '',
      substituteForVacationId: '',
      coveringForEmployeeName: '',
      coverageStartDate: getTodayStr(),
      coverageEndDate: getTodayStr(),
      requestedStartDate: getTodayStr(),
      requestedEndDate: getTodayStr(),
      vacationType: settings.vacationTypes[0]?.name || 'Annual',
      reason: '',
      adminNotes: '',
      status: 'Pending',
    });
  };

  const handleSaveException = (e: React.FormEvent) => {
    e.preventDefault();
    setEditError('');
    if (!editTarget?.employeeId || !editTarget.requestedStartDate || !editTarget.requestedEndDate) {
      setEditError(
        lang === 'ar' ? 'يرجى تحديد الموظف وتاريخي البداية والنهاية.' : 'Employee and date range are required.'
      );
      return;
    }
    if (editTarget.requestedStartDate > editTarget.requestedEndDate) {
      setEditError(
        lang === 'ar'
          ? 'تاريخ النهاية يجب أن يكون مساوياً أو بعد تاريخ البداية.'
          : 'End date must be on or after start date.'
      );
      return;
    }

    const emp = employees.find((x) => x.id === editTarget.employeeId);
    if (!emp) return;

    const calcDays = editDaysBreakdown.workDays;
    if (calcDays <= 0) {
      setEditError(
        lang === 'ar'
          ? 'الفترة المحددة تحتوي على 0 يوم عمل فعلي.'
          : 'Selected date range has 0 working days.'
      );
      return;
    }

    const duty = vacations.find((v) => v.id === editTarget.substituteForVacationId);
    const coveringName =
      duty?.employeeName || editTarget.coveringForEmployeeName?.trim() || (lang === 'ar' ? 'تكليف إنابة' : 'Coverage');
    const covStart = duty?.startDate || editTarget.coverageStartDate || editTarget.requestedStartDate;
    const covEnd = duty?.endDate || editTarget.coverageEndDate || editTarget.requestedEndDate;

    if (editTarget.id) {
      setSubstituteExceptions((prev) =>
        prev.map((item) =>
          item.id === editTarget.id
            ? {
                ...item,
                employeeId: emp.id,
                employeeName: emp.fullName,
                substituteForVacationId: editTarget.substituteForVacationId || item.substituteForVacationId,
                coveringForEmployeeName: coveringName,
                coverageStartDate: covStart,
                coverageEndDate: covEnd,
                requestedStartDate: editTarget.requestedStartDate!,
                requestedEndDate: editTarget.requestedEndDate!,
                requestedDays: calcDays,
                vacationType: editTarget.vacationType || item.vacationType,
                reason: editTarget.reason?.trim() || item.reason,
                adminNotes: editTarget.adminNotes?.trim() || undefined,
                status: (editTarget.status as SubstituteExceptionRequest['status']) || item.status,
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
      onLogAudit(
        lang === 'ar' ? 'تعديل طلب استثناء بديل' : 'Updated Substitute Exception',
        `${emp.fullName} · ${editTarget.requestedStartDate} → ${editTarget.requestedEndDate} (${calcDays} ${t(lang, 'workDays')})`,
        'vacation'
      );
      onToast('success', lang === 'ar' ? 'تم تحديث طلب الاستثناء بنجاح.' : 'Exception request updated.');
    } else {
      const created: SubstituteExceptionRequest = {
        id: generateId(),
        employeeId: emp.id,
        employeeName: emp.fullName,
        substituteForVacationId: editTarget.substituteForVacationId || '',
        coveringForEmployeeName: coveringName,
        coverageStartDate: covStart,
        coverageEndDate: covEnd,
        requestedStartDate: editTarget.requestedStartDate,
        requestedEndDate: editTarget.requestedEndDate,
        requestedDays: calcDays,
        vacationType: editTarget.vacationType || settings.vacationTypes[0]?.name || 'Annual',
        reason: editTarget.reason?.trim() || (lang === 'ar' ? 'طلب استثناء لتجاوز حد اليومين' : 'Substitute exception'),
        adminNotes: editTarget.adminNotes?.trim() || undefined,
        status: 'Pending',
        createdAt: new Date().toISOString(),
      };
      setSubstituteExceptions((prev) => [created, ...prev]);
      onLogAudit(
        lang === 'ar' ? 'تسجيل طلب استثناء بديل' : 'Created Substitute Exception',
        `${emp.fullName} · ${calcDays} ${t(lang, 'workDays')}`,
        'vacation'
      );
      onToast('success', lang === 'ar' ? 'تم تسجيل طلب الاستثناء.' : 'Exception request created.');
      onNotify?.({
        type: 'substitute',
        titleAr: 'طلب استثناء موظف بديل',
        titleEn: 'New Substitute Exception',
        messageAr: `${emp.fullName}: ${calcDays} ${t('ar', 'workDays')} (${created.requestedStartDate} → ${created.requestedEndDate})`,
        messageEn: `${emp.fullName}: ${calcDays} work days (${created.requestedStartDate} → ${created.requestedEndDate})`,
        targetView: 'requests',
        targetSubTab: 'exceptions',
      });
    }

    setEditTarget(null);
    setEditError('');
  };

  const handleConfirmReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    const reason = returnReason.trim();
    const nowIso = new Date().toISOString();

    setSubstituteExceptions((prev) =>
      prev.map((item) =>
        item.id === returnTarget.id
          ? {
              ...item,
              status: 'Returned',
              adminNotes: reason || (lang === 'ar' ? 'مُعاد للموظف للتعديل والمراجعة' : 'Returned to employee for edit'),
              returnedAt: nowIso,
              updatedAt: nowIso,
            }
          : item
      )
    );

    onLogAudit(
      lang === 'ar' ? 'إرجاع طلب استثناء للتعديل' : 'Returned Substitute Exception',
      `${returnTarget.employeeName}${reason ? ` · ${reason}` : ''}`,
      'vacation'
    );
    onToast(
      'info',
      lang === 'ar'
        ? `تمت إعادة طلب الاستثناء للموظف ${returnTarget.employeeName} للتعديل.`
        : `Exception returned to ${returnTarget.employeeName} for revision.`
    );
    onNotify?.({
      type: 'status',
      titleAr: 'إرجاع طلب استثناء للتعديل',
      titleEn: 'Substitute Exception Returned',
      messageAr: `${returnTarget.employeeName}${reason ? ` — ${reason}` : ''}`,
      messageEn: `${returnTarget.employeeName}${reason ? ` — ${reason}` : ''}`,
      targetView: 'my_requests',
      targetSubTab: 'leave',
    });

    setReturnTarget(null);
    setReturnReason('');
  };

  const handleDeleteException = () => {
    if (!deleteTarget) return;
    setSubstituteExceptions((prev) => prev.filter((item) => item.id !== deleteTarget.id));
    onLogAudit(
      lang === 'ar' ? 'حذف طلب استثناء بديل' : 'Deleted Substitute Exception',
      `${deleteTarget.employeeName} (${deleteTarget.requestedStartDate} → ${deleteTarget.requestedEndDate})`,
      'vacation'
    );
    onToast('success', lang === 'ar' ? 'تم حذف طلب الاستثناء.' : 'Exception request deleted.');
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-4 text-[var(--text-main)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-[var(--text-main)]">
            {t(lang, 'exceptionsQueueTitle')}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">{t(lang, 'exceptionsQueueDesc')}</p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openNewExceptionModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus size={15} />
            <span>{t(lang, 'newExceptionBtn')}</span>
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-xs text-[var(--text-muted)]">{statusLabels.all}</div>
            <div className="font-display text-2xl font-bold font-mono-tabular mt-0.5">{counts.all}</div>
          </div>
          <ShieldCheck size={18} className="text-[var(--primary-text)]" />
        </div>
        <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-xs text-[var(--text-muted)]">{statusLabels.Pending}</div>
            <div className="font-display text-2xl font-bold font-mono-tabular text-[var(--status-warn-text)] mt-0.5">
              {counts.Pending}
            </div>
          </div>
          <Clock size={18} className="text-[var(--status-warn-text)]" />
        </div>
        <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-xs text-[var(--text-muted)]">{statusLabels.Approved}</div>
            <div className="font-display text-2xl font-bold font-mono-tabular text-[var(--status-success-text)] mt-0.5">
              {counts.Approved}
            </div>
          </div>
          <CheckCircle2 size={18} className="text-[var(--status-success-text)]" />
        </div>
        <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-xs text-[var(--text-muted)]">{statusLabels.Returned}</div>
            <div className="font-display text-2xl font-bold font-mono-tabular text-[var(--primary-text)] mt-0.5">
              {counts.Returned}
            </div>
          </div>
          <RotateCcw size={18} className="text-[var(--primary-text)]" />
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] gap-1">
          {(['all', 'Pending', 'Approved', 'Returned', 'Rejected'] as const).map((st) => {
            const active = statusFilter === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {statusLabels[st]} <span className="font-mono-tabular opacity-75">({counts[st]})</span>
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
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t(lang, 'searchVacationsPlaceholder')}
            className="w-full ps-9 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                <th className="px-4 py-3 text-start font-semibold">
                  {lang === 'ar' ? 'مكلّف كبديل عن' : 'Covering For'}
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  {lang === 'ar' ? 'تفاصيل الإجازة المطلوبة' : 'Requested Leave'}
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  {lang === 'ar' ? 'مبرر الاستثناء / الملاحظات' : 'Reason & Notes'}
                </th>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredExceptions.map((ex) => {
                const emp = employees.find((e) => e.id === ex.employeeId);
                return (
                  <tr key={ex.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <AvatarWithFallback name={ex.employeeName} sizeClass="w-8 h-8" />
                        <div>
                          <div className="font-semibold text-[var(--text-main)]">{ex.employeeName}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {emp?.department || '-'} · <span className="font-mono-tabular">{ex.createdAt.slice(0, 10)}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-xs">
                      <div className="font-medium text-[var(--text-main)]">{ex.coveringForEmployeeName}</div>
                      <div className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                        {ex.coverageStartDate} → {ex.coverageEndDate}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-xs">
                      <div className="font-mono-tabular font-semibold text-[var(--primary-text)]">
                        {ex.requestedDays} {t(lang, 'workDays')} · {translateVacationType(ex.vacationType, lang)}
                      </div>
                      <div className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                        {ex.requestedStartDate} → {ex.requestedEndDate}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-xs max-w-xs">
                      <p className="text-[var(--text-main)] line-clamp-2">{ex.reason || '-'}</p>
                      {ex.adminNotes && (
                        <p className="text-[11px] text-[var(--primary-text)] mt-0.5 line-clamp-1">
                          {lang === 'ar' ? `ملاحظة الإدارة: ${ex.adminNotes}` : `Admin Note: ${ex.adminNotes}`}
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-xs">
                      <StatusLabel status={ex.status} lang={lang} />
                      {ex.status === 'Approved' && (
                        <span className="block text-[11px] text-[var(--text-muted)] mt-1">
                          {ex.consumedVacationId
                            ? lang === 'ar'
                              ? 'تم استخدام الاستثناء لإدخال الإجازة'
                              : 'Used for leave entry'
                            : lang === 'ar'
                            ? `معتمد من: ${ex.approvedBy || '-'} (مفتوح للإدخال)`
                            : `Approved by ${ex.approvedBy || '-'} (Unlocked)`}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-end">
                      <div className="inline-flex items-center gap-1 justify-end">
                        {/* View Details */}
                        <button
                          type="button"
                          onClick={() => setViewTarget(ex)}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                          title={t(lang, 'viewExceptionTitle')}
                        >
                          <Eye size={15} />
                        </button>

                        {canManage && (
                          <>
                            {/* Edit */}
                            <button
                              type="button"
                              onClick={() => {
                                setEditError('');
                                setEditTarget({ ...ex });
                              }}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                              title={t(lang, 'editExceptionTitle')}
                            >
                              <Edit size={15} />
                            </button>

                            {/* Approve / Return / Reject */}
                            {(ex.status === 'Pending' || ex.status === 'Returned') && canApproveExceptions && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onResolveSubstituteException?.(ex.id, 'Approved')}
                                  className="p-1.5 rounded-lg text-[var(--status-success-text)] hover:bg-[var(--status-success-bg)] cursor-pointer"
                                  title={t(lang, 'approveExceptionBtn')}
                                >
                                  <CheckCircle2 size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReturnTarget(ex);
                                    setReturnReason(ex.adminNotes || '');
                                  }}
                                  className="p-1.5 rounded-lg text-[var(--primary-text)] hover:bg-[var(--primary-soft)] cursor-pointer"
                                  title={t(lang, 'returnExceptionBtn')}
                                >
                                  <RotateCcw size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onResolveSubstituteException?.(ex.id, 'Rejected')}
                                  className="p-1.5 rounded-lg text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                                  title={t(lang, 'rejectExceptionBtn')}
                                >
                                  <XCircle size={15} />
                                </button>
                              </>
                            )}

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(ex)}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                              title={t(lang, 'deleteLabel')}
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

              {filteredExceptions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                    {lang === 'ar'
                      ? 'لا توجد طلبات استثناء إجازة بديل مطابقة للبحث أو التصفية.'
                      : 'No substitute leave exception requests match your filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Details Modal */}
      {viewTarget && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-[var(--primary-text)]" />
                <h3 className="font-display font-bold text-base">{t(lang, 'viewExceptionTitle')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewTarget(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <AvatarWithFallback name={viewTarget.employeeName} sizeClass="w-10 h-10" />
                  <div>
                    <div className="text-sm font-bold text-[var(--text-main)]">{viewTarget.employeeName}</div>
                    <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular">
                      {employees.find((e) => e.id === viewTarget.employeeId)?.department || '-'} ·{' '}
                      {viewTarget.createdAt.slice(0, 10)}
                    </div>
                  </div>
                </div>
                <StatusLabel status={viewTarget.status} lang={lang} />
              </div>

              <div className="grid grid-cols-2 gap-3 bg-[var(--app-bg)] p-3.5 rounded-lg border border-[var(--border)]">
                <div>
                  <span className="block text-[11px] text-[var(--text-muted)]">
                    {lang === 'ar' ? 'مكلّف كبديل عن' : 'Covering For'}
                  </span>
                  <span className="font-semibold text-[var(--text-main)]">{viewTarget.coveringForEmployeeName}</span>
                </div>
                <div>
                  <span className="block text-[11px] text-[var(--text-muted)]">
                    {lang === 'ar' ? 'فترة تكليف البديل' : 'Coverage Period'}
                  </span>
                  <span className="font-mono-tabular font-semibold">
                    {viewTarget.coverageStartDate} → {viewTarget.coverageEndDate}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-[var(--text-muted)]">{t(lang, 'vacationType')}</span>
                  <span className="font-semibold">{translateVacationType(viewTarget.vacationType, lang)}</span>
                </div>
                <div>
                  <span className="block text-[11px] text-[var(--text-muted)]">{t(lang, 'netWorkDaysLabel')}</span>
                  <span className="font-mono-tabular font-bold text-[var(--primary-text)]">
                    {viewTarget.requestedDays} {t(lang, 'workDays')}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="block text-[11px] text-[var(--text-muted)]">
                    {lang === 'ar' ? 'فترة الإجازة المطلوب استثناؤها' : 'Requested Leave Period'}
                  </span>
                  <span className="font-mono-tabular font-semibold">
                    {viewTarget.requestedStartDate} → {viewTarget.requestedEndDate}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] space-y-1">
                <span className="font-bold text-[var(--text-muted)] block">
                  {lang === 'ar' ? 'مبرر طلب الاستثناء:' : 'Exception Justification:'}
                </span>
                <p className="text-[var(--text-main)] whitespace-pre-wrap leading-relaxed">
                  {viewTarget.reason || '-'}
                </p>
              </div>

              {viewTarget.adminNotes && (
                <div className="p-3 rounded-lg bg-[var(--primary-soft)] border border-[var(--primary)]/35 space-y-1">
                  <span className="font-bold text-[var(--primary-text)] block">
                    {lang === 'ar' ? 'ملاحظات الإدارة / التعديل المطلوب:' : 'Management / Return Notes:'}
                  </span>
                  <p className="text-[var(--text-main)] whitespace-pre-wrap leading-relaxed">
                    {viewTarget.adminNotes}
                  </p>
                </div>
              )}

              {(viewTarget.approvedBy || viewTarget.consumedVacationId) && (
                <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular flex flex-wrap justify-between gap-2">
                  {viewTarget.approvedBy && (
                    <span>
                      {lang === 'ar' ? `بواسطة: ${viewTarget.approvedBy}` : `Reviewed by: ${viewTarget.approvedBy}`}
                    </span>
                  )}
                  {viewTarget.consumedVacationId && (
                    <span className="text-[var(--status-success-text)] font-semibold">
                      {lang === 'ar' ? 'تم استهلاك الاستثناء في سجل الإجازات' : 'Consumed in Leave Ledger'}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap justify-end gap-2">
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    const target = viewTarget;
                    setViewTarget(null);
                    setEditError('');
                    setEditTarget({ ...target });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer"
                >
                  <Edit size={13} />
                  <span>{lang === 'ar' ? 'تعديل' : 'Edit'}</span>
                </button>
              )}
              {(viewTarget.status === 'Pending' || viewTarget.status === 'Returned') && canApproveExceptions && (
                <button
                  type="button"
                  onClick={() => {
                    const target = viewTarget;
                    setViewTarget(null);
                    setReturnTarget(target);
                    setReturnReason(target.adminNotes || '');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                >
                  <RotateCcw size={13} />
                  <span>{t(lang, 'returnExceptionBtn')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewTarget(null)}
                className="px-4 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold cursor-pointer"
              >
                {t(lang, 'close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Exception Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold text-base">
                {editTarget.id ? t(lang, 'editExceptionTitle') : t(lang, 'newExceptionBtn')}
              </h3>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveException} className="p-6 overflow-y-auto space-y-4 text-xs">
              <div>
                <label className="block font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'employeeCol')} *
                </label>
                <select
                  required
                  value={editTarget.employeeId || ''}
                  onChange={(e) =>
                    setEditTarget({
                      ...editTarget,
                      employeeId: e.target.value,
                      substituteForVacationId: '',
                    })
                  }
                  disabled={Boolean(editTarget.id)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] disabled:opacity-70"
                >
                  <option value="">{t(lang, 'selectEmployee')}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.adminId})
                    </option>
                  ))}
                </select>
              </div>

              {editEmployeeDuties.length > 0 ? (
                <div>
                  <label className="block font-medium text-[var(--text-muted)] mb-1">
                    {lang === 'ar' ? 'تكليف البديل المرتبط' : 'Linked Substitute Duty'}
                  </label>
                  <select
                    value={editTarget.substituteForVacationId || ''}
                    onChange={(e) => {
                      const duty = editEmployeeDuties.find((d) => d.id === e.target.value);
                      setEditTarget({
                        ...editTarget,
                        substituteForVacationId: e.target.value,
                        coveringForEmployeeName: duty?.employeeName || editTarget.coveringForEmployeeName,
                        coverageStartDate: duty?.startDate || editTarget.coverageStartDate,
                        coverageEndDate: duty?.endDate || editTarget.coverageEndDate,
                      });
                    }}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    <option value="">
                      {editTarget.coveringForEmployeeName
                        ? `${editTarget.coveringForEmployeeName} (${editTarget.coverageStartDate} → ${editTarget.coverageEndDate})`
                        : lang === 'ar'
                        ? '-- اختر تكليف البديل --'
                        : '-- Select Coverage --'}
                    </option>
                    {editEmployeeDuties.map((duty) => (
                      <option key={duty.id} value={duty.id}>
                        {duty.employeeName} ({duty.startDate} → {duty.endDate})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block font-medium text-[var(--text-muted)] mb-1">
                    {lang === 'ar' ? 'مكلّف كبديل عن' : 'Covering For'}
                  </label>
                  <input
                    type="text"
                    value={editTarget.coveringForEmployeeName || ''}
                    onChange={(e) => setEditTarget({ ...editTarget, coveringForEmployeeName: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'startDate')} *
                  </label>
                  <input
                    type="date"
                    required
                    value={editTarget.requestedStartDate || ''}
                    onChange={(e) => setEditTarget({ ...editTarget, requestedStartDate: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'endDate')} *
                  </label>
                  <input
                    type="date"
                    required
                    value={editTarget.requestedEndDate || ''}
                    onChange={(e) => setEditTarget({ ...editTarget, requestedEndDate: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)]">{t(lang, 'netWorkDaysLabel')}:</span>
                <span className="font-mono-tabular font-bold text-[var(--primary-text)]">
                  {editDaysBreakdown.workDays} {t(lang, 'workDays')}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'vacationType')}
                  </label>
                  <select
                    value={editTarget.vacationType || ''}
                    onChange={(e) => setEditTarget({ ...editTarget, vacationType: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    {settings.vacationTypes.map((vt) => (
                      <option key={vt.id} value={vt.name}>
                        {translateVacationType(vt.name, lang)}
                      </option>
                    ))}
                  </select>
                </div>
                {editTarget.id && canApproveExceptions && (
                  <div>
                    <label className="block font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'statusCol')}
                    </label>
                    <select
                      value={editTarget.status || 'Pending'}
                      onChange={(e) =>
                        setEditTarget({
                          ...editTarget,
                          status: e.target.value as SubstituteExceptionRequest['status'],
                        })
                      }
                      className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    >
                      <option value="Pending">{statusLabels.Pending}</option>
                      <option value="Approved">{statusLabels.Approved}</option>
                      <option value="Returned">{statusLabels.Returned}</option>
                      <option value="Rejected">{statusLabels.Rejected}</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-[var(--text-muted)] mb-1">
                  {lang === 'ar' ? 'مبرر طلب الاستثناء' : 'Exception Reason'}
                </label>
                <textarea
                  rows={2}
                  value={editTarget.reason || ''}
                  onChange={(e) => setEditTarget({ ...editTarget, reason: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                />
              </div>

              <div>
                <label className="block font-medium text-[var(--text-muted)] mb-1">
                  {lang === 'ar' ? 'ملاحظات الإدارة' : 'Admin Notes'}
                </label>
                <input
                  type="text"
                  value={editTarget.adminNotes || ''}
                  onChange={(e) => setEditTarget({ ...editTarget, adminNotes: e.target.value })}
                  placeholder={lang === 'ar' ? 'ملاحظات اختيارية حول القرار أو التعديل...' : 'Optional admin note...'}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              {editError && (
                <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[var(--status-danger-text)]">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
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

      {/* Return to Employee for Edit Modal */}
      {returnTarget && (
        <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmReturn}
            className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="border-b border-[var(--border)] pb-3">
              <h3 className="font-display font-bold text-base">{t(lang, 'returnExceptionTitle')}</h3>
              <p className="text-xs text-[var(--text-muted)]">
                {returnTarget.employeeName} · {returnTarget.requestedStartDate} → {returnTarget.requestedEndDate}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                {lang === 'ar' ? 'سبب الإرجاع / التعديلات المطلوبة من الموظف' : 'Revision Instructions for Employee'}
              </label>
              <textarea
                rows={3}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder={t(lang, 'reasonPlaceholder')}
                className="w-full p-3 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setReturnTarget(null);
                  setReturnReason('');
                }}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                <RotateCcw size={14} />
                <span>{t(lang, 'returnExceptionBtn')}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? `هل أنت متأكد من حذف طلب الاستثناء للموظف "${deleteTarget?.employeeName}"؟`
            : `Delete substitute exception request for "${deleteTarget?.employeeName}"?`
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={handleDeleteException}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default SubstituteExceptionsView;
