import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CertificateView } from "./certificates.js";

// US Letter, landscape (matches the @page size of the printable HTML diploma).
const PAGE_W = 792;
const PAGE_H = 612;
// CSS px -> PDF pt (96px/in vs 72pt/in), so the HTML font sizes map 1:1 in print.
const PX_TO_PT = 0.75;
const MM_TO_PT = 2.834645669;

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../assets");

export const DEFAULT_CERTIFICATE_BACKGROUND_PATH = resolve(ASSETS_DIR, "diploma-fondo-v4.jpg");
const SCRIPT_FONT_PATH = resolve(ASSETS_DIR, "fonts/GreatVibes-Regular.ttf");

// Read-once caches: the diploma assets never change at runtime.
let fontBytesCache: Uint8Array | null = null;
let backgroundCache = new Map<string, Uint8Array>();

const TITLE_COLOR = rgb(0.545, 0.102, 0.102); // #8B1A1A
const NAME_COLOR = rgb(0.239, 0.122, 0.059); // #3d1f0f
const META_COLOR = rgb(0.239, 0.122, 0.059);
const LEGEND_COLOR = rgb(0, 0, 0);

export type CertificatePdfOptions = {
  backgroundPath?: string | undefined;
};

export async function renderCertificatePdf(
  view: CertificateView,
  options: CertificatePdfOptions = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const backgroundPath = options.backgroundPath ?? DEFAULT_CERTIFICATE_BACKGROUND_PATH;
  const backgroundBytes = await loadBackground(backgroundPath);
  if (backgroundBytes) {
    const image = await doc.embedJpg(backgroundBytes);
    // Replicate CSS background-size:cover (scale to fill, center, crop overflow).
    const scale = Math.max(PAGE_W / image.width, PAGE_H / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (PAGE_W - width) / 2,
      y: (PAGE_H - height) / 2,
      width,
      height
    });
  }

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontBytes = (fontBytesCache ??= await readFile(SCRIPT_FONT_PATH));
  const scriptFont = await doc.embedFont(fontBytes, { subset: true });

  drawCenteredLine(
    page,
    helveticaBold,
    winAnsi(`DIPLOMADO EN ${view.courseTitle.toUpperCase()}`),
    fitFontSize(helveticaBold, winAnsi(`DIPLOMADO EN ${view.courseTitle.toUpperCase()}`), 18 * PX_TO_PT, PAGE_W * 0.86),
    0.26 * PAGE_H,
    TITLE_COLOR
  );

  drawCenteredLine(
    page,
    scriptFont,
    view.studentName,
    fitFontSize(scriptFont, view.studentName, 48 * PX_TO_PT, PAGE_W * 0.86),
    0.34 * PAGE_H,
    NAME_COLOR
  );

  const legend = `Por haber completado satisfactoriamente el programa de capacitación especializada en ${view.courseTitle}, demostrando las competencias y conocimientos necesarios para implementar estrategias efectivas de administración del personal en el sector de seguridad privada.`;
  drawCenteredParagraph(page, helvetica, winAnsi(legend), 14 * PX_TO_PT, PAGE_W * 0.8, 0.48 * PAGE_H, 1.5, LEGEND_COLOR);

  const meta = `Folio: ${view.folio} · Verificación: ${view.verificationCode} · Emitido: ${formatDate(view.issuedAt)}`;
  drawCenteredAtBottom(page, helvetica, winAnsi(meta), 10 * PX_TO_PT, 18 * MM_TO_PT, META_COLOR);

  return doc.save();
}

async function loadBackground(path: string): Promise<Uint8Array | null> {
  const cached = backgroundCache.get(path);
  if (cached) {
    return cached;
  }
  try {
    const bytes = await readFile(path);
    backgroundCache.set(path, bytes);
    return bytes;
  } catch {
    return null;
  }
}

function drawCenteredLine(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  centerYFromTop: number,
  color: ReturnType<typeof rgb>
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (PAGE_W - width) / 2,
    y: PAGE_H - centerYFromTop - size * 0.35,
    size,
    font,
    color
  });
}

function drawCenteredAtBottom(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  yFromBottom: number,
  color: ReturnType<typeof rgb>
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_W - width) / 2, y: yFromBottom, size, font, color });
}

function drawCenteredParagraph(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
  centerYFromTop: number,
  lineHeightFactor: number,
  color: ReturnType<typeof rgb>
) {
  const lines = wrapText(font, text, size, maxWidth);
  const lineHeight = size * lineHeightFactor;
  const totalHeight = lines.length * lineHeight;
  let topFromTop = centerYFromTop - totalHeight / 2;
  for (const line of lines) {
    const width = font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x: (PAGE_W - width) / 2,
      y: PAGE_H - topFromTop - size,
      size,
      font,
      color
    });
    topFromTop += lineHeight;
  }
}

// Shrink the font size until the text fits maxWidth, so long names/titles
// never overflow the diploma (the HTML used white-space:nowrap and could clip).
function fitFontSize(font: PDFFont, text: string, size: number, maxWidth: number): number {
  let current = size;
  while (current > 8 && font.widthOfTextAtSize(text, current) > maxWidth) {
    current -= 0.5;
  }
  return current;
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

// Standard PDF fonts use WinAnsi; replace a few common characters that fall
// outside it so generation never throws on real-world course/student data.
function winAnsi(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}
