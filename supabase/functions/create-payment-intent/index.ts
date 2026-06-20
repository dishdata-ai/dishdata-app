import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('Stripe secret key not configured');
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { amount, currency = 'eur', paymentMethodType, customerId, metadata } = await req.json();

    console.log('Creating payment intent:', { amount, currency, paymentMethodType, customerId });

    // Create payment intent with support for various payment methods including Tap to Pay
    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      metadata: metadata || {},
    };

    // Add payment method types
    if (paymentMethodType) {
      paymentIntentParams.payment_method_types = [paymentMethodType];
    } else {
      // Default to card_present for Tap to Pay and other in-person methods
      paymentIntentParams.payment_method_types = ['card_present', 'card'];
    }

    // Attach customer if provided
    if (customerId) {
      paymentIntentParams.customer = customerId;
    }

    // For Tap to Pay, add capture method
    if (paymentMethodType === 'card_present') {
      paymentIntentParams.capture_method = 'automatic';
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    console.log('Payment intent created:', paymentIntent.id);

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error creating payment intent:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
