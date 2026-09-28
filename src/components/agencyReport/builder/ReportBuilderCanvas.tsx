import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  Bars3Icon,
} from '@heroicons/react/24/outline'
import type { ClientReportSnapshot } from '../../../lib/agencyReport/types'
import {
  GRID_COLUMNS,
  duplicateWidget,
  reorderWidgets,
  resizeWidget,
  removeWidget,
  sortWidgets,
  type ReportLayout,
  type ReportWidget,
} from '../../../lib/agencyReport/layout'
import { catalogEntryFor } from '../../../lib/agencyReport/widgets'
import { ReportWidgetRenderer } from '../widgets/ReportWidgetRenderer'

interface ReportBuilderCanvasProps {
  layout: ReportLayout
  report: ClientReportSnapshot | null
  onChange: (layout: ReportLayout) => void
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  readOnly?: boolean
}

function gridStyle(widget: ReportWidget) {
  return {
    gridColumn: `${widget.grid.col + 1} / span ${widget.grid.colSpan}`,
    gridRow: `span ${widget.grid.rowSpan}`,
  }
}

function SortableWidget({
  widget,
  report,
  selected,
  readOnly,
  onSelect,
  onRemove,
  onDuplicate,
  onResize,
}: {
  widget: ReportWidget
  report: ClientReportSnapshot | null
  selected: boolean
  readOnly?: boolean
  onSelect: () => void
  onRemove: () => void
  onDuplicate: () => void
  onResize: (delta: { colSpan?: number; rowSpan?: number }) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: readOnly,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...gridStyle(widget),
  }

  const entry = catalogEntryFor(widget.binding)
  const title = widget.title ?? (entry ? t(entry.defaultTitleKey as never) : widget.binding.metric)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-xl border bg-white p-3 min-h-[80px] ${
        selected ? 'border-violet-500 ring-2 ring-violet-500/30' : 'border-gray-200'
      } ${readOnly ? '' : 'cursor-pointer hover:border-violet-300'}`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
    >
      {!readOnly && (
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
          <button
            type="button"
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-grab active:cursor-grabbing"
            title={t('agencyReport.builder.drag')}
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <Bars3Icon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50"
            title={t('agencyReport.builder.duplicate')}
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
          >
            <DocumentDuplicateIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50"
            title={t('agencyReport.builder.removeWidget')}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {report ? (
        <ReportWidgetRenderer widget={widget} report={report} title={title} />
      ) : (
        <div className="flex flex-col items-center justify-center h-full min-h-[60px] text-center">
          <p className="text-xs font-medium text-gray-500">{title}</p>
          <p className="text-[10px] text-gray-400 mt-1">{widget.type.replace('_', ' ')}</p>
        </div>
      )}

      {!readOnly && selected && (
        <div className="absolute bottom-2 right-2 flex gap-0.5">
          <button
            type="button"
            className="p-1 rounded bg-gray-100 text-gray-500 hover:bg-violet-100 hover:text-violet-600"
            title={t('agencyReport.builder.narrower')}
            onClick={(e) => {
              e.stopPropagation()
              onResize({ colSpan: -1 })
            }}
          >
            <ArrowsPointingInIcon className="w-3 h-3 rotate-45" />
          </button>
          <button
            type="button"
            className="p-1 rounded bg-gray-100 text-gray-500 hover:bg-violet-100 hover:text-violet-600"
            title={t('agencyReport.builder.wider')}
            onClick={(e) => {
              e.stopPropagation()
              onResize({ colSpan: 1 })
            }}
          >
            <ArrowsPointingOutIcon className="w-3 h-3 rotate-45" />
          </button>
          <button
            type="button"
            className="p-1 rounded bg-gray-100 text-gray-500 hover:bg-violet-100 hover:text-violet-600 text-[10px] font-bold px-1.5"
            title={t('agencyReport.builder.shorter')}
            onClick={(e) => {
              e.stopPropagation()
              onResize({ rowSpan: -1 })
            }}
          >
            −
          </button>
          <button
            type="button"
            className="p-1 rounded bg-gray-100 text-gray-500 hover:bg-violet-100 hover:text-violet-600 text-[10px] font-bold px-1.5"
            title={t('agencyReport.builder.taller')}
            onClick={(e) => {
              e.stopPropagation()
              onResize({ rowSpan: 1 })
            }}
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}

export function ReportBuilderCanvas({
  layout,
  report,
  onChange,
  selectedId,
  onSelect,
  readOnly = false,
}: ReportBuilderCanvasProps) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const widgets = useMemo(() => sortWidgets(layout.widgets), [layout.widgets])
  const maxRow = widgets.reduce((m, w) => Math.max(m, w.grid.row + w.grid.rowSpan), 0)

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return
    onChange(reorderWidgets(layout, String(active.id), String(over.id)))
  }

  const activeWidget = activeId ? widgets.find((w) => w.id === activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="report-builder-canvas rounded-2xl border border-dashed border-gray-300 p-4 relative"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(80px, auto)',
          gap: '12px',
          minHeight: `${(maxRow + 1) * 100}px`,
          backgroundImage: readOnly
            ? undefined
            : `repeating-linear-gradient(90deg, rgba(139,92,246,0.06) 0, rgba(139,92,246,0.06) 1px, transparent 1px, transparent calc(100% / ${GRID_COLUMNS}))`,
          backgroundColor: 'rgba(249,250,251,0.8)',
        }}
        onClick={() => onSelect?.(null)}
      >
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            {widgets.map((widget) => (
              <SortableWidget
                key={widget.id}
                widget={widget}
                report={report}
                selected={selectedId === widget.id}
                readOnly={readOnly}
                onSelect={() => onSelect?.(widget.id)}
                onRemove={() => onChange(removeWidget(layout, widget.id))}
                onDuplicate={() => onChange(duplicateWidget(layout, widget.id))}
                onResize={(delta) => onChange(resizeWidget(layout, widget.id, delta))}
              />
            ))}
        </SortableContext>

        {widgets.length === 0 && (
          <div
            className="col-span-full flex items-center justify-center py-16 text-sm text-gray-400"
            style={{ gridColumn: `1 / -1` }}
          >
            {t('agencyReport.builder.emptyCanvas')}
          </div>
        )}
      </div>

      <DragOverlay>
        {activeWidget ? (
          <div className="rounded-xl border-2 border-violet-500 bg-white p-3 shadow-xl opacity-90 w-48">
            <p className="text-xs font-medium text-gray-700">
              {activeWidget.title ?? activeWidget.binding.metric}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
