import { describe, expect, test } from "vitest";
import { clientIp } from "../src/client-ip.js";

describe("clientIp", () => {
  test("nimmt den letzten Eintrag, den der Edge-Caddy gesetzt hat", () => {
    expect(clientIp("203.0.113.9")).toBe("203.0.113.9");
    expect(clientIp("198.51.100.1, 203.0.113.9")).toBe("203.0.113.9");
    expect(clientIp("198.51.100.1,  203.0.113.9 ")).toBe("203.0.113.9");
  });
  test("ohne Header oder ohne Adresse gibt es keine", () => {
    expect(clientIp(undefined)).toBeUndefined();
    expect(clientIp(null)).toBeUndefined();
    expect(clientIp("")).toBeUndefined();
    expect(clientIp("198.51.100.1, ")).toBeUndefined();
  });
});
