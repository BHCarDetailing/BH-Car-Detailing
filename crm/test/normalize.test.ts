import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, cleanName, vehicleSizeClass } from "../src/lib/normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => expect(normalizeEmail("  Bob@Email.COM ")).toBe("bob@email.com"));
  it("rejects non-emails", () => expect(normalizeEmail("not-an-email")).toBeNull());
  it("passes empty through as null", () => expect(normalizeEmail("")).toBeNull());
});

describe("normalizePhone", () => {
  it("US 10-digit gets +1", () => expect(normalizePhone("(917) 783-1038")).toBe("+19177831038"));
  it("11-digit with 1 keeps it", () => expect(normalizePhone("1 917 783 1038")).toBe("+19177831038"));
  it("international with + kept as digits", () => expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958"));
  it("garbage is null", () => expect(normalizePhone("123")).toBeNull());
});

describe("cleanName", () => {
  it("collapses whitespace", () => expect(cleanName("  Jorge   Zurita ")).toBe("Jorge Zurita"));
  it("title-cases ALLCAPS", () => expect(cleanName("JORGE ZURITA")).toBe("Jorge Zurita"));
  it("leaves mixed case alone", () => expect(cleanName("Dvori Rosenfeld")).toBe("Dvori Rosenfeld"));
});

describe("vehicleSizeClass — the site's exact select options", () => {
  it("maps sedan option", () => expect(vehicleSizeClass("Sedan / Coupe / Convertible")).toBe("sedan"));
  it("maps suv option", () => expect(vehicleSizeClass("SUV / Truck")).toBe("suv"));
  it("maps exotic option", () => expect(vehicleSizeClass("Exotic / Luxury")).toBe("exotic"));
  it("unknown is other", () => expect(vehicleSizeClass("boat")).toBe("other"));
});
