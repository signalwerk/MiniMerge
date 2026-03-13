import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
} from "react";
import {
  Upload,
  Grid as GridIcon,
  List as ListIcon,
  Download,
  Trash2,
  FileText,
} from "lucide-react";
import {
  FILE_INPUT_ACCEPT,
  generateMergedPdf,
  isSupportedInputFile,
  parseInputFile,
} from "./pdfService";
import type { PdfPageNode, SourceFile } from "./types";
import "./App.css";

function clampInsertionIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer
    ? Array.from(dataTransfer.types).includes("Files")
    : false;
}

function getSupportedDraggedFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files).filter(isSupportedInputFile);
}

function moveSelectedPages(
  currentPages: PdfPageNode[],
  selectedPageIds: Set<string>,
  insertionIndex: number,
): PdfPageNode[] {
  const pagesToMove = currentPages.filter((page) => selectedPageIds.has(page.id));
  if (pagesToMove.length === 0) {
    return currentPages;
  }

  const remainingPages = currentPages.filter(
    (page) => !selectedPageIds.has(page.id),
  );
  const selectedPagesBeforeInsertion = currentPages
    .slice(0, insertionIndex)
    .filter((page) => selectedPageIds.has(page.id)).length;
  const adjustedInsertionIndex = clampInsertionIndex(
    insertionIndex - selectedPagesBeforeInsertion,
    remainingPages.length,
  );
  const reorderedPages = [...remainingPages];
  reorderedPages.splice(adjustedInsertionIndex, 0, ...pagesToMove);
  return reorderedPages;
}

export default function App() {
  const [pages, setPages] = useState<PdfPageNode[]>([]);
  const [sourceFiles, setSourceFiles] = useState<Record<string, SourceFile>>(
    {},
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(
    new Set(),
  );
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropInsertionIndex, setDropInsertionIndex] = useState<number | null>(
    null,
  );
  const emptyFileInputRef = useRef<HTMLInputElement>(null);

  const clearSelection = useCallback(() => {
    setSelectedPageIds(new Set());
    setLastSelectedId(null);
  }, []);

  const resetDragState = useCallback(() => {
    setDraggedPageId(null);
    setDropInsertionIndex(null);
    setIsDraggingFile(false);
  }, []);

  const processIncomingFiles = useCallback(
    async (files: File[], insertionIndex?: number | null) => {
      if (files.length === 0) {
        return;
      }

      setIsProcessing(true);
      try {
        const newFiles: Record<string, SourceFile> = {};
        const newPages: PdfPageNode[] = [];

        for (const file of files) {
          const fileId = crypto.randomUUID();
          const result = await parseInputFile(file, fileId);
          newFiles[fileId] = result.sourceFile;
          newPages.push(...result.pages);
        }

        setSourceFiles((prev) => ({ ...prev, ...newFiles }));
        setPages((prev) => {
          const insertAt =
            insertionIndex == null
              ? prev.length
              : clampInsertionIndex(insertionIndex, prev.length);
          const nextPages = [...prev];
          nextPages.splice(insertAt, 0, ...newPages);
          return nextPages;
        });
      } catch (err) {
        console.error("Error processing files:", err);
        alert("Error parsing PDF/image files. Check console for details.");
      } finally {
        setIsProcessing(false);
      }
    },
    [],
  );

  const handleRemoveSelected = useCallback(() => {
    setPages((prev) => prev.filter((page) => !selectedPageIds.has(page.id)));
    clearSelection();
  }, [clearSelection, selectedPageIds]);

  const selectAllPages = useCallback(() => {
    if (pages.length === 0) {
      return;
    }

    setSelectedPageIds(new Set(pages.map((page) => page.id)));
    setLastSelectedId(pages[pages.length - 1]?.id ?? null);
  }, [pages]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        if (pages.length > 0) {
          e.preventDefault();
          selectAllPages();
        }
        return;
      }

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedPageIds.size > 0
      ) {
        handleRemoveSelected();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRemoveSelected, pages.length, selectAllPages, selectedPageIds]);

  const openEmptyFilePicker = useCallback(() => {
    if (!isProcessing) {
      emptyFileInputRef.current?.click();
    }
  }, [isProcessing]);

  const handleEmptyDropzoneKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEmptyFilePicker();
      }
    },
    [openEmptyFilePicker],
  );

  const handleDragOverFile = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (draggedPageId || !isFileDrag(e.dataTransfer)) {
        return;
      }

      e.preventDefault();
      setIsDraggingFile(true);

      const target = e.target as HTMLElement;
      if (!target.closest(".page-card")) {
        setDropInsertionIndex(pages.length);
      }
    },
    [draggedPageId, pages.length],
  );

  const handleDragLeaveFile = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const nextTarget = e.relatedTarget;
      if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
        return;
      }

      if (!draggedPageId) {
        setIsDraggingFile(false);
        setDropInsertionIndex(null);
      }
    },
    [draggedPageId],
  );

  const handleRootDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();

      if (draggedPageId) {
        resetDragState();
        return;
      }

      const files = getSupportedDraggedFiles(e.dataTransfer);
      if (files.length === 0) {
        resetDragState();
        return;
      }

      await processIncomingFiles(files, dropInsertionIndex ?? pages.length);
      resetDragState();
    },
    [
      draggedPageId,
      dropInsertionIndex,
      pages.length,
      processIncomingFiles,
      resetDragState,
    ],
  );

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isSupportedInputFile);
    await processIncomingFiles(files);
    e.target.value = "";
  };

  const handlePageClick = (e: MouseEvent, pageId: string) => {
    e.preventDefault();
    const nextSelectedIds = new Set(selectedPageIds);

    if (e.shiftKey && lastSelectedId) {
      const lastIndex = pages.findIndex((page) => page.id === lastSelectedId);
      const currentIndex = pages.findIndex((page) => page.id === pageId);

      if (lastIndex === -1 || currentIndex === -1) {
        return;
      }

      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);

      if (!e.metaKey && !e.ctrlKey) {
        nextSelectedIds.clear();
      }

      for (let i = start; i <= end; i += 1) {
        nextSelectedIds.add(pages[i].id);
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (nextSelectedIds.has(pageId)) {
        nextSelectedIds.delete(pageId);
      } else {
        nextSelectedIds.add(pageId);
      }
      setLastSelectedId(pageId);
    } else {
      nextSelectedIds.clear();
      nextSelectedIds.add(pageId);
      setLastSelectedId(pageId);
    }

    setSelectedPageIds(nextSelectedIds);
  };

  const handleContentMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) {
        return;
      }

      const target = e.target as HTMLElement;
      if (target.closest(".page-card") || target.closest(".app__fab")) {
        return;
      }

      clearSelection();
    },
    [clearSelection],
  );

  const handleDownload = async () => {
    if (pages.length === 0) return;

    setIsProcessing(true);
    try {
      const mergedPdfUint8Array = await generateMergedPdf(pages, sourceFiles);
      const blob = new Blob([mergedPdfUint8Array], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "merged.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error merging PDF:", err);
      alert("Error generating merged PDF.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePageDragStart = (
    e: DragEvent<HTMLDivElement>,
    pageId: string,
  ) => {
    setDraggedPageId(pageId);
    if (!selectedPageIds.has(pageId)) {
      setSelectedPageIds(new Set([pageId]));
      setLastSelectedId(pageId);
    }
    e.dataTransfer.effectAllowed = "move";
  };

  const handlePageDragOver = (
    e: DragEvent<HTMLDivElement>,
    pageIndex: number,
  ) => {
    const hasPageDrag = draggedPageId !== null;
    const hasFileDrag = !hasPageDrag && isFileDrag(e.dataTransfer);
    if (!hasPageDrag && !hasFileDrag) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (hasFileDrag) {
      setIsDraggingFile(true);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const insertBefore =
      viewMode === "list"
        ? e.clientY < rect.top + rect.height / 2
        : e.clientX < rect.left + rect.width / 2;

    setDropInsertionIndex(insertBefore ? pageIndex : pageIndex + 1);
  };

  const handlePageDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (draggedPageId) {
        if (dropInsertionIndex !== null) {
          setPages((prev) =>
            moveSelectedPages(prev, selectedPageIds, dropInsertionIndex),
          );
        }
        resetDragState();
        return;
      }

      const files = getSupportedDraggedFiles(e.dataTransfer);
      if (files.length === 0) {
        resetDragState();
        return;
      }

      await processIncomingFiles(files, dropInsertionIndex ?? pages.length);
      resetDragState();
    },
    [
      draggedPageId,
      dropInsertionIndex,
      pages.length,
      processIncomingFiles,
      resetDragState,
      selectedPageIds,
    ],
  );

  const pageCollectionClassName = `app__pages app__pages--${viewMode}`;

  return (
    <div
      className="app"
      onDragOver={handleDragOverFile}
      onDragLeave={handleDragLeaveFile}
      onDrop={handleRootDrop}
    >
      <header className="app__header">
        <h1 className="app__brand">
          <FileText className="app__brand-icon" />
          MiniMerge
        </h1>
        <div className="app__toolbar">
          <div className="app__view-toggle">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`app__view-button ${viewMode === "grid" ? "app__view-button--active" : ""}`}
              title="Grid View"
              aria-pressed={viewMode === "grid"}
            >
              <GridIcon className="app__view-icon" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`app__view-button ${viewMode === "list" ? "app__view-button--active" : ""}`}
              title="List View"
              aria-pressed={viewMode === "list"}
            >
              <ListIcon className="app__view-icon" />
            </button>
          </div>
          <div className="app__divider" />
          <button
            type="button"
            onClick={handleRemoveSelected}
            disabled={selectedPageIds.size === 0}
            className="app__action app__action--remove"
          >
            <Trash2 className="app__action-icon" />
            Remove
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={pages.length === 0 || isProcessing}
            className="app__action app__action--primary"
          >
            <Download className="app__action-icon" />
            {isProcessing ? "Processing..." : "Merge PDF"}
          </button>
        </div>
      </header>

      <main className="app__main">
        {pages.length === 0 ? (
          <div
            className={`dropzone ${isDraggingFile ? "dropzone--active" : ""}`}
            onClick={openEmptyFilePicker}
            onKeyDown={handleEmptyDropzoneKeyDown}
            role="button"
            tabIndex={0}
          >
            {isProcessing ? (
              <div className="dropzone__processing">Processing files...</div>
            ) : (
              <>
                <Upload
                  className={`dropzone__icon ${isDraggingFile ? "dropzone__icon--active" : ""}`}
                />
                <h2 className="dropzone__title">
                  Drag and drop PDFs, JPEGs or PNGs here
                </h2>
                <p className="dropzone__description">
                  Or select files from your computer (Multiple allowed)
                </p>
                <div className="dropzone__button">Browse Files</div>
                <input
                  ref={emptyFileInputRef}
                  type="file"
                  multiple
                  accept={FILE_INPUT_ACCEPT}
                  className="app__file-input"
                  onChange={handleFileInput}
                />
              </>
            )}
          </div>
        ) : (
          <div className="app__content" onMouseDown={handleContentMouseDown}>
            <div className={pageCollectionClassName}>
              {pages.map((page, index) => {
                const isSelected = selectedPageIds.has(page.id);
                const sourceFile = sourceFiles[page.fileId];
                const showIndicatorBefore = dropInsertionIndex === index;
                const showIndicatorAfter =
                  index === pages.length - 1 &&
                  dropInsertionIndex === pages.length;
                const pageCardClassName = [
                  "page-card",
                  `page-card--${viewMode}`,
                  isSelected ? "page-card--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const previewClassName = [
                  "page-card__preview",
                  isSelected ? "page-card__preview--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <div
                    key={page.id}
                    draggable
                    onDragStart={(e) => handlePageDragStart(e, page.id)}
                    onDragOver={(e) => handlePageDragOver(e, index)}
                    onDrop={handlePageDrop}
                    onDragEnd={resetDragState}
                    onClick={(e) => handlePageClick(e, page.id)}
                    className={pageCardClassName}
                  >
                    {showIndicatorBefore && (
                      <div
                        className={`page-card__drop-indicator page-card__drop-indicator--before page-card__drop-indicator--${viewMode}`}
                      >
                        <div className="page-card__drop-indicator-line" />
                        {isDraggingFile && (
                          <div className="page-card__drop-indicator-label">
                            Insert files here
                          </div>
                        )}
                      </div>
                    )}
                    {showIndicatorAfter && (
                      <div
                        className={`page-card__drop-indicator page-card__drop-indicator--after page-card__drop-indicator--${viewMode}`}
                      >
                        <div className="page-card__drop-indicator-line" />
                        {isDraggingFile && (
                          <div className="page-card__drop-indicator-label">
                            Insert files here
                          </div>
                        )}
                      </div>
                    )}

                    {viewMode === "grid" ? (
                      <>
                        <div
                          className={previewClassName}
                          style={{
                            aspectRatio: `${page.width} / ${page.height}`,
                          }}
                        >
                          <img
                            src={page.thumbnailUrl}
                            alt={`Page ${page.pageIndex + 1}`}
                            className="page-card__preview-image"
                            draggable={false}
                          />
                          <div className="page-card__preview-hover" />
                        </div>
                        <div className="page-card__label">
                          {page.label
                            ? page.label
                            : `Page ${page.pageIndex + 1}`}
                        </div>
                        <div
                          className="page-card__filename"
                          title={sourceFile?.name}
                        >
                          {sourceFile?.name}
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          className="page-card__list-preview"
                          style={{
                            aspectRatio: `${page.width} / ${page.height}`,
                          }}
                        >
                          <img
                            src={page.thumbnailUrl}
                            alt="Thumbnail"
                            className="page-card__preview-image"
                            draggable={false}
                          />
                        </div>
                        <div className="page-card__meta">
                          <div className="page-card__meta-title">
                            {sourceFile?.name}
                          </div>
                          <div className="page-card__meta-subtitle">
                            Page {page.label ? page.label : page.pageIndex + 1}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <label className="app__fab" title="Add files">
              <Upload className="app__fab-icon" />
              <input
                type="file"
                multiple
                accept={FILE_INPUT_ACCEPT}
                className="app__file-input"
                onChange={handleFileInput}
              />
            </label>
          </div>
        )}
      </main>
    </div>
  );
}
