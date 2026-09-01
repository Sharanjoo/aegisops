package detection

import (
	"strings"

	corev1 "k8s.io/api/core/v1"
)

const (
	CrashLoopBackOffReason = "CrashLoopBackOff"

	ContainerTypeApplication = "application"
	ContainerTypeInit        = "init"

	applicationNameLabel = "app.kubernetes.io/name"
	legacyAppLabel       = "app"
)

// Finding represents an unhealthy Kubernetes container discovered by the agent.
type Finding struct {
	PodUID        string
	Namespace     string
	PodName       string
	ServiceName   string
	ContainerName string
	ContainerType string
	RestartCount  int32
	Reason        string
	Message       string
}

// DetectCrashLoopBackOff examines both application and init containers.
func DetectCrashLoopBackOff(pod *corev1.Pod) []Finding {
	if pod == nil {
		return nil
	}

	findings := detectContainerStatuses(
		pod,
		pod.Status.ContainerStatuses,
		ContainerTypeApplication,
	)

	findings = append(
		findings,
		detectContainerStatuses(
			pod,
			pod.Status.InitContainerStatuses,
			ContainerTypeInit,
		)...,
	)

	return findings
}

func detectContainerStatuses(
	pod *corev1.Pod,
	statuses []corev1.ContainerStatus,
	containerType string,
) []Finding {
	findings := make([]Finding, 0)

	for _, status := range statuses {
		waitingState := status.State.Waiting

		if waitingState == nil ||
			waitingState.Reason != CrashLoopBackOffReason {
			continue
		}

		findings = append(findings, Finding{
			PodUID:        string(pod.UID),
			Namespace:     pod.Namespace,
			PodName:       pod.Name,
			ServiceName:   serviceNameForPod(pod, status.Name),
			ContainerName: status.Name,
			ContainerType: containerType,
			RestartCount:  status.RestartCount,
			Reason:        waitingState.Reason,
			Message:       waitingState.Message,
		})
	}

	return findings
}

func serviceNameForPod(
	pod *corev1.Pod,
	fallbackContainerName string,
) string {
	for _, labelName := range []string{
		applicationNameLabel,
		legacyAppLabel,
	} {
		value := strings.TrimSpace(pod.Labels[labelName])

		if value != "" {
			return value
		}
	}

	return fallbackContainerName
}
