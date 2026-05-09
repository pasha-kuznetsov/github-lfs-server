import { describe, test, expect } from "bun:test";
import { presignDownload, presignUpload } from "../src/s3";

const ENV = {
  S3_ENDPOINT:          "https://test-account.r2.cloudflarestorage.com",
  S3_ACCESS_KEY_ID:     "test-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_BUCKET_NAME:          "lfs-objects",
};

const KEY = "alice/repo/abc123def456";

// Parse a presigned URL into its structural parts.
function parse(raw: string) {
  const url = new URL(raw);
  return {
    protocol: url.protocol,
    host:     url.host,
    pathname: url.pathname,
    params:   url.searchParams,
  };
}

// ---------------------------------------------------------------------------

describe("presignUpload", () => {
  test("returns an HTTPS URL", async () => {
    const url = await presignUpload(ENV, KEY);
    expect(parse(url).protocol).toBe("https:");
  });

  test("targets the R2 endpoint for the configured account", async () => {
    const url = await presignUpload(ENV, KEY);
    expect(parse(url).host).toBe("test-account.r2.cloudflarestorage.com");
  });

  test("path contains bucket name then key", async () => {
    const url = await presignUpload(ENV, KEY);
    expect(parse(url).pathname).toBe("/lfs-objects/alice/repo/abc123def456");
  });

  test("uses AWS Signature Version 4", async () => {
    const url = await presignUpload(ENV, KEY);
    expect(parse(url).params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  });

  test("X-Amz-Expires matches the default TTL (3600)", async () => {
    const url = await presignUpload(ENV, KEY);
    expect(parse(url).params.get("X-Amz-Expires")).toBe("3600");
  });

  test("respects a custom TTL", async () => {
    const url = await presignUpload(ENV, KEY, 900);
    expect(parse(url).params.get("X-Amz-Expires")).toBe("900");
  });

  test("credential contains the configured access key ID", async () => {
    const url = await presignUpload(ENV, KEY);
    const credential = parse(url).params.get("X-Amz-Credential") ?? "";
    expect(credential).toMatch(/^test-key-id\//);
  });
});

// ---------------------------------------------------------------------------

describe("presignDownload", () => {
  test("returns an HTTPS URL", async () => {
    const url = await presignDownload(ENV, KEY);
    expect(parse(url).protocol).toBe("https:");
  });

  test("targets the R2 endpoint for the configured account", async () => {
    const url = await presignDownload(ENV, KEY);
    expect(parse(url).host).toBe("test-account.r2.cloudflarestorage.com");
  });

  test("path contains bucket name then key", async () => {
    const url = await presignDownload(ENV, KEY);
    expect(parse(url).pathname).toBe("/lfs-objects/alice/repo/abc123def456");
  });

  test("uses AWS Signature Version 4", async () => {
    const url = await presignDownload(ENV, KEY);
    expect(parse(url).params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  });

  test("X-Amz-Expires matches the default TTL (3600)", async () => {
    const url = await presignDownload(ENV, KEY);
    expect(parse(url).params.get("X-Amz-Expires")).toBe("3600");
  });

  test("respects a custom TTL", async () => {
    const url = await presignDownload(ENV, KEY, 7200);
    expect(parse(url).params.get("X-Amz-Expires")).toBe("7200");
  });

  test("credential contains the configured access key ID", async () => {
    const url = await presignDownload(ENV, KEY);
    const credential = parse(url).params.get("X-Amz-Credential") ?? "";
    expect(credential).toMatch(/^test-key-id\//);
  });
});

// ---------------------------------------------------------------------------

describe("presignUpload vs presignDownload", () => {
  test("produce different signatures for the same key", async () => {
    const [up, down] = await Promise.all([
      presignUpload(ENV, KEY),
      presignDownload(ENV, KEY),
    ]);
    expect(parse(up).params.get("X-Amz-Signature")).not.toBe(
      parse(down).params.get("X-Amz-Signature"),
    );
  });
});
