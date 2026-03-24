// Supabase Edge Function: mpesa-pay
// Handles OAuth and STK Push for Safaricom Daraja API

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    
    // Check if this is a Safaricom Callback
    if (body.Body && body.Body.stkCallback) {
      const callback = body.Body.stkCallback
      const checkoutRequestId = callback.CheckoutRequestID
      const resultCode = callback.ResultCode
      
      console.log(`[M-Pesa Callback] ID: ${checkoutRequestId}, Code: ${resultCode}`)

      // Initialize Supabase Client (service role for server-side updates)
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.7.1")
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      if (resultCode === 0) {
        // Success
        await supabase
          .from('donations')
          .update({ payment_status: 'completed' })
          .eq('checkout_request_id', checkoutRequestId)
      } else {
        // Failed
        await supabase
          .from('donations')
          .update({ payment_status: 'failed' })
          .eq('checkout_request_id', checkoutRequestId)
      }

      return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const { amount, phoneNumber, action } = body

    // 1. Get Credentials from Environment Variables
    const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY')
    const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET')
    const shortCode = Deno.env.get('MPESA_SHORTCODE') // Till Number or Paybill
    const passKey = Deno.env.get('MPESA_PASSKEY')
    const callbackUrl = Deno.env.get('MPESA_CALLBACK_URL') // Your Supabase function URL

    if (!consumerKey || !consumerSecret) {
      throw new Error('M-Pesa credentials not configured in Supabase environment.')
    }

    if (action === 'stkPush') {
      // 2. Get OAuth Token
      const auth = btoa(`${consumerKey}:${consumerSecret}`)
      const tokenRes = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
        headers: { Authorization: `Basic ${auth}` }
      })
      const { access_token } = await tokenRes.json()

      // 3. Prepare STK Push
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0].slice(0, 14)
      const password = btoa(`${shortCode}${passKey}${timestamp}`)
      
      const mpesaRes = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          BusinessShortCode: shortCode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline', // Or 'CustomerBuyGoodsOnline'
          Amount: Math.round(amount),
          PartyA: phoneNumber,
          PartyB: shortCode,
          PhoneNumber: phoneNumber,
          CallBackURL: callbackUrl,
          AccountReference: 'OasisHope',
          TransactionDesc: 'Donation'
        })
      })

      const result = await mpesaRes.json()
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    throw new Error('Invalid action')

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
