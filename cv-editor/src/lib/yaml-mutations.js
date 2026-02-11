import yaml from 'js-yaml'

export const YAML_DUMP_OPTIONS = {
  lineWidth: -1,
  quotingType: '"',
  forceQuotes: false,
  noRefs: true,
}

export function parsePath(path) {
  const parts = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let m
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) parts.push(m[1])
    else if (m[2] !== undefined) parts.push(parseInt(m[2], 10))
  }
  return parts
}

export function reorderSections(yamlString, fromIndex, toIndex) {
  const data = yaml.load(yamlString)
  const sections = [...(data.sections || [])]
  const [moved] = sections.splice(fromIndex, 1)
  const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
  sections.splice(insertAt, 0, moved)
  data.sections = sections
  return yaml.dump(data, YAML_DUMP_OPTIONS)
}

export function reorderBullets(yamlString, bulletsPath, fromIndex, toIndex) {
  const data = yaml.load(yamlString)
  const parts = parsePath(bulletsPath)
  let target = data
  for (const part of parts) {
    target = target[part]
    if (!target) return yamlString
  }
  const bullets = [...target]
  const [moved] = bullets.splice(fromIndex, 1)
  const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
  bullets.splice(insertAt, 0, moved)
  let parent = data
  for (let i = 0; i < parts.length - 1; i++) {
    parent = parent[parts[i]]
  }
  parent[parts[parts.length - 1]] = bullets
  return yaml.dump(data, YAML_DUMP_OPTIONS)
}
