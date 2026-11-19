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
    selectAll: (filters) => invoke(INVOKE.reservationsSelectAll, filters),
    quickFilterCounts: (filters) => invoke(INVOKE.reservationsQuickFilterCounts, filters),
  },
  treatments: {
    pickFile: (input) => invoke(INVOKE.treatmentsPickFile, input),
    discardFile: (selectionId) => invoke(INVOKE.treatmentsDiscardFile, selectionId),
    check: (input) => invoke(INVOKE.treatmentsCheck, input),
    apply: (input) => invoke(INVOKE.treatmentsApply, input),
    get: (input) => invoke(INVOKE.treatmentsGet, input),
    remove: (documentId) => invoke(INVOKE.treatmentsRemove, documentId),
    revert: (documentId) => invoke(INVOKE.treatmentsRevert, documentId),
    setManualAmount: (input) => invoke(INVOKE.treatmentsSetManualAmount, input),
    clearManualAmount: (input) => invoke(INVOKE.treatmentsClearManualAmount, input),
    confirmReview: (input) => invoke(INVOKE.treatmentsConfirmReview, input),
    saveDocument: (documentId) => invoke(INVOKE.treatmentsSaveDocument, documentId),
    confirmReviews: (input) => invoke(INVOKE.treatmentsConfirmReviews, input),
  },
  dispatches: {
    check: (input) => invoke(INVOKE.dispatchesCheck, input),
    start: (input) => invoke(INVOKE.dispatchesStart, input),
    list: (input) => invoke(INVOKE.dispatchesList, input),
    get: (dispatchId) => invoke(INVOKE.dispatchesGet, dispatchId),
    resume: (dispatchId) => invoke(INVOKE.dispatchesResume, dispatchId),
    cancel: (dispatchId) => invoke(INVOKE.dispatchesCancel, dispatchId),
    sendToken: (input) => invoke(INVOKE.dispatchesSendToken, input),
    watch: (dispatchId) => invoke(INVOKE.dispatchesWatch, dispatchId),
    unwatch: (dispatchId) => invoke(INVOKE.dispatchesUnwatch, dispatchId),
    onChanged: subscribe(EVENTS.dispatchesChanged),
  },
  commercial: {
    get: (input) => invoke(INVOKE.commercialGet, input),
    cancelLine: (input) => invoke(INVOKE.commercialCancelLine, input),
    restoreLine: (input) => invoke(INVOKE.commercialRestoreLine, input),
    confirmReturn: (returnId) => invoke(INVOKE.commercialConfirmReturn, returnId),
    rejectReturn: (input) => invoke(INVOKE.commercialRejectReturn, input),
    undoConfirmation: (returnId) => invoke(INVOKE.commercialUndoConfirmation, returnId),
    confirmReturns: (input) => invoke(INVOKE.commercialConfirmReturns, input),
    sheetStatus: () => invoke(INVOKE.commercialSheetStatus),
    readNow: () => invoke(INVOKE.commercialReadNow),
  },
  clipboard: {
    copyReservations: (input) => invoke(INVOKE.clipboardCopyReservations, input),
  },
};

contextBridge.exposeInMainWorld('hunit', hunit);
