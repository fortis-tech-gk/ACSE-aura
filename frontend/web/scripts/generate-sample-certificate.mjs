// Renders a sample Certificate of Participation to PDF + PNG using headless Chrome.
//   node scripts/generate-sample-certificate.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join(root, '..', '..', 'docs', 'sample-certificate'));
mkdirSync(outDir, { recursive: true });

// Load the TS template without a build step
const tmp = path.join(os.tmpdir(), `cert-template-${process.pid}.mjs`);
const src = readFileSync(path.join(root, 'src/lib/certificate-template.ts'), 'utf8');
writeFileSync(tmp, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { certificateHtml } = await import(pathToFileURL(tmp).href);

// Same embedded fonts + logos the phone app uses, so this sample is what a student downloads
const assetsSrc = readFileSync(path.join(root, '..', 'mobile', 'src/lib/certificate-assets.ts'), 'utf8');
const tmpAssets = path.join(os.tmpdir(), `cert-assets-${process.pid}.mjs`);
writeFileSync(tmpAssets, ts.transpileModule(assetsSrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { CERT_FONT_CSS, CERT_VTU_LOGO, CERT_ACS_LOGO } = await import(pathToFileURL(tmpAssets).href);

const html = certificateHtml(
  {
    athleteName: 'Ananya R. Shetty',
    usn: '1AC22CS014',
    collegeName: 'Dr. Ambedkar Institute of Technology, Bengaluru',
    certificateNo: 'AURA26-0412',
    events: ['100m', '4x100m Relay'],
  },
  { vtuLogo: CERT_VTU_LOGO, hostLogo: CERT_ACS_LOGO, fontCss: CERT_FONT_CSS },
);
const htmlPath = path.join(outDir, 'certificate.html');
writeFileSync(htmlPath, html);

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find((c) => { try { execFileSync('which', [c]); return true; } catch { return false; } });
const common = ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=8000', '--hide-scrollbars'];
const url = pathToFileURL(htmlPath).href;
execFileSync(chrome, [...common, '--no-pdf-header-footer', `--print-to-pdf=${path.join(outDir, 'certificate.pdf')}`, url], { stdio: 'inherit' });
execFileSync(chrome, [...common, '--window-size=1123,794', '--force-device-scale-factor=2', `--screenshot=${path.join(outDir, 'certificate.png')}`, url], { stdio: 'inherit' });
console.log('written to', outDir);
