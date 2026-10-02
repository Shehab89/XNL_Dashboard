import { describe, expect, it } from "vitest";
import raw from "../data/snapshot.json";
import { PARTIES, POLITICIANS, TOTAL_SEATS, partyById } from "../data/reference";
import { loadMonitor } from "../services/monitor";
import { buildIndex, search } from "../services/search";
import { fmtSigned, fold, slug } from "../utils/format";
import { change, net, smooth, windowSum } from "../utils/series";

describe("series", () => {
  it("compares complete windows and refuses tiny bases", () => {
    const xs = [10, 10, 10, 10, 20, 20, 20, 20, 999];
    expect(windowSum(xs, 8, 4)).toBe(80);
    expect(change(xs, 8, 4)).toBeCloseTo(1);
    expect(change([1, 1, 1, 1, 5, 5, 5, 5], 8, 4)).toBeNull();
  });
  it("smooths without changing length", () => {
    expect(smooth([0, 3, 0])).toEqual([1.5, 1, 1.5]);
  });
  it("returns no net tone below the minimum", () => {
    expect(net(5, 1, 10)).toBeNull();
    expect(net(30, 10, 100)).toBe(20);
  });
});

describe("format", () => {
  it("folds accents and slugs Dutch words", () => {
    expect(fold("Oekraïne")).toBe("oekraine");
    expect(slug("Tweede Kamer")).toBe("tweede-kamer");
    expect(fmtSigned(-3, "nl")).toBe("−3");
  });
});

describe("reference data", () => {
  it("adds up to 150 seats and links every leader to a known politician", async () => {
    await loadMonitor();
    expect(PARTIES.length).toBeGreaterThan(10);
    expect(PARTIES.reduce((a, p) => a + (p.seats ?? 0), 0)).toBe(TOTAL_SEATS);
    for (const p of PARTIES) if (p.leaderId) expect(POLITICIANS.some((x) => x.id === p.leaderId)).toBe(true);
    for (const x of POLITICIANS) expect(partyById.has(x.partyId)).toBe(true);
  });
});

describe("monitor service", () => {
  it("maps every snapshot party and topic name onto the reference lists", async () => {
    const d = await loadMonitor();
    expect(d.weeks).toHaveLength(raw.weeks.length);
    expect(d.partialWeek).toBe(d.weeks.length - 1);
    for (const [, c] of d.party) expect(c.series.n).toHaveLength(d.weeks.length);
    expect(d.links.length).toBeGreaterThan(0);
    expect(d.personTopics.length).toBeGreaterThan(0);
    expect(d.politician.size).toBe(POLITICIANS.length);
    expect(partyById.get("pro")?.leader).toBe("Jesse Klaver");
  });
});

describe("search", () => {
  it("finds people by surname, topics by English synonyms, and terms", async () => {
    const d = await loadMonitor();
    const idx = buildIndex(d, "nl");
    expect(search(idx, "bontenbal")[0].id).toBe("henri-bontenbal");
    expect(search(idx, "housing")[0].id).toBe("wonen");
    expect(search(idx, "motie")[0].kind).toBe("term");
    expect(search(idx, "x")).toEqual([]);
  });
});
