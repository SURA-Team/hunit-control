/**
 * Controle de volume (specs/008, US5; "Controle de volume" da biblioteca, versões "Ativo" e
 * "Desabilitado"): rótulo "Volume", ícone de som baixo à esquerda e alto à direita, trilho preto com o
 * botão lima e o valor em porcentagem à direita. Desabilitado em cinza.
 *
 * Teclado (contracts/ui-components.md): setas ±5, Page Up/Page Down ±10, Home e End (0 e 100). O
 * `onChangeEnd` avisa quando a pessoa solta o controle ou muda pelo teclado (a tela toca a amostra).
 */
import { Slider } from '@mantine/core';
import { useId, type KeyboardEvent } from 'react';
import { SoundHighIcon, SoundLowIcon } from '../icons';
import { fieldClasses } from './shared';

export interface VolumeFieldProps {
  /** Volume de 0 a 100. */
  value: number;
  onChange: (value: number) => void;
  /** Ao soltar o controle ou mudar pelo teclado. */
  onChangeEnd?: (value: number) => void;
  disabled?: boolean;
  /** Rótulo visível. Padrão: "Volume". */
  label?: string;
  /** Nome para o leitor de tela. Padrão: "Volume do aviso". */
  'aria-label'?: string;
}

const STEP = 5;
const PAGE_STEP = 10;

/** "70 %", como no design (espaço fino antes do sinal). */
export function formatVolume(value: number): string {
  return `${Math.round(value)} %`;
}

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export function VolumeField({
  value,
  onChange,
  onChangeEnd,
  disabled = false,
  label = 'Volume',
  'aria-label': ariaLabel = 'Volume do aviso',
}: VolumeFieldProps) {
  const labelId = useId();

  // O Slider do Mantine trata setas, Home e End; Page Up e Page Down (±10) ficam aqui.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== 'PageUp' && event.key !== 'PageDown')) return;
    event.preventDefault();
    const next = clamp(value + (event.key === 'PageUp' ? PAGE_STEP : -PAGE_STEP));
    onChange(next);
    onChangeEnd?.(next);
  };

  return (
    <div className={fieldClasses.volume}>
      <span id={labelId} className={fieldClasses.label}>
        {label}
      </span>
      <div className={fieldClasses.volumeRow} data-disabled={disabled || undefined}>
        <SoundLowIcon />
        <div className={fieldClasses.volumeSlider} onKeyDownCapture={onKeyDownCapture}>
          <Slider
            classNames={{
              root: fieldClasses.volumeSlider,
              track: fieldClasses.volumeTrack,
              bar: fieldClasses.volumeBar,
              thumb: fieldClasses.volumeThumb,
            }}
            value={value}
            onChange={(next) => onChange(clamp(next))}
            onChangeEnd={(next) => onChangeEnd?.(clamp(next))}
            min={0}
            max={100}
            step={STEP}
            disabled={disabled}
            label={null}
            size={6}
            thumbSize={16}
            thumbLabel={ariaLabel}
            thumbValueText={formatVolume}
            thumbProps={{ 'aria-describedby': labelId }}
          />
        </div>
        <SoundHighIcon />
        <span className={fieldClasses.volumeValue} aria-hidden="true">
          {formatVolume(value)}
        </span>
      </div>
    </div>
  );
}
