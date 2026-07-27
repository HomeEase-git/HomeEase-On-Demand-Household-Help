import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const CHAT_IMAGE_BUCKET = process.env.SUPABASE_CHAT_BUCKET || 'chat-images';
export const KYC_DOCUMENT_BUCKET = process.env.SUPABASE_KYC_BUCKET || 'kyc-documents';
export const RESUME_BUCKET = process.env.SUPABASE_RESUME_BUCKET || 'resumes';
export const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || 'avatars';
