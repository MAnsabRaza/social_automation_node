const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { chromium } = require("playwright");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// === Your CapSolver Key ===
const CAPSOLVER_API_KEY = "CAP-ED4178FF70C174EB79EDF60846570312670376A951B815C52C7113DC914E7F42";

async function solveCaptcha(siteURL, siteKey) {
    console.log("🧩 Solving Captcha...");

    const createTask = await axios.post(
        "https://api.capsolver.com/createTask",
        {
            clientKey: CAPSOLVER_API_KEY,
            task: {
                type: "ReCaptchaV2TaskProxyLess",
                websiteURL: siteURL,
                websiteKey: siteKey,
            }
        }
    );

    const taskId = createTask.data.taskId;
    console.log("🧩 taskId:", taskId);

    while (true) {
        const result = await axios.post(
            "https://api.capsolver.com/getTaskResult",
            {
                clientKey: CAPSOLVER_API_KEY,
                taskId: taskId
            }
        );

        if (result.data.status === "ready") {
            console.log("🟢 Captcha Solved!");
            return result.data.solution.gRecaptchaResponse;
        }

        await new Promise(x => setTimeout(x, 5000));
    }
}

// PLATFORM URLS
const LOGIN_URL = {
    instagram: "https://www.instagram.com/accounts/login/",
    facebook: "https://www.facebook.com/login/",
    youtube: "https://accounts.google.com",
    tiktok: "https://www.tiktok.com/login",
    twitter: "https://twitter.com/login",
    linkedin: "https://www.linkedin.com/login"
};
let activeBrowsers = {};   // store browsers and pages
let activeContexts = {};

app.post("/login-social", async (req, res) => {
    const { username, password, platform, account_id,
        proxy_host, proxy_port, proxy_username, proxy_password } = req.body;

    if (!LOGIN_URL[platform]) {
        return res.json({ success: false, message: "Platform not supported" });
    }

    console.log("Login attempt:", platform, "Account ID:", account_id);

    try {
        // Reuse existing browser if already logged in
        if (activeBrowsers[account_id]) {
            const context = activeContexts[account_id];
            const storageState = await context.storageState();

            return res.json({
                success: true,
                message: "Already logged in - session reused",
                sessionData: JSON.stringify(storageState),
                cookies: storageState.cookies,
                authToken: extractAuthToken(storageState.cookies, platform)
            });
        }

        // Launch new browser
        const browser = await chromium.launch({
            headless: false, // Keep false for debugging Instagram/FB
            proxy: proxy_host ? {
                server: `http://${proxy_host}:${proxy_port}`,
                username: proxy_username || undefined,
                password: proxy_password || undefined,
            } : undefined,
        });

        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
        });

        const page = await context.newPage();
        activeBrowsers[account_id] = browser;
        activeContexts[account_id] = context;

        await page.goto(LOGIN_URL[platform], { waitUntil: "networkidle", timeout: 60000 });

        // === Handle CAPTCHA if exists ===
        const captchaFrame = page.frameLocator('iframe[src*="recaptcha"]');
        if (await captchaFrame.locator('#recaptcha').isVisible().catch(() => false)) {
            console.log("Captcha detected, solving...");
            const siteKey = await page.locator('[data-sitekey]').getAttribute('data-sitekey').catch(() => "6Ld2VCkUAAAAACPXeu5YgGDis45w..."); // fallback
            const token = await solveCaptcha(LOGIN_URL[platform], siteKey || "6Ld2VCkUAAAAACPXeu5YgGDis45w...");
            await page.evaluate((t) => {
                document.querySelector('textarea#g-recaptcha-response').value = t;
                if (window.grecaptcha) grecaptcha.getResponse = () => t;
            }, token);
            await page.waitForTimeout(2000);
        }

        // === PLATFORM-SPECIFIC LOGIN ===
        switch (platform) {
            case "instagram":
                await page.fill('input[name="username"]', username);
                await page.fill('input[name="password"]', password);
                await page.click('button[type="submit"]');

                // Wait for navigation after login
                await page.waitForURL("https://www.instagram.com/**", { timeout: 30000 }).catch(() => {});
                
                // Handle "Save Your Login Info?" → Click "Not Now"
                await page.click('text=Not now').catch(() => {});
                // Handle notifications → "Not Now"
                await page.click('button:has-text("Not Now")').catch(() => {});

                await page.waitForTimeout(5000);
                break;
                 case "facebook":
                await page.fill("#email", username);
                await page.fill("#pass", password);
                await page.click('button[name="login"]');
                break;

            case "twitter":
                await page.fill('input[name="text"]', username);
                await page.keyboard.press("Enter");
                await page.waitForTimeout(3000);
                await page.fill('input[name="password"]', password);
                await page.keyboard.press("Enter");
                break;

            case "tiktok":
                await page.fill('input[name="username"]', username);
                await page.fill('input[name="password"]', password);
                await page.click('button');
                break;

            case "linkedin":
                await page.fill("#username", username);
                await page.fill("#password", password);
                await page.click('button[type="submit"]');
                break;

            case "youtube":
                await page.fill("input[type=email]", username);
                await page.keyboard.press("Enter");
                await page.waitForTimeout(3000);
                await page.fill("input[type=password]", password);
                await page.keyboard.press("Enter");
                break;
                

            // Add other platforms with similar "Not Now" handling...
        }

        // === SAVE SESSION AFTER SUCCESSFUL LOGIN ===
        const storageState = await context.storageState();

        // Extract auth token
        const authToken = extractAuthToken(storageState.cookies, platform);

        console.log("Login successful for account:", account_id);

        res.json({
            success: true,
            message: "Login successful",
            sessionData: JSON.stringify(storageState),
            cookies: storageState.cookies,
            authToken: authToken || null
        });

    } catch (error) {
        console.error("Login failed:", error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});


// --------------- CHECK LOGIN STATUS -------------------
app.post("/check-login", async (req, res) => {
    const { platform, cookies, sessionData, proxy_host, proxy_port, proxy_username, proxy_password } = req.body;

    if (!cookies || !sessionData) {
        return res.json({ success: false, isLoggedIn: false, message: "No session data found" });
    }

    try {
        const browser = await chromium.launch({
            headless: true,
            proxy: proxy_host ? {
                server: `http://${proxy_host}:${proxy_port}`,
                username: proxy_username || undefined,
                password: proxy_password || undefined,
            } : undefined,
        });

        const parsedSessionData = JSON.parse(sessionData);
        const context = await browser.newContext({ storageState: parsedSessionData });
        const page = await context.newPage();

        // Check if logged in by navigating to home page
        const homeUrls = {
            instagram: "https://www.instagram.com/",
            facebook: "https://www.facebook.com/",
            twitter: "https://twitter.com/home",
            linkedin: "https://www.linkedin.com/feed/",
            youtube: "https://www.youtube.com/",
            tiktok: "https://www.tiktok.com/foryou"
        };

        await page.goto(homeUrls[platform] || LOGIN_URL[platform], { timeout: 30000 });
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        const isLoggedIn = !currentUrl.includes('/login') && !currentUrl.includes('/signin');

        await browser.close();

        res.json({ success: true, isLoggedIn });

    } catch (error) {
        console.log(error);
        res.json({ success: false, isLoggedIn: false, error: error.message });
    }
});

// --------------- POST WITH SESSION REUSE -------------------
app.post("/post-social", async (req, res) => {
    const {
        platform, content, image, hashtags,
        sessionData, account_id,
        proxy_host, proxy_port, proxy_username, proxy_password
    } = req.body;

    let browser, context, page;

    try {
        browser = await chromium.launch({
            headless: false,
            proxy: proxy_host ? { server: `http://${proxy_host}:${proxy_port}`, username: proxy_username, password: proxy_password } : undefined
        });

        // Reuse saved session if provided
        if (sessionData) {
            context = await browser.newContext({
                storageState: JSON.parse(sessionData)
            });
            console.log("Reusing saved session");
        } else {
            return res.json({ success: false, message: "No sessionData provided" });
        }

        page = await context.newPage();
        await page.goto("https://www.instagram.com/", { timeout: 60000 });

        // Check if still logged in
        const isLoginPage = await page.locator('input[name="username"]').isVisible().catch(() => false);
        if (isLoginPage) {
            return res.json({ success: false, message: "Session expired - login required" });
        }

        // Go to create post
        await page.goto("https://www.instagram.com/create/select/");
        await page.waitForTimeout(5000);

        // Upload image
        if (image) {
            const filePath = path.join(__dirname, "temp_upload.png");
            fs.writeFileSync(filePath, Buffer.from(image.split(';base64,').pop(), 'base64'));
            await page.setInputFiles('input[type="file"]', filePath);
            await page.waitForTimeout(7000);
        }

        await page.click('div[role="button"]:has-text("Next")', { timeout: 10000 });
        await page.waitForTimeout(2000);
        await page.click('div[role="button"]:has-text("Next")', { timeout: 10000 });
        await page.waitForTimeout(2000);

        await page.fill('textarea', `${content}\n\n${hashtags}`);
        await page.waitForTimeout(2000);

        await page.click('div[role="button"]:has-text("Share")');
        await page.waitForTimeout(8000);

        // Return updated session (in case cookies changed)
        const updatedState = await context.storageState();

        res.json({
            success: true,
            message: "Posted successfully!",
            sessionData: JSON.stringify(updatedState)
        });

    } catch (err) {
        console.error("Post failed:", err);
        res.json({ success: false, message: err.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
});

// Helper function to extract auth token
function extractAuthToken(cookies, platform) {
    const tokenMap = {
        instagram: 'sessionid',
        facebook: 'c_user',
        twitter: 'auth_token',
        linkedin: 'li_at',
        youtube: 'SAPISID',
        tiktok: 'sessionid'
    };

    const tokenName = tokenMap[platform];
    const cookie = cookies.find(c => c.name === tokenName);
    return cookie ? cookie.value : null;
}

app.listen(PORT, () => {
    console.log(`🚀 Node API running http://localhost:${PORT}`);
});