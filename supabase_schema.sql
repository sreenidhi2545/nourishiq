-- ============================================================
-- NourishIQ — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID extension (already on by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: users
-- Stores user profile data (extends Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id     UUID UNIQUE,                        -- links to auth.users.id (null for mock auth)
  name        TEXT NOT NULL,
  age         INT  CHECK (age > 0 AND age < 150),
  gender      TEXT,                               -- 'Male' | 'Female' | 'Other'
  city        TEXT DEFAULT 'Hyderabad',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: sessions
-- One row per AI analysis (symptoms or blood report)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES public.users(id) ON DELETE CASCADE,
  symptoms     TEXT[],                            -- e.g. ['Always tired', 'Hair fall']
  deficiencies JSONB NOT NULL,                    -- full deficiencies array from Groq
  body_score   INT  CHECK (body_score >= 0 AND body_score <= 100),
  tip          JSONB,                             -- { title, body }
  source       TEXT DEFAULT 'symptoms',           -- 'symptoms' | 'blood_report'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON public.sessions(created_at DESC);

-- ============================================================
-- TABLE: cart_items
-- One row per unique food item in a user's cart
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cart_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES public.users(id) ON DELETE CASCADE,
  session_id   UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  food_name    TEXT NOT NULL,
  emoji        TEXT,
  price        NUMERIC(8,2) NOT NULL,
  qty          INT NOT NULL DEFAULT 1 CHECK (qty > 0),
  deficiency   TEXT,                             -- e.g. 'Iron', 'Vitamin B12'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, food_name)                    -- one row per item per user
);

CREATE INDEX IF NOT EXISTS cart_items_user_id_idx ON public.cart_items(user_id);

-- ============================================================
-- TABLE: awareness_cards
-- AI-generated awareness tips per analysis session
-- ============================================================
CREATE TABLE IF NOT EXISTS public.awareness_cards (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES public.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  cards      JSONB NOT NULL,                     -- array of 3 awareness card objects
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS awareness_user_id_idx ON public.awareness_cards(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- Users can only read/write their own data
-- ============================================================
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.awareness_cards ENABLE ROW LEVEL SECURITY;

-- Allow server-side service role to bypass RLS (used by our Express backend)
-- The anon key will NOT have access to other users' data.

-- users: users can only see/edit their own row
CREATE POLICY "users_own_row" ON public.users
  USING (id = (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- sessions: users can only see their own sessions
CREATE POLICY "sessions_own" ON public.sessions
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- cart_items: users can only see their own cart
CREATE POLICY "cart_own" ON public.cart_items
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- awareness_cards: users can only see their own cards
CREATE POLICY "awareness_own" ON public.awareness_cards
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- ============================================================
-- NOTE: Our Express backend uses the SERVICE_ROLE key which
-- bypasses RLS entirely — so server.js can write on behalf
-- of any user without RLS conflicts.
-- ============================================================
