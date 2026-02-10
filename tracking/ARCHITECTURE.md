# Architecture Sketch

## Modules
- **DataSources**: adapters for EventKit, HealthKit, MusicKit, Location.
- **Models**: LayerEvent, LayerType, MetricSeries.
- **Timeline**: rendering engine that stacks layers and resolves overlaps.
- **Insights**: simple correlations and summary generation.

## Core Model (concept)
- `LayerEvent`
  - id
  - type (enum: commitment, task, blocked, health, media, location, focus)
  - start/end
  - attributes (structured by type)

- `MetricSeries`
  - type (e.g., HR, stress)
  - points: (timestamp, value)

## Rendering
- Solid blocks for events.
- Ribbons for ambient layers.
- Pulses for metrics.

