import { presignR2ObjectUrl } from "./presign";

export interface ObjectsStorageEnv {
  LFS_BUCKET: R2Bucket;
  S3_ENDPOINT: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_BUCKET_NAME: string;
  S3_PRESIGN_TTL: string;
  LFS_BUCKET?: R2Bucket;
}

export class ObjectsStorage {
  private readonly env: ObjectsStorageEnv;

  constructor(env: ObjectsStorageEnv) {
    this.env = env;
  }

  async presignUpload(
    key: string,
    verifyHref: string,
  ): Promise<
    | { actions: { upload: { href: string }; verify: { href: string } } }
    | Record<string, never>
  > {
    if (!("message" in (await this.verifyObject(key)))) return {};
    const href = await this.presignedObjectUrl("PUT", key);
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
    const href = await this.presignedObjectUrl("GET", key);
    return { actions: { download: { href } } };
  }

  async verifyObject(
    key: string,
    size?: number,
  ): Promise<Record<string, never> | { message: string }> {
    const obj = await this.env.LFS_BUCKET.head(key);
    if (!obj) return { message: "Object not found" };
    if (size !== undefined && size !== obj.size)
      return { message: "Object size mismatch" };
    return {};
  }

  private presignedObjectUrl(method: "GET" | "PUT", key: string): Promise<string> {
    return presignR2ObjectUrl({
      method,
      endpoint: this.env.S3_ENDPOINT,
      bucket: this.env.S3_BUCKET_NAME,
      key,
      accessKeyId: this.env.S3_ACCESS_KEY_ID,
      secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
      expiresSeconds: Number(this.env.S3_PRESIGN_TTL),
    });
  }
}
