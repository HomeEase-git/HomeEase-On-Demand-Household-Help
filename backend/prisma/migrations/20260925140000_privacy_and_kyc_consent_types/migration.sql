-- Separate consent records for the Privacy Notice and KYC data collection,
-- instead of relying on the Terms checkbox (Data Privacy Act §§12-13).
ALTER TYPE "ContractType" ADD VALUE 'PRIVACY_NOTICE';
ALTER TYPE "ContractType" ADD VALUE 'KYC_CONSENT';
