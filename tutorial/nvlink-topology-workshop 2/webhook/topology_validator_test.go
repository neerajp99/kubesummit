// Unit tests for application-specific admission invariants.
//
// The fixtures are intentionally small: each test isolates one policy promise
// such as queue presence, exclusive fallback mode, approved topology levels,
// or whole-Job GPU accounting. HTTP/TLS behavior is outside this package.
package topologyvalidator

import (
	"strings"
	"testing"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func replicas(value int32) *int32 { return &value }

func job(parallelism int32, perPod int64, annotationKey, level string) *batchv1.Job {
	// Construct only the fields consumed by Validate. Keeping the fixture narrow
	// makes a failed test point directly at policy behavior rather than YAML noise.
	labels := map[string]string{QueueLabel: "gpu-queue"}
	annotations := map[string]string{}
	if annotationKey != "" {
		annotations[annotationKey] = level
	}
	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Labels: labels},
		Spec: batchv1.JobSpec{
			Parallelism: replicas(parallelism),
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Annotations: annotations},
				Spec: corev1.PodSpec{Containers: []corev1.Container{{
					Name: "trainer",
					Resources: corev1.ResourceRequirements{Limits: corev1.ResourceList{
						"workshop.example.com/gpu": *resource.NewQuantity(perPod, resource.DecimalSI),
					}},
				}}},
			},
		},
	}
}

func TestSingleGPUNeedsNoTopology(t *testing.T) {
	if err := Validate(job(1, 1, "", ""), DefaultPolicy()); err != nil {
		t.Fatalf("single GPU should pass: %v", err)
	}
}

func TestDistributedJobRequiresQueue(t *testing.T) {
	j := job(2, 1, RequiredTopologyAnnotation, "workshop.example.com/leaf")
	delete(j.Labels, QueueLabel)
	if err := Validate(j, DefaultPolicy()); err == nil || !strings.Contains(err.Error(), QueueLabel) {
		t.Fatalf("expected queue label error, got %v", err)
	}
}

func TestExactlyOneFallbackPolicy(t *testing.T) {
	j := job(2, 1, RequiredTopologyAnnotation, "workshop.example.com/leaf")
	j.Spec.Template.Annotations[PreferredTopologyAnnotation] = "workshop.example.com/leaf"
	if err := Validate(j, DefaultPolicy()); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("expected exclusive policy error, got %v", err)
	}
}

func TestUnknownLevelRejected(t *testing.T) {
	err := Validate(job(2, 1, RequiredTopologyAnnotation, "example.com/unknown"), DefaultPolicy())
	if err == nil || !strings.Contains(err.Error(), "not permitted") {
		t.Fatalf("expected level error, got %v", err)
	}
}

func TestLargeJobRequiresBlock(t *testing.T) {
	err := Validate(job(8, 1, RequiredTopologyAnnotation, "workshop.example.com/leaf"), DefaultPolicy())
	if err == nil || !strings.Contains(err.Error(), "must require") {
		t.Fatalf("expected block requirement, got %v", err)
	}
	if err := Validate(job(8, 1, RequiredTopologyAnnotation, "workshop.example.com/block"), DefaultPolicy()); err != nil {
		t.Fatalf("block-local large job should pass: %v", err)
	}
}

func TestTotalGPUIncludesParallelism(t *testing.T) {
	j := job(4, 2, RequiredTopologyAnnotation, "workshop.example.com/block")
	if got := TotalRequestedGPU(j, "workshop.example.com/gpu"); got != 8 {
		t.Fatalf("expected 8 total GPUs, got %d", got)
	}
}
