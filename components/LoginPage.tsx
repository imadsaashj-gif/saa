import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  Globe,
  Landmark,
  Lock,
  MapPin,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { AppUser, Language, SystemSettings, ThemeOption } from '../types';
import { t } from '../i18n';
import { emblemImg, loginShowcaseImg } from '../assets';

interface LoginPageProps {
  users: AppUser[];
  settings: SystemSettings;
  lang: Language;
  theme: ThemeOption;
  onChangeLanguage: (lang: Language) => void;
  onChangeTheme: (theme: ThemeOption) => void;
  onLoginSuccess: (user: AppUser) => void;
}

const REMEMBERED_IDENT_KEY = 'arch_hr_remembered_login_v1';

function getGlassBgClass(opacity?: number): string {
  const val = opacity ?? 20;
  if (val <= 12) return 'bg-[var(--card-bg)]/10';
  if (val <= 17) return 'bg-[var(--card-bg)]/15';
  if (val <= 22) return 'bg-[var(--card-bg)]/20';
  if (val <= 27) return 'bg-[var(--card-bg)]/25';
  if (val <= 34) return 'bg-[var(--card-bg)]/30';
  if (val <= 44) return 'bg-[var(--card-bg)]/40';
  if (val <= 54) return 'bg-[var(--card-bg)]/50';
  if (val <= 64) return 'bg-[var(--card-bg)]/60';
  if (val <= 74) return 'bg-[var(--card-bg)]/70';
  if (val <= 84) return 'bg-[var(--card-bg)]/80';
  if (val <= 92) return 'bg-[var(--card-bg)]/90';
  if (val <= 97) return 'bg-[var(--card-bg)]/95';
  return 'bg-[var(--card-bg)]';
}

function formatUtcTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())} UTC`;
}

const SLIDE_FILL_CLASSES = [
  'w-[0%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-[100%]',
];

const SLIDE_HANDLE_POSITIONS = [
  'start-[4px]',
  'start-[6%]',
  'start-[10%]',
  'start-[14%]',
  'start-[18%]',
  'start-[22%]',
  'start-[27%]',
  'start-[31%]',
  'start-[36%]',
  'start-[40%]',
  'start-[45%]',
  'start-[49%]',
  'start-[54%]',
  'start-[58%]',
  'start-[63%]',
  'start-[67%]',
  'start-[72%]',
  'start-[76%]',
  'start-[81%]',
  'start-[86%]',
];

function getSlideVisualClasses(val: number): { fillClass: string; handleClass: string } {
  const idx = Math.min(SLIDE_FILL_CLASSES.length - 1, Math.max(0, Math.round((val / 100) * (SLIDE_FILL_CLASSES.length - 1))));
  return {
    fillClass: SLIDE_FILL_CLASSES[idx],
    handleClass: SLIDE_HANDLE_POSITIONS[idx],
  };
}

const LoginPage: React.FC<LoginPageProps> = ({
  users,
  settings,
  lang,
  theme,
  onChangeLanguage,
  onChangeTheme,
  onLoginSuccess,
}) => {
  const [identifier, setIdentifier] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED_IDENT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBERED_IDENT_KEY));
    } catch {
      return false;
    }
  });
  const [showForgotHelp, setShowForgotHelp] = useState(false);
  const [slideValue, setSlideValue] = useState(0);
  const [isSlideVerified, setIsSlideVerified] = useState(false);
  const [error, setError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);
  const [utcNow, setUtcNow] = useState(() => formatUtcTimestamp(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUtcNow(formatUtcTimestamp(new Date()));
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const branding = settings.branding;
  const orgNameAr = branding?.orgNameAr || 'مصلحة الآثار';
  const orgNameEn = branding?.orgNameEn || 'Department of Archaeology';
  const orgName = lang === 'ar' ? orgNameAr : orgNameEn;
  const orgTitleAr = branding?.orgTitleAr || 'بوابة الموارد البشرية وطلبات الموظفين';
  const orgTitleEn = branding?.orgTitleEn || 'HR & Employee Requests Portal';
  const systemCode = branding?.loginSystemCode || 'HR PORTAL';
  const versionBadge = branding?.loginVersionBadge || 'PORTAL v2.4';
  const logoSrc = branding?.logoDataUrl || emblemImg;
  const loginBannerLogoSrc = branding?.loginLogoDataUrl;
  const showcaseSrc = branding?.loginImageDataUrl || loginShowcaseImg;
  const showcaseTitle =
    lang === 'ar'
      ? branding?.loginShowcaseTitleAr || 'الحفاظ على الآثار.'
      : branding?.loginShowcaseTitleEn || 'Preserving Heritage.';
  const headline =
    lang === 'ar'
      ? branding?.loginHeadlineAr ||
        'منظومة متكاملة لإدارة شؤون الموظفين، الحضور والانصراف، الإجازات، والهيكل الإداري.'
      : branding?.loginHeadlineEn ||
        'Unified Administration for Staff Records, Attendance, Leave & Heritage Sites.';
  const rawTags =
    lang === 'ar'
      ? branding?.loginShowcaseTagsAr || 'سجل الموظفين، الحضور والمواقع، الإجازات والطلبات'
      : branding?.loginShowcaseTagsEn || 'Staff Registry, Attendance & Sites, Leave & Requests';
  const showcaseTags = rawTags
    .split(/[،,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
  const restrictedNotice =
    lang === 'ar'
      ? branding?.loginRestrictedNoticeAr || 'دخول مقيد — للمستخدمين المصرح لهم فقط'
      : branding?.loginRestrictedNoticeEn || 'Restricted Access — Authorized Users Only';
  const forgotHelpText =
    lang === 'ar'
      ? branding?.loginForgotHelpAr ||
        'يرجى التواصل مع مسؤول النظام أو إدارة الموارد البشرية لإعادة تعيين كلمة المرور.'
      : branding?.loginForgotHelpEn ||
        'Please contact the System Administrator or HR Department to reset your password.';

  const glassClass = getGlassBgClass(branding?.loginCardOpacity);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isSlideVerified) {
      setError(t(lang, 'slideToVerifyError'));
      return;
    }

    const ident = identifier.trim().toLowerCase();
    const matched = users.find(
      (u) =>
        ((u.username && u.username.trim().toLowerCase() === ident) ||
          u.email.trim().toLowerCase() === ident) &&
        u.password === password &&
        u.status === 'Active'
    );
    if (!matched) {
      setIsSlideVerified(false);
      setSlideValue(0);
      setError(
        lang === 'ar'
          ? 'اسم المستخدم أو البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الحساب معطل.'
          : 'Invalid username/email or password, or account is inactive.'
      );
      return;
    }

    try {
      if (rememberMe && identifier.trim()) {
        localStorage.setItem(REMEMBERED_IDENT_KEY, identifier.trim());
      } else {
        localStorage.removeItem(REMEMBERED_IDENT_KEY);
      }
    } catch {
      // Ignore storage error
    }

    onLoginSuccess(matched);
  };

  const tagIcons = [Landmark, MapPin, Users, ShieldCheck];

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="relative min-h-screen w-full overflow-hidden flex items-stretch justify-start bg-[#111318] text-[var(--text-main)]"
    >
      {/* Full-Screen Showcase Background Image */}
      {!imgFailed ? (
        <img
          src={showcaseSrc}
          alt={orgName}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="fixed inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="fixed inset-0 bg-gradient-to-br from-[#191610] via-[#111318] to-[#2B2210]" />
      )}
      <div
        className={`fixed inset-0 bg-gradient-to-b ${
          theme === 'dark'
            ? 'from-black/35 via-black/25 to-black/70'
            : 'from-white/60 via-white/40 to-black/35'
        }`}
      />

      {/* Side-Docked Full-Height Translucent Login Panel (Right in AR / Left in EN) */}
      <aside
        className={`relative z-20 w-full md:w-[460px] lg:w-[500px] min-h-screen shrink-0 ${glassClass} backdrop-blur-xl border-e border-[var(--border)] px-5 sm:px-7 py-5 flex flex-col justify-between gap-4 shadow-2xl`}
      >
        {/* Top Controls Row: Language (Globe), Theme Switcher, Version Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeLanguage(lang === 'ar' ? 'en' : 'ar')}
              title={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
              aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)]/85 text-xs font-semibold text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
            >
              <span>{t(lang, 'switchLang')}</span>
              <Globe size={14} className="text-[var(--primary-text)]" />
            </button>

            <button
              type="button"
              onClick={() => onChangeTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)]/85 text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer"
              title={theme === 'dark' ? t(lang, 'lightMode') : t(lang, 'darkMode')}
              aria-label={theme === 'dark' ? t(lang, 'lightMode') : t(lang, 'darkMode')}
            >
              {theme === 'dark' ? (
                <Sun size={14} className="text-[var(--primary-text)]" />
              ) : (
                <Moon size={14} className="text-[var(--primary-text)]" />
              )}
            </button>
          </div>

          {versionBadge && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--app-bg)]/85 text-[11px] font-mono-tabular text-[var(--text-muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span>{versionBadge}</span>
            </div>
          )}
        </div>

        {/* Center Brand Identity + Login Form Card */}
        <div className="w-full space-y-4 my-auto py-2">
          {/* 220 x 81.89 px Login Logo & System Titles */}
          <div className="text-center space-y-2">
            <div className="w-[220px] h-[81.89px] mx-auto rounded-xl border border-[var(--border)] bg-[var(--app-bg)]/70 flex items-center justify-center overflow-hidden px-2">
              {loginBannerLogoSrc ? (
                <img
                  src={loginBannerLogoSrc}
                  alt={orgName}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex items-center gap-2.5 px-2 min-w-0">
                  <img
                    src={logoSrc}
                    alt={orgName}
                    className="w-12 h-12 rounded-lg object-cover border border-[var(--border)] shrink-0"
                  />
                  <div className="min-w-0 text-start">
                    <p className="font-display font-bold text-xs text-[var(--text-main)] truncate">
                      {orgNameAr}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">
                      {orgNameEn}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {systemCode && (
              <h1 className="font-display font-extrabold text-base tracking-wide text-[var(--primary-text)]">
                {systemCode}
              </h1>
            )}
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-[var(--text-main)]">{orgTitleAr}</p>
              <p className="text-[11px] text-[var(--text-muted)]">{orgTitleEn}</p>
            </div>
          </div>

          {/* Translucent Form Card (No Digital ID) */}
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)]/80 dark:bg-[var(--card-bg)]/50 backdrop-blur-md p-5 space-y-3.5 text-start shadow-xl"
          >
            <div>
              <label className="block text-xs font-semibold text-[var(--text-main)] mb-1">
                {t(lang, 'usernameOrEmailLabel')} <span className="text-[var(--status-danger-text)]">*</span>
              </label>
              <div className="relative">
                <User
                  size={15}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 text-[var(--text-muted)]"
                />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin"
                  dir="ltr"
                  className="w-full ps-9 pe-3 py-2.5 bg-[var(--app-bg)] text-[var(--text-main)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-main)] mb-1">
                {t(lang, 'passwordLabel')} <span className="text-[var(--status-danger-text)]">*</span>
              </label>
              <div className="relative">
                <Lock
                  size={15}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 text-[var(--text-muted)]"
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full ps-9 pe-10 py-2.5 bg-[var(--app-bg)] text-[var(--text-main)] border border-[var(--border)] rounded-lg text-sm outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 -translate-y-1/2 end-2.5 p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Remember Me + Forgot Password */}
            <div className="flex items-center justify-between gap-2 text-xs">
              <label className="inline-flex items-center gap-1.5 text-[var(--text-muted)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-[var(--border)] accent-[var(--primary)] cursor-pointer"
                />
                <span>{t(lang, 'rememberMeLabel')}</span>
              </label>
              <button
                type="button"
                onClick={() => setShowForgotHelp((prev) => !prev)}
                className="text-[var(--primary-text)] hover:underline font-semibold cursor-pointer"
              >
                {t(lang, 'forgotPasswordLabel')}
              </button>
            </div>

            {showForgotHelp && (
              <div className="p-2.5 rounded-lg bg-[var(--status-info-bg)] border border-[var(--status-info-border)] text-[11px] text-[var(--status-info-text)] leading-relaxed">
                {forgotHelpText}
              </div>
            )}

            {/* Slide-to-Verify Security Bar */}
            {(() => {
              const { fillClass, handleClass } = getSlideVisualClasses(isSlideVerified ? 100 : slideValue);
              return (
                <div className="space-y-1">
                  <div
                    className={`relative h-11 rounded-lg border overflow-hidden select-none transition-colors ${
                      isSlideVerified
                        ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]'
                        : 'border-[var(--border)] bg-[var(--app-bg)]/90'
                    }`}
                  >
                    {/* Gold Theme Fill Track */}
                    {!isSlideVerified && slideValue > 0 && (
                      <div
                        className={`pointer-events-none absolute inset-y-0 start-0 bg-[var(--primary-soft)] border-e border-[var(--primary)]/40 transition-all duration-75 ${fillClass}`}
                      />
                    )}

                    {/* Center Prompt / Verified Status */}
                    <div className="absolute inset-0 flex items-center justify-center gap-2 px-12 text-xs font-semibold pointer-events-none">
                      {isSlideVerified ? (
                        <>
                          <CheckCircle2 size={15} className="text-[var(--status-success-text)] shrink-0" />
                          <span className="text-[var(--status-success-text)] truncate">
                            {t(lang, 'slideToVerifyDone')}
                          </span>
                        </>
                      ) : (
                        <>
                          {lang === 'ar' ? (
                            <ChevronsLeft size={14} className="text-[var(--primary-text)] animate-pulse shrink-0" />
                          ) : (
                            <ChevronsRight size={14} className="text-[var(--primary-text)] animate-pulse shrink-0" />
                          )}
                          <span className="text-[var(--text-muted)] truncate">
                            {t(lang, 'slideToVerifyPrompt')}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Theme-Matched Sliding Handle */}
                    {!isSlideVerified && (
                      <div
                        className={`pointer-events-none absolute top-1 bottom-1 w-10 rounded-md bg-[var(--primary)] text-[var(--primary-fg)] border border-[var(--primary-hover)] shadow-sm flex items-center justify-center transition-all duration-75 z-10 ${handleClass}`}
                      >
                        {lang === 'ar' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                      </div>
                    )}

                    {!isSlideVerified ? (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        dir={lang === 'ar' ? 'rtl' : 'ltr'}
                        value={slideValue}
                        aria-label={t(lang, 'slideToVerifyPrompt')}
                        onChange={(e) => {
                          const nextVal = Number(e.target.value);
                          if (nextVal >= 92) {
                            setSlideValue(100);
                            setIsSlideVerified(true);
                            setError('');
                          } else {
                            setSlideValue(nextVal);
                          }
                        }}
                        onPointerUp={() => {
                          if (!isSlideVerified && slideValue < 92) {
                            setSlideValue(0);
                          }
                        }}
                        onKeyUp={() => {
                          if (!isSlideVerified && slideValue < 92) {
                            setSlideValue(0);
                          }
                        }}
                        className="absolute inset-0 z-20 w-full h-full opacity-0 cursor-grab active:cursor-grabbing"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsSlideVerified(false);
                          setSlideValue(0);
                        }}
                        title={lang === 'ar' ? 'إعادة تعيين التحقق' : 'Reset verification'}
                        className="relative z-20 h-11 px-3 flex items-center justify-center text-[var(--status-success-text)] hover:opacity-80 cursor-pointer"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {error && (
              <div className="p-2.5 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!isSlideVerified}
              className={`w-full py-2.5 px-4 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                isSlideVerified
                  ? 'bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-fg)] cursor-pointer shadow-md'
                  : 'bg-[var(--surface-subtle)] text-[var(--text-muted)] border border-[var(--border)] cursor-not-allowed opacity-80'
              }`}
            >
              {isSlideVerified ? <ShieldCheck size={16} /> : <Lock size={16} />}
              <span>{t(lang, 'login')}</span>
            </button>
          </form>
        </div>

        {/* Restricted Access Footer & UTC Clock */}
        <div className="pt-3 border-t border-[var(--border)] text-center space-y-1 text-[11px] text-[var(--text-muted)]">
          <p className="font-medium">
            {orgName} © {new Date().getFullYear()}
          </p>
          <p className="text-[11px] text-[var(--text-main)] font-semibold">
            {restrictedNotice}
          </p>
          <p className="font-mono-tabular text-[10px] text-[var(--text-muted)]" dir="ltr">
            {utcNow}
          </p>
        </div>
      </aside>

      {/* Open Showcase Area (Opposite Side of Login Panel) */}
      <section className="hidden md:flex flex-1 relative z-10 flex-col justify-between p-8 lg:p-10 pointer-events-none">
        {/* Top End Organization Pill */}
        <div className="flex justify-end">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-black/45 backdrop-blur-md border border-white/15 text-xs text-white/95 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-[#e2c16b]" />
            <span className="font-semibold">{orgNameAr}</span>
            <span className="text-white/50">·</span>
            <span className="text-white/80">{orgNameEn}</span>
          </div>
        </div>

        {/* Bottom Hero Showcase Text & Feature Tags */}
        <div className="max-w-2xl space-y-3 text-start">
          <h2 className="font-display font-extrabold text-3xl lg:text-4xl text-[#e2c16b] drop-shadow-md">
            {showcaseTitle}
          </h2>
          <p className="text-sm lg:text-base text-white/90 leading-relaxed drop-shadow max-w-xl">
            {headline}
          </p>
          {showcaseTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {showcaseTags.map((tag, idx) => {
                const TagIcon = tagIcons[idx % tagIcons.length];
                return (
                  <span
                    key={`${tag}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/15 text-xs font-medium text-white/95 shadow"
                  >
                    <TagIcon size={13} className="text-[#e2c16b] shrink-0" />
                    <span>{tag}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default LoginPage;
