import { supabase, AVATAR_BUCKET, RESUME_BUCKET } from '@config/supabase';

/**
 * Creates the avatars/resumes Supabase Storage buckets if they don't already
 * exist, so this feature doesn't require a manual dashboard setup step.
 * chat-images and kyc-documents are provisioned already and left alone.
 */
export const ensureStorageBuckets = async () => {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error('Failed to list Supabase storage buckets:', listError);
    return;
  }

  const existingNames = new Set((buckets ?? []).map((bucket) => bucket.name));

  for (const bucketName of [AVATAR_BUCKET, RESUME_BUCKET]) {
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
};
