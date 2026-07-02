import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function stableJson(value) {
  return JSON.stringify(sortJson(value))
}

export function hashObject(value) {
  return sha256(stableJson(value))
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  )
}

export function safe(_label, fn, fallback = null) {
  try {
    const value = fn()
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

export function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function boxArea(box) {
  if (!box) return 0
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)
}

export function boxCenter(box) {
  if (!box) return null
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  }
}

export function posHint(box, containerBox) {
  const center = boxCenter(box)
  if (!center || !containerBox) return null
  const width = Math.max(1, containerBox.right - containerBox.left)
  const height = Math.max(1, containerBox.bottom - containerBox.top)
  return {
    xRatio: round((center.x - containerBox.left) / width, 4),
    yRatio: round((center.y - containerBox.top) / height, 4),
  }
}

export function processName(pid) {
  if (!pid) return ''
  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return basename(output).toLowerCase()
  } catch {
    return ''
  }
}

export function pidsForAppCandidates(candidates) {
  const pids = new Set()
  for (const candidate of candidates) {
    for (const args of [['-x', candidate], ['-if', candidate]]) {
      try {
        const output = execFileSync('pgrep', args, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        for (const line of output.split('\n')) {
          const pid = Number(line.trim())
          if (Number.isFinite(pid) && pid > 0) pids.add(pid)
        }
      } catch {
        // no match for this candidate/form
      }
    }
  }

  return [...pids]
    .filter((pid) => {
      const proc = processName(pid)
      return candidates.some((candidate) => proc.includes(candidate.toLowerCase()))
    })
    .sort((a, b) => a - b)
}
