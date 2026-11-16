import React, { useState } from 'react';
import { Building2, Users } from 'lucide-react';
import {
  AppUser,
  DepartmentUnit,
  Employee,
  Language,
  SystemSettings,
  Vacation,
} from '../types';
import { t } from '../i18n';
import OrgStructureView from './OrgStructureView';
import EmployeeManager from './EmployeeManager';

export type OrgSubTab = 'departments' | 'employees';

interface OrgHubProps {
  activeSubTab?: OrgSubTab;
  onChangeSubTab?: (tab: OrgSubTab) => void;
  orgUnits: DepartmentUnit[];
  setOrgUnits: React.Dispatch<React.SetStateAction<DepartmentUnit[]>>;
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  addVacationsFromImport: (vacationData: any[]) => void;
  vacations: Vacation[];
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  onLogAudit: (action: string, details: string, category: 'org' | 'employee') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onLoadDemoData: () => void;
  onOpenNewLeaveForEmployee: (employeeId: string) => void;
}

const OrgHub: React.FC<OrgHubProps> = ({
  activeSubTab,
  onChangeSubTab,
  orgUnits,
  setOrgUnits,
  employees,
  setEmployees,
  addVacationsFromImport,
  vacations,
  settings,
  lang,
  currentUser,
  onLogAudit,
  onToast,
  onLoadDemoData,
  onOpenNewLeaveForEmployee,
}) => {
  const canViewOrg = currentUser?.permissions.includes('view_org') ?? false;
  const canViewEmployees = currentUser?.permissions.includes('view_employees') ?? false;

  const defaultTab: OrgSubTab = canViewOrg ? 'departments' : 'employees';
  const [internalTab, setInternalTab] = useState<OrgSubTab>(defaultTab);
  const currentTab: OrgSubTab = activeSubTab || internalTab;
  const [preFilteredDept, setPreFilteredDept] = useState<string | null>(null);

  const setTab = (next: OrgSubTab) => {
    setInternalTab(next);
    onChangeSubTab?.(next);
  };

  const tabs: Array<{ id: OrgSubTab; label: string; icon: React.FC<{ size?: number }>; badge: number; allowed: boolean }> = [
    {
      id: 'departments',
      label: t(lang, 'orgSubDepts'),
      icon: Building2,
      badge: orgUnits.length,
      allowed: canViewOrg,
    },
    {
      id: 'employees',
      label: t(lang, 'orgSubEmployees'),
      icon: Users,
      badge: employees.length,
      allowed: canViewEmployees,
    },
  ];

  const allowedTabs = tabs.filter((tb) => tb.allowed);

  return (
    <div className="space-y-5 text-[var(--text-main)]">
      {/* Main Org Hub Header + 2 Ordered Sub-Pages */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">
            {t(lang, 'navOrgStructure')}
          </h2>
          <p className="text-sm text-[var(--text-muted)]">{t(lang, 'orgHubDesc')}</p>
        </div>

        <div className="inline-flex flex-wrap p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
          {allowedTabs.map((tab) => {
            const Icon = tab.icon;
            const active = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                <span className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded bg-[var(--primary-soft)] text-[var(--primary-text)]">
                  {tab.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-page 1: الإدارات والأقسام */}
      {currentTab === 'departments' && canViewOrg && (
        <OrgStructureView
          embedded
          orgUnits={orgUnits}
          setOrgUnits={setOrgUnits}
          employees={employees}
          vacations={vacations}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details) => onLogAudit(action, details, 'org')}
          onToast={onToast}
          onOpenDeptEmployees={(deptName) => {
            setPreFilteredDept(deptName);
            setTab('employees');
          }}
        />
      )}

      {/* Sub-page 2: سجل الموظفين */}
      {currentTab === 'employees' && canViewEmployees && (
        <EmployeeManager
          embedded
          initialDeptFilter={preFilteredDept}
          onClearInitialDeptFilter={() => setPreFilteredDept(null)}
          employees={employees}
          setEmployees={setEmployees}
          addVacationsFromImport={addVacationsFromImport}
          vacations={vacations}
          orgUnits={orgUnits}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details) => onLogAudit(action, details, 'employee')}
          onToast={onToast}
          onLoadDemoData={onLoadDemoData}
          onOpenNewLeaveForEmployee={onOpenNewLeaveForEmployee}
        />
      )}
    </div>
  );
};

export default OrgHub;
