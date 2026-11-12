/**
 * Ponte entre a interface e o processo principal (specs/002, contracts/ipc.md, research R-02).
 *
 * Expõe `window.hunit` com uma função por canal e eventos que devolvem a função de cancelar a
 * inscrição. O `ipcRenderer` nunca é exposto. Roda com `sandbox: true`: por isso é compilado como
 * CommonJS num arquivo único (electron.vite.config.ts).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  EVENTS,
  INVOKE,
  SEND,
  type EventChannel,
  type InvokeChannel,
} from '../shared/ipc-channels.js';
import type { HunitApi, Result, Unsubscribe } from '../shared/ipc-types.js';

function invoke<T>(channel: InvokeChannel, input?: unknown): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, input) as Promise<Result<T>>;
}

function subscribe<T>(channel: EventChannel) {
  return (callback: (payload: T) => void): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const hunit: HunitApi = {
  app: {
    info: () => invoke(INVOKE.appInfo),
  },
  connection: {
    getState: () => invoke(INVOKE.connectionGetState),
    getConfig: () => invoke(INVOKE.connectionGetConfig),
    pickCertificate: () => invoke(INVOKE.connectionPickCertificate),
    test: (input) => invoke(INVOKE.connectionTest, input),
    save: (input) => invoke(INVOKE.connectionSave, input),
    remove: () => invoke(INVOKE.connectionRemove),
    onState: subscribe(EVENTS.connectionState),
  },
  preferences: {
    set: (input) => invoke(INVOKE.preferencesSet, input),
  },
  attention: {
    test: () => invoke(INVOKE.attentionTest),
    onPlaySound: (callback) => subscribe<undefined>(EVENTS.attentionPlaySound)(() => callback()),
  },
  credentials: {
    status: () => invoke(INVOKE.credentialsStatus),
    set: (input) => invoke(INVOKE.credentialsSet, input),
    clear: () => invoke(INVOKE.credentialsClear),
    onCleared: subscribe(EVENTS.credentialsCleared),
  },
  activity: {
    ping: () => ipcRenderer.send(SEND.activityPing),
  },
  hotels: {
    list: () => invoke(INVOKE.hotelsList),
  },
  executions: {
    list: (input) => invoke(INVOKE.executionsList, input),
    get: (executionId) => invoke(INVOKE.executionsGet, executionId),
    start: (input) => invoke(INVOKE.executionsStart, input),
    resume: (executionId) => invoke(INVOKE.executionsResume, executionId),
    cancel: (executionId) => invoke(INVOKE.executionsCancel, executionId),
    sendToken: (input) => invoke(INVOKE.executionsSendToken, input),
    watch: (executionId) => invoke(INVOKE.executionsWatch, executionId),
    unwatch: (executionId) => invoke(INVOKE.executionsUnwatch, executionId),
    onChanged: subscribe(EVENTS.executionsChanged),
  },
  twoFactor: {
    onRequested: subscribe(EVENTS.twoFactorRequested),
    onClosed: subscribe(EVENTS.twoFactorClosed),
  },
  evidence: {
    list: (executionId) => invoke(INVOKE.evidenceList, executionId),
    save: (input) => invoke(INVOKE.evidenceSave, input),
  },
  reservations: {
    list: (input) => invoke(INVOKE.reservationsList, input),
    get: (input) => invoke(INVOKE.reservationsGet, input),
    channels: () => invoke(INVOKE.reservationsChannels),
  },
};

contextBridge.exposeInMainWorld('hunit', hunit);
