import { useState, useCallback, useEffect } from "react";
import type { ChangeEvent, DragEvent, MouseEvent } from "react";
import {
  Upload,
  Grid as GridIcon,
  List as ListIcon,
  Download,
  Trash2,
  FileText,
} from "lucide-react";
import { parsePdfFile, generateMergedPdf } from "./pdfService";
import type { PdfPageNode, PdfFile } from "./types";
import "./App.css";

export default function App() {
  const [pages, setPages] = useState<PdfPageNode[]>([]);
  const [pdfFiles, setPdfFiles] = useState<Record<string, PdfFile>>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(
    new Set(),
  );
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(
    null,
  );

  const handleRemoveSelected = useCallback(() => {
    setPages((prev) => prev.filter((p) => !selectedPageIds.has(p.id)));
    setSelectedPageIds(new Set());
    setLastSelectedId(null);
  }, [selectedPageIds]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedPageIds.size > 0
      ) {
        handleRemoveSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRemoveSelected, selectedPageIds]);

  const handleDragOverFile = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (draggedPageId) return;
      setIsDraggingFile(true);
    },
    [draggedPageId],
  );

  const handleDragLeaveFile = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
  }, []);

  const handleDropFile = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDraggingFile(false);

      if (draggedPageId) return;

      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf",
      );
      if (files.length === 0) return;

      setIsProcessing(true);
      try {
        const newFiles: Record<string, PdfFile> = {};
        const newPages: PdfPageNode[] = [];

        for (const file of files) {
          const fileId = crypto.randomUUID();
          const result = await parsePdfFile(file, fileId);
          newFiles[fileId] = result.pdfFile;
          newPages.push(...result.pages);
        }

        setPdfFiles((prev) => ({ ...prev, ...newFiles }));
        setPages((prev) => [...prev, ...newPages]);
      } catch (err) {
        console.error("Error processing PDFs:", err);
        alert("Error parsing PDF files. Check console for details.");
      } finally {
        setIsProcessing(false);
      }
    },
    [draggedPageId],
  );

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.type === "application/pdf",
    );
    if (files.length === 0) return;

    setIsProcessing(true);
    try {
      const newFiles: Record<string, PdfFile> = {};
      const newPages: PdfPageNode[] = [];

      for (const file of files) {
        const fileId = crypto.randomUUID();
        const result = await parsePdfFile(file, fileId);
        newFiles[fileId] = result.pdfFile;
        newPages.push(...result.pages);
      }

      setPdfFiles((prev) => ({ ...prev, ...newFiles }));
      setPages((prev) => [...prev, ...newPages]);
    } catch (err) {
      console.error("Error processing PDFs:", err);
      alert("Error parsing PDF files. Check console for details.");
    } finally {
      setIsProcessing(false);
    }
    e.target.value = "";
  };

  const handlePageClick = (e: MouseEvent, pageId: string) => {
    e.preventDefault();
    const newSelected = new Set(selectedPageIds);

    if (e.shiftKey && lastSelectedId) {
      const lastIdx = pages.findIndex((p) => p.id === lastSelectedId);
      const currIdx = pages.findIndex((p) => p.id === pageId);

      if (lastIdx === -1 || currIdx === -1) return;

      const start = Math.min(lastIdx, currIdx);
      const end = Math.max(lastIdx, currIdx);

      if (!e.metaKey && !e.ctrlKey) {
        newSelected.clear();
      }

      for (let i = start; i <= end; i += 1) {
        newSelected.add(pages[i].id);
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (newSelected.has(pageId)) {
        newSelected.delete(pageId);
      } else {
        newSelected.add(pageId);
      }
      setLastSelectedId(pageId);
    } else {
      newSelected.clear();
      newSelected.add(pageId);
      setLastSelectedId(pageId);
    }

    setSelectedPageIds(newSelected);
  };

  const handleDownload = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const mergedPdfUint8Array = await generateMergedPdf(pages, pdfFiles);
      const blob = new Blob([mergedPdfUint8Array], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "merged.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
    targetId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    if (selectedPageIds.has(targetId)) {
      setDropTargetId(null);
      setDropPosition(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    if (viewMode === "list") {
      const midY = rect.top + rect.height / 2;
      setDropPosition(e.clientY < midY ? "before" : "after");
    } else {
      const midX = rect.left + rect.width / 2;
      setDropPosition(e.clientX < midX ? "before" : "after");
    }

    setDropTargetId(targetId);
  };

  const handlePageDrop = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedPageId || selectedPageIds.has(targetId) || !dropPosition) {
      resetDragStyles();
      return;
    }

    setPages((prev) => {
      const newPages = [...prev];
      const itemsToMove = newPages.filter((p) => selectedPageIds.has(p.id));
      const itemsToKeep = newPages.filter((p) => !selectedPageIds.has(p.id));

      const targetIndex = itemsToKeep.findIndex((p) => p.id === targetId);
      if (targetIndex === -1) return prev;

      const insertIndex =
        dropPosition === "before" ? targetIndex : targetIndex + 1;
      itemsToKeep.splice(insertIndex, 0, ...itemsToMove);
      return itemsToKeep;
    });

    resetDragStyles();
  };

  const resetDragStyles = () => {
    setDraggedPageId(null);
    setDropTargetId(null);
    setDropPosition(null);
  };

  const pageCollectionClassName = `app__pages app__pages--${viewMode}`;

  return (
    <div
      className="app"
      onDragOver={handleDragOverFile}
      onDragLeave={handleDragLeaveFile}
      onDrop={handleDropFile}
    >
      <header className="app__header">
        <h1 className="app__brand">
          <FileText className="app__brand-icon" />
          PdfMiniMerge
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
          >
            {isProcessing ? (
              <div className="dropzone__processing">Processing PDFs...</div>
            ) : (
              <>
                <Upload
                  className={`dropzone__icon ${isDraggingFile ? "dropzone__icon--active" : ""}`}
                />
                <h2 className="dropzone__title">Drag and drop PDFs here</h2>
                <p className="dropzone__description">
                  Or select files from your computer (Multiple allowed)
                </p>
                <label className="dropzone__button">
                  Browse Files
                  <input
                    type="file"
                    multiple
                    accept=".pdf"
                    className="app__file-input"
                    onChange={handleFileInput}
                  />
                </label>
              </>
            )}
          </div>
        ) : (
          <div className="app__content">
            {isDraggingFile && (
              <div className="app__overlay">
                <div className="app__overlay-content">
                  <Upload className="app__overlay-icon" />
                  Drop PDFs to append
                </div>
              </div>
            )}

            <div className={pageCollectionClassName}>
              {pages.map((page) => {
                const isSelected = selectedPageIds.has(page.id);
                const isDropTarget = dropTargetId === page.id;
                const pdfFile = pdfFiles[page.fileId];
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
                    onDragOver={(e) => handlePageDragOver(e, page.id)}
                    onDrop={(e) => handlePageDrop(e, page.id)}
                    onDragEnd={resetDragStyles}
                    onClick={(e) => handlePageClick(e, page.id)}
                    className={pageCardClassName}
                  >
                    {isDropTarget && dropPosition === "before" && (
                      <div
                        className={`page-card__drop-indicator page-card__drop-indicator--before page-card__drop-indicator--${viewMode}`}
                      />
                    )}
                    {isDropTarget && dropPosition === "after" && (
                      <div
                        className={`page-card__drop-indicator page-card__drop-indicator--after page-card__drop-indicator--${viewMode}`}
                      />
                    )}

                    {viewMode === "grid" ? (
                      <>
                        <div className={previewClassName}>
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
                          title={pdfFile?.name}
                        >
                          {pdfFile?.name}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="page-card__list-preview">
                          <img
                            src={page.thumbnailUrl}
                            alt="Thumbnail"
                            className="page-card__preview-image"
                            draggable={false}
                          />
                        </div>
                        <div className="page-card__meta">
                          <div className="page-card__meta-title">
                            {pdfFile?.name}
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

            <label className="app__fab" title="Add PDF">
              <Upload className="app__fab-icon" />
              <input
                type="file"
                multiple
                accept=".pdf"
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
