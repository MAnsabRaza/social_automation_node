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
  youtube:
    "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F&dsh=S1359224021%3A1766843685369378&ec=65620&hl=en&ifkv=Ac2yZaUMabvbQcslE6h1iTgIEGmRjXVU4CAOAA3pbO8EMLrrsucsaRPXf8CT6G_l1hpDocOn9-GI2A&passive=true&service=youtube&uilel=3&flowName=GlifWebSignIn&flowEntry=ServiceLogin",
  tiktok: "https://www.tiktok.com/login/phone-or-email/email",
  twitter: "https://twitter.com/login",
  linkedin: "https://www.linkedin.com/login",
};
let activeBrowsers = {}; // store browsers and pages
let activeContexts = {};
const activeScrollBots = {};
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

        await page.waitForTimeout(3000);

        // Email entry
        const emailSelectors = [
          'input[autocomplete="username"]',
          'input[name="text"]',
        ];
        let emailEntered = false;
        for (const selector of emailSelectors) {
          try {
            const input = await page.waitForSelector(selector, {
              timeout: 5000,
              state: "visible",
            });
            if (input) {
              await input.fill(twitterEmail);
              emailEntered = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!emailEntered) throw new Error("Could not find email input");

        await page.waitForTimeout(1000);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(4000);

        // Username if required
        try {
          const usernameInput = await page.waitForSelector(
            'input[data-testid="ocfEnterTextTextInput"]',
            { timeout: 5000 }
          );
          if (usernameInput) {
            await usernameInput.fill(twitterUsername.replace("@", ""));
            await page.keyboard.press("Enter");
            await page.waitForTimeout(4000);
          }
        } catch (e) {}

        // Password
        const passwordInput = await page.waitForSelector(
          'input[name="password"]',
          { timeout: 8000 }
        );
        await passwordInput.fill(password);
        await page.waitForTimeout(1500);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(8000);
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
        ];
        let tiktokEmailEntered = false;
        for (const selector of tiktokEmailSelectors) {
          try {
            const input = await page.waitForSelector(selector, {
              timeout: 5000,
              state: "visible",
            });
            if (input) {
              await input.fill(tiktokEmail);
              console.log("✅ Email entered");
              tiktokEmailEntered = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!tiktokEmailEntered)
          throw new Error("Could not find TikTok email input");

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
              await input.fill(password);
              console.log("✅ Password entered");
              tiktokPasswordEntered = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!tiktokPasswordEntered)
          throw new Error("Could not find TikTok password input");

        // Click Login
        await page.waitForTimeout(1000);
        const tiktokLoginSelectors = [
          'button[type="submit"]',
          'button:has-text("Log in")',
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

        if (!tiktokLoginClicked) await page.keyboard.press("Enter");

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

        // Wait for successful redirect
        try {
          await page.waitForURL("**/foryou**", { timeout: 15000 });
          console.log("✅ Successfully redirected to TikTok home");
        } catch (e) {
          const currentUrl = page.url();
          console.log("⚠️ Current URL:", currentUrl);
          if (currentUrl.includes("/login")) {
            throw new Error("Login failed - still on login page");
          }
        }

        // Extra wait for cookies to settle
        await page.waitForTimeout(5000);
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

    // Final wait for all platforms
    await page.waitForTimeout(5000);

    // Get storage state
    console.log("📦 Capturing storage state...");
    const storageState = await context.storageState();

    console.log("📊 Storage State Details:");
    console.log("  - Cookies count:", storageState.cookies?.length || 0);
    console.log("  - Origins count:", storageState.origins?.length || 0);

    // Show cookie names for debugging
    if (storageState.cookies && storageState.cookies.length > 0) {
      const cookieNames = storageState.cookies.map((c) => c.name).join(", ");
      console.log("  - Cookie names:", cookieNames);
    }

    // Extract auth token
    const authToken = extractAuthToken(storageState.cookies, platform);

    // Convert to JSON string
    const sessionDataString = JSON.stringify(storageState);

    console.log("📏 Data Sizes:");
    console.log(
      "  - Session Data:",
      sessionDataString.length,
      "bytes",
      "(" + (sessionDataString.length / 1024).toFixed(2) + " KB)"
    );
    console.log(
      "  - Cookies:",
      JSON.stringify(storageState.cookies).length,
      "bytes"
    );
    console.log("  - Auth Token:", authToken ? "Found" : "Not found");

    // Log first 500 chars of session data for debugging
    console.log("📝 Session Data Preview (first 500 chars):");
    console.log(sessionDataString.substring(0, 500));

    const response = {
      success: true,
      message: "Login successful",
      sessionData: sessionDataString,
      cookies: storageState.cookies,
      authToken: authToken,
    };

    console.log(`✅ Login successful → ${account_id}`);
    console.log(
      `📊 Response prepared with ${Object.keys(response).length} fields`
    );

    return res.json(response);
  } catch (error) {
    console.error("❌ Login failed:", error.message);
    console.error("Stack trace:", error.stack);

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
        headless: false,
        slowMo: 100,
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

    // 🔥 UNLIMITED AUTO-SCROLL
    if (taskType === "scroll" || taskType === "share") {
      const options = {
        likeChance: task.likeChance || 30,
        commentChance: task.commentChance || 8,
        shareChance: task.shareChance || 5,
        comments: task.comments || undefined,
      };

      if (platform === "instagram") {
        instagramScrollBot(page, account.id, options);
        return res.json({
          success: true,
          message: "Instagram unlimited scrolling started",
          info: "Bot will run until you call /stop-scroll",
        });
      }

      if (platform === "facebook") {
        facebookScrollBot(page, account.id, options);
        return res.json({
          success: true,
          message: "Facebook unlimited scrolling started",
          info: "Bot will run until you call /stop-scroll",
        });
      }

      if (platform === "twitter") {
        twitterScrollBot(page, account.id, options);
        return res.json({
          success: true,
          message: "Twitter unlimited scrolling started",
          info: "Bot will run until you call /stop-scroll",
        });
      }
      if (platform === "youtube") {
        const youtubeOptions = {
          likeChance: task.likeChance || 35,
          commentChance: task.commentChance || 10,
          comments: task.comments || undefined,
        };

        youtubeScrollBot(page, account.id, youtubeOptions);
        return res.json({
          success: true,
          message: "YouTube Shorts unlimited scrolling started",
          info: "Bot will run until you call /stop-scroll",
        });
      }

      if (platform === "tiktok") {
        // ⭐ Pass email and password for TikTok auto-login
        const tiktokOptions = {
          ...options,
          email: account.account_email || account.account_username,
          password: account.account_password,
        };

        tiktokScrollBot(page, account.id, tiktokOptions);
        return res.json({
          success: true,
          message: "TikTok unlimited scrolling started (with auto-login)",
          info: "Bot will automatically log in if needed, then start scrolling. Call /stop-scroll to stop.",
        });
      }

      return res.json({
        success: false,
        message: `Scroll bot not available for platform: ${platform}`,
      });
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
    if (platform === "linkedin") {
      return await createLinkedInPost(page, task);
    }
    if (platform === "tiktok") {
      return await createTikTokPost(page, task);
    }
    if(platform === "youtube"){
      return await createYouTubePost(page, task);
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
async function createYouTubePost(page, postContent) {
  console.log("📺 Creating YouTube video...");
  
  try {
    // 1️⃣ Open YouTube Studio
    await page.goto("https://studio.youtube.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    // 2️⃣ Close any popups/dialogs
    await page.click('button[aria-label="No thanks"]').catch(() => {});
    await page.click('button[aria-label="Dismiss"]').catch(() => {});
    await page.click('text="Not now"').catch(() => {});
    await page.waitForTimeout(2000);

    // 3️⃣ Click CREATE button
    console.log("🔘 Clicking CREATE button...");
    const createButtonSelectors = [
      'button[aria-label="Create"]',
      'ytcp-button#create-icon',
      '#upload-icon',
      'button:has-text("CREATE")',
    ];

    let createClicked = false;
    for (const selector of createButtonSelectors) {
      try {
        const createBtn = page.locator(selector).first();
        await createBtn.waitFor({ state: "visible", timeout: 10000 });
        await createBtn.click({ timeout: 5000 });
        console.log("✅ CREATE clicked");
        createClicked = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!createClicked) {
      throw new Error("Could not find or click CREATE button");
    }

    await page.waitForTimeout(2000);

    // 4️⃣ Click "Upload videos" option
    console.log("🔘 Clicking Upload videos...");
    const uploadOptionSelectors = [
      'text="Upload videos"',
      'tp-yt-paper-item:has-text("Upload videos")',
      '#text-item-0',
    ];

    let uploadClicked = false;
    for (const selector of uploadOptionSelectors) {
      try {
        await page.locator(selector).first().click({ timeout: 5000 });
        console.log("✅ Upload videos clicked");
        uploadClicked = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!uploadClicked) {
      throw new Error("Could not find or click Upload videos option");
    }

    await page.waitForTimeout(3000);

    // 5️⃣ Resolve video path
    const absoluteVideoPath = path.join(
      "C:",
      "wamp64",
      "www",
      "social-automation",
      "public",
      postContent.media_urls
    );
    
    console.log("🔍 Looking for video at:", absoluteVideoPath);
    
    if (!fs.existsSync(absoluteVideoPath)) {
      throw new Error(`Video file not found: ${absoluteVideoPath}`);
    }
    
    console.log("✅ Video file found");

    // 6️⃣ Upload video file
    console.log("📤 Uploading video...");
    const fileInputSelectors = [
      'input[type="file"]',
      '#upload-input',
      'input[name="Filedata"]',
    ];

    let fileUploaded = false;
    for (const selector of fileInputSelectors) {
      try {
        const fileInput = page.locator(selector);
        await fileInput.waitFor({ state: "attached", timeout: 10000 });
        await fileInput.setInputFiles(absoluteVideoPath);
        console.log("✅ Video uploaded");
        fileUploaded = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!fileUploaded) {
      throw new Error("Could not find file input to upload video");
    }

    // 7️⃣ Wait for upload dialog to appear
    await page.waitForTimeout(5000);
    console.log("⏳ Waiting for upload dialog...");

    // 8️⃣ Fill in Title
    console.log("📝 Adding title...");
    const title = postContent.title || postContent.content?.substring(0, 100) || "New Video";
    
    const titleSelectors = [
      '#textbox',
      'div[aria-label="Add a title that describes your video"]',
      '#title-textarea',
      'ytcp-social-suggestions-textbox[label="Title"] #textbox',
    ];

    let titleAdded = false;
    for (const selector of titleSelectors) {
      try {
        const titleBox = page.locator(selector).first();
        await titleBox.waitFor({ state: "visible", timeout: 10000 });
        await titleBox.click();
        await titleBox.fill("");
        await titleBox.fill(title.trim());
        console.log("✅ Title added");
        titleAdded = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!titleAdded) {
      console.log("⚠️ Could not add title, continuing anyway...");
    }

    await page.waitForTimeout(2000);

    // 9️⃣ Fill in Description
    console.log("📝 Adding description...");
    const description = (postContent.content || "") + "\n\n" + (postContent.hashtags || "");
    
    const descriptionSelectors = [
      'div[aria-label="Tell viewers about your video"]',
      '#description-textarea #textbox',
      'ytcp-social-suggestions-textbox[label="Description"] #textbox',
    ];

    let descriptionAdded = false;
    for (const selector of descriptionSelectors) {
      try {
        const descBox = page.locator(selector).first();
        await descBox.waitFor({ state: "visible", timeout: 5000 });
        await descBox.click();
        await descBox.fill(description.trim());
        console.log("✅ Description added");
        descriptionAdded = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!descriptionAdded) {
      console.log("⚠️ Could not add description, continuing anyway...");
    }

    await page.waitForTimeout(2000);

    // 🔟 Select "No, it's not made for kids" (required)
    console.log("👶 Setting audience...");
    const notForKidsSelectors = [
      '#radio-button-not-made-for-kids',
      'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
    ];

    for (const selector of notForKidsSelectors) {
      try {
        await page.locator(selector).click({ timeout: 5000 });
        console.log("✅ Audience set to 'Not for kids'");
        break;
      } catch (e) {
        continue;
      }
    }

    await page.waitForTimeout(2000);

    // 1️⃣1️⃣ Click NEXT button (Details page)
    console.log("🔘 Clicking NEXT (Details)...");
    await clickNextButton(page);
    await page.waitForTimeout(3000);

    // 1️⃣2️⃣ Click NEXT button (Video elements page)
    console.log("🔘 Clicking NEXT (Video elements)...");
    await clickNextButton(page);
    await page.waitForTimeout(3000);

    // 1️⃣3️⃣ Click NEXT button (Checks page)
    console.log("🔘 Clicking NEXT (Checks)...");
    await clickNextButton(page);
    await page.waitForTimeout(3000);

    // 1️⃣4️⃣ Select visibility (Public/Unlisted/Private)
    console.log("🔓 Setting visibility...");
    const visibility = postContent.visibility || "unlisted"; // default to unlisted
    
    const visibilitySelectors = {
      public: '#public-radio-button',
      unlisted: '#unlisted-radio-button',
      private: '#private-radio-button',
    };

    const visibilitySelector = visibilitySelectors[visibility.toLowerCase()];
    if (visibilitySelector) {
      try {
        await page.locator(visibilitySelector).click({ timeout: 5000 });
        console.log(`✅ Visibility set to ${visibility}`);
      } catch (e) {
        console.log("⚠️ Could not set visibility, using default");
      }
    }

    await page.waitForTimeout(2000);

    // 1️⃣5️⃣ Click PUBLISH button
    console.log("📤 Publishing video...");
    const publishSelectors = [
      'ytcp-button#done-button',
      'button:has-text("Publish")',
      '#done-button',
    ];

    let published = false;
    for (const selector of publishSelectors) {
      try {
        const publishBtn = page.locator(selector).first();
        await publishBtn.waitFor({ state: "visible", timeout: 10000 });
        await publishBtn.click({ timeout: 5000 });
        console.log("✅ Publish button clicked");
        published = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!published) {
      throw new Error("Could not find or click Publish button");
    }

    // Wait for publish to complete
    await page.waitForTimeout(10000);

    // Check for success
    const successIndicators = [
      'text="Video published"',
      'text="Uploaded"',
      'ytcp-video-share-dialog',
    ];

    let uploadSuccess = false;
    for (const indicator of successIndicators) {
      if (await page.locator(indicator).isVisible().catch(() => false)) {
        uploadSuccess = true;
        break;
      }
    }

    console.log("✅ YouTube video uploaded successfully");
    
    return {
      success: true,
      message: uploadSuccess ? "Video published" : "Video upload likely successful",
    };

  } catch (error) {
    console.error("❌ YouTube upload failed:", error.message);
    
    // Take screenshot for debugging
    try {
      await page.screenshot({
        path: `youtube-error-${Date.now()}.png`,
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

// Helper function to click NEXT button
async function clickNextButton(page) {
  const nextButtonSelectors = [
    'ytcp-button#next-button',
    'button:has-text("Next")',
    '#next-button',
  ];

  for (const selector of nextButtonSelectors) {
    try {
      const nextBtn = page.locator(selector).first();
      await nextBtn.waitFor({ state: "visible", timeout: 10000 });
      await nextBtn.click({ timeout: 5000 });
      console.log("✅ NEXT clicked");
      return;
    } catch (e) {
      continue;
    }
  }

  throw new Error("Could not find or click NEXT button");
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
async function createTikTokPost(page, postContent) {
  console.log("🎵 Creating TikTok post...");

  try {
    // 1️⃣ Navigate to TikTok Studio upload page
    await page.goto("https://www.tiktok.com/tiktokstudio/upload", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("⏳ TikTok upload page loaded, waiting for content...");
    await page.waitForTimeout(5000);

    // Scroll to ensure upload area is visible
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(2000);

    // 2️⃣ Check if we need to upload a video
    const hasVideo = postContent?.media_urls;

    if (!hasVideo) {
      throw new Error("TikTok requires a video to post");
    }

    console.log("🎬 Video detected, preparing to upload...");

    // Build absolute path to video
    const path = require("path");
    const fs = require("fs");

    const absoluteVideoPath = path.join(
      "C:",
      "wamp64",
      "www",
      "social-automation",
      "public",
      postContent.media_urls
    );

    console.log("🔍 Looking for video at:", absoluteVideoPath);

    if (!fs.existsSync(absoluteVideoPath)) {
      throw new Error(`Video file not found: ${absoluteVideoPath}`);
    }

    console.log("✅ Video file found");

    // 3️⃣ Find and trigger the file upload
    console.log("🔍 Looking for video upload mechanism...");

    let videoUploaded = false;

    // METHOD 1: Try clicking "Select video" button and use file input
    try {
      console.log("📍 Method 1: Looking for 'Select video' button...");

      const selectVideoButton = page
        .locator('button:has-text("Select video")')
        .first();
      const buttonExists = await selectVideoButton.count();

      if (buttonExists > 0) {
        console.log("✅ Found 'Select video' button");

        // Find the file input (it should be in the DOM but hidden)
        const fileInput = await page.locator('input[type="file"]').first();

        // Set the file directly on the hidden input
        await fileInput.setInputFiles(absoluteVideoPath);
        console.log("✅ Video uploaded via hidden file input");
        videoUploaded = true;
      }
    } catch (e) {
      console.log(`⚠️ Method 1 failed:`, e.message);
    }

    // METHOD 2: Find any file input and set files directly
    if (!videoUploaded) {
      try {
        console.log("📍 Method 2: Looking for any file input...");

        const allFileInputs = await page.locator('input[type="file"]').all();
        console.log(`Found ${allFileInputs.length} file input(s)`);

        if (allFileInputs.length > 0) {
          await allFileInputs[0].setInputFiles(absoluteVideoPath);
          console.log("✅ Video uploaded via first file input");
          videoUploaded = true;
        }
      } catch (e) {
        console.log(`⚠️ Method 2 failed:`, e.message);
      }
    }

    // METHOD 3: Use JavaScript to find and trigger file input
    if (!videoUploaded) {
      try {
        console.log("📍 Method 3: Using JavaScript to find file input...");

        const foundViaJs = await page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="file"]');
          console.log(`Found ${inputs.length} file inputs via JavaScript`);

          if (inputs.length > 0) {
            inputs[0].setAttribute("data-video-upload", "true");
            return true;
          }

          return false;
        });

        if (foundViaJs) {
          const uploadInput = page.locator('[data-video-upload="true"]');
          await uploadInput.setInputFiles(absoluteVideoPath);
          console.log("✅ Video uploaded via JavaScript method");
          videoUploaded = true;
        }
      } catch (e) {
        console.log(`⚠️ Method 3 failed:`, e.message);
      }
    }

    // METHOD 4: Try to trigger the drag-and-drop zone
    if (!videoUploaded) {
      try {
        console.log("📍 Method 4: Looking for drag-and-drop zone...");

        // Look for the iframe or drag zone
        const dragZoneSelectors = [
          'iframe[title*="upload"]',
          'div[role="button"]',
          ".upload-card",
          '[class*="upload"]',
        ];

        for (const selector of dragZoneSelectors) {
          const element = page.locator(selector).first();
          const exists = await element.count();

          if (exists > 0) {
            console.log(`Found potential drag zone: ${selector}`);

            // Try to find file input within or near this element
            const nearbyInput = await page.evaluate((sel) => {
              const zone = document.querySelector(sel);
              if (zone) {
                const input =
                  zone.querySelector('input[type="file"]') ||
                  zone.parentElement?.querySelector('input[type="file"]') ||
                  document.querySelector('input[type="file"]');

                if (input) {
                  input.setAttribute("data-drag-upload", "true");
                  return true;
                }
              }
              return false;
            }, selector);

            if (nearbyInput) {
              const uploadInput = page.locator('[data-drag-upload="true"]');
              await uploadInput.setInputFiles(absoluteVideoPath);
              console.log("✅ Video uploaded via drag zone method");
              videoUploaded = true;
              break;
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ Method 4 failed:`, e.message);
      }
    }

    // METHOD 5: Check if we're in an iframe
    if (!videoUploaded) {
      try {
        console.log("📍 Method 5: Checking for iframe...");

        const frames = page.frames();
        console.log(`Found ${frames.length} frames`);

        for (const frame of frames) {
          try {
            const frameInputs = await frame.locator('input[type="file"]').all();

            if (frameInputs.length > 0) {
              console.log(`Found file input in frame: ${frame.url()}`);
              await frameInputs[0].setInputFiles(absoluteVideoPath);
              console.log("✅ Video uploaded via iframe");
              videoUploaded = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        console.log(`⚠️ Method 5 failed:`, e.message);
      }
    }

    if (!videoUploaded) {
      // Take debug screenshot
      const screenshotPath = `tiktok-no-upload-input-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      // Log page content for debugging
      const pageContent = await page.evaluate(() => {
        const inputs = Array.from(
          document.querySelectorAll('input[type="file"]')
        );
        const buttons = Array.from(document.querySelectorAll("button"));

        return {
          url: window.location.href,
          fileInputs: inputs.map((i) => ({
            id: i.id,
            class: i.className,
            accept: i.accept,
            visible: i.offsetParent !== null,
          })),
          buttons: buttons
            .map((b) => ({
              text: b.textContent?.trim(),
              class: b.className,
            }))
            .slice(0, 10), // First 10 buttons
        };
      });

      console.log("📋 Page analysis:", JSON.stringify(pageContent, null, 2));

      throw new Error(
        "TikTok upload input not found - check screenshot and logs"
      );
    }

    // 4️⃣ Wait for video to upload and process (20-25 seconds)
    console.log("⏳ Waiting for video to upload and process...");
    console.log("⏱️  This will take approximately 20-25 seconds...");

    // Initial upload wait - 10 seconds
    await page.waitForTimeout(10000);
    console.log("⏳ Upload in progress... (10s elapsed)");

    // Continue waiting - another 10 seconds
    await page.waitForTimeout(10000);
    console.log("⏳ Processing video... (20s elapsed)");

    // Final buffer - 5 seconds
    await page.waitForTimeout(5000);
    console.log("⏳ Finalizing... (25s elapsed)");

    // Wait for video preview to appear
    console.log("🔍 Waiting for video preview...");

    try {
      await page.waitForSelector(
        'video, canvas, div[class*="video-preview"], div[class*="preview"]',
        {
          timeout: 30000,
        }
      );
      console.log("✅ Video preview loaded");
    } catch (e) {
      console.log(
        "⚠️ Video preview not detected after 30s, checking if upload succeeded..."
      );

      // Check if we've moved past upload screen
      const currentUrl = page.url();
      if (!currentUrl.includes("Select video")) {
        console.log("✅ Appears to have progressed past upload screen");
      }
    }

    // Give extra time for UI to stabilize
    console.log("⏳ Letting UI stabilize...");
    await page.waitForTimeout(3000);

    // 5️⃣ Find and fill the caption/description field
    console.log("🔍 Looking for caption field...");

    const captionSelectors = [
      'div[contenteditable="true"]',
      'textarea[placeholder*="escription"]',
      'textarea[placeholder*="caption"]',
      'div[data-text*="escription"]',
      'div[role="textbox"]',
      "textarea",
    ];

    let captionField = null;

    for (const selector of captionSelectors) {
      try {
        const field = page.locator(selector).first();
        const count = await field.count();

        if (count > 0) {
          const isVisible = await field
            .isVisible({ timeout: 2000 })
            .catch(() => false);

          if (isVisible) {
            captionField = field;
            console.log(`✅ Found caption field: ${selector}`);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Try JavaScript method if not found
    if (!captionField) {
      console.log("🔍 Trying JavaScript method to find caption field...");

      const foundViaJs = await page.evaluate(() => {
        // Look for contenteditable divs
        const editableDivs = Array.from(
          document.querySelectorAll('div[contenteditable="true"]')
        );

        if (editableDivs.length > 0) {
          editableDivs[0].setAttribute("data-target-caption", "true");
          return true;
        }

        // Look for textareas
        const textareas = Array.from(document.querySelectorAll("textarea"));
        if (textareas.length > 0) {
          textareas[0].setAttribute("data-target-caption", "true");
          return true;
        }

        // Look for role=textbox
        const textboxes = Array.from(
          document.querySelectorAll('[role="textbox"]')
        );
        if (textboxes.length > 0) {
          textboxes[0].setAttribute("data-target-caption", "true");
          return true;
        }

        return false;
      });

      if (foundViaJs) {
        captionField = page.locator('[data-target-caption="true"]').first();
        console.log("✅ Found caption field via JavaScript");
      }
    }

    if (!captionField) {
      const screenshotPath = `tiktok-no-caption-field-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
      console.log(
        "⚠️ Caption field not found - will try to post without caption"
      );
    }

    // 6️⃣ Add caption if field was found
    if (captionField) {
      const content = postContent?.content || "";
      const hashtags = postContent?.hashtags || "";
      const fullCaption = `${content}\n\n${hashtags}`.trim();

      if (fullCaption) {
        console.log("✍️ Writing caption...");

        // Scroll into view and click
        await captionField.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);

        try {
          await captionField.click({ timeout: 5000 });
        } catch (e) {
          await captionField.click({ force: true });
        }

        await page.waitForTimeout(500);

        // Type the caption with realistic delays
        try {
          await captionField.fill("");
          await page.waitForTimeout(300);
          await captionField.type(fullCaption, {
            delay: 50 + Math.random() * 100,
          });
          console.log("✅ Caption typed successfully");
        } catch (e) {
          console.log("⚠️ Typing failed, trying paste method...");

          // Try paste method
          await page.evaluate((text) => {
            const field =
              document.querySelector('[data-target-caption="true"]') ||
              document.querySelector('div[contenteditable="true"]') ||
              document.querySelector("textarea") ||
              document.querySelector('[role="textbox"]');

            if (field) {
              field.focus();

              if (field.tagName === "TEXTAREA" || field.tagName === "INPUT") {
                field.value = text;
              } else {
                field.textContent = text;
              }

              // Trigger events
              field.dispatchEvent(new Event("input", { bubbles: true }));
              field.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }, fullCaption);

          console.log("✅ Caption inserted via JavaScript");
        }

        await page.waitForTimeout(2000);
      }
    }

    // 7️⃣ Find and click the Post/Publish button
    console.log("🔍 Looking for Post button...");

    await page.waitForTimeout(2000); // Give UI time to enable button

    const postButtonSelectors = [
      'button:has-text("Post")',
      'button:has-text("Publish")',
      'div[role="button"]:has-text("Post")',
      'div[role="button"]:has-text("Publish")',
      'button[type="submit"]',
      'button:has-text("Submit")',
    ];

    let postButton = null;

    for (const selector of postButtonSelectors) {
      try {
        const btn = page.locator(selector).first();
        const count = await btn.count();

        if (count > 0) {
          const isVisible = await btn
            .isVisible({ timeout: 2000 })
            .catch(() => false);

          if (isVisible) {
            // Check if enabled
            const isDisabled = await btn.isDisabled().catch(() => false);

            if (!isDisabled) {
              postButton = btn;
              console.log(`✅ Found enabled Post button: ${selector}`);
              break;
            } else {
              console.log(
                `⚠️ Found Post button but it's disabled: ${selector}`
              );
            }
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
          document.querySelectorAll(
            'button, div[role="button"], [role="button"]'
          )
        );

        for (const btn of buttons) {
          const text = btn.textContent?.trim().toLowerCase() || "";
          const disabled =
            btn.disabled ||
            btn.getAttribute("disabled") !== null ||
            btn.getAttribute("aria-disabled") === "true" ||
            btn.classList.contains("disabled");

          if (
            (text.includes("post") || text.includes("publish")) &&
            !disabled
          ) {
            btn.setAttribute("data-target-post-btn", "true");
            return true;
          }
        }

        return false;
      });

      if (foundBtnViaJs) {
        postButton = page.locator('[data-target-post-btn="true"]').first();
        console.log("✅ Found Post button via JavaScript");
      }
    }

    if (!postButton) {
      const screenshotPath = `tiktok-no-post-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
      throw new Error(
        "TikTok Post button not found or is disabled - video may still be processing"
      );
    }

    // 8️⃣ Click the Post button
    console.log("📤 Clicking Post button...");

    await postButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    let postClicked = false;

    try {
      await postButton.click({ timeout: 5000 });
      postClicked = true;
      console.log("✅ Post button clicked");
    } catch (e) {
      console.log("⚠️ Normal click failed, trying alternative methods...");

      try {
        await postButton.click({ force: true });
        postClicked = true;
        console.log("✅ Post button clicked (force)");
      } catch (e2) {
        await page.evaluate(() => {
          const btn =
            document.querySelector('[data-target-post-btn="true"]') ||
            Array.from(document.querySelectorAll("button")).find((b) =>
              b.textContent?.toLowerCase().includes("post")
            );
          if (btn) btn.click();
        });
        postClicked = true;
        console.log("✅ Post button clicked (JavaScript)");
      }
    }

    // 🔍 Debug: Log page state after clicking Post
    await page.waitForTimeout(3000);
    const pageState = await page.evaluate(() => {
      return {
        url: window.location.href,
        bodyText: document.body.textContent?.substring(0, 500),
        visibleButtons: Array.from(document.querySelectorAll("button"))
          .map((b) => b.textContent?.trim())
          .slice(0, 5),
      };
    });
    console.log(
      "📊 Page state after Post click:",
      JSON.stringify(pageState, null, 2)
    );

    // 9️⃣ Wait for post to complete and verify
    console.log("⏳ Waiting for video to post...");

    // Wait longer for TikTok to process
    await page.waitForTimeout(5000);

    // Check multiple times over 30 seconds for success indicators
    let postSuccess = false;
    let attempts = 0;
    const maxAttempts = 6; // Check every 5 seconds for 30 seconds total

    while (attempts < maxAttempts && !postSuccess) {
      attempts++;
      console.log(`🔍 Verification attempt ${attempts}/${maxAttempts}...`);

      const checkResult = await page.evaluate(() => {
        const successIndicators = [
          "your video is being uploaded",
          "video uploaded",
          "post successful",
          "posted",
          "upload successful",
          "successfully posted",
          "your video is processing",
          "video is being processed",
          "posting",
          "uploading",
        ];

        const bodyText = document.body.textContent?.toLowerCase() || "";
        const currentUrl = window.location.href;

        // Check for success text
        for (const indicator of successIndicators) {
          if (bodyText.includes(indicator)) {
            return { success: true, indicator: indicator, url: currentUrl };
          }
        }

        // Check if redirected away from upload page (strong indicator of success)
        if (
          !currentUrl.includes("/upload") &&
          !currentUrl.includes("/tiktokstudio/upload")
        ) {
          return {
            success: true,
            indicator: "redirected away from upload",
            url: currentUrl,
          };
        }

        // Check if Post button disappeared (means it was submitted)
        const postButtons = Array.from(
          document.querySelectorAll('button, [role="button"]')
        ).filter((btn) => {
          const text = btn.textContent?.toLowerCase() || "";
          return text.includes("post") || text.includes("publish");
        });

        if (postButtons.length === 0) {
          return {
            success: true,
            indicator: "post button disappeared",
            url: currentUrl,
          };
        }

        return { success: false, url: currentUrl };
      });

      if (checkResult.success) {
        postSuccess = true;
        console.log(`✅ Post verified! Indicator: "${checkResult.indicator}"`);
        break;
      }

      // Wait before next check
      if (attempts < maxAttempts) {
        await page.waitForTimeout(5000);
      }
    }

    const finalUrl = page.url();

    if (postSuccess) {
      console.log("✅ TikTok post created successfully");

      await page.screenshot({
        path: `tiktok-post-success-${Date.now()}.png`,
        fullPage: true,
      });

      return {
        success: true,
        message: "TikTok post created successfully",
        verified: true,
        post_url: finalUrl,
      };
    } else {
      console.log("⚠️ Post status unclear after multiple checks");

      await page.screenshot({
        path: `tiktok-post-uncertain-${Date.now()}.png`,
        fullPage: true,
      });

      // Check one more time if we're still on upload page
      const stillOnUpload = finalUrl.includes("/upload");

      return {
        success: !stillOnUpload, // If we left upload page, likely successful
        message: stillOnUpload
          ? "TikTok post submitted but verification failed - please check manually"
          : "TikTok post likely successful (left upload page)",
        verified: false,
        post_url: finalUrl,
        note: "Automatic verification inconclusive. Please check your TikTok profile to confirm.",
      };
    }
  } catch (error) {
    console.error("❌ TikTok post failed:", error.message);

    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `tiktok-post-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: tiktok-post-error-${timestamp}.png`
      );
    } catch (screenshotError) {
      console.log("⚠️ Could not save error screenshot");
    }

    return {
      success: false,
      message: error.message,
      debug_screenshot: `tiktok-post-error-${timestamp}.png`,
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
      const allButtons = document.querySelectorAll("button");

      for (const btn of allButtons) {
        // Check if button contains an SVG (heart icon)
        const svg = btn.querySelector("svg");
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
          html: btn.outerHTML.substring(0, 200),
        });

        // Check if it's a like button (has heart SVG + like count OR has "like" in aria-label)
        if (hasLikeCount || ariaLabel.toLowerCase().includes("like")) {
          // Check if already liked (red heart)
          const paths = svg.querySelectorAll("path");
          let isLiked = false;

          for (const path of paths) {
            const fill = path.getAttribute("fill") || "";
            const style = window.getComputedStyle(path);
            const computedFill = style.fill || "";

            // Check for red/pink color
            if (
              fill.includes("254") ||
              fill.includes("#FE2C55") ||
              fill.includes("#fe2c55") ||
              computedFill.includes("254, 44, 85")
            ) {
              isLiked = true;
              break;
            }
          }

          // Also check aria-label for "unlike"
          if (ariaLabel.toLowerCase().includes("unlike")) {
            isLiked = true;
          }

          console.log("Like button status:", { isLiked, ariaLabel });

          if (isLiked) {
            return { found: true, alreadyLiked: true };
          }

          // Mark button for clicking
          btn.setAttribute("data-like-target", "true");
          return { found: true, alreadyLiked: false };
        }
      }

      // Strategy 2: Look for specific TikTok button structure
      // TikTok often uses a button with data-e2e attribute
      const likeButton = document.querySelector('[data-e2e*="like"]');
      if (likeButton) {
        console.log(
          "Found button via data-e2e:",
          likeButton.outerHTML.substring(0, 200)
        );
        likeButton.setAttribute("data-like-target", "true");

        // Check if liked
        const svg = likeButton.querySelector("svg path");
        const isLiked =
          svg &&
          ((svg.getAttribute("fill") || "").includes("254") ||
            (window.getComputedStyle(svg).fill || "").includes("254"));

        return { found: true, alreadyLiked: isLiked };
      }

      // Strategy 3: Find by aria-label containing "like"
      const buttonByAria = Array.from(allButtons).find((btn) => {
        const label = btn.getAttribute("aria-label") || "";
        return label.toLowerCase().includes("like");
      });

      if (buttonByAria) {
        console.log(
          "Found button via aria-label:",
          buttonByAria.getAttribute("aria-label")
        );
        buttonByAria.setAttribute("data-like-target", "true");

        const isLiked = (buttonByAria.getAttribute("aria-label") || "")
          .toLowerCase()
          .includes("unlike");
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
        const allBtns = document.querySelectorAll("button");
        allBtns.forEach((btn, i) => {
          console.log(`Button ${i}:`, {
            ariaLabel: btn.getAttribute("aria-label"),
            dataE2e: btn.getAttribute("data-e2e"),
            text: btn.textContent.substring(0, 50),
            hasSVG: !!btn.querySelector("svg"),
          });
        });
      });

      throw new Error(
        "TikTok Like button not found - check screenshot and console logs"
      );
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
      const allButtons = document.querySelectorAll("button");

      for (const btn of allButtons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";

        // Check for "unlike" in aria-label
        if (ariaLabel.toLowerCase().includes("unlike")) {
          return true;
        }

        // Check for red heart
        const svg = btn.querySelector("svg");
        if (svg) {
          const paths = svg.querySelectorAll("path");
          for (const path of paths) {
            const fill = path.getAttribute("fill") || "";
            const computedFill = window.getComputedStyle(path).fill || "";

            if (
              fill.includes("254") ||
              fill.includes("#FE2C55") ||
              computedFill.includes("254, 44, 85")
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

async function youtubeLike(page, targetUrl) {
  console.log("❤️ Liking YouTube video...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    // Navigate to video
    console.log(`🔴 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    console.log("⏳ YouTube video loaded, waiting...");
    await page.waitForTimeout(5000);

    // Scroll to ensure video actions are loaded
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Searching for like button...");

    // Find the like button
    const buttonInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const btn of buttons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";

        // Check if it's a like button
        if (ariaLabel.toLowerCase().includes("like this video")) {
          console.log("Found like button:", ariaLabel);

          // Check if already liked
          if (ariaLabel.toLowerCase().includes("dislike")) {
            // If aria-label says "dislike", it means video is already liked
            return { found: true, alreadyLiked: true };
          }

          // Check button pressed state
          const isPressed = btn.getAttribute("aria-pressed") === "true";
          if (isPressed) {
            return { found: true, alreadyLiked: true };
          }

          // Mark button for clicking
          btn.setAttribute("data-yt-like", "true");
          return { found: true, alreadyLiked: false };
        }
      }

      return { found: false, alreadyLiked: false };
    });

    console.log("Button search result:", buttonInfo);

    if (buttonInfo.alreadyLiked) {
      console.log("💗 YouTube video already liked");
      return {
        success: true,
        message: "YouTube video already liked",
        alreadyLiked: true,
        video_url: targetUrl,
      };
    }

    if (!buttonInfo.found) {
      throw new Error("YouTube Like button not found");
    }

    console.log("✅ Like button found! Clicking...");
    await page.waitForTimeout(1000);

    // Click the like button
    let clickSuccess = false;

    // Strategy 1: Locator click
    try {
      const likeBtn = page.locator('[data-yt-like="true"]').first();
      await likeBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await likeBtn.click({ timeout: 5000 });
      clickSuccess = true;
      console.log("✅ Clicked via locator");
    } catch (e) {
      console.log("⚠️ Locator click failed");
    }

    // Strategy 2: JavaScript click
    if (!clickSuccess) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-yt-like="true"]');
          if (btn) btn.click();
        });
        clickSuccess = true;
        console.log("✅ Clicked via JavaScript");
      } catch (e) {
        console.log("⚠️ JS click failed");
      }
    }

    // Strategy 3: Force click
    if (!clickSuccess) {
      try {
        const likeBtn = page.locator('[data-yt-like="true"]').first();
        await likeBtn.click({ force: true, timeout: 5000 });
        clickSuccess = true;
        console.log("✅ Clicked via force");
      } catch (e) {
        console.log("⚠️ Force click failed");
      }
    }

    if (!clickSuccess) {
      throw new Error("Failed to click like button");
    }

    // Wait for like to register
    console.log("⏳ Waiting for like to register...");
    await page.waitForTimeout(3000);

    // Verify like was successful
    const verified = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const btn of buttons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const isPressed = btn.getAttribute("aria-pressed") === "true";

        // Check if button is now pressed or aria-label changed
        if (ariaLabel.toLowerCase().includes("like this video") && isPressed) {
          console.log("✅ Like verified - button is pressed");
          return true;
        }
      }

      return false;
    });

    if (verified) {
      console.log("❤️ Like confirmed!");
      return {
        success: true,
        message: "YouTube video liked successfully",
        confirmed: true,
        video_url: targetUrl,
      };
    } else {
      console.warn("⚠️ Like clicked but verification pending");
      return {
        success: true,
        message: "Like button clicked (verification pending)",
        confirmed: false,
        video_url: targetUrl,
      };
    }
  } catch (error) {
    console.error("❌ YouTube like error:", error.message);
    return {
      success: false,
      message: error.message,
      video_url: targetUrl,
    };
  }
}

// Update likePost to include YouTube
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

    if (platform === "youtube") {
      return await youtubeLike(page, targetUrl);
    }

    return {
      success: false,
      message: `Like not supported for platform: ${platform}`,
    };
  } catch (error) {
    console.error(`❌ Like failed on ${platform}:`, error.message);
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
      const allButtons = document.querySelectorAll(
        'button, span[role="button"]'
      );

      for (const btn of allButtons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const dataE2e = btn.getAttribute("data-e2e") || "";

        // Look for comment icon by aria-label or data-e2e
        if (
          ariaLabel.toLowerCase().includes("comment") ||
          dataE2e.includes("comment") ||
          dataE2e.includes("browse-comment")
        ) {
          console.log("Found comment icon:", { ariaLabel, dataE2e });
          btn.setAttribute("data-comment-icon", "true");
          btn.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }

        // Also check if button contains comment count and SVG (comment icon)
        const svg = btn.querySelector("svg");
        const text = btn.textContent || "";

        // Comment counts typically show like "58.7K"
        if (svg && /[\d.]+[KMB]/.test(text)) {
          // Check if this might be comment icon (not like icon)
          // Comment icon is typically a speech bubble
          const pathD = svg.querySelector("path")?.getAttribute("d") || "";

          // Speech bubble path typically contains curves (C or c commands)
          if (pathD.includes("C") || pathD.includes("c")) {
            console.log("Found comment icon via SVG pattern");
            btn.setAttribute("data-comment-icon", "true");
            btn.scrollIntoView({ behavior: "smooth", block: "center" });
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
      const editableDivs = document.querySelectorAll(
        'div[contenteditable="true"], div[contenteditable="plaintext-only"]'
      );

      console.log(`Found ${editableDivs.length} editable divs`);

      for (const div of editableDivs) {
        const placeholder =
          div.getAttribute("data-placeholder") ||
          div.getAttribute("placeholder") ||
          "";
        const rect = div.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;

        console.log("Checking div:", {
          placeholder,
          isVisible,
          width: rect.width,
          height: rect.height,
        });

        // Check if it's a comment box
        if (isVisible) {
          console.log("Found visible contenteditable div");
          div.setAttribute("data-comment-box", "true");
          div.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }
      }

      // Fallback: look for textarea
      const textareas = document.querySelectorAll("textarea");
      for (const textarea of textareas) {
        const rect = textarea.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          textarea.setAttribute("data-comment-box", "true");
          textarea.scrollIntoView({ behavior: "smooth", block: "center" });
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
        const text = btn.textContent?.trim() || "";
        const dataE2e = btn.getAttribute("data-e2e") || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const rect = btn.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;

        console.log("Checking button:", {
          text,
          dataE2e,
          ariaLabel,
          isVisible,
        });

        // Look for Post button
        if (
          isVisible &&
          (text.toLowerCase() === "post" ||
            text.toLowerCase() === "comment" ||
            dataE2e === "comment-post" ||
            ariaLabel.toLowerCase().includes("post"))
        ) {
          console.log("Found Post button!");
          btn.setAttribute("data-post-btn", "true");
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
      console.log(
        `📸 Error screenshot saved: tiktok-comment-error-${timestamp}.png`
      );
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
async function youtubeComment(page, targetUrl, commentText) {
  console.log("🔴 Commenting on YouTube...");

  if (!targetUrl) throw new Error("Target URL missing");
  if (!commentText) throw new Error("Comment text missing");

  try {
    // Navigate to video
    console.log(`🔴 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    console.log("⏳ YouTube video loaded, waiting...");
    await page.waitForTimeout(5000);

    // Check if it's a Short
    const isShort = targetUrl.includes("/shorts/");
    console.log(`📱 Video type: ${isShort ? "Short" : "Regular video"}`);

    if (isShort) {
      // For Shorts - click comment button first
      console.log("🔍 Looking for comment button on Short...");

      const commentButtonFound = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));

        for (const btn of buttons) {
          const ariaLabel = btn.getAttribute("aria-label") || "";

          // Find comment button (has comment count)
          if (ariaLabel.toLowerCase().includes("comment")) {
            console.log("Found comment button:", ariaLabel);
            btn.setAttribute("data-yt-comment-icon", "true");
            return true;
          }
        }

        return false;
      });

      if (!commentButtonFound) {
        throw new Error("Comment button not found on Short");
      }

      // Click comment button to open comment section
      console.log("🖱️ Clicking comment button...");
      await page.evaluate(() => {
        const btn = document.querySelector('[data-yt-comment-icon="true"]');
        if (btn) btn.click();
      });

      console.log("⏳ Waiting for comment panel to open...");
      await page.waitForTimeout(4000);
    } else {
      // For regular videos - scroll to comment section
      console.log("📜 Scrolling to comment section...");
      await page.evaluate(() => {
        window.scrollBy(0, 600);
      });
      await page.waitForTimeout(3000);
    }

    // Find comment box
    console.log("🔍 Looking for comment box...");

    const commentBoxFound = await page.evaluate(() => {
      // Wait a bit for elements to settle
      const boxes = Array.from(
        document.querySelectorAll(
          'div[contenteditable="true"], div[contenteditable="plaintext-only"]'
        )
      );

      console.log(`Found ${boxes.length} editable boxes`);

      for (const box of boxes) {
        const id = box.getAttribute("id") || "";
        const ariaLabel = box.getAttribute("aria-label") || "";
        const placeholder = box.getAttribute("aria-placeholder") || "";
        const dataPlaceholder = box.getAttribute("data-placeholder") || "";

        console.log("Checking box:", {
          id,
          ariaLabel,
          placeholder,
          dataPlaceholder,
        });

        // YouTube comment box - check all possible attributes
        if (
          id.includes("simplebox") ||
          id.includes("contenteditable-root") ||
          ariaLabel.toLowerCase().includes("comment") ||
          placeholder.toLowerCase().includes("comment") ||
          dataPlaceholder.toLowerCase().includes("comment")
        ) {
          // Make sure it's visible
          const rect = box.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            console.log("Found visible comment box!");
            box.setAttribute("data-yt-comment-box", "true");
            box.scrollIntoView({ behavior: "smooth", block: "center" });
            return true;
          }
        }
      }

      return false;
    });

    if (!commentBoxFound) {
      throw new Error("Comment box not found");
    }

    console.log("✅ Found comment box");
    await page.waitForTimeout(1500);

    // Focus and type comment
    console.log("📝 Clicking comment box to focus...");

    await page.evaluate(() => {
      const box = document.querySelector('[data-yt-comment-box="true"]');
      if (box) {
        box.click();
        box.focus();
      }
    });

    await page.waitForTimeout(1000);

    // Type comment
    console.log(`⌨️ Typing comment: "${commentText}"`);

    const commentBox = page.locator('[data-yt-comment-box="true"]').first();
    await commentBox.click();
    await page.waitForTimeout(500);
    await commentBox.type(commentText, { delay: 50 });

    console.log("✅ Comment typed");
    await page.waitForTimeout(2000);

    // Find and click Comment button
    console.log("🔍 Looking for Comment submit button...");

    const commentBtnFound = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const btn of buttons) {
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const id = btn.getAttribute("id") || "";
        const text = btn.textContent?.trim() || "";

        console.log("Checking button:", { id, ariaLabel, text });

        // YouTube comment submit button
        if (
          id.includes("submit-button") ||
          (text === "Comment" && ariaLabel.toLowerCase().includes("comment"))
        ) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            console.log("Found Comment submit button");
            btn.setAttribute("data-yt-comment-btn", "true");
            return true;
          }
        }
      }

      return false;
    });

    if (!commentBtnFound) {
      throw new Error("Comment submit button not found");
    }

    console.log("✅ Found Comment button, clicking...");
    await page.waitForTimeout(500);

    // Click Comment button
    let clickSuccess = false;

    try {
      const commentBtn = page.locator('[data-yt-comment-btn="true"]').first();
      await commentBtn.click({ timeout: 5000 });
      clickSuccess = true;
      console.log("✅ Clicked Comment button (locator)");
    } catch (e) {
      console.log("⚠️ Locator click failed, trying JS...");
    }

    if (!clickSuccess) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-yt-comment-btn="true"]');
          if (btn) btn.click();
        });
        clickSuccess = true;
        console.log("✅ Clicked Comment button (JavaScript)");
      } catch (e) {
        console.log("⚠️ JS click failed");
      }
    }

    if (!clickSuccess) {
      throw new Error("Failed to click Comment button");
    }

    console.log("⏳ Waiting for comment to post...");
    await page.waitForTimeout(4000);

    // Verify comment was posted
    const verified = await page.evaluate((text) => {
      const bodyText = document.body.innerText;
      return bodyText.includes(text);
    }, commentText);

    console.log("✅ YouTube comment posted successfully!");

    return {
      success: true,
      message: "YouTube comment posted successfully",
      verified: verified,
      video_url: targetUrl,
      comment: commentText,
    };
  } catch (error) {
    console.error("❌ YouTube comment failed:", error.message);
    return {
      success: false,
      message: error.message,
      video_url: targetUrl,
    };
  }
}

// Update commentOnPost to include YouTube
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
    if (platform === "youtube") {
      return await youtubeComment(page, targetUrl, commentText);
    }

    return {
      success: false,
      message: `Commenting not supported on ${platform}`,
    };
  } catch (error) {
    console.error("❌ Comment failed:", error.message);
    return {
      success: false,
      message: error.message,
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
          console.log(
            `Found button with selector: ${selector}, Text: "${buttonText}"`
          );

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
        const allButtons = Array.from(document.querySelectorAll("button"));

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
        console.log(
          `✅ Follow button found with text: "${buttonResult.buttonText}"`
        );
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
          const allButtons = Array.from(document.querySelectorAll("button"));
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
      const allButtons = Array.from(document.querySelectorAll("button"));

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
      console.log(
        `📸 Error screenshot saved: tiktok-follow-error-${timestamp}.png`
      );
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
async function youtubeFollow(page, targetUrl) {
  console.log("🔴 Processing YouTube subscribe...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    // Navigate directly to the channel URL
    console.log(`🔴 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    console.log("⏳ YouTube channel loaded, waiting...");
    await page.waitForTimeout(4000);

    console.log("🔍 Looking for Subscribe button...");

    // Simple and direct approach - find Subscribe button
    const subscribeButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";

        // Check if already subscribed
        if (text === "Subscribed" || ariaLabel.includes("Unsubscribe")) {
          return { found: true, alreadySubscribed: true };
        }

        // Find Subscribe button
        if (text === "Subscribe" || ariaLabel.includes("Subscribe to")) {
          btn.setAttribute("data-yt-sub", "true");
          console.log(`✅ Found Subscribe button: "${text || ariaLabel}"`);
          return { found: true, alreadySubscribed: false };
        }
      }

      return { found: false, alreadySubscribed: false };
    });

    if (subscribeButton.alreadySubscribed) {
      console.log("ℹ️ Already subscribed to this channel");
      return {
        success: true,
        message: "Already subscribed to this channel",
        alreadySubscribed: true,
      };
    }

    if (!subscribeButton.found) {
      throw new Error("Subscribe button not found on page");
    }

    // Click the Subscribe button using JavaScript
    console.log("🖱️ Clicking Subscribe button...");

    await page.evaluate(() => {
      const btn = document.querySelector('[data-yt-sub="true"]');
      if (btn) {
        btn.click();
      }
    });

    console.log("✅ Subscribe button clicked!");
    await page.waitForTimeout(3000);

    // Verify subscription
    const isSubscribed = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some((btn) => {
        const text = btn.textContent?.trim() || "";
        return text === "Subscribed";
      });
    });

    if (isSubscribed) {
      console.log("✅ Successfully subscribed to channel!");
      return {
        success: true,
        message: "Channel subscribed successfully",
        confirmed: true,
        channel_url: targetUrl,
      };
    } else {
      console.log("⚠️ Subscribe clicked but confirmation pending");
      return {
        success: true,
        message: "Subscribe button clicked",
        confirmed: false,
        channel_url: targetUrl,
      };
    }
  } catch (error) {
    console.error("❌ YouTube subscribe failed:", error.message);
    return {
      success: false,
      message: error.message,
      channel_url: targetUrl,
    };
  }
}

// Update followUser to include YouTube
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
    } else if (platform === "youtube") {
      return await youtubeFollow(page, targetUrl);
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
    await page.waitForTimeout(5000);

    // Scroll to ensure profile buttons are loaded
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(2000);

    console.log("🔍 Looking for Following button...");

    // Find and check the follow status with improved detection
    const followStatus = await page.evaluate(() => {
      const allButtons = Array.from(
        document.querySelectorAll('button, div[role="button"], [role="button"]')
      );

      console.log(`Total buttons found: ${allButtons.length}`);

      let followingButton = null;
      let followButton = null;

      // Search through all buttons for Following or Follow
      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        const rect = btn.getBoundingClientRect();

        // Check if button is visible and in the upper part of the page (profile area)
        const isVisible = rect.width > 0 && rect.height > 0;
        const isInProfileArea = rect.top < 400 && rect.top > 50;

        console.log(
          `Button: "${text}" | Visible: ${isVisible} | Top: ${rect.top} | Left: ${rect.left}`
        );

        // Look for "Following" button (exact match, case-sensitive)
        if (isVisible && isInProfileArea && text === "Following") {
          console.log("✅ Found Following button");
          followingButton = btn;
          followingButton.setAttribute("data-following-btn", "true");
          followingButton.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          break;
        }
      }

      // If no Following button, check for Follow button
      if (!followingButton) {
        for (const btn of allButtons) {
          const text = btn.textContent?.trim() || "";
          const rect = btn.getBoundingClientRect();

          const isVisible = rect.width > 0 && rect.height > 0;
          const isInProfileArea = rect.top < 400 && rect.top > 50;

          // Look for "Follow" button (not following yet)
          if (isVisible && isInProfileArea && text === "Follow") {
            console.log("ℹ️ Found Follow button");
            followButton = btn;
            break;
          }
        }
      }

      if (followingButton) {
        return { found: true, isFollowing: true };
      }

      if (followButton) {
        console.log("ℹ️ User is not following this account");
        return { found: true, isFollowing: false };
      }

      return { found: false, isFollowing: false };
    });

    console.log("📊 Follow status:", followStatus);

    if (!followStatus.found) {
      // Take debug screenshot
      const screenshotPath = `tiktok-no-follow-btn-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      // Log all button texts for debugging
      const buttonTexts = await page.evaluate(() => {
        const btns = Array.from(
          document.querySelectorAll(
            'button, div[role="button"], [role="button"]'
          )
        );
        return btns
          .map((b) => b.textContent?.trim())
          .filter((t) => t && t.length < 50);
      });
      console.log("🔍 All button texts found:", buttonTexts);

      throw new Error("Following/Follow button not found on profile");
    }

    if (!followStatus.isFollowing) {
      console.log("ℹ️ User is not following this account");
      return {
        success: true,
        message: "User is not following this account",
        alreadyUnfollowed: true,
        profile_url: targetUrl,
      };
    }

    // Click the "Following" button to open dropdown menu
    console.log("🖱️ Clicking Following button...");
    await page.waitForTimeout(1500);

    let clickSuccess = false;

    // Method 1: Try clicking with locator
    try {
      const followingBtn = page.locator('[data-following-btn="true"]').first();
      await followingBtn.click({ timeout: 5000 });
      clickSuccess = true;
      console.log("✅ Clicked Following button (locator)");
    } catch (e) {
      console.log("⚠️ Locator click failed, trying alternative methods...");
    }

    // Method 2: Try JavaScript click
    if (!clickSuccess) {
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-following-btn="true"]');
          if (btn) {
            btn.click();
            return true;
          }
          throw new Error("Button not found");
        });
        clickSuccess = true;
        console.log("✅ Clicked Following button (JavaScript)");
      } catch (e) {
        console.log("⚠️ JavaScript click failed");
      }
    }

    // Method 3: Force click
    if (!clickSuccess) {
      try {
        const followingBtn = page
          .locator('[data-following-btn="true"]')
          .first();
        await followingBtn.click({ force: true, timeout: 5000 });
        clickSuccess = true;
        console.log("✅ Clicked Following button (force)");
      } catch (e) {
        console.log("⚠️ Force click failed");
      }
    }

    if (!clickSuccess) {
      throw new Error("Failed to click Following button");
    }

    // Wait for dropdown menu to appear
    console.log("⏳ Waiting for unfollow menu to appear...");
    await page.waitForTimeout(3000);

    // Take screenshot after clicking to see menu
    await page.screenshot({
      path: `tiktok-menu-opened-${Date.now()}.png`,
      fullPage: true,
    });

    // Find and click "Unfollow" option in the menu
    console.log("🔍 Looking for Unfollow option in menu...");

    const unfollowFound = await page.evaluate(() => {
      // Look for all possible elements that could contain "Unfollow"
      const allElements = Array.from(
        document.querySelectorAll(
          'div[role="menuitem"], div[role="button"], button, span, div, p'
        )
      );

      console.log(
        `Checking ${allElements.length} elements for Unfollow option`
      );

      for (const el of allElements) {
        const text = el.textContent?.trim() || "";
        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;

        // Look for exact "Unfollow" text
        if (isVisible && text === "Unfollow") {
          console.log("✅ Found Unfollow option:", {
            tag: el.tagName,
            text: text,
            top: rect.top,
            left: rect.left,
          });
          el.setAttribute("data-unfollow-option", "true");
          return true;
        }
      }

      console.log("⚠️ Unfollow option not found in initial search");
      return false;
    });

    if (!unfollowFound) {
      const screenshotPath = `tiktok-no-unfollow-option-${Date.now()}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);

      // Log what we found instead
      const menuContent = await page.evaluate(() => {
        const elements = Array.from(
          document.querySelectorAll("div, span, button")
        );
        return elements
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((el) => el.textContent?.trim())
          .filter((t) => t && t.length < 30 && t.length > 0)
          .slice(0, 20);
      });
      console.log("🔍 Visible text content:", menuContent);

      throw new Error("Unfollow option not found in menu");
    }

    console.log("🖱️ Clicking Unfollow option...");
    await page.waitForTimeout(1000);

    // Click the Unfollow option
    let unfollowClickSuccess = false;

    // Method 1: Try locator click
    try {
      const unfollowOption = page
        .locator('[data-unfollow-option="true"]')
        .first();
      await unfollowOption.click({ timeout: 5000 });
      unfollowClickSuccess = true;
      console.log("✅ Clicked Unfollow option (locator)");
    } catch (e) {
      console.log("⚠️ Locator click failed, trying JavaScript...");
    }

    // Method 2: Try JavaScript click
    if (!unfollowClickSuccess) {
      try {
        await page.evaluate(() => {
          const option = document.querySelector(
            '[data-unfollow-option="true"]'
          );
          if (option) {
            option.click();
            return true;
          }
          throw new Error("Unfollow option not found");
        });
        unfollowClickSuccess = true;
        console.log("✅ Clicked Unfollow option (JavaScript)");
      } catch (e) {
        console.log("⚠️ JavaScript click failed");
      }
    }

    // Method 3: Force click
    if (!unfollowClickSuccess) {
      try {
        const unfollowOption = page
          .locator('[data-unfollow-option="true"]')
          .first();
        await unfollowOption.click({ force: true, timeout: 5000 });
        unfollowClickSuccess = true;
        console.log("✅ Clicked Unfollow option (force)");
      } catch (e) {
        console.log("⚠️ Force click failed");
      }
    }

    if (!unfollowClickSuccess) {
      throw new Error("Failed to click Unfollow option");
    }

    // Wait for unfollow action to complete
    console.log("⏳ Waiting for unfollow to complete...");
    await page.waitForTimeout(4000);

    // Verify by checking if button changed to "Follow"
    console.log("🔍 Verifying unfollow...");

    const verified = await page.evaluate(() => {
      const allButtons = Array.from(
        document.querySelectorAll('button, div[role="button"], [role="button"]')
      );

      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        const rect = btn.getBoundingClientRect();

        const isVisible = rect.width > 0 && rect.height > 0;
        const isInProfileArea = rect.top < 400 && rect.top > 50;

        // Check if button now shows "Follow" (not "Following")
        if (isVisible && isInProfileArea && text === "Follow") {
          console.log("✅ Verified: Button now shows 'Follow'");
          return true;
        }
      }

      console.log("⚠️ Verification: 'Follow' button not found yet");
      return false;
    });

    // Take verification screenshot
    await page.screenshot({
      path: `tiktok-unfollow-verify-${Date.now()}.png`,
      fullPage: true,
    });

    if (verified) {
      console.log("✅ TikTok unfollow successful and verified!");
      return {
        success: true,
        message: "User unfollowed successfully",
        verified: true,
        profile_url: targetUrl,
      };
    } else {
      console.warn("⚠️ Unfollow action completed but verification uncertain");

      return {
        success: true,
        message: "Unfollow action completed (verification pending)",
        verified: false,
        profile_url: targetUrl,
        note: "Action was performed but button state not yet updated. Please check profile to confirm.",
      };
    }
  } catch (error) {
    console.error("❌ TikTok unfollow failed:", error.message);

    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `tiktok-unfollow-error-${timestamp}.png`,
        fullPage: true,
      });
      console.log(
        `📸 Error screenshot saved: tiktok-unfollow-error-${timestamp}.png`
      );
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

async function youtubeUnfollow(page, targetUrl) {
  console.log("🔴 Processing YouTube unsubscribe...");

  try {
    if (!targetUrl) throw new Error("Target URL missing");

    // Navigate directly to the channel
    console.log(`🔴 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    console.log("⏳ YouTube channel loaded, waiting...");
    await page.waitForTimeout(4000);

    console.log("🔍 Looking for Subscribed button...");

    // Check subscription status
    const buttonStatus = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";

        // Check if subscribed
        if (text === "Subscribed" || ariaLabel.includes("Unsubscribe")) {
          btn.setAttribute("data-yt-unsub", "true");
          console.log("✅ Found Subscribed button");
          return { found: true, isSubscribed: true };
        }

        // Check if not subscribed
        if (text === "Subscribe" || ariaLabel.includes("Subscribe to")) {
          console.log("ℹ️ Not subscribed to this channel");
          return { found: true, isSubscribed: false };
        }
      }

      return { found: false, isSubscribed: false };
    });

    if (!buttonStatus.found) {
      throw new Error("Subscription button not found");
    }

    if (!buttonStatus.isSubscribed) {
      console.log("ℹ️ Already not subscribed to this channel");
      return {
        success: true,
        message: "Not subscribed to this channel",
        alreadyUnsubscribed: true,
      };
    }

    // Click Subscribed button to open menu
    console.log("🖱️ Clicking Subscribed button...");

    await page.evaluate(() => {
      const btn = document.querySelector('[data-yt-unsub="true"]');
      if (btn) btn.click();
    });

    await page.waitForTimeout(2000);

    // Find and click Unsubscribe in menu
    console.log("🔍 Looking for Unsubscribe option...");

    const unsubscribeFound = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll(
          "yt-formatted-string, tp-yt-paper-item, button, div"
        )
      );

      for (const el of elements) {
        const text = el.textContent?.trim() || "";

        if (text === "Unsubscribe") {
          el.setAttribute("data-yt-unsub-option", "true");
          console.log("✅ Found Unsubscribe option");
          return true;
        }
      }

      return false;
    });

    if (!unsubscribeFound) {
      throw new Error("Unsubscribe option not found in menu");
    }

    // Click Unsubscribe
    console.log("🖱️ Clicking Unsubscribe...");

    await page.evaluate(() => {
      const option = document.querySelector('[data-yt-unsub-option="true"]');
      if (option) option.click();
    });

    await page.waitForTimeout(2000);

    // Confirm unsubscribe if dialog appears
    console.log("🔍 Looking for confirmation...");

    const confirmClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";

        if (text === "Unsubscribe" || ariaLabel.includes("Unsubscribe")) {
          console.log("✅ Found confirmation button");
          btn.click();
          return true;
        }
      }

      return false;
    });

    if (confirmClicked) {
      console.log("✅ Clicked confirmation");
    }

    await page.waitForTimeout(3000);

    // Verify unsubscribe
    console.log("🔍 Verifying unsubscribe...");

    const verified = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";

        if (text === "Subscribe" || ariaLabel.includes("Subscribe to")) {
          console.log("✅ Verified - button shows Subscribe");
          return true;
        }
      }

      return false;
    });

    if (verified) {
      console.log("✅ YouTube unsubscribe successful!");
      return {
        success: true,
        message: "Channel unsubscribed successfully",
        verified: true,
        channel_url: targetUrl,
      };
    } else {
      console.log("⚠️ Unsubscribe completed but verification pending");
      return {
        success: true,
        message: "Unsubscribe action completed",
        verified: false,
        channel_url: targetUrl,
      };
    }
  } catch (error) {
    console.error("❌ YouTube unsubscribe failed:", error.message);
    return {
      success: false,
      message: error.message,
      channel_url: targetUrl,
    };
  }
}

// Update unfollowUser to include YouTube
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

    if (platform === "youtube") {
      return await youtubeUnfollow(page, targetUrl);
    }

    return {
      success: false,
      message: `Unfollow not supported for ${platform}`,
    };
  } catch (error) {
    console.error("❌ Unfollow failed:", error.message);
    return { success: false, message: error.message };
  }
}
//Scrolling

app.post("/stop-scroll", async (req, res) => {
  const { account_id } = req.body;

  if (!account_id) {
    return res.json({ success: false, message: "account_id required" });
  }

  if (activeScrollBots[account_id]) {
    activeScrollBots[account_id].shouldStop = true;
    console.log(`🛑 Stop signal sent to scroll bot for account ${account_id}`);

    return res.json({
      success: true,
      message: "Stop signal sent. Bot will stop after current action.",
    });
  }

  return res.json({
    success: false,
    message: "No active scroll bot found for this account",
  });
});

// --------------- GET SCROLL BOT STATUS -------------------
app.post("/stop-scroll", async (req, res) => {
  const { account_id } = req.body;

  if (!account_id) {
    return res.json({ success: false, message: "account_id required" });
  }

  if (activeScrollBots[account_id]) {
    activeScrollBots[account_id].shouldStop = true;
    console.log(`🛑 Stop signal sent to scroll bot for account ${account_id}`);

    return res.json({
      success: true,
      message: "Stop signal sent. Bot will stop after current action.",
    });
  }

  return res.json({
    success: false,
    message: "No active scroll bot found for this account",
  });
});

// --------------- GET SCROLL BOT STATUS -------------------
app.post("/scroll-status", async (req, res) => {
  const { account_id } = req.body;

  if (!account_id) {
    return res.json({ success: false, message: "account_id required" });
  }

  const botStatus = activeScrollBots[account_id];

  if (botStatus) {
    return res.json({
      success: true,
      isRunning: !botStatus.shouldStop,
      stats: botStatus.stats,
    });
  }

  return res.json({
    success: true,
    isRunning: false,
    stats: null,
  });
});

// --------------- INSTAGRAM UNLIMITED SCROLL BOT -------------------
async function instagramScrollBot(page, accountId, options = {}) {
  console.log("📸 Instagram UNLIMITED scroll bot started...");

  const {
    likeChance = 35,
    commentChance = 10,
    comments = [
      "Nice post 🔥",
      "Love this ❤️",
      "Amazing 😍",
      "So cool 👏",
      "Great content 💯",
      "Awesome! 🙌",
      "Beautiful ✨",
      "Incredible! 👌",
    ],
  } = options;

  // Initialize bot state
  activeScrollBots[accountId] = {
    shouldStop: false,
    stats: {
      scrolls: 0,
      likes: 0,
      comments: 0,
      startTime: Date.now(),
    },
  };

  try {
    // 🔥 Navigate to Instagram home/feed automatically
    console.log("🏠 Navigating to Instagram feed...");
    await page.goto("https://www.instagram.com/", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await page.waitForTimeout(5000);

    // Verify we're on the feed
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/accounts/login")
    ) {
      console.log("❌ Not logged in - session expired");
      delete activeScrollBots[accountId];
      return {
        success: false,
        message: "Session expired. Please log in again.",
      };
    }

    console.log("✅ Feed loaded - Starting unlimited scroll...");

    let scrollIteration = 0;

    // 🔄 INFINITE LOOP - runs until user stops it
    while (!activeScrollBots[accountId]?.shouldStop) {
      scrollIteration++;
      console.log(`⬇️ Scrolling feed (iteration: ${scrollIteration})`);

      // Smooth random scroll
      await page.mouse.wheel(0, Math.floor(Math.random() * 600) + 400);
      await page.waitForTimeout(Math.floor(Math.random() * 2500) + 1500);

      // Update stats
      activeScrollBots[accountId].stats.scrolls = scrollIteration;

      // Collect visible posts
      const posts = await page.locator("article").all();

      if (posts.length === 0) {
        console.log("⚠️ No posts found, continuing...");
        continue;
      }

      // Pick random post from visible ones
      const post = posts[Math.floor(Math.random() * posts.length)];

      try {
        await post.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);

        // Check stop signal before interactions
        if (activeScrollBots[accountId]?.shouldStop) break;

        // ❤️ RANDOM LIKE
        if (Math.random() * 100 < likeChance) {
          const likeBtn = post.locator('svg[aria-label="Like"]').first();

          if (await likeBtn.isVisible().catch(() => false)) {
            await likeBtn.click({ delay: 120 });
            activeScrollBots[accountId].stats.likes++;
            console.log(
              `❤️ Post liked (Total: ${activeScrollBots[accountId].stats.likes})`
            );
            await page.waitForTimeout(Math.floor(Math.random() * 2000) + 1500);
          }
        }

        // Check stop signal before commenting
        if (activeScrollBots[accountId]?.shouldStop) break;

        // 💬 RANDOM COMMENT
        if (Math.random() * 100 < commentChance) {
          const commentBtn = post.locator('svg[aria-label="Comment"]').first();

          if (await commentBtn.isVisible().catch(() => false)) {
            await commentBtn.click();
            await page.waitForTimeout(2000);

            const textarea = page.locator("textarea").first();
            if (await textarea.isVisible().catch(() => false)) {
              const comment =
                comments[Math.floor(Math.random() * comments.length)];

              await textarea.type(comment, { delay: 80 });
              await page.keyboard.press("Enter");

              activeScrollBots[accountId].stats.comments++;
              console.log(
                `💬 Commented: "${comment}" (Total: ${activeScrollBots[accountId].stats.comments})`
              );
              await page.waitForTimeout(
                Math.floor(Math.random() * 3000) + 2000
              );
            }
          }
        }
      } catch (err) {
        console.log("⚠️ Post interaction skipped:", err.message);
      }

      // Random pause every 5-10 scrolls
      if (scrollIteration % 7 === 0) {
        const pauseDuration = Math.floor(Math.random() * 5000) + 3000;
        console.log(`⏸️ Taking a ${pauseDuration}ms break...`);
        await page.waitForTimeout(pauseDuration);
      }

      // Check stop signal at end of loop
      if (activeScrollBots[accountId]?.shouldStop) {
        console.log("🛑 Stop signal received - ending scroll bot");
        break;
      }
    }

    const finalStats = activeScrollBots[accountId].stats;
    const duration = Math.floor((Date.now() - finalStats.startTime) / 1000);

    console.log("✅ Instagram scroll bot stopped");
    console.log(
      `📊 Final Stats: ${finalStats.scrolls} scrolls, ${finalStats.likes} likes, ${finalStats.comments} comments in ${duration}s`
    );

    // Cleanup
    delete activeScrollBots[accountId];

    return {
      success: true,
      message: "Instagram scrolling stopped",
      stats: {
        ...finalStats,
        duration: `${duration}s`,
      },
    };
  } catch (error) {
    console.error("❌ Scroll bot error:", error.message);
    delete activeScrollBots[accountId];
    return {
      success: false,
      message: error.message,
    };
  }
}

async function facebookScrollBot(page, accountId, options = {}) {
  console.log("📘 Facebook UNLIMITED scroll bot started...");

  const {
    likeChance = 35,
    commentChance = 10,
    comments = [
      "Great post! 👍",
      "Love this! ❤️",
      "Amazing! 😍",
      "Awesome! 🔥",
      "Nice! 👏",
      "Well said! 💯",
      "Interesting! 🤔",
      "Thanks for sharing! 🙏",
    ],
  } = options;

  // Initialize bot state
  activeScrollBots[accountId] = {
    shouldStop: false,
    platform: "facebook",
    stats: {
      scrolls: 0,
      likes: 0,
      comments: 0,
      attempts: 0,
      errors: [],
      startTime: Date.now(),
    },
  };

  // Helper function to perform like action (LANGUAGE AGNOSTIC)
  async function performLike(post) {
    try {
      console.log("🔍 Attempting to like post...");

      // Strategy 1: Find Like button by SVG icon and position (most reliable)
      const likeClicked = await post.evaluate((postEl) => {
        try {
          // Method 1: Find buttons in the action bar
          const actionButtons = postEl.querySelectorAll(
            'div[role="button"], span[role="button"]'
          );

          // The Like button is typically the FIRST interactive button in the action bar
          // Look for buttons that have SVG icons (Like, Comment, Share)
          const buttonsArray = Array.from(actionButtons);

          for (let i = 0; i < Math.min(buttonsArray.length, 5); i++) {
            const btn = buttonsArray[i];
            const ariaLabel = (
              btn.getAttribute("aria-label") || ""
            ).toLowerCase();

            // Check if this looks like an already-liked button
            if (ariaLabel.includes("remove") || ariaLabel.includes("unlike")) {
              console.log("Post already liked");
              return { success: false, alreadyLiked: true };
            }

            // Check if button has thumbs-up SVG (Like button indicator)
            const svg = btn.querySelector("svg");
            if (svg) {
              const svgPath = svg.querySelector("path");
              if (svgPath) {
                const pathD = svgPath.getAttribute("d");
                // Thumbs up icon has specific path patterns
                // Also check if it's the first actionable button
                if (
                  i === 0 ||
                  ariaLabel.includes("like") ||
                  (pathD && pathD.length > 50 && pathD.includes("M"))
                ) {
                  // Extra check: make sure it's not Share or other button
                  if (
                    !ariaLabel.includes("share") &&
                    !ariaLabel.includes("comment")
                  ) {
                    btn.click();
                    console.log("Clicked Like button at position:", i);
                    return { success: true, alreadyLiked: false };
                  }
                }
              }
            }
          }

          // Method 2: Look specifically for Like-related aria-labels (any language)
          for (const btn of buttonsArray) {
            const ariaLabel = (
              btn.getAttribute("aria-label") || ""
            ).toLowerCase();

            // Check multiple language variations
            if (
              ariaLabel === "like" ||
              ariaLabel === "पसंद" || // Hindi
              ariaLabel === "لائک" || // Urdu
              ariaLabel === "beğen" || // Turkish
              ariaLabel === "curtir" || // Portuguese
              ariaLabel === "me gusta" || // Spanish
              ariaLabel.startsWith("like") ||
              ariaLabel.includes("thumbs up")
            ) {
              btn.click();
              console.log("Clicked Like button by aria-label:", ariaLabel);
              return { success: true, alreadyLiked: false };
            }
          }

          return { success: false, alreadyLiked: false };
        } catch (e) {
          console.error("Error in like evaluation:", e);
          return { success: false, alreadyLiked: false };
        }
      });

      if (likeClicked.alreadyLiked) {
        console.log("💙 Post already liked, skipping...");
        return false;
      }

      if (likeClicked.success) {
        activeScrollBots[accountId].stats.likes++;
        console.log(
          `❤️ [Facebook] Liked! (Total: ${activeScrollBots[accountId].stats.likes})`
        );
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500));
        return true;
      }

      // Strategy 2: Fallback - Click first button with SVG
      console.log("🔍 Trying fallback method...");

      const buttons = await post.locator('div[role="button"]').all();

      if (buttons.length > 0) {
        // Usually Like is the first button
        const firstButton = buttons[0];

        try {
          await firstButton.scrollIntoViewIfNeeded({ timeout: 1000 });
          await page.waitForTimeout(300);
          await firstButton.click({ timeout: 2000, force: true });

          activeScrollBots[accountId].stats.likes++;
          console.log(
            `❤️ [Facebook] Liked via fallback! (Total: ${activeScrollBots[accountId].stats.likes})`
          );
          await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500));
          return true;
        } catch (e) {
          console.log("⚠️ Fallback click failed:", e.message);
        }
      }

      console.log("⚠️ Could not find Like button");
      return false;
    } catch (e) {
      console.log("⚠️ Like attempt failed:", e.message);
      activeScrollBots[accountId].stats.errors.push(`Like: ${e.message}`);
      return false;
    }
  }

  // Helper function to perform comment action (LANGUAGE AGNOSTIC)
  async function performComment(post) {
    try {
      console.log("🔍 Attempting to comment...");

      // Step 1: Click comment button (usually second button in action bar)
      const commentClicked = await post.evaluate((postEl) => {
        try {
          const actionButtons = postEl.querySelectorAll(
            'div[role="button"], span[role="button"]'
          );
          const buttonsArray = Array.from(actionButtons);

          // Method 1: Find by aria-label
          for (const btn of buttonsArray) {
            const ariaLabel = (
              btn.getAttribute("aria-label") || ""
            ).toLowerCase();

            // Check multiple language variations for Comment
            if (
              ariaLabel.includes("comment") ||
              ariaLabel.includes("کمنٹ") || // Urdu
              ariaLabel.includes("टिप्पणी") || // Hindi
              ariaLabel.includes("yorum") || // Turkish
              ariaLabel.includes("comentar") || // Spanish/Portuguese
              ariaLabel.includes("commenter") // French
            ) {
              btn.click();
              console.log("Clicked Comment button by aria-label:", ariaLabel);
              return true;
            }
          }

          // Method 2: Comment is usually the SECOND button (after Like)
          if (buttonsArray.length >= 2) {
            buttonsArray[1].click();
            console.log("Clicked second button (Comment position)");
            return true;
          }

          return false;
        } catch (e) {
          console.error("Error clicking comment button:", e);
          return false;
        }
      });

      if (!commentClicked) {
        console.log("⚠️ Could not click comment button");
        return false;
      }

      console.log("✅ Comment button clicked, waiting for input...");
      await page.waitForTimeout(2000);

      // Step 2: Find and fill comment input
      const comment = comments[Math.floor(Math.random() * comments.length)];

      // Wait for comment box to appear
      await page.waitForTimeout(1500);

      // Strategy: Find any contenteditable div that appeared recently
      const commentPosted = await page.evaluate((commentText) => {
        try {
          // Find all contenteditable elements
          const editableDivs = document.querySelectorAll(
            'div[contenteditable="true"]'
          );

          // Try the last one first (most recently opened)
          for (let i = editableDivs.length - 1; i >= 0; i--) {
            const div = editableDivs[i];

            // Check if it's visible and empty
            const rect = div.getBoundingClientRect();
            if (rect.height > 0 && rect.width > 0) {
              // Focus and type
              div.focus();
              div.click();

              // Clear any placeholder
              div.textContent = "";

              // Insert text
              div.textContent = commentText;

              // Trigger input event
              const inputEvent = new Event("input", { bubbles: true });
              div.dispatchEvent(inputEvent);

              console.log("Comment typed:", commentText);
              return true;
            }
          }

          return false;
        } catch (e) {
          console.error("Error typing comment:", e);
          return false;
        }
      }, comment);

      if (!commentPosted) {
        console.log("⚠️ Could not type comment");
        return false;
      }

      // Wait a bit before pressing Enter
      await page.waitForTimeout(1000);

      // Press Enter to submit
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);

      activeScrollBots[accountId].stats.comments++;
      console.log(
        `💬 [Facebook] Commented: "${comment}" (Total: ${activeScrollBots[accountId].stats.comments})`
      );
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));

      return true;
    } catch (e) {
      console.log("⚠️ Comment attempt failed:", e.message);
      activeScrollBots[accountId].stats.errors.push(`Comment: ${e.message}`);
      return false;
    }
  }

  try {
    console.log("🏠 Navigating to Facebook feed...");
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for feed to load
    await page.waitForTimeout(6000);

    // Verify login
    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      console.log("❌ Not logged in - session expired");
      delete activeScrollBots[accountId];
      return {
        success: false,
        message: "Session expired. Please log in again.",
      };
    }

    console.log("✅ Facebook feed loaded - Starting unlimited scroll...");

    let scrollIteration = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // 🔄 INFINITE LOOP
    while (!activeScrollBots[accountId]?.shouldStop) {
      scrollIteration++;
      console.log(`\n⬇️ [Facebook] Scroll iteration: ${scrollIteration}`);

      // Scroll smoothly
      const scrollAmount = 600 + Math.floor(Math.random() * 400);
      await page.mouse.wheel(0, scrollAmount);
      await page.waitForTimeout(2500 + Math.floor(Math.random() * 2000));

      activeScrollBots[accountId].stats.scrolls = scrollIteration;

      // Get Facebook posts - try multiple selectors
      let posts = await page.locator('div[role="article"]').all();

      if (posts.length === 0) {
        posts = await page.locator('div[data-pagelet^="FeedUnit"]').all();
      }

      if (posts.length === 0) {
        console.log("⚠️ No posts found, continuing to scroll...");
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log("❌ Too many consecutive errors, stopping bot");
          break;
        }
        continue;
      }

      consecutiveErrors = 0;
      console.log(`📊 Found ${posts.length} posts on screen`);

      // Pick a random post from visible posts
      const postIndex = Math.floor(Math.random() * Math.min(posts.length, 4));
      const post = posts[postIndex];

      try {
        // Scroll post into view
        await post.scrollIntoViewIfNeeded({ timeout: 3000 });
        await page.waitForTimeout(2000);

        if (activeScrollBots[accountId]?.shouldStop) break;

        activeScrollBots[accountId].stats.attempts++;

        // ❤️ LIKE ACTION
        if (Math.random() * 100 < likeChance) {
          await performLike(post);

          // Wait a bit between like and comment
          await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
        }

        if (activeScrollBots[accountId]?.shouldStop) break;

        // 💬 COMMENT ACTION
        if (Math.random() * 100 < commentChance) {
          await performComment(post);
        }
      } catch (err) {
        console.log("⚠️ Post interaction error:", err.message);
        activeScrollBots[accountId].stats.errors.push(
          `Interaction: ${err.message}`
        );
        consecutiveErrors++;
      }

      // Random pause every 4-7 scrolls
      if (scrollIteration % (4 + Math.floor(Math.random() * 4)) === 0) {
        const pauseDuration = 3000 + Math.floor(Math.random() * 4000);
        console.log(
          `⏸️ Taking a ${Math.floor(pauseDuration / 1000)}s break...`
        );
        await page.waitForTimeout(pauseDuration);
      }

      if (activeScrollBots[accountId]?.shouldStop) {
        console.log("🛑 Stop signal received - ending Facebook bot");
        break;
      }
    }

    const finalStats = activeScrollBots[accountId].stats;
    const duration = Math.floor((Date.now() - finalStats.startTime) / 1000);

    console.log("\n✅ Facebook scroll bot stopped");
    console.log(`📊 Final Stats:`);
    console.log(`   - Scrolls: ${finalStats.scrolls}`);
    console.log(`   - Likes: ${finalStats.likes}`);
    console.log(`   - Comments: ${finalStats.comments}`);
    console.log(`   - Attempts: ${finalStats.attempts}`);
    console.log(`   - Duration: ${duration}s`);
    console.log(`   - Errors: ${finalStats.errors.length}`);

    delete activeScrollBots[accountId];

    return {
      success: true,
      message: "Facebook scrolling stopped",
      stats: {
        ...finalStats,
        duration: `${duration}s`,
      },
    };
  } catch (error) {
    console.error("❌ Facebook scroll bot error:", error.message);

    if (activeScrollBots[accountId]) {
      activeScrollBots[accountId].stats.errors.push(error.message);
    }

    delete activeScrollBots[accountId];

    return {
      success: false,
      message: error.message,
    };
  }
}

async function twitterScrollBot(page, accountId, options = {}) {
  console.log("🐦 Twitter UNLIMITED scroll bot started...");

  const {
    likeChance = 35,
    commentChance = 10,
    retweetChance = 5,
    comments = [
      "Great tweet! 👍",
      "Love this! 🔥",
      "Amazing! 💯",
      "So true! ✨",
      "Interesting! 🤔",
      "Thanks for sharing! 🙏",
      "Well said! 👏",
      "Awesome! 🚀",
    ],
  } = options;

  // Initialize bot state
  activeScrollBots[accountId] = {
    shouldStop: false,
    platform: "twitter",
    stats: {
      scrolls: 0,
      likes: 0,
      comments: 0,
      retweets: 0,
      attempts: 0,
      errors: [],
      startTime: Date.now(),
    },
  };

  // Helper function to check if already liked

  async function isTweetAlreadyLiked(tweet) {
    try {
      return await tweet.evaluate((tweetEl) => {
        const likeButton = tweetEl.querySelector('[data-testid="like"]');
        if (!likeButton) return false;

        // Method 1: Check aria-label - must be exact "Liked" or contain "Unlike"
        const ariaLabel = likeButton.getAttribute("aria-label");
        if (ariaLabel) {
          // Only return true if it says "Liked" or "Unlike" (not just "Like")
          if (
            ariaLabel === "Liked" ||
            ariaLabel.startsWith("Unlike") ||
            ariaLabel.includes(" Liked")
          ) {
            return true;
          }
          // If it's just "Like" (without the 'd'), it's NOT liked
          if (ariaLabel === "Like" || ariaLabel.startsWith("Like ")) {
            return false;
          }
        }

        // Method 2: Check for the filled heart SVG path
        const svg = likeButton.querySelector("svg");
        if (!svg) return false;

        // Method 2a: Check SVG color first (most reliable)
        const computedStyle = window.getComputedStyle(svg);
        const color = computedStyle.color || computedStyle.fill;

        // Liked tweets have pink/red color
        if (color) {
          // Check for pink/red colors
          if (
            color.includes("249, 24, 128") ||
            color.includes("224, 36, 94") ||
            color.includes("244, 33, 46") ||
            color.includes("rgb(249")
          ) {
            return true;
          }
          // If it's gray/white, it's not liked
          if (
            color.includes("113, 118, 123") ||
            color.includes("239, 243, 244")
          ) {
            return false;
          }
        }

        // Method 2b: Check path as last resort
        const path = svg.querySelector("path");
        if (path) {
          const d = path.getAttribute("d");
          if (d) {
            // Filled heart path (liked) vs empty heart (not liked)
            const isFilledPath =
              d.startsWith("M20.884") || d.startsWith("M16.697");
            const isEmptyPath = d.includes("M16.5") || d.includes("M12 21.638");

            if (isFilledPath) return true;
            if (isEmptyPath) return false;
          }
        }

        return false;
      });
    } catch (e) {
      console.log("⚠️ Could not check like status:", e.message);
      return false;
    }
  }

  // Helper function to check if already retweeted
  async function isTweetAlreadyRetweeted(tweet) {
    try {
      return await tweet.evaluate((tweetEl) => {
        const retweetButton = tweetEl.querySelector('[data-testid="retweet"]');
        if (!retweetButton) return false;

        // Check if retweet button has green color (retweeted state)
        const svg = retweetButton.querySelector("svg");
        if (!svg) return false;

        const style = window.getComputedStyle(svg);
        const color = style.color || style.fill;

        // Retweeted tweets have green color
        return (
          color &&
          (color.includes("rgb(0, 186, 124)") ||
            color.includes("rgb(23, 191, 99)"))
        );
      });
    } catch (e) {
      console.log("⚠️ Could not check retweet status:", e.message);
      return false;
    }
  }

  // Helper function to perform like action
  async function performLike(tweet) {
    try {
      // Check if already liked
      // if (await isTweetAlreadyLiked(tweet)) {
      //   console.log("❤️ Tweet already liked, skipping...");
      //   return false;
      // }

      console.log("🔍 Attempting to like tweet...");

      // Strategy 1: Use data-testid (most reliable for Twitter)
      try {
        const likeButton = tweet.locator('[data-testid="like"]').first();

        if (await likeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await likeButton.scrollIntoViewIfNeeded({ timeout: 1000 });
          await page.waitForTimeout(300 + Math.floor(Math.random() * 200));
          await likeButton.click({ timeout: 2000 });

          activeScrollBots[accountId].stats.likes++;
          console.log(
            `❤️ [Twitter] Liked! (Total: ${activeScrollBots[accountId].stats.likes})`
          );
          await page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));
          return true;
        }
      } catch (e) {
        console.log("⚠️ Primary like method failed:", e.message);
      }

      // Strategy 2: Find by aria-label
      try {
        const likeButton = tweet.locator('[aria-label*="Like"]').first();

        if (await likeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await likeButton.click({ timeout: 2000 });

          activeScrollBots[accountId].stats.likes++;
          console.log(
            `❤️ [Twitter] Liked via aria-label! (Total: ${activeScrollBots[accountId].stats.likes})`
          );
          await page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));
          return true;
        }
      } catch (e) {
        console.log("⚠️ Aria-label like method failed:", e.message);
      }

      console.log("⚠️ Could not find Like button");
      return false;
    } catch (e) {
      console.log("⚠️ Like attempt failed:", e.message);
      activeScrollBots[accountId].stats.errors.push(`Like: ${e.message}`);
      return false;
    }
  }

  // Helper function to perform retweet action
  async function performRetweet(tweet) {
    try {
      // Check if already retweeted
      if (await isTweetAlreadyRetweeted(tweet)) {
        console.log("🔄 Tweet already retweeted, skipping...");
        return false;
      }

      console.log("🔍 Attempting to retweet...");

      // Click retweet button
      try {
        const retweetButton = tweet.locator('[data-testid="retweet"]').first();

        if (
          await retweetButton.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await retweetButton.scrollIntoViewIfNeeded({ timeout: 1000 });
          await page.waitForTimeout(300);
          await retweetButton.click({ timeout: 2000 });

          // Wait for retweet menu to appear
          await page.waitForTimeout(1000);

          // Click "Retweet" option in the menu (not "Quote")
          const retweetOption = page
            .locator('[data-testid="retweetConfirm"]')
            .first();

          if (
            await retweetOption.isVisible({ timeout: 2000 }).catch(() => false)
          ) {
            await retweetOption.click({ timeout: 2000 });

            activeScrollBots[accountId].stats.retweets++;
            console.log(
              `🔄 [Twitter] Retweeted! (Total: ${activeScrollBots[accountId].stats.retweets})`
            );
            await page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));
            return true;
          }
        }
      } catch (e) {
        console.log("⚠️ Retweet method failed:", e.message);
      }

      console.log("⚠️ Could not retweet");
      return false;
    } catch (e) {
      console.log("⚠️ Retweet attempt failed:", e.message);
      activeScrollBots[accountId].stats.errors.push(`Retweet: ${e.message}`);
      return false;
    }
  }

  // Helper function to perform comment action
  async function performComment(tweet) {
    try {
      console.log("🔍 Attempting to comment...");

      // Click reply/comment button
      try {
        const replyButton = tweet.locator('[data-testid="reply"]').first();

        if (await replyButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await replyButton.scrollIntoViewIfNeeded({ timeout: 1000 });
          await page.waitForTimeout(300);
          await replyButton.click({ timeout: 2000 });

          console.log("✅ Reply button clicked, waiting for input...");
          await page.waitForTimeout(2000);

          // Find the tweet compose box
          const tweetBox = page
            .locator('[data-testid="tweetTextarea_0"]')
            .first();

          if (await tweetBox.isVisible({ timeout: 3000 }).catch(() => false)) {
            const comment =
              comments[Math.floor(Math.random() * comments.length)];

            console.log(`✍️ Typing comment: "${comment}"`);

            // Click to focus
            await tweetBox.click({ timeout: 2000 });
            await page.waitForTimeout(500);

            // Type the comment
            await tweetBox.pressSequentially(comment, { delay: 100 });
            await page.waitForTimeout(1000);

            // Click the reply button to post
            const postReplyButton = page
              .locator('[data-testid="tweetButton"]')
              .first();

            if (
              await postReplyButton
                .isVisible({ timeout: 2000 })
                .catch(() => false)
            ) {
              await postReplyButton.click({ timeout: 2000 });

              activeScrollBots[accountId].stats.comments++;
              console.log(
                `💬 [Twitter] Commented: "${comment}" (Total: ${activeScrollBots[accountId].stats.comments})`
              );
              await page.waitForTimeout(
                2000 + Math.floor(Math.random() * 2000)
              );

              // Close the reply dialog by pressing Escape
              await page.keyboard.press("Escape");
              await page.waitForTimeout(500);

              return true;
            }
          }
        }
      } catch (e) {
        console.log("⚠️ Comment method failed:", e.message);

        // Try to close any open dialogs
        try {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        } catch {}
      }

      console.log("⚠️ Could not post comment");
      return false;
    } catch (e) {
      console.log("⚠️ Comment attempt failed:", e.message);
      activeScrollBots[accountId].stats.errors.push(`Comment: ${e.message}`);

      // Try to close any open dialogs
      try {
        await page.keyboard.press("Escape");
      } catch {}

      return false;
    }
  }

  try {
    console.log("🏠 Navigating to Twitter feed...");

    // Navigate to Twitter home feed
    await page.goto("https://twitter.com/home", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for feed to load
    await page.waitForTimeout(5000);

    // Verify login
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/i/flow/login")) {
      console.log("❌ Not logged in - session expired");
      delete activeScrollBots[accountId];
      return {
        success: false,
        message: "Session expired. Please log in again.",
      };
    }

    console.log("✅ Twitter feed loaded - Starting unlimited scroll...");

    let scrollIteration = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // 🔄 INFINITE LOOP
    while (!activeScrollBots[accountId]?.shouldStop) {
      scrollIteration++;
      console.log(`\n⬇️ [Twitter] Scroll iteration: ${scrollIteration}`);

      // Scroll smoothly
      const scrollAmount = 600 + Math.floor(Math.random() * 400);
      await page.mouse.wheel(0, scrollAmount);
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));

      activeScrollBots[accountId].stats.scrolls = scrollIteration;

      // Get Twitter tweets (posts)
      let tweets = await page.locator('article[data-testid="tweet"]').all();

      // Fallback: try alternative selector
      if (tweets.length === 0) {
        tweets = await page.locator("article").all();
      }

      if (tweets.length === 0) {
        console.log("⚠️ No tweets found, continuing to scroll...");
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log("❌ Too many consecutive errors, stopping bot");
          break;
        }
        continue;
      }

      consecutiveErrors = 0;
      console.log(`📊 Found ${tweets.length} tweets on screen`);

      // Pick a random tweet from visible tweets
      const tweetIndex = Math.floor(Math.random() * Math.min(tweets.length, 5));
      const tweet = tweets[tweetIndex];

      try {
        // Scroll tweet into view
        await tweet.scrollIntoViewIfNeeded({ timeout: 3000 });
        await page.waitForTimeout(1500);

        if (activeScrollBots[accountId]?.shouldStop) break;

        activeScrollBots[accountId].stats.attempts++;

        // ❤️ LIKE ACTION
        if (Math.random() * 100 < likeChance) {
          await performLike(tweet);
          await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));
        }

        if (activeScrollBots[accountId]?.shouldStop) break;

        // 🔄 RETWEET ACTION
        if (Math.random() * 100 < retweetChance) {
          await performRetweet(tweet);
          await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));
        }

        if (activeScrollBots[accountId]?.shouldStop) break;

        // 💬 COMMENT ACTION
        if (Math.random() * 100 < commentChance) {
          await performComment(tweet);
        }
      } catch (err) {
        console.log("⚠️ Tweet interaction error:", err.message);
        activeScrollBots[accountId].stats.errors.push(
          `Interaction: ${err.message}`
        );
        consecutiveErrors++;
      }

      // Random pause every 5-8 scrolls
      if (scrollIteration % (5 + Math.floor(Math.random() * 4)) === 0) {
        const pauseDuration = 3000 + Math.floor(Math.random() * 5000);
        console.log(
          `⏸️ Taking a ${Math.floor(pauseDuration / 1000)}s break...`
        );
        await page.waitForTimeout(pauseDuration);
      }

      if (activeScrollBots[accountId]?.shouldStop) {
        console.log("🛑 Stop signal received - ending Twitter bot");
        break;
      }
    }

    const finalStats = activeScrollBots[accountId].stats;
    const duration = Math.floor((Date.now() - finalStats.startTime) / 1000);

    console.log("\n✅ Twitter scroll bot stopped");
    console.log(`📊 Final Stats:`);
    console.log(`   - Scrolls: ${finalStats.scrolls}`);
    console.log(`   - Likes: ${finalStats.likes}`);
    console.log(`   - Comments: ${finalStats.comments}`);
    console.log(`   - Retweets: ${finalStats.retweets}`);
    console.log(`   - Attempts: ${finalStats.attempts}`);
    console.log(`   - Duration: ${duration}s`);
    console.log(`   - Errors: ${finalStats.errors.length}`);

    delete activeScrollBots[accountId];

    return {
      success: true,
      message: "Twitter scrolling stopped",
      stats: {
        ...finalStats,
        duration: `${duration}s`,
      },
    };
  } catch (error) {
    console.error("❌ Twitter scroll bot error:", error.message);

    if (activeScrollBots[accountId]) {
      activeScrollBots[accountId].stats.errors.push(error.message);
    }

    delete activeScrollBots[accountId];

    return {
      success: false,
      message: error.message,
    };
  }
}
async function tiktokScrollBot(page, accountId, options = {}) {
  console.log("🎵 TikTok UNLIMITED scroll bot started...");

  const {
    likeChance = 35,
    commentChance = 10,
    shareChance = 5,
    comments = [
      "Love this! 🔥",
      "Amazing! 💯",
      "So good! ✨",
      "Wow! 😍",
      "This is fire! 🚀",
      "Great content! 👏",
      "Can't stop watching! 🤩",
      "Perfect! ❤️",
    ],
    email = null,
    password = null,
  } = options;

  // Initialize bot state
  activeScrollBots[accountId] = {
    shouldStop: false,
    platform: "tiktok",
    stats: {
      scrolls: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      attempts: 0,
      errors: [],
      startTime: Date.now(),
    },
  };

  // Helper function to check if logged in
  // async function checkIfLoggedIn() {
  //   try {
  //     const currentUrl = page.url();
  //     console.log("📍 Current URL:", currentUrl);

  //     // Check if we're on login page
  //     if (currentUrl.includes('/login')) {
  //       return false;
  //     }

  //     // Check for login indicators
  //     const loginButton = await page.locator('button:has-text("Log in")').isVisible({ timeout: 2000 }).catch(() => false);
  //     if (loginButton) {
  //       return false;
  //     }

  //     // Check for user profile icon (indicates logged in)
  //     const profileIcon = await page.locator('[data-e2e="nav-profile"]').isVisible({ timeout: 2000 }).catch(() => false);
  //     if (profileIcon) {
  //       console.log("✅ Already logged in (profile icon found)");
  //       return true;
  //     }

  //     // Check for upload button (only visible when logged in)
  //     const uploadButton = await page.locator('[data-e2e="nav-upload"]').isVisible({ timeout: 2000 }).catch(() => false);
  //     if (uploadButton) {
  //       console.log("✅ Already logged in (upload button found)");
  //       return true;
  //     }

  //     return false;
  //   } catch (e) {
  //     console.log("⚠️ Could not determine login status:", e.message);
  //     return false;
  //   }
  // }

  // Helper function to perform login
  async function performLogin() {
    try {
      console.log("🔐 Attempting to log in to TikTok...");

      if (!email || !password) {
        throw new Error("Email and password are required for login");
      }

      // Navigate to login page
      console.log("🌐 Navigating to TikTok login page...");
      await page.goto("https://www.tiktok.com/login/phone-or-email/email", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await page.waitForTimeout(4000);

      // Enter Email
      console.log("📧 Entering email...");
      const emailSelectors = [
        'input[type="text"]',
        'input[name="email"]',
        'input[placeholder*="email" i]',
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
            await input.fill(email);
            console.log("✅ Email entered");
            emailEntered = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!emailEntered) {
        throw new Error("Could not find TikTok email input");
      }

      // Enter Password
      console.log("🔑 Entering password...");
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
      ];
      let passwordEntered = false;

      for (const selector of passwordSelectors) {
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
            passwordEntered = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!passwordEntered) {
        throw new Error("Could not find TikTok password input");
      }

      // Click Login Button
      console.log("👆 Clicking login button...");
      await page.waitForTimeout(1000);
      const loginSelectors = [
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button[data-e2e="login-button"]',
      ];
      let loginClicked = false;

      for (const selector of loginSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 3000 })) {
            await btn.click();
            console.log("✅ Login button clicked");
            loginClicked = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!loginClicked) {
        await page.keyboard.press("Enter");
        console.log("✅ Pressed Enter to login");
      }

      await page.waitForTimeout(8000);

      // Check for CAPTCHA
      const captchaVisible = await page
        .locator('div:has-text("Verify")')
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (captchaVisible) {
        console.log(
          "⚠️ CAPTCHA detected - waiting 60 seconds for manual solve..."
        );
        console.log("🖐️ Please solve the CAPTCHA manually in the browser");
        await page.waitForTimeout(60000);
      }

      // Wait for successful redirect
      console.log("⏳ Waiting for login to complete...");
      try {
        await page.waitForURL("**/foryou**", { timeout: 15000 });
        console.log("✅ Successfully redirected to TikTok home");
      } catch (e) {
        const currentUrl = page.url();
        console.log("⚠️ Current URL:", currentUrl);

        if (currentUrl.includes("/login")) {
          throw new Error("Login failed - still on login page");
        }

        console.log("✅ Login appears successful (not on login page)");
      }

      // Extra wait for cookies to settle
      await page.waitForTimeout(5000);

      console.log("✅ TikTok login completed successfully!");
      return true;
    } catch (error) {
      console.error("❌ TikTok login failed:", error.message);
      throw error;
    }
  }

  // Helper function to check if already liked
  async function isVideoAlreadyLiked(videoContainer) {
    try {
      return await videoContainer.evaluate((container) => {
        const likeButton =
          container.querySelector('[data-e2e="like-icon"]') ||
          container.querySelector('[data-e2e="browse-like-icon"]') ||
          container.querySelector('button[aria-label*="like"]');

        if (!likeButton) return false;

        const isActive =
          likeButton.classList.contains("active") ||
          likeButton.classList.contains("liked");
        if (isActive) return true;

        const svg = likeButton.querySelector("svg");
        if (svg) {
          const path = svg.querySelector("path");
          if (path) {
            const fill = path.getAttribute("fill");
            const style = window.getComputedStyle(path);
            const color = style.fill || style.color || fill;

            if (
              color &&
              (color.includes("rgb(254, 44, 85)") ||
                color.includes("rgb(255, 43, 84)") ||
                color.includes("#FE2C55") ||
                color.includes("#ff2b54"))
            ) {
              return true;
            }
          }
        }

        const ariaLabel = likeButton.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.toLowerCase().includes("unlike")) {
          return true;
        }

        return false;
      });
    } catch (e) {
      return false;
    }
  }

  // Helper function to perform like action
  async function performLike(videoContainer) {
    try {
      const strategies = [
        { name: "data-e2e", selector: '[data-e2e="like-icon"]' },
        { name: "browse-like", selector: '[data-e2e="browse-like-icon"]' },
        { name: "aria-label", selector: 'button[aria-label*="like"]' },
      ];

      for (const strategy of strategies) {
        try {
          const likeButton = videoContainer.locator(strategy.selector).first();

          if (
            await likeButton.isVisible({ timeout: 2000 }).catch(() => false)
          ) {
            await likeButton.scrollIntoViewIfNeeded({ timeout: 1000 });
            await page.waitForTimeout(300 + Math.floor(Math.random() * 200));
            await likeButton.click({ timeout: 2000 });

            activeScrollBots[accountId].stats.likes++;
            console.log(
              `❤️ Liked via ${strategy.name}! (Total: ${activeScrollBots[accountId].stats.likes})`
            );
            await page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      console.log("⚠️ Could not find Like button");
      return false;
    } catch (e) {
      console.log("⚠️ Like failed:", e.message);
      return false;
    }
  }

  // Helper function to perform comment action
  async function performComment(videoContainer) {
    try {
      const commentButton = videoContainer
        .locator('[data-e2e="comment-icon"]')
        .first();

      if (await commentButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await commentButton.scrollIntoViewIfNeeded({ timeout: 1000 });
        await page.waitForTimeout(300);
        await commentButton.click({ timeout: 2000 });
        await page.waitForTimeout(2000);

        const commentBox = page.locator('[data-e2e="comment-input"]').first();

        if (await commentBox.isVisible({ timeout: 3000 }).catch(() => false)) {
          const comment = comments[Math.floor(Math.random() * comments.length)];

          await commentBox.click({ timeout: 2000 });
          await page.waitForTimeout(500);
          await commentBox.pressSequentially(comment, { delay: 100 });
          await page.waitForTimeout(1000);

          const postButton = page.locator('[data-e2e="comment-post"]').first();

          if (
            await postButton.isVisible({ timeout: 2000 }).catch(() => false)
          ) {
            await postButton.click({ timeout: 2000 });

            activeScrollBots[accountId].stats.comments++;
            console.log(
              `💬 Commented: "${comment}" (Total: ${activeScrollBots[accountId].stats.comments})`
            );
            await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));

            await page.keyboard.press("Escape");
            await page.waitForTimeout(500);
            return true;
          }
        }
      }

      return false;
    } catch (e) {
      try {
        await page.keyboard.press("Escape");
      } catch {}
      return false;
    }
  }

  // Helper function to perform share action
  async function performShare(videoContainer) {
    try {
      const shareButton = videoContainer
        .locator('[data-e2e="share-icon"]')
        .first();

      if (await shareButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await shareButton.scrollIntoViewIfNeeded({ timeout: 1000 });
        await page.waitForTimeout(300);
        await shareButton.click({ timeout: 2000 });

        activeScrollBots[accountId].stats.shares++;
        console.log(
          `🔗 Shared! (Total: ${activeScrollBots[accountId].stats.shares})`
        );
        await page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));

        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  try {
    // ⭐ STEP 1: Check if logged in, if not, perform login
    console.log("🔍 Checking login status...");

    await page.goto("https://www.tiktok.com/foryou", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const isLoggedIn = await checkIfLoggedIn();

    if (!isLoggedIn) {
      console.log("🔐 Not logged in - attempting to log in...");
      await performLogin();
    } else {
      console.log("✅ Already logged in - proceeding to scroll");
    }

    // ⭐ STEP 2: Navigate to For You page (if not already there)
    console.log("🏠 Ensuring we're on the For You page...");
    const currentUrl = page.url();

    if (!currentUrl.includes("/foryou")) {
      await page.goto("https://www.tiktok.com/foryou", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(5000);
    }

    console.log("✅ Ready to start scrolling!");

    let scrollIteration = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // ⭐ STEP 3: Start infinite scroll loop
    while (!activeScrollBots[accountId]?.shouldStop) {
      scrollIteration++;
      console.log(`\n⬇️ Scroll iteration: ${scrollIteration}`);

      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));

      activeScrollBots[accountId].stats.scrolls = scrollIteration;

      let videoContainers = await page
        .locator('[data-e2e="recommend-list-item-container"]')
        .all();

      if (videoContainers.length === 0) {
        videoContainers = await page
          .locator('div[class*="DivVideoContainer"]')
          .all();
      }

      if (videoContainers.length === 0) {
        videoContainers = await page
          .locator('div[class*="DivItemContainer"]')
          .all();
      }

      if (videoContainers.length === 0) {
        console.log("⚠️ No videos found, continuing...");
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log("❌ Too many errors, stopping");
          break;
        }
        continue;
      }

      consecutiveErrors = 0;
      const videoContainer = videoContainers[0];

      try {
        await videoContainer.scrollIntoViewIfNeeded({ timeout: 3000 });
        await page.waitForTimeout(1500);

        if (activeScrollBots[accountId]?.shouldStop) break;

        activeScrollBots[accountId].stats.attempts++;

        const alreadyLiked = await isVideoAlreadyLiked(videoContainer);

        // ❤️ LIKE
        if (Math.random() * 100 < likeChance) {
          if (alreadyLiked) {
            console.log("❤️ Already liked, skipping...");
          } else {
            await performLike(videoContainer);
          }
          await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));
        }

        if (activeScrollBots[accountId]?.shouldStop) break;

        // 🔗 SHARE
        if (Math.random() * 100 < shareChance) {
          await performShare(videoContainer);
          await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));
        }

        if (activeScrollBots[accountId]?.shouldStop) break;

        // 💬 COMMENT
        if (Math.random() * 100 < commentChance) {
          await performComment(videoContainer);
        }
      } catch (err) {
        console.log("⚠️ Interaction error:", err.message);
        consecutiveErrors++;
      }

      // Random pause every 5-8 scrolls
      if (scrollIteration % (5 + Math.floor(Math.random() * 4)) === 0) {
        const pauseDuration = 5000 + Math.floor(Math.random() * 5000);
        console.log(
          `⏸️ Taking a ${Math.floor(pauseDuration / 1000)}s break...`
        );
        await page.waitForTimeout(pauseDuration);
      }

      if (activeScrollBots[accountId]?.shouldStop) {
        console.log("🛑 Stop signal received");
        break;
      }
    }

    const finalStats = activeScrollBots[accountId].stats;
    const duration = Math.floor((Date.now() - finalStats.startTime) / 1000);

    console.log("\n✅ TikTok scroll bot stopped");
    console.log(
      `📊 Stats: Scrolls: ${finalStats.scrolls} | Likes: ${finalStats.likes} | Comments: ${finalStats.comments} | Shares: ${finalStats.shares}`
    );
    console.log(`⏱️ Duration: ${duration}s`);

    delete activeScrollBots[accountId];

    return {
      success: true,
      message: "TikTok scrolling stopped",
      stats: { ...finalStats, duration: `${duration}s` },
    };
  } catch (error) {
    console.error("❌ TikTok bot error:", error.message);

    if (activeScrollBots[accountId]) {
      activeScrollBots[accountId].stats.errors.push(error.message);
    }

    delete activeScrollBots[accountId];

    return {
      success: false,
      message: error.message,
    };
  }
}
//auth token
// function extractAuthToken(cookies, platform) {
//   const tokenMap = {
//     instagram: "sessionid",
//     facebook: "c_user",
//     twitter: "auth_token",
//     linkedin: "li_at",
//     youtube: "SAPISID",
//     tiktok: ['sessionid', 'tt_webid', 'tt_webid_v2', 'sid_tt'],
//   };

//   const tokenName = tokenMap[platform];
//   const cookie = cookies.find((c) => c.name === tokenName);
//   return cookie ? cookie.value : null;
// }
async function youtubeScrollBot(page, accountId, options = {}) {
  console.log("🔴 YouTube Shorts UNLIMITED scroll bot started...");

  const {
    likeChance = 35,
    commentChance = 10,
    comments = [
      "Amazing! 🔥",
      "Love this! ❤️",
      "Great content! 👍",
      "So good! ✨",
      "Wow! 😍",
      "Perfect! 💯",
      "This is awesome! 🚀",
      "Keep it up! 💪",
    ],
  } = options;

  // Initialize bot state
  activeScrollBots[accountId] = {
    shouldStop: false,
    platform: "youtube",
    stats: {
      scrolls: 0,
      likes: 0,
      comments: 0,
      attempts: 0,
      errors: [],
      startTime: Date.now(),
    },
  };

  // Helper function to check if video is already liked
  async function isVideoAlreadyLiked() {
    try {
      return await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));

        for (const btn of buttons) {
          const ariaLabel = btn.getAttribute("aria-label") || "";
          const isPressed = btn.getAttribute("aria-pressed") === "true";

          if (
            ariaLabel.toLowerCase().includes("like this video") &&
            isPressed
          ) {
            return true;
          }
        }

        return false;
      });
    } catch (e) {
      return false;
    }
  }

  // Helper function to perform like
  async function performLike() {
    try {
      const liked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));

        for (const btn of buttons) {
          const ariaLabel = btn.getAttribute("aria-label") || "";
          const isPressed = btn.getAttribute("aria-pressed") === "true";

          // Find like button and check if not already liked
          if (
            ariaLabel.toLowerCase().includes("like this video") &&
            !isPressed
          ) {
            btn.click();
            console.log("✅ Like button clicked");
            return true;
          }
        }

        return false;
      });

      if (liked) {
        activeScrollBots[accountId].stats.likes++;
        console.log(
          `❤️ Liked! (Total: ${activeScrollBots[accountId].stats.likes})`
        );
        await page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));
        return true;
      }

      return false;
    } catch (e) {
      console.log("⚠️ Like failed:", e.message);
      return false;
    }
  }

  // Helper function to perform comment
  async function performComment() {
    try {
      // Click comment button to open comment section
      const commentOpened = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));

        for (const btn of buttons) {
          const ariaLabel = btn.getAttribute("aria-label") || "";

          if (ariaLabel.toLowerCase().includes("comment")) {
            btn.click();
            console.log("✅ Comment button clicked");
            return true;
          }
        }

        return false;
      });

      if (!commentOpened) {
        console.log("⚠️ Comment button not found");
        return false;
      }

      await page.waitForTimeout(2000);

      // Find comment box
      const commentBoxFound = await page.evaluate(() => {
        const boxes = Array.from(
          document.querySelectorAll(
            'div[contenteditable="true"], div[contenteditable="plaintext-only"]'
          )
        );

        for (const box of boxes) {
          const rect = box.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            box.setAttribute("data-yt-comment-temp", "true");
            box.scrollIntoView({ behavior: "smooth", block: "center" });
            return true;
          }
        }

        return false;
      });

      if (!commentBoxFound) {
        console.log("⚠️ Comment box not found");
        return false;
      }

      await page.waitForTimeout(1000);

      // Type comment
      const comment = comments[Math.floor(Math.random() * comments.length)];

      await page.evaluate(() => {
        const box = document.querySelector('[data-yt-comment-temp="true"]');
        if (box) {
          box.click();
          box.focus();
        }
      });

      await page.waitForTimeout(500);

      const commentBox = page.locator('[data-yt-comment-temp="true"]').first();
      await commentBox.click();
      await page.waitForTimeout(300);
      await commentBox.type(comment, { delay: 50 });

      await page.waitForTimeout(1500);

      // Click Comment submit button
      const submitted = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));

        for (const btn of buttons) {
          const text = btn.textContent?.trim() || "";

          if (text === "Comment") {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              btn.click();
              console.log("✅ Comment submitted");
              return true;
            }
          }
        }

        return false;
      });

      if (submitted) {
        activeScrollBots[accountId].stats.comments++;
        console.log(
          `💬 Commented: "${comment}" (Total: ${activeScrollBots[accountId].stats.comments})`
        );
        await page.waitForTimeout(2000);

        // Close comment panel
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        return true;
      }

      return false;
    } catch (e) {
      console.log("⚠️ Comment failed:", e.message);
      try {
        await page.keyboard.press("Escape");
      } catch {}
      return false;
    }
  }

  try {
    // Navigate to YouTube Shorts
    console.log("🏠 Navigating to YouTube Shorts...");
    await page.goto("https://www.youtube.com/shorts", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await page.waitForTimeout(5000);
    console.log("✅ Ready to start scrolling!");

    let scrollIteration = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // Start infinite scroll loop
    while (!activeScrollBots[accountId]?.shouldStop) {
      scrollIteration++;
      console.log(`\n⬇️ Scroll iteration: ${scrollIteration}`);

      // Scroll to next short (Arrow Down or swipe)
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));

      activeScrollBots[accountId].stats.scrolls = scrollIteration;

      if (activeScrollBots[accountId]?.shouldStop) break;

      try {
        activeScrollBots[accountId].stats.attempts++;

        // Check if already liked
        const alreadyLiked = await isVideoAlreadyLiked();

        // ❤️ LIKE
        if (Math.random() * 100 < likeChance) {
          if (alreadyLiked) {
            console.log("❤️ Already liked, skipping...");
          } else {
            await performLike();
          }
          await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));
        }

        if (activeScrollBots[accountId]?.shouldStop) break;

        // 💬 COMMENT
        if (Math.random() * 100 < commentChance) {
          await performComment();
        }

        consecutiveErrors = 0;
      } catch (err) {
        console.log("⚠️ Interaction error:", err.message);
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log("❌ Too many errors, stopping");
          break;
        }
      }

      // Random pause every 5-8 scrolls
      if (scrollIteration % (5 + Math.floor(Math.random() * 4)) === 0) {
        const pauseDuration = 5000 + Math.floor(Math.random() * 5000);
        console.log(
          `⏸️ Taking a ${Math.floor(pauseDuration / 1000)}s break...`
        );
        await page.waitForTimeout(pauseDuration);
      }

      if (activeScrollBots[accountId]?.shouldStop) {
        console.log("🛑 Stop signal received");
        break;
      }
    }

    const finalStats = activeScrollBots[accountId].stats;
    const duration = Math.floor((Date.now() - finalStats.startTime) / 1000);

    console.log("\n✅ YouTube Shorts scroll bot stopped");
    console.log(
      `📊 Stats: Scrolls: ${finalStats.scrolls} | Likes: ${finalStats.likes} | Comments: ${finalStats.comments}`
    );
    console.log(`⏱️ Duration: ${duration}s`);

    delete activeScrollBots[accountId];

    return {
      success: true,
      message: "YouTube Shorts scrolling stopped",
      stats: { ...finalStats, duration: `${duration}s` },
    };
  } catch (error) {
    console.error("❌ YouTube bot error:", error.message);

    if (activeScrollBots[accountId]) {
      activeScrollBots[accountId].stats.errors.push(error.message);
    }

    delete activeScrollBots[accountId];

    return {
      success: false,
      message: error.message,
    };
  }
}
function extractAuthToken(cookies, platform) {
  if (!cookies || cookies.length === 0) return null;

  const tokenMap = {
    instagram: ["sessionid", "csrftoken"],
    facebook: ["c_user", "xs"],
    twitter: ["auth_token", "ct0"],
    tiktok: ["sessionid", "tt_webid", "tt_webid_v2", "sid_tt"], // TikTok tokens
    linkedin: ["li_at", "JSESSIONID"],
    youtube: ["SAPISID", "SSID"],
  };

  const tokens = tokenMap[platform] || [];

  for (const cookie of cookies) {
    if (tokens.includes(cookie.name)) {
      return cookie.value;
    }
  }

  return null;
}
app.listen(PORT, () => {
  console.log(`🚀 Node API running http://localhost:${PORT}`);
});
