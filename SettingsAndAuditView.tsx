import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  CheckSquare,
  Database,
  Download,
  Edit,
  Image as ImageIcon,
  Mail,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Square,
  Sun,
  Trash2,
  Upload,
  CalendarDays,
} from 'lucide-react';
import {
  AbsenceRecord,
  AppUser,
  ArchiveRecord,
  AttendanceRecord,
  AuditLogEntry,
  BrandingSettings,
  DepartmentUnit,
  Employee,
  EmployeeRequest,
  ExitPermission,
  Language,
  NotificationSettings,
  OfficialHoliday,
  SubstituteExceptionRequest,
  SystemSettings,
  ThemeOption,
  Vacation,
  generateId,
} from '../types';
import { WEEKDAY_LABELS, t, translateVacationType } from '../i18n';
import { getTodayStr } from '../utils/leaveCalculations';
import { getEffectiveWorkSiteLocations } from '../utils/attendanceCalculations';
import { DEFAULT_ATTENDANCE_SETTINGS, DEFAULT_BRANDING, DEFAULT_NOTIFICATION_SETTINGS } from '../data/seedData';
import { emblemImg, loginShowcaseImg } from '../assets';
import { ConfirmDialog } from './UIPrimitives';
import UserManager from './UserManager';
import AttendanceAdminTab from './AttendanceAdminTab';
import AuditLogPanel from './AuditLogPanel';

interface SettingsAndAuditViewProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  vacations: Vacation[];
  setVacations: React.Dispatch<React.SetStateAction<Vacation[]>>;
  orgUnits: DepartmentUnit[];
  setOrgUnits: React.Dispatch<React.SetStateAction<DepartmentUnit[]>>;
  exitPermissions: ExitPermission[];
  setExitPermissions: React.Dispatch<React.SetStateAction<ExitPermission[]>>;
  employeeRequests: EmployeeRequest[];
  setEmployeeRequests: React.Dispatch<React.SetStateAction<EmployeeRequest[]>>;
  substituteExceptions?: SubstituteExceptionRequest[];
  setSubstituteExceptions?: React.Dispatch<React.SetStateAction<SubstituteExceptionRequest[]>>;
  attendanceRecords?: AttendanceRecord[];
  setAttendanceRecords?: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  absenceRecords?: AbsenceRecord[];
  setAbsenceRecords?: React.Dispatch<React.SetStateAction<AbsenceRecord[]>>;
  archiveRecords?: ArchiveRecord[];
  setArchiveRecords?: React.Dispatch<React.SetStateAction<ArchiveRecord[]>>;
  users: AppUser[];
  setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
  currentUser: AppUser | null;
  auditLogs: AuditLogEntry[];
  lang: Language;
  onChangeLanguage: (lang: Language) => void;
  onChangeTheme: (theme: ThemeOption) => void;
  onLogAudit: (action: string, details: string, category: 'settings' | 'system' | 'user') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onRestoreDemoData: () => void;
  onClearAllData: () => void;
  activeTab?: SettingsTab;
  onChangeTab?: (tab: SettingsTab) => void;
  initialTab?: SettingsTab | null;
  onClearInitialTab?: () => void;
  onSendTestNotification?: (channels: NotificationSettings) => void;
}

export type SettingsTab = 'branding' | 'users' | 'attendance_admin' | 'config' | 'holidays' | 'notifications' | 'backup' | 'audit';

function compressImageToDataUrl(file: File, maxWidth: number, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const isPng = file.type === 'image/png';
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

const SettingsAndAuditView: React.FC<SettingsAndAuditViewProps> = ({
  settings,
  setSettings,
  employees,
  setEmployees,
  vacations,
  setVacations,
  orgUnits,
  setOrgUnits,
  exitPermissions,
  setExitPermissions,
  employeeRequests,
  setEmployeeRequests,
  substituteExceptions = [],
  setSubstituteExceptions,
  attendanceRecords = [],
  setAttendanceRecords,
  absenceRecords = [],
  setAbsenceRecords,
  archiveRecords = [],
  setArchiveRecords,
  users,
  setUsers,
  currentUser,
  auditLogs,
  lang,
  onChangeLanguage,
  onChangeTheme,
  onLogAudit,
  onToast,
  onRestoreDemoData,
  onClearAllData,
  activeTab: controlledTab,
  onChangeTab,
  initialTab,
  onClearInitialTab,
  onSendTestNotification,
}) => {
  const canManageSettings = currentUser?.permissions.includes('manage_settings') ?? false;
  const canManageUsers = currentUser?.permissions.includes('manage_users') ?? false;
  const canManageAttendanceAdmin =
    canManageSettings || (currentUser?.permissions.includes('manage_attendance') ?? false);

  const [internalTab, setInternalTab] = useState<SettingsTab>(
    canManageSettings ? 'branding' : canManageAttendanceAdmin ? 'attendance_admin' : 'users'
  );

  useEffect(() => {
    if (initialTab) {
      if (onChangeTab) {
        onChangeTab(initialTab);
      } else {
        setInternalTab(initialTab);
      }
      onClearInitialTab?.();
    }
  }, [initialTab, onClearInitialTab, onChangeTab]);

  const [brandingForm, setBrandingForm] = useState<BrandingSettings>(() => ({
    ...DEFAULT_BRANDING,
    ...(settings.branding || {}),
  }));

  useEffect(() => {
    setBrandingForm({
      ...DEFAULT_BRANDING,
      ...(settings.branding || {}),
    });
  }, [settings.branding]);

  const [notifForm, setNotifForm] = useState<NotificationSettings>(() => ({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(settings.notifications || {}),
  }));

  useEffect(() => {
    setNotifForm({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...(settings.notifications || {}),
    });
  }, [settings.notifications]);

  const [newVacationTypeName, setNewVacationTypeName] = useState('');
  const [newContractTypeName, setNewContractTypeName] = useState('');
  const [newContractLimit, setNewContractLimit] = useState(24);
  const [editingType, setEditingType] = useState<{
    category: 'vacation' | 'contract';
    id: string;
    name: string;
    limit?: number;
  } | null>(null);

  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayStart, setNewHolidayStart] = useState(getTodayStr());
  const [newHolidayEnd, setNewHolidayEnd] = useState(getTodayStr());

  const [backupFile, setBackupFile] = useState<File | null>(null);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const handleAddVacationType = () => {
    const name = newVacationTypeName.trim();
    if (!name) return;
    setSettings((prev) => ({
      ...prev,
      vacationTypes: [...prev.vacationTypes, { id: generateId(), name }],
    }));
    setNewVacationTypeName('');
    onLogAudit(lang === 'ar' ? 'إضافة نوع إجازة' : 'Added Leave Type', name, 'settings');
  };

  const handleAddContractType = () => {
    const name = newContractTypeName.trim();
    if (!name) return;
    setSettings((prev) => ({
      ...prev,
      contractTypes: [
        ...prev.contractTypes,
        {
          id: generateId(),
          name,
          allowedVacationTypes: prev.vacationTypes.map((v) => v.id),
          annualLeaveLimit: Number(newContractLimit) || 24,
        },
      ],
    }));
    setNewContractTypeName('');
    onLogAudit(lang === 'ar' ? 'إضافة نوع عقد' : 'Added Contract Type', name, 'settings');
  };

  const handleSaveTypeEdit = () => {
    if (!editingType || !editingType.name.trim()) return;
    if (editingType.category === 'vacation') {
      setSettings((prev) => ({
        ...prev,
        vacationTypes: prev.vacationTypes.map((v) =>
          v.id === editingType.id ? { ...v, name: editingType.name.trim() } : v
        ),
      }));
    } else {
      setSettings((prev) => ({
        ...prev,
        contractTypes: prev.contractTypes.map((c) =>
          c.id === editingType.id
            ? {
                ...c,
                name: editingType.name.trim(),
                annualLeaveLimit: Number(editingType.limit) || 0,
              }
            : c
        ),
      }));
    }
    setEditingType(null);
    onToast('success', lang === 'ar' ? 'تم حفظ التعديلات.' : 'Changes saved.');
  };

  const toggleContractVacationLink = (contractId: string, vacationId: string) => {
    setSettings((prev) => ({
      ...prev,
      contractTypes: prev.contractTypes.map((c) => {
        if (c.id !== contractId) return c;
        const exists = c.allowedVacationTypes.includes(vacationId);
        return {
          ...c,
          allowedVacationTypes: exists
            ? c.allowedVacationTypes.filter((id) => id !== vacationId)
            : [...c.allowedVacationTypes, vacationId],
        };
      }),
    }));
  };

  const toggleWorkDay = (dayIdx: number) => {
    setSettings((prev) => {
      const exists = prev.workWeekDays.includes(dayIdx);
      const next = exists
        ? prev.workWeekDays.filter((d) => d !== dayIdx)
        : [...prev.workWeekDays, dayIdx].sort();
      return { ...prev, workWeekDays: next.length > 0 ? next : prev.workWeekDays };
    });
  };

  const handleAddHoliday = () => {
    const name = newHolidayName.trim();
    if (!name || !newHolidayStart) return;
    const holiday: OfficialHoliday = {
      id: generateId(),
      name,
      startDate: newHolidayStart,
      endDate: newHolidayEnd >= newHolidayStart ? newHolidayEnd : newHolidayStart,
    };
    setSettings((prev) => ({
      ...prev,
      officialHolidays: [...prev.officialHolidays, holiday],
    }));
    setNewHolidayName('');
    onLogAudit(lang === 'ar' ? 'إضافة عطلة رسمية' : 'Added Official Holiday', name, 'settings');
    onToast('success', lang === 'ar' ? 'تمت إضافة العطلة الرسمية.' : 'Official holiday added.');
  };

  const handleFullExport = () => {
    const payload = {
      timestamp: new Date().toISOString(),
      employees,
      vacations,
      orgUnits,
      exitPermissions,
      employeeRequests,
      substituteExceptions,
      attendanceRecords,
      absenceRecords,
      archiveRecords,
      settings,
      users,
      auditLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archaeology-hr-backup-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onLogAudit(lang === 'ar' ? 'تصدير نسخة احتياطية' : 'Exported JSON Backup', `${employees.length} employees`, 'system');
    onToast('success', lang === 'ar' ? 'تم تنزيل ملف النسخة الاحتياطية.' : 'Backup file downloaded.');
  };

  const executeRestore = () => {
    if (!backupFile) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(String(e.target?.result || '{}'));
        if (!Array.isArray(json.employees) || !Array.isArray(json.vacations)) {
          throw new Error('Invalid backup structure.');
        }
        setEmployees(json.employees);
        setVacations(json.vacations);
        if (Array.isArray(json.orgUnits)) setOrgUnits(json.orgUnits);
        if (Array.isArray(json.exitPermissions)) setExitPermissions(json.exitPermissions);
        if (Array.isArray(json.employeeRequests)) setEmployeeRequests(json.employeeRequests);
        if (Array.isArray(json.substituteExceptions) && setSubstituteExceptions) {
          setSubstituteExceptions(json.substituteExceptions);
        }
        if (Array.isArray(json.attendanceRecords) && setAttendanceRecords) {
          setAttendanceRecords(json.attendanceRecords);
        }
        if (Array.isArray(json.absenceRecords) && setAbsenceRecords) {
          setAbsenceRecords(json.absenceRecords);
        }
        if (Array.isArray(json.archiveRecords) && setArchiveRecords) {
          setArchiveRecords(json.archiveRecords);
        }
        if (Array.isArray(json.users) && json.users.length > 0) setUsers(json.users);
        if (json.settings) {
          const legacyTheme = String(json.settings.currentTheme || 'dark');
          const mappedTheme: ThemeOption = legacyTheme === 'black' || legacyTheme === 'dark' ? 'dark' : 'light';
          setSettings((prev) => ({
            ...prev,
            ...json.settings,
            currentTheme: mappedTheme,
            workWeekDays: Array.isArray(json.settings.workWeekDays)
              ? json.settings.workWeekDays
              : prev.workWeekDays,
            officialHolidays: Array.isArray(json.settings.officialHolidays)
              ? json.settings.officialHolidays
              : prev.officialHolidays,
            requireAttachment: Boolean(json.settings.requireAttachment),
            branding: { ...DEFAULT_BRANDING, ...(json.settings.branding || {}) },
            attendanceConfig: (() => {
              const merged = {
                ...DEFAULT_ATTENDANCE_SETTINGS,
                ...(json.settings.attendanceConfig || {}),
              };
              return {
                ...merged,
                enforceGeofenceForEmployees: merged.enforceGeofenceForEmployees ?? true,
                defaultGeofenceRadiusMeters: merged.defaultGeofenceRadiusMeters ?? 250,
                workSiteLocations: getEffectiveWorkSiteLocations(merged),
              };
            })(),
          }));
        }
        onLogAudit(lang === 'ar' ? 'استعادة نسخة احتياطية' : 'Restored JSON Backup', backupFile.name, 'system');
        onToast('success', lang === 'ar' ? 'تمت استعادة البيانات بنجاح.' : 'Backup restored successfully.');
        setBackupFile(null);
      } catch {
        onToast('error', lang === 'ar' ? 'ملف النسخة الاحتياطية غير صالح.' : 'Invalid backup JSON file.');
      }
    };
    reader.readAsText(backupFile);
  };

  const handleUploadBrandingImage = async (field: 'logoDataUrl' | 'loginImageDataUrl', file?: File | null) => {
    if (!file) return;
    try {
      const maxWidth = field === 'logoDataUrl' ? 400 : 1280;
      const dataUrl = await compressImageToDataUrl(file, maxWidth, 0.85);
      setBrandingForm((prev) => ({ ...prev, [field]: dataUrl }));
      setSettings((prev) => ({
        ...prev,
        branding: { ...DEFAULT_BRANDING, ...(prev.branding || {}), ...brandingForm, [field]: dataUrl },
      }));
      onLogAudit(
        lang === 'ar' ? 'تحديث صور الهوية' : 'Updated Branding Asset',
        field === 'logoDataUrl' ? 'Organization Logo' : 'Login Showcase Image',
        'settings'
      );
      onToast('success', lang === 'ar' ? 'تم رفع وتحديث الصورة بنجاح.' : 'Image uploaded and applied.');
    } catch {
      onToast('error', lang === 'ar' ? 'فشل قراءة الصورة.' : 'Failed to process image.');
    }
  };

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    setSettings((prev) => ({
      ...prev,
      branding: {
        ...DEFAULT_BRANDING,
        ...(prev.branding || {}),
        ...brandingForm,
      },
    }));
    onLogAudit(
      lang === 'ar' ? 'تحديث هوية المؤسسة' : 'Updated Organization Branding',
      brandingForm.orgNameAr || brandingForm.orgNameEn,
      'settings'
    );
    onToast('success', lang === 'ar' ? 'تم حفظ إعدادات الهوية وصفحة الدخول.' : 'Branding settings saved.');
  };

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    setSettings((prev) => ({
      ...prev,
      notifications: { ...notifForm },
    }));
    onLogAudit(
      lang === 'ar' ? 'تحديث إعدادات الإشعارات' : 'Updated Notification Settings',
      `${notifForm.appEnabled ? 'App ' : ''}${notifForm.emailEnabled ? `Email(${notifForm.notificationEmail})` : ''}`,
      'settings'
    );
    onToast('success', lang === 'ar' ? 'تم حفظ إعدادات الإشعارات بنجاح.' : 'Notification settings saved.');
  };

  const handleToggleBrowserNotifications = async (enabled: boolean) => {
    if (enabled && typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            onToast('warning', lang === 'ar' ? 'لم يتم منح صلاحية إشعارات المتصفح.' : 'Browser notification permission not granted.');
          }
        } catch {
          // Ignore Notification permission rejection
        }
      }
    }
    setNotifForm((prev) => ({ ...prev, browserEnabled: enabled }));
  };

  const availableTabs: Array<{ id: SettingsTab; label: string }> = [
    ...(canManageSettings ? [{ id: 'branding' as const, label: t(lang, 'settingsTabBranding') }] : []),
    ...(canManageUsers ? [{ id: 'users' as const, label: t(lang, 'settingsTabUsers') }] : []),
    ...(canManageAttendanceAdmin
      ? [{ id: 'attendance_admin' as const, label: t(lang, 'settingsTabAttendanceAdmin') }]
      : []),
    ...(canManageSettings
      ? [
          { id: 'config' as const, label: t(lang, 'settingsTabConfig') },
          { id: 'holidays' as const, label: t(lang, 'settingsTabHolidays') },
          { id: 'notifications' as const, label: t(lang, 'settingsTabNotifications') },
          { id: 'backup' as const, label: t(lang, 'settingsTabBackup') },
          { id: 'audit' as const, label: t(lang, 'settingsTabAudit') },
        ]
      : []),
  ];

  const requestedTab = controlledTab ?? internalTab;
  const activeTab: SettingsTab = availableTabs.some((tb) => tb.id === requestedTab)
    ? requestedTab
    : availableTabs[0]?.id || 'branding';

  const setActiveTab = (next: SettingsTab) => {
    if (onChangeTab) {
      onChangeTab(next);
    } else {
      setInternalTab(next);
    }
  };

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[var(--border)]">
        <div>
          <h2 className="font-display text-2xl font-bold flex items-center gap-2">
            <Settings size={22} className="text-[var(--primary-text)]" />
            <span>{t(lang, 'settingsTitle')}</span>
          </h2>
        </div>

        <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] gap-1">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Branding & Login Page Image */}
      {activeTab === 'branding' && canManageSettings && (
        <form onSubmit={handleSaveBranding} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-4">
            <h3 className="font-display text-base font-bold flex items-center gap-2">
              <Palette size={18} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'settingsTabBranding')}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'brandingOrgNameAr')}
                </label>
                <input
                  type="text"
                  value={brandingForm.orgNameAr}
                  onChange={(e) => setBrandingForm({ ...brandingForm, orgNameAr: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'brandingOrgNameEn')}
                </label>
                <input
                  type="text"
                  value={brandingForm.orgNameEn}
                  onChange={(e) => setBrandingForm({ ...brandingForm, orgNameEn: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'brandingOrgTitleAr')}
                </label>
                <input
                  type="text"
                  value={brandingForm.orgTitleAr}
                  onChange={(e) => setBrandingForm({ ...brandingForm, orgTitleAr: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'brandingOrgTitleEn')}
                </label>
                <input
                  type="text"
                  value={brandingForm.orgTitleEn}
                  onChange={(e) => setBrandingForm({ ...brandingForm, orgTitleEn: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'brandingLoginHeadlineAr')}
                </label>
                <input
                  type="text"
                  value={brandingForm.loginHeadlineAr || ''}
                  onChange={(e) => setBrandingForm({ ...brandingForm, loginHeadlineAr: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'brandingLoginHeadlineEn')}
                </label>
                <input
                  type="text"
                  value={brandingForm.loginHeadlineEn || ''}
                  onChange={(e) => setBrandingForm({ ...brandingForm, loginHeadlineEn: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                {t(lang, 'saveBrandingBtn')}
              </button>
            </div>
          </div>

          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-5">
            {/* Organization Logo */}
            <div className="space-y-2.5">
              <label className="block text-xs font-semibold text-[var(--text-muted)]">
                {t(lang, 'brandingLogoLabel')}
              </label>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--border)]">
                <img
                  src={brandingForm.logoDataUrl || emblemImg}
                  alt="Logo"
                  className="w-16 h-16 rounded-xl object-cover border border-[var(--border)] shrink-0"
                />
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer">
                    <Upload size={14} />
                    <span>{t(lang, 'uploadImageBtn')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUploadBrandingImage('logoDataUrl', e.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setBrandingForm((prev) => ({ ...prev, logoDataUrl: emblemImg }));
                      setSettings((prev) => ({
                        ...prev,
                        branding: { ...DEFAULT_BRANDING, ...(prev.branding || {}), logoDataUrl: emblemImg },
                      }));
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                  >
                    <RotateCcw size={13} />
                    <span>{t(lang, 'resetDefaultImgBtn')}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Login Page Showcase Image */}
            <div className="space-y-2.5 pt-3 border-t border-[var(--border)]">
              <label className="block text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                <ImageIcon size={14} className="text-[var(--primary-text)]" />
                <span>{t(lang, 'brandingLoginImgLabel')}</span>
              </label>
              <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--app-bg)]">
                <div className="relative h-44 w-full overflow-hidden">
                  <img
                    src={brandingForm.loginImageDataUrl || loginShowcaseImg}
                    alt="Login Showcase"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                  <div className="absolute bottom-3 start-3 end-3 text-white text-xs font-semibold truncate">
                    {lang === 'ar' ? brandingForm.loginHeadlineAr : brandingForm.loginHeadlineEn}
                  </div>
                </div>
                <div className="p-3 flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer">
                    <Upload size={14} />
                    <span>{t(lang, 'uploadImageBtn')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUploadBrandingImage('loginImageDataUrl', e.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setBrandingForm((prev) => ({ ...prev, loginImageDataUrl: loginShowcaseImg }));
                      setSettings((prev) => ({
                        ...prev,
                        branding: { ...DEFAULT_BRANDING, ...(prev.branding || {}), loginImageDataUrl: loginShowcaseImg },
                      }));
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                  >
                    <RotateCcw size={13} />
                    <span>{t(lang, 'resetDefaultImgBtn')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Tab: Embedded Permissions Management */}
      {activeTab === 'users' && canManageUsers && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6">
          <UserManager
            embedded
            users={users}
            setUsers={setUsers}
            currentUser={currentUser}
            lang={lang}
            settings={settings}
            setSettings={setSettings}
            employees={employees}
            onLogAudit={(action, details, cat) => onLogAudit(action, details, cat)}
            onToast={onToast}
          />
        </div>
      )}

      {/* Tab: Attendance Administration ("إدارة الحضور والإنصراف") */}
      {activeTab === 'attendance_admin' && canManageAttendanceAdmin && (
        <AttendanceAdminTab
          settings={settings}
          setSettings={setSettings}
          employees={employees}
          setEmployees={setEmployees}
          attendanceRecords={attendanceRecords}
          setAttendanceRecords={setAttendanceRecords}
          lang={lang}
          currentUserName={currentUser?.name}
          onLogAudit={(action, details, cat) => onLogAudit(action, details, cat)}
          onToast={onToast}
        />
      )}

      {/* Tab 1: Types & Eligibility */}
      {activeTab === 'config' && canManageSettings && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Leave & Contract Types */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-6">
            <div className="space-y-3">
              <h3 className="font-display text-sm font-bold text-[var(--text-main)]">
                {t(lang, 'vacationTypesTitle')}
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={lang === 'ar' ? 'اسم نوع الإجازة...' : 'New leave type...'}
                  value={newVacationTypeName}
                  onChange={(e) => setNewVacationTypeName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddVacationType()}
                  className="flex-1 px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  onClick={handleAddVacationType}
                  className="px-3.5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
                {settings.vacationTypes.map((vt) => (
                  <div key={vt.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-[var(--app-bg)]">
                    {editingType?.id === vt.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          autoFocus
                          value={editingType.name}
                          onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveTypeEdit()}
                          className="flex-1 px-2 py-1 bg-[var(--card-bg)] border border-[var(--primary)] rounded text-sm outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleSaveTypeEdit}
                          className="p-1.5 rounded bg-[var(--primary)] text-[var(--primary-fg)] cursor-pointer"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-medium">{translateVacationType(vt.name, lang)}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingType({ category: 'vacation', id: vt.id, name: vt.name })}
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmState({
                                title: t(lang, 'confirmActionTitle'),
                                message: lang === 'ar' ? `حذف نوع الإجازة "${vt.name}"؟` : `Delete "${vt.name}"?`,
                                onConfirm: () => {
                                  setSettings((prev) => ({
                                    ...prev,
                                    vacationTypes: prev.vacationTypes.filter((x) => x.id !== vt.id),
                                    contractTypes: prev.contractTypes.map((c) => ({
                                      ...c,
                                      allowedVacationTypes: c.allowedVacationTypes.filter((id) => id !== vt.id),
                                    })),
                                  }));
                                  setConfirmState(null);
                                },
                              })
                            }
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-5 border-t border-[var(--border)] space-y-3">
              <h3 className="font-display text-sm font-bold text-[var(--text-main)]">
                {t(lang, 'contractTypesTitle')}
              </h3>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder={lang === 'ar' ? 'اسم نوع التعاقد...' : 'New contract type...'}
                  value={newContractTypeName}
                  onChange={(e) => setNewContractTypeName(e.target.value)}
                  className="flex-1 min-w-[160px] px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                />
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={newContractLimit}
                  onChange={(e) => setNewContractLimit(Number(e.target.value))}
                  className="w-20 px-2.5 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                  title={t(lang, 'annualLimitLabel')}
                />
                <button
                  type="button"
                  onClick={handleAddContractType}
                  className="px-3.5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
                {settings.contractTypes.map((ct) => (
                  <div key={ct.id} className="px-3.5 py-2.5 bg-[var(--app-bg)] flex items-center justify-between gap-2">
                    {editingType?.id === ct.id ? (
                      <div className="flex flex-wrap items-center gap-2 flex-1">
                        <input
                          autoFocus
                          value={editingType.name}
                          onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                          className="flex-1 min-w-[140px] px-2 py-1 bg-[var(--card-bg)] border border-[var(--primary)] rounded text-sm outline-none"
                        />
                        <input
                          type="number"
                          value={editingType.limit ?? 0}
                          onChange={(e) => setEditingType({ ...editingType, limit: Number(e.target.value) })}
                          className="w-20 px-2 py-1 bg-[var(--card-bg)] border border-[var(--primary)] rounded text-sm font-mono-tabular outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleSaveTypeEdit}
                          className="p-1.5 rounded bg-[var(--primary)] text-[var(--primary-fg)] cursor-pointer"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="text-sm font-medium">{ct.name}</div>
                          <div className="text-xs font-mono-tabular text-[var(--text-muted)]">
                            {t(lang, 'annualLimitLabel')}: {ct.annualLeaveLimit ?? 0}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingType({
                                category: 'contract',
                                id: ct.id,
                                name: ct.name,
                                limit: ct.annualLeaveLimit,
                              })
                            }
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmState({
                                title: t(lang, 'confirmActionTitle'),
                                message: lang === 'ar' ? `حذف نوع العقد "${ct.name}"؟` : `Delete "${ct.name}"?`,
                                onConfirm: () => {
                                  setSettings((prev) => ({
                                    ...prev,
                                    contractTypes: prev.contractTypes.filter((x) => x.id !== ct.id),
                                  }));
                                  setConfirmState(null);
                                },
                              })
                            }
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Eligibility Rules */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-4">
            <h3 className="font-display text-sm font-bold text-[var(--text-main)]">
              {t(lang, 'eligibilityMatrixTitle')}
            </h3>
            <div className="space-y-3">
              {settings.contractTypes.map((contract) => (
                <div
                  key={contract.id}
                  className="p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] space-y-3"
                >
                  <div className="font-semibold text-sm text-[var(--primary-text)] border-b border-[var(--border)] pb-2">
                    {contract.name}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {settings.vacationTypes.map((vt) => {
                      const isChecked = contract.allowedVacationTypes.includes(vt.id);
                      return (
                        <button
                          key={vt.id}
                          type="button"
                          onClick={() => toggleContractVacationLink(contract.id, vt.id)}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                            isChecked
                              ? 'bg-[var(--primary-soft)] border-[var(--primary)]/50 text-[var(--text-main)] font-medium'
                              : 'bg-[var(--card-bg)] border-[var(--border)] text-[var(--text-muted)]'
                          }`}
                        >
                          {isChecked ? (
                            <CheckSquare size={14} className="text-[var(--primary-text)] shrink-0" />
                          ) : (
                            <Square size={14} className="shrink-0 opacity-60" />
                          )}
                          <span className="truncate">{translateVacationType(vt.name, lang)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Workweek, Holidays & Appearance */}
      {activeTab === 'holidays' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-6">
            <div className="space-y-3">
              <h3 className="font-display text-sm font-bold text-[var(--text-main)]">
                {t(lang, 'workWeekTitle')}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {WEEKDAY_LABELS[lang].map((dayLabel, idx) => {
                  const active = settings.workWeekDays.includes(idx);
                  return (
                    <button
                      key={dayLabel}
                      type="button"
                      onClick={() => toggleWorkDay(idx)}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-transparent'
                          : 'bg-[var(--app-bg)] text-[var(--text-muted)] border-[var(--border)]'
                      }`}
                    >
                      {dayLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-5 border-t border-[var(--border)] space-y-3">
              <label className="flex items-center gap-3 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={settings.requireAttachment}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, requireAttachment: e.target.checked }))
                  }
                  className="rounded accent-[var(--primary)]"
                />
                <span>{t(lang, 'requireAttachmentLabel')}</span>
              </label>
            </div>

            <div className="pt-5 border-t border-[var(--border)] space-y-3">
              <h3 className="font-display text-sm font-bold text-[var(--text-main)]">
                {t(lang, 'themeLabel')}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onChangeTheme('dark')}
                  className={`p-3 rounded-xl border flex items-center gap-3 transition-colors cursor-pointer ${
                    settings.currentTheme === 'dark'
                      ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                      : 'border-[var(--border)] bg-[var(--app-bg)]'
                  }`}
                >
                  <Moon size={18} className="text-[var(--primary-text)]" />
                  <span className="text-xs font-semibold">{t(lang, 'darkMode')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTheme('light')}
                  className={`p-3 rounded-xl border flex items-center gap-3 transition-colors cursor-pointer ${
                    settings.currentTheme === 'light'
                      ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                      : 'border-[var(--border)] bg-[var(--app-bg)]'
                  }`}
                >
                  <Sun size={18} className="text-[var(--primary-text)]" />
                  <span className="text-xs font-semibold">{t(lang, 'lightMode')}</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onChangeLanguage('ar')}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                    lang === 'ar'
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-transparent'
                      : 'bg-[var(--app-bg)] border-[var(--border)]'
                  }`}
                >
                  العربية (RTL)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeLanguage('en')}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                    lang === 'en'
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-transparent'
                      : 'bg-[var(--app-bg)] border-[var(--border)]'
                  }`}
                >
                  English (LTR)
                </button>
              </div>
            </div>
          </div>

          {/* Official Holidays */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-4">
            <h3 className="font-display text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
              <CalendarDays size={17} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'officialHolidaysTitle')}</span>
            </h3>

            <div className="space-y-3 p-4 rounded-lg bg-[var(--app-bg)] border border-[var(--border)]">
              <input
                type="text"
                placeholder={t(lang, 'holidayNamePlaceholder')}
                value={newHolidayName}
                onChange={(e) => setNewHolidayName(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={newHolidayStart}
                  onChange={(e) => setNewHolidayStart(e.target.value)}
                  className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular text-[var(--text-main)] outline-none"
                />
                <input
                  type="date"
                  value={newHolidayEnd}
                  onChange={(e) => setNewHolidayEnd(e.target.value)}
                  className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular text-[var(--text-main)] outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleAddHoliday}
                className="w-full py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                {t(lang, 'addHolidayBtn')}
              </button>
            </div>

            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
              {settings.officialHolidays.map((h) => (
                <div key={h.id} className="px-4 py-3 bg-[var(--app-bg)] flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{h.name}</div>
                    <div className="text-xs font-mono-tabular text-[var(--text-muted)]">
                      {h.startDate} → {h.endDate}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        officialHolidays: prev.officialHolidays.filter((item) => item.id !== h.id),
                      }))
                    }
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Backup & Data */}
      {activeTab === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-5">
            <h3 className="font-display text-base font-bold flex items-center gap-2">
              <Database size={18} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'backupTitle')}</span>
            </h3>

            <button
              type="button"
              onClick={handleFullExport}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
            >
              <Download size={16} />
              <span>{t(lang, 'downloadBackupJson')}</span>
            </button>

            <div className="pt-4 border-t border-[var(--border)] space-y-3">
              <label className="flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-[var(--border)] rounded-lg cursor-pointer text-xs text-[var(--text-muted)] hover:border-[var(--primary)]">
                <Upload size={16} />
                <span>{backupFile ? backupFile.name : t(lang, 'restoreBackupLabel')}</span>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
                />
              </label>
              {backupFile && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmState({
                      title: t(lang, 'confirmActionTitle'),
                      message:
                        lang === 'ar'
                          ? 'سيتم استبدال جميع البيانات الحالية بالملف المحدد. هل تريد المتابعة؟'
                          : 'Replace all current data with the selected backup?',
                      onConfirm: () => {
                        executeRestore();
                        setConfirmState(null);
                      },
                    })
                  }
                  className="w-full py-2.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                >
                  {t(lang, 'restoreNowBtn')}
                </button>
              )}
            </div>
          </div>

          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-[var(--text-main)]">
              {lang === 'ar' ? 'إدارة السجلات الافتراضية' : 'Workspace Dataset Controls'}
            </h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              {lang === 'ar'
                ? 'يمكنك إعادة تحميل البيانات التجريبية الخاصة بمصلحة الآثار أو تفريغ كافة السجلات قبل استيراد ملف Excel فعلي.'
                : 'Reset to the sample Archaeology Department dataset or clear all records before importing a production Excel sheet.'}
            </p>
            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={() =>
                  setConfirmState({
                    title: t(lang, 'confirmActionTitle'),
                    message:
                      lang === 'ar'
                        ? 'هل تريد استعادة البيانات التجريبية الافتراضية؟'
                        : 'Restore the default demo dataset?',
                    onConfirm: () => {
                      onRestoreDemoData();
                      setConfirmState(null);
                    },
                  })
                }
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--app-bg)] cursor-pointer"
              >
                <RotateCcw size={15} />
                <span>{t(lang, 'resetDemoBtn')}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setConfirmState({
                    title: t(lang, 'confirmActionTitle'),
                    message:
                      lang === 'ar'
                        ? 'هل أنت متأكد من تفريغ جميع سجلات الموظفين والإجازات؟'
                        : 'Clear all employee and vacation records?',
                    onConfirm: () => {
                      onClearAllData();
                      setConfirmState(null);
                    },
                  })
                }
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold hover:opacity-90 cursor-pointer"
              >
                <Trash2 size={15} />
                <span>{t(lang, 'clearAllBtn')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Notifications Settings (Email, App, Browser) */}
      {activeTab === 'notifications' && canManageSettings && (
        <form onSubmit={handleSaveNotifications} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-5">
            <div>
              <h3 className="font-display text-base font-bold flex items-center gap-2">
                <Bell size={18} className="text-[var(--primary-text)]" />
                <span>{t(lang, 'notificationSettingsTitle')}</span>
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">{t(lang, 'notificationSettingsDesc')}</p>
            </div>

            <div className="space-y-3">
              {/* App In-Header Notifications */}
              <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] cursor-pointer hover:border-[var(--primary)]/50 transition-colors">
                <input
                  type="checkbox"
                  checked={notifForm.appEnabled}
                  onChange={(e) => setNotifForm({ ...notifForm, appEnabled: e.target.checked })}
                  className="mt-0.5 rounded accent-[var(--primary)]"
                />
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold">{t(lang, 'channelAppLabel')}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t(lang, 'channelAppDesc')}</div>
                </div>
              </label>

              {/* Email Notifications */}
              <div className="p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifForm.emailEnabled}
                    onChange={(e) => setNotifForm({ ...notifForm, emailEnabled: e.target.checked })}
                    className="mt-0.5 rounded accent-[var(--primary)]"
                  />
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold flex items-center gap-1.5">
                      <Mail size={14} className="text-[var(--primary-text)]" />
                      <span>{t(lang, 'channelEmailLabel')}</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">{t(lang, 'channelEmailDesc')}</div>
                  </div>
                </label>

                {notifForm.emailEnabled && (
                  <div className="ps-6">
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      {t(lang, 'notificationEmailLabel')}
                    </label>
                    <input
                      type="email"
                      value={notifForm.notificationEmail}
                      onChange={(e) => setNotifForm({ ...notifForm, notificationEmail: e.target.value })}
                      placeholder="hr@archaeology.gov"
                      className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                )}
              </div>

              {/* Browser Notifications */}
              <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] cursor-pointer hover:border-[var(--primary)]/50 transition-colors">
                <input
                  type="checkbox"
                  checked={notifForm.browserEnabled}
                  onChange={(e) => handleToggleBrowserNotifications(e.target.checked)}
                  className="mt-0.5 rounded accent-[var(--primary)]"
                />
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold">{t(lang, 'channelBrowserLabel')}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t(lang, 'channelBrowserDesc')}</div>
                </div>
              </label>

              {/* Sound toggle */}
              <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifForm.soundEnabled}
                  onChange={(e) => setNotifForm({ ...notifForm, soundEnabled: e.target.checked })}
                  className="rounded accent-[var(--primary)]"
                />
                <span className="text-sm font-medium">{t(lang, 'channelSoundLabel')}</span>
              </label>
            </div>
          </div>

          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="font-display text-base font-bold">{t(lang, 'triggersSectionTitle')}</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={notifForm.notifyOnNewRequest}
                    onChange={(e) => setNotifForm({ ...notifForm, notifyOnNewRequest: e.target.checked })}
                    className="rounded accent-[var(--primary)]"
                  />
                  <span>{t(lang, 'triggerNewRequest')}</span>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={notifForm.notifyOnStatusChange}
                    onChange={(e) => setNotifForm({ ...notifForm, notifyOnStatusChange: e.target.checked })}
                    className="rounded accent-[var(--primary)]"
                  />
                  <span>{t(lang, 'triggerStatusChange')}</span>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={notifForm.notifyOnSubstituteConflict}
                    onChange={(e) => setNotifForm({ ...notifForm, notifyOnSubstituteConflict: e.target.checked })}
                    className="rounded accent-[var(--primary)]"
                  />
                  <span>{t(lang, 'triggerSubstituteConflict')}</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-[var(--border)]">
              <button
                type="submit"
                className="flex-1 py-2.5 px-4 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
              >
                {t(lang, 'saveNotificationSettingsBtn')}
              </button>
              {onSendTestNotification && (
                <button
                  type="button"
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, notifications: { ...notifForm } }));
                    onSendTestNotification(notifForm);
                  }}
                  className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-sm font-semibold text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
                >
                  <Send size={15} className="text-[var(--primary-text)]" />
                  <span>{t(lang, 'sendTestNotificationBtn')}</span>
                </button>
              )}
            </div>
          </div>
        </form>
      )}

      {/* Tab 4: Audit Log */}
      {activeTab === 'audit' && (
        <AuditLogPanel
          auditLogs={auditLogs}
          lang={lang}
          embedded
          currentUser={currentUser}
          employees={employees}
          settings={settings}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmText={t(lang, 'confirmBtn')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
};

export default SettingsAndAuditView;
