-- The Bad Timeline - Supabase Database Schema

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable Row Level Security
ALTER DATABASE postgres SET "app.jwt_secret" = 'your-jwt-secret-here';

-- Create profiles table to extend Supabase auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  payment_provider_id TEXT,
  credits INTEGER DEFAULT 0 NOT NULL,
  total_credits_purchased INTEGER DEFAULT 0 NOT NULL,
  total_credits_earned INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles table
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update updated_at on profile updates
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create discount_codes table for available codes
CREATE TABLE IF NOT EXISTS public.discount_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  credits_reward INTEGER NOT NULL,
  max_uses INTEGER DEFAULT NULL, -- NULL means unlimited uses globally
  max_uses_per_user INTEGER DEFAULT 1, -- Default: one use per user
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NULL
);

-- Create discount_code_redemptions table to track usage
CREATE TABLE IF NOT EXISTS public.discount_code_redemptions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  discount_code_id INTEGER REFERENCES public.discount_codes(id) ON DELETE CASCADE NOT NULL,
  code TEXT NOT NULL, -- Store the code text for easy querying
  credits_awarded INTEGER NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, discount_code_id) -- Ensure one redemption per user per code
);

-- Create credit_transactions table for audit trail
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('earned', 'purchased', 'spent', 'refunded')),
  credits_change INTEGER NOT NULL, -- Positive for credits added, negative for credits spent
  credits_before INTEGER NOT NULL,
  credits_after INTEGER NOT NULL,
  description TEXT NOT NULL,
  reference_id TEXT, -- Can store Stripe session ID, discount code ID, etc.
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security on all new tables
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_code_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- Create policies for discount_codes (read-only for authenticated users)
CREATE POLICY "Anyone can view active discount codes" ON public.discount_codes
  FOR SELECT USING (is_active = true);

-- Create policies for discount_code_redemptions
CREATE POLICY "Users can view their own redemptions" ON public.discount_code_redemptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own redemptions" ON public.discount_code_redemptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create policies for credit_transactions
CREATE POLICY "Users can view their own credit transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own credit transactions" ON public.credit_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Insert the cassandraiscool discount code
INSERT INTO public.discount_codes (code, credits_reward, max_uses_per_user, is_active)
VALUES ('cassandraiscool', 200, 1, true)
ON CONFLICT (code) DO NOTHING;

-- Create function to safely redeem discount code
CREATE OR REPLACE FUNCTION public.redeem_discount_code(discount_code_text TEXT)
RETURNS TABLE(success BOOLEAN, message TEXT, credits_awarded INTEGER, new_balance INTEGER) AS $$
DECLARE
  user_uuid UUID;
  code_record RECORD;
  existing_redemption_count INTEGER;
  current_credits INTEGER;
  new_credits INTEGER;
BEGIN
  -- Get current user
  user_uuid := auth.uid();
  
  IF user_uuid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Authentication required', 0, 0;
    RETURN;
  END IF;

  -- Get the discount code
  SELECT * INTO code_record 
  FROM public.discount_codes 
  WHERE code = LOWER(TRIM(discount_code_text)) AND is_active = true
  AND (expires_at IS NULL OR expires_at > NOW());
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Invalid or expired discount code', 0, 0;
    RETURN;
  END IF;

  -- Check if user has already redeemed this code
  SELECT COUNT(*) INTO existing_redemption_count
  FROM public.discount_code_redemptions 
  WHERE user_id = user_uuid AND discount_code_id = code_record.id;
  
  IF existing_redemption_count >= code_record.max_uses_per_user THEN
    RETURN QUERY SELECT FALSE, 'This discount code has already been used', 0, 0;
    RETURN;
  END IF;

  -- Get current user credits
  SELECT credits INTO current_credits 
  FROM public.profiles 
  WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    -- Create profile if it doesn't exist
    INSERT INTO public.profiles (id, email, credits) 
    VALUES (user_uuid, '', 0);
    current_credits := 0;
  END IF;

  -- Calculate new credits
  new_credits := current_credits + code_record.credits_reward;

  -- Update user credits
  UPDATE public.profiles 
  SET credits = new_credits, 
      total_credits_earned = total_credits_earned + code_record.credits_reward,
      updated_at = NOW()
  WHERE id = user_uuid;

  -- Record the redemption
  INSERT INTO public.discount_code_redemptions (user_id, discount_code_id, code, credits_awarded)
  VALUES (user_uuid, code_record.id, code_record.code, code_record.credits_reward);

  -- Record the credit transaction
  INSERT INTO public.credit_transactions (user_id, transaction_type, credits_change, credits_before, credits_after, description, reference_id)
  VALUES (user_uuid, 'earned', code_record.credits_reward, current_credits, new_credits, 
          'Discount code redemption: ' || code_record.code, code_record.id::TEXT);

  RETURN QUERY SELECT TRUE, 'Discount code redeemed successfully!', code_record.credits_reward, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to safely spend credits
CREATE OR REPLACE FUNCTION public.spend_credits(credits_to_spend INTEGER, description TEXT DEFAULT 'Credit spent', reference_id TEXT DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, message TEXT, credits_remaining INTEGER) AS $$
DECLARE
  user_uuid UUID;
  current_credits INTEGER;
  new_credits INTEGER;
BEGIN
  -- Get current user
  user_uuid := auth.uid();
  
  IF user_uuid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Authentication required', 0;
    RETURN;
  END IF;

  IF credits_to_spend <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Credits to spend must be positive', 0;
    RETURN;
  END IF;

  -- Get current user credits with row lock
  SELECT credits INTO current_credits 
  FROM public.profiles 
  WHERE id = user_uuid
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'User profile not found', 0;
    RETURN;
  END IF;

  -- Check if user has enough credits
  IF current_credits < credits_to_spend THEN
    RETURN QUERY SELECT FALSE, 'Insufficient credits', current_credits;
    RETURN;
  END IF;

  -- Calculate new credits
  new_credits := current_credits - credits_to_spend;

  -- Update user credits
  UPDATE public.profiles 
  SET credits = new_credits, updated_at = NOW()
  WHERE id = user_uuid;

  -- Record the credit transaction
  INSERT INTO public.credit_transactions (user_id, transaction_type, credits_change, credits_before, credits_after, description, reference_id)
  VALUES (user_uuid, 'spent', -credits_to_spend, current_credits, new_credits, description, reference_id);

  RETURN QUERY SELECT TRUE, 'Credits spent successfully', new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.discount_codes TO authenticated;
GRANT ALL ON public.discount_codes TO service_role;
GRANT ALL ON public.discount_code_redemptions TO authenticated;
GRANT ALL ON public.discount_code_redemptions TO service_role;
GRANT ALL ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
GRANT ALL ON SEQUENCE discount_codes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE discount_codes_id_seq TO service_role;
GRANT ALL ON SEQUENCE discount_code_redemptions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE discount_code_redemptions_id_seq TO service_role;
GRANT ALL ON SEQUENCE credit_transactions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE credit_transactions_id_seq TO service_role; 

-- User preferences table
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  preference_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their preferences" ON public.user_preferences
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert preferences" ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their preferences" ON public.user_preferences
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Generated tweets table
CREATE TABLE IF NOT EXISTS public.generated_tweets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.generated_tweets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tweets" ON public.generated_tweets
  FOR SELECT USING (true);

CREATE POLICY "Service role can insert tweets" ON public.generated_tweets
  USING (true) WITH CHECK (true);

-- User likes table
CREATE TABLE IF NOT EXISTS public.user_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tweet_id UUID REFERENCES public.generated_tweets(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tweet_id)
);

ALTER TABLE public.user_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their likes" ON public.user_likes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can like tweets" ON public.user_likes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their likes" ON public.user_likes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
