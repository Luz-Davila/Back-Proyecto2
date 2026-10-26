import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_BUCKET } from './bucket-config';
import { ensureBucket } from './ensure-bucket';
import { serviceHeaders } from './service-headers';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('SUPABASE_URL').replace(/\/+$/, '');
    this.serviceKey = config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    this.bucket = config.get<string>('SUPABASE_STORAGE_BUCKET') || DEFAULT_BUCKET;
  }

  async onModuleInit(): Promise<void> {
    if (!this.serviceKey) {
      this.logger.warn('SUPABASE_SERVICE_ROLE_KEY no está definida: la carga de imágenes fallará');
      return;
    }

    try {
      const created = await this.prepareBucket();
      if (created) {
        this.logger.log(`Bucket ${this.bucket} creado`);
      }
    } catch (error) {
      this.logger.warn(`No se pudo preparar el bucket de imágenes: ${(error as Error).message}`);
    }
  }

  async upload(path: string, body: Buffer, contentType: string): Promise<void> {
    await this.prepareBucket();

    const response = await this.request(`/storage/v1/object/${this.bucket}/${encodePath(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      body: new Uint8Array(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new InternalServerErrorException(
        `No se pudo subir la imagen (${response.status}): ${detail}`,
      );
    }
  }

  async remove(path: string): Promise<void> {
    const response = await this.request(`/storage/v1/object/${this.bucket}/${encodePath(path)}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      this.logger.warn(`No se pudo borrar la imagen ${path} (${response.status})`);
    }
  }

  async signedUrl(path: string, expiresInSeconds = 600): Promise<string> {
    const response = await this.request(
      `/storage/v1/object/sign/${this.bucket}/${encodePath(path)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new InternalServerErrorException(
        `No se pudo firmar la imagen (${response.status}): ${detail}`,
      );
    }

    const { signedURL } = (await response.json()) as { signedURL: string };
    return `${this.baseUrl}/storage/v1${signedURL}`;
  }

  private async prepareBucket(): Promise<boolean> {
    if (this.bucketReady) {
      return false;
    }
    if (!this.serviceKey) {
      throw new InternalServerErrorException('El almacenamiento de imágenes no está configurado');
    }

    const created = await ensureBucket(this.baseUrl, this.serviceKey, this.bucket);
    this.bucketReady = true;
    return created;
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    if (!this.serviceKey) {
      throw new InternalServerErrorException('El almacenamiento de imágenes no está configurado');
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...serviceHeaders(this.serviceKey), ...init.headers },
    });
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
