const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables')
}

// Backend client with service role key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const profileFields = 'id, email, credits, total_credits_purchased, total_credits_earned, created_at, updated_at'

const parseAuthToken = (req) => {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) {
    return null
  }
  return header.replace('Bearer ', '').trim()
}

const requireUser = async (req) => {
  const token = parseAuthToken(req)
  if (!token) {
    const error = new Error('Authentication required')
    error.statusCode = 401
    throw error
  }

  const { data, error: authError } = await supabase.auth.getUser(token)
  if (authError || !data?.user) {
    const error = new Error('Invalid or expired token')
    error.statusCode = 401
    throw error
  }

  return data.user
}

const ensureProfile = async (user) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select(profileFields)
    .eq('id', user.id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw error
  }

  if (!profile) {
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        credits: 0,
        total_credits_purchased: 0,
        total_credits_earned: 0
      })
      .select(profileFields)
      .single()

    if (insertError) {
      throw insertError
    }
    return newProfile
  }

  return profile
}

const findProfileByEmail = async (email) => {
  if (!email) return null
  const { data, error } = await supabase
    .from('profiles')
    .select(profileFields)
    .ilike('email', email.toLowerCase())
    .single()

  if (error) {
    return null
  }

  return data
}

const adjustUserCredits = async ({
  userId,
  delta,
  transactionType,
  description,
  referenceId = null
}) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('credits, total_credits_purchased, total_credits_earned')
    .eq('id', userId)
    .single()

  if (error) {
    throw error
  }

  const creditsBefore = profile.credits || 0
  const creditsAfter = creditsBefore + delta

  if (creditsAfter < 0) {
    return { success: false, creditsBefore, creditsAfter: creditsBefore }
  }

  const updates = {
    credits: creditsAfter,
    updated_at: new Date().toISOString()
  }

  if (delta > 0) {
    if (transactionType === 'purchased') {
      updates.total_credits_purchased = (profile.total_credits_purchased || 0) + delta
    } else if (transactionType === 'earned') {
      updates.total_credits_earned = (profile.total_credits_earned || 0) + delta
    }
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)

  if (updateError) {
    throw updateError
  }

  const { error: transactionError } = await supabase
    .from('credit_transactions')
    .insert({
      user_id: userId,
      transaction_type: transactionType,
      credits_change: delta,
      credits_before: creditsBefore,
      credits_after: creditsAfter,
      description: description || `${transactionType} credits`,
      reference_id: referenceId
    })

  if (transactionError) {
    throw transactionError
  }

  return { success: true, creditsBefore, creditsAfter }
}

module.exports = { supabase, requireUser, ensureProfile, adjustUserCredits, findProfileByEmail } 
