package kubernetes

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestRunRequiresClientsetAndHandler(t *testing.T) {
	if err := NewPodWatcher(nil, func(context.Context, *corev1.Pod) {}).
		Run(context.Background(), nil); err == nil {
		t.Fatal("expected an error when the clientset is nil")
	}

	if err := NewPodWatcher(fake.NewSimpleClientset(), nil).
		Run(context.Background(), nil); err == nil {
		t.Fatal("expected an error when the handler is nil")
	}
}

func TestRunDeliversExistingPodsAndSignalsReady(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
	}
	clientset := fake.NewSimpleClientset(pod)

	handled := make(chan string, 1)
	ready := make(chan struct{})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- NewPodWatcher(
			clientset,
			func(_ context.Context, observed *corev1.Pod) {
				select {
				case handled <- observed.Name:
				default:
				}
			},
		).Run(ctx, func() { close(ready) })
	}()

	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("watcher never became ready")
	}

	select {
	case name := <-handled:
		if name != "web" {
			t.Fatalf("expected pod web, got %q", name)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("handler was not called for the existing pod")
	}

	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected clean shutdown, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("watcher did not stop after context cancellation")
	}
}

func TestHandlePodIgnoresNonPodsAndPassesACopy(t *testing.T) {
	var received *corev1.Pod
	watcher := NewPodWatcher(
		fake.NewSimpleClientset(),
		func(_ context.Context, pod *corev1.Pod) { received = pod },
	)

	watcher.handlePod(context.Background(), "not a pod")
	if received != nil {
		t.Fatal("handler must not be called for non-Pod objects")
	}

	original := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "a"}}
	watcher.handlePod(context.Background(), original)

	if received == nil || received == original {
		t.Fatal("handler must receive a deep copy, not the cached object")
	}
}
