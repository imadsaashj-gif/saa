import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  DoorOpen,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  AppUser,
  AttendanceRecord,
  Employee,
  ExitPermission,
  Language,
  SystemSettings,
  Vacation,
} from '../types';
import { t, translateVacationType } from '../i18n';
import { NotificationEmitPayload } from './RequestsHub';
import {
  formatAttendanceDuration,
  getShiftScheduleBounds,
  resolveSyncedRectification,
} from '../utils/attendanceCalculations';
import { formatMinutesLabel, formatReadableDate } from '../utils/leaveCalculations';
import { AvatarWithFallback } from './UIPrimitives';

interface EmployeeViolationsViewProps {
  attendanceRecords: AttendanceRecord[];
  setAttendanceRecords: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  employees: Employee[];
  exitPermissions: ExitPermission[];
  setExitPermissions: React.Dispatch<React.SetStateAction<ExitPermission[]>>;
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
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
  embedded?: boolean;
}

type ViolationsTab = 'pending' | 'resolved' | 'rejected' | 'all';

const EmployeeViolationsView: React.FC<EmployeeViolationsViewProps> = ({
  attendanceRecords,
  setAttendanceRecords,
  employees,
  exitPermissions,
  setExitPermissions,
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
  const canApprove = Boolean(currentUser?.permissions.includes('manage_violations'));

  const [activeTab, setActiveTab] = useState<ViolationsTab>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectModalTarget, setRejectModalTarget] = useState<AttendanceRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Collect all violation incidents with their synced rectification request details
  const violationRows = useMemo(() => {
    return attendanceRecords
      .filter((r) => r.violationType !== 'None')
      .map((rec) => {
        const synced = resolveSyncedRectification(rec, exitPermissions, vacations);
        const emp = employees.find((e) => e.id === rec.employeeId);
        return {
          record: rec,
          employee: emp,
          synced,
        };
      })
      .sort((a, b) => b.record.date.localeCompare(a.record.date));
  }, [attendanceRecords, exitPermissions, vacations, employees]);

  const counts = useMemo(() => {
    const pending = violationRows.filter((v) => v.synced.status === 'Pending').length;
    const resolved = violationRows.filter((v) => v.synced.status === 'Resolved').length;
    const rejected = violationRows.filter((v) => v.synced.status === 'Rejected').length;
    const warningsOnly = violationRows.filter((v) => v.synced.status === 'Unresolved').length;
    return {
      pending,
      resolved,
      rejected,
      warningsOnly,
      allRequests: violationRows.filter((v) => v.synced.status !== 'Unresolved').length,
      allTotal: violationRows.length,
    };
  }, [violationRows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return violationRows.filter((row) => {
      const { record, employee, synced } = row;
      if (activeTab === 'pending' && synced.status !== 'Pending') return false;
      if (activeTab === 'resolved' && synced.status !== 'Resolved') return false;
      if (activeTab === 'rejected' && synced.status !== 'Rejected') return false;
      // In 'all', show all rectification requests + flagged warnings
      if (!q) return true;
      return (
        record.employeeName.toLowerCase().includes(q) ||
        (employee?.department || '').toLowerCase().includes(q) ||
        record.workSite.toLowerCase().includes(q) ||
        record.entryLocation.toLowerCase().includes(q) ||
        (synced.linkedLabel || '').toLowerCase().includes(q)
      );
    });
  }, [violationRows, activeTab, searchQuery]);

  const handleDecision = (
    record: AttendanceRecord,
    decision: 'Approved' | 'Rejected',
    reasonNote?: string
  ) => {
    const nextRegStatus = decision === 'Approved' ? 'Resolved' : 'Rejected';
    const reviewedBy = currentUser?.name || 'Manager';
    const reviewedAt = new Date().toISOString();

    if (record.rectificationType === 'exit_permit' && record.rectificationId) {
      setExitPermissions((prev) =>
        prev.map((ex) => {
          if (ex.id !== record.rectificationId) return ex;
          const noteSuffix = reasonNote ? `${ex.notes ? '\n' : ''}[${decision}]: ${reasonNote}` : '';
          return { ...ex, status: decision, notes: (ex.notes || '') + noteSuffix };
        })
      );
    } else if (record.rectificationType === 'leave' && record.rectificationId) {
      setVacations((prev) =>
        prev.map((v) => {
          if (v.id !== record.rectificationId) return v;
          const noteSuffix = reasonNote ? `${v.notes ? '\n' : ''}[${decision}]: ${reasonNote}` : '';
          return { ...v, status: decision, notes: (v.notes || '') + noteSuffix };
        })
      );
    }

    setAttendanceRecords((prev) =>
      prev.map((r) =>
        r.id === record.id
          ? {
              ...r,
              regularizationStatus: nextRegStatus,
              reviewedBy,
              reviewedAt,
            }
          : r
      )
    );

    onLogAudit(
      decision === 'Approved'
        ? lang === 'ar'
          ? 'اعتماد طلب تصحيح مخالفة دوام'
          : 'Approved Violation Rectification'
        : lang === 'ar'
        ? 'رفض طلب تصحيح مخالفة دوام'
        : 'Rejected Violation Rectification',
      `${record.employeeName} · ${record.date}${reasonNote ? ` (${reasonNote})` : ''}`,
      'attendance',
      record.employeeId
    );

    onNotify?.({
      type: 'status',
      titleAr:
        decision === 'Approved'
          ? `اعتماد تصحيح مخالفة: ${record.employeeName}`
          : `رفض تصحيح مخالفة: ${record.employeeName}`,
      titleEn:
        decision === 'Approved'
          ? `Violation Rectification Approved: ${record.employeeName}`
          : `Violation Rectification Rejected: ${record.employeeName}`,
      messageAr:
        decision === 'Approved'
          ? `تم اعتماد طلب تصحيح المخالفة ليوم ${record.date} من قِبل ${reviewedBy}.`
          : `تم رفض طلب تصحيح المخالفة ليوم ${record.date}${reasonNote ? `: ${reasonNote}` : '.'}`,
      messageEn:
        decision === 'Approved'
          ? `Rectification request for ${record.date} was approved by ${reviewedBy}.`
          : `Rectification request for ${record.date} was rejected${reasonNote ? `: ${reasonNote}` : '.'}`,
      targetView: 'attendance',
    });

    onToast(
      decision === 'Approved' ? 'success' : 'info',
      decision === 'Approved'
        ? lang === 'ar'
          ? `تم اعتماد تصحيح مخالفة ${record.employeeName} بنجاح.`
          : `Rectification approved for ${record.employeeName}.`
        : lang === 'ar'
        ? `تم رفض طلب تصحيح ${record.employeeName}.`
        : `Rectification rejected for ${record.employeeName}.`
    );
  };

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Page Header (hidden or condensed when embedded inside AttendanceHub) */}
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-2xl font-bold flex items-center gap-2">
              <ShieldAlert size={22} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'violationsPageTitle')}</span>
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{t(lang, 'violationsPageDesc')}</p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono-tabular">
            <div className="px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border)]">
              <span className="text-[var(--text-muted)]">
                {lang === 'ar' ? 'طلبات بانتظار الاعتماد:' : 'Pending Approval:'}
              </span>{' '}
              <strong className="text-[var(--primary-text)]">{counts.pending}</strong>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--card-bg)] rounded-xl border border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <ShieldAlert size={16} className="text-[var(--primary-text)] shrink-0" />
            <span>{t(lang, 'violationsPageDesc')}</span>
          </div>
          <div className="px-3 py-1 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] text-xs font-mono-tabular">
            <span className="text-[var(--text-muted)]">
              {lang === 'ar' ? 'طلبات بانتظار الاعتماد:' : 'Pending Approval:'}
            </span>{' '}
            <strong className="text-[var(--primary-text)]">{counts.pending}</strong>
          </div>
        </div>
      )}

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {lang === 'ar' ? 'طلبات بانتظار الاعتماد' : 'Pending Requests'}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--status-warn-text)] mt-1">
              {counts.pending}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-warn-bg)] text-[var(--status-warn-text)]">
            <Clock size={20} />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {lang === 'ar' ? 'تصحيحات معتمدة' : 'Approved Rectifications'}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--status-success-text)] mt-1">
              {counts.resolved}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)]">
            <CheckCircle2 size={20} />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {lang === 'ar' ? 'تصحيحات مرفوضة' : 'Rejected Requests'}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--status-danger-text)] mt-1">
              {counts.rejected}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]">
            <XCircle size={20} />
          </div>
        </div>

        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] font-medium">
              {lang === 'ar' ? 'إنذارات بانتظار رد الموظف' : 'Active Employee Warnings'}
            </p>
            <p className="font-display font-mono-tabular text-2xl font-bold text-[var(--primary-text)] mt-1">
              {counts.warningsOnly}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)]">
            <AlertTriangle size={20} />
          </div>
        </div>
      </div>

      {/* Filter Toolbar & Rectification Queue Table */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--card-bg)] border border-[var(--border)] gap-1">
            {[
              {
                id: 'pending' as ViolationsTab,
                label: `${lang === 'ar' ? 'طلبات بانتظار الاعتماد' : 'Pending Approval'} (${counts.pending})`,
              },
              {
                id: 'resolved' as ViolationsTab,
                label: `${lang === 'ar' ? 'المعتمدة' : 'Approved'} (${counts.resolved})`,
              },
              {
                id: 'rejected' as ViolationsTab,
                label: `${lang === 'ar' ? 'المرفوضة' : 'Rejected'} (${counts.rejected})`,
              },
              {
                id: 'all' as ViolationsTab,
                label: `${lang === 'ar' ? 'الكل والإنذارات' : 'All Violations'} (${counts.allTotal})`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[230px]">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                lang === 'ar' ? 'بحث بالموظف أو القسم أو موقع العمل...' : 'Search employee, department, site...'
              }
              className="w-full ps-8 pe-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-start">{t(lang, 'employeeCol')}</th>
                <th className="px-4 py-3 text-start">
                  {lang === 'ar' ? 'التاريخ والمخالفة' : 'Date & Violation'}
                </th>
                <th className="px-4 py-3 text-start">
                  {lang === 'ar' ? 'موقع العمل والبوابات' : 'Work Site & Gates'}
                </th>
                <th className="px-4 py-3 text-start">
                  {lang === 'ar' ? 'طلب التصحيح المقدم' : 'Submitted Rectification Request'}
                </th>
                <th className="px-4 py-3 text-start">{t(lang, 'statusCol')}</th>
                <th className="px-4 py-3 text-end">{t(lang, 'actionsCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredRows.map(({ record, employee, synced }) => {
                const bounds = getShiftScheduleBounds(record.shiftMode, settings.attendanceConfig);
                const isPending = synced.status === 'Pending';

                return (
                  <tr key={record.id} className="hover:bg-[var(--surface-subtle)]/40 align-middle">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5 min-w-[170px]">
                        <AvatarWithFallback name={record.employeeName} sizeClass="w-8 h-8" />
                        <div className="min-w-0">
                          <p className="font-bold text-[var(--text-main)] truncate">{record.employeeName}</p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            {employee?.department || '-'}
                            {employee?.jobTitle ? ` · ${employee.jobTitle}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="font-mono-tabular font-semibold">{formatReadableDate(record.date, lang)}</div>
                      <div className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                        {record.checkInTime} → {record.checkOutTime || '--:--'} ({bounds.start}–{bounds.end})
                      </div>
                      <div className="text-[11px] font-semibold text-[var(--status-danger-text)] mt-0.5">
                        {record.lateMinutes > 0 &&
                          `${t(lang, 'lateArrivalTag')} (${formatAttendanceDuration(record.lateMinutes, lang)})`}
                        {record.lateMinutes > 0 && record.earlyExitMinutes > 0 ? ' · ' : ''}
                        {record.earlyExitMinutes > 0 &&
                          `${t(lang, 'earlyDepartureTag')} (${formatAttendanceDuration(record.earlyExitMinutes, lang)})`}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 max-w-[200px]">
                      <div className="font-semibold truncate">{record.workSite}</div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {record.entryLocation}
                        {record.exitLocation ? ` → ${record.exitLocation}` : ''}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 max-w-[260px]">
                      {synced.linkedExitPermit ? (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1.5 font-semibold text-[var(--primary-text)]">
                            <DoorOpen size={13} />
                            <span>
                              {lang === 'ar' ? 'تصحيح بطلب إذن:' : 'Exit Permit:'}{' '}
                              {synced.linkedExitPermit.reasonType}
                            </span>
                          </div>
                          <div className="font-mono-tabular text-[11px] text-[var(--text-main)]">
                            {synced.linkedExitPermit.exitTime} → {synced.linkedExitPermit.returnTime} (
                            {formatMinutesLabel(synced.linkedExitPermit.durationMinutes, lang)})
                          </div>
                          {synced.linkedExitPermit.notes && (
                            <p className="text-[11px] text-[var(--text-muted)] truncate">
                              {synced.linkedExitPermit.notes}
                            </p>
                          )}
                        </div>
                      ) : synced.linkedLeave ? (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1.5 font-semibold text-[var(--primary-text)]">
                            <Calendar size={13} />
                            <span>
                              {lang === 'ar' ? 'تصحيح بطلب إجازة:' : 'Leave:'}{' '}
                              {translateVacationType(synced.linkedLeave.type, lang)}
                            </span>
                          </div>
                          <div className="font-mono-tabular text-[11px] text-[var(--text-main)]">
                            {synced.linkedLeave.startDate} → {synced.linkedLeave.endDate} ({synced.linkedLeave.days}{' '}
                            {t(lang, 'workDays')})
                          </div>
                          {synced.linkedLeave.notes && (
                            <p className="text-[11px] text-[var(--text-muted)] truncate">
                              {synced.linkedLeave.notes}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">
                          {lang === 'ar'
                            ? 'إنذار مسجل — لم يقدم الموظف طلب تصحيح بعد'
                            : 'Warning issued — awaiting employee submission'}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {synced.status === 'Pending' && (
                        <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-warn-text)]">
                          <Clock size={14} />
                          <span>{t(lang, 'rectificationStatusPending')}</span>
                        </span>
                      )}
                      {synced.status === 'Resolved' && (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-success-text)]">
                            <CheckCircle2 size={14} />
                            <span>{t(lang, 'rectificationStatusResolved')}</span>
                          </span>
                          {record.reviewedBy && (
                            <div className="text-[11px] text-[var(--text-muted)]">{record.reviewedBy}</div>
                          )}
                        </div>
                      )}
                      {synced.status === 'Rejected' && (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-danger-text)]">
                            <XCircle size={14} />
                            <span>{t(lang, 'rectificationStatusRejected')}</span>
                          </span>
                          {record.reviewedBy && (
                            <div className="text-[11px] text-[var(--text-muted)]">{record.reviewedBy}</div>
                          )}
                        </div>
                      )}
                      {synced.status === 'Unresolved' && (
                        <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-danger-text)]">
                          <AlertTriangle size={14} />
                          <span>{t(lang, 'rectificationStatusUnresolved')}</span>
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-end whitespace-nowrap">
                      {canApprove && isPending ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDecision(record, 'Approved')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                          >
                            <Check size={14} />
                            <span>{t(lang, 'approveRectificationBtn')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectModalTarget(record);
                              setRejectReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                          >
                            <X size={14} />
                            <span>{t(lang, 'rejectRectificationBtn')}</span>
                          </button>
                        </div>
                      ) : synced.status === 'Resolved' ? (
                        <span className="inline-flex items-center gap-1 text-[var(--status-success-text)] font-medium">
                          <ShieldCheck size={14} />
                          <span>{lang === 'ar' ? 'مكتمل' : 'Done'}</span>
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    {activeTab === 'pending'
                      ? lang === 'ar'
                        ? 'لا توجد طلبات تصحيح مخالفات بانتظار الاعتماد حالياً.'
                        : 'No violation rectification requests awaiting approval.'
                      : lang === 'ar'
                      ? 'لا توجد سجلات مطابقة للبحث أو الفلتر.'
                      : 'No matching violation records found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Reason Modal */}
      {rejectModalTarget && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base text-[var(--status-danger-text)]">
                  {t(lang, 'rejectRectificationBtn')}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {rejectModalTarget.employeeName} · {rejectModalTarget.date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRejectModalTarget(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={
                  lang === 'ar'
                    ? 'اذكر سبب رفض طلب تصحيح المخالفة...'
                    : 'Provide reason for rejecting the rectification request...'
                }
                className="w-full p-3 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectModalTarget(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm cursor-pointer"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleDecision(rejectModalTarget, 'Rejected', rejectReason.trim());
                    setRejectModalTarget(null);
                    setRejectReason('');
                  }}
                  className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 cursor-pointer"
                >
                  {t(lang, 'confirmBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeViolationsView;
