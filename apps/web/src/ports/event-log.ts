export type EventLevel = "info" | "warn" | "error";

export type AppEvent = {
  level: EventLevel;
  event: string;
  traceId?: string;
  actorId?: string;
  valuationId?: string;
  meta?: unknown;
};

export type EventRow = AppEvent & { id: number; at: Date };

export interface PortEventLog {
  record(e: AppEvent): Promise<void>;
  byTrace(traceId: string): Promise<EventRow[]>;
  byValuation(valuationId: string): Promise<EventRow[]>;
}
