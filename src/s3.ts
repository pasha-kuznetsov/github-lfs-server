import { MiddlewareHandler } from "hono";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface S3Env {
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_BUCKET_NAME: string;
  S3_PRESIGN_TTL: string;
}

export class S3Bucket {
  private readonly env: S3Env;
  private readonly client: S3Client;

  constructor(env: S3Env) {
    this.env = env;
    this.client = new S3Client({
      region: "auto",
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async presignUpload(
    key: string,
    verifyHref: string,
  ): Promise<
    | { actions: { upload: { href: string }; verify: { href: string } } }
    | Record<string, never>
  > {
    if (!("message" in (await this.verifyObject(key)))) return {};
    const href = await this.presignCommand(
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET_NAME, Key: key }),
    );
    return { actions: { upload: { href }, verify: { href: verifyHref } } };
  }

  async presignDownload(
    key: string,
  ): Promise<
    | { actions: { download: { href: string } } }
    | { error: { code: number; message: string } }
  > {
    const info = await this.verifyObject(key);
    if ("message" in info)
      return { error: { code: 404, message: info.message } };
    const href = await this.presignCommand(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET_NAME, Key: key }),
    );
    return { actions: { download: { href } } };
  }

  async verifyObject(
    key: string,
    size?: number,
  ): Promise<Record<string, never> | { message: string }> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.env.S3_BUCKET_NAME, Key: key }),
      );
      if (size !== undefined && size !== (res.ContentLength ?? 0))
        return { message: "Object size mismatch" };
      return {};
    } catch {
      return { message: "Object not found" };
    }
  }

  presignCommand(command: any): Promise<string> {
    return getSignedUrl(this.client, command, {
      expiresIn: Number(this.env.S3_PRESIGN_TTL),
    });
  }
}
