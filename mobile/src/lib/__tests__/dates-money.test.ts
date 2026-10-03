import {addDays, addMonths, dayDiff, longDate, niceDate, ord} from "../dates";
import {money, parseAmount, splitPounds} from "../money";

describe("dates", () => {
  test("adding days and months crosses month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  test("dayDiff ignores clock changes", () => {
    expect(dayDiff("2026-10-24", "2026-10-26")).toBe(2);   // UK clocks go back on 25 Oct
    expect(dayDiff("2026-10-05", "2026-10-30")).toBe(25);
  });
  test("dates read the same on every device", () => {
    expect(niceDate("2026-10-03")).toBe("Sat 3 Oct");
    expect(longDate("2026-10-03")).toBe("Sat 3 October");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ord)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });
});

describe("money", () => {
  test("whole pounds drop the pence, others keep two places", () => {
    expect(money(1250)).toBe("£1,250");
    expect(money(12.5)).toBe("£12.50");
    expect(money(1234567.891)).toBe("£1,234,567.89");
    expect(money(0.1 + 0.2)).toBe("£0.30");
  });
  test("negatives use a real minus sign, positives can show a plus", () => {
    expect(money(-40)).toBe("−£40");
    expect(money(5, true)).toBe("+£5");
    expect(money(0, true)).toBe("£0");
  });
  test("splitPounds gives the big number its parts", () => {
    expect(splitPounds(1234.5)).toEqual({whole: "1,234", pence: "50"});
    expect(splitPounds(-16)).toEqual({whole: "16", pence: "00"});
  });
  test("parseAmount reads what people type", () => {
    expect(parseAmount("£1,250.50")).toBe(1250.5);
    expect(parseAmount(" 12 ")).toBe(12);
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("")).toBeNaN();
  });
});
