CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- 1. worker link
CREATE TABLE public.worker_link (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  worker_url TEXT,
  worker_token TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX worker_link_token_idx ON public.worker_link (worker_token);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_link TO authenticated;
GRANT ALL ON public.worker_link TO service_role;
ALTER TABLE public.worker_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own worker link" ON public.worker_link FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER worker_link_touch BEFORE UPDATE ON public.worker_link FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 2. encrypted telegram credentials: worker-only
CREATE TABLE public.telegram_config (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  api_id_enc TEXT,
  api_hash_enc TEXT,
  bot_token_enc TEXT,
  session_enc TEXT,
  phone TEXT,
  bot_username TEXT,
  telegram_user_id BIGINT,
  telegram_username TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_config TO service_role;
ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER telegram_config_touch BEFORE UPDATE ON public.telegram_config FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 3. non-secret status flags
CREATE TABLE public.telegram_status (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  api_configured BOOLEAN NOT NULL DEFAULT false,
  bot_configured BOOLEAN NOT NULL DEFAULT false,
  session_configured BOOLEAN NOT NULL DEFAULT false,
  bot_username TEXT,
  telegram_username TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.telegram_status TO authenticated;
GRANT ALL ON public.telegram_status TO service_role;
ALTER TABLE public.telegram_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own status" ON public.telegram_status FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER telegram_status_touch BEFORE UPDATE ON public.telegram_status FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 4. canonical chats
CREATE TABLE public.chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  access_hash TEXT,
  title TEXT,
  username TEXT,
  chat_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  access_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chats_user_chat_unique UNIQUE (user_id, telegram_chat_id)
);
GRANT SELECT ON public.chats TO authenticated;
GRANT ALL ON public.chats TO service_role;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own chats" ON public.chats FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER chats_touch BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 5. jobs
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  bot_chat_id BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  stage TEXT,
  folders_total INT NOT NULL DEFAULT 0,
  folders_ok INT NOT NULL DEFAULT 0,
  folders_failed INT NOT NULL DEFAULT 0,
  total_chats INT NOT NULL DEFAULT 0,
  unique_chats INT NOT NULL DEFAULT 0,
  duplicate_chats INT NOT NULL DEFAULT 0,
  inaccessible_chats INT NOT NULL DEFAULT 0,
  final_chats INT NOT NULL DEFAULT 0,
  folder_name TEXT,
  share_link TEXT,
  share_link_note TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs" ON public.jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER jobs_touch BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 6. job folders
CREATE TABLE public.job_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  url TEXT NOT NULL,
  slug TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  chats_found INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX job_folders_job_idx ON public.job_folders (job_id);
GRANT SELECT ON public.job_folders TO authenticated;
GRANT ALL ON public.job_folders TO service_role;
ALTER TABLE public.job_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own job folders" ON public.job_folders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER job_folders_touch BEFORE UPDATE ON public.job_folders FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 7. job chats (source folder relationships)
CREATE TABLE public.job_chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  folder_id UUID REFERENCES public.job_folders ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES public.chats ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  is_duplicate BOOLEAN NOT NULL DEFAULT false,
  eligible BOOLEAN NOT NULL DEFAULT false,
  access_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_chats_unique UNIQUE (job_id, folder_id, telegram_chat_id)
);
CREATE INDEX job_chats_job_idx ON public.job_chats (job_id);
GRANT SELECT ON public.job_chats TO authenticated;
GRANT ALL ON public.job_chats TO service_role;
ALTER TABLE public.job_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own job chats" ON public.job_chats FOR SELECT TO authenticated USING (auth.uid() = user_id);