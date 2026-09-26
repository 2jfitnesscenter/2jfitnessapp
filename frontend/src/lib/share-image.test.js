import { describe, expect, it } from 'vitest'
import { captureDimensions, captureOptions } from './share-image.js'

const node = ({ scrollWidth, scrollHeight, width, height }) => ({
  scrollWidth, scrollHeight,
  getBoundingClientRect: () => ({ width, height }),
})

describe('share image capture sizing', () => {
  it('uses the full scroll height when content is taller than the visible card', () => {
    expect(captureDimensions(node({ scrollWidth: 270, scrollHeight: 812, width: 270, height: 480 })))
      .toEqual({ width: 270, height: 812 })
  })

  it('keeps the rendered minimum when content is short and scales the whole canvas', () => {
    const opts = captureOptions(node({ scrollWidth: 260, scrollHeight: 220, width: 270, height: 480 }), 4)
    expect(opts).toMatchObject({ width: 270, height: 480, canvasWidth: 1080, canvasHeight: 1920 })
    expect(opts.style).toEqual({ height: '480px', maxHeight: 'none', overflow: 'visible' })
  })
})
