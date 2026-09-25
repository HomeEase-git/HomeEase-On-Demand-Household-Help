import {
  supabase,
  AVATAR_BUCKET,
  RESUME_BUCKET,
  BOOKING_PHOTO_BUCKET,
  CHAT_IMAGE_BUCKET,
  KYC_DOCUMENT_BUCKET,
  TAX_CERTIFICATE_BUCKET,
  PROMO_BANNER_BUCKET,
} from '@config/supabase';

/**
 * Creates every Supabase Storage bucket this app reads/writes if it doesn't
 * already exist, so a fresh environment doesn't need a manual dashboard
 * setup step.
 *
 * kyc-documents, resumes and chat-images are private: they hold government
 * IDs, NBI clearances, selfies, resumes and in-home photos, so objects are
 * only ever served as short-lived signed URLs (see utils/storageUrls.ts and
 * middleware/signStorageUrls.ts). This only affects newly created buckets —
 * an existing public bucket must be switched to private in the Supabase
 * dashboard, AFTER the backend that signs URLs is deployed.
 */
export const ensureStorageBuckets = async () => {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error('Failed to list Supabase storage buckets:', listError);
    return;
  }

  const existingNames = new Set((buckets ?? []).map((bucket) => bucket.name));
  // Private buckets (tax certificates carry TINs and income figures) are
  // served only via short-lived signed URLs.
  const bucketVisibility: Array<[string, boolean]> = [
    [AVATAR_BUCKET, true],
    [BOOKING_PHOTO_BUCKET, true],
    [PROMO_BANNER_BUCKET, true],
    [KYC_DOCUMENT_BUCKET, false],
    [RESUME_BUCKET, false],
    [CHAT_IMAGE_BUCKET, false],
    [TAX_CERTIFICATE_BUCKET, false],
  ];

  for (const [bucketName, isPublic] of bucketVisibility) {
    if (existingNames.has(bucketName)) {
      continue;
    }

    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: isPublic,
    });

    if (createError) {
      console.error(`Failed to create Supabase storage bucket "${bucketName}":`, createError);
    } else {
      console.log(`Created Supabase storage bucket "${bucketName}"`);
    }
  }
};
