import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import { dirname, join, resolve, sep } from 'path';

type Driver = 's3' | 'local';

/**
 * Document blob storage.
 *
 * Two drivers share one interface:
 *  - "s3"    — MinIO or any S3-compatible bucket (production).
 *  - "local" — files on disk under STORAGE_LOCAL_DIR (local dev without Docker).
 *
 * With STORAGE_DRIVER=auto (the default) the service probes S3 at boot and falls
 * back to local disk when the bucket is unreachable, so uploads keep working on a
 * laptop with no MinIO running instead of failing at the moment a user drops a file.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly configuredDriver: string;
  private readonly localDir: string;
  private driver: Driver = 's3';

  constructor(private config: ConfigService) {
    this.bucket = config.get<string>('s3.bucket')!;
    this.configuredDriver = config.get<string>('storage.driver') ?? 'auto';
    this.localDir = resolve(
      process.cwd(),
      config.get<string>('storage.localDir') ?? '.storage',
    );
    this.s3 = new S3Client({
      endpoint: config.get<string>('s3.endpoint'),
      region: config.get<string>('s3.region'),
      credentials: {
        accessKeyId: config.get<string>('s3.accessKey')!,
        secretAccessKey: config.get<string>('s3.secretKey')!,
      },
      forcePathStyle: true, // required for MinIO
    });
  }

  async onModuleInit() {
    if (this.configuredDriver === 'local') {
      await this.useLocal('STORAGE_DRIVER=local');
      return;
    }

    const reachable = await this.ensureBucketExists();
    if (reachable) {
      this.driver = 's3';
      this.logger.log(`Storage driver: s3 (bucket "${this.bucket}")`);
      return;
    }

    if (this.configuredDriver === 's3') {
      // Explicitly configured for S3 — surface the problem rather than silently
      // writing documents somewhere the rest of the deployment cannot read.
      this.logger.error(
        `STORAGE_DRIVER=s3 but bucket "${this.bucket}" is unreachable. Uploads will fail.`,
      );
      return;
    }

    await this.useLocal(`S3 bucket "${this.bucket}" unreachable`);
  }

  private async useLocal(reason: string): Promise<void> {
    this.driver = 'local';
    await fs.mkdir(this.localDir, { recursive: true });
    this.logger.warn(`Storage driver: local (${reason}) — files under ${this.localDir}`);
  }

  /** @returns true when the bucket exists (or was created) and is usable. */
  private async ensureBucketExists(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket: ${this.bucket}`);
        return true;
      } catch {
        return false;
      }
    }
  }

  /** Guards against a key like "../../etc/passwd" escaping the storage root. */
  private localPath(key: string): string {
    const full = resolve(this.localDir, key);
    if (full !== this.localDir && !full.startsWith(this.localDir + sep)) {
      throw new NotFoundException('Invalid storage key.');
    }
    return full;
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    if (this.driver === 'local') {
      const path = this.localPath(key);
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, buffer);
      return;
    }

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  /**
   * A time-limited URL the browser can open directly (an <img>/<iframe> cannot send
   * an Authorization header). S3 signs its own; the local driver gets an equivalent
   * HMAC-signed link to the API's streaming route.
   */
  async presignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (this.driver === 'local') {
      const apiUrl = this.config.get<string>('urls.api') ?? 'http://localhost:3001';
      const expires = Date.now() + expiresInSeconds * 1000;
      const sig = this.signKey(key, expires);
      return (
        `${apiUrl}/api/v1/documents/file?key=${encodeURIComponent(key)}` +
        `&expires=${expires}&sig=${sig}`
      );
    }

    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  private signingSecret(): string {
    return this.config.get<string>('jwt.accessSecret') ?? 'dev-access-secret';
  }

  private signKey(key: string, expires: number): string {
    return createHmac('sha256', this.signingSecret())
      .update(`${key}:${expires}`)
      .digest('hex');
  }

  /** Constant-time check of a local-storage download link. */
  verifySignature(key: string, expires: number, sig: string): boolean {
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = this.signKey(key, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async download(key: string): Promise<Buffer> {
    if (this.driver === 'local') {
      try {
        return await fs.readFile(this.localPath(key));
      } catch {
        throw new NotFoundException(`Stored file "${key}" not found.`);
      }
    }

    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  async exists(key: string): Promise<boolean> {
    if (this.driver === 'local') {
      try {
        await fs.access(this.localPath(key));
        return true;
      } catch {
        return false;
      }
    }

    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Local-disk root, exposed for the file-streaming route. */
  get isLocal(): boolean {
    return this.driver === 'local';
  }

  get root(): string {
    return join(this.localDir);
  }
}
