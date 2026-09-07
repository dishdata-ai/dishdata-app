"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote, ArrowDownToLine, ArrowUpFromLine, Lock, Unlock, TriangleAlert,
} from "lucide-react";
import {
  Card, SectionTitle, Button, Badge, Modal, Input, Field, StatCard, EmptyState, PageSkeleton, Table,
} from "@/components/ui";
import { useOpenTill, useTillSessions, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import {
  openTill, closeTill, recordCashMovement, expectedCash, listCashMovements, unassignedCashSince,
} from "@/lib/api/till";
import type { CashDirection, TillSession } from "@/lib/api/database.types";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";

/** Reasons offered for manual movements. Free text stays available via the comment. */
const IN_REASONS = ["Transfer from bank or safe", "Private deposit", "Other income", "Tips", "Other"];
const OUT_REASONS = ["Transfer to bank or safe", "Supplier payment", "Petty cash", "Private withdrawal", "Other"];

const berlin = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

export default function Till() {
  const { org } = useOrg();
  const fmt = useFmt();
  const invalidate = useInvalidate();
  const openQ = useOpenTill();
  const sessionsQ = useTillSessions();

  const [tab, setTab] = useState<"current" | "history">("current");
  const [opening, setOpening] = useState(false);
  const [floatInput, setFloatInput] = useState("");
  const [movement, setMovement] = useState<CashDirection | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);

  const session = openQ.data ?? null;

  // The live expected balance is computed by the same SQL used at close, so
  // what staff watch during service can't drift from what they're reconciled
  // against — worth a round-trip rather than a second implementation here.
  const expectedQ = useQuery({
    queryKey: ["org", org?.id, "till_expected", session?.id],
    queryFn: () => expectedCash(session!),
    enabled: !!session,
  });

  const movementsQ = useQuery({
    queryKey: ["org", org?.id, "till_movements", session?.id],
    queryFn: () => listCashMovements(session!.id),
    enabled: !!session,
  });

  // Cash rung up since the last close with no till open belongs to no cash
  // book at all — a real §146 AO gap, so it's surfaced rather than absorbed.
  const lastClosedAt = useMemo(() => {
    const closed = (sessionsQ.data ?? []).filter((s) => s.status === "closed" && s.closed_at);
    return closed.length ? closed[0].closed_at : null;
  }, [sessionsQ.data]);

  const orphanQ = useQuery({
    queryKey: ["org", org?.id, "till_unassigned", lastClosedAt],
    queryFn: () => unassignedCashSince(org!.id, lastClosedAt),
    enabled: !!org && !session,
  });

  const expected = expectedQ.data ?? 0;
  const countedNum = Number(counted.replace(",", ".")) || 0;
  const countDiff = countedNum - expected;

  useEffect(() => {
    if (!movement) return;
    setAmount("");
    setComment("");
    setReason(movement === "in" ? IN_REASONS[0] : OUT_REASONS[0]);
  }, [movement]);

  const refresh = () => invalidate("till_open", "till_sessions", "till_expected", "till_movements", "till_unassigned");

  const doOpen = async () => {
    setBusy(true);
    try {
      await openTill(org!.id, Number(floatInput.replace(",", ".")) || 0);
      refresh();
      setOpening(false);
      setFloatInput("");
      toast.success("Till opened", "Cash sales now count toward this drawer");
    } catch (e) {
      toast.error("Could not open the till", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doMovement = async () => {
    const value = Number(amount.replace(",", ".")) || 0;
    setBusy(true);
    try {
      await recordCashMovement(org!.id, movement!, value, reason, comment.trim() || null);
      refresh();
      setMovement(null);
      toast.success(movement === "in" ? "Cash added" : "Cash taken out", `${fmt(value, 2)} · ${reason}`);
    } catch (e) {
      toast.error("Could not record that", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doClose = async () => {
    setBusy(true);
    try {
      await closeTill(org!.id, countedNum, closeNote.trim() || null);
      refresh();
      setClosing(false);
      setCounted("");
      setCloseNote("");
      toast.success("Till closed", Math.abs(countDiff) < 0.005 ? "Drawer balanced exactly" : `Difference ${fmt(countDiff, 2)}`);
    } catch (e) {
      toast.error("Could not close the till", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (openQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Till & Cash"
        subtitle="Drawer float, cash in and out, and the count that closes the day."
        action={
          session ? (
            <Button variant="ghost" onClick={() => setClosing(true)}>
              <Lock className="h-4 w-4" /> Close Till
            </Button>
          ) : (
            <Button onClick={() => setOpening(true)}>
              <Unlock className="h-4 w-4" /> Open Till
            </Button>
          )
        }
      />

      <div className="flex gap-1.5">
        {(["current", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
              tab === t
                ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
            )}
          >
            {t === "current" ? "Current" : "History"}
          </button>
        ))}
      </div>

      {tab === "current" ? (
        session ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Expected in drawer"
                value={fmt(expected, 2)}
                hint="float + cash sales +/- movements"
                icon={Banknote}
              />
              <StatCard title="Opening float" value={fmt(session.opening_float, 2)} hint={berlin(session.opened_at)} icon={Unlock} />
              <StatCard
                title="Cash in"
                value={fmt((movementsQ.data ?? []).filter((m) => m.direction === "in").reduce((s, m) => s + m.amount, 0), 2)}
                hint="manual deposits"
                icon={ArrowDownToLine}
              />
              <StatCard
                title="Cash out"
                value={fmt((movementsQ.data ?? []).filter((m) => m.direction === "out").reduce((s, m) => s + m.amount, 0), 2)}
                hint="manual withdrawals"
                icon={ArrowUpFromLine}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="ghost" className="flex-1" onClick={() => setMovement("in")}>
                <ArrowDownToLine className="h-4 w-4" /> Put cash in
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setMovement("out")}>
                <ArrowUpFromLine className="h-4 w-4" /> Take cash out
              </Button>
            </div>

            <Card>
              <div className="border-b border-line p-4">
                <h3 className="font-semibold text-white">Cash movements</h3>
                <p className="text-xs text-zinc-500">
                  Every manual deposit and withdrawal in this session, with its reason.
                </p>
              </div>
              {(movementsQ.data ?? []).length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-500">
                  No manual cash movements yet — only sales have touched this drawer.
                </div>
              ) : (
                <Table headers={["When", "Direction", "Reason", "Amount"]}>
                  {(movementsQ.data ?? []).map((m) => (
                    <tr key={m.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-zinc-400">{berlin(m.created_at)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={m.direction === "in" ? "green" : "amber"}>
                          {m.direction === "in" ? "In" : "Out"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {m.reason}
                        {m.comment && <span className="block text-xs text-zinc-500">{m.comment}</span>}
                      </td>
                      <td className={cn("px-4 py-3 font-semibold", m.direction === "in" ? "text-brand-300" : "text-amber-soft")}>
                        {m.direction === "in" ? "+" : "−"}
                        {fmt(m.amount, 2)}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </>
        ) : (
          <>
            {(orphanQ.data ?? 0) > 0 && (
              <Card className="border-amber-500/30 bg-amber-500/[0.06]">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-sm text-amber-200">
                    <strong>{fmt(orphanQ.data ?? 0, 2)} in cash sales with no till open.</strong> Those takings
                    belong to no drawer and appear in no cash book. Open a till to start recording, and note
                    the amount somewhere before it&rsquo;s forgotten — a cash book with a gap can&rsquo;t be
                    reconciled later.
                  </p>
                </div>
              </Card>
            )}
            <Card>
              <EmptyState
                icon={Banknote}
                title="No till open"
                hint="Open the drawer with its starting float to begin recording cash for this shift."
                action={
                  <Button onClick={() => setOpening(true)}>
                    <Unlock className="h-4 w-4" /> Open Till
                  </Button>
                }
              />
            </Card>
          </>
        )
      ) : (
        <Card>
          <div className="border-b border-line p-4">
            <h3 className="font-semibold text-white">Closed sessions</h3>
            <p className="text-xs text-zinc-500">Each drawer close, with what was expected against what was counted.</p>
          </div>
          {(sessionsQ.data ?? []).filter((s) => s.status === "closed").length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">No till has been closed yet.</div>
          ) : (
            <Table headers={["Opened", "Closed", "Float", "Expected", "Counted", "Difference"]}>
              {(sessionsQ.data ?? [])
                .filter((s) => s.status === "closed")
                .map((s: TillSession) => {
                  const diff = s.difference ?? 0;
                  const balanced = Math.abs(diff) < 0.005;
                  return (
                    <tr key={s.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-zinc-400">{berlin(s.opened_at)}</td>
                      <td className="px-4 py-3 text-zinc-400">{s.closed_at ? berlin(s.closed_at) : "—"}</td>
                      <td className="px-4 py-3 text-zinc-300">{fmt(s.opening_float, 2)}</td>
                      <td className="px-4 py-3 text-zinc-300">{fmt(s.expected_closing ?? 0, 2)}</td>
                      <td className="px-4 py-3 font-medium text-zinc-100">{fmt(s.counted_closing ?? 0, 2)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={balanced ? "green" : Math.abs(diff) < 5 ? "amber" : "rose"}>
                          {balanced ? "Balanced" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff), 2)}`}
                        </Badge>
                        {s.note && <span className="mt-1 block text-xs text-zinc-500">{s.note}</span>}
                      </td>
                    </tr>
                  );
                })}
            </Table>
          )}
        </Card>
      )}

      {/* Open */}
      <Modal open={opening} onClose={() => setOpening(false)} title="Open the till">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Count the cash already in the drawer and enter it as the starting float. Everything after this
            is measured against it.
          </p>
          <Field label="Opening float">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={floatInput}
              onChange={(e) => setFloatInput(e.target.value)}
              autoFocus
            />
          </Field>
          <Button className="w-full" disabled={busy} onClick={doOpen}>
            {busy ? "Opening…" : "Open Till"}
          </Button>
        </div>
      </Modal>

      {/* Cash in / out */}
      <Modal
        open={!!movement}
        onClose={() => setMovement(null)}
        title={movement === "in" ? "Put cash in" : "Take cash out"}
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            {movement === "in"
              ? "Money added to the drawer that isn't a sale — a float top-up or a transfer from the safe."
              : "Money removed from the drawer — a supplier paid in cash, or a drop to the safe."}
          </p>
          {movement === "out" && (
            <p className="text-xs text-zinc-500">Available: {fmt(expected, 2)}</p>
          )}
          <Field label="Amount">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Reason">
            <div className="space-y-1.5">
              {(movement === "in" ? IN_REASONS : OUT_REASONS).map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "w-full cursor-pointer rounded-xl border px-3 py-2 text-left text-sm transition-all",
                    reason === r
                      ? "border-brand-400/60 bg-brand-400/10 text-white"
                      : "border-line bg-white/[0.02] text-zinc-400 hover:border-zinc-500",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Comment (optional)">
            <Input placeholder="e.g. Receipt No 123" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Button
            className="w-full"
            disabled={busy || !(Number(amount.replace(",", ".")) > 0)}
            onClick={doMovement}
          >
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </div>
      </Modal>

      {/* Close */}
      <Modal open={closing} onClose={() => setClosing(false)} title="Close the till">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Count the drawer and enter what is physically there. A difference is recorded rather than
            corrected — that record is the point of the cash book.
          </p>
          <div className="space-y-2 text-sm">
            {(
              [
                ["Opening float", fmt(session?.opening_float ?? 0, 2)],
                ["Expected now", fmt(expected, 2)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between rounded-lg px-3 py-2 odd:bg-white/[0.02]">
                <span className="text-zinc-400">{label}</span>
                <span className="font-medium text-zinc-100">{value}</span>
              </div>
            ))}
          </div>
          <Field label="Counted in drawer">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              autoFocus
            />
          </Field>
          {counted.trim() !== "" && (
            <div
              className={cn(
                "flex justify-between rounded-xl border px-3 py-2.5 text-sm font-semibold",
                Math.abs(countDiff) < 0.005
                  ? "border-brand-400/30 bg-brand-400/5 text-brand-300"
                  : "border-amber-soft/30 bg-amber-soft/5 text-amber-soft",
              )}
            >
              <span>Difference</span>
              <span>
                {Math.abs(countDiff) < 0.005 ? "Balanced" : `${countDiff > 0 ? "+" : "−"}${fmt(Math.abs(countDiff), 2)}`}
              </span>
            </div>
          )}
          <Field label="Note (optional)">
            <Input placeholder="e.g. till short, reported to manager" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={busy || counted.trim() === ""} onClick={doClose}>
            {busy ? "Closing…" : "Close Till"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
