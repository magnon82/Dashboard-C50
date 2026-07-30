export type ThemeId = 'excel' | 'slate' | 'carranza' | 'midnight';

export interface DashboardTheme {
  id: ThemeId;
  name: string;
  description: string;
  pageBg: string;
  headerBg: string;
  headerSub: string;
  headerMuted: string;
  selectBg: string;
  cardBg: string;
  title: string;
  muted: string;
  kpi: Array<{ border: string; label: string }>;
  tableHead: string;
  tableFoot: string;
  tableWeek: string;
  tableTotal: string;
  chartColors: string[];
}

export const DASHBOARD_THEMES: DashboardTheme[] = [
  {
    id: 'excel',
    name: 'Corporativo Excel',
    description: 'Azul marino, verde y púrpura — como tu Dashboard ventas 2025',
    pageBg: '#eef1f5',
    headerBg: '#1e3a5f',
    headerSub: '#bfdbfe',
    headerMuted: '#dbeafe',
    selectBg: 'rgba(255,255,255,0.1)',
    cardBg: '#ffffff',
    title: '#1e3a5f',
    muted: '#64748b',
    kpi: [
      { border: '#217346', label: '#217346' },
      { border: '#0d9488', label: '#0d9488' },
      { border: '#2e75b6', label: '#2e75b6' },
      { border: '#7030a0', label: '#7030a0' },
    ],
    tableHead: '#1e3a5f',
    tableFoot: '#217346',
    tableWeek: '#2e75b6',
    tableTotal: '#217346',
    chartColors: ['blue', 'emerald', 'amber', 'violet', 'rose'],
  },
  {
    id: 'slate',
    name: 'Slate Pro',
    description: 'Minimalista tipo SaaS — grises fríos y acentos índigo',
    pageBg: '#f8fafc',
    headerBg: '#0f172a',
    headerSub: '#94a3b8',
    headerMuted: '#cbd5e1',
    selectBg: 'rgba(255,255,255,0.08)',
    cardBg: '#ffffff',
    title: '#0f172a',
    muted: '#64748b',
    kpi: [
      { border: '#6366f1', label: '#4f46e5' },
      { border: '#14b8a6', label: '#0d9488' },
      { border: '#3b82f6', label: '#2563eb' },
      { border: '#8b5cf6', label: '#7c3aed' },
    ],
    tableHead: '#0f172a',
    tableFoot: '#334155',
    tableWeek: '#6366f1',
    tableTotal: '#0f172a',
    chartColors: ['indigo', 'cyan', 'amber', 'violet', 'slate'],
  },
  {
    id: 'carranza',
    name: 'Carranza Cálido',
    description: 'Terracota y oliva — identidad restaurante / hospitalidad',
    pageBg: '#faf7f2',
    headerBg: '#7c2d12',
    headerSub: '#fed7aa',
    headerMuted: '#ffedd5',
    selectBg: 'rgba(255,255,255,0.12)',
    cardBg: '#ffffff',
    title: '#431407',
    muted: '#78716c',
    kpi: [
      { border: '#b45309', label: '#92400e' },
      { border: '#65a30d', label: '#4d7c0f' },
      { border: '#c2410c', label: '#9a3412' },
      { border: '#a16207', label: '#854d0e' },
    ],
    tableHead: '#7c2d12',
    tableFoot: '#65a30d',
    tableWeek: '#b45309',
    tableTotal: '#4d7c0f',
    chartColors: ['orange', 'lime', 'amber', 'red', 'yellow'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Modo oscuro — contraste alto para pantallas largas',
    pageBg: '#0b1120',
    headerBg: '#111827',
    headerSub: '#6b7280',
    headerMuted: '#9ca3af',
    selectBg: 'rgba(255,255,255,0.06)',
    cardBg: '#1f2937',
    title: '#f9fafb',
    muted: '#9ca3af',
    kpi: [
      { border: '#34d399', label: '#6ee7b7' },
      { border: '#22d3ee', label: '#67e8f9' },
      { border: '#60a5fa', label: '#93c5fd' },
      { border: '#a78bfa', label: '#c4b5fd' },
    ],
    tableHead: '#374151',
    tableFoot: '#065f46',
    tableWeek: '#60a5fa',
    tableTotal: '#34d399',
    chartColors: ['emerald', 'cyan', 'blue', 'violet', 'pink'],
  },
];

export function getTheme(id: ThemeId): DashboardTheme {
  return DASHBOARD_THEMES.find((t) => t.id === id) ?? DASHBOARD_THEMES[0];
}
