interface ErrorStateProps {
  message: string
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div className="state-panel state-panel-error" role="alert">
      <p>Could not load incidents.</p>
      <p className="state-panel-detail">{message}</p>
    </div>
  )
}
