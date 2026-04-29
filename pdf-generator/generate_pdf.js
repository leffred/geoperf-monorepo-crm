#!/usr/bin/env node
/**
 * GEOPERF — Conversion HTML → PDF via Puppeteer
 *
 * Prérequis :
 *   npm install puppeteer
 *
 * Usage :
 *   node generate_pdf.js <input.html> <output.pdf>
 *
 * Le HTML doit être complet (DOCTYPE, head, body, CSS embedded ou via fonts.googleapis.com).
 * Format A4 portrait, marges gérées par CSS @page.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage: node generate_pdf.js <input.html> <output.pdf>');
    process.exit(1);
  }

  const absInput = path.resolve(inputPath);
  const absOutput = path.resolve(outputPath);

  if (!fs.existsSync(absInput)) {
    console.error(`[ERROR] Input file not found: ${absInput}`);
    process.exit(1);
  }

  console.log(`[INFO] Launching headless browser...`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // file:// URL for local fonts/assets to work
    const fileUrl = `file://${absInput}`;
    console.log(`[INFO] Loading ${fileUrl}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // Wait for fonts to actually render
    await page.evaluateHandle('document.fonts.ready');

    console.log(`[INFO] Generating PDF → ${absOutput}`);
    await page.pdf({
      path: absOutput,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }, // CSS @page handles margins
    });

    const stats = fs.statSync(absOutput);
    console.log(`[OK] PDF generated: ${absOutput} (${(stats.size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`[ERROR] PDF generation failed:`, err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
