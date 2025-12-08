const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { chromium } = require("playwright");
const axios = require("axios");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

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


// --------------- LOGIN ROUTE -------------------
app.post("/login-social", async (req, res) => {
    const platform=req.body;
    // const { username, password, platform,
    //     proxy_host, proxy_port, proxy_username, proxy_password } = req.body;

    // if (!LOGIN_URL[platform]) {
    //     return res.json({ success: false, message: "Platform not supported" });
    // }

    // console.log("🌍 Login:", platform);

     try {
    //     const browser = await chromium.launch({
    //         headless: false,
    //         proxy: proxy_host ? {
    //             server: `http://${proxy_host}:${proxy_port}`,
    //             username: proxy_username || undefined,
    //             password: proxy_password || undefined,
    //         } : undefined,
    //     });

    //     const page = await browser.newPage();
    //     await page.goto(LOGIN_URL[platform], { timeout: 60000 });

    //     // ======== CAPTCHA DETECT =========
    //     const captchaExists = await page.locator('iframe[src*="recaptcha"]').count();
    //     if (captchaExists > 0) {
    //         console.log("⚠ CAPTCHA FOUND!");
    //         const token = await solveCaptcha(LOGIN_URL[platform], "6Ld2VCkUAAAAACPXeu5YgGDis45w");
    //         await page.evaluate(`document.getElementById("g-recaptcha-response").value="${token}"`);
    //     }

    //     console.log("🔐 filling credentials...");

        switch (platform) {
            case "instagram":
                await page.fill('input[name="username"]', username);
                await page.fill('input[name="password"]', password);
                await page.click('button[type="submit"]');
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
        }

        await page.waitForTimeout(7000);

        res.json({ success: true, message: "Login attempted successfully (browser open)" });

    } catch (error) {
        console.log(error);
        res.json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Node API running http://localhost:${PORT}`);
});
