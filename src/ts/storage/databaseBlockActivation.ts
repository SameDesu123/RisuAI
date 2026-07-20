export function applyDatabaseBlockStorageDefault<T extends { databaseBlockStorage?: boolean }>(
    database: T,
): T & { databaseBlockStorage: boolean } {
    database.databaseBlockStorage ??= true;
    return database as T & { databaseBlockStorage: boolean };
}
