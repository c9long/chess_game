import { describe, expect, it } from 'vitest'
import { gridNavIndex } from './grid-nav.ts'

// The civ picker: nine tiles, three per row.
//   0 1 2
//   3 4 5
//   6 7 8
describe('gridNavIndex', () => {
  it('moves left and right in reading order, wrapping at the ends', () => {
    expect(gridNavIndex('ArrowRight', 0, 9, 3)).toBe(1)
    expect(gridNavIndex('ArrowRight', 2, 9, 3)).toBe(3)
    expect(gridNavIndex('ArrowRight', 8, 9, 3)).toBe(0)
    expect(gridNavIndex('ArrowLeft', 3, 9, 3)).toBe(2)
    expect(gridNavIndex('ArrowLeft', 0, 9, 3)).toBe(8)
  })

  it('moves up and down a row in the same column, wrapping', () => {
    expect(gridNavIndex('ArrowDown', 1, 9, 3)).toBe(4)
    expect(gridNavIndex('ArrowDown', 7, 9, 3)).toBe(1)
    expect(gridNavIndex('ArrowUp', 4, 9, 3)).toBe(1)
    expect(gridNavIndex('ArrowUp', 2, 9, 3)).toBe(8)
  })

  it('handles a short last row', () => {
    // 0 1 2 / 3 4
    expect(gridNavIndex('ArrowUp', 2, 5, 3)).toBe(2)
    expect(gridNavIndex('ArrowUp', 1, 5, 3)).toBe(4)
    expect(gridNavIndex('ArrowDown', 2, 5, 3)).toBe(2)
    expect(gridNavIndex('ArrowDown', 4, 5, 3)).toBe(1)
  })

  it('jumps with Home and End and ignores other keys', () => {
    expect(gridNavIndex('Home', 5, 9, 3)).toBe(0)
    expect(gridNavIndex('End', 2, 9, 3)).toBe(8)
    expect(gridNavIndex('Enter', 2, 9, 3)).toBeNull()
    expect(gridNavIndex('ArrowRight', 0, 0, 3)).toBeNull()
  })
})
