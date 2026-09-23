import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your_supabase_url_here') &&
  !supabaseAnonKey.includes('your_supabase_anon_key_here') &&
  !supabaseUrl.includes('ljotxrrxaousrxnvzsfh')
)

// Create a mock client if Supabase is not configured
let supabase;

if (!isSupabaseConfigured) {
  console.warn('Supabase not configured, using mock client')
  
  // Create a mock Supabase client for development
  supabase = {
    auth: {
      getSession: () => Promise.resolve({ 
        data: { session: { access_token: 'mock_token_' + Date.now(), user: { id: 'mock_user_id', email: 'test@example.com' } } },
        error: null 
      }),
      signInWithPassword: (credentials) => {
        const userId = 'user_' + Date.now()
        const userEmail = credentials.email
        console.log(`🎭 Mock login for: ${userEmail}`)
        return Promise.resolve({ 
          data: { 
            user: { email: userEmail, id: userId },
            session: { access_token: 'mock_token_' + Date.now(), user: { email: userEmail, id: userId } }
          }, 
          error: null 
        })
      },
      signUp: (credentials) => {
        const userId = 'user_' + Date.now()
        const userEmail = credentials.email || `${userId}@fake.com`
        console.log(`🎭 Mock signup for: ${userEmail}`)
        return Promise.resolve({ 
          data: { 
            user: { 
              email: userEmail, 
              id: userId,
              user_metadata: credentials.options?.data || {}
            },
            session: { access_token: 'mock_token_' + Date.now(), user: { email: userEmail, id: userId } }
          }, 
          error: null 
        })
      },
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: (callback) => {
        // Simulate auth state change after a short delay
        setTimeout(() => {
          callback('SIGNED_IN', { 
            access_token: 'mock_token_' + Date.now(), 
            user: { email: 'test@example.com', id: 'mock_user_id' } 
          })
        }, 100)
        
        return { 
          data: { 
            subscription: { 
              unsubscribe: () => {} 
            } 
          } 
        }
      }
    }
  }
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  })
}

export { supabase, isSupabaseConfigured }
