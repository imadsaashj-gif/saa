import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  Clock,
  Crosshair,
  Edit,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import {
  AttendanceRecord,
  AttendanceSettings,
  Employee,
  Language,
  RectificationStatus,
  ShiftMode,
  SystemSettings,
  WorkSiteLocation,
  generateId,
} from '../types';
import { t } from '../i18n';
import { DEFAULT_ATTENDANCE_SETTINGS } from '../data/seedData';
import {
  evaluateAttendanceEntry,
  formatAttendanceDuration,
  formatDistanceLabel,
  getEffectiveWorkSiteLocations,
  getShiftScheduleBounds,
} from '../utils/attendanceCalculations';
import { acquireSmartLocation } from '../utils/geolocation';
import { formatReadableDate, getTodayStr } from '../utils/leaveCalculations';
import { ConfirmDialog } from './UIPrimitives';
import InteractiveGeoMap from './InteractiveGeoMap';

interface AttendanceAdminTabProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  employees: Employee[];
  setEmployees?: React.Dispatch<React.SetStateAction<Employee[]>>;
  attendanceRecords: AttendanceRecord[];
  setAttendanceRecords?: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  lang: Language;
  currentUserName?: string;
  onLogAudit: (action: string, details: string, category: 'settings' | 'system') => void;
  onToast: (type: 'success' | 'error' | 'warning' | 'info', text: string) => void;
}

const AttendanceAdminTab: React.FC<AttendanceAdminTabProps> = ({
  settings,
  setSettings,
  employees,
  setEmployees,
  attendanceRecords,
  setAttendanceRecords,
  lang,
  currentUserName,
  onLogAudit,
  onToast,
}) => {
  const [form, setForm] = useState<AttendanceSettings>(() => {
    const merged: AttendanceSettings = {
      ...DEFAULT_ATTENDANCE_SETTINGS,
      ...(settings.attendanceConfig || {}),
    };
    return {
      ...merged,
      workSiteLocations: getEffectiveWorkSiteLocations(merged),
    };
  });

  useEffect(() => {
    const merged: AttendanceSettings = {
      ...DEFAULT_ATTENDANCE_SETTINGS,
      ...(settings.attendanceConfig || {}),
    };
    setForm({
      ...merged,
      workSiteLocations: getEffectiveWorkSiteLocations(merged),
    });
  }, [settings.attendanceConfig]);

  const [newWorkSite, setNewWorkSite] = useState('');
  const [newGate, setNewGate] = useState('');
  const [editingSite, setEditingSite] = useState<{ original: string; value: string } | null>(null);
  const [editingGate, setEditingGate] = useState<{ original: string; value: string } | null>(null);
  const [selectedMapSiteName, setSelectedMapSiteName] = useState<string>(
    () => settings.attendanceConfig?.approvedWorkSites?.[0] || DEFAULT_ATTENDANCE_SETTINGS.approvedWorkSites[0] || ''
  );
  const [mapFocusTrigger, setMapFocusTrigger] = useState(0);
  const [isRenewingGps, setIsRenewingGps] = useState(false);
  const gpsCancelRef = useRef<(() => void) | null>(null);

  const [geoSearchQuery, setGeoSearchQuery] = useState('');
  const [isSearchingGeo, setIsSearchingGeo] = useState(false);
  const [geoSearchResults, setGeoSearchResults] = useState<
    Array<{ displayName: string; lat: number; lng: number }>
  >([]);
  const [geoSearchError, setGeoSearchError] = useState('');

  const [exemptEmpId, setExemptEmpId] = useState<string>(employees[0]?.id || '');
  const [exemptReasonInput, setExemptReasonInput] = useState<string>('');
  const [propWorkSiteName, setPropWorkSiteName] = useState<string>('');
  const [propAllowedSites, setPropAllowedSites] = useState<string[]>([]);
  const [propShiftMode, setPropShiftMode] = useState<ShiftMode>('standard');
  const [propRadiusOverride, setPropRadiusOverride] = useState<string>('');
  const [propBiometricExempt, setPropBiometricExempt] = useState<boolean>(false);
  const [propSearch, setPropSearch] = useState<string>('');
  const [recordSearch, setRecordSearch] = useState('');

  useEffect(() => {
    return () => {
      gpsCancelRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!exemptEmpId && employees[0]) {
      setExemptEmpId(employees[0].id);
    }
  }, [employees, exemptEmpId]);

  const exemptEmployees = useMemo(
    () => employees.filter((e) => Boolean(e.biometricExempt)),
    [employees]
  );

  const selectedPropEmployee = useMemo(
    () => employees.find((e) => e.id === exemptEmpId) || null,
    [employees, exemptEmpId]
  );

  useEffect(() => {
    if (!selectedPropEmployee) return;
    setPropWorkSiteName(selectedPropEmployee.location || '');
    setPropAllowedSites(selectedPropEmployee.allowedWorkSites || []);
    setPropShiftMode(selectedPropEmployee.defaultShiftMode || 'standard');
    setPropRadiusOverride(
      selectedPropEmployee.geofenceRadiusOverrideMeters !== undefined
        ? String(selectedPropEmployee.geofenceRadiusOverrideMeters)
        : ''
    );
    setPropBiometricExempt(Boolean(selectedPropEmployee.biometricExempt));
    setExemptReasonInput(selectedPropEmployee.biometricExemptReason || '');
  }, [selectedPropEmployee]);

  // Modal for adding or editing any attendance record field
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [isCreatingRecord, setIsCreatingRecord] = useState(false);
  const [recEmpId, setRecEmpId] = useState(employees[0]?.id || '');
  const [recDate, setRecDate] = useState(getTodayStr());
  const [recShiftMode, setRecShiftMode] = useState<ShiftMode>('standard');
  const [recCheckIn, setRecCheckIn] = useState('07:00');
  const [recCheckOut, setRecCheckOut] = useState('15:00');
  const [recWorkSite, setRecWorkSite] = useState('');
  const [recEntryLocation, setRecEntryLocation] = useState('');
  const [recExitLocation, setRecExitLocation] = useState('');
  const [recManualOvertime, setRecManualOvertime] = useState<string>('');
  const [recRegStatus, setRecRegStatus] = useState<RectificationStatus>('None');
  const [recWarningNote, setRecWarningNote] = useState('');
  const [recNotes, setRecNotes] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const effectiveWorkSites = useMemo(() => getEffectiveWorkSiteLocations(form), [form]);
  const activeMapSite = useMemo(
    () =>
      effectiveWorkSites.find((s) => s.name === selectedMapSiteName) ||
      effectiveWorkSites[0] ||
      null,
    [effectiveWorkSites, selectedMapSiteName]
  );

  useEffect(() => {
    if (!effectiveWorkSites.some((s) => s.name === selectedMapSiteName) && effectiveWorkSites[0]) {
      setSelectedMapSiteName(effectiveWorkSites[0].name);
    }
  }, [effectiveWorkSites, selectedMapSiteName]);

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: AttendanceSettings = {
      ...form,
      graceMinutes: Math.max(0, Number(form.graceMinutes) || 0),
      overtimeThresholdMinutes: Math.max(0, Number(form.overtimeThresholdMinutes) || 0),
      overtimeMultiplier: Math.max(1, Number(form.overtimeMultiplier) || 1),
      defaultGeofenceRadiusMeters: Math.max(25, Number(form.defaultGeofenceRadiusMeters) || 250),
      enforceGeofenceForEmployees: form.enforceGeofenceForEmployees ?? true,
      workSiteLocations: effectiveWorkSites,
    };
    setSettings((prev) => ({
      ...prev,
      attendanceConfig: cleaned,
    }));
    onLogAudit(
      lang === 'ar' ? 'تحديث إعدادات إدارة الحضور والإنصراف' : 'Updated Attendance Management Settings',
      `${cleaned.standardStart}–${cleaned.standardEnd} | Flex: ${cleaned.flexibleStart}–${cleaned.flexibleEnd} | Overtime >=${cleaned.overtimeThresholdMinutes}m (x${cleaned.overtimeMultiplier}) | Geofence=${cleaned.enforceGeofenceForEmployees ? 'ON' : 'OFF'}`,
      'settings'
    );
    onToast(
      'success',
      lang === 'ar'
        ? 'تم حفظ كافة إعدادات إدارة الحضور والإنصراف والخريطة بنجاح.'
        : 'Attendance management & geofence settings saved successfully.'
    );
  };

  const syncAttendanceLocations = (
    nextSites: string[],
    nextGates: string[],
    nextSiteLocations?: WorkSiteLocation[]
  ) => {
    const resolvedLocations =
      nextSiteLocations ??
      getEffectiveWorkSiteLocations({
        ...form,
        approvedWorkSites: nextSites,
        approvedGates: nextGates,
      });

    setForm((prev) => ({
      ...prev,
      approvedWorkSites: nextSites,
      approvedGates: nextGates,
      workSiteLocations: resolvedLocations,
    }));

    setSettings((prev) => ({
      ...prev,
      attendanceConfig: {
        ...DEFAULT_ATTENDANCE_SETTINGS,
        ...(prev.attendanceConfig || {}),
        ...form,
        approvedWorkSites: nextSites,
        approvedGates: nextGates,
        workSiteLocations: resolvedLocations,
      },
    }));
  };

  const handleAddWorkSite = () => {
    const val = newWorkSite.trim();
    if (!val) return;
    if (form.approvedWorkSites.some((s) => s.trim().toLowerCase() === val.toLowerCase())) {
      onToast('error', lang === 'ar' ? 'موقع العمل موجود مسبقاً.' : 'Work site already exists.');
      return;
    }
    const nextSites = [...form.approvedWorkSites, val];
    const anchor = activeMapSite || effectiveWorkSites[0];
    const nextLocations: WorkSiteLocation[] = [
      ...effectiveWorkSites,
      {
        id: `ws-${generateId().slice(0, 8)}`,
        name: val,
        lat: anchor ? Number((anchor.lat + 0.0015).toFixed(6)) : 32.895,
        lng: anchor ? Number((anchor.lng + 0.0015).toFixed(6)) : 13.18,
        radiusMeters: Math.max(25, Number(form.defaultGeofenceRadiusMeters) || 250),
        defaultGate: form.approvedGates[0] || 'البوابة الرئيسية',
        updatedAt: new Date().toISOString(),
        updatedBy: currentUserName || 'Admin',
      },
    ];
    syncAttendanceLocations(nextSites, form.approvedGates, nextLocations);
    setSelectedMapSiteName(val);
    setNewWorkSite('');
    onLogAudit(lang === 'ar' ? 'إضافة موقع عمل معتمد' : 'Added Work Site', val, 'settings');
    onToast('success', lang === 'ar' ? `تمت إضافة موقع العمل "${val}".` : `Added work site "${val}".`);
  };

  const handleSaveEditWorkSite = () => {
    if (!editingSite) return;
    const trimmed = editingSite.value.trim();
    const original = editingSite.original;
    if (!trimmed) {
      onToast('error', lang === 'ar' ? 'يرجى إدخال اسم موقع العمل.' : 'Work site name cannot be empty.');
      return;
    }
    if (trimmed === original) {
      setEditingSite(null);
      return;
    }
    if (
      form.approvedWorkSites.some(
        (s) => s !== original && s.trim().toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      onToast('error', lang === 'ar' ? 'يوجد موقع عمل آخر بنفس الاسم.' : 'Another work site has this name.');
      return;
    }
    const renamedSiteObj = effectiveWorkSites.find((loc) => loc.name === original);
    const nextSites = form.approvedWorkSites.map((s) => (s === original ? trimmed : s));
    const nextLocations = effectiveWorkSites.map((loc) =>
      loc.name === original ? { ...loc, name: trimmed, updatedAt: new Date().toISOString() } : loc
    );
    syncAttendanceLocations(nextSites, form.approvedGates, nextLocations);
    if (selectedMapSiteName === original) {
      setSelectedMapSiteName(trimmed);
    }

    if (setAttendanceRecords) {
      setAttendanceRecords((prev) =>
        prev.map((r) => (r.workSite === original ? { ...r, workSite: trimmed } : r))
      );
    }

    if (setEmployees) {
      setEmployees((prev) =>
        prev.map((emp) => {
          const matchesPrimary =
            emp.location === original || (renamedSiteObj && emp.assignedWorkSiteId === renamedSiteObj.id);
          const matchesAllowed = emp.allowedWorkSites?.includes(original);
          if (!matchesPrimary && !matchesAllowed) return emp;
          return {
            ...emp,
            location: matchesPrimary ? trimmed : emp.location,
            assignedWorkSiteId: matchesPrimary && renamedSiteObj ? renamedSiteObj.id : emp.assignedWorkSiteId,
            allowedWorkSites: matchesAllowed
              ? emp.allowedWorkSites?.map((s) => (s === original ? trimmed : s))
              : emp.allowedWorkSites,
          };
        })
      );
    }

    onLogAudit(
      lang === 'ar' ? 'تعديل اسم موقع العمل المعتمد' : 'Renamed Approved Work Site',
      `${original} → ${trimmed}`,
      'settings'
    );
    onToast(
      'success',
      lang === 'ar' ? `تم تعديل موقع العمل إلى "${trimmed}" ومزامنته مع الموظفين.` : `Work site updated to "${trimmed}".`
    );
    setEditingSite(null);
  };

  const handleRemoveWorkSite = (site: string) => {
    const nextSites = form.approvedWorkSites.filter((s) => s !== site);
    const nextLocations = effectiveWorkSites.filter((loc) => loc.name !== site);
    syncAttendanceLocations(nextSites, form.approvedGates, nextLocations);
    if (editingSite?.original === site) setEditingSite(null);
    if (selectedMapSiteName === site) setSelectedMapSiteName(nextSites[0] || '');
  };

  const handleUpdateSiteCoordinates = (
    siteName: string,
    lat: number,
    lng: number,
    source: 'map' | 'gps',
    accuracyMeters?: number,
    silent = false
  ) => {
    const nextLocations = effectiveWorkSites.map((loc) =>
      loc.name === siteName
        ? {
            ...loc,
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            updatedAt: new Date().toISOString(),
            updatedBy: currentUserName || 'Admin',
          }
        : loc
    );
    syncAttendanceLocations(form.approvedWorkSites, form.approvedGates, nextLocations);
    if (!silent) {
      onLogAudit(
        source === 'gps'
          ? lang === 'ar'
            ? 'تجديد موقع المكتب عبر GPS'
            : 'Renewed Office Pin via GPS'
          : lang === 'ar'
          ? 'تحديد إحداثيات موقع العمل من الخريطة'
          : 'Updated Work Site Map Pin',
        `${siteName} (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        'settings'
      );
      onToast(
        'success',
        source === 'gps'
          ? lang === 'ar'
            ? `تم تجديد إحداثيات "${siteName}" عبر GPS الحالي${
                accuracyMeters ? ` (دقة ±${accuracyMeters} م)` : ''
              }.`
            : `Renewed "${siteName}" coordinates via live GPS${
                accuracyMeters ? ` (±${accuracyMeters}m)` : ''
              }.`
          : lang === 'ar'
          ? `تم تحديث نقطة المكتب "${siteName}" على الخريطة.`
          : `Updated map coordinates for "${siteName}".`
      );
    }
  };

  const handleUpdateSiteGeofenceConfig = (
    siteName: string,
    patch: { radiusMeters?: number; defaultGate?: string }
  ) => {
    const nextLocations = effectiveWorkSites.map((loc) =>
      loc.name === siteName
        ? {
            ...loc,
            ...patch,
            radiusMeters:
              patch.radiusMeters !== undefined
                ? Math.max(25, Math.min(5000, Math.round(patch.radiusMeters) || 250))
                : loc.radiusMeters,
            updatedAt: new Date().toISOString(),
          }
        : loc
    );
    syncAttendanceLocations(form.approvedWorkSites, form.approvedGates, nextLocations);
  };

  const handleRenewActiveSiteViaGps = () => {
    if (!activeMapSite) return;
    gpsCancelRef.current?.();
    setIsRenewingGps(true);

    const targetSiteName = activeMapSite.name;
    let gotNativeFix = false;
    let gotIpFallback = false;

    gpsCancelRef.current = acquireSmartLocation({
      lang,
      onFix: (fix) => {
        if (fix.source === 'ip-fallback') {
          if (gotNativeFix) return;
          gotIpFallback = true;
          handleUpdateSiteCoordinates(
            targetSiteName,
            fix.lat,
            fix.lng,
            'gps',
            fix.accuracyMeters,
            true
          );
          setMapFocusTrigger((c) => c + 1);
          onToast(
            'warning',
            lang === 'ar'
              ? `تم تقريب إحداثيات "${targetSiteName}" عبر الشبكة (${
                  fix.cityLabel || 'IP'
                }). اضغط على الموقع الدقيق على الخريطة أو ابحث بالاسم للتثبيت.`
              : `Approximate location loaded for "${targetSiteName}" (${
                  fix.cityLabel || 'IP'
                }). Click the map or search above to refine the exact office pin.`
          );
        } else {
          const isUpgrade = gotNativeFix;
          gotNativeFix = true;
          handleUpdateSiteCoordinates(
            targetSiteName,
            fix.lat,
            fix.lng,
            'gps',
            fix.accuracyMeters,
            isUpgrade
          );
          setMapFocusTrigger((c) => c + 1);
        }
      },
      onDiagnostic: (diag) => {
        if (!gotNativeFix && !gotIpFallback) {
          onToast('error', lang === 'ar' ? diag.messageAr : diag.messageEn);
        }
      },
      onComplete: () => {
        setIsRenewingGps(false);
      },
    });
  };

  const handleGeoPlaceSearch = async () => {
    const q = geoSearchQuery.trim();
    if (q.length < 2) return;
    setIsSearchingGeo(true);
    setGeoSearchError('');
    try {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = (await res.json()) as {
        results?: Array<{ displayName: string; lat: number; lng: number }>;
      };
      const items = Array.isArray(data.results) ? data.results : [];
      setGeoSearchResults(items);
      if (items.length === 0) {
        setGeoSearchError(t(lang, 'geoSearchNoResults'));
      }
    } catch {
      setGeoSearchResults([]);
      setGeoSearchError(t(lang, 'geoSearchNoResults'));
    } finally {
      setIsSearchingGeo(false);
    }
  };

  const handleSaveEmployeeAttendanceProps = () => {
    if (!setEmployees || !exemptEmpId) return;
    const targetEmp = employees.find((e) => e.id === exemptEmpId);
    if (!targetEmp) return;

    const cleanPrimary = propWorkSiteName.trim() || targetEmp.location;
    const matchedSite = effectiveWorkSites.find(
      (s) => s.name.trim().toLowerCase() === cleanPrimary.toLowerCase()
    );
    const cleanAllowed = Array.from<string>(
      new Set(propAllowedSites.map((s) => s.trim()).filter(Boolean))
    ).filter((s) => s.toLowerCase() !== cleanPrimary.toLowerCase());
    const radiusVal = Number(propRadiusOverride);
    const cleanRadius =
      propRadiusOverride.trim() !== '' && !isNaN(radiusVal) && radiusVal >= 25
        ? Math.min(5000, Math.round(radiusVal))
        : undefined;
    const cleanReason = exemptReasonInput.trim();
    const nowIso = new Date().toISOString();

    setEmployees((prev) =>
      prev.map((emp) =>
        emp.id === exemptEmpId
          ? {
              ...emp,
              location: cleanPrimary,
              assignedWorkSiteId: matchedSite?.id,
              allowedWorkSites: cleanAllowed.length > 0 ? cleanAllowed : undefined,
              defaultShiftMode: propShiftMode,
              geofenceRadiusOverrideMeters: cleanRadius,
              biometricExempt: propBiometricExempt,
              biometricExemptReason: propBiometricExempt
                ? cleanReason || emp.biometricExemptReason || undefined
                : undefined,
              biometricExemptUpdatedAt: nowIso,
              biometricExemptUpdatedBy: currentUserName || 'Admin',
            }
          : emp
      )
    );

    onLogAudit(
      lang === 'ar' ? 'تحديث خصائص الحضور وموقع العمل للموظف' : 'Updated Employee Attendance & Site Properties',
      `${targetEmp.fullName} · ${cleanPrimary} (${propShiftMode}${cleanRadius ? `, ${cleanRadius}m` : ''}${
        propBiometricExempt ? ', Biometric Exempt' : ''
      })`,
      'settings'
    );
    onToast(
      'success',
      lang === 'ar'
        ? `تم حفظ موقع العمل وخصائص الحضور للموظف ${targetEmp.fullName} ومزامنتها.`
        : `Saved attendance & work site properties for ${targetEmp.fullName}.`
    );
  };

  const handleRevokeBiometricExemption = (emp: Employee) => {
    if (!setEmployees) return;
    const nowIso = new Date().toISOString();
    setEmployees((prev) =>
      prev.map((item) =>
        item.id === emp.id
          ? {
              ...item,
              biometricExempt: false,
              biometricExemptReason: undefined,
              biometricExemptUpdatedAt: nowIso,
              biometricExemptUpdatedBy: currentUserName || 'Admin',
            }
          : item
      )
    );
    onLogAudit(
      lang === 'ar' ? 'إلغاء إعفاء موظف من البصمة' : 'Revoked Employee Biometric Exemption',
      `${emp.fullName} (${emp.adminId})`,
      'settings'
    );
    onToast(
      'info',
      lang === 'ar'
        ? `تم إلغاء الإعفاء من البصمة للموظف ${emp.fullName}.`
        : `Revoked biometric exemption for ${emp.fullName}.`
    );
  };

  const handleAddGate = () => {
    const val = newGate.trim();
    if (!val) return;
    if (form.approvedGates.some((g) => g.trim().toLowerCase() === val.toLowerCase())) {
      onToast('error', lang === 'ar' ? 'نقطة البوابة موجودة مسبقاً.' : 'Gate point already exists.');
      return;
    }
    const nextGates = [...form.approvedGates, val];
    setForm((prev) => ({ ...prev, approvedGates: nextGates }));
    syncAttendanceLocations(form.approvedWorkSites, nextGates);
    setNewGate('');
    onLogAudit(lang === 'ar' ? 'إضافة نقطة/بوابة حضور وانصراف' : 'Added Attendance Gate', val, 'settings');
    onToast('success', lang === 'ar' ? `تمت إضافة البوابة "${val}".` : `Added gate "${val}".`);
  };

  const handleSaveEditGate = () => {
    if (!editingGate) return;
    const trimmed = editingGate.value.trim();
    const original = editingGate.original;
    if (!trimmed) {
      onToast('error', lang === 'ar' ? 'يرجى إدخال اسم البوابة أو جهاز البصمة.' : 'Gate name cannot be empty.');
      return;
    }
    if (trimmed === original) {
      setEditingGate(null);
      return;
    }
    if (
      form.approvedGates.some(
        (g) => g !== original && g.trim().toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      onToast('error', lang === 'ar' ? 'توجد بوابة أخرى بنفس الاسم.' : 'Another gate has this name.');
      return;
    }
    const nextGates = form.approvedGates.map((g) => (g === original ? trimmed : g));
    setForm((prev) => ({ ...prev, approvedGates: nextGates }));
    syncAttendanceLocations(form.approvedWorkSites, nextGates);

    if (setAttendanceRecords) {
      setAttendanceRecords((prev) =>
        prev.map((r) =>
          r.entryLocation === original || r.exitLocation === original
            ? {
                ...r,
                entryLocation: r.entryLocation === original ? trimmed : r.entryLocation,
                exitLocation: r.exitLocation === original ? trimmed : r.exitLocation,
              }
            : r
        )
      );
    }

    onLogAudit(
      lang === 'ar' ? 'تعديل نقطة وبوابة الحضور والإنصراف' : 'Renamed Attendance Gate',
      `${original} → ${trimmed}`,
      'settings'
    );
    onToast(
      'success',
      lang === 'ar' ? `تم تعديل نقطة البوابة إلى "${trimmed}".` : `Gate updated to "${trimmed}".`
    );
    setEditingGate(null);
  };

  const handleRemoveGate = (gate: string) => {
    const nextGates = form.approvedGates.filter((g) => g !== gate);
    setForm((prev) => ({
      ...prev,
      approvedGates: nextGates,
    }));
    syncAttendanceLocations(form.approvedWorkSites, nextGates);
    if (editingGate?.original === gate) setEditingGate(null);
  };

  const openEditRecordModal = (rec: AttendanceRecord) => {
    setIsCreatingRecord(false);
    setEditingRecord(rec);
    setRecEmpId(rec.employeeId);
    setRecDate(rec.date);
    setRecShiftMode(rec.shiftMode);
    setRecCheckIn(rec.checkInTime);
    setRecCheckOut(rec.checkOutTime || '');
    setRecWorkSite(rec.workSite);
    setRecEntryLocation(rec.entryLocation);
    setRecExitLocation(rec.exitLocation || '');
    setRecManualOvertime(rec.overtimeMinutes !== undefined ? String(rec.overtimeMinutes) : '');
    setRecRegStatus(rec.regularizationStatus);
    setRecWarningNote(rec.warningNote || '');
    setRecNotes(rec.notes || '');
  };

  const openNewRecordModal = () => {
    const emp = employees[0];
    setIsCreatingRecord(true);
    setEditingRecord(null);
    setRecEmpId(emp?.id || '');
    setRecDate(getTodayStr());
    setRecShiftMode('standard');
    setRecCheckIn(form.standardStart);
    setRecCheckOut(form.standardEnd);
    setRecWorkSite(emp?.location || form.approvedWorkSites[0] || '');
    setRecEntryLocation(form.approvedGates[0] || '');
    setRecExitLocation(form.approvedGates[0] || '');
    setRecManualOvertime('');
    setRecRegStatus('None');
    setRecWarningNote('');
    setRecNotes('');
  };

  const handleSaveRecordChanges = (e: React.FormEvent) => {
    e.preventDefault();
    if (!setAttendanceRecords) return;
    const emp = employees.find((x) => x.id === recEmpId);
    if (!emp) return;

    const cleanOut = recCheckOut.trim() || undefined;
    const evaluation = evaluateAttendanceEntry(recCheckIn, cleanOut, recShiftMode, form);
    const resolvedOvertime =
      recManualOvertime.trim() !== '' && !isNaN(Number(recManualOvertime))
        ? Math.max(0, Number(recManualOvertime))
        : evaluation.overtimeMinutes;

    const nextRegStatus: RectificationStatus =
      evaluation.violationType === 'None'
        ? 'None'
        : recRegStatus === 'None'
        ? 'Unresolved'
        : recRegStatus;

    if (isCreatingRecord) {
      const created: AttendanceRecord = {
        id: generateId(),
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: recDate,
        shiftMode: recShiftMode,
        checkInTime: recCheckIn,
        checkOutTime: cleanOut,
        workSite: recWorkSite.trim() || emp.location || '-',
        entryLocation: recEntryLocation.trim() || '-',
        exitLocation: cleanOut ? recExitLocation.trim() || recEntryLocation.trim() : undefined,
        lateMinutes: evaluation.lateMinutes,
        earlyExitMinutes: evaluation.earlyExitMinutes,
        overtimeMinutes: resolvedOvertime,
        violationType: evaluation.violationType,
        regularizationStatus: nextRegStatus,
        warningIssued: evaluation.violationType !== 'None',
        warningNote: recWarningNote.trim() || undefined,
        notes: recNotes.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      setAttendanceRecords((prev) => [created, ...prev]);
      onLogAudit(
        lang === 'ar' ? 'إضافة سجل حضور وانصراف من الإدارة' : 'Added Attendance Record (Admin)',
        `${emp.fullName} · ${recDate}`,
        'system'
      );
      onToast('success', lang === 'ar' ? 'تمت إضافة السجل وتحديث الحسابات.' : 'Record added.');
    } else if (editingRecord) {
      const updated: AttendanceRecord = {
        ...editingRecord,
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: recDate,
        shiftMode: recShiftMode,
        checkInTime: recCheckIn,
        checkOutTime: cleanOut,
        workSite: recWorkSite.trim() || emp.location || '-',
        entryLocation: recEntryLocation.trim() || '-',
        exitLocation: cleanOut ? recExitLocation.trim() || recEntryLocation.trim() : undefined,
        lateMinutes: evaluation.lateMinutes,
        earlyExitMinutes: evaluation.earlyExitMinutes,
        overtimeMinutes: resolvedOvertime,
        violationType: evaluation.violationType,
        regularizationStatus: nextRegStatus,
        warningIssued: evaluation.violationType !== 'None' ? true : editingRecord.warningIssued,
        warningNote: recWarningNote.trim() || undefined,
        notes: recNotes.trim() || undefined,
      };
      setAttendanceRecords((prev) => prev.map((r) => (r.id === editingRecord.id ? updated : r)));
      onLogAudit(
        lang === 'ar' ? 'تعديل بيانات سجل الحضور والإنصراف' : 'Edited Attendance Record',
        `${emp.fullName} · ${recDate} (${recCheckIn}${cleanOut ? ` → ${cleanOut}` : ''})`,
        'settings'
      );
      onToast('success', lang === 'ar' ? 'تم تعديل بيانات السجل بنجاح.' : 'Attendance record updated.');
    }

    setEditingRecord(null);
    setIsCreatingRecord(false);
  };

  const handleRecalculateAll = () => {
    if (!setAttendanceRecords) return;
    setAttendanceRecords((prev) =>
      prev.map((rec) => {
        const evalRes = evaluateAttendanceEntry(rec.checkInTime, rec.checkOutTime, rec.shiftMode, form);
        return {
          ...rec,
          lateMinutes: evalRes.lateMinutes,
          earlyExitMinutes: evalRes.earlyExitMinutes,
          overtimeMinutes: evalRes.overtimeMinutes,
          violationType: evalRes.violationType,
          regularizationStatus:
            evalRes.violationType === 'None'
              ? 'None'
              : rec.regularizationStatus === 'None'
              ? 'Unresolved'
              : rec.regularizationStatus,
        };
      })
    );
    onLogAudit(
      lang === 'ar' ? 'إعادة احتساب كافة سجلات الحضور والإضافي' : 'Recalculated All Attendance & Overtime',
      `${attendanceRecords.length} records`,
      'settings'
    );
    onToast(
      'success',
      lang === 'ar'
        ? 'تمت إعادة احتساب التأخير والخروج المبكر والعمل الإضافي لكافة السجلات وفق الإعدادات.'
        : 'Recalculated all attendance records using current policies.'
    );
  };

  const filteredRecords = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    return [...attendanceRecords]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((r) => {
        if (!q) return true;
        return (
          r.employeeName.toLowerCase().includes(q) ||
          r.workSite.toLowerCase().includes(q) ||
          r.entryLocation.toLowerCase().includes(q) ||
          r.date.includes(q)
        );
      });
  }, [attendanceRecords, recordSearch]);

  return (
    <div className="space-y-6 text-[var(--text-main)]">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-5">
        <div>
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <Clock size={19} className="text-[var(--primary-text)]" />
            <span>{t(lang, 'attendanceAdminTitle')}</span>
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{t(lang, 'attendanceAdminDesc')}</p>
        </div>

        {setAttendanceRecords && (
          <button
            type="button"
            onClick={handleRecalculateAll}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
          >
            <Clock size={14} className="text-[var(--primary-text)]" />
            <span>
              {lang === 'ar' ? 'إعادة احتساب الإضافي والتأخير للسجلات' : 'Recalculate Overtime & Delays'}
            </span>
          </button>
        )}
      </div>

      {/* Policy Settings Form */}
      <form onSubmit={handleSaveConfig} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Shift Windows & Overtime Rules */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-5 space-y-5">
          <div className="space-y-3">
            <h4 className="font-display text-sm font-bold text-[var(--primary-text)]">
              {lang === 'ar' ? 'أوقات الدوام القياسي والساعة المرنة' : 'Shift Schedules & Flexible Hours'}
            </h4>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {lang === 'ar' ? 'بداية الدوام القياسي' : 'Standard Shift Start'}
                </label>
                <input
                  type="time"
                  value={form.standardStart}
                  onChange={(e) => setForm({ ...form, standardStart: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {lang === 'ar' ? 'نهاية الدوام القياسي' : 'Standard Shift End'}
                </label>
                <input
                  type="time"
                  value={form.standardEnd}
                  onChange={(e) => setForm({ ...form, standardEnd: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 pt-2 cursor-pointer text-xs font-semibold">
              <input
                type="checkbox"
                checked={form.flexibleEnabled}
                onChange={(e) => setForm({ ...form, flexibleEnabled: e.target.checked })}
                className="rounded accent-[var(--primary)]"
              />
              <span>
                {lang === 'ar' ? 'تفعيل نظام الساعة المرنة للموظفين' : 'Enable Flexible Shift Window'}
              </span>
            </label>

            {form.flexibleEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {lang === 'ar' ? 'بداية الساعة المرنة' : 'Flexible Start'}
                  </label>
                  <input
                    type="time"
                    value={form.flexibleStart}
                    onChange={(e) => setForm({ ...form, flexibleStart: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {lang === 'ar' ? 'نهاية الساعة المرنة' : 'Flexible End'}
                  </label>
                  <input
                    type="time"
                    value={form.flexibleEnd}
                    onChange={(e) => setForm({ ...form, flexibleEnd: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                {t(lang, 'graceMinutesLabel')}
              </label>
              <input
                type="number"
                min={0}
                max={120}
                value={form.graceMinutes}
                onChange={(e) => setForm({ ...form, graceMinutes: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {/* Overtime Configuration */}
          <div className="pt-4 border-t border-[var(--border)] space-y-3">
            <h4 className="font-display text-sm font-bold text-[var(--primary-text)]">
              {lang === 'ar' ? 'ضوابط احتساب العمل الإضافي' : 'Overtime Calculation Settings'}
            </h4>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold">
              <input
                type="checkbox"
                checked={form.overtimeEnabled}
                onChange={(e) => setForm({ ...form, overtimeEnabled: e.target.checked })}
                className="rounded accent-[var(--primary)]"
              />
              <span>
                {lang === 'ar'
                  ? 'تفعيل احتساب ساعات العمل الإضافي تلقائياً بعد انتهاء الدوام'
                  : 'Automatically calculate overtime hours past shift end'}
              </span>
            </label>

            {form.overtimeEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'overtimeThresholdLabel')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={form.overtimeThresholdMinutes}
                    onChange={(e) =>
                      setForm({ ...form, overtimeThresholdMinutes: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'overtimeMultiplierLabel')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={3}
                    step={0.25}
                    value={form.overtimeMultiplier}
                    onChange={(e) => setForm({ ...form, overtimeMultiplier: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Rules Checkboxes */}
          <div className="pt-4 border-t border-[var(--border)] space-y-2.5 text-xs">
            <h4 className="font-display text-sm font-bold text-[var(--primary-text)] flex items-center gap-1.5">
              <ShieldCheck size={15} />
              <span>{lang === 'ar' ? 'سياسة الإنذارات والحماية الجغرافية' : 'Warnings & Geofence Security Policy'}</span>
            </h4>
            <label className="flex items-center gap-2.5 cursor-pointer font-semibold text-[var(--text-main)]">
              <input
                type="checkbox"
                checked={form.enforceGeofenceForEmployees ?? true}
                onChange={(e) => setForm({ ...form, enforceGeofenceForEmployees: e.target.checked })}
                className="rounded accent-[var(--primary)]"
              />
              <span>{t(lang, 'enforceGeofenceLabel')}</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requireLocationOnCheck}
                onChange={(e) => setForm({ ...form, requireLocationOnCheck: e.target.checked })}
                className="rounded accent-[var(--primary)]"
              />
              <span>
                {lang === 'ar'
                  ? 'إلزام تحديد موقع العمل وبوابة الدخول/الخروج عند كل تسجيل'
                  : 'Require work site and gate location on check-in/out'}
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoWarnOnViolation}
                onChange={(e) => setForm({ ...form, autoWarnOnViolation: e.target.checked })}
                className="rounded accent-[var(--primary)]"
              />
              <span>
                {lang === 'ar'
                  ? 'إصدار إنذار تلقائي للموظف عند التأخير أو الانصراف المبكر'
                  : 'Automatically issue employee warnings for late arrivals / early exits'}
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowPermitRectification}
                onChange={(e) => setForm({ ...form, allowPermitRectification: e.target.checked })}
                className="rounded accent-[var(--primary)]"
              />
              <span>{t(lang, 'rectifyWithPermit')}</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowLeaveRectification}
                onChange={(e) => setForm({ ...form, allowLeaveRectification: e.target.checked })}
                className="rounded accent-[var(--primary)]"
              />
              <span>{t(lang, 'rectifyWithLeave')}</span>
            </label>
          </div>
        </div>

        {/* Card 2: Approved Work Sites, Interactive GPS Map & Check-In/Out Gates + Save */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] p-5 flex flex-col justify-between space-y-5">
          <div className="space-y-5">
            {/* Approved Work Sites */}
            <div className="space-y-2.5">
              <h4 className="font-display text-sm font-bold text-[var(--primary-text)] flex items-center gap-1.5">
                <Building2 size={15} />
                <span>{lang === 'ar' ? 'مواقع العمل المعتمدة' : 'Approved Work Sites'}</span>
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newWorkSite}
                  onChange={(e) => setNewWorkSite(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddWorkSite())}
                  placeholder={lang === 'ar' ? 'إضافة موقع عمل جديد...' : 'Add work site...'}
                  className="flex-1 px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  onClick={handleAddWorkSite}
                  className="px-3 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {form.approvedWorkSites.map((site) => {
                  const isEditingThis = editingSite?.original === site;
                  const isSelectedOnMap = activeMapSite?.name === site;
                  const siteLoc = effectiveWorkSites.find((loc) => loc.name === site);
                  return (
                    <div
                      key={site}
                      className={`px-3 py-2 flex items-center justify-between gap-2 text-xs transition-colors ${
                        isSelectedOnMap
                          ? 'bg-[var(--primary-soft)]/70'
                          : 'bg-[var(--app-bg)] hover:bg-[var(--surface-subtle)]/40'
                      }`}
                    >
                      {isEditingThis ? (
                        <>
                          <input
                            type="text"
                            autoFocus
                            value={editingSite.value}
                            onChange={(e) =>
                              setEditingSite((prev) => (prev ? { ...prev, value: e.target.value } : null))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSaveEditWorkSite();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingSite(null);
                              }
                            }}
                            className="flex-1 px-2 py-1 bg-[var(--card-bg)] border border-[var(--primary)] rounded text-xs outline-none"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={handleSaveEditWorkSite}
                              title={lang === 'ar' ? 'حفظ التعديل' : 'Save'}
                              aria-label={lang === 'ar' ? 'حفظ التعديل' : 'Save'}
                              className="p-1.5 rounded bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] cursor-pointer"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSite(null)}
                              title={t(lang, 'cancel')}
                              aria-label={t(lang, 'cancel')}
                              className="p-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedMapSiteName(site);
                              setMapFocusTrigger((c) => c + 1);
                            }}
                            className="flex-1 text-start min-w-0 flex items-center gap-2 cursor-pointer"
                          >
                            <MapPin
                              size={13}
                              className={
                                isSelectedOnMap
                                  ? 'text-[var(--primary-text)] shrink-0'
                                  : 'text-[var(--text-muted)] shrink-0'
                              }
                            />
                            <div className="min-w-0">
                              <span
                                className={`font-medium truncate block ${
                                  isSelectedOnMap ? 'text-[var(--primary-text)] font-bold' : ''
                                }`}
                              >
                                {site}
                              </span>
                              {siteLoc && (
                                <span className="text-[10px] font-mono-tabular text-[var(--text-muted)] block">
                                  {siteLoc.lat.toFixed(4)}, {siteLoc.lng.toFixed(4)} · {siteLoc.radiusMeters}m ·{' '}
                                  {employees.filter(
                                    (e) =>
                                      e.assignedWorkSiteId === siteLoc.id ||
                                      e.location.trim().toLowerCase() === site.trim().toLowerCase() ||
                                      e.allowedWorkSites?.includes(site)
                                  ).length}{' '}
                                  {lang === 'ar' ? 'موظف' : 'staff'}
                                </span>
                              )}
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingSite({ original: site, value: site })}
                              title={lang === 'ar' ? 'تعديل موقع العمل' : 'Edit work site'}
                              aria-label={lang === 'ar' ? 'تعديل موقع العمل' : 'Edit work site'}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:border-[var(--primary)] cursor-pointer"
                            >
                              <Edit size={12} />
                              <span>{lang === 'ar' ? 'تعديل' : 'Edit'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveWorkSite(site)}
                              title={t(lang, 'deleteLabel')}
                              aria-label={t(lang, 'deleteLabel')}
                              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Interactive Work Site Map & Live GPS Office Pin Renewal */}
            {activeMapSite && (
              <div className="pt-4 border-t border-[var(--border)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-display text-sm font-bold text-[var(--primary-text)] flex items-center gap-1.5">
                      <Crosshair size={15} />
                      <span>{t(lang, 'workSiteMapTitle')}</span>
                    </h4>
                    <p className="text-[11px] text-[var(--text-muted)]">{t(lang, 'workSiteMapDesc')}</p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRenewActiveSiteViaGps}
                    disabled={isRenewingGps}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    <RefreshCw size={13} className={isRenewingGps ? 'animate-spin' : ''} />
                    <span>{t(lang, 'renewOfficeGpsBtn')}</span>
                  </button>
                </div>

                {/* Selected Site Radius + Default Gate + Direct Coordinates */}
                <div className="space-y-2.5 p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'workSiteLabel')}
                      </label>
                      <select
                        value={activeMapSite.name}
                        onChange={(e) => {
                          setSelectedMapSiteName(e.target.value);
                          setMapFocusTrigger((c) => c + 1);
                        }}
                        className="w-full px-2.5 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-md text-xs font-semibold outline-none focus:border-[var(--primary)]"
                      >
                        {effectiveWorkSites.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'geofenceRadiusLabel')}
                      </label>
                      <input
                        type="number"
                        min={25}
                        max={5000}
                        step={25}
                        value={activeMapSite.radiusMeters}
                        onChange={(e) =>
                          handleUpdateSiteGeofenceConfig(activeMapSite.name, {
                            radiusMeters: Number(e.target.value),
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-md text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">
                        {t(lang, 'entryLocationLabel')}
                      </label>
                      <select
                        value={activeMapSite.defaultGate || form.approvedGates[0] || ''}
                        onChange={(e) =>
                          handleUpdateSiteGeofenceConfig(activeMapSite.name, {
                            defaultGate: e.target.value,
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-md text-xs outline-none focus:border-[var(--primary)]"
                      >
                        {form.approvedGates.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-[var(--border)]">
                    <div>
                      <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">
                        {lang === 'ar' ? 'خط العرض (Latitude)' : 'Latitude'}
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={activeMapSite.lat}
                          onChange={(e) => {
                          const val = Number.parseFloat(e.target.value);
                          if (Number.isFinite(val) && val >= -90 && val <= 90) {
                            handleUpdateSiteCoordinates(activeMapSite.name, val, activeMapSite.lng, 'map', undefined, true);
                            setMapFocusTrigger((c) => c + 1);
                          }
                        }}
                        className="w-full px-2.5 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-md text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">
                        {lang === 'ar' ? 'خط الطول (Longitude)' : 'Longitude'}
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={activeMapSite.lng}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value);
                          if (Number.isFinite(val) && val >= -180 && val <= 180) {
                            handleUpdateSiteCoordinates(activeMapSite.name, activeMapSite.lat, val, 'map', undefined, true);
                            setMapFocusTrigger((c) => c + 1);
                          }
                        }}
                        className="w-full px-2.5 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-md text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[var(--border)] space-y-2">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search
                          size={13}
                          className="absolute start-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
                        />
                        <input
                          type="text"
                          value={geoSearchQuery}
                          onChange={(e) => setGeoSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleGeoPlaceSearch();
                            }
                          }}
                          placeholder={t(lang, 'geoSearchPlaceholder')}
                          className="w-full ps-8 pe-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-md text-xs outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleGeoPlaceSearch()}
                        disabled={isSearchingGeo || geoSearchQuery.trim().length < 2}
                        className="px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        {isSearchingGeo ? t(lang, 'geoSearching') : t(lang, 'geoSearchBtn')}
                      </button>
                    </div>

                    {geoSearchResults.length > 0 && (
                      <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg bg-[var(--card-bg)] overflow-hidden max-h-40 overflow-y-auto">
                        {geoSearchResults.map((item, idx) => (
                          <button
                            key={`${item.lat}-${item.lng}-${idx}`}
                            type="button"
                            onClick={() => {
                              handleUpdateSiteCoordinates(activeMapSite.name, item.lat, item.lng, 'map');
                              setMapFocusTrigger((c) => c + 1);
                              setGeoSearchResults([]);
                              setGeoSearchError('');
                            }}
                            className="w-full px-3 py-2 text-start hover:bg-[var(--primary-soft)] flex items-center justify-between gap-2 text-[11px] cursor-pointer"
                          >
                            <span className="truncate font-medium text-[var(--text-main)]">{item.displayName}</span>
                            <span className="font-mono-tabular text-[10px] text-[var(--text-muted)] shrink-0">
                              {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {geoSearchError && (
                      <p className="text-[11px] text-[var(--text-muted)]">{geoSearchError}</p>
                    )}
                  </div>
                </div>

                <InteractiveGeoMap
                  mode="admin-editor"
                  theme={settings.currentTheme}
                  lang={lang}
                  workSites={effectiveWorkSites}
                  selectedSiteId={activeMapSite.id}
                  selectedSiteName={activeMapSite.name}
                  heightClass="h-72"
                  minHeightPx={288}
                  focusTrigger={mapFocusTrigger}
                  onSelectSite={(site) => {
                    setSelectedMapSiteName(site.name);
                    setMapFocusTrigger((c) => c + 1);
                  }}
                  onAdminPickCoordinates={(lat, lng) =>
                    handleUpdateSiteCoordinates(activeMapSite.name, lat, lng, 'map')
                  }
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                  <span>{t(lang, 'clickMapToPlaceOffice')}</span>
                  <span className="font-mono-tabular font-semibold text-[var(--text-main)]">
                    {activeMapSite.lat.toFixed(5)}, {activeMapSite.lng.toFixed(5)} · {activeMapSite.radiusMeters}m
                  </span>
                </div>
              </div>
            )}

            {/* Approved Entry/Exit Gates */}
            <div className="pt-4 border-t border-[var(--border)] space-y-2.5">
              <h4 className="font-display text-sm font-bold text-[var(--primary-text)] flex items-center gap-1.5">
                <MapPin size={15} />
                <span>{lang === 'ar' ? 'نقاط وبوابات الحضور والإنصراف' : 'Entry & Exit Gates'}</span>
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGate}
                  onChange={(e) => setNewGate(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddGate())}
                  placeholder={lang === 'ar' ? 'إضافة بوابة أو جهاز بصمة...' : 'Add gate / checkpoint...'}
                  className="flex-1 px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  onClick={handleAddGate}
                  className="px-3 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] cursor-pointer"
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {form.approvedGates.map((gate) => {
                  const isEditingThis = editingGate?.original === gate;
                  return (
                    <div
                      key={gate}
                      className="px-3 py-2 bg-[var(--app-bg)] flex items-center justify-between gap-2 text-xs"
                    >
                      {isEditingThis ? (
                        <>
                          <input
                            type="text"
                            autoFocus
                            value={editingGate.value}
                            onChange={(e) =>
                              setEditingGate((prev) => (prev ? { ...prev, value: e.target.value } : null))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSaveEditGate();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingGate(null);
                              }
                            }}
                            className="flex-1 px-2 py-1 bg-[var(--card-bg)] border border-[var(--primary)] rounded text-xs outline-none"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={handleSaveEditGate}
                              title={lang === 'ar' ? 'حفظ التعديل' : 'Save'}
                              aria-label={lang === 'ar' ? 'حفظ التعديل' : 'Save'}
                              className="p-1.5 rounded bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] cursor-pointer"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGate(null)}
                              title={t(lang, 'cancel')}
                              aria-label={t(lang, 'cancel')}
                              className="p-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="font-medium truncate">{gate}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingGate({ original: gate, value: gate })}
                              title={lang === 'ar' ? 'تعديل نقطة البوابة' : 'Edit gate location'}
                              aria-label={lang === 'ar' ? 'تعديل نقطة البوابة' : 'Edit gate location'}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:border-[var(--primary)] cursor-pointer"
                            >
                              <Edit size={12} />
                              <span>{lang === 'ar' ? 'تعديل' : 'Edit'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveGate(gate)}
                              title={t(lang, 'deleteLabel')}
                              aria-label={t(lang, 'deleteLabel')}
                              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--border)]">
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] cursor-pointer"
            >
              <Save size={16} />
              <span>{t(lang, 'saveAttendanceSettingsBtn')}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Employee Work-Site Assignment, Geofence Overrides, Shift Defaults & Biometric Exemptions */}
      {setEmployees && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] shrink-0">
                <UserCheck size={17} />
              </div>
              <div>
                <h4 className="font-display text-sm font-bold flex items-center gap-2">
                  <span>{t(lang, 'employeeAttendancePropsTitle')}</span>
                  <span className="font-mono-tabular text-xs font-bold text-[var(--primary-text)]">
                    ({employees.length})
                  </span>
                  {exemptEmployees.length > 0 && (
                    <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                      · {exemptEmployees.length} {t(lang, 'biometricExemptBadge')}
                    </span>
                  )}
                </h4>
                <p className="text-xs text-[var(--text-muted)]">{t(lang, 'employeeAttendancePropsDesc')}</p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div className="p-4 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-4">
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'employeeCol')}
                  </label>
                  <select
                    value={exemptEmpId}
                    onChange={(e) => setExemptEmpId(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-semibold outline-none focus:border-[var(--primary)]"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} — {emp.department}
                        {emp.biometricExempt ? ` (${t(lang, 'biometricExemptBadge')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'assignedWorkSiteLabel')}
                  </label>
                  <select
                    value={propWorkSiteName}
                    onChange={(e) => setPropWorkSiteName(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                  >
                    {effectiveWorkSites.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} ({s.radiusMeters}m)
                      </option>
                    ))}
                    {propWorkSiteName &&
                      !effectiveWorkSites.some(
                        (s) => s.name.trim().toLowerCase() === propWorkSiteName.trim().toLowerCase()
                      ) && <option value={propWorkSiteName}>{propWorkSiteName}</option>}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'defaultShiftModeLabel')}
                  </label>
                  <select
                    value={propShiftMode}
                    onChange={(e) => setPropShiftMode(e.target.value as ShiftMode)}
                    className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                  >
                    <option value="standard">
                      {t(lang, 'shiftStandardLabel')} ({form.standardStart}–{form.standardEnd})
                    </option>
                    <option value="flexible">
                      {t(lang, 'shiftFlexibleLabel')} ({form.flexibleStart}–{form.flexibleEnd})
                    </option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'geofenceOverrideLabel')}
                  </label>
                  <input
                    type="number"
                    min={25}
                    max={5000}
                    step={25}
                    value={propRadiusOverride}
                    onChange={(e) => setPropRadiusOverride(e.target.value)}
                    placeholder={lang === 'ar' ? 'افتراضي' : 'Default'}
                    className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              {/* Additional Allowed Sites & Biometric Exemption Toggle */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-3 border-t border-[var(--border)] items-center">
                <div className="lg:col-span-5 space-y-1.5">
                  <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                    {t(lang, 'allowedWorkSitesLabel')}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {effectiveWorkSites
                      .filter((s) => s.name.trim().toLowerCase() !== propWorkSiteName.trim().toLowerCase())
                      .map((site) => {
                        const checked = propAllowedSites.includes(site.name);
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
                              onChange={(e) =>
                                setPropAllowedSites((prev) =>
                                  e.target.checked
                                    ? [...prev, site.name]
                                    : prev.filter((item) => item !== site.name)
                                )
                              }
                              className="rounded accent-[var(--primary)]"
                            />
                            <span>{site.name}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--text-main)]">
                    <input
                      type="checkbox"
                      checked={propBiometricExempt}
                      onChange={(e) => setPropBiometricExempt(e.target.checked)}
                      className="rounded accent-[var(--primary)]"
                    />
                    <ShieldCheck size={14} className="text-[var(--primary-text)] shrink-0" />
                    <span>{t(lang, 'biometricExemptToggleLabel')}</span>
                  </label>
                  {propBiometricExempt && (
                    <input
                      type="text"
                      value={exemptReasonInput}
                      onChange={(e) => setExemptReasonInput(e.target.value)}
                      placeholder={t(lang, 'biometricExemptReasonPlaceholder')}
                      className="w-full px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                    />
                  )}
                </div>

                <div className="lg:col-span-3">
                  <button
                    type="button"
                    onClick={handleSaveEmployeeAttendanceProps}
                    disabled={!exemptEmpId}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    <Save size={14} />
                    <span>{lang === 'ar' ? 'حفظ خصائص الموظف' : 'Save Employee Props'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Unified Roster Linked Work-Site & Attendance Ledger */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative min-w-[220px] flex-1 max-w-sm">
                <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={propSearch}
                  onChange={(e) => setPropSearch(e.target.value)}
                  placeholder={lang === 'ar' ? 'بحث في الموظفين والمواقع...' : 'Filter employees & sites...'}
                  className="w-full ps-8 pe-3 py-1.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>

            <div className="border border-[var(--border)] rounded-lg overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs text-start">
                <thead className="bg-[var(--surface-subtle)] border-b border-[var(--border)] text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3.5 py-2.5 text-start">{t(lang, 'employeeCol')}</th>
                    <th className="px-3.5 py-2.5 text-start">{t(lang, 'assignedWorkSiteLabel')}</th>
                    <th className="px-3.5 py-2.5 text-start">{t(lang, 'defaultShiftModeLabel')}</th>
                    <th className="px-3.5 py-2.5 text-start">{t(lang, 'biometricStatusCol')}</th>
                    <th className="px-3.5 py-2.5 text-end">{t(lang, 'actionsCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {employees
                    .filter((emp) => {
                      const q = propSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        emp.fullName.toLowerCase().includes(q) ||
                        emp.adminId.toLowerCase().includes(q) ||
                        emp.location.toLowerCase().includes(q) ||
                        emp.department.toLowerCase().includes(q)
                      );
                    })
                    .map((emp) => {
                      const matchedSite =
                        effectiveWorkSites.find((s) => s.id === emp.assignedWorkSiteId) ||
                        effectiveWorkSites.find(
                          (s) => s.name.trim().toLowerCase() === emp.location.trim().toLowerCase()
                        );
                      const effectiveRad = emp.geofenceRadiusOverrideMeters ?? matchedSite?.radiusMeters ?? 250;
                      const isSelectedRow = emp.id === exemptEmpId;
                      return (
                        <tr
                          key={emp.id}
                          className={`hover:bg-[var(--surface-subtle)]/40 ${
                            isSelectedRow ? 'bg-[var(--primary-soft)]/40' : ''
                          }`}
                        >
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-[var(--text-main)]">{emp.fullName}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">
                              {emp.adminId} · {emp.department}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-medium text-[var(--text-main)]">{emp.location || '-'}</div>
                            <div className="text-[10px] font-mono-tabular text-[var(--text-muted)]">
                              {effectiveRad}m
                              {emp.allowedWorkSites && emp.allowedWorkSites.length > 0
                                ? ` · +${emp.allowedWorkSites.length} ${lang === 'ar' ? 'إضافي' : 'extra'}`
                                : ''}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 font-medium">
                            {emp.defaultShiftMode === 'flexible'
                              ? t(lang, 'shiftFlexibleLabel')
                              : t(lang, 'shiftStandardLabel')}
                          </td>
                          <td className="px-3.5 py-2.5">
                            {emp.biometricExempt ? (
                              <div>
                                <span className="font-semibold text-[var(--primary-text)]">
                                  {t(lang, 'biometricExemptBadge')}
                                </span>
                                {emp.biometricExemptReason && (
                                  <div className="text-[10px] text-[var(--text-muted)]">
                                    {emp.biometricExemptReason}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[var(--text-muted)]">
                                {t(lang, 'biometricRequiredBadge')}
                              </span>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5 text-end whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setExemptEmpId(emp.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
                              >
                                <Edit size={12} className="text-[var(--primary-text)]" />
                                <span>{lang === 'ar' ? 'تعديل الربط' : 'Edit Link'}</span>
                              </button>
                              {emp.biometricExempt && (
                                <button
                                  type="button"
                                  onClick={() => handleRevokeBiometricExemption(emp)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] text-xs font-semibold hover:opacity-90 cursor-pointer whitespace-nowrap"
                                  title={t(lang, 'biometricExemptRevokeBtn')}
                                >
                                  <UserX size={12} />
                                </button>
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
        </div>
      )}

      {/* Direct Records Management Table (Edit all fields / Add / Delete) */}
      {setAttendanceRecords && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold">
                {lang === 'ar'
                  ? 'تعديل وإدارة سجلات الحضور والإنصراف المسجلة'
                  : 'Edit & Manage Logged Attendance Records'}
              </h4>
              <p className="text-xs text-[var(--text-muted)]">
                {lang === 'ar'
                  ? 'تعديل الأوقات، الموقع، البوابات، ساعات العمل الإضافي، وحالة التصحيح لأي موظف'
                  : 'Edit shift times, work site, gates, overtime hours, and statuses for any entry'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={recordSearch}
                  onChange={(e) => setRecordSearch(e.target.value)}
                  placeholder={lang === 'ar' ? 'بحث في السجلات...' : 'Filter records...'}
                  className="w-full ps-8 pe-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                />
              </div>
              <button
                type="button"
                onClick={openNewRecordModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-semibold hover:bg-[var(--primary-hover)] cursor-pointer whitespace-nowrap"
              >
                <Plus size={14} />
                <span>{lang === 'ar' ? 'إضافة سجل' : 'Add Record'}</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start">{t(lang, 'employeeCol')}</th>
                  <th className="px-4 py-3 text-start">{t(lang, 'attendanceDateLabel')}</th>
                  <th className="px-4 py-3 text-start">{t(lang, 'workSiteLabel')}</th>
                  <th className="px-4 py-3 text-start">{lang === 'ar' ? 'الدخول / الخروج' : 'In / Out'}</th>
                  <th className="px-4 py-3 text-start">{t(lang, 'overtimeCol')}</th>
                  <th className="px-4 py-3 text-start">{t(lang, 'adherencePercentCol')}</th>
                  <th className="px-4 py-3 text-end">{t(lang, 'actionsCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredRecords.map((rec) => {
                  const evalRes = evaluateAttendanceEntry(rec.checkInTime, rec.checkOutTime, rec.shiftMode, form);
                  const bounds = getShiftScheduleBounds(rec.shiftMode, form);
                  const overtimeMins = rec.overtimeMinutes !== undefined ? rec.overtimeMinutes : evalRes.overtimeMinutes;
                  return (
                    <tr key={rec.id} className="hover:bg-[var(--surface-subtle)]/40">
                      <td className="px-4 py-3 font-semibold">{rec.employeeName}</td>
                      <td className="px-4 py-3 font-mono-tabular whitespace-nowrap">
                        <div>{formatReadableDate(rec.date, lang)}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {bounds.start}–{bounds.end}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{rec.workSite}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {rec.entryLocation} {rec.exitLocation ? `→ ${rec.exitLocation}` : ''}
                        </div>
                        {(rec.geofenceStatus || rec.integrityDigest) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px]">
                            {rec.geofenceStatus === 'VerifiedInside' && (
                              <span className="font-semibold text-[var(--status-success-text)]">
                                {lang === 'ar' ? 'GPS موثق' : 'GPS Verified'}
                                {rec.checkInDistanceMeters !== undefined
                                  ? ` (${formatDistanceLabel(rec.checkInDistanceMeters, lang)})`
                                  : ''}
                              </span>
                            )}
                            {rec.geofenceStatus === 'OutsideRange' && (
                              <span className="font-semibold text-[var(--status-danger-text)]">
                                {lang === 'ar' ? 'خارج النطاق' : 'Outside Range'}
                              </span>
                            )}
                            {rec.integrityDigest && (
                              <span className="font-mono-tabular text-[var(--text-muted)]">
                                {rec.integrityDigest}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular whitespace-nowrap">
                        {rec.checkInTime} → {rec.checkOutTime || '--:--'}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-[var(--primary-text)] whitespace-nowrap">
                        {overtimeMins > 0 ? `+${formatAttendanceDuration(overtimeMins, lang)}` : '-'}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular font-bold">{evalRes.adherencePercent}%</td>
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditRecordModal(rec)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold hover:border-[var(--primary)] cursor-pointer"
                          >
                            <Edit size={13} className="text-[var(--primary-text)]" />
                            <span>{lang === 'ar' ? 'تعديل' : 'Edit'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(rec.id)}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-bg)] cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRecords.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      {lang === 'ar' ? 'لا توجد سجلات مطابقة.' : 'No matching records.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Edit / Create Complete Attendance Record */}
      {(editingRecord || isCreatingRecord) && (
        <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
              <h3 className="font-display font-bold text-base">
                {isCreatingRecord
                  ? lang === 'ar'
                    ? 'إضافة سجل دخول وخروج'
                    : 'Add Attendance Record'
                  : lang === 'ar'
                  ? 'تعديل بيانات الدخول والخروج'
                  : 'Edit Attendance Record'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditingRecord(null);
                  setIsCreatingRecord(false);
                }}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRecordChanges} className="p-5 space-y-4 overflow-y-auto text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'employeeCol')}
                  </label>
                  <select
                    value={recEmpId}
                    onChange={(e) => setRecEmpId(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName}
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
                    value={recDate}
                    onChange={(e) => setRecDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'shiftScheduleLabel')}
                  </label>
                  <select
                    value={recShiftMode}
                    onChange={(e) => setRecShiftMode(e.target.value as ShiftMode)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    <option value="standard">
                      {t(lang, 'shiftStandardLabel')} ({form.standardStart}–{form.standardEnd})
                    </option>
                    <option value="flexible">
                      {t(lang, 'shiftFlexibleLabel')} ({form.flexibleStart}–{form.flexibleEnd})
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'workSiteLabel')}
                  </label>
                  <input
                    type="text"
                    value={recWorkSite}
                    onChange={(e) => setRecWorkSite(e.target.value)}
                    list="admin-work-sites"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    required
                  />
                  <datalist id="admin-work-sites">
                    {form.approvedWorkSites.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'checkInTimeLabel')}
                  </label>
                  <input
                    type="time"
                    value={recCheckIn}
                    onChange={(e) => setRecCheckIn(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'checkOutTimeLabel')}
                  </label>
                  <input
                    type="time"
                    value={recCheckOut}
                    onChange={(e) => setRecCheckOut(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'entryLocationLabel')}
                  </label>
                  <input
                    type="text"
                    value={recEntryLocation}
                    onChange={(e) => setRecEntryLocation(e.target.value)}
                    list="admin-gates"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                    required
                  />
                  <datalist id="admin-gates">
                    {form.approvedGates.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {t(lang, 'exitLocationLabel')}
                  </label>
                  <input
                    type="text"
                    value={recExitLocation}
                    onChange={(e) => setRecExitLocation(e.target.value)}
                    list="admin-gates"
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {lang === 'ar'
                      ? 'العمل الإضافي بالدقائق (اتركه فارغاً للحساب التلقائي)'
                      : 'Overtime Minutes (blank = auto)'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={recManualOvertime}
                    onChange={(e) => setRecManualOvertime(e.target.value)}
                    placeholder={lang === 'ar' ? 'تلقائي' : 'Auto'}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    {lang === 'ar' ? 'حالة التصحيح / المخالفة' : 'Rectification Status'}
                  </label>
                  <select
                    value={recRegStatus}
                    onChange={(e) => setRecRegStatus(e.target.value as RectificationStatus)}
                    className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                  >
                    <option value="None">{lang === 'ar' ? 'بدون مخالفة' : 'None'}</option>
                    <option value="Unresolved">{t(lang, 'rectificationStatusUnresolved')}</option>
                    <option value="Pending">{t(lang, 'rectificationStatusPending')}</option>
                    <option value="Resolved">{t(lang, 'rectificationStatusResolved')}</option>
                    <option value="Rejected">{t(lang, 'rectificationStatusRejected')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {lang === 'ar' ? 'ملاحظة الإنذار (إن وجدت)' : 'Warning Note (Optional)'}
                </label>
                <input
                  type="text"
                  value={recWarningNote}
                  onChange={(e) => setRecWarningNote(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-xs outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  {t(lang, 'notes')}
                </label>
                <textarea
                  rows={2}
                  value={recNotes}
                  onChange={(e) => setRecNotes(e.target.value)}
                  className="w-full p-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)] resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => {
                    setEditingRecord(null);
                    setIsCreatingRecord(false);
                  }}
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

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title={t(lang, 'confirmActionTitle')}
        message={
          lang === 'ar'
            ? 'هل أنت متأكد من حذف سجل الدخول والخروج هذا؟'
            : 'Are you sure you want to delete this attendance entry?'
        }
        confirmText={t(lang, 'confirmBtn')}
        cancelText={t(lang, 'cancel')}
        onConfirm={() => {
          if (confirmDeleteId && setAttendanceRecords) {
            setAttendanceRecords((prev) => prev.filter((r) => r.id !== confirmDeleteId));
            onLogAudit(lang === 'ar' ? 'حذف سجل حضور' : 'Deleted Attendance Record', confirmDeleteId, 'system');
            onToast('info', lang === 'ar' ? 'تم حذف السجل.' : 'Record deleted.');
          }
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};

export default AttendanceAdminTab;
