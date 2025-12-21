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
  tiktok: "https://www.tiktok.com/login",
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
app.post("/login-social", async (req, res) => {
  const {
    username,
    password,
    platform,
    account_id,
  } = req.body;

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
      headless: false,  // Changed to false so you can see what's happening
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["geolocation", "notifications"],
      viewport: { width: 1280, height: 720 }
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
        break;

      case "twitter":
        await page.waitForSelector('input[name="text"]', { timeout: 20000 });
        await page.fill('input[name="text"]', username);
        await page.keyboard.press("Enter");

        await page.waitForTimeout(3000);
        await page.fill('input[name="password"]', password);
        await page.keyboard.press("Enter");
        break;

      case "tiktok":
        await page.waitForTimeout(3000);
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click("button");
        break;

      case "linkedin":
        await page.waitForSelector("#username", { timeout: 20000 });
        await page.fill("#username", username);
        await page.fill("#password", password);
        await page.click('button[type="submit"]');
        break;

      case "youtube":
        await page.waitForSelector('input[type="email"]', { timeout: 20000 });
        await page.fill("input[type=email]", username);
        await page.keyboard.press("Enter");

        await page.waitForTimeout(3000);
        await page.fill("input[type=password]", password);
        await page.keyboard.press("Enter");
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
  const {
    platform,
    cookies,
    sessionData,
  } = req.body;

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
        headless: false,  // Browser will be visible
        slowMo: 100,      // Slow down operations by 100ms for visibility
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--start-maximized'
        ]
      });

      context = await browser.newContext({
        storageState,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        locale: "en-US",
        viewport: { width: 1280, height: 720 },
        permissions: ["geolocation", "notifications"]
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
      return await createInstagramPost(page, task); // ✅ PASS task
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
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Click "What's on your mind?" box
    await page.click('[aria-label="Create a post"]').catch(() => {
      return page.click('div[role="button"]:has-text("What\'s on your mind")');
    });

    await page.waitForTimeout(2000);

    // Type content
    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    const textBox = await page
      .locator('[aria-label="What\'s on your mind?"]')
      .first();
    await textBox.fill(fullText);

    await page.waitForTimeout(2000);

    // Click Post button
    await page.click('div[aria-label="Post"]').catch(() => {
      return page.click('div[role="button"]:has-text("Post")');
    });

    await page.waitForTimeout(5000);

    console.log("✅ Facebook post created successfully");
    return {
      success: true,
      message: "Facebook post created successfully",
      post_url: page.url(),
    };
  } catch (error) {
    console.error("❌ Facebook post failed:", error.message);
    return { success: false, message: error.message };
  }
}

// ==========================================
// TWITTER POST
// ==========================================
async function createTwitterPost(page, postContent) {
  console.log("🐦 Creating Twitter post...");

  try {
    await page.goto("https://twitter.com/home", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Click tweet box
    const tweetBox = await page
      .locator('[data-testid="tweetTextarea_0"]')
      .first();

    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    await tweetBox.fill(fullText);
    await page.waitForTimeout(2000);

    // Click Post/Tweet button
    await page.click('[data-testid="tweetButtonInline"]');
    await page.waitForTimeout(5000);

    console.log("✅ Twitter post created successfully");
    return {
      success: true,
      message: "Twitter post created successfully",
      post_url: page.url(),
    };
  } catch (error) {
    console.error("❌ Twitter post failed:", error.message);
    return { success: false, message: error.message };
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
async function likePost(page, platform, targetUrl) {
  console.log(`❤️ Liking post on ${platform}... new code`);

  try {
    if (!targetUrl) throw new Error("Target URL missing");
    if (platform !== "instagram") throw new Error("Platform not supported");

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
      await page.screenshot({ path: "like-attempt.png", fullPage: false });
      return {
        success: true,
        message: "Like attempted (no visual confirmation)",
      };
    }

    console.log("❤️ Like successful & confirmed");
    return { success: true, message: "Post liked successfully" };
  } catch (error) {
    console.error("❌ Like failed:", error.message);
    // Debug screenshot
    try {
      await page.screenshot({ path: "like-error.png", fullPage: false });
    } catch {}
    return { success: false, message: error.message };
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
      'i.x1b0d669.xep6ejk' // Facebook X icon class
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
      'div.x1ed109x.xrvj5dj.x1l90r2v.xds687c', // Facebook comment box classes
      'div[data-lexical-editor="true"]',
      'textarea[placeholder*="Write a comment"]',
      'div.notranslate._5rpu' // Older Facebook class
    ];

    let commentBox = null;
    let foundSelector = null;

    for (const sel of commentSelectors) {
      try {
        const box = page.locator(sel).first();
        const isVisible = await box.isVisible({ timeout: 3000 }).catch(() => false);
        
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
      console.log(`📸 Error screenshot saved: facebook-comment-error-${timestamp}.png`);
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

async function commentOnPost(page, platform, targetUrl, commentText) {
  try {
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
    await page
      .screenshot({
        path: `${platform}-comment-error-${Date.now()}.png`,
        fullPage: true,
      })
      .catch(() => {});
    return { success: false, message: error.message };
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

async function twitterFollow(page, targetUrl) {
  console.log("🐦 Processing Twitter/X follow...");

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  const selectors = [
    '[data-testid$="-follow"]',
    'button:has-text("Follow")',
    '[role="button"]:has-text("Follow")',
  ];

  for (const selector of selectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 5000 })) {
        await btn.click({ timeout: 5000 });
        console.log(`✅ Twitter follow clicked: ${selector}`);
        return;
      }
    } catch {}
  }

  const already = await page
    .locator('button:has-text("Following")')
    .first()
    .isVisible()
    .catch(() => false);

  if (already) {
    console.log("ℹ️ Already following on Twitter/X");
    return;
  }

  throw new Error("Twitter follow button not found");
}
async function followUser(page, platform, targetUrl) {
  console.log(`👤 Following user on ${platform}...`);

  try {
    if (platform === "instagram") {
      await instagramFollow(page, targetUrl);
    } else if (platform === "facebook") {
      await facebookFollow(page, targetUrl);
    } else if (platform === "twitter") {
      await twitterFollow(page, targetUrl);
    } else {
      throw new Error(`Platform ${platform} not supported`);
    }

    await page.waitForTimeout(3000);

    return { success: true, message: "User followed successfully" };
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

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(4000);

  const unfollowBtn = page.locator('[data-testid$="-unfollow"]').first();
  const isFollowing = await unfollowBtn.isVisible().catch(() => false);

  if (!isFollowing) {
    return { success: true, message: "User was not followed" };
  }

  await unfollowBtn.click();
  await page.waitForTimeout(2000);

  const confirmBtn = page
    .locator('[data-testid="confirmationSheetConfirm"]')
    .first();

  await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
  await confirmBtn.click();

  await page.waitForTimeout(3000);

  console.log("✅ Twitter unfollowed");
  return { success: true, message: "Twitter unfollowed successfully" };
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
