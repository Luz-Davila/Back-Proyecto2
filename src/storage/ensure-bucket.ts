import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_FILE_SIZE } from './bucket-config';
import { serviceHeaders } from './service-headers';

/**
 * Crea el bucket privado de imágenes si no existe.
 *
 * @returns `true` si lo creó en esta llamada y `false` si ya existía.
 */
export async function ensureBucket(
  baseUrl: string,
  serviceKey: string,
  bucket: string,
): Promise<boolean> {
  const headers = serviceHeaders(serviceKey);

  const existing = await fetch(`${baseUrl}/storage/v1/bucket/${bucket}`, { headers });
  if (existing.ok) {
    return false;
  }

  const created = await fetch(`${baseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      fileSizeLimit: MAX_IMAGE_FILE_SIZE,
      allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    }),
  });

  if (!created.ok && created.status !== 409) {
    const afterCreate = await fetch(`${baseUrl}/storage/v1/bucket/${bucket}`, { headers });
    if (afterCreate.ok) {
      return false;
    }

    const detail = await created.text().catch(() => '');
    throw new Error(`No se pudo crear el bucket ${bucket} (${created.status}): ${detail}`);
  }

  return created.ok;
}
