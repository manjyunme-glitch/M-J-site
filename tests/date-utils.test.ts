import assert from "node:assert/strict";
import test from "node:test";
import { addDays, calendarDuration, daysBetween, isValidDateOnly, nextAnnualOccurrence } from "../src/date-utils.ts";

test("calendarDuration borrows across short months without losing days", () => {
  assert.deepEqual(calendarDuration("2026-01-31", "2026-03-01"), { years: 0, months: 1, days: 1 });
});

test("calendarDuration returns zero for a future start date", () => {
  assert.deepEqual(calendarDuration("2027-12-31", "2026-07-29"), { years: 0, months: 0, days: 0 });
});

test("calendarDuration clamps leap-day anniversaries", () => {
  assert.deepEqual(calendarDuration("2024-02-29", "2025-02-28"), { years: 1, months: 0, days: 0 });
  assert.deepEqual(calendarDuration("2024-02-29", "2025-03-01"), { years: 1, months: 0, days: 1 });
});

test("nextAnnualOccurrence maps February 29 to February 28 in non-leap years", () => {
  assert.equal(nextAnnualOccurrence("2024-02-29", "2026-02-27"), "2026-02-28");
  assert.equal(nextAnnualOccurrence("2024-02-29", "2026-03-01"), "2027-02-28");
  assert.equal(nextAnnualOccurrence("2024-02-29", "2028-02-28"), "2028-02-29");
});

test("nextAnnualOccurrence never schedules before the original event", () => {
  assert.equal(nextAnnualOccurrence("2028-05-20", "2026-07-29"), "2028-05-20");
});

test("date-only helpers reject invalid calendar dates", () => {
  assert.equal(isValidDateOnly("2026-02-29"), false);
  assert.equal(daysBetween("invalid", "2026-07-29"), 0);
  assert.equal(addDays("invalid", 1), "");
});

test("addDays and daysBetween use date-only UTC arithmetic", () => {
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-29", 1), "2024-03-01");
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2);
});
