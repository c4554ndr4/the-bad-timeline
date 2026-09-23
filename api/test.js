export default async function handler(req, res) {
  try {
    // Test environment variables
    const envTest = {
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
      nodeVersion: process.version,
      method: req.method,
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      environment: envTest,
      message: 'Test endpoint working'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}