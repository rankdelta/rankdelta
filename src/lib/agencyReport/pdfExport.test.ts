import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildReportPdfBasename,
  buildReportPdfFilename,
  canPrintReport,
  collectPdfExportGroups,
  cssStringLiteral,
  enterReportPrintMode,
  exportReportDomToPdf,
  isPrintPreviewRequested,
  layoutPdfGroups,
  loadPdfExportDeps,
  mmToPx,
  PDF_CONTENT_HEIGHT_MM,
  PDF_CONTENT_WIDTH_MM,
  printReportAsPdf,
  REPORT_PRINT_CLASS,
  REPORT_PRINT_PREVIEW_CLASS,
  REPORT_PRINT_SIZING_CLASS,
  reportFileSuffix,
  sanitizePdfFilenameSegment,
} from './pdfExport'

const OKLCH_TEXT = 'oklch(0.21 0.034 264.665)'
const OKLCH_BG = 'oklch(1 0 0)'
const OKLCH_BORDER = 'oklch(0.928 0.006 264.531)'

function mockElementDimensions(el: HTMLElement, width = 200, height = 40) {
  el.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height })
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: width })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height })
}

function stubOklchComputedStyle() {
  const oklchDeclaration = {
    color: OKLCH_TEXT,
    backgroundColor: OKLCH_BG,
    borderTopColor: OKLCH_BORDER,
    borderRightColor: OKLCH_BORDER,
    borderBottomColor: OKLCH_BORDER,
    borderLeftColor: OKLCH_BORDER,
    getPropertyValue: (prop: string) => {
      const map: Record<string, string> = {
        color: OKLCH_TEXT,
        'background-color': OKLCH_BG,
        'border-top-color': OKLCH_BORDER,
      }
      return map[prop] ?? ''
    },
  }
  return vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () => oklchDeclaration as CSSStyleDeclaration,
  )
}

describe('sanitizePdfFilenameSegment', () => {
  it('slugifies client names', () => {
    expect(sanitizePdfFilenameSegment('Acme Corp')).toBe('Acme-Corp')
    expect(sanitizePdfFilenameSegment('  ')).toBe('report')
    expect(sanitizePdfFilenameSegment('Caffè & Co.')).toBe('Caffe-Co')
  })
})

describe('buildReportPdfFilename', () => {
  it('builds ClientName-period-rankdelta.pdf', () => {
    expect(buildReportPdfFilename('Acme Corp', '2025-01-01', '2025-01-31')).toBe(
      'Acme-Corp-2025-01-01_2025-01-31-rankdelta.pdf',
    )
  })
})

describe('collectPdfExportGroups', () => {
  it('returns groups in document order', () => {
    document.body.innerHTML = `
      <div class="agency-report-view">
        <div class="pdf-export-group" id="a">A</div>
        <div class="pdf-export-group" id="b">B</div>
      </div>
    `
    const root = document.querySelector('.agency-report-view')!
    const groups = collectPdfExportGroups(root)
    expect(groups.map((g) => g.id)).toEqual(['a', 'b'])
  })
})

describe('layoutPdfGroups', () => {
  const contentWidthPx = mmToPx(PDF_CONTENT_WIDTH_MM)
  const contentHeightPx = mmToPx(PDF_CONTENT_HEIGHT_MM)

  it('keeps groups on one page when they fit', () => {
    const placements = layoutPdfGroups({
      heightsPx: [100, 120],
      contentWidthPx,
      contentHeightPx,
    })
    expect(placements).toHaveLength(2)
    expect(placements[0]!.pageIndex).toBe(0)
    expect(placements[1]!.pageIndex).toBe(0)
  })

  it('starts a new page when the next group would overflow', () => {
    const tall = contentHeightPx - 50
    const placements = layoutPdfGroups({
      heightsPx: [tall, 80],
      contentWidthPx,
      contentHeightPx,
    })
    expect(placements[0]!.pageIndex).toBe(0)
    expect(placements[1]!.pageIndex).toBe(1)
  })

  it('scales oversized groups instead of splitting them', () => {
    const placements = layoutPdfGroups({
      heightsPx: [contentHeightPx * 2],
      contentWidthPx,
      contentHeightPx,
    })
    expect(placements).toHaveLength(1)
    expect(placements[0]!.scale).toBeLessThan(1)
    expect(placements[0]!.heightMm).toBeLessThanOrEqual(PDF_CONTENT_HEIGHT_MM + 0.01)
  })

  it('forces cover groups onto their own page', () => {
    const placements = layoutPdfGroups({
      heightsPx: [100, 80, 90],
      contentWidthPx,
      contentHeightPx,
      isCover: (index) => index === 0,
    })
    expect(placements[0]!.pageIndex).toBe(0)
    expect(placements[1]!.pageIndex).toBe(1)
  })
})

describe('loadPdfExportDeps', () => {
  it('lazy-loads html2canvas-pro (oklch-capable fork)', async () => {
    const deps = await loadPdfExportDeps()
    expect(deps.html2canvas).toBeTypeOf('function')
    const mod = await import('html2canvas-pro')
    expect(deps.html2canvas).toBe(mod.default)
  })
})

describe('exportReportDomToPdf', () => {
  it('captures each group with html2canvas and saves via jsPDF', async () => {
    document.body.innerHTML = `
      <div class="agency-report-view">
        <div class="pdf-export-group" style="width:200px;height:40px">Cover</div>
        <div class="pdf-export-group" style="width:200px;height:30px">Section</div>
      </div>
    `
    const root = document.querySelector('.agency-report-view') as HTMLElement
    const groups = collectPdfExportGroups(root)
    for (const group of groups) {
      mockElementDimensions(group, 200, group.textContent === 'Cover' ? 40 : 30)
    }

    const html2canvas = vi.fn(async (el: HTMLElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = el.getBoundingClientRect().height * 2
      return canvas
    })

    const addImage = vi.fn()
    const addPage = vi.fn()
    const save = vi.fn()

    class MockJsPDF {
      addPage = addPage
      addImage = addImage
      save = save
    }

    await exportReportDomToPdf(
      root,
      'Acme-Corp-2025-01-01_2025-01-31-rankdelta.pdf',
      { html2canvas, jsPDF: MockJsPDF as never },
    )

    expect(html2canvas).toHaveBeenCalledTimes(groups.length)
    expect(addImage).toHaveBeenCalledTimes(groups.length)
    expect(save).toHaveBeenCalledWith('Acme-Corp-2025-01-01_2025-01-31-rankdelta.pdf')
  })

  it('throws when no export groups exist', async () => {
    document.body.innerHTML = `<div class="agency-report-view"><p>No groups</p></div>`
    const root = document.querySelector('.agency-report-view') as HTMLElement
    await expect(
      exportReportDomToPdf(root, 'x.pdf', {
        html2canvas: vi.fn(),
        jsPDF: class {} as never,
      }),
    ).rejects.toThrow(/No PDF export groups/)
  })

  it('completes export when computed styles use oklch (Tailwind CSS v4)', async () => {
    const mockCtx = {
      canvas: document.createElement('canvas'),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      measureText: vi.fn(() => ({ width: 50, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 })),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      clip: vi.fn(),
      rect: vi.fn(),
      setTransform: vi.fn(),
      transform: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createPattern: vi.fn(),
      putImageData: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    }
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => mockCtx as unknown as CanvasRenderingContext2D)
    const toDataUrlSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,oklch-test')

    document.body.innerHTML = `
      <div class="agency-report-view">
        <div class="pdf-export-group text-gray-900 bg-white border border-gray-200" style="width:200px;height:40px">
          KPI card
        </div>
      </div>
    `
    const root = document.querySelector('.agency-report-view') as HTMLElement
    const group = root.querySelector('.pdf-export-group') as HTMLElement
    mockElementDimensions(group, 200, 40)

    const getComputedStyleSpy = stubOklchComputedStyle()

    const save = vi.fn()
    class MockJsPDF {
      addPage = vi.fn()
      addImage = vi.fn()
      save = save
    }

    const deps = await loadPdfExportDeps()

    await expect(
      exportReportDomToPdf(root, 'oklch-report.pdf', { ...deps, jsPDF: MockJsPDF as never }),
    ).resolves.toBeUndefined()

    expect(getComputedStyleSpy).toHaveBeenCalled()
    expect(getContextSpy).toHaveBeenCalled()
    expect(toDataUrlSpy).toHaveBeenCalled()
    expect(save).toHaveBeenCalledWith('oklch-report.pdf')
  })
})

describe('print path', () => {
  it('builds a white-label basename with the agency as suffix', () => {
    expect(buildReportPdfBasename('Acme Corp', '2025-01-01', '2025-01-31')).toBe(
      'Acme-Corp-2025-01-01_2025-01-31-rankdelta',
    )
    expect(buildReportPdfBasename('Acme Corp', '2025-01-01', '2025-01-31', 'Studio Rossi & Co.')).toBe(
      'Acme-Corp-2025-01-01_2025-01-31-studio-rossi-co',
    )
    expect(buildReportPdfBasename('Acme Corp', '2025-01-01', '2025-01-31', '')).toBe('Acme-Corp-2025-01-01_2025-01-31')
  })

  it('never files a white-label report under "rankdelta", even without an agency name', () => {
    expect(reportFileSuffix(null)).toBe('rankdelta')
    expect(reportFileSuffix({ hideAstroSeoFooter: false, agencyName: 'Studio Nord' })).toBe('rankdelta')
    expect(reportFileSuffix({ hideAstroSeoFooter: true, agencyName: 'Studio Nord' })).toBe('Studio Nord')
    expect(reportFileSuffix({ hideAstroSeoFooter: true, agencyName: null })).toBe('')
    expect(reportFileSuffix({ hideAstroSeoFooter: true, agencyName: '  ' })).toBe('')
  })

  it('detects ?print=1', () => {
    expect(isPrintPreviewRequested('?print=1')).toBe(true)
    expect(isPrintPreviewRequested('?foo=1&print=true')).toBe(true)
    expect(isPrintPreviewRequested('?print=0')).toBe(false)
    expect(isPrintPreviewRequested('')).toBe(false)
  })

  it('quotes footer text for CSS content', () => {
    expect(cssStringLiteral('Acme · "Q1"')).toBe('"Acme · \\"Q1\\""')
  })

  it('enterReportPrintMode toggles the html class, custom properties and title, and restores them', () => {
    document.title = 'Before'
    const restore = enterReportPrintMode({
      documentTitle: 'Acme-2025-01-01_2025-01-31-rankdelta',
      footerText: 'Prepared by Studio · Acme · Jan 2025',
      pageLabel: 'Page',
      preview: true,
    })
    const root = document.documentElement
    expect(root.classList.contains(REPORT_PRINT_CLASS)).toBe(true)
    expect(root.classList.contains(REPORT_PRINT_PREVIEW_CLASS)).toBe(true)
    expect(root.style.getPropertyValue('--report-print-footer')).toBe('"Prepared by Studio · Acme · Jan 2025"')
    expect(root.style.getPropertyValue('--report-print-page-label')).toBe('"Page"')
    expect(document.title).toBe('Acme-2025-01-01_2025-01-31-rankdelta')

    restore()
    expect(root.classList.contains(REPORT_PRINT_CLASS)).toBe(false)
    expect(root.classList.contains(REPORT_PRINT_PREVIEW_CLASS)).toBe(false)
    expect(root.style.getPropertyValue('--report-print-footer')).toBe('')
    expect(document.title).toBe('Before')
  })

  it('printReportAsPdf enters print mode, calls window.print, and restores on afterprint', async () => {
    const listeners = new Map<string, () => void>()
    const print = vi.fn(() => {
      // The print layout must be active while the engine snapshots the page, at paper width so the
      // charts have redrawn at paper size.
      expect(document.documentElement.classList.contains(REPORT_PRINT_CLASS)).toBe(true)
      expect(document.documentElement.classList.contains(REPORT_PRINT_SIZING_CLASS)).toBe(true)
      listeners.get('afterprint')?.()
    })
    const win = {
      document,
      print,
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      // Run the short chart-redraw wait; never the 60 s afterprint fallback.
      setTimeout: vi.fn((cb: () => void, ms: number) => {
        if (ms < 1000) cb()
        return 0
      }),
      requestAnimationFrame: (cb: () => void) => {
        cb()
        return 0
      },
    } as unknown as Window

    await printReportAsPdf({ documentTitle: 'x', footerText: 'f', pageLabel: 'Page' }, win)

    expect(print).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains(REPORT_PRINT_CLASS)).toBe(false)
    expect(document.documentElement.classList.contains(REPORT_PRINT_SIZING_CLASS)).toBe(false)
    expect(listeners.has('afterprint')).toBe(false)
  })

  it('canPrintReport is false without window.print', () => {
    expect(canPrintReport({} as Window)).toBe(false)
    expect(canPrintReport({ print: () => {} } as unknown as Window)).toBe(true)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
