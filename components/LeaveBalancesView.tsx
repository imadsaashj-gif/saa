import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Search, AlertTriangle, CheckCircle2, Clock, Users } from 'lucide-react';
import { Employee, Language, SystemSettings, Vacation } from '../types';
import { t } from '../i18n';
import { getEmployeeLeaveSummary, getTodayStr } from '../utils/leaveCalculations';
import { getVividCardClass } from '../utils/cardColors';
import { AvatarWithFallback } from './UIPrimitives';

interface LeaveBalancesViewProps {
  employees: Employee[];
  vacations: Vacation[];
  settings: SystemSettings;
  lang: Language;
  embedded?: boolean;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
}

const LeaveBalancesView: React.FC<LeaveBalancesViewProps> = ({
  employees,
  vacations,
  settings,
  lang,
  embedded = false,
  onToast,
}) => {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'normal' | 'near' | 'exceeded'>('all');
  const tableRef = useRef<HTMLDivElement>(null);

  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
    vacations.forEach((v) => {
      const y = Number(v.startDate?.slice(0, 4));
      if (y > 2000) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [vacations, currentYear]);

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))),
    [employees]
  );

  const baseSummaries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return employees
      .filter((emp) => {
        const matchesSearch =
          !q ||
          emp.fullName.toLowerCase().includes(q) ||
          emp.adminId.toLowerCase().includes(q) ||
          emp.department.toLowerCase().includes(q);
        const matchesDept = deptFilter === 'all' || emp.department === deptFilter;
        return matchesSearch && matchesDept;
      })
      .map((emp) => getEmployeeLeaveSummary(emp, vacations, settings, selectedYear))
      .sort((a, b) => b.utilizationPercent - a.utilizationPercent);
  }, [employees, vacations, settings, selectedYear, searchTerm, deptFilter]);

  const balanceCounts = useMemo(() => {
    return {
      all: baseSummaries.length,
      normal: baseSummaries.filter((s) => s.status === 'normal').length,
      near: baseSummaries.filter((s) => s.status === 'near').length,
      exceeded: baseSummaries.filter((s) => s.status === 'exceeded').length,
    };
  }, [baseSummaries]);

  const summaries = useMemo(
    () =>
      balanceFilter === 'all'
        ? baseSummaries
        : baseSummaries.filter((s) => s.status === balanceFilter),
    [baseSummaries, balanceFilter]
  );

  const scrollToTable = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const handleExportLedger = () => {
    const rows = summaries.map((s) => ({
      [t(lang, 'adminIdCol')]: s.employee.adminId,
      [t(lang, 'fullName')]: s.employee.fullName,
      [t(lang, 'departmentCol')]: s.employee.department,
      [t(lang, 'contractCol')]: s.employee.contractType,
      [t(lang, 'annualQuota')]: s.annualLimit,
      [t(lang, 'usedDays')]: s.approvedDays,
      [t(lang, 'pendingDaysCol')]: s.pendingDays,
      [t(lang, 'remainingDays')]: s.remainingDays,
      [t(lang, 'utilizationCol')]: `${s.utilizationPercent}%`,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Balances_${selectedYear}`);
    XLSX.writeFile(wb, `leave_balances_${selectedYear}_${getTodayStr()}.xlsx`);
    onToast('success', lang === 'ar' ? 'تم تصدير جدول أرصدة الإجازات.' : 'Leave balances exported.');
  };

  return (
    <div className="space-y-4 text-[var(--text-main)]">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--text-main)]">{t(lang, 'balancesTitle')}</h3>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'balancesDesc')}</p>
          </div>
          <button
            type="button"
            onClick={handleExportLedger}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download size={15} />
            <span>{t(lang, 'exportExcel')}</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">{t(lang, 'balancesTitle')}</h2>
            <p className="text-sm text-[var(--text-muted)]">{t(lang, 'balancesDesc')}</p>
          </div>

          <button
            type="button"
            onClick={handleExportLedger}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download size={15} />
            <span>{t(lang, 'exportExcel')}</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setBalanceFilter('all');
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setBalanceFilter('all');
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(0, { isActive: balanceFilter === 'all' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{lang === 'ar' ? 'إجمالي الموظفين' : 'Total Staff'}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5">{balanceCounts.all}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] shrink-0">
            <Users size={19} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setBalanceFilter((prev) => (prev === 'normal' ? 'all' : 'normal'));
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setBalanceFilter((prev) => (prev === 'normal' ? 'all' : 'normal'));
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(1, { isActive: balanceFilter === 'normal' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'balanceStatusNominal')}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5 text-[var(--status-success-text)]">
              {balanceCounts.normal}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] shrink-0">
            <CheckCircle2 size={19} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setBalanceFilter((prev) => (prev === 'near' ? 'all' : 'near'));
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setBalanceFilter((prev) => (prev === 'near' ? 'all' : 'near'));
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(2, { isActive: balanceFilter === 'near' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'balanceStatusNear')}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5 text-[var(--status-warn-text)]">
              {balanceCounts.near}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] shrink-0">
            <Clock size={19} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setBalanceFilter((prev) => (prev === 'exceeded' ? 'all' : 'exceeded'));
            scrollToTable();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setBalanceFilter((prev) => (prev === 'exceeded' ? 'all' : 'exceeded'));
              scrollToTable();
            }
          }}
          className={`${getVividCardClass(3, { isActive: balanceFilter === 'exceeded' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'balanceStatusExceeded')}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5 text-[var(--status-danger-text)]">
              {balanceCounts.exceeded}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] shrink-0">
            <AlertTriangle size={19} />
          </div>
        </div>
      </div>

      <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            size={15}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
          <input
            type="text"
            placeholder={t(lang, 'searchEmployeesPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
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

        <div className="inline-flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{t(lang, 'yearLabel')}:</span>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular font-semibold text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
          >
            {availableYears.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div ref={tableRef} className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'contractCol')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t(lang, 'annualQuota')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t(lang, 'usedDays')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t(lang, 'pendingDaysCol')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t(lang, 'remainingDays')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'utilizationCol')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {summaries.map((item) => (
                <tr key={item.employee.id} className="hover:bg-[var(--surface-subtle)]/50 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <AvatarWithFallback name={item.employee.fullName} sizeClass="w-8 h-8" />
                      <div>
                        <div className="font-semibold text-[var(--text-main)]">{item.employee.fullName}</div>
                        <div className="text-xs text-[var(--text-muted)]">
                          <span className="font-mono-tabular">{item.employee.adminId}</span> ·{' '}
                          {item.employee.department || '-'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-[var(--text-main)]">{item.employee.contractType}</td>
                  <td className="px-4 py-3.5 text-end font-mono-tabular font-semibold">{item.annualLimit}</td>
                  <td className="px-4 py-3.5 text-end font-mono-tabular">{item.approvedDays}</td>
                  <td className="px-4 py-3.5 text-end font-mono-tabular text-[var(--status-warn-text)]">
                    {item.pendingDays}
                  </td>
                  <td className="px-4 py-3.5 text-end font-mono-tabular font-bold text-[var(--primary-text)]">
                    {item.remainingDays}
                  </td>
                  <td className="px-4 py-3.5 min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-[var(--surface-subtle)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            item.status === 'exceeded'
                              ? 'bg-red-500'
                              : item.status === 'near'
                              ? 'bg-amber-500'
                              : 'bg-[var(--primary)]'
                          }`}
                          style={{ width: `${item.utilizationPercent}%` }}
                        />
                      </div>
                      <span className="font-mono-tabular text-xs text-[var(--text-muted)] w-9 text-end">
                        {item.utilizationPercent}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {item.status === 'exceeded' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-danger-text)]">
                        <AlertTriangle size={14} /> {t(lang, 'balanceStatusExceeded')}
                      </span>
                    ) : item.status === 'near' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-warn-text)]">
                        <Clock size={14} /> {t(lang, 'balanceStatusNear')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--status-success-text)]">
                        <CheckCircle2 size={14} /> {t(lang, 'balanceStatusNominal')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {summaries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">
                    {t(lang, 'noEmployeesFound')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LeaveBalancesView;
