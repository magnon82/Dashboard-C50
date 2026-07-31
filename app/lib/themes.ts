export type ThemeId = 'suite' | 'excel' | 'slate' | 'carranza' | 'midnight';

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
  accent: string;
  accentSoft: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarMuted: string;
  kpi: Array<{ border: string; label: string }>;
  tableHead: string;
  tableFoot: string;
  tableWeek: string;
  tableTotal: string;
  chartColors: string[];
  chartPrimary: string;
  chartSecondary: string;
}

/** Tokens del mockup: navy + naranja + cards blancas redondeadas */
export const SUITE = {
  navy: '#1B2A4A',
  navyDeep: '#152238',
  navySoft: '#2A3F66',
  orange: '#E8A317',
  orangeDeep: '#D4890F',
  orangeSoft: '#FFF4DE',
  pageBg: '#E8ECF1',
  card: '#FFFFFF',
  text: '#1B2A4A',
  muted: '#6B7A90',
  border: '#E2E8F0',
  shadow: '0 10px 30px rgba(27, 42, 74, 0.08)',
} as const;

export const DASHBOARD_THEMES: DashboardTheme[] = [
  {
    id: 'suite',
    name: 'Suite C50',
    description: 'Navy + naranja — diseño unificado del hub',
    pageBg: SUITE.pageBg,
    headerBg: SUITE.navy,
    headerSub: '#A8B8D4',
    headerMuted: '#C5D0E3',
    selectBg: 'rgba(255,255,255,0.12)',
    cardBg: SUITE.card,
    title: SUITE.navy,
    muted: SUITE.muted,
    accent: SUITE.orange,
    accentSoft: SUITE.orangeSoft,
    sidebarBg: SUITE.navy,
    sidebarText: '#FFFFFF',
    sidebarMuted: '#A8B8D4',
    kpi: [
      { border: SUITE.navy, label: SUITE.navy },
      { border: SUITE.orange, label: SUITE.orangeDeep },
      { border: SUITE.navySoft, label: SUITE.navySoft },
      { border: '#C47B0A', label: '#C47B0A' },
    ],
    tableHead: SUITE.navy,
    tableFoot: SUITE.navySoft,
    tableWeek: SUITE.orangeDeep,
    tableTotal: SUITE.navy,
    chartColors: ['blue', 'amber', 'slate', 'orange', 'indigo'],
    chartPrimary: SUITE.navy,
    chartSecondary: SUITE.orange,
  },
  {
    id: 'excel',
    name: 'Corporativo Excel',
    description: 'Azul marino, verde y púrpura — legado',
    pageBg: '#eef1f5',
    headerBg: '#1e3a5f',
    headerSub: '#bfdbfe',
    headerMuted: '#dbeafe',
    selectBg: 'rgba(255,255,255,0.1)',
    cardBg: '#ffffff',
    title: '#1e3a5f',
    muted: '#64748b',
    accent: '#c55a11',
    accentSoft: '#fff7ed',
    sidebarBg: '#1e3a5f',
    sidebarText: '#FFFFFF',
    sidebarMuted: '#bfdbfe',
    kpi: [
      { border: '#217346', label: '#217346' },
      { border: '#0d9488', label: '#0d9488' },
      { border: '#2b579a', label: '#2b579a' },
      { border: '#7030a0', label: '#7030a0' },
    ],
    tableHead: '#1e3a5f',
    tableFoot: '#217346',
    tableWeek: '#2e75b6',
    tableTotal: '#217346',
    chartColors: ['blue', 'emerald', 'amber', 'violet', 'rose'],
    chartPrimary: '#1B2A4A',
    chartSecondary: '#E8A317',
  },
  {
    id: 'slate',
    name: 'Slate Pro',
    description: 'Minimalista tipo SaaS',
    pageBg: '#f8fafc',
    headerBg: '#0f172a',
    headerSub: '#94a3b8',
    headerMuted: '#cbd5e1',
    selectBg: 'rgba(255,255,255,0.08)',
    cardBg: '#ffffff',
    title: '#0f172a',
    muted: '#64748b',
    accent: '#f59e0b',
    accentSoft: '#fffbeb',
    sidebarBg: '#0f172a',
    sidebarText: '#FFFFFF',
    sidebarMuted: '#94a3b8',
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
    chartPrimary: '#1B2A4A',
    chartSecondary: '#E8A317',
  },
  {
    id: 'carranza',
    name: 'Carranza Cálido',
    description: 'Terracota y oliva',
    pageBg: '#faf7f2',
    headerBg: '#7c2d12',
    headerSub: '#fed7aa',
    headerMuted: '#ffedd5',
    selectBg: 'rgba(255,255,255,0.12)',
    cardBg: '#ffffff',
    title: '#431407',
    muted: '#78716c',
    accent: '#b45309',
    accentSoft: '#fff7ed',
    sidebarBg: '#7c2d12',
    sidebarText: '#FFFFFF',
    sidebarMuted: '#fed7aa',
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
    chartPrimary: '#1B2A4A',
    chartSecondary: '#E8A317',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Modo oscuro',
    pageBg: '#0b1120',
    headerBg: '#111827',
    headerSub: '#6b7280',
    headerMuted: '#9ca3af',
    selectBg: 'rgba(255,255,255,0.06)',
    cardBg: '#1f2937',
    title: '#f9fafb',
    muted: '#9ca3af',
    accent: '#f59e0b',
    accentSoft: '#422006',
    sidebarBg: '#111827',
    sidebarText: '#FFFFFF',
    sidebarMuted: '#9ca3af',
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
    chartPrimary: '#60a5fa',
    chartSecondary: '#f59e0b',
  },
];

export function getTheme(id: ThemeId = 'suite'): DashboardTheme {
  return DASHBOARD_THEMES.find((t) => t.id === id) ?? DASHBOARD_THEMES[0];
}
