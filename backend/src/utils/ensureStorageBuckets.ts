import {
  supabase,
  AVATAR_BUCKET,
  RESUME_BUCKET,
  BOOKING_PHOTO_BUCKET,
  CHAT_IMAGE_BUCKET,
  KYC_DOCUMENT_BUCKET,
  PROMO_BANNER_BUCKET,
} from '@config/supabase';

export const ensureStorageBuckets = async () => {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error('Failed to list Supabase storage buckets:', listError);
    return;
  }

  const existingNames = new Set((buckets ?? []).map((bucket) => bucket.name));
  const bucketVisibility: Array<[string, boolean]> = [
    [AVATAR_BUCKET, true],
    [BOOKING_PHOTO_BUCKET, true],
    [PROMO_BANNER_BUCKET, true],
    [KYC_DOCUMENT_BUCKET, false],
    [RESUME_BUCKET, false],
    [CHAT_IMAGE_BUCKET, false],
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
