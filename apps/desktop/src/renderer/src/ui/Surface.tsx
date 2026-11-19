/**
 * Superfície clara ou escura (specs/006, FR-007, research R-06; "Regra de hierarquia" do design,
 * node `135:1379`): dentro de uma superfície escura (diálogo do token, barra de lote, card do que está
 * em andamento), a ação principal fica lima em vez de preta. Os componentes de ui/ leem o contexto;
 * as telas só declaram onde a superfície é escura.
 *
 * Menus e diálogos claros abertos de dentro de uma superfície escura voltam para a clara
 * (`<Surface dark={false}>`): o contexto do React atravessa os portais.
 */
import { createContext, useContext, type ReactNode } from 'react';

export type SurfaceTone = 'light' | 'dark';

const SurfaceContext = createContext<SurfaceTone>('light');

export function Surface({ dark = false, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <SurfaceContext.Provider value={dark ? 'dark' : 'light'}>{children}</SurfaceContext.Provider>
  );
}

export function useSurface(): SurfaceTone {
  return useContext(SurfaceContext);
}
