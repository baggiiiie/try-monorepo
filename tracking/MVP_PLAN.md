# MVP Plan

## Goal
Ship a calendar-first timeline where users can overlay their calendar and health data, toggle layers, and review past days with context.

## Scope
- Read-only EventKit events.
- HealthKit daily summaries: sleep, HRV, workouts.
- Manual note/mood logging (1–2 taps).
- Day and Week views with layer toggles.
- Forensics panel (tap a spike to show co-occurring layers).

## Screens
1. **Week View**
   - Base grid of calendar events.
   - Layer toggles in a dock.
   - Quick filter for “only health” or “only commitments”.
2. **Day Forensics View**
   - Vertical stacked timeline with ribbons/pulses.
   - Select any spike to show contextual overlay.
3. **Log Sheet**
   - Fast note/mood input.

## Milestones
1. Data ingestion (EventKit + HealthKit)
2. Basic timeline rendering
3. Layer toggles + filters
4. Manual logging
5. Forensics panel

