export function retainDatabaseBackupIds(
    existing: number[],
    next: number,
    limit = 20,
) {
    const ordered = [...new Set([...existing, next])]
        .filter(Number.isFinite)
        .sort((first, second) => second - first);

    return {
        retained: ordered.slice(0, limit),
        removed: ordered.slice(limit),
    };
}
