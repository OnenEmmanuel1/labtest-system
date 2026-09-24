const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir);
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const capture = async (filename) => {
    await new Promise(r => setTimeout(r, 2000)); // wait longer for render
    const filePath = path.join(screenshotsDir, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`Saved ${filename}`);
  };

  try {
    // TECHNICIAN PAGES
    await page.goto('http://localhost:3001/auth/login', { waitUntil: 'domcontentloaded' });
    await page.type('input[name="email"]', 'tech1@labtm.com');
    await page.type('input[name="password"]', 'password123');
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('button[type="submit"]')
    ]);
    
    // ALERT CONFIRMATION SCREEN
    await page.goto('http://localhost:3001/technician/verify', { waitUntil: 'domcontentloaded' });
    await capture('08-alert-confirmation-screen.png');

    console.log('Capture complete!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await browser.close();
  }
}

run();
