export type TimelineEntry = { at: Date; label: string; detail?: string };

/** Shapes this module needs — structural, so it stays free of adapter imports (F-10). */
export type EventLike = { at: Date; level: string; event: string; meta?: unknown };
export type AuditLike = { at: Date; action: string; actorId: string };

/**
 * One run reads as one timeline. The two trails answer different questions —
 * `audit_log` says what the appraiser committed to, `event_log` says what
 * broke — and a failure is only legible next to the step it interrupted.
 */
export function mergeTimeline(events: EventLike[], audits: AuditLike[]): TimelineEntry[] {
  return [
    ...events.map((e) => ({
      at: e.at,
      label: `${e.level}: ${e.event}`,
      detail: e.meta ? JSON.stringify(e.meta) : undefined,
    })),
    ...audits.map((a) => ({ at: a.at, label: `audit: ${a.action}`, detail: a.actorId })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());
}

export function formatTimeline(entries: TimelineEntry[]): string {
  return (
    entries
      .map(
        (e) => `${e.at.toISOString().slice(11, 19)}  ${e.label}${e.detail ? `  ${e.detail}` : ""}`,
      )
      .join("\n") + "\n"
  );
}
