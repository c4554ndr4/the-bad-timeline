import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('Missing Supabase configuration')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { discountCode } = req.body

    if (!discountCode || typeof discountCode !== 'string') {
      return res.status(400).json({ error: 'Discount code is required' })
    }

    // Get the authorization header
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const token = authHeader.split(' ')[1]

    // Verify the JWT token with Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      console.error('Authentication error:', authError)
      return res.status(401).json({ error: 'Invalid authentication token' })
    }

    // Use a user-scoped client for the redemption RPC
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    })

    // Call the discount code redemption function
    const { data, error } = await supabaseUser
      .rpc('redeem_discount_code', { 
        discount_code_text: discountCode 
      })
      .single()

    if (error) {
      console.error('Discount redemption error:', error)
      return res.status(500).json({ error: 'Failed to redeem discount code' })
    }

    if (!data.success) {
      return res.status(400).json({ 
        error: data.message,
        success: false
      })
    }

    // Return success response
    res.status(200).json({
      success: true,
      message: data.message,
      creditsAwarded: data.credits_awarded,
      newBalance: data.new_balance
    })

  } catch (error) {
    console.error('Discount code redemption error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
