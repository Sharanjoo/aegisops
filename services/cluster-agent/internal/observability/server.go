// Package observability provides the cluster agent's HTTP health and
// metrics surface (/healthz, /readyz, /metrics). It is the agent's only
// listening port - the rest of its work is a Kubernetes watch loop with no
// other HTTP surface.
package observability

import (
	"context"
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Server exposes /healthz, /readyz, and /metrics.
type Server struct {
	httpServer *http.Server
	ready      atomic.Bool
}

// NewServer creates an observability HTTP server bound to address. It does
// not start listening until Start is called.
func NewServer(address string, registry *prometheus.Registry) *Server {
	server := &Server{}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", server.handleHealthz)
	mux.HandleFunc("/readyz", server.handleReadyz)
	mux.Handle(
		"/metrics",
		promhttp.HandlerFor(registry, promhttp.HandlerOpts{}),
	)

	server.httpServer = &http.Server{
		Addr:              address,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	return server
}

// SetReady marks whether the agent has finished initializing (its
// Kubernetes informer cache has synced) and can perform its work. /readyz
// reports 503 until this is called with true.
func (server *Server) SetReady(ready bool) {
	server.ready.Store(ready)
}

// Start begins serving in the background and returns a channel that
// receives at most one error - nil once the server has shut down cleanly
// via Shutdown, or the error that caused it to stop otherwise.
func (server *Server) Start() <-chan error {
	errs := make(chan error, 1)

	go func() {
		err := server.httpServer.ListenAndServe()

		if err != nil && err != http.ErrServerClosed {
			errs <- err
			return
		}

		errs <- nil
	}()

	return errs
}

// Shutdown gracefully stops the HTTP server.
func (server *Server) Shutdown(ctx context.Context) error {
	return server.httpServer.Shutdown(ctx)
}

func (server *Server) handleHealthz(
	responseWriter http.ResponseWriter,
	_ *http.Request,
) {
	writeStatus(responseWriter, http.StatusOK, "ok")
}

func (server *Server) handleReadyz(
	responseWriter http.ResponseWriter,
	_ *http.Request,
) {
	if !server.ready.Load() {
		writeStatus(responseWriter, http.StatusServiceUnavailable, "not ready")
		return
	}

	writeStatus(responseWriter, http.StatusOK, "ready")
}

func writeStatus(
	responseWriter http.ResponseWriter,
	statusCode int,
	status string,
) {
	responseWriter.Header().Set("Content-Type", "application/json")
	responseWriter.WriteHeader(statusCode)
	_ = json.NewEncoder(responseWriter).Encode(
		map[string]string{"status": status},
	)
}
