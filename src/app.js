(function() {
    // ================================================================
    // 1. CONFIGURATION
    // ================================================================
    const CONFIG = {
        MAX_IMAGE_SIZE: 700,
        PRICE_DISPLAY: '$1',
        SERVER_URL: 'https://lamourangel.github.io/Picture-to-cartoon/',
        PAYPAL_CLIENT_ID: null,
        CURRENCY: 'USD',
        PRICE: '1'
    };

    // Load config from server .env file
    async function loadConfigFromEnv() {
        try {
            let response;
            // Try relative path first (works when backend is served from same origin or proxied)
            try {
                response = await fetch('/api/paypal-config');
            } catch (err) {
                // Fallback to explicit server URL (useful in dev when frontend served separately)
                response = await fetch(`${CONFIG.SERVER_URL}/api/paypal-config`);
            }

            const data = await response.json();

            if (data.success) {
                CONFIG.PAYPAL_CLIENT_ID = data.clientId;
                CONFIG.CURRENCY = data.currency;
                CONFIG.PRICE = data.price;
                CONFIG.SERVER_URL = data.serverUrl || CONFIG.SERVER_URL || window.location.origin;
                CONFIG.PRICE_DISPLAY = `$${data.price}`;

                const priceTag = document.getElementById('priceTag');
                if (priceTag) {
                    priceTag.textContent = CONFIG.PRICE_DISPLAY;
                }

                console.log('✅ Config loaded from .env:', CONFIG);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading config:', error);
            // Do not silently fall back to sandbox when you requested LIVE mode
            CONFIG.PAYPAL_CLIENT_ID = null;
            try {
                CONFIG.SERVER_URL = window.location.origin || CONFIG.SERVER_URL;
            } catch (e) {
                CONFIG.SERVER_URL = CONFIG.SERVER_URL;
            }
            console.warn('Could not load /api/paypal-config; ensure the backend is running and SERVER_URL is set.');
            return false;
        }
    }

    // ================================================================
    // 2. UI HELPER FUNCTIONS
    // ================================================================
    function showLoading(message) {
        const el = document.getElementById('loading');
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
        }
    }

    function hideLoading() {
        const el = document.getElementById('loading');
        if (el) el.style.display = 'none';
    }

    function showError(message) {
        const el = document.getElementById('error');
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
        }
        setTimeout(() => {
            if (el) el.style.display = 'none';
        }, 5000);
    }

    function showSuccess(message) {
        const el = document.getElementById('success');
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
        }
    }

    // ================================================================
    // 3. PAYMENT FUNCTIONS
    // ================================================================
    
    // Create payment on server
    async function createPaymentOnServer() {
        try {
            // Use relative endpoints so the frontend works when served from same origin
            const url = '/api/create-payment';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const text = await response.text();
                console.error('Create payment failed:', response.status, text);
                throw new Error(`Create payment failed: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to create payment');
            }
            
            return data.id;
        } catch (error) {
            console.error('Create payment error:', error);
            throw error;
        }
    }

    // Verify payment on server
    async function verifyPaymentOnServer(orderID) {
        try {
            const url = '/api/verify-payment';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ orderID })
            });
            
            if (!response.ok) {
                const text = await response.text();
                console.error('Verify payment failed:', response.status, text);
                throw new Error(`Verify payment failed: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Payment verification failed');
            }
            
            return data;
        } catch (error) {
            console.error('Verify payment error:', error);
            throw error;
        }
    }

    // Handle successful payment
    function handlePaymentSuccess(result) {
        showSuccess('Payment confirmed! You can now download your image.');
        
        // Update UI to show download is unlocked
        isPaid = true;
        transactionId = result.transactionId;
        downloadBtn.classList.add('btn-download-unlocked');
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download (Unlocked)';
        
        // Show success in modal
        paymentSuccessMsg.classList.add('show');
        paymentStatus.textContent = '✅ Payment verified! Click Download to save your image.';
        paymentStatus.className = 'payment-status success';
        
        // Auto-close modal after 2 seconds
        setTimeout(() => {
            modal.classList.remove('show');
        }, 2000);
    }

    // ================================================================
    // 4. PAYPAL BUTTON
    // ================================================================
    async function renderPayPalButton() {
        try {
            // Load config if not loaded
            if (!CONFIG.PAYPAL_CLIENT_ID) {
                const ok = await loadConfigFromEnv();
                if (!ok || !CONFIG.PAYPAL_CLIENT_ID) {
                    throw new Error('PayPal client ID not available. Make sure the backend /api/paypal-config returns a valid clientId.');
                }
            }
            
            // Dynamically load PayPal SDK
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                const clientIdForSdk = CONFIG.PAYPAL_CLIENT_ID; // use explicit live client id provided by backend
                script.src = `https://www.paypal.com/sdk/js?client-id=${clientIdForSdk}&currency=${CONFIG.CURRENCY}`;
                script.onload = resolve;
                script.onerror = (err) => reject(new Error('Failed to load PayPal SDK: ' + (err && err.message)));
                document.head.appendChild(script);
            });
            
            // Render PayPal button
            paypal.Buttons({
                createOrder: async () => {
                    try {
                        paymentStatus.textContent = 'Creating payment...';
                        paymentStatus.className = 'payment-status';
                        const orderID = await createPaymentOnServer();
                        return orderID;
                    } catch (error) {
                        paymentStatus.textContent = 'Error: ' + error.message;
                        paymentStatus.className = 'payment-status error';
                        throw error;
                    }
                },
                
                onApprove: async (data) => {
                    try {
                        paymentStatus.textContent = 'Verifying payment...';
                        paymentStatus.className = 'payment-status';
                        const result = await verifyPaymentOnServer(data.orderID);
                        handlePaymentSuccess(result);
                    } catch (error) {
                        paymentStatus.textContent = 'Error: ' + error.message;
                        paymentStatus.className = 'payment-status error';
                    }
                },
                
                onError: (err) => {
                    console.error('PayPal error:', err);
                    paymentStatus.textContent = 'PayPal error. Please try again.';
                    paymentStatus.className = 'payment-status error';
                    showError('PayPal payment failed. Please try again.');
                },
                
                onCancel: () => {
                    paymentStatus.textContent = 'Payment cancelled. You can try again.';
                    paymentStatus.className = 'payment-status';
                }
                
            }).render('#paypal-button-container');
            
        } catch (error) {
            console.error('Failed to load PayPal:', error);
            const container = document.getElementById('paypal-button-container');
            container.innerHTML = `
                <div style="color: #dc3545; padding: 10px; background: rgba(220,53,69,0.1); border-radius: 8px;">
                    ⚠️ Failed to load PayPal. Please refresh the page.<br/><small>${error.message || ''}</small>
                </div>
            `;
        }
    }

    // ================================================================
    // 5. CREDIT/DEBIT CARD BUTTON
    // ================================================================
    function setupCardPayment() {
        const cardButton = document.createElement('button');
        cardButton.className = 'card-pay-button';
        cardButton.innerHTML = '<i class="fas fa-credit-card"></i> Pay with Credit/Debit Card';
        cardButton.id = 'cardPayButton';
        
        // Add to container
        const container = document.getElementById('card-button-container');
        container.appendChild(cardButton);
        
        // Click handler
        cardButton.addEventListener('click', async function() {
            // Disable button to prevent double-click
            this.disabled = true;
            this.innerHTML = '<span class="payment-loading-spinner"></span> Processing...';
            
            try {
                // Step 1: Create payment
                paymentStatus.textContent = 'Creating payment...';
                paymentStatus.className = 'payment-status';
                
                const orderID = await createPaymentOnServer();
                
                // Step 2: Simulate card payment (in production, redirect to payment page)
                // For this demo, we'll use PayPal's card processing
                // In production, you would redirect to a card payment page
                
                // For demo: Show a card payment form
                paymentStatus.textContent = 'For card payments, we use PayPal\'s secure checkout. Redirecting...';
                paymentStatus.className = 'payment-status';
                
                // Simulate card payment flow
                // In production, you would redirect to your card payment page
                // or use PayPal's card fields
                
                // For demo: auto-verify after 2 seconds
                setTimeout(async () => {
                    try {
                        const result = await verifyPaymentOnServer(orderID);
                        handlePaymentSuccess(result);
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-credit-card"></i> Pay with Credit/Debit Card';
                    } catch (error) {
                        paymentStatus.textContent = 'Card payment failed: ' + error.message;
                        paymentStatus.className = 'payment-status error';
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-credit-card"></i> Pay with Credit/Debit Card';
                    }
                }, 2000);
                
            } catch (error) {
                paymentStatus.textContent = 'Error: ' + error.message;
                paymentStatus.className = 'payment-status error';
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-credit-card"></i> Pay with Credit/Debit Card';
            }
        });
    }

    // ================================================================
    // 6. APP LOGIC
    // ================================================================
    const fileInput = document.getElementById('fileInput');
    const uploadZone = document.getElementById('uploadZone');
    const originalWrapper = document.getElementById('originalWrapper');
    const cartoonWrapper = document.getElementById('cartoonWrapper');
    const cartoonifyBtn = document.getElementById('cartoonifyBtn');
    const resetBtn = document.getElementById('resetBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const styleOptions = document.querySelectorAll('.style-option');

    const modal = document.getElementById('downloadPaywallModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const paymentSuccessMsg = document.getElementById('paymentSuccessMsg');
    const paymentStatus = document.getElementById('paymentStatus');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let currentImage = null;
    let currentFile = null;
    let currentStyle = 'manga';
    let isPaid = false;
    let currentCartoonDataURL = null;
    let transactionId = null;

    // --- STYLE SELECTION ---
    styleOptions.forEach(opt => {
        opt.addEventListener('click', function() {
            styleOptions.forEach(o => o.classList.remove('active'));
            this.classList.add('active');
            currentStyle = this.dataset.style;
            if (currentImage) {
                cartoonifyCurrent();
            }
        });
    });

    // --- RESET ---
    function resetDisplay() {
        currentImage = null;
        currentFile = null;
        isPaid = false;
        currentCartoonDataURL = null;
        transactionId = null;
        originalWrapper.innerHTML = `<i class="fas fa-camera placeholder-icon"></i>`;
        cartoonWrapper.innerHTML = `<i class="fas fa-star placeholder-icon"></i>`;
        const watermark = document.createElement('div');
        watermark.className = 'watermark-preview';
        watermark.textContent = '🔒 PREVIEW';
        cartoonWrapper.appendChild(watermark);

        fileInput.value = '';
        downloadBtn.classList.remove('btn-download-unlocked');
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';

        paymentSuccessMsg.classList.remove('show');
        paymentStatus.textContent = 'Choose a payment method above';
        paymentStatus.className = 'payment-status';
        modal.classList.remove('show');
    }

    // --- LOAD IMAGE ---
    function loadImageFromFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                currentImage = img;
                currentFile = file;
                isPaid = false;
                currentCartoonDataURL = null;
                transactionId = null;
                downloadBtn.classList.remove('btn-download-unlocked');
                downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';

                const clone = img.cloneNode(true);
                clone.style.width = '100%';
                clone.style.height = '100%';
                clone.style.objectFit = 'cover';
                originalWrapper.innerHTML = '';
                originalWrapper.appendChild(clone);

                cartoonWrapper.innerHTML = '';
                const watermark = document.createElement('div');
                watermark.className = 'watermark-preview';
                watermark.textContent = '🔒 PREVIEW';
                cartoonWrapper.appendChild(watermark);

                cartoonifyCurrent();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // --- CARTOON EFFECT ---
    function applyCartoonEffect(sourceImg, style) {
        let w = sourceImg.naturalWidth || sourceImg.width;
        let h = sourceImg.naturalHeight || sourceImg.height;
        const MAX = CONFIG.MAX_IMAGE_SIZE || 700;
        if (w > MAX || h > MAX) {
            const ratio = Math.min(MAX / w, MAX / h);
            w = Math.floor(w * ratio);
            h = Math.floor(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(sourceImg, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        const gray = new Uint8Array(w * h);
        for (let i = 0; i < data.length; i += 4) {
            gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        const edge1 = new Uint8Array(w * h);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const gx = -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)] -
                    2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)] -
                    gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
                const gy = -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x +
                    1)] +
                    gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
                const mag = Math.min(255, Math.sqrt(gx * gx + gy * gy));
                edge1[idx] = Math.min(255, Math.round(mag * 1.5));
            }
        }

        const edge = new Uint8Array(w * h);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const val = edge1[idx];
                let maxVal = val;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nIdx = (y + dy) * w + (x + dx);
                        if (edge1[nIdx] > maxVal) maxVal = edge1[nIdx];
                    }
                }
                edge[idx] = (val >= maxVal * 0.8) ? val : 0;
            }
        }

        const eyeMap = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const r = data[idx * 4];
                const g = data[idx * 4 + 1];
                const b = data[idx * 4 + 2];
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                const edgeVal = edge[idx] / 255;
                const eyeScore = (lum / 255) * (1 - edgeVal * 0.5) * (1 + (r > 80 && g > 50 ? 0.2 : 0));
                eyeMap[idx] = Math.min(1, eyeScore);
            }
        }

        let posterizeSteps = 7,
            saturation = 1.6,
            edgeStrength = 0.7,
            contrast = 1.2,
            brightness = 1.08,
            eyeBoost = 1.5,
            shadowBoost = 1.15,
            highlightBoost = 1.2;

        switch (style) {
            case 'manga':
                posterizeSteps = 7;
                saturation = 1.6;
                edgeStrength = 0.7;
                contrast = 1.2;
                brightness = 1.08;
                eyeBoost = 1.5;
                shadowBoost = 1.15;
                highlightBoost = 1.2;
                break;
            case 'comic':
                posterizeSteps = 6;
                saturation = 1.7;
                edgeStrength = 0.6;
                contrast = 1.15;
                brightness = 1.1;
                eyeBoost = 1.3;
                shadowBoost = 1.1;
                highlightBoost = 1.0;
                break;
            case 'vivid':
                posterizeSteps = 5;
                saturation = 2.0;
                edgeStrength = 0.55;
                contrast = 1.25;
                brightness = 1.12;
                eyeBoost = 1.4;
                shadowBoost = 1.1;
                highlightBoost = 1.1;
                break;
            case 'soft':
                posterizeSteps = 8;
                saturation = 1.2;
                edgeStrength = 0.4;
                contrast = 1.05;
                brightness = 1.15;
                eyeBoost = 1.4;
                shadowBoost = 1.15;
                highlightBoost = 1.0;
                break;
            default:
                posterizeSteps = 7;
                saturation = 1.6;
                edgeStrength = 0.7;
                contrast = 1.2;
                brightness = 1.08;
                eyeBoost = 1.5;
                shadowBoost = 1.15;
                highlightBoost = 1.2;
        }

        const step = 255 / posterizeSteps;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            const idx = i / 4;
            const lumOrig = 0.299 * r + 0.587 * g + 0.114 * b;

            if (lumOrig < 100) {
                const boost = shadowBoost + (1 - lumOrig / 100) * 0.15;
                r = Math.min(255, Math.round(r * boost));
                g = Math.min(255, Math.round(g * boost));
                b = Math.min(255, Math.round(b * boost));
            } else if (lumOrig >= 100 && lumOrig < 180) {
                const boost = 1.05 + (180 - lumOrig) / 180 * 0.08;
                r = Math.min(255, Math.round(r * boost));
                g = Math.min(255, Math.round(g * boost));
                b = Math.min(255, Math.round(b * boost));
            } else if (lumOrig >= 180) {
                const boost = highlightBoost + (lumOrig - 180) / 75 * 0.15;
                r = Math.min(255, Math.round(r * boost));
                g = Math.min(255, Math.round(g * boost));
                b = Math.min(255, Math.round(b * boost));
            }

            r = Math.round(r / step) * step;
            g = Math.round(g / step) * step;
            b = Math.round(b / step) * step;

            const grayVal = 0.299 * r + 0.587 * g + 0.114 * b;
            r = Math.min(255, Math.round(grayVal + saturation * (r - grayVal)));
            g = Math.min(255, Math.round(grayVal + saturation * (g - grayVal)));
            b = Math.min(255, Math.round(grayVal + saturation * (b - grayVal)));

            const e = edge[idx] || 0;
            const eyeScore = eyeMap[idx] || 0;

            let strength = edgeStrength;
            if (eyeScore > 0.4) strength = 0.2;
            const localContrast = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
            if (localContrast > 60 && eyeScore < 0.3) {
                strength = Math.min(0.85, strength * 1.2);
            }

            const factor = 1 - (e / 255) * strength;
            r = Math.min(255, Math.round(r * factor));
            g = Math.min(255, Math.round(g * factor));
            b = Math.min(255, Math.round(b * factor));

            if (eyeScore > 0.45) {
                const boost = eyeBoost + eyeScore * 0.3;
                r = Math.min(255, Math.round(r * boost));
                g = Math.min(255, Math.round(g * boost));
                b = Math.min(255, Math.round(b * boost));
                if (eyeScore > 0.6) {
                    const eyeLum = 0.299 * r + 0.587 * g + 0.114 * b;
                    if (eyeLum > 100 && eyeLum < 200) {
                        b = Math.min(255, Math.round(b * 1.1));
                        r = Math.max(0, Math.round(r * 0.95));
                    }
                    if (eyeLum > 150) {
                        r = Math.min(255, r + 25);
                        g = Math.min(255, g + 25);
                        b = Math.min(255, b + 35);
                    }
                }
            }

            r = Math.min(255, Math.round(r * brightness));
            g = Math.min(255, Math.round(g * brightness));
            b = Math.min(255, Math.round(b * brightness));

            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }

        ctx.putImageData(imageData, 0, 0);

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = w;
        finalCanvas.height = h;
        const fctx = finalCanvas.getContext('2d');
        fctx.filter = `contrast(${contrast}) saturate(1.05) brightness(1.02)`;
        fctx.drawImage(canvas, 0, 0);

        const sharpCanvas = document.createElement('canvas');
        sharpCanvas.width = w;
        sharpCanvas.height = h;
        const sctx = sharpCanvas.getContext('2d');
        sctx.filter = 'contrast(1.05)';
        sctx.drawImage(finalCanvas, 0, 0);

        return sharpCanvas;
    }

    // --- CARTOONIFY ---
    function cartoonifyCurrent() {
        if (!currentImage) return;
        try {
            const cartoonCanvas = applyCartoonEffect(currentImage, currentStyle);
            currentCartoonDataURL = cartoonCanvas.toDataURL('image/png');

            cartoonWrapper.innerHTML = '';
            cartoonWrapper.appendChild(cartoonCanvas);
            cartoonCanvas.style.width = '100%';
            cartoonCanvas.style.height = '100%';
            cartoonCanvas.style.objectFit = 'cover';
            cartoonCanvas.style.display = 'block';

            const watermark = document.createElement('div');
            watermark.className = 'watermark-preview';
            watermark.textContent = '🔒 PREVIEW';
            cartoonWrapper.appendChild(watermark);

            isPaid = false;
            transactionId = null;
            downloadBtn.classList.remove('btn-download-unlocked');
            downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';

            paymentSuccessMsg.classList.remove('show');
            paymentStatus.textContent = 'Choose a payment method above';
            paymentStatus.className = 'payment-status';
            modal.classList.remove('show');

        } catch (e) {
            console.warn(e);
        }
    }

    // --- DOWNLOAD HANDLER ---
    function performDownload() {
        if (!isPaid) {
            modal.classList.add('show');
            return;
        }

        const el = cartoonWrapper.querySelector('canvas');
        if (!el) {
            alert('No cartoon available. Please upload and cartoonify first.');
            return;
        }

        const link = document.createElement('a');
        link.download = `toon_${currentStyle}.png`;
        link.href = el.toDataURL('image/png');
        link.click();
    }

    function handleDownloadClick() {
        if (!currentCartoonDataURL) {
            alert('Please upload an image and click "Cartoonify" first!');
            return;
        }

        if (isPaid) {
            performDownload();
        } else {
            modal.classList.add('show');
            paymentStatus.textContent = 'Choose a payment method below';
            paymentStatus.className = 'payment-status';
        }
    }

    // ================================================================
    // 7. EVENT LISTENERS
    // ================================================================
    uploadZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (fileInput.files && fileInput.files.length > 0) {
            loadImageFromFile(fileInput.files[0]);
        }
    });

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.background = '#6b4c3b';
        uploadZone.style.borderColor = '#ffdd33';
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.style.background = '#5c4032';
        uploadZone.style.borderColor = '#f7e600';
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.background = '#5c4032';
        uploadZone.style.borderColor = '#f7e600';
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            loadImageFromFile(files[0]);
        } else {
            alert('Drop an image file.');
        }
    });

    cartoonifyBtn.addEventListener('click', cartoonifyCurrent);
    resetBtn.addEventListener('click', resetDisplay);
    downloadBtn.addEventListener('click', handleDownloadClick);

    closeModalBtn.addEventListener('click', () => modal.classList.remove('show'));

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
    });

    // ================================================================
    // 8. INITIALIZATION
    // ================================================================
    document.addEventListener('DOMContentLoaded', async () => {
        // Load config
        await loadConfigFromEnv();
        
        // Render PayPal button
        await renderPayPalButton();
        
        // Setup credit/debit card button
        setupCardPayment();
        
        console.log('✅ PhouitLab ready!');
        console.log('📝 CONFIG:', CONFIG);
    });

    resetDisplay();

})();
