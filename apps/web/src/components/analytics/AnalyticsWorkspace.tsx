/**
 * The Analytics workspace, in both interfaces.
 *
 * Why it exists. The Analytics tab used to fetch one of the twelve datasets the API serves — revenue — and
 * draw a bar chart. Everything else the platform already computed was unreachable from the screen. This is a
 * measure-first workspace: every figure is a named measure with its own definition, its source endpoint, a
 * target where one exists and a tone; and the screen prints the limitations the API reports, in the API's own
 * words, rather than letting a dashboard imply a completeness the data does not have.
 *
 * THE TWO ARRANGEMENTS ARE DIFFERENT DESIGNS, NOT ONE WITH A CLASS TOGGLED.
 *
 *   Modern — a strip of period chips you press; a rail of measures grouped by domain, each carrying its own
 *   value and a tone dot; the selected measure in a panel whose sentence says what the number means this
 *   period; dimension pills that re-cut the same table; the realisation funnel as bars; the limitations
 *   in-line; a countable footer; and a sheet for a measure's definition.
 *
 *   Classic — a filter form: labelled fields in a grid with a Run and a Reset; the measures as a table of
 *   Measure / Value / Target / Status / Source; a select where the modern panel has pills; the funnel as a
 *   table of steps; and a dialog with a heading and a Close for the definition.
 *
 * The shared part is the state, the four API calls and the words — never the layout.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api";
import toast from "react-hot-toast";
import { RefreshCw, TrendingUp, Info, Filter, ListFilter } from "lucide-react";
import { CardSkeleton, TableSkeleton } from "../ui/Skeleton";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { money, number } from "../reports/reportKit";
import { apiErrorMessage } from "../../lib/apiError";

type Unit = "count" | "percent" | "minutes" | "money" | "days" | "score" | "hours";
type Tone = "good" | "warn" | "bad" | "neutral";

interface Measure {
  id: string;
  label: string;
  group: string;
  unit: Unit;
  definition: string;
  direction: "higher" | "lower" | "neutral";
  target: number | null;
  targetLabel: string | null;
  source: string;
}

interface MeasuredValue extends Measure {
  value: number | null;
  reading: string;
  tone: Tone;
  unreliable?: boolean;
}

interface Overview {
  period: { label: string; from: string | null; to: string | null };
  measures: MeasuredValue[];
  limitations: { source: string; note: string }[];
  groups: string[];
}

interface FunnelStep {
  id: string;
  label: string;
  value: number | null;
  unit: Unit;
  leak: string | null;
}

interface FunnelData {
  steps: FunnelStep[];
  reading: string;
}

interface BreakdownRow {
  key: string;
  label: string;
  tickets: number;
  open: number | null;
  invoiced: number | null;
  health: Tone | null;
  score: number | null;
  reason: string | null;
}

interface Breakdown {
  dimension: string;
  measureLabel: string;
  rows: BreakdownRow[];
}

const GROUP_LABELS: Record<string, string> = {
  service: "Service",
  responsiveness: "Responsiveness",
  effort: "Effort",
  money: "Money",
  experience: "Experience",
  commercial: "Commercial",
};

const DIMENSIONS: { id: string; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "board", label: "Board" },
  { id: "technician", label: "Technician" },
  { id: "priority", label: "Priority" },
];

const PRESETS = [
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

/** The window a preset resolves to. "All time" sends no dates, which is what the builders treat as all time. */
function presetRange(id: string): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (id) {
    case "month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "quarter": {
      const q = Math.floor(m / 3);
      return { from: iso(new Date(y, q * 3, 1)), to: iso(new Date(y, q * 3 + 3, 0)) };
    }
    case "year":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default:
      return { from: "", to: "" };
  }
}

function formatMinutes(value: number): string {
  if (value < 60) return `${Math.round(value)}m`;
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** One place that turns a measure into words, so the rail, the table and the dialog cannot disagree. */
function format(value: number | null, unit: Unit): string {
  if (value === null || value === undefined) return "—";
  switch (unit) {
    case "money": return money(value);
    case "percent": return `${number(value)}%`;
    case "minutes": return formatMinutes(value);
    case "days": return `${number(value)} d`;
    case "hours": return `${number(value)} h`;
    case "score": return value.toFixed(1);
    default: return number(value);
  }
}

const toneText = (tone: Tone): string =>
  tone === "good" ? "text-green-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-red-400" : "text-white";

const toneChip = (tone: Tone): string =>
  tone === "good" ? "chip--good" : tone === "warn" ? "chip--warn" : tone === "bad" ? "chip--bad" : "";

const toneLabel = (tone: Tone, unreliable?: boolean): string => {
  if (unreliable) return "Unreliable";
  return tone === "good" ? "Met" : tone === "warn" ? "Watch" : tone === "bad" ? "Breach" : "No target";
};

export function AnalyticsWorkspace() {
  const modern = useModernInterface();
  const [preset, setPreset] = useState("year");
  const [range, setRange] = useState(() => presetRange("year"));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [dimension, setDimension] = useState("client");
  const [selected, setSelected] = useState<string>("collection-rate");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [defining, setDefining] = useState<Measure | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    return p.toString();
  }, [range]);

  const load = useCallback(async (q: string) => {
    setBusy(true);
    try {
      const [o, f] = await Promise.all([
        api.get(`/analytics/overview?${q}`),
        api.get(`/analytics/funnel?${q}`),
      ]);
      setOverview(o.data);
      setFunnel(f.data);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not load the analytics"));
      setOverview(null);
      setFunnel(null);
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(query); }, [load, query]);

  // The breakdown is a separate read on purpose: changing the dimension must not re-run the nine builders
  // behind the overview.
  useEffect(() => {
    let live = true;
    api.get(`/analytics/breakdown?dimension=${dimension}&${query}`)
      .then((r) => { if (live) setBreakdown(r.data); })
      .catch(() => { if (live) setBreakdown(null); });
    return () => { live = false; };
  }, [dimension, query]);

  const measures = overview?.measures ?? [];
  const withValue = measures.filter((m) => m.value !== null);
  const current = measures.find((m) => m.id === selected) ?? withValue[0] ?? null;
  const grouped = (overview?.groups ?? []).map((g) => ({
    id: g,
    label: GROUP_LABELS[g] ?? g,
    rows: measures.filter((m) => m.group === g && m.value !== null),
  }));

  const applyPreset = (id: string) => {
    setPreset(id);
    setRange(presetRange(id));
  };

  if (loading) return modern ? <CardSkeleton rows={3} /> : <TableSkeleton rows={8} />;

  // ═══════════════════════════ Modern ═══════════════════════════
  if (modern) {
    return (
      <div className="space-y-5">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => applyPreset(p.id)} className={`chip ${preset === p.id ? "chip--on" : ""}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">
              {overview?.period.label ?? "All time"} · {withValue.length} of {measures.length} measures carry a figure
            </span>
          </div>
        </div>

        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Measures</h3>
            <p className="text-xs text-gray-500">
              A dot reports the measure against its target. No dot means no target has been set, which is a fact
              about the measure rather than about this period.
            </p>
          </div>

          {grouped.map((g) => (
            <div key={g.id}>
              <p className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">{g.label}</p>
              <div className="flex flex-wrap gap-2">
                {g.rows.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                    title={m.reading}
                    className={`chip ${selected === m.id ? "chip--on" : ""} ${m.tone !== "neutral" ? toneChip(m.tone) : ""}`}
                  >
                    {m.tone !== "neutral" && <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
                    {m.label} <span className="chip__n">{format(m.value, m.unit)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {current && (
            <div className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                    Selected measure · {GROUP_LABELS[current.group] ?? current.group}
                  </p>
                  <p className={`mt-1 text-3xl font-bold ${toneText(current.tone)}`}>{format(current.value, current.unit)}</p>
                  <p className="mt-2 text-sm text-gray-300">{current.reading}</p>
                </div>
                <button className="btn-secondary text-xs shrink-0" onClick={() => setDefining(current)}>Definition</button>
              </div>
              <p className="mt-3 text-xs text-gray-500">Source: {current.source}</p>
              {current.unreliable && (
                <p className="mt-2 flex items-start gap-2 text-xs text-amber-400">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  This figure is computable but not meaningful yet — the reason is below.
                </p>
              )}
            </div>
          )}

          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <ListFilter size={15} className="text-cyber-400" />Breakdown
              </h3>
              <span className="text-xs text-gray-500">the same figures, cut four ways</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {DIMENSIONS.map((d) => (
                <button key={d.id} onClick={() => setDimension(d.id)} className={`chip ${dimension === d.id ? "chip--on" : ""}`}>
                  {d.label}
                </button>
              ))}
            </div>
            {breakdown && breakdown.rows.length > 0 ? (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="pb-2">{DIMENSIONS.find((d) => d.id === dimension)?.label}</th>
                    <th className="pb-2 text-right">{breakdown.measureLabel}</th>
                    {dimension === "client" && <th className="pb-2 text-right">Health</th>}
                  </tr>
                </thead>
                <tbody>
                  {breakdown.rows.slice(0, 8).map((r) => (
                    <tr key={r.key} className="border-t border-surface-border">
                      <td className="py-2 text-gray-300">{r.label}</td>
                      <td className="py-2 text-right text-white">{r.tickets}</td>
                      {dimension === "client" && (
                        <td className="py-2 text-right">
                          {r.score === null ? <span className="text-gray-600">—</span> : (
                            <span className={`chip ${toneChip(r.health ?? "neutral")}`} title={r.reason ?? ""}>{r.score}</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-gray-500">Nothing to break down in this period.</p>
            )}
            {dimension === "client" && (
              <p className="mt-3 text-xs text-gray-500">
                Health weighs how old the oldest open ticket is, how much of the load is high priority, and whether
                the money arrived. A score is shown rather than a band because with a uniformly aged backlog every
                client would otherwise read the same.
              </p>
            )}
          </div>
        </div>

        {funnel && (
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Filter size={15} className="text-cyber-400" />Cash realisation
              </h3>
              <span className="text-xs text-gray-500">the same work, at each step it can leak</span>
            </div>
            <div className="mt-4 space-y-2">
              {funnel.steps.map((s, i) => {
                const first = funnel.steps[0]?.value ?? null;
                const pct = first && s.value !== null && i < 2 ? (s.value / first) * 100 : null;
                return (
                  <div key={s.id} className="grid grid-cols-[110px_1fr_100px] items-center gap-3 text-sm">
                    <span className="text-gray-400">{s.label}</span>
                    <span className="h-4 rounded bg-cyber-600" style={{ width: `${Math.max(2, Math.min(100, pct ?? 100))}%` }} />
                    <span className="text-right text-white">{format(s.value, s.unit)}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-gray-400">{funnel.reading}</p>
            {funnel.steps.filter((s) => s.leak).map((s) => (
              <p key={s.id} className="mt-1 text-xs text-amber-400">{s.label}: {s.leak}</p>
            ))}
          </div>
        )}

        {overview && overview.limitations.length > 0 && (
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Info size={15} className="text-amber-400" />What this period cannot tell you
              </h3>
              <span className="text-xs text-gray-500">reported by the API, not inferred</span>
            </div>
            <div className="mt-3 space-y-2">
              {overview.limitations.map((l, i) => (
                <p key={i} className="border-l-2 border-amber-500/60 pl-3 text-xs text-gray-300">
                  <span className="text-gray-500">{l.source}</span> — {l.note}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            {withValue.length} measures with a figure · {DIMENSIONS.length} dimensions · {measures.filter((m) => m.target !== null).length} carry a target
          </p>
          <button className="btn-secondary text-xs flex items-center gap-2" onClick={() => void load(query)} disabled={busy}>
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />{busy ? "Recalculating" : "Recalculate"}
          </button>
        </div>

        {defining && <DefinitionSheet measure={defining} onClose={() => setDefining(null)} />}
      </div>
    );
  }

  // ═══════════════════════════ Classic ═══════════════════════════
  return (
    <div className="space-y-5">
      <form className="card" onSubmit={(e) => { e.preventDefault(); void load(query); }}>
        <h3 className="text-sm font-semibold text-white mb-4">Filters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input type="date" className="input-field w-full" value={range.from}
              onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input type="date" className="input-field w-full" value={range.to}
              onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Preset</label>
            <select className="input-field w-full" value={preset} onChange={(e) => applyPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="custom">Custom range</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Breakdown by</label>
            <select className="input-field w-full" value={dimension} onChange={(e) => setDimension(e.target.value)}>
              {DIMENSIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => applyPreset("year")}>Reset</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Running…" : "Run"}</button>
        </div>
      </form>

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-white">Measures</h3>
          <p className="text-xs text-gray-500">{overview?.period.label ?? "All time"} · {measures.length} rows</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="pb-2">Measure</th>
                <th className="pb-2">Group</th>
                <th className="pb-2 text-right">Value</th>
                <th className="pb-2 pr-5 text-right">Target</th>
                <th className="pb-2 whitespace-nowrap">Status</th>
                <th className="pb-2 pl-4">Source</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {measures.map((m) => (
                <tr key={m.id} className="border-t border-surface-border">
                  <td className="py-2 text-gray-200">
                    {m.label}
                    <p className="text-xs text-gray-500">{m.reading}</p>
                  </td>
                  <td className="py-2 text-gray-400">{GROUP_LABELS[m.group] ?? m.group}</td>
                  <td className={`py-2 text-right font-medium ${toneText(m.tone)}`}>{format(m.value, m.unit)}</td>
                  <td className="py-2 pr-5 text-right text-gray-400">{m.targetLabel ?? "—"}</td>
                  <td className="py-2 whitespace-nowrap"><span className={`chip text-xs ${toneChip(m.tone)}`}>{toneLabel(m.tone, m.unreliable)}</span></td>
                  <td className="py-2 pl-4 text-xs text-gray-500">{m.source}</td>
                  <td className="py-2 text-right">
                    <button className="btn-secondary text-xs" onClick={() => setDefining(m)}>Definition</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-white">Breakdown</h3>
            <select className="input-field text-xs w-40" value={dimension} onChange={(e) => setDimension(e.target.value)}>
              {DIMENSIONS.map((d) => <option key={d.id} value={d.id}>By {d.label.toLowerCase()}</option>)}
            </select>
          </div>
          {breakdown && breakdown.rows.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-2">{DIMENSIONS.find((d) => d.id === dimension)?.label}</th>
                  <th className="pb-2 text-right">{breakdown.measureLabel}</th>
                  {dimension === "client" && <th className="pb-2 text-right">Score</th>}
                </tr>
              </thead>
              <tbody>
                {breakdown.rows.map((r) => (
                  <tr key={r.key} className="border-t border-surface-border">
                    <td className="py-2 text-gray-300">{r.label}</td>
                    <td className="py-2 text-right text-white">{r.tickets}</td>
                    {dimension === "client" && <td className="py-2 text-right text-white">{r.score ?? "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">Nothing to break down in this period.</p>}
        </div>

        {funnel && (
          <div className="card">
            <h3 className="text-sm font-semibold text-white mb-3">Cash realisation</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-2">Step</th><th className="pb-2 text-right">Amount</th><th className="pb-2">Leak</th>
                </tr>
              </thead>
              <tbody>
                {funnel.steps.map((s) => (
                  <tr key={s.id} className="border-t border-surface-border">
                    <td className="py-2 text-gray-300">{s.label}</td>
                    <td className="py-2 text-right text-white">{format(s.value, s.unit)}</td>
                    <td className="py-2 text-xs text-amber-400">{s.leak ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-400">{funnel.reading}</p>
          </div>
        )}
      </div>

      {overview && overview.limitations.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-3">Notes and limitations</h3>
          <div className="space-y-2">
            {overview.limitations.map((l, i) => (
              <p key={i} className="border-l-2 border-amber-500/60 pl-3 text-xs text-gray-300">
                <span className="text-gray-500">{l.source}</span> — {l.note}
              </p>
            ))}
          </div>
        </div>
      )}

      {defining && <DefinitionDialog measure={defining} onClose={() => setDefining(null)} />}
    </div>
  );
}

/** The definition's content is identical in both arrangements, so the words live here once. */
function DefinitionBody({ measure }: { measure: Measure }) {
  return (
    <>
      <p className="text-sm text-gray-300">{measure.definition}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-gray-500">Source</dt><dd className="text-gray-300">{measure.source}</dd>
        <dt className="text-gray-500">Unit</dt><dd className="text-gray-300">{measure.unit}</dd>
        <dt className="text-gray-500">Target</dt><dd className="text-gray-300">{measure.targetLabel ?? "No target set"}</dd>
        <dt className="text-gray-500">Direction</dt>
        <dd className="text-gray-300">
          {measure.direction === "higher" ? "Higher is better" : measure.direction === "lower" ? "Lower is better" : "Neither — context decides"}
        </dd>
      </dl>
    </>
  );
}

/** Modern: a sheet that comes in from the right and closes on Escape. */
function DefinitionSheet({ measure, onClose }: { measure: Measure; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-surface-border bg-surface-light p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Measure definition"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">{measure.label}</h3>
          <button className="btn-secondary text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="mt-4"><DefinitionBody measure={measure} /></div>
      </div>
    </div>
  );
}

/** Classic: a dialog with a heading and a Close under it. */
function DefinitionDialog({ measure, onClose }: { measure: Measure; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Measure definition">
        <h3 className="text-sm font-semibold text-white">{measure.label}</h3>
        <div className="mt-4"><DefinitionBody measure={measure} /></div>
        <div className="mt-5 flex justify-end">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** The tab renders this. */
export default function AnalyticsTab() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 flex items-start gap-2">
        <TrendingUp size={13} className="text-cyber-400 mt-0.5 shrink-0" />
        Every figure here is computed by the same builders the standard reports use, so a number on this screen
        and the same number in a report cannot disagree.
      </p>
      <AnalyticsWorkspace />
    </div>
  );
}
