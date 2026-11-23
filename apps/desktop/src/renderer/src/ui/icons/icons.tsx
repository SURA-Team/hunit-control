/**
 * Ícones do design (specs/006, research R-04), um componente por SVG de
 * apps/desktop/resources/icons/ (exportados do Figma, T002): traço em `currentColor` (herdam a cor
 * do texto), tamanho natural do desenho por padrão e ocultos do leitor de tela — o nome vem do texto
 * ao lado ou do `aria-label` do botão. O teste ui-icons.test.tsx confere que cada SVG tem o seu
 * componente, com os mesmos traços.
 */
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Largura e altura, em px. Padrão: o tamanho do desenho no design. */
  size?: number;
}

interface Stroke {
  d: string;
  width: number;
  linejoin?: 'round';
}

function createIcon(displayName: string, box: number, strokes: Stroke[]) {
  function Icon({ size = box, ...props }: IconProps) {
    return (
      <svg
        viewBox={`0 0 ${box} ${box}`}
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {strokes.map((stroke, index) => (
          <path
            key={index}
            d={stroke.d}
            stroke="currentColor"
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin={stroke.linejoin}
          />
        ))}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

/** `attention.svg` */
export const AttentionIcon = createIcon('AttentionIcon', 14, [
  { d: 'M7 4.0835V7.5835', width: 1.75, linejoin: 'round' },
  { d: 'M7 9.9165H7.00583', width: 1.75, linejoin: 'round' },
]);

/** `info.svg` (specs/008, nota do som do aviso, telas 1.1 a 1.3) */
export const InfoIcon = createIcon('InfoIcon', 18, [
  {
    d: 'M15.75 9C15.75 12.7279 12.7279 15.75 9 15.75C5.27208 15.75 2.25 12.7279 2.25 9C2.25 5.27208 5.27208 2.25 9 2.25C12.7279 2.25 15.75 5.27208 15.75 9Z',
    width: 1.35,
  },
  { d: 'M9 8.25V12', width: 1.35 },
  { d: 'M9 6H9.0075', width: 1.35 },
]);

/** `check.svg` */
export const CheckIcon = createIcon('CheckIcon', 14, [
  { d: 'M2.91663 7.29167L5.54163 9.91667L11.0833 4.375', width: 1.75, linejoin: 'round' },
]);

/** `chevron-down.svg` */
export const ChevronDownIcon = createIcon('ChevronDownIcon', 16, [
  { d: 'M4 6L8 10L12 6', width: 1.33333, linejoin: 'round' },
]);

/** `chevron-left.svg` */
export const ChevronLeftIcon = createIcon('ChevronLeftIcon', 20, [
  { d: 'M12.5 5L7.5 10L12.5 15', width: 1.8, linejoin: 'round' },
]);

/** `chevron-right.svg` */
export const ChevronRightIcon = createIcon('ChevronRightIcon', 20, [
  { d: 'M7.5 5L12.5 10L7.5 15', width: 1.8, linejoin: 'round' },
]);

/** `close.svg` */
export const CloseIcon = createIcon('CloseIcon', 20, [
  { d: 'M15 5L5 15', width: 1.8, linejoin: 'round' },
  { d: 'M5 5L15 15', width: 1.8, linejoin: 'round' },
]);

/** `commercial.svg` */
export const CommercialIcon = createIcon('CommercialIcon', 20, [
  {
    d: 'M7.5 5.83334V4.58334C7.5 4.25182 7.6317 3.93388 7.86612 3.69946C8.10054 3.46504 8.41848 3.33334 8.75 3.33334H11.25C11.5815 3.33334 11.8995 3.46504 12.1339 3.69946C12.3683 3.93388 12.5 4.25182 12.5 4.58334V5.83334M2.5 10.4167H17.5M4.58333 5.83334H15.4167C16.5673 5.83334 17.5 6.76608 17.5 7.91668V14.5833C17.5 15.7339 16.5673 16.6667 15.4167 16.6667H4.58333C3.43274 16.6667 2.5 15.7339 2.5 14.5833V7.91668C2.5 6.76608 3.43274 5.83334 4.58333 5.83334Z',
    width: 1.5,
    linejoin: 'round',
  },
]);

/** `document.svg` */
export const DocumentIcon = createIcon('DocumentIcon', 20, [
  {
    d: 'M11.6667 2.5H5.83341C5.39139 2.5 4.96746 2.67559 4.6549 2.98816C4.34234 3.30072 4.16675 3.72464 4.16675 4.16667V15.8333C4.16675 16.2754 4.34234 16.6993 4.6549 17.0118C4.96746 17.3244 5.39139 17.5 5.83341 17.5H14.1667C14.6088 17.5 15.0327 17.3244 15.3453 17.0118C15.6578 16.6993 15.8334 16.2754 15.8334 15.8333V6.66667L11.6667 2.5Z',
    width: 1.5,
    linejoin: 'round',
  },
  { d: 'M11.6667 2.5V6.66667H15.8334', width: 1.5, linejoin: 'round' },
]);

/** `download.svg` */
export const DownloadIcon = createIcon('DownloadIcon', 16, [
  { d: 'M8 2.66669V10', width: 1.33333, linejoin: 'round' },
  { d: 'M4.66663 6.66669L7.99996 10L11.3333 6.66669', width: 1.33333, linejoin: 'round' },
  { d: 'M3.33337 13.3333H12.6667', width: 1.33333, linejoin: 'round' },
]);

/** `executions.svg` */
export const ExecutionsIcon = createIcon('ExecutionsIcon', 20, [
  {
    d: 'M2.91667 10C2.91305 11.6339 3.4744 13.2188 4.5056 14.4862C5.53681 15.7536 6.97445 16.6255 8.57495 16.9542C10.1755 17.2829 11.8404 17.0482 13.2876 16.2899C14.7349 15.5315 15.8755 14.2961 16.5161 12.7931C17.1568 11.29 17.2581 9.61168 16.8029 8.04246C16.3478 6.47323 15.3641 5.10962 14.0186 4.18265C12.6731 3.25569 11.0485 2.82239 9.42005 2.95616C7.79163 3.08994 6.25953 3.78256 5.08334 4.91668L2.91667 7.08335M7.08334 7.08329L2.91667 7.08335L2.91668 2.91663M10 6.25V10L12.5 11.6667',
    width: 1.5,
    linejoin: 'round',
  },
]);

/** `eye.svg` */
export const EyeIcon = createIcon('EyeIcon', 20, [
  {
    d: 'M8.33334 10C8.33334 10.442 8.50894 10.866 8.8215 11.1785C9.13406 11.4911 9.55798 11.6667 10 11.6667C10.442 11.6667 10.866 11.4911 11.1785 11.1785C11.4911 10.866 11.6667 10.442 11.6667 10C11.6667 9.55798 11.4911 9.13406 11.1785 8.8215C10.866 8.50894 10.442 8.33334 10 8.33334C9.55798 8.33334 9.13406 8.50894 8.8215 8.8215C8.50894 9.13406 8.33334 9.55798 8.33334 10Z',
    width: 1.8,
    linejoin: 'round',
  },
  {
    d: 'M17.5 10C15.5 13.3333 13 15 10 15C7 15 4.5 13.3333 2.5 10C4.5 6.66667 7 5 10 5C13 5 15.5 6.66667 17.5 10Z',
    width: 1.8,
    linejoin: 'round',
  },
]);

/** `minus.svg` */
export const MinusIcon = createIcon('MinusIcon', 14, [{ d: 'M3.5 7H10.5', width: 1.75 }]);

/** `remove.svg` */
export const RemoveIcon = createIcon('RemoveIcon', 16, [
  { d: 'M2.66663 4.66669H13.3333', width: 1.33333, linejoin: 'round' },
  { d: 'M6.66663 7.33331V11.3333M9.33329 7.33331V11.3333', width: 1.33333, linejoin: 'round' },
  {
    d: 'M4 4.66669L4.66667 12.6667C4.66667 13.0203 4.80714 13.3594 5.05719 13.6095C5.30724 13.8595 5.64638 14 6 14H10C10.3536 14 10.6928 13.8595 10.9428 13.6095C11.1929 13.3594 11.3333 13.0203 11.3333 12.6667L12 4.66669',
    width: 1.33333,
    linejoin: 'round',
  },
  { d: 'M6 4.66669V2.66669H10V4.66669', width: 1.33333, linejoin: 'round' },
]);

/** `reservations.svg` */
export const ReservationsIcon = createIcon('ReservationsIcon', 20, [
  {
    d: 'M13.3334 2.08337V5.41671M6.66669 2.08337V5.41671M2.91669 8.33337H17.0834M7.50002 12.5L9.16669 14.1667L12.5 10.8334M5.41669 3.75H14.5834C15.9641 3.75 17.0834 4.86929 17.0834 6.25V14.5833C17.0834 15.964 15.9641 17.0833 14.5834 17.0833H5.41669C4.03598 17.0833 2.91669 15.964 2.91669 14.5833V6.25C2.91669 4.86929 4.03598 3.75 5.41669 3.75Z',
    width: 1.5,
    linejoin: 'round',
  },
]);

/** `revert.svg` */
export const RevertIcon = createIcon('RevertIcon', 16, [
  {
    d: 'M2.33339 8C2.33049 9.30712 2.77957 10.575 3.60453 11.589C4.4295 12.6029 5.57961 13.3004 6.86001 13.5634C8.14041 13.8263 9.47235 13.6386 10.6302 13.0319C11.788 12.4252 12.7004 11.4369 13.2129 10.2345C13.7255 9.032 13.8065 7.68933 13.4424 6.43395C13.0782 5.17857 12.2913 4.08768 11.2149 3.34611C10.1385 2.60454 8.83882 2.2579 7.53609 2.36492C6.23335 2.47194 5.00767 3.02604 4.06672 3.93333L2.33339 5.66666',
    width: 1.33333,
    linejoin: 'round',
  },
  { d: 'M2.33337 2.33331V5.66665H5.66671', width: 1.33333, linejoin: 'round' },
]);

/** `run.svg` */
export const RunIcon = createIcon('RunIcon', 20, [
  {
    d: 'M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z',
    width: 1.5,
    linejoin: 'round',
  },
  { d: 'M8.33333 7.16663V12.8333L13 9.99996L8.33333 7.16663Z', width: 1.5, linejoin: 'round' },
]);

/** `search-empty.svg` */
export const SearchEmptyIcon = createIcon('SearchEmptyIcon', 48, [
  {
    d: 'M22 36C29.732 36 36 29.732 36 22C36 14.268 29.732 8 22 8C14.268 8 8 14.268 8 22C8 29.732 14.268 36 22 36Z',
    width: 3.2,
    linejoin: 'round',
  },
  { d: 'M40 40L33 33', width: 3.2, linejoin: 'round' },
  { d: 'M17 22H27', width: 3.2, linejoin: 'round' },
]);

/** `selector.svg` */
export const SelectorIcon = createIcon('SelectorIcon', 20, [
  { d: 'M6.66666 7.49999L9.99999 4.16666L13.3333 7.49999', width: 1.8, linejoin: 'round' },
  { d: 'M13.3333 12.5L9.99999 15.8333L6.66666 12.5', width: 1.8, linejoin: 'round' },
]);

/** `settings.svg` */
export const SettingsIcon = createIcon('SettingsIcon', 20, [
  {
    d: 'M3.33335 16.6667V11.6667M3.33335 11.6667H1.66669M3.33335 11.6667H5.00002M3.33335 8.33337V3.33337M10 16.6667V10M10 6.66671V3.33337M10 6.66671H8.33335M10 6.66671H11.6667M16.6667 16.6667V13.3334M16.6667 13.3334H15M16.6667 13.3334H18.3334M16.6667 10V3.33337',
    width: 1.5,
    linejoin: 'round',
  },
]);

/** `sound-high.svg` (specs/008, controle de volume; exportado do Figma, T039) */
export const SoundHighIcon = createIcon('SoundHighIcon', 20, [
  {
    d: 'M9.16667 4.16667L5 7.5H2.5V12.5H5L9.16667 15.8333V4.16667Z',
    width: 1.5,
    linejoin: 'round',
  },
  {
    d: 'M12.9167 7.08333C13.6801 7.8622 14.1077 8.90936 14.1077 10C14.1077 11.0906 13.6801 12.1378 12.9167 12.9167',
    width: 1.5,
    linejoin: 'round',
  },
  {
    d: 'M15.4167 4.58333C16.1477 5.28343 16.7295 6.12426 17.1269 7.05517C17.5243 7.98608 17.7292 8.9878 17.7292 10C17.7292 11.0122 17.5243 12.0139 17.1269 12.9448C16.7295 13.8757 16.1477 14.7166 15.4167 15.4167',
    width: 1.5,
    linejoin: 'round',
  },
]);

/** `sound-low.svg` (specs/008, controle de volume; exportado do Figma, T039): só o alto-falante */
export const SoundLowIcon = createIcon('SoundLowIcon', 20, [
  {
    d: 'M9.16667 4.16667L5 7.5H2.5V12.5H5L9.16667 15.8333V4.16667Z',
    width: 1.5,
    linejoin: 'round',
  },
]);

/** `undo.svg` */
export const UndoIcon = createIcon('UndoIcon', 16, [
  { d: 'M5.99996 9.33335L2.66663 6.00002L5.99996 2.66669', width: 1.33333, linejoin: 'round' },
  {
    d: 'M2.66663 6H9.66663C10.6391 6 11.5717 6.38631 12.2594 7.07394C12.947 7.76157 13.3333 8.69421 13.3333 9.66667C13.3333 10.6391 12.947 11.5718 12.2594 12.2594C11.5717 12.947 10.6391 13.3333 9.66663 13.3333H7.33329',
    width: 1.33333,
    linejoin: 'round',
  },
]);
