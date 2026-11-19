/**
 * Marca da nova identidade no cabeçalho (specs/006, FR-003): o H lima no quadrado preto ("Marca/Ícone
 * — nova identidade", node `24:70`; o mesmo desenho de apps/desktop/resources/brand.svg, que gera o
 * ícone do app). Decorativa: o nome "HUNIT Control" vem ao lado.
 */
import { colors } from '../tokens';
import type { IconProps } from './icons';

export function BrandMark({ size = 32, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width="32" height="32" rx="10" fill={colors['superfície/escura']} />
      <path
        d="M10.26 22.5V9.54H12.708V14.868H18.504V9.54H20.952V22.5H18.504V17.154H12.708V22.5H10.26Z"
        fill={colors['destaque/lima']}
      />
    </svg>
  );
}
