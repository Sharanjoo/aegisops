package kubernetes

import (
	"context"
	"errors"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/informers"
	kubernetesclient "k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

// PodHandler processes a Pod received from the Kubernetes informer.
type PodHandler func(context.Context, *corev1.Pod)

// PodWatcher continuously observes Pod additions and updates.
type PodWatcher struct {
	clientset kubernetesclient.Interface
	handler   PodHandler
}

// NewPodWatcher creates a watcher for Pods across all namespaces.
func NewPodWatcher(
	clientset kubernetesclient.Interface,
	handler PodHandler,
) *PodWatcher {
	return &PodWatcher{
		clientset: clientset,
		handler:   handler,
	}
}

// Run starts the Pod informer and blocks until the context is cancelled.
// onReady, if non-nil, is called once the informer cache has synced and the
// watcher is actually able to observe Pods - the point at which the agent
// should be considered ready to perform its work.
func (watcher *PodWatcher) Run(
	ctx context.Context,
	onReady func(),
) error {
	if watcher.clientset == nil {
		return errors.New("Kubernetes clientset is required")
	}

	if watcher.handler == nil {
		return errors.New("Pod handler is required")
	}

	informerFactory := informers.NewSharedInformerFactory(
		watcher.clientset,
		0,
	)

	podInformer := informerFactory.
		Core().
		V1().
		Pods().
		Informer()

	_, err := podInformer.AddEventHandler(
		cache.ResourceEventHandlerFuncs{
			AddFunc: func(object any) {
				watcher.handlePod(ctx, object)
			},
			UpdateFunc: func(_, newObject any) {
				watcher.handlePod(ctx, newObject)
			},
		},
	)
	if err != nil {
		return fmt.Errorf(
			"register Pod informer handler: %w",
			err,
		)
	}

	informerFactory.Start(ctx.Done())

	if !cache.WaitForCacheSync(
		ctx.Done(),
		podInformer.HasSynced,
	) {
		if ctx.Err() != nil {
			return nil
		}

		return errors.New("Pod informer cache synchronization failed")
	}

	if onReady != nil {
		onReady()
	}

	<-ctx.Done()

	return nil
}

func (watcher *PodWatcher) handlePod(
	ctx context.Context,
	object any,
) {
	pod, ok := object.(*corev1.Pod)
	if !ok {
		return
	}

	// Informer cache objects must never be modified by consumers.
	watcher.handler(ctx, pod.DeepCopy())
}
