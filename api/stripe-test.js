import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    
    // Test basic Stripe API call
    const account = await stripe.accounts.retrieve();
    
    res.json({
      success: true,
      stripeConnected: true,
      accountId: account.id,
      country: account.country,
      livemode: account.livemode,
      message: 'Stripe connection successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      type: error.type,
      code: error.code,
      stripeError: true
    });
  }
}