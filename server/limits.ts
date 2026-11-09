export class RateLimit {
  private hits = new Map<string, { until: number; count: number }>()

  take(key: string, max: number, period: number) {
    const now = Date.now()
    const prior = this.hits.get(key)
    if (!prior || prior.until <= now) {
      this.hits.set(key, { until: now + period, count: 1 })
      return true
    }
    if (prior.count >= max) return false
    prior.count++
    return true
  }

  prune() {
    const now = Date.now()
    for (const [key, value] of this.hits) if (value.until <= now) this.hits.delete(key)
  }
}
