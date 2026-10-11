/**
 * Analytics: the measures the platform already computes, named, sourced and told apart from the ones it
 * cannot compute honestly.
 *
 * Why this exists. `reportData.ts` already serves twelve datasets — ticket volume, SLA, utilisation,
 * revenue, aging, time tracking, CSAT, agreement profitability and client value — and the Analytics screen
 * read exactly one of them (`revenue-summary`) and drew a bar chart. Everything here is a thin, explicit
 * layer over those builders: it picks the figure out of each payload, says which endpoint and field it came
 * from, compares it with the same figure in the period before, and passes through the data-quality notes the
 * builders already write.
 *
 * The design rule this file is built on: **a figure that cannot be computed is reported as absent, with the
 * reason.** The builders already do that — `capacityBasis` says "Not measured — give the report a date
 * range", `pricing.note` says how many entries carry no rate — so the overview carries those sentences
 * through to the screen rather than letting a dashboard imply a completeness the data does not have. A
 * percentage that is 100% because no cost rate is set is the most dangerous kind of number on a screen like
 * this, and it is reported as unreliable rather than shown as excellent.
 *
 * Every measure is read from a builder that already exists. Nothing here re-queries the database, so a
 * figure on the Analytics screen and the same figure in a standard report cannot disagree.
 */
import type { AuthUser } from "../middleware/auth";
import {
  agingReport,
  clientValueReport,
  contractProfitabilityReport,
  csatReport,
  revenueReport,
  slaReport,
  ticketVolumeReport,
  timeTrackingReport,
  utilizationReport,
  type ReportPeriod,
} from "./reportData";

export type MeasureGroup = "service" | "responsiveness" | "effort" | "money" | "experience" | "commercial";
export type MeasureUnit = "count" | "percent" | "minutes" | "money" | "days" | "score" | "hours";
export type Tone = "good" | "warn" | "bad" | "neutral";

export interface MeasureDefinition {
  id: string;
  label: string;
  group: MeasureGroup;
  unit: MeasureUnit;
  /** One sentence a report never says: what the figure means, and what it does not. */
  definition: string;
  /** Which way is good news, so the screen can show a tone without the reader knowing the target. */
  direction: "higher" | "lower" | "neutral";
  target: number | null;
  targetLabel: string | null;
  /** The endpoint and field, so the figure on this screen can be checked against the report it came from. */
  source: string;
}

export interface MeasuredValue extends MeasureDefinition {
  value: number | null;
  /** What the number means *this period*, in words. The sentence the screen puts beside it. */
  reading: string;
  tone: Tone;
  /** True when the builder itself said the figure cannot be trusted in this period. */
  unreliable?: boolean;
}

export interface AnalyticsLimitation {
  source: string;
  note: string;
}

export interface AnalyticsOverview {
  period: ReportPeriod;
  measures: MeasuredValue[];
  limitations: AnalyticsLimitation[];
  /** Which groups actually produced a figure, in the order the screen should show them. */
  groups: MeasureGroup[];
}

export const MEASURE_GROUPS: { id: MeasureGroup; label: string }[] = [
  { id: "service", label: "Service" },
  { id: "responsiveness", label: "Responsiveness" },
  { id: "effort", label: "Effort" },
  { id: "money", label: "Money" },
  { id: "experience", label: "Experience" },
  { id: "commercial", label: "Commercial" },
];

/**
 * The catalogue. A measure exists here only if a builder already computes it — the `source` field is a
 * claim that can be checked, not a description.
 */
export const ANALYTICS_MEASURES: MeasureDefinition[] = [
  {
    id: "tickets-opened",
    label: "Tickets opened",
    group: "service",
    unit: "count",
    definition: "Tickets created in the period, counted on their creation date rather than the board they ended up on.",
    direction: "neutral",
    target: null,
    targetLabel: null,
    source: "ticket-volume · total",
  },
  {
    id: "tickets-closed",
    label: "Tickets closed",
    group: "service",
    unit: "count",
    definition: "Tickets that reached resolved or closed in the period. Opened minus closed is the movement in the backlog, not the backlog itself.",
    direction: "higher",
    target: null,
    targetLabel: null,
    source: "ticket-volume · closed",
  },
  {
    id: "backlog-over-30",
    label: "Backlog over 30 days",
    group: "service",
    unit: "percent",
    definition: "The share of open tickets older than 30 days. Age is measured from creation, not from the last time somebody touched it.",
    direction: "lower",
    target: 20,
    targetLabel: "at most 20%",
    source: "ticket-aging · buckets",
  },
  {
    id: "oldest-open",
    label: "Oldest open ticket",
    group: "service",
    unit: "days",
    definition: "The age of the oldest ticket that is still open. One ticket, so it moves on a single piece of work.",
    direction: "lower",
    target: 30,
    targetLabel: "at most 30 days",
    source: "ticket-volume · oldestOpen",
  },
  {
    id: "first-response-compliance",
    label: "First-response compliance",
    group: "responsiveness",
    unit: "percent",
    definition: "Tickets answered inside their board's response target, as a share of the tickets evaluated. A ticket still awaiting a first reply is neither met nor breached.",
    direction: "higher",
    target: 95,
    targetLabel: "at least 95%",
    source: "sla-compliance · responseCompliancePct",
  },
  {
    id: "resolution-compliance",
    label: "Resolution compliance",
    group: "responsiveness",
    unit: "percent",
    definition: "Tickets resolved inside their board's resolution target, as a share of the tickets evaluated.",
    direction: "higher",
    target: 90,
    targetLabel: "at least 90%",
    source: "sla-compliance · resolutionCompliancePct",
  },
  {
    id: "average-first-response",
    label: "Average first response",
    group: "responsiveness",
    unit: "minutes",
    definition: "Mean minutes to the first reply, over tickets that have been replied to. Blank when nothing in the period was answered.",
    direction: "lower",
    target: null,
    targetLabel: null,
    source: "sla-compliance · avgResponseMinutes",
  },
  {
    id: "billable-share",
    label: "Billable share of effort",
    group: "effort",
    unit: "percent",
    definition: "Billable minutes as a share of all minutes recorded in the period. This is not utilisation — it has no capacity in it, so it cannot exceed 100 however few people worked.",
    direction: "higher",
    target: 75,
    targetLabel: "at least 75%",
    source: "technician-utilization · totals",
  },
  {
    id: "billable-hours",
    label: "Billable hours",
    group: "effort",
    unit: "hours",
    definition: "Hours recorded against work that is marked billable, before anybody decides whether to charge for them.",
    direction: "neutral",
    target: null,
    targetLabel: null,
    source: "technician-utilization · totals",
  },
  {
    id: "unrated-entries",
    label: "Time entries with no rate",
    group: "effort",
    unit: "count",
    definition: "Entries that carry no rate. They add nothing to recorded value, so recorded value is a floor rather than a total while this is above zero.",
    direction: "lower",
    target: 0,
    targetLabel: "none",
    source: "time-tracking · pricing",
  },
  {
    id: "invoiced",
    label: "Invoiced in period",
    group: "money",
    unit: "money",
    definition: "Invoice value dated inside the period, whatever period the work was done in.",
    direction: "higher",
    target: null,
    targetLabel: null,
    source: "revenue-summary · invoicedInPeriod",
  },
  {
    id: "collected",
    label: "Collected in period",
    group: "money",
    unit: "money",
    definition: "Payments received in the period, which may settle invoices raised before it.",
    direction: "higher",
    target: null,
    targetLabel: null,
    source: "revenue-summary · collectedInPeriod",
  },
  {
    id: "overdue",
    label: "Overdue",
    group: "money",
    unit: "money",
    definition: "Outstanding invoice value past its due date. This is the part of the ledger that is not merely late but late past the terms.",
    direction: "lower",
    target: 0,
    targetLabel: "none",
    source: "revenue-summary · totalOverdue",
  },
  {
    id: "collection-rate",
    label: "Collection rate",
    group: "money",
    unit: "percent",
    definition: "Collected divided by invoiced in the same period. A period can collect against older invoices, so this can exceed 100 or be low against a strong month.",
    direction: "higher",
    target: 90,
    targetLabel: "at least 90%",
    source: "revenue-summary · collectionRate",
  },
  {
    id: "average-invoice",
    label: "Average invoice",
    group: "money",
    unit: "money",
    definition: "Mean value of the invoices raised in the period.",
    direction: "higher",
    target: null,
    targetLabel: null,
    source: "revenue-summary · averageInvoice",
  },
  {
    id: "csat",
    label: "Average CSAT score",
    group: "experience",
    unit: "score",
    definition: "Mean survey score out of ten. Read it with the response count beside it: one reply and a hundred replies are the same number and not the same evidence.",
    direction: "higher",
    target: 8.5,
    targetLabel: "at least 8.5 / 10",
    source: "csat · totals",
  },
  {
    id: "csat-coverage",
    label: "Survey coverage",
    group: "experience",
    unit: "percent",
    definition: "Responses received as a share of the tickets resolved in the period. Low coverage does not make the score wrong; it makes it unrepresentative.",
    direction: "higher",
    target: 25,
    targetLabel: "at least 25%",
    source: "csat · totals",
  },
  {
    id: "agreement-margin",
    label: "Agreement margin",
    group: "commercial",
    unit: "percent",
    definition: "Margin on delivered agreement work. It is only meaningful when technicians carry a cost rate — with no cost rate, labour costs nothing and margin reads 100% whatever the work cost.",
    direction: "higher",
    target: 45,
    targetLabel: "at least 45%",
    source: "contract-profitability · totals",
  },
  {
    id: "recurring-value",
    label: "Annualised agreement value",
    group: "commercial",
    unit: "money",
    definition: "Active agreements expressed as a year's worth of billing, whatever cadence each one bills on.",
    direction: "higher",
    target: null,
    targetLabel: null,
    source: "contract-profitability · totals",
  },
  {
    id: "unpriced-hours",
    label: "Agreement hours with no price",
    group: "commercial",
    unit: "hours",
    definition: "Hours delivered against agreements that carry no hourly rate, so they cannot be valued at all. This is the part of agreement effort that never becomes revenue.",
    direction: "lower",
    target: 0,
    targetLabel: "none",
    source: "contract-profitability · totals",
  },
  {
    id: "revenue-per-ticket",
    label: "Revenue per ticket",
    group: "commercial",
    unit: "money",
    definition: "Invoiced value divided by tickets raised, across the clients in scope. A mean of a very uneven distribution, useful for a trend and not for a client.",
    direction: "higher",
    target: null,
    targetLabel: null,
    source: "client-value · clients",
  },
];

/** Tone from a value against its target. No target means no claim, which is why it is neutral and not good. */
function toneFor(value: number | null, target: number | null, direction: "higher" | "lower" | "neutral"): Tone {
  if (value === null || target === null || direction === "neutral") return "neutral";
  if (direction === "higher") {
    if (value >= target) return "good";
    // Within a tenth of the target is a warning; further away is a breach.
    return value >= target * 0.9 ? "warn" : "bad";
  }
  if (value <= target) return "good";
  return value <= target * 1.25 ? "warn" : "bad";
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/**
 * Everything the screen needs for one period, in one round of report building.
 *
 * The builders run together rather than in sequence: each one is independent, and a screen that takes nine
 * round trips to draw is a screen nobody opens twice.
 */
export async function analyticsOverview(user: AuthUser | undefined, period: ReportPeriod): Promise<AnalyticsOverview> {
  const [tickets, sla, utilisation, revenue, aging, time, csat, contracts, clients] = await Promise.all([
    ticketVolumeReport(user, period),
    slaReport(user, period),
    utilizationReport(user, period),
    revenueReport(user, period),
    agingReport(user, period),
    timeTrackingReport(user, period),
    csatReport(user, period),
    contractProfitabilityReport(user, period),
    clientValueReport(user, period),
  ]);

  const limitations: AnalyticsLimitation[] = [];
  const note = (source: string, text?: string | null) => {
    if (typeof text === "string" && text.trim() !== "") limitations.push({ source, note: text.trim() });
  };

  // ── The figures, each one read from the builder's own payload ────────────────────────────────────
  const ut = utilisation.totals as { billableMinutes: number; nonBillableMinutes: number; labourCost: number; withoutCostRate: number };
  const effortMinutes = ut.billableMinutes + ut.nonBillableMinutes;
  const billableShare = effortMinutes > 0 ? +((ut.billableMinutes / effortMinutes) * 100).toFixed(1) : null;

  const agingBuckets = (aging.buckets ?? []) as { key: string; label: string; count: number; pct: number }[];
  const over30 = agingBuckets.filter((b) => b.key === "over30Days").reduce((a, b) => a + b.pct, 0);
  const agingTotal = sum(agingBuckets.map((b) => b.count));
  const backlogOver30 = agingTotal > 0 ? +over30.toFixed(1) : null;

  const oldest = ((tickets.oldestOpen ?? []) as { ageDays: number }[])[0];
  const oldestOpen = oldest ? oldest.ageDays : null;

  const csatTotals = csat.totals as { responses: number; averageScore: number | null; resolvedTickets: number };
  const coverage = csatTotals.resolvedTickets > 0 ? +((csatTotals.responses / csatTotals.resolvedTickets) * 100).toFixed(1) : null;

  const cp = contracts.totals as { marginPct: number; annualisedValue: number; unpricedHours: number; labourCost: number };
  const clientRows = (clients.clients ?? []) as { invoiced: number; ticketsTotal: number }[];
  const revenuePerTicket = sum(clientRows.map((c) => c.ticketsTotal)) > 0
    ? +(sum(clientRows.map((c) => c.invoiced)) / sum(clientRows.map((c) => c.ticketsTotal))).toFixed(2)
    : null;

  const raw: Record<string, { value: number | null; reading: string; unreliable?: boolean }> = {
    "tickets-opened": {
      value: tickets.total as number,
      reading: `${tickets.total} raised, ${tickets.closed} closed — the backlog moved by ${(tickets.total as number) - (tickets.closed as number)}.`,
    },
    "tickets-closed": {
      value: tickets.closed as number,
      reading: `${tickets.closed} of ${tickets.total} raised in the period reached resolved or closed.`,
    },
    "backlog-over-30": {
      value: backlogOver30,
      reading: backlogOver30 === null
        ? "No open tickets in the period to age."
        : `${backlogOver30}% of the open backlog is older than 30 days, over ${agingTotal} open tickets.`,
    },
    "oldest-open": {
      value: oldestOpen,
      reading: oldestOpen === null ? "Nothing is open." : `The oldest open ticket has been open ${oldestOpen} days.`,
    },
    "first-response-compliance": {
      value: sla.responseCompliancePct as number | null,
      reading: `${sla.response.met} met, ${sla.response.breached} breached, ${sla.response.missed} missed of ${sla.evaluated} evaluated.`,
    },
    "resolution-compliance": {
      value: sla.resolutionCompliancePct as number | null,
      reading: `${sla.resolution.met} met, ${sla.resolution.breached} breached, ${sla.resolution.missed} missed.`,
    },
    "average-first-response": {
      value: sla.avgResponseMinutes as number | null,
      reading: sla.avgResponseMinutes === null
        ? "Nothing in the period has been replied to yet."
        : `Mean first reply of ${sla.avgResponseMinutes} minutes across the tickets that were answered.`,
    },
    "billable-share": {
      value: billableShare,
      reading: `${Math.round(ut.billableMinutes / 60)} billable hours against ${Math.round(ut.nonBillableMinutes / 60)} that are not. Share of effort, not utilisation.`,
    },
    "billable-hours": {
      value: +(ut.billableMinutes / 60).toFixed(2),
      reading: `${ut.billableMinutes} minutes recorded against billable work.`,
    },
    "unrated-entries": {
      value: effectiveUnrated(time.pricing),
      reading: effectiveUnrated(time.pricing) === 0
        ? "Every entry in the period carries a rate."
        : `${effectiveUnrated(time.pricing)} entries carry no rate, so recorded value is a floor.`,
    },
    invoiced: { value: revenue.invoicedInPeriod as number, reading: `${revenue.invoiceCount} invoices raised in the period.` },
    collected: { value: revenue.collectedInPeriod as number, reading: `${revenue.paidCount} invoices settled in the period.` },
    overdue: { value: revenue.totalOverdue as number, reading: `Past due, against ${revenue.totalOutstanding} outstanding in total.` },
    "collection-rate": {
      value: revenue.collectionRate as number,
      reading: `${revenue.collectionRate}% of what was invoiced in the period has been collected.`,
    },
    "average-invoice": { value: revenue.averageInvoice as number | null, reading: `Mean across ${revenue.invoiceCount} invoices.` },
    csat: {
      value: csatTotals.averageScore,
      reading: csatTotals.responses === 0
        ? "No surveys answered in the period."
        : `${csatTotals.averageScore} out of 10 from ${csatTotals.responses} ${csatTotals.responses === 1 ? "reply" : "replies"}.`,
    },
    "csat-coverage": {
      value: coverage,
      reading: coverage === null
        ? "Nothing was resolved in the period, so coverage cannot be worked out."
        : `${csatTotals.responses} ${csatTotals.responses === 1 ? "response" : "responses"} against ${csatTotals.resolvedTickets} resolved.`,
    },
    "agreement-margin": {
      value: cp.marginPct,
      // The builder returns 100% when no cost rate exists. Saying so is the whole point.
      unreliable: ut.withoutCostRate > 0 && cp.labourCost === 0,
      reading: ut.withoutCostRate > 0 && cp.labourCost === 0
        ? `Reads ${cp.marginPct}% because ${ut.withoutCostRate} ${ut.withoutCostRate === 1 ? "technician carries" : "technicians carry"} no cost rate, so labour costs nothing. Not a margin until a cost rate is set.`
        : `Margin on ${Math.round(cp.annualisedValue / 1000)}k of annualised agreement value.`,
    },
    "recurring-value": { value: cp.annualisedValue, reading: `${contracts.agreements.length} agreements, annualised.` },
    "unpriced-hours": {
      value: cp.unpricedHours,
      reading: cp.unpricedHours === 0
        ? "Every delivered agreement hour carries a price."
        : `${cp.unpricedHours} hours delivered against agreements with no hourly rate, so they cannot be valued.`,
    },
    "revenue-per-ticket": {
      value: revenuePerTicket,
      reading: revenuePerTicket === null ? "No tickets in scope." : `Mean invoiced value per ticket across the clients in scope.`,
    },
  };

  const measures: MeasuredValue[] = ANALYTICS_MEASURES.map((d) => {
    const r = raw[d.id] ?? { value: null, reading: "Not computed for this period." };
    const value = r.value === null || Number.isNaN(r.value) ? null : r.value;
    return {
      ...d,
      value,
      reading: r.reading,
      unreliable: r.unreliable,
      tone: r.unreliable ? "warn" : toneFor(value, d.target, d.direction),
    };
  });

  // ── What the period cannot tell you, in the builders' own words ──────────────────────────────────
  if (typeof utilisation.capacityBasis === "string" && measures.some((m) => m.id === "billable-share")) {
    const anyCapacity = ((utilisation.technicians ?? []) as { utilizationPct: number | null }[]).some((t) => t.utilizationPct !== null);
    if (!anyCapacity) note("technician-utilization", utilisation.capacityBasis);
  }
  note("time-tracking", time.pricing?.note);
  note("ticket-volume", tickets.dataQuality?.note);
  note("sla-compliance", sla.note);
  note("csat", csat.note);
  if (csatTotals.resolvedTickets > 0 && csatTotals.responses < csatTotals.resolvedTickets) {
    note("csat", `Coverage is ${csatTotals.responses} of ${csatTotals.resolvedTickets} resolved tickets — the score is a sample, and a small one.`);
  }
  if (ut.withoutCostRate > 0) {
    note("technician-utilization", `${ut.withoutCostRate} ${ut.withoutCostRate === 1 ? "technician has" : "technicians have"} no cost rate, so labour cost is zero and every margin on this screen reads high.`);
  }

  return {
    period,
    measures,
    limitations,
    groups: MEASURE_GROUPS.filter((g) => measures.some((m) => m.group === g.id && m.value !== null)).map((g) => g.id),
  };
}

/** The builder reports entries without a rate; zero is a real answer and must not be replaced by a guess. */
function effectiveUnrated(pricing: { entriesWithoutRate?: number } | undefined): number {
  return typeof pricing?.entriesWithoutRate === "number" ? pricing.entriesWithoutRate : 0;
}

export interface FunnelStep {
  id: string;
  label: string;
  value: number | null;
  unit: MeasureUnit;
  /** What was lost between the previous step and this one, in words. */
  leak: string | null;
}

export interface AnalyticsFunnel {
  period: ReportPeriod;
  steps: FunnelStep[];
  reading: string;
}

/**
 * Cash realisation: the same delivered work at each step it can leak.
 *
 * This is the measure professional-services platforms are built around and it is spread across three of our
 * reports — effort in `time-tracking`, value in `technician-utilization`, billing and collection in
 * `contract-profitability`. It is assembled here rather than recomputed, so every step traces to a builder.
 */
export async function analyticsFunnel(user: AuthUser | undefined, period: ReportPeriod): Promise<AnalyticsFunnel> {
  const [time, utilisation, contracts] = await Promise.all([
    timeTrackingReport(user, period),
    utilizationReport(user, period),
    contractProfitabilityReport(user, period),
  ]);

  const tt = time.totals as { minutes: number; billableMinutes: number; noChargeMinutes: number };
  const cp = contracts.totals as { invoiced: number; collected: number; hoursDelivered: number; unpricedHours: number; agreements: number };
  const hours = (m: number) => +(m / 60).toFixed(2);

  const steps: FunnelStep[] = [
    { id: "worked", label: "Worked", value: hours(tt.minutes), unit: "hours", leak: null },
    {
      id: "billable",
      label: "Billable",
      value: hours(tt.billableMinutes),
      unit: "hours",
      leak: tt.minutes - tt.billableMinutes > 0
        ? `${hours(tt.minutes - tt.billableMinutes)} hours recorded as non-billable.`
        : null,
    },
    {
      id: "invoiced",
      label: "Invoiced",
      value: cp.invoiced,
      unit: "money",
      leak: cp.unpricedHours > 0
        ? `${cp.unpricedHours} agreement hours carry no rate, so they cannot become revenue at all.`
        : null,
    },
    {
      id: "collected",
      label: "Collected",
      value: cp.collected,
      unit: "money",
      leak: cp.invoiced - cp.collected > 0
        ? `${(cp.invoiced - cp.collected).toFixed(2)} invoiced and not yet collected.`
        : null,
    },
  ];

  const agreementScoped = cp.agreements > 0
    ? `${cp.hoursDelivered} hours were delivered against ${cp.agreements} active ${cp.agreements === 1 ? "agreement" : "agreements"}, and ${cp.invoiced.toFixed(2)} of that has been invoiced.`
    : "No active agreements, so there is no agreement-scoped delivery to follow through to cash.";

  return { period, steps, reading: agreementScoped };
}

export interface BreakdownRow {
  key: string;
  label: string;
  tickets: number;
  open: number | null;
  invoiced: number | null;
  health: Tone | null;
  /**
   * A 0–100 account-health score, so clients separate even when every one of them is in poor shape.
   * A band alone cannot do that: with a uniformly aged backlog every client reads "at risk" and the column
   * stops carrying information. The score is a weighted penalty, and the band is read off it.
   */
  score: number | null;
  /** Why the score is what it is. Null when no band was earned. */
  reason: string | null;
}

export interface AnalyticsBreakdown {
  period: ReportPeriod;
  dimension: BreakdownDimension;
  rows: BreakdownRow[];
  /** The column the dimension is counted by, so a header cannot claim the wrong thing. */
  measureLabel: string;
}

export type BreakdownDimension = "client" | "board" | "technician" | "priority";

export const BREAKDOWN_DIMENSIONS: { id: BreakdownDimension; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "board", label: "Board" },
  { id: "technician", label: "Technician" },
  { id: "priority", label: "Priority" },
];

type Group = { key: string; label: string; count: number };

/**
 * The same figures cut by client, board, technician or priority.
 *
 * The health band exists only for the client dimension, because only that dimension has client economics
 * behind it (`client-value`). A band invented for a board would be a decoration.
 */
export async function analyticsBreakdown(
  user: AuthUser | undefined,
  period: ReportPeriod,
  dimension: BreakdownDimension
): Promise<AnalyticsBreakdown> {
  const [tickets, clients] = await Promise.all([
    ticketVolumeReport(user, period),
    dimension === "client" ? clientValueReport(user, period) : Promise.resolve(null),
  ]);

  const groups: Group[] = dimension === "board"
    ? (tickets.byBoard as Group[]) ?? []
    : dimension === "technician"
      ? (tickets.byAssignee as Group[]) ?? []
      : dimension === "priority"
        ? (tickets.byPriority as Group[]) ?? []
        : (tickets.byClient as Group[]) ?? [];

  const measureLabel = dimension === "technician" ? "Assigned" : dimension === "priority" ? "Raised" : "Tickets";

  if (dimension !== "client") {
    return {
      period,
      dimension,
      measureLabel,
      rows: groups.map((g) => ({ key: g.key, label: g.label, tickets: g.count, open: null, invoiced: null, health: null, score: null, reason: null })),
    };
  }

  type ClientRow = {
    client: string;
    ticketsTotal: number;
    open: number;
    highPriority: number;
    oldestOpenDays: number | null;
    avgFirstReplyMinutes: number | null;
    invoiced: number;
    collected: number;
    outstanding: number;
    revenuePerTicket: number;
  };
  const economics = new Map<string, ClientRow>(
    ((clients?.clients ?? []) as ClientRow[]).map((c) => [c.client, c])
  );

  const rows: BreakdownRow[] = groups.map((g) => {
    const e = economics.get(g.label);
    if (!e) return { key: g.key, label: g.label, tickets: g.count, open: null, invoiced: null, health: null, score: null, reason: null };

    // The score weighs the three things an account manager actually acts on: how old the oldest work is,
    // how much of it is high priority, and whether the money arrived. 100 is unblemished; the penalties
    // are capped so no single fact can drive a client to zero on its own.
    const reasons: string[] = [];
    let score = 100;

    if (e.oldestOpenDays !== null && e.oldestOpenDays > 0) {
      const penalty = Math.min(45, e.oldestOpenDays * 0.5);
      score -= penalty;
      if (e.oldestOpenDays > 30) reasons.push(`oldest ticket open ${e.oldestOpenDays} days`);
    }
    if (e.ticketsTotal > 0 && e.highPriority > 0) {
      score -= Math.min(25, (e.highPriority / e.ticketsTotal) * 100 * 0.5);
      if (e.highPriority / e.ticketsTotal > 0.15) reasons.push(`${e.highPriority} high-priority of ${e.ticketsTotal}`);
    }
    if (e.invoiced > 0) {
      const outShare = e.outstanding / e.invoiced;
      if (outShare > 0) {
        score -= Math.min(25, outShare * 25);
        if (outShare > 0.5) reasons.push(`${Math.round(outShare * 100)}% of invoiced still outstanding`);
      }
      if (e.collected === 0) { score -= 12; reasons.push("nothing collected"); }
    }

    score = Math.max(0, Math.round(score));
    const band: Tone = score >= 65 ? "good" : score >= 40 ? "warn" : "bad";

    return {
      key: g.key,
      label: g.label,
      tickets: e.ticketsTotal,
      open: e.open,
      invoiced: e.invoiced,
      health: band,
      score,
      reason: reasons.length ? reasons.join("; ") : "nothing outstanding",
    };
  });

  return { period, dimension, measureLabel, rows };
}
