/**
 * Reading an uploaded XLSX register as raw cells — the worker's
 * `POST /coop-sheet` behind a port (T-13). Text only, dates ISO, rows padded
 * to `cols`; every rule about the content lives in `domain/coop-import.ts`.
 */
export type CoopSheet = { name: string; cols: number; rows: string[][] };

export interface PortCoopSheet {
  readSheets(file: { bytes: Uint8Array; name: string }, token: string): Promise<CoopSheet[]>;
}
