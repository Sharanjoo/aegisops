package detection

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestDetectCrashLoopBackOff(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "pod-uid-1",
			Namespace: "payments",
			Name:      "payments-api-abc",
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name:         "payments-api",
					RestartCount: 5,
					State: corev1.ContainerState{
						Waiting: &corev1.ContainerStateWaiting{
							Reason:  CrashLoopBackOffReason,
							Message: "back-off restarting failed container",
						},
					},
				},
			},
		},
	}

	findings := DetectCrashLoopBackOff(pod)

	if len(findings) != 1 {
		t.Fatalf(
			"expected 1 finding, got %d",
			len(findings),
		)
	}

	finding := findings[0]

	if finding.Namespace != "payments" {
		t.Errorf(
			"expected namespace payments, got %s",
			finding.Namespace,
		)
	}

	if finding.PodName != "payments-api-abc" {
		t.Errorf(
			"expected pod payments-api-abc, got %s",
			finding.PodName,
		)
	}

	if finding.ContainerName != "payments-api" {
		t.Errorf(
			"expected container payments-api, got %s",
			finding.ContainerName,
		)
	}

	if finding.RestartCount != 5 {
		t.Errorf(
			"expected restart count 5, got %d",
			finding.RestartCount,
		)
	}
}

func TestDetectCrashLoopBackOffIgnoresHealthyContainer(
	t *testing.T,
) {
	pod := &corev1.Pod{
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "healthy-api",
					State: corev1.ContainerState{
						Running: &corev1.ContainerStateRunning{},
					},
				},
			},
		},
	}

	findings := DetectCrashLoopBackOff(pod)

	if len(findings) != 0 {
		t.Fatalf(
			"expected no findings, got %d",
			len(findings),
		)
	}
}

func TestDetectCrashLoopBackOffDetectsInitContainer(
	t *testing.T,
) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "pod-uid-2",
			Namespace: "orders",
			Name:      "orders-api-abc",
		},
		Status: corev1.PodStatus{
			InitContainerStatuses: []corev1.ContainerStatus{
				{
					Name:         "database-migration",
					RestartCount: 3,
					State: corev1.ContainerState{
						Waiting: &corev1.ContainerStateWaiting{
							Reason: CrashLoopBackOffReason,
						},
					},
				},
			},
		},
	}

	findings := DetectCrashLoopBackOff(pod)

	if len(findings) != 1 {
		t.Fatalf(
			"expected 1 finding, got %d",
			len(findings),
		)
	}

	if findings[0].ContainerType != ContainerTypeInit {
		t.Errorf(
			"expected init container type, got %s",
			findings[0].ContainerType,
		)
	}
}
