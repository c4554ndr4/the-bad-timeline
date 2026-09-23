import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Get the raw body for signature verification
    let body = req.body;
    if (typeof body === 'object') {
      body = JSON.stringify(body);
    }
    
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Checkout session completed:', session.id);
    
    try {
      // Extract metadata from checkout session
      const { userId, credits, userEmail } = session.metadata;
      
      console.log(`✅ Payment successful for user ${userId}: ${credits} credits`);
      console.log(`   Session ID: ${session.id}`);
      console.log(`   Amount paid: $${session.amount_total / 100}`);
      console.log(`   Customer email: ${userEmail}`);
      
      // Here you would typically:
      // 1. Add credits to user account in your database
      // 2. Send confirmation email
      // 3. Log the transaction
      
      // Mock database update for now
      console.log(`🎯 Added ${credits} credits to user account`);
      
    } catch (error) {
      console.error('Error processing checkout success:', error);
    }
  }
  
  // Handle failed payments  
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    console.log('❌ Checkout session expired:', session.id);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.json({ received: true });
}

// Important: This tells Vercel to handle the request body as raw
export const config = {
  api: {
    bodyParser: false,
  },
};