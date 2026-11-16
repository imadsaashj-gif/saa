import React, { useMemo, useState } from 'react';
import { Download, History, Lock, Search, ShieldCheck } from 'lucide-react';
import { AppUser, AuditLogEntry, Employee, Language, PERMISSIONS_LIST, SystemSettings } from '../types';
import { t } from '../i18n';
import { getTodayStr } from '../utils/leaveCalculations';

interface AuditLogPanelProps {
  auditLogs: AuditLogEntry[];
  lang: Language;
  embedded?: boolean;
  currentUser?: AppUser | null;
  employees?: Employee[];
  settings?: SystemSettings;
}

const CATEGORY_LABELS: Record<Language, Record<string, string>> = {
  ar: {
    all: 'الكل',
    attendance: 'الحضور والإنصراف',
    absence: 'الغيابات',
    vacation: 'الإجازات والبدلاء',
    request: 'الطلبات والأذونات',
    archive: 'الأرشيف',
    employee: 'الموظفين',
    org: 'الهيكل التنظيمي',
    settings: 'الإعدادات',
    user: 'الصلاحيات والمستخدمين',
    system: 'النظام',
  },
  en: {
    all: 'All',
    attendance: 'Attendance',
    absence: 'Absences',
    vacation: 'Leaves & Substitutes',
    request: 'Requests & Exits',
    archive: 'Archive',
    employee: 'Employees',
    org: 'Org Structure',
    settings: 'Settings',
    user: 'Permissions',
    system: 'System',
  },
};

const AuditLogPanel: React.FC<AuditLogPanelProps> = ({
  auditLogs,
  lang,
  embedded = false,
  currentUser,
  employees = [],
  settings,
}) => {
  const [auditSearch, setAuditSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AuditLogEntry['category']>('all');

  const isEmployeeScoped = currentUser?.role === 'Employee';

  // Resolve employee linked to the signed-in employee account
  const linkedEmployee = useMemo(() => {
    if (!currentUser) return undefined;
    if (currentUser.linkedEmployeeId) {
      const byId = employees.find((e) => e.id === currentUser.linkedEmployeeId);
      if (byId) return byId;
    }
    const cleanUserName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
    return employees.find(
      (e) =>
        (e.email && e.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()) ||
        e.fullName.trim().toLowerCase() === cleanUserName
    );
  }, [currentUser, employees]);

  // All permission definitions (built-in + SuperAdmin custom)
  const allPermissionDefs = useMemo(
    () => [...PERMISSIONS_LIST, ...(settings?.customPermissions || [])],
    [settings?.customPermissions]
  );

  // Granted permission labels for Employee scope display
  const activePermissionLabels = useMemo(() => {
    if (!currentUser) return [];
    return currentUser.permissions.map((permId) => {
      const def = allPermissionDefs.find((d) => d.id === permId);
      if (!def) return permId;
      return lang === 'ar' ? def.labelAr : def.labelEn;
    });
  }, [currentUser, allPermissionDefs, lang]);

  // Scoped base logs: Employees see ONLY activities tied to their account/profile or permitted actions
  const roleScopedLogs = useMemo(() => {
    if (!isEmployeeScoped || !currentUser) return auditLogs;
    const cleanActorName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
    const empFullName = linkedEmployee?.fullName.trim().toLowerCase();

    return auditLogs.filter((entry) => {
      const matchesActor =
        entry.actorId === currentUser.id ||
        entry.actor.trim().toLowerCase() === currentUser.name.trim().toLowerCase() ||
        entry.actor.trim().toLowerCase() === cleanActorName;

      const matchesTarget =
        Boolean(linkedEmployee && entry.targetEmployeeId === linkedEmployee.id) ||
        Boolean(empFullName && entry.details.toLowerCase().includes(empFullName));

      return matchesActor || matchesTarget;
    });
  }, [auditLogs, isEmployeeScoped, currentUser, linkedEmployee]);

  // Available category filter buttons restricted for Employees
  const availableCategories = useMemo<Array<'all' | AuditLogEntry['category']>>(() => {
    if (!isEmployeeScoped || !currentUser) {
      return [
        'all',
        'attendance',
        'absence',
        'vacation',
        'request',
        'archive',
        'employee',
        'org',
        'settings',
        'user',
        'system',
      ];
    }
    const scopedCats: Array<'all' | AuditLogEntry['category']> = ['all'];
    if (currentUser.permissions.includes('view_attendance')) scopedCats.push('attendance');
    if (currentUser.permissions.includes('view_absences')) scopedCats.push('absence');
    if (currentUser.permissions.includes('view_my_requests') || currentUser.permissions.includes('view_vacations')) {
      scopedCats.push('vacation', 'request');
    }
    if (currentUser.permissions.includes('view_archive')) scopedCats.push('archive');
    return scopedCats;
  }, [isEmployeeScoped, currentUser]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return roleScopedLogs.filter((entry) => {
      const matchCat = categoryFilter === 'all' || entry.category === categoryFilter;
      const matchQuery =
        !q ||
        entry.actor.toLowerCase().includes(q) ||
        entry.action.toLowerCase().includes(q) ||
        entry.details.toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [roleScopedLogs, auditSearch, categoryFilter]);

  const handleExportAuditJson = () => {
    const blob = new Blob([JSON.stringify(filteredAuditLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 text-[var(--text-main)]">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-2xl font-bold flex items-center gap-2">
              <History size={22} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'auditLogTitle')}</span>
            </h2>
            <p className="text-sm text-[var(--text-muted)]">{t(lang, 'auditLogDesc')}</p>
          </div>
          {!isEmployeeScoped && (
            <button
              type="button"
              onClick={handleExportAuditJson}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download size={15} className="text-[var(--primary-text)]" />
              <span>{lang === 'ar' ? 'تصدير السجل (.json)' : 'Export Log (.json)'}</span>
            </button>
          )}
        </div>
      )}

      {/* Employee Scope & Active Permissions Summary Banner */}
      {isEmployeeScoped && currentUser && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--primary-text)]">
            <Lock size={14} />
            <span>{t(lang, 'auditEmployeeScopeBanner')}</span>
          </div>
          <div className="text-xs text-[var(--text-muted)] flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-main)]">
              <ShieldCheck size={13} className="text-[var(--primary-text)]" />
              {t(lang, 'auditEmployeePermissionsTitle')}:
            </span>
            {activePermissionLabels.length > 0 ? (
              <span>{activePermissionLabels.join(' · ')}</span>
            ) : (
              <span>-</span>
            )}
          </div>
        </div>
      )}

      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
          {embedded ? (
            <div className="flex items-center gap-2">
              <History size={18} className="text-[var(--primary-text)]" />
              <div>
                <h3 className="font-display text-sm font-bold">{t(lang, 'auditLogTitle')}</h3>
                <p className="text-xs text-[var(--text-muted)]">{t(lang, 'auditLogDesc')}</p>
              </div>
            </div>
          ) : (
            <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--card-bg)] border border-[var(--border)] gap-1">
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    categoryFilter === cat
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {CATEGORY_LABELS[lang][cat] || cat}
                </button>
              ))}
            </div>
          )}

          <div className="relative min-w-[220px]">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder={lang === 'ar' ? 'بحث في السجل...' : 'Filter logs...'}
              className="w-full ps-8 pe-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-start">{lang === 'ar' ? 'التاريخ والوقت' : 'Timestamp'}</th>
                <th className="px-4 py-3 text-start">{lang === 'ar' ? 'المستخدم' : 'Actor'}</th>
                <th className="px-4 py-3 text-start">{lang === 'ar' ? 'التصنيف' : 'Category'}</th>
                <th className="px-4 py-3 text-start">{lang === 'ar' ? 'العملية' : 'Action'}</th>
                <th className="px-4 py-3 text-start">{lang === 'ar' ? 'التفاصيل' : 'Details'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredAuditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-[var(--surface-subtle)]/40">
                  <td className="px-4 py-2.5 font-mono-tabular text-[var(--text-muted)] whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString(lang === 'ar' ? 'ar-LY' : 'en-US')}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{log.actor}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">
                    {CATEGORY_LABELS[lang][log.category] || log.category}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-[var(--primary-text)]">{log.action}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{log.details}</td>
                </tr>
              ))}
              {filteredAuditLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                    {isEmployeeScoped
                      ? t(lang, 'auditNoPersonalLogs')
                      : lang === 'ar'
                      ? 'لا توجد نشاطات مطابقة للبحث.'
                      : 'No matching activity records.'}
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

export default AuditLogPanel;
