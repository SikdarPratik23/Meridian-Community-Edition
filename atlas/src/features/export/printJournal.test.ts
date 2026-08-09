/**
 * Unit tests for the PDF/print document's correctness-critical internals.
 *
 * `printJournal` itself only opens a window and calls print(), so the parts worth
 * asserting are the hand-rolled markdown→HTML pass (there is no library to trust
 * here) and the HTML escaping that stands between journal prose and the generated
 * document. A caption containing `<script>` must never reach the output as markup.
 */
import { describe, expect, test } from 'vitest'
import { bodyToHtml, esc, inlineMd, routeSvg } from './printJournal'
import { COORDS, image, journal } from '../../test/factories'

describe('esc', () => {
  test('escapes all five HTML-significant characters', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  test('escapes the ampersand first so entities are not double-broken', () => {
    expect(esc('<')).toBe('&lt;')
    expect(esc('&lt;')).toBe('&amp;lt;')
  })

  test('leaves ordinary prose untouched', () => {
    expect(esc('A warm evening in Nuremberg.')).toBe('A warm evening in Nuremberg.')
  })

  test('leaves unicode and emoji untouched', () => {
    expect(esc('আজ 🌍')).toBe('আজ 🌍')
  })

  test('neutralises a script tag', () => {
    expect(esc('<script>alert(1)</script>')).not.toContain('<script>')
  })
})

describe('inlineMd', () => {
  test('bold', () => {
    expect(inlineMd('a **bold** b')).toBe('a <strong>bold</strong> b')
  })

  test('italic', () => {
    expect(inlineMd('a *soft* b')).toBe('a <em>soft</em> b')
  })

  test('inline code', () => {
    expect(inlineMd('use `npm test`')).toBe('use <code>npm test</code>')
  })

  test('links', () => {
    expect(inlineMd('[OSM](https://osm.org)')).toBe('<a href="https://osm.org">OSM</a>')
  })

  test('bold wins over italic for a doubled asterisk', () => {
    expect(inlineMd('**strong**')).toBe('<strong>strong</strong>')
  })

  test('several marks in one line', () => {
    expect(inlineMd('**a** and *b* and `c`')).toBe(
      '<strong>a</strong> and <em>b</em> and <code>c</code>',
    )
  })

  test('leaves unmatched marks alone', () => {
    expect(inlineMd('2 * 3 = 6')).toBe('2 * 3 = 6')
  })
})

describe('bodyToHtml', () => {
  test('a plain line becomes a paragraph', () => {
    expect(bodyToHtml('Hello there.', [])).toBe('<p>Hello there.</p>')
  })

  test('consecutive lines join into one paragraph', () => {
    expect(bodyToHtml('One line\nsecond line', [])).toBe('<p>One line second line</p>')
  })

  test('a blank line starts a new paragraph', () => {
    expect(bodyToHtml('First.\n\nSecond.', [])).toBe('<p>First.</p>\n<p>Second.</p>')
  })

  test('headings map to h2–h4 (h1 is the entry title)', () => {
    expect(bodyToHtml('# Big', [])).toBe('<h2>Big</h2>')
    expect(bodyToHtml('## Mid', [])).toBe('<h3>Mid</h3>')
    expect(bodyToHtml('### Small', [])).toBe('<h4>Small</h4>')
  })

  test('four hashes is not a heading', () => {
    expect(bodyToHtml('#### Nope', [])).toContain('<p>')
  })

  test('blockquotes', () => {
    expect(bodyToHtml('> Quoted', [])).toBe('<blockquote>Quoted</blockquote>')
  })

  test('bullet lists gather into one ul', () => {
    expect(bodyToHtml('- one\n- two', [])).toBe('<ul><li>one</li><li>two</li></ul>')
  })

  test('asterisk bullets work too', () => {
    expect(bodyToHtml('* one\n* two', [])).toBe('<ul><li>one</li><li>two</li></ul>')
  })

  test('numbered lists gather into one ol', () => {
    expect(bodyToHtml('1. one\n2. two', [])).toBe('<ol><li>one</li><li>two</li></ol>')
  })

  test('switching list type closes the previous list', () => {
    const html = bodyToHtml('- bullet\n1. number', [])
    expect(html).toBe('<ul><li>bullet</li></ul>\n<ol><li>number</li></ol>')
  })

  test('a paragraph after a list closes the list first', () => {
    const html = bodyToHtml('- one\n\nAfter.', [])
    expect(html).toBe('<ul><li>one</li></ul>\n<p>After.</p>')
  })

  test('inline marks are applied inside paragraphs, lists and headings', () => {
    expect(bodyToHtml('**bold** text', [])).toBe('<p><strong>bold</strong> text</p>')
    expect(bodyToHtml('- **bold** item', [])).toBe('<ul><li><strong>bold</strong> item</li></ul>')
    expect(bodyToHtml('## **bold** head', [])).toBe('<h3><strong>bold</strong> head</h3>')
  })

  test('an empty body produces nothing', () => {
    expect(bodyToHtml('', [])).toBe('')
  })

  test('a whitespace-only body produces nothing', () => {
    expect(bodyToHtml('   \n\n  \n', [])).toBe('')
  })

  test('normalises Windows line endings', () => {
    expect(bodyToHtml('First.\r\n\r\nSecond.', [])).toBe('<p>First.</p>\n<p>Second.</p>')
  })

  describe('escaping', () => {
    test('HTML in prose is escaped, not emitted as markup', () => {
      expect(bodyToHtml('<script>alert(1)</script>', [])).toBe(
        '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
      )
    })

    test('HTML in a heading is escaped', () => {
      expect(bodyToHtml('# <b>x</b>', [])).toBe('<h2>&lt;b&gt;x&lt;/b&gt;</h2>')
    })

    test('HTML in a list item is escaped', () => {
      expect(bodyToHtml('- <img onerror=x>', [])).toContain('&lt;img onerror=x&gt;')
    })

    test('an ampersand in prose becomes an entity', () => {
      expect(bodyToHtml('Fish & chips', [])).toBe('<p>Fish &amp; chips</p>')
    })
  })

  describe('inline photos', () => {
    const photo = image({ id: 'ph-1', data: 'data:image/jpeg;base64,ZZZ' })

    test('an attachment ref resolves to its stored data URL', () => {
      const html = bodyToHtml('![](attachment:ph-1)', [photo])
      expect(html).toContain('<figure class="ph">')
      expect(html).toContain('src="data:image/jpeg;base64,ZZZ"')
    })

    test('a caption becomes both alt text and a figcaption', () => {
      const html = bodyToHtml('![The summit](attachment:ph-1)', [photo])
      expect(html).toContain('alt="The summit"')
      expect(html).toContain('<figcaption>The summit</figcaption>')
    })

    test('no caption means no figcaption element', () => {
      expect(bodyToHtml('![](attachment:ph-1)', [photo])).not.toContain('<figcaption>')
    })

    test('a ref whose attachment is missing is dropped, not left broken', () => {
      // Photos can go missing after a sync trim; an empty <img src> in a PDF
      // would render as a broken-image box.
      expect(bodyToHtml('![](attachment:gone)', [photo])).toBe('')
    })

    test('a caption containing HTML is escaped', () => {
      const html = bodyToHtml('![<script>x</script>](attachment:ph-1)', [photo])
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })

    test('an ordinary image URL passes through', () => {
      const html = bodyToHtml('![remote](https://example.com/a.jpg)', [])
      expect(html).toContain('src="https://example.com/a.jpg"')
    })

    test('a photo between paragraphs closes the paragraph first', () => {
      const html = bodyToHtml('Before\n\n![](attachment:ph-1)\n\nAfter', [photo])
      expect(html.indexOf('<p>Before</p>')).toBeLessThan(html.indexOf('<figure'))
      expect(html.indexOf('<figure')).toBeLessThan(html.indexOf('<p>After</p>'))
    })

    test('a photo directly after a list closes the list', () => {
      const html = bodyToHtml('- one\n![](attachment:ph-1)', [photo])
      expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<figure'))
    })

    test('several photos each get their own figure', () => {
      const html = bodyToHtml('![a](attachment:ph-1)\n\n![b](attachment:ph-2)', [
        photo,
        image({ id: 'ph-2' }),
      ])
      expect(html.match(/<figure/g)).toHaveLength(2)
    })
  })
})

describe('routeSvg', () => {
  const at = (lon: number, lat: number) => journal({ longitude: lon, latitude: lat })

  test('an empty route produces nothing', () => {
    expect(routeSvg([])).toBe('')
  })

  test('a single point renders a pin but no path', () => {
    const svg = routeSvg([at(...COORDS.nuremberg)])
    expect(svg).toContain('<svg')
    expect(svg).toContain('<circle')
    expect(svg).not.toContain('<path')
  })

  test('two points render a dashed path and two numbered pins', () => {
    const svg = routeSvg([at(...COORDS.nuremberg), at(...COORDS.munich)])
    expect(svg).toContain('stroke-dasharray')
    expect(svg.match(/<circle/g)).toHaveLength(2)
    expect(svg).toContain('>1</text>')
    expect(svg).toContain('>2</text>')
  })

  test('pins are numbered in the order given', () => {
    const svg = routeSvg([at(11, 49), at(12, 50), at(13, 51)])
    const nums = [...svg.matchAll(/>(\d+)<\/text>/g)].map((m) => m[1])
    expect(nums).toEqual(['1', '2', '3'])
  })

  test('all coordinates land inside the viewBox', () => {
    const svg = routeSvg([at(11, 49), at(12, 50), at(13, 51)])
    for (const m of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0)
      expect(Number(m[1])).toBeLessThanOrEqual(720)
      expect(Number(m[2])).toBeGreaterThanOrEqual(0)
      expect(Number(m[2])).toBeLessThanOrEqual(380)
    }
  })

  test('identical points do not divide by zero', () => {
    // The span guards (`Math.max(1e-6, …)`) exist for exactly this case.
    const svg = routeSvg([at(11, 49), at(11, 49)])
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  test('a route spanning the globe stays finite', () => {
    const svg = routeSvg([at(-179, -80), at(179, 80)])
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  test('a polar route (cos-latitude near zero) stays finite', () => {
    const svg = routeSvg([at(0, 89.999), at(10, 89.999)])
    expect(svg).not.toContain('NaN')
  })

  test('is self-contained SVG — no tiles, no network references', () => {
    const svg = routeSvg([at(11, 49), at(12, 50)])
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toContain('http://tile')
    expect(svg).not.toContain('https://')
  })

  test('carries an accessible label', () => {
    expect(routeSvg([at(11, 49)])).toContain('aria-label="Route sketch"')
  })
})
