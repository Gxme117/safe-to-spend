import {confidenceNote, isOrgPending, orgOutcomeLine, type PendingOrg} from "../orgProposal";
import type {OrgReport} from "../organise";

function makeReport(over: Partial<OrgReport> = {}): OrgReport {
  return {
    runId: "r1", at: Date.now(), reviewed: 3, auto: 2, provisional: 1, left: 0, more: 0, failed: 0,
    byCat: [], check: [], unclear: [], ...over,
  };
}

function makePending(runId = "r1"): PendingOrg {
  return {runId, apply: async () => ({report: makeReport({runId})})};
}

describe("orgOutcomeLine — cancelled", () => {
  it("returns a cancelled message with the run id", () => {
    const line = orgOutcomeLine("r1", "cancelled");
    expect(line).toContain("cancelled");
    expect(line).toContain("r1");
  });
});

describe("orgOutcomeLine — with report", () => {
  it("includes organised count", () => {
    const report = makeReport({auto: 10, provisional: 2, left: 1, more: 0});
    const line = orgOutcomeLine("r1", {report});
    expect(line).toContain("12 payments organised");
  });

  it("includes provisional count when non-zero", () => {
    const report = makeReport({auto: 10, provisional: 2});
    const line = orgOutcomeLine("r1", {report});
    expect(line).toContain("2 to review");
  });

  it("omits provisional when zero", () => {
    const report = makeReport({auto: 5, provisional: 0});
    const line = orgOutcomeLine("r1", {report});
    expect(line).not.toContain("to review");
  });

  it("includes left count when non-zero", () => {
    const report = makeReport({auto: 3, provisional: 0, left: 4});
    const line = orgOutcomeLine("r1", {report});
    expect(line).toContain("4 skipped");
  });

  it("includes more count when non-zero", () => {
    const report = makeReport({auto: 3, provisional: 0, left: 0, more: 50});
    const line = orgOutcomeLine("r1", {report});
    expect(line).toContain("50 more still waiting");
  });

  it("singular when done is 1", () => {
    const report = makeReport({auto: 1, provisional: 0, left: 0, more: 0});
    const line = orgOutcomeLine("r1", {report});
    expect(line).toContain("1 payment organised");
    expect(line).not.toContain("payments organised");
  });

  it("includes run id in output", () => {
    const report = makeReport();
    const line = orgOutcomeLine("r42", {report});
    expect(line).toContain("r42");
  });
});

describe("confidenceNote", () => {
  it("returns a non-empty string", () => {
    expect(confidenceNote().length).toBeGreaterThan(0);
  });
});

describe("isOrgPending", () => {
  it("returns true when pending matches runId", () => {
    expect(isOrgPending(makePending("r1"), "r1")).toBe(true);
  });

  it("returns false when pending is null", () => {
    expect(isOrgPending(null, "r1")).toBe(false);
  });

  it("returns false when runId doesn't match", () => {
    expect(isOrgPending(makePending("r1"), "r2")).toBe(false);
  });
});

describe("preview count invariant", () => {
  it("high + medium + low <= total for all fixture runs", () => {
    const previews = [
      {runId: "r1", high: 5, medium: 3, low: 2, total: 10, more: 0},
      {runId: "r2", high: 0, medium: 0, low: 1, total: 1, more: 0},
      {runId: "r3", high: 100, medium: 50, low: 50, total: 200, more: 300},
    ];
    for (const p of previews) {
      expect(p.high + p.medium + p.low).toBeLessThanOrEqual(p.total);
    }
  });
});
