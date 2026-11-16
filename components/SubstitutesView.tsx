import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { AppUser, Employee, Language, SubstituteExceptionRequest, Vacation } from '../types';
import { t, translateVacationType } from '../i18n';
import { getTodayStr } from '../utils/leaveCalculations';
import { getVividCardClass } from '../utils/cardColors';
import { AvatarWithFallback, StatusLabel } from './UIPrimitives';

interface SubstitutesViewProps {
  employees: Employee[];
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  substituteExceptions?: SubstituteExceptionRequest[];
  onResolveSubstituteException?: (id: string, status: 'Approved' | 'Rejected') => void;
  lang: Language;
  currentUser: AppUser | null;
  onLogAudit: (action: string, details: string, category: 'vacation') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: {
    type: 'substitute';
    titleAr: string;
    titleEn: string;
    messageAr: string;
    messageEn: string;
    targetView: 'requests';
    targetSubTab: 'substitutes';
  }) => void;
}

type CoveragePhase = 'active' | 'scheduled' | 'completed';

const SubstitutesView: React.FC<SubstitutesViewProps> = ({
  employees,
  vacations,
  setVacations,
  substituteExceptions = [],
  onResolveSubstituteException,
  lang,
  currentUser,
  onLogAudit,
  onToast,
  onNotify,
}) => {
  const [viewMode, setViewMode] = useState<'assignments' | 'roster' | 'exceptions'>('assignments');
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'scheduled' | 'completed' | 'conflict'>('all');
  const [reassignTarget, setReassignTarget] = useState<{ vac: Vacation; nextSubstitute: string } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const scrollToTable = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const canManage = currentUser?.permissions.includes('manage_vacations') ?? false;
  const canApproveExceptions =
    currentUser?.role === 'SuperAdmin' ||
    currentUser?.role === 'Admin' ||
    currentUser?.role === 'Manager' ||
    Boolean(currentUser?.permissions.includes('approve_exceptions'));
  const pendingExceptionsCount = substituteExceptions.filter((e) => e.status === 'Pending').length;
  const todayStr = getTodayStr();

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))),
    [employees]
  );

  // Build substitute assignment rows with conflict checks
  const assignmentRows = useMemo(() => {
    const activeOrScheduledLeaves = vacations.filter((v) => v.status !== 'Rejected');

    return activeOrScheduledLeaves
      .map((vac) => {
        const coveredEmp = employees.find((e) => e.id === vac.employeeId);
        const subName = (vac.substitute || '').trim();
        const subEmp = subName
          ? employees.find((e) => e.fullName.trim().toLowerCase() === subName.toLowerCase())
          : undefined;

        let phase: CoveragePhase = 'scheduled';
        if (vac.endDate < todayStr) phase = 'completed';
        else if (vac.startDate <= todayStr && vac.endDate >= todayStr && vac.status === 'Approved') {
          phase = 'active';
        }

        // Conflict 1: Substitute themselves is on approved/pending leave overlapping [vac.startDate, vac.endDate]
        const subOwnLeaveConflict = Boolean(
          subName &&
            activeOrScheduledLeaves.some(
              (other) =>
                other.id !== vac.id &&
                (other.employeeId === subEmp?.id ||
                  other.employeeName.trim().toLowerCase() === subName.toLowerCase()) &&
                other.startDate <= vac.endDate &&
                other.endDate >= vac.startDate
            )
        );

        // Conflict 2: Same substitute covering multiple overlapping leaves simultaneously
        const doubleAssignedConflict = Boolean(
          subName &&
            activeOrScheduledLeaves.some(
              (other) =>
                other.id !== vac.id &&
                other.substitute.trim().toLowerCase() === subName.toLowerCase() &&
                other.startDate <= vac.endDate &&
                other.endDate >= vac.startDate
            )
        );

        const missingSubstitute = !subName;
        const hasConflict = subOwnLeaveConflict || doubleAssignedConflict || missingSubstitute;

        let conflictReason = '';
        if (missingSubstitute) {
          conflictReason = lang === 'ar' ? 'لم يُحدد موظف بديل بعد' : 'No substitute assigned';
        } else if (subOwnLeaveConflict) {
          conflictReason =
            lang === 'ar' ? 'البديل نفسه لديه إجازة متداخلة' : 'Substitute has overlapping leave';
        } else if (doubleAssignedConflict) {
          conflictReason =
            lang === 'ar' ? 'البديل مكلف بأكثر من تغطية متزامنة' : 'Substitute double-booked on dates';
        }

        return {
          vac,
          coveredEmp,
          subEmp,
          subName,
          department: coveredEmp?.department || '-',
          phase,
          hasConflict,
          conflictReason,
        };
      })
      .sort((a, b) => {
        const rank = { active: 0, scheduled: 1, completed: 2 };
        if (rank[a.phase] !== rank[b.phase]) return rank[a.phase] - rank[b.phase];
        return a.vac.startDate.localeCompare(b.vac.startDate);
      });
  }, [vacations, employees, todayStr, lang]);

  const filteredAssignments = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return assignmentRows.filter((row) => {
      const matchSearch =
        !q ||
        row.vac.employeeName.toLowerCase().includes(q) ||
        row.subName.toLowerCase().includes(q) ||
        row.department.toLowerCase().includes(q);
      const matchDept = deptFilter === 'all' || row.department === deptFilter;
      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'conflict'
          ? row.hasConflict
          : row.phase === statusFilter;
      return matchSearch && matchDept && matchStatus;
    });
  }, [assignmentRows, searchTerm, deptFilter, statusFilter]);

  const kpis = useMemo(() => {
    const activeCount = assignmentRows.filter((r) => r.phase === 'active' && Boolean(r.subName)).length;
    const scheduledCount = assignmentRows.filter((r) => r.phase === 'scheduled').length;
    const uniqueSubstitutes = new Set(assignmentRows.map((r) => r.subName).filter(Boolean)).size;
    const conflictCount = assignmentRows.filter((r) => r.hasConflict && r.phase !== 'completed').length;
    return { activeCount, scheduledCount, uniqueSubstitutes, conflictCount };
  }, [assignmentRows]);

  // Backup staff readiness roster
  const rosterRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const activeLeaveTodayIds = new Set(
      vacations
        .filter((v) => v.status === 'Approved' && v.startDate <= todayStr && v.endDate >= todayStr)
        .map((v) => v.employeeId)
    );

    const assignmentsBySub: Record<string, { count: number; days: number; coveringToday: boolean }> = {};
    assignmentRows.forEach((row) => {
      if (!row.subName) return;
      const key = row.subName.toLowerCase();
      if (!assignmentsBySub[key]) {
        assignmentsBySub[key] = { count: 0, days: 0, coveringToday: false };
      }
      assignmentsBySub[key].count += 1;
      assignmentsBySub[key].days += Number(row.vac.days) || 0;
      if (row.phase === 'active') assignmentsBySub[key].coveringToday = true;
    });

    return employees
      .filter((emp) => {
        const s = String(emp.status).toLowerCase();
        if (s.includes('terminated') || s.includes('resigned')) return false;
        const matchDept = deptFilter === 'all' || emp.department === deptFilter;
        const matchSearch =
          !q ||
          emp.fullName.toLowerCase().includes(q) ||
          emp.department.toLowerCase().includes(q) ||
          emp.jobTitle.toLowerCase().includes(q);
        return matchDept && matchSearch;
      })
      .map((emp) => {
        const stats = assignmentsBySub[emp.fullName.trim().toLowerCase()] || {
          count: 0,
          days: 0,
          coveringToday: false,
        };
        const isAway = activeLeaveTodayIds.has(emp.id);
        return {
          emp,
          isAway,
          coveringToday: stats.coveringToday,
          dutiesCount: stats.count,
          coveredDays: stats.days,
        };
      })
      .sort((a, b) => b.dutiesCount - a.dutiesCount);
  }, [employees, vacations, assignmentRows, todayStr, deptFilter, searchTerm]);

  const handleConfirmReassign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignTarget) return;
    const { vac, nextSubstitute } = reassignTarget;
    const cleaned = nextSubstitute.trim();

    setVacations((prev) => prev.map((v) => (v.id === vac.id ? { ...v, substitute: cleaned } : v)));
    onLogAudit(
      lang === 'ar' ? 'تحديث الموظف البديل' : 'Reassigned Substitute',
      `${vac.employeeName} -> ${cleaned || (lang === 'ar' ? 'غير محدد' : 'Unassigned')}`,
      'vacation'
    );
    onToast(
      'success',
      lang === 'ar' ? 'تم تحديث الموظف البديل بنجاح.' : 'Substitute employee reassigned.'
    );
    onNotify?.({
      type: 'substitute',
      titleAr: 'تعديل تكليف الموظف البديل',
      titleEn: 'Substitute Reassignment Updated',
      messageAr: `تم تعيين ${cleaned || 'غير محدد'} بديلاً للموظف ${vac.employeeName} (${vac.startDate} → ${vac.endDate}).`,
      messageEn: `${cleaned || 'Unassigned'} assigned as substitute for ${vac.employeeName} (${vac.startDate} → ${vac.endDate}).`,
      targetView: 'requests',
      targetSubTab: 'substitutes',
    });
    setReassignTarget(null);
  };

  return (
    <div className="space-y-5 text-[var(--text-main)]">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-[var(--text-main)]">
            {t(lang, 'substitutesTitle')}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">{t(lang, 'substitutesDesc')}</p>
        </div>

        <div className="inline-flex p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
          <button
            type="button"
            onClick={() => setViewMode('assignments')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'assignments'
                ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            {t(lang, 'substitutesAssignmentsTitle')}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('roster')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'roster'
                ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            {t(lang, 'substitutesRosterTitle')}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('exceptions')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'exceptions'
                ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <span>{t(lang, 'exceptionsQueueTitle')}</span>
            {pendingExceptionsCount > 0 && (
              <span className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded bg-[var(--status-warn-bg)] text-[var(--status-warn-text)]">
                {pendingExceptionsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 4 KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setViewMode('assignments');
            setStatusFilter((prev) => (prev === 'active' ? 'all' : 'active'));
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setViewMode('assignments');
              setStatusFilter((prev) => (prev === 'active' ? 'all' : 'active'));
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(1, { isActive: viewMode === 'assignments' && statusFilter === 'active' })} p-4 rounded-xl flex items-center justify-between`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'activeCoveragesLabel')}</p>
            <p className="font-display text-2xl font-bold tabular-nums mt-1">{kpis.activeCount}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)]">
            <UserCheck size={20} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setViewMode('assignments');
            setStatusFilter((prev) => (prev === 'scheduled' ? 'all' : 'scheduled'));
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setViewMode('assignments');
              setStatusFilter((prev) => (prev === 'scheduled' ? 'all' : 'scheduled'));
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(0, { isActive: viewMode === 'assignments' && statusFilter === 'scheduled' })} p-4 rounded-xl flex items-center justify-between`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'scheduledCoveragesLabel')}</p>
            <p className="font-display text-2xl font-bold tabular-nums mt-1">{kpis.scheduledCount}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)]">
            <CalendarClock size={20} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setViewMode('roster');
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setViewMode('roster');
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(4, { isActive: viewMode === 'roster' })} p-4 rounded-xl flex items-center justify-between`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'assignedSubstitutesLabel')}</p>
            <p className="font-display text-2xl font-bold tabular-nums mt-1">{kpis.uniqueSubstitutes}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)] text-[var(--primary-text)]">
            <Users size={20} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setViewMode('assignments');
            setStatusFilter((prev) => (prev === 'conflict' ? 'all' : 'conflict'));
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setViewMode('assignments');
              setStatusFilter((prev) => (prev === 'conflict' ? 'all' : 'conflict'));
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(3, { isActive: viewMode === 'assignments' && statusFilter === 'conflict' })} p-4 rounded-xl flex items-center justify-between`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'coverageConflictsLabel')}</p>
            <p
              className={`font-display text-2xl font-bold tabular-nums mt-1 ${
                kpis.conflictCount > 0 ? 'text-[var(--status-danger-text)]' : 'text-[var(--status-success-text)]'
              }`}
            >
              {kpis.conflictCount}
            </p>
          </div>
          <div
            className={`p-2.5 rounded-lg ${
              kpis.conflictCount > 0
                ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]'
                : 'bg-[var(--status-success-bg)] text-[var(--status-success-text)]'
            }`}
          >
            <AlertTriangle size={20} />
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            size={15}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              lang === 'ar'
                ? 'بحث باسم الموظف المجاز أو البديل أو الإدارة...'
                : 'Search employee, substitute, or department...'
            }
            className="w-full ps-9 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
          />
        </div>

        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
        >
          <option value="all">{t(lang, 'allDepartments')}</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {viewMode === 'assignments' && (
          <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] gap-1">
            {([
              { id: 'all', label: lang === 'ar' ? 'الكل' : 'All' },
              { id: 'active', label: t(lang, 'coverageStatusActive') },
              { id: 'scheduled', label: t(lang, 'coverageStatusScheduled') },
              { id: 'conflict', label: t(lang, 'coverageStatusConflict') },
              { id: 'completed', label: t(lang, 'coverageStatusCompleted') },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === item.id
                    ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mode 1: Substitute Assignments Table */}
      <div ref={tableRef}>
      {viewMode === 'assignments' ? (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'substituteLabel')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'vacationType')}</th>
                  <th className="px-4 py-3 text-start font-semibold">
                    {t(lang, 'startDate')} → {t(lang, 'endDate')}
                  </th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">
                    {lang === 'ar' ? 'حالة التغطية' : 'Coverage State'}
                  </th>
                  {canManage && <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredAssignments.map(({ vac, subEmp, subName, department, phase, hasConflict, conflictReason }) => (
                  <tr key={vac.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <AvatarWithFallback name={vac.employeeName} sizeClass="w-8 h-8" />
                        <div>
                          <div className="font-semibold text-[var(--text-main)]">{vac.employeeName}</div>
                          <div className="text-xs text-[var(--text-muted)]">{department}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {subName ? (
                        <div className="flex items-center gap-2.5">
                          <AvatarWithFallback name={subName} sizeClass="w-7 h-7" />
                          <div>
                            <div className="text-xs font-semibold text-[var(--text-main)]">{subName}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">
                              {subEmp?.jobTitle || (lang === 'ar' ? 'بديل مكلف' : 'Assigned Backup')}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-[var(--status-danger-text)]">
                          {lang === 'ar' ? 'بدون بديل' : 'Unassigned'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span className="font-medium">{translateVacationType(vac.type, lang)}</span>
                      <span className="block font-mono-tabular text-[11px] text-[var(--text-muted)]">
                        {vac.days} {t(lang, 'workDays')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono-tabular text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {vac.startDate} → {vac.endDate}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusLabel status={vac.status} lang={lang} />
                    </td>
                    <td className="px-4 py-3.5">
                      {hasConflict && phase !== 'completed' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--status-danger-text)]">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span>{conflictReason}</span>
                        </span>
                      ) : phase === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--status-success-text)]">
                          <CheckCircle2 size={14} className="shrink-0" />
                          <span>{t(lang, 'coverageStatusActive')}</span>
                        </span>
                      ) : phase === 'scheduled' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--primary-text)]">
                          <Clock size={14} className="shrink-0" />
                          <span>{t(lang, 'coverageStatusScheduled')}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">{t(lang, 'coverageStatusCompleted')}</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3.5 text-end">
                        <button
                          type="button"
                          onClick={() => setReassignTarget({ vac, nextSubstitute: vac.substitute || '' })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-medium text-[var(--text-main)] hover:border-[var(--primary)] hover:text-[var(--primary-text)] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <ArrowLeftRight size={13} />
                          <span>{t(lang, 'reassignSubstituteBtn')}</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filteredAssignments.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 7 : 6} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                      {t(lang, 'noSubstitutesAssigned')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === 'roster' ? (
        /* Mode 2: Backup Staff Readiness Roster */
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'departmentCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'jobTitleCol')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'dutiesCountCol')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'coveredDaysCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'availabilityCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rosterRows.map(({ emp, isAway, coveringToday, dutiesCount, coveredDays }) => (
                  <tr key={emp.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <AvatarWithFallback name={emp.fullName} sizeClass="w-8 h-8" />
                        <div>
                          <div className="font-semibold text-[var(--text-main)]">{emp.fullName}</div>
                          <div className="text-xs font-mono-tabular text-[var(--text-muted)]">{emp.adminId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{emp.department || '-'}</td>
                    <td className="px-4 py-3 text-xs text-[var(--text-main)]">{emp.jobTitle || '-'}</td>
                    <td className="px-4 py-3 text-end font-mono-tabular font-semibold">{dutiesCount}</td>
                    <td className="px-4 py-3 text-end font-mono-tabular text-[var(--primary-text)] font-semibold">
                      {coveredDays}
                    </td>
                    <td className="px-4 py-3">
                      {isAway ? (
                        <StatusLabel status="On Leave" lang={lang} />
                      ) : coveringToday ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--primary-text)]">
                          <RefreshCw size={13} />
                          <span>{lang === 'ar' ? 'مكلف بالإنابة اليوم' : 'Covering Leave Today'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--status-success-text)]">
                          <CheckCircle2 size={14} />
                          <span>{lang === 'ar' ? 'متاح للتكليف' : 'Available for Backup'}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {rosterRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                      {t(lang, 'noEmployeesFound')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Mode 3: Substitute Leave Exception Requests */
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold">{t(lang, 'exceptionsQueueTitle')}</h4>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'exceptionsQueueDesc')}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">
                    {lang === 'ar' ? 'مكلّف كبديل عن' : 'Covering For'}
                  </th>
                  <th className="px-4 py-3 text-start font-semibold">
                    {lang === 'ar' ? 'الإجازة المطلوبة' : 'Requested Leave'}
                  </th>
                  <th className="px-4 py-3 text-start font-semibold">
                    {lang === 'ar' ? 'مبرر الاستثناء' : 'Exception Reason'}
                  </th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {substituteExceptions
                  .filter((ex) => {
                    const q = searchTerm.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      ex.employeeName.toLowerCase().includes(q) ||
                      ex.coveringForEmployeeName.toLowerCase().includes(q) ||
                      ex.reason.toLowerCase().includes(q)
                    );
                  })
                  .map((ex) => (
                    <tr key={ex.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <AvatarWithFallback name={ex.employeeName} sizeClass="w-8 h-8" />
                          <div>
                            <div className="font-semibold text-[var(--text-main)]">{ex.employeeName}</div>
                            <div className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
                              {ex.createdAt.slice(0, 10)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-medium">{ex.coveringForEmployeeName}</div>
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
                      <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] max-w-xs">
                        {ex.reason || '-'}
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
                              ? `معتمد من: ${ex.approvedBy || '-'} (جاهز لإدخال الإجازة)`
                              : `Approved by ${ex.approvedBy || '-'} (Unlocked)`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-end">
                        {ex.status === 'Pending' && canApproveExceptions ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onResolveSubstituteException?.(ex.id, 'Approved')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                            >
                              <ShieldCheck size={14} />
                              <span>{t(lang, 'approveExceptionBtn')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onResolveSubstituteException?.(ex.id, 'Rejected')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                            >
                              <XCircle size={14} />
                              <span>{t(lang, 'reject')}</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                {substituteExceptions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                      {lang === 'ar' ? 'لا توجد طلبات استثناء مسجلة.' : 'No substitute exception requests found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* Reassign Substitute Modal */}
      {reassignTarget && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-sm">{t(lang, 'reassignSubstituteBtn')}</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {reassignTarget.vac.employeeName} ·{' '}
                  <span className="font-mono-tabular">
                    {reassignTarget.vac.startDate} → {reassignTarget.vac.endDate}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReassignTarget(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmReassign} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'selectSubstitute')}
                </label>
                <select
                  value={reassignTarget.nextSubstitute}
                  onChange={(e) => setReassignTarget({ ...reassignTarget, nextSubstitute: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                >
                  <option value="">{lang === 'ar' ? '-- بدون بديل --' : '-- No Substitute --'}</option>
                  {employees
                    .filter((emp) => emp.id !== reassignTarget.vac.employeeId)
                    .map((emp) => (
                      <option key={emp.id} value={emp.fullName}>
                        {emp.fullName} ({emp.department || '-'})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setReassignTarget(null)}
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
    </div>
  );
};

export default SubstitutesView;
