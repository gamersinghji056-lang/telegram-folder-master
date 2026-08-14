-- Multi-user Telegram bot support.
-- The worker is still linked to one app owner through worker_link, but every
-- Telegram bot user gets an independent encrypted MTProto session and jobs.

CREATE TABLE IF NOT EXISTS public.telegram_user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  bot_user_id BIGINT NOT NULL,
  bot_chat_id BIGINT,
  phone TEXT,
  session_enc TEXT NOT NULL,
  telegram_account_id BIGINT,
  telegram_username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  last_connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_user_sessions_user_bot_unique UNIQUE (user_id, bot_user_id)
);

CREATE INDEX IF NOT EXISTS telegram_user_sessions_user_idx
  ON public.telegram_user_sessions (user_id);

GRANT ALL ON public.telegram_user_sessions TO service_role;
ALTER TABLE public.telegram_user_sessions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER telegram_user_sessions_touch
  BEFORE UPDATE ON public.telegram_user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS bot_user_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS bot_user_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.job_folders ADD COLUMN IF NOT EXISTS bot_user_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.job_chats ADD COLUMN IF NOT EXISTS bot_user_id BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_user_chat_unique;

ALTER TABLE public.chats
  ADD CONSTRAINT chats_user_bot_chat_unique UNIQUE (user_id, bot_user_id, telegram_chat_id);

CREATE INDEX IF NOT EXISTS chats_user_bot_idx
  ON public.chats (user_id, bot_user_id);

CREATE INDEX IF NOT EXISTS jobs_user_bot_idx
  ON public.jobs (user_id, bot_user_id);

CREATE INDEX IF NOT EXISTS job_folders_user_bot_idx
  ON public.job_folders (user_id, bot_user_id);

CREATE INDEX IF NOT EXISTS job_chats_user_bot_idx
  ON public.job_chats (user_id, bot_user_id);
