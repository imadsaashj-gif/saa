import React, { useState } from 'react';
import { BarChart3, Send, Loader2, AlertCircle } from 'lucide-react';
import { Employee, Language, SystemSettings, Vacation } from '../types';
import { TRANSLATIONS, t } from '../i18n';
import { analyzeDataWithGemini } from '../services/geminiService';

interface AIAssistantViewProps {
  employees: Employee[];
  vacations: Vacation[];
  settings: SystemSettings;
  lang: Language;
}

interface MessageItem {
  id: string;
  question: string;
  answer: string;
  error?: string;
  timestamp: string;
}

const FormattedMarkdownText: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  return (
    <div className="space-y-2 text-sm leading-relaxed text-[var(--text-main)]">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={i} className="font-display font-bold text-sm text-[var(--primary-text)] pt-2">
              {trimmed.slice(4)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
          const text = trimmed.replace(/^#+\s*/, '');
          return (
            <h3 key={i} className="font-display font-bold text-base text-[var(--primary-text)] pt-2">
              {text}
            </h3>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={i} className="flex items-start gap-2 ps-2">
              <span className="text-[var(--primary-text)] mt-1">•</span>
              <span>{trimmed.slice(2).replace(/\*\*/g, '')}</span>
            </div>
          );
        }
        return <p key={i}>{trimmed.replace(/\*\*/g, '')}</p>;
      })}
    </div>
  );
};

const AIAssistantView: React.FC<AIAssistantViewProps> = ({ employees, vacations, settings, lang }) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<MessageItem[]>([]);

  const quickPrompts = TRANSLATIONS[lang].aiQuickPrompts;

  const runAnalysis = async (queryText: string) => {
    const clean = queryText.trim();
    if (!clean || isLoading) return;
    setIsLoading(true);
    setPrompt('');

    const result = await analyzeDataWithGemini(employees, vacations, settings, clean, lang);
    setHistory((prev) => [
      {
        id: String(Date.now()),
        question: clean,
        answer: result.text,
        error: result.error,
        timestamp: new Date().toLocaleTimeString(lang === 'ar' ? 'ar-LY' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
      ...prev,
    ]);
    setIsLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-[var(--text-main)]">
      <div className="pb-2 border-b border-[var(--border)] flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[var(--primary-soft)] text-[var(--primary-text)] border border-[var(--border)]">
            <BarChart3 size={22} />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold text-[var(--text-main)]">{t(lang, 'aiTitle')}</h2>
            <p className="text-sm text-[var(--text-muted)]">{t(lang, 'aiSubtitle')}</p>
          </div>
        </div>
      </div>

      {/* Input Panel */}
      <div className="bg-[var(--card-bg)] p-6 rounded-xl border border-[var(--border)] space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runAnalysis(prompt)}
            placeholder={t(lang, 'aiPlaceholder')}
            className="flex-1 px-4 py-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
          />
          <button
            type="button"
            disabled={isLoading || !prompt.trim()}
            onClick={() => runAnalysis(prompt)}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-semibold hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            <span>{isLoading ? t(lang, 'aiAnalyzing') : t(lang, 'aiAnalyzeBtn')}</span>
          </button>
        </div>

        {/* Quick Insight Prompts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
          {quickPrompts.map((qp) => (
            <button
              key={qp}
              type="button"
              disabled={isLoading}
              onClick={() => runAnalysis(qp)}
              className="text-start p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border)] text-xs text-[var(--text-main)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {qp}
            </button>
          ))}
        </div>
      </div>

      {/* Analysis Output History */}
      <div className="space-y-4">
        {history.map((item) => (
          <article
            key={item.id}
            className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] overflow-hidden"
          >
            <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between gap-4">
              <h3 className="font-semibold text-sm text-[var(--text-main)]">{item.question}</h3>
              <span className="text-xs font-mono-tabular text-[var(--text-muted)] shrink-0">
                {item.timestamp}
              </span>
            </div>
            <div className="p-6">
              {item.error ? (
                <div className="p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-xs text-[var(--status-danger-text)] flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{item.error}</span>
                </div>
              ) : (
                <FormattedMarkdownText content={item.answer} />
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default AIAssistantView;
