// Package topologyvalidator contains the pure decision core for a validating
// admission webhook.
//
// Used by: the optional slide-34 code walkthrough and `go test ./webhook`.
// Input: a Kubernetes batch/v1 Job plus an explicit organizational Policy.
// Output: nil when intent is allowed, or a user-facing validation error.
// Side effects: none; this package never calls Kubernetes, Kueue, or DCIM.
//
// The HTTP AdmissionReview handler, TLS deployment, authentication, HA,
// observability, and rollout machinery are intentionally outside the live lab.
// Keeping the policy core deterministic and unit-tested lets the architecture
// slide point to executable code without presenting a toy server as production.
package topologyvalidator

import (
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
)

const (
	QueueLabel                  = "kueue.x-k8s.io/queue-name"
	RequiredTopologyAnnotation = "kueue.x-k8s.io/podset-required-topology"
	PreferredTopologyAnnotation = "kueue.x-k8s.io/podset-preferred-topology"
)

// Policy is versioned configuration in production, not a collection of
// conditionals embedded in the webhook handler.
type Policy struct {
	GPUResourceName      corev1.ResourceName
	AllowedLevels        map[string]struct{}
	LargeJobGPUThreshold int64
	LargeJobLevel        string
}

// DefaultPolicy returns the workshop's allowed topology levels and the rule
// that Jobs requesting eight or more GPUs must require block-level locality.
func DefaultPolicy() Policy {
	return Policy{
		GPUResourceName: "workshop.example.com/gpu",
		AllowedLevels: map[string]struct{}{
			"workshop.example.com/leaf":  {},
			"workshop.example.com/block": {},
		},
		LargeJobGPUThreshold: 8,
		LargeJobLevel:        "workshop.example.com/block",
	}
}

// Validate checks intent and organizational policy. It never chooses a node
// or topology domain; Kueue and kube-scheduler retain those responsibilities.
func Validate(job *batchv1.Job, policy Policy) error {
	if job == nil {
		return fmt.Errorf("job is required")
	}
	replicas := int64(1)
	if job.Spec.Parallelism != nil {
		if *job.Spec.Parallelism < 1 {
			return fmt.Errorf("parallelism must be positive")
		}
		replicas = int64(*job.Spec.Parallelism)
	}

	perPod := requestedGPUPerPod(job.Spec.Template.Spec, policy.GPUResourceName)
	total := perPod * replicas
	if total <= 1 {
		return nil
	}

	if job.Labels[QueueLabel] == "" {
		return fmt.Errorf("distributed GPU jobs must declare %s", QueueLabel)
	}
	annotations := job.Spec.Template.Annotations
	required := annotations[RequiredTopologyAnnotation]
	preferred := annotations[PreferredTopologyAnnotation]
	if (required == "") == (preferred == "") {
		return fmt.Errorf("declare exactly one of %s or %s", RequiredTopologyAnnotation, PreferredTopologyAnnotation)
	}
	level := required
	if level == "" {
		level = preferred
	}
	if _, allowed := policy.AllowedLevels[level]; !allowed {
		return fmt.Errorf("topology level %q is not permitted", level)
	}
	if total >= policy.LargeJobGPUThreshold && (required == "" || required != policy.LargeJobLevel) {
		return fmt.Errorf("jobs requesting %d GPUs must require %q locality", total, policy.LargeJobLevel)
	}
	return nil
}

// TotalRequestedGPU returns the scheduling footprint of the whole Job.
func TotalRequestedGPU(job *batchv1.Job, resourceName corev1.ResourceName) int64 {
	if job == nil {
		return 0
	}
	replicas := int64(1)
	if job.Spec.Parallelism != nil && *job.Spec.Parallelism > 0 {
		replicas = int64(*job.Spec.Parallelism)
	}
	return requestedGPUPerPod(job.Spec.Template.Spec, resourceName) * replicas
}

// requestedGPUPerPod implements the effective Pod scheduling footprint:
// sum regular containers, compare it with the largest init-container request,
// and return the greater value. Init containers run sequentially.
func requestedGPUPerPod(spec corev1.PodSpec, resourceName corev1.ResourceName) int64 {
	regular := int64(0)
	for _, container := range spec.Containers {
		regular += effectiveRequest(container, resourceName)
	}
	initMax := int64(0)
	for _, container := range spec.InitContainers {
		if value := effectiveRequest(container, resourceName); value > initMax {
			initMax = value
		}
	}
	if initMax > regular {
		return initMax
	}
	return regular
}

// effectiveRequest uses the greater of request and limit for defensive policy
// evaluation. Extended resources normally require equal request and limit, but
// admission code should not silently undercount a malformed object.
func effectiveRequest(container corev1.Container, resourceName corev1.ResourceName) int64 {
	request := int64(0)
	if quantity, present := container.Resources.Requests[resourceName]; present {
		request = quantity.Value()
	}
	limit := int64(0)
	if quantity, present := container.Resources.Limits[resourceName]; present {
		limit = quantity.Value()
	}
	if limit > request {
		return limit
	}
	return request
}
