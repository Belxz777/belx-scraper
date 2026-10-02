
import { describe, expect, test } from "bun:test";

import {
  normalizeGroup,
  isGroupName,
  isDateArg,
  extractScheduleUrl,
  parseScheduleArgs,
} from "../../src/bot/schedule-args";

describe("normalizeGroup", () => {
  test("normalizes case and whitespace", () => {
    expect(normalizeGroup("  и-26-1  ")).toBe("И-26-1");
    expect(normalizeGroup("И-26-1")).toBe("И-26-1");
  });

  test("collapses repeated whitespace", () => {
    expect(normalizeGroup("  и-26-1   ")).toBe("И-26-1");
  });
});

describe("isGroupName", () => {
  test.each([
    "И-26-1",
    "ПР-25-2",
    "ИС-24-10",
    "И-26-1-2",
    "и-26-1",
  ])("accepts valid group %s", (group) => {
    expect(isGroupName(group)).toBe(true);
  });

  test.each([
    "",
    "И",
    "И-2-1",
    "И-26",
    "И-26-ABC",
    "ИПЭК-26-1",
    "И-26-1-2-3",
  ])("rejects invalid group %s", (group) => {
    expect(isGroupName(group)).toBe(false);
  });
});

describe("isDateArg", () => {
  test.each(["today", "tomorrow", "yesterday"])(
    "accepts relative date %s",
    (date) => {
      expect(isDateArg(date)).toBe(true);
    },
  );

  test.each(["23.09", "1.1", "23.09.2026", "1.1.2026"])(
    "accepts date %s",
    (date) => {
      expect(isDateArg(date)).toBe(true);
    },
  );

  test.each(["", "23/09", "tomorrow!", "2026-09-23", "abc"])(
    "rejects invalid date argument %s",
    (date) => {
      expect(isDateArg(date)).toBe(false);
    },
  );
});

describe("extractScheduleUrl", () => {
  test("extracts an HTTPS schedule URL", () => {
    expect(
      extractScheduleUrl(
        "https://www.pilot-ipek.ru/raspo/23%20сентября",
      ),
    ).toBe("https://www.pilot-ipek.ru/raspo/23%20сентября");
  });

  test("accepts a URL without a protocol", () => {
    expect(
      extractScheduleUrl("pilot-ipek.ru/raspo/23%20сентября"),
    ).toBe("pilot-ipek.ru/raspo/23%20сентября");
  });

  test("returns null when no URL is present", () => {
    expect(extractScheduleUrl("И-26-1 tomorrow")).toBeNull();
  });

  test("preserves a combined Friday/Saturday URL", () => {
    const url =
      "https://www.pilot-ipek.ru/raspo/25,%2026%20сентября";

    expect(extractScheduleUrl(url)).toBe(url);
  });
});

describe("parseScheduleArgs", () => {
  test("uses today by default", () => {
    expect(parseScheduleArgs("", null)).toEqual({
      group: null,
      dateArg: "today",
      image: false,
    });
  });

  test("parses a group", () => {
    expect(parseScheduleArgs("И-26-1", null)).toEqual({
      group: "И-26-1",
      dateArg: "today",
      image: false,
    });
  });

  test("parses group and date", () => {
    expect(parseScheduleArgs("И-26-1 tomorrow", null)).toEqual({
      group: "И-26-1",
      dateArg: "tomorrow",
      image: false,
    });
  });

  test("supports date before group", () => {
    expect(parseScheduleArgs("tomorrow И-26-1", null)).toEqual({
      group: "И-26-1",
      dateArg: "tomorrow",
      image: false,
    });
  });

  test("uses the saved group when none is specified", () => {
    expect(parseScheduleArgs("tomorrow", "и-26-1")).toEqual({
      group: "И-26-1",
      dateArg: "tomorrow",
      image: false,
    });
  });

  test("allows overriding the saved group", () => {
    expect(parseScheduleArgs("ПР-25-2", "И-26-1").group).toBe(
      "ПР-25-2",
    );
  });

  test("parses image aliases", () => {
    for (const alias of ["image", "img", "photo", "pic", "фото"]) {
      expect(parseScheduleArgs(`И-26-1 ${alias}`, null).image).toBe(
        true,
      );
    }
  });

  test("supports a date and image together", () => {
    expect(parseScheduleArgs("23.09 image И-26-1", null)).toEqual({
      group: "И-26-1",
      dateArg: "23.09",
      image: true,
    });
  });

  test("uses a URL as the date argument", () => {
    const url = "https://www.pilot-ipek.ru/raspo/23%20сентября";

    expect(parseScheduleArgs(url, "И-26-1")).toEqual({
      group: "И-26-1",
      dateArg: url,
      image: false,
    });
  });

  test("normalizes whitespace in input", () => {
    expect(parseScheduleArgs("  и-26-1   tomorrow  ", null)).toEqual({
      group: "И-26-1",
      dateArg: "tomorrow",
      image: false,
    });
  });
});