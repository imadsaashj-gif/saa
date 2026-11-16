import React, { useMemo, useState } from 'react';
import { Clock, ShieldAlert, UserX } from 'lucide-react';
import {
  AbsenceRecord,
  AppUser,
  AttendanceRecord,
  DepartmentUnit,
  Employee,
  ExitPermission,
  Language,
  SubstituteExceptionRequest,
  SystemSettings,
  Vacation,
} from '../types';
import { t } from '../i18n';
import { NotificationEmitPayload } from './RequestsHub';
import {
  computeAttendanceMetrics,
  detectMissingAttendanceCandidates,
  resolveSyncedRectification,
} from '../utils/attendanceCalculations';
import AttendanceView from './AttendanceView';
import EmployeeViolationsView from './EmployeeViolationsView';
import AbsencesView from './AbsencesView';

export type AttendanceHubSubTab = 'sheet' | 'violations' | 'absences';

interface AttendanceHubProps {
  attendanceRecords: AttendanceRecord[];
  setAttendanceRecords: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  absenceRecords: AbsenceRecord[];
  setAbsenceRecords: React.Dispatch<React.SetStateAction<AbsenceRecord[]>>;
  employees: Employee[];
  orgUnits: DepartmentUnit[];
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  exitPermissions: ExitPermission[];
  setExitPermissions: React.Dispatch<React.SetStateAction<ExitPermission[]>>;
  substituteExceptions?: SubstituteExceptionRequest[];
  onSubmitSubstituteException?: (req: SubstituteExceptionRequest) => void;
  onMarkExceptionConsumed?: (exceptionId: string, vacationId: string) => void;
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  activeSubTab?: AttendanceHubSubTab;
  onChangeSubTab?: (tab: AttendanceHubSubTab) => void;
  onLogAudit: (
    action: string,
    details: string,
    category: 'attendance' | 'absence' | 'vacation' | 'request',
    targetEmployeeId?: string
  ) => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onNotify?: (payload: NotificationEmitPayload) => void;
}

const AttendanceHub: React.FC<AttendanceHubProps> = ({
  attendanceRecords,
  setAttendanceRecords,
  absenceRecords,
  setAbsenceRecords,
  employees,
  orgUnits,
  vacations,
  setVacations,
  exitPermissions,
  setExitPermissions,
  substituteExceptions = [],
  onSubmitSubstituteException,
  onMarkExceptionConsumed,
  settings,
  lang,
  currentUser,
  activeSubTab: controlledTab,
  onChangeSubTab,
  onLogAudit,
  onToast,
  onNotify,
}) => {
  const [internalTab, setInternalTab] = useState<AttendanceHubSubTab>('sheet');
  const perms = currentUser?.permissions || [];

  const availableTabs = useMemo(() => {
    const list: Array<{
      id: AttendanceHubSubTab;
      label: string;
      icon: typeof Clock;
      badge: number;
    }> = [];

    const pendingViolationsCount = attendanceRecords.filter((r) => {
      if (r.violationType === 'None') return false;
      return resolveSyncedRectification(r, exitPermissions, vacations).status === 'Pending';
    }).length;

    const openAbsencesCount = absenceRecords.filter((a) => a.status === 'Open').length;
    const autoDetectedCount = detectMissingAttendanceCandidates(
      employees,
      attendanceRecords,
      vacations,
      absenceRecords,
      settings,
      10
    ).length;

    if (
      perms.includes('view_attendance_sheet') ||
      perms.includes('manage_attendance') ||
      perms.includes('view_attendance')
    ) {
      list.push({
        id: 'sheet',
        label: t(lang, 'attendanceSubSheet'),
        icon: Clock,
        badge: computeAttendanceMetrics(attendanceRecords, exitPermissions, vacations, settings.attendanceConfig)
          .openShifts,
      });
    }

    if (perms.includes('view_violations') || perms.includes('manage_violations')) {
      list.push({
        id: 'violations',
        label: t(lang, 'attendanceSubViolations'),
        icon: ShieldAlert,
        badge: pendingViolationsCount,
      });
    }

    if (perms.includes('view_absences') || perms.includes('manage_absences')) {
      list.push({
        id: 'absences',
        label: t(lang, 'attendanceSubAbsences'),
        icon: UserX,
        badge: openAbsencesCount + autoDetectedCount,
      });
    }

    return list;
  }, [perms, lang, attendanceRecords, exitPermissions, vacations, absenceRecords, employees, settings]);

  const requestedTab = controlledTab ?? internalTab;
  const activeTab: AttendanceHubSubTab = availableTabs.some((tb) => tb.id === requestedTab)
    ? requestedTab
    : availableTabs[0]?.id || 'sheet';

  const setSubTab = (next: AttendanceHubSubTab) => {
    if (onChangeSubTab) {
      onChangeSubTab(next);
    } else {
      setInternalTab(next);
    }
  };

  return (
    <div className="space-y-5 text-[var(--text-main)]">
      {/* Main Attendance & Compliance Hub Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">
            {t(lang, 'attendanceHubTitle')}
          </h2>
          <p className="text-sm text-[var(--text-muted)]">{t(lang, 'attendanceHubDesc')}</p>
        </div>

        <div className="inline-flex flex-wrap p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
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
                {tab.badge > 0 && (
                  <span className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded bg-[var(--primary-soft)] text-[var(--primary-text)]">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. كشف الحضور والانصراف */}
      {activeTab === 'sheet' && (
        <AttendanceView
          embedded
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
          onLogAudit={(action, details, cat, targetEmpId) => onLogAudit(action, details, cat, targetEmpId)}
          onToast={onToast}
          onNotify={onNotify}
          onNavigateToViolations={
            availableTabs.some((tb) => tb.id === 'violations') ? () => setSubTab('violations') : undefined
          }
        />
      )}

      {/* 2. مخالفات الحضور والانصراف */}
      {activeTab === 'violations' && (
        <EmployeeViolationsView
          embedded
          attendanceRecords={attendanceRecords}
          setAttendanceRecords={setAttendanceRecords}
          employees={employees}
          exitPermissions={exitPermissions}
          setExitPermissions={setExitPermissions}
          vacations={vacations}
          setVacations={setVacations}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details, cat, targetEmpId) => onLogAudit(action, details, cat, targetEmpId)}
          onToast={onToast}
          onNotify={onNotify}
        />
      )}

      {/* 3. الغيابات */}
      {activeTab === 'absences' && (
        <AbsencesView
          embedded
          absenceRecords={absenceRecords}
          setAbsenceRecords={setAbsenceRecords}
          employees={employees}
          attendanceRecords={attendanceRecords}
          vacations={vacations}
          setVacations={setVacations}
          settings={settings}
          lang={lang}
          currentUser={currentUser}
          onLogAudit={(action, details, cat, targetEmpId) => onLogAudit(action, details, cat, targetEmpId)}
          onToast={onToast}
          onNotify={onNotify}
        />
      )}
    </div>
  );
};

export default AttendanceHub;
