package detection

import (
	"testing"
	"time"
)

func TestDeduplicatorSuppressesFindingDuringCooldown(
	t *testing.T,
) {
	currentTime := time.Date(
		2026,
		time.September,
		1,
		12,
		0,
		0,
		0,
		time.UTC,
	)

	deduplicator := newDeduplicator(
		5*time.Minute,
		func() time.Time {
			return currentTime
		},
	)

	finding := Finding{
		PodUID:        "pod-uid-1",
		Namespace:     "default",
		PodName:       "payments-api",
		ContainerName: "payments-api",
		ContainerType: ContainerTypeApplication,
		Reason:        CrashLoopBackOffReason,
	}

	if !deduplicator.Allow(finding) {
		t.Fatal("expected the first finding to be allowed")
	}

	if deduplicator.Allow(finding) {
		t.Fatal("expected duplicate finding to be suppressed")
	}

	currentTime = currentTime.Add(5 * time.Minute)

	if !deduplicator.Allow(finding) {
		t.Fatal("expected finding after cooldown to be allowed")
	}
}

func TestDeduplicatorAllowsDifferentContainers(
	t *testing.T,
) {
	deduplicator := newDeduplicator(
		5*time.Minute,
		time.Now,
	)

	firstFinding := Finding{
		PodUID:        "pod-uid-1",
		ContainerName: "application",
		ContainerType: ContainerTypeApplication,
		Reason:        CrashLoopBackOffReason,
	}

	secondFinding := Finding{
		PodUID:        "pod-uid-1",
		ContainerName: "sidecar",
		ContainerType: ContainerTypeApplication,
		Reason:        CrashLoopBackOffReason,
	}

	if !deduplicator.Allow(firstFinding) {
		t.Fatal("expected first container finding to be allowed")
	}

	if !deduplicator.Allow(secondFinding) {
		t.Fatal("expected different container finding to be allowed")
	}
}

func TestDeduplicatorAllowsFindingAfterForget(
	t *testing.T,
) {
	deduplicator := NewDeduplicator(time.Hour)

	finding := Finding{
		PodUID:        "pod-uid-1",
		ContainerName: "payments-api",
		ContainerType: ContainerTypeApplication,
		Reason:        CrashLoopBackOffReason,
	}

	if !deduplicator.Allow(finding) {
		t.Fatal("expected first finding to be allowed")
	}

	deduplicator.Forget(finding)

	if !deduplicator.Allow(finding) {
		t.Fatal("expected forgotten finding to be allowed")
	}
}
