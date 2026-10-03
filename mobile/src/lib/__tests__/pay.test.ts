import {perPayday, takeHome, yearlyTakeHome} from "../pay";

test("take-home below the allowance is the whole amount", () => {
  expect(takeHome(10000)).toBe(10000);
});

test("basic rate: 20% tax and 8% NI above £12,570", () => {
  // 30,000: tax 3,486, NI 1,394.40
  expect(takeHome(30000)).toBe(25119.6);
});

test("higher rate: 40% above £50,270, NI drops to 2%", () => {
  // 60,000: tax 7,540 + 3,892 = 11,432; NI 3,016 + 194.60 = 3,210.60
  expect(takeHome(60000)).toBe(45357.4);
});

test("the allowance tapers away above £100,000", () => {
  // 125,140: no allowance; tax 7,540 + 87,440 × 40% = 42,516; NI 3,016 + 1,497.40 = 4,513.40
  expect(takeHome(125140)).toBe(78110.6);
});

test("hourly is rate × hours × 52, before tax", () => {
  expect(yearlyTakeHome("hour", 12.5, 37.5)).toBe(takeHome(24375));
});

test("week and month are already take-home", () => {
  expect(yearlyTakeHome("week", 400)).toBe(20800);
  expect(yearlyTakeHome("month", 1800)).toBe(21600);
});

test("split over the paydays in a year", () => {
  expect(perPayday(20800, "monthly-lastworking")).toBe(1733.33);
  expect(perPayday(20800, "fourweekly")).toBe(1600);
  expect(perPayday(20800, "weekly")).toBe(400);
});
