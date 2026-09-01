package detection

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestDetectCrashLoopBackOffUsesApplicationNameLabel(
	t *testing.T,
) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				applicationNameLabel: "orders-api",
				legacyAppLabel:       "legacy-orders",
			},
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "application-container",
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

	if findings[0].ServiceName != "orders-api" {
		t.Errorf(
			"expected orders-api, got %s",
			findings[0].ServiceName,
		)
	}
}

func TestDetectCrashLoopBackOffFallsBackToContainerName(
	t *testing.T,
) {
	pod := &corev1.Pod{
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "inventory-worker",
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

	if findings[0].ServiceName != "inventory-worker" {
		t.Errorf(
			"expected inventory-worker, got %s",
			findings[0].ServiceName,
		)
	}
}
