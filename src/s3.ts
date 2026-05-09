import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface S3Env {
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_BUCKET_NAME: string;
}

function s3Client(env: S3Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export function presignUpload(env: S3Env, key: string, ttl = 3600): Promise<string> {
  return getSignedUrl(
    s3Client(env),
    new PutObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }),
    { expiresIn: ttl },
  );
}

export function presignDownload(env: S3Env, key: string, ttl = 3600): Promise<string> {
  return getSignedUrl(
    s3Client(env),
    new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }),
    { expiresIn: ttl },
  );
}
