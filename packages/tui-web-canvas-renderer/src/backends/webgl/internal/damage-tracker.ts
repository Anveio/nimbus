export class DamageTracker {
  private readonly tilesDirty = new Set<number>()
  private readonly exposedRows = new Set<number>()
  scrollLines = 0
  overlayChanged = false

  markTileDirty(index: number): void {
    this.tilesDirty.add(index)
  }

  markTilesDirty(indices: Iterable<number>): void {
    for (const index of indices) {
      this.tilesDirty.add(index)
    }
  }

  markRowExposed(row: number): void {
    this.exposedRows.add(row)
  }

  consumeDirtyTiles(): number[] {
    const tiles = [...this.tilesDirty]
    this.tilesDirty.clear()
    return tiles
  }

  consumeExposedRows(): number[] {
    const rows = [...this.exposedRows]
    this.exposedRows.clear()
    return rows
  }

  hasWork(): boolean {
    return (
      this.tilesDirty.size > 0 ||
      this.exposedRows.size > 0 ||
      this.scrollLines !== 0 ||
      this.overlayChanged
    )
  }

  clear(): void {
    this.tilesDirty.clear()
    this.exposedRows.clear()
    this.scrollLines = 0
    this.overlayChanged = false
  }
}
