// availableActions — frontend port of src/actions.ts, the tested single source of truth for
// which actions an issue offers (architecture review, Candidate 5). Kept 1:1 with the TS by
// test/web-actions-parity.test.mjs. Pure: {state, blocked} + observable facts -> ordered
// [{id, variant, confirm?}]. web/detail.js renders the list via its per-action builders.
export function availableActions(status, facts) {
  if (status.state === "done") return [];
  const out = [];

  if (facts.running) {
    out.push({ id: "stop", variant: "warn" });
    return out;
  }

  if (facts.hasPr) {
    if (facts.conflict) out.push({ id: "fix", variant: "primary" });
    else if (facts.needsFix) {
      out.push({ id: "fix", variant: "primary" });
      out.push({ id: "mergeAnyway", variant: "green", confirm: true });
    } else out.push({ id: "merge", variant: "green", confirm: true });
    out.push({ id: "resume", variant: "neutral" });
    out.push({ id: "cancel", variant: "warn" });
    return out;
  }

  const parked = status.state === "notPlanned" || status.state === "planned";
  const awaiting = status.blocked === "awaitingApproval";

  if (facts.isEpic) {
    out.push({ id: "close", variant: "green", confirm: true });
    out.push({ id: "resume", variant: "neutral" });
    out.push({ id: "cancel", variant: "warn" });
    return out;
  }
  if (parked && !awaiting) {
    out.push({ id: "start", variant: "green" });
    return out;
  }
  if (awaiting) {
    out.push({ id: "approve", variant: "primary" });
    out.push({ id: "toPlanned", variant: "neutral" });
    return out;
  }
  if (facts.approvedNoPr) {
    out.push({ id: "createPr", variant: "green" });
    out.push({ id: "resume", variant: "neutral" });
    out.push({ id: "cancel", variant: "warn" });
    return out;
  }
  out.push({ id: "resume", variant: "neutral" });
  out.push({ id: "close", variant: "neutral", confirm: true });
  out.push({ id: "cancel", variant: "warn" });
  return out;
}
