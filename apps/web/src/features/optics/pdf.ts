/**
 * Générateur PDF minimal (texte seul), sans dépendance : police Courier
 * (une des 14 polices standard, aucune police embarquée), encodage
 * WinAnsiEncoding, format A4. Assez pour un rapport de bilans aligné en
 * colonnes ; pas d'image ni de mise en page riche.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const FONT_SIZE = 9;
const TITLE_SIZE = 12;
const LEADING = 11;
/** Courier : 0,6 em par caractère. */
export const PDF_LINE_CHARS = Math.floor((PAGE_WIDTH - 2 * MARGIN) / (FONT_SIZE * 0.6));
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING) - 1;

/** Caractères hors de WinAnsi remplacés par un équivalent lisible. */
const REPLACEMENTS: Readonly<Record<string, string>> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "✓": "OK",
  "✕": "X",
  "≠": "<>",
  "⊘": "(x)",
  "▼": "v",
  "▲": "^",
  "◌": "o",
  "⚠": "!",
  "−": "-",
  " ": " ",
  " ": " ",
};

/** Points de code de WinAnsi (CP1252) au-delà du Latin-1 : U+20AC → 0x80, etc. */
const CP1252: Readonly<Record<string, number>> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Octets WinAnsi d'un texte (caractère inconnu : « ? »). */
export function winAnsi(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const replaced = REPLACEMENTS[character];
    if (replaced !== undefined) {
      bytes.push(...winAnsi(replaced));
      continue;
    }
    const code = character.codePointAt(0) ?? 0x3f;
    const mapped = CP1252[character];
    if (mapped !== undefined) bytes.push(mapped);
    else if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else bytes.push(0x3f);
  }
  return bytes;
}

/** Chaîne littérale PDF en ASCII : parenthèses et barre oblique échappées, octets hauts en octal. */
function literal(text: string): string {
  return winAnsi(text)
    .map((byte) => (byte === 0x28 || byte === 0x29 || byte === 0x5c ? `\\${String.fromCharCode(byte)}` : byte >= 0x80 ? `\\${byte.toString(8).padStart(3, "0")}` : String.fromCharCode(byte)))
    .join("");
}

/** Coupe les lignes trop longues aux espaces (ou net si un mot dépasse). */
export function wrapLines(lines: readonly string[], width = PDF_LINE_CHARS): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (line.length <= width) {
      result.push(line);
      continue;
    }
    const indent = /^\s*/.exec(line)?.[0] ?? "";
    let rest = line;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(" ", width);
      const at = cut > indent.length ? cut : width;
      result.push(rest.slice(0, at).trimEnd());
      rest = indent + rest.slice(at).trimStart();
    }
    result.push(rest);
  }
  return result;
}

/**
 * Document PDF : un titre puis des lignes de texte à chasse fixe, réparties
 * sur autant de pages A4 que nécessaire. Renvoie les octets du fichier.
 */
export function textPdf(title: string, lines: readonly string[]): Uint8Array<ArrayBuffer> {
  const body = wrapLines(lines);
  const pages: string[][] = [];
  for (let start = 0; start < Math.max(body.length, 1); start += LINES_PER_PAGE) pages.push(body.slice(start, start + LINES_PER_PAGE));

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(" ")}] /Count ${String(pages.length)} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";
  objects[4] = `<< /Title (${literal(title)}) /Producer (NetForge) >>`;
  pages.forEach((pageLines, index) => {
    const top = PAGE_HEIGHT - MARGIN;
    const heading = index === 0 ? `/F1 ${String(TITLE_SIZE)} Tf (${literal(title)}) Tj T* T* /F1 ${String(FONT_SIZE)} Tf ` : `/F1 ${String(FONT_SIZE)} Tf `;
    const content = `BT ${String(LEADING)} TL ${String(MARGIN)} ${String(top)} Td ${heading}${pageLines.map((line) => `(${literal(line)}) Tj T*`).join(" ")} ET`;
    const pageId = pageIds[index] ?? 0;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(pageId + 1)} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`;
  });

  // Tout le fichier est en ASCII : un caractère = un octet, les décalages se lisent sur la chaîne.
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = output.length;
    output += `${String(id)} 0 obj\n${objects[id] ?? "null"}\nendobj\n`;
  }
  const xref = output.length;
  output += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  const bytes = new Uint8Array(output.length);
  for (let index = 0; index < output.length; index += 1) bytes[index] = output.charCodeAt(index);
  return bytes;
}
