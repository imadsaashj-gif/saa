export enum ContractType {
  FULL_TIME = 'Full Time',
  PART_TIME = 'Part Time',
  CONTRACT = 'Contract',
  TEMPORARY = 'Temporary',
  INTERN = 'Intern',
}

export enum EmployeeStatus {
  ACTIVE = 'Active',
  ON_LEAVE = 'On Leave',
  TERMINATED = 'Terminated',
  RESIGNED = 'Resigned',
}

export type Language = 'ar' | 'en';
export type ThemeOption = 'dark' | 'light';

export interface VacationTypeConfig {
  id: string;
  name: string;
  color?: string;
}

export interface ContractTypeConfig {
  id: string;
  name: string;
  allowedVacationTypes: string[];
  annualLeaveLimit?: number;
}

export interface OfficialHoliday {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface BrandingSettings {
  orgNameAr: string;
  orgNameEn: string;
  orgTitleAr: string;
  orgTitleEn: string;
  logoDataUrl?: string;
  loginLogoDataUrl?: string;
  loginImageDataUrl?: string;
  loginCardOpacity?: number;
  loginSystemCode?: string;
  loginVersionBadge?: string;
  loginShowcaseTitleAr?: string;
  loginShowcaseTitleEn?: string;
  loginHeadlineAr?: string;
  loginHeadlineEn?: string;
  loginShowcaseTagsAr?: string;
  loginShowcaseTagsEn?: string;
  loginRestrictedNoticeAr?: string;
  loginRestrictedNoticeEn?: string;
  loginForgotHelpAr?: string;
  loginForgotHelpEn?: string;
}

export interface NotificationSettings {
  appEnabled: boolean;
  emailEnabled: boolean;
  notificationEmail: string;
  browserEnabled: boolean;
  soundEnabled: boolean;
  notifyOnNewRequest: boolean;
  notifyOnStatusChange: boolean;
  notifyOnSubstituteConflict: boolean;
}

export interface AppNotification {
  id: string;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  timestamp: string;
  read: boolean;
  type: 'request' | 'status' | 'substitute' | 'system';
  channels: Array<'app' | 'email' | 'browser'>;
  emailTarget?: string;
  targetView?:
    | 'dashboard'
    | 'my_requests'
    | 'attendance_hub'
    | 'attendance'
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

export interface PermissionDefinition {
  id: string;
  labelEn: string;
  labelAr: string;
  categoryEn: string;
  categoryAr: string;
  isCustom?: boolean;
}

export interface WorkSiteLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  defaultGate?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AttendanceSettings {
  standardStart: string;
  standardEnd: string;
  flexibleEnabled: boolean;
  flexibleStart: string;
  flexibleEnd: string;
  graceMinutes: number;
  overtimeEnabled: boolean;
  overtimeThresholdMinutes: number;
  overtimeMultiplier: number;
  approvedWorkSites: string[];
  workSiteLocations?: WorkSiteLocation[];
  approvedGates: string[];
  requireLocationOnCheck: boolean;
  enforceGeofenceForEmployees?: boolean;
  defaultGeofenceRadiusMeters?: number;
  autoWarnOnViolation: boolean;
  allowPermitRectification: boolean;
  allowLeaveRectification: boolean;
}

export interface SystemSettings {
  vacationTypes: VacationTypeConfig[];
  contractTypes: ContractTypeConfig[];
  currentTheme: ThemeOption;
  language?: Language;
  workWeekDays: number[];
  officialHolidays: OfficialHoliday[];
  requireAttachment: boolean;
  branding?: BrandingSettings;
  notifications?: NotificationSettings;
  attendanceConfig?: AttendanceSettings;
  customPermissions?: PermissionDefinition[];
}

export interface DepartmentUnit {
  id: string;
  name: string;
  code: string;
  parentId?: string;
  managerName: string;
  location: string;
  description: string;
}

export interface Employee {
  id: string;
  serialNo?: string;
  fullName: string;
  adminId: string;
  jobTitle: string;
  contractType: string;
  hireDate: string;
  location: string;
  assignedWorkSiteId?: string;
  allowedWorkSites?: string[];
  defaultShiftMode?: ShiftMode;
  geofenceRadiusOverrideMeters?: number;
  department: string;
  directManager: string;
  status: string;
  phone?: string;
  email?: string;
  notes?: string;
  biometricExempt?: boolean;
  biometricExemptReason?: string;
  biometricExemptUpdatedAt?: string;
  biometricExemptUpdatedBy?: string;
}

export interface Vacation {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  days: number;
  type: string;
  substitute: string;
  notes: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Returned';
  attachment?: string;
  attachmentData?: string;
  createdAt?: string;
}

export interface ExitPermission {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  exitTime: string; // HH:MM
  returnTime: string; // HH:MM
  durationMinutes: number;
  reasonType: string;
  notes: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Returned';
  createdAt?: string;
}

export interface EmployeeRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  requestType: string;
  priority: 'Normal' | 'Urgent';
  title: string;
  details: string;
  targetDate: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Returned';
  adminNotes?: string;
  createdAt?: string;
}

export interface SubstituteExceptionRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  substituteForVacationId: string;
  coveringForEmployeeName: string;
  coverageStartDate: string;
  coverageEndDate: string;
  requestedStartDate: string;
  requestedEndDate: string;
  requestedDays: number;
  vacationType: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Returned';
  adminNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  returnedAt?: string;
  updatedAt?: string;
  consumedVacationId?: string;
  createdAt: string;
}

export type ShiftMode = 'standard' | 'flexible';
export type AttendanceViolationType = 'None' | 'LateArrival' | 'EarlyDeparture' | 'Both';
export type RectificationStatus = 'None' | 'Unresolved' | 'Pending' | 'Resolved' | 'Rejected';

export type GeofenceStatus = 'VerifiedInside' | 'OutsideRange' | 'ManualAdmin' | 'LocationUnavailable';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  shiftMode: ShiftMode;
  checkInTime: string;
  checkOutTime?: string;
  workSite: string;
  entryLocation: string;
  exitLocation?: string;
  checkInLat?: number;
  checkInLng?: number;
  checkInAccuracyMeters?: number;
  checkInDistanceMeters?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  checkOutAccuracyMeters?: number;
  checkOutDistanceMeters?: number;
  geofenceStatus?: GeofenceStatus;
  isAutoStamped?: boolean;
  recordedByUserId?: string;
  recordedByUserName?: string;
  integrityDigest?: string;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes?: number;
  violationType: AttendanceViolationType;
  regularizationStatus: RectificationStatus;
  rectificationType?: 'exit_permit' | 'leave';
  rectificationId?: string;
  warningIssued?: boolean;
  warningNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  notes?: string;
  createdAt: string;
}

export type AbsenceType = 'Unexcused' | 'Excused' | 'NoCheckIn' | 'HalfDay';
export type AbsenceStatus = 'Open' | 'Excused' | 'Deducted' | 'ConvertedToLeave';

export interface AbsenceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department?: string;
  date: string;
  absenceType: AbsenceType;
  status: AbsenceStatus;
  reason?: string;
  linkedVacationId?: string;
  recordedBy: string;
  notes?: string;
  createdAt: string;
}

export type ArchiveCategory = 'leave' | 'exit_permit' | 'hr_request' | 'attendance' | 'document';

export interface ArchiveRecord {
  id: string;
  refCode: string;
  title: string;
  category: ArchiveCategory;
  employeeId?: string;
  employeeName?: string;
  department?: string;
  recordDate: string;
  archivedAt: string;
  archivedBy: string;
  statusLabel: string;
  summary: string;
  attachmentName?: string;
  attachmentData?: string;
  sourceId?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorId?: string;
  targetEmployeeId?: string;
  action: string;
  details: string;
  category: 'employee' | 'vacation' | 'settings' | 'system' | 'user' | 'org' | 'request' | 'attendance' | 'absence' | 'archive';
}

export type UserRole = 'SuperAdmin' | 'Admin' | 'Manager' | 'HR' | 'Employee' | 'Viewer';

export interface AppUser {
  id: string;
  username?: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  permissions: string[];
  status: 'Active' | 'Inactive';
  lastLogin: string;
  avatar?: string;
  linkedEmployeeId?: string;
}

export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
};

export const PERMISSIONS_LIST: PermissionDefinition[] = [
  { id: 'view_dashboard', labelEn: 'View Dashboard', labelAr: 'عرض لوحة التحكم', categoryEn: 'General', categoryAr: 'عام' },
  { id: 'view_my_requests', labelEn: 'Access My Requests Portal', labelAr: 'الوصول لصفحة طلباتي وتقديم الطلبات', categoryEn: 'Self-Service', categoryAr: 'طلباتي' },
  { id: 'view_attendance', labelEn: 'Personal Check-In / Check-Out', labelAr: 'تسجيل الحضور والانصراف الشخصي', categoryEn: 'Attendance', categoryAr: 'الحضور والانصراف' },
  { id: 'view_attendance_sheet', labelEn: 'View Staff Attendance Sheet', labelAr: 'عرض كشف الحضور والانصراف', categoryEn: 'Attendance', categoryAr: 'الحضور والانصراف' },
  { id: 'manage_attendance', labelEn: 'Manage Attendance Policies & Sheet', labelAr: 'إدارة الحضور والإنصراف وتعديل السجلات والسياسات', categoryEn: 'Attendance', categoryAr: 'الحضور والانصراف' },
  { id: 'view_violations', labelEn: 'View Attendance Violations', labelAr: 'عرض صفحة مخالفات الحضور والانصراف', categoryEn: 'Violations', categoryAr: 'المخالفات' },
  { id: 'manage_violations', labelEn: 'Approve / Reject Violation Rectifications', labelAr: 'اعتماد ورفض طلبات تصحيح المخالفات', categoryEn: 'Violations', categoryAr: 'المخالفات' },
  { id: 'view_absences', labelEn: 'View Employee Absences', labelAr: 'عرض صفحة الغيابات', categoryEn: 'Absences', categoryAr: 'الغيابات' },
  { id: 'manage_absences', labelEn: 'Record & Manage Absences', labelAr: 'تسجيل وإدارة الغيابات وتحويلها لإجازات', categoryEn: 'Absences', categoryAr: 'الغيابات' },
  { id: 'view_employees', labelEn: 'View Employees', labelAr: 'عرض سجل الموظفين', categoryEn: 'Employees', categoryAr: 'الموظفون' },
  { id: 'manage_employees', labelEn: 'Create / Edit Employees', labelAr: 'إضافة وتعديل الموظفين', categoryEn: 'Employees', categoryAr: 'الموظفون' },
  { id: 'view_vacations', labelEn: 'View Requests & Balances', labelAr: 'عرض طلبات الموظفين والأرصدة', categoryEn: 'Requests', categoryAr: 'الطلبات' },
  { id: 'manage_vacations', labelEn: 'Approve / Manage Requests', labelAr: 'اعتماد وإدارة طلبات الإجازات وأذونات الخروج', categoryEn: 'Requests', categoryAr: 'الطلبات' },
  { id: 'approve_exceptions', labelEn: 'Approve Substitute Exceptions (Manager)', labelAr: 'اعتماد طلبات استثناء البديل (صلاحية المدير)', categoryEn: 'Requests', categoryAr: 'الطلبات' },
  { id: 'export_excel', labelEn: 'Export Excel Files (Attendance, Absences, Violations, Requests)', labelAr: 'تصدير ملفات إكسل (الحضور والغياب والمخالفات والطلبات)', categoryEn: 'Reports & Export', categoryAr: 'التقارير والتصدير' },
  { id: 'view_org', labelEn: 'View Org Structure', labelAr: 'عرض الهيكل التنظيمي', categoryEn: 'Organization', categoryAr: 'الهيكل التنظيمي' },
  { id: 'manage_org', labelEn: 'Manage Org Structure', labelAr: 'تعديل الإدارات والأقسام', categoryEn: 'Organization', categoryAr: 'الهيكل التنظيمي' },
  { id: 'view_archive', labelEn: 'Access Archive Page', labelAr: 'عرض صفحة الأرشيف حسب الصلاحية', categoryEn: 'Archive', categoryAr: 'الأرشيف' },
  { id: 'manage_archive', labelEn: 'Archive & Upload Official Documents', labelAr: 'إدارة الأرشيف وإضافة/حذف الوثائق', categoryEn: 'Archive', categoryAr: 'الأرشيف' },
  { id: 'view_audit', labelEn: 'View Activity & Audit Log', labelAr: 'عرض سجل النشاطات', categoryEn: 'Admin', categoryAr: 'الإدارة' },
  { id: 'ai_insights', labelEn: 'Use AI HR Assistant', labelAr: 'استخدام المساعد التحليلي', categoryEn: 'Intelligence', categoryAr: 'الذكاء التحليلي' },
  { id: 'manage_settings', labelEn: 'System Configuration & Attendance Admin', labelAr: 'إعدادات النظام وإدارة الحضور والإنصراف والنسخ الاحتياطي', categoryEn: 'Admin', categoryAr: 'الإدارة' },
  { id: 'manage_users', labelEn: 'Permissions Management', labelAr: 'إدارة الصلاحيات والمستخدمين', categoryEn: 'Admin', categoryAr: 'الإدارة' },
];

export const ALL_PERMISSION_IDS: string[] = PERMISSIONS_LIST.map((p) => p.id);

export const ARABIC_HEADERS_MAP: Record<string, string> = {
  'م': 'serialNo',
  'الرقم التسلسلي': 'serialNo',
  'الاسم الكامل': 'fullName',
  'الاسم': 'fullName',
  'اسم الموظف': 'fullName',
  'Full Name': 'fullName',
  'Name': 'fullName',
  'الرقم الإداري': 'adminId',
  'الرقم الوظيفي': 'adminId',
  'رقم الموظف': 'adminId',
  'Admin ID': 'adminId',
  'Employee ID': 'adminId',
  'المسمى الوظيفي': 'jobTitle',
  'الوظيفة': 'jobTitle',
  'Job Title': 'jobTitle',
  'نوع التعاقد': 'contractType',
  'التعاقد': 'contractType',
  'Contract Type': 'contractType',
  'تاريخ التعيين': 'hireDate',
  'تاريخ المباشرة': 'hireDate',
  'Hire Date': 'hireDate',
  'مكان العمل': 'location',
  'الموقع': 'location',
  'Location': 'location',
  'الإدارة /القسم': 'department',
  'الإدارة / القسم': 'department',
  'الادارة / القسم': 'department',
  'القسم': 'department',
  'الإدارة': 'department',
  'Department': 'department',
  'المسؤول الباشر': 'directManager',
  'المسؤول المباشر': 'directManager',
  'مدير مباشر': 'directManager',
  'Direct Manager': 'directManager',
  'Manager': 'directManager',
  'الحالة': 'status',
  'حالة الموظف': 'status',
  'Status': 'status',
  'رقم الهاتف': 'phone',
  'الهاتف': 'phone',
  'Phone': 'phone',
  'البريد الإلكتروني': 'email',
  'Email': 'email',
  'بداية': 'vacationStart',
  'تاريخ البداية': 'vacationStart',
  'Start Date': 'vacationStart',
  'نهاية': 'vacationEnd',
  'تاريخ النهاية': 'vacationEnd',
  'End Date': 'vacationEnd',
  'أيام الاجازة': 'vacationDays',
  'أيام الإجازة': 'vacationDays',
  'مدة الاجازة': 'vacationDays',
  'Days': 'vacationDays',
  'نوع الاجازة': 'vacationType',
  'نوع الإجازة': 'vacationType',
  'Vacation Type': 'vacationType',
  'البديل الأول': 'substitute',
  'البديل': 'substitute',
  'الموظف البديل': 'substitute',
  'Substitute': 'substitute',
  'ملاحظات': 'notes',
  'Notes': 'notes',
  'الحالة (اجازة)': 'vacationStatus',
  'حالة الاجازة': 'vacationStatus',
  'حالة الإجازة': 'vacationStatus',
  'Status (Vacation)': 'vacationStatus',
  'المرفقات': 'attachment',
  'معفى من البصمة': 'biometricExempt',
  'إعفاء من البصمة': 'biometricExempt',
  'Biometric Exempt': 'biometricExempt',
  'سبب الإعفاء من البصمة': 'biometricExemptReason',
  'Biometric Exempt Reason': 'biometricExemptReason',
  'نظام الدوام الافتراضي': 'defaultShiftMode',
  'Default Shift Mode': 'defaultShiftMode',
  'نطاق السياج المخصص': 'geofenceRadiusOverrideMeters',
  'Geofence Radius Override': 'geofenceRadiusOverrideMeters',
};

export const REVERSE_HEADERS_MAP: Record<string, string> = {
  serialNo: 'م',
  fullName: 'الاسم الكامل',
  adminId: 'الرقم الإداري',
  jobTitle: 'المسمى الوظيفي',
  contractType: 'نوع التعاقد',
  hireDate: 'تاريخ التعيين',
  location: 'مكان العمل',
  department: 'الإدارة / القسم',
  directManager: 'المسؤول المباشر',
  status: 'الحالة',
  phone: 'رقم الهاتف',
  email: 'البريد الإلكتروني',
  vacationStart: 'بداية',
  vacationEnd: 'نهاية',
  vacationDays: 'أيام الإجازة',
  vacationType: 'نوع الإجازة',
  substitute: 'البديل الأول',
  notes: 'ملاحظات',
  vacationStatus: 'حالة الإجازة',
  attachment: 'المرفقات',
  biometricExempt: 'معفى من البصمة',
  biometricExemptReason: 'سبب الإعفاء من البصمة',
  defaultShiftMode: 'نظام الدوام الافتراضي',
  geofenceRadiusOverrideMeters: 'نطاق السياج المخصص',
};