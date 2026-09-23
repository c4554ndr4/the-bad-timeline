import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Import database operations (we'll need to adapt these for Vercel)
// For now, we'll use Stripe metadata to store user info

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, credits, userId, userEmail } = req.body;
    
    if (!amount || amount < 1 || amount > 100) {
      return res.status(400).json({ error: 'Invalid amount. Must be between $1 and $100.' });
    }

    if (!credits || credits < 1) {
      return res.status(400).json({ error: 'Invalid credits amount.' });
    }

    if (!userId || !userEmail) {
      return res.status(400).json({ error: 'User information required.' });
    }

    // Create or retrieve Stripe customer
    let customer;
    try {
      // Try to find existing customer by email
      const customers = await stripe.customers.list({
        email: userEmail,
        limit: 1
      });
      
      if (customers.data.length > 0) {
        customer = customers.data[0];
      } else {
        // Create new customer
        customer = await stripe.customers.create({
          email: userEmail,
          metadata: {
            userId: userId
          }
        });
      }
    } catch (error) {
      console.error('Error handling customer:', error);
      return res.status(500).json({ 
        error: 'Failed to process customer information',
        details: error.message,
        stripeError: error.type || 'unknown'
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Stripe uses cents
      currency: 'usd',
      customer: customer.id,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        userId: userId,
        credits: credits.toString(),
        userEmail: userEmail
      }
    });
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      customerId: customer.id
    });

  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create payment intent',
      details: error.message 
    });
  }
}