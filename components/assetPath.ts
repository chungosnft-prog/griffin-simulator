/**
 * Prefix for files in /public. Empty in dev; on GitHub Pages the site lives
 * under /<repo>/, so the workflow sets NEXT_PUBLIC_BASE_PATH to match.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

export const asset = (path: string) => `${BASE_PATH}${path}`
