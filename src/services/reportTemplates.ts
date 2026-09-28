import { supabase } from '../lib/supabaseClient'
import type { ReportLayout } from '../lib/agencyReport/layout'
import { isValidLayout, normalizeLayout } from '../lib/agencyReport/layout'

export interface ReportTemplateRow {
  id: string
  user_id: string
  project_id: string | null
  name: string
  description: string | null
  layout: ReportLayout
  is_default: boolean
  created_at: string
  updated_at: string
}

function parseLayout(raw: unknown): ReportLayout {
  if (isValidLayout(raw)) return normalizeLayout(raw)
  return { version: 1, columns: 12, widgets: [] }
}

export async function fetchReportTemplates(projectId?: string | null): Promise<ReportTemplateRow[]> {
  let query = supabase
    .from('report_templates')
    .select('id, user_id, project_id, name, description, layout, is_default, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (projectId) {
    query = query.or(`project_id.eq.${projectId},project_id.is.null`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    layout: parseLayout(row.layout),
  })) as ReportTemplateRow[]
}

export async function saveReportTemplate(input: {
  name: string
  description?: string
  layout: ReportLayout
  projectId?: string | null
  isDefault?: boolean
}): Promise<ReportTemplateRow> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('unauthorized')

  const { data, error } = await supabase
    .from('report_templates')
    .insert({
      user_id: user.id,
      project_id: input.projectId || null,
      name: input.name,
      description: input.description ?? null,
      layout: normalizeLayout(input.layout),
      is_default: input.isDefault ?? false,
    })
    .select('id, user_id, project_id, name, description, layout, is_default, created_at, updated_at')
    .single()

  if (error) throw error
  return { ...data, layout: parseLayout(data.layout) } as ReportTemplateRow
}

export async function deleteReportTemplate(templateId: string): Promise<void> {
  const { error } = await supabase.from('report_templates').delete().eq('id', templateId)
  if (error) throw error
}
