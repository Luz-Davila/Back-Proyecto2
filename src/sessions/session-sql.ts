import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/** Only trusted TypeORM metadata becomes SQL identifiers; values stay parameters. */
export function sessionTable<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
): string {
  const metadata = manager.connection.getMetadata(entity);
  return [metadata.schema, metadata.tableName]
    .filter((part): part is string => !!part)
    .map((part) => manager.connection.driver.escape(part))
    .join('.');
}
