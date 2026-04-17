-- CreateEnum
CREATE TYPE "ProjectCreationMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "creationMode" "ProjectCreationMode" NOT NULL DEFAULT 'AUTO';
