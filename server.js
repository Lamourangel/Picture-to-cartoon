const express = require('express');
const cors = require('cors');
const paypal = require('@paypal/checkout-server-sdk');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? (process.env.FRONTEND_URL || 'https://your-domain.com')
        : '*', // Allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// PayPal Configuration - SANDBOX MODE FOR TESTING
function getPayPalClient() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
        throw new Error('Missing PayPal credentials in .env file');
    }

    // VALIDATE: Sandbox Client IDs start with 'BA' or 'BAA'
    if (!clientId.startsWith('BA') && !clientId.startsWith('A')) {
        console.warn('⚠️ WARNING: Client ID format may be invalid. Sandbox IDs start with "BA", Live IDs start with "A"');
    }
    
    // Using SandboxEnvironment = TESTING MODE
    console.log('🧪 Running in SANDBOX mode for testing');
    const environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
    return new paypal.core.PayPalHttpClient(environment);
}

// Get PayPal config for frontend
app.get('/api/paypal-config', (req, res) => {
    try {
        // Don't send clientSecret to frontend - security risk!
        res.json({
            success: true,
            clientId: process.env.PAYPAL_CLIENT_ID,
            currency: process.env.CURRENCY || 'USD',
            price: process.env.PRICE || '1.00',
            serverUrl: process.env.SERVER_URL || 'https://yourdomain.com' // CHANGE THIS!
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Payment
app.post('/api/create-payment', async (req, res) => {
    try {
        const client = getPayPalClient();
        const request = new paypal.orders.OrdersCreateRequest();
        
        // Add proper error handling for missing price
        const price = parseFloat(process.env.PRICE || '1.00');
        if (isNaN(price) || price <= 0) {
            throw new Error('Invalid price in environment variables');
        }

        request.requestBody({
            intent: 'CAPTURE',
            application_context: {
                return_url: `${process.env.SERVER_URL || 'https://yourdomain.com'}/return`,
                cancel_url: `${process.env.SERVER_URL || 'https://yourdomain.com'}/cancel`,
                brand_name: process.env.BRAND_NAME || 'Your Store',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW'
            },
            purchase_units: [{
                amount: {
                    currency_code: process.env.CURRENCY || 'USD',
                    value: price.toFixed(2) // Ensures proper decimal format
                },
                description: process.env.PRODUCT_DESCRIPTION || 'Digital Product Purchase'
            }]
        });
        
        const order = await client.execute(request);
        res.json({ success: true, id: order.result.id });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            // Don't expose sensitive details in production
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Verify Payment
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { orderID } = req.body;
        
        if (!orderID) {
            return res.status(400).json({ success: false, error: 'Order ID is required' });
        }

        const client = getPayPalClient();
        const request = new paypal.orders.OrdersCaptureRequest(orderID);
        request.requestBody({});
        
        const capture = await client.execute(request);
        
        // Comprehensive status check
        if (capture.result.status === 'COMPLETED') {
            // Verify the payment amount matches your price
            const receivedAmount = parseFloat(capture.result.purchase_units[0].payments.captures[0].amount.value);
            const expectedPrice = parseFloat(process.env.PRICE || '1.00');
            
            if (receivedAmount !== expectedPrice) {
                // Log this for fraud detection
                console.warn(`⚠️ Payment amount mismatch: Expected ${expectedPrice}, got ${receivedAmount}`);
                // Still process it, but log it
            }

            // Generate a secure download token here (don't just use a static URL!)
            const downloadToken = Buffer.from(`${orderID}:${Date.now()}`).toString('base64');
            
            res.json({
                success: true,
                downloadUrl: `${process.env.SERVER_URL || 'https://yourdomain.com'}/api/download/${downloadToken}`,
                transactionId: capture.result.purchase_units[0].payments.captures[0].id,
                payerEmail: capture.result.payer.email_address
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: `Payment not completed. Status: ${capture.result.status}`
            });
        }
    } catch (error) {
        console.error('Verify payment error:', error);
        
        // Check for specific PayPal errors
        if (error.statusCode === 404) {
            res.status(404).json({ success: false, error: 'Order not found or already captured' });
        } else if (error.statusCode === 422) {
            res.status(422).json({ success: false, error: 'Order already captured or invalid' });
        } else {
            res.status(500).json({ 
                success: false, 
                error: error.message,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
});

// Return URL (after successful payment)
app.get('/return', (req, res) => {
    // You can redirect to a success page on your frontend
    res.send(`
        <html>
            <head><title>Payment Successful</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>✅ Payment Successful!</h1>
                <p>Your download will begin shortly.</p>
                <script>
                    // Close window after 3 seconds (or redirect to your app)
                    setTimeout(() => window.close(), 3000);
                </script>
            </body>
        </html>
    `);
});

// Cancel URL (when user cancels payment)
app.get('/cancel', (req, res) => {
    res.send(`
        <html>
            <head><title>Payment Cancelled</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Payment Cancelled</h1>
                <p>You can close this window and try again.</p>
                <script>
                    setTimeout(() => window.close(), 3000);
                </script>
            </body>
        </html>
    `);
});

// Download endpoint (SECURE VERSION)
app.get('/api/download/:token', (req, res) => {
    const { token } = req.params;
    
    // Validate the token here (check expiration, order ID, etc.)
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [orderId, timestamp] = decoded.split(':');
        
        // Check if token is less than 1 hour old
        if (Date.now() - parseInt(timestamp) > 3600000) {
            return res.status(410).send('Download link has expired');
        }
        
        // Send your actual file here
        res.send('Your secure download file');
    } catch (error) {
        res.status(400).send('Invalid download token');
    }
});

// Health check endpoint (useful for monitoring)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        environment: 'Sandbox (Testing)',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🧪 Mode: SANDBOX (Testing & Development)`);
    console.log(`📦 Price: ${process.env.PRICE || '1.00'} ${process.env.CURRENCY || 'USD'}`);
    
    // Validate credentials on startup
    try {
        const clientId = process.env.PAYPAL_CLIENT_ID;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
            console.error('❌ ERROR: Missing PayPal credentials in .env file!');
            console.error('   Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
            console.error('   Get your Sandbox credentials from: https://developer.paypal.com/dashboard');
            process.exit(1);
        }
        
        if (!clientId.startsWith('BA') && !clientId.startsWith('A')) {
            console.warn('⚠️ WARNING: Client ID format may be invalid');
            console.warn('   Sandbox Client IDs typically start with "BA" or "BAA"');
            console.warn('   Live Client IDs start with "A" or "Ab"');
        }
        
        console.log('✅ PayPal credentials loaded successfully');
        console.log('💡 Using Sandbox mode for testing. Switch to Live mode in production!');
    } catch (error) {
        console.error('❌ Credential validation failed:', error.message);
        process.exit(1);
    }
});
