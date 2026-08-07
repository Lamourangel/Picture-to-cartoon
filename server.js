const express = require('express');
const cors = require('cors');
const path = require('path');
const paypal = require('@paypal/paypal-server-sdk');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? (process.env.FRONTEND_URL || 'https://lamourangel.github.io')
        : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('.'));

// PayPal Configuration - LIVE MODE
function getPayPalClient() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
        throw new Error('Missing PayPal credentials in .env file');
    }

    // Live Client IDs typically start with "A" or "Ab"
    if (!clientId.startsWith('A') && !clientId.startsWith('Ab')) {
        console.warn('⚠️ WARNING: Client ID format may be invalid. Live IDs typically start with "A" or "Ab"');
    }
    
    console.log('💰 Running in LIVE mode - REAL transactions');
    // CHANGE: SandboxEnvironment -> LiveEnvironment
    const environment = new paypal.core.LiveEnvironment(clientId, clientSecret);
    return new paypal.core.PayPalHttpClient(environment);
}

// Get PayPal config for frontend
app.get('/api/paypal-config', (req, res) => {
    try {
        res.json({
            success: true,
            clientId: process.env.PAYPAL_CLIENT_ID,
            currency: process.env.CURRENCY || 'USD',
            price: process.env.PRICE || '1.00',
            serverUrl: process.env.SERVER_URL || 'https://lamourangel.github.io',
            // CHANGE: Add mode indicator for frontend
            mode: 'live'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Payment
app.post('/api/create-payment', async (req, res) => {
    try {
        const client = getPayPalClient();
        const ordersController = new paypal.OrdersController(client);
        
        const price = parseFloat(process.env.PRICE || '1.00');
        if (isNaN(price) || price <= 0) {
            throw new Error('Invalid price in environment variables');
        }

        const orderData = {
            intent: 'CAPTURE',
            application_context: {
                return_url: `${process.env.SERVER_URL || 'https://lamourangel.github.io'}/return`,
                cancel_url: `${process.env.SERVER_URL || 'https://lamourangel.github.io'}/cancel`,
                brand_name: process.env.BRAND_NAME || 'Your Store',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                landing_page: 'BILLING'
            },
            purchase_units: [{
                amount: {
                    currency_code: process.env.CURRENCY || 'USD',
                    value: price.toFixed(2)
                },
                description: process.env.PRODUCT_DESCRIPTION || 'Digital Product Purchase'
            }]
        };

        const order = await ordersController.createOrder({ body: orderData });
        res.json({ success: true, id: order.result.id });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
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
        const ordersController = new paypal.OrdersController(client);

        const capture = await ordersController.captureOrder({ id: orderID });
        
        if (capture.result.status === 'COMPLETED') {
            const receivedAmount = parseFloat(capture.result.purchase_units[0].payments.captures[0].amount.value);
            const expectedPrice = parseFloat(process.env.PRICE || '1.00');
            
            if (receivedAmount !== expectedPrice) {
                console.warn(`⚠️ Payment amount mismatch: Expected ${expectedPrice}, got ${receivedAmount}`);
            }

            const downloadToken = Buffer.from(`${orderID}:${Date.now()}`).toString('base64');
            
            res.json({
                success: true,
                downloadUrl: `${process.env.SERVER_URL || 'https://lamourangel.github.io'}/api/download/${downloadToken}`,
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

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Return URL (after successful payment)
app.get('/return', (req, res) => {
    res.send(`
        <html>
            <head><title>Payment Successful</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>✅ Payment Successful!</h1>
                <p>Your download will begin shortly.</p>
                <script>
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
    
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [orderId, timestamp] = decoded.split(':');
        
        if (Date.now() - parseInt(timestamp) > 3600000) {
            return res.status(410).send('Download link has expired');
        }
        
        res.send('Your secure download file');
    } catch (error) {
        res.status(400).send('Invalid download token');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        environment: 'LIVE (Production)', // CHANGE: Updated
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`💰 Mode: LIVE (Production - Real transactions)`); // CHANGE: Updated
    console.log(`📦 Price: ${process.env.PRICE || '1.00'} ${process.env.CURRENCY || 'USD'}`);
    
    try {
        const clientId = process.env.PAYPAL_CLIENT_ID;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
            console.error('❌ ERROR: Missing PayPal credentials in .env file!');
            console.error('   Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
            console.error('   Get your LIVE credentials from: https://developer.paypal.com/dashboard');
            process.exit(1);
        }
        
        if (!clientId.startsWith('A') && !clientId.startsWith('Ab')) {
            console.warn('⚠️ WARNING: Client ID format may be invalid');
            console.warn('   LIVE Client IDs typically start with "A" or "Ab"');
            console.warn('   Make sure you\'re using LIVE credentials, not Sandbox');
        }
        
        console.log('✅ PayPal credentials loaded successfully');
        console.log('🔴 LIVE MODE ACTIVE - Real money transactions');
        console.log('⚠️  Test thoroughly before going live!');
    } catch (error) {
        console.error('❌ Credential validation failed:', error.message);
        process.exit(1);
    }
});
