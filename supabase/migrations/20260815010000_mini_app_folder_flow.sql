-- Mini App folder flow support.
-- Analysis now marks not-yet-joined but joinable chats as JOIN_REQUIRED.
-- Those rows are eligible for the user's explicit "Join & Create Folder" confirmation.

UPDATE public.job_chats
SET eligible = true
WHERE is_duplicate = false
  AND access_status IN ('ACCESSIBLE', 'JOIN_REQUIRED');

CREATE INDEX IF NOT EXISTS job_chats_job_user_bot_eligible_idx
  ON public.job_chats (job_id, user_id, bot_user_id, eligible, is_duplicate);
