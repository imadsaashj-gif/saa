export interface VividCardStyle {
  id: string;
  hover: string;
  active: string;
}

export const VIVID_CARD_PALETTE: VividCardStyle[] = [
  {
    id: 'cyan',
    hover:
      'hover:border-cyan-400 hover:shadow-[0_0_14px_-3px_rgba(34,211,238,0.45)]',
    active:
      'border-cyan-400 bg-cyan-500/10 shadow-[0_0_16px_-2px_rgba(34,211,238,0.52)]',
  },
  {
    id: 'emerald',
    hover:
      'hover:border-emerald-400 hover:shadow-[0_0_14px_-3px_rgba(52,211,153,0.45)]',
    active:
      'border-emerald-400 bg-emerald-500/10 shadow-[0_0_16px_-2px_rgba(52,211,153,0.52)]',
  },
  {
    id: 'amber',
    hover:
      'hover:border-amber-400 hover:shadow-[0_0_14px_-3px_rgba(251,191,36,0.45)]',
    active:
      'border-amber-400 bg-amber-500/10 shadow-[0_0_16px_-2px_rgba(251,191,36,0.52)]',
  },
  {
    id: 'rose',
    hover:
      'hover:border-rose-500 hover:shadow-[0_0_14px_-3px_rgba(244,63,94,0.45)]',
    active:
      'border-rose-500 bg-rose-500/10 shadow-[0_0_16px_-2px_rgba(244,63,94,0.52)]',
  },
  {
    id: 'violet',
    hover:
      'hover:border-violet-500 hover:shadow-[0_0_14px_-3px_rgba(139,92,246,0.45)]',
    active:
      'border-violet-500 bg-violet-500/10 shadow-[0_0_16px_-2px_rgba(139,92,246,0.52)]',
  },
  {
    id: 'lime',
    hover:
      'hover:border-lime-400 hover:shadow-[0_0_14px_-3px_rgba(163,230,53,0.45)]',
    active:
      'border-lime-400 bg-lime-500/10 shadow-[0_0_16px_-2px_rgba(163,230,53,0.52)]',
  },
  {
    id: 'sky',
    hover:
      'hover:border-sky-400 hover:shadow-[0_0_14px_-3px_rgba(56,189,248,0.45)]',
    active:
      'border-sky-400 bg-sky-500/10 shadow-[0_0_16px_-2px_rgba(56,189,248,0.52)]',
  },
  {
    id: 'orange',
    hover:
      'hover:border-orange-500 hover:shadow-[0_0_14px_-3px_rgba(249,115,22,0.45)]',
    active:
      'border-orange-500 bg-orange-500/10 shadow-[0_0_16px_-2px_rgba(249,115,22,0.52)]',
  },
  {
    id: 'pink',
    hover:
      'hover:border-pink-500 hover:shadow-[0_0_14px_-3px_rgba(236,72,153,0.45)]',
    active:
      'border-pink-500 bg-pink-500/10 shadow-[0_0_16px_-2px_rgba(236,72,153,0.52)]',
  },
  {
    id: 'fuchsia',
    hover:
      'hover:border-fuchsia-500 hover:shadow-[0_0_14px_-3px_rgba(217,70,239,0.45)]',
    active:
      'border-fuchsia-500 bg-fuchsia-500/10 shadow-[0_0_16px_-2px_rgba(217,70,239,0.52)]',
  },
  {
    id: 'teal',
    hover:
      'hover:border-teal-400 hover:shadow-[0_0_14px_-3px_rgba(45,212,191,0.45)]',
    active:
      'border-teal-400 bg-teal-500/10 shadow-[0_0_16px_-2px_rgba(45,212,191,0.52)]',
  },
  {
    id: 'indigo',
    hover:
      'hover:border-indigo-400 hover:shadow-[0_0_14px_-3px_rgba(129,140,248,0.45)]',
    active:
      'border-indigo-400 bg-indigo-500/10 shadow-[0_0_16px_-2px_rgba(129,140,248,0.52)]',
  },
  {
    id: 'yellow',
    hover:
      'hover:border-yellow-400 hover:shadow-[0_0_14px_-3px_rgba(250,204,21,0.45)]',
    active:
      'border-yellow-400 bg-yellow-500/10 shadow-[0_0_16px_-2px_rgba(250,204,21,0.52)]',
  },
  {
    id: 'blue',
    hover:
      'hover:border-blue-500 hover:shadow-[0_0_14px_-3px_rgba(59,130,246,0.45)]',
    active:
      'border-blue-500 bg-blue-500/10 shadow-[0_0_16px_-2px_rgba(59,130,246,0.52)]',
  },
  {
    id: 'purple',
    hover:
      'hover:border-purple-500 hover:shadow-[0_0_14px_-3px_rgba(168,85,247,0.45)]',
    active:
      'border-purple-500 bg-purple-500/10 shadow-[0_0_16px_-2px_rgba(168,85,247,0.52)]',
  },
  {
    id: 'red',
    hover:
      'hover:border-red-500 hover:shadow-[0_0_14px_-3px_rgba(239,68,68,0.45)]',
    active:
      'border-red-500 bg-red-500/10 shadow-[0_0_16px_-2px_rgba(239,68,68,0.52)]',
  },
  {
    id: 'green',
    hover:
      'hover:border-green-400 hover:shadow-[0_0_14px_-3px_rgba(74,222,128,0.45)]',
    active:
      'border-green-400 bg-green-500/10 shadow-[0_0_16px_-2px_rgba(74,222,128,0.52)]',
  },
  {
    id: 'neon_magenta',
    hover:
      'hover:border-[#FF2E93] hover:shadow-[0_0_14px_-3px_rgba(255,46,147,0.45)]',
    active:
      'border-[#FF2E93] bg-[#FF2E93]/10 shadow-[0_0_16px_-2px_rgba(255,46,147,0.52)]',
  },
  {
    id: 'neon_aqua',
    hover:
      'hover:border-[#00F5D4] hover:shadow-[0_0_14px_-3px_rgba(0,245,212,0.45)]',
    active:
      'border-[#00F5D4] bg-[#00F5D4]/10 shadow-[0_0_16px_-2px_rgba(0,245,212,0.52)]',
  },
];

export function getVividCardClass(
  paletteIndex: number,
  options: { isActive?: boolean; interactive?: boolean } = {}
): string {
  const { isActive = false, interactive = true } = options;
  const entry = VIVID_CARD_PALETTE[paletteIndex % VIVID_CARD_PALETTE.length];
  const base = 'bg-[var(--card-bg)] border transition-all duration-150';
  const interactCls = interactive
    ? 'cursor-pointer hover:-translate-y-0.5 active:scale-[0.99]'
    : '';
  const stateCls = isActive
    ? entry.active
    : `border-[var(--border)] ${interactive ? entry.hover : ''}`;
  return `${base} ${interactCls} ${stateCls}`.trim();
}
