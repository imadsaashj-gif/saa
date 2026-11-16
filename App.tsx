import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ClipboardList,
  Clock,
  Database,
  DoorOpen,
  FilePlus2,
  FileSpreadsheet,
  Globe,
  Hash,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  Network,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  Save,
  Scale,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Upload,
  UserCheck,
  UserCircle,
  Users,
  UserX,
  X,
  Zap,
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import MyRequestsView, { MyRequestsSubTab } from './components/MyRequestsView';
import AttendanceHub, { AttendanceHubSubTab } from './components/AttendanceHub';
import OrgHub, { OrgSubTab } from './components/OrgHub';
import RequestsHub, { NotificationEmitPayload, RequestsSubTab } from './components/RequestsHub';
import ArchiveView from './components/ArchiveView';
import AIAssistantView from './components/AIAssistantView';
import AuditLogPanel from './components/AuditLogPanel';
import NotificationsPopover from './components/NotificationsPopover';
import SettingsAndAuditView, { SettingsTab } from './components/SettingsAndAuditView';
import LoginPage from './components/LoginPage';
import QuickRequestModal from './components/QuickRequestModal';
import { AvatarWithFallback, ToastContainer, ToastMessage } from './components/UIPrimitives';
import { emblemImg } from './assets';
import {
  ALL_PERMISSION_IDS,
  AbsenceRecord,
  AppNotification,
  AppUser,
  ArchiveRecord,
  AttendanceRecord,
  AuditLogEntry,
  DepartmentUnit,
  Employee,
  EmployeeRequest,
  ExitPermission,
  Language,
  NotificationSettings,
  PERMISSIONS_LIST,
  SubstituteExceptionRequest,
  SystemSettings,
  ThemeOption,
  Vacation,
  generateId,
} from './types';
import { t, translateRole } from './i18n';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_BRANDING,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_ORG_UNITS,
  DEFAULT_SETTINGS,
  DEFAULT_USERS,
  INITIAL_AUDIT_LOGS,
  INITIAL_NOTIFICATIONS,
  SAMPLE_ABSENCES,
  SAMPLE_ARCHIVE_RECORDS,
  SAMPLE_ATTENDANCE_RECORDS,
  SAMPLE_EMPLOYEE_REQUESTS,
  SAMPLE_EMPLOYEES,
  SAMPLE_EXIT_PERMISSIONS,
  SAMPLE_SUBSTITUTE_EXCEPTIONS,
  SAMPLE_VACATIONS,
  SUPER_ADMIN_USER,
} from './data/seedData';
import { getEffectiveWorkSiteLocations, resolveSyncedRectification } from './utils/attendanceCalculations';

type View =
  | 'dashboard'
  | 'my_requests'
  | 'attendance_hub'
  | 'requests'
  | 'org'
  | 'archive'
  | 'settings'
  | 'audit'
  | 'ai'
  | 'profile';

const STORAGE_KEYS = {
  employees: 'arch_hr_employees_v2',
  vacations: 'arch_hr_vacations_v2',
  orgUnits: 'arch_hr_org_v2',
  exitPermissions: 'arch_hr_exits_v2',
  employeeRequests: 'arch_hr_requests_v2',
  substituteExceptions: 'arch_hr_sub_exceptions_v2',
  attendance: 'arch_hr_attendance_v2',
  absences: 'arch_hr_absences_v2',
  archive: 'arch_hr_archive_v2',
  notifications: 'arch_hr_notifications_v2',
  settings: 'arch_hr_settings_v2',
  users: 'arch_hr_users_v2',
  usersPhase2Migrated: 'arch_hr_users_phase2_migrated_v1',
  usersPhase3Migrated: 'arch_hr_users_phase3_migrated_v1',
  usersPhase4Migrated: 'arch_hr_users_phase4_migrated_v1',
  usersSuperAdminOnlyMigrated: 'arch_hr_users_superadmin_only_v1',
  audit: 'arch_hr_audit_v2',
  currentUserId: 'arch_hr_current_user_v2',
  sidebarCollapsed: 'arch_hr_sidebar_collapsed_v1',
};

function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function hydrateUsers(rawUsers: AppUser[], extraPermIds: string[] = []): AppUser[] {
  const needsSuperAdminOnlyReset = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.usersSuperAdminOnlyMigrated) !== '1';
    } catch {
      return false;
    }
  })();

  const needsPhase2Backfill = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.usersPhase2Migrated) !== '1';
    } catch {
      return false;
    }
  })();

  const needsPhase3Backfill = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.usersPhase3Migrated) !== '1';
    } catch {
      return false;
    }
  })();

  const needsPhase4Backfill = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.usersPhase4Migrated) !== '1';
    } catch {
      return false;
    }
  })();

  if (needsSuperAdminOnlyReset) {
    const existingSuper = rawUsers.find((u) => u.role === 'SuperAdmin' || u.id === SUPER_ADMIN_USER.id);
    const normalizedSuper: AppUser = {
      ...(existingSuper || SUPER_ADMIN_USER),
      id: existingSuper?.id || SUPER_ADMIN_USER.id,
      username: 'admin',
      password: 'admin',
      email: 'admin@archaeology.gov',
      role: 'SuperAdmin',
      status: 'Active',
      linkedEmployeeId: existingSuper?.linkedEmployeeId || 'emp-1',
      permissions: Array.from(new Set([...ALL_PERMISSION_IDS, ...extraPermIds])),
    };
    try {
      localStorage.setItem(STORAGE_KEYS.usersSuperAdminOnlyMigrated, '1');
      localStorage.setItem(STORAGE_KEYS.usersPhase2Migrated, '1');
      localStorage.setItem(STORAGE_KEYS.usersPhase3Migrated, '1');
      localStorage.setItem(STORAGE_KEYS.usersPhase4Migrated, '1');
    } catch {
      // Ignore storage write issue
    }
    return [normalizedSuper];
  }

  const migrated = rawUsers.map((u) => {
    if (u.role === 'SuperAdmin') {
      return {
        ...u,
        linkedEmployeeId: u.linkedEmployeeId || 'emp-1',
        permissions: Array.from(new Set([...ALL_PERMISSION_IDS, ...extraPermIds])),
      };
    }

    let perms = u.permissions;

    if (needsPhase2Backfill) {
      if (u.role === 'Admin') {
        perms = Array.from(
          new Set([
            ...perms,
            'view_my_requests',
            'view_attendance',
            'manage_attendance',
            'view_org',
            'manage_org',
            'view_archive',
            'manage_archive',
            'view_audit',
            'approve_exceptions',
          ])
        );
      } else if (u.role === 'Manager') {
        perms = Array.from(
          new Set([
            ...perms,
            'view_my_requests',
            'view_attendance',
            'manage_attendance',
            'view_org',
            'view_archive',
            'manage_archive',
            'view_audit',
            'approve_exceptions',
          ])
        );
      } else if (u.role === 'HR') {
        perms = Array.from(
          new Set([
            ...perms,
            'view_my_requests',
            'view_attendance',
            'manage_attendance',
            'view_org',
            'view_archive',
            'manage_archive',
            'view_audit',
          ])
        );
      } else if (u.role === 'Employee') {
        perms = Array.from(
          new Set([...perms, 'view_my_requests', 'view_attendance', 'view_archive', 'view_audit'])
        );
      } else if (u.role === 'Viewer') {
        perms = Array.from(new Set([...perms, 'view_attendance', 'view_archive']));
      }
    }

    if (needsPhase3Backfill) {
      if (u.role === 'Admin' || u.role === 'Manager') {
        perms = Array.from(new Set([...perms, 'view_violations', 'manage_violations']));
      } else if (u.role === 'Employee') {
        perms = Array.from(new Set([...perms, 'view_dashboard']));
      }
    }

    if (needsPhase4Backfill) {
      if (u.role === 'Admin' || u.role === 'Manager' || u.role === 'HR') {
        perms = Array.from(new Set([...perms, 'view_attendance_sheet', 'view_absences', 'manage_absences']));
      } else if (u.role === 'Viewer') {
        perms = Array.from(new Set([...perms, 'view_attendance_sheet', 'view_absences']));
      }
    }

    return perms === u.permissions ? u : { ...u, permissions: perms };
  });

  if (needsPhase2Backfill) {
    try {
      localStorage.setItem(STORAGE_KEYS.usersPhase2Migrated, '1');
    } catch {
      // Ignore storage write issue
    }
  }
  if (needsPhase3Backfill) {
    try {
      localStorage.setItem(STORAGE_KEYS.usersPhase3Migrated, '1');
    } catch {
      // Ignore storage write issue
    }
  }
  if (needsPhase4Backfill) {
    try {
      localStorage.setItem(STORAGE_KEYS.usersPhase4Migrated, '1');
    } catch {
      // Ignore storage write issue
    }
  }

  const withSuper = migrated.some((u) => u.role === 'SuperAdmin' || u.id === SUPER_ADMIN_USER.id)
    ? migrated
    : [SUPER_ADMIN_USER, ...migrated];

  return withSuper;
}

function getDefaultViewForUser(user: AppUser | null): View {
  if (!user) return 'dashboard';
  const perms = user.permissions || [];
  if (perms.includes('view_dashboard')) return 'dashboard';
  if (perms.includes('view_my_requests')) return 'my_requests';
  if (
    perms.includes('view_attendance_sheet') ||
    perms.includes('manage_attendance') ||
    perms.includes('view_violations') ||
    perms.includes('manage_violations') ||
    perms.includes('view_absences') ||
    perms.includes('manage_absences')
  ) {
    return 'attendance_hub';
  }
  if (perms.includes('view_vacations')) return 'requests';
  if (perms.includes('view_org') || perms.includes('view_employees')) return 'org';
  if (perms.includes('view_archive') || perms.includes('manage_archive')) return 'archive';
  if (perms.includes('manage_settings') || perms.includes('manage_users') || perms.includes('manage_attendance')) {
    return 'settings';
  }
  if (perms.includes('view_audit')) return 'audit';
  if (perms.includes('ai_insights')) return 'ai';
  return 'dashboard';
}

const App: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>(() =>
    loadStored<Employee[]>(STORAGE_KEYS.employees, SAMPLE_EMPLOYEES)
  );
  const [vacations, setVacations] = useState<Vacation[]>(() =>
    loadStored<Vacation[]>(STORAGE_KEYS.vacations, SAMPLE_VACATIONS)
  );
  const [orgUnits, setOrgUnits] = useState<DepartmentUnit[]>(() =>
    loadStored<DepartmentUnit[]>(STORAGE_KEYS.orgUnits, DEFAULT_ORG_UNITS)
  );
  const [exitPermissions, setExitPermissions] = useState<ExitPermission[]>(() =>
    loadStored<ExitPermission[]>(STORAGE_KEYS.exitPermissions, SAMPLE_EXIT_PERMISSIONS)
  );
  const [employeeRequests, setEmployeeRequests] = useState<EmployeeRequest[]>(() =>
    loadStored<EmployeeRequest[]>(STORAGE_KEYS.employeeRequests, SAMPLE_EMPLOYEE_REQUESTS)
  );
  const [substituteExceptions, setSubstituteExceptions] = useState<SubstituteExceptionRequest[]>(() =>
    loadStored<SubstituteExceptionRequest[]>(STORAGE_KEYS.substituteExceptions, SAMPLE_SUBSTITUTE_EXCEPTIONS)
  );
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(() =>
    loadStored<AttendanceRecord[]>(STORAGE_KEYS.attendance, SAMPLE_ATTENDANCE_RECORDS)
  );
  const [absenceRecords, setAbsenceRecords] = useState<AbsenceRecord[]>(() =>
    loadStored<AbsenceRecord[]>(STORAGE_KEYS.absences, SAMPLE_ABSENCES)
  );
  const [archiveRecords, setArchiveRecords] = useState<ArchiveRecord[]>(() =>
    loadStored<ArchiveRecord[]>(STORAGE_KEYS.archive, SAMPLE_ARCHIVE_RECORDS)
  );
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    loadStored<AppNotification[]>(STORAGE_KEYS.notifications, INITIAL_NOTIFICATIONS)
  );
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() => {
    const loaded = loadStored<SystemSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
    const mergedAttCfg = {
      ...DEFAULT_ATTENDANCE_SETTINGS,
      ...(loaded.attendanceConfig || {}),
      enforceGeofenceForEmployees:
        loaded.attendanceConfig?.enforceGeofenceForEmployees ??
        DEFAULT_ATTENDANCE_SETTINGS.enforceGeofenceForEmployees ??
        true,
      defaultGeofenceRadiusMeters:
        loaded.attendanceConfig?.defaultGeofenceRadiusMeters ??
        DEFAULT_ATTENDANCE_SETTINGS.defaultGeofenceRadiusMeters ??
        250,
    };
    return {
      ...DEFAULT_SETTINGS,
      ...loaded,
      branding: {
        ...DEFAULT_BRANDING,
        ...(loaded.branding || {}),
        loginCardOpacity:
          loaded.branding?.loginCardOpacity === 78
            ? 20
            : loaded.branding?.loginCardOpacity ?? DEFAULT_BRANDING.loginCardOpacity,
      },
      notifications: {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...(loaded.notifications || {}),
      },
      attendanceConfig: {
        ...mergedAttCfg,
        workSiteLocations: getEffectiveWorkSiteLocations(mergedAttCfg),
      },
      customPermissions: loaded.customPermissions || [],
    };
  });
  const [appUsers, setAppUsers] = useState<AppUser[]>(() => {
    const loadedSettings = loadStored<SystemSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
    const customPermIds = (loadedSettings.customPermissions || []).map((p) => p.id);
    return hydrateUsers(loadStored<AppUser[]>(STORAGE_KEYS.users, DEFAULT_USERS), customPermIds);
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() =>
    loadStored<AuditLogEntry[]>(STORAGE_KEYS.audit, INITIAL_AUDIT_LOGS)
  );

  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.currentUserId);
    if (!saved || saved === 'null') return null;
    return saved;
  });

  const currentUser = useMemo(
    () => appUsers.find((u) => u.id === currentUserId && u.status === 'Active') || null,
    [appUsers, currentUserId]
  );

  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [myRequestsSubTab, setMyRequestsSubTab] = useState<MyRequestsSubTab>('leave');
  const [attendanceSubTab, setAttendanceSubTab] = useState<AttendanceHubSubTab>('sheet');
  const [requestsSubTab, setRequestsSubTab] = useState<RequestsSubTab>('leaves');
  const [orgSubTab, setOrgSubTab] = useState<OrgSubTab>('departments');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('branding');
  const [expandedGroups, setExpandedGroups] = useState<{
    my_requests: boolean;
    attendance_hub: boolean;
    requests: boolean;
    org: boolean;
    settings: boolean;
  }>({
    my_requests: true,
    attendance_hub: true,
    requests: true,
    org: true,
    settings: false,
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === '1';
    } catch {
      return false;
    }
  });
  const [preselectedEmpForLeave, setPreselectedEmpForLeave] = useState<string | null>(null);
  const [isQuickRequestOpen, setIsQuickRequestOpen] = useState(false);
  const [navHistory, setNavHistory] = useState<Array<{ view: View; subTab?: string }>>([]);
  const [profileName, setProfileName] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileAdminId, setProfileAdminId] = useState('');
  const [profileSerialNo, setProfileSerialNo] = useState('');
  const [profileJobTitle, setProfileJobTitle] = useState('');
  const [profileDepartment, setProfileDepartment] = useState('');
  const [profileDirectManager, setProfileDirectManager] = useState('');
  const [profileContractType, setProfileContractType] = useState('');
  const [profileHireDate, setProfileHireDate] = useState('');
  const [profileLocation, setProfileLocation] = useState('');
  const [profileAssignedWorkSiteId, setProfileAssignedWorkSiteId] = useState('');
  const [profileShiftMode, setProfileShiftMode] = useState<'standard' | 'flexible'>('standard');
  const [profileStatus, setProfileStatus] = useState('على رأس عمله');
  const [profileNotes, setProfileNotes] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [profilePassword, setProfilePassword] = useState('');
  const [profileConfirmPassword, setProfileConfirmPassword] = useState('');
  const [profileError, setProfileError] = useState('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const lang: Language = systemSettings.language || 'ar';
  const theme: ThemeOption = systemSettings.currentTheme || 'dark';
  const notifConfig: NotificationSettings = systemSettings.notifications || DEFAULT_NOTIFICATION_SETTINGS;

  const branding = systemSettings.branding || DEFAULT_BRANDING;
  const brandingOrgName =
    lang === 'ar'
      ? branding.orgNameAr || t(lang, 'brandTitle')
      : branding.orgNameEn || t(lang, 'brandTitle');
  const brandingOrgTitle =
    lang === 'ar'
      ? branding.orgTitleAr || t(lang, 'brandSubtitle')
      : branding.orgTitleEn || t(lang, 'brandSubtitle');
  const brandingLogo = branding.logoDataUrl || emblemImg;

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.employees, JSON.stringify(employees));
    } catch {
      // Ignore quota exceeded
    }
  }, [employees]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.vacations, JSON.stringify(vacations));
    } catch {
      // Ignore quota exceeded
    }
  }, [vacations]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.orgUnits, JSON.stringify(orgUnits));
    } catch {
      // Ignore quota exceeded
    }
  }, [orgUnits]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.exitPermissions, JSON.stringify(exitPermissions));
    } catch {
      // Ignore quota exceeded
    }
  }, [exitPermissions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.employeeRequests, JSON.stringify(employeeRequests));
    } catch {
      // Ignore quota exceeded
    }
  }, [employeeRequests]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.substituteExceptions, JSON.stringify(substituteExceptions));
    } catch {
      // Ignore quota exceeded
    }
  }, [substituteExceptions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.attendance, JSON.stringify(attendanceRecords));
    } catch {
      // Ignore quota exceeded
    }
  }, [attendanceRecords]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.absences, JSON.stringify(absenceRecords));
    } catch {
      // Ignore quota exceeded
    }
  }, [absenceRecords]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.archive, JSON.stringify(archiveRecords));
    } catch {
      // Ignore quota exceeded
    }
  }, [archiveRecords]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.notifications, JSON.stringify(notifications.slice(0, 60)));
    } catch {
      // Ignore quota exceeded
    }
  }, [notifications]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(systemSettings));
    } catch {
      // Ignore quota exceeded
    }
  }, [systemSettings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(appUsers));
    } catch {
      // Ignore quota exceeded
    }
  }, [appUsers]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(auditLogs.slice(0, 200)));
    } catch {
      // Ignore quota exceeded
    }
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.currentUserId, currentUserId === null ? 'null' : currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, isSidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore storage error
    }
  }, [isSidebarCollapsed]);

  // Clear stale session ID if user no longer exists after user-list cleanup
  useEffect(() => {
    if (currentUserId && !appUsers.some((u) => u.id === currentUserId && u.status === 'Active')) {
      setCurrentUserId(null);
    }
  }, [currentUserId, appUsers]);

  // Sync HTML attributes for Dark/Light, RTL/LTR, and customized Org Title
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    root.lang = lang;
    document.title = brandingOrgName;
  }, [theme, lang, brandingOrgName]);

  const showToast = useCallback((type: ToastMessage['type'], text: string) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  const logAudit = useCallback(
    (action: string, details: string, category: AuditLogEntry['category'], targetEmployeeId?: string) => {
      const entry: AuditLogEntry = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        actor: currentUser?.name || 'System',
        actorId: currentUser?.id,
        targetEmployeeId,
        action,
        details,
        category,
      };
      setAuditLogs((prev) => [entry, ...prev.slice(0, 199)]);
    },
    [currentUser]
  );

  const playSoftChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.19);
    } catch {
      // Ignore audio block
    }
  }, []);

  const emitNotification = useCallback(
    (payload: NotificationEmitPayload, overrideCfg?: NotificationSettings) => {
      const cfg = overrideCfg || notifConfig;
      if (payload.type === 'request' && !cfg.notifyOnNewRequest) return;
      if (payload.type === 'status' && !cfg.notifyOnStatusChange) return;
      if (payload.type === 'substitute' && !cfg.notifyOnSubstituteConflict) return;

      const channels: Array<'app' | 'email' | 'browser'> = [];
      if (cfg.appEnabled) channels.push('app');
      if (cfg.emailEnabled && cfg.notificationEmail?.trim()) channels.push('email');
      if (cfg.browserEnabled) channels.push('browser');

      if (channels.length === 0) return;

      const entry: AppNotification = {
        id: generateId(),
        titleAr: payload.titleAr,
        titleEn: payload.titleEn,
        messageAr: payload.messageAr,
        messageEn: payload.messageEn,
        timestamp: new Date().toISOString(),
        read: false,
        type: payload.type,
        channels,
        emailTarget: cfg.emailEnabled ? cfg.notificationEmail : undefined,
        targetView: payload.targetView,
        targetSubTab: payload.targetSubTab,
      };

      if (cfg.appEnabled) {
        setNotifications((prev) => [entry, ...prev.slice(0, 59)]);
      }

      if (cfg.soundEnabled && cfg.appEnabled) {
        playSoftChime();
      }

      if (cfg.browserEnabled && typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          try {
            new Notification(lang === 'ar' ? payload.titleAr : payload.titleEn, {
              body: lang === 'ar' ? payload.messageAr : payload.messageEn,
            });
          } catch {
            // Ignore browser notification failure
          }
        }
      }

      if (cfg.emailEnabled && cfg.notificationEmail?.trim()) {
        showToast(
          'info',
          lang === 'ar'
            ? `تم إشعار البريد (${cfg.notificationEmail}): ${payload.titleAr}`
            : `Email alert queued (${cfg.notificationEmail}): ${payload.titleEn}`
        );
      }
    },
    [notifConfig, lang, playSoftChime, showToast]
  );

  const handleThemeChange = (nextTheme: ThemeOption) => {
    setSystemSettings((prev) => ({ ...prev, currentTheme: nextTheme }));
  };

  const handleLanguageChange = (nextLang: Language) => {
    setSystemSettings((prev) => ({ ...prev, language: nextLang }));
  };

  const addVacationsFromImport = (vacationsData: any[]) => {
    const imported: Vacation[] = vacationsData.map((v) => ({
      id: generateId(),
      employeeId: String(v.employeeId || ''),
      employeeName: String(v.employeeName || ''),
      startDate: String(v.startDate || ''),
      endDate: String(v.endDate || ''),
      days: Number(v.days) || 0,
      type: String(v.type || 'Annual'),
      substitute: String(v.substitute || ''),
      notes: String(v.notes || ''),
      status: (v.status || 'Approved') as Vacation['status'],
    }));
    setVacations((prev) => [...prev, ...imported]);
  };

  const handleUpdateVacationStatus = (id: string, status: Vacation['status'], reasonNote?: string) => {
    const target = vacations.find((v) => v.id === id);
    setVacations((prev) =>
      prev.map((v) => {
        if (v.id !== id) return v;
        const suffix = reasonNote ? `${v.notes ? '\n' : ''}[${status}]: ${reasonNote}` : '';
        return { ...v, status, notes: (v.notes || '') + suffix };
      })
    );
    if (target) {
      logAudit(
        lang === 'ar' ? `تحديث حالة إجازة (${status})` : `Leave Status -> ${status}`,
        target.employeeName,
        'vacation',
        target.employeeId
      );
      showToast('success', lang === 'ar' ? 'تم تحديث حالة الطلب.' : 'Leave request updated.');
      emitNotification({
        type: 'status',
        titleAr:
          status === 'Approved'
            ? 'اعتماد طلب إجازة'
            : status === 'Returned'
            ? 'إعادة إجازة للتعديل'
            : 'رفض طلب إجازة',
        titleEn:
          status === 'Approved'
            ? 'Leave Approved'
            : status === 'Returned'
            ? 'Leave Returned'
            : 'Leave Rejected',
        messageAr: `${target.employeeName} (${target.startDate} → ${target.endDate})`,
        messageEn: `${target.employeeName} (${target.startDate} → ${target.endDate})`,
        targetView: 'requests',
        targetSubTab: 'leaves',
      });
    }
  };

  const handleSubmitSubstituteException = useCallback(
    (req: SubstituteExceptionRequest) => {
      setSubstituteExceptions((prev) => [req, ...prev]);
      logAudit(
        lang === 'ar' ? 'تقديم طلب استثناء بديل' : 'Submitted Substitute Exception',
        `${req.employeeName} (${req.requestedDays}d · ${req.coveringForEmployeeName})`,
        'vacation',
        req.employeeId
      );
      showToast(
        'info',
        lang === 'ar'
          ? 'تم إرسال طلب الاستثناء للمدير للمراجعة والاعتماد.'
          : 'Substitute exception request sent to Manager for approval.'
      );
      emitNotification({
        type: 'substitute',
        titleAr: 'طلب استثناء موظف بديل',
        titleEn: 'Substitute Exception Request',
        messageAr: `${req.employeeName} يطلب استثناء لإجازة مدتها ${req.requestedDays} أيام عن فترة تغطيته لـ ${req.coveringForEmployeeName}.`,
        messageEn: `${req.employeeName} requested a ${req.requestedDays}-day leave exception while substituting for ${req.coveringForEmployeeName}.`,
        targetView: 'requests',
        targetSubTab: 'exceptions',
      });
    },
    [lang, logAudit, showToast, emitNotification]
  );

  const handleResolveSubstituteException = useCallback(
    (id: string, status: 'Approved' | 'Rejected') => {
      const target = substituteExceptions.find((e) => e.id === id);
      if (!target) return;
      setSubstituteExceptions((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                status,
                approvedBy: currentUser?.name || 'Manager',
                approvedAt: new Date().toISOString(),
              }
            : e
        )
      );
      logAudit(
        status === 'Approved'
          ? lang === 'ar'
            ? 'اعتماد استثناء بديل'
            : 'Approved Substitute Exception'
          : lang === 'ar'
          ? 'رفض استثناء بديل'
          : 'Rejected Substitute Exception',
        target.employeeName,
        'vacation',
        target.employeeId
      );
      showToast(
        status === 'Approved' ? 'success' : 'info',
        status === 'Approved'
          ? lang === 'ar'
            ? `تم اعتماد استثناء ${target.employeeName}. يمكنه الآن إدخال الإجازة.`
            : `Exception approved for ${target.employeeName}. Leave entry is now enabled.`
          : lang === 'ar'
          ? `تم رفض طلب استثناء ${target.employeeName}.`
          : `Exception rejected for ${target.employeeName}.`
      );
      emitNotification({
        type: 'substitute',
        titleAr: status === 'Approved' ? 'اعتماد استثناء البديل' : 'رفض استثناء البديل',
        titleEn: status === 'Approved' ? 'Substitute Exception Approved' : 'Substitute Exception Rejected',
        messageAr:
          status === 'Approved'
            ? `${target.employeeName}: تم اعتماد الاستثناء (${target.requestedDays} أيام) ويمكن إدخال الإجازة الآن.`
            : `${target.employeeName}: لم تتم الموافقة على الاستثناء.`,
        messageEn:
          status === 'Approved'
            ? `${target.employeeName}: Exception approved (${target.requestedDays} days); leave entry unlocked.`
            : `${target.employeeName}: Exception request rejected.`,
        targetView: 'requests',
        targetSubTab: status === 'Approved' ? 'leaves' : 'exceptions',
      });
    },
    [substituteExceptions, currentUser, lang, logAudit, showToast, emitNotification]
  );

  const handleMarkExceptionConsumed = useCallback((exceptionId: string, vacationId: string) => {
    setSubstituteExceptions((prev) =>
      prev.map((e) => (e.id === exceptionId ? { ...e, consumedVacationId: vacationId } : e))
    );
  }, []);

  const totalPendingRequests = useMemo(
    () =>
      vacations.filter((v) => v.status === 'Pending').length +
      exitPermissions.filter((e) => e.status === 'Pending').length +
      employeeRequests.filter((r) => r.status === 'Pending').length +
      substituteExceptions.filter((e) => e.status === 'Pending').length,
    [vacations, exitPermissions, employeeRequests, substituteExceptions]
  );

  const hasPerm = (perms: string[]) => perms.some((p) => currentUser?.permissions.includes(p));

  // Ordered Main Menu + Sub-Menus with Icons on ALL items & sub-items:
  const myRequestChildren: Array<{
    id: MyRequestsSubTab;
    label: string;
    icon: React.FC<{ size?: number; className?: string }>;
  }> = [
    { id: 'leave', label: t(lang, 'myRequestsSubLeave'), icon: FilePlus2 },
    { id: 'exit', label: t(lang, 'myRequestsSubExit'), icon: DoorOpen },
    { id: 'attendance', label: t(lang, 'myRequestsSubAttendance'), icon: Clock },
  ];

  const attendanceChildren: Array<{
    id: AttendanceHubSubTab;
    label: string;
    perms: string[];
    icon: React.FC<{ size?: number; className?: string }>;
  }> = [
    {
      id: 'sheet',
      label: t(lang, 'attendanceSubSheet'),
      perms: ['view_attendance_sheet', 'manage_attendance', 'view_attendance'],
      icon: FileSpreadsheet,
    },
    {
      id: 'violations',
      label: t(lang, 'attendanceSubViolations'),
      perms: ['view_violations', 'manage_violations'],
      icon: AlertTriangle,
    },
    {
      id: 'absences',
      label: t(lang, 'attendanceSubAbsences'),
      perms: ['view_absences', 'manage_absences'],
      icon: UserX,
    },
  ];

  const requestChildren: Array<{
    id: RequestsSubTab;
    label: string;
    icon: React.FC<{ size?: number; className?: string }>;
  }> = [
    { id: 'leaves', label: t(lang, 'subTabLeaves'), icon: CalendarCheck2 },
    { id: 'exit_permits', label: t(lang, 'subTabExitPermissions'), icon: DoorOpen },
    { id: 'calendar', label: t(lang, 'subTabCalendar'), icon: CalendarRange },
    { id: 'substitutes', label: t(lang, 'subTabSubstitutes'), icon: UserCheck },
    { id: 'exceptions', label: t(lang, 'subTabExceptions'), icon: ShieldCheck },
    { id: 'balances', label: t(lang, 'subTabBalances'), icon: Scale },
  ];

  const orgChildren: Array<{
    id: OrgSubTab;
    label: string;
    perms: string[];
    icon: React.FC<{ size?: number; className?: string }>;
  }> = [
    { id: 'departments', label: t(lang, 'orgSubDepts'), perms: ['view_org'], icon: Network },
    { id: 'employees', label: t(lang, 'orgSubEmployees'), perms: ['view_employees'], icon: Users },
  ];

  const settingsChildren: Array<{
    id: SettingsTab;
    label: string;
    perms: string[];
    icon: React.FC<{ size?: number; className?: string }>;
  }> = [
    { id: 'branding', label: t(lang, 'settingsTabBranding'), perms: ['manage_settings'], icon: Palette },
    { id: 'users', label: t(lang, 'settingsTabUsers'), perms: ['manage_users'], icon: Shield },
    {
      id: 'attendance_admin',
      label: t(lang, 'settingsTabAttendanceAdmin'),
      perms: ['manage_settings', 'manage_attendance'],
      icon: Clock,
    },
    { id: 'config', label: t(lang, 'settingsTabConfig'), perms: ['manage_settings'], icon: SlidersHorizontal },
    { id: 'holidays', label: t(lang, 'settingsTabHolidays'), perms: ['manage_settings'], icon: CalendarDays },
    { id: 'notifications', label: t(lang, 'settingsTabNotifications'), perms: ['manage_settings'], icon: Bell },
    { id: 'backup', label: t(lang, 'settingsTabBackup'), perms: ['manage_settings'], icon: Database },
    { id: 'audit', label: t(lang, 'settingsTabAudit'), perms: ['manage_settings'], icon: History },
  ];

  const getCurrentSubTabForView = (view: View): string | undefined => {
    if (view === 'my_requests') return myRequestsSubTab;
    if (view === 'attendance_hub') return attendanceSubTab;
    if (view === 'requests') return requestsSubTab;
    if (view === 'org') return orgSubTab;
    if (view === 'settings') return settingsTab;
    return undefined;
  };

  const applyViewNavigation = (
    view: View,
    nextSubTab?: string,
    recordHistory: boolean = true
  ) => {
    const prevSub = getCurrentSubTabForView(currentView);
    if (recordHistory && (currentView !== view || (nextSubTab && prevSub !== nextSubTab))) {
      setNavHistory((prev) => [...prev.slice(-19), { view: currentView, subTab: prevSub }]);
    }

    setCurrentView(view);

    if (view === 'my_requests') {
      setExpandedGroups((p) => ({ ...p, my_requests: true }));
      if (nextSubTab && myRequestChildren.some((c) => c.id === nextSubTab)) {
        setMyRequestsSubTab(nextSubTab as MyRequestsSubTab);
      }
    } else if (view === 'attendance_hub') {
      setExpandedGroups((p) => ({ ...p, attendance_hub: true }));
      const allowedAtt = attendanceChildren.filter((c) => hasPerm(c.perms));
      if (nextSubTab && allowedAtt.some((c) => c.id === nextSubTab)) {
        setAttendanceSubTab(nextSubTab as AttendanceHubSubTab);
      } else if (allowedAtt[0]) {
        setAttendanceSubTab(allowedAtt[0].id);
      }
    } else if (view === 'requests') {
      setExpandedGroups((p) => ({ ...p, requests: true }));
      if (nextSubTab) setRequestsSubTab(nextSubTab as RequestsSubTab);
    } else if (view === 'org') {
      setExpandedGroups((p) => ({ ...p, org: true }));
      const allowedOrg = orgChildren.filter((c) => hasPerm(c.perms));
      if (nextSubTab && allowedOrg.some((c) => c.id === nextSubTab)) {
        setOrgSubTab(nextSubTab as OrgSubTab);
      } else if (allowedOrg[0]) {
        setOrgSubTab(allowedOrg[0].id);
      }
    } else if (view === 'settings') {
      setExpandedGroups((p) => ({ ...p, settings: true }));
      const allowedSettings = settingsChildren.filter((c) => hasPerm(c.perms));
      if (nextSubTab && allowedSettings.some((c) => c.id === nextSubTab)) {
        setSettingsTab(nextSubTab as SettingsTab);
      } else if (allowedSettings[0]) {
        setSettingsTab(allowedSettings[0].id);
      }
    }
    setIsSidebarOpen(false);
  };

  const handleNavigate = (
    target: View | 'attendance' | 'violations' | 'absences',
    subTab?: string,
    recordHistory: boolean = true
  ) => {
    let view: View;
    let nextSubTab = subTab;

    if (target === 'attendance') {
      if (currentUser?.role !== 'Employee' && hasPerm(['view_attendance_sheet', 'manage_attendance'])) {
        view = 'attendance_hub';
        nextSubTab = subTab || 'sheet';
      } else {
        view = 'my_requests';
        nextSubTab = 'attendance';
      }
    } else if (target === 'violations') {
      view = 'attendance_hub';
      nextSubTab = subTab || 'violations';
    } else if (target === 'absences') {
      view = 'attendance_hub';
      nextSubTab = subTab || 'absences';
    } else {
      view = target;
    }

    applyViewNavigation(view, nextSubTab, recordHistory);
  };

  const handleGoBack = () => {
    if (navHistory.length > 0) {
      const prevEntry = navHistory[navHistory.length - 1];
      setNavHistory((prev) => prev.slice(0, -1));
      applyViewNavigation(prevEntry.view, prevEntry.subTab, false);
      return;
    }
    const defaultView = getDefaultViewForUser(currentUser);
    if (currentView !== defaultView) {
      applyViewNavigation(defaultView, undefined, false);
    }
  };

  const resolvedEmployeeIdForQuickRequest = useMemo(() => {
    if (!currentUser || currentUser.role !== 'Employee') return undefined;
    if (currentUser.linkedEmployeeId && employees.some((e) => e.id === currentUser.linkedEmployeeId)) {
      return currentUser.linkedEmployeeId;
    }
    const byEmail = employees.find(
      (e) => e.email && e.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()
    );
    return byEmail?.id || employees[0]?.id;
  }, [currentUser, employees]);

  const unresolvedAttendanceCount = useMemo(() => {
    const canManageAtt =
      currentUser?.role !== 'Employee' && Boolean(currentUser?.permissions.includes('manage_attendance'));
    const scopeRecords = canManageAtt
      ? attendanceRecords
      : resolvedEmployeeIdForQuickRequest
      ? attendanceRecords.filter((r) => r.employeeId === resolvedEmployeeIdForQuickRequest)
      : [];
    return scopeRecords.filter((rec) => {
      if (rec.violationType === 'None') return false;
      const synced = resolveSyncedRectification(rec, exitPermissions, vacations);
      return synced.status === 'Unresolved' || synced.status === 'Rejected';
    }).length;
  }, [attendanceRecords, currentUser, resolvedEmployeeIdForQuickRequest, exitPermissions, vacations]);

  const pendingViolationsCount = useMemo(
    () =>
      attendanceRecords.filter((rec) => {
        if (rec.violationType === 'None') return false;
        return resolveSyncedRectification(rec, exitPermissions, vacations).status === 'Pending';
      }).length,
    [attendanceRecords, exitPermissions, vacations]
  );

  const openAbsencesCount = useMemo(
    () => absenceRecords.filter((a) => a.status === 'Open').length,
    [absenceRecords]
  );

  const attendanceHubBadge =
    (hasPerm(['view_violations', 'manage_violations']) ? pendingViolationsCount : 0) +
    (hasPerm(['view_absences', 'manage_absences']) ? openAbsencesCount : 0);

  const navOrderItems: Array<{
    id: View;
    label: string;
    icon: React.FC<{ size?: number }>;
    perms: string[];
    badge?: number;
  }> = [
    { id: 'dashboard', label: t(lang, 'navDashboard'), icon: LayoutDashboard, perms: ['view_dashboard'] },
    {
      id: 'my_requests',
      label: t(lang, 'navMyRequests'),
      icon: ClipboardList,
      perms: ['view_my_requests'],
      badge: currentUser?.role === 'Employee' ? unresolvedAttendanceCount : undefined,
    },
    {
      id: 'attendance_hub',
      label: t(lang, 'navAttendanceHub'),
      icon: Clock,
      perms: [
        'view_attendance_sheet',
        'manage_attendance',
        'view_violations',
        'manage_violations',
        'view_absences',
        'manage_absences',
      ],
      badge: attendanceHubBadge,
    },
    {
      id: 'requests',
      label: t(lang, 'navRequests'),
      icon: Calendar,
      perms: ['view_vacations'],
      badge: totalPendingRequests,
    },
    { id: 'org', label: t(lang, 'navOrgStructure'), icon: Building2, perms: ['view_org', 'view_employees'] },
    { id: 'archive', label: t(lang, 'navArchive'), icon: Archive, perms: ['view_archive', 'manage_archive'] },
    {
      id: 'settings',
      label: t(lang, 'navSettings'),
      icon: Settings,
      perms: ['manage_settings', 'manage_users', 'manage_attendance'],
    },
    { id: 'audit', label: t(lang, 'navAuditLog'), icon: History, perms: ['view_audit', 'manage_settings'] },
    { id: 'ai', label: t(lang, 'navAI'), icon: BarChart3, perms: ['ai_insights'] },
  ];

  // Keep currentView restricted to pages permitted for the active user
  useEffect(() => {
    if (!currentUser) return;
    if (currentView === 'profile') return;
    const item = navOrderItems.find((n) => n.id === currentView);
    if (!item || !item.perms.some((p) => currentUser.permissions.includes(p))) {
      setCurrentView(getDefaultViewForUser(currentUser));
    }
  }, [currentUser, currentView]);

  const allowedNavItems = navOrderItems.filter((item) => hasPerm(item.perms));

  const activeParentLabel =
    currentView === 'profile'
      ? t(lang, 'profileTitle')
      : navOrderItems.find((n) => n.id === currentView)?.label || t(lang, 'navDashboard');
  const activeSubLabel =
    currentView === 'my_requests'
      ? myRequestChildren.find((c) => c.id === myRequestsSubTab)?.label
      : currentView === 'attendance_hub'
      ? attendanceChildren.find((c) => c.id === attendanceSubTab)?.label
      : currentView === 'requests'
      ? requestChildren.find((c) => c.id === requestsSubTab)?.label ||
        (requestsSubTab === 'hr_requests' ? t(lang, 'subTabEmployeeRequests') : undefined)
      : currentView === 'org'
      ? orgChildren.find((c) => c.id === orgSubTab)?.label
      : currentView === 'settings'
      ? settingsChildren.find((c) => c.id === settingsTab)?.label
      : undefined;

  const linkedEmployeeForProfile = useMemo(() => {
    if (!currentUser) return undefined;
    if (currentUser.linkedEmployeeId) {
      const byId = employees.find((e) => e.id === currentUser.linkedEmployeeId);
      if (byId) return byId;
    }
    const byEmail = employees.find(
      (e) => e.email && currentUser.email && e.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()
    );
    return byEmail;
  }, [currentUser, employees]);

  const populateProfileForm = useCallback(() => {
    if (!currentUser) return;
    setProfileName(linkedEmployeeForProfile?.fullName || currentUser.name);
    setProfileUsername(currentUser.username || '');
    setProfileEmail(currentUser.email || linkedEmployeeForProfile?.email || '');
    setProfilePhone(linkedEmployeeForProfile?.phone || '');
    setProfileAdminId(linkedEmployeeForProfile?.adminId || '');
    setProfileSerialNo(linkedEmployeeForProfile?.serialNo || '');
    setProfileJobTitle(linkedEmployeeForProfile?.jobTitle || '');
    setProfileDepartment(linkedEmployeeForProfile?.department || '');
    setProfileDirectManager(linkedEmployeeForProfile?.directManager || '');
    setProfileContractType(
      linkedEmployeeForProfile?.contractType || systemSettings.contractTypes[0]?.name || ''
    );
    setProfileHireDate(linkedEmployeeForProfile?.hireDate || '');
    setProfileLocation(linkedEmployeeForProfile?.location || '');
    setProfileAssignedWorkSiteId(linkedEmployeeForProfile?.assignedWorkSiteId || '');
    setProfileShiftMode(linkedEmployeeForProfile?.defaultShiftMode === 'flexible' ? 'flexible' : 'standard');
    setProfileStatus(linkedEmployeeForProfile?.status || 'على رأس عمله');
    setProfileNotes(linkedEmployeeForProfile?.notes || '');
    setProfileAvatar(currentUser.avatar || '');
    setProfilePassword('');
    setProfileConfirmPassword('');
    setProfileError('');
  }, [currentUser, linkedEmployeeForProfile, systemSettings.contractTypes]);

  useEffect(() => {
    if (currentView === 'profile') {
      populateProfileForm();
    }
  }, [currentView, populateProfileForm]);

  const openProfileView = () => {
    if (!currentUser) return;
    populateProfileForm();
    applyViewNavigation('profile');
  };

  const handleProfileAvatarUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setProfileAvatar(canvas.toDataURL('image/webp', 0.85));
        } else {
          setProfileAvatar(rawUrl);
        }
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const cleanName = profileName.trim();
    const cleanUsername = profileUsername.trim();
    const cleanEmail = profileEmail.trim();
    const cleanPhone = profilePhone.trim();
    const cleanAdminId = profileAdminId.trim();
    const cleanSerialNo = profileSerialNo.trim();
    const cleanJobTitle = profileJobTitle.trim();
    const cleanDepartment = profileDepartment.trim();
    const cleanDirectManager = profileDirectManager.trim();
    const cleanContractType = profileContractType.trim();
    const cleanHireDate = profileHireDate.trim();
    const cleanLocation = profileLocation.trim();
    const cleanNotes = profileNotes.trim();
    const cleanStatus = profileStatus.trim() || 'على رأس عمله';

    if (!cleanName || !cleanEmail) {
      setProfileError(
        lang === 'ar' ? 'الاسم الكامل والبريد الإلكتروني مطلوبان.' : 'Full name and email are required.'
      );
      return;
    }
    if (cleanUsername) {
      const dupUsername = appUsers.find(
        (u) =>
          u.id !== currentUser.id &&
          u.username &&
          u.username.trim().toLowerCase() === cleanUsername.toLowerCase()
      );
      if (dupUsername) {
        setProfileError(lang === 'ar' ? 'اسم المستخدم مسجل لحساب آخر.' : 'Username is already taken.');
        return;
      }
    }
    const dupEmail = appUsers.find(
      (u) => u.id !== currentUser.id && u.email.trim().toLowerCase() === cleanEmail.toLowerCase()
    );
    if (dupEmail) {
      setProfileError(lang === 'ar' ? 'البريد الإلكتروني مسجل لحساب آخر.' : 'Email is already taken.');
      return;
    }
    if (cleanAdminId) {
      const dupAdminId = employees.find(
        (emp) =>
          emp.id !== linkedEmployeeForProfile?.id &&
          emp.adminId &&
          emp.adminId.trim().toLowerCase() === cleanAdminId.toLowerCase()
      );
      if (dupAdminId) {
        setProfileError(
          lang === 'ar' ? 'الرقم الإداري مسجل لموظف آخر.' : 'Administrative ID is already assigned to another employee.'
        );
        return;
      }
    }
    if (profilePassword) {
      if (profilePassword.length < 4) {
        setProfileError(
          lang === 'ar' ? 'كلمة المرور يجب أن تكون ٤ أحرف على الأقل.' : 'Password must be at least 4 characters.'
        );
        return;
      }
      if (profilePassword !== profileConfirmPassword) {
        setProfileError(lang === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.');
        return;
      }
    }

    let resolvedLinkedEmployeeId = linkedEmployeeForProfile?.id || currentUser.linkedEmployeeId;

    if (linkedEmployeeForProfile) {
      setEmployees((prev) =>
        prev.map((emp) =>
          emp.id === linkedEmployeeForProfile.id
            ? {
                ...emp,
                fullName: cleanName,
                adminId: cleanAdminId || emp.adminId,
                serialNo: cleanSerialNo || undefined,
                phone: cleanPhone || undefined,
                email: cleanEmail,
                jobTitle: cleanJobTitle || emp.jobTitle,
                department: cleanDepartment || emp.department,
                directManager: cleanDirectManager || emp.directManager,
                contractType: cleanContractType || emp.contractType,
                hireDate: cleanHireDate || emp.hireDate,
                location: cleanLocation || emp.location,
                assignedWorkSiteId: profileAssignedWorkSiteId || undefined,
                defaultShiftMode: profileShiftMode,
                status: cleanStatus,
                notes: cleanNotes || undefined,
              }
            : emp
        )
      );
    } else if (
      cleanAdminId ||
      cleanPhone ||
      cleanJobTitle ||
      cleanDepartment ||
      cleanDirectManager ||
      cleanLocation
    ) {
      const newEmpId = generateId();
      resolvedLinkedEmployeeId = newEmpId;
      const newEmpRecord: Employee = {
        id: newEmpId,
        serialNo: cleanSerialNo || String(employees.length + 1),
        fullName: cleanName,
        adminId: cleanAdminId || `USR-${currentUser.id}`,
        jobTitle: cleanJobTitle || translateRole(currentUser.role, lang),
        contractType: cleanContractType || systemSettings.contractTypes[0]?.name || 'عقد محلي',
        hireDate: cleanHireDate || new Date().toISOString().slice(0, 10),
        location: cleanLocation || systemSettings.attendanceConfig?.approvedWorkSites?.[0] || '',
        assignedWorkSiteId: profileAssignedWorkSiteId || undefined,
        defaultShiftMode: profileShiftMode,
        department: cleanDepartment || orgUnits[0]?.name || '',
        directManager: cleanDirectManager || '',
        status: cleanStatus,
        phone: cleanPhone || undefined,
        email: cleanEmail,
        notes: cleanNotes || undefined,
      };
      setEmployees((prev) => [newEmpRecord, ...prev]);
    }

    setAppUsers((prev) =>
      prev.map((u) =>
        u.id === currentUser.id
          ? {
              ...u,
              name: cleanName,
              username: cleanUsername || u.username,
              email: cleanEmail,
              avatar: profileAvatar.trim() || undefined,
              password: profilePassword ? profilePassword : u.password,
              linkedEmployeeId: resolvedLinkedEmployeeId || u.linkedEmployeeId,
            }
          : u
      )
    );
    logAudit(
      lang === 'ar' ? 'تحديث الملف الشخصي' : 'Updated User Profile',
      `${cleanName}${cleanAdminId ? ` (${cleanAdminId})` : ''}${cleanUsername ? ` · @${cleanUsername}` : ''}`,
      'user'
    );
    showToast('success', lang === 'ar' ? 'تم حفظ جميع بيانات الملف الشخصي بنجاح.' : 'All profile data saved successfully.');
    setProfilePassword('');
    setProfileConfirmPassword('');
    setProfileError('');
  };

  // (resolvedEmployeeIdForQuickRequest defined above navOrderItems)

  // Split-Screen Login Page (Aligned Right in Arabic / Left in English)
  if (!currentUser) {
    return (
      <>
        <LoginPage
          users={appUsers}
          settings={systemSettings}
          lang={lang}
          theme={theme}
          onChangeLanguage={handleLanguageChange}
          onChangeTheme={handleThemeChange}
          onLoginSuccess={(user) => {
            setCurrentUserId(user.id);
            setAppUsers((prev) =>
              prev.map((u) => (u.id === user.id ? { ...u, lastLogin: new Date().toLocaleTimeString() } : u))
            );
            setCurrentView(getDefaultViewForUser(user));
            showToast('success', `${t(lang, 'welcomeBack')} ${user.name}`);
          }}
        />
        <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--text-main)] flex overflow-hidden">
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar (Supports Full Expanded & Collapsed Icon-Only Rail) */}
      <aside
        className={`no-print fixed inset-y-0 start-0 z-50 bg-[var(--sidebar-bg)] border-e border-[var(--border)] transform transition-all duration-200 flex flex-col md:relative md:translate-x-0 ${
          isSidebarCollapsed ? 'w-64 md:w-20' : 'w-64'
        } ${
          isSidebarOpen
            ? 'translate-x-0'
            : lang === 'ar'
            ? 'translate-x-full md:translate-x-0'
            : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Dynamic Brand Header + Collapse Control */}
        <div
          className={`px-3.5 py-4 border-b border-[var(--border)] flex items-center gap-2 ${
            isSidebarCollapsed ? 'md:flex-col md:justify-center' : 'justify-between'
          }`}
        >
          <div className={`flex items-center gap-3 min-w-0 ${isSidebarCollapsed ? 'md:justify-center' : ''}`}>
            <img
              src={brandingLogo}
              alt={brandingOrgName}
              className="w-10 h-10 rounded-lg object-cover border border-[var(--border)] shrink-0"
            />
            <div className={`min-w-0 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
              <h1 className="font-display font-bold text-sm text-[var(--text-main)] truncate">
                {brandingOrgName}
              </h1>
              <p className="text-[11px] text-[var(--text-muted)] truncate">{brandingOrgTitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              title={isSidebarCollapsed ? t(lang, 'expandSidebarLabel') : t(lang, 'collapseSidebarLabel')}
              aria-label={isSidebarCollapsed ? t(lang, 'expandSidebarLabel') : t(lang, 'collapseSidebarLabel')}
              className="hidden md:inline-flex items-center justify-center p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:border-[var(--primary)] transition-colors cursor-pointer"
            >
              {lang === 'ar' ? (
                isSidebarCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />
              ) : isSidebarCollapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden p-1 text-[var(--text-muted)] hover:text-[var(--text-main)]"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Ordered Navigation Links with Icons on ALL Items & Sub-Menus */}
        <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto">
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            const isGroup =
              item.id === 'my_requests' ||
              item.id === 'attendance_hub' ||
              item.id === 'requests' ||
              item.id === 'org' ||
              item.id === 'settings';

            const groupChildren: Array<{
              id: string;
              label: string;
              icon: React.FC<{ size?: number; className?: string }>;
            }> =
              item.id === 'my_requests'
                ? myRequestChildren
                : item.id === 'attendance_hub'
                ? attendanceChildren.filter((c) => hasPerm(c.perms))
                : item.id === 'requests'
                ? requestChildren
                : item.id === 'org'
                ? orgChildren.filter((c) => hasPerm(c.perms))
                : item.id === 'settings'
                ? settingsChildren.filter((c) => hasPerm(c.perms))
                : [];

            const hasChildren = isGroup && groupChildren.length > 0;
            const isExpanded =
              item.id === 'my_requests'
                ? expandedGroups.my_requests
                : item.id === 'attendance_hub'
                ? expandedGroups.attendance_hub
                : item.id === 'requests'
                ? expandedGroups.requests
                : item.id === 'org'
                ? expandedGroups.org
                : item.id === 'settings'
                ? expandedGroups.settings
                : false;

            const activeGroupSubId =
              item.id === 'my_requests'
                ? myRequestsSubTab
                : item.id === 'attendance_hub'
                ? attendanceSubTab
                : item.id === 'requests'
                ? requestsSubTab
                : item.id === 'org'
                ? orgSubTab
                : item.id === 'settings'
                ? settingsTab
                : '';

            return (
              <div key={item.id} className="space-y-1">
                <button
                  type="button"
                  title={item.label}
                  onClick={() => {
                    if (isGroup) {
                      if (currentView === item.id && !isSidebarCollapsed) {
                        setExpandedGroups((p) => ({
                          ...p,
                          [item.id]: !p[item.id as keyof typeof p],
                        }));
                      } else {
                        handleNavigate(item.id);
                      }
                    } else {
                      handleNavigate(item.id);
                    }
                  }}
                  className={`relative w-full flex items-center gap-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSidebarCollapsed
                      ? 'md:justify-center md:px-2 px-3.5 py-2.5 justify-between'
                      : 'justify-between px-3.5 py-2.5'
                  } ${
                    isActive
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)] font-semibold'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <span className={`flex items-center gap-3 min-w-0 ${isSidebarCollapsed ? 'md:justify-center' : ''}`}>
                    <Icon size={18} />
                    <span className={`truncate ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
                  </span>
                  {item.badge !== undefined && item.badge > 0 && isSidebarCollapsed && (
                    <span className="hidden md:inline-block absolute top-1.5 end-1.5 w-2 h-2 rounded-full bg-[var(--status-danger-text)]" />
                  )}
                  <span className={`inline-flex items-center gap-1.5 shrink-0 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span
                        className={`font-mono-tabular text-xs px-1.5 py-0.5 rounded ${
                          isActive
                            ? 'bg-black/20 text-[var(--primary-fg)]'
                            : 'bg-[var(--primary-soft)] text-[var(--primary-text)]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                    {hasChildren && (
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    )}
                  </span>
                </button>

                {hasChildren && isExpanded && (
                  <div
                    className={`space-y-0.5 py-0.5 ${
                      isSidebarCollapsed
                        ? 'ps-4 ms-4 border-s border-[var(--border)] md:ps-0 md:ms-0 md:border-s-0 md:flex md:flex-col md:items-center'
                        : 'ps-4 ms-4 border-s border-[var(--border)]'
                    }`}
                  >
                    {groupChildren.map((child) => {
                      const ChildIcon = child.icon;
                      const subActive = currentView === item.id && activeGroupSubId === child.id;
                      return (
                        <button
                          key={child.id}
                          type="button"
                          title={child.label}
                          onClick={() => handleNavigate(item.id, child.id)}
                          className={`flex items-center gap-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                            isSidebarCollapsed
                              ? 'w-full px-3 py-1.5 text-start md:w-10 md:h-8 md:p-0 md:justify-center'
                              : 'w-full px-3 py-1.5 text-start'
                          } ${
                            subActive
                              ? 'bg-[var(--primary-soft)] text-[var(--primary-text)] font-semibold'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--surface-subtle)]'
                          }`}
                        >
                          <ChildIcon size={14} className="shrink-0" />
                          <span className={`truncate ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{child.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer: Logout Only */}
        <div className="p-2.5 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => setCurrentUserId(null)}
            title={t(lang, 'logout')}
            className={`w-full flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] hover:border-[var(--status-danger-text)]/35 transition-colors cursor-pointer ${
              isSidebarCollapsed ? 'px-3 py-2.5 md:p-2.5 md:justify-center justify-center' : 'px-3.5 py-2.5 justify-center'
            }`}
          >
            <LogOut size={16} className="shrink-0" />
            <span className={isSidebarCollapsed ? 'md:hidden' : ''}>{t(lang, 'logout')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        {/* Top Bar Contract */}
        <header className="no-print h-14 bg-[var(--card-bg)] border-b border-[var(--border)] px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-main)]"
            >
              <Menu size={18} />
            </button>
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              title={isSidebarCollapsed ? t(lang, 'expandSidebarLabel') : t(lang, 'collapseSidebarLabel')}
              aria-label={isSidebarCollapsed ? t(lang, 'expandSidebarLabel') : t(lang, 'collapseSidebarLabel')}
              className="hidden md:inline-flex items-center justify-center p-1.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:border-[var(--primary)] transition-colors shrink-0 cursor-pointer"
            >
              {lang === 'ar' ? (
                isSidebarCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />
              ) : isSidebarCollapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
            {(navHistory.length > 0 || currentView !== getDefaultViewForUser(currentUser)) && (
              <button
                type="button"
                onClick={handleGoBack}
                title={lang === 'ar' ? 'العودة للصفحة السابقة' : 'Go back'}
                aria-label={lang === 'ar' ? 'العودة للصفحة السابقة' : 'Go back'}
                className="inline-flex items-center justify-center p-1.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:border-[var(--primary)] transition-colors shrink-0 cursor-pointer"
              >
                {lang === 'ar' ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}
              </button>
            )}
            <nav
              aria-label={lang === 'ar' ? 'مسار التنقل والعودة' : 'Breadcrumb'}
              className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] truncate"
            >
              <button
                type="button"
                onClick={() => handleNavigate(getDefaultViewForUser(currentUser))}
                title={lang === 'ar' ? 'العودة إلى الرئيسية' : 'Return to Home'}
                className="font-semibold text-[var(--text-main)] hover:text-[var(--primary-text)] hover:underline whitespace-nowrap cursor-pointer transition-colors"
              >
                {brandingOrgName}
              </button>
              <span aria-hidden="true">/</span>
              <button
                type="button"
                onClick={() => {
                  if (currentView === 'profile') {
                    handleGoBack();
                  } else {
                    handleNavigate(currentView);
                  }
                }}
                title={
                  currentView === 'profile'
                    ? lang === 'ar'
                      ? 'العودة للخلف'
                      : 'Go back'
                    : activeSubLabel
                    ? lang === 'ar'
                      ? `العودة إلى ${activeParentLabel}`
                      : `Return to ${activeParentLabel}`
                    : activeParentLabel
                }
                className={`whitespace-nowrap cursor-pointer transition-colors ${
                  activeSubLabel
                    ? 'text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:underline font-medium'
                    : 'text-[var(--primary-text)] hover:underline font-semibold'
                }`}
              >
                {activeParentLabel}
              </button>
              {activeSubLabel && (
                <>
                  <span aria-hidden="true">/</span>
                  <button
                    type="button"
                    onClick={handleGoBack}
                    title={lang === 'ar' ? 'العودة للخطوة السابقة' : 'Return to previous screen'}
                    className="text-[var(--primary-text)] hover:underline font-semibold whitespace-nowrap cursor-pointer transition-colors"
                  >
                    {activeSubLabel}
                  </button>
                </>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Global Quick Request Trigger */}
            <button
              type="button"
              onClick={() => setIsQuickRequestOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Zap size={14} />
              <span>{t(lang, 'quickRequestBtn')}</span>
            </button>

            {/* Header Notifications Center */}
            <NotificationsPopover
              notifications={notifications}
              notificationSettings={notifConfig}
              lang={lang}
              canOpenSettings={currentUser.permissions.includes('manage_settings')}
              onMarkAsRead={(id) =>
                setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
              }
              onMarkAllRead={() =>
                setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
              }
              onClearRead={() =>
                setNotifications((prev) => prev.filter((n) => !n.read))
              }
              onNavigateFromNotification={(notif) => {
                if (notif.targetView) {
                  if (notif.targetView === 'attendance') {
                    if (hasPerm(['view_attendance_sheet', 'manage_attendance']) && currentUser.role !== 'Employee') {
                      handleNavigate('attendance_hub', 'sheet');
                    } else if (hasPerm(['view_my_requests'])) {
                      handleNavigate('my_requests', 'attendance');
                    }
                    return;
                  }
                  if (notif.targetView === 'violations') {
                    if (hasPerm(['view_violations', 'manage_violations'])) {
                      handleNavigate('attendance_hub', 'violations');
                    } else if (hasPerm(['view_my_requests'])) {
                      handleNavigate('my_requests', 'attendance');
                    }
                    return;
                  }
                  if (notif.targetView === 'absences') {
                    if (hasPerm(['view_absences', 'manage_absences'])) {
                      handleNavigate('attendance_hub', 'absences');
                    }
                    return;
                  }
                  const navDef = navOrderItems.find((n) => n.id === notif.targetView);
                  if (navDef && hasPerm(navDef.perms)) {
                    handleNavigate(notif.targetView as View, notif.targetSubTab);
                  } else if (hasPerm(['view_my_requests'])) {
                    handleNavigate('my_requests');
                  }
                }
              }}
              onOpenNotificationSettings={() => {
                handleNavigate('settings', 'notifications');
              }}
            />

            <button
              type="button"
              onClick={() => handleLanguageChange(lang === 'ar' ? 'en' : 'ar')}
              title={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
              aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--primary)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>{t(lang, 'switchLang')}</span>
              <Globe size={14} className="text-[var(--primary-text)]" />
            </button>

            <button
              type="button"
              onClick={() => handleThemeChange(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? t(lang, 'lightMode') : t(lang, 'darkMode')}
              title={theme === 'dark' ? t(lang, 'lightMode') : t(lang, 'darkMode')}
              className="inline-flex items-center justify-center p-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-[var(--text-main)] hover:border-[var(--primary)] transition-colors shrink-0 cursor-pointer"
            >
              {theme === 'dark' ? (
                <Sun size={15} className="text-[var(--primary-text)]" />
              ) : (
                <Moon size={15} className="text-[var(--primary-text)]" />
              )}
            </button>

            {/* User Profile Button */}
            <button
              type="button"
              onClick={openProfileView}
              title={t(lang, 'profileTitle')}
              aria-label={t(lang, 'profileTitle')}
              className={`inline-flex items-center gap-2 ps-1.5 pe-2.5 py-1 rounded-lg border transition-colors shrink-0 cursor-pointer ${
                currentView === 'profile'
                  ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-text)]'
                  : 'border-[var(--border)] bg-[var(--app-bg)] hover:border-[var(--primary)]'
              }`}
            >
              <AvatarWithFallback src={currentUser.avatar} name={currentUser.name} sizeClass="w-6 h-6" />
              <span className="hidden sm:inline text-xs font-semibold max-w-[120px] truncate">
                {currentUser.name}
              </span>
            </button>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-[1380px] mx-auto">
            {currentView === 'dashboard' && hasPerm(['view_dashboard']) && (
              <Dashboard
                employees={employees}
                vacations={vacations}
                exitPermissions={exitPermissions}
                employeeRequests={employeeRequests}
                substituteExceptions={substituteExceptions}
                attendanceRecords={attendanceRecords}
                absenceRecords={absenceRecords}
                orgUnits={orgUnits}
                settings={systemSettings}
                lang={lang}
                currentUser={currentUser}
                onUpdateVacationStatus={handleUpdateVacationStatus}
                onResolveSubstituteException={handleResolveSubstituteException}
                onOpenQuickRequest={() => setIsQuickRequestOpen(true)}
                onNavigate={(view, subTab) => handleNavigate(view, subTab)}
              />
            )}

            {currentView === 'my_requests' && hasPerm(['view_my_requests']) && (
              <MyRequestsView
                currentUser={currentUser}
                employees={employees}
                vacations={vacations}
                setVacations={setVacations}
                exitPermissions={exitPermissions}
                setExitPermissions={setExitPermissions}
                employeeRequests={employeeRequests}
                setEmployeeRequests={setEmployeeRequests}
                substituteExceptions={substituteExceptions}
                setSubstituteExceptions={setSubstituteExceptions}
                onSubmitSubstituteException={handleSubmitSubstituteException}
                onMarkExceptionConsumed={handleMarkExceptionConsumed}
                attendanceRecords={attendanceRecords}
                setAttendanceRecords={setAttendanceRecords}
                orgUnits={orgUnits}
                settings={systemSettings}
                lang={lang}
                activeSubTab={myRequestsSubTab}
                onChangeSubTab={(tab) => handleNavigate('my_requests', tab)}
                onLogAudit={(action, details, cat) =>
                  logAudit(action, details, cat, resolvedEmployeeIdForQuickRequest)
                }
                onLogAttendanceAudit={(action, details, cat, targetEmpId) =>
                  logAudit(action, details, cat, targetEmpId)
                }
                onToast={showToast}
                onNotify={(payload) => emitNotification(payload)}
              />
            )}

            {currentView === 'attendance_hub' &&
              hasPerm([
                'view_attendance_sheet',
                'manage_attendance',
                'view_violations',
                'manage_violations',
                'view_absences',
                'manage_absences',
              ]) && (
                <AttendanceHub
                  attendanceRecords={attendanceRecords}
                  setAttendanceRecords={setAttendanceRecords}
                  absenceRecords={absenceRecords}
                  setAbsenceRecords={setAbsenceRecords}
                  employees={employees}
                  orgUnits={orgUnits}
                  vacations={vacations}
                  setVacations={setVacations}
                  exitPermissions={exitPermissions}
                  setExitPermissions={setExitPermissions}
                  substituteExceptions={substituteExceptions}
                  onSubmitSubstituteException={handleSubmitSubstituteException}
                  onMarkExceptionConsumed={handleMarkExceptionConsumed}
                  settings={systemSettings}
                  lang={lang}
                  currentUser={currentUser}
                  activeSubTab={attendanceSubTab}
                  onChangeSubTab={(tab) => handleNavigate('attendance_hub', tab)}
                  onLogAudit={(action, details, cat, targetEmpId) =>
                    logAudit(action, details, cat, targetEmpId)
                  }
                  onToast={showToast}
                  onNotify={(payload) => emitNotification(payload)}
                />
              )}

            {currentView === 'requests' && hasPerm(['view_vacations']) && (
              <RequestsHub
                vacations={vacations}
                setVacations={setVacations}
                exitPermissions={exitPermissions}
                setExitPermissions={setExitPermissions}
                employeeRequests={employeeRequests}
                setEmployeeRequests={setEmployeeRequests}
                substituteExceptions={substituteExceptions}
                setSubstituteExceptions={setSubstituteExceptions}
                onSubmitSubstituteException={handleSubmitSubstituteException}
                onResolveSubstituteException={handleResolveSubstituteException}
                onMarkExceptionConsumed={handleMarkExceptionConsumed}
                employees={employees}
                settings={systemSettings}
                lang={lang}
                currentUser={currentUser}
                preselectedEmployeeId={preselectedEmpForLeave}
                onClearPreselectedEmployee={() => setPreselectedEmpForLeave(null)}
                activeSubTab={requestsSubTab}
                onChangeSubTab={(tab) => handleNavigate('requests', tab)}
                onLogAudit={(action, details, cat) => logAudit(action, details, cat)}
                onToast={showToast}
                onNotify={(payload) => emitNotification(payload)}
              />
            )}

            {currentView === 'org' && (hasPerm(['view_org', 'view_employees'])) && (
              <OrgHub
                activeSubTab={orgSubTab}
                onChangeSubTab={(tab) => handleNavigate('org', tab)}
                orgUnits={orgUnits}
                setOrgUnits={setOrgUnits}
                employees={employees}
                setEmployees={setEmployees}
                addVacationsFromImport={addVacationsFromImport}
                vacations={vacations}
                settings={systemSettings}
                lang={lang}
                currentUser={currentUser}
                onLogAudit={(action, details, cat) => logAudit(action, details, cat)}
                onToast={showToast}
                onLoadDemoData={() => {
                  setEmployees(SAMPLE_EMPLOYEES);
                  setVacations(SAMPLE_VACATIONS);
                  setOrgUnits(DEFAULT_ORG_UNITS);
                  setExitPermissions(SAMPLE_EXIT_PERMISSIONS);
                  setEmployeeRequests(SAMPLE_EMPLOYEE_REQUESTS);
                  setSubstituteExceptions(SAMPLE_SUBSTITUTE_EXCEPTIONS);
                  setAttendanceRecords(SAMPLE_ATTENDANCE_RECORDS);
                  setAbsenceRecords(SAMPLE_ABSENCES);
                  setArchiveRecords(SAMPLE_ARCHIVE_RECORDS);
                  showToast('success', lang === 'ar' ? 'تم تحميل البيانات التجريبية.' : 'Demo data loaded.');
                }}
                onOpenNewLeaveForEmployee={(empId) => {
                  setPreselectedEmpForLeave(empId);
                  handleNavigate('requests', 'leaves');
                }}
              />
            )}

            {currentView === 'archive' && hasPerm(['view_archive', 'manage_archive']) && (
              <ArchiveView
                archiveRecords={archiveRecords}
                setArchiveRecords={setArchiveRecords}
                employees={employees}
                vacations={vacations}
                exitPermissions={exitPermissions}
                employeeRequests={employeeRequests}
                attendanceRecords={attendanceRecords}
                lang={lang}
                currentUser={currentUser}
                onLogAudit={(action, details, cat, targetEmpId) => logAudit(action, details, cat, targetEmpId)}
                onToast={showToast}
              />
            )}

            {currentView === 'settings' &&
              (currentUser.permissions.includes('manage_settings') ||
                currentUser.permissions.includes('manage_users') ||
                currentUser.permissions.includes('manage_attendance')) && (
                <SettingsAndAuditView
                  settings={systemSettings}
                  setSettings={setSystemSettings}
                  employees={employees}
                  setEmployees={setEmployees}
                  vacations={vacations}
                  setVacations={setVacations}
                  orgUnits={orgUnits}
                  setOrgUnits={setOrgUnits}
                  exitPermissions={exitPermissions}
                  setExitPermissions={setExitPermissions}
                  employeeRequests={employeeRequests}
                  setEmployeeRequests={setEmployeeRequests}
                  substituteExceptions={substituteExceptions}
                  setSubstituteExceptions={setSubstituteExceptions}
                  attendanceRecords={attendanceRecords}
                  setAttendanceRecords={setAttendanceRecords}
                  absenceRecords={absenceRecords}
                  setAbsenceRecords={setAbsenceRecords}
                  archiveRecords={archiveRecords}
                  setArchiveRecords={setArchiveRecords}
                  users={appUsers}
                  setUsers={setAppUsers}
                  currentUser={currentUser}
                  auditLogs={auditLogs}
                  lang={lang}
                  activeTab={settingsTab}
                  onChangeTab={(tab) => handleNavigate('settings', tab)}
                  onChangeLanguage={handleLanguageChange}
                  onChangeTheme={handleThemeChange}
                  onLogAudit={(action, details, cat) => logAudit(action, details, cat)}
                  onToast={showToast}
                  onSendTestNotification={(cfg) => {
                    emitNotification(
                      {
                        type: 'system',
                        titleAr: 'إشعار تجريبي للنظام',
                        titleEn: 'System Test Notification',
                        messageAr: `تم التحقق بنجاح من قنوات التنبيه (${cfg.appEnabled ? 'التطبيق ' : ''}${
                          cfg.emailEnabled ? `· البريد: ${cfg.notificationEmail}` : ''
                        }).`,
                        messageEn: `Notification channels verified (${cfg.appEnabled ? 'App ' : ''}${
                          cfg.emailEnabled ? `· Email: ${cfg.notificationEmail}` : ''
                        }).`,
                        targetView: 'settings',
                      },
                      cfg
                    );
                    showToast('success', lang === 'ar' ? 'تم إرسال الإشعار التجريبي.' : 'Test notification dispatched.');
                  }}
                  onRestoreDemoData={() => {
                    setEmployees(SAMPLE_EMPLOYEES);
                    setVacations(SAMPLE_VACATIONS);
                    setOrgUnits(DEFAULT_ORG_UNITS);
                    setExitPermissions(SAMPLE_EXIT_PERMISSIONS);
                    setEmployeeRequests(SAMPLE_EMPLOYEE_REQUESTS);
                    setSubstituteExceptions(SAMPLE_SUBSTITUTE_EXCEPTIONS);
                    setAttendanceRecords(SAMPLE_ATTENDANCE_RECORDS);
                    setAbsenceRecords(SAMPLE_ABSENCES);
                    setArchiveRecords(SAMPLE_ARCHIVE_RECORDS);
                    setNotifications(INITIAL_NOTIFICATIONS);
                    setSystemSettings((prev) => ({
                      ...DEFAULT_SETTINGS,
                      currentTheme: prev.currentTheme,
                      language: prev.language,
                    }));
                    logAudit(lang === 'ar' ? 'استعادة البيانات التجريبية' : 'Restored Demo Dataset', 'Reset', 'system');
                    showToast('success', lang === 'ar' ? 'تمت استعادة البيانات التجريبية.' : 'Demo dataset restored.');
                  }}
                  onClearAllData={() => {
                    setEmployees([]);
                    setVacations([]);
                    setExitPermissions([]);
                    setEmployeeRequests([]);
                    setSubstituteExceptions([]);
                    setAttendanceRecords([]);
                    setAbsenceRecords([]);
                    setArchiveRecords([]);
                    setNotifications([]);
                    logAudit(lang === 'ar' ? 'تفريغ كافة السجلات' : 'Cleared All Records', 'Empty state', 'system');
                    showToast('info', lang === 'ar' ? 'تم تفريغ جميع السجلات.' : 'All records cleared.');
                  }}
                />
              )}

            {currentView === 'audit' && hasPerm(['view_audit', 'manage_settings']) && (
              <AuditLogPanel
                auditLogs={auditLogs}
                lang={lang}
                currentUser={currentUser}
                employees={employees}
                settings={systemSettings}
              />
            )}

            {currentView === 'ai' && hasPerm(['ai_insights']) && (
              <AIAssistantView
                employees={employees}
                vacations={vacations}
                settings={systemSettings}
                lang={lang}
              />
            )}

            {currentView === 'profile' && (
              <div className="space-y-6 text-[var(--text-main)]">
                {/* Profile Page Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-[var(--primary-soft)] text-[var(--primary-text)]">
                      <UserCircle size={24} />
                    </div>
                    <div>
                      <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">
                        {t(lang, 'profileTitle')}
                      </h2>
                      <p className="text-xs text-[var(--text-muted)]">
                        {lang === 'ar'
                          ? 'عرض وتعديل كافة البيانات الشخصية والوظيفية، الأرقام الإدارية، موقع العمل، وكلمة المرور'
                          : 'View and edit all personal, job, administrative ID, work site, and password details'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGoBack}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer"
                    >
                      {lang === 'ar' ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
                      <span>{lang === 'ar' ? 'العودة' : 'Back'}</span>
                    </button>
                    <button
                      type="submit"
                      form="profile-full-form"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors cursor-pointer shadow-sm"
                    >
                      <Save size={14} />
                      <span>{lang === 'ar' ? 'حفظ البيانات' : 'Save Profile'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentUserId(null)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--status-danger-text)]/30 bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                    >
                      <LogOut size={14} />
                      <span>{t(lang, 'logout')}</span>
                    </button>
                  </div>
                </div>

                {/* Identity Summary & Avatar Card */}
                <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <AvatarWithFallback
                      src={profileAvatar || currentUser.avatar}
                      name={profileName || currentUser.name}
                      sizeClass="w-20 h-20"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display font-bold text-xl text-[var(--text-main)] truncate">
                          {profileName || currentUser.name}
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[var(--primary-soft)] text-[var(--primary-text)]">
                          {translateRole(currentUser.role, lang)}
                        </span>
                        {linkedEmployeeForProfile?.biometricExempt && (
                          <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[var(--status-success-bg)] text-[var(--status-success-text)]">
                            {lang === 'ar' ? 'معفى من البصمة' : 'Biometric Exempt'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] font-mono-tabular mt-1 truncate">
                        {profileAdminId ? `${lang === 'ar' ? 'الرقم الإداري' : 'ID'}: ${profileAdminId} · ` : ''}
                        {profileUsername ? `@${profileUsername} · ` : ''}
                        {profileEmail || currentUser.email}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-[var(--text-muted)]">
                        {profileJobTitle && <span>{profileJobTitle}</span>}
                        {profileDepartment && <span>· {profileDepartment}</span>}
                        {currentUser.lastLogin && (
                          <span>
                            · {lang === 'ar' ? `آخر دخول: ${currentUser.lastLogin}` : `Last login: ${currentUser.lastLogin}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer">
                      <Upload size={14} />
                      <span>{t(lang, 'uploadAvatarBtn')}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleProfileAvatarUpload(f);
                        }}
                      />
                    </label>
                    {profileAvatar && (
                      <button
                        type="button"
                        onClick={() => setProfileAvatar('')}
                        className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                      >
                        {lang === 'ar' ? 'إزالة الصورة' : 'Remove photo'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Full Editable Profile Form */}
                <form id="profile-full-form" onSubmit={handleSaveProfile} className="space-y-5">
                  {profileError && (
                    <div className="p-3.5 rounded-xl bg-[var(--status-danger-bg)] border border-[var(--status-danger-text)]/30 text-[var(--status-danger-text)] text-xs font-medium">
                      {profileError}
                    </div>
                  )}

                  {/* Section 1: Personal & Account Information */}
                  <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
                    <h4 className="font-display font-bold text-base text-[var(--text-main)] flex items-center gap-2">
                      <UserCircle size={18} className="text-[var(--primary-text)]" />
                      <span>{lang === 'ar' ? 'البيانات الشخصية وبيانات الدخول' : 'Personal & Account Information'}</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'الاسم الكامل' : 'Full Name'} *
                        </label>
                        <input
                          type="text"
                          required
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'usernameLabel')}
                        </label>
                        <input
                          type="text"
                          value={profileUsername}
                          onChange={(e) => setProfileUsername(e.target.value)}
                          dir="ltr"
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'email')} *
                        </label>
                        <input
                          type="email"
                          required
                          value={profileEmail}
                          onChange={(e) => setProfileEmail(e.target.value)}
                          dir="ltr"
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1 flex items-center gap-1">
                          <Phone size={12} />
                          <span>{lang === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</span>
                        </label>
                        <input
                          type="tel"
                          value={profilePhone}
                          onChange={(e) => setProfilePhone(e.target.value)}
                          dir="ltr"
                          placeholder="+218..."
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1 flex items-center gap-1">
                          <Hash size={12} />
                          <span>{lang === 'ar' ? 'الرقم الإداري' : 'Administrative ID'}</span>
                        </label>
                        <input
                          type="text"
                          value={profileAdminId}
                          onChange={(e) => setProfileAdminId(e.target.value)}
                          dir="ltr"
                          placeholder="EMP-001"
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1 flex items-center gap-1">
                          <Hash size={12} />
                          <span>{lang === 'ar' ? 'الرقم التسلسلي' : 'Serial No.'}</span>
                        </label>
                        <input
                          type="text"
                          value={profileSerialNo}
                          onChange={(e) => setProfileSerialNo(e.target.value)}
                          dir="ltr"
                          placeholder="1"
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Employment & Organizational Details */}
                  <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
                    <h4 className="font-display font-bold text-base text-[var(--text-main)] flex items-center gap-2">
                      <Briefcase size={18} className="text-[var(--primary-text)]" />
                      <span>{lang === 'ar' ? 'البيانات الوظيفية والتنظيمية' : 'Employment & Organizational Details'}</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'المسمى الوظيفي' : 'Job Title'}
                        </label>
                        <input
                          type="text"
                          value={profileJobTitle}
                          onChange={(e) => setProfileJobTitle(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'الإدارة / القسم' : 'Department / Division'}
                        </label>
                        <select
                          value={profileDepartment}
                          onChange={(e) => setProfileDepartment(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        >
                          <option value="">{lang === 'ar' ? '-- اختر الإدارة / القسم --' : '-- Select Department --'}</option>
                          {orgUnits.map((unit) => (
                            <option key={unit.id} value={unit.name}>
                              {unit.name}
                            </option>
                          ))}
                          {profileDepartment && !orgUnits.some((u) => u.name === profileDepartment) && (
                            <option value={profileDepartment}>{profileDepartment}</option>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'المسؤول المباشر' : 'Direct Manager'}
                        </label>
                        <input
                          type="text"
                          value={profileDirectManager}
                          onChange={(e) => setProfileDirectManager(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'نوع التعاقد' : 'Contract Type'}
                        </label>
                        <select
                          value={profileContractType}
                          onChange={(e) => setProfileContractType(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        >
                          <option value="">{lang === 'ar' ? '-- اختر نوع التعاقد --' : '-- Select Contract Type --'}</option>
                          {systemSettings.contractTypes.map((ct) => (
                            <option key={ct.id} value={ct.name}>
                              {ct.name}
                            </option>
                          ))}
                          {profileContractType && !systemSettings.contractTypes.some((c) => c.name === profileContractType) && (
                            <option value={profileContractType}>{profileContractType}</option>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'تاريخ التعيين' : 'Hire Date'}
                        </label>
                        <input
                          type="date"
                          value={profileHireDate}
                          onChange={(e) => setProfileHireDate(e.target.value)}
                          dir="ltr"
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'الحالة الوظيفية' : 'Employment Status'}
                        </label>
                        <select
                          value={profileStatus}
                          onChange={(e) => setProfileStatus(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        >
                          <option value="على رأس عمله">{lang === 'ar' ? 'على رأس عمله' : 'Active'}</option>
                          <option value="إجازة">{lang === 'ar' ? 'إجازة' : 'On Leave'}</option>
                          <option value="موقوف">{lang === 'ar' ? 'موقوف' : 'Suspended'}</option>
                          <option value="منتهي">{lang === 'ar' ? 'منتهي' : 'Terminated'}</option>
                          {profileStatus &&
                            !['على رأس عمله', 'إجازة', 'موقوف', 'منتهي'].includes(profileStatus) && (
                              <option value={profileStatus}>{profileStatus}</option>
                            )}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Work Site, Attendance & Notes */}
                  <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
                    <h4 className="font-display font-bold text-base text-[var(--text-main)] flex items-center gap-2">
                      <MapPin size={18} className="text-[var(--primary-text)]" />
                      <span>{lang === 'ar' ? 'موقع العمل والحضور والملاحظات' : 'Work Site, Attendance & Notes'}</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'assignedWorkSiteLabel')}
                        </label>
                        <select
                          value={profileLocation}
                          onChange={(e) => {
                            const selectedName = e.target.value;
                            setProfileLocation(selectedName);
                            const matchedSite = getEffectiveWorkSiteLocations(systemSettings.attendanceConfig).find(
                              (s) => s.name === selectedName
                            );
                            setProfileAssignedWorkSiteId(matchedSite?.id || '');
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        >
                          <option value="">{lang === 'ar' ? '-- اختر موقع العمل --' : '-- Select Work Site --'}</option>
                          {getEffectiveWorkSiteLocations(systemSettings.attendanceConfig).map((site) => (
                            <option key={site.id} value={site.name}>
                              {site.name}
                            </option>
                          ))}
                          {profileLocation &&
                            !getEffectiveWorkSiteLocations(systemSettings.attendanceConfig).some(
                              (s) => s.name === profileLocation
                            ) && <option value={profileLocation}>{profileLocation}</option>}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'defaultShiftModeLabel')}
                        </label>
                        <select
                          value={profileShiftMode}
                          onChange={(e) =>
                            setProfileShiftMode(e.target.value === 'flexible' ? 'flexible' : 'standard')
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        >
                          <option value="standard">{t(lang, 'shiftStandardLabel')}</option>
                          <option value="flexible">{t(lang, 'shiftFlexibleLabel')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'biometricStatusCol')}
                        </label>
                        <div className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold">
                          <span
                            className={
                              linkedEmployeeForProfile?.biometricExempt
                                ? 'text-[var(--status-success-text)]'
                                : 'text-[var(--text-main)]'
                            }
                          >
                            {linkedEmployeeForProfile?.biometricExempt
                              ? lang === 'ar'
                                ? 'معفى من البصمة'
                                : 'Biometric Exempt'
                              : lang === 'ar'
                              ? 'ملزم بالبصمة الجغرافية'
                              : 'Geofenced Biometric Required'}
                          </span>
                        </div>
                      </div>
                      <div className="md:col-span-2 lg:col-span-3">
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {lang === 'ar' ? 'ملاحظات إدارية' : 'Administrative Notes'}
                        </label>
                        <textarea
                          rows={2}
                          value={profileNotes}
                          onChange={(e) => setProfileNotes(e.target.value)}
                          placeholder={lang === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 4: Password Change */}
                  <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl p-6 space-y-4">
                    <h4 className="font-display font-bold text-base text-[var(--text-main)] flex items-center gap-2">
                      <KeyRound size={18} className="text-[var(--primary-text)]" />
                      <span>{lang === 'ar' ? 'تغيير كلمة المرور (اختياري)' : 'Change Password (Optional)'}</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'changePasswordLabel')}
                        </label>
                        <input
                          type="password"
                          value={profilePassword}
                          onChange={(e) => setProfilePassword(e.target.value)}
                          placeholder={lang === 'ar' ? 'اتركه فارغاً بدون تغيير' : 'Leave blank to keep current'}
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'confirmPasswordLabel')}
                        </label>
                        <input
                          type="password"
                          value={profileConfirmPassword}
                          onChange={(e) => setProfileConfirmPassword(e.target.value)}
                          placeholder="••••••"
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Prominent Form Save Action Bar */}
                  <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-[var(--text-muted)]">
                      {lang === 'ar'
                        ? 'يتم تحديث بيانات حسابك وسجلك الوظيفي بشكل متزامن عند الحفظ.'
                        : 'Account details and linked staff record synchronize automatically on save.'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={populateProfileForm}
                        className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium hover:bg-[var(--surface-subtle)] cursor-pointer"
                      >
                        {lang === 'ar' ? 'إعادة ضبط' : 'Reset'}
                      </button>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-bold hover:bg-[var(--primary-hover)] transition-colors cursor-pointer shadow-sm"
                      >
                        <Save size={15} />
                        <span>{lang === 'ar' ? 'حفظ كافة التعديلات' : 'Save All Changes'}</span>
                      </button>
                    </div>
                  </div>
                </form>

                {/* Active Permissions Summary */}
                <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl p-5 space-y-3">
                  <h5 className="text-sm font-bold flex items-center gap-2 text-[var(--text-main)]">
                    <ShieldCheck size={16} className="text-[var(--primary-text)]" />
                    <span>
                      {t(lang, 'activePermissionsTitle')} ({currentUser.permissions.length})
                    </span>
                  </h5>
                  <div className="flex flex-wrap gap-1.5 max-h-60 overflow-y-auto">
                    {currentUser.permissions.map((permId) => {
                      const def =
                        PERMISSIONS_LIST.find((p) => p.id === permId) ||
                        (systemSettings.customPermissions || []).find((p) => p.id === permId);
                      const label = def ? (lang === 'ar' ? def.labelAr : def.labelEn) : permId;
                      return (
                        <span
                          key={permId}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] bg-[var(--app-bg)] border border-[var(--border)] text-[var(--text-main)]"
                        >
                          <Check size={11} className="text-[var(--status-success-text)]" />
                          <span>{label}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Global Quick Request Modal */}
      <QuickRequestModal
        open={isQuickRequestOpen}
        onClose={() => setIsQuickRequestOpen(false)}
        employees={employees}
        vacations={vacations}
        exitPermissions={exitPermissions}
        substituteExceptions={substituteExceptions}
        lockedEmployeeId={resolvedEmployeeIdForQuickRequest}
        settings={systemSettings}
        lang={lang}
        onSubmitSubstituteException={handleSubmitSubstituteException}
        onMarkExceptionConsumed={handleMarkExceptionConsumed}
        onSubmitLeave={(vac) => {
          setVacations((prev) => [...prev, vac]);
          logAudit(
            lang === 'ar' ? 'طلب إجازة سريع' : 'Quick Leave Request',
            `${vac.employeeName} · ${vac.days}d`,
            'vacation',
            vac.employeeId
          );
          showToast('success', lang === 'ar' ? 'تم إرسال طلب الإجازة بنجاح.' : 'Quick leave request submitted.');
          emitNotification({
            type: 'request',
            titleAr: 'طلب إجازة سريع جديد',
            titleEn: 'New Quick Leave Request',
            messageAr: `${vac.employeeName} · ${vac.days} ${lang === 'ar' ? 'أيام' : 'days'} (${vac.startDate} → ${vac.endDate})`,
            messageEn: `${vac.employeeName} · ${vac.days} days (${vac.startDate} → ${vac.endDate})`,
            targetView: 'requests',
            targetSubTab: 'leaves',
          });
        }}
        onSubmitExitPermission={(permit) => {
          setExitPermissions((prev) => [permit, ...prev]);
          logAudit(
            lang === 'ar' ? 'إذن خروج سريع' : 'Quick Exit Permit',
            `${permit.employeeName} (${permit.exitTime})`,
            'request',
            permit.employeeId
          );
          showToast('success', lang === 'ar' ? 'تم تسجيل إذن الخروج بنجاح.' : 'Exit permit submitted.');
          emitNotification({
            type: 'request',
            titleAr: 'إذن خروج سريع جديد',
            titleEn: 'New Quick Exit Permit',
            messageAr: `${permit.employeeName} (${permit.exitTime} → ${permit.returnTime})`,
            messageEn: `${permit.employeeName} (${permit.exitTime} → ${permit.returnTime})`,
            targetView: 'requests',
            targetSubTab: 'exit_permits',
          });
        }}
        onSubmitEmployeeRequest={(req) => {
          setEmployeeRequests((prev) => [req, ...prev]);
          logAudit(
            lang === 'ar' ? 'طلب إداري سريع' : 'Quick HR Request',
            `${req.employeeName} · ${req.title}`,
            'request',
            req.employeeId
          );
          showToast('success', lang === 'ar' ? 'تم إرسال الطلب الإداري بنجاح.' : 'HR request submitted.');
          emitNotification({
            type: 'request',
            titleAr: 'طلب إداري سريع جديد',
            titleEn: 'New Quick HR Request',
            messageAr: `${req.employeeName} · ${req.title}`,
            messageEn: `${req.employeeName} · ${req.title}`,
            targetView: 'requests',
            targetSubTab: 'hr_requests',
          });
        }}
      />

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
    </div>
  );
};

export default App;