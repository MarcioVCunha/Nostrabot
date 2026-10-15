import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

export const SUPABASE_URL = "https://slkztbeihpesepamjcbo.supabase.co";
export const SUPABASE_ANON_KEY =
  "sb_publishable_bB3svjN36RwUrz-4RHBP3Q_P8XzyaDs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export function publicAudioUrl(storagePath) {
  if (!storagePath) return "";
  return `${SUPABASE_URL}/storage/v1/object/public/audios/${storagePath}`;
}

export function isSchemaMissingError(error) {
  const message = String(error?.message || error || "");
  return (
    /could not find the table|relation .* does not exist|schema cache|PGRST205|42P01/i.test(
      message
    )
  );
}
