import * as mupdf from "mupdf";
import type { PdfPageNode, SourceFile, SupportedFileMimeType } from "./types";

const PDF_MIME_TYPE = "application/pdf";
const JPEG_MIME_TYPE = "image/jpeg";
const PNG_MIME_TYPE = "image/png";

export const FILE_INPUT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

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

function appendImageSource(
  finalPdf: mupdf.PDFDocument,
  sourceFile: SourceFile,
): void {
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
