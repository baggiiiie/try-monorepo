package wideevent

import (
	"context"
	"log/slog"
	"sync"
	"testing"
)

func TestAttrBagWithoutContextIsNoop(t *testing.T) {
	ctx := context.Background()
	AddAttrs(ctx, slog.String("ignored", "value"))
	if got := Attrs(ctx); got != nil {
		t.Fatalf("expected nil attrs without bag, got %v", got)
	}
}

func TestAttrBagAccumulatesAttrs(t *testing.T) {
	ctx := WithAttrBag(context.Background())
	AddAttrs(ctx, slog.Int("first", 1))
	AddAttrs(ctx, slog.Int("second", 2))

	got := Attrs(ctx)
	if len(got) != 2 {
		t.Fatalf("expected 2 attrs, got %d (%v)", len(got), got)
	}
	if got[0].Key != "first" || got[0].Value.Int64() != 1 {
		t.Fatalf("unexpected first attr: %v", got[0])
	}
	if got[1].Key != "second" || got[1].Value.Int64() != 2 {
		t.Fatalf("unexpected second attr: %v", got[1])
	}
}

func TestAttrBagAttrsReturnsCopy(t *testing.T) {
	ctx := WithAttrBag(context.Background())
	AddAttrs(ctx, slog.Int("first", 1))

	snapshot := Attrs(ctx)
	AddAttrs(ctx, slog.Int("second", 2))

	if len(snapshot) != 1 {
		t.Fatalf("expected snapshot to be unaffected, got %d attrs", len(snapshot))
	}
}

func TestAttrBagIsConcurrencySafe(t *testing.T) {
	ctx := WithAttrBag(context.Background())

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			AddAttrs(ctx, slog.Int("n", i))
			IncrCounter(ctx, "tx_retries", 1)
		}(i)
	}
	wg.Wait()

	got := Attrs(ctx)
	if len(got) != 51 {
		t.Fatalf("expected 50 attrs + 1 counter, got %d", len(got))
	}
	last := got[len(got)-1]
	if last.Key != "tx_retries" || last.Value.Int64() != 50 {
		t.Fatalf("expected tx_retries=50 counter at end, got %v", last)
	}
}

func TestIncrCounterSuppressesZero(t *testing.T) {
	ctx := WithAttrBag(context.Background())
	IncrCounter(ctx, "tx_retries", 0)
	if got := Attrs(ctx); got != nil {
		t.Fatalf("expected nil attrs when only zero counters exist, got %v", got)
	}
}

func TestIncrCounterWithoutBagIsNoop(t *testing.T) {
	IncrCounter(context.Background(), "tx_retries", 1)
}
