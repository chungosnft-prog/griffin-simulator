import type { EasingType } from "./types"

export function ease(t: number, type: EasingType): number {
  const c = Math.max(0, Math.min(1, t))
  switch (type) {
    case "easeIn":    return c * c
    case "easeOut":   return c * (2 - c)
    case "easeInOut": return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c
    default:          return c // linear
  }
}
