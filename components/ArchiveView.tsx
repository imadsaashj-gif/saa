import React, { useMemo, useRef, useState } from 'react';
import {
  Archive,
  Download,
  Eye,
  FileCheck,
  FolderArchive,
  Lock,
  Paperclip,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AppUser,
  ArchiveCategory,
  ArchiveRecord,
  AttendanceRecord,
  Employee,
  EmployeeRequest,
  ExitPermission,
  Language,
  Vacation,
  generateId,
} from '../types';
import { t, translateStatus, translateVacationType } from '../i18n';
import { formatReadableDate, getTodayStr } from '../utils/leaveCalculations';
import { getVividCardClass } from '../utils/cardColors';
import { ConfirmDialog } from './UIPrimitives';

interface ArchiveViewProps {
  archiveRecords: ArchiveRecord[];
  setArchiveRecords: React.Dispatch<React.SetStateAction<ArchiveRecord[]>>;
  employees: Employee[];
  vacations: Vacation[];
  exitPermissions: ExitPermission[];
  employeeRequests: EmployeeRequest[];
  attendanceRecords: AttendanceRecord[];
  lang: Language;
  currentUser: AppUser | null;
  onLogAudit: (
    action: string,
    details: string,
    category: 'archive',
    targetEmployeeId?: string
  ) => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
}

interface UnifiedArchiveEntry extends ArchiveRecord {
  isStoredManual: boolean;
}

const ArchiveView: React.FC<ArchiveViewProps> = ({
  archiveRecords,
  setArchiveRecords,
  employees,
  vacations,
  exitPermissions,
  employeeRequests,
  attendanceRecords,
  lang,
  currentUser,
  onLogAudit,
  onToast,
}) => {
  const canManageArchive = Boolean(currentUser?.permissions.includes('manage_archive'));
  const hasInstitutionalScope =
    currentUser?.role !== 'Employee' &&
    Boolean(
      canManageArchive ||
        currentUser?.permissions.includes('view_employees') ||
        currentUser?.permissions.includes('view_vacations')
    );
  const isEmployeeScoped = !hasInstitutionalScope || currentUser?.role === 'Employee';

  const linkedEmployee = useMemo(() => {
    if (!currentUser) return undefined;
    if (currentUser.linkedEmployeeId) {
      const byId = employees.find((e) => e.id === currentUser.linkedEmployeeId);
      if (byId) return byId;
    }
    const cleanName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
    const byMatch = employees.find(
      (e) =>
        (e.email && e.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()) ||
        e.fullName.trim().toLowerCase() === cleanName
    );
    return byMatch || (currentUser.role === 'Employee' ? employees[0] : undefined);
  }, [currentUser, employees]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<'all' | ArchiveCategory>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const ledgerRef = useRef<HTMLDivElement>(null);
  const scrollToLedger = () => ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Add Document Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docRefCode, setDocRefCode] = useState('');
  const [docCategory, setDocCategory] = useState<ArchiveCategory>('document');
  const [docEmployeeId, setDocEmployeeId] = useState<string>('');
  const [docDate, setDocDate] = useState<string>(getTodayStr());
  const [docStatusLabel, setDocStatusLabel] = useState<string>('وثيقة رسمية معتمدة');
  const [docSummary, setDocSummary] = useState<string>('');
  const [docAttachmentName, setDocAttachmentName] = useState<string>('');
  const [docAttachmentData, setDocAttachmentData] = useState<string>('');

  // Attachment preview & Confirm Delete
  const [previewRecord, setPreviewRecord] = useState<UnifiedArchiveEntry | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const todayStr = getTodayStr();

  // Build derived auto-indexed historical records for items not yet explicitly snapshotted in archiveRecords
  const autoIndexedHistorical = useMemo<UnifiedArchiveEntry[]>(() => {
    const importedSourceIds = new Set(archiveRecords.map((a) => a.sourceId).filter(Boolean));
    const list: UnifiedArchiveEntry[] = [];

    // 1. Completed / Rejected Leaves
    vacations.forEach((v) => {
      if (importedSourceIds.has(v.id)) return;
      const isHistorical = v.status === 'Rejected' || (v.status === 'Approved' && v.endDate <= todayStr);
      if (!isHistorical) return;
      const emp = employees.find((e) => e.id === v.employeeId);
      list.push({
        id: `auto-vac-${v.id}`,
        refCode: `VAC-${v.startDate.slice(0, 4)}-${v.id.slice(-4).toUpperCase()}`,
        title:
          lang === 'ar'
            ? `${translateVacationType(v.type, 'ar')} — ${v.employeeName}`
            : `${translateVacationType(v.type, 'en')} — ${v.employeeName}`,
        category: 'leave',
        employeeId: v.employeeId,
        employeeName: v.employeeName,
        department: emp?.department,
        recordDate: v.endDate || v.startDate,
        archivedAt: v.createdAt || v.endDate || todayStr,
        archivedBy: lang === 'ar' ? 'أرشفة تلقائية' : 'Auto-Indexed',
        statusLabel: translateStatus(v.status, lang),
        summary:
          lang === 'ar'
            ? `${v.startDate} → ${v.endDate} (${v.days} أيام عمل)${v.substitute ? ` · البديل: ${v.substitute}` : ''}`
            : `${v.startDate} → ${v.endDate} (${v.days} work days)${v.substitute ? ` · Sub: ${v.substitute}` : ''}`,
        attachmentName: v.attachment,
        attachmentData: v.attachmentData,
        sourceId: v.id,
        isStoredManual: false,
      });
    });

    // 2. Settled Exit Permits
    exitPermissions.forEach((ex) => {
      if (importedSourceIds.has(ex.id)) return;
      if (ex.status !== 'Approved' && ex.status !== 'Rejected') return;
      const emp = employees.find((e) => e.id === ex.employeeId);
      list.push({
        id: `auto-exit-${ex.id}`,
        refCode: `EXT-${ex.date.slice(0, 4)}-${ex.id.slice(-4).toUpperCase()}`,
        title:
          lang === 'ar'
            ? `إذن خروج (${ex.reasonType}) — ${ex.employeeName}`
            : `Exit Permit (${ex.reasonType}) — ${ex.employeeName}`,
        category: 'exit_permit',
        employeeId: ex.employeeId,
        employeeName: ex.employeeName,
        department: emp?.department,
        recordDate: ex.date,
        archivedAt: ex.createdAt || ex.date,
        archivedBy: lang === 'ar' ? 'أرشفة تلقائية' : 'Auto-Indexed',
        statusLabel: translateStatus(ex.status, lang),
        summary: `${ex.exitTime} → ${ex.returnTime} (${ex.durationMinutes} min)${ex.notes ? ` · ${ex.notes}` : ''}`,
        sourceId: ex.id,
        isStoredManual: false,
      });
    });

    // 3. Settled HR Requests
    employeeRequests.forEach((req) => {
      if (importedSourceIds.has(req.id)) return;
      if (req.status !== 'Approved' && req.status !== 'Rejected') return;
      const emp = employees.find((e) => e.id === req.employeeId);
      list.push({
        id: `auto-req-${req.id}`,
        refCode: `REQ-${(req.targetDate || todayStr).slice(0, 4)}-${req.id.slice(-4).toUpperCase()}`,
        title: `${req.title} — ${req.employeeName}`,
        category: 'hr_request',
        employeeId: req.employeeId,
        employeeName: req.employeeName,
        department: emp?.department,
        recordDate: req.targetDate || todayStr,
        archivedAt: req.createdAt || todayStr,
        archivedBy: lang === 'ar' ? 'أرشفة تلقائية' : 'Auto-Indexed',
        statusLabel: translateStatus(req.status, lang),
        summary: `${req.requestType} · ${req.details}`,
        sourceId: req.id,
        isStoredManual: false,
      });
    });

    // 4. Rectified / Past Attendance Logs
    attendanceRecords.forEach((att) => {
      if (importedSourceIds.has(att.id)) return;
      const isArchivable = att.regularizationStatus === 'Resolved' || att.date < todayStr;
      if (!isArchivable) return;
      const emp = employees.find((e) => e.id === att.employeeId);
      list.push({
        id: `auto-att-${att.id}`,
        refCode: `ATT-${att.date.slice(0, 4)}-${att.id.slice(-4).toUpperCase()}`,
        title:
          lang === 'ar'
            ? `سجل دخول وخروج (${att.workSite}) — ${att.employeeName}`
            : `Attendance Log (${att.workSite}) — ${att.employeeName}`,
        category: 'attendance',
        employeeId: att.employeeId,
        employeeName: att.employeeName,
        department: emp?.department,
        recordDate: att.date,
        archivedAt: att.createdAt || att.date,
        archivedBy: lang === 'ar' ? 'أرشفة تلقائية' : 'Auto-Indexed',
        statusLabel:
          att.regularizationStatus === 'Resolved'
            ? t(lang, 'rectificationStatusResolved')
            : att.violationType === 'None'
            ? t(lang, 'compliantShiftTag')
            : translateStatus(att.violationType, lang),
        summary: `${att.checkInTime} (${att.entryLocation}) → ${att.checkOutTime || '--:--'}${
          att.exitLocation ? ` (${att.exitLocation})` : ''
        }`,
        sourceId: att.id,
        isStoredManual: false,
      });
    });

    return list;
  }, [archiveRecords, vacations, exitPermissions, employeeRequests, attendanceRecords, employees, lang, todayStr]);

  // Combined stored + auto-indexed entries filtered by permission scope
  const scopedEntries = useMemo<UnifiedArchiveEntry[]>(() => {
    const manualMapped: UnifiedArchiveEntry[] = archiveRecords.map((rec) => ({
      ...rec,
      isStoredManual: true,
    }));
    const merged = [...manualMapped, ...autoIndexedHistorical].sort((a, b) =>
      (b.recordDate || b.archivedAt).localeCompare(a.recordDate || a.archivedAt)
    );

    if (!isEmployeeScoped) return merged;
    if (!linkedEmployee) return [];

    const linkedName = linkedEmployee.fullName.trim().toLowerCase();
    return merged.filter(
      (item) =>
        item.employeeId === linkedEmployee.id ||
        Boolean(item.employeeName && item.employeeName.trim().toLowerCase() === linkedName)
    );
  }, [archiveRecords, autoIndexedHistorical, isEmployeeScoped, linkedEmployee]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    scopedEntries.forEach((item) => {
      const y = (item.recordDate || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [scopedEntries]);

  const availableDepartments = useMemo(() => {
    const depts = new Set<string>();
    scopedEntries.forEach((item) => {
      if (item.department?.trim()) depts.add(item.department.trim());
    });
    return Array.from(depts);
  }, [scopedEntries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedEntries.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (yearFilter !== 'all' && !(item.recordDate || '').startsWith(yearFilter)) return false;
      if (!isEmployeeScoped && deptFilter !== 'all' && item.department !== deptFilter) return false;
      if (!q) return true;
      return (
        item.refCode.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        (item.employeeName || '').toLowerCase().includes(q) ||
        (item.department || '').toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.statusLabel.toLowerCase().includes(q)
      );
    });
  }, [scopedEntries, categoryFilter, yearFilter, isEmployeeScoped, deptFilter, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<'all' | ArchiveCategory, number> = {
      all: scopedEntries.length,
      document: 0,
      leave: 0,
      exit_permit: 0,
      hr_request: 0,
      attendance: 0,
    };
    scopedEntries.forEach((item) => {
      counts[item.category] = (counts[item.category] || 0) + 1;
    });
    return counts;
  }, [scopedEntries]);

  const handleOpenAddModal = () => {
    const seq = archiveRecords.length + 101;
    setDocTitle('');
    setDocRefCode(`DOC-${todayStr.slice(0, 4)}-${seq}`);
    setDocCategory('document');
    setDocEmployeeId(employees[0]?.id || '');
    setDocDate(todayStr);
    setDocStatusLabel(lang === 'ar' ? 'وثيقة رسمية معتمدة' : 'Approved Official Document');
    setDocSummary('');
    setDocAttachmentName('');
    setDocAttachmentData('');
    setIsAddModalOpen(true);
  };

  const handleUploadAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      onToast('error', lang === 'ar' ? 'حجم الملف يجب ألا يتجاوز 3 ميجابايت.' : 'File size must not exceed 3 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDocAttachmentName(file.name);
      setDocAttachmentData(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const handleCreateArchiveDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim()) return;
    const linkedEmp = employees.find((emp) => emp.id === docEmployeeId);
    const newEntry: ArchiveRecord = {
      id: generateId(),
      refCode: docRefCode.trim() || `DOC-${todayStr.slice(0, 4)}-${Date.now().toString().slice(-3)}`,
      title: docTitle.trim(),
      category: docCategory,
      employeeId: linkedEmp?.id,
      employeeName: linkedEmp?.fullName,
      department: linkedEmp?.department,
      recordDate: docDate || todayStr,
      archivedAt: new Date().toISOString(),
      archivedBy: currentUser?.name || 'Admin',
      statusLabel: docStatusLabel.trim() || (lang === 'ar' ? 'مؤرشف' : 'Archived'),
      summary: docSummary.trim() || '-',
      attachmentName: docAttachmentName || undefined,
      attachmentData: docAttachmentData || undefined,
    };
    setArchiveRecords((prev) => [newEntry, ...prev]);
    onLogAudit(
      lang === 'ar' ? 'إضافة وثيقة إلى الأرشيف' : 'Archived Official Document',
      `${newEntry.refCode} · ${newEntry.title}`,
      'archive',
      linkedEmp?.id
    );
    onToast('success', lang === 'ar' ? 'تم حفظ الوثيقة في الأرشيف بنجاح.' : 'Document archived.');
    setIsAddModalOpen(false);
  };

  const handleSyncCompletedToArchive = () => {
    if (autoIndexedHistorical.length === 0) {
      onToast(
        'info',
        lang === 'ar'
          ? 'جميع السجلات المكتملة المؤهلة مؤرشفة بالفعل.'
          : 'All eligible completed records are already archived.'
      );
      return;
    }
    const snapshots: ArchiveRecord[] = autoIndexedHistorical.map(({ isStoredManual: _m, ...rest }) => ({
      ...rest,
      id: generateId(),
      archivedAt: new Date().toISOString(),
      archivedBy: currentUser?.name || 'Admin',
    }));
    setArchiveRecords((prev) => [...snapshots, ...prev]);
    onLogAudit(
      lang === 'ar' ? 'أرشفة السجلات المكتملة' : 'Archived Completed Records',
      `${snapshots.length} ${lang === 'ar' ? 'سجل مكتمل' : 'completed records'}`,
      'archive'
    );
    onToast(
      'success',
      lang === 'ar'
        ? `تم تثبيت وأرشفة ${snapshots.length} سجل مكتمل في الأرشيف الدائم.`
        : `Archived ${snapshots.length} completed records.`
    );
  };

  const handleDeleteArchiveRecord = (id: string) => {
    const target = archiveRecords.find((a) => a.id === id);
    setArchiveRecords((prev) => prev.filter((a) => a.id !== id));
    setConfirmDeleteId(null);
    if (target) {
      onLogAudit(
        lang === 'ar' ? 'حذف وثيقة من الأرشيف' : 'Removed Archive Entry',
        `${target.refCode} · ${target.title}`,
        'archive',
        target.employeeId
      );
    }
    onToast('info', lang === 'ar' ? 'تم حذف السجل من الأرشيف.' : 'Archive record removed.');
  };

  const handleExportJson = () => {
    const sanitized = filteredEntries.map(({ attachmentData: _data, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hr-archive-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getCategoryLabel = (cat: ArchiveCategory): string => {
    if (cat === 'document') return lang === 'ar' ? 'وثيقة رسمية' : 'Document';
    if (cat === 'leave') return lang === 'ar' ? 'إجازة' : 'Leave';
    if (cat === 'exit_permit') return lang === 'ar' ? 'إذن خروج' : 'Exit Permit';
    if (cat === 'hr_request') return lang === 'ar' ? 'طلب إداري' : 'HR Request';
    return lang === 'ar' ? 'سجل حضور' : 'Attendance';
  };

  const categoryTabs: Array<{ id: 'all' | ArchiveCategory; label: string }> = [
    { id: 'all', label: `${t(lang, 'archiveCategoryAll')} (${categoryCounts.all})` },
    { id: 'document', label: `${t(lang, 'archiveCategoryDocs')} (${categoryCounts.document})` },
    { id: 'leave', label: `${t(lang, 'archiveCategoryLeaves')} (${categoryCounts.leave})` },
    { id: 'exit_permit', label: `${t(lang, 'archiveCategoryExits')} (${categoryCounts.exit_permit})` },
    { id: 'hr_request', label: `${t(lang, 'archiveCategoryRequests')} (${categoryCounts.hr_request})` },
    { id: 'attendance', label: `${t(lang, 'archiveCategoryAttendance')} (${categoryCounts.attendance})` },
  ];

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="font-display text-2xl font-bold flex items-center gap-2">
            <Archive size={22} className="text-[var(--primary-text)]" />
            <span>{t(lang, 'archiveTitle')}</span>
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{t(lang, 'archiveDesc')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download size={14} className="text-[var(--primary-text)]" />
            <span>{lang === 'ar' ? 'تصدير الفهرس (.json)' : 'Export Index (.json)'}</span>
          </button>

          {canManageArchive && (
            <>
              <button
                type="button"
                onClick={handleSyncCompletedToArchive}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap shrink-0"
              >
                <FolderArchive size={14} className="text-[var(--primary-text)]" />
                <span>
                  {t(lang, 'archiveSyncCompletedBtn')}
                  {autoIndexedHistorical.length > 0 ? ` (${autoIndexedHistorical.length})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={handleOpenAddModal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus size={15} />
                <span>{t(lang, 'archiveAddDocBtn')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scoped Employee Privacy Banner */}
      {isEmployeeScoped && (
        <div className="bg-[var(--card-bg)] border border-[var(--primary)]/35 p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-[var(--primary-text)]">
            <Lock size={15} />
            <span>{t(lang, 'archiveScopedEmployeeNotice')}</span>
          </div>
          {linkedEmployee && (
            <span className="text-[var(--text-muted)]">
              {linkedEmployee.fullName} · {linkedEmployee.department}
            </span>
          )}
        </div>
      )}

      {/* Interactive Archive Category Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setCategoryFilter('all');
            scrollToLedger();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCategoryFilter('all');
              scrollToLedger();
            }
          }}
          className={`${getVividCardClass(0, { isActive: categoryFilter === 'all' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'archiveCategoryAll')}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5">{categoryCounts.all}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] shrink-0">
            <Archive size={18} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setCategoryFilter((prev) => (prev === 'document' ? 'all' : 'document'));
            scrollToLedger();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCategoryFilter((prev) => (prev === 'document' ? 'all' : 'document'));
              scrollToLedger();
            }
          }}
          className={`${getVividCardClass(1, { isActive: categoryFilter === 'document' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'archiveCategoryDocs')}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5 text-[var(--status-success-text)]">
              {categoryCounts.document}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] shrink-0">
            <FileCheck size={18} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setCategoryFilter((prev) => (prev === 'leave' ? 'all' : 'leave'));
            scrollToLedger();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCategoryFilter((prev) => (prev === 'leave' ? 'all' : 'leave'));
              scrollToLedger();
            }
          }}
          className={`${getVividCardClass(10, { isActive: categoryFilter === 'leave' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'archiveCategoryLeaves')}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5 text-[var(--primary-text)]">
              {categoryCounts.leave}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)] text-[var(--primary-text)] shrink-0">
            <FolderArchive size={18} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setCategoryFilter((prev) => (prev === 'attendance' ? 'all' : 'attendance'));
            scrollToLedger();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCategoryFilter((prev) => (prev === 'attendance' ? 'all' : 'attendance'));
              scrollToLedger();
            }
          }}
          className={`${getVividCardClass(9, { isActive: categoryFilter === 'attendance' })} p-4 rounded-xl flex items-center justify-between gap-2`}
        >
          <div>
            <p className="text-xs text-[var(--text-muted)]">{t(lang, 'archiveCategoryAttendance')}</p>
            <p className="font-display text-2xl font-bold font-mono-tabular mt-0.5 text-[var(--status-warn-text)]">
              {categoryCounts.attendance + categoryCounts.exit_permit + categoryCounts.hr_request}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] shrink-0">
            <Paperclip size={18} />
          </div>
        </div>
      </div>

      {/* Filter Card */}
      <div ref={ledgerRef} className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap p-1 rounded-lg bg-[var(--card-bg)] border border-[var(--border)] gap-1">
            {categoryTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  categoryFilter === tab.id
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
            >
              <option value="all">{t(lang, 'archiveYearAll')}</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>

            {!isEmployeeScoped && availableDepartments.length > 0 && (
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
              >
                <option value="all">{t(lang, 'allDepartments')}</option>
                {availableDepartments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            )}

            <div className="relative min-w-[220px]">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  lang === 'ar' ? 'بحث بالرقم المرجعي أو العنوان أو الموظف...' : 'Search ref code, title, employee...'
                }
                className="w-full ps-8 pe-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
        </div>

        {/* Archive Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-start">{t(lang, 'archiveRefCodeLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'archiveDocTitleLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'myRequestsCategoryCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'employeeCol')} / {t(lang, 'departmentCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'attendanceDateLabel')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'statusCol')}</th>
                <th className="px-4 py-3 text-start">{t(lang, 'actionsCol')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredEntries.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--surface-subtle)]/40 align-middle">
                  <td className="px-4 py-3 font-mono-tabular font-bold text-[var(--primary-text)] whitespace-nowrap">
                    {item.refCode}
                  </td>

                  <td className="px-4 py-3 max-w-[300px]">
                    <p className="font-semibold text-[var(--text-main)]">{item.title}</p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{item.summary}</p>
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap text-[var(--text-muted)] font-medium">
                    {getCategoryLabel(item.category)}
                  </td>

                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--text-main)]">{item.employeeName || '-'}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{item.department || '-'}</p>
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap font-mono-tabular">
                    <div>{formatReadableDate(item.recordDate, lang)}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{item.archivedBy}</div>
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-success-text)]">
                      <FileCheck size={13} />
                      <span>{item.statusLabel}</span>
                    </span>
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {(item.attachmentData || item.attachmentName) && (
                        <button
                          type="button"
                          onClick={() => setPreviewRecord(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer"
                        >
                          <Eye size={13} className="text-[var(--primary-text)]" />
                          <span>{t(lang, 'archivePreviewBtn')}</span>
                        </button>
                      )}
                      {canManageArchive && item.isStoredManual && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                          title={t(lang, 'deleteLabel')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      {!(item.attachmentData || item.attachmentName) && !(canManageArchive && item.isStoredManual) && (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    {t(lang, 'archiveEmptyMsg')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Archive Document Modal (manage_archive only) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold text-base flex items-center gap-2">
                <Archive size={18} className="text-[var(--primary-text)]" />
                <span>{t(lang, 'archiveAddDocBtn')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateArchiveDoc} className="p-5 space-y-4 text-sm max-h-[82vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'archiveDocTitleLabel')} *
                </label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'archiveRefCodeLabel')} *
                  </label>
                  <input
                    type="text"
                    value={docRefCode}
                    onChange={(e) => setDocRefCode(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'myRequestsCategoryCol')}
                  </label>
                  <select
                    value={docCategory}
                    onChange={(e) => setDocCategory(e.target.value as ArchiveCategory)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    <option value="document">{lang === 'ar' ? 'وثيقة رسمية' : 'Official Document'}</option>
                    <option value="leave">{lang === 'ar' ? 'ملف إجازة' : 'Leave File'}</option>
                    <option value="exit_permit">{lang === 'ar' ? 'إذن خروج' : 'Exit Permit'}</option>
                    <option value="hr_request">{lang === 'ar' ? 'طلب إداري' : 'HR Request'}</option>
                    <option value="attendance">{lang === 'ar' ? 'سجل حضور' : 'Attendance Record'}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'employeeCol')}
                  </label>
                  <select
                    value={docEmployeeId}
                    onChange={(e) => setDocEmployeeId(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    <option value="">{t(lang, 'noLinkedEmployeeOption')}</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} — {emp.department}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'attendanceDateLabel')}
                  </label>
                  <input
                    type="date"
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'statusCol')}
                </label>
                <input
                  type="text"
                  value={docStatusLabel}
                  onChange={(e) => setDocStatusLabel(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'requestDetailsLabel')}
                </label>
                <textarea
                  rows={2}
                  value={docSummary}
                  onChange={(e) => setDocSummary(e.target.value)}
                  className="w-full p-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'attachment')} (PDF / JPG / PNG)
                </label>
                <label className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--app-bg)] cursor-pointer hover:border-[var(--primary)] text-xs">
                  <Upload size={15} className="text-[var(--primary-text)]" />
                  <span>{docAttachmentName || (lang === 'ar' ? 'اختر ملفاً لإرفاقه' : 'Choose attachment')}</span>
                  <input type="file" accept="image/*,application/pdf" onChange={handleUploadAttachment} className="sr-only" />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
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

      {/* Attachment Preview Modal */}
      {previewRecord && (
        <div className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-sm">{previewRecord.title}</h3>
                <p className="text-xs text-[var(--text-muted)] font-mono-tabular">
                  {previewRecord.refCode} · {previewRecord.attachmentName || t(lang, 'attachment')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewRecord(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-[var(--app-bg)] flex items-center justify-center min-h-[280px]">
              {previewRecord.attachmentData ? (
                previewRecord.attachmentData.startsWith('data:application/pdf') ? (
                  <iframe
                    src={previewRecord.attachmentData}
                    title={previewRecord.title}
                    className="w-full h-[65vh] rounded border border-[var(--border)] bg-white"
                  />
                ) : (
                  <img
                    src={previewRecord.attachmentData}
                    alt={previewRecord.title}
                    className="max-w-full max-h-[65vh] rounded-lg border border-[var(--border)] object-contain"
                  />
                )
              ) : (
                <div className="text-center space-y-2 text-sm text-[var(--text-muted)]">
                  <Paperclip size={28} className="mx-auto text-[var(--primary-text)]" />
                  <p>{previewRecord.attachmentName}</p>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              {previewRecord.attachmentData && (
                <a
                  href={previewRecord.attachmentData}
                  download={previewRecord.attachmentName || `${previewRecord.refCode}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold"
                >
                  <Download size={14} />
                  <span>{t(lang, 'downloadFile')}</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setPreviewRecord(null)}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-semibold cursor-pointer"
              >
                {t(lang, 'close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? 'هل أنت متأكد من حذف هذا السجل من الأرشيف؟'
            : 'Are you sure you want to remove this entry from the archive?'
        }
        confirmText={t(lang, 'confirmBtn')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => confirmDeleteId && handleDeleteArchiveRecord(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};

export default ArchiveView;
