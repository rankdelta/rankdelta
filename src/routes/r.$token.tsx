import { createFileRoute } from '@tanstack/react-router'
import { SharedReportPage } from '../pages/SharedReportPage'

export const Route = createFileRoute('/r/$token')({
  component: SharedReportPage,
})
