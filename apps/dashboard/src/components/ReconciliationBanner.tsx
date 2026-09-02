interface ReconciliationBannerProps {
  error: string | null
  onRetry: () => void
}

/**
 * Shown only when automatic recovery from a reconciliation gap (a hydration
 * that exhausted its retries, or a startup event-buffer overflow) has also
 * exhausted its own fallback refresh attempts. Non-fatal: the rest of the
 * dashboard keeps working, and a later successful refresh clears this.
 */
export function ReconciliationBanner({ error, onRetry }: ReconciliationBannerProps) {
  if (!error) {
    return null
  }

  return (
    <div className="reconciliation-banner" role="alert">
      <span>{error}</span>
      <button type="button" className="reconciliation-banner-retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
