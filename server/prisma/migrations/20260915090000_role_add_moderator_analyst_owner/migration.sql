-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'moderator' AFTER 'editor';
ALTER TYPE "Role" ADD VALUE 'analyst' AFTER 'moderator';
ALTER TYPE "Role" ADD VALUE 'owner' AFTER 'admin';
