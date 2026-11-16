import { Employee, Language, SystemSettings, Vacation } from '../types';
import { getEmployeeLeaveSummary, getTodayStr } from '../utils/leaveCalculations';

export const analyzeDataWithGemini = async (
  employees: Employee[],
  vacations: Vacation[],
  settings: SystemSettings,
  prompt: string,
  language: Language
): Promise<{ text: string; error?: string }> => {
  const todayStr = getTodayStr();
  const currentYear = new Date().getFullYear();

  const departmentBreakdown = employees.reduce<Record<string, { total: number; onLeaveToday: number }>>(
    (acc, emp) => {
      const dept = emp.department || 'Unassigned';
      if (!acc[dept]) acc[dept] = { total: 0, onLeaveToday: 0 };
      acc[dept].total++;
      const away = vacations.some(
        (v) => v.employeeId === emp.id && v.status === 'Approved' && v.startDate <= todayStr && v.endDate >= todayStr
      );
      if (away) acc[dept].onLeaveToday++;
      return acc;
    },
    {}
  );

  const contractBreakdown = employees.reduce<Record<string, number>>((acc, emp) => {
    const c = emp.contractType || 'Unknown';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

  const statusBreakdown = vacations.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] || 0) + 1;
    return acc;
  }, {});

  const leaveBalances = employees.map((emp) => {
    const summary = getEmployeeLeaveSummary(emp, vacations, settings, currentYear);
    return {
      name: emp.fullName,
      adminId: emp.adminId,
      department: emp.department,
      contractType: emp.contractType,
      annualLimit: summary.annualLimit,
      approvedDays: summary.approvedDays,
      pendingDays: summary.pendingDays,
      remainingDays: summary.remainingDays,
      utilizationPercent: summary.utilizationPercent,
    };
  });

  const activeLeavesToday = vacations
    .filter((v) => v.status === 'Approved' && v.startDate <= todayStr && v.endDate >= todayStr)
    .map((v) => ({
      employee: v.employeeName,
      type: v.type,
      startDate: v.startDate,
      endDate: v.endDate,
      days: v.days,
      substitute: v.substitute,
    }));

  const pendingRequests = vacations
    .filter((v) => v.status === 'Pending' || v.status === 'Returned')
    .map((v) => ({
      employee: v.employeeName,
      type: v.type,
      status: v.status,
      startDate: v.startDate,
      endDate: v.endDate,
      days: v.days,
      substitute: v.substitute,
    }));

  const summaryContext = {
    todayDate: todayStr,
    totalEmployees: employees.length,
    totalVacationRecords: vacations.length,
    departmentBreakdown,
    contractBreakdown,
    vacationStatusBreakdown: statusBreakdown,
    activeLeavesToday,
    pendingRequests,
    leaveBalancesSummary: leaveBalances.slice(0, 60),
    officialHolidays: settings.officialHolidays,
  };

  try {
    const response = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        language,
        summaryContext,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return {
        text: '',
        error: data?.error || `Request failed with status ${response.status}`,
      };
    }

    return { text: data.text || '' };
  } catch (err) {
    console.error('AI analysis request failed:', err);
    return {
      text: '',
      error:
        language === 'ar'
          ? 'تعذر الاتصال بخادم التحليل. تأكد من تشغيل الخادم وإعداد مفتاح API.'
          : 'Unable to reach the analysis endpoint. Please try again shortly.',
    };
  }
};
