import { describe, test, expect } from "vitest";
import { parseGithubList, ownersFromEnv } from "./utils";

describe("parseGithubList", () => {
  test("returns empty array for undefined", () => {
    expect(parseGithubList(undefined)).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(parseGithubList("")).toEqual([]);
  });

  test("returns empty array for whitespace-only string", () => {
    expect(parseGithubList("   ")).toEqual([]);
  });

  test("splits on comma", () => {
    expect(parseGithubList("foo,bar")).toEqual(["foo", "bar"]);
  });

  test("splits on semicolon", () => {
    expect(parseGithubList("foo;bar")).toEqual(["foo", "bar"]);
  });

  test("splits on space", () => {
    expect(parseGithubList("foo bar")).toEqual(["foo", "bar"]);
  });

  test("collapses consecutive separators", () => {
    expect(parseGithubList("foo,,; bar")).toEqual(["foo", "bar"]);
  });

  test("trims leading and trailing separators", () => {
    expect(parseGithubList(" foo ")).toEqual(["foo"]);
  });

  test("handles mixed separators", () => {
    expect(parseGithubList("alice,bob; carol")).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });
});

describe("ownersFromEnv", () => {
  test("GITHUB_ORGS and GITHUB_ORG are merged", () => {
    const result = ownersFromEnv({ GITHUB_ORGS: "foo bar", GITHUB_ORG: "baz" });
    expect(result).toEqual(new Set(["foo", "bar", "baz"]));
  });

  test("GITHUB_ORG alone", () => {
    const result = ownersFromEnv({ GITHUB_ORG: "MyOrg" });
    expect(result).toEqual(new Set(["MyOrg"]));
  });

  test("GITHUB_ORGS with two entries produces two-entry set", () => {
    const result = ownersFromEnv({ GITHUB_ORGS: "foo bar" });
    expect(result).toEqual(new Set(["foo", "bar"]));
  });

  test("GITHUB_USER fallback when no orgs set", () => {
    const result = ownersFromEnv({ GITHUB_USER: "pasha" });
    expect(result).toEqual(new Set(["pasha"]));
  });

  test("names preserve original case (callers lowercase before comparing)", () => {
    const result = ownersFromEnv({ GITHUB_ORG: "MyOrg" });
    expect(result.has("MyOrg")).toBe(true);
    expect(result.has("myorg")).toBe(false);
  });

  test("throws when nothing configured", () => {
    expect(() => ownersFromEnv({})).toThrow();
  });

  test("throws when GITHUB_ORG is whitespace-only and no user", () => {
    expect(() => ownersFromEnv({ GITHUB_ORG: "   " })).toThrow();
  });

  test("all vars empty still throws", () => {
    expect(() => ownersFromEnv({ GITHUB_ORGS: "", GITHUB_ORG: "", GITHUB_USER: "" })).toThrow();
  });
});
