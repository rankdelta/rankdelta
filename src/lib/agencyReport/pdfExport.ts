/**
 * Client-side agency report PDF export.
 *
 * Default path: the browser's own print engine (vector text, selectable, ~instant) driven by
 * `src/styles/report-print.css` — see `printReportAsPdf`. The html2canvas-pro + jsPDF raster path
 * below is kept only as a fallback for environments without `window.print`.
 */

export const PDF_EXPORT_GROUP_SELECTOR = '.pdf-export-group'
export const PDF_EXPORT_ROOT_SELECTOR = '.agency-report-view'

/** Class on <html> that switches the report into its print layout (also used by `?print=1`). */
export const REPORT_PRINT_CLASS = 'report-print'
/** Extra class for the on-screen QA preview: fakes the A4 page area so page breaks can be eyeballed. */
export const REPORT_PRINT_PREVIEW_CLASS = 'report-print-preview'
export const REPORT_PRINT_QUERY_PARAM = 'print'

/** True when the URL asks for the print layout on screen (`?print=1`). */
export function isPrintPreviewRequested(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  const value = new URLSearchParams(search).get(REPORT_PRINT_QUERY_PARAM)
  return value === '1' || value === 'true'
}

export interface ReportPrintOptions {
  /** Suggested file name (Chrome uses document.title for "Save as PDF"). No extension. */
  documentTitle: string
  /** Running footer text printed bottom-left on every page: "Agency · Client · Period". */
  footerText: string
  /** Localised "Page" label for the bottom-right page counter. */
  pageLabel: string
  /** Also apply the on-screen preview chrome (dashed A4 frame). */
  preview?: boolean
}

/** Quote a string for use in CSS `content:` (via a custom property). */
export function cssStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`
}

/**
 * Switch the document into report print mode. Returns a restore function that undoes everything
 * (class, custom properties, title) — call it on `afterprint` or when leaving the page.
 */
export function enterReportPrintMode(options: ReportPrintOptions, doc: Document = document): () => void {
  const root = doc.documentElement
  const previousTitle = doc.title
  const hadClass = root.classList.contains(REPORT_PRINT_CLASS)
  const hadPreview = root.classList.contains(REPORT_PRINT_PREVIEW_CLASS)

  root.classList.add(REPORT_PRINT_CLASS)
  if (options.preview) root.classList.add(REPORT_PRINT_PREVIEW_CLASS)
  root.style.setProperty('--report-print-footer', cssStringLiteral(options.footerText))
  root.style.setProperty('--report-print-page-label', cssStringLiteral(options.pageLabel))
  if (options.documentTitle) doc.title = options.documentTitle

  return () => {
    if (!hadClass) root.classList.remove(REPORT_PRINT_CLASS)
    if (!hadPreview) root.classList.remove(REPORT_PRINT_PREVIEW_CLASS)
    root.style.removeProperty('--report-print-footer')
    root.style.removeProperty('--report-print-page-label')
    doc.title = previousTitle
  }
}

/** Two animation frames: enough for the class swap to be laid out before the print engine snapshots. */
function nextPaint(win: Window): Promise<void> {
  return new Promise((resolve) => {
    if (typeof win.requestAnimationFrame !== 'function') {
      resolve()
      return
    }
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()))
  })
}

/**
 * Open the browser print dialog with the report in its print layout ("Save as PDF" is one click away).
 * Resolves once the dialog has closed (`afterprint`), with a timeout fallback for engines that never fire it.
 */
export async function printReportAsPdf(options: ReportPrintOptions, win: Window = window): Promise<void> {
  const doc = win.document
  const restore = enterReportPrintMode(options, doc)
  await nextPaint(win)

  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      win.removeEventListener('afterprint', finish)
      restore()
      resolve()
    }
    win.addEventListener('afterprint', finish)
    try {
      win.print()
    } catch (err) {
      finish()
      throw err
    }
    // Chrome blocks inside print(); Safari returns immediately and fires afterprint later.
    win.setTimeout(finish, 60_000)
  })
}

/** Whether the print path is usable here (jsdom and some embedded webviews have no print()). */
export function canPrintReport(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  return !!win && typeof win.print === 'function'
}

export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const PDF_MARGIN_MM = 10
export const PDF_CONTENT_WIDTH_MM = A4_WIDTH_MM - PDF_MARGIN_MM * 2
export const PDF_CONTENT_HEIGHT_MM = A4_HEIGHT_MM - PDF_MARGIN_MM * 2
export const PDF_GROUP_GAP_MM = 4

export interface PdfGroupPlacement {
  groupIndex: number
  pageIndex: number
  yMm: number
  widthMm: number
  heightMm: number
  scale: number
}

export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4
}

/** Slugify a filename segment (client name, etc.). */
export function sanitizePdfFilenameSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'report'
  const slug = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'report'
}

/** Build `<ClientName>-<period>-<suffix>` — the suffix is the agency slug on white-label reports. */
export function buildReportPdfBasename(
  clientName: string,
  periodStart: string,
  periodEnd: string,
  suffix = 'rankdelta',
): string {
  const client = sanitizePdfFilenameSegment(clientName)
  const period = `${periodStart}_${periodEnd}`.replace(/[^\d_-]/g, '')
  const tail = sanitizePdfFilenameSegment(suffix).toLowerCase()
  return `${client}-${period}-${tail}`
}

/** Build `<ClientName>-<period>-rankdelta.pdf`. */
export function buildReportPdfFilename(
  clientName: string,
  periodStart: string,
  periodEnd: string,
  suffix = 'rankdelta',
): string {
  return `${buildReportPdfBasename(clientName, periodStart, periodEnd, suffix)}.pdf`
}

/** Collect export groups in DOM order within a report root. */
export function collectPdfExportGroups(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(PDF_EXPORT_GROUP_SELECTOR))
}

export interface LayoutPdfGroupsInput {
  heightsPx: number[]
  contentWidthPx: number
  contentHeightPx: number
  isCover?: (index: number) => boolean
}

/**
 * Pure layout: assign each group to a page slot without splitting groups.
 * Tall groups are scaled down to fit a single page (never sliced).
 */
export function layoutPdfGroups({
  heightsPx,
  contentHeightPx,
  isCover = () => false,
}: LayoutPdfGroupsInput): PdfGroupPlacement[] {
  const placements: PdfGroupPlacement[] = []
  let pageIndex = 0
  let yPx = 0
  const gapPx = mmToPx(PDF_GROUP_GAP_MM)

  for (let groupIndex = 0; groupIndex < heightsPx.length; groupIndex++) {
    const rawHeightPx = heightsPx[groupIndex] ?? 0
    if (rawHeightPx <= 0) continue

    let scale = 1
    if (rawHeightPx > contentHeightPx) {
      scale = contentHeightPx / rawHeightPx
    }
    const scaledHeightPx = rawHeightPx * scale

    if (isCover(groupIndex) && yPx > 0) {
      pageIndex += 1
      yPx = 0
    }

    if (yPx > 0 && yPx + scaledHeightPx > contentHeightPx) {
      pageIndex += 1
      yPx = 0
    }

    placements.push({
      groupIndex,
      pageIndex,
      yMm: PDF_MARGIN_MM + (yPx / contentHeightPx) * PDF_CONTENT_HEIGHT_MM,
      widthMm: PDF_CONTENT_WIDTH_MM,
      heightMm: (scaledHeightPx / contentHeightPx) * PDF_CONTENT_HEIGHT_MM,
      scale,
    })

    yPx += scaledHeightPx + gapPx

    if (isCover(groupIndex)) {
      pageIndex += 1
      yPx = 0
    } else if (yPx >= contentHeightPx) {
      pageIndex += 1
      yPx = 0
    }
  }

  return placements
}

export interface Html2CanvasLike {
  (element: HTMLElement, options?: Record<string, unknown>): Promise<HTMLCanvasElement>
}

export interface JsPdfLike {
  new (options?: { orientation?: string; unit?: string; format?: string }): {
    addPage(): void
    addImage(
      imageData: string,
      format: string,
      x: number,
      y: number,
      width: number,
      height: number,
    ): void
    save(filename: string): void
  }
}

export interface ExportReportDomToPdfDeps {
  html2canvas: Html2CanvasLike
  jsPDF: JsPdfLike
}

/**
 * Capture grouped DOM blocks and assemble a paginated A4 PDF.
 * Lazy-load html2canvas-pro + jsPDF at the call site to keep the main bundle small.
 */
export async function exportReportDomToPdf(
  root: HTMLElement,
  filename: string,
  deps: ExportReportDomToPdfDeps,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const groups = collectPdfExportGroups(root)
  if (groups.length === 0) {
    throw new Error('No PDF export groups found in report')
  }

  const contentWidthPx = mmToPx(PDF_CONTENT_WIDTH_MM)
  const contentHeightPx = mmToPx(PDF_CONTENT_HEIGHT_MM)

  const heightsPx = groups.map((g) => {
    const rectHeight = g.getBoundingClientRect().height
    return rectHeight > 0 ? rectHeight : g.offsetHeight || g.scrollHeight
  })
  const isCover = (index: number) => groups[index]?.classList.contains('pdf-export-cover') ?? false

  const placements = layoutPdfGroups({
    heightsPx,
    contentWidthPx,
    contentHeightPx,
    isCover,
  })

  const pdf = new deps.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let activePage = 0

  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i]
    if (!placement) continue
    const group = groups[placement.groupIndex]
    if (!group) continue
    onProgress?.(i + 1, placements.length)

    if (placement.pageIndex > activePage) {
      for (let p = activePage; p < placement.pageIndex; p++) {
        pdf.addPage()
      }
      activePage = placement.pageIndex
    }

    const canvas = await deps.html2canvas(group, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: '#ffffff',
      width: group.scrollWidth,
      height: group.scrollHeight,
    })

    const imgData = canvas.toDataURL('image/png')
    const xMm = PDF_MARGIN_MM + (PDF_CONTENT_WIDTH_MM - placement.widthMm) / 2
    pdf.addImage(
      imgData,
      'PNG',
      xMm,
      placement.yMm,
      placement.widthMm,
      placement.heightMm,
    )
  }

  pdf.save(filename)
}

/** Lazy-load canvas + PDF libs (already pinned in package.json). */
export async function loadPdfExportDeps(): Promise<ExportReportDomToPdfDeps> {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ])
  return { html2canvas, jsPDF: jsPDF as JsPdfLike }
}
