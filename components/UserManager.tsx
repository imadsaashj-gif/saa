import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  Copy,
  Edit,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  ALL_PERMISSION_IDS,
  AppUser,
  Employee,
  Language,
  PERMISSIONS_LIST,
  PermissionDefinition,
  SystemSettings,
  UserRole,
  generateId,
} from '../types';
import { t, translateRole } from '../i18n';
import { AvatarWithFallback, ConfirmDialog, StatusLabel } from './UIPrimitives';

interface UserManagerProps {
  users: AppUser[];
  setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
  currentUser: AppUser | null;
  lang: Language;
  embedded?: boolean;
  settings?: SystemSettings;
  setSettings?: React.Dispatch<React.SetStateAction<SystemSettings>>;
  employees?: Employee[];
  onLogAudit: (action: string, details: string, category: 'user' | 'settings') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
}

export function getDefaultPermissionsForRole(role: UserRole, allPermIds: string[] = ALL_PERMISSION_IDS): string[] {
  switch (role) {
    case 'SuperAdmin':
    case 'Admin':
      return [...allPermIds];
    case 'Manager':
      return [
        'view_dashboard',
        'view_my_requests',
        'view_attendance',
        'view_attendance_sheet',
        'manage_attendance',
        'view_violations',
        'manage_violations',
        'view_absences',
        'manage_absences',
        'view_employees',
        'manage_employees',
        'view_vacations',
        'manage_vacations',
        'approve_exceptions',
        'export_excel',
        'view_org',
        'view_archive',
        'manage_archive',
        'view_audit',
        'ai_insights',
      ];
    case 'HR':
      return [
        'view_dashboard',
        'view_my_requests',
        'view_attendance',
        'view_attendance_sheet',
        'manage_attendance',
        'view_absences',
        'manage_absences',
        'view_employees',
        'manage_employees',
        'view_vacations',
        'manage_vacations',
        'export_excel',
        'view_org',
        'view_archive',
        'manage_archive',
        'view_audit',
        'ai_insights',
      ];
    case 'Employee':
      return ['view_dashboard', 'view_my_requests', 'view_attendance', 'view_archive', 'view_audit'];
    case 'Viewer':
    default:
      return [
        'view_dashboard',
        'view_employees',
        'view_vacations',
        'view_org',
        'view_attendance',
        'view_attendance_sheet',
        'view_absences',
        'view_archive',
      ];
  }
}

const UserManager: React.FC<UserManagerProps> = ({
  users,
  setUsers,
  currentUser,
  lang,
  embedded = false,
  settings,
  setSettings,
  employees = [],
  onLogAudit,
  onToast,
}) => {
  const isSuperAdmin = currentUser?.role === 'SuperAdmin';

  const customPermissions = useMemo(
    () => settings?.customPermissions || [],
    [settings?.customPermissions]
  );

  const allPermissions: PermissionDefinition[] = useMemo(
    () => [...PERMISSIONS_LIST, ...customPermissions],
    [customPermissions]
  );

  const allPermissionIds = useMemo(() => allPermissions.map((p) => p.id), [allPermissions]);

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<AppUser | null>(null);
  const [credentialsModalUser, setCredentialsModalUser] = useState<AppUser | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  // Exclusive SuperAdmin Custom Permission Creator state
  const [isAddPermOpen, setIsAddPermOpen] = useState(false);
  const [newPermAr, setNewPermAr] = useState('');
  const [newPermEn, setNewPermEn] = useState('');
  const [newPermCat, setNewPermCat] = useState('');

  const [formData, setFormData] = useState<Partial<AppUser>>({
    name: '',
    username: '',
    email: '',
    password: '',
    role: 'Employee',
    permissions: ['view_my_requests'],
    status: 'Active',
    linkedEmployeeId: '',
  });

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      translateRole(u.role, lang).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleOpenModal = (user?: AppUser) => {
    if (user && user.role === 'SuperAdmin' && !isSuperAdmin) {
      onToast(
        'error',
        lang === 'ar'
          ? 'تعديل حساب المشرف العام مقتصر على المشرف العام فقط.'
          : 'Only Super Admin can modify a Super Admin account.'
      );
      return;
    }
    setShowPassword(false);
    if (user) {
      setEditingUser(user);
      setFormData({ ...user, username: user.username || '', password: '' });
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        username: '',
        email: '',
        password: '',
        role: 'Employee',
        permissions: getDefaultPermissionsForRole('Employee', allPermissionIds),
        status: 'Active',
        linkedEmployeeId: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleRoleChange = (role: UserRole) => {
    if (role === 'SuperAdmin' && !isSuperAdmin) return;
    const defaults = getDefaultPermissionsForRole(role, allPermissionIds);
    setFormData((prev) => ({ ...prev, role, permissions: defaults }));
  };

  const togglePermission = (permId: string) => {
    // Only Super Admin has freedom to add/customize/toggle individual permissions
    if (!isSuperAdmin) return;
    setFormData((prev) => {
      const current = prev.permissions || [];
      return {
        ...prev,
        permissions: current.includes(permId)
          ? current.filter((p) => p !== permId)
          : [...current, permId],
      };
    });
  };

  const handleGrantAllPermissions = () => {
    if (!isSuperAdmin) return;
    setFormData((prev) => ({ ...prev, permissions: [...allPermissionIds] }));
  };

  const handleClearAllPermissions = () => {
    if (!isSuperAdmin) return;
    setFormData((prev) => ({ ...prev, permissions: [] }));
  };

  const handleCreateCustomPermission = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin || !setSettings) return;
    const labelAr = newPermAr.trim();
    if (!labelAr) {
      onToast('error', lang === 'ar' ? 'يرجى كتابة اسم الصلاحية بالعربية.' : 'Permission name is required.');
      return;
    }
    const labelEn = newPermEn.trim() || labelAr;
    const cat = newPermCat.trim();
    const newPerm: PermissionDefinition = {
      id: `custom_${generateId().slice(0, 8)}`,
      labelAr,
      labelEn,
      categoryAr: cat || 'صلاحية مخصصة',
      categoryEn: cat || 'Custom',
      isCustom: true,
    };

    setSettings((prev) => ({
      ...prev,
      customPermissions: [...(prev.customPermissions || []), newPerm],
    }));
    // Immediately reflect on all SuperAdmin accounts so SuperAdmin holds all permissions
    setUsers((prev) =>
      prev.map((u) =>
        u.role === 'SuperAdmin'
          ? { ...u, permissions: Array.from(new Set([...u.permissions, newPerm.id])) }
          : u
      )
    );
    onLogAudit(lang === 'ar' ? 'إضافة صلاحية جديدة' : 'Added Custom Permission', labelAr, 'settings');
    onToast('success', lang === 'ar' ? `تمت إضافة الصلاحية "${labelAr}" بنجاح.` : `Permission "${labelEn}" added.`);
    setNewPermAr('');
    setNewPermEn('');
    setNewPermCat('');
    setIsAddPermOpen(false);
  };

  const handleDeleteCustomPermission = (perm: PermissionDefinition) => {
    if (!isSuperAdmin || !setSettings || !perm.isCustom) return;
    setSettings((prev) => ({
      ...prev,
      customPermissions: (prev.customPermissions || []).filter((p) => p.id !== perm.id),
    }));
    setUsers((prev) =>
      prev.map((u) => ({
        ...u,
        permissions: u.permissions.filter((id) => id !== perm.id),
      }))
    );
    setFormData((prev) => ({
      ...prev,
      permissions: (prev.permissions || []).filter((id) => id !== perm.id),
    }));
    onLogAudit(lang === 'ar' ? 'حذف صلاحية مخصصة' : 'Removed Custom Permission', perm.labelAr, 'settings');
    onToast('info', lang === 'ar' ? 'تمت إزالة الصلاحية المخصصة.' : 'Custom permission removed.');
  };

  const openCredentialsModal = (user: AppUser) => {
    setCopiedCredentials(false);
    setCredentialsModalUser(user);
  };

  const buildCredentialsText = (user: AppUser) => {
    const portalUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const loginId = user.username?.trim() || user.email;
    const roleText = translateRole(user.role, lang);
    if (lang === 'ar') {
      return [
        `بيانات الدخول إلى بوابة شؤون الموظفين (${settings?.branding?.orgNameAr || 'مصلحة الآثار'}):`,
        `- الاسم: ${user.name}`,
        `- الدور الوظيفي: ${roleText}`,
        `- اسم المستخدم: ${loginId}`,
        `- البريد الإلكتروني: ${user.email}`,
        `- كلمة المرور: ${user.password || '******'}`,
        portalUrl ? `- رابط البوابة: ${portalUrl}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    return [
      `HR Portal Login Credentials (${settings?.branding?.orgNameEn || 'Archaeology HR Portal'}):`,
      `- Name: ${user.name}`,
      `- Role: ${roleText}`,
      `- Username: ${loginId}`,
      `- Email: ${user.email}`,
      `- Password: ${user.password || '******'}`,
      portalUrl ? `- Portal URL: ${portalUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const handleCopyCredentials = async (user: AppUser) => {
    const text = buildCredentialsText(user);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCredentials(true);
      onToast(
        'success',
        lang === 'ar' ? 'تم نسخ بيانات الدخول بنجاح.' : 'Login credentials copied to clipboard.'
      );
      onLogAudit(lang === 'ar' ? 'نسخ بيانات دخول مستخدم' : 'Copied User Credentials', user.name, 'user');
    } catch {
      onToast('error', lang === 'ar' ? 'تعذر النسخ التلقائي، يرجى النسخ يدوياً.' : 'Unable to access clipboard.');
    }
  };

  const handleResetTempPassword = (user: AppUser) => {
    const randomPwd = `Arc#${Math.floor(1000 + Math.random() * 9000)}`;
    const updatedUser: AppUser = { ...user, password: randomPwd };
    setUsers((prev) => prev.map((u) => (u.id === user.id ? updatedUser : u)));
    setCredentialsModalUser(updatedUser);
    setCopiedCredentials(false);
    onLogAudit(lang === 'ar' ? 'إعادة تعيين كلمة مرور وإصدار بيانات دخول' : 'Generated Temp Password', user.name, 'user');
    onToast(
      'success',
      lang === 'ar'
        ? `تم توليد كلمة مرور جديدة للمستخدم ${user.name}.`
        : `Generated temporary password for ${user.name}.`
    );
  };

  const handleSave = () => {
    if (!formData.name?.trim() || !formData.email?.trim()) {
      onToast('error', lang === 'ar' ? 'الاسم والبريد الإلكتروني مطلوبان.' : 'Name and email are required.');
      return;
    }
    if (!editingUser && !formData.password?.trim()) {
      onToast('error', lang === 'ar' ? 'كلمة المرور مطلوبة للحساب الجديد.' : 'Password is required.');
      return;
    }

    const chosenRole = (formData.role as UserRole) || 'Employee';
    if (!isSuperAdmin && chosenRole === 'SuperAdmin') {
      onToast('error', lang === 'ar' ? 'تعيين المشرف العام متاح للمشرف العام فقط.' : 'Only Super Admin can assign Super Admin.');
      return;
    }

    const derivedUsername =
      formData.username?.trim() || formData.email.trim().split('@')[0] || formData.name.trim();

    const duplicateUsername = users.some(
      (u) =>
        u.id !== editingUser?.id &&
        u.username &&
        u.username.trim().toLowerCase() === derivedUsername.toLowerCase()
    );
    if (duplicateUsername) {
      onToast(
        'error',
        lang === 'ar' ? 'اسم المستخدم مسجل مسبقاً لحساب آخر.' : 'Username is already taken by another user.'
      );
      return;
    }

    // Only SuperAdmin has free control over arbitrary permissions; non-SuperAdmin strictly uses preset role defaults
    const effectivePermissions: string[] = isSuperAdmin
      ? Array.from(new Set<string>(formData.permissions || []))
      : getDefaultPermissionsForRole(chosenRole, allPermissionIds);

    if (editingUser) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editingUser.id
            ? ({
                ...u,
                ...formData,
                username: derivedUsername,
                role: chosenRole,
                permissions: effectivePermissions,
                linkedEmployeeId: formData.linkedEmployeeId || undefined,
                password: formData.password?.trim() ? formData.password : u.password,
              } as AppUser)
            : u
        )
      );
      onLogAudit(lang === 'ar' ? 'تعديل حساب وصلاحيات' : 'Updated Account & Permissions', formData.name, 'user');
      onToast('success', lang === 'ar' ? 'تم تحديث الحساب والصلاحيات.' : 'Account and permissions updated.');
    } else {
      const newUser: AppUser = {
        id: generateId(),
        name: formData.name.trim(),
        username: derivedUsername,
        email: formData.email.trim(),
        password: formData.password!,
        role: chosenRole,
        permissions: effectivePermissions,
        status: (formData.status as 'Active' | 'Inactive') || 'Active',
        lastLogin: lang === 'ar' ? 'لم يسجل بعد' : 'Never',
        linkedEmployeeId: formData.linkedEmployeeId || undefined,
      };
      setUsers((prev) => [...prev, newUser]);
      onLogAudit(lang === 'ar' ? 'إنشاء حساب مستخدم' : 'Created User Account', newUser.name, 'user');
      onToast('success', lang === 'ar' ? 'تم إنشاء الحساب بنجاح.' : 'User account created.');
      openCredentialsModal(newUser);
    }
    setIsModalOpen(false);
  };

  const assignableRoles: UserRole[] = isSuperAdmin
    ? ['SuperAdmin', 'Admin', 'Manager', 'HR', 'Employee', 'Viewer']
    : ['Admin', 'Manager', 'HR', 'Employee', 'Viewer'];

  return (
    <div className="space-y-5 text-[var(--text-main)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          {embedded ? (
            <>
              <h3 className="font-display text-base font-bold flex items-center gap-2">
                <Shield size={18} className="text-[var(--primary-text)]" />
                <span>{t(lang, 'usersTitle')}</span>
              </h3>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'usersDesc')}</p>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl font-bold flex items-center gap-2">
                <Shield size={22} className="text-[var(--primary-text)]" />
                <span>{t(lang, 'usersTitle')}</span>
              </h2>
              <p className="text-sm text-[var(--text-muted)]">{t(lang, 'usersDesc')}</p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isSuperAdmin && setSettings && (
            <button
              type="button"
              onClick={() => setIsAddPermOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold hover:bg-[var(--primary)] hover:text-[var(--primary-fg)] transition-colors cursor-pointer whitespace-nowrap"
            >
              <KeyRound size={14} />
              <span>{t(lang, 'addPermissionBtn')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
          >
            <Plus size={15} />
            <span>{t(lang, 'addUserBtn')}</span>
          </button>
        </div>
      </div>

      {/* SuperAdmin Exclusive Policy Notice */}
      <div
        className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
          isSuperAdmin
            ? 'bg-[var(--primary-soft)]/50 border-[var(--primary)]/40 text-[var(--text-main)]'
            : 'bg-[var(--status-warn-bg)]/45 border-[var(--status-warn-border)] text-[var(--status-warn-text)]'
        }`}
      >
        {isSuperAdmin ? (
          <ShieldCheck size={16} className="text-[var(--primary-text)] shrink-0 mt-0.5" />
        ) : (
          <Lock size={16} className="shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5">
          <p className="font-semibold">{t(lang, 'superAdminOnlyBanner')}</p>
          {!isSuperAdmin && <p className="opacity-90">{t(lang, 'permLockedNotice')}</p>}
        </div>
      </div>

      {/* SuperAdmin Only: Add Custom Permission Panel */}
      {isSuperAdmin && isAddPermOpen && setSettings && (
        <form
          onSubmit={handleCreateCustomPermission}
          className="p-5 rounded-xl border border-[var(--primary)]/45 bg-[var(--surface-subtle)] space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-display text-sm font-bold flex items-center gap-2">
              <KeyRound size={15} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'addPermissionTitle')}</span>
            </h4>
            <button
              type="button"
              onClick={() => setIsAddPermOpen(false)}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              required
              value={newPermAr}
              onChange={(e) => setNewPermAr(e.target.value)}
              placeholder={t(lang, 'permLabelArPlaceholder')}
              className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
            />
            <input
              type="text"
              value={newPermEn}
              onChange={(e) => setNewPermEn(e.target.value)}
              placeholder={t(lang, 'permLabelEnPlaceholder')}
              className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
            />
            <input
              type="text"
              value={newPermCat}
              onChange={(e) => setNewPermCat(e.target.value)}
              placeholder={t(lang, 'permCategoryPlaceholder')}
              className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsAddPermOpen(false)}
              className="px-3.5 py-1.5 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-main)] cursor-pointer"
            >
              {t(lang, 'cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
            >
              {t(lang, 'addPermissionBtn')}
            </button>
          </div>
        </form>
      )}

      {/* Custom Permissions Registry (Visible cleanly when custom permissions exist) */}
      {customPermissions.length > 0 && (
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-[var(--text-main)]">
            <span>{t(lang, 'customPermissionsListTitle')}</span>
            <span className="font-mono-tabular text-[var(--text-muted)]">{customPermissions.length}</span>
          </div>
          <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden">
            {customPermissions.map((perm) => (
              <div key={perm.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <span className="font-semibold text-[var(--text-main)]">
                    {lang === 'ar' ? perm.labelAr : perm.labelEn}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {' '}
                    · {lang === 'ar' ? perm.categoryAr : perm.categoryEn}
                  </span>
                </div>
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCustomPermission(perm)}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer shrink-0"
                    title={t(lang, 'deleteLabel')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-[var(--card-bg)] p-3 rounded-xl border border-[var(--border)] flex items-center gap-3">
        <Search className="text-[var(--text-muted)]" size={16} />
        <input
          type="text"
          placeholder={lang === 'ar' ? 'البحث في الحسابات أو الأدوار...' : 'Search user accounts or roles...'}
          className="flex-1 bg-transparent outline-none text-sm text-[var(--text-main)]"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Users Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredUsers.map((user) => {
          const isSelf = currentUser?.id === user.id;
          const isProtectedSuper = user.role === 'SuperAdmin' && !isSuperAdmin;
          const linkedEmp = user.linkedEmployeeId
            ? employees.find((e) => e.id === user.linkedEmployeeId)
            : undefined;

          return (
            <div
              key={user.id}
              className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-5 flex flex-col justify-between gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <AvatarWithFallback src={user.avatar} name={user.name} sizeClass="w-10 h-10" />
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm text-[var(--text-main)] truncate">{user.name}</h3>
                    <p className="text-xs font-mono-tabular text-[var(--text-muted)] truncate">
                      {user.username ? `@${user.username} · ` : ''}{user.email}
                    </p>
                    {linkedEmp && (
                      <p className="text-[11px] text-[var(--text-muted)] truncate">
                        {linkedEmp.fullName} · {linkedEmp.adminId}
                      </p>
                    )}
                  </div>
                </div>
                <StatusLabel status={user.status} lang={lang} />
              </div>

              <div className="text-xs text-[var(--text-muted)] flex items-center justify-between border-t border-[var(--border)] pt-3">
                <span className="font-semibold text-[var(--primary-text)]">{translateRole(user.role, lang)}</span>
                <span className="tabular-nums font-mono-tabular">
                  {user.permissions.length} {lang === 'ar' ? 'صلاحية' : 'permissions'}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {!isProtectedSuper ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleOpenModal(user)}
                      className="flex-1 py-2 px-2.5 text-xs font-medium bg-[var(--surface-subtle)] border border-[var(--border)] rounded-lg hover:bg-[var(--app-bg)] transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Edit size={13} />
                      <span>
                        {isSuperAdmin
                          ? lang === 'ar'
                            ? 'تعديل الصلاحيات'
                            : 'Edit & Perms'
                          : lang === 'ar'
                          ? 'تعديل'
                          : 'Edit'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openCredentialsModal(user)}
                      className="px-2.5 py-2 text-xs font-semibold bg-[var(--primary-soft)] text-[var(--primary-text)] border border-[var(--primary)]/35 rounded-lg hover:bg-[var(--primary)] hover:text-[var(--primary-fg)] transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                      title={t(lang, 'sendCredentialsBtn')}
                    >
                      <Send size={13} />
                      <span>{lang === 'ar' ? 'بيانات الدخول' : 'Credentials'}</span>
                    </button>
                  </>
                ) : (
                  <div className="flex-1 py-2 px-3 text-[11px] text-center text-[var(--text-muted)] bg-[var(--surface-subtle)] border border-[var(--border)] rounded-lg inline-flex items-center justify-center gap-1.5">
                    <Lock size={12} />
                    <span>{lang === 'ar' ? 'محمي للمشرف العام فقط' : 'Super Admin Only'}</span>
                  </div>
                )}

                {!isSelf && user.role !== 'SuperAdmin' && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteUser(user)}
                    className="px-3 py-2 text-[var(--status-danger-text)] bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] rounded-lg hover:opacity-85 cursor-pointer"
                    title={t(lang, 'deleteLabel')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add/Edit User Modal with Permissions Matrix */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] w-full max-w-xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold text-[var(--text-main)]">
                {editingUser ? (lang === 'ar' ? 'تعديل الحساب والصلاحيات' : 'Edit Account & Permissions') : t(lang, 'addUserBtn')}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'fullName')} *
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--app-bg)] text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'usernameLabel')}
                  </label>
                  <input
                    type="text"
                    placeholder={lang === 'ar' ? 'مثال: m.mansouri' : 'e.g. m.mansouri'}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm font-mono-tabular bg-[var(--app-bg)] text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={formData.username || ''}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'email')} *
                  </label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm font-mono-tabular bg-[var(--app-bg)] text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'passwordLabel')} {!editingUser && '*'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder={editingUser ? (lang === 'ar' ? 'اتركه فارغاً للإبقاء' : 'Leave blank to keep') : '••••••••'}
                      className="w-full px-3 py-2 pe-9 border border-[var(--border)] rounded-lg text-sm bg-[var(--app-bg)] text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                      value={formData.password || ''}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute end-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              {employees.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'linkedEmployeeLabel')}
                  </label>
                  <select
                    value={formData.linkedEmployeeId || ''}
                    onChange={(e) => setFormData({ ...formData, linkedEmployeeId: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--app-bg)] text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                  >
                    <option value="">{t(lang, 'noLinkedEmployeeOption')}</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.adminId}) · {emp.department}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                    {t(lang, 'roleCol')}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {assignableRoles.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleRoleChange(r)}
                        className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          formData.role === r
                            ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-transparent'
                            : 'bg-[var(--app-bg)] text-[var(--text-main)] border-[var(--border)] hover:bg-[var(--surface-subtle)]'
                        }`}
                      >
                        {translateRole(r, lang)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                    {t(lang, 'accountStatus')}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Active', 'Inactive'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFormData({ ...formData, status: st })}
                        className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          formData.status === st
                            ? 'bg-[var(--primary-soft)] text-[var(--primary-text)] border-[var(--primary)]'
                            : 'bg-[var(--app-bg)] text-[var(--text-muted)] border-[var(--border)]'
                        }`}
                      >
                        {st === 'Active' ? (lang === 'ar' ? 'نشط' : 'Active') : lang === 'ar' ? 'معطل' : 'Inactive'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Interactive Permissions Matrix (Unrestricted Freedom ONLY for SuperAdmin) */}
              <div className="space-y-2.5 pt-3 border-t border-[var(--border)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                    {!isSuperAdmin && <Lock size={13} />}
                    <span>{t(lang, 'permissionsLabel')}</span>
                    <span className="font-mono-tabular">({(formData.permissions || []).length})</span>
                  </label>

                  {isSuperAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGrantAllPermissions}
                        className="px-2.5 py-1 rounded-md bg-[var(--primary-soft)] text-[var(--primary-text)] text-[11px] font-semibold hover:bg-[var(--primary)] hover:text-[var(--primary-fg)] transition-colors cursor-pointer"
                      >
                        {t(lang, 'grantAllPermsBtn')}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearAllPermissions}
                        className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
                      >
                        {t(lang, 'clearAllPermsBtn')}
                      </button>
                    </div>
                  )}
                </div>

                {!isSuperAdmin && (
                  <p className="text-[11px] text-[var(--status-warn-text)]">{t(lang, 'permLockedNotice')}</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allPermissions.map((perm) => {
                    const checked = (formData.permissions || []).includes(perm.id);
                    return (
                      <button
                        key={perm.id}
                        type="button"
                        disabled={!isSuperAdmin}
                        onClick={() => togglePermission(perm.id)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-start text-xs transition-colors ${
                          isSuperAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'
                        } ${
                          checked
                            ? 'bg-[var(--primary-soft)] border-[var(--primary)]/50 text-[var(--text-main)]'
                            : 'bg-[var(--app-bg)] border-[var(--border)] text-[var(--text-muted)]'
                        }`}
                      >
                        {checked ? (
                          <CheckSquare size={15} className="text-[var(--primary-text)] shrink-0" />
                        ) : (
                          <Square size={15} className="shrink-0 opacity-60" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">
                            {lang === 'ar' ? perm.labelAr : perm.labelEn}
                          </div>
                          <div className="text-[10px] opacity-75 truncate">
                            {lang === 'ar' ? perm.categoryAr : perm.categoryEn}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-subtle)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--text-main)] hover:bg-[var(--card-bg)] cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 bg-[var(--primary)] text-[var(--primary-fg)] rounded-lg text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                {t(lang, 'save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send / Copy Login Credentials Modal */}
      {credentialsModalUser && (
        <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <KeyRound size={18} className="text-[var(--primary-text)]" />
                <h3 className="font-display font-bold text-sm text-[var(--text-main)]">
                  {t(lang, 'credentialsModalTitle')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCredentialsModalUser(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-[var(--text-muted)]">{t(lang, 'credentialsModalDesc')}</p>

              <div className="p-4 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)]">{t(lang, 'fullName')}:</span>
                  <span className="font-bold text-[var(--text-main)]">{credentialsModalUser.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)]">{t(lang, 'roleCol')}:</span>
                  <span className="font-semibold text-[var(--primary-text)]">
                    {translateRole(credentialsModalUser.role, lang)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border)]">
                  <span className="text-[var(--text-muted)]">{t(lang, 'usernameLabel')}:</span>
                  <span className="font-mono-tabular font-bold text-[var(--text-main)]">
                    {credentialsModalUser.username || credentialsModalUser.email}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)]">{t(lang, 'email')}:</span>
                  <span className="font-mono-tabular text-[var(--text-main)]">{credentialsModalUser.email}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-muted)]">{t(lang, 'passwordLabel')}:</span>
                  <span className="font-mono-tabular font-bold text-[var(--primary-text)]">
                    {credentialsModalUser.password || '—'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyCredentials(credentialsModalUser)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
                >
                  {copiedCredentials ? <Check size={14} /> : <Copy size={14} />}
                  <span>
                    {copiedCredentials
                      ? lang === 'ar'
                        ? 'تم النسخ'
                        : 'Copied'
                      : t(lang, 'copyCredentialsBtn')}
                  </span>
                </button>

                <a
                  href={`mailto:${encodeURIComponent(credentialsModalUser.email)}?subject=${encodeURIComponent(
                    lang === 'ar' ? 'بيانات الدخول لبوابة شؤون الموظفين' : 'HR Portal Login Credentials'
                  )}&body=${encodeURIComponent(buildCredentialsText(credentialsModalUser))}`}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-main)] font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
                >
                  <Mail size={14} className="text-[var(--primary-text)]" />
                  <span>{t(lang, 'sendViaEmailBtn')}</span>
                </a>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => handleResetTempPassword(credentialsModalUser)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--primary-text)] hover:underline cursor-pointer"
                >
                  <RefreshCw size={12} />
                  <span>{lang === 'ar' ? 'توليد كلمة مرور مؤقتة جديدة' : 'Generate Temporary Password'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCredentialsModalUser(null)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                >
                  {t(lang, 'close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeleteUser)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? `هل أنت متأكد من حذف حساب "${confirmDeleteUser?.name}"؟`
            : `Delete account "${confirmDeleteUser?.name}"?`
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => {
          if (confirmDeleteUser) {
            setUsers((prev) => prev.filter((u) => u.id !== confirmDeleteUser.id));
            onLogAudit(lang === 'ar' ? 'حذف حساب مستخدم' : 'Deleted User Account', confirmDeleteUser.name, 'user');
            onToast('success', lang === 'ar' ? 'تم حذف المستخدم.' : 'User deleted.');
          }
          setConfirmDeleteUser(null);
        }}
        onCancel={() => setConfirmDeleteUser(null)}
      />
    </div>
  );
};

export default UserManager;