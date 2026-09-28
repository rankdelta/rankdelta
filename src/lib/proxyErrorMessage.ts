/**
 * Map seo-proxy typed errors to user-facing i18n messages (real limit reason, not vague copy).
 */

import {
  AccountBudgetError,
  PlanRequiredError,
  ResearchQuotaError,
} from '../services/edgeProxy'

type TFn = (key: string, opts?: Record<string, unknown>) => string

export function proxyErrorMessage(t: TFn, err: unknown): string | null {
  if (err instanceof ResearchQuotaError) {
    return t('usage.researchQuotaReached', { used: err.used, cap: err.cap })
  }
  if (err instanceof AccountBudgetError) {
    const spent = err.spentCents != null ? (err.spentCents / 100).toFixed(0) : null
    const cap = err.capCents != null ? (err.capCents / 100).toFixed(0) : '50'
    if (spent != null) {
      return t('usage.apiCapReachedDetail', { spent, cap })
    }
    return t('usage.apiCapReached')
  }
  if (err instanceof PlanRequiredError) {
    return t('usage.planRequired')
  }
  return null
}

export function isProxyQuotaError(err: unknown): err is ResearchQuotaError | AccountBudgetError | PlanRequiredError {
  return err instanceof ResearchQuotaError
    || err instanceof AccountBudgetError
    || err instanceof PlanRequiredError
}
