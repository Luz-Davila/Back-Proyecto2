const REQUIRED_VARIABLES = ['DATABASE_URL'] as const;

export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED_VARIABLES.filter((name) => !config[name]);

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }

  return config;
}
