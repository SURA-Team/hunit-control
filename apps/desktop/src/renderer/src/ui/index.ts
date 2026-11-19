/**
 * Componentes únicos do app (specs/006, FR-030, research R-05; contracts/ui-components.md). As telas
 * montam a interface só com eles e com o layout neutro do Mantine (Stack, Group, Text, SimpleGrid…);
 * o ESLint barra nas telas os componentes visuais do Mantine.
 */
export { Action, type ActionProps, type ActionSize, type ActionVariant } from './Action';
export { AppDialog, type AppDialogProps } from './AppDialog';
export { AppDrawer, type AppDrawerProps } from './AppDrawer';
export { AppHeader, type AppHeaderProps, type HeaderProfile } from './AppHeader';
export {
  BatchSummary,
  ReasonList,
  SummaryLine,
  type ReasonItem,
  type SummaryLineProps,
  type SummaryTone,
} from './BatchSummary';
export { Card, type CardProps } from './Card';
export { CodeText } from './CodeText';
export {
  CardAside,
  CardHeader,
  DataField,
  DataGrid,
  DataTile,
  DataTiles,
  DetailHeader,
  type CardHeaderProps,
  type DataFieldProps,
  type DetailHeaderProps,
} from './Detail';
export { Countdown, type CountdownProps } from './Countdown';
export {
  CountCard,
  CountGrid,
  IndicatorCard,
  type CountCardProps,
  type IndicatorCardProps,
} from './CountCards';
export {
  DocumentAction,
  type DocumentActionKind,
  type DocumentActionProps,
} from './DocumentAction';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export * from './fields';
export {
  AppliedFilters,
  FilterBar,
  FilterBarSearch,
  FilterPanel,
  FilterPanelWide,
  RemovableChip,
  type AppliedFiltersProps,
  type FilterBarProps,
  type FilterPanelProps,
  type RemovableChipProps,
} from './FilterBar';
export { FilterChip, type FilterChipProps } from './FilterChip';
export * from './icons';
export * from './lists';
export { MenuButton, type MenuButtonItem, type MenuButtonProps } from './MenuButton';
export { Notice, type NoticeProps, type NoticeTone } from './Notice';
export { PageHeader, SectionTitle, type PageHeaderProps } from './PageHeader';
export { describePeriod, PeriodPicker, type Period } from './PeriodPicker';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { SideMenu, SideMenuItem, type SideMenuItemProps } from './SideMenu';
export {
  SituationBadges,
  StatusBadge,
  type BadgeTone,
  type SituationBadgeItem,
  type StatusBadgeProps,
} from './StatusBadge';
export { Surface, useSurface, type SurfaceTone } from './Surface';
export { TabPanel, Tabs, type TabItem, type TabsProps } from './Tabs';
