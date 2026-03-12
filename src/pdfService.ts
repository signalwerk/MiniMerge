import * as mupdf from "mupdf";
import type { PdfPageNode, SourceFile, SupportedFileMimeType } from "./types";

const PDF_MIME_TYPE = "application/pdf";
const JPEG_MIME_TYPE = "image/jpeg";
const PNG_MIME_TYPE = "image/png";
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const FILE_INPUT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

type PngColorType = 0 | 2 | 3 | 4 | 6;

interface ParsedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: PngColorType;
  compressionMethod: number;
  filterMethod: number;
  interlaceMethod: number;
  palette: Uint8Array | null;
  transparency: Uint8Array | null;
  idatChunks: Uint8Array[];
  xResolution: number | null;
  yResolution: number | null;
}

function toBrowserUint8Array(
  data: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  return copy;
}

function getFileExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1) {
    return "";
  }

  return name.slice(dotIndex).toLowerCase();
}

export function getSupportedMimeType(
  file: Pick<File, "name" | "type">,
): SupportedFileMimeType | null {
  const normalizedType = file.type.toLowerCase();

  if (normalizedType === PDF_MIME_TYPE) {
    return PDF_MIME_TYPE;
  }

  if (normalizedType === PNG_MIME_TYPE) {
    return PNG_MIME_TYPE;
  }

  if (normalizedType === JPEG_MIME_TYPE || normalizedType === "image/jpg") {
    return JPEG_MIME_TYPE;
  }

  switch (getFileExtension(file.name)) {
    case ".pdf":
      return PDF_MIME_TYPE;
    case ".png":
      return PNG_MIME_TYPE;
    case ".jpg":
    case ".jpeg":
      return JPEG_MIME_TYPE;
    default:
      return null;
  }
}

export function isSupportedInputFile(
  file: Pick<File, "name" | "type">,
): boolean {
  return getSupportedMimeType(file) !== null;
}

function createBlobUrl(
  buffer: Uint8Array,
  mimeType: SupportedFileMimeType,
): string {
  return URL.createObjectURL(
    new Blob([toBrowserUint8Array(buffer)], { type: mimeType }),
  );
}

function formatPdfNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(4).replace(/\.?0+$/, "");
}

function normalizeResolution(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function pixelsToPoints(pixels: number, resolution: number | null): number {
  if (!resolution) {
    return pixels;
  }

  return (pixels / resolution) * 72;
}

function buildImagePageContents(pageWidth: number, pageHeight: number): string {
  return `q\n${formatPdfNumber(pageWidth)} 0 0 ${formatPdfNumber(pageHeight)} 0 0 cm\n/Im0 Do\nQ`;
}

function appendImagePage(
  finalPdf: mupdf.PDFDocument,
  imageRef: mupdf.PDFObject,
  width: number,
  height: number,
  xResolution: number | null,
  yResolution: number | null,
): void {
  const pageWidth = pixelsToPoints(width, xResolution);
  const pageHeight = pixelsToPoints(height, yResolution);
  const resources = {
    XObject: {
      Im0: imageRef,
    },
  };
  const page = finalPdf.addPage(
    [0, 0, pageWidth, pageHeight],
    0,
    resources,
    buildImagePageContents(pageWidth, pageHeight),
  );

  finalPdf.insertPage(-1, page);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function concatenateChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let writeOffset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return merged;
}

function parsePng(buffer: Uint8Array): ParsedPng | null {
  if (buffer.length < PNG_SIGNATURE.length + 12) {
    return null;
  }

  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType: PngColorType | null = null;
  let compressionMethod = 0;
  let filterMethod = 0;
  let interlaceMethod = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];
  let xResolution: number | null = null;
  let yResolution: number | null = null;

  while (offset + 12 <= buffer.length) {
    const chunkLength = readUint32(buffer, offset);
    offset += 4;

    if (offset + 4 + chunkLength + 4 > buffer.length) {
      return null;
    }

    const chunkType = String.fromCharCode(
      buffer[offset],
      buffer[offset + 1],
      buffer[offset + 2],
      buffer[offset + 3],
    );
    offset += 4;

    const chunkData = buffer.slice(offset, offset + chunkLength);
    offset += chunkLength + 4;

    switch (chunkType) {
      case "IHDR":
        if (chunkData.length !== 13) {
          return null;
        }

        width = readUint32(chunkData, 0);
        height = readUint32(chunkData, 4);
        bitDepth = chunkData[8];
        colorType = chunkData[9] as PngColorType;
        compressionMethod = chunkData[10];
        filterMethod = chunkData[11];
        interlaceMethod = chunkData[12];
        break;
      case "PLTE":
        palette = chunkData;
        break;
      case "tRNS":
        transparency = chunkData;
        break;
      case "pHYs":
        if (chunkData.length === 9 && chunkData[8] === 1) {
          xResolution = readUint32(chunkData, 0) * 0.0254;
          yResolution = readUint32(chunkData, 4) * 0.0254;
        }
        break;
      case "IDAT":
        idatChunks.push(chunkData);
        break;
      case "IEND":
        offset = buffer.length;
        break;
      default:
        break;
    }
  }

  if (
    !width ||
    !height ||
    !bitDepth ||
    colorType === null ||
    idatChunks.length === 0
  ) {
    return null;
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    compressionMethod,
    filterMethod,
    interlaceMethod,
    palette,
    transparency,
    idatChunks,
    xResolution,
    yResolution,
  };
}

function buildPngTransparencyMask(parsedPng: ParsedPng): number[] | null {
  if (!parsedPng.transparency) {
    return null;
  }

  if (parsedPng.colorType === 0 && parsedPng.transparency.length === 2) {
    const sample = readUint16(parsedPng.transparency, 0);
    return [sample, sample];
  }

  if (parsedPng.colorType === 2 && parsedPng.transparency.length === 6) {
    const red = readUint16(parsedPng.transparency, 0);
    const green = readUint16(parsedPng.transparency, 2);
    const blue = readUint16(parsedPng.transparency, 4);
    return [red, red, green, green, blue, blue];
  }

  return null;
}

function tryAddDirectPngImage(
  finalPdf: mupdf.PDFDocument,
  buffer: Uint8Array,
): {
  imageRef: mupdf.PDFObject;
  width: number;
  height: number;
  xResolution: number | null;
  yResolution: number | null;
} | null {
  const parsedPng = parsePng(buffer);

  if (!parsedPng) {
    return null;
  }

  if (
    parsedPng.compressionMethod !== 0 ||
    parsedPng.filterMethod !== 0 ||
    parsedPng.interlaceMethod !== 0
  ) {
    return null;
  }

  let colorSpace: mupdf.PDFObject | string | unknown[];
  let predictorColors: number;

  switch (parsedPng.colorType) {
    case 0:
      colorSpace = "DeviceGray";
      predictorColors = 1;
      break;
    case 2:
      colorSpace = "DeviceRGB";
      predictorColors = 3;
      break;
    case 3:
      if (
        !parsedPng.palette ||
        parsedPng.palette.length === 0 ||
        parsedPng.palette.length % 3 !== 0
      ) {
        return null;
      }

      if (parsedPng.transparency) {
        return null;
      }

      colorSpace = [
        "Indexed",
        "DeviceRGB",
        parsedPng.palette.length / 3 - 1,
        finalPdf.newByteString(parsedPng.palette),
      ];
      predictorColors = 1;
      break;
    case 4:
    case 6:
      return null;
    default:
      return null;
  }

  const imageDictionary: Record<string, unknown> = {
    Type: "XObject",
    Subtype: "Image",
    Width: parsedPng.width,
    Height: parsedPng.height,
    BitsPerComponent: parsedPng.bitDepth,
    ColorSpace: colorSpace,
    Filter: "FlateDecode",
    DecodeParms: {
      Predictor: 15,
      Colors: predictorColors,
      BitsPerComponent: parsedPng.bitDepth,
      Columns: parsedPng.width,
    },
  };

  const transparencyMask = buildPngTransparencyMask(parsedPng);
  if (transparencyMask) {
    imageDictionary.Mask = transparencyMask;
  }

  return {
    imageRef: finalPdf.addRawStream(
      concatenateChunks(parsedPng.idatChunks),
      imageDictionary,
    ),
    width: parsedPng.width,
    height: parsedPng.height,
    xResolution: parsedPng.xResolution,
    yResolution: parsedPng.yResolution,
  };
}

function appendImageSource(
  finalPdf: mupdf.PDFDocument,
  sourceFile: SourceFile,
): void {
  if (sourceFile.mimeType === PNG_MIME_TYPE) {
    const directPngImage = tryAddDirectPngImage(finalPdf, sourceFile.buffer);

    if (directPngImage) {
      appendImagePage(
        finalPdf,
        directPngImage.imageRef,
        directPngImage.width,
        directPngImage.height,
        directPngImage.xResolution,
        directPngImage.yResolution,
      );
      return;
    }
  }

  // MuPDF keeps JPEG DCT streams intact when embedding. For PNGs we fall back
  // here when PDF-compatible passthrough is not possible, such as alpha PNGs.
  const image = new mupdf.Image(sourceFile.buffer);
  try {
    const imageRef = finalPdf.addImage(image);
    appendImagePage(
      finalPdf,
      imageRef,
      image.getWidth(),
      image.getHeight(),
      normalizeResolution(image.getXResolution()),
      normalizeResolution(image.getYResolution()),
    );
  } finally {
    image.destroy();
  }
}

function parsePdfDocument(buffer: Uint8Array, fileId: string): PdfPageNode[] {
  const doc = mupdf.Document.openDocument(buffer, PDF_MIME_TYPE);
  try {
    const pages: PdfPageNode[] = [];
    const numPages = doc.countPages();
    const scale = 0.5;
    const matrix = mupdf.Matrix.scale(scale, scale);
    const colorSpace = mupdf.ColorSpace.DeviceRGB;

    for (let i = 0; i < numPages; i += 1) {
      const page = doc.loadPage(i);
      try {
        const bounds = page.getBounds();
        const width = bounds[2] - bounds[0];
        const height = bounds[3] - bounds[1];
        const pixmap = page.toPixmap(matrix, colorSpace, false);

        try {
          const pngData = toBrowserUint8Array(pixmap.asPNG());
          const thumbnailUrl = createBlobUrl(pngData, PNG_MIME_TYPE);

          let label = "";
          try {
            label = page.getLabel();
          } catch {
            label = "";
          }

          pages.push({
            id: `${fileId}-p${i}`,
            fileId,
            pageIndex: i,
            thumbnailUrl,
            width,
            height,
            label,
          });
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }

    return pages;
  } finally {
    doc.destroy();
  }
}

function parseImageDocument(
  buffer: Uint8Array,
  mimeType: SupportedFileMimeType,
  fileId: string,
): PdfPageNode[] {
  const image = new mupdf.Image(buffer);

  try {
    return [
      {
        id: `${fileId}-p0`,
        fileId,
        pageIndex: 0,
        thumbnailUrl: createBlobUrl(buffer, mimeType),
        width: image.getWidth(),
        height: image.getHeight(),
        label: "1",
      },
    ];
  } finally {
    image.destroy();
  }
}

export async function parseInputFile(
  file: File,
  fileId: string,
): Promise<{ sourceFile: SourceFile; pages: PdfPageNode[] }> {
  const mimeType = getSupportedMimeType(file);

  if (!mimeType) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);
  const pages =
    mimeType === PDF_MIME_TYPE
      ? parsePdfDocument(buffer, fileId)
      : parseImageDocument(buffer, mimeType, fileId);

  const sourceFile: SourceFile = {
    id: fileId,
    name: file.name,
    buffer,
    mimeType,
  };

  return { sourceFile, pages };
}

export async function generateMergedPdf(
  pages: PdfPageNode[],
  sourceFiles: Record<string, SourceFile>,
): Promise<Uint8Array<ArrayBuffer>> {
  const openedDocs: Record<string, mupdf.Document> = {};

  try {
    const finalPdf = new mupdf.PDFDocument();

    for (const pageNode of pages) {
      const sourceFile = sourceFiles[pageNode.fileId];
      if (!sourceFile) {
        continue;
      }

      if (sourceFile.mimeType === PDF_MIME_TYPE) {
        if (!openedDocs[pageNode.fileId]) {
          openedDocs[pageNode.fileId] = mupdf.Document.openDocument(
            sourceFile.buffer,
            PDF_MIME_TYPE,
          );
        }

        const sourcePdf = openedDocs[pageNode.fileId].asPDF();
        if (sourcePdf) {
          finalPdf.graftPage(-1, sourcePdf, pageNode.pageIndex);
        }
        continue;
      }

      appendImageSource(finalPdf, sourceFile);
    }

    const outBuffer = finalPdf.saveToBuffer("");
    return toBrowserUint8Array(outBuffer.asUint8Array());
  } finally {
    for (const doc of Object.values(openedDocs)) {
      doc.destroy();
    }
  }
}
