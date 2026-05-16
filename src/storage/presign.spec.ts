import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test, expect } from "vitest";

import { presignR2ObjectUrl } from "./presign";

const golden = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "presign.spec.json"),
    "utf8",
  ),
) as {
  frozenDatetime: string;
  config: {
    S3_ENDPOINT: string;
    S3_ACCESS_KEY_ID: string;
    S3_SECRET_ACCESS_KEY: string;
    S3_BUCKET_NAME: string;
    S3_PRESIGN_TTL: string;
    KEY: string;
  };
  expectedPutPresignedUrl: string;
  expectedGetPresignedUrl: string;
};

describe("presign golden fixture", () => {
  test("PUT presigned URL matches fixture (regenerate: scripts/run.sh create-presign-spec)", async () => {
    const c = golden.config;
    const href = await presignR2ObjectUrl({
      method: "PUT",
      endpoint: c.S3_ENDPOINT,
      bucket: c.S3_BUCKET_NAME,
      key: c.KEY,
      accessKeyId: c.S3_ACCESS_KEY_ID,
      secretAccessKey: c.S3_SECRET_ACCESS_KEY,
      expiresSeconds: Number(c.S3_PRESIGN_TTL),
      datetime: golden.frozenDatetime,
    });
    expect(href).toBe(golden.expectedPutPresignedUrl);
  });

  test("GET presigned URL matches fixture (regenerate: scripts/run.sh create-presign-spec)", async () => {
    const c = golden.config;
    const href = await presignR2ObjectUrl({
      method: "GET",
      endpoint: c.S3_ENDPOINT,
      bucket: c.S3_BUCKET_NAME,
      key: c.KEY,
      accessKeyId: c.S3_ACCESS_KEY_ID,
      secretAccessKey: c.S3_SECRET_ACCESS_KEY,
      expiresSeconds: Number(c.S3_PRESIGN_TTL),
      datetime: golden.frozenDatetime,
    });
    expect(href).toBe(golden.expectedGetPresignedUrl);
  });
});
