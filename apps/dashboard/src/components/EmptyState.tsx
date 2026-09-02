interface EmptyStateProps {
  hasFilters: boolean
}

export function EmptyState({ hasFilters }: EmptyStateProps) {
  return (
    <div className="state-panel">
      <p>
        {hasFilters
          ? 'No incidents match the current filters.'
          : 'No incidents reported. All systems nominal.'}
      </p>
    </div>
  )
}
