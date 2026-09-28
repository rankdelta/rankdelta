import { useTranslation } from 'react-i18next'
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  EyeIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline'

interface BuilderToolbarProps {
  mode: 'edit' | 'preview'
  onModeChange: (mode: 'edit' | 'preview') => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  widgetCount: number
}

export function BuilderToolbar({
  mode,
  onModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  widgetCount,
}: BuilderToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-white/80">{t('agencyReport.builder.canvasTitle')}</p>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50 tabular-nums">
          {t('agencyReport.builder.widgetCount', { count: widgetCount })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <button
            type="button"
            onClick={() => onModeChange('edit')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
              mode === 'edit' ? 'bg-violet-600 text-white' : 'text-white/60 hover:bg-white/5'
            }`}
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            {t('agencyReport.builder.mode.edit')}
          </button>
          <button
            type="button"
            onClick={() => onModeChange('preview')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
              mode === 'preview' ? 'bg-violet-600 text-white' : 'text-white/60 hover:bg-white/5'
            }`}
          >
            <EyeIcon className="w-3.5 h-3.5" />
            {t('agencyReport.builder.mode.preview')}
          </button>
        </div>

        {mode === 'edit' && (
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              title={t('agencyReport.builder.undo')}
              className="px-2.5 py-1.5 text-white/60 hover:bg-white/5 disabled:opacity-30"
            >
              <ArrowUturnLeftIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              title={t('agencyReport.builder.redo')}
              className="px-2.5 py-1.5 text-white/60 hover:bg-white/5 disabled:opacity-30 border-l border-white/10"
            >
              <ArrowUturnRightIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
