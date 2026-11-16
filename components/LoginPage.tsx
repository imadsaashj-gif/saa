import React, { useState } from 'react';
import { Lock, Moon, Sun, ArrowRight, ArrowLeft } from 'lucide-react';
import { AppUser, Language, SystemSettings, ThemeOption } from '../types';
import { t, translateRole } from '../i18n';
import { emblemImg, loginShowcaseImg } from '../assets';
import { AvatarWithFallback } from './UIPrimitives';

interface LoginPageProps {
  users: AppUser[];
  settings: SystemSettings;
  lang: Language;
  theme: ThemeOption;
  onChangeLanguage: (lang: Language) => void;
  onChangeTheme: (theme: ThemeOption) => void;
  onLoginSuccess: (user: AppUser) => void;
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  const branding = settings.branding;
  const orgName =
    lang === 'ar'
      ? branding?.orgNameAr || t(lang, 'brandTitle')
      : branding?.orgNameEn || t(lang, 'brandTitle');
  const orgTitle =
    lang === 'ar'
      ? branding?.orgTitleAr || t(lang, 'brandSubtitle')
      : branding?.orgTitleEn || t(lang, 'brandSubtitle');
  const logoSrc = branding?.logoDataUrl || emblemImg;
  const showcaseSrc = branding?.loginImageDataUrl || loginShowcaseImg;
  const headline =
    lang === 'ar'
      ? branding?.loginHeadlineAr || 'منظومة متكاملة لإدارة شؤون الموظفين، الإجازات، والهيكل الإداري'
      : branding?.loginHeadlineEn || 'Unified Administration for Staff Records, Requests & Heritage Sites';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const matched = users.find(
      (u) =>
        u.email.trim().toLowerCase() === email.trim().toLowerCase() &&
        u.password === password &&
        u.status === 'Active'
    );
    if (!matched) {
      setError(
        lang === 'ar'
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الحساب معطل.'
          : 'Invalid email or password, or account is inactive.'
      );
      return;
    }
    onLoginSuccess(matched);
  };

  const activeUsers = users.filter((u) => u.status === 'Active');

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--text-main)] grid grid-cols-1 lg:grid-cols-2 items-stretch">
      {/* Column 1: Login Form Panel — sits on the RIGHT in Arabic (RTL) and LEFT in English (LTR) */}
      <div className="flex flex-col justify-between p-6 sm:p-10 lg:p-14 bg-[var(--card-bg)] border-e border-[var(--border)]">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={logoSrc}
              alt={orgName}
              referrerPolicy="no-referrer"
              className="w-11 h-11 rounded-xl object-cover border border-[var(--border)] shrink-0"
            />
            <div className="min-w-0 text-start">
              <h1 className="font-display font-bold text-base text-[var(--text-main)] truncate">{orgName}</h1>
              <p className="text-xs text-[var(--text-muted)] truncate">{orgTitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onChangeLanguage(lang === 'ar' ? 'en' : 'ar')}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer whitespace-nowrap"
            >
              {t(lang, 'switchLang')}
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-[var(--text-main)] hover:border-[var(--primary)] cursor-pointer"
              title={theme === 'dark' ? t(lang, 'lightMode') : t(lang, 'darkMode')}
            >
              {theme === 'dark' ? <Sun size={15} className="text-[var(--primary-text)]" /> : <Moon size={15} className="text-[var(--primary-text)]" />}
            </button>
          </div>
        </div>

        {/* Center Form */}
        <div className="my-auto py-10 max-w-md w-full mx-auto space-y-6 text-start">
          <div className="space-y-2">
            <h2 className="font-display text-3xl font-bold text-[var(--text-main)]">
              {t(lang, 'signInTitle')}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">{t(lang, 'signInSubtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
                {t(lang, 'email')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="superadmin@archaeology.gov"
                className="w-full px-3.5 py-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm font-mono-tabular text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
                {t(lang, 'passwordLabel')}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock size={16} />
              <span>{t(lang, 'login')}</span>
            </button>
          </form>

          {/* Quick Access Accounts */}
          <div className="pt-5 border-t border-[var(--border)] space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)]">{t(lang, 'demoCredentialsNote')}</p>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {activeUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-[var(--border)] bg-[var(--app-bg)] hover:border-[var(--primary)] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(u.email);
                      setPassword(u.password || '');
                    }}
                    className="flex items-center gap-2.5 min-w-0 text-start flex-1 cursor-pointer"
                  >
                    <AvatarWithFallback src={u.avatar} name={u.name} sizeClass="w-8 h-8" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--text-main)] truncate">{u.name}</div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {translateRole(u.role, lang)} · <span className="font-mono-tabular">{u.email}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoginSuccess(u)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] text-xs font-semibold hover:bg-[var(--primary)] hover:text-[var(--primary-fg)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>{lang === 'ar' ? 'دخول' : 'Enter'}</span>
                    {lang === 'ar' ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-xs text-[var(--text-muted)] flex items-center justify-between pt-4 border-t border-[var(--border)]">
          <span>{orgName}</span>
          <span className="font-mono-tabular">{new Date().getFullYear()}</span>
        </div>
      </div>

      {/* Column 2: Showcase Visual Panel — sits on the LEFT in Arabic (RTL) and RIGHT in English (LTR) */}
      <div className="relative hidden lg:flex flex-col justify-end overflow-hidden bg-[#111318]">
        {!imgFailed ? (
          <img
            src={showcaseSrc}
            alt={orgName}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#191610] via-[#111318] to-[#2B2210]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/15" />

        <div className="relative z-10 p-12 space-y-4 text-start text-white max-w-xl">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#E4C268]">
            <span>{orgName}</span>
            <span aria-hidden="true">·</span>
            <span>{orgTitle}</span>
          </div>
          <h2 className="font-display text-3xl font-bold leading-snug text-white">
            {headline}
          </h2>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
