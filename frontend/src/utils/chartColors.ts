// Fixed-order categorical palette (validated CVD-safe ordering) — always
// assign by index/category identity, never cycle or re-sort by rank.
export const CATEGORICAL_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
]

const categoryColorMap = new Map<string, string>()
let nextColorIndex = 0

export function colorForCategory(category: string): string {
  const key = category.toLowerCase()
  if (!categoryColorMap.has(key)) {
    categoryColorMap.set(key, CATEGORICAL_COLORS[nextColorIndex % CATEGORICAL_COLORS.length])
    nextColorIndex += 1
  }
  return categoryColorMap.get(key)!
}

export const SEQUENTIAL_HUE = '#2a78d6'
