import React, { useMemo, useState } from 'react';
import {
  Building2,
  Edit,
  Eye,
  GitBranch,
  List,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AppUser, DepartmentUnit, Employee, Language, SystemSettings, Vacation, generateId } from '../types';
import { t } from '../i18n';
import { getTodayStr } from '../utils/leaveCalculations';
import { AvatarWithFallback, ConfirmDialog, StatusLabel } from './UIPrimitives';

interface OrgStructureViewProps {
  orgUnits: DepartmentUnit[];
  setOrgUnits: React.Dispatch<React.SetStateAction<DepartmentUnit[]>>;
  employees: Employee[];
  vacations: Vacation[];
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  embedded?: boolean;
  onLogAudit: (action: string, details: string, category: 'org') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onOpenDeptEmployees?: (deptName: string) => void;
}

const OrgStructureView: React.FC<OrgStructureViewProps> = ({
  orgUnits,
  setOrgUnits,
  employees,
  vacations,
  settings,
  lang,
  currentUser,
  embedded = false,
  onLogAudit,
  onToast,
  onOpenDeptEmployees,
}) => {
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [editingUnit, setEditingUnit] = useState<DepartmentUnit | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [viewingUnitRoster, setViewingUnitRoster] = useState<DepartmentUnit | null>(null);
  const [confirmDeleteUnit, setConfirmDeleteUnit] = useState<DepartmentUnit | null>(null);

  const canManage = currentUser?.permissions.includes('manage_org') ?? false;
  const todayStr = getTodayStr();
  const branding = settings.branding;
  const orgName =
    lang === 'ar'
      ? branding?.orgNameAr || t(lang, 'brandTitle')
      : branding?.orgNameEn || t(lang, 'brandTitle');

  const activeLeaveEmpIds = useMemo(
    () =>
      new Set(
        vacations
          .filter((v) => v.status === 'Approved' && v.startDate <= todayStr && v.endDate >= todayStr)
          .map((v) => v.employeeId)
      ),
    [vacations, todayStr]
  );

  const getUnitStats = (unit: DepartmentUnit) => {
    const childUnits = orgUnits.filter((u) => u.parentId === unit.id);
    const unitNames = new Set([unit.name, ...childUnits.map((c) => c.name)]);
    const directStaff = employees.filter((e) => e.department === unit.name);
    const totalStaff = employees.filter((e) => unitNames.has(e.department));
    const awayCount = totalStaff.filter((e) => activeLeaveEmpIds.has(e.id)).length;
    return { directStaff, totalStaff, awayCount, childUnits };
  };

  const topLevelUnits = useMemo(() => {
    const ids = new Set(orgUnits.map((u) => u.id));
    return orgUnits.filter((u) => !u.parentId || !ids.has(u.parentId));
  }, [orgUnits]);

  const handleOpenCreate = (parentId?: string) => {
    setIsCreating(true);
    setEditingUnit({
      id: generateId(),
      name: '',
      code: `DEP-0${orgUnits.length + 1}`,
      parentId: parentId || '',
      managerName: '',
      location: '',
      description: '',
    });
  };

  const handleSaveUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUnit || !editingUnit.name.trim()) {
      onToast('error', lang === 'ar' ? 'اسم الإدارة أو القسم مطلوب.' : 'Unit name is required.');
      return;
    }

    const cleaned: DepartmentUnit = {
      ...editingUnit,
      name: editingUnit.name.trim(),
      parentId: editingUnit.parentId || undefined,
    };

    if (isCreating) {
      setOrgUnits((prev) => [...prev, cleaned]);
      onLogAudit(lang === 'ar' ? 'إضافة وحدة إدارية' : 'Added Org Unit', cleaned.name, 'org');
      onToast('success', lang === 'ar' ? 'تمت إضافة الإدارة / القسم.' : 'Organizational unit added.');
    } else {
      setOrgUnits((prev) => prev.map((u) => (u.id === cleaned.id ? cleaned : u)));
      onLogAudit(lang === 'ar' ? 'تعديل وحدة إدارية' : 'Updated Org Unit', cleaned.name, 'org');
      onToast('success', lang === 'ar' ? 'تم تحديث الوحدة الإدارية.' : 'Organizational unit updated.');
    }
    setEditingUnit(null);
  };

  // Recursive Org Chart Diagram Node (Name-only boxes connected with orthogonal diagram lines)
  const renderDiagramBranch = (
    unit: DepartmentUnit,
    idx: number,
    siblingCount: number,
    level: number,
    visited: Set<string>
  ): React.ReactNode => {
    if (visited.has(unit.id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(unit.id);

    const children = orgUnits.filter((u) => u.parentId === unit.id && !nextVisited.has(u.id));
    const isTopDept = level === 1;

    return (
      <div
        key={unit.id}
        className="relative flex flex-col items-center px-2.5 sm:px-4 pt-8 shrink-0"
      >
        {/* Horizontal connector bar across siblings (omitted for single child) */}
        {siblingCount > 1 && (
          <div
            aria-hidden="true"
            className={`absolute top-0 h-0.5 bg-[var(--primary)]/55 ${
              idx === 0
                ? 'end-0 w-[calc(50%+1px)]'
                : idx === siblingCount - 1
                ? 'start-0 w-[calc(50%+1px)]'
                : 'inset-x-0 w-full'
            }`}
          />
        )}

        {/* Vertical drop line down to node box */}
        <div
          aria-hidden="true"
          className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-8 bg-[var(--primary)]/55"
        />

        {/* Minimal Name-Only Node Box */}
        <button
          type="button"
          onClick={() => setViewingUnitRoster(unit)}
          title={unit.name}
          className={`min-w-[160px] max-w-[220px] px-5 py-3.5 rounded-xl border text-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${
            isTopDept
              ? 'bg-[var(--card-bg)] border-[var(--primary)]/60 hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]/30 shadow-xs'
              : 'bg-[var(--surface-subtle)] border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--card-bg)]'
          }`}
        >
          <span
            className={`block text-sm leading-snug text-[var(--text-main)] ${
              isTopDept ? 'font-display font-bold' : 'font-semibold'
            }`}
          >
            {unit.name}
          </span>
        </button>

        {/* Sub-Sections Tree connected downward */}
        {children.length > 0 && (
          <div className="flex flex-col items-center">
            <div aria-hidden="true" className="w-0.5 h-8 bg-[var(--primary)]/55" />
            <div className="flex items-start justify-center">
              {children.map((child, childIdx) =>
                renderDiagramBranch(child, childIdx, children.length, level + 1, nextVisited)
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Header */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 ${
          embedded ? '' : 'pb-2 border-b border-[var(--border)]'
        }`}
      >
        <div>
          {embedded ? (
            <>
              <h3 className="font-display text-base font-bold">{t(lang, 'orgSubDepts')}</h3>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'orgStructureDesc')}</p>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl font-bold">{t(lang, 'orgStructureTitle')}</h2>
              <p className="text-sm text-[var(--text-muted)]">{t(lang, 'orgStructureDesc')}</p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'tree'
                  ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <GitBranch size={14} />
              <span>{t(lang, 'orgTreeTab')}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-[var(--card-bg)] text-[var(--primary-text)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <List size={14} />
              <span>{t(lang, 'orgListTab')}</span>
            </button>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={() => handleOpenCreate()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus size={15} />
              <span>{t(lang, 'addDepartmentBtn')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Org Diagram View (Strictly unit names in boxes linked by hierarchy connector lines) */}
      {viewMode === 'tree' ? (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-x-auto">
          <div className="min-w-full w-max px-6 py-10 sm:px-10 flex flex-col items-center">
            {/* Executive Apex Box (Organization Name only) */}
            <div className="min-w-[200px] max-w-[280px] px-7 py-4 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary-soft)]/50 text-center">
              <h3 className="font-display text-lg font-bold text-[var(--text-main)] leading-snug">
                {orgName}
              </h3>
            </div>

            {topLevelUnits.length > 0 ? (
              <>
                {/* Main Vertical Stem from Executive Box down to Top-Level Departments */}
                <div aria-hidden="true" className="w-0.5 h-8 bg-[var(--primary)]/55" />

                {/* Top-Level Departments & Connected Sub-Sections */}
                <div className="flex items-start justify-center">
                  {topLevelUnits.map((unit, idx) =>
                    renderDiagramBranch(unit, idx, topLevelUnits.length, 1, new Set<string>())
                  )}
                </div>
              </>
            ) : (
              <div className="mt-8 text-center space-y-3 text-sm text-[var(--text-muted)]">
                <p>{t(lang, 'noDepartments')}</p>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleOpenCreate()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>{t(lang, 'addDepartmentBtn')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Table Directory View */
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'deptCodeLabel')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'deptNameLabel')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'parentDeptLabel')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'deptHeadLabel')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'locationCol')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'staffCountLabel')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {orgUnits.map((unit) => {
                  const parent = orgUnits.find((u) => u.id === unit.parentId);
                  const stats = getUnitStats(unit);
                  return (
                    <tr key={unit.id} className="hover:bg-[var(--surface-subtle)]/50">
                      <td className="px-4 py-3 font-mono-tabular text-xs font-semibold text-[var(--primary-text)]">
                        {unit.code}
                      </td>
                      <td className="px-4 py-3 font-semibold">{unit.name}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                        {parent ? parent.name : lang === 'ar' ? 'إدارة رئيسية' : 'Top-Level'}
                      </td>
                      <td className="px-4 py-3 text-xs">{unit.managerName || '-'}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{unit.location || '-'}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular font-semibold">
                        {stats.directStaff.length}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setViewingUnitRoster(unit)}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                          >
                            <Eye size={15} />
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsCreating(false);
                                  setEditingUnit({ ...unit });
                                }}
                                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] cursor-pointer"
                              >
                                <Edit size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUnit(unit)}
                                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unit Details, Management Actions & Staff Roster Modal (triggered by clicking any node box) */}
      {viewingUnitRoster && (() => {
        const parentUnit = viewingUnitRoster.parentId
          ? orgUnits.find((u) => u.id === viewingUnitRoster.parentId)
          : undefined;
        const unitEmployees = employees.filter((e) => e.department === viewingUnitRoster.name);
        return (
          <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[var(--primary-text)] font-semibold">
                    <Building2 size={14} />
                    <span className="font-mono-tabular">{viewingUnitRoster.code}</span>
                    {parentUnit && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[var(--text-muted)] truncate">{parentUnit.name}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-bold truncate">{viewingUnitRoster.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {viewingUnitRoster.managerName || '-'}
                    {viewingUnitRoster.location ? ` · ${viewingUnitRoster.location}` : ''}
                    {` · ${unitEmployees.length} ${lang === 'ar' ? 'موظف' : 'staff'}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingUnitRoster(null)}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              {viewingUnitRoster.description && (
                <div className="px-6 py-3 border-b border-[var(--border)] text-xs text-[var(--text-muted)] leading-relaxed">
                  {viewingUnitRoster.description}
                </div>
              )}

              <div className="p-5 overflow-y-auto divide-y divide-[var(--border)]">
                {unitEmployees.map((emp) => (
                  <div key={emp.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <AvatarWithFallback name={emp.fullName} sizeClass="w-8 h-8" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{emp.fullName}</div>
                        <div className="text-xs text-[var(--text-muted)] truncate">
                          <span className="font-mono-tabular">{emp.adminId}</span> · {emp.jobTitle}
                        </div>
                      </div>
                    </div>
                    <StatusLabel
                      status={activeLeaveEmpIds.has(emp.id) ? 'On Leave' : emp.status || 'Active'}
                      lang={lang}
                    />
                  </div>
                ))}
                {unitEmployees.length === 0 && (
                  <p className="py-8 text-center text-sm text-[var(--text-muted)]">
                    {t(lang, 'noEmployeesFound')}
                  </p>
                )}
              </div>

              <div className="px-6 py-3 border-t border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-2">
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const parentId = viewingUnitRoster.id;
                        setViewingUnitRoster(null);
                        handleOpenCreate(parentId);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--primary)]/50 bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold hover:bg-[var(--primary)] hover:text-[var(--primary-fg)] transition-colors cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>{lang === 'ar' ? 'إضافة قسم فرعي' : 'Add Sub-Section'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const target = viewingUnitRoster;
                        setViewingUnitRoster(null);
                        setIsCreating(false);
                        setEditingUnit({ ...target });
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer"
                    >
                      <Edit size={13} />
                      <span>{t(lang, 'editDepartmentBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const target = viewingUnitRoster;
                        setViewingUnitRoster(null);
                        setConfirmDeleteUnit(target);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] text-xs font-medium hover:opacity-85 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>{t(lang, 'deleteLabel')}</span>
                    </button>
                  </div>
                ) : (
                  <div />
                )}

                {onOpenDeptEmployees && (
                  <button
                    type="button"
                    onClick={() => {
                      const name = viewingUnitRoster.name;
                      setViewingUnitRoster(null);
                      onOpenDeptEmployees(name);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
                  >
                    <Users size={14} />
                    <span>{lang === 'ar' ? 'فتح في سجل الموظفين' : 'Open in Employee Records'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add / Edit Org Unit Modal */}
      {editingUnit && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold">
                {isCreating ? t(lang, 'addDepartmentBtn') : t(lang, 'editDepartmentBtn')}
              </h3>
              <button
                type="button"
                onClick={() => setEditingUnit(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveUnit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'deptNameLabel')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingUnit.name}
                    onChange={(e) => setEditingUnit({ ...editingUnit, name: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'deptCodeLabel')}
                  </label>
                  <input
                    type="text"
                    value={editingUnit.code}
                    onChange={(e) => setEditingUnit({ ...editingUnit, code: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'parentDeptLabel')}
                </label>
                <select
                  value={editingUnit.parentId || ''}
                  onChange={(e) => setEditingUnit({ ...editingUnit, parentId: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                >
                  <option value="">{t(lang, 'topLevelOption')}</option>
                  {orgUnits
                    .filter((u) => u.id !== editingUnit.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'deptHeadLabel')}
                  </label>
                  <input
                    type="text"
                    list="orgManagersList"
                    value={editingUnit.managerName}
                    onChange={(e) => setEditingUnit({ ...editingUnit, managerName: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  />
                  <datalist id="orgManagersList">
                    {employees.map((e) => (
                      <option key={e.id} value={e.fullName} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'locationCol')}
                  </label>
                  <input
                    type="text"
                    value={editingUnit.location}
                    onChange={(e) => setEditingUnit({ ...editingUnit, location: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'deptDescLabel')}
                </label>
                <textarea
                  rows={3}
                  value={editingUnit.description}
                  onChange={(e) => setEditingUnit({ ...editingUnit, description: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingUnit(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-main)] cursor-pointer"
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

      <ConfirmDialog
        open={Boolean(confirmDeleteUnit)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? `هل أنت متأكد من حذف الوحدة الإدارية "${confirmDeleteUnit?.name}"؟`
            : `Delete organizational unit "${confirmDeleteUnit?.name}"?`
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => {
          if (confirmDeleteUnit) {
            setOrgUnits((prev) =>
              prev
                .filter((u) => u.id !== confirmDeleteUnit.id)
                .map((u) => (u.parentId === confirmDeleteUnit.id ? { ...u, parentId: undefined } : u))
            );
            onLogAudit(lang === 'ar' ? 'حذف وحدة إدارية' : 'Deleted Org Unit', confirmDeleteUnit.name, 'org');
            onToast('success', lang === 'ar' ? 'تم حذف الوحدة الإدارية.' : 'Organizational unit deleted.');
          }
          setConfirmDeleteUnit(null);
        }}
        onCancel={() => setConfirmDeleteUnit(null)}
      />
    </div>
  );
};

export default OrgStructureView;
