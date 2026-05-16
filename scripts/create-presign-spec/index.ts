/**
 * Writes the JSON file at the path from the first CLI argument (default:
 * `src/storage/presign.spec.json`) with frozen-clock presigned URLs.
 *
 * - `expected*` — canonical strings asserted by unit tests (aws4fetch / production).
 * - `referenceAwsSdk*` — same inputs via @aws-sdk/s3-request-presigner (differs on PUT
 *   because the SDK adds optional checksum / x-id query params).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { presignR2ObjectUrl } from "../../src/storage/presign.ts";

const OUT = resolve(process.argv[2] ?? "src/storage/presign.spec.json");

const FROZEN = new Date("2020-01-01T00:00:00.000Z");
const FROZEN_STR = "20200101T000000Z";

const CONFIG = {
  S3_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
  S3_ACCESS_KEY_ID: "test-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_BUCKET_NAME: "lfs-objects",
  S3_PRESIGN_TTL: "3600",
  KEY: "alice/repo/abc123def456",
} as const;

const client = new S3Client({
  region: "auto",
  endpoint: CONFIG.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: CONFIG.S3_ACCESS_KEY_ID,
    secretAccessKey: CONFIG.S3_SECRET_ACCESS_KEY,
  },
});

const signOpts = {
  expiresIn: Number(CONFIG.S3_PRESIGN_TTL),
  signingDate: FROZEN,
};

const referenceAwsSdkPut = await getSignedUrl(
  client,
  new PutObjectCommand({ Bucket: CONFIG.S3_BUCKET_NAME, Key: CONFIG.KEY }),
  signOpts,
);

const referenceAwsSdkGet = await getSignedUrl(
  client,
  new GetObjectCommand({ Bucket: CONFIG.S3_BUCKET_NAME, Key: CONFIG.KEY }),
  signOpts,
);

const expectedPutPresignedUrl = await presignR2ObjectUrl({
  method: "PUT",
  endpoint: CONFIG.S3_ENDPOINT,
  bucket: CONFIG.S3_BUCKET_NAME,
  key: CONFIG.KEY,
  accessKeyId: CONFIG.S3_ACCESS_KEY_ID,
  secretAccessKey: CONFIG.S3_SECRET_ACCESS_KEY,
  expiresSeconds: Number(CONFIG.S3_PRESIGN_TTL),
  datetime: FROZEN_STR,
});

const expectedGetPresignedUrl = await presignR2ObjectUrl({
  method: "GET",
  endpoint: CONFIG.S3_ENDPOINT,
  bucket: CONFIG.S3_BUCKET_NAME,
  key: CONFIG.KEY,
  accessKeyId: CONFIG.S3_ACCESS_KEY_ID,
  secretAccessKey: CONFIG.S3_SECRET_ACCESS_KEY,
  expiresSeconds: Number(CONFIG.S3_PRESIGN_TTL),
  datetime: FROZEN_STR,
});

if (referenceAwsSdkGet.trim() !== expectedGetPresignedUrl.trim()) {
  console.warn(
    "Note: GET presign differs between AWS SDK and aws4fetch — inspect fixture:\n",
    referenceAwsSdkGet,
    "\nvs\n",
    expectedGetPresignedUrl,
  );
}

const payload = {
  description:
    "expected* = production presign (aws4fetch). referenceAwsSdk* = @aws-sdk/s3-request-presigner for the same frozen clock (PUT may differ due to SDK checksum middleware).",
  frozenDatetime: FROZEN_STR,
  config: CONFIG,
  expectedPutPresignedUrl,
  expectedGetPresignedUrl,
  referenceAwsSdkPutPresignedUrl: referenceAwsSdkPut.trim(),
  referenceAwsSdkGetPresignedUrl: referenceAwsSdkGet.trim(),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log("Wrote", OUT);
