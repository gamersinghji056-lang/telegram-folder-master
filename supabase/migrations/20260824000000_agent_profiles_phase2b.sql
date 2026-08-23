-- Phase 2B: tenant-scoped Personal AI Representative persistence.
-- Additive only. Do not apply automatically from code.

CREATE TABLE IF NOT EXISTS public.agent_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  display_name TEXT,
  owner_name TEXT,
  business_profession TEXT,
  business_description TEXT,
  purpose TEXT,
  preferred_languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  tone_style TEXT,
  products_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  restricted_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  always_follow_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  never_do_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_profiles_owner_agent_unique UNIQUE (owner_id, agent_id)
);

CREATE INDEX IF NOT EXISTS agent_profiles_owner_idx
  ON public.agent_profiles (owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_profiles TO authenticated;
GRANT ALL ON public.agent_profiles TO service_role;
ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own agent profiles" ON public.agent_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER agent_profiles_touch
  BEFORE UPDATE ON public.agent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.owner_instructions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  instruction TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_instructions_owner_agent_idx
  ON public.owner_instructions (owner_id, agent_id);

CREATE INDEX IF NOT EXISTS owner_instructions_enabled_idx
  ON public.owner_instructions (owner_id, agent_id, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_instructions TO authenticated;
GRANT ALL ON public.owner_instructions TO service_role;
ALTER TABLE public.owner_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own owner instructions" ON public.owner_instructions
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER owner_instructions_touch
  BEFORE UPDATE ON public.owner_instructions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.onboarding_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  current_step TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  question_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_sessions_owner_agent_unique UNIQUE (owner_id, agent_id)
);

CREATE INDEX IF NOT EXISTS onboarding_sessions_owner_idx
  ON public.onboarding_sessions (owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_sessions TO authenticated;
GRANT ALL ON public.onboarding_sessions TO service_role;
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own onboarding sessions" ON public.onboarding_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER onboarding_sessions_touch
  BEFORE UPDATE ON public.onboarding_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
