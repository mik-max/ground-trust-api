-- Drop the "newcomer" value from the Role enum. Standard Postgres pattern
-- for removing an enum value (no direct ALTER TYPE ... DROP VALUE exists):
-- recreate the type without it, repoint the column, swap names, drop the old type.
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('resident', 'government', 'admin');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
COMMIT;
