import { useMemo, useState } from 'react'

import { EmptyState } from './components/EmptyState'
import { ErrorState } from './components/ErrorState'
import { FiltersBar } from './components/FiltersBar'
import { Header } from './components/Header'
import { IncidentTable } from './components/IncidentTable'
import { LoadingState } from './components/LoadingState'
import { SummaryCards } from './components/SummaryCards'
import { WebSocketBanner } from './components/WebSocketBanner'
import { loadEnv } from './config/env'
import {
  DEFAULT_INCIDENT_FILTERS,
  filterIncidents,
  type IncidentFilters,
} from './state/filterIncidents'
import { useIncidentDashboard } from './state/useIncidentDashboard'

const env = loadEnv()

function App() {
  const { snapshotStatus, snapshotError, incidents, connectionState } =
    useIncidentDashboard(env.incidentApiBaseUrl, env.realtimeWsUrl)

  const [filters, setFilters] = useState<IncidentFilters>(
    DEFAULT_INCIDENT_FILTERS,
  )

  const filteredIncidents = useMemo(
    () => filterIncidents(incidents, filters),
    [incidents, filters],
  )

  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.status !== 'ALL' ||
    filters.severity !== 'ALL'

  return (
    <div className="app-shell">
      <Header connectionState={connectionState} />

      <main className="app-main">
        <SummaryCards incidents={incidents} />

        <WebSocketBanner state={connectionState} />

        <FiltersBar filters={filters} onChange={setFilters} />

        {snapshotStatus === 'loading' && <LoadingState />}

        {snapshotStatus === 'error' && (
          <ErrorState message={snapshotError ?? 'Unknown error'} />
        )}

        {snapshotStatus === 'ready' &&
          (filteredIncidents.length === 0 ? (
            <EmptyState hasFilters={hasActiveFilters} />
          ) : (
            <IncidentTable incidents={filteredIncidents} />
          ))}
      </main>
    </div>
  )
}

export default App
