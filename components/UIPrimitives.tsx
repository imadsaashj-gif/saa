import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info, RotateCcw, X, XCircle } from 'lucide-react';
import { Language } from '../types';
import { translateStatus } from '../i18n';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export const AvatarWithFallback: React.FC<{
  src?: string;
  name: string;
  sizeClass?: string;
}> = ({ src, name, sizeClass = 'w-9 h-9' }) => {
  const [failed, setFailed] = React.useState(false);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join('')
    .toUpperCase();

  if (!src || failed) {
    return (
      <div
        className={`${sizeClass} rounded-lg bg-[var(--primary-soft)] text-[var(--primary-text)] border border-[var(--border)] flex items-center justify-center font-display font-bold text-xs shrink-0 select-none`}
        aria-hidden="true"
      >
        {initials || '؟'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${sizeClass} rounded-lg object-cover border border-[var(--border)] shrink-0`}
    />
  );
};

export const StatusLabel: React.FC<{
  status: string;
  lang: Language;
}> = ({ status, lang }) => {
  const s = status.trim().toLowerCase();
  let colorClass = 'text-[var(--text-muted)]';
  let Icon = Info;

  if (s === 'approved' || s === 'active' || s === 'on job') {
    colorClass = 'text-[var(--status-success-text)]';
    Icon = CheckCircle2;
  } else if (s === 'pending' || s === 'on leave') {
    colorClass = 'text-[var(--status-warn-text)]';
    Icon = Clock;
  } else if (s === 'rejected' || s === 'terminated' || s === 'resigned' || s === 'inactive') {
    colorClass = 'text-[var(--status-danger-text)]';
    Icon = XCircle;
  } else if (s === 'returned') {
    colorClass = 'text-[var(--primary-text)]';
    Icon = RotateCcw;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${colorClass}`}>
      <Icon size={14} className="shrink-0" />
      <span>{translateStatus(status, lang)}</span>
    </span>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmText, cancelText, destructive = true, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-5"
      >
        <div className="flex items-start gap-3">
          <div
            className={`p-2.5 rounded-lg shrink-0 ${
              destructive
                ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]'
                : 'bg-[var(--primary-soft)] text-[var(--primary-text)]'
            }`}
          >
            <AlertTriangle size={20} />
          </div>
          <div className="space-y-1 flex-1">
            <h3 className="font-display text-base font-bold text-[var(--text-main)]">{title}</h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text-main)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              destructive
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ToastContainer: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 end-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        const styles =
          toast.type === 'success'
            ? 'border-[var(--status-success-border)] bg-[var(--card-bg)] text-[var(--status-success-text)]'
            : toast.type === 'error'
            ? 'border-[var(--status-danger-border)] bg-[var(--card-bg)] text-[var(--status-danger-text)]'
            : toast.type === 'warning'
            ? 'border-[var(--status-warn-border)] bg-[var(--card-bg)] text-[var(--status-warn-text)]'
            : 'border-[var(--border)] bg-[var(--card-bg)] text-[var(--primary-text)]';
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm ${styles}`}
          >
            <span className="text-[var(--text-main)] font-medium">{toast.text}</span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0 cursor-pointer"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
