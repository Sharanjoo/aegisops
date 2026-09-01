package detection

import (
	"strings"
	"sync"
	"time"
)

// Deduplicator suppresses repeated findings during a cooldown period.
type Deduplicator struct {
	mutex        sync.Mutex
	cooldown     time.Duration
	lastReported map[string]time.Time
	now          func() time.Time
}

// NewDeduplicator creates a thread-safe finding deduplicator.
func NewDeduplicator(cooldown time.Duration) *Deduplicator {
	return newDeduplicator(cooldown, time.Now)
}

func newDeduplicator(
	cooldown time.Duration,
	now func() time.Time,
) *Deduplicator {
	return &Deduplicator{
		cooldown:     cooldown,
		lastReported: make(map[string]time.Time),
		now:          now,
	}
}

// Allow returns true when a finding should be processed.
func (deduplicator *Deduplicator) Allow(finding Finding) bool {
	currentTime := deduplicator.now()
	key := findingKey(finding)

	deduplicator.mutex.Lock()
	defer deduplicator.mutex.Unlock()

	deduplicator.removeExpiredEntries(currentTime)

	lastReportedAt, previouslyReported :=
		deduplicator.lastReported[key]

	if previouslyReported &&
		currentTime.Before(lastReportedAt.Add(deduplicator.cooldown)) {
		return false
	}

	deduplicator.lastReported[key] = currentTime

	return true
}

func (deduplicator *Deduplicator) removeExpiredEntries(
	currentTime time.Time,
) {
	for key, reportedAt := range deduplicator.lastReported {
		if !currentTime.Before(
			reportedAt.Add(deduplicator.cooldown),
		) {
			delete(deduplicator.lastReported, key)
		}
	}
}

func findingKey(finding Finding) string {
	podIdentity := finding.PodUID

	if podIdentity == "" {
		podIdentity = finding.Namespace + "/" + finding.PodName
	}

	return strings.Join(
		[]string{
			podIdentity,
			finding.ContainerType,
			finding.ContainerName,
			finding.Reason,
		},
		"|",
	)
}

// Forget removes a finding from the cooldown cache.
// This allows retrying after a failed incident-service request.
func (deduplicator *Deduplicator) Forget(finding Finding) {
	key := findingKey(finding)

	deduplicator.mutex.Lock()
	defer deduplicator.mutex.Unlock()

	delete(deduplicator.lastReported, key)
}
