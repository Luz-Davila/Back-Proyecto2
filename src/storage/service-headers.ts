/**
 * Encabezados para llamar a Supabase con la clave de servicio.
 *
 * Las claves nuevas (`sb_secret_...`) no son JWT y deben viajar en `apikey`;
 * el gateway de Supabase las traduce al JWT de service_role. Las claves
 * heredadas sí son JWT y además necesitan `Authorization`.
 */
export function serviceHeaders(serviceKey: string): Record<string, string> {
  if (serviceKey.startsWith('eyJ')) {
    return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  }

  return { apikey: serviceKey };
}
