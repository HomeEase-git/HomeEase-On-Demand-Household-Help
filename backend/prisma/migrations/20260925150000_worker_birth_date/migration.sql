-- Worker date of birth for the 18+ requirement (see utils/age.ts).
ALTER TABLE "WorkerProfile" ADD COLUMN "birthDate" DATE;
