import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Bell,
  CheckCheck,
  FileText,
  Mail,
  Settings,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { AppNotification, Language, NotificationSettings } from '../types';
import { t } from '../i18n';

interface NotificationsPopoverProps {
  notifications: AppNotification[];
  notificationSettings: NotificationSettings;
  lang: Language;
  canOpenSettings: boolean;
  onMarkAsRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearRead: () => void;
  onNavigateFromNotification: (notification: AppNotification) => void;
  onOpenNotificationSettings: () => void;
}

const NotificationsPopover: React.FC<NotificationsPopoverProps> = ({
  notifications,
  notificationSettings,
  lang,
  canOpenSettings,
  onMarkAsRead,
  onMarkAllRead,
  onClearRead,
  onNavigateFromNotification,
  onOpenNotificationSettings,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === 'ar' ? 'ar-LY' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const getIconForType = (type: AppNotification['type']) => {
    if (type === 'substitute') return <ArrowLeftRight size={15} className="text-[var(--primary-text)]" />;
    if (type === 'status') return <CheckCheck size={15} className="text-[var(--status-success-text)]" />;
    if (type === 'system') return <ShieldAlert size={15} className="text-[var(--status-warn-text)]" />;
    return <FileText size={15} className="text-[var(--primary-text)]" />;
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`relative inline-flex items-center justify-center p-2 rounded-lg border transition-colors cursor-pointer ${
          open
            ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-text)]'
            : 'border-[var(--border)] bg-[var(--app-bg)] text-[var(--text-main)] hover:border-[var(--primary)]'
        }`}
        aria-label={t(lang, 'notificationsTitle')}
        title={t(lang, 'notificationsTitle')}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -end-1.5 min-w-[18px] h-[18px] px-1 rounded-md bg-[var(--primary)] text-[var(--primary-fg)] font-mono-tabular text-[10px] font-bold flex items-center justify-center border border-[var(--card-bg)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute top-14 sm:top-full end-2 sm:end-0 mt-0 sm:mt-2 w-[calc(100vw-1rem)] sm:w-96 bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl z-[85] overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-bold text-[var(--text-main)]">
                  {t(lang, 'notificationsTitle')}
                </h3>
                {unreadCount > 0 && (
                  <span className="font-mono-tabular text-[11px] font-semibold text-[var(--primary-text)]">
                    ({unreadCount} {t(lang, 'unreadNotifications')})
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                <span>
                  {notificationSettings.appEnabled
                    ? lang === 'ar'
                      ? 'التطبيق: مفعّل'
                      : 'App: On'
                    : lang === 'ar'
                    ? 'التطبيق: متوقف'
                    : 'App: Off'}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1 truncate max-w-[190px]">
                  <Mail size={10} />
                  {notificationSettings.emailEnabled
                    ? notificationSettings.notificationEmail || (lang === 'ar' ? 'البريد مفعّل' : 'Email On')
                    : lang === 'ar'
                    ? 'البريد متوقف'
                    : 'Email Off'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--card-bg)] cursor-pointer"
                  title={t(lang, 'markAllRead')}
                >
                  <CheckCheck size={16} />
                </button>
              )}
              {canOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenNotificationSettings();
                  }}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary-text)] hover:bg-[var(--card-bg)] cursor-pointer"
                  title={t(lang, 'openNotificationSettings')}
                >
                  <Settings size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-[var(--border)]">
            {notifications.length > 0 ? (
              notifications.map((item) => {
                const title = lang === 'ar' ? item.titleAr : item.titleEn;
                const message = lang === 'ar' ? item.messageAr : item.messageEn;
                const channelText = item.channels
                  .map((ch) =>
                    ch === 'app'
                      ? lang === 'ar'
                        ? 'التطبيق'
                        : 'App'
                      : ch === 'email'
                      ? lang === 'ar'
                        ? 'البريد الإلكتروني'
                        : 'Email'
                      : lang === 'ar'
                      ? 'المتصفح'
                      : 'Browser'
                  )
                  .join(' · ');

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onMarkAsRead(item.id);
                      setOpen(false);
                      onNavigateFromNotification(item);
                    }}
                    className={`w-full text-start p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                      item.read
                        ? 'bg-[var(--card-bg)] hover:bg-[var(--surface-subtle)]/50'
                        : 'bg-[var(--primary-soft)]/50 hover:bg-[var(--primary-soft)]/80'
                    }`}
                  >
                    <div className="p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] shrink-0 mt-0.5">
                      {getIconForType(item.type)}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[var(--text-main)] truncate">{title}</span>
                        {!item.read && <span className="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" />}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{message}</p>
                      <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)] pt-0.5">
                        <span className="font-mono-tabular">{formatTime(item.timestamp)}</span>
                        <span>{channelText}</span>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="py-12 px-6 text-center space-y-2 text-[var(--text-muted)]">
                <Bell size={24} className="mx-auto opacity-45" />
                <p className="text-xs">{t(lang, 'noNotifications')}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onClearRead}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--status-danger-text)] cursor-pointer"
              >
                <Trash2 size={13} />
                <span>{t(lang, 'clearReadNotifications')}</span>
              </button>

              {canOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenNotificationSettings();
                  }}
                  className="text-xs font-semibold text-[var(--primary-text)] hover:underline cursor-pointer"
                >
                  {t(lang, 'openNotificationSettings')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationsPopover;
