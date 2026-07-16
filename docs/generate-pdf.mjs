/**
 * Converts RouteSync-Sales-Deck.md → RouteSync-Sales-Deck.html → RouteSync-Sales-Deck.pdf
 * Uses Node.js built-ins only (no npm packages needed).
 * PDF is generated via Chrome / Edge headless --print-to-pdf.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const mdPath  = resolve(__dir, 'RouteSync-Sales-Deck.md');
const htmlPath = resolve(__dir, 'RouteSync-Sales-Deck.html');
const pdfPath  = resolve(__dir, 'RouteSync-Sales-Deck.pdf');

// ── 1. Read markdown ──────────────────────────────────────────────────────────
const md = readFileSync(mdPath, 'utf8');

// ── 2. Minimal markdown → HTML parser (handles the constructs we actually use) ─
function mdToHtml(src) {
  const lines = src.split('\n');
  const out = [];
  let inTable = false;
  let tableHeader = false;
  let inCode = false;
  let inBlockquote = false;
  let inList = false;
  let listLines = [];

  function flushList() {
    if (!listLines.length) return;
    out.push('<ul>');
    listLines.forEach(l => out.push(`<li>${inline(l)}</li>`));
    out.push('</ul>');
    listLines = [];
    inList = false;
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="link">$1</span>');
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // fenced code block
    if (line.startsWith('```')) {
      if (!inCode) { flushList(); out.push('<pre><code>'); inCode = true; }
      else { out.push('</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(escHtml(line)); continue; }

    // table
    if (line.includes('|')) {
      flushList();
      const cells = line.split('|').map(c => c.trim()).filter(c => c !== '');
      if (cells.every(c => /^[-: ]+$/.test(c))) {
        // separator row
        tableHeader = false;
        continue;
      }
      if (!inTable) {
        out.push('<table>');
        inTable = true;
        tableHeader = true;
        out.push('<thead><tr>');
        cells.forEach(c => out.push(`<th>${inline(c)}</th>`));
        out.push('</tr></thead><tbody>');
        tableHeader = false;
      } else {
        out.push('<tr>');
        cells.forEach(c => out.push(`<td>${inline(c)}</td>`));
        out.push('</tr>');
      }
      continue;
    }
    if (inTable) { out.push('</tbody></table>'); inTable = false; }

    // blockquote
    if (line.startsWith('> ')) {
      flushList();
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      continue;
    }

    // headings
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      flushList();
      const level = hm[1].length;
      const text = hm[2].replace(/\s*\{[^}]+\}\s*$/, ''); // strip anchors
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }

    // horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushList();
      out.push('<hr>');
      continue;
    }

    // bullet list
    if (/^[-*]\s/.test(line)) {
      inList = true;
      listLines.push(line.replace(/^[-*]\s/, ''));
      continue;
    }
    if (inList && line.trim() === '') {
      flushList();
      out.push('<p>&nbsp;</p>');
      continue;
    }

    // blank line
    if (line.trim() === '') {
      flushList();
      out.push('');
      continue;
    }

    // paragraph
    if (!inList) {
      flushList();
      out.push(`<p>${inline(line)}</p>`);
    } else {
      listLines.push(line);
    }
  }
  flushList();
  if (inTable) out.push('</tbody></table>');

  return out.join('\n');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── 3. Wrap in full HTML with premium styling ─────────────────────────────────
const body = mdToHtml(md);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RouteSync — Product Overview &amp; Sales Guide</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --blue:    #2563eb;
    --blue-lt: #eff6ff;
    --green:   #16a34a;
    --green-lt:#f0fdf4;
    --text:    #111827;
    --muted:   #6b7280;
    --border:  #e5e7eb;
    --surface: #f9fafb;
    --red:     #dc2626;
  }

  html { font-size: 14px; }

  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--text);
    line-height: 1.7;
    padding: 48px 64px;
    max-width: 920px;
    margin: 0 auto;
    background: #fff;
  }

  /* Cover area */
  body > h1:first-of-type {
    font-size: 2.4rem;
    font-weight: 700;
    color: var(--blue);
    letter-spacing: -0.03em;
    line-height: 1.2;
    margin-bottom: 0.4rem;
    border: none;
    padding: 0;
  }

  /* Headings */
  h1 { font-size: 1.9rem; font-weight: 700; letter-spacing: -0.02em; color: var(--text); margin: 2.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid var(--border); }
  h2 { font-size: 1.4rem; font-weight: 600; color: var(--text); margin: 2rem 0 0.75rem; }
  h3 { font-size: 1.1rem; font-weight: 600; color: var(--blue); margin: 1.5rem 0 0.5rem; }
  h4 { font-size: 1rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin: 1.25rem 0 0.4rem; }

  p { margin: 0.6rem 0; color: var(--text); }
  p:empty { margin: 0.3rem; }

  strong { font-weight: 600; }
  em { font-style: italic; color: var(--muted); }
  code { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.85em; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
  pre { background: #1e293b; color: #e2e8f0; border-radius: 10px; padding: 20px 24px; margin: 1rem 0; overflow-x: auto; font-size: 0.82rem; line-height: 1.6; }
  pre code { background: none; border: none; padding: 0; color: inherit; font-size: inherit; }

  hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

  a, .link { color: var(--blue); text-decoration: none; }

  blockquote {
    border-left: 4px solid var(--blue);
    background: var(--blue-lt);
    padding: 12px 20px;
    border-radius: 0 8px 8px 0;
    margin: 1rem 0;
    font-style: normal;
    color: var(--text);
  }

  blockquote p { margin: 0; }

  ul { padding-left: 1.4rem; margin: 0.5rem 0; }
  ul li { margin: 0.25rem 0; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.25rem 0;
    font-size: 0.875rem;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  thead { background: var(--blue); }
  thead th { color: #fff; font-weight: 600; text-align: left; padding: 10px 14px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  tbody tr:nth-child(even) { background: var(--surface); }
  tbody tr:hover { background: var(--blue-lt); }
  td { padding: 9px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
  td:first-child { font-weight: 500; }

  /* Section number callout */
  h2[id^="1-"], h2[id^="2-"], h2[id^="3-"], h2[id^="4-"],
  h2[id^="5-"], h2[id^="6-"], h2[id^="7-"], h2[id^="8-"],
  h2[id^="9-"], h2[id^="10-"], h2[id^="11-"], h2[id^="12-"] {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* Quick ref table special */
  table:last-of-type td:first-child { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

  /* Page break hints for PDF */
  @media print {
    h1, h2 { page-break-after: avoid; }
    table   { page-break-inside: avoid; }
    pre     { page-break-inside: avoid; }
    hr      { page-break-after: always; border: none; }
  }

  /* Toc */
  h2[id="table-of-contents"] + ul {
    list-style: none;
    padding: 0;
    columns: 2;
    gap: 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 20px;
    margin: 0.5rem 0 2rem;
  }
  h2[id="table-of-contents"] + ul li { margin: 0.25rem 0; }
  h2[id="table-of-contents"] + ul li .link { color: var(--blue); font-weight: 500; }

  /* Cover badge */
  .cover-badge {
    display: inline-block;
    background: var(--blue);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 12px;
    border-radius: 99px;
    margin-bottom: 1.5rem;
  }

  /* footer note */
  body > p:last-child {
    color: var(--muted);
    font-size: 0.8rem;
    text-align: center;
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
</style>
</head>
<body>
${body}
</body>
</html>`;

// ── 4. Write HTML ─────────────────────────────────────────────────────────────
writeFileSync(htmlPath, html, 'utf8');
console.log('✅ HTML written:', htmlPath);

// ── 5. Generate PDF via Chrome headless ──────────────────────────────────────
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const browser = chromePaths.find(p => existsSync(p));
if (!browser) {
  console.error('❌ Chrome/Edge not found. HTML is ready at:', htmlPath);
  process.exit(1);
}

const cmd = `"${browser}" --headless=new --disable-gpu --no-sandbox --print-to-pdf="${pdfPath}" --print-to-pdf-no-header "file:///${htmlPath.replace(/\\/g, '/')}"`;
console.log('📄 Generating PDF with:', browser.split('\\').pop());
try {
  execSync(cmd, { stdio: 'pipe', timeout: 30000 });
  console.log('✅ PDF written:', pdfPath);
} catch (e) {
  console.error('❌ PDF generation failed:', e.message);
  console.log('   HTML is still available at:', htmlPath);
}

// ── Also generate PLATFORM_GUIDE.pdf ─────────────────────────────────────────
const guideMdPath   = resolve(__dir, 'PLATFORM_GUIDE.md');
const guideHtmlPath = resolve(__dir, 'PLATFORM_GUIDE.html');
const guidePdfPath  = resolve(__dir, 'PLATFORM_GUIDE.pdf');

const guideMd   = readFileSync(guideMdPath, 'utf8');
const guideBody = mdToHtml(guideMd);

const guideHtml = html
  .replace('<title>RouteSync — Product Overview &amp; Sales Guide</title>',
           '<title>RouteSync — Complete Platform Guide</title>')
  .replace(guideBody, '') // prevent double-body if somehow reused
  .replace(body, guideBody); // swap the body content

writeFileSync(guideHtmlPath, guideHtml, 'utf8');
console.log('✅ Guide HTML written:', guideHtmlPath);

const guideCmd = `"${browser}" --headless=new --disable-gpu --no-sandbox --print-to-pdf="${guidePdfPath}" --print-to-pdf-no-header "file:///${guideHtmlPath.replace(/\\/g, '/')}"`;
try {
  execSync(guideCmd, { stdio: 'pipe', timeout: 60000 });
  console.log('✅ Guide PDF written:', guidePdfPath);
} catch (e) {
  console.error('❌ Guide PDF failed:', e.message);
}
