export function fakeNode({
  name = '',
  description = '',
  overallDescription = description,
  role = 'button',
  value = '',
  actions = ['activate'],
  box = { left: 10, top: 10, right: 110, bottom: 40 },
} = {}) {
  return {
    name,
    description,
    overallDescription,
    role,
    value,
    className: 'FakeNode',
    localizedControlType: role,
    isEnabled: true,
    activateCount: 0,
    supportedActions: () => actions,
    boundingBox: () => box,
    ancestors: () => [],
    parent: () => null,
    activate() { this.activateCount += 1 },
    focus() {},
    toggle() {},
    select() {},
    expandCollapse() {},
    scrollIntoView() {},
    setValue(next) { this.value = next },
  }
}

export function fakeContext(overrides = {}) {
  return {
    stableAppId: 'Fake App',
    routeKey: 'app-root',
    containerBox: null,
    contextCheck: {
      scopeKind: 'app',
      processName: 'fake-app',
      structuralHash: null,
      ...overrides,
    },
  }
}
