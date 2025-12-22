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
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// === Your CapSolver Key ===
const CAPSOLVER_API_KEY =
  "CAP-ED4178FF70C174EB79EDF60846570312670376A951B815C52C7113DC914E7F42";

async function solveCaptcha(siteURL, siteKey) {
  console.log("🧩 Solving Captcha...");

  const createTask = await axios.post("https://api.capsolver.com/createTask", {
    clientKey: CAPSOLVER_API_KEY,
    task: {
      type: "ReCaptchaV2TaskProxyLess",
      websiteURL: siteURL,
      websiteKey: siteKey,
    },
  });

  const taskId = createTask.data.taskId;
  console.log("🧩 taskId:", taskId);

  while (true) {
    const result = await axios.post("https://api.capsolver.com/getTaskResult", {
      clientKey: CAPSOLVER_API_KEY,
      taskId: taskId,
    });

    if (result.data.status === "ready") {
      console.log("🟢 Captcha Solved!");
      return result.data.solution.gRecaptchaResponse;
    }

    await new Promise((x) => setTimeout(x, 5000));
  }
}

// PLATFORM URLS
const LOGIN_URL = {
  instagram: "https://www.instagram.com/accounts/login/",
  facebook: "https://www.facebook.com/login/",
  youtube: "https://accounts.google.com",
  tiktok: "https://www.tiktok.com/login/phone-or-email/email",
  twitter: "https://twitter.com/login",
  linkedin: "https://www.linkedin.com/login",
};
let activeBrowsers = {}; // store browsers and pages
let activeContexts = {};

// app.post("/login-social", async (req, res) => {
//   const {
//     username,
//     password,
//     platform,
//     account_id,
//     proxy_host,
//     proxy_port,
//     proxy_username,
//     proxy_password,
//   } = req.body;

//   if (!LOGIN_URL[platform]) {
//     return res.json({ success: false, message: "Platform not supported" });
//   }

//   console.log(`🌐 Login attempt → ${platform} | Account ID: ${account_id}`);

//   try {
//     // Reuse session if browser is already running
//     if (activeBrowsers[account_id]) {
//       const context = activeContexts[account_id];
//       const storageState = await context.storageState();

//       return res.json({
//         success: true,
//         message: "Already logged in - session reused",
//         sessionData: JSON.stringify(storageState),
//         cookies: storageState.cookies,
//         authToken: extractAuthToken(storageState.cookies, platform),
//       });
//     }

//     // Launch new browser
//     const browser = await chromium.launch({
//       headless: true,
//       proxy: proxy_host
//         ? {
//             server: `http://${proxy_host}:${proxy_port}`,
//             username: proxy_username || undefined,
//             password: proxy_password || undefined,
//           }
//         : undefined,
//     });

//     const context = await browser.newContext({
//       userAgent:
//         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
//       locale: "en-US",
//       timezoneId: "America/New_York",
//       permissions: ["geolocation", "notifications"],
//     });

//     activeBrowsers[account_id] = browser;
//     activeContexts[account_id] = context;

//     const page = await context.newPage();

//     console.log("⏳ Loading login page...");

//     // FIX: Instagram never reaches "networkidle" → replaced
//     await page.goto(LOGIN_URL[platform], {
//       waitUntil: "domcontentloaded",
//       timeout: 60000,
//     });

//     await page.waitForTimeout(2500); // Let IG/FB scripts load

//     // --------------------------
//     //     PLATFORM LOGINS
//     // --------------------------

//     switch (platform) {
//       case "instagram":
//         await page.waitForSelector('input[name="username"]', {
//           timeout: 30000,
//         });

//         await page.fill('input[name="username"]', username);
//         await page.fill('input[name="password"]', password);

//         await page.click('button[type="submit"]');

//         // Wait for login redirect
//         await page.waitForTimeout(5000);

//         // Dismiss popups
//         await page.click("text=Not now").catch(() => {});
//         await page.click('button:has-text("Not Now")').catch(() => {});

//         break;

//       case "facebook":
//         await page.waitForSelector("#email", { timeout: 20000 });
//         await page.fill("#email", username);
//         await page.fill("#pass", password);
//         await page.click('button[name="login"]');
//         break;

//       case "twitter":
//         await page.waitForSelector('input[name="text"]', { timeout: 20000 });
//         await page.fill('input[name="text"]', username);
//         await page.keyboard.press("Enter");

//         await page.waitForTimeout(3000);
//         await page.fill('input[name="password"]', password);
//         await page.keyboard.press("Enter");
//         break;

//       case "tiktok":
//         await page.waitForTimeout(3000);
//         await page.fill('input[name="username"]', username);
//         await page.fill('input[name="password"]', password);
//         await page.click("button");
//         break;

//       case "linkedin":
//         await page.waitForSelector("#username", { timeout: 20000 });
//         await page.fill("#username", username);
//         await page.fill("#password", password);
//         await page.click('button[type="submit"]');
//         break;

//       case "youtube":
//         await page.waitForSelector('input[type="email"]', { timeout: 20000 });
//         await page.fill("input[type=email]", username);
//         await page.keyboard.press("Enter");

//         await page.waitForTimeout(3000);
//         await page.fill("input[type=password]", password);
//         await page.keyboard.press("Enter");
//         break;
//     }

//     // Allow cookie/session setup
//     await page.waitForTimeout(5000);

//     // Save session
//     const storageState = await context.storageState();
//     const authToken = extractAuthToken(storageState.cookies, platform);

//     console.log(`✅ Login successful → ${account_id}`);

//     return res.json({
//       success: true,
//       message: "Login successful",
//       sessionData: JSON.stringify(storageState),
//       cookies: storageState.cookies,
//       authToken: authToken,
//     });
//   } catch (error) {
//     console.error("❌ Login failed:", error.message);

//     return res.json({
//       success: false,
//       message: "Login error",
//       error: error.message,
//     });
//   }
// });
// // --------------- CHECK LOGIN STATUS -------------------
// app.post("/check-login", async (req, res) => {
//   const {
//     platform,
//     cookies,
//     sessionData,
//     proxy_host,
//     proxy_port,
//     proxy_username,
//     proxy_password,
//   } = req.body;

//   if (!cookies || !sessionData) {
//     return res.json({
//       success: false,
//       isLoggedIn: false,
//       message: "No session data found",
//     });
//   }

//   try {
//     const browser = await chromium.launch({
//       headless: true,
//       proxy: proxy_host
//         ? {
//             server: `http://${proxy_host}:${proxy_port}`,
//             username: proxy_username || undefined,
//             password: proxy_password || undefined,
//           }
//         : undefined,
//     });

//     const parsedSessionData = JSON.parse(sessionData);
//     const context = await browser.newContext({
//       storageState: parsedSessionData,
//     });
//     const page = await context.newPage();

//     // Check if logged in by navigating to home page
//     const homeUrls = {
//       instagram: "https://www.instagram.com/",
//       facebook: "https://www.facebook.com/",
//       twitter: "https://twitter.com/home",
//       linkedin: "https://www.linkedin.com/feed/",
//       youtube: "https://www.youtube.com/",
//       tiktok: "https://www.tiktok.com/foryou",
//     };

//     await page.goto(homeUrls[platform] || LOGIN_URL[platform], {
//       timeout: 30000,
//     });
//     await page.waitForTimeout(3000);

//     const currentUrl = page.url();
//     const isLoggedIn =
//       !currentUrl.includes("/login") && !currentUrl.includes("/signin");

//     await browser.close();

//     res.json({ success: true, isLoggedIn });
//   } catch (error) {
//     console.log(error);
//     res.json({ success: false, isLoggedIn: false, error: error.message });
//   }
// });

// app.post("/execute-task", async (req, res) => {
//   const { task, account } = req.body;

//   console.log("📋 Executing Task:", task);

//   if (!task || !account) {
//     return res.json({
//       success: false,
//       message: "Missing task or account data",
//     });
//   }

//   const platform = account.platform;
//   const taskType = task.task_type;

//   try {
//     let browser, context, page;

//     if (activeBrowsers[account.id]) {
//       console.log("♻️ Reusing existing browser session");
//       browser = activeBrowsers[account.id];
//       context = activeContexts[account.id];
//       page = await context.newPage();
//     } else {
//       console.log("🚀 Launching new browser session");

//       let storageState = null;
//       if (account.session_data) {
//         try {
//           storageState = JSON.parse(account.session_data);
//         } catch {}
//       }

//       browser = await chromium.launch({
//         headless: false,
//         proxy: account.proxy_id
//           ? {
//               server: `http://${account.proxy.host}:${account.proxy.port}`,
//               username: account.proxy.username || undefined,
//               password: account.proxy.password || undefined,
//             }
//           : undefined,
//       });

//       context = await browser.newContext({
//         storageState,
//         userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0",
//         locale: "en-US",
//       });

//       activeBrowsers[account.id] = browser;
//       activeContexts[account.id] = context;

//       page = await context.newPage();
//     }

//     // ✅ POST TASK
//     if (taskType === "post") {
//       return res.json(await createPost(page, platform, task));
//     }

//     if (taskType === "follow") {
//       return res.json(await followUser(page, platform, task.target_url));
//     }

//     if (taskType === "unfollow") {
//       return res.json(await unfollowUser(page, platform, task.target_url));
//     }

//     if (taskType === "like") {
//       const result = await likePost(page, platform, task.target_url);
//       return res.json(result);
//     }
//     if (taskType === "comment") {
//       return res.json(
//         await commentOnPost(page, platform, task.target_url, task.comment)
//       );
//     }

//     return res.json({
//       success: false,
//       message: `Task type ${taskType} not supported`,
//     });
//   } catch (error) {
//     console.error("❌ Task execution failed:", error.message);
//     return res.json({
//       success: false,
//       message: error.message,
//     });
//   }
// });

// Modified /login-social endpoint (proxy parameters removed)


// At the top of your server.js file


// LOGIN ENDPOINT - Replace your existing app.post("/login-social"...)
app.post("/login-social", async (req, res) => {
  const { username, password, platform, account_id } = req.body;

  if (!LOGIN_URL[platform]) {
    return res.json({ success: false, message: "Platform not supported" });
  }

  console.log(`🌐 Login attempt → ${platform} | Account ID: ${account_id}`);

  try {
    // Reuse session if browser is already running
    if (activeBrowsers[account_id]) {
      const context = activeContexts[account_id];
      const storageState = await context.storageState();

      return res.json({
        success: true,
        message: "Already logged in - session reused",
        sessionData: JSON.stringify(storageState),
        cookies: storageState.cookies,
        authToken: extractAuthToken(storageState.cookies, platform),
      });
    }

    // Launch new browser
    const browser = await chromium.launch({
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["geolocation", "notifications"],
      viewport: { width: 1280, height: 720 },
    });

    activeBrowsers[account_id] = browser;
    activeContexts[account_id] = context;

    const page = await context.newPage();

    console.log("⏳ Loading login page...");

    await page.goto(LOGIN_URL[platform], {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(2500);

    switch (platform) {
      case "instagram":
        await page.waitForSelector('input[name="username"]', {
          timeout: 30000,
        });
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
        await page.click("text=Not now").catch(() => {});
        await page.click('button:has-text("Not Now")').catch(() => {});
        break;

      case "facebook":
        await page.waitForSelector("#email", { timeout: 20000 });
        await page.fill("#email", username);
        await page.fill("#pass", password);
        await page.click('button[name="login"]');
        await page.waitForTimeout(5000);
        break;

      case "twitter":
        console.log("🐦 Starting Twitter login flow...");
        const twitterEmail = req.body.email || username;
        const twitterUsername = req.body.twitter_username || username;
        console.log("📧 Using email:", twitterEmail);
        console.log("👤 Using username:", twitterUsername);

        await page.waitForTimeout(3000);

        // STEP 1: Enter Email
        console.log("📧 STEP 1: Entering email...");
        const emailSelectors = [
          'input[autocomplete="username"]',
          'input[name="text"]',
          'input[type="text"]',
          'input[autocomplete="email"]',
        ];

        let emailEntered = false;
        for (const selector of emailSelectors) {
          try {
            const input = await page.waitForSelector(selector, {
              timeout: 5000,
              state: "visible",
            });
            if (input) {
              await input.click();
              await page.waitForTimeout(500);
              await input.fill(twitterEmail);
              console.log("✅ Email entered successfully");
              emailEntered = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!emailEntered) {
          throw new Error("Could not find email input field");
        }

        await page.waitForTimeout(1000);
        try {
          const nextButton1 = page.locator('div[role="button"]:has-text("Next")').first();
          if (await nextButton1.isVisible({ timeout: 3000 })) {
            await nextButton1.click();
          } else {
            await page.keyboard.press("Enter");
          }
        } catch (e) {
          await page.keyboard.press("Enter");
        }

        await page.waitForTimeout(4000);

        // STEP 2: Enter Username (if required)
        console.log("👤 STEP 2: Checking for username verification...");
        const usernameSelectors = [
          'input[data-testid="ocfEnterTextTextInput"]',
          'input[name="text"]',
          'input[type="text"]',
        ];

        let usernameEntered = false;
        for (const selector of usernameSelectors) {
          try {
            const usernameInput = await page.waitForSelector(selector, {
              timeout: 5000,
              state: "visible",
            });
            if (usernameInput) {
              console.log("📱 Username verification detected");
              await usernameInput.click();
              await page.waitForTimeout(500);
              const cleanUsername = twitterUsername.replace("@", "");
              await usernameInput.fill(cleanUsername);
              console.log("✅ Username entered:", cleanUsername);
              usernameEntered = true;

              await page.waitForTimeout(1000);
              try {
                const nextButton2 = page.locator('div[role="button"]:has-text("Next")').first();
                if (await nextButton2.isVisible({ timeout: 3000 })) {
                  await nextButton2.click();
                } else {
                  await page.keyboard.press("Enter");
                }
              } catch (e) {
                await page.keyboard.press("Enter");
              }
              await page.waitForTimeout(4000);
              break;
            }
          } catch (e) {
            continue;
          }
        }

        // STEP 3: Enter Password
        console.log("🔐 STEP 3: Entering password...");
        const passwordSelectors = [
          'input[name="password"]',
          'input[type="password"]',
          'input[autocomplete="current-password"]',
        ];

        let passwordEntered = false;
        for (const selector of passwordSelectors) {
          try {
            const input = await page.waitForSelector(selector, {
              timeout: 8000,
              state: "visible",
            });
            if (input) {
              await input.click();
              await page.waitForTimeout(500);
              await input.fill(password);
              console.log("✅ Password entered successfully");
              passwordEntered = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!passwordEntered) {
          throw new Error("Could not find password input field");
        }

        await page.waitForTimeout(1500);
        const loginButtonSelectors = [
          'div[data-testid="LoginForm_Login_Button"]',
          'div[role="button"]:has-text("Log in")',
          'button:has-text("Log in")',
        ];

        let loginClicked = false;
        for (const selector of loginButtonSelectors) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 3000 })) {
              await btn.click();
              console.log("✅ Clicked Log in button");
              loginClicked = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!loginClicked) {
          await page.keyboard.press("Enter");
        }

        await page.waitForTimeout(8000);
        console.log("✅ Twitter login successful!");
        break;

      case "tiktok":
        console.log("🎵 Starting TikTok login flow...");
        const tiktokEmail = req.body.email || username;
        console.log("📧 Using email:", tiktokEmail);

        await page.waitForTimeout(4000);

        // Enter Email
        const tiktokEmailSelectors = [
          'input[type="text"]',
          'input[name="email"]',
          'input[placeholder*="email" i]',
        ];

        let tiktokEmailEntered = false;
        for (const selector of tiktokEmailSelectors) {
          try {
            const input = await page.waitForSelector(selector, {
              timeout: 5000,
              state: "visible",
            });
            if (input) {
              await input.click();
              await page.waitForTimeout(500);
              await input.fill(tiktokEmail);
              console.log("✅ Email entered");
              tiktokEmailEntered = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!tiktokEmailEntered) {
          throw new Error("Could not find TikTok email input");
        }

        // Enter Password
        const tiktokPasswordSelectors = [
          'input[type="password"]',
          'input[name="password"]',
        ];

        let tiktokPasswordEntered = false;
        for (const selector of tiktokPasswordSelectors) {
          try {
            const input = await page.waitForSelector(selector, {
              timeout: 5000,
              state: "visible",
            });
            if (input) {
              await input.click();
              await page.waitForTimeout(500);
              await input.fill(password);
              console.log("✅ Password entered");
              tiktokPasswordEntered = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!tiktokPasswordEntered) {
          throw new Error("Could not find TikTok password input");
        }

        // Click Login
        await page.waitForTimeout(1000);
        const tiktokLoginSelectors = [
          'button[type="submit"]',
          'button:has-text("Log in")',
          'button[data-e2e="login-button"]',
        ];

        let tiktokLoginClicked = false;
        for (const selector of tiktokLoginSelectors) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 3000 })) {
              await btn.click();
              console.log("✅ Clicked login button");
              tiktokLoginClicked = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!tiktokLoginClicked) {
          await page.keyboard.press("Enter");
        }

        await page.waitForTimeout(8000);

        // Check for CAPTCHA
        const captchaVisible = await page
          .locator('div:has-text("Verify")')
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (captchaVisible) {
          console.log("⚠️ CAPTCHA detected - waiting 45 seconds...");
          await page.waitForTimeout(45000);
        }

        console.log("✅ TikTok login completed!");
        break;

      case "linkedin":
        await page.waitForSelector("#username", { timeout: 20000 });
        await page.fill("#username", username);
        await page.fill("#password", password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
        break;

      case "youtube":
        await page.waitForSelector('input[type="email"]', { timeout: 20000 });
        await page.fill("input[type=email]", username);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3000);
        await page.fill("input[type=password]", password);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(5000);
        break;
    }

    await page.waitForTimeout(5000);

    const storageState = await context.storageState();
    const authToken = extractAuthToken(storageState.cookies, platform);

    console.log(`✅ Login successful → ${account_id}`);

    return res.json({
      success: true,
      message: "Login successful",
      sessionData: JSON.stringify(storageState),
      cookies: storageState.cookies,
      authToken: authToken,
    });
  } catch (error) {
    console.error("❌ Login failed:", error.message);

    return res.json({
      success: false,
      message: "Login error",
      error: error.message,
    });
  }
});

// --------------- CHECK LOGIN STATUS -------------------
app.post("/check-login", async (req, res) => {
  const { platform, cookies, sessionData } = req.body;

  if (!cookies || !sessionData) {
    return res.json({
      success: false,
      isLoggedIn: false,
      message: "No session data found",
    });
  }

  try {
    const browser = await chromium.launch({
      headless: true,
    });

    const parsedSessionData = JSON.parse(sessionData);
    const context = await browser.newContext({
      storageState: parsedSessionData,
    });
    const page = await context.newPage();

    const homeUrls = {
      instagram: "https://www.instagram.com/",
      facebook: "https://www.facebook.com/",
      twitter: "https://twitter.com/home",
      linkedin: "https://www.linkedin.com/feed/",
      youtube: "https://www.youtube.com/",
      tiktok: "https://www.tiktok.com/foryou",
    };

    await page.goto(homeUrls[platform] || LOGIN_URL[platform], {
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const isLoggedIn =
      !currentUrl.includes("/login") && !currentUrl.includes("/signin");

    await browser.close();

    res.json({ success: true, isLoggedIn });
  } catch (error) {
    console.log(error);
    res.json({ success: false, isLoggedIn: false, error: error.message });
  }
});

// --------------- EXECUTE TASK -------------------
app.post("/execute-task", async (req, res) => {
  const { task, account } = req.body;

  console.log("📋 Executing Task:", task);

  if (!task || !account) {
    return res.json({
      success: false,
      message: "Missing task or account data",
    });
  }

  const platform = account.platform;
  const taskType = task.task_type;

  try {
    let browser, context, page;

    if (activeBrowsers[account.id]) {
      console.log("♻️ Reusing existing browser session");
      browser = activeBrowsers[account.id];
      context = activeContexts[account.id];
      page = await context.newPage();
    } else {
      console.log("🚀 Launching new browser session");

      let storageState = null;
      if (account.session_data) {
        try {
          storageState = JSON.parse(account.session_data);
        } catch (e) {
          console.log("⚠️ Failed to parse session data:", e.message);
        }
      }

      browser = await chromium.launch({
        headless: false, // Browser will be visible
        slowMo: 100, // Slow down operations by 100ms for visibility
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--start-maximized",
        ],
      });

      context = await browser.newContext({
        storageState,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        locale: "en-US",
        viewport: { width: 1280, height: 720 },
        permissions: ["geolocation", "notifications"],
      });

      activeBrowsers[account.id] = browser;
      activeContexts[account.id] = context;

      page = await context.newPage();
    }

    // Task execution logic
    if (taskType === "post") {
      return res.json(await createPost(page, platform, task));
    }

    if (taskType === "follow") {
      return res.json(await followUser(page, platform, task.target_url));
    }

    if (taskType === "unfollow") {
      return res.json(await unfollowUser(page, platform, task.target_url));
    }

    if (taskType === "like") {
      const result = await likePost(page, platform, task.target_url);
      return res.json(result);
    }

    if (taskType === "comment") {
      return res.json(
        await commentOnPost(page, platform, task.target_url, task.comment)
      );
    }

    return res.json({
      success: false,
      message: `Task type ${taskType} not supported`,
    });
  } catch (error) {
    console.error("❌ Task execution failed:", error.message);
    return res.json({
      success: false,
      message: error.message,
    });
  }
});

// Add endpoint to close browser for an account
app.post("/close-browser", async (req, res) => {
  const { account_id } = req.body;

  try {
    if (activeBrowsers[account_id]) {
      await activeBrowsers[account_id].close();
      delete activeBrowsers[account_id];
      delete activeContexts[account_id];
      console.log(`🔒 Browser closed for account ${account_id}`);
      return res.json({ success: true, message: "Browser closed" });
    }

    return res.json({ success: true, message: "No active browser found" });
  } catch (error) {
    console.error("❌ Failed to close browser:", error.message);
    return res.json({ success: false, message: error.message });
  }
});
async function createPost(page, platform, task) {
  console.log(`📝 Creating post on ${platform}...`);

  try {
    if (platform === "instagram") {
      return await createInstagramPost(page, task);
    }

    if (platform === "facebook") {
      return await createFacebookPost(page, task);
    }
    if (platform === "twitter") {
      return await createTwitterPost(page, task);
    }

    return {
      success: false,
      message: `Platform ${platform} not supported`,
    };
  } catch (error) {
    console.error(`❌ Failed to create post on ${platform}:`, error.message);
    return {
      success: false,
      message: error.message,
    };
  }
}

// ==========================================
// INSTAGRAM POST
// ==========================================
async function createInstagramPost(page, postContent) {
  console.log("📸 Creating Instagram post...");

  try {
    // 1️⃣ Open Instagram
    await page.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(5000);

    // 2️⃣ Close popups
    await page.click("text=Not now").catch(() => {});
    await page.click('button:has-text("Not Now")').catch(() => {});
    await page.waitForTimeout(2000);

    // 3️⃣ Click Create button
    const createButton = page
      .locator('svg[aria-label="New post"], svg[aria-label="Create"]')
      .first();

    await createButton.waitFor({ state: "visible", timeout: 20000 });
    await createButton.click();
    console.log("✅ Create clicked");

    await page.waitForTimeout(3000);

    // 4️⃣ Click "Post" option if available
    const postOption = page.locator('text="Post"').first();
    if (await postOption.isVisible().catch(() => false)) {
      await postOption.click();
      console.log("✅ Post option clicked");
      await page.waitForTimeout(2000);
    }

    // 5️⃣ Resolve image path
    const absoluteImagePath = path.join(
      "C:",
      "wamp64",
      "www",
      "social-automation",
      "public",
      postContent.media_urls
    );

    console.log("🔍 Looking for image at:", absoluteImagePath);

    if (!fs.existsSync(absoluteImagePath)) {
      throw new Error(`Image file not found: ${absoluteImagePath}`);
    }

    console.log("✅ Image file found");

    // 6️⃣ Upload using hidden input[type=file]
    const fileInput = page.locator('input[type="file"]');

    await fileInput.waitFor({ state: "attached", timeout: 20000 });
    await fileInput.setInputFiles(absoluteImagePath);

    console.log("✅ Image uploaded");

    // 7️⃣ Wait for preview and dialog to load
    await page.waitForTimeout(4000);

    // Wait for the crop dialog to be visible
    await page.locator('[role="dialog"]').waitFor({
      state: "visible",
      timeout: 15000,
    });

    console.log("✅ Crop dialog loaded");
    await page.waitForTimeout(2000);

    // 8️⃣ Click Next button (Crop/Edit step) - Using multiple strategies
    console.log("🔘 Attempting to click Next button (crop step)...");

    const nextButtonSelectors = [
      'div[role="button"]:has-text("Next")',
      'button:has-text("Next")',
      '//div[@role="button" and contains(text(), "Next")]',
      '[role="button"]:has-text("Next")',
      'div:text-is("Next")',
    ];

    let nextClicked = false;
    for (const selector of nextButtonSelectors) {
      try {
        const nextBtn = page.locator(selector).first();
        await nextBtn.waitFor({ state: "visible", timeout: 5000 });
        await nextBtn.click({ timeout: 5000 });
        console.log(`✅ Next clicked using selector: ${selector}`);
        nextClicked = true;
        break;
      } catch (e) {
        console.log(`⚠️ Selector failed: ${selector}`);
        continue;
      }
    }

    if (!nextClicked) {
      // Last resort: click by position (top-right of dialog)
      try {
        await page
          .locator("text=Next")
          .first()
          .click({ force: true, timeout: 5000 });
        console.log("✅ Next clicked using force click");
        nextClicked = true;
      } catch (e) {
        throw new Error(
          "Could not find or click Next button after image upload"
        );
      }
    }

    await page.waitForTimeout(4000);

    // 9️⃣ Click Next button again (Filters step)
    console.log("🔘 Attempting to click Next button (filters step)...");

    nextClicked = false;
    for (const selector of nextButtonSelectors) {
      try {
        const nextBtn = page.locator(selector).first();
        await nextBtn.waitFor({ state: "visible", timeout: 5000 });
        await nextBtn.click({ timeout: 5000 });
        console.log(`✅ Next clicked (filters) using selector: ${selector}`);
        nextClicked = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!nextClicked) {
      try {
        await page
          .locator("text=Next")
          .first()
          .click({ force: true, timeout: 5000 });
        console.log("✅ Next clicked (filters) using force click");
      } catch (e) {
        throw new Error("Could not find or click Next button on filters page");
      }
    }

    await page.waitForTimeout(4000);

    // 🔟 Add Caption
    console.log("📝 Adding caption...");

    const caption =
      (postContent.content || "") + "\n\n" + (postContent.hashtags || "");

    const captionSelectors = [
      'div[aria-label="Write a caption..."]',
      'textarea[aria-label*="caption"]',
      'div[contenteditable="true"]',
      '[aria-label*="Write a caption"]',
    ];

    let captionAdded = false;
    for (const selector of captionSelectors) {
      try {
        const captionBox = page.locator(selector).first();
        await captionBox.waitFor({ state: "visible", timeout: 5000 });
        await captionBox.click();
        await captionBox.fill(caption.trim());
        console.log("✅ Caption added");
        captionAdded = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!captionAdded) {
      console.log("⚠️ Could not add caption, continuing anyway...");
    }

    await page.waitForTimeout(2000);

    // 1️⃣1️⃣ Click Share button
    console.log("📤 Clicking Share button...");

    const shareSelectors = [
      'button:has-text("Share")',
      'div[role="button"]:has-text("Share")',
      '//div[@role="button" and contains(text(), "Share")]',
    ];

    let shareClicked = false;
    for (const selector of shareSelectors) {
      try {
        const shareBtn = page.locator(selector).first();
        await shareBtn.waitFor({ state: "visible", timeout: 5000 });
        await shareBtn.click({ timeout: 5000 });
        console.log("✅ Share button clicked");
        shareClicked = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!shareClicked) {
      throw new Error("Could not find or click Share button");
    }

    // Wait for post to complete
    await page.waitForTimeout(12000);

    // Check for success indicators
    const successIndicators = [
      "text=Your post has been shared",
      "text=Post shared",
      'img[alt*="Animated checkmark"]',
    ];

    let postSuccess = false;
    for (const indicator of successIndicators) {
      if (
        await page
          .locator(indicator)
          .isVisible()
          .catch(() => false)
      ) {
        postSuccess = true;
        break;
      }
    }

    console.log("✅ Instagram post created successfully");

    return {
      success: true,
      message: postSuccess ? "Post confirmed" : "Post likely successful",
    };
  } catch (error) {
    console.error("❌ Instagram post failed:", error.message);

    // Take screenshot for debugging
    try {
      await page.screenshot({
        path: `instagram-error-${Date.now()}.png`,
        fullPage: true,
      });
      console.log("📸 Error screenshot saved");
    } catch (screenshotError) {
      console.log("⚠️ Could not save screenshot");
    }

    return {
      success: false,
      message: error.message,
    };
  }
}
// ==========================================
// FACEBOOK POST
// ==========================================
async function createFacebookPost(page, postContent) {
  console.log("📘 Creating Facebook post...");

  try {
    // 1️⃣ Navigate to Facebook
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Facebook loaded, waiting for content...");
    await page.waitForTimeout(5000);

    // Close any popups
    try {
      await page
        .locator('[aria-label="Close"]')
        .first()
        .click({ timeout: 2000 });
      await page.waitForTimeout(1000);
    } catch (e) {
      // No popup to close
    }

    // 2️⃣ Click "What's on your mind?" or "Create a post"
    console.log("🔘 Looking for create post button...");

    const createPostSelectors = [
      '[aria-label="Create a post"]',
      'div[role="button"]:has-text("What\'s on your mind")',
      'span:has-text("What\'s on your mind")',
      'div[role="button"][aria-label="Create a post"]',
      '[data-pagelet="FeedComposer"]',
    ];

    let createClicked = false;
    for (const selector of createPostSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click({ timeout: 5000 });
          console.log(`✅ Clicked create post: ${selector}`);
          createClicked = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!createClicked) {
      throw new Error("Could not find 'Create a post' button");
    }

    await page.waitForTimeout(3000);

    // 3️⃣ Wait for post composer dialog to open
    console.log("⏳ Waiting for post composer...");

    const composerSelectors = [
      'div[role="dialog"]',
      '[aria-label="Create a post"]',
      'form[method="POST"]',
    ];

    let composerFound = false;
    for (const selector of composerSelectors) {
      try {
        await page.locator(selector).first().waitFor({
          state: "visible",
          timeout: 5000,
        });
        composerFound = true;
        console.log("✅ Post composer opened");
        break;
      } catch (e) {
        continue;
      }
    }

    if (!composerFound) {
      throw new Error("Post composer dialog did not open");
    }

    await page.waitForTimeout(2000);

    // 4️⃣ Check if there's an image to upload
    const hasImage = postContent?.media_urls;

    if (hasImage) {
      console.log("🖼️ Image detected, preparing to upload...");

      // Build absolute path to image
      const absoluteImagePath = path.join(
        "C:",
        "wamp64",
        "www",
        "social-automation",
        "public",
        postContent.media_urls
      );

      console.log("🔍 Looking for image at:", absoluteImagePath);

      if (!fs.existsSync(absoluteImagePath)) {
        throw new Error(`Image file not found: ${absoluteImagePath}`);
      }

      console.log("✅ Image file found");

      // Find and click "Photo/video" button
      const photoButtonSelectors = [
        '[aria-label="Photo/video"]',
        'div[aria-label="Photo/video"]',
        'span:has-text("Photo/video")',
        'div[role="button"]:has-text("Photo/video")',
        '[data-testid="media-sprout"]',
      ];

      let photoClicked = false;
      for (const selector of photoButtonSelectors) {
        try {
          const photoBtn = page.locator(selector).first();
          if (await photoBtn.isVisible({ timeout: 3000 })) {
            await photoBtn.click({ timeout: 5000 });
            console.log(`✅ Clicked Photo/video button: ${selector}`);
            photoClicked = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!photoClicked) {
        console.log(
          "⚠️ Could not click Photo/video button, trying direct file input..."
        );
      }

      await page.waitForTimeout(2000);

      // Upload image using file input
      console.log("📤 Uploading image...");

      const fileInputSelectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"]',
        'input[accept*="image"]',
      ];

      let fileUploaded = false;
      for (const selector of fileInputSelectors) {
        try {
          const fileInput = page.locator(selector).first();
          await fileInput.waitFor({ state: "attached", timeout: 5000 });
          await fileInput.setInputFiles(absoluteImagePath);
          console.log("✅ Image uploaded successfully");
          fileUploaded = true;
          break;
        } catch (e) {
          continue;
        }
      }

      if (!fileUploaded) {
        throw new Error("Could not upload image - file input not found");
      }

      // Wait for image to process
      console.log("⏳ Waiting for image to process...");
      await page.waitForTimeout(5000);

      // Check if image preview is visible
      const imagePreviewVisible = await page
        .locator('img[src*="blob:"], img[src*="scontent"]')
        .first()
        .isVisible({ timeout: 10000 })
        .catch(() => false);

      if (imagePreviewVisible) {
        console.log("✅ Image preview loaded");
      } else {
        console.log("⚠️ Image preview not detected, but continuing...");
      }
    }

    // 5️⃣ Type content and hashtags
    console.log("📝 Adding post text...");

    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    if (fullText) {
      const textBoxSelectors = [
        'div[aria-label="What\'s on your mind?"]',
        'div[aria-label="What\'s on your mind, "]', // Facebook adds username
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[aria-placeholder*="mind"]',
        'p[data-text="true"]',
      ];

      let textAdded = false;
      for (const selector of textBoxSelectors) {
        try {
          const textBox = page.locator(selector).first();
          if (await textBox.isVisible({ timeout: 3000 })) {
            await textBox.click({ timeout: 3000 });
            await page.waitForTimeout(1000);

            // Type text with human-like delay
            await textBox.type(fullText, { delay: 50 + Math.random() * 100 });
            console.log("✅ Post text added");
            textAdded = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!textAdded) {
        console.log("⚠️ Could not add text to post");
      }

      await page.waitForTimeout(2000);
    } else {
      console.log("ℹ️ No text content provided");
    }

    // 6️⃣ Click Post button
    console.log("📤 Looking for Post button...");

    const postButtonSelectors = [
      'div[aria-label="Post"]',
      'div[role="button"][aria-label="Post"]',
      'span:text-is("Post")',
      'div[role="button"]:has-text("Post")',
      'button:has-text("Post")',
    ];

    let postClicked = false;
    for (const selector of postButtonSelectors) {
      try {
        const postBtn = page.locator(selector).first();
        if (await postBtn.isVisible({ timeout: 5000 })) {
          // Check if button is enabled (not disabled/grayed out)
          const isEnabled = await postBtn.evaluate((el) => {
            return (
              !el.hasAttribute("aria-disabled") ||
              el.getAttribute("aria-disabled") === "false"
            );
          });

          if (!isEnabled) {
            console.log("⚠️ Post button is disabled, waiting...");
            await page.waitForTimeout(3000);
          }

          await postBtn.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);

          try {
            await postBtn.click({ timeout: 5000 });
          } catch (e) {
            console.log("⚠️ Regular click failed, trying force click...");
            await postBtn.click({ force: true });
          }

          console.log("✅ Post button clicked");
          postClicked = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!postClicked) {
      // Take screenshot for debugging
      await page.screenshot({
        path: `facebook-post-button-error-${Date.now()}.png`,
        fullPage: true,
      });
      throw new Error("Could not find or click Post button - check screenshot");
    }

    // 7️⃣ Wait for post to be published
    console.log("⏳ Waiting for post to publish...");
    await page.waitForTimeout(8000);

    // Check if dialog closed (indicates success)
    const dialogClosed = await page
      .locator('div[role="dialog"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    const postSuccess = !dialogClosed; // If dialog is gone, post succeeded

    if (postSuccess) {
      console.log("✅ Facebook post created successfully");
    } else {
      console.log("⚠️ Post status unclear, but likely successful");
    }

    return {
      success: true,
      message: postSuccess
        ? "Facebook post created successfully"
        : "Facebook post likely created (confirmation pending)",
      post_url: page.url(),
    };
  } catch (error) {
    console.error("❌ Facebook post failed:", error.message);

    // Take debug screenshot
    try {
      await page.screenshot({
        path: `facebook-post-error-${Date.now()}.png`,
        fullPage: true,
      });
      console.log("📸 Error screenshot saved");
    } catch (screenshotError) {
      console.log("⚠️ Could not save screenshot");
    }

    return {
      success: false,
      message: error.message,
    };
  }
}

// ==========================================
// TWITTER POST
// ==========================================
async function createTwitterPost(page, postContent) {
  console.log("🐦 Creating Twitter/X post...");

  try {
    // 1️⃣ Navigate to Twitter/X home
    await page.goto("https://twitter.com/home", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Twitter loaded, waiting for content...");
    await page.waitForTimeout(5000);

    // Scroll to ensure compose box is visible
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Looking for tweet compose box...");

    // 2️⃣ Find and click the tweet compose box
    const tweetBoxSelectors = [
      'div[data-testid="tweetTextarea_0"]',
      'div[aria-label="Post text"]',
      'div[aria-label="Tweet text"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[data-testid="tweetTextarea_0_label"]',
    ];

    let tweetBox = null;
    let foundSelector = null;

    for (const selector of tweetBoxSelectors) {
      try {
        const box = page.locator(selector).first();
        const isVisible = await box
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (isVisible) {
          tweetBox = box;
          foundSelector = selector;
          console.log(`✅ Found tweet box with selector: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Try JavaScript method if not found
    if (!tweetBox) {
      console.log("🔍 Trying JavaScript method to find tweet box...");

      const foundViaJs = await page.evaluate(() => {
        const editableDivs = Array.from(
          document.querySelectorAll('div[contenteditable="true"]')
        );

        for (const div of editableDivs) {
          const testId = div.getAttribute("data-testid") || "";
          const ariaLabel = div.getAttribute("aria-label") || "";

          if (
            testId === "tweetTextarea_0" ||
            ariaLabel.includes("Post text") ||
            ariaLabel.includes("Tweet text")
          ) {
            div.setAttribute("data-target-tweet-box", "true");
            return true;
          }
        }

        return false;
      });

      if (foundViaJs) {
        tweetBox = page.locator('[data-target-tweet-box="true"]').first();
        console.log("✅ Found tweet box via JavaScript");
      }
    }

    if (!tweetBox) {
      const screenshotPath = `twitter-no-compose-box-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("Twitter compose box not found - check screenshot");
    }

    // 3️⃣ Click to focus on the tweet box
    console.log("📝 Clicking tweet compose box...");
    await tweetBox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    try {
      await tweetBox.click({ timeout: 5000 });
    } catch (e) {
      await tweetBox.click({ force: true });
    }

    await page.waitForTimeout(2000);

    // 4️⃣ Prepare tweet content
    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    if (!fullText) {
      throw new Error("Tweet content is empty");
    }

    console.log("✍️ Writing tweet content...");

    // 5️⃣ Type the tweet content
    let typingSuccessful = false;

    // Method 1: Use Playwright's fill and type
    try {
      await tweetBox.fill("");
      await page.waitForTimeout(500);
      await tweetBox.type(fullText, { delay: 80 + Math.random() * 120 });
      typingSuccessful = true;
      console.log("✅ Tweet content typed (Playwright method)");
    } catch (e) {
      console.log("⚠️ Playwright typing failed, trying keyboard method...");
    }

    // Method 2: Use keyboard.type
    if (!typingSuccessful) {
      try {
        await page.keyboard.type(fullText, { delay: 100 });
        typingSuccessful = true;
        console.log("✅ Tweet content typed (keyboard method)");
      } catch (e) {
        console.log("⚠️ Keyboard typing failed, trying JavaScript method...");
      }
    }

    // Method 3: JavaScript insertion
    if (!typingSuccessful) {
      try {
        await page.evaluate((text) => {
          const box =
            document.querySelector('[data-target-tweet-box="true"]') ||
            document.querySelector('div[data-testid="tweetTextarea_0"]') ||
            document.querySelector(
              'div[contenteditable="true"][role="textbox"]'
            );

          if (box) {
            box.focus();
            box.textContent = text;

            // Trigger input event
            const inputEvent = new Event("input", { bubbles: true });
            box.dispatchEvent(inputEvent);

            return true;
          }
          return false;
        }, fullText);

        typingSuccessful = true;
        console.log("✅ Tweet content inserted (JavaScript method)");
      } catch (e) {
        console.log("❌ All typing methods failed");
      }
    }

    if (!typingSuccessful) {
      throw new Error("Failed to type tweet content");
    }

    await page.waitForTimeout(2000);

    // 6️⃣ Check if there's an image to upload
    const hasImage = postContent?.media_urls;

    if (hasImage) {
      console.log("🖼️ Image detected, preparing to upload...");

      // Build absolute path to image (adjust path as needed)
      const path = require("path");
      const fs = require("fs");

      const absoluteImagePath = path.join(
        "C:",
        "wamp64",
        "www",
        "social-automation",
        "public",
        postContent.media_urls
      );

      console.log("🔍 Looking for image at:", absoluteImagePath);

      if (!fs.existsSync(absoluteImagePath)) {
        throw new Error(`Image file not found: ${absoluteImagePath}`);
      }

      console.log("✅ Image file found");

      // Find and click media upload button
      const mediaButtonSelectors = [
        'input[data-testid="fileInput"]',
        'input[type="file"][accept*="image"]',
        'button[data-testid="attachments"]',
        'div[aria-label="Add photos or video"]',
        'button[aria-label="Add photos or video"]',
      ];

      let imageUploaded = false;

      // Try file input first
      for (const selector of mediaButtonSelectors) {
        try {
          const elem = page.locator(selector).first();

          if (selector.includes("input")) {
            // Direct file input
            await elem.setInputFiles(absoluteImagePath);
            console.log("✅ Image uploaded via file input");
            imageUploaded = true;
            break;
          } else {
            // Button that opens file dialog
            if (await elem.isVisible({ timeout: 3000 })) {
              // Click button to open file dialog
              await elem.click({ timeout: 3000 });
              await page.waitForTimeout(1000);

              // Then upload file
              const fileInput = page.locator('input[type="file"]').first();
              await fileInput.setInputFiles(absoluteImagePath);
              console.log("✅ Image uploaded via button click");
              imageUploaded = true;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (!imageUploaded) {
        console.log("⚠️ Could not upload image");
      } else {
        // Wait for image to process
        console.log("⏳ Waiting for image to process...");
        await page.waitForTimeout(5000);
      }
    }

    // 7️⃣ Find and click the Post button
    console.log("🔍 Looking for Post button...");

    const postButtonSelectors = [
      'button[data-testid="tweetButton"]',
      'button[data-testid="tweetButtonInline"]',
      'div[data-testid="tweetButton"]',
      'div[data-testid="tweetButtonInline"]',
      'button:has-text("Post")',
      'div[role="button"]:has-text("Post")',
      'button:has-text("Tweet")',
    ];

    let postButton = null;
    let postButtonFound = false;

    for (const selector of postButtonSelectors) {
      try {
        const btn = page.locator(selector).first();
        const isVisible = await btn
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (isVisible) {
          // Check if button is enabled
          const isDisabled = await btn
            .getAttribute("disabled")
            .catch(() => null);
          const ariaDisabled = await btn
            .getAttribute("aria-disabled")
            .catch(() => null);

          if (isDisabled === null && ariaDisabled !== "true") {
            postButton = btn;
            postButtonFound = true;
            console.log(`✅ Found Post button: ${selector}`);
            break;
          } else {
            console.log(`⚠️ Post button found but disabled: ${selector}`);
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Try JavaScript method to find Post button
    if (!postButton) {
      console.log("🔍 Trying JavaScript method to find Post button...");

      const foundBtnViaJs = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('button, div[role="button"]')
        );

        for (const btn of buttons) {
          const testId = btn.getAttribute("data-testid") || "";
          const text = btn.textContent?.trim() || "";
          const disabled =
            btn.disabled || btn.getAttribute("aria-disabled") === "true";

          if (
            (testId === "tweetButton" || testId === "tweetButtonInline") &&
            !disabled
          ) {
            btn.setAttribute("data-target-post-btn", "true");
            return true;
          }

          if ((text === "Post" || text === "Tweet") && !disabled) {
            btn.setAttribute("data-target-post-btn", "true");
            return true;
          }
        }

        return false;
      });

      if (foundBtnViaJs) {
        postButton = page.locator('[data-target-post-btn="true"]').first();
        postButtonFound = true;
        console.log("✅ Found Post button via JavaScript");
      }
    }

    if (!postButton) {
      const screenshotPath = `twitter-no-post-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error(
        "Twitter Post button not found or is disabled - check screenshot"
      );
    }

    // 8️⃣ Click the Post button
    console.log("📤 Clicking Post button...");

    await postButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    let postClicked = false;

    // Method 1: Normal click
    try {
      await postButton.click({ timeout: 5000 });
      postClicked = true;
      console.log("✅ Post button clicked (normal click)");
    } catch (e) {
      console.log("⚠️ Normal click failed, trying force click...");
    }

    // Method 2: Force click
    if (!postClicked) {
      try {
        await postButton.click({ force: true });
        postClicked = true;
        console.log("✅ Post button clicked (force click)");
      } catch (e) {
        console.log("⚠️ Force click failed, trying JavaScript click...");
      }
    }

    // Method 3: JavaScript click
    if (!postClicked) {
      try {
        await page.evaluate(() => {
          const btn =
            document.querySelector('[data-target-post-btn="true"]') ||
            document.querySelector('button[data-testid="tweetButton"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        postClicked = true;
        console.log("✅ Post button clicked (JavaScript click)");
      } catch (e) {
        console.log("❌ All click methods failed");
      }
    }

    if (!postClicked) {
      throw new Error("Failed to click Post button");
    }

    // 9️⃣ Wait for tweet to be posted
    console.log("⏳ Waiting for tweet to post...");
    await page.waitForTimeout(6000);

    // Verify tweet was posted by checking if compose box is empty/reset
    const tweetPosted = await page.evaluate(() => {
      const box =
        document.querySelector('div[data-testid="tweetTextarea_0"]') ||
        document.querySelector('div[contenteditable="true"][role="textbox"]');

      if (box) {
        const text = box.textContent?.trim() || "";
        return text === "" || text === "What is happening?!";
      }

      return true; // Assume posted if box not found
    });

    if (tweetPosted) {
      console.log("✅ Twitter post created successfully");
      return {
        success: true,
        message: "Twitter post created successfully",
        verified: true,
        post_url: page.url(),
      };
    } else {
      console.log("✅ Twitter post likely created (verification pending)");
      return {
        success: true,
        message: "Twitter post created (verification pending)",
        verified: false,
        post_url: page.url(),
        note: "Post was submitted but verification pending. Check your profile manually.",
      };
    }
  } catch (error) {
    console.error("❌ Twitter post failed:", error.message);

    // Debug screenshot
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `twitter-post-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: twitter-post-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `twitter-post-error-${timestamp}.png`,
    };
  }
}

// ==========================================
// LINKEDIN POST
// ==========================================
async function createLinkedInPost(page, postContent) {
  console.log("💼 Creating LinkedIn post...");

  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Click "Start a post" button
    await page.click('button:has-text("Start a post")');
    await page.waitForTimeout(2000);

    // Type content
    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    const editor = await page.locator(".ql-editor").first();
    await editor.fill(fullText);

    await page.waitForTimeout(2000);

    // Click Post button
    await page.click('button:has-text("Post")');
    await page.waitForTimeout(5000);

    console.log("✅ LinkedIn post created successfully");
    return {
      success: true,
      message: "LinkedIn post created successfully",
      post_url: page.url(),
    };
  } catch (error) {
    console.error("❌ LinkedIn post failed:", error.message);
    return { success: false, message: error.message };
  }
}

// ==========================================
// LIKE POST FUNCTION
// ==========================================
async function instagramLike(page, targetUrl) {
  console.log("❤️ Liking Instagram post...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    const cleanUrl = targetUrl.split("?")[0];

    await page.goto(cleanUrl, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(8000);

    // Detect session expired
    if (
      await page
        .locator('input[name="username"]')
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      throw new Error("Instagram session expired (login required)");
    }

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(3000);

    // Check if already liked (multiple possible red heart indicators)
    const alreadyLiked = await page.evaluate(() => {
      const svgs = document.querySelectorAll("svg");
      for (const svg of svgs) {
        const fill = svg.getAttribute("fill");
        const stroke = svg.getAttribute("stroke");
        const ariaLabel = svg.getAttribute("aria-label");

        if (
          fill === "#ed4956" ||
          fill === "rgb(255, 48, 64)" ||
          stroke === "#ed4956" ||
          (ariaLabel && ariaLabel.toLowerCase().includes("unlike"))
        ) {
          return true;
        }
      }
      return false;
    });

    if (alreadyLiked) {
      console.log("💙 Already liked");
      return { success: true, message: "Already liked" };
    }

    // Try multiple selector strategies
    let likeButton = null;

    // Strategy 1: Find by aria-label
    likeButton = page.locator('[aria-label="Like"]').first();
    let isVisible = await likeButton
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    // Strategy 2: Find SVG with specific viewBox (Instagram like icon)
    if (!isVisible) {
      console.log("Trying strategy 2: SVG viewBox...");
      likeButton = page.locator('svg[aria-label="Like"]').locator("..").first();
      isVisible = await likeButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);
    }

    // Strategy 3: Find button/div containing heart SVG path
    if (!isVisible) {
      console.log("Trying strategy 3: Heart path selector...");
      const heartPaths = [
        'path[d*="M16.792 3.904A4.989"]', // Common Instagram heart path
        'path[d*="M34.6 3.1"]', // Alternative heart path
        'path[d*="M16.792"]', // Partial match
      ];

      for (const pathSelector of heartPaths) {
        likeButton = page
          .locator(
            `button:has(${pathSelector}), div[role="button"]:has(${pathSelector}), span[role="button"]:has(${pathSelector})`
          )
          .first();
        isVisible = await likeButton
          .isVisible({ timeout: 2000 })
          .catch(() => false);
        if (isVisible) break;
      }
    }

    // Strategy 4: Find by JavaScript evaluation (most reliable)
    if (!isVisible) {
      console.log("Trying strategy 4: JavaScript evaluation...");
      const likeButtonFound = await page.evaluate(() => {
        // Find all SVGs
        const svgs = document.querySelectorAll("svg");

        for (const svg of svgs) {
          const ariaLabel = svg.getAttribute("aria-label");

          // Look for "Like" label
          if (ariaLabel && ariaLabel.toLowerCase() === "like") {
            // Find the clickable parent
            let parent = svg.parentElement;
            while (parent) {
              const role = parent.getAttribute("role");
              const tag = parent.tagName.toLowerCase();

              if (
                tag === "button" ||
                role === "button" ||
                (tag === "div" && role === "button") ||
                (tag === "span" && parent.onclick)
              ) {
                parent.setAttribute("data-like-button", "true");
                return true;
              }
              parent = parent.parentElement;
            }
          }
        }
        return false;
      });

      if (likeButtonFound) {
        likeButton = page.locator('[data-like-button="true"]').first();
        isVisible = await likeButton
          .isVisible({ timeout: 2000 })
          .catch(() => false);
      }
    }

    if (!isVisible) {
      throw new Error("Like button not found with any strategy");
    }

    console.log("✅ Like button found, clicking...");

    // Human-like interaction
    await likeButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300 + Math.random() * 700);
    await likeButton.hover({ timeout: 10000 });
    await page.waitForTimeout(200 + Math.random() * 500);

    // Try click with different methods
    try {
      await likeButton.click({ timeout: 10000, delay: 100 });
    } catch (e) {
      console.log("Standard click failed, trying force click...");
      await likeButton.click({ force: true, delay: 150 });
    }

    // Wait and verify
    await page.waitForTimeout(5000);

    // Check for red heart or "Unlike" label
    const confirmed = await page.evaluate(() => {
      const svgs = document.querySelectorAll("svg");
      for (const svg of svgs) {
        const fill = svg.getAttribute("fill");
        const stroke = svg.getAttribute("stroke");
        const ariaLabel = svg.getAttribute("aria-label");

        if (
          fill === "#ed4956" ||
          fill === "rgb(255, 48, 64)" ||
          stroke === "#ed4956" ||
          (ariaLabel && ariaLabel.toLowerCase().includes("unlike"))
        ) {
          return true;
        }
      }
      return false;
    });

    if (!confirmed) {
      console.warn("⚠️ No red heart visible – like may still have worked");
      // Take debug screenshot
      await page.screenshot({
        path: `instagram-like-attempt-${Date.now()}.png`,
        fullPage: false,
      });
      return {
        success: true,
        message: "Like attempted (no visual confirmation)",
      };
    }

    console.log("❤️ Instagram like successful & confirmed");
    return { success: true, message: "Post liked successfully" };
  } catch (error) {
    console.error("❌ Instagram like failed:", error.message);
    // Debug screenshot
    try {
      await page.screenshot({
        path: `instagram-like-error-${Date.now()}.png`,
        fullPage: false,
      });
    } catch {}
    return { success: false, message: error.message };
  }
}

async function facebookLike(page, targetUrl) {
  console.log("👍 Liking Facebook post...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Page loaded, waiting for content...");
    await page.waitForTimeout(8000);

    // Close any popups/dialogs
    const closeSelectors = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      'div[role="button"][aria-label="Close"]',
    ];

    for (const selector of closeSelectors) {
      try {
        await page.locator(selector).first().click({ timeout: 2000 });
        console.log("✅ Closed popup");
        await page.waitForTimeout(1000);
      } catch (e) {
        // Ignore if not found
      }
    }

    // Scroll to load reactions
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await page.waitForTimeout(3000);

    console.log("🔍 Checking if already liked...");

    // Check if already liked
    const alreadyLiked = await page.evaluate(() => {
      // Look for "Unlike" text or filled/active like button
      const elements = document.querySelectorAll("[aria-label]");

      for (const elem of elements) {
        const ariaLabel = elem.getAttribute("aria-label");
        if (ariaLabel) {
          const lowerLabel = ariaLabel.toLowerCase();
          // Check for "Remove Like" or similar patterns
          if (
            lowerLabel.includes("remove like") ||
            lowerLabel.includes("unlike") ||
            lowerLabel === "like: liked"
          ) {
            return true;
          }
        }
      }

      // Check for active/filled thumbs up icon
      const svgs = document.querySelectorAll("svg");
      for (const svg of svgs) {
        const fill = svg.querySelector("path")?.getAttribute("fill");
        const parentLabel = svg
          .closest("[aria-label]")
          ?.getAttribute("aria-label");

        if (parentLabel && parentLabel.toLowerCase().includes("like")) {
          // Blue fill indicates already liked
          if (
            fill &&
            (fill.includes("rgb(24, 119, 242)") || fill === "#1877F2")
          ) {
            return true;
          }
        }
      }

      return false;
    });

    if (alreadyLiked) {
      console.log("💙 Already liked");
      return { success: true, message: "Already liked" };
    }

    console.log("🔍 Looking for Like button...");

    // Find Like button with multiple strategies
    const likeSelectors = [
      // Most common Facebook Like button selectors
      '[aria-label="Like"]',
      '[aria-label="like"]',
      'div[aria-label="Like"][role="button"]',
      'span[aria-label="Like"][role="button"]',

      // Text-based selectors
      'div[role="button"]:has-text("Like")',
      'span[role="button"]:has-text("Like")',

      // Reaction button (Facebook's main reaction element)
      '[data-testid="reaction-button"]',

      // SVG parent with Like label
      'svg[aria-label="Like"]',

      // Specific Facebook classes
      'div.x1i10hfl[role="button"][tabindex="0"]',
    ];

    let likeButton = null;
    let foundSelector = null;

    for (const selector of likeSelectors) {
      try {
        const btn = page.locator(selector).first();
        const isVisible = await btn
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (isVisible) {
          likeButton = btn;
          foundSelector = selector;
          console.log(`✅ Found Like button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // JavaScript evaluation fallback
    if (!likeButton) {
      console.log("🔍 Trying JavaScript evaluation...");

      const likeButtonFound = await page.evaluate(() => {
        // Find elements with "Like" aria-label
        const elements = document.querySelectorAll("[aria-label]");

        for (const elem of elements) {
          const ariaLabel = elem.getAttribute("aria-label");
          if (ariaLabel && ariaLabel.toLowerCase() === "like") {
            const role = elem.getAttribute("role");
            const tag = elem.tagName.toLowerCase();

            if (
              role === "button" ||
              tag === "button" ||
              (tag === "div" && role === "button") ||
              (tag === "span" && role === "button")
            ) {
              elem.setAttribute("data-fb-like-button", "true");
              return true;
            }
          }
        }

        return false;
      });

      if (likeButtonFound) {
        likeButton = page.locator('[data-fb-like-button="true"]').first();
        console.log("✅ Found Like button via JavaScript");
      }
    }

    if (!likeButton) {
      // Take screenshot for debugging
      const screenshotPath = `facebook-like-error-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("Facebook Like button not found - check screenshot");
    }

    // Click the Like button
    console.log("👍 Clicking Like button...");

    await likeButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500 + Math.random() * 500);

    try {
      await likeButton.hover({ timeout: 5000 });
      await page.waitForTimeout(300 + Math.random() * 400);
      await likeButton.click({ timeout: 5000, delay: 100 });
    } catch (e) {
      console.log("⚠️ Regular click failed, trying force click...");
      await likeButton.click({ force: true });
    }

    // Wait for reaction to register
    await page.waitForTimeout(4000);

    // Verify like was successful
    const likeConfirmed = await page.evaluate(() => {
      const elements = document.querySelectorAll("[aria-label]");

      for (const elem of elements) {
        const ariaLabel = elem.getAttribute("aria-label");
        if (ariaLabel) {
          const lowerLabel = ariaLabel.toLowerCase();
          if (
            lowerLabel.includes("remove like") ||
            lowerLabel.includes("unlike") ||
            lowerLabel === "like: liked"
          ) {
            return true;
          }
        }
      }

      // Check for blue/filled thumbs up
      const svgs = document.querySelectorAll("svg");
      for (const svg of svgs) {
        const path = svg.querySelector("path");
        if (path) {
          const fill = path.getAttribute("fill");
          if (
            fill &&
            (fill.includes("rgb(24, 119, 242)") || fill === "#1877F2")
          ) {
            return true;
          }
        }
      }

      return false;
    });

    if (!likeConfirmed) {
      console.warn("⚠️ Like confirmation not detected – but may have worked");
      return {
        success: true,
        message: "Facebook like attempted (confirmation pending)",
      };
    }

    console.log("👍 Facebook like successful & confirmed");
    return {
      success: true,
      message: "Post liked successfully",
      post_url: targetUrl,
    };
  } catch (error) {
    console.error("❌ Facebook like failed:", error.message);

    // Debug screenshot
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `facebook-like-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: facebook-like-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `facebook-like-error-${timestamp}.png`,
    };
  }
}
async function twitterLike(page, targetUrl) {
  console.log("❤️ Liking Twitter/X post...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Tweet loaded, waiting for content...");
    await page.waitForTimeout(6000);

    // Scroll to ensure tweet actions are loaded
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Checking if already liked...");

    // Check if already liked and find like button
    const likeStatus = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('button, div[role="button"]')
      );

      for (const btn of buttons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check for "Liked" state (already liked - filled heart)
        if (
          ariaLabel.toLowerCase().includes("liked") ||
          testId === "unlike" ||
          testId.includes("unlike")
        ) {
          return { isLiked: true, foundButton: false };
        }
      }

      // Now look for Like button (empty heart)
      for (const btn of buttons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check for "Like" button (not "Liked")
        if (
          (ariaLabel.toLowerCase() === "like" &&
            !ariaLabel.toLowerCase().includes("liked")) ||
          testId === "like" ||
          (testId.includes("like") && !testId.includes("unlike"))
        ) {
          // Mark this button for clicking
          btn.setAttribute("data-target-like-btn", "true");
          return { isLiked: false, foundButton: true };
        }
      }

      return { isLiked: false, foundButton: false };
    });

    if (likeStatus.isLiked) {
      console.log("💗 Tweet already liked");
      return {
        success: true,
        message: "Tweet already liked",
        alreadyLiked: true,
        tweet_url: targetUrl,
      };
    }

    if (!likeStatus.foundButton) {
      console.log("❌ Like button not found on page");

      const screenshotPath = `twitter-no-like-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("Twitter Like button not found - check screenshot");
    }

    console.log("🔍 Like button found, attempting to click...");

    // Get the marked button
    const likeButton = page.locator('[data-target-like-btn="true"]').first();

    // Scroll button into view
    await likeButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    // Try to click with multiple strategies
    let clickSuccessful = false;

    // Strategy 1: Normal click
    try {
      await likeButton.hover({ timeout: 3000 });
      await page.waitForTimeout(400 + Math.random() * 300);
      await likeButton.click({ timeout: 5000, delay: 100 });
      clickSuccessful = true;
      console.log("✅ Clicked Like button (normal click)");
    } catch (e) {
      console.log("⚠️ Normal click failed, trying force click...");
    }

    // Strategy 2: Force click
    if (!clickSuccessful) {
      try {
        await likeButton.click({ force: true, timeout: 5000 });
        clickSuccessful = true;
        console.log("✅ Clicked Like button (force click)");
      } catch (e) {
        console.log("⚠️ Force click failed, trying JavaScript click...");
      }
    }

    // Strategy 3: JavaScript click
    if (!clickSuccessful) {
      try {
        const jsClicked = await page.evaluate(() => {
          const btn = document.querySelector('[data-target-like-btn="true"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });

        if (jsClicked) {
          clickSuccessful = true;
          console.log("✅ Clicked Like button (JavaScript click)");
        }
      } catch (e) {
        console.log("❌ All click strategies failed");
      }
    }

    if (!clickSuccessful) {
      throw new Error("Failed to click Like button after multiple attempts");
    }

    // Wait for the like action to register
    console.log("⏳ Waiting for like action to complete...");
    await page.waitForTimeout(3000);

    // Verify like was successful
    console.log("🔍 Verifying like status...");

    const likeConfirmed = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('button, div[role="button"]')
      );

      for (const btn of buttons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check if button now shows "Liked" (filled heart)
        if (
          ariaLabel.toLowerCase().includes("liked") ||
          testId === "unlike" ||
          testId.includes("unlike")
        ) {
          return true;
        }
      }

      // Alternative check: look for filled heart SVG
      const svgs = document.querySelectorAll("svg");
      for (const svg of svgs) {
        const paths = svg.querySelectorAll("path");
        for (const path of paths) {
          const d = path.getAttribute("d") || "";
          // Twitter's filled heart path
          if (
            d.includes("M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67") ||
            d.includes("M12 21.638h-.014C9.403")
          ) {
            const fill = path.getAttribute("fill") || "";
            // Check if it's filled (red/pink color)
            if (
              fill &&
              (fill.includes("rgb(249") ||
                fill.includes("#F91880") ||
                fill === "currentColor")
            ) {
              return true;
            }
          }
        }
      }

      return false;
    });

    if (likeConfirmed) {
      console.log("❤️ Twitter like successful and confirmed");
      return {
        success: true,
        message: "Tweet liked successfully",
        confirmed: true,
        tweet_url: targetUrl,
      };
    } else {
      console.warn("⚠️ Like button was clicked but confirmation not detected");

      // Take a screenshot for debugging
      const screenshotPath = `twitter-like-unconfirmed-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      return {
        success: true,
        message: "Like button clicked (awaiting confirmation)",
        confirmed: false,
        tweet_url: targetUrl,
        note: "Button was clicked but 'Liked' status not yet detected. May need a few seconds.",
      };
    }
  } catch (error) {
    console.error("❌ Twitter like failed:", error.message);

    // Debug screenshot
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `twitter-like-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: twitter-like-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `twitter-like-error-${timestamp}.png`,
      tweet_url: targetUrl,
    };
  }
}

async function tiktokLike(page, targetUrl) {
  console.log("❤️ Liking TikTok post...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ TikTok video loaded, waiting for content...");
    await page.waitForTimeout(6000);

    // Scroll to ensure video actions are loaded
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Searching for like button...");

    // Find and analyze the like button
    const buttonInfo = await page.evaluate(() => {
      // Strategy 1: Find button with heart SVG and like count
      const allButtons = document.querySelectorAll('button');
      
      for (const btn of allButtons) {
        // Check if button contains an SVG (heart icon)
        const svg = btn.querySelector('svg');
        if (!svg) continue;

        // Check if this button is near or contains like count text
        const buttonText = btn.textContent || "";
        const hasLikeCount = /[\d.]+[KMB]?/.test(buttonText);
        
        // Check aria-label
        const ariaLabel = btn.getAttribute("aria-label") || "";
        
        // Log what we found
        console.log("Button found:", {
          ariaLabel: ariaLabel,
          text: buttonText,
          hasLikeCount: hasLikeCount,
          html: btn.outerHTML.substring(0, 200)
        });

        // Check if it's a like button (has heart SVG + like count OR has "like" in aria-label)
        if (hasLikeCount || ariaLabel.toLowerCase().includes("like")) {
          // Check if already liked (red heart)
          const paths = svg.querySelectorAll('path');
          let isLiked = false;
          
          for (const path of paths) {
            const fill = path.getAttribute('fill') || '';
            const style = window.getComputedStyle(path);
            const computedFill = style.fill || '';
            
            // Check for red/pink color
            if (
              fill.includes('254') || 
              fill.includes('#FE2C55') || 
              fill.includes('#fe2c55') ||
              computedFill.includes('254, 44, 85')
            ) {
              isLiked = true;
              break;
            }
          }

          // Also check aria-label for "unlike"
          if (ariaLabel.toLowerCase().includes('unlike')) {
            isLiked = true;
          }

          console.log("Like button status:", { isLiked, ariaLabel });

          if (isLiked) {
            return { found: true, alreadyLiked: true };
          }

          // Mark button for clicking
          btn.setAttribute('data-like-target', 'true');
          return { found: true, alreadyLiked: false };
        }
      }

      // Strategy 2: Look for specific TikTok button structure
      // TikTok often uses a button with data-e2e attribute
      const likeButton = document.querySelector('[data-e2e*="like"]');
      if (likeButton) {
        console.log("Found button via data-e2e:", likeButton.outerHTML.substring(0, 200));
        likeButton.setAttribute('data-like-target', 'true');
        
        // Check if liked
        const svg = likeButton.querySelector('svg path');
        const isLiked = svg && (
          (svg.getAttribute('fill') || '').includes('254') ||
          (window.getComputedStyle(svg).fill || '').includes('254')
        );
        
        return { found: true, alreadyLiked: isLiked };
      }

      // Strategy 3: Find by aria-label containing "like"
      const buttonByAria = Array.from(allButtons).find(btn => {
        const label = btn.getAttribute('aria-label') || '';
        return label.toLowerCase().includes('like');
      });

      if (buttonByAria) {
        console.log("Found button via aria-label:", buttonByAria.getAttribute('aria-label'));
        buttonByAria.setAttribute('data-like-target', 'true');
        
        const isLiked = (buttonByAria.getAttribute('aria-label') || '').toLowerCase().includes('unlike');
        return { found: true, alreadyLiked: isLiked };
      }

      return { found: false, alreadyLiked: false };
    });

    console.log("Button search result:", buttonInfo);

    if (buttonInfo.alreadyLiked) {
      console.log("💗 TikTok video already liked");
      return {
        success: true,
        message: "TikTok video already liked",
        alreadyLiked: true,
        video_url: targetUrl,
      };
    }

    if (!buttonInfo.found) {
      console.log("❌ Like button not found");

      // Take debug screenshot
      const screenshotPath = `tiktok-no-like-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      // Log all buttons for debugging
      await page.evaluate(() => {
        console.log("=== ALL BUTTONS ON PAGE ===");
        const allBtns = document.querySelectorAll('button');
        allBtns.forEach((btn, i) => {
          console.log(`Button ${i}:`, {
            ariaLabel: btn.getAttribute('aria-label'),
            dataE2e: btn.getAttribute('data-e2e'),
            text: btn.textContent.substring(0, 50),
            hasSVG: !!btn.querySelector('svg')
          });
        });
      });

      throw new Error("TikTok Like button not found - check screenshot and console logs");
    }

    console.log("✅ Like button found! Attempting to click...");

    // Wait a bit before clicking
    await page.waitForTimeout(1000);

    // Try multiple click strategies
    let clickSuccess = false;

    // Strategy 1: Click using locator
    try {
      const likeBtn = page.locator('[data-like-target="true"]').first();
      await likeBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await likeBtn.click({ timeout: 5000 });
      clickSuccess = true;
      console.log("✅ Clicked via locator");
    } catch (e) {
      console.log("⚠️ Locator click failed:", e.message);
    }

    // Strategy 2: JavaScript click
    if (!clickSuccess) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-like-target="true"]');
          if (btn) {
            btn.click();
            return true;
          }
          throw new Error("Button not found in DOM");
        });
        clickSuccess = true;
        console.log("✅ Clicked via JavaScript");
      } catch (e) {
        console.log("⚠️ JS click failed:", e.message);
      }
    }

    // Strategy 3: Force click
    if (!clickSuccess) {
      try {
        const likeBtn = page.locator('[data-like-target="true"]').first();
        await likeBtn.click({ force: true, timeout: 5000 });
        clickSuccess = true;
        console.log("✅ Clicked via force");
      } catch (e) {
        console.log("⚠️ Force click failed:", e.message);
      }
    }

    if (!clickSuccess) {
      throw new Error("Failed to click like button with all strategies");
    }

    // Wait for like animation
    console.log("⏳ Waiting for like to register...");
    await page.waitForTimeout(3000);

    // Verify like was successful
    const verified = await page.evaluate(() => {
      const allButtons = document.querySelectorAll('button');
      
      for (const btn of allButtons) {
        const ariaLabel = btn.getAttribute('aria-label') || '';
        
        // Check for "unlike" in aria-label
        if (ariaLabel.toLowerCase().includes('unlike')) {
          return true;
        }

        // Check for red heart
        const svg = btn.querySelector('svg');
        if (svg) {
          const paths = svg.querySelectorAll('path');
          for (const path of paths) {
            const fill = path.getAttribute('fill') || '';
            const computedFill = window.getComputedStyle(path).fill || '';
            
            if (
              fill.includes('254') || 
              fill.includes('#FE2C55') ||
              computedFill.includes('254, 44, 85')
            ) {
              return true;
            }
          }
        }
      }
      
      return false;
    });

    if (verified) {
      console.log("❤️ Like confirmed!");
      return {
        success: true,
        message: "TikTok video liked successfully",
        confirmed: true,
        video_url: targetUrl,
      };
    } else {
      console.warn("⚠️ Like clicked but verification failed");
      
      // Screenshot for debugging
      await page.screenshot({
        path: `tiktok-like-unconfirmed-${Date.now()}.png`,
      });

      return {
        success: true,
        message: "Like button clicked (verification pending)",
        confirmed: false,
        video_url: targetUrl,
      };
    }

  } catch (error) {
    console.error("❌ TikTok like error:", error.message);

    // Debug screenshot
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `tiktok-like-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(`📸 Error screenshot: tiktok-like-error-${timestamp}.png`);
    } catch {}

    return {
      success: false,
      message: error.message,
      video_url: targetUrl,
    };
  }
}

async function likePost(page, platform, targetUrl) {
  console.log(`❤️ Liking post on ${platform}...`);

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    if (platform === "instagram") {
      return await instagramLike(page, targetUrl);
    }

    if (platform === "facebook") {
      return await facebookLike(page, targetUrl);
    }

    if (platform === "twitter") {
      return await twitterLike(page, targetUrl);
    }

    if (platform === "tiktok") {
      return await tiktokLike(page, targetUrl);
    }

    return {
      success: false,
      message: `Like not supported for platform: ${platform}`,
    };
  } catch (error) {
    console.error(`❌ Like failed on ${platform}:`, error.message);

    // Debug screenshot
    try {
      await page.screenshot({
        path: `${platform}-like-error-${Date.now()}.png`,
        fullPage: false,
      });
    } catch {}

    return {
      success: false,
      message: error.message,
    };
  }
}


// ==========================================
// COMMENT FUNCTION
// ==========================================

async function instagramComment(page, targetUrl, commentText) {
  console.log("💬 Commenting on Instagram...");

  if (!targetUrl) throw new Error("Target URL missing");
  if (!commentText) throw new Error("Comment text missing");

  const cleanUrl = targetUrl.split("?")[0];

  try {
    // Navigate with error handling
    try {
      await page.goto(cleanUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (navError) {
      if (!page.url().includes("instagram.com")) {
        throw new Error("Failed to navigate to Instagram post");
      }
      console.log("⚠️ Navigation timeout but page loaded, continuing...");
    }

    await page.waitForTimeout(5000);

    // Detect session expired
    if (
      await page
        .locator('input[name="username"]')
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      throw new Error("Instagram session expired (login required)");
    }

    // Scroll to load the post content
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await page.waitForTimeout(2000);

    // Try multiple selectors for the comment icon (Instagram has variations)
    const commentIconSelectors = [
      'svg[aria-label="Comment"]',
      'svg[aria-label="Comment on this post"]',
      'button[aria-label="Comment"]',
      'span:has(svg[aria-label*="Comment"])',
    ];

    let commentIconClicked = false;

    for (const selector of commentIconSelectors) {
      try {
        const icon = page.locator(selector).first();
        if (await icon.isVisible({ timeout: 5000 })) {
          await icon.scrollIntoViewIfNeeded();
          await icon.click({ force: true, timeout: 5000 });
          console.log(`✅ Clicked comment icon using selector: ${selector}`);
          commentIconClicked = true;
          await page.waitForTimeout(2000);
          break;
        }
      } catch (e) {
        console.log(`⚠️ Failed to click with selector: ${selector}`);
        continue;
      }
    }

    if (!commentIconClicked) {
      console.log("⚠️ Comment icon not clicked, trying direct textbox access");
    }

    // Scroll down more to ensure comment box is loaded
    await page.evaluate(() => {
      window.scrollBy(0, 400);
    });
    await page.waitForTimeout(2000);

    // Try multiple selectors for comment input box
    const commentBoxSelectors = [
      'textarea[placeholder*="Add a comment"]',
      'textarea[aria-label*="Add a comment"]',
      'div[role="textbox"][contenteditable="true"]',
      'textarea[placeholder*="comment"]',
      "form textarea",
    ];

    let commentBox = null;

    for (const selector of commentBoxSelectors) {
      try {
        const box = page.locator(selector).first();
        if (await box.isVisible({ timeout: 5000 })) {
          commentBox = box;
          console.log(`✅ Found comment box using selector: ${selector}`);
          break;
        }
      } catch (e) {
        console.log(`⚠️ Comment box not found with selector: ${selector}`);
        continue;
      }
    }

    if (!commentBox) {
      // Last resort: take screenshot for debugging
      await page.screenshot({
        path: "instagram-comment-box-not-found.png",
        fullPage: true,
      });
      throw new Error(
        "Comment input box not found - check instagram-comment-box-not-found.png"
      );
    }

    // Interact with comment box
    await commentBox.scrollIntoViewIfNeeded();
    await commentBox.click({ force: true });
    await page.waitForTimeout(1000);

    // Clear any existing text
    await commentBox.fill("");
    await page.waitForTimeout(500);

    // Type comment with human-like delay
    await commentBox.type(commentText, { delay: 100 + Math.random() * 100 });
    await page.waitForTimeout(1000);

    // Find and click the Post button with multiple selectors
    const postButtonSelectors = [
      'button:has-text("Post")',
      'div[role="button"]:has-text("Post")',
      'button[type="submit"]',
      "button:has(div:text('Post'))",
    ];

    let postButton = null;

    for (const selector of postButtonSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 5000 })) {
          postButton = btn;
          console.log(`✅ Found post button using selector: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!postButton) {
      throw new Error("Post button not found");
    }

    await postButton.scrollIntoViewIfNeeded();
    await postButton.hover();
    await page.waitForTimeout(500);
    await postButton.click({ force: true });

    // Wait for comment to be posted
    await page.waitForTimeout(5000);

    // Verify comment posted
    const commentVisible = await page
      .locator(`text=${commentText}`)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    console.log(
      commentVisible
        ? "✅ Comment posted & confirmed"
        : "✅ Comment posted (confirmation pending)"
    );

    return {
      success: true,
      message: commentVisible
        ? "Comment posted successfully"
        : "Comment posted (confirmation pending)",
      post_url: cleanUrl,
    };
  } catch (error) {
    console.error("❌ Instagram comment failed:", error.message);

    // Debug screenshot with timestamp
    const timestamp = Date.now();
    await page
      .screenshot({
        path: `instagram-comment-error-${timestamp}.png`,
        fullPage: true,
      })
      .catch(() => {});

    return {
      success: false,
      message: error.message,
      debug_screenshot: `instagram-comment-error-${timestamp}.png`,
    };
  }
}

async function facebookComment(page, targetUrl, commentText) {
  console.log("💬 Commenting on Facebook...");

  if (!targetUrl) throw new Error("Target URL missing");
  if (!commentText) throw new Error("Comment text missing");

  try {
    // Navigate to the post/photo
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Page loaded, waiting for content...");
    await page.waitForTimeout(8000); // Increased wait time for Facebook to load

    // Close any popups/dialogs
    const closeSelectors = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      'div[role="button"][aria-label="Close"]',
      "i.x1b0d669.xep6ejk", // Facebook X icon class
    ];

    for (const selector of closeSelectors) {
      try {
        await page.locator(selector).first().click({ timeout: 2000 });
        console.log("✅ Closed popup");
        await page.waitForTimeout(1000);
      } catch (e) {
        // Ignore if not found
      }
    }

    // Scroll to load comment section
    await page.evaluate(() => {
      window.scrollBy(0, 400);
    });
    await page.waitForTimeout(3000);

    console.log("🔍 Looking for comment box...");

    // Find comment box with multiple strategies
    const commentSelectors = [
      // Most common Facebook comment box selectors
      'div[aria-label="Write a comment"]',
      'div[aria-label="Write a comment..."]',
      'div[aria-placeholder="Write a comment"]',
      'div[aria-placeholder="Write a comment..."]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      "div.x1ed109x.xrvj5dj.x1l90r2v.xds687c", // Facebook comment box classes
      'div[data-lexical-editor="true"]',
      'textarea[placeholder*="Write a comment"]',
      "div.notranslate._5rpu", // Older Facebook class
    ];

    let commentBox = null;
    let foundSelector = null;

    for (const sel of commentSelectors) {
      try {
        const box = page.locator(sel).first();
        const isVisible = await box
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (isVisible) {
          commentBox = box;
          foundSelector = sel;
          console.log(`✅ Found comment box with selector: ${sel}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // If still not found, try clicking "Write a comment" text
    if (!commentBox) {
      console.log("🔍 Trying to click 'Write a comment' text...");

      const commentTriggers = [
        'span:text("Write a comment")',
        'span:text("Write a comment...")',
        'div:text("Write a comment")',
      ];

      for (const trigger of commentTriggers) {
        try {
          const elem = page.locator(trigger).first();
          if (await elem.isVisible({ timeout: 3000 })) {
            await elem.click({ timeout: 3000 });
            console.log("✅ Clicked comment trigger");
            await page.waitForTimeout(2000);

            // Try finding comment box again after clicking
            for (const sel of commentSelectors) {
              const box = page.locator(sel).first();
              if (await box.isVisible({ timeout: 3000 }).catch(() => false)) {
                commentBox = box;
                foundSelector = sel;
                console.log(`✅ Found comment box after clicking: ${sel}`);
                break;
              }
            }
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (!commentBox) {
      // Take screenshot for debugging
      const screenshotPath = `facebook-comment-error-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("Facebook comment box not found - check screenshot");
    }

    // Interact with comment box
    console.log("📝 Writing comment...");
    await commentBox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    await commentBox.click({ force: true });
    await page.waitForTimeout(1500);

    // Clear any existing text
    await commentBox.fill("");
    await page.waitForTimeout(500);

    // Type comment with human-like delay
    await commentBox.type(commentText, { delay: 80 + Math.random() * 120 });
    await page.waitForTimeout(1500);

    console.log("🔍 Looking for Post/Submit button...");

    // Find and click Post button with multiple strategies
    const postBtnSelectors = [
      // Enter key press indicator
      'div[aria-label="Press Enter to post"]',
      'div[aria-label="Comment"]',
      'div[aria-label="Post comment"]',

      // Button/div with text
      'div[role="button"]:has-text("Comment")',
      'div[role="button"]:has-text("Post")',
      'button:has-text("Comment")',
      'button:has-text("Post")',

      // SVG/Icon based (Facebook often uses icons)
      'div[aria-label="Post comment"] svg',
      'div[aria-label="Comment"] svg',

      // Classes
      'div[role="button"].x1i10hfl',
    ];

    let postBtn = null;
    let postMethod = null;

    for (const sel of postBtnSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          postBtn = btn;
          postMethod = sel;
          console.log(`✅ Found post button: ${sel}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Try pressing Enter key if no button found
    if (!postBtn) {
      console.log("⚠️ Post button not found, trying Enter key...");
      try {
        await page.keyboard.press("Enter");
        console.log("✅ Pressed Enter key");
        await page.waitForTimeout(5000);

        return {
          success: true,
          message: "Facebook comment posted via Enter key",
        };
      } catch (e) {
        // Take debug screenshot
        const screenshotPath = `facebook-post-btn-error-${Date.now()}.png`;
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });
        console.log(`📸 Screenshot saved: ${screenshotPath}`);

        throw new Error("Facebook Post button not found and Enter key failed");
      }
    }

    // Click the post button
    console.log("📤 Clicking Post button...");
    await postBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    try {
      await postBtn.click({ timeout: 5000 });
    } catch (e) {
      console.log("⚠️ Regular click failed, trying force click...");
      await postBtn.click({ force: true });
    }

    // Wait for comment to be posted
    await page.waitForTimeout(6000);

    // Verify comment was posted
    const commentPosted = await page
      .locator(`text="${commentText}"`)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    console.log(
      commentPosted
        ? "✅ Comment posted & verified"
        : "✅ Comment likely posted (verification pending)"
    );

    return {
      success: true,
      message: commentPosted
        ? "Facebook comment posted successfully"
        : "Facebook comment posted (verification pending)",
      post_url: targetUrl,
    };
  } catch (error) {
    console.error("❌ Facebook comment failed:", error.message);

    // Debug screenshot with timestamp
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `facebook-comment-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: facebook-comment-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `facebook-comment-error-${timestamp}.png`,
    };
  }
}

async function twitterComment(page, targetUrl, commentText) {
  console.log("🐦 Commenting on Twitter/X...");

  if (!targetUrl) throw new Error("Target URL missing");
  if (!commentText) throw new Error("Comment text missing");

  try {
    // Navigate to the tweet
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Tweet loaded, waiting for content...");
    await page.waitForTimeout(6000);

    // Scroll to load reply section
    await page.evaluate(() => {
      window.scrollBy(0, 400);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Looking for reply/comment box...");

    // Find reply box with multiple strategies
    const replyBoxSelectors = [
      // Main reply box selectors
      'div[data-testid="tweetTextarea_0"]',
      'div[data-testid="tweetTextarea_1"]',
      'div[aria-label="Post text"]',
      'div[aria-label="Tweet text"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-testid*="tweet"]',
      "div.public-DraftEditor-content",
      "div.DraftEditor-editorContainer",

      // Alternative selectors
      'div[class*="public-DraftEditor"]',
      'div[data-contents="true"]',
    ];

    let replyBox = null;
    let foundSelector = null;

    // First try to find visible reply box
    for (const sel of replyBoxSelectors) {
      try {
        const box = page.locator(sel).first();
        const isVisible = await box
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (isVisible) {
          replyBox = box;
          foundSelector = sel;
          console.log(`✅ Found reply box with selector: ${sel}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // If not found, try clicking "Post your reply" or similar trigger
    if (!replyBox) {
      console.log("🔍 Reply box not visible, trying to activate it...");

      const replyTriggers = [
        'div[data-testid="reply"]',
        'button[data-testid="reply"]',
        'div[aria-label="Reply"]',
        'span:has-text("Post your reply")',
        'div:has-text("Post your reply")',
      ];

      for (const trigger of replyTriggers) {
        try {
          const elem = page.locator(trigger).first();
          if (await elem.isVisible({ timeout: 3000 })) {
            await elem.click({ timeout: 3000 });
            console.log("✅ Clicked reply trigger");
            await page.waitForTimeout(2000);

            // Try finding reply box again after clicking
            for (const sel of replyBoxSelectors) {
              const box = page.locator(sel).first();
              if (await box.isVisible({ timeout: 3000 }).catch(() => false)) {
                replyBox = box;
                foundSelector = sel;
                console.log(`✅ Found reply box after clicking: ${sel}`);
                break;
              }
            }

            if (replyBox) break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    // Try JavaScript method to find reply box
    if (!replyBox) {
      console.log("🔍 Trying JavaScript method to find reply box...");

      const foundViaJs = await page.evaluate(() => {
        // Find contenteditable divs
        const editableDivs = Array.from(
          document.querySelectorAll('div[contenteditable="true"]')
        );

        for (const div of editableDivs) {
          const ariaLabel = div.getAttribute("aria-label") || "";
          const testId = div.getAttribute("data-testid") || "";

          if (
            ariaLabel.includes("Post text") ||
            ariaLabel.includes("Tweet text") ||
            testId.includes("tweetTextarea")
          ) {
            div.setAttribute("data-target-reply-box", "true");
            return true;
          }
        }

        // Fallback: find any contenteditable div in reply section
        const allContentEditable = document.querySelectorAll(
          'div[contenteditable="true"][role="textbox"]'
        );
        if (allContentEditable.length > 0) {
          allContentEditable[0].setAttribute("data-target-reply-box", "true");
          return true;
        }

        return false;
      });

      if (foundViaJs) {
        replyBox = page.locator('[data-target-reply-box="true"]').first();
        console.log("✅ Found reply box via JavaScript");
      }
    }

    if (!replyBox) {
      // Take screenshot for debugging
      const screenshotPath = `twitter-comment-no-box-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("Twitter reply box not found - check screenshot");
    }

    // Click and focus on reply box
    console.log("📝 Writing reply...");
    await replyBox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    // Click to focus
    try {
      await replyBox.click({ timeout: 5000 });
    } catch (e) {
      await replyBox.click({ force: true });
    }

    await page.waitForTimeout(1500);

    // Type the comment with human-like delay
    let typingSuccessful = false;

    // Method 1: Use Playwright's fill and type
    try {
      await replyBox.fill("");
      await page.waitForTimeout(500);
      await replyBox.type(commentText, { delay: 80 + Math.random() * 120 });
      typingSuccessful = true;
      console.log("✅ Typed comment using Playwright");
    } catch (e) {
      console.log("⚠️ Playwright typing failed, trying keyboard method...");
    }

    // Method 2: Use keyboard.type
    if (!typingSuccessful) {
      try {
        await page.keyboard.type(commentText, { delay: 100 });
        typingSuccessful = true;
        console.log("✅ Typed comment using keyboard");
      } catch (e) {
        console.log("⚠️ Keyboard typing failed, trying JavaScript...");
      }
    }

    // Method 3: JavaScript insertion
    if (!typingSuccessful) {
      try {
        await page.evaluate((text) => {
          const box =
            document.querySelector('[data-target-reply-box="true"]') ||
            document.querySelector(
              'div[contenteditable="true"][role="textbox"]'
            );

          if (box) {
            box.focus();
            box.textContent = text;

            // Trigger input event
            const inputEvent = new Event("input", { bubbles: true });
            box.dispatchEvent(inputEvent);

            return true;
          }
          return false;
        }, commentText);

        typingSuccessful = true;
        console.log("✅ Inserted comment using JavaScript");
      } catch (e) {
        console.log("❌ All typing methods failed");
      }
    }

    if (!typingSuccessful) {
      throw new Error("Failed to type comment text");
    }

    await page.waitForTimeout(2000);

    console.log("🔍 Looking for Reply button...");

    // Find Reply button with multiple strategies
    const replyBtnSelectors = [
      // Main reply button selectors
      'button[data-testid="tweetButton"]',
      'button[data-testid="tweetButtonInline"]',
      'div[data-testid="tweetButton"]',
      'div[data-testid="tweetButtonInline"]',

      // Alternative selectors
      'button:has-text("Reply")',
      'div[role="button"]:has-text("Reply")',
      'button:has-text("Post")',
      'div[role="button"]:has-text("Post")',

      // Aria labels
      'button[aria-label*="Reply"]',
      'button[aria-label*="Post"]',
      'div[aria-label*="Reply"][role="button"]',
    ];

    let replyBtn = null;
    let replyBtnFound = false;

    for (const sel of replyBtnSelectors) {
      try {
        const btn = page.locator(sel).first();
        const isVisible = await btn
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (isVisible) {
          // Check if button is enabled
          const isDisabled = await btn
            .getAttribute("disabled")
            .catch(() => null);

          if (isDisabled === null) {
            replyBtn = btn;
            replyBtnFound = true;
            console.log(`✅ Found Reply button: ${sel}`);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Try JavaScript method to find Reply button
    if (!replyBtn) {
      console.log("🔍 Trying JavaScript method to find Reply button...");

      const foundBtnViaJs = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('button, div[role="button"]')
        );

        for (const btn of buttons) {
          const testId = btn.getAttribute("data-testid") || "";
          const text = btn.textContent?.trim() || "";
          const ariaLabel = btn.getAttribute("aria-label") || "";

          if (
            testId === "tweetButton" ||
            testId === "tweetButtonInline" ||
            (text === "Reply" && !btn.disabled) ||
            (text === "Post" && !btn.disabled) ||
            (ariaLabel.includes("Reply") && !btn.disabled)
          ) {
            btn.setAttribute("data-target-reply-btn", "true");
            return true;
          }
        }

        return false;
      });

      if (foundBtnViaJs) {
        replyBtn = page.locator('[data-target-reply-btn="true"]').first();
        replyBtnFound = true;
        console.log("✅ Found Reply button via JavaScript");
      }
    }

    if (!replyBtn) {
      // Take screenshot for debugging
      const screenshotPath = `twitter-comment-no-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("Twitter Reply button not found - check screenshot");
    }

    // Click the Reply button
    console.log("📤 Clicking Reply button...");
    await replyBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    let replyClicked = false;

    // Method 1: Normal click
    try {
      await replyBtn.click({ timeout: 5000 });
      replyClicked = true;
      console.log("✅ Clicked Reply button (normal click)");
    } catch (e) {
      console.log("⚠️ Normal click failed, trying force click...");
    }

    // Method 2: Force click
    if (!replyClicked) {
      try {
        await replyBtn.click({ force: true });
        replyClicked = true;
        console.log("✅ Clicked Reply button (force click)");
      } catch (e) {
        console.log("⚠️ Force click failed, trying JavaScript click...");
      }
    }

    // Method 3: JavaScript click
    if (!replyClicked) {
      try {
        await page.evaluate(() => {
          const btn =
            document.querySelector('[data-target-reply-btn="true"]') ||
            document.querySelector('button[data-testid="tweetButton"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        replyClicked = true;
        console.log("✅ Clicked Reply button (JavaScript click)");
      } catch (e) {
        console.log("❌ All click methods failed");
      }
    }

    if (!replyClicked) {
      throw new Error("Failed to click Reply button");
    }

    // Wait for comment to be posted
    console.log("⏳ Waiting for reply to post...");
    await page.waitForTimeout(6000);

    // Verify comment was posted by checking if it appears on the page
    const commentPosted = await page.evaluate((text) => {
      // Look for the comment text in the page
      const bodyText = document.body.innerText;
      return bodyText.includes(text);
    }, commentText);

    if (commentPosted) {
      console.log("✅ Reply posted & verified");
      return {
        success: true,
        message: "Twitter reply posted successfully",
        verified: true,
        tweet_url: targetUrl,
      };
    } else {
      console.log("✅ Reply likely posted (verification pending)");
      return {
        success: true,
        message: "Twitter reply posted (verification pending)",
        verified: false,
        tweet_url: targetUrl,
        note: "Reply was submitted but verification pending. Check the tweet manually.",
      };
    }
  } catch (error) {
    console.error("❌ Twitter comment failed:", error.message);

    // Debug screenshot with timestamp
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `twitter-comment-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: twitter-comment-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `twitter-comment-error-${timestamp}.png`,
      tweet_url: targetUrl,
    };
  }
}
async function tiktokComment(page, targetUrl, commentText) {
  console.log("🎵 Commenting on TikTok...");

  if (!targetUrl) throw new Error("Target URL missing");
  if (!commentText) throw new Error("Comment text missing");

  try {
    // Navigate to the TikTok video
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ TikTok video loaded, waiting for content...");
    await page.waitForTimeout(5000);

    // Scroll to ensure comment section is loaded
    console.log("📜 Scrolling to load comment area...");
    await page.evaluate(() => {
      window.scrollBy(0, 400);
    });
    await page.waitForTimeout(2000);

    // STEP 1: Find and click the comment icon to open comment box
    console.log("🔍 Looking for comment icon...");
    
    const commentIconFound = await page.evaluate(() => {
      const allButtons = document.querySelectorAll('button, span[role="button"]');
      
      for (const btn of allButtons) {
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const dataE2e = btn.getAttribute('data-e2e') || '';
        
        // Look for comment icon by aria-label or data-e2e
        if (
          ariaLabel.toLowerCase().includes('comment') ||
          dataE2e.includes('comment') ||
          dataE2e.includes('browse-comment')
        ) {
          console.log("Found comment icon:", { ariaLabel, dataE2e });
          btn.setAttribute('data-comment-icon', 'true');
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
        
        // Also check if button contains comment count and SVG (comment icon)
        const svg = btn.querySelector('svg');
        const text = btn.textContent || '';
        
        // Comment counts typically show like "58.7K"
        if (svg && /[\d.]+[KMB]/.test(text)) {
          // Check if this might be comment icon (not like icon)
          // Comment icon is typically a speech bubble
          const pathD = svg.querySelector('path')?.getAttribute('d') || '';
          
          // Speech bubble path typically contains curves (C or c commands)
          if (pathD.includes('C') || pathD.includes('c')) {
            console.log("Found comment icon via SVG pattern");
            btn.setAttribute('data-comment-icon', 'true');
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return true;
          }
        }
      }
      
      return false;
    });

    if (!commentIconFound) {
      console.log("❌ Comment icon not found");
      const screenshotPath = `tiktok-no-comment-icon-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
      throw new Error("Comment icon not found on page");
    }

    console.log("✅ Found comment icon, clicking to open comment box...");
    await page.waitForTimeout(800);

    // Click the comment icon
    let clickSuccess = false;

    // Try clicking with locator
    try {
      const commentIcon = page.locator('[data-comment-icon="true"]').first();
      await commentIcon.click({ timeout: 5000 });
      clickSuccess = true;
      console.log("✅ Clicked comment icon (locator)");
    } catch (e) {
      console.log("⚠️ Locator click failed, trying JS...");
    }

    // Try JavaScript click
    if (!clickSuccess) {
      try {
        await page.evaluate(() => {
          const icon = document.querySelector('[data-comment-icon="true"]');
          if (icon) {
            icon.click();
          }
        });
        clickSuccess = true;
        console.log("✅ Clicked comment icon (JavaScript)");
      } catch (e) {
        console.log("⚠️ JS click failed");
      }
    }

    if (!clickSuccess) {
      throw new Error("Failed to click comment icon");
    }

    // Wait for comment box to appear
    console.log("⏳ Waiting for comment box to appear...");
    await page.waitForTimeout(3000);

    // STEP 2: Find the comment input box
    console.log("🔍 Looking for comment input box...");
    
    const commentBoxFound = await page.evaluate(() => {
      // Look for contenteditable divs
      const editableDivs = document.querySelectorAll('div[contenteditable="true"], div[contenteditable="plaintext-only"]');
      
      console.log(`Found ${editableDivs.length} editable divs`);
      
      for (const div of editableDivs) {
        const placeholder = div.getAttribute('data-placeholder') || div.getAttribute('placeholder') || '';
        const rect = div.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        
        console.log("Checking div:", { placeholder, isVisible, width: rect.width, height: rect.height });
        
        // Check if it's a comment box
        if (isVisible) {
          console.log("Found visible contenteditable div");
          div.setAttribute('data-comment-box', 'true');
          div.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
      }
      
      // Fallback: look for textarea
      const textareas = document.querySelectorAll('textarea');
      for (const textarea of textareas) {
        const rect = textarea.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          textarea.setAttribute('data-comment-box', 'true');
          textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
      }
      
      return false;
    });

    if (!commentBoxFound) {
      const screenshotPath = `tiktok-no-comment-box-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
      throw new Error("Comment input box not found after clicking icon");
    }

    console.log("✅ Found comment box");
    await page.waitForTimeout(1000);

    // STEP 3: Focus and type in comment box
    console.log("📝 Focusing on comment box...");
    
    await page.evaluate(() => {
      const box = document.querySelector('[data-comment-box="true"]');
      if (box) {
        box.click();
        box.focus();
      }
    });

    await page.waitForTimeout(1000);

    // Type the comment using keyboard simulation (more reliable)
    console.log(`⌨️ Typing comment: "${commentText}"`);
    
    const commentBox = page.locator('[data-comment-box="true"]').first();
    await commentBox.click();
    await page.waitForTimeout(500);
    
    // Type the comment character by character for more natural input
    await commentBox.type(commentText, { delay: 50 });
    
    console.log("✅ Comment typed");
    await page.waitForTimeout(2000);

    // STEP 4: Find and click Post button
    console.log("🔍 Looking for Post button...");
    
    const postBtnFound = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, div[role="button"]');
      
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || '';
        const dataE2e = btn.getAttribute('data-e2e') || '';
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const rect = btn.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        
        console.log("Checking button:", { text, dataE2e, ariaLabel, isVisible });
        
        // Look for Post button
        if (isVisible && (
          text.toLowerCase() === 'post' ||
          text.toLowerCase() === 'comment' ||
          dataE2e === 'comment-post' ||
          ariaLabel.toLowerCase().includes('post')
        )) {
          console.log("Found Post button!");
          btn.setAttribute('data-post-btn', 'true');
          return true;
        }
      }
      
      return false;
    });

    if (!postBtnFound) {
      const screenshotPath = `tiktok-no-post-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
      throw new Error("Post button not found");
    }

    console.log("✅ Found Post button, clicking...");
    await page.waitForTimeout(500);

    // Click Post button
    let postClickSuccess = false;

    try {
      const postBtn = page.locator('[data-post-btn="true"]').first();
      await postBtn.click({ timeout: 5000 });
      postClickSuccess = true;
      console.log("✅ Clicked Post button (locator)");
    } catch (e) {
      console.log("⚠️ Locator click failed, trying JS...");
    }

    if (!postClickSuccess) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-post-btn="true"]');
          if (btn) {
            btn.click();
          }
        });
        postClickSuccess = true;
        console.log("✅ Clicked Post button (JavaScript)");
      } catch (e) {
        console.log("⚠️ JS click failed");
      }
    }

    if (!postClickSuccess) {
      throw new Error("Failed to click Post button");
    }

    console.log("⏳ Waiting for comment to post...");
    await page.waitForTimeout(4000);

    // Verify comment was posted
    const verified = await page.evaluate((text) => {
      const bodyText = document.body.innerText;
      return bodyText.includes(text);
    }, commentText);

    console.log("✅ TikTok comment posted successfully!");
    
    return {
      success: true,
      message: "TikTok comment posted successfully",
      verified: verified,
      video_url: targetUrl,
      comment: commentText,
    };

  } catch (error) {
    console.error("❌ TikTok comment failed:", error.message);

    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `tiktok-comment-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(`📸 Error screenshot saved: tiktok-comment-error-${timestamp}.png`);
    } catch (e) {
      console.log("⚠️ Could not save screenshot");
    }

    return {
      success: false,
      message: error.message,
      video_url: targetUrl,
    };
  }
}

// Main function to handle all platforms
async function commentOnPost(page, platform, targetUrl, commentText) {
  try {
    if (platform === "tiktok") {
      return await tiktokComment(page, targetUrl, commentText);
    }
    if (platform === "twitter") {
      return await twitterComment(page, targetUrl, commentText);
    }
    if (platform === "instagram") {
      return await instagramComment(page, targetUrl, commentText);
    }
    if (platform === "facebook") {
      return await facebookComment(page, targetUrl, commentText);
    }
    
    return {
      success: false,
      message: `Commenting not supported on ${platform}`,
    };
  } catch (error) {
    console.error("❌ Comment failed:", error.message);
    
    try {
      await page.screenshot({
        path: `${platform}-comment-error-${Date.now()}.png`,
        fullPage: true,
      });
    } catch (e) {
      // Ignore screenshot errors
    }
    
    return { 
      success: false, 
      message: error.message 
    };
  }
}

// ==========================================
// FOLLOW USER FUNCTION
// ==========================================

async function instagramFollow(page, targetUrl) {
  console.log("📸 Instagram follow...");

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(4000);

  const followBtn = page
    .locator('button:has-text("Follow"), button:has-text("Follow Back")')
    .first();

  await followBtn.waitFor({ state: "visible", timeout: 15000 });
  await followBtn.click();

  console.log("✅ Instagram follow done");
}

async function facebookFollow(page, targetUrl) {
  console.log("📘 Processing Facebook friend request...");

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(8000);

  await page
    .locator('[aria-label="Close"]')
    .click()
    .catch(() => {});
  await page.waitForTimeout(1000);

  const addFriendSelectors = [
    'div[aria-label="Add Friend"]',
    'div[aria-label="Add friend"]',
    'span:text-is("Add Friend")',
    'span:text-is("Add friend")',
    'div[role="button"]:has-text("Add Friend")',
    '//div[@aria-label="Add Friend"]',
    '//span[text()="Add Friend"]',
  ];

  for (const selector of addFriendSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 8000 })) {
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        await btn.click({ timeout: 5000 });
        console.log(`✅ Facebook Add Friend clicked: ${selector}`);
        return;
      }
    } catch {}
  }

  const already = await page
    .locator(
      'span:has-text("Friends"), span:has-text("Friend request sent"), span:has-text("Cancel request")'
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (already) {
    console.log("ℹ️ Facebook request already sent / already friends");
    return;
  }

  await page.screenshot({
    path: `facebook-follow-error-${Date.now()}.png`,
    fullPage: true,
  });

  throw new Error("Facebook Add Friend button not found");
}

async function linkedinFollow(page, targetUrl) {
  console.log("💼 Processing LinkedIn follow/connect...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ LinkedIn profile loaded, waiting for content...");
    await page.waitForTimeout(5000);

    // Close any popups/modals
    const closeSelectors = [
      '[aria-label="Dismiss"]',
      'button[aria-label="Dismiss"]',
      "[data-test-modal-close-btn]",
    ];

    for (const selector of closeSelectors) {
      try {
        await page.locator(selector).first().click({ timeout: 2000 });
        console.log("✅ Closed popup");
        await page.waitForTimeout(1000);
      } catch (e) {
        // No popup to close
      }
    }

    // Scroll to load profile actions
    await page.evaluate(() => {
      window.scrollBy(0, 200);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Looking for Connect/Follow button...");

    // Check if already connected or following
    const alreadyConnectedSelectors = [
      'button:has-text("Message")',
      'button:has-text("Pending")',
      'button[aria-label*="Pending"]',
      'span:text-is("Message")',
      'span:text-is("Following")',
    ];

    let alreadyConnected = false;
    for (const selector of alreadyConnectedSelectors) {
      const elem = page.locator(selector).first();
      if (await elem.isVisible({ timeout: 2000 }).catch(() => false)) {
        alreadyConnected = true;
        console.log(`ℹ️ Already connected/following - found: ${selector}`);
        break;
      }
    }

    if (alreadyConnected) {
      return {
        success: true,
        message: "Already connected or request pending",
      };
    }

    // Find Connect or Follow button with multiple strategies
    const connectFollowSelectors = [
      // Connect button (sends connection request)
      'button:has-text("Connect")',
      'button[aria-label*="Connect"]',
      'span:text-is("Connect")',

      // Follow button (for following without connecting)
      'button:has-text("Follow")',
      'button[aria-label*="Follow"]',
      'span:text-is("Follow")',

      // More specific selectors
      'div.pvs-profile-actions button:has-text("Connect")',
      'div.pvs-profile-actions button:has-text("Follow")',

      // Action bar buttons
      'section.artdeco-card button:has-text("Connect")',
      'section.artdeco-card button:has-text("Follow")',
    ];

    let actionButton = null;
    let foundSelector = null;
    let actionType = null; // 'connect' or 'follow'

    for (const selector of connectFollowSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          actionButton = btn;
          foundSelector = selector;

          // Determine if it's Connect or Follow
          const buttonText = await btn.textContent();
          actionType = buttonText.toLowerCase().includes("connect")
            ? "connect"
            : "follow";

          console.log(
            `✅ Found ${actionType} button with selector: ${selector}`
          );
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Try "More" dropdown if primary buttons not found
    if (!actionButton) {
      console.log("🔍 Trying 'More' dropdown...");

      const moreButton = page.locator('button:has-text("More")').first();
      if (await moreButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await moreButton.click();
        await page.waitForTimeout(2000);

        // Look for Connect/Follow in dropdown
        const dropdownSelectors = [
          'div[role="menu"] span:text-is("Connect")',
          'div[role="menu"] span:text-is("Follow")',
          'ul.artdeco-dropdown__content-inner span:text-is("Connect")',
          'ul.artdeco-dropdown__content-inner span:text-is("Follow")',
        ];

        for (const selector of dropdownSelectors) {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            actionButton = btn;
            foundSelector = selector;

            const buttonText = await btn.textContent();
            actionType = buttonText.toLowerCase().includes("connect")
              ? "connect"
              : "follow";

            console.log(`✅ Found ${actionType} in More dropdown: ${selector}`);
            break;
          }
        }
      }
    }

    if (!actionButton) {
      // Take screenshot for debugging
      const screenshotPath = `linkedin-follow-error-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error(
        "LinkedIn Connect/Follow button not found - check screenshot"
      );
    }

    // Click the Connect/Follow button
    console.log(`💼 Clicking ${actionType} button...`);

    await actionButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    try {
      await actionButton.hover({ timeout: 5000 });
      await page.waitForTimeout(300);
      await actionButton.click({ timeout: 5000 });
    } catch (e) {
      console.log("⚠️ Regular click failed, trying force click...");
      await actionButton.click({ force: true });
    }

    await page.waitForTimeout(3000);

    // Handle "Connect" modal if it appears
    if (actionType === "connect") {
      console.log("🔍 Checking for connection request modal...");

      // Look for "Add a note" or "Send" button in modal
      const modalSelectors = [
        'button[aria-label="Send now"]',
        'button:has-text("Send without a note")',
        'button:has-text("Send")',
        'button[aria-label="Send invitation"]',
      ];

      let modalHandled = false;
      for (const selector of modalSelectors) {
        try {
          const sendBtn = page.locator(selector).first();
          if (await sendBtn.isVisible({ timeout: 5000 })) {
            await sendBtn.click({ timeout: 5000 });
            console.log(`✅ Sent connection request using: ${selector}`);
            modalHandled = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (modalHandled) {
        await page.waitForTimeout(3000);
      } else {
        console.log("ℹ️ No connection modal appeared or already sent");
      }
    }

    // Verify success
    await page.waitForTimeout(2000);

    const successIndicators = [
      'button:has-text("Pending")',
      'button:has-text("Message")',
      'button[aria-label*="Pending"]',
      'span:text-is("Pending")',
      'span:text-is("Following")',
    ];

    let actionConfirmed = false;
    for (const indicator of successIndicators) {
      if (
        await page
          .locator(indicator)
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        actionConfirmed = true;
        console.log(`✅ Success confirmed - found: ${indicator}`);
        break;
      }
    }

    if (!actionConfirmed) {
      console.warn(
        "⚠️ Success confirmation not detected - but action likely worked"
      );
    }

    const successMessage =
      actionType === "connect"
        ? "Connection request sent successfully"
        : "User followed successfully";

    console.log(`💼 LinkedIn ${actionType} successful`);
    return {
      success: true,
      message: actionConfirmed
        ? successMessage
        : `${successMessage} (confirmation pending)`,
      action: actionType,
      profile_url: targetUrl,
    };
  } catch (error) {
    console.error("❌ LinkedIn follow/connect failed:", error.message);

    // Debug screenshot
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `linkedin-follow-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: linkedin-follow-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `linkedin-follow-error-${timestamp}.png`,
    };
  }
}

async function twitterFollow(page, targetUrl) {
  console.log("🐦 Processing Twitter/X follow...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Twitter profile loaded, waiting for content...");
    await page.waitForTimeout(6000);

    // Scroll to ensure profile actions are loaded
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Checking current follow status...");

    // Check if already following and find follow button
    const followStatus = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll(
          'button, div[role="button"], span[role="button"]'
        )
      );

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check for "Following" state (already followed)
        if (
          text === "Following" ||
          ariaLabel.includes("Following") ||
          testId.endsWith("-unfollow") ||
          (testId.includes("unfollow") && !testId.includes("follow-"))
        ) {
          return { isFollowing: true, foundButton: false };
        }
      }

      // Now look for Follow button
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check for "Follow" button (not "Following")
        if (
          (text === "Follow" && text !== "Following") ||
          (ariaLabel === "Follow" && !ariaLabel.includes("Following")) ||
          (testId.endsWith("-follow") && !testId.includes("unfollow"))
        ) {
          // Mark this button for clicking
          btn.setAttribute("data-target-follow-btn", "true");
          return { isFollowing: false, foundButton: true };
        }
      }

      return { isFollowing: false, foundButton: false };
    });

    if (followStatus.isFollowing) {
      console.log("ℹ️ User is already following this account");
      return {
        success: true,
        message: "Already following this user",
        alreadyFollowing: true,
      };
    }

    if (!followStatus.foundButton) {
      console.log("❌ Follow button not found on page");

      const screenshotPath = `twitter-no-follow-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error(
        "Twitter Follow button not found - user may be private or blocked"
      );
    }

    console.log("🔍 Follow button found, attempting to click...");

    // Get the marked button
    const followButton = page
      .locator('[data-target-follow-btn="true"]')
      .first();

    // Scroll button into view
    await followButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    // Try to click with multiple strategies
    let clickSuccessful = false;

    // Strategy 1: Normal click
    try {
      await followButton.hover({ timeout: 3000 });
      await page.waitForTimeout(500);
      await followButton.click({ timeout: 5000 });
      clickSuccessful = true;
      console.log("✅ Clicked Follow button (normal click)");
    } catch (e) {
      console.log("⚠️ Normal click failed, trying force click...");
    }

    // Strategy 2: Force click
    if (!clickSuccessful) {
      try {
        await followButton.click({ force: true, timeout: 5000 });
        clickSuccessful = true;
        console.log("✅ Clicked Follow button (force click)");
      } catch (e) {
        console.log("⚠️ Force click failed, trying JavaScript click...");
      }
    }

    // Strategy 3: JavaScript click
    if (!clickSuccessful) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-target-follow-btn="true"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        clickSuccessful = true;
        console.log("✅ Clicked Follow button (JavaScript click)");
      } catch (e) {
        console.log("❌ All click strategies failed");
      }
    }

    if (!clickSuccessful) {
      throw new Error("Failed to click Follow button after multiple attempts");
    }

    // Wait for the action to register
    console.log("⏳ Waiting for follow action to complete...");
    await page.waitForTimeout(4000);

    // Verify follow was successful
    console.log("🔍 Verifying follow status...");

    const followConfirmed = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll(
          'button, div[role="button"], span[role="button"]'
        )
      );

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check if button now shows "Following"
        if (
          text === "Following" ||
          ariaLabel.includes("Following") ||
          testId.endsWith("-unfollow") ||
          (testId.includes("unfollow") && !testId.includes("follow-"))
        ) {
          return true;
        }
      }

      return false;
    });

    if (followConfirmed) {
      console.log("✅ Twitter follow successful and confirmed");
      return {
        success: true,
        message: "User followed successfully",
        confirmed: true,
        profile_url: targetUrl,
      };
    } else {
      console.warn(
        "⚠️ Follow button was clicked but confirmation not detected"
      );

      // Take a screenshot for debugging
      const screenshotPath = `twitter-follow-unconfirmed-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      return {
        success: true,
        message: "Follow button clicked (awaiting confirmation)",
        confirmed: false,
        profile_url: targetUrl,
        note: "Button was clicked but 'Following' status not yet detected. May need a few seconds.",
      };
    }
  } catch (error) {
    console.error("❌ Twitter follow failed:", error.message);

    // Debug screenshot
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `twitter-follow-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: twitter-follow-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `twitter-follow-error-${timestamp}.png`,
      profile_url: targetUrl,
    };
  }
}

async function tiktokFollow(page, targetUrl) {
  console.log("🎵 Processing TikTok follow...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    // Navigate to the TikTok profile
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ TikTok profile loaded, waiting for content...");
    await page.waitForTimeout(5000);

    // Scroll to ensure profile actions are loaded
    await page.evaluate(() => {
      window.scrollBy(0, 200);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Looking for Follow button...");

    // Try multiple selector strategies to find the Follow button
    const followSelectors = [
      'button:has-text("Follow")',
      'button[data-e2e="follow-button"]',
      'button[data-e2e="profile-follow-button"]',
    ];

    let followButton = null;
    let buttonFound = false;

    // Try each selector
    for (const selector of followSelectors) {
      try {
        const btn = page.locator(selector).first();
        const isVisible = await btn.isVisible({ timeout: 3000 });
        
        if (isVisible) {
          const buttonText = await btn.textContent();
          console.log(`Found button with selector: ${selector}, Text: "${buttonText}"`);
          
          // Make sure it's "Follow" and NOT "Following"
          if (buttonText && buttonText.trim() === "Follow") {
            followButton = btn;
            buttonFound = true;
            console.log("✅ Valid Follow button found");
            break;
          } else if (buttonText && buttonText.trim() === "Following") {
            console.log("ℹ️ User is already following this account");
            return {
              success: true,
              message: "Already following this user",
              alreadyFollowing: true,
            };
          }
        }
      } catch (e) {
        console.log(`Selector ${selector} not found, trying next...`);
        continue;
      }
    }

    // If not found by selectors, try finding by text content
    if (!buttonFound) {
      console.log("🔍 Trying to find button by searching all buttons...");
      
      const buttonResult = await page.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button'));
        
        for (const btn of allButtons) {
          const text = btn.textContent?.trim() || "";
          
          console.log(`Checking button: "${text}"`);
          
          // Check for exact "Following" first
          if (text === "Following") {
            return { found: true, isFollowing: true, buttonText: text };
          }
          
          // Check for exact "Follow"
          if (text === "Follow") {
            btn.setAttribute("data-tiktok-follow-btn", "true");
            return { found: true, isFollowing: false, buttonText: text };
          }
        }
        
        return { found: false, isFollowing: false, buttonText: null };
      });

      console.log("Button search result:", buttonResult);

      if (buttonResult.isFollowing) {
        console.log("ℹ️ User is already following this account");
        return {
          success: true,
          message: "Already following this user",
          alreadyFollowing: true,
        };
      }

      if (buttonResult.found && !buttonResult.isFollowing) {
        followButton = page.locator('[data-tiktok-follow-btn="true"]').first();
        buttonFound = true;
        console.log(`✅ Follow button found with text: "${buttonResult.buttonText}"`);
      }
    }

    if (!buttonFound) {
      console.log("❌ Follow button not found on page");
      
      const screenshotPath = `tiktok-no-follow-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("TikTok Follow button not found");
    }

    // Now click the Follow button
    console.log("🖱️ Attempting to click Follow button...");

    // Scroll button into view
    await followButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    let clickSuccessful = false;

    // Strategy 1: Normal click
    try {
      await followButton.click({ timeout: 5000 });
      clickSuccessful = true;
      console.log("✅ Clicked Follow button (normal click)");
    } catch (e) {
      console.log("⚠️ Normal click failed, trying force click...");
    }

    // Strategy 2: Force click
    if (!clickSuccessful) {
      try {
        await followButton.click({ force: true, timeout: 5000 });
        clickSuccessful = true;
        console.log("✅ Clicked Follow button (force click)");
      } catch (e) {
        console.log("⚠️ Force click failed, trying JavaScript click...");
      }
    }

    // Strategy 3: JavaScript click
    if (!clickSuccessful) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-tiktok-follow-btn="true"]');
          if (btn) {
            btn.click();
            return true;
          }
          // Fallback: find any button with "Follow" text
          const allButtons = Array.from(document.querySelectorAll('button'));
          for (const button of allButtons) {
            if (button.textContent?.trim() === "Follow") {
              button.click();
              return true;
            }
          }
          return false;
        });
        clickSuccessful = true;
        console.log("✅ Clicked Follow button (JavaScript click)");
      } catch (e) {
        console.log("❌ JavaScript click failed:", e.message);
      }
    }

    if (!clickSuccessful) {
      throw new Error("Failed to click Follow button after all attempts");
    }

    // Wait for the action to complete
    console.log("⏳ Waiting for follow action to complete...");
    await page.waitForTimeout(5000);

    // Verify the follow was successful
    console.log("🔍 Verifying follow status...");

    const followConfirmed = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        
        // Check if button now shows "Following"
        if (text === "Following") {
          console.log("✅ Follow confirmed - button shows: Following");
          return true;
        }
      }
      
      return false;
    });

    if (followConfirmed) {
      console.log("✅ TikTok follow successful and confirmed");
      return {
        success: true,
        message: "User followed successfully",
        confirmed: true,
        profile_url: targetUrl,
      };
    } else {
      console.log("⚠️ Follow button clicked but confirmation not detected yet");
      
      // Take screenshot for debugging
      const screenshotPath = `tiktok-follow-pending-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      return {
        success: true,
        message: "Follow button clicked successfully",
        confirmed: false,
        profile_url: targetUrl,
        note: "Button was clicked. Follow may take a moment to register.",
      };
    }

  } catch (error) {
    console.error("❌ TikTok follow failed:", error.message);

    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `tiktok-follow-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(`📸 Error screenshot saved: tiktok-follow-error-${timestamp}.png`);
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `tiktok-follow-error-${timestamp}.png`,
      profile_url: targetUrl,
    };
  }
}

async function followUser(page, platform, targetUrl) {
  console.log(`👤 Following user on ${platform}...`);

  try {
    if (platform === "instagram") {
      return await instagramFollow(page, targetUrl);
    } else if (platform === "facebook") {
      return await facebookFollow(page, targetUrl);
    } else if (platform === "twitter") {
      return await twitterFollow(page, targetUrl);
    } else if (platform === "tiktok") {
      return await tiktokFollow(page, targetUrl);
    } else if (platform === "linkedin") {
      return await linkedinFollow(page, targetUrl);
    } else {
      throw new Error(`Platform ${platform} not supported`);
    }
  } catch (error) {
    console.error("❌ Follow failed:", error.message);
    return { success: false, message: error.message };
  }
}

//unfollow

async function instagramUnfollow(page, targetUrl) {
  console.log("📸 Processing Instagram unfollow...");

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  const followingBtn = page.locator('button:has-text("Following")').first();
  const isFollowing = await followingBtn.isVisible().catch(() => false);

  if (!isFollowing) {
    console.log("ℹ️ User is not followed");
    return { success: true, message: "User was not followed" };
  }

  await followingBtn.click();
  await page.waitForTimeout(2000);

  const dialog = page.locator('div[role="dialog"]').first();
  await dialog.waitFor({ state: "visible", timeout: 15000 });

  const unfollowBtn = dialog
    .locator('div[role="button"]:has-text("Unfollow")')
    .first();

  await unfollowBtn.waitFor({ state: "visible", timeout: 15000 });
  await unfollowBtn.click();

  await page.waitForTimeout(3000);

  console.log("✅ Instagram unfollowed");
  return { success: true, message: "Instagram unfollowed successfully" };
}

async function facebookUnfriend(page, targetUrl) {
  console.log("📘 Processing Facebook unfriend...");

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(7000);

  await page
    .locator('[aria-label="Close"]')
    .click()
    .catch(() => {});
  await page.waitForTimeout(1000);

  const friendsSelectors = [
    'div[aria-label="Friends"]',
    'span:text-is("Friends")',
    'div[role="button"]:has-text("Friends")',
    '//span[text()="Friends"]',
  ];

  let friendsBtn = null;
  for (const sel of friendsSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      friendsBtn = btn;
      break;
    }
  }

  if (!friendsBtn) {
    const notFriends = await page
      .locator('div[aria-label="Add Friend"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (notFriends) {
      return { success: true, message: "User is not a friend" };
    }

    throw new Error("Friends button not found");
  }

  await friendsBtn.scrollIntoViewIfNeeded();
  await friendsBtn.click();
  await page.waitForTimeout(2000);

  const unfriendSelectors = [
    'div[role="menuitem"]:has-text("Unfriend")',
    'span:text-is("Unfriend")',
    '//span[text()="Unfriend"]',
  ];

  let unfriendBtn = null;
  for (const sel of unfriendSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      unfriendBtn = btn;
      break;
    }
  }

  if (!unfriendBtn) {
    throw new Error("Unfriend option not found");
  }

  await unfriendBtn.click();
  await page.waitForTimeout(2000);

  const confirmBtn = page
    .locator('div[role="button"]:has-text("Confirm"), span:text-is("Confirm")')
    .first();

  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
  }

  await page.waitForTimeout(3000);

  console.log("✅ Facebook unfriended");
  return { success: true, message: "Facebook unfriended successfully" };
}

async function twitterUnfollow(page, targetUrl) {
  console.log("🐦 Processing Twitter/X unfollow...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ Twitter profile loaded, waiting for content...");
    await page.waitForTimeout(6000);

    // Scroll to ensure profile actions are loaded
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Checking if currently following...");

    // Check if currently following and find unfollow button
    const followStatus = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll(
          'button, div[role="button"], span[role="button"]'
        )
      );

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check for "Following" state (can unfollow)
        if (
          text === "Following" ||
          ariaLabel.includes("Following") ||
          testId.endsWith("-unfollow") ||
          (testId.includes("unfollow") && !testId.includes("follow-"))
        ) {
          // Mark this button for clicking
          btn.setAttribute("data-target-unfollow-btn", "true");
          return { isFollowing: true, foundButton: true };
        }
      }

      // Check if showing "Follow" button (not following)
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const testId = btn.getAttribute("data-testid") || "";

        if (
          text === "Follow" ||
          (testId.endsWith("-follow") && !testId.includes("unfollow"))
        ) {
          return { isFollowing: false, foundButton: false };
        }
      }

      return { isFollowing: false, foundButton: false };
    });

    if (!followStatus.isFollowing) {
      console.log("ℹ️ User is not currently following this account");
      return {
        success: true,
        message: "User was not followed",
        wasFollowing: false,
      };
    }

    if (!followStatus.foundButton) {
      console.log("❌ Following button not found on page");

      const screenshotPath = `twitter-no-unfollow-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      throw new Error("Twitter Following button not found");
    }

    console.log("🔍 Following button found, attempting to click...");

    // Get the marked button
    const unfollowButton = page
      .locator('[data-target-unfollow-btn="true"]')
      .first();

    // Scroll button into view
    await unfollowButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    // Click the Following button
    let clickSuccessful = false;

    // Strategy 1: Normal click
    try {
      await unfollowButton.hover({ timeout: 3000 });
      await page.waitForTimeout(500);
      await unfollowButton.click({ timeout: 5000 });
      clickSuccessful = true;
      console.log("✅ Clicked Following button (normal click)");
    } catch (e) {
      console.log("⚠️ Normal click failed, trying force click...");
    }

    // Strategy 2: Force click
    if (!clickSuccessful) {
      try {
        await unfollowButton.click({ force: true, timeout: 5000 });
        clickSuccessful = true;
        console.log("✅ Clicked Following button (force click)");
      } catch (e) {
        console.log("⚠️ Force click failed, trying JavaScript click...");
      }
    }

    // Strategy 3: JavaScript click
    if (!clickSuccessful) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector(
            '[data-target-unfollow-btn="true"]'
          );
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        clickSuccessful = true;
        console.log("✅ Clicked Following button (JavaScript click)");
      } catch (e) {
        console.log("❌ All click strategies failed");
      }
    }

    if (!clickSuccessful) {
      throw new Error(
        "Failed to click Following button after multiple attempts"
      );
    }

    // Wait for confirmation modal to appear
    console.log("⏳ Waiting for unfollow confirmation modal...");
    await page.waitForTimeout(2000);

    // Find and click the confirmation button
    const confirmSelectors = [
      '[data-testid="confirmationSheetConfirm"]',
      'button:has-text("Unfollow")',
      'div[role="button"]:has-text("Unfollow")',
      '[data-testid="confirmationSheetDialog"] button:has-text("Unfollow")',
    ];

    let confirmButton = null;
    let confirmClicked = false;

    for (const selector of confirmSelectors) {
      try {
        const btn = page.locator(selector).first();
        const isVisible = await btn.isVisible({ timeout: 5000 });

        if (isVisible) {
          confirmButton = btn;
          console.log(`✅ Found confirmation button: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!confirmButton) {
      console.log("⚠️ Confirmation button not found, trying JavaScript...");

      // Try to find and click confirmation via JavaScript
      const jsConfirmed = await page.evaluate(() => {
        // Look for modal dialog
        const dialogs = document.querySelectorAll(
          '[role="dialog"], [data-testid="confirmationSheetDialog"]'
        );

        for (const dialog of dialogs) {
          const buttons = dialog.querySelectorAll('button, div[role="button"]');

          for (const btn of buttons) {
            const text = btn.textContent?.trim() || "";
            const testId = btn.getAttribute("data-testid") || "";

            if (text === "Unfollow" || testId === "confirmationSheetConfirm") {
              btn.click();
              return true;
            }
          }
        }

        return false;
      });

      if (jsConfirmed) {
        confirmClicked = true;
        console.log("✅ Clicked confirmation button via JavaScript");
      }
    } else {
      // Click the confirmation button
      try {
        await confirmButton.click({ timeout: 5000 });
        confirmClicked = true;
        console.log("✅ Clicked confirmation button");
      } catch (e) {
        // Try force click
        try {
          await confirmButton.click({ force: true });
          confirmClicked = true;
          console.log("✅ Clicked confirmation button (force)");
        } catch (e2) {
          console.log("❌ Failed to click confirmation button");
        }
      }
    }

    if (!confirmClicked) {
      throw new Error("Failed to confirm unfollow action");
    }

    // Wait for the action to complete
    console.log("⏳ Waiting for unfollow action to complete...");
    await page.waitForTimeout(4000);

    // Verify unfollow was successful
    console.log("🔍 Verifying unfollow status...");

    const unfollowConfirmed = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll(
          'button, div[role="button"], span[role="button"]'
        )
      );

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const testId = btn.getAttribute("data-testid") || "";

        // Check if button now shows "Follow" (not following anymore)
        if (
          (text === "Follow" && text !== "Following") ||
          (ariaLabel === "Follow" && !ariaLabel.includes("Following")) ||
          (testId.endsWith("-follow") && !testId.includes("unfollow"))
        ) {
          return true;
        }
      }

      return false;
    });

    if (unfollowConfirmed) {
      console.log("✅ Twitter unfollow successful and confirmed");
      return {
        success: true,
        message: "User unfollowed successfully",
        confirmed: true,
        profile_url: targetUrl,
      };
    } else {
      console.warn(
        "⚠️ Unfollow action completed but confirmation not detected"
      );

      // Take a screenshot for debugging
      const screenshotPath = `twitter-unfollow-unconfirmed-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      return {
        success: true,
        message: "Unfollow action completed (awaiting confirmation)",
        confirmed: false,
        profile_url: targetUrl,
        note: "Unfollow was executed but 'Follow' status not yet detected. May need a few seconds.",
      };
    }
  } catch (error) {
    console.error("❌ Twitter unfollow failed:", error.message);

    // Debug screenshot
    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `twitter-unfollow-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: twitter-unfollow-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `twitter-unfollow-error-${timestamp}.png`,
      profile_url: targetUrl,
    };
  }
}

async function tiktokUnfollow(page, targetUrl) {
  console.log("🎵 Processing TikTok unfollow...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    // Navigate to the TikTok profile
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ TikTok profile loaded, waiting for content...");
    await page.waitForTimeout(3000);

    console.log("🔍 Looking for Following button...");

    // Click the "Following" button
    const clickResult = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        
        // Look for "Following" button (contains the text)
        if (text.includes("Following")) {
          console.log("✅ Found Following button, clicking...");
          btn.click();
          return { success: true, found: true };
        }
      }
      
      // Check if already showing "Follow" (not following)
      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        if (text === "Follow") {
          console.log("ℹ️ Button shows 'Follow' - user not following");
          return { success: false, found: true, notFollowing: true };
        }
      }
      
      return { success: false, found: false };
    });

    console.log("Click result:", clickResult);

    if (clickResult.notFollowing) {
      console.log("ℹ️ User is not following this account");
      return {
        success: true,
        message: "User is not following this account",
        alreadyUnfollowed: true,
      };
    }

    if (!clickResult.found || !clickResult.success) {
      throw new Error("Following button not found or click failed");
    }

    console.log("✅ Following button clicked");

    // Wait for the confirmation dialog to appear
    console.log("⏳ Waiting for Unfollow confirmation...");
    await page.waitForTimeout(1500);

    // Click the "Unfollow" confirmation button
    const unfollowResult = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        
        if (text === "Unfollow") {
          console.log("✅ Found Unfollow button, clicking...");
          btn.click();
          return { success: true };
        }
      }
      
      console.log("❌ Unfollow button not found");
      return { success: false };
    });

    if (!unfollowResult.success) {
      throw new Error("Unfollow confirmation button not found");
    }

    console.log("✅ Unfollow button clicked");

    // Wait for the action to complete
    await page.waitForTimeout(2000);

    // Verify by checking if button changed to "Follow"
    console.log("🔍 Verifying unfollow...");
    const verifyResult = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      
      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        
        if (text === "Follow") {
          return { success: true };
        }
      }
      
      return { success: false };
    });

    if (verifyResult.success) {
      console.log("✅ TikTok unfollow successful!");
      return {
        success: true,
        message: "User unfollowed successfully",
        profile_url: targetUrl,
      };
    } else {
      throw new Error("Unfollow verification failed");
    }

  } catch (error) {
    console.error("❌ TikTok unfollow failed:", error.message);

    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `tiktok-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: tiktok-error-${timestamp}.png`);
    } catch (screenshotError) {
      console.log("⚠️ Could not save screenshot");
    }

    return {
      success: false,
      message: error.message,
      profile_url: targetUrl,
    };
  }
}
async function unfollowUser(page, platform, targetUrl) {
  console.log(`🚫 Unfollowing user on ${platform}...`);

  try {
    if (platform === "instagram") {
      return await instagramUnfollow(page, targetUrl);
    }

    if (platform === "facebook") {
      return await facebookUnfriend(page, targetUrl);
    }

    if (platform === "twitter" || platform === "x") {
      return await twitterUnfollow(page, targetUrl);
    }
    if (platform === "tiktok") {
      return await tiktokUnfollow(page, targetUrl);
    }

    return {
      success: false,
      message: `Unfollow not supported for ${platform}`,
    };
  } catch (error) {
    console.error("❌ Unfollow failed:", error.message);

    await page
      .screenshot({
        path: `${platform}-unfollow-error-${Date.now()}.png`,
        fullPage: true,
      })
      .catch(() => {});

    return { success: false, message: error.message };
  }
}

// async function unfollowUser(page, platform, targetUrl) {
//   console.log(`🚫 Unfollowing user on ${platform}...`);

//   try {
//     await page.goto(targetUrl, {
//       waitUntil: "domcontentloaded",
//       timeout: 60000,
//     });

//     await page.waitForTimeout(4000);

//     if (platform !== "instagram") {
//       return {
//         success: false,
//         message: `Unfollow not supported for ${platform}`,
//       };
//     }

//     // STEP 1: Find "Following" button
//     const followingBtn = page.locator('button:has-text("Following")').first();

//     const isFollowing = await followingBtn.count();
//     if (!isFollowing) {
//       console.log("ℹ️ User is NOT followed — skipping unfollow");
//       return {
//         success: true,
//         message: "User was not followed, nothing to unfollow",
//       };
//     }

//     // ✅ CLICK FOLLOWING (THIS WAS MISSING)
//     await followingBtn.waitFor({ state: "visible", timeout: 15000 });
//     await followingBtn.click();
//     await page.waitForTimeout(2000);

//     // STEP 2: Wait for dialog
//     const dialog = page.locator('div[role="dialog"]').first();
//     await dialog.waitFor({ state: "visible", timeout: 15000 });

//     // STEP 3: Click Unfollow
//     const unfollowBtn = dialog
//       .locator('div[role="button"]:has-text("Unfollow")')
//       .first();

//     await unfollowBtn.waitFor({ state: "visible", timeout: 15000 });
//     await unfollowBtn.click();

//     await page.waitForTimeout(3000);

//     console.log("✅ Unfollowed successfully");
//     return {
//       success: true,
//       message: "User unfollowed successfully",
//     };
//   } catch (error) {
//     console.error("❌ Unfollow failed:", error.message);
//     return {
//       success: false,
//       message: error.message,
//     };
//   }
// }

// Helper function to extract auth token

function extractAuthToken(cookies, platform) {
  const tokenMap = {
    instagram: "sessionid",
    facebook: "c_user",
    twitter: "auth_token",
    linkedin: "li_at",
    youtube: "SAPISID",
    tiktok: "sessionid",
  };

  const tokenName = tokenMap[platform];
  const cookie = cookies.find((c) => c.name === tokenName);
  return cookie ? cookie.value : null;
}

app.listen(PORT, () => {
  console.log(`🚀 Node API running http://localhost:${PORT}`);
});
