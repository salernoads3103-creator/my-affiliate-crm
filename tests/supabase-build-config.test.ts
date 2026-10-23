import { describe, expect, it } from "bun:test";
import { validateSupabaseBuildUrl } from "../scripts/validate-supabase-build-env.mjs";

describe("Supabase production build URL validation", () => {
  it("accepts an HTTPS project base URL with or without a trailing slash", () => {
    expect(validateSupabaseBuildUrl("https://project.supabase.co").origin).toBe(
      "https://project.supabase.co",
    );
    expect(validateSupabaseBuildUrl("https://project.supabase.co/").pathname).toBe("/");
  });

  it("accepts a valid HTTP URL for local Supabase environments", () => {
    expect(validateSupabaseBuildUrl("http://127.0.0.1:54321").hostname).toBe("127.0.0.1");
  });

  it.each([undefined, "", "   ", "project.supabase.co", "not a URL"])(
    "rejects an empty or malformed value: %s",
    (value) => {
      expect(() => validateSupabaseBuildUrl(value)).toThrow(
        "VITE_SUPABASE_URL must be a valid HTTP(S) Supabase project base URL",
      );
    },
  );

  it.each([
    "ftp://project.supabase.co",
    "https://project.supabase.co/rest/v1/",
    "https://project.supabase.co/path",
    "https://user:password@project.supabase.co",
    "https://project.supabase.co?query=1",
    "https://project.supabase.co#fragment",
  ])("rejects a non-base project URL: %s", (value) => {
    expect(() => validateSupabaseBuildUrl(value)).toThrow(
      "VITE_SUPABASE_URL must be a valid HTTP(S) Supabase project base URL",
    );
  });
});
