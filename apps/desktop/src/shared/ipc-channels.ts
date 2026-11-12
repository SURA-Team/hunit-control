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
  twoFactorRequested: 'twoFactor:requested',
  twoFactorClosed: 'twoFactor:closed',
  attentionPlaySound: 'attention:playSound',
} as const;

export type InvokeChannel = (typeof INVOKE)[keyof typeof INVOKE];
export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS];
