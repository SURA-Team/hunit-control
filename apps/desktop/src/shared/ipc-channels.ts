/**
 * Nome fixo de cada canal da ponte (`<área>:<ação>`), usado pelo preload e pelo processo
 * principal (specs/002, contracts/ipc.md).
 */

/** Pedidos da interface ao principal (`invoke`, com resposta `Result`). */
export const INVOKE = {
  appInfo: 'app:info',
  connectionGetState: 'connection:getState',
  connectionGetConfig: 'connection:getConfig',
  connectionPickCertificate: 'connection:pickCertificate',
  connectionTest: 'connection:test',
  connectionSave: 'connection:save',
  connectionRemove: 'connection:remove',
  preferencesSet: 'preferences:set',
  attentionTest: 'attention:test',
  credentialsStatus: 'credentials:status',
  credentialsSet: 'credentials:set',
  credentialsClear: 'credentials:clear',
  hotelsList: 'hotels:list',
  executionsList: 'executions:list',
  executionsGet: 'executions:get',
  executionsStart: 'executions:start',
  executionsResume: 'executions:resume',
  executionsCancel: 'executions:cancel',
  executionsSendToken: 'executions:sendToken',
  executionsWatch: 'executions:watch',
  executionsUnwatch: 'executions:unwatch',
  evidenceList: 'evidence:list',
  evidenceSave: 'evidence:save',
  reservationsList: 'reservations:list',
  reservationsGet: 'reservations:get',
  reservationsChannels: 'reservations:channels',
  // "Cancelada sem cobrança" (specs/008, contracts/ipc.md).
  reservationsMarkNoCharge: 'reservations:markNoCharge',
  reservationsUndoNoCharge: 'reservations:undoNoCharge',
  // Tratativas manuais (specs/003, contracts/ipc.md).
  treatmentsPickFile: 'treatments:pickFile',
  treatmentsDiscardFile: 'treatments:discardFile',
  treatmentsCheck: 'treatments:check',
  treatmentsApply: 'treatments:apply',
  treatmentsGet: 'treatments:get',
  treatmentsRemove: 'treatments:remove',
  treatmentsRevert: 'treatments:revert',
  treatmentsSetManualAmount: 'treatments:setManualAmount',
  treatmentsClearManualAmount: 'treatments:clearManualAmount',
  treatmentsConfirmReview: 'treatments:confirmReview',
  treatmentsSaveDocument: 'treatments:saveDocument',
  // Envio ao Comercial (specs/005, contracts/ipc.md).
  reservationsSelectAll: 'reservations:selectAll',
  /** Contagens dos filtros rápidos (specs/006). */
  reservationsQuickFilterCounts: 'reservations:quickFilterCounts',
  /** Resumo do período do módulo de Relatórios (specs/007, contracts/ipc.md). */
  reportsOverview: 'reports:overview',
  treatmentsConfirmReviews: 'treatments:confirmReviews',
  dispatchesCheck: 'dispatches:check',
  dispatchesStart: 'dispatches:start',
  dispatchesList: 'dispatches:list',
  dispatchesGet: 'dispatches:get',
  dispatchesResume: 'dispatches:resume',
  dispatchesCancel: 'dispatches:cancel',
  dispatchesSendToken: 'dispatches:sendToken',
  dispatchesWatch: 'dispatches:watch',
  dispatchesUnwatch: 'dispatches:unwatch',
  commercialGet: 'commercial:get',
  commercialCancelLine: 'commercial:cancelLine',
  commercialRestoreLine: 'commercial:restoreLine',
  commercialConfirmReturn: 'commercial:confirmReturn',
  commercialRejectReturn: 'commercial:rejectReturn',
  commercialUndoConfirmation: 'commercial:undoConfirmation',
  commercialConfirmReturns: 'commercial:confirmReturns',
  // A "Cancelada" do Comercial (homologação da 008, R-19).
  commercialConfirmCancellation: 'commercial:confirmCancellation',
  commercialRejectCancellation: 'commercial:rejectCancellation',
  // A situação livre do Comercial (specs/009).
  commercialConfirmSituationReturn: 'commercial:confirmSituationReturn',
  commercialSheetStatus: 'commercial:sheetStatus',
  commercialReadNow: 'commercial:readNow',
  // Ajustes de cobrança (specs/008, contracts/ipc.md).
  commercialHunitCharges: 'commercial:hunitCharges',
  commercialCheckHunitCharges: 'commercial:checkHunitCharges',
  clipboardCopyReservations: 'clipboard:copyReservations',
} as const;

/** Avisos da interface ao principal (`send`, sem resposta). */
export const SEND = {
  activityPing: 'activity:ping',
} as const;

/** Eventos do principal para a interface. */
export const EVENTS = {
  connectionState: 'connection:state',
  credentialsCleared: 'credentials:cleared',
  executionsChanged: 'executions:changed',
  dispatchesChanged: 'dispatches:changed',
  twoFactorRequested: 'twoFactor:requested',
  twoFactorClosed: 'twoFactor:closed',
  attentionPlaySound: 'attention:playSound',
} as const;

export type InvokeChannel = (typeof INVOKE)[keyof typeof INVOKE];
export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS];
