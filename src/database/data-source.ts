import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from './database.options';

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error('DATABASE_URL no está definida. Revisa el archivo .env de la raíz.');
}

export default new DataSource(buildDatabaseOptions(url, process.env.DATABASE_SSL === 'true'));
