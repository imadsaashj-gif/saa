import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Search,
  Download,
  Upload,
  Plus,
  Trash2,
  Edit,
  Eye,
  X,
  FileSpreadsheet,
  CalendarPlus,
  Briefcase,
  MapPin,
  Phone,
  Mail,
  UserCheck,
  Database,
  ShieldCheck,
  Clock,
  Crosshair,
} from 'lucide-react';
import {
  ARABIC_HEADERS_MAP,
  AppUser,
  DepartmentUnit,
  Employee,
  Language,
  REVERSE_HEADERS_MAP,
  ShiftMode,
  SystemSettings,
  Vacation,
  generateId,
} from '../types';
import { t, translateVacationType } from '../i18n';
import {
  calculateTenure,
  formatLocalYYYYMMDD,
  getEmployeeLeaveSummary,
  getTodayStr,
} from '../utils/leaveCalculations';
import { getEffectiveWorkSiteLocations, getShiftScheduleBounds } from '../utils/attendanceCalculations';
import { AvatarWithFallback, ConfirmDialog, StatusLabel } from './UIPrimitives';

interface EmployeeManagerProps {
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  addVacationsFromImport: (vacationData: any[]) => void;
  vacations: Vacation[];
  orgUnits?: DepartmentUnit[];
  settings: SystemSettings;
  lang: Language;
  currentUser: AppUser | null;
  embedded?: boolean;
  initialDeptFilter?: string | null;
  onClearInitialDeptFilter?: () => void;
  onLogAudit: (action: string, details: string, category: 'employee') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
  onLoadDemoData: () => void;
  onOpenNewLeaveForEmployee: (employeeId: string) => void;
}

interface ImportPreview {
  newEmployees: Employee[];
  duplicateMatches: Employee[];
  newVacations: any[];
  invalid: number;
  totalRows: number;
  detectedHeaders: string[];
}

const EmployeeManager: React.FC<EmployeeManagerProps> = ({
  employees,
  setEmployees,
  addVacationsFromImport,
  vacations,
  orgUnits = [],
  settings,
  lang,
  currentUser,
  embedded = false,
  initialDeptFilter,
  onClearInitialDeptFilter,
  onLogAudit,
  onToast,
  onLoadDemoData,
  onOpenNewLeaveForEmployee,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [contractFilter, setContractFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [biometricFilter, setBiometricFilter] = useState<'all' | 'exempt' | 'required'>('all');

  useEffect(() => {
    if (initialDeptFilter) {
      setDeptFilter(initialDeptFilter);
      onClearInitialDeptFilter?.();
    }
  }, [initialDeptFilter, onClearInitialDeptFilter]);

  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [updateDuplicates, setUpdateDuplicates] = useState(true);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ mode: 'single' | 'bulk'; emp?: Employee } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canManage = currentUser?.permissions.includes('manage_employees') ?? false;
  const currentYear = new Date().getFullYear();

  const effectiveWorkSites = useMemo(
    () => getEffectiveWorkSiteLocations(settings.attendanceConfig),
    [settings.attendanceConfig]
  );

  const departments = useMemo(
    () =>
      Array.from(
        new Set([
          ...orgUnits.map((u) => u.name),
          ...employees.map((e) => e.department).filter(Boolean),
        ])
      ),
    [employees, orgUnits]
  );

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return employees.filter((e) => {
      const matchesSearch =
        !q ||
        e.fullName.toLowerCase().includes(q) ||
        e.adminId.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.jobTitle.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q);
      const matchesDept = deptFilter === 'all' || e.department === deptFilter;
      const matchesContract = contractFilter === 'all' || e.contractType === contractFilter;
      const matchesStatus = statusFilter === 'all' || e.status === statusFilter;
      const matchesBiometric =
        biometricFilter === 'all' ||
        (biometricFilter === 'exempt' ? Boolean(e.biometricExempt) : !e.biometricExempt);
      return matchesSearch && matchesDept && matchesContract && matchesStatus && matchesBiometric;
    });
  }, [employees, searchTerm, deptFilter, contractFilter, statusFilter, biometricFilter]);

  const isAllVisibleSelected =
    filteredEmployees.length > 0 && filteredEmployees.every((e) => selectedIds.has(e.id));
  const isSomeVisibleSelected =
    filteredEmployees.some((e) => selectedIds.has(e.id)) && !isAllVisibleSelected;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = new Set(selectedIds);
    if (e.target.checked) {
      filteredEmployees.forEach((emp) => next.add(emp.id));
    } else {
      filteredEmployees.forEach((emp) => next.delete(emp.id));
    }
    setSelectedIds(next);
  };

  const handleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const parseExcelDate = (val: unknown): string => {
    if (!val) return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      return formatLocalYYYYMMDD(val);
    }
    if (typeof val === 'number') {
      const utcMs = Math.round((val - 25569) * 86400 * 1000);
      const dt = new Date(utcMs);
      if (!isNaN(dt.getTime())) {
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      return '';
    }
    return String(val).trim();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      if (!data) return;

      try {
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

        let headerRowIndex = 0;
        const potentialNameHeaders = ['الاسم الكامل', 'الاسم', 'اسم الموظف', 'full name', 'fullname', 'name'];
        for (let i = 0; i < Math.min(aoa.length, 15); i++) {
          const row = aoa[i];
          if (!row || row.length === 0) continue;
          const rowStr = row.map((c) => String(c).trim().replace(/\s+/g, ' ').toLowerCase());
          if (rowStr.some((cell) => potentialNameHeaders.some((h) => cell.includes(h)))) {
            headerRowIndex = i;
            break;
          }
        }

        const jsonOpts: XLSX.Sheet2JSONOpts = { defval: '' };
        if (headerRowIndex > 0) {
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
          range.s.r = headerRowIndex;
          jsonOpts.range = range;
        }

        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, jsonOpts);
        const preview: ImportPreview = {
          newEmployees: [],
          duplicateMatches: [],
          newVacations: [],
          invalid: 0,
          totalRows: jsonData.length,
          detectedHeaders: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
        };

        const existingMap = new Map<string, Employee>();
        employees.forEach((emp) => {
          if (emp.adminId) existingMap.set(emp.adminId.trim().toLowerCase(), emp);
        });
        const fileAdminIds = new Set<string>();

        jsonData.forEach((row) => {
          const normalized: Record<string, unknown> = {};
          Object.keys(row).forEach((key) => {
            const cleanKey = key.trim().replace(/\s+/g, ' ');
            let mappedKey: string | null =
              ARABIC_HEADERS_MAP[cleanKey] ||
              (Object.values(ARABIC_HEADERS_MAP).includes(cleanKey) ? cleanKey : null);
            if (!mappedKey) {
              const found = Object.keys(ARABIC_HEADERS_MAP).find(
                (k) => k.toLowerCase() === cleanKey.toLowerCase()
              );
              if (found) mappedKey = ARABIC_HEADERS_MAP[found];
            }
            normalized[mappedKey || key] = row[key];
          });

          const getVal = (key: string) => {
            const v = normalized[key];
            return v !== undefined && v !== null ? String(v).trim() : '';
          };

          const fullName = getVal('fullName');
          const adminId = getVal('adminId');

          if (!fullName) {
            preview.invalid++;
            return;
          }

          const cleanAdminId = adminId.toLowerCase();
          if (cleanAdminId && fileAdminIds.has(cleanAdminId)) {
            preview.invalid++;
            return;
          }
          if (cleanAdminId) fileAdminIds.add(cleanAdminId);

          const existingMatch = cleanAdminId ? existingMap.get(cleanAdminId) : undefined;
          const empId = existingMatch ? existingMatch.id : generateId();

          const exemptRaw = getVal('biometricExempt').toLowerCase();
          const hasExemptCell = exemptRaw !== '';
          const parsedExempt =
            exemptRaw === 'true' ||
            exemptRaw === 'yes' ||
            exemptRaw === '1' ||
            exemptRaw === 'نعم' ||
            exemptRaw === 'معفى' ||
            exemptRaw === 'exempt';

          const parsedLocation = getVal('location') || existingMatch?.location || '';
          const matchedSiteObj = effectiveWorkSites.find(
            (s) => s.name.trim().toLowerCase() === parsedLocation.trim().toLowerCase()
          );
          const shiftRaw = getVal('defaultShiftMode').toLowerCase();
          const parsedShift: ShiftMode | undefined =
            shiftRaw === 'flexible' || shiftRaw.includes('مرن')
              ? 'flexible'
              : shiftRaw === 'standard' || shiftRaw.includes('قياسي')
              ? 'standard'
              : existingMatch?.defaultShiftMode;
          const radiusRaw = Number(getVal('geofenceRadiusOverrideMeters'));
          const parsedRadius =
            !isNaN(radiusRaw) && radiusRaw >= 25
              ? Math.min(5000, Math.round(radiusRaw))
              : existingMatch?.geofenceRadiusOverrideMeters;

          const parsedEmp: Employee = {
            id: empId,
            serialNo: getVal('serialNo') || existingMatch?.serialNo || '',
            fullName,
            adminId: adminId || existingMatch?.adminId || `ARC-${Math.floor(100 + Math.random() * 900)}`,
            jobTitle: getVal('jobTitle') || existingMatch?.jobTitle || '',
            contractType:
              getVal('contractType') ||
              existingMatch?.contractType ||
              settings.contractTypes[0]?.name ||
              'عقد محلي',
            hireDate: parseExcelDate(normalized['hireDate']) || existingMatch?.hireDate || getTodayStr(),
            location: matchedSiteObj ? matchedSiteObj.name : parsedLocation,
            assignedWorkSiteId: matchedSiteObj?.id || existingMatch?.assignedWorkSiteId,
            allowedWorkSites: existingMatch?.allowedWorkSites,
            defaultShiftMode: parsedShift,
            geofenceRadiusOverrideMeters: parsedRadius,
            department: getVal('department') || existingMatch?.department || '',
            directManager: getVal('directManager') || existingMatch?.directManager || '',
            status: getVal('status') || existingMatch?.status || 'Active',
            phone: getVal('phone') || existingMatch?.phone || '',
            email: getVal('email') || existingMatch?.email || '',
            biometricExempt: hasExemptCell ? parsedExempt : existingMatch?.biometricExempt,
            biometricExemptReason:
              getVal('biometricExemptReason') || existingMatch?.biometricExemptReason,
          };

          if (existingMatch) {
            preview.duplicateMatches.push(parsedEmp);
          } else {
            preview.newEmployees.push(parsedEmp);
          }

          if (normalized['vacationStart']) {
            preview.newVacations.push({
              employeeId: empId,
              employeeName: parsedEmp.fullName,
              startDate: parseExcelDate(normalized['vacationStart']),
              endDate: parseExcelDate(normalized['vacationEnd']) || parseExcelDate(normalized['vacationStart']),
              days: Number(getVal('vacationDays')) || 1,
              type: getVal('vacationType') || 'Annual',
              substitute: getVal('substitute'),
              notes: getVal('notes'),
              status: getVal('vacationStatus') || 'Approved',
            });
          }
        });

        setImportPreview(preview);
      } catch (err) {
        console.error('Excel import error:', err);
        onToast('error', lang === 'ar' ? 'تعذر قراءة ملف Excel المحدد.' : 'Failed to parse the Excel file.');
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmImport = () => {
    if (!importPreview) return;
    setEmployees((prev) => {
      let next = [...prev];
      if (updateDuplicates && importPreview.duplicateMatches.length > 0) {
        const updateMap = new Map(importPreview.duplicateMatches.map((e) => [e.id, e]));
        next = next.map((emp) => updateMap.get(emp.id) || emp);
      }
      return [...next, ...importPreview.newEmployees];
    });
    if (importPreview.newVacations.length > 0) {
      addVacationsFromImport(importPreview.newVacations);
    }
    const addedCount = importPreview.newEmployees.length;
    const updatedCount = updateDuplicates ? importPreview.duplicateMatches.length : 0;
    onLogAudit(
      lang === 'ar' ? 'استيراد موظفين من Excel' : 'Excel Employee Import',
      `${lang === 'ar' ? 'جديد' : 'New'}: ${addedCount}, ${lang === 'ar' ? 'محدث' : 'Updated'}: ${updatedCount}`,
      'employee'
    );
    onToast(
      'success',
      lang === 'ar'
        ? `تم استيراد ${addedCount} موظف جديد وتحديث ${updatedCount} سجل.`
        : `Imported ${addedCount} new and updated ${updatedCount} employees.`
    );
    setImportPreview(null);
  };

  const handleExport = () => {
    const exportData = filteredEmployees.map((emp, idx) => {
      const row: Record<string, string> = {};
      row[REVERSE_HEADERS_MAP['serialNo']] = emp.serialNo || String(idx + 1);
      row[REVERSE_HEADERS_MAP['fullName']] = emp.fullName;
      row[REVERSE_HEADERS_MAP['adminId']] = emp.adminId;
      row[REVERSE_HEADERS_MAP['jobTitle']] = emp.jobTitle;
      row[REVERSE_HEADERS_MAP['contractType']] = emp.contractType;
      row[REVERSE_HEADERS_MAP['hireDate']] = emp.hireDate;
      row[REVERSE_HEADERS_MAP['location']] = emp.location;
      row[REVERSE_HEADERS_MAP['department']] = emp.department;
      row[REVERSE_HEADERS_MAP['directManager']] = emp.directManager;
      row[REVERSE_HEADERS_MAP['status']] = emp.status;
      row[REVERSE_HEADERS_MAP['phone']] = emp.phone || '';
      row[REVERSE_HEADERS_MAP['email']] = emp.email || '';
      row[REVERSE_HEADERS_MAP['biometricExempt']] = emp.biometricExempt
        ? lang === 'ar'
          ? 'نعم'
          : 'Yes'
        : lang === 'ar'
        ? 'لا'
        : 'No';
      row[REVERSE_HEADERS_MAP['biometricExemptReason']] = emp.biometricExemptReason || '';
      row[REVERSE_HEADERS_MAP['defaultShiftMode']] =
        emp.defaultShiftMode === 'flexible'
          ? lang === 'ar'
            ? 'ساعة مرنة'
            : 'Flexible'
          : lang === 'ar'
          ? 'قياسي'
          : 'Standard';
      row[REVERSE_HEADERS_MAP['geofenceRadiusOverrideMeters']] = emp.geofenceRadiusOverrideMeters
        ? String(emp.geofenceRadiusOverrideMeters)
        : '';
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, `archaeology_employees_${getTodayStr()}.xlsx`);
    onToast('success', lang === 'ar' ? 'تم تصدير سجل الموظفين بنجاح.' : 'Employees exported successfully.');
  };

  const handleDownloadTemplate = () => {
    const sampleRow: Record<string, string> = {
      [REVERSE_HEADERS_MAP['serialNo']]: '1',
      [REVERSE_HEADERS_MAP['fullName']]: 'محمد علي المنصوري',
      [REVERSE_HEADERS_MAP['adminId']]: 'ARC-201',
      [REVERSE_HEADERS_MAP['jobTitle']]: 'باحث آثار',
      [REVERSE_HEADERS_MAP['contractType']]: settings.contractTypes[0]?.name || 'عقد محلي',
      [REVERSE_HEADERS_MAP['hireDate']]: getTodayStr(),
      [REVERSE_HEADERS_MAP['location']]: effectiveWorkSites[0]?.name || 'ديوان المصلحة - طرابلس',
      [REVERSE_HEADERS_MAP['department']]: 'إدارة التنقيب والبعثات',
      [REVERSE_HEADERS_MAP['directManager']]: 'د. طارق المنصوري',
      [REVERSE_HEADERS_MAP['status']]: 'Active',
      [REVERSE_HEADERS_MAP['phone']]: '091-0000000',
      [REVERSE_HEADERS_MAP['email']]: 'name@archaeology.gov',
      [REVERSE_HEADERS_MAP['biometricExempt']]: 'لا',
      [REVERSE_HEADERS_MAP['biometricExemptReason']]: '',
      [REVERSE_HEADERS_MAP['defaultShiftMode']]: 'قياسي',
      [REVERSE_HEADERS_MAP['geofenceRadiusOverrideMeters']]: '',
    };
    const ws = XLSX.utils.json_to_sheet([sampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'employees_import_template.xlsx');
  };

  const handleOpenCreate = () => {
    setIsCreatingNew(true);
    const defaultSite = effectiveWorkSites[0];
    setEditingEmployee({
      id: generateId(),
      serialNo: String(employees.length + 1),
      fullName: '',
      adminId: `ARC-${100 + employees.length + 1}`,
      jobTitle: '',
      contractType: settings.contractTypes[0]?.name || 'عقد محلي',
      hireDate: getTodayStr(),
      location: defaultSite?.name || '',
      assignedWorkSiteId: defaultSite?.id,
      allowedWorkSites: [],
      defaultShiftMode: 'standard',
      department: '',
      directManager: '',
      status: 'Active',
      phone: '',
      email: '',
      notes: '',
    });
  };

  const handleOpenEdit = (emp: Employee) => {
    setIsCreatingNew(false);
    const matchedSite =
      effectiveWorkSites.find((s) => s.id === emp.assignedWorkSiteId) ||
      effectiveWorkSites.find((s) => s.name.trim().toLowerCase() === emp.location.trim().toLowerCase());
    setEditingEmployee({
      ...emp,
      assignedWorkSiteId: emp.assignedWorkSiteId || matchedSite?.id,
      allowedWorkSites: emp.allowedWorkSites || [],
      defaultShiftMode: emp.defaultShiftMode || 'standard',
    });
  };

  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    if (!editingEmployee.fullName.trim()) {
      onToast('error', lang === 'ar' ? 'الاسم الكامل مطلوب.' : 'Full name is required.');
      return;
    }

    const duplicateAdminId = employees.some(
      (emp) =>
        emp.id !== editingEmployee.id &&
        emp.adminId.trim().toLowerCase() === editingEmployee.adminId.trim().toLowerCase() &&
        editingEmployee.adminId.trim() !== ''
    );
    if (duplicateAdminId) {
      onToast('error', lang === 'ar' ? 'الرقم الإداري مسجل لموظف آخر.' : 'Admin ID already exists.');
      return;
    }

    const cleanLocation = editingEmployee.location.trim();
    const matchedSite =
      effectiveWorkSites.find((s) => s.id === editingEmployee.assignedWorkSiteId) ||
      effectiveWorkSites.find((s) => s.name.trim().toLowerCase() === cleanLocation.toLowerCase());

    const cleanOverrideRadius =
      editingEmployee.geofenceRadiusOverrideMeters !== undefined &&
      !isNaN(Number(editingEmployee.geofenceRadiusOverrideMeters)) &&
      Number(editingEmployee.geofenceRadiusOverrideMeters) >= 25
        ? Math.min(5000, Math.round(Number(editingEmployee.geofenceRadiusOverrideMeters)))
        : undefined;

    const cleanAllowedSites = Array.from<string>(
      new Set((editingEmployee.allowedWorkSites || []).map((s) => s.trim()).filter(Boolean))
    ).filter((s) => s.toLowerCase() !== cleanLocation.toLowerCase());

    const normalizedEmp: Employee = {
      ...editingEmployee,
      location: cleanLocation,
      assignedWorkSiteId: matchedSite?.id,
      allowedWorkSites: cleanAllowedSites.length > 0 ? cleanAllowedSites : undefined,
      defaultShiftMode: editingEmployee.defaultShiftMode || 'standard',
      geofenceRadiusOverrideMeters: cleanOverrideRadius,
      biometricExempt: Boolean(editingEmployee.biometricExempt),
      biometricExemptReason: editingEmployee.biometricExempt
        ? editingEmployee.biometricExemptReason?.trim() || undefined
        : undefined,
      biometricExemptUpdatedAt: editingEmployee.biometricExempt
        ? editingEmployee.biometricExemptUpdatedAt || new Date().toISOString()
        : undefined,
      biometricExemptUpdatedBy: editingEmployee.biometricExempt
        ? editingEmployee.biometricExemptUpdatedBy || currentUser?.name || 'Admin'
        : undefined,
    };

    const exemptSuffix = normalizedEmp.biometricExempt
      ? ` · ${lang === 'ar' ? 'معفى من البصمة' : 'Biometric Exempt'}`
      : '';

    if (isCreatingNew) {
      setEmployees((prev) => [...prev, normalizedEmp]);
      onLogAudit(
        lang === 'ar' ? 'إضافة موظف' : 'Added Employee',
        `${normalizedEmp.fullName} (${normalizedEmp.adminId})${exemptSuffix}`,
        'employee'
      );
      onToast('success', lang === 'ar' ? 'تمت إضافة الموظف بنجاح.' : 'Employee added.');
    } else {
      setEmployees((prev) => prev.map((emp) => (emp.id === normalizedEmp.id ? normalizedEmp : emp)));
      onLogAudit(
        lang === 'ar' ? 'تعديل بيانات موظف' : 'Updated Employee',
        `${normalizedEmp.fullName} (${normalizedEmp.adminId})${exemptSuffix}`,
        'employee'
      );
      onToast('success', lang === 'ar' ? 'تم تحديث بيانات الموظف.' : 'Employee updated.');
    }
    setEditingEmployee(null);
  };

  const executeConfirmedDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.mode === 'single' && confirmDelete.emp) {
      const target = confirmDelete.emp;
      setEmployees((prev) => prev.filter((e) => e.id !== target.id));
      onLogAudit(lang === 'ar' ? 'حذف موظف' : 'Deleted Employee', target.fullName, 'employee');
      onToast('success', lang === 'ar' ? 'تم حذف سجل الموظف.' : 'Employee deleted.');
      if (viewingEmployee?.id === target.id) setViewingEmployee(null);
    } else if (confirmDelete.mode === 'bulk') {
      const count = selectedIds.size;
      setEmployees((prev) => prev.filter((e) => !selectedIds.has(e.id)));
      setSelectedIds(new Set());
      onLogAudit(lang === 'ar' ? 'حذف جماعي للموظفين' : 'Bulk Delete Employees', `${count}`, 'employee');
      onToast('success', lang === 'ar' ? `تم حذف ${count} موظف.` : `Deleted ${count} employees.`);
    }
    setConfirmDelete(null);
  };

  const viewedEmployeeSummary = useMemo(() => {
    if (!viewingEmployee) return null;
    return getEmployeeLeaveSummary(viewingEmployee, vacations, settings, currentYear);
  }, [viewingEmployee, vacations, settings, currentYear]);

  const viewedEmployeeHistory = useMemo(() => {
    if (!viewingEmployee) return [];
    return vacations
      .filter((v) => v.employeeId === viewingEmployee.id)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [viewingEmployee, vacations]);

  return (
    <div className="space-y-4 text-[var(--text-main)]">
      {/* Header */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 ${
          embedded ? '' : 'pb-2 border-b border-[var(--border)]'
        }`}
      >
        <div>
          {embedded ? (
            <>
              <h3 className="font-display text-base font-bold text-[var(--text-main)]">
                {t(lang, 'employeesTitle')}
              </h3>
              <p className="text-xs text-[var(--text-muted)]">{t(lang, 'employeesDesc')}</p>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">
                {t(lang, 'employeesTitle')}
              </h2>
              <p className="text-sm text-[var(--text-muted)]">{t(lang, 'employeesDesc')}</p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet size={15} className="text-[var(--primary-text)]" />
            <span>{t(lang, 'downloadTemplate')}</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload size={15} className="text-[var(--primary-text)]" />
              <span>{t(lang, 'importExcel')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download size={15} />
            <span>{t(lang, 'exportExcel')}</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus size={15} />
              <span>{t(lang, 'addEmployee')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-[var(--card-bg)] p-4 rounded-xl border border-[var(--border)] flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            size={16}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
          <input
            type="text"
            placeholder={t(lang, 'searchEmployeesPlaceholder')}
            className="w-full ps-9 pe-4 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
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

        <select
          value={contractFilter}
          onChange={(e) => setContractFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
        >
          <option value="all">{t(lang, 'allContracts')}</option>
          {settings.contractTypes.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
        >
          <option value="all">{t(lang, 'allStatuses')}</option>
          <option value="Active">{lang === 'ar' ? 'على رأس العمل' : 'Active'}</option>
          <option value="On Leave">{lang === 'ar' ? 'في إجازة' : 'On Leave'}</option>
          <option value="Terminated">{lang === 'ar' ? 'منتهي الخدمة' : 'Terminated'}</option>
        </select>

        <select
          value={biometricFilter}
          onChange={(e) => setBiometricFilter(e.target.value as 'all' | 'exempt' | 'required')}
          className="px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
        >
          <option value="all">{t(lang, 'biometricExemptFilterAll')}</option>
          <option value="exempt">{t(lang, 'biometricExemptFilterOnly')}</option>
          <option value="required">{t(lang, 'biometricRequiredFilterOnly')}</option>
        </select>

        {canManage && selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => setConfirmDelete({ mode: 'bulk' })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Trash2 size={14} />
            <span>
              {t(lang, 'bulkDelete')} ({selectedIds.size})
            </span>
          </button>
        )}
      </div>

      {/* Employees Table */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
        {filteredEmployees.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <tr>
                  {canManage && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={isAllVisibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeVisibleSelected;
                        }}
                        onChange={handleSelectAll}
                        className="rounded accent-[var(--primary)]"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'employeeCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'adminIdCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'jobTitleCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'departmentCol')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'contractCol')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'remainingDays')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t(lang, 'statusCol')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t(lang, 'actionsCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredEmployees.map((emp) => {
                  const summary = getEmployeeLeaveSummary(emp, vacations, settings, currentYear);
                  return (
                    <tr
                      key={emp.id}
                      className={`hover:bg-[var(--surface-subtle)]/50 transition-colors ${
                        selectedIds.has(emp.id) ? 'bg-[var(--primary-soft)]/50' : ''
                      }`}
                    >
                      {canManage && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(emp.id)}
                            onChange={() => handleSelectRow(emp.id)}
                            className="rounded accent-[var(--primary)]"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setViewingEmployee(emp)}
                          className="flex items-center gap-3 text-start group cursor-pointer"
                        >
                          <AvatarWithFallback name={emp.fullName} sizeClass="w-8 h-8" />
                          <div>
                            <div className="font-semibold text-[var(--text-main)] group-hover:text-[var(--primary-text)] transition-colors">
                              {emp.fullName}
                            </div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {emp.location || '-'}
                              {emp.defaultShiftMode === 'flexible'
                                ? ` · ${t(lang, 'shiftFlexibleLabel')}`
                                : ''}
                              {emp.geofenceRadiusOverrideMeters
                                ? ` · ${emp.geofenceRadiusOverrideMeters}m`
                                : ''}
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-xs text-[var(--text-muted)]">
                        {emp.adminId || '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-main)]">{emp.jobTitle || '-'}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{emp.department || '-'}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-main)]">{emp.contractType || '-'}</td>
                      <td className="px-4 py-3 text-end font-mono-tabular text-xs font-semibold">
                        <span
                          className={
                            summary.status === 'exceeded'
                              ? 'text-[var(--status-danger-text)]'
                              : summary.status === 'near'
                              ? 'text-[var(--status-warn-text)]'
                              : 'text-[var(--primary-text)]'
                          }
                        >
                          {summary.remainingDays} / {summary.annualLimit}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <StatusLabel status={emp.status || 'Active'} lang={lang} />
                          {emp.biometricExempt && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--primary-text)] whitespace-nowrap">
                              <ShieldCheck size={12} className="shrink-0" />
                              <span>{t(lang, 'biometricExemptBadge')}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setViewingEmployee(emp)}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--surface-subtle)] transition-colors cursor-pointer"
                            title={t(lang, 'employeeProfile')}
                          >
                            <Eye size={15} />
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(emp)}
                                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--surface-subtle)] transition-colors cursor-pointer"
                                title={t(lang, 'editEmployee')}
                              >
                                <Edit size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete({ mode: 'single', emp })}
                                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] transition-colors cursor-pointer"
                                title={t(lang, 'deleteLabel')}
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
        ) : (
          <div className="p-12 text-center space-y-3">
            <Database size={32} className="mx-auto text-[var(--text-muted)] opacity-50" />
            <p className="text-sm font-medium text-[var(--text-muted)]">{t(lang, 'noEmployeesFound')}</p>
            {employees.length === 0 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={onLoadDemoData}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  {t(lang, 'loadSampleData')}
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                  >
                    {t(lang, 'importExcel')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Employee Detail Drawer / Modal */}
      {viewingEmployee && viewedEmployeeSummary && (
        <div className="fixed inset-0 z-[75] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <AvatarWithFallback name={viewingEmployee.fullName} sizeClass="w-11 h-11" />
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-bold text-[var(--text-main)] truncate">
                    {viewingEmployee.fullName}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    <span className="font-mono-tabular">{viewingEmployee.adminId}</span> ·{' '}
                    {viewingEmployee.jobTitle || '-'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingEmployee(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--card-bg)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div className="space-y-1">
                  <span className="text-[var(--text-muted)] flex items-center gap-1">
                    <Briefcase size={12} /> {t(lang, 'departmentCol')}
                  </span>
                  <p className="font-semibold text-[var(--text-main)]">{viewingEmployee.department || '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-muted)] flex items-center gap-1">
                    <MapPin size={12} /> {t(lang, 'assignedWorkSiteLabel')}
                  </span>
                  <p className="font-semibold text-[var(--text-main)]">{viewingEmployee.location || '-'}</p>
                  {(() => {
                    const siteObj =
                      effectiveWorkSites.find((s) => s.id === viewingEmployee.assignedWorkSiteId) ||
                      effectiveWorkSites.find(
                        (s) => s.name.trim().toLowerCase() === viewingEmployee.location.trim().toLowerCase()
                      );
                    if (!siteObj) return null;
                    return (
                      <p className="text-[10px] font-mono-tabular text-[var(--text-muted)]">
                        {siteObj.lat.toFixed(4)}, {siteObj.lng.toFixed(4)} ·{' '}
                        {viewingEmployee.geofenceRadiusOverrideMeters ?? siteObj.radiusMeters}m
                      </p>
                    );
                  })()}
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-muted)] flex items-center gap-1">
                    <Clock size={12} /> {t(lang, 'defaultShiftModeLabel')}
                  </span>
                  <p className="font-semibold text-[var(--text-main)]">
                    {viewingEmployee.defaultShiftMode === 'flexible'
                      ? t(lang, 'shiftFlexibleLabel')
                      : t(lang, 'shiftStandardLabel')}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-muted)]">{t(lang, 'contractCol')}</span>
                  <p className="font-semibold text-[var(--text-main)]">{viewingEmployee.contractType}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-muted)] flex items-center gap-1">
                    <UserCheck size={12} /> {t(lang, 'directManager')}
                  </span>
                  <p className="font-semibold text-[var(--text-main)]">{viewingEmployee.directManager || '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-muted)]">{t(lang, 'hireDate')}</span>
                  <p className="font-mono-tabular font-semibold text-[var(--text-main)]">
                    {viewingEmployee.hireDate || '-'} ({calculateTenure(viewingEmployee.hireDate, lang)})
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[var(--text-muted)]">{t(lang, 'statusCol')}</span>
                  <div>
                    <StatusLabel status={viewingEmployee.status || 'Active'} lang={lang} />
                  </div>
                </div>
                {viewingEmployee.allowedWorkSites && viewingEmployee.allowedWorkSites.length > 0 && (
                  <div className="space-y-1 sm:col-span-3">
                    <span className="text-[var(--text-muted)] flex items-center gap-1">
                      <Crosshair size={12} /> {t(lang, 'allowedWorkSitesLabel')}
                    </span>
                    <p className="font-medium text-[var(--text-main)]">
                      {viewingEmployee.allowedWorkSites.join(' · ')}
                    </p>
                  </div>
                )}
                <div className="space-y-1 sm:col-span-2">
                  <span className="text-[var(--text-muted)] flex items-center gap-1">
                    <ShieldCheck size={12} /> {t(lang, 'biometricStatusCol')}
                  </span>
                  {viewingEmployee.biometricExempt ? (
                    <div className="space-y-0.5">
                      <p className="font-semibold text-[var(--primary-text)]">
                        {t(lang, 'biometricExemptBadge')}
                      </p>
                      {viewingEmployee.biometricExemptReason && (
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {viewingEmployee.biometricExemptReason}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="font-medium text-[var(--text-main)]">
                      {t(lang, 'biometricRequiredBadge')}
                    </p>
                  )}
                </div>
                {(viewingEmployee.phone || viewingEmployee.email) && (
                  <>
                    <div className="space-y-1">
                      <span className="text-[var(--text-muted)] flex items-center gap-1">
                        <Phone size={12} /> {t(lang, 'phone')}
                      </span>
                      <p className="font-mono-tabular text-[var(--text-main)]">{viewingEmployee.phone || '-'}</p>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <span className="text-[var(--text-muted)] flex items-center gap-1">
                        <Mail size={12} /> {t(lang, 'email')}
                      </span>
                      <p className="font-mono-tabular text-[var(--text-main)]">{viewingEmployee.email || '-'}</p>
                    </div>
                  </>
                )}
              </div>

              {/* Annual Leave Balance Ledger */}
              <div className="pt-5 border-t border-[var(--border)] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-sm font-bold text-[var(--text-main)]">
                    {t(lang, 'balanceSnapshot')} ({currentYear})
                  </h4>
                  <span className="text-xs font-mono-tabular font-semibold text-[var(--primary-text)]">
                    {viewedEmployeeSummary.utilizationPercent}%
                  </span>
                </div>
                <div className="h-2.5 bg-[var(--surface-subtle)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--primary)] rounded-full"
                    style={{ width: `${viewedEmployeeSummary.utilizationPercent}%` }}
                  />
                </div>
                <div className="grid grid-cols-4 gap-3 text-center pt-1">
                  <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)]">
                    <div className="text-[11px] text-[var(--text-muted)]">{t(lang, 'annualQuota')}</div>
                    <div className="font-mono-tabular font-bold text-base text-[var(--text-main)]">
                      {viewedEmployeeSummary.annualLimit}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)]">
                    <div className="text-[11px] text-[var(--text-muted)]">{t(lang, 'usedDays')}</div>
                    <div className="font-mono-tabular font-bold text-base text-[var(--text-main)]">
                      {viewedEmployeeSummary.approvedDays}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)]">
                    <div className="text-[11px] text-[var(--text-muted)]">{t(lang, 'pendingDaysCol')}</div>
                    <div className="font-mono-tabular font-bold text-base text-[var(--status-warn-text)]">
                      {viewedEmployeeSummary.pendingDays}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--primary-soft)]">
                    <div className="text-[11px] text-[var(--primary-text)]">{t(lang, 'remainingDays')}</div>
                    <div className="font-mono-tabular font-bold text-base text-[var(--primary-text)]">
                      {viewedEmployeeSummary.remainingDays}
                    </div>
                  </div>
                </div>
              </div>

              {/* Vacation History */}
              <div className="pt-5 border-t border-[var(--border)] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-sm font-bold text-[var(--text-main)]">
                    {t(lang, 'leaveHistory')} ({viewedEmployeeHistory.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const id = viewingEmployee.id;
                      setViewingEmployee(null);
                      onOpenNewLeaveForEmployee(id);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
                  >
                    <CalendarPlus size={14} />
                    <span>{t(lang, 'createLeaveForEmp')}</span>
                  </button>
                </div>

                {viewedEmployeeHistory.length > 0 ? (
                  <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
                    {viewedEmployeeHistory.map((v) => (
                      <div key={v.id} className="px-4 py-2.5 flex items-center justify-between text-xs gap-4">
                        <div>
                          <div className="font-semibold text-[var(--text-main)]">
                            {translateVacationType(v.type, lang)}
                          </div>
                          <div className="font-mono-tabular text-[var(--text-muted)]">
                            {v.startDate} → {v.endDate} ({v.days} {t(lang, 'workDays')})
                          </div>
                        </div>
                        <StatusLabel status={v.status} lang={lang} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)] py-3">{t(lang, 'noVacationsFound')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Add/Edit Employee Modal */}
      {editingEmployee && (
        <div className="fixed inset-0 z-[75] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold text-[var(--text-main)]">
                {isCreatingNew ? t(lang, 'newEmployee') : t(lang, 'editEmployee')}
              </h3>
              <button
                type="button"
                onClick={() => setEditingEmployee(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'fullName')} *
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.fullName}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, fullName: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'adminIdCol')} *
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.adminId}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, adminId: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'serialNo')}
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.serialNo || ''}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, serialNo: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'jobTitleCol')}
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.jobTitle}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, jobTitle: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'departmentCol')}
                  </label>
                  <input
                    type="text"
                    list="employeeOrgUnitsList"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.department}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, department: e.target.value })}
                  />
                  <datalist id="employeeOrgUnitsList">
                    {departments.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'contractCol')}
                  </label>
                  <select
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.contractType}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, contractType: e.target.value })}
                  >
                    {settings.contractTypes.map((ct) => (
                      <option key={ct.id} value={ct.name}>
                        {ct.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'statusCol')}
                  </label>
                  <select
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.status}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, status: e.target.value })}
                  >
                    <option value="Active">{lang === 'ar' ? 'على رأس العمل' : 'Active'}</option>
                    <option value="On Leave">{lang === 'ar' ? 'في إجازة' : 'On Leave'}</option>
                    <option value="Terminated">{lang === 'ar' ? 'منتهي الخدمة' : 'Terminated'}</option>
                    <option value="Resigned">{lang === 'ar' ? 'مستقيل' : 'Resigned'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'hireDate')}
                  </label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.hireDate}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, hireDate: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'directManager')}
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.directManager}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, directManager: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'phone')}
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.phone || ''}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, phone: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'email')}
                  </label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                    value={editingEmployee.email || ''}
                    onChange={(e) => setEditingEmployee({ ...editingEmployee, email: e.target.value })}
                  />
                </div>

                {/* Linked Work Site & Attendance Properties Panel */}
                <div className="sm:col-span-2 p-4 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] space-y-3.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-[var(--primary-text)] border-b border-[var(--border)] pb-2">
                    <MapPin size={15} />
                    <span>{t(lang, 'employeeAttendancePropsTitle')}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'assignedWorkSiteLabel')}
                      </label>
                      <select
                        value={
                          effectiveWorkSites.some(
                            (s) =>
                              s.id === editingEmployee.assignedWorkSiteId ||
                              s.name.trim().toLowerCase() === editingEmployee.location.trim().toLowerCase()
                          )
                            ? (
                                effectiveWorkSites.find((s) => s.id === editingEmployee.assignedWorkSiteId) ||
                                effectiveWorkSites.find(
                                  (s) =>
                                    s.name.trim().toLowerCase() === editingEmployee.location.trim().toLowerCase()
                                )
                              )?.name || ''
                            : '__custom__'
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__custom__') {
                            setEditingEmployee({
                              ...editingEmployee,
                              assignedWorkSiteId: undefined,
                            });
                            return;
                          }
                          const found = effectiveWorkSites.find((s) => s.name === val);
                          setEditingEmployee({
                            ...editingEmployee,
                            location: val,
                            assignedWorkSiteId: found?.id,
                          });
                        }}
                        className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                      >
                        {effectiveWorkSites.map((site) => (
                          <option key={site.id} value={site.name}>
                            {site.name} ({site.radiusMeters}m)
                          </option>
                        ))}
                        <option value="__custom__">
                          {lang === 'ar' ? 'إدخال موقع مخصص يدوياً...' : 'Custom site name...'}
                        </option>
                      </select>

                      {!effectiveWorkSites.some(
                        (s) =>
                          s.id === editingEmployee.assignedWorkSiteId ||
                          s.name.trim().toLowerCase() === editingEmployee.location.trim().toLowerCase()
                      ) && (
                        <input
                          type="text"
                          placeholder={lang === 'ar' ? 'اسم الموقع المخصص...' : 'Custom work site...'}
                          value={editingEmployee.location}
                          onChange={(e) =>
                            setEditingEmployee({
                              ...editingEmployee,
                              location: e.target.value,
                              assignedWorkSiteId: undefined,
                            })
                          }
                          className="mt-2 w-full px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                        />
                      )}

                      {(() => {
                        const matched =
                          effectiveWorkSites.find((s) => s.id === editingEmployee.assignedWorkSiteId) ||
                          effectiveWorkSites.find(
                            (s) => s.name.trim().toLowerCase() === editingEmployee.location.trim().toLowerCase()
                          );
                        if (!matched) return null;
                        return (
                          <p className="mt-1 text-[10px] font-mono-tabular text-[var(--text-muted)]">
                            GPS: {matched.lat.toFixed(4)}, {matched.lng.toFixed(4)} · {matched.radiusMeters}m
                          </p>
                        );
                      })()}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'defaultShiftModeLabel')}
                        </label>
                        <select
                          value={editingEmployee.defaultShiftMode || 'standard'}
                          onChange={(e) =>
                            setEditingEmployee({
                              ...editingEmployee,
                              defaultShiftMode: e.target.value as ShiftMode,
                            })
                          }
                          className="w-full px-2.5 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                        >
                          <option value="standard">
                            {t(lang, 'shiftStandardLabel')} ({getShiftScheduleBounds('standard', settings.attendanceConfig).start})
                          </option>
                          <option value="flexible">
                            {t(lang, 'shiftFlexibleLabel')} ({getShiftScheduleBounds('flexible', settings.attendanceConfig).start})
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'geofenceOverrideLabel')}
                        </label>
                        <input
                          type="number"
                          min={25}
                          max={5000}
                          step={25}
                          placeholder={lang === 'ar' ? 'افتراضي الموقع' : 'Site default'}
                          value={editingEmployee.geofenceRadiusOverrideMeters ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEditingEmployee({
                              ...editingEmployee,
                              geofenceRadiusOverrideMeters: v ? Number(v) : undefined,
                            });
                          }}
                          className="w-full px-2.5 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                    </div>
                  </div>

                  {effectiveWorkSites.length > 1 && (
                    <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
                      <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                        {t(lang, 'allowedWorkSitesLabel')}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {effectiveWorkSites
                          .filter(
                            (s) => s.name.trim().toLowerCase() !== editingEmployee.location.trim().toLowerCase()
                          )
                          .map((site) => {
                            const checked = (editingEmployee.allowedWorkSites || []).includes(site.name);
                            return (
                              <label
                                key={site.id}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] cursor-pointer transition-colors ${
                                  checked
                                    ? 'bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary-text)] font-semibold'
                                    : 'bg-[var(--card-bg)] border-[var(--border)] text-[var(--text-muted)]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const current = editingEmployee.allowedWorkSites || [];
                                    const next = e.target.checked
                                      ? [...current, site.name]
                                      : current.filter((x) => x !== site.name);
                                    setEditingEmployee({
                                      ...editingEmployee,
                                      allowedWorkSites: next,
                                    });
                                  }}
                                  className="rounded accent-[var(--primary)]"
                                />
                                <span>{site.name}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-[var(--border)] space-y-2.5">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={Boolean(editingEmployee.biometricExempt)}
                        onChange={(e) =>
                          setEditingEmployee({
                            ...editingEmployee,
                            biometricExempt: e.target.checked,
                            biometricExemptUpdatedAt: new Date().toISOString(),
                            biometricExemptUpdatedBy: currentUser?.name || 'Admin',
                          })
                        }
                        className="rounded accent-[var(--primary)]"
                      />
                      <ShieldCheck size={14} className="text-[var(--primary-text)] shrink-0" />
                      <span>{t(lang, 'biometricExemptToggleLabel')}</span>
                    </label>

                    {editingEmployee.biometricExempt && (
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          {t(lang, 'biometricExemptReasonLabel')} {t(lang, 'optionalLabel')}
                        </label>
                        <input
                          type="text"
                          placeholder={t(lang, 'biometricExemptReasonPlaceholder')}
                          className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
                          value={editingEmployee.biometricExemptReason || ''}
                          onChange={(e) =>
                            setEditingEmployee({ ...editingEmployee, biometricExemptReason: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingEmployee(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-main)] hover:bg-[var(--surface-subtle)] cursor-pointer"
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

      {/* Excel Import Preview Modal */}
      {importPreview && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold text-[var(--text-main)]">
                {t(lang, 'importPreviewTitle')} ({importPreview.totalRows})
              </h3>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)]">
                  <div className="font-mono-tabular text-xl font-bold">{importPreview.newEmployees.length}</div>
                  <div className="text-xs">{t(lang, 'validNewRows')}</div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--status-warn-bg)] text-[var(--status-warn-text)] border border-[var(--status-warn-border)]">
                  <div className="font-mono-tabular text-xl font-bold">{importPreview.duplicateMatches.length}</div>
                  <div className="text-xs">{t(lang, 'duplicateRows')}</div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)]">
                  <div className="font-mono-tabular text-xl font-bold">{importPreview.invalid}</div>
                  <div className="text-xs">{t(lang, 'invalidRows')}</div>
                </div>
              </div>

              {importPreview.duplicateMatches.length > 0 && (
                <label className="flex items-center gap-2.5 p-3 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)] cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={updateDuplicates}
                    onChange={(e) => setUpdateDuplicates(e.target.checked)}
                    className="rounded accent-[var(--primary)]"
                  />
                  <span className="font-medium text-[var(--text-main)]">{t(lang, 'updateExistingToggle')}</span>
                </label>
              )}

              {importPreview.detectedHeaders.length > 0 && (
                <div className="text-xs text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text-main)]">{t(lang, 'detectedColumns')}: </span>
                  {importPreview.detectedHeaders.join(' · ')}
                </div>
              )}

              <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                <table className="w-full text-xs text-start">
                  <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-[var(--text-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-start">{t(lang, 'fullName')}</th>
                      <th className="px-3 py-2 text-start">{t(lang, 'adminIdCol')}</th>
                      <th className="px-3 py-2 text-start">{t(lang, 'departmentCol')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {[...importPreview.newEmployees, ...importPreview.duplicateMatches]
                      .slice(0, 12)
                      .map((emp) => (
                        <tr key={emp.id}>
                          <td className="px-3 py-2 font-medium">{emp.fullName}</td>
                          <td className="px-3 py-2 font-mono-tabular">{emp.adminId}</td>
                          <td className="px-3 py-2 text-[var(--text-muted)]">{emp.department || '-'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-subtle)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-main)] hover:bg-[var(--card-bg)] cursor-pointer"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="button"
                onClick={confirmImport}
                className="px-5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
              >
                {t(lang, 'confirmImport')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={t(lang, 'confirmActionTitle')}
        message={
          confirmDelete?.mode === 'bulk'
            ? lang === 'ar'
              ? `هل أنت متأكد من حذف ${selectedIds.size} موظف؟`
              : `Delete ${selectedIds.size} selected employees?`
            : lang === 'ar'
            ? `هل أنت متأكد من حذف الموظف "${confirmDelete?.emp?.fullName}"؟`
            : `Delete employee "${confirmDelete?.emp?.fullName}"?`
        }
        confirmText={t(lang, 'deleteLabel')}
        cancelText={t(lang, 'cancel')}
        onConfirm={executeConfirmedDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};

export default EmployeeManager;