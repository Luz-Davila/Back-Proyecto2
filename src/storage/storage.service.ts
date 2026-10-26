import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_BUCKET = 'question-images';
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
      await this.ensureBucket();
    } catch (error) {
      this.logger.warn(`No se pudo preparar el bucket de imágenes: ${(error as Error).message}`);
    }
  }

  async upload(path: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();

    const response = await this.request(
      `/storage/v1/object/${this.bucket}/${encodePath(path)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
        body: new Uint8Array(body),
      },
    );

    if (!response.ok) {
      throw new InternalServerErrorException(`No se pudo subir la imagen (${response.status})`);
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
      throw new InternalServerErrorException(`No se pudo firmar la imagen (${response.status})`);
    }

    const { signedURL } = (await response.json()) as { signedURL: string };
    return `${this.baseUrl}/storage/v1${signedURL}`;
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) {
      return;
    }
    if (!this.serviceKey) {
      throw new InternalServerErrorException('El almacenamiento de imágenes no está configurado');
    }

    const exists = await this.request(`/storage/v1/bucket/${this.bucket}`, { method: 'GET' });
    if (exists.status === 200) {
      this.bucketReady = true;
      return;
    }

    const created = await this.request('/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: this.bucket,
        name: this.bucket,
        public: false,
        fileSizeLimit: MAX_FILE_SIZE,
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      }),
    });

    if (!created.ok && created.status !== 409) {
      throw new InternalServerErrorException(
        `No se pudo crear el bucket ${this.bucket} (${created.status})`,
      );
    }

    this.bucketReady = true;
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    if (!this.serviceKey) {
      throw new InternalServerErrorException('El almacenamiento de imágenes no está configurado');
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.serviceKey}`, ...init.headers },
    });
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
