# Legacy Migration Archive

These SQL files document the pre-baseline migration history. They were previously mixed between the main and System databases, and files named `system-migration.sql` were never executed by Prisma Migrate.

Do not run this directory with `prisma migrate deploy` and do not copy these migrations back into either active `migrations/` directory.

Active histories:

- Main database: `prisma/migrations/`
- System database: `prisma/system/migrations/`

Existing databases must pass `npm run prisma:baseline:audit` before baseline adoption. Adoption is allowed only when the schema already matches the current datamodel and migration history is empty or a checksum-valid prefix of the active repository history. The tool records every missing active migration in order. Databases with unknown, failed, rolled-back, reordered, checksum-divergent, or drifted histories require a side-by-side rebuild instead of manual `migrate resolve`.
