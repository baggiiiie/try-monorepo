# Multi-Layered Life Calendar

## Vision
A calendar-first personal data timeline that overlays life signals (health, focus, location, media, and commitments) into layered time. The app is a time machine: plan the future with real context and review the past with meaningful correlations.

## Principles
- Calendar is the primary surface, not a dashboard.
- Different data types behave as distinct layer types, not generic events.
- Correlation beats raw tracking: the value is in context.
- Privacy-first, on-device by default with optional iCloud sync.

## Target Platforms
- iOS (primary)
- macOS (companion; optional data signals from desktop activity)

## Core User Journeys
1. **Plan with context**
   - Open tomorrow and see predicted energy based on sleep.
   - Drag a focus block into a low-stress window suggested by data.
2. **Reflect with context**
   - Tap a stress spike and see what co-occurred: meetings, location, music.
   - Weekly review auto-generates patterns and prompts.
3. **Understand time leakage**
   - Compare planned time vs actual activity layers.

## Layer Types (first-class types)
- **Commitments**: Meetings, appointments (EventKit).
- **Tasks**: User-created blocks with completion states.
- **Blocked Time**: “Do not schedule” placeholders.
- **Health**: Sleep, heart rate, HRV, workouts, mindfulness (HealthKit).
- **Focus/Device**: App usage bands, focus sessions (DeviceActivity on iOS; optional macOS helper).
- **Media**: Music sessions from Apple Music/Spotify.
- **Location**: Dwell time, travel arcs, commute windows.

## Visual Language
- **Grid**: Traditional day/week calendar grid as the base.
- **Layers**:
  - Solid blocks = commitments/tasks.
  - Ribbons = background activity (focus, media, location).
  - Pulses = metrics (HR, stress spikes).
- **Modes**:
  - Planning Mode (forward-looking colors, clearer blocks).
  - Forensics Mode (past-focused, richer overlays).
- **Noise Control**: A “signal slider” to fade less important layers.

## Functional Scope (MVP)
- Read calendar events from EventKit.
- Import daily HealthKit summaries (sleep, HRV, workouts).
- Manual quick logging (mood or note) for the day.
- Timeline view with layer toggles.
- Day view “forensics” panel (tap a spike to see co-occurring layers).

## Phase 2 (Post-MVP)
- Music history from Apple Music and Spotify.
- Location-based layers (commute, dwell time).
- Focus layers from DeviceActivity + macOS helper.
- Correlation insights and weekly review.
- “Energy forecast” for upcoming days.

## Privacy & Safety
- On-device storage by default.
- Explicit opt-in for each data source.
- Clear data export and deletion options.

## Risks & Constraints
- Screen Time APIs are limited for full usage history.
- Apple Music and Spotify have partial history access.
- Safari history is not accessible on iOS.

