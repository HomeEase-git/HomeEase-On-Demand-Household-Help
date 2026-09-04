import {
  supabase,
  AVATAR_BUCKET,
  RESUME_BUCKET,
  BOOKING_PHOTO_BUCKET,
  CHAT_IMAGE_BUCKET,
  KYC_DOCUMENT_BUCKET,
  TAX_CERTIFICATE_BUCKET,
} from '@config/supabase';

/**
 * Creates every Supabase Storage bucket this app reads/writes if it doesn't
 * already exist, so a fresh environment doesn't need a manual dashboard
 * setup step.
 *
 * kyc-documents is created public (not signed-URL private, unlike
 * tax-certificates) to match how the app actually reads it —
 * uploadController.ts and verificationController.ts both call
 * .getPublicUrl() on it, never .createSignedUrl(). That's a pre-existing
 * design choice (worth reconsidering separately, since it means a leaked
 * URL exposes a government ID with no expiry) — not something to silently
 * change here, since doing so would break every existing KYC document URL.
 */
export const ensureStorageBuckets = async () => {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error('Failed to list Supabase storage buckets:', listError);
    return;
  }

  const existingNames = new Set((buckets ?? []).map((bucket) => bucket.name));
  const publicBuckets = [AVATAR_BUCKET, RESUME_BUCKET, BOOKING_PHOTO_BUCKET, CHAT_IMAGE_BUCKET, KYC_DOCUMENT_BUCKET];

  for (const bucketName of publicBuckets) {
    if (existingNames.has(bucketName)) {
      continue;
    }

    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: true,
    });

    if (createError) {
      console.error(`Failed to create Supabase storage bucket "${bucketName}":`, createError);
    } else {
      console.log(`Created Supabase storage bucket "${bucketName}"`);
    }
  }

  if (!existingNames.has(TAX_CERTIFICATE_BUCKET)) {
    // Private — contains worker TINs and income figures, served only via
    // short-lived signed URLs (see taxCertificateService).
    const { error: createError } = await supabase.storage.createBucket(TAX_CERTIFICATE_BUCKET, {
      public: false,
    });

    if (createError) {
      console.error(`Failed to create Supabase storage bucket "${TAX_CERTIFICATE_BUCKET}":`, createError);
    } else {
      console.log(`Created Supabase storage bucket "${TAX_CERTIFICATE_BUCKET}"`);
    }
  }
};
