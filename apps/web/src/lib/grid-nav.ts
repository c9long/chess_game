/**
 * Arrow-key movement in a grid of `count` items laid out `cols` per row (row-major), for a
 * roving tabindex. Left/Right step through the items in reading order and wrap around;
 * Up/Down move a row and stay in the same column (wrapping to the other end); Home/End jump to
 * the first/last item. Returns null for keys it doesn't handle.
 */
export function gridNavIndex(
  key: string,
  index: number,
  count: number,
  cols: number,
): number | null {
  if (count <= 0) return null
  const last = count - 1
  switch (key) {
    case 'ArrowRight':
      return index >= last ? 0 : index + 1
    case 'ArrowLeft':
      return index <= 0 ? last : index - 1
    case 'ArrowDown': {
      const next = index + cols
      // Wrap to the top of the same column.
      return next <= last ? next : index % cols
    }
    case 'ArrowUp': {
      const prev = index - cols
      if (prev >= 0) return prev
      // Wrap to the same column on the last row that has it.
      const col = index % cols
      let target = col
      while (target + cols <= last) target += cols
      return target
    }
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}
